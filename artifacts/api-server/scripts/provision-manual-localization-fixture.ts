/**
 * Creates the dedicated, non-production Manual-maintenance identity used for
 * controlled localization reconciliation/import checks. This is intentionally
 * opt-in and never runs as part of application startup.
 */
import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const FIXTURE_USERNAME = "e2e.pm.manual.localization";
const FIXTURE_EMAIL = "e2e.pm.manual.localization@example.invalid";

function requireFixturePassword(): string {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refusing to provision the Manual localization fixture in production.");
  }
  if (process.env.E2E_ENABLE_NON_PRODUCTION_FIXTURES !== "true") {
    throw new Error("Set E2E_ENABLE_NON_PRODUCTION_FIXTURES=true to provision this non-production fixture.");
  }
  if (!process.env.E2E_PASSWORD) {
    throw new Error("E2E_PASSWORD must be configured as a secret.");
  }
  return process.env.E2E_PASSWORD;
}

async function main() {
  const passwordHash = await bcrypt.hash(requireFixturePassword(), 12);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: number }>(
      "SELECT id FROM users WHERE username = $1 LIMIT 1 FOR UPDATE",
      [FIXTURE_USERNAME],
    );
    if (existing.rows[0]) {
      await client.query(
        `UPDATE users SET
           name = 'E2E Manual Localization Maintainer',
           email = $1,
           password_hash = $2,
           role = 'program_manager',
           role_label = 'Programme Manager',
           scope = 'global',
           state_id = NULL,
           sector = NULL,
           status = 'active',
           email_verified = true,
           invite_token = NULL,
           invite_expires_at = NULL,
           updated_at = NOW()
         WHERE id = $3`,
        [FIXTURE_EMAIL, passwordHash, existing.rows[0].id],
      );
    } else {
      await client.query(
        `INSERT INTO users
           (name, email, username, password_hash, role, role_label, scope, status, email_verified)
         VALUES
           ('E2E Manual Localization Maintainer', $1, $2, $3,
            'program_manager', 'Programme Manager', 'global', 'active', true)`,
        [FIXTURE_EMAIL, FIXTURE_USERNAME, passwordHash],
      );
    }
    await client.query("COMMIT");
    console.log("Manual localization fixture provisioned.");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});