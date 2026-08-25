-- Migration 057: Preserve legacy Plan budget-verification metadata.
-- Runtime execution uses the matching entry in src/lib/run-migrations.ts.
--
-- Historical Plan records created before the nullable budget/currency fix were
-- silently stored as budget_planned=0 and currency='USD'. These 17 records were
-- deterministically identified from the existing data and must remain
-- distinguishable from genuine, explicitly entered USD 0 budgets.

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS budget_legacy_unverified BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE plans
   SET budget_legacy_unverified = TRUE
 WHERE id IN (10,11,14,15,16,17,18,19,20,22,24,57,58,59,60,61,62)
   AND budget_planned = 0
   AND currency = 'USD';
