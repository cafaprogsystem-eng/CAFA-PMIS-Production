# Communication Centre Realtime Socket Lifecycle Closure

**Closure date:** 20 August 2026  
**Scope:** `COMM-008`, `COMM-009`, and `COMM-018` only.  
**Status:** Closed after targeted implementation and regression verification.

## Scope and boundaries

This closure covers authorised Communication Centre Socket.IO room access,
identity-only realtime invalidation events, and the Messages page socket
lifecycle. It does not redesign notifications, read receipts, conversation
pagination, offline messaging, or realtime behaviour in other modules.

Communication notifications remain independently created and delivered. They
are not used as a replacement for realtime convergence events.

## Canonical conversation-room authority

- Conversation rooms use the same `canAccessConversation` decision as HTTP.
- A socket join accepts only a strictly positive numeric conversation ID and
  returns a deterministic acknowledgement.
- Direct conversations require a real membership row for every role, including
  Programme Manager and Super Admin.
- Programme Manager and Super Admin may join only non-direct conversations when
  the canonical operational-access decision permits it. Joining does not create
  a membership row.
- Every protected room emission refreshes the socket user's active status and
  current role, then re-runs the canonical decision. A removed or deactivated
  socket is removed from the room and receives an access-revoked identity event
  instead of protected conversation data.

## Realtime event contract

Conversation events contain only refetch identities:

- `message:new` carries the conversation and message IDs.
- `conversation:changed` carries the conversation ID, change kind, optional
  message ID, and safe actor identity hints.
- `conversation:updated` is the member-list/unread invalidation hint for users
  who are not currently in the conversation room.

No realtime Communication event carries message content, attachments or storage
metadata, per-user hide state, or a recipient-specific reply projection.

The following committed mutations emit an authorised refetch event: message
creation, edit, shared delete, reaction toggle, pin, unpin, conversation
rename, member add, and member removal. Delete For Me remains a per-user hide
only and does not create a shared conversation event. After its committed hide
mutation it sends a minimal actor-only invalidation to the actor's other
sessions. The route emits only after the relevant database mutation or
transaction commit succeeds.

## Messages client lifecycle

- Messages now uses the app-wide authenticated `SocketProvider`; it does not
  construct a second page-local Socket.IO client.
- Selecting a conversation joins its authorised room, leaves the prior room on
  route change/unmount, and re-joins on reconnect.
- All Messages listeners are removed with their exact handler references.
- Reconnect invalidates authorised list/detail/history/pinned queries before
  the current room is rehydrated.
- Invalid IDs never generate an API request or room join. Access loss clears
  the affected cached conversation state and returns the user to the Messages
  list.
- Delete For Me immediately refreshes that actor's message history, detail,
  list, and unread caches; their other sessions receive the same actor-only
  refetch hint.
- Per-conversation composition, typing, reply/edit, mention, and panel state
  is reset when switching conversations. The root socket provider is remounted
  by authenticated user ID, preventing a prior user's socket from surviving a
  session change.

## Closure classification

| Item | Classification | Evidence |
|---|---|---|
| `COMM-008` | Closed | Authorised room join/leave, DM member-only enforcement, typing relay, malformed-ID rejection, and access re-check/removal. |
| `COMM-009` | Closed | Commit-after-mutation identity events converge message, edit, shared-delete, reaction, pin, and membership changes through authorised HTTP refetches. |
| `COMM-018` | Closed | One provider socket, deterministic listener cleanup, conversation switching, reconnect rejoin/refetch, access-loss handling, and user-session remount isolation. |

## Verification evidence

- API Communication and Notification matrix: **281 tests passed** across
  realtime boundary, lifecycle migration, Communication routes/upload
  transport, notification hardening, delivery, taxonomy, link safety, and
  recipient deduplication coverage.
- Web Communication and Notification matrix: **15 tests passed**, including
  strict route-ID handling and shared-socket listener cleanup.
- API production build: **passed**.
- Web production build: **passed**.
- Web TypeScript check: **passed**.
- API typecheck remains blocked by nine pre-existing errors in object-storage
  metadata narrowing and the plans aggregate integration test; no reported
  error is in the realtime closure files.
- Project-wide web lint remains blocked by existing unrelated lint errors in
  notification client and PMR test files. The changed Messages and socket files
  pass the web TypeScript check and focused tests.
- No authenticated non-production browser session was available for a live
  multi-user socket probe. A fresh `/messages` browser context redirected
  normally to Sign In, with no app crash; this closure does not claim the
  unavailable authenticated realtime verification.