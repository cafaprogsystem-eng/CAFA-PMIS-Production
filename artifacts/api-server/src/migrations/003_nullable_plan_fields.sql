-- Migration 003: Relax NOT NULL on draft Plan fields; nullify remaining Multi-Sector values.
-- Reference copy — runtime execution uses the inlined TypeScript in src/lib/run-migrations.ts.
-- Keep this file in sync with the 003_nullable_plan_fields entry in MIGRATIONS.
--
-- Plans are created as drafts and plan_type/start_date/end_date may legitimately
-- be absent at creation time. The NOT NULL constraints prevented valid draft saves.
--
-- Any plans still carrying sector='Multi-Sector' after migration 002 are ambiguous
-- and already flagged with migration_review_notes; set sector to NULL here so
-- no retired value is returned by the API.

ALTER TABLE plans
  ALTER COLUMN plan_type   DROP NOT NULL,
  ALTER COLUMN start_date  DROP NOT NULL,
  ALTER COLUMN end_date    DROP NOT NULL;

-- Nullify remaining Multi-Sector sector values (already flagged in migration_review_notes).
UPDATE plans
   SET sector = NULL
 WHERE sector = 'Multi-Sector';
