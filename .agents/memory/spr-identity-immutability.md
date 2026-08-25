---
name: SPR identity immutability
description: State Programme Report (program_state) identity rules — PATCH guard + null-state create fail-closed
---

**Rule:** program_state reports have an immutable business identity after creation: stateId, kind, period, reportingMonth, reportingYear, quarter, periodStart, periodEnd, reportType. The generic `PATCH /reports/:id` handler rejects any present identity key (even same-value) with 409 `program_state_report_identity_immutable`, mirroring the `activity` and `project` blocks (present-key convention). super_admin bypasses for administrative corrections.

**Also:** POST /reports for program_state fails closed (403 `state_scope_required`) when a state-scoped role (SPO/SOM) has a null assigned stateId — the create clamp derives stateId from the profile, so a null profile state would create an unreadable null-stateId SPR.

**Why:** Audit-confirmed escape: an SPO could PATCH stateId to another state and change kind/period, moving the report outside their own scope and bypassing period uniqueness.

**How to apply:** Any new report type with a period/state identity needs an equivalent PATCH identity block; content fields (title, sections, activities, narratives, risks, sector, relatedProjectIds, beneficiaries) must stay editable in draft. Tests: `src/test/spr-identity-hardening.test.ts` (mock harness pattern from pmr-quarter-immutability).
