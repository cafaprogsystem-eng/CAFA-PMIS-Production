/**
 * Standalone seed runner for Docker / CI environments.
 *
 * Seeds all roles, canonical Sudan State master data, and demo users into the database.
 * Safe to run multiple times — upserts where possible.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node /app/scripts/seed.mjs
 *   docker compose exec api node /app/scripts/seed.mjs
 */

import { execSync } from "child_process";
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

const seedScript = resolve(__dirname, "../lib/db/src/seed.ts");
if (!existsSync(seedScript)) {
  console.error(`ERROR: Seed script not found at ${seedScript}`);
  process.exit(1);
}

const tsxCandidates = [
  resolve(__dirname, "../node_modules/.bin/tsx"),
  resolve(__dirname, "../lib/db/node_modules/.bin/tsx"),
];
const tsx = tsxCandidates.find(existsSync);
if (!tsx) {
  console.error("ERROR: tsx not found. Run `pnpm install` in the workspace first.");
  process.exit(1);
}

console.log("Seeding database…");
try {
  execSync(`node "${tsx}" "${seedScript}"`, {
    stdio: "inherit",
    env: { ...process.env },
  });
  console.log("Seed complete.");
} catch (err) {
  console.error("Seed failed:", err.message);
  process.exit(1);
}
