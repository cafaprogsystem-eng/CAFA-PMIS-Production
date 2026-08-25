---
name: RTL business-surface guardrails
description: Scope and exemptions for maintaining Arabic RTL layout and mixed-direction safety.
---

Audit every user-facing business surface, including secondary forms, dialogs, detail views, search controls, tables, and compact/card views—not just representative high-traffic pages. Use logical Tailwind properties for normal layout and explicit LTR isolation for codes, money, dates, counts, and percentages embedded in Arabic UI.

**Why:** A narrow source guard can pass while lower-traffic report forms, finance rows, and workflow controls still retain physical alignment or reverse technical values in Arabic.

**How to apply:** Broad source guards should cover the active business modules and only allow documented physical geometry where both values are intentionally paired (full-width `left-0 right-0`) or positioned with matching physical translation (`left-1/2 -translate-x-1/2`). Do not use these exemptions for ordinary content alignment, padding, margins, or search icons.