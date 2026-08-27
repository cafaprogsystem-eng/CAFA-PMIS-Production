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
    "AWS staging plan business-flow certification blocked: invalid CAFA_STAGING_BASE_URL.",
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
    "AWS staging plan business-flow certification blocked: CAFA_STAGING_BASE_URL must be an exact HTTPS origin.",
  );
  process.exit(1);
}

if (!identifier || !password) {
  console.error(
    "AWS staging plan business-flow certification blocked: staging login credentials are required.",
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
  return (
    Array.isArray(permissions) &&
    (permissions.includes("*") || permissions.includes(required))
  );
}

let sessionCookie = null;
let planId = null;
let planDeleted = false;
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
    blocked(
      `/api/auth/login returned ${login.status}; expected authenticated 200.`,
    );
  }

  sessionCookie = cookieHeaderFrom(login);
  if (!sessionCookie) {
    blocked("Login did not issue a usable session cookie.");
  }

  const permissions =
    loginBody.permissions ?? loginBody.user?.permissions ?? [];

  if (!hasPermission(permissions, "plans.create")) {
    blocked("Certification account does not have plans.create permission.");
  }

  if (!hasPermission(permissions, "plans.delete")) {
    blocked(
      "Certification account does not have plans.delete permission; refusing to create a fixture that cannot be safely cleaned up.",
    );
  }

  pass("Authenticated staging session has plan create/delete permissions.");

  const unique = randomUUID();
  const title = `Staging Plan Certification ${unique}`;

  const createResponse = await apiRequest("/api/plans", sessionCookie, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title,
      frequency: "monthly",
      locationType: "hq",
    }),
  });

  const created = await jsonOrNull(createResponse);

  if (
    createResponse.status === 201 &&
    Number.isInteger(Number(created?.id))
  ) {
    // Capture the ID immediately so finally can clean up even if a later
    // response-contract assertion fails.
    planId = Number(created.id);
  }

  if (
    createResponse.status !== 201 ||
    !planId ||
    typeof created?.code !== "string" ||
    created?.title !== title ||
    created?.status !== "draft" ||
    created?.frequency !== "monthly" ||
    created?.locationType !== "hq" ||
    created?.stateId != null ||
    created?.projectId != null ||
    typeof created?.registrationToken !== "string" ||
    created.registrationToken.length === 0
  ) {
    blocked(
      `/api/plans returned an invalid HQ draft create response (${createResponse.status}).`,
    );
  }

  if (!/^CAFA-PLAN-HQ-\d+$/.test(created.code)) {
    blocked("Created HQ plan did not receive the canonical HQ plan code.");
  }

  // registrationToken is intentionally never printed. It is a one-time bearer
  // credential and its lifecycle is cleaned when the temporary plan is deleted.
  pass(`Temporary HQ draft plan created (${created.code}).`);

  const readResponse = await apiRequest(
    `/api/plans/${planId}`,
    sessionCookie,
  );
  const plan = await jsonOrNull(readResponse);

  if (
    readResponse.status !== 200 ||
    Number(plan?.id) !== planId ||
    plan?.title !== title ||
    plan?.status !== "draft" ||
    plan?.frequency !== "monthly" ||
    plan?.locationType !== "hq" ||
    plan?.stateId != null ||
    plan?.projectId != null ||
    !Array.isArray(plan?.activities) ||
    plan.activities.length !== 0 ||
    Number(plan?.activitiesCount ?? 0) !== 0
  ) {
    blocked(
      `/api/plans/${planId} did not return the expected persisted HQ draft plan contract.`,
    );
  }

  pass("Created HQ plan persisted and is readable through the scoped detail endpoint.");

  const deleteResponse = await apiRequest(
    `/api/plans/${planId}`,
    sessionCookie,
    { method: "DELETE" },
  );

  if (deleteResponse.status !== 204) {
    blocked(
      `/api/plans/${planId} cleanup returned ${deleteResponse.status}; expected 204.`,
    );
  }

  planDeleted = true;
  pass("Temporary plan was deleted through the production deletion policy.");

  const afterDelete = await apiRequest(
    `/api/plans/${planId}`,
    sessionCookie,
  );
  const afterDeleteBody = await jsonOrNull(afterDelete);

  if (
    afterDelete.status !== 404 ||
    afterDeleteBody?.error !== "plan_not_found"
  ) {
    blocked(
      `Deleted plan lookup returned ${afterDelete.status}; expected 404 plan_not_found.`,
    );
  }

  pass("Deleted plan is no longer addressable through the application.");

  console.log("");
  console.log(
    `AWS staging plan business-flow certification passed for ${baseUrl}.`,
  );
  console.log(
    "Verified HQ draft creation, one-time registration credential issuance, scoped detail read, production delete, and post-delete absence.",
  );
} catch (error) {
  primaryError = error;
} finally {
  if (planId && !planDeleted && sessionCookie) {
    try {
      const cleanup = await apiRequest(
        `/api/plans/${planId}`,
        sessionCookie,
        { method: "DELETE" },
      );

      if (cleanup.status !== 204) {
        throw new Error(
          `best-effort plan cleanup returned ${cleanup.status}`,
        );
      }

      console.log("CLEANUP: Temporary plan removed.");
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
      // Session revoke semantics are independently covered by the dedicated
      // authenticated staging certification.
    }
  }
}

if (primaryError) {
  console.error(
    `AWS staging plan business-flow certification blocked: ${
      primaryError instanceof Error
        ? primaryError.message
        : String(primaryError)
    }`,
  );
}

if (cleanupError) {
  console.error(
    `AWS staging plan business-flow certification cleanup failed: ${
      cleanupError instanceof Error
        ? cleanupError.message
        : String(cleanupError)
    }`,
  );
}

if (primaryError || cleanupError) {
  process.exit(1);
}
