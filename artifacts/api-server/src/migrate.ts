/**
 * Production migration entry point.
 * Runs the project's tracked history, verifies its exact head, then exits.
 */
import { runMigrations } from "./lib/run-migrations.js";
import { logger } from "./lib/logger.js";
import { pool } from "@workspace/db";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the tracked migration command.");
}

try {
  await runMigrations();
  logger.info("Tracked migration command completed successfully");
} catch (err) {
  logger.error({ err }, "Tracked migration command failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
