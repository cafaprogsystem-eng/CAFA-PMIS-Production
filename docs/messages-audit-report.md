# CAFA PMIS — Communication Module (Messages) Audit Report

**Date:** June 2026  
**Auditor:** Automated static code inspection — actual code, routes, DB schema, UI  
**Scope:** Full audit of the Messages / Communication module  
**Inspection Method:** Direct file reads of `artifacts/api-server/src/routes/conversations.ts`, `artifacts/cafa-pmis/src/pages/messages.tsx`, `lib/db/src/schema/index.ts`, `artifacts/api-server/src/lib/notifications.ts`, `artifacts/api-server/src/middlewares/currentUser.ts`

---

## Readiness Score

```
████████████████████████████████░░░░░░░░░░░░░░░░░░░░  56 / 100
```

| Severity | Count | Score Impact |
|---|---|---|
| Critical | **1** | −15 |
| High | **2** | −13 |
| Medium | **4** | −11 |
| Low | **5** | −5 |
| **Score** | | **56 / 100** |

**Overall Status:** 🔴 NOT READY FOR PRODUCTION — Critical and High findings must be resolved before go-live.

---

## Screens Reviewed

| Screen / Component | File | Reviewed |
|---|---|---|
| Messages page (full layout) | `pages/messages.tsx` | ✅ |
| Conversation list panel | `pages/messages.tsx:549–609` | ✅ |
| Chat window (message thread) | `pages/messages.tsx:611–755` | ✅ |
| New Conversation modal | `pages/messages.tsx:249–373` | ✅ |
| MessageBubble component | `pages/messages.tsx:139–227` | ✅ |
| Messages dropdown (topbar) | `components/messages-dropdown.tsx` | ✅ (referenced) |
| Conversations API router | `routes/conversations.ts` | ✅ |
| DB schema (3 tables) | `lib/db/src/schema/index.ts:428–458` | ✅ |
| Notifications library | `lib/notifications.ts` | ✅ |
| Auth middleware | `middlewares/currentUser.ts` | ✅ |

---

## Database Validation

### Tables

**`conversations`** (`lib/db/src/schema/index.ts:428–438`)
```
id           serial PK
type         text NOT NULL DEFAULT 'direct'
name         text (nullable)
project_id   integer (nullable, NO FK CONSTRAINT)
state_id     integer (nullable, NO FK CONSTRAINT)
sector       text (nullable)
created_by_id integer NOT NULL
created_at   timestamptz
updated_at   timestamptz
```

**`conversation_members`** (`lib/db/src/schema/index.ts:440–446`)
```
id               serial PK
conversation_id  integer NOT NULL
user_id          integer NOT NULL
joined_at        timestamptz
last_read_at     timestamptz (nullable — used for unread count)
```

**`messages`** (`lib/db/src/schema/index.ts:448–458`)
```
id               serial PK
conversation_id  integer NOT NULL
sender_id        integer NOT NULL
body             text NOT NULL
attachments      jsonb (nullable — array of {type, url, name, size})
reply_to_id      integer (nullable — FK to messages.id, via LEFT JOIN)
edited_at        timestamptz (nullable)
deleted_at       timestamptz (nullable — soft delete)
created_at       timestamptz NOT NULL
```

**Findings:**
- ✅ Soft delete implemented (`deleted_at`)
- ✅ Read tracking implemented (`last_read_at` in conversation_members)
- ✅ Threaded replies implemented (`reply_to_id`)
- ✅ Attachment metadata stored as JSONB
- ⚠️ `conversations.project_id` and `conversations.state_id` have **no foreign key constraints** — referential integrity relies on application-level validation only
- ⚠️ No `UNIQUE` constraint on `conversation_members(conversation_id, user_id)` in the Drizzle schema; the SQL route uses `ON CONFLICT DO NOTHING` as a workaround

---

## API Validation

### Endpoints Implemented

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/conversations/unread-count` | ✅ session | Total unread across all user's conversations |
| `GET` | `/conversations` | ✅ session | List conversations the caller is a member of |
| `POST` | `/conversations` | ✅ session | Create a conversation |
| `GET` | `/conversations/:id` | ✅ member check | Detail + members + unread count |
| `POST` | `/conversations/:id/members` | ✅ member check | Add a user to a conversation |
| `POST` | `/conversations/:id/read` | ✅ session | Mark all messages read |
| `GET` | `/conversations/:id/messages` | ✅ member check | Paginated message history |
| `POST` | `/conversations/:id/messages` | ✅ member check | Send a message |
| `PATCH` | `/messages/:msgId` | ✅ owner only | Edit a message body |
| `DELETE` | `/messages/:msgId` | ✅ owner + admin | Soft-delete a message |

**Router registration:** `routes/index.ts:60` — `router.use(conversationsRouter)` — confirmed behind `requireAuth`.

### Access Control Mechanism

All data-returning endpoints use `assertMember()`:

```typescript
// conversations.ts:9–15
async function assertMember(convId: number, userId: number): Promise<boolean> {
  const r = await pool.query(
    `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
    [convId, userId],
  );
  return (r.rowCount ?? 0) > 0;
}
```

`GET /conversations` filters by `cm.user_id = $1` (line 58) — users only see conversations they belong to. ✅

---

## Permission Validation

### What Is Enforced

| Check | Enforced | Evidence |
|---|---|---|
| Authentication required | ✅ | Router registered after `requireAuth` (routes/index.ts:40,60) |
| Read messages of conversation not joined | ✅ | `assertMember()` returns 403 (line 274) |
| View conversation not joined | ✅ | `getConvById()` returns null if not member (line 31) |
| Edit someone else's message | ✅ | `sender_id !== userId` → 403 (line 386) |
| Delete someone else's message (non-admin) | ✅ | Owner OR admin (super_admin/ED/PM) check (lines 422–426) |
| Add member to conversation you are not in | ✅ | `assertMember()` guard (line 243) |

### What Is NOT Enforced ← Findings

See C-01, H-02 in findings section below.

---

## Security Validation

### C-01 — CRITICAL: No Authorization on Conversation Creation by Type

**File:** `artifacts/api-server/src/routes/conversations.ts:101–195`  
**Evidence:**

```typescript
router.post("/conversations", async (req, res, next) => {
  const userId = req.currentUser!.id;
  const { type = "direct", name, memberIds = [], projectId, stateId, sector } = req.body;
  // ← ZERO role/state/sector validation here

  if (type === "state" && stateId) {
    const stateUsers = await pool.query(
      `SELECT id FROM users WHERE state_id=$1 AND status='active'`,
      [stateId],          // ← ANY stateId accepted from any user
    );
    allMemberIds = [...new Set([...allMemberIds, ...stateUsers.rows.map(r => r.id)])];
  }

  if (type === "sector" && sector) {
    const sectorUsers = await pool.query(
      `SELECT id FROM users WHERE (sector ILIKE $1 OR sector ILIKE $2) AND status='active'`,
      [`%${sector}%`, `${sector}%`],   // ← ANY sector accepted from any user
    );
    allMemberIds = [...new Set([...allMemberIds, ...sectorUsers.rows.map(r => r.id)])];
  }

  if (type === "project" && projectId) {
    const assigned = await pool.query(
      `SELECT user_id FROM project_assignments WHERE project_id=$1`,
      [projectId],        // ← ANY projectId accepted from any user
    );
```

**Impact:**

- A **State Officer** assigned to State A can call `POST /conversations` with `{ type: "state", stateId: <B> }` and the server will auto-enroll **all active users of State B** into a new conversation the attacker controls — exposing State B user identities and creating an unsolicited communication channel.
- A **State Officer** with no sector assignment can create a `sector` chat for any of the 9 sectors and auto-invite all Technical Coordinators and staff for that sector.
- A **Technical Coordinator** restricted to one sector can create a `project` chat for a project outside their sector and gain visibility of that project's team.
- These gaps violate the core RBAC isolation model of the rest of the system.

**Remediation:**

```typescript
// State chat: enforce caller's assigned state
if (type === "state") {
  const user = req.currentUser!;
  const isStateRole = ["state_manager","state_officer"].includes(user.role);
  if (isStateRole && user.stateId !== stateId) {
    res.status(403).json({ error: "state_forbidden" }); return;
  }
}

// Sector chat: enforce TC's assigned sector(s)
if (type === "sector") {
  const restriction = tcSectorRestriction(req);
  if (restriction && !restriction.includes(sector)) {
    res.status(403).json({ error: "sector_forbidden" }); return;
  }
}

// Project chat: enforce project membership
if (type === "project") {
  const guard = await assertSectorAllowed(req, projectSector);
  if (!guard.ok) { res.status(guard.status).json(guard.body); return; }
}
```

---

### H-01 — HIGH: No Notification Deduplication for Messages

**File:** `artifacts/api-server/src/routes/conversations.ts:354–368`  
**Evidence:**

```typescript
const otherMembers = await pool.query<{ user_id: number }>(
  `SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id!=$2`,
  [convId, userId],
);
for (const m of otherMembers.rows) {
  await createNotification({          // ← plain createNotification, no dedup
    userId: m.user_id,
    kind: "message",
    entityType: "conversation",
    entityId: convId,
    message: `${senderName}: ${body.slice(0, 80)}`,
    link: `/messages/${convId}`,
  });
}
```

**Impact:** A state chat auto-enrolls all active users in a state (potentially 20–50 users). Every single message sent to that conversation generates a notification for every member in a tight loop — no deduplication, no rate limiting, no batching. A user who sends 10 messages in a row in a 30-person state chat creates **300 individual notification rows** in the database in seconds. This causes:

1. Notification inbox flooding — unread count skyrockets for recipients
2. Database write amplification
3. Performance degradation on the `GET /notifications` query for affected users

`createNotificationDeduped` exists in the library (`notifications.ts:311–323`) but is not used here.

**Remediation:** Replace `createNotification` with `createNotificationDeduped` using a short dedup window (5 minutes per conversation per user):

```typescript
await createNotificationDeduped({
  userId: m.user_id,
  kind: "message",
  entityType: "conversation",
  entityId: convId,
  message: `${senderName}: ${body.slice(0, 80)}`,
  link: `/messages/${convId}`,
  dedupeWindowMinutes: 5,
});
```

---

### H-02 — HIGH: Any Conversation Member Can Add Any User

**File:** `artifacts/api-server/src/routes/conversations.ts:238–252`  
**Evidence:**

```typescript
router.post("/conversations/:id/members", async (req, res, next) => {
  const userId = req.currentUser!.id;
  const convId = parseInt(req.params.id);
  const isMember = await assertMember(convId, userId);
  if (!isMember) { res.status(403).json({ error: "forbidden" }); return; }
  const { userId: newUserId } = req.body as { userId: number };
  // ← No check: is newUserId valid? active? appropriate for this conv type?
  await pool.query(
    `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [convId, newUserId],
  );
  res.status(204).end();
});
```

**Impact:**

- Any member (including the lowest-privilege State Officer) can add any user ID to any conversation they belong to — including users from other states or sectors.
- An attacker can pass an arbitrary `newUserId` (no existence or active-status check) to add non-existent or deactivated accounts.
- Combined with C-01: attacker creates a state chat for State B (adds all State B users) then adds themselves to receive all replies.

**Remediation:**

```typescript
// Validate new user exists and is active
const userCheck = await pool.query(`SELECT id, status FROM users WHERE id=$1`, [newUserId]);
if (!userCheck.rows[0] || userCheck.rows[0].status !== "active") {
  res.status(400).json({ error: "invalid_user" }); return;
}
// Restrict add permission to creator or admin roles
const isAdmin = ["super_admin","program_manager","senior_coordinator"].includes(req.currentUser!.role);
const isCreator = conv.createdById === userId;
if (!isAdmin && !isCreator) {
  res.status(403).json({ error: "forbidden" }); return;
}
```

---

## Conversation Types Validation

| Type | DB Field | Auto-enroll Logic | Create Modal | Server Side | Status |
|---|---|---|---|---|---|
| Direct (1:1) | `type='direct'` | Dedup existing conv | ✅ | ✅ | **Implemented** |
| Group | `type='group'` | Manual member selection | ✅ | ✅ | **Implemented** |
| Project | `type='project'` | Auto-adds `project_assignments` | ✅ | ✅ | **Implemented** |
| State | `type='state'` | Auto-adds all state users | ✅ | ✅ | **Implemented** |
| Sector | `type='sector'` | Auto-adds all sector users | ✅ | ✅ | **Implemented** |
| Announcement / System | `type='system'` | Not implemented | ❌ | ❌ | **Missing** |
| Organization-wide | N/A | Not implemented | ❌ | ❌ | **Missing** |

---

## Project Integration Validation

| Integration | Supported | Evidence |
|---|---|---|
| Link conversation to **Project** | ✅ | `conversations.project_id` column; auto-enroll from `project_assignments` |
| Link conversation to **State** | ✅ | `conversations.state_id` column; auto-enroll all state users |
| Link conversation to **Sector** | ✅ | `conversations.sector` column; auto-enroll all sector users |
| Link to **Report** | ❌ | No `report_id` column, no route, no UI |
| Link to **Risk** | ❌ | No `risk_id` column, no route, no UI |
| Link to **Plan** | ❌ | No `plan_id` column, no route, no UI |
| Link to **Budget** | ❌ | No `budget_id` column, no route, no UI |

---

## M-01 — MEDIUM: HTTP Polling Only — No WebSocket or Server-Sent Events

**Evidence:**

```typescript
// messages.tsx:419–425
const { data: messages = [] } = useQuery<Msg[]>({
  queryKey: ["messages", selectedId],
  queryFn: () => apiFetch(`/api/conversations/${selectedId}/messages?limit=60`),
  enabled: !!selectedId,
  refetchInterval: 5_000,   // ← 5-second polling
  staleTime: 0,
});

// Conversation list polls every 30 seconds
const { data: convList = [] } = useQuery<ConvSummary[]>({
  refetchInterval: 30_000,  // ← 30-second polling
});
```

Grep for WebSocket/Socket.IO across the entire codebase returned **zero results** — confirmed no real-time transport.

**Impact:**

- Message latency of up to 5 seconds for the receiver
- Conversation list latency of up to 30 seconds for new conversation appearance
- 100+ concurrent users → hundreds of polling requests per minute to the API server
- No online presence indicator possible without a push channel

**Status:** Acceptable for MVP with modest user counts; should be replaced with WebSocket or SSE for production at scale.

---

## M-02 — MEDIUM: Message Content Search Not Implemented

**Evidence (server-side search, `conversations.ts:92–96`):**

```typescript
// Search only on conversation name and LAST message body:
${search ? `WHERE (c.name ILIKE $${p} OR lm.body ILIKE $${p})` : ""}
```

`lm` is the CTE joining the **most recent message only** — not message history.

**Impact:** Users cannot search historical message content. Searching for "payment schedule" will only match if those words appear in a conversation's name or its very last message.

**Missing:** `GET /conversations/:id/messages?q=` (message content search within a thread) — not implemented anywhere.

---

## M-03 — MEDIUM: Announcement / Organization-wide Type Not Implemented

**Evidence (`messages.tsx:50`):**

```typescript
system: { label: "System", icon: Building2, color: "text-slate-500" },
```

The UI `TYPE_META` defines a `system` type with a label and icon, but:
- The New Conversation modal offers only: `direct`, `group`, `project`, `state`, `sector`
- `POST /conversations` has no handling for `type === "system"` or `type === "announcement"`
- No server-side broadcast mechanism exists

**Impact:** Organization-wide announcements from Program Manager / Executive Director to all staff — a core communication pattern in a humanitarian NGO — cannot be sent through the Messages module.

---

## M-04 — MEDIUM: Sector ILIKE Match May Include Partial Names

**Evidence (`conversations.ts:157–161`):**

```typescript
const sectorUsers = await pool.query<{ id: number }>(
  `SELECT id FROM users WHERE (sector ILIKE $1 OR sector ILIKE $2) AND status='active'`,
  [`%${sector}%`, `${sector}%`],
);
```

TC sector is stored as a comma-separated string (e.g. `"Health,WASH,Nutrition"`). The ILIKE `%sector%` pattern on the whole field will correctly match multi-sector TCs, but `sector = "WASH"` would also match a user whose sector field is `"MPCA / Cash Assistance,WASH"`. This is coincidentally **correct behaviour** for multi-sector TCs but the SQL is fragile:

- `sector = "Protection"` would also match a hypothetical `"Child Protection"` entry (legacy data)
- No validation that the `sector` parameter matches a valid sector from `VALID_SECTORS`

---

## Notifications Integration Validation

| Feature | Status | Evidence |
|---|---|---|
| New message triggers notification | ✅ | `conversations.ts:354–368` — `createNotification` for each non-sender member |
| Bell icon unread badge | ✅ | `components/notifications-bell.tsx` — polls `GET /notifications` (30s) |
| Messages dropdown unread count | ✅ | `GET /conversations/unread-count` consumed by `messages-dropdown.tsx` |
| Read status sync on open | ✅ | `POST /conversations/:id/read` fires on `selectedId` change (`messages.tsx:428–433`) |
| Per-conversation unread count | ✅ | SQL subquery in `GET /conversations` (`conversations.ts:83–87`) |
| Notification deduplication | ❌ | Uses `createNotification`, not `createNotificationDeduped` — see H-01 |
| Duplicate suppression on reopen | ❌ | Each page visit/reopen to the same conversation re-queries but does not suppress redundant notification creation |

---

## Attachments Validation

| Feature | Status | Evidence |
|---|---|---|
| File upload UI | ✅ | Paperclip button, hidden `<input type="file" multiple>` (`messages.tsx:733`) |
| Presigned URL upload | ✅ | `POST /api/storage/uploads/request-url` with `scope: "messages"` (`messages.tsx:507–509`) |
| PUT to presigned URL | ✅ | `messages.tsx:511–513` |
| Attachment metadata stored in DB | ✅ | `attachments` JSONB column in `messages` table |
| Attachment rendered in chat | ✅ | `MessageBubble` renders `<a href={att.url}>` links (`messages.tsx:181–188`) |
| Multiple files per message | ✅ | `files` array iterated in `handleFileChange` |
| Image vs. file type detection | ✅ | `file.type.startsWith("image/") ? "image" : "file"` (`messages.tsx:514`) |
| Client-side file type restriction | ❌ | `<input type="file" multiple>` — **no `accept` attribute** — any file type |
| Server-side file type validation | ❌ | `POST /conversations/:id/messages` accepts any `attachments` array without type validation |
| Attachment size limit | ❌ | No explicit limit enforced client or server side |
| Download access control | ⚠️ | Presigned URLs are stored as `publicUrl` — accessible to anyone with the URL; no per-user download gating |
| Repository integration (project docs) | ❌ | Message attachments go to `messages` scope in object storage but are **not cross-referenced** with the Document Repository |

---

## Real-Time Messaging Validation

| Feature | Status | Evidence |
|---|---|---|
| WebSocket connection | ❌ | Zero socket/ws references in codebase |
| Server-Sent Events (SSE) | ❌ | Not implemented for messages |
| Message delivery (polling) | ✅ | 5-second refetchInterval |
| True read receipts | ❌ | `CheckCheck` icon shown for **all** own messages regardless of read state (`messages.tsx:196`) — cosmetic only |
| Online presence / "last seen" | ❌ | Not implemented |
| Typing indicators | ❌ | Not implemented |
| Reconnection handling | ✅ | TanStack Query retries automatically on network restore |
| Offline PWA behaviour | ✅ | Conversations and messages cached by Dexie offline layer; send queued when offline |

---

## Search & Filtering Validation

| Feature | Status | Evidence |
|---|---|---|
| Search users (create modal) | ✅ | `GET /api/users?search=…&limit=20` in NewConversationModal (`messages.tsx:263`) |
| Search conversation list (name) | ✅ | `c.name ILIKE $${p}` on server (`conversations.ts:93`) |
| Search conversation list (last message) | ✅ | `lm.body ILIKE $${p}` on server (`conversations.ts:93`) |
| Search historical message content | ❌ | Not implemented |
| Filter: All | ✅ | Default tab |
| Filter: Unread | ✅ | `unread=true` query param → SQL count subquery |
| Filter: Direct | ✅ | `type=direct` |
| Filter: Projects | ✅ | `type=project` |
| Filter: States | ✅ | `type=state` |
| Filter: Sectors | ✅ | `type=sector` |

---

## User Experience Validation

| Feature | Status | Notes |
|---|---|---|
| Two-pane WhatsApp-style layout | ✅ | Left: conversation list; Right: chat window |
| Mobile responsive (single-pane) | ✅ | `hidden md:flex` / `w-full md:w-80` breakpoints |
| Conversation list empty state | ✅ | Icon + "No conversations yet" message |
| Chat window empty state | ✅ | "Select a conversation" placeholder |
| Message thread empty state | ✅ | "No messages yet. Say hello! 👋" |
| Date dividers between days | ✅ | `DateDivider` component with Today/Yesterday/date |
| Sender avatar + name in groups | ✅ | Shown for non-own messages when sender changes |
| Deleted message display | ✅ | "🚫 This message was deleted" placeholder |
| Edit indicator | ✅ | "edited" label below message timestamp |
| Reply preview in input bar | ✅ | Blue-left-border preview strip |
| Pending attachment chips | ✅ | Shown above input bar before sending |
| Loading states | ⚠️ | TanStack Query loading states not explicitly handled — no skeleton UI shown during initial load |
| Error handling (send fail) | ✅ | `toast.error(e.message)` |
| Emoji picker | ❌ | Button present with `title="Emoji — coming soon"` — non-functional |
| Message pagination ("load more") | ❌ | API supports cursor-based `before` param but UI shows only last 60 messages with no load-more control |
| Conversation member list | ✅ | Shown in chat header (first 3 names) |

---

## L-01 — LOW: No Pagination UI for Message History

**Evidence (`messages.tsx:419–425`):**

```typescript
queryFn: () => apiFetch(`/api/conversations/${selectedId}/messages?limit=60`),
```

The API implements cursor-based pagination (`before` param at `conversations.ts:276–281`) but the UI fetches only the last 60 messages with no "Load older messages" button or infinite scroll.

**Impact:** Conversations older than 60 messages lose historical context in the UI.

---

## L-02 — LOW: Emoji Picker Non-Functional

**Evidence (`messages.tsx:738–741`):**

```typescript
<Button variant="ghost" size="icon" ... title="Emoji — coming soon">
  <Smile className="h-4 w-4" />
</Button>
```

The button has no `onClick` handler. It is a visible but permanently inactive UI element.

---

## L-03 — LOW: Edit Does Not Support Changing Attachments

**Evidence (`conversations.ts:374–408`, `PATCH /messages/:msgId`):**

```typescript
const { body } = req.body as { body: string };
// ...
await pool.query(`UPDATE messages SET body=$1, edited_at=NOW() WHERE id=$2`, [body.trim(), msgId]);
```

`PATCH` only accepts `body`. A message with an incorrect attachment cannot be corrected — the attachment is permanently stored.

---

## L-04 — LOW: No Linking to Reports, Plans, Risks, or Budgets

**Evidence (DB schema `lib/db/src/schema/index.ts:428–438`):**

The `conversations` table has `project_id`, `state_id`, and `sector` columns but no `report_id`, `plan_id`, `risk_id`, or `budget_id`.

Contextual communication (e.g. "discuss this risk with the team") requires navigating away from the risk to Messages and manually starting a conversation — there is no "open chat" deep-link from a Risk, Plan, or Report detail page.

---

## L-05 — LOW: No Foreign Key Constraints on conversations.project_id / state_id

**Evidence:** Drizzle schema shows no `.references(() => ...)` on `projectId` or `stateId` columns in `conversationsTable`. The application trusts that `projectId` supplied at creation time is valid without verifying it against the `projects` or `states` tables.

---

## Data Retention & Audit Validation

| Feature | Status | Evidence |
|---|---|---|
| Soft delete (messages) | ✅ | `deleted_at` timestamp; body hidden in UI; still returned in API |
| Message history retained permanently | ✅ | No TTL or purge mechanism |
| Conversation creation audited | ✅ | `logAudit` called on `POST /conversations` (`conversations.ts:180`) |
| Message send audited | ❌ | `logAudit` not called on `POST /conversations/:id/messages` |
| Message edit audited | ❌ | `logAudit` not called on `PATCH /messages/:msgId` |
| Message delete audited | ❌ | `logAudit` not called on `DELETE /messages/:msgId` |
| Attachment history | ✅ | JSONB stored in `messages.attachments`; retained with message |
| Retention policy | ❌ | No configurable retention or archival policy |

---

## Final Recommendation

### Summary of All Findings

| ID | Severity | Finding | File | Fix Effort |
|---|---|---|---|---|
| C-01 | 🔴 Critical | No role/state/sector enforcement on conversation creation | `conversations.ts:101–195` | Medium |
| H-01 | 🟠 High | No notification dedup for messages — flooding risk in large chats | `conversations.ts:354–368` | Low |
| H-02 | 🟠 High | Any member can add any user to any conversation | `conversations.ts:238–252` | Low |
| M-01 | 🟡 Medium | HTTP polling only — no WebSocket or SSE; 5 s message latency | Architecture | High |
| M-02 | 🟡 Medium | No historical message content search | Route + UI | Medium |
| M-03 | 🟡 Medium | Announcement / org-wide broadcast type not implemented | Route + DB + UI | High |
| M-04 | 🟡 Medium | Sector ILIKE may match partial/legacy sector names; no input validation | `conversations.ts:157–161` | Low |
| L-01 | 🔵 Low | No pagination UI — history beyond 60 messages inaccessible | `messages.tsx:421` | Low |
| L-02 | 🔵 Low | Emoji picker is non-functional placeholder | `messages.tsx:738` | Low |
| L-03 | 🔵 Low | Message edit does not support modifying attachments | `conversations.ts:389` | Low |
| L-04 | 🔵 Low | No linking from Reports, Plans, Risks, or Budgets to conversations | DB schema | Medium |
| L-05 | 🔵 Low | No FK constraints on conversations.project_id / state_id | DB schema | Low |

### Prioritised Remediation Plan

**Phase 1 — Must fix before production (Critical + High, ~3 days)**

1. **C-01** — Add state/sector/project authorization to `POST /conversations`. Use the existing `assertSectorAllowed`, `assertStateAllowed`, and `tcSectorRestriction` helpers already present in `currentUser.ts`.
2. **H-01** — Replace `createNotification` with `createNotificationDeduped` (5-minute window) in the message send handler.
3. **H-02** — Add user existence + active-status check and restrict add-member permission to conversation creator or admin roles.

**Phase 2 — Should fix for quality release (Medium, ~1 week)**

4. **M-04** — Validate `sector` parameter against `VALID_SECTORS` list before the ILIKE query.
5. **M-01** — Implement Server-Sent Events (SSE) for message push to reduce polling overhead. WebSocket is optional — SSE is simpler and the API already uses it for the AI assistant (`POST /ai/chat`).
6. **M-02** — Add `GET /conversations/:id/messages?q=` endpoint with `ILIKE` search across `messages.body`.

**Phase 3 — Enhancement backlog (Low + feature gaps)**

7. **L-01** — Add "Load older messages" button using the existing `before` cursor param.
8. **M-03** — Implement `announcement` conversation type gated on `program_manager` / `senior_coordinator` roles.
9. **L-04** — Add "Open Chat" deep-link buttons from Risk, Report, and Plan detail pages.
10. **L-02** — Integrate an emoji picker (e.g. `emoji-mart`).
11. **L-05** — Add FK constraints via a Drizzle migration.
12. Audit logging for message send, edit, delete.

---

```
╔══════════════════════════════════════════════════════════════════╗
║                                                                  ║
║   Messages Module Audit Complete                                 ║
║                                                                  ║
║   Score: 56 / 100  🔴 NOT READY FOR PRODUCTION                  ║
║   Critical: 1  High: 2  Medium: 4  Low: 5                       ║
║                                                                  ║
║   Phase 1 remediation (C-01, H-01, H-02) required before        ║
║   the module should be enabled for production users.             ║
║   Estimated fix effort: 2–3 days.                                ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝
```
