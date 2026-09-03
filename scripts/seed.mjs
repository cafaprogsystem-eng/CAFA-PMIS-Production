/**
 * Standalone seed runner for Docker / CI environments.
 *
 * Seeds demo data (a demo user, a demo project, and a few related records)
 * for exercising a fresh staging database end to end. Safe to run multiple
 * times — every insert is idempotent (see lib/db/src/seed.ts).
 *
 * Runs the API's bundled, compiled seed entry point — the same pattern
 * scripts/migrate.mjs already uses for migrations — so this needs no
 * TypeScript toolchain (tsx/typescript) at runtime. Production images strip
 * devDependencies, and tsx is a devDependency, so invoking the raw .ts
 * source directly would fail there; build.mjs bundles lib/db/src/seed.ts
 * into dist/seed.mjs at build time instead, alongside dist/index.mjs and
 * dist/migrate.mjs.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node /app/scripts/seed.mjs
 *   docker compose exec api node /app/scripts/seed.mjs
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
if (process.env.NODE_ENV === "production") {
  console.error("ERROR: demo seed provisioning is forbidden in production.");
  process.exit(1);
}

const entryPoint = resolve(__dirname, "../artifacts/api-server/dist/seed.mjs");
if (!existsSync(entryPoint)) {
  console.error(`ERROR: compiled seed entry point not found at ${entryPoint}. Build the API artifact first.`);
  process.exit(1);
}

console.log("Seeding database…");
const result = spawnSync(process.execPath, ["--enable-source-maps", entryPoint], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error("Seed command could not start:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`Seed command failed with exit code ${result.status ?? 1}.`);
  process.exit(result.status ?? 1);
}
console.log("Seed complete.");
