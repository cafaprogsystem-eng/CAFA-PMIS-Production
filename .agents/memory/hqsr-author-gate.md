---
name: HQ Sector Report author gate
description: HQSR-001 create-gate rules and enabled SPC fallback path for hq_sector reports
---

- POST /reports hq_sector gate (PERM-03 block in routes/reports.ts): requires non-blank, trimmed, canonical sector (VALID_SECTOR_SET) for ALL authors including super_admin, before role branching.
- Authors: TC (exact-segment match against assigned CSV sectors, fail closed if none), super_admin. SPO/SOM/PM/ED/Viewer → 403 `hq_sector_author_role_required`.
- SPC fallback (HQSR-BD-1/BD-6) is ENABLED: SPC may author when no active TC covers the sector; PM is the coordination reviewer for fallback reports only. The fallback is frozen at creation as `workflow_path='spc_fallback'` — never derived from the author's current role (role changes must not alter an approval path). PM does NOT hold `reports.approve.coordination`; PM reviews fallback reports via a narrow transition-handler exception scoped to hq_sector + spc_fallback + coordination-stage actions — never grant the permission globally.
- HQSR-002 identity immutability: hq_sector PATCH rejects any present identity key (sector/kind/period/reportingMonth/reportingYear/quarter/periodStart/periodEnd/stateId/projectId/reportType, camel+snake) with 409 `hq_sector_report_identity_immutable`. Unlike SPR/PMR/Activity guards, there is NO super_admin bypass — actor-independent by design (sector identity anchors the author gate).
- Vacancy check: `hasActiveTcForSector()` in lib/reportAuth.ts — active TCs only, exact CSV-segment match; server-side only, never trust frontend "no TC" claims.
- Frontend: `canAuthorHqSectorReport(role, userSector)` in cafa-pmis lib/permissions.ts fails closed for TC without sectors and includes SPC (backend vacancy check authoritative); reportSelect exposes `authorRole` so transitionsFor can split hq_sector coordination visibility (PM ↔ SPC-authored, SPC ↔ TC-authored).

**Why:** generic reports.create previously let any role create HQ Sector Reports (audit defect); super_admin path previously allowed arbitrary/whitespace sectors.
**How to apply:** any change to HQ sector authoring, SPC fallback enablement, or the coordination permission map must keep the workflow completable and preserve the canonical-sector pre-check.
