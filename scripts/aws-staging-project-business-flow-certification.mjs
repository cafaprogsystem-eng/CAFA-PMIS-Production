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
  console.error(
    "AWS staging project business-flow certification blocked: invalid CAFA_STAGING_BASE_URL.",
  );
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
    "AWS staging project business-flow certification blocked: CAFA_STAGING_BASE_URL must be an exact HTTPS origin.",
  );
  process.exit(1);
}

if (!identifier || !password) {
  console.error(
    "AWS staging project business-flow certification blocked: staging login credentials are required.",
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

function hasPermission(permissions, required) {
  return Array.isArray(permissions) &&
    (permissions.includes("*") || permissions.includes(required));
}

let sessionCookie = null;
let projectId = null;
let projectDeleted = false;
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

  const permissions = loginBody.permissions ?? loginBody.user?.permissions ?? [];

  if (!hasPermission(permissions, "projects.create")) {
    blocked("Certification account does not have projects.create permission.");
  }

  if (!hasPermission(permissions, "projects.delete")) {
    blocked(
      "Certification account does not have projects.delete permission; refusing to create a fixture that cannot be safely cleaned up.",
    );
  }

  pass("Authenticated staging session has project create/delete permissions.");

  const unique = randomUUID();
  const title = `Staging Project Certification ${unique}`;
  const agreementNumber = `CERT-${unique}`;
  const description =
    `Temporary CAFA PMIS staging project business-flow certification fixture ${unique}. ` +
    "This record must be permanently deleted by the certification cleanup path.";

  const createResponse = await apiRequest("/api/projects", sessionCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      description,
      agreementNumber,
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      sectors: ["Health"],
      donor: "UNFPA",
      reportingFrequency: "monthly",
      hasHqOperations: true,
      stateIds: [],
    }),
  });

  const created = await jsonOrNull(createResponse);

  if (
    createResponse.status !== 201 ||
    !Number.isInteger(Number(created?.id)) ||
    typeof created?.code !== "string" ||
    created?.title !== title ||
    created?.status !== "draft" ||
    created?.reportingFrequency !== "monthly"
  ) {
    blocked(
      `/api/projects returned an invalid create response (${createResponse.status}).`,
    );
  }

  projectId = Number(created.id);

  if (!/^CAFA-PROJ-\d{4}-\d+$/.test(created.code)) {
    blocked("Created project did not receive the canonical CAFA project code.");
  }

  pass(`Temporary HQ-only draft project created (${created.code}).`);

  const readResponse = await apiRequest(
    `/api/projects/${projectId}`,
    sessionCookie,
  );
  const readBody = await jsonOrNull(readResponse);
  const project = readBody?.project;

  if (
    readResponse.status !== 200 ||
    Number(project?.id) !== projectId ||
    project?.title !== title ||
    project?.agreementNumber !== agreementNumber ||
    project?.status !== "draft" ||
    project?.reportingFrequency !== "monthly" ||
    project?.hasHqOperations !== true ||
    !Array.isArray(readBody?.states) ||
    readBody.states.length !== 0
  ) {
    blocked(
      `/api/projects/${projectId} did not return the expected persisted HQ-only draft project contract.`,
    );
  }

  pass("Created project persisted and is readable through the scoped detail endpoint.");

  const deleteResponse = await apiRequest(
    `/api/projects/${projectId}`,
    sessionCookie,
    {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reason: "Automated staging project certification cleanup.",
      }),
    },
  );

  const deleteBody = await jsonOrNull(deleteResponse);

  if (
    deleteResponse.status !== 200 ||
    Number(deleteBody?.projectId) !== projectId ||
    deleteBody?.deletionMode !== "permanent"
  ) {
    blocked(
      `/api/projects/${projectId} cleanup returned an invalid deletion response (${deleteResponse.status}).`,
    );
  }

  projectDeleted = true;
  pass("Temporary project was permanently deleted through the production deletion policy.");

  const afterDelete = await apiRequest(
    `/api/projects/${projectId}`,
    sessionCookie,
  );
  const afterDeleteBody = await jsonOrNull(afterDelete);

  if (
    afterDelete.status !== 404 ||
    afterDeleteBody?.error !== "project not found"
  ) {
    blocked(
      `Deleted project lookup returned ${afterDelete.status}; expected 404 project not found.`,
    );
  }

  pass("Deleted project is no longer addressable through the application.");

  console.log("");
  console.log(
    `AWS staging project business-flow certification passed for ${baseUrl}.`,
  );
  console.log(
    "Verified create, persisted HQ-only draft state, scoped detail read, production permanent delete, and post-delete absence.",
  );
} catch (error) {
  primaryError = error;
} finally {
  if (projectId && !projectDeleted && sessionCookie) {
    try {
      const cleanup = await apiRequest(
        `/api/projects/${projectId}`,
        sessionCookie,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reason: "Best-effort staging project certification cleanup.",
          }),
        },
      );

      const cleanupBody = await jsonOrNull(cleanup);

      if (
        cleanup.status !== 200 ||
        Number(cleanupBody?.projectId) !== projectId ||
        cleanupBody?.deletionMode !== "permanent"
      ) {
        throw new Error(
          `best-effort project cleanup returned ${cleanup.status}`,
        );
      }

      console.log("CLEANUP: Temporary project permanently removed.");
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
      // Authentication/session revocation is independently certified by the
      // dedicated authenticated staging certification.
    }
  }
}

if (primaryError) {
  console.error(
    `AWS staging project business-flow certification blocked: ${
      primaryError instanceof Error ? primaryError.message : String(primaryError)
    }`,
  );
}

if (cleanupError) {
  console.error(
    `AWS staging project business-flow certification cleanup failed: ${
      cleanupError instanceof Error ? cleanupError.message : String(cleanupError)
    }`,
  );
}

if (primaryError || cleanupError) {
  process.exit(1);
}
