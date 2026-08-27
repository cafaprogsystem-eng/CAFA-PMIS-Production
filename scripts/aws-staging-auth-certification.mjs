#!/usr/bin/env node

const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";
const identifier = process.env.CAFA_STAGING_LOGIN_IDENTIFIER?.trim() ?? "";
const password = process.env.CAFA_STAGING_LOGIN_PASSWORD ?? "";

function fail(message) {
  console.error(`AWS staging authenticated certification blocked: ${message}`);
  process.exit(1);
}

function pass(message) {
  console.log(`PASS: ${message}`);
}

let origin;
try {
  origin = new URL(rawBaseUrl);
} catch {
  fail("CAFA_STAGING_BASE_URL must be the exact approved HTTPS staging origin.");
}

if (
  origin.protocol !== "https:" ||
  origin.pathname !== "/" ||
  origin.search ||
  origin.hash ||
  origin.username ||
  origin.password
) {
  fail("CAFA_STAGING_BASE_URL must be an HTTPS origin without path, query, credentials, or fragment.");
}

if (!identifier) fail("CAFA_STAGING_LOGIN_IDENTIFIER is required.");
if (!password) fail("CAFA_STAGING_LOGIN_PASSWORD is required.");

const baseUrl = origin.toString().replace(/\/$/, "");

async function jsonOrNull(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function request(path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    redirect: "error",
    headers: {
      Accept: "application/json",
      ...(options.headers ?? {}),
    },
    ...options,
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

const unauthenticatedMe = await request("/api/me");
if (unauthenticatedMe.status !== 401) {
  fail(`/api/me returned ${unauthenticatedMe.status} without a session; expected 401.`);
}
pass("Unauthenticated /api/me is rejected.");

const anonymousSwitcher = await request("/api/users/switcher");
if (anonymousSwitcher.status !== 401) {
  fail(`/api/users/switcher returned ${anonymousSwitcher.status} anonymously; expected 401.`);
}
pass("Anonymous access to demo identity switcher is rejected.");

const login = await request("/api/auth/login", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    identifier,
    password,
    remember: false,
  }),
});

const loginBody = await jsonOrNull(login);

if (login.status !== 200) {
  fail(`/api/auth/login returned ${login.status}; expected 200.`);
}

if (
  !loginBody?.user ||
  !Number.isInteger(Number(loginBody.user.id)) ||
  !Array.isArray(loginBody.permissions)
) {
  fail("/api/auth/login returned an invalid authenticated response contract.");
}

const setCookies =
  typeof login.headers.getSetCookie === "function"
    ? login.headers.getSetCookie()
    : [login.headers.get("set-cookie")].filter(Boolean);

const sessionSetCookie = setCookies.find((value) =>
  value.toLowerCase().startsWith("cafa_sid="),
);

if (!sessionSetCookie) {
  fail("/api/auth/login did not issue the cafa_sid session cookie.");
}

const cookieLower = sessionSetCookie.toLowerCase();

if (!cookieLower.includes("httponly")) {
  fail("cafa_sid is missing HttpOnly.");
}

if (!cookieLower.includes("secure")) {
  fail("cafa_sid is missing Secure in staging.");
}

if (!cookieLower.includes("samesite=lax")) {
  fail("cafa_sid is missing SameSite=Lax.");
}

if (!cookieLower.includes("path=/")) {
  fail("cafa_sid is missing Path=/.");
}

const maxAgeMatch = sessionSetCookie.match(/Max-Age=(\d+)/i);
if (!maxAgeMatch || Number(maxAgeMatch[1]) !== 28800) {
  fail("non-remembered cafa_sid does not have the expected 8-hour Max-Age.");
}

const sessionCookie = cookieHeaderFrom(login);
if (!sessionCookie) {
  fail("/api/auth/login did not expose a usable session cookie.");
}

const loggedInUserId = Number(loginBody.user.id);
pass("Login succeeded and returned user + permissions.");
pass("Session cookie has HttpOnly, Secure, SameSite=Lax, Path=/, and 8-hour Max-Age.");

const me = await request("/api/me", {
  headers: { Cookie: sessionCookie },
});
const meBody = await jsonOrNull(me);

if (me.status !== 200) {
  fail(`/api/me returned ${me.status} after login; expected 200.`);
}

if (
  !meBody?.user ||
  Number(meBody.user.id) !== loggedInUserId ||
  !Array.isArray(meBody.permissions)
) {
  fail("/api/me did not preserve the authenticated session identity.");
}

pass("Session persisted across authenticated requests.");

const [cookieName, cookieValue] = sessionCookie.split("=", 2);
const tamperedCookie = `${cookieName}=${cookieValue.slice(0, -1)}${cookieValue.endsWith("A") ? "B" : "A"}`;

const tamperedSession = await request("/api/me", {
  headers: { Cookie: tamperedCookie },
});

if (tamperedSession.status !== 401) {
  fail(`/api/me returned ${tamperedSession.status} for a tampered session cookie; expected 401.`);
}
pass("Tampered session cookie is rejected.");

const authenticatedSwitcher = await request("/api/users/switcher", {
  headers: { Cookie: sessionCookie },
});

if (authenticatedSwitcher.status !== 404) {
  fail(`/api/users/switcher returned ${authenticatedSwitcher.status} while authenticated; expected 404.`);
}
pass("Demo role harness remains hidden while authenticated.");

const logout = await request("/api/auth/logout", {
  method: "POST",
  headers: { Cookie: sessionCookie },
});
const logoutBody = await jsonOrNull(logout);

if (logout.status !== 200 || logoutBody?.ok !== true) {
  fail("/api/auth/logout did not complete successfully.");
}

const logoutSetCookies =
  typeof logout.headers.getSetCookie === "function"
    ? logout.headers.getSetCookie()
    : [logout.headers.get("set-cookie")].filter(Boolean);

const clearedSessionCookie = logoutSetCookies.find((value) =>
  value.toLowerCase().startsWith("cafa_sid="),
);

if (!clearedSessionCookie) {
  fail("Logout did not issue a cafa_sid clearing cookie.");
}

const clearingCookieChecks = {
  httpOnly: /httponly/i.test(clearedSessionCookie),
  secure: /secure/i.test(clearedSessionCookie),
  sameSiteLax: /samesite=lax/i.test(clearedSessionCookie),
  rootPath: /path=\//i.test(clearedSessionCookie),
  hasExpires: /expires=/i.test(clearedSessionCookie),
  hasMaxAgeZero: /max-age=0/i.test(clearedSessionCookie),
};

console.log("Logout clearing cookie attributes:", clearingCookieChecks);

if (
  !clearingCookieChecks.httpOnly ||
  !clearingCookieChecks.secure ||
  !clearingCookieChecks.sameSiteLax ||
  !clearingCookieChecks.rootPath ||
  (!clearingCookieChecks.hasExpires && !clearingCookieChecks.hasMaxAgeZero)
) {
  fail("Logout clearing cookie is missing required security or expiry attributes.");
}

pass("Logout succeeded and issued the hardened clearing cookie.");

const afterLogout = await request("/api/me", {
  headers: { Cookie: sessionCookie },
});

if (afterLogout.status !== 401) {
  fail(`/api/me returned ${afterLogout.status} after logout; expected revoked-session 401.`);
}
pass("Logout invalidated the server-side session.");

console.log("");
console.log(`AWS staging authenticated certification passed for ${baseUrl}.`);
console.log(
  "Verified login, session persistence, production demo-harness isolation, logout, and server-side session revocation.",
);
