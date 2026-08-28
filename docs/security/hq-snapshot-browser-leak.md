# HQ snapshot browser leak — pre-remediation evidence

Recorded before the browser-cache remediation on 2026-08-28.

## Proven exploit

- Route: `/reports/hq-sector`, with the HQ Sector Report create/edit dialog open.
- Preconditions: the same authenticated Technical Coordinator is initially assigned to `Health`; the form has selected `Health`; `GET /api/dashboard/sector-snapshot?sector=Health` has succeeded within the query's 60-second freshness window.
- Transition: the coordinator's authoritative sector assignment changes to `WASH` while the form remains mounted. The realtime `authorization_changed` path refreshes `/api/me`, but the form consumes the separate generated `/api/me` query and the snapshot query is keyed only by `["sector-snapshot","Health"]`.
- Request/response sequence: the original authorized request returns `200` and protected snapshot metrics. After the scope change, React Query reuses that fresh entry and renders it without issuing a second snapshot request. A direct post-change request is correctly rejected by the server with `403` and an error-only body.
- Protected values exposed: aggregate active projects/states/localities, activities, beneficiaries, indicator progress, delayed activities, risks, approvals, state/project/donor breakdowns, and indicators for the former sector.
- Root cause: browser authorization context was absent from the snapshot key, and the realtime refresh updated only `["auth","me"]`, not the generated `["/api/me"]` identity used by the form. A denied refetch was not an erasure boundary for a prior successful query result.
- Impact: a re-scoped TC could continue reading another sector's HQ snapshot from browser memory until eviction/remount. SOM/SPO transitions had the same stale-identity risk. This is a browser-resident disclosure; the canonical `reportAuth` API boundary already denies these requests before snapshot queries execute.

The HQ snapshot URL is not in the approved offline-read allowlist, so the snapshot payload is not written to Dexie. Adjacent cacheable report/detail paths were audited separately for same-user scope-change invalidation.