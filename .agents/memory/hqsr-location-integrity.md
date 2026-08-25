---
name: HQSR location integrity
description: HQ Sector Reports must have state_id and project_id NULL — enforcement layers and migration caveat
---

# HQSR location integrity

Rule: `report_type = 'hq_sector'` ⇒ `state_id IS NULL AND project_id IS NULL`. Actor-independent — PM Full Operational Access and super_admin have no bypass.

**Why:** HQ Sector Reports are anchored to a canonical sector, never a State/Project; residual linkage from the generic create flow corrupted scoping semantics.

**How to apply:**
- CREATE route returns 422 `hq_sector_location_invalid` for supplied stateId/projectId (after the sector/author gate, so 400/403 keep precedence) AND forces NULL in the INSERT params.
- DB CHECK `chk_hq_sector_no_state_project` (migration 021) is the last line of defence.
- Migration 021 auto-remediates only "Class A" rows (non-null canonical sector + valid kind). If a "Class B" malformed hq_sector row (e.g. null sector) ever exists in an environment, the constraint ALTER will fail and block server start — remediate manually first.
- Frontend: HQSR detail header never renders State/Project metadata; form payload never carries top-level stateId/projectId. Contract tests: api-server + cafa-pmis `hqsr-location-integrity.test.ts`.
