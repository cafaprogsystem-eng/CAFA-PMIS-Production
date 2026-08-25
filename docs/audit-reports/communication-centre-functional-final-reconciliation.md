# Communication Centre Functional Final Reconciliation

**Audit date:** 20 August 2026  
**Scope:** Communication Centre only (`COMM-001`–`COMM-021`)  
**Authority:** Current HEAD, tracked migrations, current route/client contracts, and
current automated evidence take precedence over historical audit wording.

## 1. Verdict

**ZERO-RESIDUAL COMPLETE — COMMUNICATION CENTRE FUNCTIONAL MODULE**

There are no current actionable Communication Centre software residuals.
`COMM-001` through `COMM-020` are closed. `COMM-021` is an accepted design
constraint: the application has no persisted per-message delivery or seen model,
and unsupported receipt claims are absent.

The separately recorded historical data, orphan-upload retention decision,
authenticated-browser limitation, and unrelated repository TypeScript diagnostics
do not block software functional closure.

## 2. Audit History

The following historical records were reconciled without modification:

1. `communication-centre-functional-audit.md` — original functional audit.
2. `communication-centre-confidentiality-idor-closure.md` — reply/forward,
   attachment, removed-member, and read-access closure.
3. `communication-upload-voice-closure.md` — upload descriptor, capability,
   voice, proxy, and immutability closure.
4. `communication-data-lifecycle-closure.md` — history, private hide,
   identity, membership, and migration closure.
5. `communication-data-reconciliation-register.md` — historical-data register.
6. `communication-api-mentions-validation-closure.md` — API, mentions,
   creation, generated-client, and validation closure.
7. `communication-realtime-socket-lifecycle-closure.md` — socket
   authorisation, convergence, and lifecycle closure.
8. `communication-read-state-list-scale-closure.md` — truthful read state,
   list pagination/scale, and receipt-truthfulness closure.
9. `communication-arabic-accessibility-closure.md` — Arabic/RTL and
   accessibility closure.
10. `notifications-communication-functional-audit-summary.md` — historical
    Communication/Notifications integration context only; Notification core
    behaviour was not reopened.

No separately named `Task #641` closure file exists in the current workspace.
Its requested subject matter was reconciled from the current lifecycle,
confidentiality, migration, and test evidence above rather than inferred from
an unavailable task record.

## 3. COMM-001–COMM-021 Final Register

| ID | Original finding | Current implementation | Current sentinel/test evidence | Current classification | Residual? |
|---|---|---|---|---|---|
| COMM-001 | Messaging upload transport and descriptor handling were incomplete. | Dedicated message upload capability; private descriptor; server canonical filename/MIME/size verification; immutable promotion to a server-controlled accepted key. | `communication-upload-capability.test.ts`, `communication-upload-transport.test.ts`, `conversation-attachment-provenance.test.ts`, `message-upload.test.ts` | CLOSED | No |
| COMM-002 | Reply/forward references could disclose another conversation or hidden content. | Reply source is bound to the target conversation; forwards require the actor’s currently visible source; deleted/private context is redacted; realtime uses identity hints. | `communication-confidentiality-idor.test.ts` | CLOSED | No |
| COMM-003 | History opening/order/cursor behaviour was unsafe or incomplete. | Newest bounded page, opaque `(created_at,id)` cursor, chronological presentation, and incremental Load older behaviour. | `communication-confidentiality-idor.test.ts`, `communication-upload-controls.test.tsx` | CLOSED | No |
| COMM-004 | Delete For Me could mutate shared message state. | `message_user_hides` is actor-specific; shared content, attachments, pins, and other members’ histories remain unaffected. | `communication-confidentiality-idor.test.ts`, `communication-data-lifecycle-closure.md` | CLOSED | No |
| COMM-005 | Future-write identity/membership/message integrity and canonical conversation identity were not adequately migration-backed. | Tracked migrations 032/033 add future-write guards, canonical key tables, history index, parent references, locks, and idempotent membership behaviour. | `communication-lifecycle-migration.test.ts`, `run-migrations.ts`, `communication-data-lifecycle-closure.md` | CLOSED | No — legacy rows are separately recorded |
| COMM-006 | Attachment access could rely on storage path possession rather than parent authorisation. | Access chain is message → conversation → canonical authorisation → proxy/storage object; direct-message attachments remain real-member-only. | `communication-confidentiality-idor.test.ts`, `conversation-attachment-provenance.test.ts` | CLOSED | No |
| COMM-007 | Upload capability/voice transport did not consistently enforce the Messaging contract. | File and voice controls/routes require `messages.attachments.upload`; viewer/text-only access remains text-only. | `communication-upload-capability.test.ts`, `communication-upload-transport.test.ts`, `message-upload.test.ts` | CLOSED | No |
| COMM-008 | Socket room authorisation could diverge from HTTP, particularly for direct messages. | Room join/rejoin rechecks canonical access; malformed IDs fail closed; direct messages require actual membership for every role. | `communication-contract.test.ts`, `communication-realtime-socket-lifecycle-closure.md` | CLOSED | No |
| COMM-009 | Realtime mutations could diverge or disclose recipient-specific data. | Post-commit identity/refetch events converge new/edit/delete/reaction/pin/membership state without broadcasting bodies, attachment internals, or private-hide state. | `communication-confidentiality-idor.test.ts`, `communication-realtime-socket-lifecycle-closure.md` | CLOSED | No |
| COMM-010 | Mentions could derive identity from display text or bypass privacy/membership rules. | `mentionedUserIds` is authoritative; server validates positive active IDs, membership, sender exclusion, and deduplication. | `communication-mentions-validation.test.ts` | CLOSED | No |
| COMM-011 | Conversation creation semantics and singleton identity were under-specified. | Discriminated direct/group/project/state/sector/announcement creation; Direct and organisational keys are canonical/race-safe; Group remains intentionally non-singleton. | `communication-contract.test.ts`, `communication-lifecycle-migration.test.ts` | CLOSED | No |
| COMM-012 | Read state could be fabricated or updated for the wrong actor. | Persisted `conversation_members.last_read_at` is actor-only and membership-scoped. | `communication-confidentiality-idor.test.ts`, `communication-read-state-list-scale-closure.md` | CLOSED | No |
| COMM-013 | Conversation list could be unbounded, unstable, client-filtered, or inefficient. | Server-side filters precede bounded cursor pagination; activity-plus-ID ordering is stable; UI uses incremental deduplicated pages. | `communication-contract.test.ts`, `communication-upload-controls.test.tsx` | CLOSED | No |
| COMM-014 | Runtime API, OpenAPI, generated schemas/client, and frontend consumption could drift. | Current conversation/list/message/read/attachment/mention contracts are documented and consumed as paginated envelopes/typed descriptors. | `communication-contract.test.ts`, `communication-api-mentions-validation-closure.md` | CLOSED | No |
| COMM-015 | A removed message author could still edit based only on authorship. | Edit requires author, active current conversation access, undeleted state, and time window. | `communication-confidentiality-idor.test.ts` | CLOSED | No |
| COMM-016 | Mark-read could falsely succeed or create state for non-members. | Non-members fail deterministically; operational access never creates membership or personal read evidence; DM privacy is strict. | `communication-confidentiality-idor.test.ts`, `communication-read-state-list-scale-closure.md` | CLOSED | No |
| COMM-017 | Route input failures could surface as raw database errors. | Positive identifiers, bounded limits, cursors, body schemas, and concurrency-safe reactions return deterministic client errors. | `communication-mentions-validation.test.ts`, `communication-contract.test.ts` | CLOSED | No |
| COMM-018 | Frontend socket lifecycle could multiply listeners or retain stale conversation state. | One provider socket, explicit listener cleanup, leave/rejoin, A→B isolation, reconnect/refetch, and access-loss handling. | `communication-upload-controls.test.tsx`, `communication-realtime-socket-lifecycle-closure.md` | CLOSED | No |
| COMM-019 | Arabic/localisation parity and RTL Communication chrome were incomplete. | English/Arabic Messages namespaces have 201 matching keys; UI chrome and active-locale dates/times are localised without translating user content. | `communication-i18n-accessibility-contract.test.ts`, `communication-arabic-accessibility-closure.md` | CLOSED | No |
| COMM-020 | Keyboard, accessible-name, form, media, mention, voice, and pagination gaps remained. | Semantic buttons, translated names, focus-revealed message actions, keyboard media, labelled inputs, listbox mentions, and named voice/reaction controls. | `communication-i18n-accessibility-contract.test.ts`, `communication-upload-controls.test.tsx` | CLOSED | No |
| COMM-021 | UI implied per-message Seen/Delivered evidence not supported by storage. | No per-message receipt model exists; unsupported double-check/Seen/Delivered claims are absent; membership-level read state remains. | `communication-upload-controls.test.tsx`, `communication-read-state-list-scale-closure.md` | ACCEPTED DESIGN CONSTRAINT | No |

## 4. Security Invariants

| Invariant | Current evidence |
|---|---|
| Direct messages are member-only for every role, including Programme Manager and Super Admin. | `conversationAuth.ts`; confidentiality, contract, and realtime suites |
| Attachment authority derives from the parent message/conversation, never a filename, object path, or guessed storage URL. | `conversationAttachments.ts`; provenance and confidentiality suites |
| Public message DTOs contain proxy URLs, not storage internals. | upload/provenance/confidentiality suites |
| Delete For Me is actor-only and cannot change shared content or another viewer’s state. | lifecycle closure; confidentiality suite |
| Reply/forward provenance and recipient visibility cannot disclose cross-conversation or privately hidden source content. | confidentiality suite; identity-only realtime design |
| Removed members cannot edit merely because they authored the message. | confidentiality suite |
| Socket authorisation rechecks canonical access and removes users who lose it. | realtime closure; `messages.tsx` socket lifecycle |
| Mention identity is structured user-ID data, not parsed first-name text. | mentions/validation suite |
| Validation is bounded and deterministic before SQL/state mutation. | contract and validation suites |
| Operational non-members do not gain fake membership or personal read state. | list/read-state closure and contract suite |

## 5. Message Lifecycle

Messages open with a bounded newest history page and Load older cursor pagination.
Shared Delete For Everyone tombstones/redacts message content and clears pin state.
Delete For Me writes an actor-only hide record and is reflected across history,
previews, unread calculations, replies, media, and attachment access without
changing other users’ message views. Edit and pin races with a shared deletion
cannot restore deleted state or emit false success.

## 6. Attachment / Storage Contract

Messaging uploads use a dedicated capability and canonical private descriptor.
The server validates filename, MIME type, declared size, actor, descriptor,
private path, and provider-authoritative object metadata before a message can
refer to the object. It promotes verified temporary bytes to a fresh
server-controlled accepted-message key, so the original signed upload cannot
overwrite accepted evidence.

Reads are proxy-only. Conservative image/audio types may be inline; unsafe files
are delivered safely as downloads with sanitised filenames. Direct-message
attachment access always requires real membership.

## 7. Conversation Identity / Membership

Tracked lifecycle migrations establish `direct_conversation_keys`,
`organisational_conversation_keys`, `message_user_hides`, history indexing, and
forward-enforcing parent relationships. Migration 033 protects future
membership writes with locking and duplicate rejection while preserving legacy
rows for human reconciliation.

Direct rooms use a canonical unordered user pair. Project, State, and Sector
rooms use canonical organisational identities. Manual Groups are intentionally
non-singleton. New membership additions validate active users, reject Direct
room additions, and return idempotently under concurrency.

## 8. Realtime / Socket Lifecycle

Realtime is an authorised invalidation/refetch mechanism, not a second message
data authority. Shared events carry identity enough to refetch the recipient’s
own HTTP-authorised representation. This protects hidden replies, attachments,
and per-user Delete For Me state.

The frontend has one app-level socket, cleans up listeners/rooms on route or
session changes, rejoins after reconnect, and clears current conversation state
when access is revoked.

## 9. Mentions

`mentionedUserIds` is the canonical mention identity. The server rejects invalid,
inactive, non-member, and direct-message outsider IDs; removes duplicates; and
does not create a mention for the sender. Message and Mention notification
events remain distinct integration calls with separate logical identities.
Notification core contracts were not changed.

## 10. Read State

The canonical state is membership-level `conversation_members.last_read_at`.
Only the authenticated member can update it. Direct non-members are denied. An
operationally authorised non-member of a non-direct conversation may view the
conversation but has `unreadCount: null`, not a fabricated `0` or a synthetic
membership/read receipt.

## 11. Conversation List / Scale

`GET /conversations` returns `{ items, hasMore, nextCursor }`, accepts a bounded
limit from 1–100, validates an opaque activity cursor, and applies search, type,
and unread filters server-side before pagination. Ordering uses visible activity
time plus conversation ID as a stable tie-breaker. The UI loads incrementally
and deduplicates cursor/refetch overlap.

The route uses set-based visible-message, preview, membership, and unread
relations; no current evidence shows a per-conversation N+1 regression.

## 12. API / OpenAPI / Validation

Current runtime routes, OpenAPI, generated client/Zod output, and frontend
consumption agree on the paginated conversation contract and message upload
descriptor. Public response types do not expose storage keys. Public route
validation covers malformed identifiers, list bounds, cursors, filters,
creation bodies, attachments, and mention IDs before database state can surface
as a raw 500.

## 13. Arabic / RTL

The Messages English and Arabic namespaces currently have exact 201-key leaf
parity. Types, actions, filters, composer, errors, pagination, attachments,
reactions, pins, announcements, roles, and time formatting use localised system
framing. Direction-sensitive Communication paths use logical start/end utilities
and mirror the back control in RTL.

Message bodies, user names, filenames, and entity names are intentionally
verbatim user/domain data and are not translated.

## 14. Accessibility

Conversation rows and native controls are keyboard-operable. Message action
controls remain visible on focus within a message. Media tiles are buttons;
voice seek/reaction controls and icon-only actions have translated accessible
names. Composer/dialog controls are named or labelled. Mentions expose
listbox/option state with Arrow, Enter/Tab, Escape, and active-descendant
semantics. Loading older, retry, and load-more flows retain semantic buttons.

## 15. Receipt Truthfulness

There is no persisted per-message delivery or seen receipt. The UI does not
present Seen, Delivered, or double-check claims. Conversation-level read state
is retained because it is backed by membership data. This is an accepted design
constraint, not a missing realtime implementation.

## 16. Database / Migrations

Communication-owned future-write protections are tracked in the migration runner:

- `032_communication_lifecycle_integrity`: hide table, key tables, history
  index, and forward-enforcing `NOT VALID` parent relationships.
- `033_communication_membership_write_integrity`: duplicate membership and
  identity-change protection for future writes.

`NOT VALID` is deliberate: legacy rows remain available for approved human
reconciliation rather than being deleted, merged, or globally revalidated by
this closure. No Communication-owned startup DDL substitutes for tracked
migrations.

## 17. Notification Integration Boundary

Communication retains its closed integration points for message, mention, pin,
and announcement notifications. Mention validation tests confirm Message and
Mention remain distinct logical events. Notifications `NOTIF-001`–`NOTIF-010`
were not modified or reopened.

## 18. Test Inventory

### Backend — 7 files / 105 passed / 0 failed

1. `src/lib/communication-lifecycle-migration.test.ts`
2. `src/routes/communication-confidentiality-idor.test.ts`
3. `src/routes/communication-contract.test.ts`
4. `src/routes/communication-mentions-validation.test.ts`
5. `src/routes/communication-upload-capability.test.ts`
6. `src/routes/communication-upload-transport.test.ts`
7. `src/routes/conversation-attachment-provenance.test.ts`

### Frontend — 3 files / 16 passed / 0 failed

1. `src/lib/message-upload.test.ts`
2. `src/test/communication-i18n-accessibility-contract.test.ts`
3. `src/test/communication-upload-controls.test.tsx`

The current focused total is **10 files / 121 passed / 0 failed**.

## 19. TypeScript / Builds

- CAFA PMIS frontend TypeScript check: **passed**.
- API production build: **passed**.
- CAFA PMIS frontend production build: **passed**.
- Communication-owned TypeScript errors: **0**.

API-wide TypeScript remains **EXTERNAL BASELINE** with nine unrelated errors:
two metadata-narrowing diagnostics in `src/lib/objectStorage.ts` and seven
`PoolClient` diagnostics in `src/test/plans-aggregate-integration.test.ts`.
Neither file is a Communication route/library/test. No cancelled or unrelated
typecheck-restoration work was performed.

## 20. Browser Verification

No safe authenticated non-production browser session was available. A fresh
browser visit to `/messages` correctly redirected to Sign In and did not crash;
the only console entries were expected unauthenticated `401` responses.

**AUTHENTICATED BROWSER VERIFICATION — ENVIRONMENT LIMITATION.**

This does not block closure because current rendered frontend tests cover the
changed accessible messaging controls and the backend suites cover the
authorisation/visibility contracts. No production credentials were used.

## 21. Software Residual Register

**NONE**

## 22. Historical Data Reconciliation Register

Historical development data remains intentionally unmodified and requires
human-approved reconciliation:

| Historical anomaly | Recorded current register evidence | Required decision |
|---|---|---|
| Duplicate membership pairs | Three known conversation/user pairs with duplicate rows | Approve any consolidation before global legacy constraint validation |
| Malformed Direct rooms | Two rooms have more than two historical participants | Decide ownership/representation; do not treat them as canonical pairwise DMs |
| Duplicate sector room | Two historical WASH rooms | Select a canonical room without automatic history merge |
| Orphan memberships | 69 recorded rows | Identify missing parents and approve repair |
| Orphan message references | Six recorded message IDs | Decide repair or retention as legacy evidence |
| Unbound project room | One recorded conversation | Confirm valid project ownership or approved archive path |

Tracked future-write controls protect new data. These legacy anomalies are
**HISTORICAL DATA REVIEW**, not current software residuals. No delete, merge,
repair, global constraint validation, or historical content rewrite was
performed.

## 23. Business Decision Register

| Item | Classification | Decision required |
|---|---|---|
| COMM-BD-004 — orphan temporary upload retention | BUSINESS / RETENTION DECISION | Define approved ownership, retention duration, reconciliation, and deletion policy for private temporary uploads that are never promoted after cancellation, failure, access loss, or browser closure. |

No automatic cleanup or retention interval was invented. Private unreferenced
objects remain unavailable to clients and can be identified by an approved
future reconciliation process.

## 24. Accepted Design Constraint Register

| Item | Classification | Current position |
|---|---|---|
| COMM-021 — per-message Seen/Delivered receipts | ACCEPTED DESIGN CONSTRAINT | The data model stores membership-level read state only. Unsupported receipt UI has been removed rather than fabricated. |

## 25. Final Closure Decision

The Communication Centre meets the final functional closure standard:

- COMM-001 through COMM-020 have no current software residual.
- COMM-021 is truthfully represented as an accepted no-receipt-model constraint.
- Direct-message privacy, parent-authorised attachment delivery, private hide,
  realtime authorisation, structured mentions, truthful read state, bounded
  list scale, API/client alignment, Arabic/RTL, and accessibility remain
  protected by current code and tests.
- Communication-owned tests are green, Communication-owned TypeScript errors
  are zero, and the Software Residual Register is empty.

**ZERO-RESIDUAL COMPLETE — COMMUNICATION CENTRE FUNCTIONAL MODULE**