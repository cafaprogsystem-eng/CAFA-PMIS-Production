-- Migration 001: Plan Registration Sessions table.
-- Reference copy — runtime execution uses the inlined TypeScript in src/lib/run-migrations.ts.
-- Keep this file in sync with the 001_plan_registration_sessions entry in MIGRATIONS.

CREATE TABLE IF NOT EXISTS plan_registration_sessions (
  id          SERIAL PRIMARY KEY,
  plan_id     INTEGER NOT NULL,
  user_id     INTEGER NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL,
  closed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plan_reg_sessions_plan_user
  ON plan_registration_sessions (plan_id, user_id);
