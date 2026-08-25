---
name: Submit-gate validation pitfalls
description: Two recurring weaknesses in backend report submit content gates — lenient Date.parse and single-source frequency detection.
---

# Submit-gate validation pitfalls

**Rule 1 — strict calendar dates.** `Date.parse("2026-02-30")` silently normalises to 2 March; a submit gate using it accepts impossible dates. Parse `YYYY-MM-DD` with a regex and round-trip the components through `Date.UTC` (check getUTCFullYear/Month/Date match). Accept JS `Date` instances too (pg returns Date objects for date columns).

**Rule 2 — fail-closed on-demand detection.** Frequency may live in both the `kind` column and `sections.frequency`; a direct API caller can store conflicting values. Trigger on-demand rules when EITHER says `on_demand` — never let a non-on-demand value in one location suppress the other.

**Why:** Both were completion-review rejections on the HQSR submit gate (HQSR-003). The HQSR validator (`validateHqSectorReportForSubmission` in api-server reports routes) implements both correctly; the older SPR validator (`validateProgramStateReportForSubmission`) still uses lenient `Date.parse` and kind-only detection — align it if its contract is ever revisited.

**How to apply:** Any new backend content gate for report submission (or edits to existing ones) must use the strict date parser and either-indicator frequency detection.
