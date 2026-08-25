-- Migration 058: Persist the Plan final-approval timestamp.
-- Runtime execution uses the matching entry in src/lib/run-migrations.ts.
-- The maintained declarative reference is lib/db/src/schema/index.ts.

-- Preserve the exact final-approval boundary that governs whether a Plan may
-- be edited after it has been reopened. A current status or updated_at value
-- is not sufficient evidence: only the immutable approval history can prove a
-- final approval happened.
ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS last_final_approved_at TIMESTAMPTZ;

-- Older final approvals predate this column. Restore only the latest explicit
-- plan final-approval event, retaining NULL for plans without that evidence and
-- preserving any timestamp already written by the live workflow.
WITH latest_final_approval AS (
  SELECT entity_id, MAX("timestamp") AS approved_at
  FROM approvals
  WHERE entity_type = 'plan'
    AND action = 'final_approve'
    AND to_status = 'approved'
  GROUP BY entity_id
)
UPDATE plans AS plan
   SET last_final_approved_at = final_approval.approved_at
  FROM latest_final_approval AS final_approval
 WHERE plan.id = final_approval.entity_id
   AND plan.last_final_approved_at IS NULL;