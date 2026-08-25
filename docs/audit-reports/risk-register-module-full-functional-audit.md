# Risk Register Module — Full Functional, Governance, Data-Integrity & Scope Audit

**Scope:** Complete Risk Register module — backend routes, schema, migrations, analytics, frontend surfaces, permissions, linkage integrity.
**Status:** Complete — P0/P1 defects with unambiguous intended behaviour fixed; remainder registered.
**Date:** 18 August 2026

---

## 1. Executive Summary

The Risk Register is a functional but structurally thin module. The core list/create/update flow works and is state- and sector-scoped, but the audit found: no read-permission gate on the list endpoint (fixed), no validation of likelihood/impact/severity/status values (fixed), an analytics definition that silently counted *high* severity risks as "critical" and diverged from the list the KPI tile links to (fixed), a project-detail create dialog that never sent `impact` and used capitalised categories that break the register's filters (fixed), and dead optimistic-locking schema. The comments tab in the risk detail sheet is **non-functional** (the shared comments API rejects `entityType=risk`), risk deletion does not exist at all despite lock-down expectations, plan/activity linkage is written only by the plans module (no linkage validation is needed in risks routes today), and Drive attachments for risks are not access-checked against the underlying risk. Verdict: **B** — sound after immediate fixes, with a bounded set of remediation tasks.

## 2. Architecture

- **Backend:** `artifacts/api-server/src/routes/risks.ts` — GET `/risks` (list, computed `riskLevel` enrichment), POST `/risks`, PATCH `/risks/:riskId`, GET `/risks/:riskId/history` (audit-log backed), GET `/risks/due-date-check` (manual job trigger). **No GET-by-id, no DELETE.**
- **Analytics:** `routes/dashboard.ts` — high-risk-state count, open/critical risk counts, follow-up KPI reasons (`active_critical_risk`, `overdue_risk_mitigation`).
- **Scheduled:** `lib/due-date-checker.ts` — due-in-7/3/1 and overdue notifications every 6 h.
- **Frontend:** `pages/risks.tsx` (list + detail sheet + inline create/edit), `pages/project-detail.tsx` (`CreateProjectRiskDialog`, `computeRiskLevelFE`), `pages/plan-detail.tsx` (read-only linked-risks table), `pages/dashboard.tsx` (KPI tile), `states.tsx`/`state-detail.tsx`, `command-palette.tsx`, `create-plan-registration-dialog.tsx` (linked-risk selector).
- **Hooks:** generated client exposes `useListRisks`, `useCreateRisk`, `useUpdateRisk` only. `useGetRisk`/`useDeleteRisk` do **not** exist (pre-scout was wrong); nothing dangles.
- **Data flow:** create (risks page or project dialog) → POST → list refetch; plan/activity linkage is written exclusively by `routes/plans.ts`.

## 3. Canonical Risk Model

| Field | Required | Semantics |
|---|---|---|
| `title`, `category` | yes | free text; canonical categories `security, operational, financial, programmatic, environmental` (lowercase) |
| `severity` | yes | impact-equivalent value `low/medium/high(/critical legacy)` — by convention the UI mirrors `impact` into `severity` |
| `likelihood` | yes | `low/medium/high` (+ legacy aliases `unlikely/possible/likely/almost_certain`) |
| `impact` | no | preferred impact field; `riskLevel` uses `COALESCE(impact, severity)` |
| `status` | default `'identified'` (DB) but POST hardcodes `'open'` | active set `open/under_mitigation/closed`; legacy `identified/assigned/mitigation_plan/follow_up/escalation/mitigated` |
| `state_id` | nullable since migration 013 | null ⇔ HQ risk (`location_type='hq'`) |
| `project_id`, `plan_id`, `plan_activity_id`, `assigned_to_id` | nullable | bare integers, no FKs |
| `due_date` | no | mitigation deadline; drives overdue notifications |
| `follow_up_date` | no | **dead column** — never read or written anywhere |
| `version`, `locked_by`, `locked_at` | — | **dead schema** — no optimistic locking is enforced on PATCH (last-write-wins) |

There is **no `score` column**; the level is always derived, so client score override is impossible (RISK-AUD-09).

The manual (`docs/system-manual-final-review.md` §risk heatmap) documents a **3×3** matrix with thresholds ≥9 critical / ≥6 high / ≥2 medium — matching production. However, `routes/manual.ts:2317-2319` FAQ text claims a 1–5 × 1–5 (score 1–25) model, which contradicts both the manual and the code (RISK-013).

## 4. Role / Permission Matrix

| Role | create | update | read | delete |
|---|---|---|---|---|
| super_admin | ✔ (`*`) | ✔ | ✔ | ✔ perm exists, **no route** |
| PM (Full Operational Access) | ✔ | ✔ | ✔ `risks.view` | ✘ |
| SPC, TC | ✔ | ✔ (TC sector-scoped at route) | ✔ | ✘ |
| ED | ✘ | ✘ | ✔ | ✘ |
| SOM | ✘ | ✘ | ✔ `risks.view.state` (state-clamped) | ✘ |
| SPO | ✔ (own state) | ✔ (own state) | ✔ `risks.view.state` | ✘ |
| viewer | ✘ | ✘ | ✔ `risks.view` | ✘ |
| unknown/legacy roles | fail closed | fail closed | **now** fail closed (read guard added) | — |

PM Full Operational Access confirmed (`currentUser.ts` PM block + HQ block). TC scoping uses `p.sector` of the linked project only; **standalone and HQ risks are invisible to TCs** (fail-closed by design; note as behaviour, not defect).

## 5. Linkage Model

- POST/PATCH `/risks` can set `state_id` (or HQ) and `project_id` only. `plan_id`/`plan_activity_id` are **never** writable through the risks routes (verified: INSERT/UPDATE contain no plan columns).
- Plan/activity ↔ risk linkage is written solely by `routes/plans.ts`: `plan_activities.risk_id` on activity INSERT/UPDATE (scoped `WHERE id=$n AND plan_id=$n`), so the feared "activity belongs to a different plan" persistence path **does not exist** in the risks module. The cross-object combination `project A + plan under B` cannot be created via the API today.
- Gaps: `projectId` on risk create is not validated to exist, nor checked against the actor's project access beyond TC sector; `plan_activities.risk_id` is not validated to reference an existing risk (RISK-007, RISK-008).
- A risk with neither state, project nor plan is impossible (state risk requires `stateId`; HQ requires org-wide role); a standalone state risk (no project) is an intended, notified case (G-02).

## 6–8. Project / Plan / Plan-Activity Integrity

- **Project:** create validates TC sector against the project's sector; state roles are clamped to own state, not to project membership (an SPO may attach a risk to any project while setting their own state — RISK-009, P3). Soft-deleted projects: risks retained and still listed/joined — deleted projects' risks stay visible in the register with a stale project title (RISK-010).
- **Plan:** linkage only via plans module; plan detail shows linked risks read-only. Plan access control is enforced by the plans routes.
- **Plan activity:** activity writes are plan-scoped by SQL; reverse link `plan_activities.risk_id` unvalidated (no FK, no existence check) — a dangling link renders as no risk, non-crashing.

## 9–11. State Scope, Sector Scope, Full Operational Access

- List: SPO/SOM hard-clamped to own `state_id`; null state ⇒ `1=0` (fail closed). `stateId` query param cannot escape the clamp. PATCH/history repeat the clamp per-row. HQ risks (`state_id IS NULL`) are never visible to state roles.
- Sector: TC list filter `p.sector = ANY(sectors)`; per-row `assertSectorAllowed` on PATCH/history; empty TC sector set matches nothing (fail closed).
- PM/super_admin: unrestricted, consistent with Global Full Operational Access.
- GET `/risks` previously had **no permission gate** (any authenticated unknown role could list all risks) — fixed with a `risks.view`/`risks.view.state` read guard, also applied to `/risks/:id/history`. The `/risks/due-date-check` manual job trigger is a privileged operational action and is now gated on `risks.admin` (held only by super_admin via the `*` wildcard).

## 12. Risk Lifecycle

Status is a **free-form field via PATCH** — no transition graph is enforced; any actor with `risks.update` (within scope) may set any allowed status, including reopening `closed`. POST hardcodes `'open'` while the DB default is `'identified'` (legacy). Status changes trigger G-03 notifications. Governance of transitions = **RISK-BD-03**.

## 13–14. Scoring & Severity

- Formula: score = mapped(likelihood 1–3) × mapped(COALESCE(impact, severity) 1–3); thresholds ≥9 critical, ≥6 high, ≥2 medium, else low. Identical in `computeRiskLevel` (TS), `riskLevelSQL` (filter), and `computeRiskLevelFE` (project-detail) for canonical values — parity verified by RISK-AUD-10.
- Previously **any TEXT** was accepted for likelihood/impact/severity/status; unknown values silently scored as 2 (medium). **Fixed:** POST and PATCH now 422 on values outside the allow-lists (canonical + legacy aliases).
- `severity: f.impact` in `CreateProjectRiskDialog` follows the same convention as risks.tsx (severity mirrors impact) but omitted `impact` itself — **fixed** to send both; category is now lowercased to match register filters.
- Divergence risk severity vs. computed level remains possible via PATCH of one field only — acceptable since all displays use computed `riskLevel` except legacy raw-severity badges (see §24 UI).

## 15. Residual Risk

No residual likelihood/impact/score fields exist anywhere (schema, routes, UI) and nothing fabricates them (RISK-AUD-11). → **RISK-BD-04**.

## 16. Mitigation

`mitigation_plan` single TEXT is the entire mitigation model; plus per-activity `plan_activities.mitigation_action`. No child action table, no delete/reinsert hazard. Multiple structured mitigation actions = product decision, not a defect.

## 17. Responsible User

`assigned_to_id` is **not validated** (nonexistent/inactive user accepted — RISK-006, P2). Notification code guards nulls (`if (assignedToId)`, `if (risk.assignedToId)`) so no crashes/ghost notifications. No same-state/sector constraint on the owner; historical inactive owners keep the assignment (grandfathered) but lose access at login (status gate).

## 18. Dates / Overdue

- `due_date` drives due-soon (7/3/1 days) and overdue notifications; overdue = `due_date < CURRENT_DATE` (server date). `follow_up_date` is dead.
- No reversed/impossible-date validation (`dueDate` before `identified_at` accepted; arbitrary strings rejected only by PG date cast → 500 rather than 422 — RISK-011, P2).
- `due-date-checker` builds "today" from a local `Date` then `toISOString().slice(0,10)` — near-midnight UTC offset can shift the reference day by one (RISK-012, P3).

## 19. Comments / History

- **Comments for risks are broken:** `RiskDetailSheet` renders `CommentsPanel entityType="risk"` but `routes/comments.ts` `VALID_ENTITY_TYPES = {project, report, plan}` — every risk comment request 400s. No IDOR exposure (rejected before access), but the tab is dead UI (RISK-001, P1 — needs the two-place role/type allow-list decision, so remediation task rather than inline fix).
- History tab works via audit log (create/update entries; JSON body as newValue). Audit coverage: create ✔, update ✔ (includes status/owner/severity/mitigation since the whole body is logged). No delete route to log.

## 20. Notifications

Events: `risk_created` (project actors / standalone→PM+SPC+state roles), `risk_assigned` (create + reassignment), `risk_high`/`risk_critical` escalation (24 h dedup), `risk_severity_downgraded` (G-05), `risk_status_changed` (G-03), due-date reminders/overdue (checker). All sends occur **after** the DB write on the same request path; a failed INSERT/UPDATE throws before any notify (RISK-AUD-16). No transactions are used, so a failure *between* notifies can partially notify — accepted, low impact (RISK-014, P3).

## 21. Analytics / Critical Risk

- **Fixed:** the "Active Critical Risks" KPI counted `severity IN ('critical','high')`, diverging from its link `/risks?riskLevel=critical` (computed). All four scope variants now use the same computed score (≥9) and exclude `closed`/`mitigated`. The high-risk-state count now uses score ≥6 with the same status exclusion (was `status <> 'closed'` only). For full tile↔list parity, GET `/risks` gained an `activeOnly` filter (`status NOT IN ('closed','mitigated')`) and the tile now links to `/risks?riskLevel=critical&activeOnly=1`, which risks.tsx forwards to the API.
- High-risk states use `COUNT(DISTINCT state_id)` — no duplicate counting. Follow-up KPI counts projects once via reason arrays; overdue mitigation uses `COUNT(DISTINCT rk.id)`. Sector variants join `projects` 1:1 — no multiplicative joins found. All variants scope-clamped.

## 22. Delete / Referential Integrity

- **Risks cannot be deleted through the API** (no route; only super_admin `*` would even hold a perm). → **RISK-BD-05**.
- Plan activity removal (plans PATCH) nulls `risks.plan_activity_id` before deleting activities; plan deletion nulls activity refs then `risks.plan_id`; both verified (RISK-AUD-18) and are the only deletion paths.
- **Project permanent delete hard-deletes its risks** (`DELETE FROM risks WHERE project_id=$1`) — including their audit-linked history remains but Drive files with `module='risks'` are orphaned (RISK-005, P2). Soft delete retains risks (visible with deleted project — RISK-010).
- `plan_activities.risk_id` can dangle if a risk were ever removed (only via project permanent delete today) — nulling of the reverse link is not performed there (RISK-005).

## 23. Attachments

`DriveAttachmentPanel module="risks"` works, but `routes/drive.ts` list/download check only file state + TC sector + SPO/SOM state scope on the *file* — never that the actor can view the underlying risk record. Enumeration of `recordId` values within one's own state/sector scope is possible (RISK-004, P2).

## 24. API / Types

- OpenAPI (`lib/api-spec/openapi.yaml`) defines GET/POST `/risks`, PATCH `/risks/{riskId}`; `Risk`, `RiskInput`, `RiskUpdate` schemas match runtime shape incl. computed `riskLevel`. No get-by-id/DELETE specified — consistent with runtime.
- The `(body as Record<string, unknown>)` casts were **stale-build artefacts**: `CreateRiskBody` *does* type `impact`/`assignedToId`/`dueDate`/`locationType`; rebuilding `lib/api-zod` + `lib/api-client-react` dists cleared the historical `locationType` TS errors. Casts removed; `tsc --noEmit` clean for all risks-owned files in both packages.
- Enum tightening in the OpenAPI spec (likelihood/impact/status) is recommended follow-up; runtime allow-lists now enforce it server-side.

## 25. Migrations

Migration 013 (`013_hq_location_type`) is the only risks migration: adds `location_type`, drops NOT NULL on `state_id`. Drizzle schema drift: `lib/db/src/schema/index.ts` still declares `stateId ... .notNull()` and lacks `locationType` (RISK-015, P3 — schema-as-doc drift only; runtime uses raw SQL). No runtime DDL in risks code (RISK-AUD-20). No FK/CHECK/UNIQUE constraints exist; app-side validation now covers value domains; FKs remain a deliberate gap consistent with the rest of the codebase (all app-side nulling).

## 26. Performance / Concurrency

- List endpoint has **no pagination** and `ORDER BY r.identified_at DESC` (no unique tiebreaker); acceptable at current volumes, flagged for growth (RISK-016, P3).
- `version/locked_by/locked_at` unused → PATCH is last-write-wins (RISK-003, P2).
- `riskLevel` filter recomputes the CASE expression per row — fine without an index at current scale.

## 27. Business Decisions

- **RISK-BD-01 — linkage hierarchy:** today project link governs sector scope; plan links are plans-module-owned and display-only. Should a risk with both project and plan cross-check plan.project_id? (Not persistable via API today.)
- **RISK-BD-02 — scoring model:** production is 3×3 (≥9/≥6/≥2). The manual FAQ's 5×5 (1–25) text is wrong or aspirational — which is canonical?
- **RISK-BD-03 — status workflow:** free-form status via PATCH, including reopening closed risks — should transitions be governed?
- **RISK-BD-04 — residual risk:** no residual fields exist. Planned feature or out of scope?
- **RISK-BD-05 — deletion/archival:** risks cannot be deleted; closure is the only terminal state, except project permanent delete which hard-destroys them. Intended retention policy?

## 28. Complete Finding Register

| ID | Sev | Layer | Location | Issue | Resolution |
|---|---|---|---|---|---|
| RISK-001 | P1 | API+UI | comments.ts:12 / risks.tsx detail sheet | Comments tab dead — `risk` not in VALID_ENTITY_TYPES; every request 400s | Remediation task (needs role/type allow-list decision, two-place change) |
| RISK-002 | P1 | API | risks.ts GET /risks, /history, /due-date-check | No permission gate — any authenticated (incl. unknown role) could list all risks | **Fixed** — `risks.view`/`risks.view.state` read guard, fail closed |
| RISK-003 | P2 | Schema/API | risks PATCH | `version/locked_by/locked_at` dead; no optimistic locking; stale writes possible | Register; BD-free but non-trivial — remediation task |
| RISK-004 | P2 | API | drive.ts list/download | Attachments for `module='risks'` not checked against risk visibility (scoped IDOR) | Remediation task |
| RISK-005 | P2 | API | projects.ts permanent delete | Hard-deletes risks; leaves `plan_activities.risk_id` and Drive files dangling | Remediation task |
| RISK-006 | P2 | API | risks.ts POST/PATCH | `assignedToId` not validated (nonexistent/inactive user accepted) | Remediation task |
| RISK-007 | P2 | API | plans.ts activity write | `risk_id` not validated to reference an existing risk | Remediation task |
| RISK-008 | P2 | API | risks.ts POST | `projectId` not validated to exist / actor project access beyond TC sector | Remediation task |
| RISK-009 | P3 | API | risks.ts POST | SPO can attach a risk to any project (state clamp only, no membership check) | Register (consistent with SPO scope decision needed) |
| RISK-010 | P3 | API/UI | riskSelect join | Risks of soft-deleted projects remain listed with stale titles | Register |
| RISK-011 | P2 | API | risks.ts POST/PATCH | No date validation — malformed `dueDate` → PG error 500; reversed dates accepted | Remediation task (return 422) |
| RISK-012 | P3 | Job | due-date-checker.ts | Local-date → `toISOString()` can shift reference day near UTC midnight | Register (`pg-date-types` memory pattern) |
| RISK-013 | P3 | Docs | manual.ts:2317 | FAQ documents 5×5/1–25 scoring; production is 3×3 | Register / align with BD-02 |
| RISK-014 | P3 | API | risks.ts notifications | Multiple notifies not transactional; partial notification on mid-sequence failure | Register |
| RISK-015 | P3 | Schema | lib/db schema | Drizzle risks table drift: `stateId.notNull()`, missing `locationType` vs. migration 013 | Register |
| RISK-016 | P3 | API | GET /risks | No pagination; non-unique sort key | Register |
| RISK-017 | P1 | UI | project-detail.tsx CreateProjectRiskDialog | Payload omitted `impact`; capitalised category values break register category filter | **Fixed** — sends `impact`, lowercases category |
| RISK-018 | P1 | API | dashboard.ts | "Active Critical Risks" counted severity∈{critical,high}, diverging from linked riskLevel=critical list; high-risk states ignored `mitigated` | **Fixed** — computed score ≥9 (critical) / ≥6 (high states), status NOT IN (closed, mitigated), all scope variants |
| RISK-019 | P1 | API | risks.ts | likelihood/impact/severity/status accepted arbitrary TEXT; unknown values silently scored medium | **Fixed** — 422 allow-list validation on POST + PATCH |
| RISK-020 | P2 | Types | risks.ts casts; stale lib dists | `(body as Record)` casts were stale-dist artefacts; historical `locationType` TS errors | **Fixed** — dists rebuilt, casts removed, tsc clean |
| RISK-021 | P3 | UI | plan-detail.tsx, command-palette, states.tsx, risks.tsx table | Raw enum display (lowercase severity/status) | **Fixed** in plan-detail (capitalised); others use CSS capitalise already / register |
| RISK-022 | P3 | API | risks.ts POST | Status hardcoded `'open'` vs. DB default `'identified'` (legacy) — harmless but inconsistent | Register |

TODO/FIXME/`as any`/`ts-ignore` sweep of risks-owned files: none remaining beyond the removed casts.

## 29. Tests

`artifacts/api-server/src/routes/__tests__/risk-audit.test.ts` — 34 tests, all passing, covering RISK-AUD-01…20 (route-level with mocked pool + structural source assertions): model/type alignment, plan-column immunity of POST, state/sector clamps incl. fail-closed nulls, permission matrix incl. unknown-role fail-closed, 422 enum validation, BE/FE severity parity, residual absence, null-assignee guards, status lifecycle values, comments non-enumeration, notification rollback safety, analytics thresholds, deletion nulling, no-DDL, date passthrough.

## 30. Recommended Remediation Tasks

Parallel-safe groups:
1. Enable risk comments end-to-end (RISK-001) — comments allow-list + role→type mapping (server + client, lockstep).
2. Attachment access checks for `module='risks'` (RISK-004).
3. Reference validation bundle: assignedToId active-user check, projectId existence, plans.risk_id existence, date validation 422 (RISK-006/007/008/011).
4. Project permanent-delete cleanup: null `plan_activities.risk_id`, archive Drive files (RISK-005).
5. Optimistic locking or removal of dead lock columns (RISK-003) — after BD review.
6. OpenAPI enum tightening + regen (follow-on to RISK-019).

## 31. Final Verdict

**B** — Functionally sound core with correct scoping after the five immediate fixes; remaining issues are bounded, registered, and mostly P2/P3 or blocked on business decisions (comments enablement being the largest user-visible gap).
