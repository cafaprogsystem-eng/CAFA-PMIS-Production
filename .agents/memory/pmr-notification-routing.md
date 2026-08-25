---
name: PMR notification routing
description: Workflow-path-aware next-approver routing and report actor resolution rules
---

- `notifyNextApprover` takes optional `workflowPath`: submit + `technical_authored` → SPC directly (never a TC); state_authored/null → sector-matched TC → SPC → PM. Callers must pass `workflowPath` only for project/activity report types (null otherwise) to keep report-type isolation.
- `actorsForEntity('report')` includes `author_id` in the UNION so returned/approved/rejected reach the report owner even when someone else was the last submitter. Do not remove.
- **Why:** technical_authored PMRs skip TC review; notifying a TC on submit misroutes the review prompt. Resubmission by an authorised non-author changes `submitted_by_id` but not `author_id`.
- **How to apply:** any new notification call site for report transitions should reuse these helpers, not re-query roles; kinds differ per helper (`review_requested` vs action kind) so cross-helper "duplicates" are intentional.
- Tests: `pmr-notifications.test.ts` (lib) + `pmr-notifications-routes.test.ts` (route); note vitest cannot mock and use the real notifications module in one file — split lib/route suites.
