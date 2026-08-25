# Global Full Operational Access Governance

**Version:** 1.0  
**Effective Date:** 2026-08-17  
**Authority:** Task #373 — CAFA PMIS Global Full Operational Access Governance  

---

## 1. Definition

**Full Operational Access** is the approved governance rule that grants **Program Manager (PM)** and **Super Admin** system-wide operational access across all CAFA PMIS modules.

Users holding Full Operational Access may perform any operationally valid action — create, view, edit, submit, review, approve, return, reject, archive, delete — subject only to:

- Structural / data-integrity rules (required fields, duplicate constraints, valid transitions)
- Approved exceptions listed in §7 (root-admin-only capabilities)
- Privacy boundary (§8)
- Accounting boundary (§9)

---

## 2. Program Manager Capabilities

PM holds all of the following permissions in `permissionsFor()`:

| Domain | Permissions |
|---|---|
| Projects | `projects.create`, `projects.update`, `projects.approve.final`, `projects.activate`, `projects.close`, `projects.delete` |
| Documents | `documents.upload`, `documents.view` |
| Reports | `reports.create`, `reports.approve.coordination`, `reports.approve.technical`, `reports.approve.final`, `reports.view` |
| Plans | `plans.create`, `plans.approve.final`, `plans.delete`, `plans.reopen` |
| Budget | `budget.view`, `budget.view.all`, `budget.create`, `budget.edit`, `budget.review`, `budget.approve.final` |
| Risks | `risks.create`, `risks.update` |
| Comments | `comments.create` |
| Communication Centre | `messages.create`, `messages.send`, `messages.manage_members` |
| Manual | `manual.edit`, `manual.edit.content` |
| Users | `users.view` |
| Dashboard/Audit | `dashboard.view.org`, `audit.view` |
| Universal | `notifications.view`, `manual.view`, `states.view`, `messages.view`, `program_resources.view` |

### Report Authorship

PM may author all report types:

- **Activity Reports** — operational access; any state/sector scope
- **Project Monthly Reports (PMR)** — operational access; any state/sector scope
- **HQ Sector Reports (HQSR)** — operational access; explicit canonical `sector` required in body; sector validity validated server-side
- **State Programme Reports (SPR)** — operational access; explicit `stateId` required in body (same requirement as super_admin); state existence validated server-side

### Self-Review / Self-Approval

PM may perform `coordination_review`, `technical_review`, or `final_approve` on a report they authored (self-review override). Requirements:

1. An explicit `overrideReason` string must be supplied in the transition request body.
2. The approval record is annotated: `used_override = TRUE`, `override_reason = <supplied text>`.
3. The audit log entry is annotated with the same values.

---

## 3. Super Admin Capabilities

Super Admin receives the `"*"` wildcard in `permissionsFor()` — all permission checks pass automatically.

**Additionally:** Super Admin may also self-review/self-approve reports with an override reason (same requirement as PM — `overrideReason` must be supplied).

**Super Admin-only capabilities** that PM does NOT have (§7) remain unchanged.

---

## 4. Normal vs Override Distinction

| Situation | Override? | Override Reason Required? |
|---|---|---|
| PM creates a project, plan, risk, comment | Normal operational access | No |
| PM creates any report type | Normal operational access | No |
| PM does `final_approve` (already their role) | No | No |
| PM does `coordination_review` on any report | Normal (permission granted) | No |
| PM does `technical_review` on any report | Normal (permission granted) | No |
| PM self-reviews their own report | Override | **Yes** |
| Super Admin self-reviews their own report | Override | **Yes** |
| PM edits any project/plan/risk/report draft | Normal operational access | No |

The `used_override = TRUE` / `override_reason` fields are recorded in the `approvals` and `audit_log` tables whenever the override path is taken.

---

## 5. Audit / Override Trail

Two database columns (added by Migration 020) capture override use:

### `approvals` table
| Column | Type | Description |
|---|---|---|
| `used_override` | `BOOLEAN NOT NULL DEFAULT FALSE` | True when PM/super_admin acted via override |
| `override_reason` | `TEXT` | Human-readable reason; non-null when `used_override = TRUE` |

### `audit_log` table
| Column | Type | Description |
|---|---|---|
| `used_override` | `BOOLEAN NOT NULL DEFAULT FALSE` | True when PM/super_admin acted via override |
| `override_reason` | `TEXT` | Human-readable reason; non-null when `used_override = TRUE` |

---

## 6. Data Integrity — What Is NOT Bypassed

Full Operational Access does NOT bypass:

- **Required field validation** — report/plan/project content gates still fire
- **Identity immutability** — `author_id`, `created_by`, programme state identity fields cannot be mutated after creation
- **Duplicate constraints** — uniqueness rules (e.g. one report per activity+state+period) still apply; 409 is returned
- **Workflow step ordering** — transitions must follow the approved workflow graph (Draft → Submitted → ... → Approved); no skipping steps
- **Budget arithmetic** — budget allocation, spending, and currency rules are not bypassed
- **Structural validation** — canonical report types, frequencies, sector names, state IDs, etc. must be valid

---

## 7. Super Admin-Only Technical Administration

The following capabilities are restricted to Super Admin (wildcard `"*"`) and are NOT granted to PM:

- User account creation, modification, and deletion (`users.create`, `users.edit`, `users.delete`)
- Permanent project deletion (requires super_admin role check beyond `projects.delete` permission)
- System configuration and secret management
- Any root-admin database or infrastructure operations

---

## 8. Privacy Boundary — Communication Centre

**PM Full Operational Access in the Communication Centre covers:**
- Creating group/project/sector/announcement conversations
- Managing conversation members
- Sending messages in conversations where PM is a member

**PM DOES NOT have access to:**
- Private direct messages (DMs) between other users where PM is not a participant
- Reading or moderating private 1-on-1 conversations covertly

This boundary is enforced at the query level: DM conversations are only returned to their participants. Full Operational Access does not grant PM surveillance of private communications.

**Super Admin** shares the same privacy boundary — the wildcard `"*"` permission does not override row-level participant filtering for DMs.

---

## 9. Accounting / Budget Boundary

Budget calculation rules, currency-aware formatting, and financial Segregation of Duties (SoD) constraints are NOT bypassed by Full Operational Access:

- PM cannot approve their own budget allocation (standard SoD — if PM created the budget entry, the same approval pathway applies)
- Spent/allocated/remaining amounts are always derived from real financial data, never overridden
- Currency-aware rules (formatCurrency, formatPercent) apply regardless of actor role

---

## 10. Future-Module Default Rule

**Any new CAFA PMIS module introduced after this governance rule takes effect must:**

1. Grant PM Full Operational Access by default (add permissions to the PM block in `permissionsFor()`)
2. Grant super_admin access via the existing `"*"` wildcard (no change required)
3. Document any module-specific privacy or accounting exceptions in this file

---

## 11. Superseded Constraints

The following previously documented constraints are superseded by this global governance rule **for PM and super_admin only**. Normal roles remain unchanged.

| Superseded Rule | Superseded By |
|---|---|
| "PM cannot author any report type" | PM may create all report types as operational access |
| "Universal self-review prohibition with no PM bypass" | PM/super_admin may self-review with override reason and audit trail |
| "PM cannot coordination_review except HQSR spc_fallback" | PM may coordination_review any report |
| "No super_admin bypass of self-review guard" | super_admin may self-review with override reason and audit trail |
| "TC, SPC, PM, ED, Viewer: NOT SPR authors" | PM superseded; TC/SPC/ED/Viewer unchanged |
| "SPO, SOM, PM, ED, Viewer: NOT HQ Sector authors" | PM superseded; SPO/SOM/ED/Viewer unchanged |
| "PM and SPC explicitly excluded as Activity Report authors" | PM superseded; SPC unchanged |

---

## 12. Implementation Reference

| Component | Location |
|---|---|
| Backend helper | `artifacts/api-server/src/lib/accessControl.ts` |
| PM permission block | `artifacts/api-server/src/middlewares/currentUser.ts` — `permissionsFor()` |
| Self-review override | `artifacts/api-server/src/routes/reports.ts` — transition handler |
| Author gates | `artifacts/api-server/src/routes/reports.ts` — POST /reports |
| Override audit columns | Migration 020 in `artifacts/api-server/src/lib/run-migrations.ts` |
| DB schema | `lib/db/src/schema/index.ts` — `approvalsTable`, `auditLogTable` |
| Frontend helper | `artifacts/cafa-pmis/src/lib/permissions.ts` — `hasFullOperationalAccess()` |
| Zod schema | `lib/api-zod/src/generated/api.ts` — `TransitionReportBody` |
