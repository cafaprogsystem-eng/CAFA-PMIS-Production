# Communication Centre Read State and List Scale Closure

**Closure date:** 20 August 2026  
**Scope:** `COMM-012`, `COMM-013`, and `COMM-021` only.

## Canonical model

Communication has a membership-level read marker:
`conversation_members.last_read_at`. It does not store a per-message delivery
or seen receipt. This closure preserves that model rather than manufacturing a
second receipt system from socket events or list refreshes.

- Marking a conversation read updates only the authenticated member's row.
- Direct Messages remain member-only, including for Programme Manager and Super
  Admin.
- An authorised operational viewer of a non-direct conversation has no
  membership row and therefore receives `unreadCount: null`, not a fabricated
  personal unread number.
- The unread-only filter matches only conversations with a real member read
  state. Sender-authored messages do not contribute to that member's unread
  count.
- Delete For Me remains viewer-specific through the hide table, while Delete
  For Everyone does not expose a body or attachment preview.

## List contract

`GET /conversations` now returns:

```json
{ "items": [], "hasMore": false, "nextCursor": null }
```

The endpoint accepts a bounded `limit` (1–100), opaque activity cursor, type,
search, and unread filters. Search/type/unread conditions are applied before
the page boundary. Results are ordered by last visible message activity (or
conversation update time), then conversation ID, so ties are deterministic.

The server uses set-based visible-message, latest-preview, and member-unread
relations. It retains the canonical membership/full-operational-access check,
Direct Message privacy, per-user hides, and shared-deletion-safe previews.
The API specification and generated client now expose the same envelope.

The Messages sidebar uses an infinite query, deduplicates rows across a
refetch/cursor overlap, keeps the selected route intact, and offers a compact
Load More control. The header dropdown asks for only eight rows. Realtime
continues to invalidate/refetch authoritative HTTP data; it does not create
read evidence.

## Receipt presentation

The sender-side double-check icon was removed. There is no visible or
accessible "Seen" or "Delivered" claim in the message bubble because the data
model cannot prove either claim. This is a truthful product constraint, not a
missing realtime event.

## Closure classification

| Item | Classification | Reason |
|---|---|---|
| `COMM-012` | CLOSED | Membership-level read state is explicit, actor-only, and non-members cannot acquire or simulate it. |
| `COMM-013` | CLOSED | Conversation listing is bounded, cursor-paginated, server-filtered, deterministically ordered, and consumed incrementally by the web UI. |
| `COMM-021` | ACCEPTED DESIGN CONSTRAINT | Per-message Seen/Delivered receipts do not exist. Unsupported claims were removed rather than invented. |

## Verification evidence

- Focused API Communication contract and confidentiality suites: **55 tests
  passed**.
- Web Communication controls suite: **7 tests passed**, including conversation
  page deduplication and the absence of unsupported receipt UI.
- CAFA PMIS TypeScript check: **passed**.
- API/generated-client validation is run with the full Communication regression
  suite below.
- API production build: **passed**.
- API TypeScript check remains blocked by the same nine unrelated baseline
  errors in object-storage metadata narrowing and the plans aggregate
  integration test. No reported error is in this closure's files.
- The unauthenticated `/messages` browser preview redirected normally to Sign
  In, with no startup or browser crash. No safe authenticated non-production
  session was available for a multi-user list/read-state browser check.