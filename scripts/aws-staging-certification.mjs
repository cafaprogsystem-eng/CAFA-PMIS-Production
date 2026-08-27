#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rawBaseUrl = process.env.CAFA_STAGING_BASE_URL?.trim() ?? "";
const identifier = process.env.CAFA_STAGING_LOGIN_IDENTIFIER?.trim() ?? "";
const password = process.env.CAFA_STAGING_LOGIN_PASSWORD ?? "";

function fail(message) {
  console.error(`AWS staging certification blocked: ${message}`);
  process.exit(1);
}

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    ...options,
  });
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
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
  fail(
    "CAFA_STAGING_BASE_URL must be an HTTPS origin without path, query, credentials, or fragment.",
  );
}

if (!identifier) {
  fail("CAFA_STAGING_LOGIN_IDENTIFIER is required.");
}

if (!password) {
  fail("CAFA_STAGING_LOGIN_PASSWORD is required.");
}

const ghVersion = run("gh", ["--version"]);
if (ghVersion.error || ghVersion.status !== 0) {
  fail("GitHub CLI (gh) is required for the remote public baseline.");
}

const ghAuth = run("gh", ["auth", "status"]);
if (ghAuth.error || ghAuth.status !== 0) {
  fail("GitHub CLI is not authenticated.");
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const requestId = randomUUID();

console.log("CAFA PMIS AWS Staging Certification");
console.log(`Target: ${origin.origin}`);
console.log("");

console.log("=== Public staging baseline (GitHub Actions) ===");

const dispatch = run(
  "gh",
  [
    "workflow",
    "run",
    "staging-baseline.yml",
    "--ref",
    "main",
    "-f",
    `base_url=${origin.origin}`,
    "-f",
    `request_id=${requestId}`,
  ],
  { stdio: "inherit" },
);

if (dispatch.error || dispatch.status !== 0) {
  fail("Could not dispatch the remote public staging baseline workflow.");
}

let workflowRun = null;
const discoveryDeadline = Date.now() + 90_000;

while (Date.now() < discoveryDeadline) {
  const listed = run("gh", [
    "run",
    "list",
    "--workflow",
    "staging-baseline.yml",
    "--limit",
    "30",
    "--json",
    "databaseId,displayTitle,status,conclusion,url",
  ]);

  if (listed.status === 0 && listed.stdout) {
    try {
      const runs = JSON.parse(listed.stdout);
      workflowRun = runs.find(
        (item) =>
          item.displayTitle === `AWS staging public baseline ${requestId}`,
      );

      if (workflowRun) break;
    } catch {
      // Retry until the workflow run becomes visible through GitHub Actions.
    }
  }

  sleep(3_000);
}

if (!workflowRun?.databaseId) {
  fail("Dispatched public baseline run did not become visible within 90 seconds.");
}

console.log(`Remote baseline run: ${workflowRun.url}`);

const watched = run(
  "gh",
  ["run", "watch", String(workflowRun.databaseId), "--exit-status"],
  {
    stdio: "inherit",
    timeout: 30 * 60 * 1000,
  },
);

if (watched.error) {
  fail(
    watched.error.code === "ETIMEDOUT"
      ? "Remote public baseline exceeded the 30-minute certification timeout."
      : `Remote public baseline watch failed: ${watched.error.message}`,
  );
}

if (watched.status !== 0) {
  fail("Remote public staging baseline failed.");
}

console.log("PASS: Public staging baseline");
console.log("");

const localCertifications = [
  {
    name: "Authentication and session security",
    script: "aws-staging-auth-certification.mjs",
  },
  {
    name: "Core module runtime",
    script: "aws-staging-core-runtime-certification.mjs",
  },
  {
    name: "Project business flow",
    script: "aws-staging-project-business-flow-certification.mjs",
  },
  {
    name: "Plan business flow",
    script: "aws-staging-plan-business-flow-certification.mjs",
  },
  {
    name: "S3 storage lifecycle",
    script: "aws-staging-storage-certification.mjs",
  },
];

for (const certification of localCertifications) {
  console.log(`=== ${certification.name} ===`);

  const result = spawnSync(
    process.execPath,
    [path.join(scriptDir, certification.script)],
    {
      env: process.env,
      stdio: "inherit",
    },
  );

  if (result.error) {
    fail(
      `${certification.name} could not start: ${result.error.message}`,
    );
  }

  if (result.status !== 0) {
    fail(
      `${certification.name} failed with exit code ${result.status ?? "unknown"}.`,
    );
  }

  console.log(`PASS: ${certification.name}`);
  console.log("");
}

console.log("========================================");
console.log("CAFA PMIS AWS STAGING CERTIFICATION PASSED");
console.log("========================================");
console.log(
  "Verified public runtime baseline, authenticated session security, core module runtime, Project and Plan business flows, and end-to-end S3 storage lifecycle.",
);
