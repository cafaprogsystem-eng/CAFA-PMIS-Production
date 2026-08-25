#!/usr/bin/env node

import { createRequire } from "node:module";
import { chromium } from "@playwright/test";

// socket.io-client is a browser artifact dependency rather than a root
// dependency. Resolve it from that workspace without changing production code.
const frontendRequire = createRequire(
  new URL("../artifacts/cafa-pmis/package.json", import.meta.url),
);
const { io } = frontendRequire("socket.io-client");

const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";

function fail(message) {
  console.error(`AWS staging baseline blocked: ${message}`);
  process.exit(1);
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

const baseUrl = origin.toString().replace(/\/$/, "");

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    redirect: "error",
    ...options,
  });
  return response;
}

async function expectStatus(path, expected, options) {
  const response = await request(path, options);
  if (response.status !== expected) {
    fail(`${path} returned ${response.status}, expected ${expected}.`);
  }
  return response;
}

async function verifySocketUpgrade() {
  await new Promise((resolve, reject) => {
    const socket = io(baseUrl, {
      path: "/api/socket.io",
      transports: ["websocket"],
      timeout: 15_000,
      reconnection: false,
      withCredentials: true,
    });
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("Socket.IO WebSocket upgrade timed out."));
    }, 16_000);

    socket.on("connect", () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    });
    socket.on("connect_error", (error) => {
      clearTimeout(timer);
      socket.close();
      // A production endpoint correctly rejects this unauthenticated client
      // after the HTTP/WebSocket transport reaches Socket.IO. That proves the
      // ALB path and WebSocket upgrade work without using a staging credential.
      if (/unauthorized/i.test(error.message)) {
        resolve();
        return;
      }
      reject(error);
    });
  });
}

const health = await expectStatus("/api/healthz", 200);
if (!/no-store/i.test(health.headers.get("cache-control") ?? "")) {
  fail("/api/healthz did not return the expected no-store response.");
}
await expectStatus("/api/readyz", 200);
const app = await expectStatus("/", 200);
if (!/(text\/html|application\/xhtml\+xml)/i.test(app.headers.get("content-type") ?? "")) {
  fail("the staging origin did not return the production PWA document.");
}

const polling = await expectStatus("/api/socket.io/?EIO=4&transport=polling", 200, {
  headers: { Origin: baseUrl },
});
if (!(await polling.text()).startsWith("0")) {
  fail("Socket.IO polling did not return an Engine.IO handshake.");
}

const foreignOrigin = await request("/api/socket.io/?EIO=4&transport=polling", {
  headers: { Origin: "https://foreign-origin.invalid" },
});
if (foreignOrigin.status < 400) {
  fail("Socket.IO accepted a foreign credentialed origin.");
}

await verifySocketUpgrade();

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(baseUrl, { waitUntil: "networkidle", timeout: 30_000 });
  const registration = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) return { supported: false, active: false };
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    return {
      supported: true,
      active: Boolean(ready),
      scope: ready && "scope" in ready ? ready.scope : null,
    };
  });
  if (!registration.supported || !registration.active) {
    fail("the production PWA service worker did not register at the staging origin.");
  }
} finally {
  await browser.close();
}

console.log(`AWS staging baseline passed for ${baseUrl}.`);
console.log("Verified HTTPS health/readiness, same-origin PWA, service-worker registration, Socket.IO polling/upgrade, and foreign-origin rejection.");