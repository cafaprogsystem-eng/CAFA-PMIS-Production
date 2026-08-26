import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const BOOTSTRAP_LOCK_KEY = "cafa-pmis:staging-initial-admin-bootstrap";

function fail(message: string): never {
  throw new Error(`Staging admin bootstrap blocked: ${message}`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) fail(`${name} is required.`);
  return value;
}

function validateEnvironment(): void {
  if (process.env.NODE_ENV !== "production") {
    fail("NODE_ENV must be production.");
  }

  if (process.env.CAFA_BOOTSTRAP_ENV !== "staging") {
    fail("CAFA_BOOTSTRAP_ENV must explicitly equal staging.");
  }

  const databaseUrl = required("DATABASE_URL");

  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    fail("DATABASE_URL is invalid.");
  }

  if (parsed.pathname !== "/cafa_pmis_staging") {
    fail("target database is not the CAFA PMIS staging database.");
  }
}

function validateInputs() {
  const name = required("BOOTSTRAP_ADMIN_NAME");
  const email = required("BOOTSTRAP_ADMIN_EMAIL").toLowerCase();
  const passwordHash = required("BOOTSTRAP_ADMIN_PASSWORD_HASH");

  if (name.length > 200) {
    fail("BOOTSTRAP_ADMIN_NAME is too long.");
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail("BOOTSTRAP_ADMIN_EMAIL is invalid.");
  }

  if (!/^\$2[aby]\$12\$/.test(passwordHash)) {
    fail("BOOTSTRAP_ADMIN_PASSWORD_HASH must be a bcrypt cost-12 hash.");
  }

  return { name, email, passwordHash };
}

async function main() {
  validateEnvironment();
  const { name, email, passwordHash } = validateInputs();

  if (bcrypt.getRounds(passwordHash) !== 12) {
    fail("invalid bcrypt bootstrap hash.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // Verify the database we actually connected to, not only the URL supplied
    // by the environment. This keeps the bootstrap fail-closed if connection
    // routing or configuration ever diverges from the URL text.
    const target = await client.query<{ database: string }>(
      "SELECT current_database() AS database",
    );

    if (target.rows[0]?.database !== "cafa_pmis_staging") {
      fail("connected database is not the CAFA PMIS staging database.");
    }

    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1))",
      [BOOTSTRAP_LOCK_KEY],
    );

    const existing = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM users`,
    );

    if ((existing.rows[0]?.count ?? 0) !== 0) {
      fail("users table is not empty; refusing bootstrap.");
    }

    const inserted = await client.query<{ id: number }>(
      `INSERT INTO users (
         name,
         email,
         username,
         phone,
         password_hash,
         role,
         role_label,
         scope,
         state_id,
         sector,
         status,
         language_preference,
         invited_by_id
       )
       VALUES (
         $1,
         $2,
         NULL,
         NULL,
         $3,
         'super_admin',
         'Super Admin',
         'hq',
         NULL,
         NULL,
         'active',
         'en',
         NULL
       )
       RETURNING id`,
      [name, email, passwordHash],
    );

    await client.query("COMMIT");

    console.log(
      `Staging initial administrator created successfully (user id ${inserted.rows[0]?.id}, email ${email}).`,
    );
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Preserve the original bootstrap failure.
    }
    throw error;
  } finally {
    client.release();
  }
}

let bootstrapFailed = false;

main()
  .catch((error) => {
    bootstrapFailed = true;
    console.error(
      error instanceof Error ? error.message : "Staging admin bootstrap failed.",
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    try {
      await pool.end();
    } catch (error) {
      if (!bootstrapFailed) {
        console.error(
          error instanceof Error
            ? `Failed to close database pool: ${error.message}`
            : "Failed to close database pool.",
        );
        process.exitCode = 1;
      }
    }
  });
