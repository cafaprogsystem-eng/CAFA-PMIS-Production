#!/usr/bin/env node

import { randomUUID } from "node:crypto";

export function fixtureId() {
  return randomUUID();
}

export function requireStagingConfig() {
  const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";
  const identifier = process.env.CAFA_STAGING_LOGIN_IDENTIFIER?.trim() ?? "";
  const password = process.env.CAFA_STAGING_LOGIN_PASSWORD ?? "";

  let origin;
  try {
    origin = new URL(rawBaseUrl);
  } catch {
    throw new Error("CAFA_STAGING_BASE_URL must be the exact approved HTTPS staging origin.");
  }

  if (
    origin.protocol !== "https:" ||
    origin.pathname !== "/" ||
    origin.search ||
    origin.hash ||
    origin.username ||
    origin.password
  ) {
    throw new Error(
      "CAFA_STAGING_BASE_URL must be an HTTPS origin without path, query, credentials, or fragment.",
    );
  }
  if (!identifier || !password) {
    throw new Error(
      "CAFA_STAGING_LOGIN_IDENTIFIER and CAFA_STAGING_LOGIN_PASSWORD are required staging credentials.",
    );
  }

  return {
    baseUrl: origin.toString().replace(/\/$/, ""),
    identifier,
    password,
  };
}

export function safeError(message) {
  return new Error(message);
}

export function assert(condition, message) {
  if (!condition) throw safeError(message);
}

export function assertEqual(actual, expected, label) {
  assert(actual === expected, `${label} did not match the expected value.`);
}

export function assertNumericId(value, label) {
  assert(
    typeof value === "number" && Number.isInteger(value) && value > 0,
    `${label} was not a positive numeric ID.`,
  );
}

function sessionCookieFromHeaders(headers) {
  const values =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : [headers.get("set-cookie") ?? ""];
  const session = values
    .flatMap((value) => value.split(/,(?=[^;,]+=)/))
    .map((value) => value.trim().match(/^(cafa_sid=[^;]+)/)?.[1] ?? null)
    .find(Boolean);
  return session ?? null;
}

async function readJson(response, path) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw safeError(`${path} returned a non-JSON response.`);
  }
}

export async function request(baseUrl, path, options = {}) {
  try {
    return await fetch(`${baseUrl}${path}`, {
      redirect: "error",
      ...options,
    });
  } catch {
    throw safeError(`${path} could not be reached over the approved staging origin.`);
  }
}

export async function expectJson(baseUrl, path, expectedStatus, options = {}) {
  const response = await request(baseUrl, path, options);
  const data = await readJson(response, path);
  if (response.status !== expectedStatus) {
    throw safeError(`${path} returned HTTP ${response.status}; expected HTTP ${expectedStatus}.`);
  }
  return { response, data };
}

export async function login(config) {
  const { response, data } = await expectJson(config.baseUrl, "/api/auth/login", 200, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: config.identifier,
      password: config.password,
      remember: false,
    }),
  });
  const cookie = sessionCookieFromHeaders(response.headers);
  assert(cookie, "The staging login did not return an authenticated session cookie.");
  assert(data && typeof data === "object", "The staging login returned an invalid response.");
  return { cookie, user: data.user, permissions: data.permissions };
}

export function authenticatedOptions(cookie, options = {}) {
  return {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(cookie ? { cookie } : {}),
    },
  };
}

export async function logout(baseUrl, cookie) {
  const { data } = await expectJson(
    baseUrl,
    "/api/auth/logout",
    200,
    authenticatedOptions(cookie, { method: "POST" }),
  );
  assert(data?.ok === true, "The staging logout response was not acknowledged.");
}

export function requirePermission(permissions, permission, label = permission) {
  assert(
    Array.isArray(permissions) && (permissions.includes("*") || permissions.includes(permission)),
    `The staging actor is missing the required ${label} permission.`,
  );
}

export function requireAnyPermission(permissions, permissionsToAccept, label) {
  assert(
    Array.isArray(permissions) &&
      (permissions.includes("*") || permissionsToAccept.some((permission) => permissions.includes(permission))),
    `The staging actor is missing the required ${label} permission.`,
  );
}

export function collectFailure(current, next) {
  if (!current) return next;
  return new Error(`${current.message}; ${next.message}`);
}

export function printFailure(prefix, error) {
  if (error) console.error(`${prefix}: ${error.message}`);
}