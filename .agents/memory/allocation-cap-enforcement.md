---
name: Allocation cap enforcement
description: BUD-BD-01 — SUM(state allocations) <= project budget_total, enforced in-transaction under row lock
---

Rule: `SUM(project_state_allocations.budget_allocation) <= projects.budget_total`, unconditional (budget=0 included), actor-independent (PM/SA cannot bypass). Canonical error: 422 `over_allocation`.

**Why:** zero-budget bypass (`projectBudget > 0 &&`), missing PATCH-side check, and a pre-BEGIN budget read allowed over-cap writes.

**How to apply:**
- Any new write path touching budget_total or allocations must read the project row `FOR UPDATE` inside the transaction, then cap-check, then write. Replace endpoint and PATCH both do this — mirror them.
- Project PATCH always writes budget_total and wholesale-replaces allocations, so the cap check compares incoming payload vs incoming budget only.
- Tests mocking these handlers must place the budget row AFTER a BEGIN mock (order: pre-flight → BEGIN → budget lock → …).
- 8 residual over-cap projects existed pre-enforcement; migration 029 warns (never auto-corrects). See docs/audit-reports/budgets-allocation-cap-integrity-closure.md.
