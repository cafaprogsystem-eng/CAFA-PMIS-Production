-- Migration 060: explicit project reporting coverage and durable reminder delivery ledger.
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reporting_start_date DATE,
  ADD COLUMN IF NOT EXISTS reporting_end_date DATE;
UPDATE projects
   SET reporting_start_date = start_date,
       reporting_end_date = end_date
 WHERE reporting_start_date IS NULL OR reporting_end_date IS NULL;
ALTER TABLE projects
  ALTER COLUMN reporting_start_date SET NOT NULL,
  ALTER COLUMN reporting_end_date SET NOT NULL;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_reporting_coverage_valid;
ALTER TABLE projects ADD CONSTRAINT projects_reporting_coverage_valid
  CHECK (reporting_start_date <= reporting_end_date);

CREATE TABLE IF NOT EXISTS monthly_report_reminder_deliveries (
  id SERIAL PRIMARY KEY,
  obligation_key TEXT NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('project','program_state','hq_sector')),
  reporting_year INTEGER NOT NULL CHECK (reporting_year BETWEEN 2000 AND 2200),
  reporting_month INTEGER NOT NULL CHECK (reporting_month BETWEEN 1 AND 12),
  scope_key TEXT NOT NULL,
  recipient_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'email')),
  stage_day INTEGER NOT NULL CHECK (stage_day > 0 AND stage_day <= 31),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','leased','sent','failed','non_retryable','dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  delivered_at TIMESTAMPTZ,
  result_metadata JSONB,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (report_type, reporting_year, reporting_month, scope_key, recipient_user_id, stage_day, channel)
);
CREATE INDEX IF NOT EXISTS monthly_report_reminder_deliveries_due_idx
  ON monthly_report_reminder_deliveries (status, next_attempt_at);