# Communication Centre Data / Lifecycle Closure

## 1. Status

| Finding | Status |
|---|---|
| COMM-003 — Message history pagination | **CLOSED** |
| COMM-004 — Per-user Delete For Me | **CLOSED** |
| COMM-005 — Data-model and conversation-identity integrity | **CLOSED (software); historical reconciliation open** |

## 2. Current-Head Reconciliation

Current HEAD confirmed all three original residuals: initial history selected the
oldest bounded messages, Delete For Me modified the shared message row, and
Communication integrity rules were neither fully tracked nor safe under
concurrent creation. The completed Communication security closures remain
preserved: COMM-001, COMM-002, COMM-006, COMM-007, COMM-015, COMM-016, and
Task #637 attachment immutability and parent-authorised delivery.

## 3. COMM-003 Message History

The conversation message API now fetches a newest bounded database page ordered
by `created_at DESC, id DESC`, then returns that page in chronological display
order. The UI opens on the newest messages and presents a Load older messages
control instead of requesting an unbounded history.

## 4. Pagination Contract

`GET /conversations/:id/messages` accepts `limit` from 1 to 100 and an opaque
`cursor`. It returns:

```json
{ "items": [], "hasMore": false, "nextCursor": null }
```

The cursor carries the immutable `(created_at, id)` boundary of the oldest
returned item. The next page uses a strict tuple comparison, which prevents
duplicates, gaps, and timestamp-tie reordering when newer messages arrive.
`idx_messages_conversation_history` is a tracked composite history index.

## 5. COMM-004 Delete For Me / Everyone

Delete For Me inserts an actor-specific `message_user_hides` row. It does not
set a shared deletion state, blank another member's body, remove their
attachment, or affect their reply/pin/preview visibility. Private hides require
a real membership row; operational viewing access is not silently converted
into membership.

Delete For Everyone remains the shared lifecycle state. It redacts the message
for all viewers and clears an existing pin, without deleting the accepted
attachment object.

Every requesting-user representation now honours a private hide: history,
conversation detail previews, unread calculations, pinned rows, reply context,
search, media galleries, reactions, and the message-scoped attachment proxy.
The hidden member receives no content through a stale attachment URL; other
authorised participants retain their accepted attachment access.

## 6. Attachment Lifecycle Safety

The migration and Delete For Me implementation never delete an attachment
object. Attachment transport remains message-scoped, immutable after
acceptance, and parent-authorised through the Communication proxy. COMM-BD-004
orphan-upload retention remains explicitly out of scope.

## 7. COMM-005 Data Model

Migration `032_communication_lifecycle_integrity` is tracked in the API
migration runner and introduces:

- `message_user_hides`;
- `direct_conversation_keys`;
- `organisational_conversation_keys`;
- `(conversation_id, created_at DESC, id DESC)` history indexing;
- forward-enforcing, non-validating foreign keys for conversation creator,
  project/state identity, membership parents, and message parents.

The non-validating form preserves historical rows while rejecting invalid
future parent references. It is intentional until the reconciliation register
is resolved. Migration `033_communication_membership_write_integrity` adds a
forward-only database trigger for `conversation_members`: it locks each
conversation/user pair and rejects new duplicate inserts or identity-changing
updates. This deliberately preserves historical duplicate rows for human
reconciliation rather than deleting or merging any evidence automatically.

## 8. Membership Integrity

New member additions validate an active existing user, reject Direct rooms, use
a transaction-scoped advisory lock for the conversation/user pair, and return
idempotent success if membership already exists. This prevents parallel adds
from exposing a raw database unique error.

## 9. Direct Conversation Identity

New DMs use a canonical ordered user pair with a database-backed key table and
a transaction-scoped advisory lock. Concurrent creation converges on one
thread. Historical malformed Direct rooms are not adopted as canonical
pairwise threads and are registered for human review.

## 10. Organisational Conversation Identity

New Project, State, and Sector conversations claim one canonical entity key.
Project and State identities are validated before creation; sectors retain the
existing canonical taxonomy validation. Manual Group conversations are
deliberately not keyed and remain non-singleton. Programme Manager and Super
Admin operational access remains non-membership access for non-DM rooms.

## 11. Migrations / Preflight

Development preflight completed before migration application. Migration `032`
was recorded successfully and the new tables, composite index, and
forward-enforcing foreign keys were verified in the development catalogue.

## 12. Historical Data Register

See [communication-data-reconciliation-register.md](communication-data-reconciliation-register.md).
It separates historical data decisions from the corrected future-write
software path and contains no private message content.

## 13. Security Regression

Direct Messages remain member-only for every role, including Programme Manager
and Super Admin. Existing reply/forward, removed-member edit, deterministic
read, attachment authorisation, and attachment immutability tests remain in
scope for regression.

Realtime new-message events now contain only a message and conversation
identity. Each recipient refetches their own authorised history view, so a
sender-rendered reply preview cannot disclose a source another member chose to
hide privately.

## 14. Tests

The Communication confidentiality route suite now additionally checks:

- the paginated newest-page response and chronological display order;
- opaque cursor metadata;
- actor-private Delete For Me insertion without a shared message update;
- private-hide redaction of reply previews, including same-conversation binding;
- an edit that loses a race with Delete For Everyone.
- identity-only realtime fan-out so recipient-specific reply visibility cannot
  be exposed in a shared socket payload;
- a pin that loses a race with Delete For Everyone without restoring pin state,
  recording an audit success, or notifying members.
- hidden-message protection for detail previews, unread counts, reply snippets,
  and attachment retrieval;
- deterministic client history merging when a realtime refresh overlaps a
  cursor boundary.

Focused backend regressions passed: **49 tests across 5 files**, plus **3
frontend Communication controls/history tests**:

- Communication confidentiality / IDOR;
- attachment provenance and immutable transport;
- Communication upload transport.
- migration tracking and future-membership uniqueness.

The API and frontend production builds both completed successfully.

Browser-level verification was attempted without mutating any data, but the
isolated test browser had no authenticated CAFA PMIS session and `/messages`
redirected to login with expected 401 API responses. The protected Messages
UI and Load older control therefore require a follow-up authenticated session
check; this is a verification-environment gap, not a known feature failure.
## 15. TypeScript / Builds

Workspace type checks continue to report baseline diagnostics in storage,
reports, risks, plan integration tests, and stale generated client types; they
are outside this closure. The focused Communication suites and both production
builds complete successfully despite those repository-wide type-check failures.

## 16. Residuals

- Historical data reconciliation remains required before global legacy-row
  constraint validation.
- COMM-BD-004 attachment/orphan retention remains open and was not changed.
- Realtime fan-out redesign, Arabic, visual refinement, and Notification
  functionality are out of scope.
