---
name: Budget historical over-allocation register
description: 8 historical over-allocated projects are blocked on human finance decisions; no automatic remediation permitted.
---
Historical over-allocation reconciliation (Budgets module):
- 8 non-deleted projects violate SUM(allocations) > budget_total; all classified category D (single bulk backfill wrote every allocation row with one shared created_at, applying uniform ×1.04/×1.12 uplifts over budget_total; audit_log has zero allocation/budget-change entries, so no canonical prior value is recoverable).
- **Why:** correct value (budget vs allocation) is a financial judgement — automatic LEAST/scaling/budget-increase is explicitly forbidden. No remediation migration exists, deliberately; sentinel BUD-HIST-08 pins that absence.
- **How to apply:** any fix for register entries (docs/audit-reports/budgets-historical-overallocation-reconciliation.md §4) must go through the normal audited API write paths (project PATCH / state-allocation replace), never ad-hoc SQL or a new auto-correcting migration. BUD-HIST-10 hard-codes the 8-project dataset — update the test and the register together if any entry is resolved.
- Migration 029 must stay warning-only (BUD-HIST-09). The Finance-held data register does not block current-head software closure; it must remain distinct from the Software Residual Register.
