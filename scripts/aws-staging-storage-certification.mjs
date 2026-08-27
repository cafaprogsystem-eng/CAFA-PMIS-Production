#!/usr/bin/env node

import { randomUUID } from "node:crypto";

const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";
const identifier = process.env.CAFA_STAGING_LOGIN_IDENTIFIER?.trim() ?? "";
const password = process.env.CAFA_STAGING_LOGIN_PASSWORD ?? "";

function blocked(message) {
  throw new Error(message);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

let origin;
try {
  origin = new URL(rawBaseUrl);
} catch {
  console.error("AWS staging storage certification blocked: invalid CAFA_STAGING_BASE_URL.");
  process.exit(1);
}

if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  console.error(
    "AWS staging storage certification blocked: CAFA_STAGING_BASE_URL must be an exact HTTPS origin.",
  );
  process.exit(1);
}

if (!identifier || !password) {
  console.error(
    "AWS staging storage certification blocked: staging login credentials are required.",
  );
  process.exit(1);
}

const baseUrl = origin.toString().replace(/\/$/, "");

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function apiRequest(path, sessionCookie, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "error",
    ...options,
    headers: {
      Accept: "application/json",
      ...(sessionCookie ? { Cookie: sessionCookie } : {}),
      ...(options.headers ?? {}),
    },
  });
}

function cookieHeaderFrom(response) {
  const values =
    typeof response.headers.getSetCookie === "function"
      ? response.headers.getSetCookie()
      : [response.headers.get("set-cookie")].filter(Boolean);

  return values
    .map((value) => value.split(";", 1)[0])
    .filter(Boolean)
    .join("; ");
}

let sessionCookie = null;
let resourceId = null;
let resourceDeleted = false;
let primaryError = null;
let cleanupError = null;

try {
  const login = await apiRequest("/api/auth/login", null, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identifier,
      password,
      remember: false,
    }),
  });

  const loginBody = await jsonOrNull(login);

  if (login.status !== 200 || !loginBody?.user?.id) {
    blocked(`/api/auth/login returned ${login.status}; expected authenticated 200.`);
  }

  sessionCookie = cookieHeaderFrom(login);
  if (!sessionCookie) {
    blocked("Login did not issue a usable session cookie.");
  }

  pass("Authenticated staging session established.");

  const unique = randomUUID();
  const fileName = `cafa-staging-storage-certification-${unique}.txt`;
  const contentType = "text/plain";
  const content = Buffer.from(
    `CAFA PMIS staging storage certification\n${unique}\n`,
    "utf8",
  );

  const descriptorResponse = await apiRequest(
    "/api/storage/uploads/request-url",
    sessionCookie,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: fileName,
        size: content.byteLength,
        contentType,
        scope: "documents",
      }),
    },
  );

  const descriptor = await jsonOrNull(descriptorResponse);

  if (
    descriptorResponse.status !== 200 ||
    typeof descriptor?.uploadURL !== "string" ||
    typeof descriptor?.objectPath !== "string" ||
    typeof descriptor?.uploadToken !== "string"
  ) {
    blocked(
      `/api/storage/uploads/request-url returned an invalid descriptor (${descriptorResponse.status}).`,
    );
  }

  if (!descriptor.objectPath.startsWith("/objects/uploads/")) {
    blocked("Upload descriptor did not use the protected uploads namespace.");
  }

  pass("Signed document upload descriptor issued.");

  const uploadUrl = new URL(descriptor.uploadURL);
  if (uploadUrl.protocol !== "https:") {
    blocked("Presigned object-storage upload URL is not HTTPS.");
  }

  const preflight = await fetch(descriptor.uploadURL, {
    method: "OPTIONS",
    redirect: "error",
    headers: {
      Origin: baseUrl,
      "Access-Control-Request-Method": "PUT",
      "Access-Control-Request-Headers": "content-type",
    },
  });

  if (!preflight.ok) {
    blocked(`Object-storage CORS preflight returned ${preflight.status}.`);
  }

  const allowedOrigin =
    preflight.headers.get("access-control-allow-origin") ?? "";
  const allowedMethods =
    preflight.headers.get("access-control-allow-methods") ?? "";
  const exposedHeaders =
    preflight.headers.get("access-control-expose-headers") ?? "";

  if (allowedOrigin !== baseUrl) {
    blocked("Object-storage CORS did not allow the exact staging origin.");
  }

  if (!allowedMethods.toUpperCase().split(/\s*,\s*/).includes("PUT")) {
    blocked("Object-storage CORS did not allow PUT.");
  }

  if (!/\betag\b/i.test(exposedHeaders)) {
    blocked("Object-storage CORS did not expose ETag.");
  }

  pass("S3 CORS preflight allows exact staging-origin PUT and exposes ETag.");

  const putResponse = await fetch(descriptor.uploadURL, {
    method: "PUT",
    redirect: "error",
    headers: {
      "Content-Type": contentType,
      Origin: baseUrl,
    },
    body: content,
  });

  if (!putResponse.ok) {
    blocked(`Presigned object-storage PUT returned ${putResponse.status}.`);
  }

  if (!putResponse.headers.get("etag")) {
    blocked("Presigned object-storage PUT did not return ETag.");
  }

  pass("Presigned S3 PUT succeeded and returned ETag.");

  const registrationResponse = await apiRequest(
    "/api/files/upload",
    sessionCookie,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Staging Storage Certification ${unique}`,
        description:
          "Temporary automated staging verification file for the S3 lifecycle certification.",
        classification: "Technical Resources",
        sector: "General / Cross-Cutting",
        confidentiality: "internal",
        retentionYears: 1,
        tags: ["staging-test", "storage-certification"],
        objectPath: descriptor.objectPath,
        fileName,
        uploadToken: descriptor.uploadToken,
        contentType,
      }),
    },
  );

  const registration = await jsonOrNull(registrationResponse);

  if (
    registrationResponse.status !== 201 ||
    !Number.isInteger(Number(registration?.id)) ||
    registration?.source !== "resource"
  ) {
    blocked(
      `/api/files/upload returned an invalid registration response (${registrationResponse.status}).`,
    );
  }

  resourceId = Number(registration.id);
  pass("Uploaded object finalized and registered as a program resource.");

  const download = await apiRequest(
    `/api/files/resource/${resourceId}/download`,
    sessionCookie,
  );

  if (download.status !== 200) {
    blocked(`Authenticated file download returned ${download.status}; expected 200.`);
  }

  if (!/private/i.test(download.headers.get("cache-control") ?? "") ||
      !/no-store/i.test(download.headers.get("cache-control") ?? "")) {
    blocked("Authenticated download is missing private, no-store cache protection.");
  }

  if (!/attachment/i.test(download.headers.get("content-disposition") ?? "")) {
    blocked("Authenticated download is missing attachment Content-Disposition.");
  }

  const downloaded = Buffer.from(await download.arrayBuffer());

  if (!downloaded.equals(content)) {
    blocked("Downloaded file content does not exactly match the uploaded content.");
  }

  pass("Authenticated download returned exact content with no-store protection.");

  const deleteResponse = await apiRequest(
    `/api/files/resource/${resourceId}`,
    sessionCookie,
    { method: "DELETE" },
  );

  const deleteBody = await jsonOrNull(deleteResponse);

  if (deleteResponse.status !== 200 || deleteBody?.ok !== true) {
    blocked(`/api/files/resource/${resourceId} deletion failed.`);
  }

  resourceDeleted = true;
  pass("Program resource deletion succeeded.");

  const afterDelete = await apiRequest(
    `/api/files/resource/${resourceId}/download`,
    sessionCookie,
  );

  if (afterDelete.status !== 404) {
    blocked(
      `Deleted resource download returned ${afterDelete.status}; expected 404.`,
    );
  }

  pass("Deleted resource is no longer addressable through the application.");

  const auditResponse = await apiRequest(
    "/api/audit-log?module=files&search=file_archive_resource_storage_cleanup_failed&page=1&pageSize=100",
    sessionCookie,
  );

  const auditBody = await jsonOrNull(auditResponse);

  if (auditResponse.status !== 200 || !Array.isArray(auditBody?.items)) {
    blocked(
      `Storage cleanup audit verification returned ${auditResponse.status}; expected 200.`,
    );
  }

  const cleanupFailure = auditBody.items.some(
    (item) =>
      item?.action === "file_archive_resource_storage_cleanup_failed" &&
      Number(item?.entityId) === resourceId,
  );

  if (cleanupFailure) {
    blocked("S3 provider-side cleanup failure was recorded for the test resource.");
  }

  pass("No S3 provider-side cleanup failure was recorded.");

  console.log("");
  console.log(`AWS staging storage certification passed for ${baseUrl}.`);
  console.log(
    "Verified signed descriptor, CORS preflight, presigned PUT, ETag, finalize/register, authenticated exact-content download, delete, and S3 cleanup audit.",
  );
} catch (error) {
  primaryError = error;
} finally {
  if (resourceId && !resourceDeleted && sessionCookie) {
    try {
      const cleanup = await apiRequest(
        `/api/files/resource/${resourceId}`,
        sessionCookie,
        { method: "DELETE" },
      );
      const cleanupBody = await jsonOrNull(cleanup);
      if (cleanup.status !== 200 || cleanupBody?.ok !== true) {
        throw new Error(
          `best-effort resource cleanup returned ${cleanup.status}`,
        );
      }
      console.log("CLEANUP: Temporary registered resource removed.");
    } catch (error) {
      cleanupError = error;
    }
  }

  if (sessionCookie) {
    try {
      await apiRequest("/api/auth/logout", sessionCookie, {
        method: "POST",
      });
    } catch {
      // The certification result does not depend on logout; the session has a
      // bounded lifetime and the dedicated auth certification verifies revoke.
    }
  }
}

if (primaryError) {
  console.error(
    `AWS staging storage certification blocked: ${
      primaryError instanceof Error ? primaryError.message : String(primaryError)
    }`,
  );
}

if (cleanupError) {
  console.error(
    `AWS staging storage certification cleanup failed: ${
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    }`,
  );
}

if (primaryError || cleanupError) {
  process.exit(1);
}
