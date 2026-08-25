-- Migration 002: Sector Architecture Unification
-- Reference copy — runtime execution uses the inlined TypeScript in src/lib/run-migrations.ts.
-- Keep this file in sync with the 002_sector_unification entry in MIGRATIONS.
-- Idempotent — safe to run multiple times.

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

-- ── Indicators ────────────────────────────────────────────────────────────────

UPDATE indicators SET sector = 'Protection', sub_sectors = '["Child Protection"]'             WHERE sector = 'Child Protection';
UPDATE indicators SET sector = 'Protection', sub_sectors = '["Gender-Based Violence (GBV)"]'  WHERE sector = 'GBV';
UPDATE indicators SET sector = 'Food Security & Livelihoods', sub_sectors = '["Livelihoods"]' WHERE sector = 'Livelihoods';
UPDATE indicators SET sector = 'Food Security & Livelihoods', sub_sectors = '["Agriculture","Livelihoods"]' WHERE sector = 'Agriculture & Livelihoods';
UPDATE indicators SET sector = 'Shelter & NFI' WHERE sector = 'Shelter / NFI';
UPDATE indicators SET sector = 'Protection'    WHERE sector IN ('MPCA', 'MPCA / Cash Assistance');

-- ── Reports ───────────────────────────────────────────────────────────────────

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

-- ── Conversations ─────────────────────────────────────────────────────────────

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

-- ── Plans ─────────────────────────────────────────────────────────────────────

-- Add review-notes column for Multi-Sector plans that cannot be auto-resolved.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

UPDATE plans SET sector = 'Shelter & NFI' WHERE sector = 'Shelter / NFI';

-- ── Program Resources — with migration-review audit trail ─────────────────────

-- Add migration_review_notes FIRST so flags are set before sector remapping.
ALTER TABLE program_resources
  ADD COLUMN IF NOT EXISTS migration_review_notes TEXT;

UPDATE program_resources SET sector = 'Food Security & Livelihoods' WHERE sector IN ('FSL', 'Agriculture & Livelihoods');
UPDATE program_resources SET sector = 'Shelter & NFI'               WHERE sector IN ('Shelter', 'Shelter / NFI');

-- Flag MPCA/Multi-Sector records for staff review before remapping.
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

UPDATE projects
   SET sectors = (
         SELECT COALESCE(jsonb_agg(DISTINCT mapped ORDER BY mapped), '[]'::jsonb)
           FROM (
                  SELECT CASE el
                    WHEN 'Child Protection'         THEN 'Protection'
                    WHEN 'GBV'                      THEN 'Protection'
                    WHEN 'Livelihoods'               THEN 'Food Security & Livelihoods'
                    WHEN 'Agriculture & Livelihoods' THEN 'Food Security & Livelihoods'
                    WHEN 'Shelter / NFI'             THEN 'Shelter & NFI'
                    WHEN 'MPCA'                     THEN 'Protection'
                    WHEN 'MPCA / Cash Assistance'   THEN 'Protection'
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
         sectors ? 'Child Protection'          OR
         sectors ? 'GBV'                       OR
         sectors ? 'Livelihoods'                OR
         sectors ? 'Agriculture & Livelihoods'  OR
         sectors ? 'Shelter / NFI'              OR
         sectors ? 'MPCA'                      OR
         sectors ? 'MPCA / Cash Assistance'
       );

-- ── Multi-Sector plans — Step 1: resolve where determinable ──────────────────
-- Migrate unambiguous Multi-Sector plans (linked project has exactly 1 canonical sector).

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

-- ── Multi-Sector plans — Step 2: flag ambiguous/unlinked plans for review ────
-- These records still carry sector='Multi-Sector' which will be nullified in
-- migration 003 so no retired value is returned by the API.

UPDATE plans
   SET migration_review_notes = 'Multi-Sector plan — requires manual review and sector reassignment to a canonical Main Sector'
 WHERE sector = 'Multi-Sector'
   AND migration_review_notes IS NULL;
