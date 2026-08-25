---
name: Budget dashboard access contract
description: Mixed operational dashboard access versus hard-gated financial endpoints, including the redaction boundary.
---

# Budget dashboard access contract

Some dashboard responses are mixed operational/financial contracts: every authenticated
role receives authorised operational metrics within its scope. For users without financial
access, summary financial properties are structurally absent, while a financial metric in
an otherwise operational row may remain present as `null` when a stable row shape is the
documented contract.

Dedicated financial analytics remain inaccessible to users without financial access.
Any empty or missing assignment scope must fail closed rather than become system-wide.

**Why:** Operational dashboard parity is required for authenticated non-Budget roles, but
financial names and values must not leak from summary, and financial-only analytics must
remain inaccessible.

**How to apply:**
- Classify each new dashboard field or endpoint as operational, financial-only, or mixed.
- On mixed responses, omit summary financial properties for excluded roles; do not
  null-fill names that should not cross the response boundary.
- For a stable operational row, use an explicitly documented null financial value.
- Enforce dedicated financial analytics before any data access.
- Preserve caller scope exactly; never interpret an empty assignment as unrestricted.

# Sector-performance mixed-currency contract

Utilisation is unavailable for mixed currencies, zero or missing budget, or missing spend;
represent it as `null`, not zero. Preserve overspend above 100%.
