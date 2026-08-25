-- Migration 004: MPCA Sector Correction & Hardening
-- Reference copy — runtime execution uses the inlined TypeScript in src/lib/run-migrations.ts.
-- Keep this file in sync with the 004_mpca_sector_correction entry in MIGRATIONS.
-- Idempotent — safe to run multiple times.

-- ── Allow NULL in sector columns ─────────────────────────────────────────────
-- Projects and indicators need nullable sector to correctly represent
-- records whose Main Sector cannot be determined without human review.
-- A NOT NULL constraint was previously preventing honest representation.

ALTER TABLE projects   ALTER COLUMN sector DROP NOT NULL;
ALTER TABLE indicators ALTER COLUMN sector DROP NOT NULL;

-- ── Remove the provisional Protection assignment from the MPCA project ────────
-- Migration 002 incorrectly guessed "Protection" for a project that was
-- solely classified as MPCA (Assistance Modality, not a Main Sector).
-- There is no authoritative evidence that Protection is the correct sector.
-- Set sector = NULL so it is flagged as unresolved, not falsely attributed.

UPDATE projects
   SET sector                 = NULL,
       migration_review_notes = 'Requires manual sector assignment — MPCA was removed as a Main Sector. Sector is unresolved pending manual review.'
 WHERE assistance_modality = 'Multipurpose Cash Assistance (MPCA)'
   AND migration_review_notes IS NOT NULL
   AND sector = 'Protection';

-- ── Remove false Protection from indicators linked to the MPCA project ────────
-- Indicator I4.1 ("Households receiving MPCA") inherited Protection from
-- migration 002. Its real sector context follows the project sector.
-- Set to NULL — the indicator will be resolved when its project is resolved.

UPDATE indicators
   SET sector      = NULL,
       sub_sectors = '[]'::jsonb
 WHERE project_id IN (
         SELECT id FROM projects
          WHERE assistance_modality = 'Multipurpose Cash Assistance (MPCA)'
            AND sector IS NULL
       )
   AND sector = 'Protection';

-- ── Clear migration_review_notes from deterministically migrated records ──────
-- Projects 3 (Child Protection→Protection), 5 (GBV→Protection),
-- 7 (Livelihoods→FSL) are fully resolved — no further action required.
-- Clearing keeps the column meaningful: NULL = done; non-NULL = requires action.

UPDATE projects
   SET migration_review_notes = NULL
 WHERE migration_review_notes LIKE 'Migrated from legacy sector:%';
