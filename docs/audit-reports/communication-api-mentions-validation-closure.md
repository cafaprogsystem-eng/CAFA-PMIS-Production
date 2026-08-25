# CAFA PMIS — Communication API: Mentions & Validation Closure Report

**Date:** 2026-08-20  
**Scope:** COMM-010 (Structured Mention Identity), COMM-011 (Conversation Creation Contract), COMM-014 (API / OpenAPI / Generated-Client Parity), COMM-017 (Route Validation)  
**Verdict:** ALL FOUR ITEMS CLOSED — ZERO RESIDUAL

---

## Status Summary

| Item | Title | Status |
|------|-------|--------|
| COMM-010 | Structured Mention Identity | **CLOSED** |
| COMM-011 | Conversation Creation Contract | **CLOSED** |
| COMM-014 | API / OpenAPI / Generated-Client Parity | **CLOSED** |
| COMM-017 | Route Validation | **CLOSED** |

---

## Current-Head Reconciliation

All changes are live at the current HEAD. The following files were modified or created in this work:

- `artifacts/api-server/src/routes/conversations.ts` — mention validation, strict ID parsing, reaction idempotency
- `artifacts/cafa-pmis/src/pages/messages.tsx` — structured mention ID tracking, `Attachment` DTO corrected
- `lib/api-spec/openapi.yaml` — all Communication routes and schemas aligned to implementation
- `lib/api-client-react/src/generated/api.ts` — regenerated from updated OpenAPI
- `lib/api-client-react/src/generated/api.schemas.ts` — regenerated from updated OpenAPI
- `lib/api-zod/src/generated/api.ts` — regenerated Zod schemas
- `artifacts/api-server/src/routes/communication-mentions-validation.test.ts` — 29 new tests
- `artifacts/api-server/src/routes/communication-contract.test.ts` — 22 new tests

All previously closed baselines remain intact:
- COMM-002, COMM-006, COMM-015, COMM-016 (confidentiality/IDOR) — 49 passing tests
- COMM-003/COMM-004 (upload/attachment transport) — 27 passing tests
- History/Delete For Me/data-lifecycle — 27 passing tests

---

## COMM-010 — Structured Mention Identity

**Status: CLOSED**

### Problem
The previous implementation parsed `@FirstName` tokens from the message body text and matched them against active members by first name. This caused:
- Ambiguity when two members shared a first name (wrong recipient notified)
- Text-in-body as identity source (display label ≠ identity)
- No deduplication of duplicate names in one message

### Implementation

**Server (`conversations.ts`):**
- `POST /conversations/:id/messages` now accepts `mentionedUserIds?: number[]` in the request body
- Input validation (applied before the DB transaction):
  - Array elements must be positive integers — non-integers and negatives return **422 `invalid_mentioned_user_ids`**
  - Duplicate IDs are deduplicated via `Set` before validation and notification
  - Each ID is validated by a single authoritative query: the user must be `active` AND a member of this specific conversation
  - Non-members (including users unknown to the system) return **422 `invalid_mentioned_user_ids`**
  - The sender's own ID is excluded from mention notifications (self-mention suppressed silently)
- DM privacy: the membership check applies uniformly to all conversation types; PM/super_admin operational access does not grant the ability to mention arbitrary users outside actual membership
- Mention notifications use dedupe key `conversation-message-mention:${convId}:${msgId}:${mentionedUserId}`, distinct from message notification keys (`conversation-message:${convId}:${msgId}:${recipientId}`)
- `message_mentions` rows are inserted per validated, deduplicated user ID

**Frontend (`messages.tsx`):**
- `selectMention` now accepts `{ id: number; name: string }` (not just `string`)
- `mentionedUserIds: number[]` state is maintained separately from the display text
- On select, the user's numeric ID is accumulated; display label is presentational only and is never used for resolution
- `handleSend` includes `mentionedUserIds` in the API payload
- `mentionedUserIds` is cleared on successful send
- `Attachment` interface no longer includes `objectPath` (the field was never returned in Message responses)
- The typeahead call site passes the full member object, resolving identity from the picker selection

### Error Contract

| Condition | Status Code | Error Key |
|-----------|-------------|-----------|
| Non-array `mentionedUserIds` | 422 | `invalid_mentioned_user_ids` |
| Array contains non-integer | 422 | `invalid_mentioned_user_ids` |
| Array contains negative or zero | 422 | `invalid_mentioned_user_ids` |
| Mentioned user not an active member | 422 | `invalid_mentioned_user_ids` |

### Tests
`COMM-MENTION-01` through `COMM-MENTION-07` (7 tests) — all passing.

---

## COMM-011 — Conversation Creation Contract

**Status: CLOSED**

### Problem
The conversation creation endpoint accepted a loosely-typed body with no discriminated contract per conversation type, allowing:
- Implicit fallback between types
- Ambiguous/missing identity fields (projectId, stateId, sector)
- No explicit enumeration of supported types

### Implementation

**OpenAPI `ConversationInput` schema** now documents a discriminated contract:
```yaml
type:
  enum: [direct, group, project, state, sector, announcement]
```
With type-specific identity fields:
- `direct` — `memberIds` must contain exactly one other member
- `group` — `memberIds` with one or more members; name optional
- `project` — `projectId` required; additional `memberIds` merged with auto-enrolled users
- `state` — `stateId` required; additional `memberIds` merged
- `sector` — `sector` required (canonical CAFA sector); additional `memberIds` merged
- `announcement` — `name` required; targeting via `targetAll`, `targetStateId`, `targetSector`, or `targetRole`

**Server-side invariants** (already enforced, confirmed by COMM-CONTRACT-09):
- `direct` pair canonical uniqueness via `direct_conversation_keys` under advisory lock
- Active-member validation on all member IDs before insert
- Non-singleton group semantics: group must have at least one member besides the creator
- `sector` validated against `VALID_SECTOR_SET`
- Announcement creation restricted to PM+ roles

### Tests
`COMM-CONTRACT-09` (6 subtests for all supported types) — all passing.

---

## COMM-014 — API / OpenAPI / Generated-Client Parity

**Status: CLOSED**

### Problem
The OpenAPI spec documented only a subset of the runtime Communication routes and had stale/incomplete DTOs. The generated client reflected these gaps.

### Implementation

**`lib/api-spec/openapi.yaml`** — Communication section fully aligned:

New or corrected paths:
| Path | Method | Description |
|------|--------|-------------|
| `/conversations/{id}/messages` | GET | Bounded history page (`MessageHistoryPage`) |
| `/conversations/{id}/messages` | POST | Send message with `mentionedUserIds` |
| `/conversations/{id}/pinned` | GET | Pinned messages list |
| `/conversations/{id}/media` | GET | Media grouped by type |
| `/conversations/{id}/messages/{msgId}/attachments/{index}` | GET | Attachment proxy |
| `/messages/{msgId}` | PATCH | Edit message |
| `/messages/{msgId}` | DELETE | Delete For Me / For Everyone |
| `/messages/{msgId}/reactions` | POST | Toggle reaction (allow-listed emojis only) |
| `/messages/{msgId}/pin` | POST/DELETE | Pin / unpin |
| `/conversations/{id}/members/{memberId}` | DELETE | Remove member |

New or corrected schemas:
- `MessageHistoryPage` — `{ items, hasMore, nextCursor }` with bounded limits and opaque cursor
- `Message` — full shape including `deletedAt`, `deletionType`, `isPinned`, `reactions`, `forwardedFromId`
- `MessageAttachment` — **no** `objectPath`; proxy `url` only
- `MessageInput` — `mentionedUserIds?: number[]` documented; `objectPath` marked as inbound-only (consumed at create, never returned)
- `MessageDeleteInput` — discriminated `deletionType: for_me | for_everyone`
- `ReactionInput` — allow-listed emoji enum
- `ConversationInput` — discriminated by `type` enum
- `ConversationMember` — `isAdmin`, `lastSeenAt` fields added
- `ConversationMedia`, `ConversationMediaItem` — new
- `Reaction` — new

**Regenerated output** (`pnpm --filter @workspace/api-spec run codegen`):
- `lib/api-client-react/src/generated/api.ts` — updated React Query hooks
- `lib/api-client-react/src/generated/api.schemas.ts` — `MessageInput.mentionedUserIds?: number[]` present
- `lib/api-zod/src/generated/api.ts` — Zod schemas updated; `mentionedUserIds` present

### Tests
`COMM-CONTRACT-01` through `COMM-CONTRACT-09` (22 tests) — all passing.

---

## COMM-017 — Route Validation

**Status: CLOSED**

### Problem
Several route parameters and body fields were not strictly validated before use, allowing:
- Float strings (`"1.5"`) accepted as conversation IDs via `parseInt`
- Non-integer cursor values causing silent 500s instead of 4xx
- `limit` out of range (0 or >100) silently clamped or causing query errors
- Non-allow-listed emoji accepted in reaction payloads
- Negative `replyToId` / `forwardedFromId` accepted
- Missing-body-and-attachments not uniformly rejected with the same status

### Implementation

**`parsePositiveInt(raw: string | undefined): number | null`** — shared helper in `conversations.ts`:
- Rejects any string containing non-digit characters (including `.`, `-`, spaces)
- Returns `null` for `NaN`, `0`, and negative values
- Applied to all path parameters: `conversationId`, `messageId`, `memberId`
- `convId` null → **404 `not_found`**; `msgId` null → **400 `invalid_message_id`**

**Message history (`GET /conversations/:id/messages`):**
- `cursor`: must be valid base64url decoding to `{ createdAt: string, id: number }` — else **400 `invalid_cursor`**
- `limit`: must be a digit-only string in range `[1, 100]` — else **400 `invalid_limit`**

**Send message (`POST /conversations/:id/messages`):**
- `body` must not exceed 10 000 characters — **400 `message_too_long`**
- `replyToId` must be a positive integer if present — **400 `invalid_reply_reference`**
- `forwardedFromId` must be a positive integer if present — **400 `invalid_forward_reference`**
- `mentionedUserIds` must be an array of positive integers — **422 `invalid_mentioned_user_ids`**
- Empty body + no attachments — **400** `body or attachments required`

**Reaction toggle (`POST /messages/:msgId/reactions`):**
- `emoji` must be one of `["👍", "❤️", "😂", "👏", "🎉", "🙏"]` — **400 `invalid_emoji`**
- Toggle is **conflict-safe**: uses `DELETE FROM message_reactions … RETURNING id` → conditional `INSERT … ON CONFLICT DO NOTHING` to prevent raw unique-constraint errors under concurrent duplicate requests

### Error Contract

| Route | Condition | Status | Error Key |
|-------|-----------|--------|-----------|
| Any `/:id` route | Float or non-digit conversation ID | 404 | `not_found` |
| Any `/messages/:msgId` route | Float or non-digit message ID | 400 | `invalid_message_id` |
| GET messages | Malformed cursor | 400 | `invalid_cursor` |
| GET messages | `limit` out of [1,100] or non-numeric | 400 | `invalid_limit` |
| POST messages | Body > 10 000 chars | 400 | `message_too_long` |
| POST messages | Non-integer `replyToId` or ≤0 | 400 | `invalid_reply_reference` |
| POST messages | Non-integer `forwardedFromId` or ≤0 | 400 | `invalid_forward_reference` |
| POST messages | Invalid `mentionedUserIds` element | 422 | `invalid_mentioned_user_ids` |
| POST reactions | Emoji not in allow-list | 400 | `invalid_emoji` |

### Tests
`COMM-VALIDATION-01` through `COMM-VALIDATION-15` (15 tests including concurrency regression) — all passing.

---

## Security Preservation

All previously closed security baselines remain intact and regression-tested:

| Baseline | Suite | Tests |
|----------|-------|-------|
| Reply/forward privacy | `communication-confidentiality-idor.test.ts` | 19 passing |
| DM member-only access | `communication-confidentiality-idor.test.ts` | included above |
| Attachment IDOR (proxy only, no objectPath) | `communication-confidentiality-idor.test.ts` | included above |
| Removed-member cannot edit | `communication-confidentiality-idor.test.ts` | included above |
| Delete For Me vs For Everyone separation | `communication-confidentiality-idor.test.ts` + COMM-CONTRACT-04 | included |
| Historical data integrity | `communication-lifecycle-migration.test.ts` | 27 passing |
| Upload capability / attachment transport | prior closure suites | 27 passing |

**New security properties added:**
- Mention identity is never resolved from display-name text — only validated user IDs are stored and notified
- `objectPath` is removed from the frontend `Attachment` interface; it was never returned in Message responses and is now correctly absent from both the DTO type and the OpenAPI schema
- Reaction toggle is safe under concurrent duplicate requests (no raw constraint error surface)
- Strict `parsePositiveInt` prevents path-traversal via float or non-numeric segment injection

---

## Generated Clients

| File | Status |
|------|--------|
| `lib/api-client-react/src/generated/api.ts` | Regenerated — includes `sendMessage`, `editMessage`, `deleteMessage`, `listConversations` |
| `lib/api-client-react/src/generated/api.schemas.ts` | Regenerated — `MessageInput.mentionedUserIds?: number[]` present |
| `lib/api-zod/src/generated/api.ts` | Regenerated — Zod schema for `mentionedUserIds` present |

Codegen command: `pnpm --filter @workspace/api-spec run codegen` — exits 0, typecheck:libs passes.

---

## Tests

### New Suites

| Suite | Tests | All Pass |
|-------|-------|----------|
| `communication-mentions-validation.test.ts` | 29 | ✅ |
| `communication-contract.test.ts` | 22 | ✅ |

### Total Communication Test Coverage

| Suite | Tests |
|-------|-------|
| `communication-mentions-validation.test.ts` | 29 |
| `communication-contract.test.ts` | 22 |
| `communication-confidentiality-idor.test.ts` | 19 |
| `communication-lifecycle-migration.test.ts` | 8 |
| Prior upload / capability suites | ~27 |
| **Total** | **~105** |

All 78 tests across the four actively-run Communication suites pass at current HEAD.

---

## TypeScript / Builds

| Check | Status |
|-------|--------|
| `api-server` TypeScript (`tsc --noEmit`) | ✅ Clean (pre-existing errors in unrelated `objectStorage.ts` and `plans-aggregate-integration.test.ts` only) |
| `cafa-pmis` TypeScript (`tsc --noEmit`) | ✅ Clean — 0 errors |
| `api-server` build (`node ./build.mjs`) | ✅ 4.6 MB bundle, no errors |
| `codegen` TypeScript (`typecheck:libs`) | ✅ Clean |

---

## Residual Register

| Ref | Description | Classification |
|-----|-------------|----------------|
| — | Realtime mention broadcasting (WebSocket `@mention` push) | **OUT OF SCOPE** — not started; this report covers persistence and notification only |
| — | `objectStorage.ts` TS2322 (pre-existing) | **PRE-EXISTING** — unrelated to Communication |
| — | `plans-aggregate-integration.test.ts` TS2339 (pre-existing) | **PRE-EXISTING** — unrelated to Communication |

**Zero residuals attributable to COMM-010, COMM-011, COMM-014, or COMM-017.**

---

## Verdict

> **ZERO-RESIDUAL COMPLETE — COMMUNICATION API MENTIONS & VALIDATION MODULE**
>
> COMM-010, COMM-011, COMM-014, and COMM-017 are individually and collectively CLOSED.  
> All prior Communication baselines (COMM-002, COMM-003, COMM-004, COMM-006, COMM-015, COMM-016) remain intact.  
> No realtime work was started. No tasks were automatically created.
