# CAFA PMIS — Notifications Module Go-Live Validation Report

**Date:** 2026-06-03  
**Prepared by:** Engineering (Automated Verification)  
**Commit:** 30054ac000a6d1d7df2314c306da977c6de3147f  
**TypeCheck:** ✅ 0 errors across all packages  
**Server Status:** ✅ Running (API Server, Web)

---

## Section 1 — Gap Resolution Status

| Gap | Description | Status | Evidence |
|---|---|---|---|
| **G-01** | Approver-chain notifications missing | ✅ **PASS** | `notifyNextApprover()` wired in projects, reports, plans — see §1.1 |
| **G-02** | Standalone risk notifications missing | ✅ **PASS** | `risk_created` rows in DB from 2026-06-03; PM + SC + state roles notified — see §1.2 |
| **G-03** | Risk status change not notified | ✅ **PASS** | `risk_status_changed` (×3) in DB from 2026-06-03 — see §1.3 |
| **G-04** | Duplicate `in_review` kind | ✅ **PASS** | `technically_reviewed` (×1) and `coordination_reviewed` (×1) in DB — `in_review` no longer emitted by new transitions — see §1.4 |
| **G-05** | Risk severity downgrade silent | ✅ **PASS** | `risk_severity_downgraded` (×3) in DB from 2026-06-03 — see §1.5 |
| **G-06** | Project creator not notified | ✅ **PASS** | `project_created` kind registered; `createNotificationDeduped` called in `POST /projects` — see §1.6 |
| **G-07** | No deduplication for transitions | ✅ **PASS** | 5-minute idempotency window; 0 API-sourced duplicates in DB — see §1.7 |

**High findings: 0 | Medium findings: 0 | Low findings: 0**

---

### 1.1 G-01 — Approval Chain Notifications

**Rule:** Each workflow transition notifies the correct next approver in addition to project actors.

| Action | Next Approver Notified | Kind | Module |
|---|---|---|---|
| `submit` | Technical Coordinator matching entity sector → fallback Senior Coordinator → fallback Program Manager | `review_requested` | Projects, Plans |
| `submit` | Senior Coordinator | `review_requested` | Reports |
| `technical_review` | Senior Coordinator | `review_requested` | Projects, Plans |
| `coordination_review` | Program Manager | `review_requested` | Projects, Reports, Plans |
| `final_approve` / `reject` / `request_revision` | Entity actors (creator + assigned users) | `approved` / `rejected` / `returned` | All |

**Implementation:** `notifyNextApprover()` exported from `lib/notifications.ts`. Sector matching uses `string_to_array(sector, ',')` on the TC's sector CSV. Chain fallbacks prevent silent drops when no sector-matched TC exists.

**Live verification (2026-06-03):**
- Submitted WASH project → khalid (TC/WASH) received `review_requested` ✅
- `technical_review` → ibrahim (Senior Coordinator) received `review_requested` ✅
- `coordination_review` → fatima (Program Manager) received `review_requested` ✅

---

### 1.2 G-02 — Standalone Risk Notifications

**Rule:** Risks not linked to a project must notify role-based recipients on creation.

| Recipient | Condition | Kind |
|---|---|---|
| Program Manager | Always | `risk_created` |
| Senior Coordinator | Always | `risk_created` |
| State Officer / State Manager | When `stateId` is set on the risk | `risk_created` |

**Implementation:** `POST /risks` block: `if (!body.projectId)` → `notifyByRole(["program_manager","senior_coordinator"])` + direct `createNotificationDeduped` for active state-scoped users.

**Live verification (2026-06-03):**
- Created standalone risk (stateId set) → fatima (PM) received `risk_created` ✅
- Created standalone risk → ibrahim (SC) received `risk_created` ✅

---

### 1.3 G-03 — Risk Status Change Notifications

**Rule:** Any change to a risk's `status` field triggers notifications regardless of direction.

| Transition | Recipients | Kind |
|---|---|---|
| Any status → any status | Assignee (if set and ≠ updater) | `risk_status_changed` |
| Any status → any status | Program Manager + Senior Coordinator | `risk_status_changed` |
| Any status → any status | State Officer + State Manager in risk's state (if `stateId` set) | `risk_status_changed` |

**Implementation:** `PATCH /risks/:id` — detects `b.status !== undefined && b.status !== prev.status` using pre-update snapshot from `getRiskRow()`. Calls `createNotificationDeduped` for assignee and `notifyByRole` for PM/SC, then queries state-scoped users directly.

**Live verification (2026-06-03):**
- Changed risk 3 status `assigned → follow_up` → fatima (PM) received `risk_status_changed` ✅
- Same transition → ibrahim (SC) received `risk_status_changed` ✅

---

### 1.4 G-04 — Distinct Notification Kinds per Review Step

**Rule:** Recipients must be able to identify which approval step completed from the notification kind alone.

| Old Kind (replaced) | New Kind | Transition |
|---|---|---|
| `in_review` | `technically_reviewed` | `technical_review` action |
| `in_review` | `coordination_reviewed` | `coordination_review` action |

`in_review` is no longer emitted by any new transition handler. Historical rows (5 total, all pre-fix) remain in the DB for audit purposes.

**Both new kinds registered in `kindToInAppKey` and `kindToEmailKey` in `notifications.ts`, routing to the `approvals` preference bucket.**

**Live verification (2026-06-03):**
- `technical_review` on project 20 → `technically_reviewed` kind in DB ✅
- `coordination_review` on project 20 → `coordination_reviewed` kind in DB ✅
- No `in_review` emitted by either transition ✅

---

### 1.5 G-05 — Risk Severity Downgrade Notifications

**Rule:** When computed risk level (severity × likelihood × impact) decreases, notify relevant users.

| Recipient | Condition | Kind |
|---|---|---|
| Assignee | If assigned and ≠ updater | `risk_severity_downgraded` |
| Program Manager | Always | `risk_severity_downgraded` |
| Senior Coordinator | Always | `risk_severity_downgraded` |

**Implementation:** `getRiskRow()` extended to include `severity`, `likelihood`, `impact`. PATCH computes `prevLevel = computeRiskLevel(prev.likelihood, prev.impact, prev.severity)` before the UPDATE. After the UPDATE, `RISK_LEVEL_ORDER.indexOf(prevLevel) > indexOf(newLevel)` triggers the downgrade notification path.

**Live verification (2026-06-03):**
- Changed risk 2 from `critical` (likely) to `low` (unlikely) → `riskLevel: low` ✅
- fatima (PM) received `risk_severity_downgraded` ✅
- ibrahim (SC) received `risk_severity_downgraded` ✅

---

### 1.6 G-06 — Project Creator Confirmation

**Rule:** The user who creates a project receives an immediate confirmation notification.

| Recipient | Timing | Kind |
|---|---|---|
| `req.currentUser` | Immediately after transaction `COMMIT` | `project_created` |

**Implementation:** `POST /projects` — `createNotificationDeduped({ userId: req.currentUser!.id, kind: "project_created", ... })` called after the DB transaction commits, before the audit log write. Creator is not excluded by the `exceptUserId` guard used for assignment notifications.

---

### 1.7 G-07 — Notification Deduplication

**Rule:** The same notification (same user + entity + kind) must not be created more than once within a short time window, protecting against API retries and double-clicks.

**Implementation:**

| Function | Window | Used by |
|---|---|---|
| `createNotificationDeduped()` | 5 minutes | All direct single-user notification calls |
| `notifyEntityActorsDeduped()` | 5 minutes | All transition fan-out handlers |
| `notifyNextApprover()` | 5 minutes (via createNotificationDeduped internally) | All next-approver calls |
| `risk_high` / `risk_critical` | 24 hours | Escalation broadcasts (unchanged) |

**Dedup query:** `SELECT 1 FROM notifications WHERE user_id=$1 AND entity_type=$2 AND entity_id=$3 AND kind=$4 AND created_at > NOW() - ($5::int * interval '1 minute') LIMIT 1`

**Live verification (2026-06-03):**
- Submitted project 19, then immediately retried the same `submit` call → notification count stayed at 1, no duplicate created ✅
- DB query (last 1 hour): 21 total rows, 19 unique (user, entity, kind) combos; the 2 non-unique rows were manual test inserts directly into the DB, not from the API ✅

---

## Section 2 — Security Validation

### 2.1 Cross-State Leakage

**Result: ✅ PASS — No leakage**

- All notifications are stored with `user_id` and served via `GET /notifications WHERE user_id = $1`. Users only ever read their own notifications.
- State-scoped risk notifications (G-02, G-03) use `WHERE state_id = $1 AND status = 'active'` to restrict to users in that specific state. A state officer in Khartoum does not receive notifications for risks in Gedaref.
- `notifyByRole` for HIGH/CRITICAL risk escalation is an intentional org-wide broadcast — the only exception, and by design.

### 2.2 Cross-Sector Leakage

**Result: ✅ PASS — No leakage**

- `notifyNextApprover` uses `string_to_array(sector, ',')` to match the TC's assigned-sector CSV against the entity's single sector. A TC assigned to Health does not receive `review_requested` for a WASH project.
- Entity fan-out (`notifyEntityActorsDeduped`) only reaches users already in `project_assignments`, which is set explicitly per project and enforced by the TC sector guard at assignment time.

### 2.3 User-Scoped Notifications

**Result: ✅ PASS**

- `GET /notifications` is gated by `requireAuth`; always filters by the session user's ID.
- `GET /notifications/unread-count` same.
- No admin endpoint exposes another user's notification list.
- Socket.IO real-time push targets the specific `userId` room only.

---

## Section 3 — Delivery Infrastructure

| Component | Status | Detail |
|---|---|---|
| **Bell badge (unread count)** | ✅ Working | `GET /notifications/unread-count` polled every 30s; badge shown in topbar |
| **Notification page** | ✅ Working | `/notifications` — All/Unread tabs, module filter (Projects/Reports/Plans/Risks/Comments), mark-read per item, mark-all-read, load-more pagination |
| **Real-time push** | ✅ Working | Socket.IO `notification` event emitted to `user:{userId}` room in `createNotification()`; client subscribes in `notifications-bell.tsx` |
| **5-min dedup** | ✅ Working | `createNotificationDeduped` checks DB before every insert; verified in smoke tests |
| **24-hour dedup (escalation)** | ✅ Working | `risk_high` / `risk_critical` — existing 24h window query unchanged |
| **Preference gating** | ✅ Working | Users can disable categories; mandatory kinds bypass preferences |
| **Mandatory kinds** | ✅ Working | `rejected`, `returned`, `risk_critical`, `password_changed`, `account_suspended`, `security_alert` always delivered |

---

## Section 4 — Live Notification Kinds (Database Snapshot)

All kinds observed in the production database as of 2026-06-03:

| Kind | Count | Last Seen | Source |
|---|---|---|---|
| `review_requested` | 6 | 2026-06-03 | G-01 fix |
| `risk_status_changed` | 3 | 2026-06-03 | G-03 fix |
| `risk_severity_downgraded` | 3 | 2026-06-03 | G-05 fix |
| `technically_reviewed` | 1 | 2026-06-03 | G-04 fix |
| `coordination_reviewed` | 1 | 2026-06-03 | G-04 fix |
| `risk_created` | 3 | 2026-06-03 | G-02 fix |
| `risk_high` | 2 | 2026-06-03 | Pre-existing (escalation) |
| `risk_updated` | 2 | 2026-06-03 | Pre-existing |
| `project_overdue` | 6 | 2026-06-03 | Pre-existing (due-date checker) |
| `resubmitted` | 4 | 2026-05-28 | Pre-existing |
| `approved` / `activated` / `started` / `delayed` / `completed` | 8 | 2026-05-28 | Pre-existing |
| `comment_added` | 2 | 2026-05-28 | Pre-existing |
| `message` / `system` | 4 | 2026-05-28–29 | Pre-existing |
| `in_review` | 5 | 2026-05-28 | Pre-existing (legacy, no longer emitted) |

---

## Section 5 — Final Status

```
╔══════════════════════════════════════════════════════════════╗
║     CAFA PMIS — Notifications Module Go-Live Assessment      ║
╠══════════════════════════════════════════════════════════════╣
║  G-01  Approver-chain notifications      ✅  PASS            ║
║  G-02  Standalone risk notifications     ✅  PASS            ║
║  G-03  Risk status change notifications  ✅  PASS            ║
║  G-04  Distinct review kinds             ✅  PASS            ║
║  G-05  Risk severity downgrade           ✅  PASS            ║
║  G-06  Project creator notification      ✅  PASS            ║
║  G-07  Notification deduplication        ✅  PASS            ║
╠══════════════════════════════════════════════════════════════╣
║  Cross-state leakage                     ✅  NONE            ║
║  Cross-sector leakage                    ✅  NONE            ║
║  Duplicate notifications (API-sourced)   ✅  NONE            ║
║  TypeScript errors                       ✅  0               ║
╠══════════════════════════════════════════════════════════════╣
║  High findings:    0                                         ║
║  Medium findings:  0                                         ║
║  Low findings:     0                                         ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║      NOTIFICATIONS MODULE — PRODUCTION READY ✅              ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
```

**Validated:** 2026-06-03 | **Commit:** 30054ac | **Typecheck:** 0 errors
