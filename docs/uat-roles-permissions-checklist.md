# CAFA PMIS — UAT Roles & Permissions Verification Checklist

**System:** CAFA PMIS  
**Phase:** User Acceptance Testing (UAT)  
**Tester:** ___________________________  
**Date:** ___________________________  
**Environment:** ___________________________

> **How to use:** Log in as each demo user, perform each check, mark **PASS** ✅ or **FAIL** ❌.  
> Demo password for all users: **`cafa2026`**

---

## Role Reference

| # | Role | Username | Scope |
|---|---|---|---|
| 1 | Executive Director | `fatima` (use `executive_director` switcher) | All states / All sectors |
| 2 | Program Manager | `fatima` | All states / All sectors |
| 3 | Senior Program Coordinator | `ahmed.m` | HQ |
| 4 | Technical Coordinator | `hassan` | Assigned sector only |
| 5 | State Program Officer | `mona` | Assigned state only |
| 6 | State Office Manager | *(switch to state_manager user)* | Assigned state — monitoring only |
| 7 | Viewer | **⚠️ NOT CONFIGURED** — No Viewer role exists in this system. Closest equivalent is State Office Manager (read-only). |

---

## 1 — Executive Director

**Login:** Use role switcher → select Executive Director  
**Expected:** Read-only oversight across all states and sectors

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible | ☐ PASS ☐ FAIL |
| Planning | ✅ Visible | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (full org view) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible | ☐ PASS ☐ FAIL |
| Notifications | ✅ Visible | ☐ PASS ☐ FAIL |
| Messages | ✅ Visible | ☐ PASS ☐ FAIL |
| Users | ✅ Visible (read-only) | ☐ PASS ☐ FAIL |
| States | ✅ Visible | ☐ PASS ☐ FAIL |
| Audit Log | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ✅ Visible | ☐ PASS ☐ FAIL |
| Document Repository | ✅ Visible | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| View any project from any state | ✅ Allowed | ☐ PASS ☐ FAIL |
| View any report from any sector | ✅ Allowed | ☐ PASS ☐ FAIL |
| View full budget (all donors, all states) | ✅ Allowed | ☐ PASS ☐ FAIL |
| View all risks | ✅ Allowed | ☐ PASS ☐ FAIL |
| View users list | ✅ Allowed | ☐ PASS ☐ FAIL |
| View audit log | ✅ Allowed | ☐ PASS ☐ FAIL |
| Post comments on projects/reports | ✅ Allowed | ☐ PASS ☐ FAIL |

### Restricted Actions
| Test | Expected | Result |
|---|---|---|
| Create a new project | ❌ Button absent / 403 | ☐ PASS ☐ FAIL |
| Approve a project (any stage) | ❌ Transition buttons absent | ☐ PASS ☐ FAIL |
| Edit a report | ❌ Edit button absent / 403 | ☐ PASS ☐ FAIL |
| Create or edit a user | ❌ Create/Edit buttons absent | ☐ PASS ☐ FAIL |
| Upload a document | ❌ 403 | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 2 — Program Manager

**Login:** `fatima` / `cafa2026`  
**Expected:** Final approver for projects, reports, plans. Full HQ management.

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (full org view) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible | ☐ PASS ☐ FAIL |
| Users | ✅ Visible (read + manage invitation) | ☐ PASS ☐ FAIL |
| Audit Log | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ❌ Hidden | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| Create a new project | ✅ Allowed | ☐ PASS ☐ FAIL |
| Submit a project for approval | ✅ Allowed | ☐ PASS ☐ FAIL |
| Final-approve a project (coordination_approved → approved) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Activate a project (approved → active) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Close a project (active → closed) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Final-approve a report | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create/edit plans | ✅ Allowed | ☐ PASS ☐ FAIL |
| Final-approve a plan | ✅ Allowed | ☐ PASS ☐ FAIL |
| Edit System Manual content | ✅ Allowed | ☐ PASS ☐ FAIL |
| Upload documents | ✅ Allowed | ☐ PASS ☐ FAIL |
| Post comments (all types) | ✅ Allowed | ☐ PASS ☐ FAIL |
| View users list | ✅ Allowed (read) | ☐ PASS ☐ FAIL |

### Restricted Actions
| Test | Expected | Result |
|---|---|---|
| Create / edit a user account | ❌ 403 (super_admin only) | ☐ PASS ☐ FAIL |
| Access AI Settings page | ❌ Hidden / redirect | ☐ PASS ☐ FAIL |
| Technically-approve a project (must be TC step) | ❌ Transition absent | ☐ PASS ☐ FAIL |

### Accessible Data
| Test | Expected | Result |
|---|---|---|
| Projects — all states, all sectors | ✅ All visible | ☐ PASS ☐ FAIL |
| Reports — all states, all sectors | ✅ All visible | ☐ PASS ☐ FAIL |
| Budget — full org view | ✅ All donors/states | ☐ PASS ☐ FAIL |
| Risks — all projects | ✅ All visible | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 3 — Senior Program Coordinator

**Login:** `ahmed.m` / `cafa2026`  
**Expected:** Coordination-stage approver. HQ-level create/edit. No final approval.

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (full org view) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible | ☐ PASS ☐ FAIL |
| Users | ✅ Visible (read-only) | ☐ PASS ☐ FAIL |
| Audit Log | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ❌ Hidden | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| Create a new project | ✅ Allowed | ☐ PASS ☐ FAIL |
| Coordination-approve a project (technically_approved → coordination_approved) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Coordination-approve a report | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create/edit/approve plans (coordination stage) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create and update risks | ✅ Allowed | ☐ PASS ☐ FAIL |
| Upload documents | ✅ Allowed | ☐ PASS ☐ FAIL |
| Edit System Manual content | ✅ Allowed | ☐ PASS ☐ FAIL |
| Post comments | ✅ Allowed | ☐ PASS ☐ FAIL |
| View full budget | ✅ Allowed | ☐ PASS ☐ FAIL |

### Restricted Actions
| Test | Expected | Result |
|---|---|---|
| Final-approve a project (coordination_approved → approved) | ❌ Transition absent / 403 | ☐ PASS ☐ FAIL |
| Activate or close a project | ❌ Transition absent | ☐ PASS ☐ FAIL |
| Final-approve a report | ❌ Transition absent | ☐ PASS ☐ FAIL |
| Create / edit a user account | ❌ 403 | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 4 — Technical Coordinator

**Login:** `hassan` / `cafa2026`  
**Expected:** Technical-stage approver. Restricted to assigned sector(s) only.

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible (sector-scoped KPIs) | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible (assigned sector only) | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (sector view only) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible (assigned sector only) | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible (assigned sector only) | ☐ PASS ☐ FAIL |
| Users | ❌ Hidden | ☐ PASS ☐ FAIL |
| Audit Log | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ❌ Hidden | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| Technically-approve a project in assigned sector (submitted → technically_approved) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create a report for assigned sector | ✅ Allowed | ☐ PASS ☐ FAIL |
| Update indicators on assigned-sector projects | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create/update risks in assigned sector | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create/update plans in assigned sector | ✅ Allowed | ☐ PASS ☐ FAIL |
| Upload documents to assigned-sector projects | ✅ Allowed | ☐ PASS ☐ FAIL |
| Post comments on assigned-sector entities | ✅ Allowed | ☐ PASS ☐ FAIL |

### Restricted Actions (Sector Guard)
| Test | Expected | Result |
|---|---|---|
| View a project outside assigned sector | ❌ 403 / Not listed | ☐ PASS ☐ FAIL |
| Approve a project outside assigned sector | ❌ 403 | ☐ PASS ☐ FAIL |
| View a report outside assigned sector | ❌ 403 / Not listed | ☐ PASS ☐ FAIL |
| View risks with no project link | ❌ Excluded from list | ☐ PASS ☐ FAIL |
| Final-approve or coordination-approve any project | ❌ Transition absent | ☐ PASS ☐ FAIL |
| View users list | ❌ Hidden | ☐ PASS ☐ FAIL |
| Edit System Manual | ❌ Edit buttons absent | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 5 — State Program Officer

**Login:** `mona` / `cafa2026`  
**Expected:** Operational creator for assigned state. Cannot see other states' data.

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible (state-scoped) | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible (assigned state only) | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (state view only) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible (assigned state only) | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible (assigned state only) | ☐ PASS ☐ FAIL |
| Users | ❌ Hidden | ☐ PASS ☐ FAIL |
| Audit Log | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ❌ Hidden | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| Create a new project (for assigned state) | ✅ Allowed | ☐ PASS ☐ FAIL |
| Update a project in assigned state | ✅ Allowed | ☐ PASS ☐ FAIL |
| Submit a project for approval | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create a monthly / quarterly report | ✅ Allowed | ☐ PASS ☐ FAIL |
| Update report content and activities | ✅ Allowed | ☐ PASS ☐ FAIL |
| Submit a report | ✅ Allowed | ☐ PASS ☐ FAIL |
| Log a risk on an assigned-state project | ✅ Allowed | ☐ PASS ☐ FAIL |
| Create/update a plan for assigned state | ✅ Allowed | ☐ PASS ☐ FAIL |
| Upload documents | ✅ Allowed | ☐ PASS ☐ FAIL |
| Register beneficiaries in project form | ✅ Allowed | ☐ PASS ☐ FAIL |

### Restricted Actions
| Test | Expected | Result |
|---|---|---|
| Approve a project at any stage | ❌ Transition buttons absent | ☐ PASS ☐ FAIL |
| Approve a report | ❌ Transition buttons absent | ☐ PASS ☐ FAIL |
| Post comments on projects/reports | ❌ Comment panel hidden / 403 | ☐ PASS ☐ FAIL |
| View users list | ❌ Hidden | ☐ PASS ☐ FAIL |
| Edit System Manual | ❌ Edit buttons absent | ☐ PASS ☐ FAIL |
| View full org-wide budget | ❌ State-scoped only | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 6 — State Office Manager

**Login:** Switch to state_manager user  
**Expected:** Monitoring only for assigned state. Zero write authority.

### Sidebar Visibility
| Item | Expected | Result |
|---|---|---|
| Dashboard | ✅ Visible (state-scoped) | ☐ PASS ☐ FAIL |
| Projects | ✅ Visible (assigned state, read-only) | ☐ PASS ☐ FAIL |
| Budget | ✅ Visible (state view, read-only) | ☐ PASS ☐ FAIL |
| Reports | ✅ Visible (assigned state, read-only) | ☐ PASS ☐ FAIL |
| Risks | ✅ Visible (assigned state, read-only) | ☐ PASS ☐ FAIL |
| Users | ❌ Hidden | ☐ PASS ☐ FAIL |
| Messages | ✅ Visible | ☐ PASS ☐ FAIL |
| AI Settings | ❌ Hidden | ☐ PASS ☐ FAIL |

### Allowed Actions
| Test | Expected | Result |
|---|---|---|
| View project detail for assigned state | ✅ Allowed | ☐ PASS ☐ FAIL |
| View report detail for assigned state | ✅ Allowed | ☐ PASS ☐ FAIL |
| View risk detail for assigned state | ✅ Allowed | ☐ PASS ☐ FAIL |
| View state budget | ✅ Allowed | ☐ PASS ☐ FAIL |
| View documents on projects | ✅ Allowed | ☐ PASS ☐ FAIL |
| View audit log | ✅ Allowed | ☐ PASS ☐ FAIL |

### Restricted Actions
| Test | Expected | Result |
|---|---|---|
| Create a new project | ❌ Create button absent / 403 | ☐ PASS ☐ FAIL |
| Edit any project | ❌ Edit button absent / 403 | ☐ PASS ☐ FAIL |
| Submit or approve a project | ❌ Transition buttons absent | ☐ PASS ☐ FAIL |
| Create or submit a report | ❌ Create button absent / 403 | ☐ PASS ☐ FAIL |
| Log a risk | ❌ Create button absent / 403 | ☐ PASS ☐ FAIL |
| Upload a document | ❌ Upload button absent / 403 | ☐ PASS ☐ FAIL |
| Post a comment | ❌ Comment panel hidden / 403 | ☐ PASS ☐ FAIL |

**Section Result:** ☐ ALL PASS ☐ FAILURES — count: _____

---

## 7 — "Viewer" Role

> ⚠️ **NOT CONFIGURED.** There is no "Viewer" role in the current system.
>
> The system has exactly **7 roles**: super_admin, executive_director, program_manager, senior_coordinator, technical_coordinator, state_manager, state_officer.
>
> **Recommendation:** If a read-only observer role is required for donors or external reviewers, add a new `viewer` role with `{ notifications.view, manual.view, states.view }` permissions and no module write access. This is a post-UAT backlog item.

**Status:** ☐ Accepted as known gap ☐ Raised as defect

---

---

# State Security Guard Tests

> **Objective:** Verify that State Program Officers and State Office Managers are strictly isolated to their assigned state. No cross-state data leakage is permitted.

## Test Setup

Identify two states in the system, e.g.:
- **State A** = Officer's assigned state (e.g., Khartoum)
- **State B** = A different state (e.g., Red Sea)

Confirm at least one project, report, and risk exists in **State B**.

---

## State Program Officer — State Isolation

**Login:** `mona` / `cafa2026` (or any state_officer)

| Test | Action | Expected | Result |
|---|---|---|---|
| **P-01** | Open Projects list | Only State A projects visible. State B projects absent. | ☐ PASS ☐ FAIL |
| **P-02** | Manually add `?stateId=<stateB_id>` to the Projects URL | Still shows only State A projects (server enforces override) | ☐ PASS ☐ FAIL |
| **P-03** | Try to open a State B project URL directly (`/projects/<state_b_id>`) | 403 Forbidden or redirect | ☐ PASS ☐ FAIL |
| **P-04** | Open Reports list | Only State A reports visible | ☐ PASS ☐ FAIL |
| **P-05** | Manually add `?stateId=<stateB_id>` to Reports URL | Still shows only State A reports | ☐ PASS ☐ FAIL |
| **P-06** | Try to open a State B report URL directly | 403 Forbidden | ☐ PASS ☐ FAIL |
| **P-07** | Open Risks list | Only risks linked to State A projects visible | ☐ PASS ☐ FAIL |
| **P-08** | Try to log a risk linked to a State B project | State B project does not appear in project picker | ☐ PASS ☐ FAIL |
| **P-09** | Open Plans list | Only State A plans visible | ☐ PASS ☐ FAIL |
| **P-10** | Create a project — State selector | Only State A available, cannot select State B | ☐ PASS ☐ FAIL |
| **P-11** | Dashboard KPIs | Show counts scoped to State A only | ☐ PASS ☐ FAIL |
| **P-12** | Budget view | Shows State A allocation only | ☐ PASS ☐ FAIL |

**State Officer Guard Result:** _____ / 12 passed

---

## State Office Manager — State Isolation

**Login:** Switch to state_manager user

| Test | Action | Expected | Result |
|---|---|---|---|
| **M-01** | Open Projects list | Only State A projects visible | ☐ PASS ☐ FAIL |
| **M-02** | Manually add `?stateId=<stateB_id>` to Projects URL | Still shows only State A projects | ☐ PASS ☐ FAIL |
| **M-03** | Open a State B project URL directly | 403 Forbidden | ☐ PASS ☐ FAIL |
| **M-04** | Open Reports list | Only State A reports visible | ☐ PASS ☐ FAIL |
| **M-05** | Open a State B report URL directly | 403 Forbidden | ☐ PASS ☐ FAIL |
| **M-06** | Open Risks list | Only State A risks visible | ☐ PASS ☐ FAIL |
| **M-07** | Dashboard KPIs | Scoped to State A only | ☐ PASS ☐ FAIL |
| **M-08** | Budget view | State A only | ☐ PASS ☐ FAIL |

**State Manager Guard Result:** _____ / 8 passed

---

## Technical Coordinator — Sector Isolation

**Login:** `hassan` / `cafa2026`

| Test | Action | Expected | Result |
|---|---|---|---|
| **T-01** | Open Projects list | Only projects in hassan's assigned sector(s) visible | ☐ PASS ☐ FAIL |
| **T-02** | Open a project outside assigned sector directly | 403 Forbidden | ☐ PASS ☐ FAIL |
| **T-03** | Open Reports list | Only reports in assigned sector(s) visible | ☐ PASS ☐ FAIL |
| **T-04** | Open a report outside assigned sector directly | 403 Forbidden | ☐ PASS ☐ FAIL |
| **T-05** | Open Risks list | Only risks linked to assigned-sector projects visible | ☐ PASS ☐ FAIL |
| **T-06** | TC with no sector assigned | All lists show empty (deny-all, not open) | ☐ PASS ☐ FAIL |

**TC Sector Guard Result:** _____ / 6 passed

---

---

# Notifications Access Matrix

| Role | Receives Notifications | Types |
|---|---|---|
| Executive Director | ✅ | All system events |
| Program Manager | ✅ | Submissions requiring final approval, documents uploaded |
| Senior Coordinator | ✅ | Items at coordination stage |
| Technical Coordinator | ✅ | Sector-scoped items at technical stage |
| State Program Officer | ✅ | Own project/report transitions, rejections, revisions |
| State Office Manager | ✅ | State-level workflow events (read-only) |

| Test | Expected | Result |
|---|---|---|
| State officer receives notification when their project is technically approved | ✅ | ☐ PASS ☐ FAIL |
| State officer receives notification when their report is returned for revision | ✅ | ☐ PASS ☐ FAIL |
| Program Manager receives notification when a report reaches final approval stage | ✅ | ☐ PASS ☐ FAIL |
| TC receives notification only for sector-scoped items | ✅ | ☐ PASS ☐ FAIL |
| State officer does NOT receive notifications for other states' projects | ❌ | ☐ PASS ☐ FAIL |

---

---

# UAT Summary

## Results by Role

| Role | Sidebar | Actions | Restrictions | Data Access | Result |
|---|---|---|---|---|---|
| Executive Director | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |
| Program Manager | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |
| Senior Program Coordinator | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |
| Technical Coordinator | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |
| State Program Officer | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |
| State Office Manager | ☐ | ☐ | ☐ | ☐ | ☐ PASS ☐ FAIL |

## State Security Guard Summary

| Guard | Tests | Passed | Failed |
|---|---|---|---|
| State Officer isolation | 12 | ___ | ___ |
| State Manager isolation | 8 | ___ | ___ |
| TC Sector isolation | 6 | ___ | ___ |
| Notifications cross-state | 5 | ___ | ___ |
| **Total** | **31** | **___** | **___** |

## Known Gaps / Open Items

| # | Item | Priority | Owner | Status |
|---|---|---|---|---|
| 1 | "Viewer" role not implemented | Low — post-UAT | Engineering | Open |
| 2 | State API enforcement: state roles blocked at API level from cross-state projects, reports (aggregates + transitions), and risks (PATCH + history). `assertStateAllowed` helper added to `currentUser.ts`; applied to all 9 project sub-routes + 2 report routes + 2 risk routes. `dashboard.ts` `userScope()` extended to cover `state_officer` in addition to `state_manager`. | Medium | Engineering | ✅ **RESOLVED** — 2026-06-03 |
| 3 | Dashboard aggregates TC sector-scope: `userScope()` in `dashboard.ts` now correctly restricts `state_officer` and `state_manager` roles; sector restriction already applied via `tcSectorRestriction`. | Medium | Engineering | ✅ **RESOLVED** — 2026-06-03 |
| 4 | Comments API permission gate: `requirePerm("comments.create")` added to `GET /comments`, `PATCH /comments/:id`, and `DELETE /comments/:id`. State roles (no `comments.create` perm) now receive HTTP 403 at the API level. | Medium | Engineering | ✅ **RESOLVED** — 2026-06-03 |

### Automated Verification — 2026-06-03

All medium-priority findings verified by automated smoke tests against the running server:

| Test | Scenario | Expected | Result |
|---|---|---|---|
| T-01 | `state_manager` (`mona`) accesses Al Jazeera project via API | HTTP 403 | ✅ PASS |
| T-02 | `state_manager` (`mona`) accesses own Khartoum project via API | HTTP 200 | ✅ PASS |
| T-03 | `state_manager` (`mona`) calls `GET /comments` | HTTP 403 | ✅ PASS |
| T-04 | `state_manager` (`mona`) sends `?stateId=2` to override project list | Only Khartoum/multi-state projects returned | ✅ PASS |
| T-05 | `super_admin` (`amira`) calls `GET /comments` | HTTP 200 | ✅ PASS |
| T-06 | `state_manager` (`mona`) calls `GET /reports/:id/aggregates` for West Darfur report | HTTP 403 | ✅ PASS |
| T-07 | `state_manager` (`mona`) calls `GET /reports/:id/aggregates` for Khartoum report | HTTP 200 | ✅ PASS |
| T-08 | `state_manager` (`mona`) dashboard summary | Returns Khartoum-scoped counts only | ✅ PASS |
| T-09 | `state_manager` (`mona`) `PATCH /risks/:id` for non-Khartoum risk | HTTP 403 | ✅ PASS |

---

## Sign-off

| Name | Role | Date | Signature |
|---|---|---|---|
| | UAT Lead | | |
| | Technical Lead | | |
| | Product Owner | | |

**Overall UAT Status:** ☐ PASSED — Ready for deployment ☐ FAILED — Defects to resolve ☐ CONDITIONAL PASS — Minor items acceptable
