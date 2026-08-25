---
name: Project scheduled reporting frequency
description: Model D (Scheduled + On-Demand) contract for projects.reporting_frequency
---

Rule: `projects.reporting_frequency` is TEXT NULL CHECK IN ('monthly','quarterly','annual') — never `on_demand`, never a DEFAULT, never backfilled. Null = "not configured" (historical) and must display as "Not Configured", never "Monthly".

**Why:** Model D decision — scheduled frequency is a project attribute; on-demand PMRs are supplementary and always allowed. Silent monthly defaulting would fabricate compliance data for historical projects.

**How to apply:**
- POST /projects requires it (route-level 400, not Zod-required — the shared ProjectInput schema is also used by PATCH where null must stay legal).
- PATCH uses a presence flag + `CASE WHEN $flag THEN $val ELSE reporting_frequency END`; changing it NEVER touches the reports table.
- Client warning only on kind≠frequency mismatch (no server enforcement yet); hidden for on_demand kind and null frequency.
- Registration form: required in create mode via `createSchema` superRefine; optional in edit mode so historical nulls aren't forced.
