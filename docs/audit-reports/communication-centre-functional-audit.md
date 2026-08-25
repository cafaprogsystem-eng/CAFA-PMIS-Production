# Communication Centre Functional Audit

**Audit date:** 19 August 2026  
**Current HEAD:** `6c36ad0`  
**Scope:** Conversations, membership, messages, replies, forwarding, mentions, reactions, pins, read state, attachments, voice notes, realtime, notifications, authorisation, schema/contracts, frontend, localisation, accessibility, and tests.  
**Nature of work:** Evidence-only audit. No production behaviour, schema, API, frontend, realtime, localisation, data, or preferences were changed.

## 1. Executive conclusion

The Communication Centre is a substantial current implementation rather than the minimal/historical surface described in older reports. Current HEAD contains direct, group, project, state, sector, and announcement conversations; message CRUD; replies, forwarding metadata, mentions, reactions, pins, media gallery and voice-note UI; user-room Socket.IO delivery; and authorisation guards that preserve direct-message privacy.

Twenty-one current defects are confirmed:

- one **Critical** defect: arbitrary cross-conversation reply references can disclose another thread's message content;
- five **High** defects: the attachment/voice upload contract is incompatible end to end, history starts at the oldest messages, delete-for-me is globally destructive, key relational/canonical constraints are absent, and stored message objects lack parent-conversation download authorisation;
- thirteen **Medium** defects across permissions, typing/realtime, mentions, creation rules, unread state, performance, contracts, localisation, and accessibility;
- two **Low** defects involving post-membership edit access and ambiguous mark-read handling.

Historical authorisation, member-add, message-notification dedupe, exact-sector validation, announcements, and basic new-message realtime improvements are present. Historical confidence in attachment readiness is not supported by current code.

## 2. Method and limits

The audit traced:

- all runtime routes in `routes/conversations.ts`;
- `assertMemberOrFullAccess`, permission grants, global auth mounting, Socket.IO authentication and rooms;
- frontend list/detail/create/send/edit/delete/reply/forward/reaction/pin/media/voice/typing flows;
- storage upload/download routes and object providers;
- declarative schema, live development constraints/indexes, OpenAPI, and generated Zod contracts;
- every related historical audit/fix/validation report;
- focused/full tests, workflow startup, and read-only browser behaviour.

No authenticated browser session or populated development conversation data was available. Therefore destructive IDOR probes, message sending, attachment upload, voice recording, multi-user realtime, read receipt, and concurrency tests were not run. Confirmed defects below are based on reachable code paths and contract/schema evidence, not speculative production data.

## 3. Runtime surface map

### 3.1 API routes

| Method and route | Function |
|---|---|
| `GET /api/conversations/unread-count` | Aggregated member unread count |
| `GET /api/conversations` | Search/filter/list conversations with preview and unread count |
| `POST /api/conversations` | Create direct/group/project/state/sector/announcement conversation |
| `GET /api/conversations/:id` | Detail and members |
| `PATCH /api/conversations/:id` | Rename/update description |
| `DELETE /api/conversations/:id/members/:memberId` | Remove member |
| `POST /api/conversations/:id/members` | Add member |
| `POST /api/conversations/:id/read` | Update current member's last-read timestamp |
| `GET /api/conversations/:id/messages` | List/search messages and joined reply/reaction metadata |
| `POST /api/conversations/:id/messages` | Send body/attachments/reply/forward metadata and derive mentions |
| `POST /api/messages/:msgId/reactions` | Toggle reaction |
| `GET /api/conversations/:id/media` | Aggregate image/document/voice attachment JSON |
| `PATCH /api/messages/:msgId` | Edit own message during 15-minute window |
| `DELETE /api/messages/:msgId` | Delete for me/everyone |
| `POST /api/messages/:msgId/pin` | Pin with role/access/limit checks |
| `DELETE /api/messages/:msgId/pin` | Unpin |
| `GET /api/conversations/:id/pinned` | List pinned messages |
| `POST /api/storage/uploads/request-url` | Create generic object upload URL; requires `documents.upload` |
| `GET /api/storage/public-objects/*` | Serve stored public objects to an authenticated user |

All are behind router-level authentication. The storage retrieval route is not unauthenticated, but it has no message/conversation parent-authorisation check.

### 3.2 Conversation and access model

`assertMemberOrFullAccess` applies these current rules:

- direct conversations are always member-only;
- PM/super-admin full operational access applies to non-direct conversations;
- other users require membership;
- send/create/manage-member permissions are granted broadly, but some operations add narrower role checks;
- announcement creation has a separate server role set.

This preserves the required private-DM boundary. Operational privilege is not treated as permission to inspect another user's direct messages.

### 3.3 Creation semantics

- **Direct:** creator plus one supplied member; server attempts to return an existing matching DM.
- **Group/project:** creator plus supplied members; optional name/description/project metadata.
- **State/sector:** organisational membership is derived from user state/sector, with supplied values influencing scope.
- **Announcement:** active recipients are selected by all/state/sector/role and membership rows are created.

The server does not enforce a complete type enum or all required type-specific identities. The client labels “project” as a type but does not require/select a project ID, so a project conversation can be unbound.

### 3.4 Message lifecycle

Send uses a DB transaction for message insert plus `conversations.updated_at`, then performs audit, realtime, mention persistence, and notification fan-out after commit. Retrieval joins sender, reply preview, and reactions. Edit and delete operate by message ID. Pins are capped at ten current messages per conversation.

Forwarding is implemented by the client sending a new message with copied body/attachments and `forwardedFromId`. Reply IDs are accepted without a same-conversation visibility check and are dereferenced into previews; forward IDs are also unvalidated but currently affect provenance metadata rather than server-side content disclosure.

### 3.5 Mention and notification lifecycle

The composer inserts a display name after `@`. The server parses first-name tokens and matches active conversation members by first name; duplicate first names can therefore notify unintended members. Message, mention, announcement, and pin events use `createNotificationDeduped`, generally keyed to the conversation rather than the specific message.

### 3.6 Read state

`conversation_members.last_read_at` drives list and global unread counts. Member read updates are user-scoped. Full-access non-members can view non-direct conversations but have no membership row to update, producing a persistent per-conversation unread mismatch.

### 3.7 Attachments and voice notes

The message table stores attachment arrays as JSON, not as rows with a conversation/object relationship. The frontend:

- sends `filename`, `mimeType`, and `scope`;
- omits `size`;
- expects `presignedUrl` and `publicUrl`.

The generated/server upload contract requires `name`, `size`, and `contentType`, and returns `uploadURL` and `objectPath`. The mismatch blocks both ordinary attachments and recorded voice notes before successful upload. Successfully uploaded but unsent objects have no communication-specific orphan lifecycle.

### 3.8 Realtime

The API initialises Socket.IO at `/api/socket.io`, authenticates production sockets using the application cookie, and uses a development-only `auth.userId` fallback outside production. It broadcasts to user rooms for new messages, conversation updates, and notifications.

The frontend has both the global `SocketProvider` connection and a second page-local connection. The page emits/listens for `user:typing`, but the server registers no handler/relay. Edit, delete, reaction, pin/unpin, and relevant membership/read changes do not consistently emit events, so remote clients can remain stale until query polling/refetch.

### 3.9 Frontend surface

The single `messages.tsx` page implements:

- responsive list/detail layout;
- conversation tabs, search, unread previews;
- creation/announcement confirmation;
- composer, reply/edit state, attachment and voice capture;
- grouped messages/date dividers;
- reactions and action menu;
- pinned panel, media gallery, forward dialog, lightbox;
- query polling plus realtime new-message merge/invalidation.

The amount of logic concentrated in one page increases collision risk for remediation; changes should be partitioned by transport, contracts, and presentation rather than edited concurrently in the same component.

## 4. Schema and migration assessment

### 4.1 Declarative model

`lib/db/src/schema/index.ts` declares:

- `conversations`;
- `conversation_members`;
- `messages`;
- `message_mentions`;
- `message_reactions`.

The declarations do not express the full set of relationships, uniqueness rules, and access-path indexes required by runtime behaviour.

### 4.2 Live development catalogue

The live development database was reachable. All audited communication tables had an estimated row count of zero. The following is a dated, read-only catalogue observation from the audit environment; it is not inferred from the current source declarations and does not establish production parity.

| Table | Confirmed constraints/indexes | Material absences |
|---|---|---|
| `conversations` | Primary key | No canonical direct-thread uniqueness; no scope/type checks; no supporting list/search index |
| `conversation_members` | Primary key; indexes on conversation and `(user_id, conversation_id)` | No unique `(conversation_id, user_id)`; no conversation/user FKs |
| `messages` | Primary key; indexes on conversation, sender, created time; FKs for deleted/pinned/forwarded users/message; deletion-type check | No conversation FK, sender FK, reply FK; no composite `(conversation_id, created_at, id)` history index |
| `message_mentions` | Primary key; message/user FKs | No unique message/mentioned-user pair; no lookup index shown |
| `message_reactions` | Primary key; message/user FKs; unique `(message_id, user_id, emoji)`; message index | Route still uses check-then-insert, so concurrent duplicate requests can surface a uniqueness error rather than an idempotent toggle |

This corrects the over-broad historical/static claim that all Communication Centre foreign keys and reaction uniqueness are absent. Some exist in the live database; the key conversation/member/message-parent gaps remain.

### 4.3 Migration traceability

The tracked SQL migration directory contains four unrelated migrations, and the current `lib/run-migrations.ts` contains no Communication Centre creation/constraint block matching the live catalogue. The live schema therefore has communication DDL not traceable from the current tracked migration set. This is a reproducibility and environment-parity concern included in COMM-005.

## 5. Confirmed finding register

| ID | Severity | Evidence | Affected area | Invariant | Impact | Recommended closure | Dependency | Parallel-safety group |
|---|---|---|---|---|---|---|---|---|
| **COMM-001** | **High** | `messages.tsx` sends `filename/mimeType/scope`, omits size, and expects `presignedUrl/publicUrl`; generated/server storage route requires `name/size/contentType` and returns `uploadURL/objectPath` | Attachments, images, documents, voice notes | Client and server must share one upload DTO and response | File and voice-note uploads fail validation/response handling | Adopt generated contract end to end, then test upload→send→render→download for every allowed media class | Storage access decision COMM-BD-005 | **C-A upload-contract** |
| **COMM-002** | **Critical** | send accepts arbitrary `replyToId`; retrieval/edit response joins `messages rm ON rm.id=m.reply_to_id` and returns reply body/sender without conversation/visibility predicate or deleted redaction | Reply IDOR, message confidentiality | A reply reference must belong to the target conversation and be visible to the actor | A member can reference an ID from another private thread and expose its body/sender in the reply preview | Validate the reply source under current user's access and same-conversation rule in transaction; redact deleted source previews; test `forwardedFromId` separately as provenance integrity; add adversarial IDOR tests | None; preserve DM boundary | **C-B IDOR-reference** |
| **COMM-003** | **High** | message list orders ascending and applies `LIMIT`; initial client asks for 80 and has no load-more cursor UI | History, pagination | Initial history should show the newest bounded page; older pages must be reachable without gaps/duplicates | Active threads open at their oldest messages and recent context can be inaccessible | Use descending keyset query then reverse response (or equivalent); return next cursor; implement load-older UI | Composite history index | **C-C pagination** |
| **COMM-004** | **High** | one global `deleted_at/deleted_by/deletion_type` row represents `for_me`; reads redact any `deleted_at` row for all viewers | Delete semantics, privacy/data | “Delete for me” must be per user and must not alter what other members see | One user's private hide blanks shared content for everyone and prevents independent hides | Introduce per-user hidden-message state; reserve shared deletion columns for delete-for-everyone; migrate carefully | Retention policy COMM-BD-004 | **C-D deletion-model** |
| **COMM-005** | **High** | live DB lacks member uniqueness/FKs, message conversation/sender/reply FKs, direct canonical uniqueness; current tracked migrations do not reproduce live comm DDL; member inserts rely on ineffective `ON CONFLICT DO NOTHING` | Data integrity, concurrency, deploy parity | Membership and message graph must be referentially valid and canonical under concurrency | Duplicate members/direct threads, orphan/foreign references, deployment drift, and race errors are possible | Create one reviewed declarative/migration contract with cleanup preflight, constraints, and indexes; make reaction toggle conflict-safe | Data remediation plan; no auto-cleanup | **C-E schema-integrity** |
| **COMM-006** | **High** | attachments are JSON URLs/paths; authenticated `/storage/public-objects/*` has no parent-conversation membership/operational-access check | Storage IDOR | Download authorisation must derive from the parent conversation, not URL possession | Any authenticated user who obtains/guesses an object path can bypass direct-thread membership | Use protected object IDs or signed downloads resolved through message→conversation authorisation; never trust caller metadata | COMM-BD-004/005 and upload repair | **C-F storage-auth** |
| **COMM-007** | **Medium** | composer exposes attachment controls to all messaging users; upload route requires `documents.upload`, which not every `messages.send` role has | Permissions/UI | Visible affordances and server permission must represent the same capability | Some users can send text but always receive 403 for attachments/voice | Decide dedicated-vs-document permission, expose capability in current user, gate UI and server consistently | COMM-BD-005 | **C-A upload-contract** |
| **COMM-008** | **Medium** | page emits/listens to `user:typing`; realtime server has no handler | Typing, realtime authorisation | A displayed realtime feature must have an authenticated, membership-checked server relay | Typing indicators never work; any future blind relay risks leakage | Either remove until supported or add throttled room relay with access checks and disconnect cleanup | Product desire for typing | **C-G realtime-server** |
| **COMM-009** | **Medium** | new-message events exist, but edit/delete/reaction/pin lifecycle routes do not broadcast corresponding updates | Realtime/cache consistency | All visible shared mutations must converge across connected members | Remote clients show stale body, deletion, reactions, and pins | Define event DTOs and invalidate/patch scoped caches; re-check membership at emit time | Event contract/OpenAPI | **C-G realtime-server** |
| **COMM-010** | **Medium** | server parses `@FirstName` and matches conversation members by first name | Mentions/recipient isolation | Selecting one user must notify that exact user ID | Duplicate first names can notify multiple/unintended recipients | Send structured mentioned-user IDs with the message and validate membership; render labels separately | Message DTO change | **C-H message-contract** |
| **COMM-011** | **Medium** | create route lacks complete type enum/type-specific validation; member IDs are not active/existence validated; state/project identity may be absent; direct lookup is check-then-insert without uniqueness | Conversation creation | Every type must have canonical identity, active valid members, and concurrency-safe uniqueness | Malformed/unbound threads, invalid members, and duplicate DMs can be created | Shared discriminated create schema; transactional active-member checks; canonical direct key; require project/state identity where type claims it | Policy for canonical state/sector/project threads | **C-I conversation-contract** |
| **COMM-012** | **Medium** | full-access non-members can list/view non-direct conversations; list calculates unread from null member state; mark-read updates no row | Access/read state | Every viewer shown personal unread state must have a persistent read-state model | Such users see messages perpetually unread and disagree with aggregated unread count | Decide membership/read-receipt semantics, then create authorised read state or suppress personal unread for non-members | COMM-BD-002 | **C-J read-state** |
| **COMM-013** | **Medium** | conversation list/search has no pagination; performs broad `ILIKE` and correlated preview/unread queries; live DB lacks supporting conversation search/list indexes | API performance | User-visible collections must be bounded and index-supported | Cost and response size grow with total conversations/messages | Add cursor pagination and measured indexes; avoid unbounded correlated scans | Query plan on representative data | **C-C pagination** |
| **COMM-014** | **Medium** | OpenAPI documents only a subset; notification routes absent; runtime has rename/remove/media/reaction/pin fields/routes not represented; frontend uses raw fetch | API contract | Runtime, spec, generated DTOs, and client calls must agree | Drift already caused COMM-001 and weakens typed regression coverage | Make runtime OpenAPI authoritative, regenerate clients, replace ad-hoc DTOs incrementally | Coordinate with NOTIF-006/008 | **C-H message-contract** |
| **COMM-015** | **Low** | edit route checks sender/time/deleted state but not current conversation access | Post-membership lifecycle | A removed member should not continue mutating thread content unless explicitly allowed | Removed sender can edit a recent message after access revocation | Resolve conversation access before edit and add removed-member test | None | **C-B IDOR-reference** |
| **COMM-016** | **Low** | mark-read route performs a user-scoped update without explicit membership/access check and returns 204 even when no row exists | Read API/error contract | Read acknowledgement should distinguish authorised membership from no-op/nonexistent access | Clients cannot distinguish success from non-membership; behaviour differs from detail/message routes | Require access/member state and return consistent 403/404 or defined non-member semantics | COMM-BD-002 | **C-J read-state** |
| **COMM-017** | **Medium** | invalid/non-numeric IDs and limits use `parseInt` without complete finite/range validation; create/message bodies are partly cast rather than parsed | Validation/error contract | Invalid client input should produce deterministic 4xx responses | Malformed input can yield SQL errors/500s and inconsistent clients | Shared generated validators for params/query/body; map validation to 422 consistently | COMM-014 | **C-H message-contract** |
| **COMM-018** | **Medium** | messages page opens its own Socket.IO client while app-level `SocketProvider` also connects | Realtime, logout/user switch, resources | One authenticated client identity should own one coordinated socket lifecycle | Duplicate connections/events, extra server load, and user-switch/logout leakage risk | Route page subscriptions through one provider; clear rooms/listeners/cache on identity change | C-G event work | **C-G realtime-server** |
| **COMM-019** | **Medium** | Arabic messages namespace is `{}`; several date helpers force locale `"en"`; some labels/ARIA strings are hard-coded English | Localisation/date semantics | Supported Arabic users must receive equivalent text, direction, and locale-aware dates | Communication Centre operates largely in fallback English with English dates | Populate namespace, translate role/type/action labels, use active locale/timezone, add RTL/render tests | Approved Arabic terminology | **C-K localisation-a11y** |
| **COMM-020** | **Medium** | photo gallery uses click-only `<div>` tiles; message actions are `opacity-0 group-hover:opacity-100` without a focus-visible/focus-within reveal; several inputs rely on visual labels without programmatic association | Keyboard/screen-reader accessibility | Every interactive action must be perceivable and operable by keyboard and assistive technology | Keyboard users can encounter invisible controls and cannot open photo lightbox from gallery; labels may not be announced | Use semantic buttons, focus-visible reveal, linked labels/ARIA, and keyboard rendered-page tests | No redesign required | **C-K localisation-a11y** |
| **COMM-021** | **Medium** | own-message UI always renders a double-check with `seen` for direct threads / `delivered` otherwise; no per-message delivery/read receipt is returned | Message status truthfulness | Delivery/read indicators must be based on actual receipt data | Users can be told a message was seen/delivered without evidence | Hide the status or define/implement real receipt semantics and DTOs | Product decision on receipts | **C-J read-state** |

## 6. Product/business decisions — not defects

| ID | Question | Evidence and reason decision is required | Closure needed before |
|---|---|---|---|
| **COMM-BD-001** | May a Senior Program Coordinator create announcements? | Frontend/permission map includes SPC; server `ANNOUNCEMENT_ROLES` permits only super-admin, ED, and PM; historical rule says PM and above | Aligning announcement access |
| **COMM-BD-002** | Should PM/super-admin operational access create membership/read receipts in non-direct conversations? | Current access grants viewing/sending without persistent read state | COMM-012/016 and receipt work |
| **COMM-BD-003** | What suppression window/key is intended for messages, mentions, announcements, and pins? | Current notification kind/entity key can collapse distinct events | Notification dedupe redesign |
| **COMM-BD-004** | What are attachment retention, orphan, and message-deletion rules? | Upload and message persistence are separate; objects have no parent row/lifecycle | Storage schema/deletion implementation |
| **COMM-BD-005** | Is communication upload controlled by a dedicated permission or general `documents.upload`? | Current send and upload capabilities diverge | COMM-001/006/007 |
| **COMM-BD-006** | Are explicit read receipts required, and at what granularity? | UI displays status but backend has only conversation-level `last_read_at` | COMM-021 |
| **COMM-BD-007** | Are state, sector, and project conversations singleton/canonical per organisational entity? | Current code can create multiple threads and project can be unbound | COMM-011 schema rules |

## 7. IDOR and access-control assessment

### 7.1 Confirmed protections

- direct messages remain member-only for every role;
- list/detail/messages/media/reactions/pins mostly call `assertMemberOrFullAccess`;
- member management requires both permission and conversation access;
- delete now resolves conversation access before mutation;
- sector validation uses exact canonical matching rather than historical partial matching.

### 7.2 Confirmed residuals

- reply preview can cross conversation boundaries (COMM-002);
- stored object retrieval is not parent-authorised (COMM-006);
- edit omits current membership/access (COMM-015);
- mark-read does not state its access/no-op contract (COMM-016).

Operational privilege must not be used to “fix” COMM-002 or COMM-006 by granting private-DM access. The correct closure is parent-resource authorisation with the existing direct-thread boundary preserved.

## 8. Realtime, storage, data, API, performance, and accessibility

### 8.1 Realtime

Basic authenticated new-message and notification delivery is present. Typing is client-only; mutation event coverage is incomplete; duplicate client sockets make lifecycle safety harder. Membership must be checked both when a user initiates a realtime action and immediately before broadcasting into a conversation audience.

### 8.2 Storage

The upload DTO mismatch prevents the intended lifecycle. Even after repair, generic authenticated public-object retrieval is insufficient for private communications. Message attachment records need a durable parent relationship, authorised download resolution, and explicit orphan/retention handling.

### 8.3 Data integrity

The live catalogue has more hardening than the declarative schema suggests, especially for reactions and mentions, but not enough for canonical membership/message relationships. No automatic cleanup is recommended: any constraint migration must first identify duplicate members/direct threads and orphan references for authorised human review.

### 8.4 API contracts

OpenAPI covers list/create/detail/read/add-member/get-and-send-message plus a limited message edit/delete shape. Runtime additionally exposes remove member, media, reactions, pins, richer fields, attachments, reply/forward metadata, and search/pagination details. Contract drift is directly implicated in the broken upload surface.

### 8.5 Performance

Conversation list/search is unbounded. Message history is bounded but semantically wrong and lacks a matching composite keyset index. Realtime gaps cause additional polling/refetch. Performance closure should use representative query plans rather than adding speculative indexes.

### 8.6 Accessibility

Many icon buttons have accessible labels and Radix dialogs/menus provide a strong base. Concrete gaps remain for click-only gallery photos, invisible keyboard-focused action controls, and some programmatic input labels. This audit records functional operability gaps only; no visual redesign is proposed.

## 9. Historical reconciliation

| Historical finding/assertion | Current status | Current-head evidence |
|---|---|---|
| C-01 conversation/message authorisation missing | **Resolved for principal routes; residuals remain** | `assertMemberOrFullAccess` is widely present; COMM-002/006/015/016 are narrower current gaps |
| H-01 message notifications duplicate | **Partially resolved** | dedupe helper is used; concurrency and suppression semantics remain |
| H-02 member add accepts unrestricted users | **Resolved in part** | access/permission hardening exists; creation member validation and DB uniqueness remain |
| Realtime message delivery absent | **Resolved** | Socket.IO server/user rooms/new-message events exist |
| Typing indicator supported | **Cannot confirm / not implemented server-side** | client event exists; no server relay |
| Attachments validated and ready | **No longer valid** | current client/server DTOs are incompatible |
| Announcement support absent | **Resolved** | runtime/server/UI announcement flows exist; authority conflict is COMM-BD-001 |
| Sector matching uses unsafe partial match | **Resolved** | exact canonical/CSV-segment matching is used |
| No reply IDOR/delete-for-me/pagination/schema concern reported | **Historical audits incomplete for current HEAD** | COMM-002 through COMM-005 are current structural evidence |
| All communication FKs/unique constraints absent | **Over-broad; corrected** | live DB has reaction/mention FKs and reaction uniqueness, while core gaps remain |

## 10. Test and validation evidence

| Validation | Result | Coverage statement |
|---|---|---|
| `pnpm --filter @workspace/api-server exec vitest run src/test/tc-notification-sector.test.ts src/test/hqsr-tc-notification.test.ts src/test/hqsr-spc-fallback.test.ts src/test/pmr-notifications-routes.test.ts src/test/pmr-notifications.test.ts src/test/pm-full-operational-access.test.ts` | **6 files, 90 tests passed** | Includes a narrow Communication Centre access slice in `pm-full-operational-access.test.ts`; not route-lifecycle coverage |
| `pnpm --filter @workspace/api-server test` | **87 files, 2,305 tests passed** | No dedicated `conversations.ts` route suite was found |
| `pnpm --filter @workspace/cafa-pmis test` | **90 files, 5,172 tests passed** | No messages/notifications page-specific suite was found |
| `pnpm --filter @workspace/api-server typecheck` | **Failed: 13 pre-existing errors in 4 unrelated files** | Does not invalidate docs, but HEAD lacks a clean typecheck |
| `pnpm --filter @workspace/cafa-pmis typecheck` | **Failed: 31 pre-existing errors in 7 unrelated files** | Predominantly reports/plans/risks, outside this audit |
| Workflow restart/logs | **API/web running; Socket.IO initialised; health 200** | Startup/runtime smoke only |
| Browser smoke | **All three protected routes redirected to login; expected `/api/me` 401s only** | No authenticated communication interaction |
| Live development schema | **Reachable; all six audited tables estimated 0 rows** | Constraints/indexes verified; no data-behaviour probe possible |

## 11. Missing sentinel coverage

No dedicated current tests were found for:

1. direct-thread privacy across every route and operational role;
2. cross-conversation reply/forward/deleted-preview IDOR;
3. upload contract, MIME/size boundary, voice-note upload, and authorised download;
4. newest-page/keyset history and load-older behaviour;
5. concurrent direct creation, member add, reaction toggle, and notification dedupe;
6. delete-for-me per-user semantics and delete-for-everyone lifecycle;
7. inactive/nonexistent members and type-specific conversation creation;
8. removed-member edit/send/reaction/realtime access;
9. non-member full-access unread/read-state semantics;
10. typing membership/throttling/disconnect;
11. edit/delete/reaction/pin realtime convergence and logout/user-switch cleanup;
12. first-name collision mentions;
13. malformed IDs/limits/bodies and consistent 4xx errors;
14. bounded conversation search performance;
15. Arabic/RTL/date rendering;
16. keyboard operation of hover actions, lightbox, composer, dialogs, and media controls;
17. truthful read/delivery receipt display.

## 12. Residual register

| Residual | Status |
|---|---|
| Authenticated browser CRUD/IDOR/realtime/storage flows | **Not exercised** — no authenticated session and no safe multi-user fixture |
| Concurrency behaviour | **Not stress-tested** — structural races/constraint gaps documented |
| Production schema/data parity | **Not inspected** — live evidence is development only |
| Orphan/retention policy | **Undefined**, COMM-BD-004 |
| Announcement authority | **Conflicting current contracts**, COMM-BD-001 |
| Operational non-member read state | **Undefined**, COMM-BD-002 |
| Real read receipts | **Undefined**, COMM-BD-006 |
| Clean typecheck | **Blocked by unrelated pre-existing errors** |

## 13. Recommended closure waves

1. **Wave C0 — policy lock:** COMM-BD-002, 004, 005, 006, and 007 where they gate data design.
2. **Wave C1 — confidentiality:** COMM-002 and COMM-006 with adversarial tests.
3. **Wave C2 — upload viability:** COMM-001 and COMM-007 after storage permission decision.
4. **Wave C3 — durable data model:** COMM-004 and COMM-005 with preflight/residual review.
5. **Wave C4 — history and contract:** COMM-003, COMM-010, COMM-011, COMM-014, COMM-017.
6. **Wave C5 — read/realtime:** COMM-008, COMM-009, COMM-012, COMM-016, COMM-018, COMM-021.
7. **Wave C6 — scale and access lifecycle:** COMM-013 and COMM-015.
8. **Wave C7 — language and functional accessibility:** COMM-019 and COMM-020.

These are recommendations only; this audit does not create remediation tasks or declare the module closed.