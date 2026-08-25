# CAFA PMIS — System Permission Matrix
**Audit Date:** 2026-08-22  
**Scope:** All 8 canonical CAFA roles × all modules × all actions  
**Source of truth:** `artifacts/api-server/src/middlewares/currentUser.ts` → `permissionsFor()`

---

## Role Definitions

| Role ID | Label | Scope | Notes |
|---------|-------|-------|-------|
| `super_admin` | Super Admin | Organisation-wide | Wildcard `*` — all permissions |
| `executive_director` | Executive Director | Organisation-wide | View-only leadership oversight |
| `program_manager` | Programme Manager | Organisation-wide | Full Operational Access (governance rule) |
| `senior_program_coordinator` | Senior Programme Coordinator | Organisation-wide | Coordination + review authority |
| `technical_coordinator` | Technical Coordinator | Sector-scoped | Multi-sector CSV; fail-closed if empty |
| `state_office_manager` | State Office Manager | State-scoped | Monitoring/read only; no approval authority |
| `state_program_officer` | State Programme Officer | State-scoped | Primary operational author in their state |
| `viewer` | Viewer | Organisation-wide | Organisation-wide read and text-conversation collaboration; no workflow writes, approvals, comments, uploads, or user management |

**Non-VALID roles** (cannot be assigned, fail-closed):  
`programme_assistant`, `program_assistant`, `project_officer`, `hq_sector_coordinator`, `hq_sector_officer`

---

## Universal Permissions (all 8 roles)

| Capability | Description |
|-----------|-------------|
| `notifications.view` | View own notifications |
| `manual.view` | View system manual |
| `states.view` | View states reference data |
| `messages.view` | View messages (text-only) |
| `program_resources.view` | View programme resources |

---

## Full Permission Matrix

### Projects Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `projects.view` (donors list gate) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `projects.view.state` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `projects.create` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `projects.update` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `projects.approve.coordination` | ✓ | — | ✓ | ✓ | — | — | — | — |
| `projects.approve.technical` | ✓ | — | ✓ | — | ✓ | — | — | — |
| `projects.approve.final` | ✓ | — | ✓ | — | — | — | — | — |
| `projects.activate` | ✓ | — | ✓ | — | — | — | — | — |
| `projects.close` | ✓ | — | ✓ | — | — | — | — | — |
| `projects.delete` | ✓ | ✓ | ✓ | — | — | — | — | — |

**Scope notes:**  
- TC: sector-scoped via `tcSectorRestriction()`; empty sector → denied  
- SOM/SPO: state-scoped via `assertStateAllowed()`; null stateId → denied  
- SPO: additionally scoped to project_assignments membership  
- `GET /projects` list has no `requirePerm` guard — all authenticated roles can list (scoping applied per role)

### Reports Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `reports.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `reports.view.state` (legacy) | ✓ | — | — | — | — | ✓ | ✓ | — |
| `reports.create` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `reports.update` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `reports.delete` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `reports.approve.coordination` | ✓ | — | ✓ | ✓ | — | — | — | — |
| `reports.approve.technical` | ✓ | — | ✓ | — | ✓ | — | — | — |
| `reports.approve.final` | ✓ | — | ✓ | — | — | — | — | — |
| `reports.program_state.create` (SOM fallback capability) | ✓ | — | — | — | — | ✓ (bounded) | — | — |
| State Programme Report author (effective route rule) | ✓ (explicit State) | — | ✓ (explicit State) | — | — | ✓ (fallback) | ✓ (primary) | — |

**Scope notes:**  
- TC: type-aware sector scope via `applyReportScope()` — Project reports use p.sector only  
- SOM/SPO: state clamped to own stateId; null → fail-closed (`1=0`)  
- SPO is the primary State Programme Report author. SOM receives a bounded fallback only when the route verifies that no active SPO covers the assigned state. Super Admin and PM must provide an explicit valid State selection.

### Plans Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `plans.view` | ✓ | — | — | — | — | — | — | ✓ |
| `plans.create` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `plans.update` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `plans.approve.coordination` | ✓ | — | ✓ | ✓ | — | — | — | — |
| `plans.approve.technical` | ✓ | — | ✓ | — | ✓ | — | — | — |
| `plans.approve.final` | ✓ | — | ✓ | — | — | — | — | — |
| `plans.reopen` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | — |
| `plans.delete` | ✓ | ✓ | ✓ | — | — | — | — | — |

**Scope notes:**  
- TC: sector-scoped; HQ plans denied to state roles  
- `GET /plans` list has no `requirePerm` guard — all authenticated roles can list (scoped by role)

### Risks Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `risks.view` (org-wide) | ✓ | — | ✓ | ✓ | ✓ | — | — | ✓ |
| `risks.view.state` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `risks.create` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `risks.update` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |
| `risks.delete` | ✓ | — | — | — | — | — | — | — |
| `risks.admin` | ✓ | — | — | — | — | — | — | — |

**Scope notes:** TC sector-scoped via p.sector; state roles scoped to own stateId

### Budget & Finance Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `budget.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `budget.view.all` | ✓ | ✓ | ✓ | ✓ | — | — | — | ✓ |
| `budget.view.sector` | ✓ | — | — | — | ✓ | — | — | — |
| `budget.view.state` | ✓ | — | — | — | — | ✓ | ✓ | — |
| `budget.create` | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| `budget.edit` | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| `budget.review` | ✓ | — | ✓ | ✓ | — | — | — | — |
| `budget.approve.final` | ✓ | — | ✓ | — | — | — | — | — |

**Note:** `BUDGET_DONORS_ROLES` in dashboard.ts is a hardcoded role set that duplicates the `budget.view` capability check. Aligned with the permission model but diverges from the canonical capability system.

### User Management Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `users.view` | ✓ | ✓ | ✓ | ✓ | — | — | — | — |
| `users.manage` | ✓ | — | — | — | — | — | — | — |

**Note:** `users.manage` is super_admin only (via wildcard). ED and PM get `users.view` only.

### System Settings

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `settings.view` | ✓ | — | — | — | — | — | — | — |

### Dashboard Module

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `dashboard.view.org` | ✓ | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
| `dashboard.view.state` | ✓ | — | — | — | — | ✓ | ✓ | — |

### Audit Log

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `audit.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Note:** SOM/SPO audit.view is route-level scoped to own stateId via JOIN; cross-state access denied server-side.

### Documents

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `documents.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `documents.upload` | ✓ | — | ✓ | ✓ | ✓ | — | ✓ | — |

### Communications / Messages

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `messages.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `messages.create` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `messages.send` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `messages.manage_members` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `messages.announce` | ✓ | ✓ | ✓ | — | — | — | — | — |
| `messages.attachments.upload` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | — |

**Note:** Announcements restricted to `ANNOUNCEMENT_ROLES = {super_admin, executive_director, program_manager}` — hardcoded in conversations.ts (not a capability string).

### Manual / Programme Resources

| Action / Capability | SA | ED | PM | SPC | TC | SOM | SPO | Viewer |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `manual.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `manual.edit` | ✓ | — | ✓ | — | — | — | — | — |
| `manual.edit.content` | ✓ | — | ✓ | ✓ | — | — | — | — |
| `program_resources.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `program_resources.upload` | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| `program_resources.edit` | ✓ | — | ✓ | ✓ | ✓ | — | — | — |
| `program_resources.delete` | ✓ | — | ✓ | ✓ | ✓ | — | — | — |

---

## Endpoint Enforcement Matrix

All non-public `/api` routes pass through `requireAuth`; every row below therefore assumes an active authenticated account. “Conditional” means a capability is necessary but the route also evaluates the target record, state/sector intersection, assignment, ownership, or workflow stage before returning data or mutating it.

| Endpoint family | Methods / actions | Capability gate | Effective record scope and conditions | Enumeration / aggregate protection | Validation evidence |
|---|---|---|---|---|---|
| Dashboard | GET summaries, trends, agenda | `dashboard.view.org` / `dashboard.view.state` | State roles are clamped to assigned state; null state fails closed; financial data separately requires budget capability | Scope predicate is applied before totals and chart groupings | Dashboard authz and budget endpoint tests |
| Projects | GET list/detail; POST/PATCH; lifecycle | Capability varies; list is intentionally authenticated/no-gate | TC sector; state-role state/assignment scope; mutation also checks owner, state and lifecycle; PM/SA override audit applies | List filters before count/page; donors are capability-gated | Project scope, governance and closure tests |
| Plans | GET list/detail; POST/PATCH; approve/reopen/delete | Capability varies; list is intentionally authenticated/no-gate | TC sector and state restrictions; edit/reopen checks approval lock and allowed lifecycle stage | Scoped list predicates before aggregation | Plan scope, approval-lock and aggregate tests |
| Reports (Project/Activity/HQ/State) | GET/detail; POST/PATCH; submit/approve | `reports.*` plus type-specific author gate | State/sector/project rules, immutable identity, author/owner and workflow status; State Programme author is SPO primary, SOM fallback, SA/PM explicit-state paths | Report list, analytics and facets scope before aggregation | Report security, author-gate and duplicate tests |
| Risks | GET/list; POST/PATCH | `risks.view*`, `risks.create/update` | TC sector; state own-state; linked plan/project scope and lifecycle checks | Scoped route predicate before KPIs/lists | Risk register and dashboard authz tests |
| Budgets | GET dashboards/allocations; POST/PATCH/review | `budget.view*`, create/edit/review/final | Finance visibility redacted where role lacks budget scope; state/sector/user scope is intersected server-side; allocations enforce cap under lock | Filters applied before totals/export/autocomplete | Budget role-gate, allocation-cap and dashboard tests |
| Users / access Inspector | GET directory/detail/effective-access; admin mutations | `users.view` / `users.manage` | Inspector is admin-only and read-only; target account status, State, sector and project assignments are resolved server-side | Directory paginates and filters on server; no credentials in responses | User-management and RBAC Inspector tests |
| Audit log | GET list/detail | `audit.view` | SOM/SPO constrained by canonical state/sector joins; invalid filters rejected | Scope predicate applied before total/count/export result | Audit workspace and state-role RBAC tests |
| Documents / attachments | GET/upload/delete/download | Parent-module capability plus document capability | Parent record authorisation is required; document metadata never grants independent access | Parent scope applies before file lookup | Project document and Drive parent-access tests |
| Storage / file repository | GET/list/upload/archive | `storage.admin` or parent capability | Repository admin is ED/PM/SA; report/project files inherit parent-record scope | Listing/search respects parent/module scope | Drive parent-record access tests |
| Communications | GET conversations/messages; create/send/members/announcements | `messages.*` | Membership and operational-viewer policy evaluated server-side; announcement author roles are SA/ED/PM | Cursors and unread count are membership-scoped | Conversation lifecycle/realtime tests |
| Notifications / preferences | GET list/count; PATCH own preferences | `notifications.view` | Always authenticated user’s own ID; caller-supplied IDs cannot widen scope | Counts and items are user-scoped | Notification recipient and preference tests |
| Manual / programme resources | GET/read; content/admin mutations | `manual.*`, `program_resources.*` | Read broadly available; mutations require explicit capability and valid hierarchy | Resource lists do not reveal restricted uploads | Manual/storage capability tests |
| AI settings / logs | GET/PATCH settings/logs | `ai.settings.manage`, `ai.logs.view` | ED manages settings; PM views logs; SA wildcard | No credential values returned in API payloads | AI route capability review |
| States / reference data | GET states/reference lookups | `states.view` or route-specific capability | Read-only reference data; downstream state query IDs are intersected with caller scope | Autocomplete/options inherit caller scope where operational data is queried | Location-context and route-scope tests |

### Intentionally Authenticated-but-Ungated Lists

`GET /projects` and `GET /plans` are operational-transparency routes. They are still authenticated and apply state/sector scope predicates, but do not demand a separate view capability. Canonical Viewer has both `projects.view` and `plans.view`; unknown legacy roles are documented governance exceptions and must be reassigned rather than treated as organisation-wide permission grants.

---

## Scope Summary by Role

| Role | State Scope | Sector Scope | Project Scope |
|------|------------|--------------|---------------|
| super_admin | All | All | All |
| executive_director | All | All | All (view-only) |
| program_manager | All | All | All (Full Op Access) |
| senior_program_coordinator | All | All | All |
| technical_coordinator | All | Assigned sectors only (fail-closed if empty) | Cross-state within sector |
| state_office_manager | Own state only (fail-closed if null) | All within state | project_states JOIN + assignments |
| state_program_officer | Own state only (fail-closed if null) | All within state | project_assignments membership |
| viewer | All | All | Organisation-wide read; no project assignment restriction |

---

## Dynamic / Conditional Rules

1. **TC sector restriction** (`tcSectorRestriction`): Returns `string[] | null`. `null` = non-TC (unrestricted). `[]` = TC with no sectors → denied via `ANY($n::text[])` matching nothing.
2. **SPO project scope**: `buildScope()` queries `project_assignments` — SPO only sees assigned projects on dashboard.
3. **SOM reports.program_state.create**: Bounded fallback — the route checks `hasActiveSpoForState()` server-side; if active SPO exists, returns 403 `program_state_spo_available`.
4. **Plan editability**: `isPlanCurrentlyEditable()` checks `approvals` table for reopen events after `last_final_approved_at`. Status alone is insufficient.
5. **Project final_approve**: Requires category='agreement' + category='budget' docs in `project_documents`.
6. **Report identity immutability**: `project_id`, `activity_id`, `report_type`, `state_id`, `sector`, `author_id` are immutable on PATCH.
7. **Full Operational Access (PM/SA)**: `resolveAccess()` in accessControl.ts allows PM/SA to bypass normal ownership gates; override_reason required for self-review override.
8. **Direct project assignments:** For state-scoped roles, direct entries in `project_assignments` are an additional record-level access path. The Access Inspector reports the assignment count and explicitly indicates when it can extend access beyond the normal State scope; it never exposes the assigned project IDs.
