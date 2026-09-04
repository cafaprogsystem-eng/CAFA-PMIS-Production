/**
 * Standalone runner for lib/db/src/create-first-admin.ts's compiled output —
 * creates the very first Super Admin account on a brand-new production
 * database. See infra/aws-production/README.md, "First administrator account".
 *
 * Runs the bundled dist/create-first-admin.mjs the same way scripts/seed.mjs
 * and scripts/migrate.mjs run their own compiled entry points, so this needs
 * no TypeScript toolchain (tsx/typescript) at runtime — production images
 * strip devDependencies.
 *
 * Usage:
 *   DATABASE_URL=postgres://... \
 *   ADMIN_NAME="..." ADMIN_EMAIL="..." [ADMIN_USERNAME="..."] ADMIN_PASSWORD="..." \
 *   node /app/scripts/create-first-admin.mjs
 */

import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("ERROR: DATABASE_URL environment variable is required.");
  process.exit(1);
}
for (const name of ["ADMIN_NAME", "ADMIN_EMAIL", "ADMIN_PASSWORD"]) {
  if (!process.env[name]) {
    console.error(`ERROR: ${name} environment variable is required.`);
    process.exit(1);
  }
}

const entryPoint = resolve(__dirname, "../artifacts/api-server/dist/create-first-admin.mjs");
if (!existsSync(entryPoint)) {
  console.error(`ERROR: compiled entry point not found at ${entryPoint}. Build the API artifact first.`);
  process.exit(1);
}

console.log("Creating the first Super Admin account…");
const result = spawnSync(process.execPath, ["--enable-source-maps", entryPoint], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error("Command could not start:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`Command failed with exit code ${result.status ?? 1}.`);
  process.exit(result.status ?? 1);
}
console.log("Done.");
