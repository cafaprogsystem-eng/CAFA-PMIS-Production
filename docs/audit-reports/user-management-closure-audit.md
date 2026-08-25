# User Management Hardening — Closure Audit Report
*Task 42 · Verified 2026-08-20*

---

## 1. Verified Architecture

### 1.1 Canonical Roles (server-authoritative, unchanged)

| Value | Label | Scope |
|---|---|---|
| `super_admin` | Super Admin | Global |
| `executive_director` | Executive Director | Global |
| `program_manager` | Programme Manager | Global |
| `senior_program_coordinator` | Senior Programme Coordinator | Global |
| `technical_coordinator` | Technical Coordinator | Sector-scoped |
| `state_office_manager` | State Office Manager | State-scoped |
| `state_program_officer` | State Programme Officer | State-scoped |
| `viewer` | Viewer (Read-only) | Global |

### 1.2 Permission Architecture

| Operation | Permission required |
|---|---|
| Read user directory, switcher, summary | `users.view` |
| Create, update, status, delete users, manage invitations | `users.manage` |
| Invitation list (token-free) | `users.manage` |

`super_admin` receives `users.manage` via the wildcard grant. `program_manager` and below cannot create, edit, or manage users. The existing `requirePerm()` middleware attaches a `permissions` array derived from the authoritative `permissionsFor()` helper; the active-account gate (`status === 'active'`) is enforced on every request via `attachCurrentUser`.

### 1.3 Scope Rules

- **State-scoped roles** (`state_office_manager`, `state_program_officer`): `stateId` is required on create/edit; retained only while role stays state-scoped. Cleared on role change to non-state role.
- **Technical Coordinator**: `sector` is required; retained only while role is `technical_coordinator`. Cleared on role change.
- **All other roles**: state and sector assignments are cleared.
- The effective scope is validated server-side before the database write on every create or PATCH.

### 1.4 Identity Normalisation

- Email and username are trimmed and lowercased before storage.
- Migration `035_user_identity_uniqueness` adds:
  - `users_normalised_email_unique` on `LOWER(email)` (UNIQUE, partial: non-deleted)
  - `users_normalised_username_unique` on `LOWER(username)` (UNIQUE, partial: non-null)
- Migration fails loudly with a pre-flight check if historical cosmetic duplicates exist, rather than silently discarding records.

### 1.5 Self-Mutation Guards

| Attempt | Response |
|---|---|
| Actor changes their own role, stateId, sector, or status (other than allowed) | `423 cannot_modify_own_access` |
| Actor changes their own status (e.g. deactivate self) | `423 cannot_change_own_status` |
| Actor issues reset-password via invite mode for own account | `400 cannot_reset_own_password_as_invite` |

### 1.6 Invitation Token Security

- Invitation tokens are **never** included in directory (`GET /users`) or invitation-list (`GET /users/invitations`) responses.
- Tokens are returned exactly once: at creation (`POST /users`) and at resend (`POST /users/:id/resend-invite`) — both guarded by `users.manage`.
- The phrase `invite_token is intentionally excluded` is present in the route source and verified by the USER-FUNC sentinel.

---

## 2. API Contract

### 2.1 User Directory — Paginated

`GET /api/users`
- Requires `users.view`
- Parameters: `name`, `email`, `role`, `stateId`, `sector`, `status`, `limit` (1–100, default 25), `offset` (0–100 000)
- `sector` filter uses `COALESCE(u.sector, '') ILIKE` against the stored sector value
- Ordering: deterministic `LOWER(name) ASC, id ASC`
- Response envelope: `{ items, total, limit, offset, hasMore, nextOffset }`

### 2.2 Invitation List — Paginated

`GET /api/users/invitations`
- Requires `users.manage`
- Parameters: `search`, `status` (pending/expired/accepted/cancelled), `role`, `stateId`, `emailDelivery`, `limit`, `offset`
- Response envelope: `{ invitations, total, hasMore, nextOffset }` — no token fields
- Summary cards on the UI are explicitly labelled "on this page" to avoid implying directory-wide counts

### 2.3 Lifecycle Endpoints

All guarded by `requirePerm("users.manage")` + `requireValidUserId`:

| Endpoint | Effect |
|---|---|
| `POST /users/:id/resend-invite` | Rotates token, sets `status=invited`, audits old→new lifecycle state after delivery attempt |
| `POST /users/:id/cancel-invite` | Nulls token, sets `status=deactivated`, audits old→new state |
| `POST /users/:id/status` | Changes status; blocked for self-deactivation |
| `POST /users/:id/reset-password` | Direct password set or invite-mode re-issue |
| `POST /users/:id/resend-verification` | Re-sends email-verification link; does not expose tokens |

### 2.4 Generated Client Alignment

OpenAPI updated → `pnpm --filter @workspace/api-spec run codegen` regenerated:
- `lib/api-client-react/src/generated/api.ts` — hooks: `useListUsers`, `useListUserInvitations`, `useResendUserInvite`, `useCancelUserInvite`, `useChangeUserStatus`, `useResetUserPassword`, `useResendUserVerification`
- `lib/api-client-react/src/generated/api.schemas.ts` — types: `UserDirectoryPage`, `InvitationListPage`, `InvitationRecord`, `ListUserInvitationsParams`, `ListUserInvitationsStatus`
- `lib/api-zod/src/generated/api.ts` — Zod schemas
- Project registration form updated to use `usersPage.items` from the paginated response

---

## 3. Lifecycle & Audit Accuracy

### 3.1 Audit Events

| Action | Fields recorded |
|---|---|
| `create` | `newValue`: name, email, username, role, stateId, status |
| `update` | `oldValue` + `newValue`: changed fields snapshot |
| `invite_resend` | `oldValue`: previous status/expiry/emailStatus/passwordConfigured; `newValue`: final status after delivery |
| `invite_cancel` | `oldValue`: previous status/expiry/emailStatus; `newValue`: deactivated |
| `status_change` | `oldValue` + `newValue`: status transition |
| `password_reset_invite` | actor, entityId only (no credential data) |
| `password_reset` | actor, entityId only |

Audit events are written **after** all state changes, including email delivery; the resend audit captures the final `inviteEmailStatus` (sent or pending) rather than the provisional pending state written before delivery attempt. Email delivery failures are non-fatal and logged; they do not roll back or suppress the audit event.

### 3.2 Active-Account Gate

`attachCurrentUser` middleware checks `row.status === 'active'` on every session attachment. Invited, suspended, inactive, and deactivated accounts are immediately blocked on the next request. No separate sign-out call is required.

---

## 4. Frontend — Administration Workspace

### 4.1 Directory Tab
- Server-backed search (name/email/username), role filter, status filter, State filter, sector filter
- Pagination controls: Previous/Next with `showing {{from}}–{{to}} of {{total}} users` label
- Table columns: name, username, email, verified badge, role badge, scope (state/sector), status badge, last login, created
- Loading skeletons, filtered-empty vs general-empty states, error state

### 4.2 Invite Dialog
- Role-driven: State selector appears only for state-scoped roles; sector selector only for Technical Coordinator
- `useListStates()` data consumed as a direct array (the `/states` endpoint returns `State[]`, not `{states:[]}`)
- Client-side validation: name + email + role required; state required for state roles; sector required for TC
- Server is authority: API errors mapped to British-English user messages

### 4.3 Invitations Tab
- Uses `useListUserInvitations` (generated hook) with `limit/offset` parameters
- Pagination: Previous/Next controls; `showing {{from}}–{{to}} of {{total}} invitations` label
- Summary cards labelled "on this page" (pending/accepted/expired/cancelled counts are page-scoped, total is filter-wide)
- Actions: Resend (via `useResendUserInvite`), Cancel (via `useCancelUserInvite`); only available for pending/expired/cancelled rows
- No invitation token displayed in the list; resend returns a fresh token through the authorised mutation

### 4.4 Deactivation Confirmation
- AlertDialog shown before status change to `deactivated`
- Copy: "This person will be signed out and unable to access the system immediately."

---

## 5. Localisation & Accessibility

### 5.1 English (British)
- All role labels use British English: "Programme Manager", "Senior Programme Coordinator", "State Programme Officer"
- Status and lifecycle strings use British English conventions

### 5.2 Arabic / RTL
- `ar/users.json` namespace structurally matches `en/users.json` leaf-for-leaf (verified by USER-VIS test)
- All leaf values are non-empty strings
- Arabic state/sector selectors, pagination labels, role labels, status badges, lifecycle messages, and accessible aria-labels are translated
- RTL layout uses logical CSS utilities (`me-`, `ms-`, `start-`, `end-`, `ps-`, `pe-`) throughout the user management page

### 5.3 Keyboard & Screen Reader
- All icon-only action buttons have `aria-label` (`t("ariaLabel.actionsFor", { name })"`)
- Tables use semantic `<Table>/<TableHeader>/<TableBody>/<TableHead>/<TableCell>`
- Dialog/AlertDialog patterns are accessible via Radix UI primitives
- Focus trapping handled by Radix Dialog

---

## 6. Security Results

### 6.1 IDOR
- Every direct-ID mutation route validates the numeric ID before any DB query (rejects non-numeric, zero, and out-of-range IDs with `invalid_user_id`)
- All admin mutations check `users.manage` before ID lookup
- No IDOR vulnerability observed in the reviewed route surface

### 6.2 Privilege Escalation
- PM cannot create, edit, activate/suspend, reset passwords, or manage invitations (returns `403 forbidden`)
- Self role/status/state/sector changes are explicitly blocked
- Invitation tokens absent from list surfaces

### 6.3 Concurrency / Duplicate Email
- Normalised-email unique index enforces uniqueness at the DB layer for concurrent inserts
- Migration `035` fails loudly with a pre-flight check before applying; does not silently drop data

### 6.4 Active-Account Gate
- Inactive accounts are blocked on the next authenticated request without requiring an explicit logout trigger

---

## 7. Test Coverage

### 7.1 USER-SEC Sentinels (`artifacts/api-server/src/test/users-management-closure.test.ts`)
- All 7 admin direct-ID routes guarded by `requirePerm("users.manage") + requireValidUserId`
- `GET /users` guarded by `requirePerm("users.view")`
- `cannot_modify_own_access` and `cannot_change_own_status` present
- Active-account gate check present in `currentUser.ts`
- Identity normalisation (`trim().toLowerCase()`) present
- Migration `035_user_identity_uniqueness` with both unique indexes present
- Invitation tokens excluded from list surface (USER-FUNC)
- Deterministic pagination (`ORDER BY LOWER(u.name) ASC, u.id ASC`, `LIMIT/OFFSET`) present

### 7.2 USER-VIS Sentinels (`artifacts/cafa-pmis/src/test/users-management-visual.test.ts`)
- Arabic locale structurally matches English (all leaf keys, all non-empty)
- Page source uses translated role labels, sector filter, pagination, deactivation confirmation, aria-labels, logical RTL CSS

### 7.3 PM Governance Sentinels (`artifacts/api-server/src/test/pm-full-operational-access.test.ts`)
- PM cannot create users, edit users, change status, reset passwords, view invitations, or delete users
- All return `403 forbidden` (not `500`)

### 7.4 Full Suite Results
- **Backend**: 2,621/2,623 pass (2 pre-existing failures in Plans/Risk modules, unrelated to User Management)
- **Frontend**: 5,294/5,294 pass

---

## 8. Residual Register

| # | Category | Description | Resolution |
|---|---|---|---|
| R-01 | Product policy | No permanent user deletion policy beyond deactivation is implemented. Soft-delete / deactivation is the documented safe path. | Open; out of scope per task definition |
| R-02 | Infrastructure | `EMAIL_ENABLED` is unset in development; email delivery runs in stub mode. Invite links are displayed in-browser for testing. | Expected behaviour; production SMTP/Resend config resolves |
| R-03 | Pre-existing test failures | `PLAN-RESP-01` and `RISK-RES-02` fail in unrelated Plans/Risk test files; not introduced by this task | Tracked separately |
| R-04 | Username on create | The `InviteUserDialog` does not collect a username (the server generates one from the email prefix). If username uniqueness conflicts arise at scale, an edit step is available post-creation. | Acceptable for invited flow; edit form exposes username |

---

*Report generated by automated closure review. Reviewed by code-review architect subagent 2026-08-20.*
