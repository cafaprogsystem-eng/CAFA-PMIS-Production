#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
let failures = 0;

function pass(label) {
  console.log(`PASS  ${label}`);
}

function fail(label, detail) {
  failures += 1;
  console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
}

function check(label, predicate, detail) {
  try {
    if (predicate()) pass(label);
    else fail(label, detail);
  } catch (error) {
    fail(label, error instanceof Error ? error.message : String(error));
  }
}

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const requiredFiles = [
  "README.md",
  "HANDOVER.md",
  "docs/github-handoff-closure.md",
  "docs/github-handoff-manifest.md",
  ".env.example",
  ".env.production.example",
  "Dockerfile",
  ".github/workflows/api-contract.yml",
  "infra/aws-staging/template.yaml",
  "infra/aws-staging/deploy-staging.sh",
  "artifacts/api-server/src/lib/run-migrations.ts",
  "artifacts/api-server/src/lib/session.ts",
  "artifacts/api-server/src/lib/state-master.ts",
  "artifacts/cafa-pmis/src/assets/landing-screenshots.provenance.json",
];

console.log("CAFA PMIS local release-readiness preflight");
console.log("This command makes no AWS calls and does not run browser certification.");

for (const file of requiredFiles) {
  check(`required tracked file: ${file}`, () => {
    if (!existsSync(path.join(root, file))) return false;
    git("ls-files", "--error-unmatch", file);
    return true;
  }, "missing or untracked");
}

check("working tree is clean", () => git("status", "--porcelain", "--untracked-files=all").trim() === "", "commit or remove local changes before handoff");
check("no whitespace errors", () => {
  git("diff", "--check");
  return true;
});

check("no tracked task-planning attachments", () =>
  git("ls-files", "attached_assets/Pasted-*.txt", "attached_assets/.Pasted-*.txt.*").trim() === "",
  "remove Pasted planning inputs from the handoff set",
);

check("no tracked historical release archive", () =>
  git("ls-files", "CAFA-PMIS-PRODUCTION-CLEAN.zip").trim() === "",
  "remove the historical release archive from the handoff set",
);

check("tracked source has no private-key header", () => {
  const privateKeyMarker = ["-----BEGIN", "PRIVATE KEY-----"].join(" ");
  const files = git("ls-files", "-z").split("\0").filter(Boolean);
  return files.every((file) => {
    const absolute = path.join(root, file);
    if (!existsSync(absolute)) return true;
    return !readFileSync(absolute, "utf8").includes(privateKeyMarker);
  });
}, "remove the file and rotate any historical credential before handoff");

check("root package manager is pinned", () => {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  return pkg.packageManager === "pnpm@10.26.1";
}, "expected pnpm@10.26.1");

check("canonical revocable-session migration is present", () => {
  const source = readFileSync(path.join(root, "artifacts/api-server/src/lib/run-migrations.ts"), "utf8");
  return source.includes("055_revocable_authenticated_sessions");
});

check("legacy numeric session cookies are rejected", () => {
  const source = readFileSync(path.join(root, "artifacts/api-server/src/lib/session.ts"), "utf8");
  return source.includes("isLegacyUserIdCookie") && source.includes("return null");
});

check("canonical state registry has eighteen records", () => {
  const source = readFileSync(path.join(root, "artifacts/api-server/src/lib/state-master.ts"), "utf8");
  const block = source.match(/export const SUDAN_STATES = \[([\s\S]*?)\] as const;/)?.[1] ?? "";
  return (block.match(/^\s*\["/gm) ?? []).length === 18;
});

check("eight sidebar baselines are tracked", () => {
  const files = git("ls-files", "artifacts/cafa-pmis/e2e/snapshots/sidebar").trim().split("\n").filter(Boolean);
  return files.length === 8;
});

check("four approved landing captures have provenance", () => {
  const provenance = JSON.parse(readFileSync(path.join(root, "artifacts/cafa-pmis/src/assets/landing-screenshots.provenance.json"), "utf8"));
  return provenance.status === "approved-baseline" && Array.isArray(provenance.assets) && provenance.assets.length === 4;
});

console.log("\nDEFERRED AWS/STAGING-ONLY CHECKS");
for (const item of [
  "Container build/startup on a Docker-capable runner",
  "CloudFormation deployment and AWS account/resource inspection",
  "TLS/ALB/DNS, secure-cookie, same-origin Socket.IO, and routed production-build PWA",
  "Task-role S3 upload/promotion/download/cleanup and mail sandbox behaviour",
  "Isolated RDS restore and representative S3-version recovery",
  "Authenticated browser, Arabic/RTL, offline/reconnect, sidebar, and landing capture certification",
]) {
  console.log(`DEFER ${item}`);
}

if (failures > 0) {
  console.error(`\nRelease-readiness preflight failed (${failures} finding${failures === 1 ? "" : "s"}).`);
  process.exitCode = 1;
} else {
  console.log("\nLocal release-readiness preflight passed. Run the documented quality gates before handoff.");
}