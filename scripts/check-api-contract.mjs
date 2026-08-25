#!/usr/bin/env node

/**
 * Verify that the committed API contract matches the canonical generated
 * source and declaration outputs.
 *
 * The generation command intentionally remains the single source of truth:
 * this script only invokes it and checks the resulting Git worktree.
 */

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const generatedPaths = [
  "lib/api-client-react/src/generated",
  "lib/api-zod/src/generated",
  "lib/api-client-react/dist",
  "lib/api-zod/dist",
];

function runCodegen(pass) {
  console.log(`API contract generation (pass ${pass}/2)…`);
  execFileSync(
    "pnpm",
    ["--filter", "@workspace/api-spec", "run", "codegen"],
    { cwd: root, stdio: "inherit" },
  );
}

function git(args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function contractDrift() {
  const modified = git(["diff", "--name-status", "--", ...generatedPaths]);
  const untracked = git([
    "ls-files",
    "--others",
    "--exclude-standard",
    "--",
    ...generatedPaths,
  ]);

  return [
    ...modified
      .split("\n")
      .filter(Boolean)
      .map((line) => `  ${line.replace("\t", " ")}`),
    ...untracked
      .split("\n")
      .filter(Boolean)
      .map((line) => `  ?? ${line}`),
  ];
}

function failWithDrift(pass, drift) {
  console.error(
    [
      "",
      `API contract drift detected after generation (pass ${pass}/2).`,
      "The following committed contract outputs would change:",
      ...drift,
      "",
      "Regenerate with:",
      "  pnpm --filter @workspace/api-spec run codegen",
      "Then commit the generated source and declaration outputs.",
      "Generated files must not be hand-edited.",
    ].join("\n"),
  );
  process.exit(1);
}

try {
  runCodegen(1);
  const firstDrift = contractDrift();
  if (firstDrift.length > 0) {
    failWithDrift(1, firstDrift);
  }

  runCodegen(2);
  const secondDrift = contractDrift();
  if (secondDrift.length > 0) {
    failWithDrift(2, secondDrift);
  }

  console.log(
    "API contract check passed: generated source and declarations are clean and stable.",
  );
} catch (error) {
  if (error?.status !== undefined) {
    process.exit(error.status || 1);
  }
  throw error;
}