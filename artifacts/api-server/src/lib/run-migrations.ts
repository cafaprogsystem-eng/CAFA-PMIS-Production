/**
 * Tracked database migration runner.
 *
 * Maintains a `schema_migrations` table that records each applied migration by
 * name. On startup, any migration whose name is not yet in that table is
 * executed in definition order.
 *
 * SQL is inlined as TypeScript string constants — no file-path resolution
 * required, works identically in development (built dist/) and production.
 *
 * Failures throw — the server must not start against an unmigrated schema.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pool } from "@workspace/db";
import { logger } from "./logger";

const initialSchemaSql = readFileSync(
  new URL("./initial-schema.sql", import.meta.url),
  "utf8",
);

// ── Migration definitions — add new entries at the bottom ────────────────────

export interface Migration {
  name: string;
  sql: string;
}

/** Exported for test suites that verify migration SQL content. Do not mutate. */
export const MIGRATIONS: Migration[] = [
  {
    name: "000_initial_schema_baseline",
    // Immutable production bootstrap generated from the declarative schema at
    // release-authority adoption. Later migrations remain ordered history.
    sql: initialSchemaSql,
  },
  {
    name: "001_plan_registration_sessions",
    sql: /* sql */ `
-- Plan Registration Sessions table.
-- Short-lived server-authoritative tokens that authorise incremental PATCH
-- calls on a newly-created Draft Plan by the session creator.
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
`,
  },
  {
    name: "002_sector_unification",
    sql: /* sql */ `
-- Sector Architecture Unification
-- Idempotent — safe to run multiple times.
-- Adds sub_sectors, assistance_modality, migration_review_notes columns and
-- remaps all legacy sector values to the 7 canonical Main Sectors.

-- ── Schema additions ─────────────────────────────────────────────────────────
-- Idempotent — ADD COLUMN IF NOT EXISTS is safe on any base schema.
-- Includes columns that may pre-date the tracked migration runner so that
-- a fresh deployment from any starting schema is always self-sufficient.

ALTER TABLE projects
  -- Pre-task multi-sector array (may already exist on upgraded databases)
  ADD COLUMN IF NOT EXISTS sectors                JSONB NOT NULL DEFAULT '[]',
  -- New in this migration
  ADD COLUMN IF NOT EXISTS sub_sectors            JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS assistance_modality    TEXT,
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

ALTER TABLE indicators
  ADD COLUMN IF NOT EXISTS sub_sectors JSONB NOT NULL DEFAULT '[]';

-- ── Projects — deterministic legacy remapping ────────────────────────────────

UPDATE projects
   SET sector                 = 'Protection',
       sub_sectors            = '["Child Protection"]',
       migration_review_notes = 'Migrated from legacy sector: Child Protection'
 WHERE sector = 'Child Protection';

UPDATE projects
   SET sector                 = 'Protection',
       sub_sectors            = '["Gender-Based Violence (GBV)"]',
       migration_review_notes = 'Migrated from legacy sector: GBV'
 WHERE sector = 'GBV';

UPDATE projects
   SET sector                 = 'Food Security & Livelihoods',
       sub_sectors            = '["Livelihoods"]',
       migration_review_notes = 'Migrated from legacy sector: Livelihoods'
 WHERE sector = 'Livelihoods';

UPDATE projects
   SET sector                 = 'Food Security & Livelihoods',
       sub_sectors            = '["Agriculture","Livelihoods"]',
       migration_review_notes = 'Migrated from legacy sector: Agriculture & Livelihoods'
 WHERE sector = 'Agriculture & Livelihoods';

UPDATE projects SET sector = 'Shelter & NFI' WHERE sector = 'Shelter / NFI';

UPDATE projects
   SET sector                 = 'Protection',
       assistance_modality    = 'Multipurpose Cash Assistance (MPCA)',
       migration_review_notes = 'Requires manual sector assignment — MPCA was removed as a Main Sector. Provisionally assigned to Protection pending review.'
 WHERE sector IN ('MPCA', 'MPCA / Cash Assistance');

-- ── Indicators — same mappings as projects ────────────────────────────────────

UPDATE indicators SET sector = 'Protection', sub_sectors = '["Child Protection"]'        WHERE sector = 'Child Protection';
UPDATE indicators SET sector = 'Protection', sub_sectors = '["Gender-Based Violence (GBV)"]' WHERE sector = 'GBV';
UPDATE indicators SET sector = 'Food Security & Livelihoods', sub_sectors = '["Livelihoods"]' WHERE sector = 'Livelihoods';
UPDATE indicators SET sector = 'Food Security & Livelihoods', sub_sectors = '["Agriculture","Livelihoods"]' WHERE sector = 'Agriculture & Livelihoods';
UPDATE indicators SET sector = 'Shelter & NFI' WHERE sector = 'Shelter / NFI';
UPDATE indicators SET sector = 'Protection'    WHERE sector IN ('MPCA', 'MPCA / Cash Assistance');

-- ── Reports — migrate all legacy sector values ────────────────────────────────

UPDATE reports SET sector = 'Protection'                  WHERE sector = 'Child Protection';
UPDATE reports SET sector = 'Protection'                  WHERE sector = 'GBV';
UPDATE reports SET sector = 'Food Security & Livelihoods' WHERE sector IN ('Livelihoods', 'Agriculture & Livelihoods');
UPDATE reports SET sector = 'Shelter & NFI'               WHERE sector = 'Shelter / NFI';

UPDATE reports r
   SET sector = COALESCE(
         (SELECT p.sector FROM projects p WHERE p.id = r.project_id AND p.sector IS NOT NULL LIMIT 1),
         'Protection'
       )
 WHERE r.sector IN ('MPCA', 'MPCA / Cash Assistance');

-- ── Conversations — migrate all legacy sector values ──────────────────────────

UPDATE conversations SET sector = 'Protection'                  WHERE sector = 'Child Protection';
UPDATE conversations SET sector = 'Protection'                  WHERE sector = 'GBV';
UPDATE conversations SET sector = 'Food Security & Livelihoods' WHERE sector IN ('Livelihoods', 'Agriculture & Livelihoods');
UPDATE conversations SET sector = 'Shelter & NFI'               WHERE sector = 'Shelter / NFI';

UPDATE conversations c
   SET sector = COALESCE(
         (SELECT p.sector FROM projects p WHERE p.id = c.project_id AND p.sector IS NOT NULL LIMIT 1),
         NULL
       )
 WHERE c.sector IN ('MPCA', 'MPCA / Cash Assistance');

-- ── Plans — schema and legacy remapping ──────────────────────────────────────

-- Add review-notes column for Multi-Sector plans that cannot be auto-resolved.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

UPDATE plans SET sector = 'Shelter & NFI' WHERE sector = 'Shelter / NFI';

-- ── Program Resources ─────────────────────────────────────────────────────────

-- Add migration_review_notes to program_resources FIRST so flags can be set
-- before we remap the sector column (preserving the origin for staff review).
ALTER TABLE program_resources
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

UPDATE program_resources SET sector = 'Food Security & Livelihoods' WHERE sector IN ('FSL', 'Agriculture & Livelihoods');
UPDATE program_resources SET sector = 'Shelter & NFI'               WHERE sector IN ('Shelter', 'Shelter / NFI');
-- MPCA/Multi-Sector records: flag for manual review, then remap to General / Cross-Cutting
-- (NOT NULL constraint requires a valid sector value; General / Cross-Cutting is the safe default)
UPDATE program_resources
   SET migration_review_notes = CONCAT(
         'Originally classified as "', sector,
         '" — requires manual reassignment to a canonical Main Sector or General / Cross-Cutting'
       )
 WHERE sector IN ('MPCA', 'MPCA / Cash Assistance', 'Multi-Sector');
UPDATE program_resources SET sector = 'General / Cross-Cutting' WHERE sector IN ('MPCA', 'MPCA / Cash Assistance', 'Multi-Sector');
-- Legacy 'General' shorthand → canonical full name
UPDATE program_resources SET sector = 'General / Cross-Cutting' WHERE sector = 'General';

-- ── Users — TC sector CSV normalisation ──────────────────────────────────────

UPDATE users
   SET sector = REGEXP_REPLACE(sector, 'Shelter / NFI', 'Shelter & NFI', 'g')
 WHERE sector LIKE '%Shelter / NFI%';

UPDATE users
   SET sector = REGEXP_REPLACE(sector, 'Agriculture & Livelihoods', 'Food Security & Livelihoods', 'g')
 WHERE sector LIKE '%Agriculture & Livelihoods%';

-- ── projects.sectors JSONB array — remap legacy values ───────────────────────
-- The scalar sector field is migrated above; the multi-sector sectors JSONB
-- array may independently contain retired values. Remap each element in-place
-- using jsonb_array_elements_text, deduplicate, and filter to canonical values.

UPDATE projects
   SET sectors = (
         SELECT COALESCE(jsonb_agg(DISTINCT mapped ORDER BY mapped), '[]'::jsonb)
           FROM (
                  SELECT CASE el
                    WHEN 'Child Protection'      THEN 'Protection'
                    WHEN 'GBV'                   THEN 'Protection'
                    WHEN 'Livelihoods'            THEN 'Food Security & Livelihoods'
                    WHEN 'Agriculture & Livelihoods' THEN 'Food Security & Livelihoods'
                    WHEN 'Shelter / NFI'          THEN 'Shelter & NFI'
                    WHEN 'MPCA'                  THEN 'Protection'
                    WHEN 'MPCA / Cash Assistance' THEN 'Protection'
                    ELSE el
                  END AS mapped
                    FROM jsonb_array_elements_text(sectors) AS el
               ) mapped_vals
          WHERE mapped IN (
                  'Health','Nutrition','WASH','Education','Protection',
                  'Food Security & Livelihoods','Shelter & NFI'
                )
       )
 WHERE sectors IS NOT NULL
   AND jsonb_array_length(sectors) > 0
   AND (
         sectors ? 'Child Protection'       OR
         sectors ? 'GBV'                    OR
         sectors ? 'Livelihoods'             OR
         sectors ? 'Agriculture & Livelihoods' OR
         sectors ? 'Shelter / NFI'           OR
         sectors ? 'MPCA'                   OR
         sectors ? 'MPCA / Cash Assistance'
       );

-- ── Multi-Sector plans — resolve where determinable ──────────────────────────
-- Step 1: Migrate unambiguous Multi-Sector plans (linked project has exactly 1 canonical sector).
UPDATE plans pl
   SET sector = (
         SELECT proj.sector
           FROM projects proj
          WHERE proj.id = pl.project_id
            AND proj.sector IN (
                  'Health','Nutrition','WASH','Education','Protection',
                  'Food Security & Livelihoods','Shelter & NFI'
                )
          LIMIT 1
       )
 WHERE pl.sector = 'Multi-Sector'
   AND (
         SELECT COUNT(DISTINCT proj.sector)
           FROM projects proj
          WHERE proj.id = pl.project_id
            AND proj.sector IN (
                  'Health','Nutrition','WASH','Education','Protection',
                  'Food Security & Livelihoods','Shelter & NFI'
                )
       ) = 1;

-- Step 2: Flag any remaining Multi-Sector plans (ambiguous or unlinked) with a
-- review note so staff can identify and manually assign a canonical sector.
-- sector is left as 'Multi-Sector' here — migration 003 also normalises
-- any remaining unresolved values to NULL to remove retired values.
UPDATE plans
   SET migration_review_notes = 'Multi-Sector plan — requires manual review and sector reassignment to a canonical Main Sector'
 WHERE sector = 'Multi-Sector'
   AND migration_review_notes IS NULL;
`,
  },
  {
    name: "003_nullable_plan_fields",
    sql: /* sql */ `
-- Migration 003: Relax NOT NULL on draft Plan fields; nullify remaining Multi-Sector values.
--
-- Plans are created as drafts and plan_type/start_date/end_date may legitimately
-- be absent at creation time. The NOT NULL constraints prevented valid draft saves.
--
-- Any plans still carrying sector='Multi-Sector' after migration 002 are ambiguous
-- and flagged; set sector to NULL here so no retired value is returned by the API.

ALTER TABLE plans
  ALTER COLUMN plan_type   DROP NOT NULL,
  ALTER COLUMN start_date  DROP NOT NULL,
  ALTER COLUMN end_date    DROP NOT NULL;

-- Nullify remaining Multi-Sector sector values (already flagged in migration_review_notes).
UPDATE plans
   SET sector = NULL
 WHERE sector = 'Multi-Sector';
`,
  },
  {
    name: "004_mpca_sector_correction",
    sql: /* sql */ `
-- Migration 004: MPCA Sector Correction & Hardening
-- Removes a provisional Protection assignment that was incorrectly applied to
-- the legacy MPCA project in migration 002. MPCA is an Assistance Modality,
-- not a Main Sector — no canonical Main Sector can be inferred without human review.
-- Idempotent — safe to run multiple times.

-- ── Allow NULL in sector columns ─────────────────────────────────────────────
-- sector = NULL correctly represents "unresolved — pending manual review".
-- A NOT NULL constraint was previously preventing honest representation.

ALTER TABLE projects   ALTER COLUMN sector DROP NOT NULL;
ALTER TABLE indicators ALTER COLUMN sector DROP NOT NULL;

-- ── Remove the provisional Protection guess from the MPCA project ─────────────
-- Set sector = NULL so the record is correctly flagged as unresolved rather
-- than falsely attributed to Protection.

UPDATE projects
   SET sector                 = NULL,
       migration_review_notes = 'Requires manual sector assignment — MPCA was removed as a Main Sector. Sector is unresolved pending manual review.'
 WHERE assistance_modality = 'Multipurpose Cash Assistance (MPCA)'
   AND sector = 'Protection'
   AND migration_review_notes IS NOT NULL;

-- ── Remove false Protection from indicators of the MPCA project ──────────────
-- Indicators inherit the unresolved state of their parent project.

UPDATE indicators
   SET sector      = NULL,
       sub_sectors = '[]'::jsonb
 WHERE project_id IN (
         SELECT id FROM projects
          WHERE assistance_modality = 'Multipurpose Cash Assistance (MPCA)'
            AND sector IS NULL
            AND migration_review_notes IS NOT NULL
       )
   AND sector = 'Protection';

-- ── Clear review notes from deterministically resolved projects ───────────────
-- Child Protection→Protection, GBV→Protection, Livelihoods→FSL are fully
-- resolved. Clearing keeps migration_review_notes meaningful: NULL = resolved,
-- non-NULL = still requires human action.

UPDATE projects
   SET migration_review_notes = NULL
 WHERE migration_review_notes LIKE 'Migrated from legacy sector:%';
`,
  },
  {
    name: "005_reports_activity_type",
    sql: /* sql */ `
-- Migration 005: Reports Architecture — Activity Type, Canonical Types, Legacy Migration
--
-- 1. Add activity_id column (Activity Report relationship)
-- 2. Add migration_review_notes for unresolved legacy rows
-- 3. Remove the invalid DEFAULT 'monthly' from report_type; allow NULL for unresolved rows
-- 4. Deterministically migrate legacy report_type values (monthly/quarterly/annual)
-- 5. Preserve frequency values in kind where kind is missing/invalid
-- 6. Add unique partial indexes for duplicate prevention
--
-- Depends on migration 004 (sector columns made nullable) being applied first.

-- Step 1: Schema additions
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS activity_id          INTEGER,
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

-- Step 2: Allow NULL on report_type (removes the NOT NULL + DEFAULT 'monthly')
ALTER TABLE reports
  ALTER COLUMN report_type DROP DEFAULT;

ALTER TABLE reports
  ALTER COLUMN report_type DROP NOT NULL;

-- Step 3: Deterministic legacy reclassification
-- Reports with report_type IN ('monthly','quarterly','annual') had their
-- frequency value incorrectly stored as the report type.

-- 3a: project_id + state_id → project report
UPDATE reports
   SET migration_review_notes = 'Migrated from legacy report_type: ' || report_type,
       report_type             = 'project'
 WHERE report_type IN ('monthly','quarterly','annual')
   AND project_id IS NOT NULL
   AND state_id   IS NOT NULL;

-- 3b: project_id only (no state_id) → project report
UPDATE reports
   SET migration_review_notes = 'Migrated from legacy report_type: ' || report_type,
       report_type             = 'project'
 WHERE report_type IN ('monthly','quarterly','annual')
   AND project_id IS NOT NULL
   AND state_id   IS NULL;

-- 3c: state_id only (no project_id, no sector) → state programme report
UPDATE reports
   SET migration_review_notes = 'Migrated from legacy report_type: ' || report_type,
       report_type             = 'program_state'
 WHERE report_type IN ('monthly','quarterly','annual')
   AND project_id IS NULL
   AND state_id   IS NOT NULL;

-- 3d: sector only (no project_id, no state_id) → hq_sector report
UPDATE reports
   SET migration_review_notes = 'Migrated from legacy report_type: ' || report_type,
       report_type             = 'hq_sector'
 WHERE report_type IN ('monthly','quarterly','annual')
   AND project_id IS NULL
   AND state_id   IS NULL
   AND sector     IS NOT NULL;

-- 3e: Remaining unresolvable → preserve as NULL, flag for review
UPDATE reports
   SET migration_review_notes = 'Unresolved legacy report_type: ' || report_type || ' — requires manual type review',
       report_type             = NULL
 WHERE report_type IN ('monthly','quarterly','annual');

-- Step 4: Frequency preservation
-- For migrated rows where kind is blank or non-canonical, promote the legacy
-- report_type value (now in migration_review_notes) into kind.
UPDATE reports
   SET kind = CASE
         WHEN migration_review_notes LIKE '%legacy report_type: monthly%'   THEN 'monthly'
         WHEN migration_review_notes LIKE '%legacy report_type: quarterly%' THEN 'quarterly'
         WHEN migration_review_notes LIKE '%legacy report_type: annual%'    THEN 'annual'
         ELSE kind
       END
 WHERE migration_review_notes IS NOT NULL
   AND (
         kind IS NULL
         OR kind = ''
         OR kind NOT IN ('monthly','quarterly','annual','on_demand')
       );

-- Step 5: Deduplicate existing rows before creating unique indexes.
-- Keeps the highest-ID record (most recently created) for each duplicate
-- group and archives the older ones so the unique constraint can be applied
-- without losing data.

-- Project monthly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate project/monthly report for same period'
 WHERE report_type = 'project'
   AND kind = 'monthly'
   AND reporting_year  IS NOT NULL
   AND reporting_month IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'project'
        AND kind = 'monthly'
        AND reporting_year  IS NOT NULL
        AND reporting_month IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY project_id, state_id, kind, reporting_year, reporting_month
   );

-- Project quarterly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate project/quarterly report for same period'
 WHERE report_type = 'project'
   AND kind = 'quarterly'
   AND reporting_year IS NOT NULL
   AND quarter        IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'project'
        AND kind = 'quarterly'
        AND reporting_year IS NOT NULL
        AND quarter        IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY project_id, state_id, kind, reporting_year, quarter
   );

-- Project annual duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate project/annual report for same period'
 WHERE report_type = 'project'
   AND kind = 'annual'
   AND reporting_year IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'project'
        AND kind = 'annual'
        AND reporting_year IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY project_id, state_id, kind, reporting_year
   );

-- Activity monthly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate activity/monthly report for same period'
 WHERE report_type = 'activity'
   AND kind = 'monthly'
   AND activity_id     IS NOT NULL
   AND reporting_year  IS NOT NULL
   AND reporting_month IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'activity'
        AND kind = 'monthly'
        AND activity_id     IS NOT NULL
        AND reporting_year  IS NOT NULL
        AND reporting_month IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY activity_id, kind, reporting_year, reporting_month
   );

-- Activity quarterly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate activity/quarterly report for same period'
 WHERE report_type = 'activity'
   AND kind = 'quarterly'
   AND activity_id    IS NOT NULL
   AND reporting_year IS NOT NULL
   AND quarter        IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'activity'
        AND kind = 'quarterly'
        AND activity_id    IS NOT NULL
        AND reporting_year IS NOT NULL
        AND quarter        IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY activity_id, kind, reporting_year, quarter
   );

-- Activity annual duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate activity/annual report for same period'
 WHERE report_type = 'activity'
   AND kind = 'annual'
   AND activity_id    IS NOT NULL
   AND reporting_year IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'activity'
        AND kind = 'annual'
        AND activity_id    IS NOT NULL
        AND reporting_year IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY activity_id, kind, reporting_year
   );

-- State programme monthly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate program_state/monthly report for same period'
 WHERE report_type = 'program_state'
   AND kind = 'monthly'
   AND state_id        IS NOT NULL
   AND reporting_year  IS NOT NULL
   AND reporting_month IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'program_state'
        AND kind = 'monthly'
        AND state_id        IS NOT NULL
        AND reporting_year  IS NOT NULL
        AND reporting_month IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY state_id, kind, reporting_year, reporting_month
   );

-- State programme quarterly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate program_state/quarterly report for same period'
 WHERE report_type = 'program_state'
   AND kind = 'quarterly'
   AND state_id       IS NOT NULL
   AND reporting_year IS NOT NULL
   AND quarter        IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'program_state'
        AND kind = 'quarterly'
        AND state_id       IS NOT NULL
        AND reporting_year IS NOT NULL
        AND quarter        IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY state_id, kind, reporting_year, quarter
   );

-- State programme annual duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate program_state/annual report for same period'
 WHERE report_type = 'program_state'
   AND kind = 'annual'
   AND state_id       IS NOT NULL
   AND reporting_year IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'program_state'
        AND kind = 'annual'
        AND state_id       IS NOT NULL
        AND reporting_year IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY state_id, kind, reporting_year
   );

-- HQ Sector monthly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate hq_sector/monthly report for same period'
 WHERE report_type = 'hq_sector'
   AND kind = 'monthly'
   AND sector          IS NOT NULL
   AND reporting_year  IS NOT NULL
   AND reporting_month IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'hq_sector'
        AND kind = 'monthly'
        AND sector          IS NOT NULL
        AND reporting_year  IS NOT NULL
        AND reporting_month IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY sector, kind, reporting_year, reporting_month
   );

-- HQ Sector quarterly duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate hq_sector/quarterly report for same period'
 WHERE report_type = 'hq_sector'
   AND kind = 'quarterly'
   AND sector         IS NOT NULL
   AND reporting_year IS NOT NULL
   AND quarter        IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'hq_sector'
        AND kind = 'quarterly'
        AND sector         IS NOT NULL
        AND reporting_year IS NOT NULL
        AND quarter        IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY sector, kind, reporting_year, quarter
   );

-- HQ Sector annual duplicates
UPDATE reports r
   SET status = 'archived',
       migration_review_notes = COALESCE(migration_review_notes || '; ', '') ||
         'Archived by migration 005 — duplicate hq_sector/annual report for same period'
 WHERE report_type = 'hq_sector'
   AND kind = 'annual'
   AND sector         IS NOT NULL
   AND reporting_year IS NOT NULL
   AND status NOT IN ('rejected','archived')
   AND id NOT IN (
     SELECT MAX(id)
       FROM reports
      WHERE report_type = 'hq_sector'
        AND kind = 'annual'
        AND sector         IS NOT NULL
        AND reporting_year IS NOT NULL
        AND status NOT IN ('rejected','archived')
      GROUP BY sector, kind, reporting_year
   );

-- Step 6: Unique partial indexes for duplicate prevention
-- Each canonical report type has its own partial unique index.
-- Rejected and archived rows are excluded so re-creation is allowed after
-- terminal outcomes.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_monthly
  ON reports (report_type, project_id, state_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'project'
    AND kind = 'monthly'
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_quarterly
  ON reports (report_type, project_id, state_id, kind, reporting_year, quarter)
  WHERE report_type = 'project'
    AND kind = 'quarterly'
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_annual
  ON reports (report_type, project_id, state_id, kind, reporting_year)
  WHERE report_type = 'project'
    AND kind = 'annual'
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_monthly
  ON reports (report_type, activity_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'activity'
    AND kind = 'monthly'
    AND activity_id     IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_quarterly
  ON reports (report_type, activity_id, kind, reporting_year, quarter)
  WHERE report_type = 'activity'
    AND kind = 'quarterly'
    AND activity_id    IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_annual
  ON reports (report_type, activity_id, kind, reporting_year)
  WHERE report_type = 'activity'
    AND kind = 'annual'
    AND activity_id    IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_monthly
  ON reports (report_type, state_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'program_state'
    AND kind = 'monthly'
    AND state_id        IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_quarterly
  ON reports (report_type, state_id, kind, reporting_year, quarter)
  WHERE report_type = 'program_state'
    AND kind = 'quarterly'
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_annual
  ON reports (report_type, state_id, kind, reporting_year)
  WHERE report_type = 'program_state'
    AND kind = 'annual'
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_monthly
  ON reports (report_type, sector, kind, reporting_year, reporting_month)
  WHERE report_type = 'hq_sector'
    AND kind = 'monthly'
    AND sector          IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_quarterly
  ON reports (report_type, sector, kind, reporting_year, quarter)
  WHERE report_type = 'hq_sector'
    AND kind = 'quarterly'
    AND sector         IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived');

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_annual
  ON reports (report_type, sector, kind, reporting_year)
  WHERE report_type = 'hq_sector'
    AND kind = 'annual'
    AND sector         IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived');
`,
  },
  {
    name: "006_reports_dedup_correction",
    sql: /* sql */ `
-- Migration 006: Correct Migration 005 duplicate archival strategy
--
-- Migration 005 changed status → 'archived' on historical duplicate rows to
-- allow unique indexes to be created. This modified the operational status of
-- historical records, including rows that had previously been approved.
-- The spec requires preserving all historical Report rows with their original
-- status unchanged.
--
-- Correction strategy:
--   1. Add migration_is_duplicate BOOLEAN column.
--   2. Mark the rows that migration 005 incorrectly archived.
--   3. Restore their status from approval history (or 'draft' if no history).
--   4. Drop old unique indexes (which excluded 'archived' status).
--   5. Recreate unique indexes that ALSO exclude migration_is_duplicate = TRUE,
--      preserving historical duplicates without any status modification.

-- Step 1: Add the marker column (idempotent)
ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS migration_is_duplicate BOOLEAN NOT NULL DEFAULT FALSE;

-- Step 2: Mark historical duplicates created by migration 005
UPDATE reports
   SET migration_is_duplicate = TRUE
 WHERE migration_review_notes LIKE '%Archived by migration 005 — duplicate%';

-- Step 3: Drop old unique indexes BEFORE restoring status.
-- CRITICAL ORDER: the old indexes still exclude 'archived' status. If we restored
-- status to 'approved' while those indexes exist, rows 17+19 (same key, both
-- 'approved', migration_is_duplicate not yet in the index predicate) would cause
-- a duplicate key violation. Dropping first avoids this.
DROP INDEX IF EXISTS idx_reports_unique_project_monthly;
DROP INDEX IF EXISTS idx_reports_unique_project_quarterly;
DROP INDEX IF EXISTS idx_reports_unique_project_annual;
DROP INDEX IF EXISTS idx_reports_unique_activity_monthly;
DROP INDEX IF EXISTS idx_reports_unique_activity_quarterly;
DROP INDEX IF EXISTS idx_reports_unique_activity_annual;
DROP INDEX IF EXISTS idx_reports_unique_program_state_monthly;
DROP INDEX IF EXISTS idx_reports_unique_program_state_quarterly;
DROP INDEX IF EXISTS idx_reports_unique_program_state_annual;
DROP INDEX IF EXISTS idx_reports_unique_hq_sector_monthly;
DROP INDEX IF EXISTS idx_reports_unique_hq_sector_quarterly;
DROP INDEX IF EXISTS idx_reports_unique_hq_sector_annual;

-- Step 4: Restore status from approval history (now safe — old indexes are gone).
-- Uses the most recent non-archived transition to_status.
-- Falls back to 'draft' if no approval history exists (safe reviewable state).
UPDATE reports r
   SET status = COALESCE(
         (SELECT a.to_status
            FROM approvals a
           WHERE a.entity_type = 'report'
             AND a.entity_id = r.id
             AND a.to_status NOT IN ('archived')
           ORDER BY a.timestamp DESC
           LIMIT 1),
         'draft'
       )
 WHERE r.migration_is_duplicate = TRUE;

-- Step 5: Recreate unique indexes with BOTH status exclusion AND
-- migration_is_duplicate = FALSE, so historical duplicates are preserved
-- with their original statuses and excluded from the constraint.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_monthly
  ON reports (report_type, project_id, state_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'project'
    AND kind = 'monthly'
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_quarterly
  ON reports (report_type, project_id, state_id, kind, reporting_year, quarter)
  WHERE report_type = 'project'
    AND kind = 'quarterly'
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_annual
  ON reports (report_type, project_id, state_id, kind, reporting_year)
  WHERE report_type = 'project'
    AND kind = 'annual'
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_monthly
  ON reports (report_type, activity_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'activity'
    AND kind = 'monthly'
    AND activity_id     IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_quarterly
  ON reports (report_type, activity_id, kind, reporting_year, quarter)
  WHERE report_type = 'activity'
    AND kind = 'quarterly'
    AND activity_id    IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_annual
  ON reports (report_type, activity_id, kind, reporting_year)
  WHERE report_type = 'activity'
    AND kind = 'annual'
    AND activity_id    IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_monthly
  ON reports (report_type, state_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'program_state'
    AND kind = 'monthly'
    AND state_id        IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_quarterly
  ON reports (report_type, state_id, kind, reporting_year, quarter)
  WHERE report_type = 'program_state'
    AND kind = 'quarterly'
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_program_state_annual
  ON reports (report_type, state_id, kind, reporting_year)
  WHERE report_type = 'program_state'
    AND kind = 'annual'
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_monthly
  ON reports (report_type, sector, kind, reporting_year, reporting_month)
  WHERE report_type = 'hq_sector'
    AND kind = 'monthly'
    AND sector          IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_quarterly
  ON reports (report_type, sector, kind, reporting_year, quarter)
  WHERE report_type = 'hq_sector'
    AND kind = 'quarterly'
    AND sector         IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_hq_sector_annual
  ON reports (report_type, sector, kind, reporting_year)
  WHERE report_type = 'hq_sector'
    AND kind = 'annual'
    AND sector         IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;
`,
  },
  {
    name: "007_reports_unverified_status_flag",
    sql: /* sql */ `
-- Migration 007: Flag historically-unverifiable status for Report 9
--
-- Migration 006 restored historical duplicate rows to their pre-Migration-005
-- status using approval history as authoritative evidence.
--
-- For Report 9 (project/monthly, project_id=1, state_id=1, 2026-06):
--   - No approval history exists in the approvals table.
--   - Migration 006 defaulted status to 'draft' via COALESCE fallback.
--   - This is incorrect: absence of approval history is NOT proof of draft status.
--   - The original status before Migration 005 is genuinely unverifiable.
--
-- Evidence used for each restored row:
--   Report 17: Full approval chain in approvals table (submit→coordination→final_approve→approved). VERIFIED.
--   Report 18: Full approval chain including request_revision cycle.                                VERIFIED.
--   Report 9:  Only audit log entry is 'create'. No submission or review records.                  UNVERIFIED.
--
-- Fix:
--   1. Add migration_status_unverified flag to distinguish verified from unverified restorations.
--   2. Mark Report 9 as unverified — administrators must review and correct if needed.
--   3. Keep status='draft' as a safe placeholder (not in any approval pipeline).
--   4. Mark Reports 17 and 18 explicitly as verified (migration_status_unverified = FALSE).

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS migration_status_unverified BOOLEAN NOT NULL DEFAULT FALSE;

-- Flag Report 9: no authoritative evidence for original status before Migration 005
UPDATE reports
   SET migration_status_unverified = TRUE,
       migration_review_notes = COALESCE(migration_review_notes, '') ||
         E'\\n\\nNote [Migration 007]: Original status before Migration 005 is UNVERIFIED. '
         'No approval history exists for this record. Migration 006 set status=''draft'' '
         'as a safe placeholder because ''draft'' is the least disruptive reviewable state. '
         'An administrator must verify the original status and correct it if needed.'
 WHERE id = 9
   AND migration_is_duplicate = TRUE;

-- Explicitly mark the verified restorations (already correct, DEFAULT is FALSE)
UPDATE reports
   SET migration_status_unverified = FALSE
 WHERE id IN (17, 18)
   AND migration_is_duplicate = TRUE;
`,
  },
  {
    name: "008_reports_author_workflow_path",
    sql: /* sql */ `
-- Migration 008: Author-based workflow path for Project and Activity Reports
--
-- The previous workflow used a five-step chain that included a State Office
-- Manager state_review step (submitted → state_reviewed). This step is being
-- removed because:
--   1. State Office Manager is VIEW ONLY per the authoritative RBAC spec.
--   2. SOM must not have any approval, review, or rejection authority.
--   3. The correct approval chain depends on who authored the report, not SOM.
--
-- Two authoring paths replace the old single chain:
--
--   state_authored (PATH A):
--     SPO created the report. TC review is MANDATORY.
--     submitted → technically_approved → coordination_approved → approved
--
--   technical_authored (PATH B):
--     TC created the report. TC review is NOT APPLICABLE (self-review forbidden).
--     submitted → coordination_approved → approved
--
-- This field is immutable after creation. A later role change for the author
-- must never alter the report's approval path.
--
-- Steps:
--   1. Add author_id column (the user who created the report).
--   2. Add workflow_path column (frozen at creation time).
--   3. Backfill author_id from submitted_by_id (best proxy available).
--   4. Backfill workflow_path: TC creators → technical_authored;
--      SPO and all others → state_authored (conservative default).
--   5. Roll back any records currently in state_reviewed → submitted so they
--      re-enter the correct author-based workflow.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS author_id    INTEGER REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS workflow_path VARCHAR(20)
    CHECK (workflow_path IN ('state_authored', 'technical_authored'));

-- Backfill author_id from submitted_by_id.
-- Only set author_id when submitted_by_id references a row that still exists in users
-- (some historical reports may have submitted_by_id pointing to a since-deleted user).
UPDATE reports r
   SET author_id = r.submitted_by_id
  FROM users u
 WHERE r.author_id IS NULL
   AND r.submitted_by_id IS NOT NULL
   AND u.id = r.submitted_by_id;

-- Backfill workflow_path for project/activity reports from author role
UPDATE reports r
   SET workflow_path = CASE
         WHEN u.role = 'technical_coordinator' THEN 'technical_authored'
         ELSE 'state_authored'
       END
  FROM users u
 WHERE r.author_id = u.id
   AND r.report_type IN ('project', 'activity')
   AND r.workflow_path IS NULL;

-- NOTE: Unresolvable workflow paths (author deleted / no evidence) are left as NULL.
-- A NULL workflow_path is the correct factual marker when the author's role cannot
-- be established from authoritative evidence. The runtime falls back conservatively
-- to state_authored behaviour (mandatory TC review) but does NOT persist a guess.
-- See migration 009 for the historical-integrity correction of records that migration
-- 008 initially wrongly defaulted to 'state_authored' or wrongly rolled back to
-- 'submitted' from 'state_reviewed'.
`,
  },
  {
    name: "009_reports_historical_integrity",
    sql: /* sql */ `
-- Migration 009: Historical integrity correction for Project and Activity Reports
--
-- Migration 008 made two incorrect changes to historical data:
--
--   Problem A: It ran "UPDATE reports SET status='submitted' WHERE status='state_reviewed'".
--   This silently destroyed factual historical status for reports that legitimately
--   reached state_reviewed under the old 5-step workflow. Those reports must keep
--   their authentic historical status.
--
--   Problem B: It ran a catch-all "SET workflow_path='state_authored' WHERE workflow_path IS NULL"
--   for project/activity records with no resolvable author. This converted factual
--   uncertainty into a fabricated historical claim. Those records must have
--   workflow_path = NULL — the correct marker for "author role could not be established".
--
-- Corrections:
--   1. Restore status='state_reviewed' for reports that were legitimately in that
--      status when migration 008 ran.  Evidence: the approvals table records a
--      'state_review' action (to_status='state_reviewed') and no subsequent 'submit'
--      action was recorded after it (which would indicate a real re-submission).
--
--   2. Reset workflow_path to NULL for project/activity records whose author_id is
--      NULL (meaning the original author's user row no longer exists and we have no
--      authoritative evidence of their role).
--
--   The runtime conservative fallback (NULL → treat as state_authored for safety)
--   is not affected — it operates at query time and never writes a guess to the DB.

-- ── Correction A: restore legitimately state_reviewed records ─────────────────
UPDATE reports
   SET status     = 'state_reviewed',
       updated_at = NOW()
 WHERE status = 'submitted'
   AND id IN (
     SELECT a.entity_id
       FROM approvals a
      WHERE a.entity_type = 'report'
        AND a.to_status   = 'state_reviewed'
        AND NOT EXISTS (
          SELECT 1
            FROM approvals a2
           WHERE a2.entity_type = 'report'
             AND a2.entity_id   = a.entity_id
             AND a2.action      = 'submit'
             AND a2.id          > a.id
        )
   );

-- ── Correction B: remove fabricated workflow_path for unresolvable authors ───
UPDATE reports
   SET workflow_path = NULL
 WHERE report_type IN ('project', 'activity')
   AND workflow_path = 'state_authored'
   AND author_id IS NULL;
`,
  },
  {
    name: "010_activity_report_unique_indexes_state_id",
    sql: /* sql */ `
-- Migration 010: Add state_id to Activity Report unique indexes
--
-- The original indexes (created in migrations 005 and 006) used
-- (report_type, activity_id, kind, reporting_year, reporting_month/quarter)
-- without state_id. The spec requires uniqueness per Activity + State + Period:
-- the same activity may legitimately generate a report for each distinct state
-- it is linked to (e.g. project-wide activities with state_id = NULL, or future
-- multi-state activities). Without state_id in the key the constraint is
-- over-strict and prevents valid reports from being created.
--
-- Strategy:
--   1. Drop the existing activity partial unique indexes.
--   2. Recreate them with state_id included in the column list and
--      "AND state_id IS NOT NULL" added to the partial condition so that
--      historical records with null state_id remain unconstrained (the
--      CREATE route now requires state_id for all new activity reports).

-- ── Drop old indexes ────────────────────────────────────────────────────────

DROP INDEX IF EXISTS idx_reports_unique_activity_monthly;
DROP INDEX IF EXISTS idx_reports_unique_activity_quarterly;
DROP INDEX IF EXISTS idx_reports_unique_activity_annual;

-- ── Recreate with state_id ──────────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_monthly
  ON reports (report_type, activity_id, state_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'activity'
    AND kind = 'monthly'
    AND activity_id     IS NOT NULL
    AND state_id        IS NOT NULL
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_quarterly
  ON reports (report_type, activity_id, state_id, kind, reporting_year, quarter)
  WHERE report_type = 'activity'
    AND kind = 'quarterly'
    AND activity_id    IS NOT NULL
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_activity_annual
  ON reports (report_type, activity_id, state_id, kind, reporting_year)
  WHERE report_type = 'activity'
    AND kind = 'annual'
    AND activity_id    IS NOT NULL
    AND state_id       IS NOT NULL
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;
`,
  },
  {
    name: "012_reports_activity_name",
    sql: /* sql */ `
-- Migration 012: Activity Report standalone subject field
--
-- Activity Reports now support three link modes:
--   (1) Standalone      — no linked activity or project record
--   (2) Existing Activity — linked to a specific activities row
--   (3) Project         — linked to a project but no specific activity row
--
-- In all three modes the report carries a human-readable "Report Subject /
-- Activity Name" that is independent of the linked record.  This is the
-- primary human-readable identity for the report.
--
-- Nullable so existing historical reports remain valid without a subject.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS activity_name TEXT;
`,
  },
  {
    name: "011_activities_sector_currency",
    sql: /* sql */ `
-- Migration 011: Standalone Activity support
--
-- Activities that have no parent Project (project_id IS NULL) are "standalone".
-- This migration makes three idempotent changes:
--
-- (1) Drops the NOT NULL constraint on project_id so standalone activities
--     (no parent project) can be persisted. Existing project-linked rows
--     keep their project_id values unchanged.
--
-- (2) Drops the NOT NULL constraint on output_id so standalone activities
--     (which have no output hierarchy) can be persisted. Existing project-
--     linked rows keep their output_id values unchanged.
--
-- (3) Adds sector TEXT and currency TEXT columns so standalone activities
--     can carry their own authoritative sector and currency. These values are
--     ignored for project-linked activities (derived from the parent project).
--
-- All changes are safe on existing data: no existing row is invalidated.

ALTER TABLE activities
  ALTER COLUMN project_id DROP NOT NULL,
  ALTER COLUMN output_id  DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS sector   TEXT,
  ADD COLUMN IF NOT EXISTS currency TEXT;
`,
  },
  {
    name: "013_hq_location_type",
    sql: /* sql */ `
-- HQ as a first-class location system-wide (additive only).
-- Adds location_type TEXT to every table that supports HQ alongside Sudan States.
-- Relaxes NOT NULL on state_id in plans and risks so HQ records (no assigned State) can exist.
-- Adds office_location TEXT to users — separate from the permission-scope stateId column.
--
-- Backward compatibility: historical records with no location_type value are inferred
-- as "state" when state_id IS NOT NULL, or left as null, in the API response layer.
-- No mass data migration is required.

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS location_type TEXT;

ALTER TABLE activities
  ADD COLUMN IF NOT EXISTS location_type TEXT;

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS location_type TEXT;

ALTER TABLE risks
  ADD COLUMN IF NOT EXISTS location_type TEXT;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS office_location TEXT;

-- Allow NULL state_id so HQ plans and HQ risks can exist without a State.
-- If the column is already nullable this is a safe no-op.
ALTER TABLE plans
  ALTER COLUMN state_id DROP NOT NULL;

ALTER TABLE risks
  ALTER COLUMN state_id DROP NOT NULL;
`,
  },
  {
    name: "015_pmr_hq_unique_indexes",
    sql: /* sql */ `
-- PMR HQ Reporting Location — durable uniqueness enforcement.
--
-- Background: The existing idx_reports_unique_project_{monthly,quarterly,annual} indexes
-- key on (report_type, project_id, state_id, kind, ...).  PostgreSQL unique indexes treat
-- NULLs as distinct, so when state_id IS NULL (the HQ path) those indexes never fire and
-- multiple active HQ reports for the same project+kind+period could be inserted.
--
-- Fix: three partial unique indexes scoped to the HQ location path, using only non-NULL
-- columns (project_id, kind, reporting_year, ...) and an index predicate that pins them to
-- HQ rows (state_id IS NULL AND location_type = 'hq').
--
-- These indexes co-exist with the state-location indexes; they cover a disjoint predicate.

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_hq_monthly
  ON reports (report_type, project_id, kind, reporting_year, reporting_month)
  WHERE report_type = 'project'
    AND kind = 'monthly'
    AND state_id        IS NULL
    AND location_type   = 'hq'
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_hq_quarterly
  ON reports (report_type, project_id, kind, reporting_year, quarter)
  WHERE report_type = 'project'
    AND kind = 'quarterly'
    AND state_id       IS NULL
    AND location_type  = 'hq'
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_unique_project_hq_annual
  ON reports (report_type, project_id, kind, reporting_year)
  WHERE report_type = 'project'
    AND kind = 'annual'
    AND state_id       IS NULL
    AND location_type  = 'hq'
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected','archived')
    AND migration_is_duplicate = FALSE;
`,
  },
  {
    name: "016_has_hq_operations",
    sql: /* sql */ `
-- Migration 016: Add has_hq_operations to projects
-- Explicit boolean flag for HQ Operational Location eligibility.
-- Independent of management_level — a project can be hq_managed but have no
-- HQ operations, or state_managed but legitimately report at HQ level.
-- DEFAULT false: new projects must opt in explicitly.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS has_hq_operations BOOLEAN NOT NULL DEFAULT false;
`,
  },
  {
    name: "017_correct_hq_backfill",
    sql: /* sql */ `
-- Migration 017: Corrective migration for the invalid hq_managed backfill.
-- Migration 016 contained an UPDATE that incorrectly set has_hq_operations=true
-- for all management_level='hq_managed' projects. That UPDATE has been removed
-- from Migration 016.
--
-- Strategy: provenance cannot be determined without an updated_at column on
-- the projects table, so existing has_hq_operations=true values are preserved
-- unchanged. Instead, this migration creates a persistent audit table recording
-- every project with management_level='hq_managed' AND has_hq_operations=true
-- at migration time. Administrators can query hq_backfill_audit to identify
-- projects whose HQ eligibility may require manual review, then use the project
-- edit form to set has_hq_operations=false on any project that should not have
-- HQ Operational Location access. See also:
-- docs/audit-reports/projects-hq-operational-review.md

CREATE TABLE IF NOT EXISTS hq_backfill_audit (
  id                SERIAL PRIMARY KEY,
  project_id        INTEGER NOT NULL,
  project_code      TEXT,
  project_title     TEXT,
  management_level  TEXT,
  has_hq_operations BOOLEAN,
  linked_states     TEXT,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert projects that may have been incorrectly backfilled.
-- The INSERT is idempotent: it skips projects already recorded.
-- No projects row is modified — this is a read-only snapshot for admin review.
-- linked_states aggregates the names of all states in project_states for the project.
INSERT INTO hq_backfill_audit
  (project_id, project_code, project_title, management_level, has_hq_operations, linked_states)
SELECT
  p.id,
  p.code,
  p.title,
  p.management_level,
  p.has_hq_operations,
  (
    SELECT COALESCE(string_agg(s.name, ', ' ORDER BY s.name), '(none)')
    FROM project_states ps
    JOIN states s ON s.id = ps.state_id
    WHERE ps.project_id = p.id
  ) AS linked_states
FROM projects p
WHERE p.management_level = 'hq_managed'
  AND p.has_hq_operations = true
  AND NOT EXISTS (
    SELECT 1 FROM hq_backfill_audit a WHERE a.project_id = p.id
  );
`,
  },
  {
    name: "018_project_reporting_frequency",
    sql: /* sql */ `
-- Migration 018: Add reporting_frequency to projects (Task #325 / Model D).
-- The project's normal scheduled PMR reporting cycle: monthly | quarterly | annual.
-- Deliberately NO DEFAULT and NO backfill: existing rows stay NULL until an
-- administrator configures them via the project edit form. NULL means
-- "scheduled frequency not configured" (historical projects) — it must never
-- be silently treated as 'monthly' by the database.
-- 'on_demand' is intentionally NOT a valid scheduled frequency (supplementary only).
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS reporting_frequency TEXT;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_reporting_frequency_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_reporting_frequency_check
  CHECK (
    reporting_frequency IS NULL
    OR reporting_frequency IN ('monthly', 'quarterly', 'annual')
  );
`,
  },
  {
    name: "014_att02_evidence_object_path_unique",
    sql: /* sql */ `
-- ATT-02 Upload hardening — unique object_path constraints on evidence tables.
--
-- Why this migration must be self-sufficient:
--   report_attachments was previously created by an unawaited module-level side
--   effect in routes/reports.ts, making it both untracked and subject to a race
--   with the migration runner at startup.  This migration owns the table from
--   this point forward and is idempotent on any starting schema.
--
--   voice_notes is Drizzle-managed.  We guard its index creation with a PL/pgSQL
--   existence check so the migration does not fail on a partial/fresh deployment
--   where Drizzle has not yet applied its schema.
--
-- Deduplication before indexing:
--   The old SELECT-then-INSERT attachment/voice-note flow was race-prone and
--   could insert duplicate object_path values under concurrent retries.  We
--   remove those duplicates (keeping the earliest registration) before adding
--   the unique constraint so the migration does not abort on existing data.

-- ── 1. report_attachments — ensure table exists ───────────────────────────────
-- This is the authoritative DDL; the unawaited CREATE TABLE in routes/reports.ts
-- is a belt-and-suspenders fallback and will become a no-op once all deployments
-- have run this migration.
CREATE TABLE IF NOT EXISTS report_attachments (
  id             SERIAL PRIMARY KEY,
  report_id      INTEGER NOT NULL,
  file_name      TEXT    NOT NULL,
  content_type   TEXT,
  size           BIGINT,
  object_path    TEXT    NOT NULL DEFAULT '',
  uploaded_by_id INTEGER,
  uploaded_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Deduplicate report_attachments.object_path ─────────────────────────────
-- Keep the earliest registration (MIN id) for each object_path; delete the rest.
-- Safe on an empty table — no rows matched, no rows deleted.
DELETE FROM report_attachments
WHERE id NOT IN (
  SELECT MIN(id) FROM report_attachments GROUP BY object_path
);

-- ── 3. Unique index on report_attachments.object_path ─────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_report_attachments_object_path
  ON report_attachments (object_path);

-- ── 4. voice_notes — deduplicate and index if the table exists ────────────────
-- voice_notes is Drizzle-managed; guard with an information_schema check so
-- this migration succeeds even if Drizzle has not yet applied its schema.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'voice_notes'
  ) THEN

    -- Remove duplicate object_path rows (same reasoning as report_attachments).
    DELETE FROM voice_notes
    WHERE id NOT IN (
      SELECT MIN(id) FROM voice_notes GROUP BY object_path
    );

    -- Create the unique index if it does not already exist.
    IF NOT EXISTS (
      SELECT 1 FROM pg_indexes
      WHERE tablename = 'voice_notes'
        AND indexname  = 'idx_voice_notes_object_path'
    ) THEN
      CREATE UNIQUE INDEX idx_voice_notes_object_path
        ON voice_notes (object_path);
    END IF;

  END IF;
END $$;
`,
  },
  {
    name: "020_global_full_operational_access_override_audit",
    sql: /* sql */ `
-- Migration 020: Override audit columns for Global Full Operational Access
--
-- Program Manager and Super Admin now have Full Operational Access across all
-- CAFA PMIS operational modules (Task #373). When either role performs an
-- action via the override path (e.g. self-review/self-approval), the approval
-- and audit log rows are annotated with used_override = TRUE and an
-- override_reason supplied by the actor.
--
-- Columns added idempotently so the migration is safe to re-run.

-- approvals table
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS used_override  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE approvals
  ADD COLUMN IF NOT EXISTS override_reason TEXT;

-- audit_log table
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS used_override  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE audit_log
  ADD COLUMN IF NOT EXISTS override_reason TEXT;
`,
  },
  {
    name: "019_workflow_path_spc_fallback",
    sql: /* sql */ `
-- Migration 019: Allow 'spc_fallback' as a workflow_path value (HQSR-BD-1/BD-6)
--
-- The SPC fallback author path for HQ Sector Reports is now enabled: when no
-- active Technical Coordinator covers a sector, a Senior Program Coordinator
-- may author the hq_sector report and the Program Manager becomes the
-- coordination reviewer.  The fallback must be identified by an IMMUTABLE
-- authoring-time fact (same rule as Migration 008: a later role change for the
-- author must never alter the report's approval path), so it is frozen into
-- workflow_path at creation rather than derived from the author's current role.
--
--   workflow_path values after this migration:
--     state_authored / technical_authored — project & activity reports (Migration 008)
--     spc_fallback                        — SPC-authored hq_sector fallback reports
--     NULL                                — all other simple-chain reports
DO $$
DECLARE
  conname_v TEXT;
BEGIN
  SELECT c.conname INTO conname_v
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
   WHERE t.relname = 'reports'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%workflow_path%';
  IF conname_v IS NOT NULL THEN
    EXECUTE format('ALTER TABLE reports DROP CONSTRAINT %I', conname_v);
  END IF;
END $$;

ALTER TABLE reports
  ADD CONSTRAINT reports_workflow_path_check
  CHECK (workflow_path IN ('state_authored', 'technical_authored', 'spc_fallback'));
`,
  },
  {
    name: "021_hq_sector_location_integrity",
    sql: /* sql */ `
-- Migration 021: HQSR-004 — HQ Sector Report location integrity
--
-- Canonical invariant: report_type = 'hq_sector' requires
-- state_id IS NULL AND project_id IS NULL. HQ Sector Reports are anchored to
-- a canonical sector, never to a State or Project. The CREATE route now
-- rejects supplied linkage (422 hq_sector_location_invalid) and forces NULL
-- in the INSERT; this migration remediates historical residue and adds a DB
-- CHECK constraint as defence in depth.
--
-- Step 1 — remediate Class A malformed rows (audited 2026-08-16; see
-- docs/audit-reports/hq-sector-location-integrity-audit.md). Class A =
-- genuine HQSR with accidental linkage: sector is one of the 7 canonical
-- Main Sectors (must stay in lockstep with lib/sectors.ts MAIN_SECTORS) and
-- kind is a valid recurring/on-demand frequency. Any row NOT matching these
-- heuristics (Class B, possibly misclassified — e.g. null or legacy
-- non-canonical sector) is left untouched so the constraint addition below
-- fails loudly rather than silently destroying classification evidence.
UPDATE reports
SET state_id = NULL, project_id = NULL
WHERE report_type = 'hq_sector'
  AND (state_id IS NOT NULL OR project_id IS NOT NULL)
  AND sector IN (
    'Health', 'Nutrition', 'WASH', 'Education', 'Protection',
    'Food Security & Livelihoods', 'Shelter & NFI'
  )
  AND kind IN ('monthly', 'quarterly', 'annual', 'on_demand');

-- Step 2 — CHECK constraint (idempotent). Other report types keep their
-- legitimate state_id/project_id linkage via the report_type <> 'hq_sector'
-- branch.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'reports'
       AND c.conname = 'chk_hq_sector_no_state_project'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT chk_hq_sector_no_state_project
      CHECK (
        report_type <> 'hq_sector'
        OR (state_id IS NULL AND project_id IS NULL)
      );
  END IF;
END $$;
`,
  },
  // ── NOTE on the duplicate "021_" prefix (PRJ-029 — NOT A DEFECT) ─────────
  // The entry below shares the "021_" numeric prefix with
  // "021_hq_sector_location_integrity" above. The migration runner tracks the
  // FULL migration name in schema_migrations — the numeric prefix is purely a
  // human-readability aid and is NOT the identity key, so both entries execute
  // independently exactly once with no conflict. Renaming deployed migrations
  // would risk re-execution and is prohibited.
  // FORWARD-LOOKING CONVENTION: new migrations should use a unique numeric
  // prefix (next unused number) for readability, but uniqueness of the full
  // name is what actually matters.
  {
    name: "021_report_attachments_drive_file_id.sql",
    sql: `
-- Migration 021: Extend report_attachments to support Drive-backed files.
--
-- HQSR (HQ Sector Reports) upload supporting documents to the Drive file store
-- rather than object storage.  This column links those records to the drive_files
-- table so the canonical /reports/:id/attachments endpoint returns them and the
-- /reports/:id/attachments/:attId/download endpoint can proxy them securely via
-- the authenticated download proxy built into the report attachment handler.
--
-- object_path remains '' for Drive-backed rows; drive_file_id remains NULL for
-- object-storage-backed rows.  The download endpoint checks drive_file_id first.
ALTER TABLE report_attachments
  ADD COLUMN IF NOT EXISTS drive_file_id INTEGER REFERENCES drive_files(id) ON DELETE SET NULL;

-- Replace the global unique index on object_path (which would reject duplicate ''
-- values used by Drive-backed rows) with two targeted partial indexes:
--
--  (a) Object-storage rows  — unique per object_path only among rows with no
--      drive_file_id.  This preserves the ATT-02 deduplication invariant.
--
--  (b) Drive-backed rows    — unique per (report_id, drive_file_id) pair so a
--      report cannot reference the same Drive file twice and bulk inserts of
--      multiple Drive-backed attachments on the same report never conflict.
DROP INDEX IF EXISTS idx_report_attachments_object_path;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_attachments_object_path_partial
  ON report_attachments (object_path)
  WHERE drive_file_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_attachments_drive_file
  ON report_attachments (report_id, drive_file_id)
  WHERE drive_file_id IS NOT NULL;
`,
  },
  {
    name: "023_hqsr_unique_period_indexes",
    sql: /* sql */ `
-- Migration 023: HQ Sector Report — deduplicate historical HQSR rows then
-- create partial unique indexes for recurring periods.
--
-- WHY DEDUPLICATION IS REQUIRED:
-- Before this migration, the POST /reports route had no server-side duplicate
-- guard for report_type = 'hq_sector'.  Although Migration 006 created
-- idx_reports_unique_hq_sector_* indexes (which the DB enforced), the route
-- returned a raw 23505 error rather than a clean 409, and any database restored
-- from a pre-006 backup could have active duplicates.  To be safe the migration
-- deterministically resolves any such duplicates before creating the new indexes.
--
-- DUPLICATE POLICY (mirrors Migration 006 / SPR pattern):
-- Among duplicate active (non-rejected, non-archived) HQSR rows for the same
-- sector + period: the row with the LOWEST id is the canonical row; all others
-- are marked migration_is_duplicate = TRUE.  Status is NOT changed; records are
-- fully preserved.  migration_review_notes is appended with an audit record.
--
-- ON DATABASES WHERE MIGRATION 006 ALREADY ENFORCED UNIQUENESS:
-- These UPDATE statements will match zero rows (no duplicates can exist) and
-- complete instantly without side-effects.
--
-- INDEXES:
-- These complement the idx_reports_unique_hq_sector_* indexes created in
-- Migration 006 by adding narrower indexes that omit the constant report_type
-- column from the index columns (smaller index, same constraint).  Both sets of
-- indexes coexist safely.  The server guard converts 23505 to a clean 409.

-- ── Step 1: Deduplicate monthly HQSRs ────────────────────────────────────────
-- For each (sector, reporting_year, reporting_month) group with multiple active
-- non-duplicate HQSR rows, mark all rows except the one with the smallest id
-- as migration_is_duplicate = TRUE.
UPDATE reports r
   SET migration_is_duplicate = TRUE,
       migration_review_notes = COALESCE(migration_review_notes, '') ||
         ' | Marked as duplicate HQSR by Migration 023 — duplicate monthly period ('
         || r.sector || ' ' || r.reporting_year::text || '-'
         || LPAD(r.reporting_month::text, 2, '0')
         || '). Canonical row (lowest id) preserved with status unchanged.'
 WHERE r.report_type = 'hq_sector'
   AND r.kind = 'monthly'
   AND r.reporting_year  IS NOT NULL
   AND r.reporting_month IS NOT NULL
   AND r.status NOT IN ('rejected', 'archived')
   AND r.migration_is_duplicate = FALSE
   AND EXISTS (
         SELECT 1
           FROM reports r2
          WHERE r2.report_type         = 'hq_sector'
            AND r2.kind                = 'monthly'
            AND r2.sector              = r.sector
            AND r2.reporting_year      = r.reporting_year
            AND r2.reporting_month     = r.reporting_month
            AND r2.status NOT IN ('rejected', 'archived')
            AND r2.migration_is_duplicate = FALSE
            AND r2.id < r.id
       );

-- ── Step 2: Deduplicate quarterly HQSRs ──────────────────────────────────────
UPDATE reports r
   SET migration_is_duplicate = TRUE,
       migration_review_notes = COALESCE(migration_review_notes, '') ||
         ' | Marked as duplicate HQSR by Migration 023 — duplicate quarterly period ('
         || r.sector || ' ' || r.reporting_year::text || ' Q' || r.quarter::text
         || '). Canonical row (lowest id) preserved with status unchanged.'
 WHERE r.report_type = 'hq_sector'
   AND r.kind = 'quarterly'
   AND r.reporting_year IS NOT NULL
   AND r.quarter        IS NOT NULL
   AND r.status NOT IN ('rejected', 'archived')
   AND r.migration_is_duplicate = FALSE
   AND EXISTS (
         SELECT 1
           FROM reports r2
          WHERE r2.report_type         = 'hq_sector'
            AND r2.kind                = 'quarterly'
            AND r2.sector              = r.sector
            AND r2.reporting_year      = r.reporting_year
            AND r2.quarter             = r.quarter
            AND r2.status NOT IN ('rejected', 'archived')
            AND r2.migration_is_duplicate = FALSE
            AND r2.id < r.id
       );

-- ── Step 3: Deduplicate annual HQSRs ─────────────────────────────────────────
UPDATE reports r
   SET migration_is_duplicate = TRUE,
       migration_review_notes = COALESCE(migration_review_notes, '') ||
         ' | Marked as duplicate HQSR by Migration 023 — duplicate annual period ('
         || r.sector || ' ' || r.reporting_year::text
         || '). Canonical row (lowest id) preserved with status unchanged.'
 WHERE r.report_type = 'hq_sector'
   AND r.kind = 'annual'
   AND r.reporting_year IS NOT NULL
   AND r.status NOT IN ('rejected', 'archived')
   AND r.migration_is_duplicate = FALSE
   AND EXISTS (
         SELECT 1
           FROM reports r2
          WHERE r2.report_type         = 'hq_sector'
            AND r2.kind                = 'annual'
            AND r2.sector              = r.sector
            AND r2.reporting_year      = r.reporting_year
            AND r2.status NOT IN ('rejected', 'archived')
            AND r2.migration_is_duplicate = FALSE
            AND r2.id < r.id
       );

-- ── Step 4: Create partial unique indexes ────────────────────────────────────
-- These are safe now: all pre-existing duplicates have migration_is_duplicate = TRUE
-- and are excluded from the index predicate.

-- Monthly: one active HQSR per sector per calendar month.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hqsr_unique_monthly
  ON reports (sector, reporting_year, reporting_month)
  WHERE report_type = 'hq_sector'
    AND kind = 'monthly'
    AND reporting_year  IS NOT NULL
    AND reporting_month IS NOT NULL
    AND status NOT IN ('rejected', 'archived')
    AND migration_is_duplicate = FALSE;

-- Quarterly: one active HQSR per sector per calendar quarter.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hqsr_unique_quarterly
  ON reports (sector, reporting_year, quarter)
  WHERE report_type = 'hq_sector'
    AND kind = 'quarterly'
    AND reporting_year IS NOT NULL
    AND quarter        IS NOT NULL
    AND status NOT IN ('rejected', 'archived')
    AND migration_is_duplicate = FALSE;

-- Annual: one active HQSR per sector per calendar year.
CREATE UNIQUE INDEX IF NOT EXISTS idx_hqsr_unique_annual
  ON reports (sector, reporting_year)
  WHERE report_type = 'hq_sector'
    AND kind = 'annual'
    AND reporting_year IS NOT NULL
    AND status NOT IN ('rejected', 'archived')
    AND migration_is_duplicate = FALSE;
`,
  },
  {
    name: "024_plan_attachments_plan_fk",
    sql: /* sql */ `
-- Migration 024: Add referential integrity to plan_attachments.plan_id.
--
-- plan_attachments previously had no FK to plans.  Without it there was no
-- PostgreSQL-level locking coordination between attachment uploads and plan
-- deletion, allowing a concurrent INSERT to slip past a DELETE transaction
-- and leave an orphaned metadata row (or miss a storage path for post-COMMIT
-- cleanup).
--
-- Adding FOREIGN KEY … ON DELETE CASCADE means:
--   1. Every INSERT into plan_attachments acquires KEY SHARE on the referenced
--      plans row.  A plan DELETE (which uses SELECT … FOR UPDATE at the start
--      of its transaction) will block those INSERTs until the transaction
--      commits — preventing new uploads from landing after path collection.
--   2. When a plans row is deleted the DB engine cascades the DELETE to all
--      matching plan_attachments rows automatically; the explicit DELETE in the
--      route handler acts as a belt-and-suspenders guard (both are safe).
--
-- Safe deployment pattern for an existing table that may contain orphan rows:
--
--   Step 1 — Remove orphan rows (plan_attachments whose plan no longer exists).
--            Historical concurrent uploads or manual corrections may have left
--            metadata rows pointing to deleted plans.  Removing them first
--            ensures the subsequent constraint addition and validation succeed.
--
--   Step 2 — Add constraint NOT VALID.  This registers the FK and enforces it
--            for all NEW inserts/updates but does NOT scan existing rows.  The
--            server can start and accept traffic immediately, even on large tables.
--
--   Step 3 — VALIDATE CONSTRAINT.  After the orphan cleanup in Step 1 every
--            surviving row should already reference a valid plan, so this scan
--            completes quickly and confirms correctness before the migration ends.
--
-- Idempotent: the outer IF checks for the constraint before each action.

-- Step 1: remove orphan metadata rows to avoid FK violation in step 3.
DELETE FROM plan_attachments
WHERE plan_id NOT IN (SELECT id FROM plans);

-- Step 2 & 3: add FK (NOT VALID) then validate in a single idempotent block.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   information_schema.table_constraints
    WHERE  constraint_name = 'fk_plan_attachments_plan_id'
      AND  table_name      = 'plan_attachments'
      AND  constraint_type = 'FOREIGN KEY'
  ) THEN
    -- NOT VALID: skips scanning pre-existing rows; enforces future inserts/updates.
    ALTER TABLE plan_attachments
      ADD CONSTRAINT fk_plan_attachments_plan_id
      FOREIGN KEY (plan_id)
      REFERENCES plans(id)
      ON DELETE CASCADE
      NOT VALID;

    -- VALIDATE: confirms all remaining rows are consistent after the orphan cleanup.
    ALTER TABLE plan_attachments
      VALIDATE CONSTRAINT fk_plan_attachments_plan_id;
  END IF;
END;
$$;
`,
  },
  {
    name: "022_hqsr_attachments_backfill.sql",
    sql: `
-- Migration 022: Backfill report_attachments for existing hq_sector reports.
--
-- HQSR reports saved before migration 021 have Drive-backed attachments stored
-- only in reports.sections->>'attachments' JSON.  They cannot be reached via the
-- PATCH-time sync (the sync guard requires a live draft PATCH; submitted/approved
-- reports are not PATCH-able).  This migration creates report_attachments rows
-- for every Drive-backed attachment found in existing hq_sector reports, using
-- the file metadata already stored in the JSON.
--
-- Idempotency:
--   • WHERE NOT EXISTS prevents duplicate rows on re-run.
--   • EXISTS (drive_files …) enforces three properties: the FK is satisfied, the
--     file is still active, and the uploader is the report author.  Any attachment
--     whose driveFileId refers to another user's file is silently skipped — this
--     prevents cross-file data disclosure via the download proxy.
--   • Only rows where driveFileId is a valid positive integer are processed.
--   • size is validated as a numeric string before casting so malformed JSON
--     metadata cannot abort the migration (falls back to 0).
--
-- Security note: the download endpoint proxies any Drive file linked through
-- report_attachments after only report-level access control.  Restricting the
-- backfill to drive_files rows where uploaded_by_user_id = r.author_id is
-- therefore a mandatory ownership gate, mirroring the runtime sync in
-- syncHqsrDriveAttachments.
INSERT INTO report_attachments
  (report_id, file_name, content_type, size, object_path, drive_file_id, uploaded_by_id)
SELECT
  r.id,
  COALESCE(NULLIF(TRIM(att->>'fileName'),  ''), 'attachment')                  AS file_name,
  COALESCE(NULLIF(TRIM(att->>'contentType'),''), 'application/octet-stream')   AS content_type,
  CASE
    WHEN (att->>'size') ~ '^[0-9]+$' AND (att->>'size')::bigint <= 2147483647
    THEN (att->>'size')::bigint
    ELSE 0
  END                                                                           AS size,
  ''                                                                            AS object_path,
  (att->>'driveFileId')::integer                                                AS drive_file_id,
  r.author_id                                                                   AS uploaded_by_id
FROM reports r,
     jsonb_array_elements(
       CASE
         WHEN jsonb_typeof(r.sections->'attachments') = 'array'
         THEN r.sections->'attachments'
         ELSE '[]'::jsonb
       END
     ) AS att
WHERE r.report_type = 'hq_sector'
  AND r.sections IS NOT NULL
  AND att->>'driveFileId' IS NOT NULL
  AND (att->>'driveFileId') ~ '^[1-9][0-9]*$'
  AND EXISTS (
        SELECT 1 FROM drive_files df
         WHERE df.id         = (att->>'driveFileId')::integer
           AND df.status     = 'active'
           AND df.uploaded_by_user_id = r.author_id
      )
  AND NOT EXISTS (
        SELECT 1 FROM report_attachments ra
         WHERE ra.report_id  = r.id
           AND ra.drive_file_id = (att->>'driveFileId')::integer
      );
`,
  },
  {
    name: "025_projects_soft_delete_and_doc_drive_file",
    sql: `
-- Migration 025: Track projects soft-delete columns and project_documents.drive_file_id
-- as proper schema migrations rather than silently at route startup.
--
-- Soft-delete columns were previously added by a pool.query().catch(()=>{}) block
-- in routes/projects.ts at module load. That pattern is removed in this task.
--
-- projects.deleted_by references users.id; SET NULL on user delete preserves audit
-- history without orphaning. The startup DDL used plain INTEGER with no FK — this
-- migration upgrades the semantics on fresh databases; existing environments where
-- the column already exists as plain INTEGER are not retroactively altered (safe).
--
-- project_documents.drive_file_id is an INTEGER reference to drive_files.id.
-- The column is nullable (NULL = object-storage-backed document).
-- ON DELETE SET NULL preserves the document row if the drive file is deleted.

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS deleted_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by     INTEGER,
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT,
  ADD COLUMN IF NOT EXISTS deletion_mode  TEXT;

ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS drive_file_id INTEGER;
`,
  },
  {
    name: "026_plans_date_range_check",
    sql: `
-- Migration 026: Add CHECK constraint to enforce date ordering on plans.
-- Both columns are nullable (migration 003); the constraint only applies
-- when both are non-NULL.
--
-- Preflight: check for existing rows that would violate the new constraint.
-- If any exist, skip adding the CHECK (log a NOTICE) so the migration does NOT
-- block server startup. The server-side validatePlanDates() guard is already in
-- place for new writes. The constraint can be added manually once historical rows
-- are remediated.  If no bad rows exist (expected), the constraint is added.
DO $$
DECLARE bad_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO bad_count
  FROM plans
  WHERE start_date IS NOT NULL
    AND end_date IS NOT NULL
    AND end_date < start_date;
  IF bad_count > 0 THEN
    RAISE NOTICE
      'Migration 026: skipping plans_date_range_check constraint — % row(s) have end_date < start_date. '
      'Remediate those rows first, then run: ALTER TABLE plans ADD CONSTRAINT plans_date_range_check '
      'CHECK (start_date IS NULL OR end_date IS NULL OR end_date >= start_date);',
      bad_count;
  ELSE
    EXECUTE 'ALTER TABLE plans DROP CONSTRAINT IF EXISTS plans_date_range_check';
    EXECUTE $sql$
      ALTER TABLE plans
        ADD CONSTRAINT plans_date_range_check
        CHECK (
          start_date IS NULL
          OR end_date IS NULL
          OR end_date >= start_date
        )
    $sql$;
    RAISE NOTICE 'Migration 026: plans_date_range_check constraint added (0 bad rows found).';
  END IF;
END $$;
`,
  },
  {
    name: "024_project_code_unique",
    sql: /* sql */ `
-- Migration 024: PRJ-008/PRJ-018 — DB-level uniqueness for projects.code.
--
-- The create route now takes a transaction-scoped advisory lock
-- (pg_advisory_xact_lock on a per-year key) before computing the next
-- sequence number, which prevents the MAX+1 race. This constraint is
-- defence-in-depth: any escape is caught at the DB layer and mapped to a
-- clean 409 (project_code_conflict) by the route's catch handler.
--
-- Step 1 — remediate any historical duplicate codes before constraining.
-- Duplicate audit at authoring time (2026-08-17) found ZERO duplicates; this
-- block is defensive for databases restored from older backups. Among
-- duplicates the lowest id keeps the original code; later rows get a
-- disambiguating '-DUPn' suffix so no data is lost.
DO $$
DECLARE r RECORD; n INTEGER;
BEGIN
  FOR r IN
    SELECT code FROM projects GROUP BY code HAVING COUNT(*) > 1
  LOOP
    n := 0;
    UPDATE projects p
       SET code = p.code || '-DUP' || sub.rn
      FROM (
        SELECT id, ROW_NUMBER() OVER (ORDER BY id) - 1 AS rn
          FROM projects WHERE code = r.code
      ) sub
     WHERE p.id = sub.id AND sub.rn > 0;
    RAISE NOTICE 'Migration 024: remediated duplicate project code %', r.code;
  END LOOP;
END $$;

-- Step 2 — UNIQUE constraint (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
      JOIN pg_class t ON t.oid = c.conrelid
     WHERE t.relname = 'projects'
       AND c.conname = 'projects_code_unique'
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT projects_code_unique UNIQUE (code);
  END IF;
END $$;

-- Step 3 — PRJ-019 (NOT A DEFECT): schema comments documenting the two
-- intentionally distinct locality tables.
COMMENT ON TABLE project_free_localities IS
  'User-entered free-text locality names captured in the Project registration form (display/ordering only). Intentionally distinct from project_localities — NOT a duplicate table (PRJ-019).';
COMMENT ON TABLE project_localities IS
  'Structured FK links from projects to the canonical localities table, used for dashboard analytics. Intentionally distinct from project_free_localities — NOT a duplicate table (PRJ-019).';
`,
  },
  {
    name: "027_project_state_allocations_integrity",
    sql: /* sql */ `
-- Migration 027: BUD audit — structural integrity for project_state_allocations.
--
-- Business rules already enforced app-side (routes/projects.ts state-allocation
-- POST): one allocation per (project, state) pair (POST replaces the full set),
-- non-negative budget allocations, and allocations only for states linked to the
-- project. This migration makes those rules defence-in-depth at the DB layer and
-- removes the concurrency window in which duplicate pairs could be inserted.

-- Step 1 — remediate duplicate (project_id, state_id) pairs, keeping the newest row.
DELETE FROM project_state_allocations psa
 USING project_state_allocations newer
 WHERE newer.project_id = psa.project_id
   AND newer.state_id   = psa.state_id
   AND (newer.updated_at > psa.updated_at
        OR (newer.updated_at = psa.updated_at AND newer.id > psa.id));

-- Step 2 — remove orphan rows (project or state no longer exists).
DELETE FROM project_state_allocations psa
 WHERE NOT EXISTS (SELECT 1 FROM projects p WHERE p.id = psa.project_id)
    OR NOT EXISTS (SELECT 1 FROM states s WHERE s.id = psa.state_id);

-- Step 3 — remediate negative allocations (app layer has always rejected these;
-- any present row is a data anomaly). Set to 0 rather than delete, preserving the row.
UPDATE project_state_allocations SET budget_allocation = 0 WHERE budget_allocation < 0;

-- Step 4 — constraints (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_state_allocations_project_state_unique') THEN
    ALTER TABLE project_state_allocations
      ADD CONSTRAINT project_state_allocations_project_state_unique UNIQUE (project_id, state_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_state_allocations_project_fk') THEN
    ALTER TABLE project_state_allocations
      ADD CONSTRAINT project_state_allocations_project_fk
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_state_allocations_state_fk') THEN
    ALTER TABLE project_state_allocations
      ADD CONSTRAINT project_state_allocations_state_fk
      FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'project_state_allocations_budget_nonnegative') THEN
    ALTER TABLE project_state_allocations
      ADD CONSTRAINT project_state_allocations_budget_nonnegative CHECK (budget_allocation >= 0);
  END IF;
END $$;
`,
  },
  {
    name: "028_risks_drop_dead_version_and_open_default",
    sql: /* sql */ `
-- Migration 028: Risk Register residual integrity (Wave 2).
--
-- RISK-003 — the risks.version column was dead optimistic-locking schema:
-- no API route ever read or wrote it and no client contract exists for
-- versioning. NOTE: locked_by / locked_at are NOT dead — they are actively
-- used by the realtime record-lock routes (routes/realtime.ts) and are
-- intentionally retained.
ALTER TABLE risks DROP COLUMN IF EXISTS version;

-- RISK-022 — the DB default status was 'identified' but the canonical create
-- status (Business Decision closure) is 'open'; every app INSERT already
-- forces 'open'. Align the DB default so direct DB inserts (seeds, migrations)
-- cannot produce inconsistent rows. Existing rows with status 'identified'
-- are NOT updated: 'identified' remains a valid lifecycle status in the
-- 9-value model and user intent cannot be distinguished retroactively.
ALTER TABLE risks ALTER COLUMN status SET DEFAULT 'open';
`,
  },
  {
    name: "029_allocation_cap_residual_warning",
    sql: `
-- Migration 029: BUD-BD-01 — allocation cap residual audit (warning only).
-- The application now enforces SUM(project_state_allocations.budget_allocation)
-- <= projects.budget_total unconditionally on all write paths. Rows written
-- before enforcement may violate the cap. This migration does NOT auto-correct
-- (allocations are user financial data) — it raises a WARNING per offending
-- project so operators can remediate deliberately. See
-- docs/audit-reports/budgets-allocation-cap-integrity-closure.md.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.title,
           COALESCE(p.budget_total::float, 0) AS budget_total,
           SUM(COALESCE(psa.budget_allocation::float, 0)) AS alloc_total
    FROM projects p
    JOIN project_state_allocations psa ON psa.project_id = p.id
    WHERE p.deleted_at IS NULL
    GROUP BY p.id, p.title, p.budget_total
    HAVING SUM(COALESCE(psa.budget_allocation::float, 0)) > COALESCE(p.budget_total::float, 0)
  LOOP
    RAISE WARNING 'Migration 029: project % (id %) is over-allocated: allocations % exceed budget % — remediate manually',
      r.title, r.id, r.alloc_total, r.budget_total;
  END LOOP;
END $$;
`,
  },
  {
    name: "030_donor_id_fk_constraint",
    sql: /* sql */ `
-- Migration 030: BUD-DONOR-008 — referential integrity for projects.donor_id
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Background
-- ----------
-- AUDIT-1 (BUD-008 closure audit, 2026-08-19) found that projects.donor_id carried
-- no database-level foreign key despite acting as a canonical link to the donors
-- table. Donor existence was previously enforced only at the application layer
-- (CREATE / PATCH routes), not at the database layer. Any tool or script bypassing
-- the API could persist an invalid donor_id without detection.
--
-- This migration closes the gap in two steps:
--
--   Step 1 — Pre-flight orphan remediation (idempotent, audit-safe).
--     Scans for any projects whose donor_id does not match a donors.id row.
--     For each orphan found: raises a WARNING to the server log (operator
--     visibility) and sets donor_id = NULL. The free-text projects.donor column
--     is NOT touched; historical attribution is preserved in that column.
--     In the 2026-08-19 dataset: zero orphans were found, so no rows are mutated
--     by this step in production.
--
--   Step 2 — FK constraint addition (idempotent via existence check).
--     Adds fk_projects_donor_id with ON DELETE SET NULL semantics: if a canonical
--     donor record is ever hard-deleted, the linked projects lose the FK reference
--     gracefully (donor_id becomes NULL) rather than blocking the deletion or
--     cascading a project delete. The free-text donor column continues to hold
--     the historical name string, preserving portfolio attribution.
--
-- Constraint name: fk_projects_donor_id
-- Behaviour on donor delete: SET NULL (not CASCADE, not RESTRICT)
-- Existing data impact: zero rows modified (clean dataset confirmed)
-- Rollback: ALTER TABLE projects DROP CONSTRAINT fk_projects_donor_id
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.id, p.donor_id
    FROM projects p
    WHERE p.donor_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM donors d WHERE d.id = p.donor_id)
  LOOP
    RAISE WARNING 'Migration 030: project % has orphaned donor_id % — setting to NULL; free-text donor field retains attribution',
      r.id, r.donor_id;
    UPDATE projects SET donor_id = NULL WHERE id = r.id;
  END LOOP;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'fk_projects_donor_id'
      AND conrelid = 'projects'::regclass
  ) THEN
    ALTER TABLE projects
      ADD CONSTRAINT fk_projects_donor_id
      FOREIGN KEY (donor_id) REFERENCES donors(id) ON DELETE SET NULL;
  END IF;
END $$;
`,
  },
  {
    name: "031_notification_event_dedupes",
    sql: /* sql */ `
-- Migration 031: NOTIF-003 — event-aware, atomic notification deduplication.
--
-- Existing notifications intentionally remain untouched. Before introducing the
-- new uniqueness invariant, this read-only preflight reports exact historical
-- duplicates for operator awareness; it never deletes or mutates notification
-- history. The new table begins empty because legacy rows have no reliable
-- source-event identity from which to reconstruct an event_key safely.
DO $$
DECLARE
  duplicate_groups INTEGER;
BEGIN
  SELECT COUNT(*)::int INTO duplicate_groups
  FROM (
    SELECT 1
    FROM notifications
    GROUP BY user_id, kind, entity_type, entity_id, message, link
    HAVING COUNT(*) > 1
  ) historical_duplicates;

  IF duplicate_groups > 0 THEN
    RAISE WARNING
      'Migration 031: % historical exact-notification duplicate groups found; no historical rows were changed',
      duplicate_groups;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS notification_event_dedupes (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_key   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT notification_event_dedupes_user_event_key_unique
    UNIQUE (user_id, event_key)
);

CREATE INDEX IF NOT EXISTS idx_notification_event_dedupes_created_at
  ON notification_event_dedupes (created_at);
`,
  },
  {
    name: "032_communication_lifecycle_integrity",
    sql: /* sql */ `
-- Migration 032: Communication Centre history, lifecycle and identity safety.
--
-- Historical conversations are deliberately not repaired here. Read-only
-- preflight findings are recorded in the Communication reconciliation register;
-- new writes use the tables and NOT VALID foreign keys below so historical
-- ambiguity never becomes an automatic deletion or a silent data rewrite.

CREATE TABLE IF NOT EXISTS message_user_hides (
  id         SERIAL PRIMARY KEY,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hidden_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT message_user_hides_message_user_unique UNIQUE (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS direct_conversation_keys (
  user_low_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  user_high_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE RESTRICT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT direct_conversation_keys_pair_unique UNIQUE (user_low_id, user_high_id),
  CONSTRAINT direct_conversation_keys_conversation_unique UNIQUE (conversation_id),
  CONSTRAINT direct_conversation_keys_ordered_pair CHECK (user_low_id < user_high_id)
);

CREATE TABLE IF NOT EXISTS organisational_conversation_keys (
  entity_key TEXT PRIMARY KEY,
  conversation_id INTEGER NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_history
  ON messages (conversation_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_message_user_hides_user_message
  ON message_user_hides (user_id, message_id);

-- Existing rows may have historical reference defects. NOT VALID FKs still
-- enforce all future inserts/updates without rewriting or deleting that history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_conversations_created_by') THEN
    ALTER TABLE conversations ADD CONSTRAINT fk_conversations_created_by
      FOREIGN KEY (created_by_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_conversations_project') THEN
    ALTER TABLE conversations ADD CONSTRAINT fk_conversations_project
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_conversations_state') THEN
    ALTER TABLE conversations ADD CONSTRAINT fk_conversations_state
      FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_conversation_members_conversation') THEN
    ALTER TABLE conversation_members ADD CONSTRAINT fk_conversation_members_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_conversation_members_user') THEN
    ALTER TABLE conversation_members ADD CONSTRAINT fk_conversation_members_user
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_messages_conversation') THEN
    ALTER TABLE messages ADD CONSTRAINT fk_messages_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_messages_sender') THEN
    ALTER TABLE messages ADD CONSTRAINT fk_messages_sender
      FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE RESTRICT NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_messages_reply') THEN
    ALTER TABLE messages ADD CONSTRAINT fk_messages_reply
      FOREIGN KEY (reply_to_id) REFERENCES messages(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='fk_messages_forwarded_from') THEN
    ALTER TABLE messages ADD CONSTRAINT fk_messages_forwarded_from
      FOREIGN KEY (forwarded_from_message_id) REFERENCES messages(id) ON DELETE SET NULL NOT VALID;
  END IF;
END $$;
`,
  },
  {
    name: "033_communication_membership_write_integrity",
    sql: /* sql */ `
-- Migration 033: preserve historical membership evidence while rejecting
-- duplicate conversation/user memberships on every future database write.
--
-- A conventional UNIQUE (conversation_id, user_id) cannot be introduced yet:
-- the reconciliation register documents legacy duplicate rows and this task
-- must not merge or delete them automatically. The trigger is forward-only:
-- existing rows remain untouched, while its transaction-scoped advisory lock
-- makes concurrent direct INSERTs converge before a duplicate can be written.

CREATE OR REPLACE FUNCTION enforce_conversation_membership_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(NEW.conversation_id, NEW.user_id);

  IF EXISTS (
    SELECT 1
    FROM conversation_members cm
    WHERE cm.conversation_id = NEW.conversation_id
      AND cm.user_id = NEW.user_id
      AND (TG_OP = 'INSERT' OR cm.id <> NEW.id)
  ) THEN
    RAISE EXCEPTION 'duplicate conversation membership for conversation % and user %',
      NEW.conversation_id, NEW.user_id
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversation_members_identity_guard ON conversation_members;
CREATE TRIGGER conversation_members_identity_guard
  BEFORE INSERT OR UPDATE OF conversation_id, user_id ON conversation_members
  FOR EACH ROW
  EXECUTE FUNCTION enforce_conversation_membership_identity();
`,
  },
  {
    name: "034_state_registry_identity",
    sql: /* sql */ `
-- Migration 034: State registry identity and forward-write safety.
--
-- States deliberately have no lifecycle columns or deletion policy. This
-- migration protects only their canonical id/name/code master-data identity.
-- Historical duplicates are reported, never merged, renamed, or deleted.

DO $$
DECLARE
  duplicate_name_groups INTEGER;
  duplicate_code_groups INTEGER;
  orphaned_references INTEGER;
  legacy_free_text INTEGER;
BEGIN
  SELECT COUNT(*)::int INTO duplicate_name_groups
  FROM (
    SELECT 1
    FROM states
    GROUP BY lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))
    HAVING COUNT(*) > 1
  ) duplicates;

  SELECT COUNT(*)::int INTO duplicate_code_groups
  FROM (
    SELECT 1
    FROM states
    GROUP BY lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))
    HAVING COUNT(*) > 1
  ) duplicates;

  SELECT (
    (SELECT COUNT(*) FROM users u LEFT JOIN states s ON s.id = u.state_id WHERE u.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM localities l LEFT JOIN states s ON s.id = l.state_id WHERE s.id IS NULL) +
    (SELECT COUNT(*) FROM project_states ps LEFT JOIN states s ON s.id = ps.state_id WHERE s.id IS NULL) +
    (SELECT COUNT(*) FROM project_state_allocations psa LEFT JOIN states s ON s.id = psa.state_id WHERE s.id IS NULL) +
    (SELECT COUNT(*) FROM activities a LEFT JOIN states s ON s.id = a.state_id WHERE a.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM beneficiaries b LEFT JOIN states s ON s.id = b.state_id WHERE s.id IS NULL) +
    (SELECT COUNT(*) FROM risks r LEFT JOIN states s ON s.id = r.state_id WHERE r.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM plans p LEFT JOIN states s ON s.id = p.state_id WHERE s.id IS NULL) +
    (SELECT COUNT(*) FROM plan_activities pa LEFT JOIN states s ON s.id = pa.state_id WHERE pa.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM reports r LEFT JOIN states s ON s.id = r.state_id WHERE r.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM conversations c LEFT JOIN states s ON s.id = c.state_id WHERE c.state_id IS NOT NULL AND s.id IS NULL) +
    (SELECT COUNT(*) FROM states st LEFT JOIN users u ON u.id = st.manager_user_id WHERE st.manager_user_id IS NOT NULL AND u.id IS NULL)
  )::int INTO orphaned_references;

  SELECT COUNT(*)::int INTO legacy_free_text
  FROM plan_activities pa
  WHERE pa.state_id IS NULL
    AND NULLIF(btrim(pa.state_name), '') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM states s
      WHERE lower(regexp_replace(btrim(s.name), '[[:space:]]+', ' ', 'g')) =
            lower(regexp_replace(btrim(pa.state_name), '[[:space:]]+', ' ', 'g'))
    );

  IF duplicate_name_groups > 0 OR duplicate_code_groups > 0 OR orphaned_references > 0 OR legacy_free_text > 0 THEN
    RAISE WARNING
      'Migration 034 State registry preflight: % normalised name duplicate groups, % normalised code duplicate groups, % orphaned ID references, % unmatched legacy free-text plan activity State names. No historical data was changed.',
      duplicate_name_groups, duplicate_code_groups, orphaned_references, legacy_free_text;
  END IF;
END $$;

-- Expression indexes support the forward-write identity checks without
-- attempting unsafe automatic cleanup of historical data.
CREATE INDEX IF NOT EXISTS idx_states_normalised_name
  ON states ((lower(regexp_replace(btrim(name), '[[:space:]]+', ' ', 'g'))));
CREATE INDEX IF NOT EXISTS idx_states_normalised_code
  ON states ((lower(regexp_replace(btrim(code), '[[:space:]]+', ' ', 'g'))));

CREATE OR REPLACE FUNCTION enforce_state_registry_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.name := regexp_replace(btrim(NEW.name), '[[:space:]]+', ' ', 'g');
  NEW.code := regexp_replace(btrim(NEW.code), '[[:space:]]+', ' ', 'g');
  IF NEW.office_address IS NOT NULL THEN
    NEW.office_address := NULLIF(regexp_replace(btrim(NEW.office_address), '[[:space:]]+', ' ', 'g'), '');
  END IF;

  IF NEW.name = '' OR char_length(NEW.name) > 120 THEN
    RAISE EXCEPTION 'invalid State name' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.code = '' OR char_length(NEW.code) > 24 THEN
    RAISE EXCEPTION 'invalid State code' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.office_address IS NOT NULL AND char_length(NEW.office_address) > 500 THEN
    RAISE EXCEPTION 'invalid State office address' USING ERRCODE = 'check_violation';
  END IF;

  -- Transaction-scoped locks make equivalent concurrent creates and renames
  -- converge before their duplicate checks. Existing duplicate rows remain
  -- readable; this is a forward-only protection.
  PERFORM pg_advisory_xact_lock(hashtext('states:name:' || lower(NEW.name)));
  PERFORM pg_advisory_xact_lock(hashtext('states:code:' || lower(NEW.code)));

  IF EXISTS (
    SELECT 1 FROM states s
    WHERE s.id IS DISTINCT FROM NEW.id
      AND lower(regexp_replace(btrim(s.name), '[[:space:]]+', ' ', 'g')) = lower(NEW.name)
  ) OR EXISTS (
    SELECT 1 FROM states s
    WHERE s.id IS DISTINCT FROM NEW.id
      AND lower(regexp_replace(btrim(s.code), '[[:space:]]+', ' ', 'g')) = lower(NEW.code)
  ) THEN
    RAISE EXCEPTION 'duplicate State name or code' USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS states_registry_identity_guard ON states;
CREATE TRIGGER states_registry_identity_guard
  BEFORE INSERT OR UPDATE OF name, code, office_address ON states
  FOR EACH ROW
  EXECUTE FUNCTION enforce_state_registry_identity();
`,
  },
  {
    name: "035_user_identity_uniqueness",
    sql: /* sql */ `
-- User Management: user identities are compared after the same trim/lowercase
-- normalisation used by the API. The preflight deliberately fails rather than
-- deleting or merging historical accounts if an operator must resolve a
-- cosmetic collision first.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM users
    GROUP BY lower(btrim(email))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce user email identity: normalised duplicate email records exist'
      USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM users
    WHERE NULLIF(btrim(COALESCE(username, '')), '') IS NOT NULL
    GROUP BY lower(btrim(username))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot enforce user username identity: normalised duplicate username records exist'
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS users_normalised_email_unique
  ON users ((lower(btrim(email))));
CREATE UNIQUE INDEX IF NOT EXISTS users_normalised_username_unique
  ON users ((lower(btrim(username))))
  WHERE NULLIF(btrim(COALESCE(username, '')), '') IS NOT NULL;
`,
  },
  {
    name: "036_document_registry",
    sql: /* sql */ `
-- The registry stores filing metadata only. It deliberately does not own file
-- bytes or parent attachment lifecycles.
CREATE TABLE IF NOT EXISTS document_registry_entries (
  id                  SERIAL PRIMARY KEY,
  source_kind         TEXT NOT NULL,
  source_id           INTEGER NOT NULL,
  title               TEXT,
  description         TEXT,
  classification      TEXT NOT NULL,
  confidentiality     TEXT NOT NULL DEFAULT 'internal',
  retention_years     INTEGER,
  tags                JSONB NOT NULL DEFAULT '[]'::jsonb,
  related_record_type TEXT,
  related_record_id   INTEGER,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT document_registry_entries_source_unique UNIQUE (source_kind, source_id),
  CONSTRAINT document_registry_entries_confidentiality_check
    CHECK (confidentiality IN ('public', 'internal', 'confidential', 'restricted')),
  CONSTRAINT document_registry_entries_retention_check
    CHECK (retention_years IS NULL OR retention_years BETWEEN 1 AND 100)
);

ALTER TABLE program_resources
  ADD COLUMN IF NOT EXISTS confidentiality TEXT NOT NULL DEFAULT 'internal',
  ADD COLUMN IF NOT EXISTS retention_years INTEGER;

ALTER TABLE program_resources
  DROP CONSTRAINT IF EXISTS program_resources_confidentiality_check;
ALTER TABLE program_resources
  ADD CONSTRAINT program_resources_confidentiality_check
    CHECK (confidentiality IN ('public', 'internal', 'confidential', 'restricted'));
ALTER TABLE program_resources
  DROP CONSTRAINT IF EXISTS program_resources_retention_years_check;
ALTER TABLE program_resources
  ADD CONSTRAINT program_resources_retention_years_check
    CHECK (retention_years IS NULL OR retention_years BETWEEN 1 AND 100);

-- Preserve legacy labels exactly. In particular, historical HR Records are
-- indexed but never reclassified into a new active category.
INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, tags, related_record_type)
SELECT 'resource', pr.id, pr.category, COALESCE(pr.confidentiality, 'internal'),
       CASE WHEN NULLIF(btrim(COALESCE(pr.tags, '')), '') IS NULL THEN '[]'::jsonb
            ELSE to_jsonb(regexp_split_to_array(pr.tags, '\\s*,\\s*')) END,
       'direct_upload'
FROM program_resources pr
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
SELECT 'project_document', pd.id, 'Project Documents', 'internal', 'project', pd.project_id
FROM project_documents pd
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
SELECT 'plan_attachment', pa.id, 'Plans & Workplans', 'internal', 'plan', pa.plan_id
FROM plan_attachments pa
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
SELECT 'drive_file', df.id,
       CASE WHEN df.module = 'plans' THEN 'Plans & Workplans'
            ELSE COALESCE(NULLIF(df.module, ''), 'Legacy Files') END,
       COALESCE(NULLIF(df.visibility_level, ''), 'internal'),
       CASE WHEN df.module = 'plans' THEN 'plan' ELSE NULL END,
       df.record_id
FROM drive_files df
WHERE df.module IN ('plans', 'attachments')
ON CONFLICT (source_kind, source_id) DO NOTHING;

INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
SELECT 'report_attachment', ra.id,
       CASE WHEN COALESCE(r.sections->>'reportingAudience', r.sections->>'reportAudience', '') = 'donor'
                   OR r.kind ILIKE '%donor%'
            THEN 'Donor Reports' ELSE 'Programme Reports' END,
       'internal', 'report', ra.report_id
FROM report_attachments ra
JOIN reports r ON r.id = ra.report_id
ON CONFLICT (source_kind, source_id) DO NOTHING;

CREATE INDEX IF NOT EXISTS document_registry_entries_classification_idx
  ON document_registry_entries (classification);
`,
  },
  {
    name: "037_plan_attachment_registry_backfill",
    sql: /* sql */ `
-- Existing plan attachments remain owned by plans; this only adds their
-- discoverability record after registry migration 036 has run.
INSERT INTO document_registry_entries
  (source_kind, source_id, classification, confidentiality, related_record_type, related_record_id)
SELECT 'plan_attachment', pa.id, 'Plans & Workplans', 'internal', 'plan', pa.plan_id
FROM plan_attachments pa
ON CONFLICT (source_kind, source_id) DO NOTHING;
`,
  },
  {
    name: "038_document_registry_titles",
    sql: /* sql */ `
ALTER TABLE document_registry_entries ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE document_registry_entries ADD COLUMN IF NOT EXISTS description TEXT;
`,
  },
  {
    name: "039_audit_log_workspace_index",
    sql: /* sql */ `
-- Supports deterministic bounded Audit Log pages without scanning history.
CREATE INDEX IF NOT EXISTS audit_log_timestamp_id_idx
  ON audit_log (timestamp DESC, id DESC);
`,
  },
  {
    name: "040_offline_sync_idempotency_claims",
    sql: /* sql */ `
-- Atomic offline replay claims. Existing historic rows remain replayable but
-- cannot be attributed retrospectively, so new rows carry actor + request data.
ALTER TABLE idempotency_log ADD COLUMN IF NOT EXISTS actor_id INTEGER;
ALTER TABLE idempotency_log ADD COLUMN IF NOT EXISTS request_hash TEXT;
ALTER TABLE idempotency_log ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE idempotency_log ALTER COLUMN status_code DROP NOT NULL;
UPDATE idempotency_log
   SET state = 'completed'
 WHERE state IS NULL AND status_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idempotency_log_actor_client_idx
  ON idempotency_log (actor_id, client_id);
`,
  },
  {
    name: "041_offline_sync_preserve_in_progress_claims",
    sql: /* sql */ `
-- An in-progress replay may have committed just before a process failure.
-- Preserve it rather than ever allowing its operation ID to run again.
UPDATE idempotency_log
   SET expires_at = 'infinity'
 WHERE state = 'in_progress';
`,
  },
  {
    name: "042_attachment_reconciliation",
    sql: /* sql */ `
-- Controlled attachment/resource reconciliation.
-- Availability is separate from the source lifecycle: an item may remain
-- active while its bytes are unavailable pending an owner decision.
ALTER TABLE report_attachments
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;
ALTER TABLE project_documents
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;
ALTER TABLE plan_attachments
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;
ALTER TABLE program_resources
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;
ALTER TABLE drive_files
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;
ALTER TABLE voice_notes
  ADD COLUMN IF NOT EXISTS availability_status TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS unavailable_reason TEXT;

DO $$
DECLARE table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'report_attachments', 'project_documents', 'plan_attachments',
    'program_resources', 'drive_files', 'voice_notes'
  ] LOOP
    EXECUTE format(
      'ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',
      table_name, table_name || '_availability_status_check'
    );
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I CHECK (availability_status IN (''available'', ''unavailable''))',
      table_name, table_name || '_availability_status_check'
    );
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS attachment_reconciliation_entries (
  id                    SERIAL PRIMARY KEY,
  source_kind           TEXT NOT NULL,
  metadata_id           TEXT NOT NULL,
  source_id             INTEGER NOT NULL,
  parent_type           TEXT,
  parent_id             INTEGER,
  file_name             TEXT,
  content_type          TEXT,
  file_size             BIGINT,
  uploaded_by_id        INTEGER,
  uploaded_at           TIMESTAMPTZ,
  lifecycle_state       TEXT,
  provider_reference    TEXT,
  parent_exists         BOOLEAN NOT NULL,
  parent_removed        BOOLEAN NOT NULL DEFAULT FALSE,
  object_resolution     TEXT NOT NULL,
  object_evidence       JSONB NOT NULL DEFAULT '{}'::jsonb,
  classification        TEXT NOT NULL,
  reason                TEXT NOT NULL,
  classified_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disposition            TEXT,
  disposition_reason     TEXT,
  disposition_by         INTEGER,
  disposition_at         TIMESTAMPTZ,
  before_metadata       JSONB,
  after_metadata        JSONB,
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT attachment_reconciliation_source_unique UNIQUE (source_kind, metadata_id),
  CONSTRAINT attachment_reconciliation_classification_check CHECK (
    classification IN (
      'OBJECT_RECOVERABLE', 'PROVIDER_MAPPING_STALE', 'METADATA_ORPHANED',
      'PARENT_REMOVED', 'OBJECT_CONFIRMED_MISSING', 'OWNER_DECISION_REQUIRED'
    )
  ),
  CONSTRAINT attachment_reconciliation_disposition_check CHECK (
    disposition IS NULL OR disposition IN ('KEEP_UNAVAILABLE', 'ARCHIVE_METADATA', 'REMOVE_METADATA', 'RECOVERED')
  )
);

CREATE INDEX IF NOT EXISTS attachment_reconciliation_classification_idx
  ON attachment_reconciliation_entries (classification, classified_at DESC);
CREATE INDEX IF NOT EXISTS attachment_reconciliation_parent_idx
  ON attachment_reconciliation_entries (parent_type, parent_id);
`,
  },
  {
    name: "043_canonical_attachments",
    sql: /* sql */ `
-- Canonical provider-neutral attachment contract for Plans and Risks.
CREATE TABLE IF NOT EXISTS attachments (
  id SERIAL PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('plan', 'risk')),
  parent_id INTEGER NOT NULL,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL CHECK (size >= 0),
  object_path TEXT NOT NULL,
  provider TEXT NOT NULL,
  upload_operation_id TEXT NOT NULL UNIQUE,
  uploaded_by_id INTEGER NOT NULL,
  version_number INTEGER NOT NULL DEFAULT 1 CHECK (version_number > 0),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'deleted')),
  availability_status TEXT NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'unavailable')),
  unavailable_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachments_parent
  ON attachments (parent_type, parent_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attachments_object_path
  ON attachments (object_path);

CREATE TABLE IF NOT EXISTS attachment_upload_operations (
  operation_id TEXT PRIMARY KEY,
  parent_type TEXT NOT NULL CHECK (parent_type IN ('plan', 'risk')),
  parent_id INTEGER NOT NULL,
  replacement_attachment_id INTEGER,
  user_id INTEGER NOT NULL,
  object_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  declared_size INTEGER NOT NULL CHECK (declared_size > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'finalised', 'failed')),
  attachment_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finalised_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_attachment_upload_operations_parent
  ON attachment_upload_operations (parent_type, parent_id);

-- Polymorphic parent tables cannot use a normal FK. These triggers remove
-- canonical metadata when a parent is permanently deleted; storage cleanup is
-- intentionally left to reconciliation tooling because triggers cannot safely
-- call a provider.
CREATE OR REPLACE FUNCTION delete_canonical_attachments_for_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM attachment_upload_operations
   WHERE parent_type = TG_ARGV[0] AND parent_id = OLD.id;
  DELETE FROM attachments
   WHERE parent_type = TG_ARGV[0] AND parent_id = OLD.id;
  RETURN OLD;
END;
$$;
DROP TRIGGER IF EXISTS plans_delete_canonical_attachments ON plans;
CREATE TRIGGER plans_delete_canonical_attachments
  AFTER DELETE ON plans FOR EACH ROW
  EXECUTE FUNCTION delete_canonical_attachments_for_parent('plan');
DROP TRIGGER IF EXISTS risks_delete_canonical_attachments ON risks;
CREATE TRIGGER risks_delete_canonical_attachments
  AFTER DELETE ON risks FOR EACH ROW
  EXECUTE FUNCTION delete_canonical_attachments_for_parent('risk');
`,
  },
  {
    name: "044_canonical_attachment_promotion_path",
    sql: /* sql */ `
-- A promotion path is recorded before an external provider copy begins. This
-- gives parent deletion and reconciliation a durable cleanup identity when a
-- process stops after provider promotion but before metadata finalisation.
ALTER TABLE attachment_upload_operations
  ADD COLUMN IF NOT EXISTS final_object_path TEXT;
CREATE INDEX IF NOT EXISTS idx_attachment_upload_operations_final_object_path
  ON attachment_upload_operations (final_object_path)
  WHERE final_object_path IS NOT NULL;
`,
  },
  {
    name: "045_project_risk_attachment_cleanup_order",
    sql: /* sql */ `
-- The Project permanent-delete transaction deliberately deletes Risks first
-- and then purges all polymorphic children under the same transaction. Keep
-- canonical Risk metadata available to that established cascade so it can
-- collect provider identities for post-commit cleanup before removing them.
DROP TRIGGER IF EXISTS risks_delete_canonical_attachments ON risks;
`,
  },
  {
    name: "046_historical_storage_import_boundary",
    sql: /* sql */ `
-- Historical provider references are evidence, never runtime file authority.
CREATE TABLE IF NOT EXISTS legacy_storage_records (
  id BIGINT PRIMARY KEY,
  provider_key TEXT,
  file_name TEXT NOT NULL,
  content_type TEXT,
  file_size BIGINT,
  module TEXT,
  record_id INTEGER,
  project_id INTEGER,
  state_id INTEGER,
  sector TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  availability_status TEXT NOT NULL DEFAULT 'unavailable',
  source_created_at TIMESTAMPTZ,
  imported_at TIMESTAMPTZ,
  canonical_object_path TEXT,
  reconciliation_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (availability_status IN ('available', 'unavailable'))
);

DO $$
BEGIN
  IF to_regclass('public.drive_files') IS NOT NULL THEN
    INSERT INTO legacy_storage_records (
      id, provider_key, file_name, content_type, file_size, module, record_id,
      project_id, state_id, sector, status, availability_status, source_created_at
    )
    SELECT id, drive_file_id, name, mime_type, size, module, record_id,
           project_id, state_id, sector, status,
           COALESCE(availability_status, 'unavailable'), created_at
    FROM drive_files
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS historical_storage_import_runs (
  id UUID PRIMARY KEY,
  requested_by INTEGER NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS historical_storage_import_attempts (
  id SERIAL PRIMARY KEY,
  run_id UUID NOT NULL REFERENCES historical_storage_import_runs(id),
  legacy_record_id BIGINT NOT NULL REFERENCES legacy_storage_records(id),
  parent_type TEXT NOT NULL CHECK (parent_type IN ('plan', 'risk')),
  parent_id INTEGER NOT NULL,
  operation_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'imported', 'reconciliation_required', 'failed')),
  source_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  destination_object_path TEXT,
  attachment_id INTEGER REFERENCES attachments(id),
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (legacy_record_id, parent_type, parent_id)
);
CREATE INDEX IF NOT EXISTS historical_storage_import_attempts_status_idx
  ON historical_storage_import_attempts (status, created_at DESC);

-- Active application reads no legacy file reference after this cutover.
ALTER TABLE project_documents DROP COLUMN IF EXISTS drive_file_id;
ALTER TABLE report_attachments DROP COLUMN IF EXISTS drive_file_id;
ALTER TABLE training_videos DROP COLUMN IF EXISTS drive_file_id;
`,
  },
  {
    name: "047_historical_storage_import_lease",
    sql: /* sql */ `
-- A stopped worker must never leave an administrator import permanently
-- in-progress. The owning request renews this bounded lease while contacting
-- the historical provider and must still hold it at finalisation.
ALTER TABLE historical_storage_import_attempts
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ;
UPDATE historical_storage_import_attempts
  SET lease_expires_at = created_at + INTERVAL '15 minutes'
  WHERE status = 'running' AND lease_expires_at IS NULL;
CREATE INDEX IF NOT EXISTS historical_storage_import_attempts_lease_idx
  ON historical_storage_import_attempts (status, lease_expires_at)
  WHERE status = 'running';
`,
  },
  {
    name: "048_attachment_upload_expiry_cleanup",
    sql: /* sql */ `
-- Expired upload operations are failed before provider cleanup begins. The
-- cleanup lifecycle is separate so a provider failure remains retryable and
-- never changes the visibility or status of a finalised attachment.
ALTER TABLE attachment_upload_operations
  ADD COLUMN IF NOT EXISTS cleanup_status TEXT NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS cleanup_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cleanup_error TEXT,
  ADD COLUMN IF NOT EXISTS cleanup_completed_at TIMESTAMPTZ;

ALTER TABLE attachment_upload_operations
  DROP CONSTRAINT IF EXISTS attachment_upload_operations_cleanup_status_check;
ALTER TABLE attachment_upload_operations
  ADD CONSTRAINT attachment_upload_operations_cleanup_status_check
  CHECK (cleanup_status IN ('not_started', 'pending', 'failed', 'completed'));

CREATE INDEX IF NOT EXISTS idx_attachment_upload_operations_expiry_cleanup
  ON attachment_upload_operations (status, cleanup_status, expires_at)
  WHERE status = 'pending'
     OR (status = 'failed' AND cleanup_status IN ('pending', 'failed'));
`,
  },
  {
    name: "049_attachment_upload_cleanup_outbox",
    sql: /* sql */ `
-- Cleanup work is independent from the polymorphic parent lifecycle. A parent
-- delete may remove the source upload-operation row after this job is created,
-- but must never erase a provider cleanup failure or retry record.
CREATE TABLE IF NOT EXISTS attachment_upload_cleanup_jobs (
  operation_id TEXT PRIMARY KEY,
  object_path TEXT NOT NULL,
  final_object_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'failed', 'completed')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error TEXT,
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_attachment_upload_cleanup_jobs_ready
  ON attachment_upload_cleanup_jobs (status, lease_expires_at, created_at)
  WHERE status IN ('pending', 'in_progress', 'failed');

-- Preserve any failed/pending cleanup work recorded by the preceding migration
-- before this outbox existed.
INSERT INTO attachment_upload_cleanup_jobs
  (operation_id, object_path, final_object_path, status, attempt_count, last_error)
SELECT operation_id, object_path, final_object_path, 'pending',
       cleanup_attempts, cleanup_error
FROM attachment_upload_operations
WHERE status = 'failed'
  AND cleanup_status <> 'completed'
ON CONFLICT (operation_id) DO NOTHING;
`,
  },
  {
    name: "050_attachment_upload_cleanup_parent_delete",
    sql: /* sql */ `
-- The trigger is the fallback for any direct Plan parent deletion. Application
-- delete flows enqueue first as well, because they explicitly remove operations
-- before the parent trigger can see them.
CREATE OR REPLACE FUNCTION delete_canonical_attachments_for_parent()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO attachment_upload_cleanup_jobs
    (operation_id, object_path, final_object_path)
  SELECT operation_id, object_path, final_object_path
  FROM attachment_upload_operations
  WHERE parent_type = TG_ARGV[0]
    AND parent_id = OLD.id
    AND status <> 'finalised'
  ON CONFLICT (operation_id) DO NOTHING;

  DELETE FROM attachment_upload_operations
   WHERE parent_type = TG_ARGV[0] AND parent_id = OLD.id;
  DELETE FROM attachments
   WHERE parent_type = TG_ARGV[0] AND parent_id = OLD.id;
  RETURN OLD;
END;
$$;
`,
  },
  {
    name: "051_attachment_upload_cleanup_legacy_failed_backfill",
    sql: /* sql */ `
-- 049 originally excluded legacy rows whose new cleanup column had the
-- default 'not_started' value. Preserve those pre-existing failed uploads as
-- retryable work on databases that already applied 049.
INSERT INTO attachment_upload_cleanup_jobs
  (operation_id, object_path, final_object_path, status, attempt_count, last_error)
SELECT operation_id, object_path, final_object_path, 'pending',
       cleanup_attempts, cleanup_error
FROM attachment_upload_operations
WHERE status = 'failed'
  AND cleanup_status <> 'completed'
ON CONFLICT (operation_id) DO NOTHING;
`,
  },
  {
    name: "052_runtime_schema_authority",
    sql: /* sql */ `
-- Runtime-owned schema setup previously ran when Manual and Training route
-- modules were imported. It is now part of the tracked release history.
ALTER TABLE manual_chapters
  ADD COLUMN IF NOT EXISTS view_count INTEGER DEFAULT 0;

CREATE TABLE IF NOT EXISTS manual_faqs (
  id SERIAL PRIMARY KEY,
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'General',
  "order" INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'published',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS manual_feedback (
  id SERIAL PRIMARY KEY,
  chapter_slug TEXT NOT NULL,
  user_id INTEGER,
  helpful BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE training_videos
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS uploaded_by_id INTEGER;

CREATE TABLE IF NOT EXISTS training_completions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  training_video_id INTEGER NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_watched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  watch_percent INTEGER NOT NULL DEFAULT 0,
  completion_status TEXT NOT NULL DEFAULT 'not_started',
  total_watch_seconds INTEGER NOT NULL DEFAULT 0,
  last_position_seconds INTEGER NOT NULL DEFAULT 0,
  certificate_issued BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE(user_id, training_video_id)
);

CREATE TABLE IF NOT EXISTS training_certificates (
  id SERIAL PRIMARY KEY,
  certificate_id TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  training_video_id INTEGER NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by_id INTEGER,
  reissued_at TIMESTAMPTZ,
  reissued_by_id INTEGER,
  is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE SEQUENCE IF NOT EXISTS training_cert_seq;
`,
  },
  {
    name: "053_manual_locale_content",
    sql: /* sql */ `
-- Parallel, reviewable Manual translations.  Canonical English rows remain
-- in the existing tables so IDs, slugs, permissions, and editorial history
-- are unchanged.
CREATE TABLE IF NOT EXISTS manual_chapter_localizations (
  id SERIAL PRIMARY KEY,
  chapter_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ar')),
  title TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_chapter_localizations_chapter_locale_unique UNIQUE (chapter_id, locale)
);
CREATE TABLE IF NOT EXISTS manual_section_localizations (
  id SERIAL PRIMARY KEY,
  section_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ar')),
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_section_localizations_section_locale_unique UNIQUE (section_id, locale)
);
CREATE TABLE IF NOT EXISTS manual_sop_localizations (
  id SERIAL PRIMARY KEY,
  sop_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ar')),
  process_name TEXT NOT NULL,
  purpose TEXT,
  responsible_role TEXT,
  steps JSONB,
  required_inputs TEXT,
  approval_flow TEXT,
  outputs TEXT,
  timeline TEXT,
  related_module TEXT,
  notifications TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_sop_localizations_sop_locale_unique UNIQUE (sop_id, locale)
);
CREATE TABLE IF NOT EXISTS manual_faq_localizations (
  id SERIAL PRIMARY KEY,
  faq_id INTEGER NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('en', 'ar')),
  question TEXT NOT NULL,
  answer TEXT NOT NULL,
  category TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT manual_faq_localizations_faq_locale_unique UNIQUE (faq_id, locale)
);
CREATE INDEX IF NOT EXISTS idx_manual_chapter_localizations_locale
  ON manual_chapter_localizations (locale);
CREATE INDEX IF NOT EXISTS idx_manual_section_localizations_locale
  ON manual_section_localizations (locale);
CREATE INDEX IF NOT EXISTS idx_manual_sop_localizations_locale
  ON manual_sop_localizations (locale);
CREATE INDEX IF NOT EXISTS idx_manual_faq_localizations_locale
  ON manual_faq_localizations (locale);
`,
  },
  {
    name: "054_manual_arabic_draft_lifecycle",
    sql: /* sql */ `
-- Machine-generated Arabic is durable editorial draft content, never a
-- request-time fallback. A human editor must explicitly review it.
ALTER TABLE manual_chapter_localizations
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS source_checksum TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER;
ALTER TABLE manual_section_localizations
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS source_checksum TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER;
ALTER TABLE manual_sop_localizations
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS source_checksum TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER;
ALTER TABLE manual_faq_localizations
  ADD COLUMN IF NOT EXISTS translation_status TEXT NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS source_checksum TEXT,
  ADD COLUMN IF NOT EXISTS source_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by_id INTEGER;
-- Only legacy placeholder rows are reclassified as machine drafts. Existing
-- editorial rows are retained exactly as authored.
UPDATE manual_section_localizations
   SET translation_status = 'draft_machine_generated'
 WHERE locale = 'ar' AND content LIKE 'إرشادات %';
UPDATE manual_sop_localizations
   SET translation_status = 'draft_machine_generated'
 WHERE locale = 'ar' AND (purpose LIKE 'إرشادات %' OR process_name LIKE 'إرشادات %');
UPDATE manual_faq_localizations
   SET translation_status = 'draft_machine_generated'
 WHERE locale = 'ar' AND (question LIKE 'إرشادات %' OR answer LIKE 'إرشادات %');
UPDATE manual_chapter_localizations
   SET translation_status = 'draft_machine_generated'
 WHERE locale = 'ar' AND description LIKE 'دليل عملي%';
`,
  },
  {
    name: "050_sudan_state_master_data",
    sql: /* sql */ `
-- Canonical Sudan State master data. This migration is additive and retains
-- every existing numeric ID and relationship. Existing states were operational
-- before lifecycle status existed, so they are backfilled as active; only an
-- existing non-blank office address is accepted as evidence of office presence.
ALTER TABLE states
  ADD COLUMN IF NOT EXISTS name_ar TEXT,
  ADD COLUMN IF NOT EXISTS operational_status TEXT NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS office_status TEXT NOT NULL DEFAULT 'unknown';

UPDATE states
   SET office_status = 'present'
 WHERE office_status = 'unknown'
   AND NULLIF(BTRIM(office_address), '') IS NOT NULL;

ALTER TABLE states DROP CONSTRAINT IF EXISTS states_operational_status_check;
ALTER TABLE states ADD CONSTRAINT states_operational_status_check
  CHECK (operational_status IN ('active', 'inactive'));
ALTER TABLE states DROP CONSTRAINT IF EXISTS states_office_status_check;
ALTER TABLE states ADD CONSTRAINT states_office_status_check
  CHECK (office_status IN ('present', 'absent', 'unknown'));

-- A duplicate historical match is not safe to merge automatically because that
-- would invalidate provenance. Stop loudly instead of guessing which ID wins.
DO $$
DECLARE duplicate_target TEXT;
BEGIN
  SELECT canonical_name INTO duplicate_target
  FROM (
    SELECT canonical_name, COUNT(*) AS n
    FROM (
      SELECT 'Khartoum' AS canonical_name, id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) IN ('khartoum')
      UNION ALL SELECT 'Gezira', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) IN ('gezira', 'al jazirah', 'al jazeera', 'al jazira')
      UNION ALL SELECT 'Gedaref', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) IN ('gedaref', 'gedarif', 'al qadarif')
      UNION ALL SELECT 'Northern', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) IN ('northern', 'northern state')
      UNION ALL SELECT 'White Nile', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'white nile'
      UNION ALL SELECT 'Blue Nile', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'blue nile'
      UNION ALL SELECT 'Sennar', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'sennar'
      UNION ALL SELECT 'Kassala', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'kassala'
      UNION ALL SELECT 'Red Sea', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'red sea'
      UNION ALL SELECT 'River Nile', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'river nile'
      UNION ALL SELECT 'North Kordofan', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'north kordofan'
      UNION ALL SELECT 'South Kordofan', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'south kordofan'
      UNION ALL SELECT 'West Kordofan', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'west kordofan'
      UNION ALL SELECT 'North Darfur', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'north darfur'
      UNION ALL SELECT 'South Darfur', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'south darfur'
      UNION ALL SELECT 'East Darfur', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'east darfur'
      UNION ALL SELECT 'Central Darfur', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'central darfur'
      UNION ALL SELECT 'West Darfur', id FROM states WHERE lower(regexp_replace(BTRIM(name), '\\s+', ' ', 'g')) = 'west darfur'
    ) matches
    GROUP BY canonical_name
  ) duplicate_matches
  WHERE n > 1
  LIMIT 1;
  IF duplicate_target IS NOT NULL THEN
    RAISE EXCEPTION 'State master-data reconciliation needs review: multiple historical rows match %', duplicate_target;
  END IF;
END $$;

WITH canonical(code, name, name_ar, aliases) AS (
  VALUES
    ('KRT','Khartoum','الخرطوم',ARRAY['khartoum']),
    ('GZR','Gezira','الجزيرة',ARRAY['gezira','al jazirah','al jazeera','al jazira']),
    ('WNL','White Nile','النيل الأبيض',ARRAY['white nile']),
    ('BNL','Blue Nile','النيل الأزرق',ARRAY['blue nile']),
    ('SNR','Sennar','سنار',ARRAY['sennar']),
    ('GDR','Gedaref','القضارف',ARRAY['gedaref','gedarif','al qadarif']),
    ('KSL','Kassala','كسلا',ARRAY['kassala']),
    ('RDS','Red Sea','البحر الأحمر',ARRAY['red sea']),
    ('RVN','River Nile','نهر النيل',ARRAY['river nile']),
    ('NOR','Northern','الشمالية',ARRAY['northern','northern state']),
    ('NKR','North Kordofan','شمال كردفان',ARRAY['north kordofan']),
    ('SKR','South Kordofan','جنوب كردفان',ARRAY['south kordofan']),
    ('WKR','West Kordofan','غرب كردفان',ARRAY['west kordofan']),
    ('NDF','North Darfur','شمال دارفور',ARRAY['north darfur']),
    ('SDF','South Darfur','جنوب دارفور',ARRAY['south darfur']),
    ('EDF','East Darfur','شرق دارفور',ARRAY['east darfur']),
    ('CDF','Central Darfur','وسط دارفور',ARRAY['central darfur']),
    ('WDF','West Darfur','غرب دارفور',ARRAY['west darfur'])
)
UPDATE states s
   SET name = c.name, code = c.code, name_ar = c.name_ar
  FROM canonical c
 WHERE lower(regexp_replace(BTRIM(s.name), '\\s+', ' ', 'g')) = ANY(c.aliases);

WITH canonical(code, name, name_ar) AS (
  VALUES
    ('KRT','Khartoum','الخرطوم'),('GZR','Gezira','الجزيرة'),('WNL','White Nile','النيل الأبيض'),
    ('BNL','Blue Nile','النيل الأزرق'),('SNR','Sennar','سنار'),('GDR','Gedaref','القضارف'),
    ('KSL','Kassala','كسلا'),('RDS','Red Sea','البحر الأحمر'),('RVN','River Nile','نهر النيل'),
    ('NOR','Northern','الشمالية'),('NKR','North Kordofan','شمال كردفان'),('SKR','South Kordofan','جنوب كردفان'),
    ('WKR','West Kordofan','غرب كردفان'),('NDF','North Darfur','شمال دارفور'),('SDF','South Darfur','جنوب دارفور'),
    ('EDF','East Darfur','شرق دارفور'),('CDF','Central Darfur','وسط دارفور'),('WDF','West Darfur','غرب دارفور')
)
INSERT INTO states (name, name_ar, code, operational_status, office_status)
SELECT name, name_ar, code, 'inactive', 'unknown'
  FROM canonical c
 WHERE NOT EXISTS (
   SELECT 1 FROM states s WHERE s.code = c.code OR s.name = c.name
 );

UPDATE states SET name_ar = name WHERE name_ar IS NULL OR BTRIM(name_ar) = '';
ALTER TABLE states ALTER COLUMN name_ar SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS states_canonical_code_unique_idx ON states (code);
`,
  },
  {
    name: "051_sudan_state_full_labels",
    sql: /* sql */ `
-- Canonical user-facing State labels. This forward-only migration updates
-- existing rows by stable code or recognised historical English aliases and
-- inserts only missing canonical records. It never changes numeric IDs or
-- relationships and is safe to rerun.
WITH canonical(code, name, name_ar, aliases) AS (
  VALUES
    ('KRT','Khartoum State','ولاية الخرطوم',ARRAY['khartoum','khartoum state']),
    ('GZR','Gezira State','ولاية الجزيرة',ARRAY['gezira','gezira state','al jazirah','al jazeera','al jazira']),
    ('WNL','White Nile State','ولاية النيل الأبيض',ARRAY['white nile','white nile state']),
    ('BNL','Blue Nile State','ولاية النيل الأزرق',ARRAY['blue nile','blue nile state']),
    ('SNR','Sennar State','ولاية سنار',ARRAY['sennar','sennar state']),
    ('GDR','Gedaref State','ولاية القضارف',ARRAY['gedaref','gedaref state','gedarif','al qadarif']),
    ('KSL','Kassala State','ولاية كسلا',ARRAY['kassala','kassala state']),
    ('RDS','Red Sea State','ولاية البحر الأحمر',ARRAY['red sea','red sea state']),
    ('RVN','River Nile State','ولاية نهر النيل',ARRAY['river nile','river nile state']),
    ('NOR','Northern State','الولاية الشمالية',ARRAY['northern','northern state']),
    ('NKR','North Kordofan State','ولاية شمال كردفان',ARRAY['north kordofan','north kordofan state']),
    ('SKR','South Kordofan State','ولاية جنوب كردفان',ARRAY['south kordofan','south kordofan state']),
    ('WKR','West Kordofan State','ولاية غرب كردفان',ARRAY['west kordofan','west kordofan state']),
    ('NDF','North Darfur State','ولاية شمال دارفور',ARRAY['north darfur','north darfur state']),
    ('SDF','South Darfur State','ولاية جنوب دارفور',ARRAY['south darfur','south darfur state']),
    ('EDF','East Darfur State','ولاية شرق دارفور',ARRAY['east darfur','east darfur state']),
    ('CDF','Central Darfur State','ولاية وسط دارفور',ARRAY['central darfur','central darfur state']),
    ('WDF','West Darfur State','ولاية غرب دارفور',ARRAY['west darfur','west darfur state'])
)
UPDATE states s
   SET name = c.name, name_ar = c.name_ar
  FROM canonical c
 WHERE s.code = c.code
    OR lower(regexp_replace(BTRIM(s.name), '\\s+', ' ', 'g')) = ANY(c.aliases);

WITH canonical(code, name, name_ar) AS (
  VALUES
    ('KRT','Khartoum State','ولاية الخرطوم'),('GZR','Gezira State','ولاية الجزيرة'),('WNL','White Nile State','ولاية النيل الأبيض'),
    ('BNL','Blue Nile State','ولاية النيل الأزرق'),('SNR','Sennar State','ولاية سنار'),('GDR','Gedaref State','ولاية القضارف'),
    ('KSL','Kassala State','ولاية كسلا'),('RDS','Red Sea State','ولاية البحر الأحمر'),('RVN','River Nile State','ولاية نهر النيل'),
    ('NOR','Northern State','الولاية الشمالية'),('NKR','North Kordofan State','ولاية شمال كردفان'),('SKR','South Kordofan State','ولاية جنوب كردفان'),
    ('WKR','West Kordofan State','ولاية غرب كردفان'),('NDF','North Darfur State','ولاية شمال دارفور'),('SDF','South Darfur State','ولاية جنوب دارفور'),
    ('EDF','East Darfur State','ولاية شرق دارفور'),('CDF','Central Darfur State','ولاية وسط دارفور'),('WDF','West Darfur State','ولاية غرب دارفور')
)
INSERT INTO states (name, name_ar, code, operational_status, office_status)
SELECT c.name, c.name_ar, c.code, 'inactive', 'unknown'
  FROM canonical c
 WHERE NOT EXISTS (SELECT 1 FROM states s WHERE s.code = c.code OR s.name = c.name);
`,
  },
  {
    name: "055_revocable_authenticated_sessions",
    sql: /* sql */ `
-- Browser cookies carry an opaque session token; this table is the canonical
-- revocation authority for HTTP and Socket.IO authentication.
CREATE TABLE IF NOT EXISTS auth_sessions (
  id         UUID PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_active_token
  ON auth_sessions (token_hash, expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
  ON auth_sessions (user_id, expires_at DESC);
`,
  },
  {
    // This intentionally precedes the State-FK migration in manifest order.
    // The shared numeric prefix is valid: tracked migrations are applied in
    // definition order, while full names are their immutable identities.
    name: "056_project_state_link_evidence_prearchive",
    sql: /* sql */ `
-- Preserve the raw evidence for the pathological legacy case where a
-- project_states row refers to both a missing project and a missing State.
-- This must run before 056_project_state_link_integrity, whose State cleanup
-- deliberately removes every unresolved operational relationship.
CREATE TABLE IF NOT EXISTS project_state_integrity_reviews (
  id SERIAL PRIMARY KEY,
  legacy_project_state_id INTEGER NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  project_code TEXT NOT NULL,
  project_title TEXT NOT NULL,
  unresolved_state_id INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'manual_correction_required'
    CHECK (review_status IN ('manual_correction_required', 'resolved', 'retired')),
  evidence TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_state_id INTEGER REFERENCES states(id) ON DELETE RESTRICT,
  resolved_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);

INSERT INTO project_state_integrity_reviews (
  legacy_project_state_id, project_id, project_code, project_title,
  unresolved_state_id, review_status, evidence
)
SELECT
  ps.id,
  ps.project_id,
  '[missing project #' || ps.project_id || ']',
  '[project record unavailable]',
  ps.state_id,
  'manual_correction_required',
  'Legacy project-State link referenced neither a project record nor a canonical State. Raw IDs were retained; authorised data review is required.'
FROM project_states ps
LEFT JOIN projects p ON p.id = ps.project_id
LEFT JOIN states s ON s.id = ps.state_id
WHERE p.id IS NULL
  AND s.id IS NULL
ON CONFLICT (legacy_project_state_id) DO NOTHING;
`,
  },
  {
    name: "056_project_state_link_integrity",
    sql: /* sql */ `
-- A historical project_states table had no foreign keys. Some legacy/UAT rows
-- therefore survived after their State master record was retired. Never infer
-- a replacement State from an obsolete numeric ID: preserve the source link
-- and its project identity for an authorised reviewer before retiring it.
CREATE TABLE IF NOT EXISTS project_state_integrity_reviews (
  id SERIAL PRIMARY KEY,
  legacy_project_state_id INTEGER NOT NULL UNIQUE,
  project_id INTEGER NOT NULL,
  project_code TEXT NOT NULL,
  project_title TEXT NOT NULL,
  unresolved_state_id INTEGER NOT NULL,
  review_status TEXT NOT NULL DEFAULT 'manual_correction_required'
    CHECK (review_status IN ('manual_correction_required', 'resolved', 'retired')),
  evidence TEXT NOT NULL,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_state_id INTEGER REFERENCES states(id) ON DELETE RESTRICT,
  resolved_by_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_project_state_integrity_reviews_open
  ON project_state_integrity_reviews (review_status, detected_at)
  WHERE review_status = 'manual_correction_required';

-- Capture every currently unresolved link before deletion. The source link ID
-- and project snapshots survive even if a project is later permanently removed.
INSERT INTO project_state_integrity_reviews (
  legacy_project_state_id, project_id, project_code, project_title,
  unresolved_state_id, review_status, evidence
)
SELECT
  ps.id, p.id, p.code, p.title, ps.state_id,
  'manual_correction_required',
  'Legacy project-State link referenced no canonical State. No replacement was inferred; authorised data review is required.'
FROM project_states ps
JOIN projects p ON p.id = ps.project_id
LEFT JOIN states s ON s.id = ps.state_id
WHERE s.id IS NULL
ON CONFLICT (legacy_project_state_id) DO NOTHING;

-- Surface the same decision on the affected project without replacing any
-- existing migration-review note. This is intentionally specific to orphaned
-- location links and does not assign a State.
UPDATE projects p
   SET migration_review_notes = CONCAT_WS(
         E'\\n',
         NULLIF(p.migration_review_notes, ''),
         'Project State link retired because its canonical State record is unavailable; requires authorised State review.'
       )
 WHERE EXISTS (
   SELECT 1
   FROM project_states ps
   LEFT JOIN states s ON s.id = ps.state_id
   WHERE ps.project_id = p.id
     AND s.id IS NULL
 )
   AND COALESCE(p.migration_review_notes, '') NOT LIKE '%Project State link retired because its canonical State record is unavailable%';

-- The invalid relationship is not operationally readable after its immutable
-- review record has been written. This does not remap or otherwise alter any
-- resolved project-State assignment.
DELETE FROM project_states ps
WHERE NOT EXISTS (
  SELECT 1 FROM states s WHERE s.id = ps.state_id
);

-- Defence in depth: all future project-State assignments must resolve through
-- the canonical registry. RESTRICT prevents State-master deletion from silently
-- recreating an unresolved operational link.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'project_states'
      AND c.conname = 'project_states_state_fk'
  ) THEN
    ALTER TABLE project_states
      ADD CONSTRAINT project_states_state_fk
      FOREIGN KEY (state_id) REFERENCES states(id) ON DELETE RESTRICT NOT VALID;
  END IF;
END $$;

ALTER TABLE project_states VALIDATE CONSTRAINT project_states_state_fk;
`,
  },
];

// ── Runner ────────────────────────────────────────────────────────────────────

const MIGRATION_ADVISORY_LOCK_KEY = "cafa-pmis:tracked-schema-migrations";

function migrationChecksum(migration: Migration): string {
  return createHash("sha256")
    .update(`${migration.name}\n${migration.sql}`)
    .digest("hex");
}

/**
 * The manifest is application source, so reject ambiguous definitions before
 * touching PostgreSQL. Full migration names are the identity; numeric prefixes
 * are deliberately allowed to repeat for historical compatibility.
 */
export function assertMigrationManifest(): void {
  const seen = new Set<string>();
  for (const migration of MIGRATIONS) {
    if (!/^\d{3}_[a-z0-9_]+(?:\.sql)?$/.test(migration.name)) {
      throw new Error(`Invalid tracked migration name: ${migration.name}`);
    }
    if (!migration.sql.trim()) {
      throw new Error(`Tracked migration has no SQL: ${migration.name}`);
    }
    if (seen.has(migration.name)) {
      throw new Error(`Duplicate tracked migration name: ${migration.name}`);
    }
    seen.add(migration.name);
  }
}

type MigrationHistoryRow = {
  filename: string;
  checksum: string | null;
};

async function ensureMigrationHistoryTable(
  client: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
): Promise<void> {
  // This is the runner's own metadata bootstrap. Application schema changes
  // continue to be owned exclusively by MIGRATIONS below.
  await client.query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      id         SERIAL PRIMARY KEY,
      filename   TEXT NOT NULL UNIQUE,
      checksum   TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(
    `ALTER TABLE public.schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT`,
  );
}

/**
 * Confirms that the deployed database has the exact tracked migration head.
 * This deliberately does not run migrations: production release jobs own
 * mutation, while API instances only verify readiness before accepting traffic.
 */
export async function verifyRequiredSchema(): Promise<void> {
  assertMigrationManifest();
  const client = await pool.connect();
  try {
    const result = await client.query<MigrationHistoryRow>(
      `SELECT filename, checksum FROM public.schema_migrations`,
    );
    const history = new Map(result.rows.map((row) => [row.filename, row.checksum]));
    for (const migration of MIGRATIONS) {
      const checksum = history.get(migration.name);
      if (checksum !== migrationChecksum(migration)) {
        throw new Error(`Required tracked migration is absent or has unexpected history: ${migration.name}`);
      }
    }
  } finally {
    client.release();
  }
}

/**
 * Runs all pending migrations in definition order.
 * Throws on the first failure — the caller should let the process die.
 */
export async function runMigrations(): Promise<void> {
  assertMigrationManifest();
  const client = await pool.connect();
  let lockAcquired = false;
  try {
    logger.info("Waiting for tracked migration authority");
    await client.query(`SELECT pg_advisory_lock(hashtextextended($1, 0))`, [
      MIGRATION_ADVISORY_LOCK_KEY,
    ]);
    lockAcquired = true;
    logger.info("Acquired tracked migration authority");
    await ensureMigrationHistoryTable(client);

    for (const migration of MIGRATIONS) {
      const { rows } = await client.query<MigrationHistoryRow>(
        `SELECT 1, filename, checksum FROM public.schema_migrations WHERE filename = $1`,
        [migration.name],
      );
      const existing = rows[0];
      const checksum = migrationChecksum(migration);
      if (existing) {
        // Databases created before checksum tracking are adopted once by the
        // locked runner. Later changes to any applied migration fail closed.
        if (existing.checksum == null) {
          await client.query(
            `UPDATE public.schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL`,
            [migration.name, checksum],
          );
        } else if (existing.checksum !== checksum) {
          throw new Error(`Tracked migration history checksum mismatch: ${migration.name}`);
        }
        logger.debug({ migration: migration.name }, "Migration already applied — skipping");
        continue;
      }

      // Existing installations predate the tracked clean bootstrap. Their
      // application schema is already present, so adopting only the baseline
      // history row avoids destructive recreation while fresh databases run it.
      if (migration.name === "000_initial_schema_baseline") {
        const baseline = await client.query<{ existing: string | null }>(
          `SELECT to_regclass('public.projects') AS existing`,
        );
        if (baseline.rows[0]?.existing) {
          await client.query(
            `INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)`,
            [migration.name, checksum],
          );
          logger.info("Adopted legacy schema into tracked bootstrap history");
          continue;
        }
      }

      logger.info({ migration: migration.name }, "Applying migration…");

      await client.query("BEGIN");
      try {
        await client.query(migration.sql);
        // The immutable pg_dump bootstrap intentionally sets an empty search
        // path. Restore the application's canonical schema before later
        // historical migrations use unqualified relation names.
        await client.query(`SET search_path TO public`);
        await client.query(
          `INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)`,
          [migration.name, checksum],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw err;
      }

      logger.info({ migration: migration.name }, "Migration applied successfully");
    }
  } finally {
    if (lockAcquired) {
      await client
        .query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [
          MIGRATION_ADVISORY_LOCK_KEY,
        ])
        .catch((err) => logger.warn({ err }, "Could not explicitly release migration authority"));
    }
    client.release();
  }
}
