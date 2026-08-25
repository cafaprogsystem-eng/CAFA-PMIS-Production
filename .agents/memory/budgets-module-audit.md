---
name: Budgets module invariants
description: Durable governance rules for budget/financial data established by the Budgets functional audit.
---

# Budgets module invariants

- **No canonical State-level expenditure source exists.** Spend lives at project level (`activities.budget_spent`). Any State-facing utilisation or spend figure must be NULL/`—`, never a fabricated share of project budgets.
  **Why:** Governance baseline — project budgets are not divided between States; a State seeing a multi-State project does not own its budget. A fabricated constant-share figure previously shipped and misled reviewers.
  **How to apply:** Never reintroduce a state utilisation formula without a real state-expenditure column. The dashboard state-performance budget component is permanently null and its score renormalises over the available components.
- **Never sum money across currencies.** Per-currency grouping plus a `currencyMixed` flag is the established pattern; a legacy cross-currency headline on the dashboard summary survives only for single-currency display.
- **Budget analytics must exclude soft-deleted projects** — every new analytics query joining projects needs the soft-delete filter.
- **One allocation per (project, state), non-negative, FK-backed** is now DB-enforced; the only allocation mutation path is replace-all and it must write an audit-log entry.
- A sentinel test suite (BUD-AUD-*) guards these invariants; extend it when touching budget queries. Findings/BD register: `docs/audit-reports/budgets-module-full-functional-audit.md`.
- **Project Budget presentation must fail closed when currency or a utilisation denominator is unavailable.** Screen views, charts, and downloadable PDF/CSV/Excel must show `—` rather than unqualified money or a fabricated 0%; zero is valid only with a known currency and positive planned amount.
  **Why:** A Project-only currency is the financial context, and a zero planned amount cannot support a burn/overspend calculation. Export surfaces carry the same interpretation risk as the visible dashboard.
  **How to apply:** Reuse the shared presentation safeguards for any Project Budget display or export. Apply the denominator check to status text as well as percentages and progress UI; retain signed remaining values and rates above 100% where the denominator is valid.

## Regression gate (BUD-REG)
- Named sentinel suite: api-server routes/__tests__/budget-regression-sentinels.test.ts (BUD-REG-01..12) caps BUD-GATE/DASH-ACCESS/BUD-SECTOR/BUD-STATE coverage; assertions are exact (exact 403 body, key-absence, strict nulls, bound params) — never weaken to truthy/status-only.
- dashboard.ts runs a one-off module-load donor data-quality query (DEFECT-07 "donor ILIKE"); tests asserting "no financial SQL before the gate" must exclude it.
- BUD-008 is closed: donor IDs are FK-backed, writes validate canonical donors, and portfolio grouping is ID-first/per-currency/deduplicated. BUD-BD-02 remains an accepted project-currency/no-FX constraint; the State proxy is permanently removed.
