# Messages Module — Phase 1 Security Fixes

**Date:** 2026-06-04  
**Baseline audit:** `docs/messages-audit-report.md` (Score: 56/100)  
**Fixes applied:** C-01, H-01, H-02  
**Typecheck:** 0 errors (post-fix)  
**API server:** restarted, healthy

---

## Summary of Changes

| Finding | Severity | Status | File Modified |
|---------|----------|--------|---------------|
| C-01 — Unauthenticated conversation creation | Critical | ✅ Fixed | `artifacts/api-server/src/routes/conversations.ts` |
| H-01 — Notification flooding on messages | High | ✅ Fixed | `artifacts/api-server/src/routes/conversations.ts` |
| H-02 — Unrestricted member management | High | ✅ Fixed | `artifacts/api-server/src/routes/conversations.ts` |

---

## C-01 — Secure POST /conversations

### Problem

`POST /conversations` accepted any authenticated user as creator regardless of conversation type. A state officer could create a state-level chat for any state (not just their own), a Technical Coordinator could create sector chats for any sector, and there was no project membership check for project-type conversations.

### Fix Applied

Three authorization guards added inside `POST /conversations` before any DB writes:

**State-type conversations:**
```ts
if (type === "state") {
  const isStateRole = user.role === "state_manager" || user.role === "state_officer";
  if (isStateRole) {
    if (!stateId || user.stateId !== stateId) {
      res.status(403).json({ error: "state_forbidden",
        message: "You may only create state conversations for your assigned state." });
      return;
    }
  }
  // HQ roles (SA, ED, PM, SC, TC) may create state chats for any state.
}
```

**Sector-type conversations:**
```ts
if (type === "sector") {
  const sectorRestriction = tcSectorRestriction(req);
  if (sectorRestriction !== null) {
    if (!sector || !sectorRestriction.includes(sector)) {
      res.status(403).json({ error: "sector_forbidden",
        message: "You may only create sector conversations for your assigned sector(s)." });
      return;
    }
  }
  // Non-TC HQ roles may create sector chats for any sector.
}
```

**Project-type conversations:**
```ts
if (type === "project") {
  const isStateRole = user.role === "state_manager" || user.role === "state_officer";
  if (isStateRole) {
    const stateCheck = await pool.query(
      `SELECT 1 FROM project_states ps WHERE ps.project_id=$1 AND ps.state_id=$2
       UNION ALL SELECT 1 FROM project_assignments pa WHERE pa.project_id=$1 AND pa.user_id=$3 LIMIT 1`,
      [projectId, user.stateId ?? -1, userId]
    );
    if (stateCheck.rows.length === 0) {
      res.status(403).json({ error: "project_state_forbidden" });
      return;
    }
  }
  const sectorRestriction = tcSectorRestriction(req);
  if (sectorRestriction !== null) {
    const projectRow = await pool.query(`SELECT sector FROM projects WHERE id=$1`, [projectId]);
    const guard = assertSectorAllowed(req, projectRow.rows[0]?.sector ?? null);
    if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
  }
}
```

### Permission Matrix

| Role | State chat | Sector chat | Project chat | Direct / Group |
|------|------------|-------------|--------------|----------------|
| state_manager / state_officer | Own state only | Unrestricted | Own state only | Unrestricted |
| technical_coordinator | Unrestricted | Assigned sectors only | Assigned sectors only | Unrestricted |
| program_manager / senior_coordinator | Unrestricted | Unrestricted | Unrestricted | Unrestricted |
| super_admin / executive_director | Unrestricted | Unrestricted | Unrestricted | Unrestricted |

### Test Results — C-01

| # | Actor | Action | Expected | Result |
|---|-------|--------|----------|--------|
| 1 | mona (state_manager, stateId=1) | Create state chat for stateId=2 | 403 | ✅ 403 |
| 2 | mona (state_manager, stateId=1) | Create state chat for stateId=1 | 201 | ✅ 201 |
| 3 | ahmed.m (state_officer, stateId=2) | Create state chat for stateId=1 | 403 | ✅ 403 |
| 4 | khalid (TC, sector=WASH) | Create sector chat for "Health" | 403 | ✅ 403 |
| 5 | khalid (TC, sector=WASH) | Create sector chat for "WASH" | 201 | ✅ 201 |
| 6 | sara (TC, sector=Health) | Create sector chat for "WASH" | 403 | ✅ 403 |
| 7 | fatima (program_manager) | Create sector chat for "Nutrition" | 201 | ✅ 201 |
| 8 | Unauthenticated | Create any conversation | 401 | ✅ 401 |

**All 8 C-01 test cases pass.**

---

## H-01 — Notification Deduplication on POST /conversations/:id/messages

### Problem

`POST /conversations/:id/messages` called `createNotification()` for every message sent to every conversation member. In a large state/sector group chat (potentially 50+ members), sending one message could create 50+ notifications per send, and rapid messaging would multiply that further.

### Fix Applied

Replaced `createNotification()` with `createNotificationDeduped()` with a 5-minute window:

```ts
for (const m of otherMembers.rows) {
  await createNotificationDeduped({
    userId: m.user_id,
    kind: "message",
    entityType: "conversation",
    entityId: convId,
    message: `${senderName}: ${body.slice(0, 80)}`,
    link: `/messages/${convId}`,
    dedupeWindowMinutes: 5,   // ← dedup window
  });
}
```

`createNotificationDeduped` skips INSERT when a notification with the same `(userId, entityType, entityId, kind)` tuple was created within the window, preserving existing unread-count semantics.

### Test Results — H-01

**Test:** 3 rapid messages sent to conversation 7 (mona → fatima + 4 other members).  
**DB query result:**

```sql
SELECT COUNT(*) AS total_notifs, COUNT(DISTINCT (entity_id, kind)) AS deduplicated_unique
FROM notifications
WHERE user_id=3 AND entity_type='conversation' AND entity_id=7 AND kind='message'
  AND created_at > NOW() - INTERVAL '2 minutes';
```

```
 total_notifs | deduplicated_unique
--------------+---------------------
            1 |                   1
```

**3 messages → 1 notification row.** Deduplication confirmed. Unread-counter accuracy is unaffected because unread counts derive from `messages.created_at` vs `conversation_members.last_read_at`, not from notification rows.

---

## H-02 — Secure POST /conversations/:id/members

### Problem

`POST /conversations/:id/members` had no caller-authorization check beyond membership. Any conversation member (even a low-privilege state officer) could add arbitrary users. There was also no validation that the target user existed or was active.

### Fix Applied

Two-layer guard added at the top of the handler:

**Layer 1 — Caller privilege check:**
```ts
const conv = await pool.query<{ created_by_id: number }>(
  `SELECT created_by_id FROM conversations WHERE id=$1`, [convId]
);
const isCreator   = conv.rows[0].created_by_id === userId;
const isPrivileged = isAdminRole(user.role);   // SA, ED, PM, SC
if (!isCreator && !isPrivileged) {
  res.status(403).json({ error: "forbidden",
    message: "Only the conversation creator, Program Manager, or Senior Coordinator may add members." });
  return;
}
```

**Layer 2 — Target user validation:**
```ts
const userCheck = await pool.query(
  `SELECT id, status FROM users WHERE id=$1`, [newUserId]
);
if (!userCheck.rows[0]) {
  res.status(400).json({ error: "user_not_found" }); return;
}
if (userCheck.rows[0].status !== "active") {
  res.status(400).json({ error: "user_not_active",
    message: "Only active users may be added to conversations." }); return;
}
```

`ADMIN_ROLES` constant:
```ts
const ADMIN_ROLES = [
  "super_admin", "executive_director", "program_manager", "senior_coordinator"
] as const;
```

Note: The membership guard (`assertMember`) runs before the privilege check. A caller who is not already a member of the conversation receives 403 regardless of role — admins must be conversation members to manage membership. This prevents cross-conversation member manipulation.

### Test Results — H-02

| # | Actor | Action | Expected | Result |
|---|-------|--------|----------|--------|
| 1 | fatima (PM — privileged + member) | Add user to conversation | 204 | ✅ 204 |
| 2 | mona (state_manager — creator) | Add active user | 204 | ✅ 204 |
| 3 | ibrahim (senior_coordinator — member, privileged) | Add active user | 204 | ✅ 204 |
| 4 | yusuf (state_manager — NOT a member) | Add user | 403 | ✅ 403 |
| 5 | amira (super_admin — not member) | Add non-existent user 9999 | 403 (not member) | ✅ 403 |
| 6 | amira (super_admin — joined, now member) | Add non-existent user 9999 | 400 | ✅ 400 |

**All 6 H-02 test cases pass.**

---

## Typecheck Verification

```
pnpm --filter @workspace/api-server run typecheck
> tsc -p tsconfig.json --noEmit
(exit 0 — no errors)
```

---

## Updated Readiness Score

### Scoring Basis (from baseline audit)

| Category | Baseline | After Phase 1 | Delta |
|----------|----------|---------------|-------|
| Authentication (15 pts) | 15/15 | 15/15 | — |
| Authorization / Access Control (20 pts) | 5/20 | 18/20 | +13 |
| Input Validation (15 pts) | 8/15 | 11/15 | +3 |
| Notification Safety (10 pts) | 3/10 | 10/10 | +7 |
| Data Integrity (10 pts) | 8/10 | 8/10 | — |
| Error Handling (10 pts) | 7/10 | 7/10 | — |
| File / Attachment Security (10 pts) | 5/10 | 5/10 | — |
| Audit & Observability (10 pts) | 5/10 | 5/10 | — |

**Total: 79/100** (up from 56/100, +23 points)

### Remaining Open Findings (Phase 2)

| ID | Severity | Finding |
|----|----------|---------|
| M-01 | Medium | Attachment URLs are not validated against a known bucket prefix |
| M-02 | Medium | No rate-limiting on `POST /conversations/:id/messages` |
| M-03 | Medium | `GET /conversations` search param not sanitized for injection risk |
| M-04 | Medium | State/sector eligibility not validated when adding members |
| L-01 | Low | Missing `Content-Security-Policy` header on API responses |
| L-02 | Low | Soft-delete (`deleted_at`) on messages is not surfaced in audit log |
| L-03 | Low | `last_read_at` update is fire-and-forget (no error propagation) |
| L-04 | Low | No maximum body length enforced on message text |
| L-05 | Low | `memberIds` array in conversation create not validated for active-user status |

### Phase 2 Recommendations (priority order)

1. **M-02** — Add `express-rate-limit` to the messages endpoint (e.g. 60 req/min per user/IP).
2. **M-04** — Extend H-02 add-member guard to validate state/sector eligibility for the new member (mirrors C-01 logic).
3. **M-01** — Validate attachment `url` fields against the configured object-storage bucket prefix.
4. **M-03** — Sanitize `search` query param via parameterized LIKE (already done in most places; double-check conversations list).
5. **L-04** — Add `MAX_MESSAGE_LENGTH = 10_000` check server-side.
