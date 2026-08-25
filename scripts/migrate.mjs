/**
 * Standalone migration runner for Docker / CI environments.
 *
 * Runs the API's bundled, tracked migration history against the target
 * database. It never runs a declarative schema push and never seeds data.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node /app/scripts/migrate.mjs
 *   docker compose exec api node /app/scripts/migrate.mjs
 *
 * The script exits with code 0 on success, non-zero on failure.
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

const entryPoint = resolve(__dirname, "../artifacts/api-server/dist/migrate.mjs");
if (!existsSync(entryPoint)) {
  console.error(`ERROR: tracked migration entry point not found at ${entryPoint}. Build the API artifact first.`);
  process.exit(1);
}

console.log("Running tracked database migrations…");
const result = spawnSync(process.execPath, ["--enable-source-maps", entryPoint], {
  stdio: "inherit",
  env: process.env,
});
if (result.error) {
  console.error("Migration command could not start:", result.error.message);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`Tracked migration command failed with exit code ${result.status ?? 1}.`);
  process.exit(result.status ?? 1);
}
console.log("Tracked migrations complete.");
