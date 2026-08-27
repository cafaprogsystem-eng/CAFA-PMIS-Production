-- Migration 059: Align persisted Plan budget fields with the draft-save runtime contract.
--
-- Draft Plans may legitimately be created before budget and currency details are
-- entered. The API intentionally persists NULL for these fields until staff supply
-- real values. Historical NOT NULL constraints and defaults (0 / USD) incorrectly
-- fabricated financial data and currently cause valid draft creation to fail.
--
-- Existing rows are intentionally left unchanged. Migration 057 separately marks
-- known historical rows whose legacy 0/USD values cannot be proven user-entered.

ALTER TABLE plans
  ALTER COLUMN budget_planned DROP DEFAULT,
  ALTER COLUMN budget_planned DROP NOT NULL,
  ALTER COLUMN budget_actual  DROP DEFAULT,
  ALTER COLUMN budget_actual  DROP NOT NULL,
  ALTER COLUMN currency       DROP DEFAULT,
  ALTER COLUMN currency       DROP NOT NULL;
