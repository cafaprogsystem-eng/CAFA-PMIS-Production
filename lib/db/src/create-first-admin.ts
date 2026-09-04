/**
 * One-off creator for the very first Super Admin account on a brand-new,
 * completely empty production database. Every normal user-creation path
 * (the invite flow, scripts/seed.mjs) either requires an existing admin or
 * is refused outright in production, so a freshly-provisioned production
 * database has no way to create its first account through the application
 * itself — see infra/aws-production/README.md, "First administrator account".
 *
 * Meant to run exactly once, via infra/aws-production/run-create-first-admin.sh,
 * which executes this as a one-off ECS Fargate task (RDS is private, so this
 * cannot run from a developer machine). Idempotent by email: re-running with
 * the same ADMIN_EMAIL leaves the existing account untouched instead of
 * erroring or creating a duplicate.
 */
import bcrypt from "bcryptjs";
import { pool } from "./index";

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`${name} environment variable is required.`);
  }
  return value;
}

async function main(): Promise<void> {
  const name = requiredEnv("ADMIN_NAME");
  const email = requiredEnv("ADMIN_EMAIL");
  const password = requiredEnv("ADMIN_PASSWORD");
  const username = process.env.ADMIN_USERNAME?.trim() || null;

  // Same policy the app itself enforces on every other password (see
  // routes/auth.ts / routes/users.ts) — a hash of a weak password would
  // still satisfy bcrypt, so this must be checked before hashing.
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error(
      "ADMIN_PASSWORD must be at least 10 characters and include at least one letter and one digit.",
    );
  }

  const existing = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))`,
    [email],
  );
  if (existing.rows.length) {
    console.log(`An account with email ${email} already exists (id ${existing.rows[0].id}) — left untouched.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const inserted = await pool.query<{ id: number }>(
    `INSERT INTO users (
       name, email, username, password_hash, role, role_label, scope,
       status, email_verified, language_preference
     )
     VALUES ($1, $2, $3, $4, 'super_admin', 'Super Admin', 'hq', 'active', true, 'en')
     ON CONFLICT ((lower(btrim(email)))) DO NOTHING
     RETURNING id`,
    [name, email, username, passwordHash],
  );

  if (inserted.rows.length) {
    console.log(`Super Admin account created: id ${inserted.rows[0].id}, email ${email}.`);
    console.log("The password you supplied was not logged anywhere by this script or by the app.");
    return;
  }

  // Lost a race against a concurrent run of this same script.
  const raced = await pool.query<{ id: number }>(
    `SELECT id FROM users WHERE lower(btrim(email)) = lower(btrim($1))`,
    [email],
  );
  console.log(
    `An account with email ${email} already exists (id ${raced.rows[0]?.id}) — left untouched (lost a race against a concurrent run).`,
  );
}

main()
  .catch((err) => {
    console.error("Creating the first admin account failed:", err);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
