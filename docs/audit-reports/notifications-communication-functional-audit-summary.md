# Notifications and Communication Centre Functional Audit — Combined Summary

**Audit date:** 19 August 2026  
**Current HEAD:** `6c36ad0`  
**Detailed reports:**

- [Notifications Functional Audit](./notifications-functional-audit.md)
- [Communication Centre Functional Audit](./communication-centre-functional-audit.md)

**Scope boundary:** Current-head functional audit and remediation planning evidence only. No production code, schema, API, frontend, realtime, localisation, accessibility, preferences, or data was changed. No remediation tasks were automatically created, and this report does not declare either surface functionally closed.

## 1. Combined conclusion

Current HEAD contains substantially more capability and hardening than the historical audits describe:

- user-owned notification read routes;
- preference-aware notification creation, email hooks, approver routing, and dedupe helpers;
- conversation membership/operational-access guards that preserve private direct messages;
- announcements, mentions, reactions, pins, attachments/voice UI, and Socket.IO new-message delivery;
- partial live database constraints and indexes.

The reassessment nevertheless confirms **31 defects**:

| Area | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Notifications | 0 | 1 | 6 | 3 | 10 |
| Communication Centre | 1 | 5 | 13 | 2 | 21 |
| **Total** | **1** | **6** | **19** | **5** | **31** |

There are also **11 separate product/business decisions**: four notification decisions and seven Communication Centre decisions. They are not presented as defects.

The immediate risk priorities are:

1. **COMM-002:** close cross-conversation reply-preview disclosure without weakening direct-message privacy;
2. **COMM-006:** authorise attachment reads through the parent conversation;
3. **COMM-001:** align the upload contract so files and voice notes can function;
4. **NOTIF-001:** restore independent in-app/email channel evaluation;
5. **COMM-004/005:** design a safe per-user deletion and relational-integrity migration after data preflight.

## 2. System map

### 2.1 Notification flow

Domain routes and the due-date checker call `createNotification`, deduped actor/role wrappers, or approver routing. The service loads user preferences, categorises event kind, inserts an in-app row, broadcasts to the user's Socket.IO room, and optionally invokes the mailer. Risk assignment has two direct table inserts that bypass this path.

The bell and notification page both call `GET /notifications`; mark-one/read-all are user-scoped in SQL. The bell query is socket-invalidated, while the page's different key relies on 30-second polling. Preferences are stored on the user profile as JSON.

### 2.2 Communication flow

All conversation/message REST routes are concentrated in `routes/conversations.ts`. `assertMemberOrFullAccess` keeps direct messages member-only and grants PM/super-admin access only to non-direct operational conversations. Message creation commits the message and conversation timestamp transactionally, then performs audit, realtime, mention, and notification side effects.

`messages.tsx` implements the complete client. It uses REST plus both a global and page-local Socket.IO client. Attachments/voice notes request a generic object upload URL, then store returned metadata inside message JSON. The current client request/response names do not match that storage API.

### 2.3 Data and contract flow

The main tables are `notifications`, `conversations`, `conversation_members`, `messages`, `message_mentions`, and `message_reactions`. Live development metadata confirms some indexes and reaction/mention constraints, but not canonical membership/direct-thread/message-parent/notification-dedupe invariants.

OpenAPI documents only part of the conversation API and none of the notification routes. Raw frontend fetch and local DTOs have drifted from generated storage contracts.

## 3. Notification finding table

Full evidence, invariants, impact, closure, dependencies, and historical detail are in the notification report.

| ID | Severity | Confirmed defect | Dependency | Parallel group |
|---|---|---|---|---|
| **NOTIF-001** | **High** | `email_only` and some email-enabled/in-app-disabled states return before email processing, producing no delivery | Mailer matrix | N-A |
| **NOTIF-002** | **Medium** | Core/direct actor paths do not consistently reject inactive/deleted recipients | User lifecycle policy | N-B |
| **NOTIF-003** | **Medium** | Deduplication is select-then-insert with no DB uniqueness guarantee | NOTIF-BD-003 | N-C |
| **NOTIF-004** | **Medium** | `risk_assigned` direct inserts bypass preferences, realtime, email, and dedupe | Risk tests | N-D |
| **NOTIF-005** | **Medium** | Report emits `technically_approved`; category maps register `technically_reviewed` | Workflow compatibility | N-D |
| **NOTIF-006** | **Medium** | Runtime profile update stores arbitrary preference JSON instead of parsing the generated contract | Spec/client generation | N-E |
| **NOTIF-007** | **Low** | Socket invalidates bell cache but not open notification-page cache | Query-key convention | N-F |
| **NOTIF-008** | **Low** | List limit accepts invalid values and ordering lacks a deterministic ID tie-breaker | OpenAPI addition | N-E |
| **NOTIF-009** | **Low** | Bell/page turn failed requests into empty states | Error-state component | N-F |
| **NOTIF-010** | **Medium** | Arabic namespace is empty and labels/date formatting contain English-only paths | Arabic terminology | N-G |

## 4. Communication Centre finding table

Full evidence, invariants, impact, closure, dependencies, and historical detail are in the Communication Centre report.

| ID | Severity | Confirmed defect | Dependency | Parallel group |
|---|---|---|---|---|
| **COMM-001** | **High** | Client and server upload DTO/response contracts are incompatible; file and voice upload cannot complete | COMM-BD-005 | C-A |
| **COMM-002** | **Critical** | Arbitrary cross-conversation reply IDs can expose another message's body/sender in joined previews | Preserve DM privacy | C-B |
| **COMM-003** | **High** | Bounded history returns oldest rather than newest messages and has no load-older UI | History index | C-C |
| **COMM-004** | **High** | “Delete for me” writes global deletion state and hides content from other members | COMM-BD-004 | C-D |
| **COMM-005** | **High** | Canonical member/direct/message-parent constraints and reproducible tracked DDL are incomplete | Data preflight | C-E |
| **COMM-006** | **High** | Authenticated object download is not authorised through the parent conversation | COMM-BD-004/005 | C-F |
| **COMM-007** | **Medium** | Attachment UI capability and `documents.upload` permission disagree for some messaging roles | COMM-BD-005 | C-A |
| **COMM-008** | **Medium** | Typing events exist only in the client; no authenticated server relay exists | Typing policy | C-G |
| **COMM-009** | **Medium** | Edit/delete/reaction/pin changes do not consistently broadcast to remote clients | Realtime event DTOs | C-G |
| **COMM-010** | **Medium** | Mentions resolve by first name rather than selected user ID | Message DTO | C-H |
| **COMM-011** | **Medium** | Conversation create lacks a full discriminated contract, active-member checks, and concurrency-safe canonical identity | COMM-BD-007 | C-I |
| **COMM-012** | **Medium** | Full-access non-members see unread messages but cannot persist read state | COMM-BD-002 | C-J |
| **COMM-013** | **Medium** | Conversation list/search is unbounded and lacks measured supporting indexes | Representative query plan | C-C |
| **COMM-014** | **Medium** | Runtime/OpenAPI/generated-client drift is extensive | Spec regeneration | C-H |
| **COMM-015** | **Low** | Removed members can still edit their own recent messages | None | C-B |
| **COMM-016** | **Low** | Mark-read has no explicit access/no-op contract and returns 204 without a member row | COMM-BD-002 | C-J |
| **COMM-017** | **Medium** | Params/query/body validation can turn malformed input into inconsistent errors/500s | COMM-014 | C-H |
| **COMM-018** | **Medium** | Page-local and global Socket.IO clients duplicate connections and complicate logout/user-switch safety | Realtime consolidation | C-G |
| **COMM-019** | **Medium** | Arabic namespace is empty and several dates/labels force English | Arabic terminology | C-K |
| **COMM-020** | **Medium** | Click-only gallery and hover-only invisible actions block reliable keyboard operation | Rendered accessibility tests | C-K |
| **COMM-021** | **Medium** | UI displays seen/delivered checks without receipt evidence | COMM-BD-006 | C-J |

## 5. Business-decision register — not defects

### Notifications

| ID | Decision |
|---|---|
| **NOTIF-BD-001** | Whether daily/weekly digest options should be selectable before a scheduler exists |
| **NOTIF-BD-002** | Whether stored notification links require an internal-route allow-list |
| **NOTIF-BD-003** | Whether conversation-level dedupe should collapse distinct messages/mentions/pins/announcements |
| **NOTIF-BD-004** | Whether users should receive notifications for their own assignment/action |

### Communication Centre

| ID | Decision |
|---|---|
| **COMM-BD-001** | Whether Senior Program Coordinators may create announcements |
| **COMM-BD-002** | Whether operational non-member access should create membership/read state |
| **COMM-BD-003** | The intended cross-event notification suppression key/window |
| **COMM-BD-004** | Attachment orphan, retention, and deletion lifecycle |
| **COMM-BD-005** | Dedicated communication-upload permission versus `documents.upload` |
| **COMM-BD-006** | Whether real read receipts are required and at what granularity |
| **COMM-BD-007** | Whether state/sector/project conversations are canonical singletons per entity |

## 6. Required cross-cutting assessments

### 6.1 IDOR and access isolation

**Confirmed secure:**

- notification list/read mutations are scoped to the current user;
- direct conversations remain member-only for every role;
- major conversation detail/message/media/reaction/pin/member routes check membership or authorised non-DM operational access;
- deep-linked destination routes retain their own authorisation.

**Confirmed residual:**

- cross-thread reply preview disclosure (COMM-002);
- attachment object reads not derived from the parent conversation (COMM-006);
- removed-member edit access (COMM-015);
- ambiguous mark-read access/no-op behaviour (COMM-016).

The closure invariant is explicit: operational privilege must not become a blanket grant to private direct messages, and notification possession must never grant entity access.

### 6.2 Realtime

Socket.IO authentication, user rooms, notification push, new-message delivery, and some conversation invalidation exist. Missing server typing support, incomplete mutation events, duplicate client sockets, and mismatched cache keys prevent complete convergence. Realtime delivery must re-evaluate current audience membership and clear listeners/caches on logout or user change.

### 6.3 Storage

Generic object storage providers and server-side type/size validation exist when the correct contract is used. The current client does not use that contract. More importantly, message attachment access is represented by JSON URLs rather than a durable parent relation and authorised resolver. Upload viability and download confidentiality are separate closure tracks.

### 6.4 Data/schema/migrations

The read-only live development catalogue observation corrects two extremes while remaining environment-specific and not proving production parity:

- the schema is **not** completely unconstrained: reaction uniqueness/FKs, mention FKs, and several indexes exist;
- it is **not** sufficient: membership uniqueness/FKs, message conversation/sender/reply FKs, direct canonical identity, history keyset support, and notification dedupe uniqueness are absent.

Current tracked migrations do not reproduce the observed Communication Centre DDL. Constraint closure requires a read-only duplicate/orphan preflight and explicit human decisions; no automatic data remediation is recommended.

### 6.5 API contract

Notification routes are missing from OpenAPI. Communication OpenAPI is a partial subset. The generated upload contract and local frontend contract have already diverged enough to break a feature. Contract closure should establish one authoritative schema and regenerate clients rather than copy types into more locations.

### 6.6 Performance

- notifications are bounded but need validated limits and deterministic ordering;
- message history is bounded incorrectly and needs keyset semantics plus a composite access-path index;
- conversation list/search is unbounded and uses correlated/`ILIKE` work without representative query-plan evidence;
- duplicate sockets and missing realtime events add unnecessary refresh work.

### 6.7 Accessibility

The frontend uses many labelled icon buttons and accessible Radix primitives. Confirmed functional gaps are narrower: invisible hover-only message actions can receive keyboard focus without becoming perceivable, photo-gallery tiles are click-only, and some visible input labels are not programmatically associated. Notification request failures also masquerade as an empty state, which removes perceivable error/retry information.

### 6.8 Localisation and date/time semantics

Both Arabic namespaces are empty. Notifications and messages contain English-only arrays/labels and forced `"en"`/`en-GB` date formatting. Quiet hours use a stored timezone and safely fail open on an invalid timezone, but the runtime profile route does not validate the nested preference timezone/shape.

## 7. Historical reconciliation

| Historical item | Status at current HEAD |
|---|---|
| Conversation/member authorisation hardening | **Still present**, with narrower current IDOR residuals |
| Direct-message privacy for operational roles | **Still present and must be preserved** |
| Message-notification dedupe | **Present but not atomic; suppression policy unresolved** |
| Member-add hardening | **Present in routes; create-time/data constraints remain incomplete** |
| Announcement support | **Resolved as a feature; authority conflict remains a decision** |
| Strict sector matching | **Resolved** |
| Socket.IO message delivery absent | **Resolved for basic new-message delivery** |
| Typing support complete | **Cannot be confirmed; server handler absent** |
| Attachment feature validated | **No longer valid; current contract is broken** |
| Report technical-review notification absent | **Historical assertion invalid now; taxonomy mismatch remains** |
| Separate unread-count notification route | **Historical route description inaccurate; unread is inline** |
| Bell owns a five-item socket subscription | **Historical implementation description inaccurate** |
| All notification/communication gaps closed | **No longer valid** |

## 8. Test inventory and honest validation result

### 8.1 Automated tests

| Command/suite | Exact result | Relevant coverage |
|---|---:|---|
| `pnpm --filter @workspace/api-server exec vitest run src/test/tc-notification-sector.test.ts src/test/hqsr-tc-notification.test.ts src/test/hqsr-spc-fallback.test.ts src/test/pmr-notifications-routes.test.ts src/test/pmr-notifications.test.ts src/test/pm-full-operational-access.test.ts` | **6 files, 90 tests passed** | TC notification sector, HQSR TC/fallback, PMR notification routes/service, PM operational access |
| `pnpm --filter @workspace/api-server test` | **87 files, 2,305 tests passed** | Broad backend regression; no dedicated conversation route suite |
| `pnpm --filter @workspace/cafa-pmis test` | **90 files, 5,172 tests passed** | Broad frontend regression; no notification/messages page-specific suite |

The focused 90 tests are a rerun subset of the backend evidence, not 90 additional unique tests. The two full suites contain **7,477 tests** in total.

### 8.2 Type and runtime validation

| Validation | Exact result |
|---|---|
| `pnpm --filter @workspace/api-server typecheck` | **Failed with 13 pre-existing errors in 4 files**: risk audit test, reports route, risks route, plan aggregate integration test |
| `pnpm --filter @workspace/cafa-pmis typecheck` | **Failed with 31 pre-existing errors in 7 files**, predominantly report/plan/risk surfaces |
| API workflow | Built and started; Socket.IO initialised; `/api/healthz` returned 200; due-date checker completed |
| Web workflow | Vite started and served normally |
| Browser console | Expected repeated `/api/me` 401s after protected-route navigation; no other errors |
| Mail delivery | Development startup explicitly in stub mode; provider delivery not tested |
| Live DB | Development database reachable; audited tables estimated zero rows; constraints/indexes captured |

The full API run logged one non-fatal due-date-checker warning because a mock did not supply expected query data; all 2,305 tests passed.

### 8.3 Browser/authenticated-session limit

A read-only browser visited `/notifications`, `/messages`, and `/notification-preferences`. Each protected route redirected to the rendered login screen. No authenticated session or credentials were available, so no inbox, preference, conversation, upload, read-state, or multi-user realtime interaction was exercised. No data was changed.

## 9. Missing sentinel coverage

The current suite lacks sentinels for these high-value invariants:

| Sentinel family | Missing coverage |
|---|---|
| **Notification delivery** | Complete channel/category/mandatory/quiet-hours matrix; email-only |
| **Recipient isolation** | Inactive/deleted/missing users and caller self-notification |
| **Concurrency** | Notification dedupe, direct-thread creation, member add, reaction toggle |
| **Event registry** | Every emitted notification kind maps to supported categories |
| **Notification API/UI** | Limit/order, failed-query state, socket cache convergence, Arabic rendering |
| **DM/IDOR** | Every route across member/non-member/PM/super-admin; cross-thread reply/forward/deleted preview |
| **Storage** | Correct upload DTO, type/size limits, voice note, orphan, parent-authorised download |
| **History/deletion** | Newest-page keyset, load older, per-user hide, shared delete |
| **Conversation creation** | Discriminated types, active users, canonical state/sector/project/direct identity |
| **Read/realtime** | Operational non-member read state, typing auth/throttle, mutation convergence, logout/user switch |
| **Mentions** | Duplicate first names and explicit mentioned-user IDs |
| **Validation/performance** | Malformed params to 4xx; bounded list/search; representative query plans |
| **Accessibility/localisation** | Keyboard hover actions/gallery/composer; Arabic RTL; locale-aware dates |
| **Receipts** | Truthful delivery/read display or intentional absence |

## 10. Residual register

| Residual | Why it remains | Classification |
|---|---|---|
| Authenticated end-to-end interaction | No browser session/credentials or safe multi-user fixture | Evidence limit |
| Production data/schema parity | Audit used current source and development catalogue only | Evidence limit |
| Concurrency rates | No data-writing stress run; structural race evidence is sufficient for findings | Evidence limit |
| Real provider email | Development mailer intentionally stubbed | Evidence limit |
| Existing duplicate/orphan communication data | Development tables estimated empty; production not queried | Migration preflight |
| Digest behaviour | UI says coming soon; no scheduler | NOTIF-BD-001 |
| Notification link allow-list | Destination auth currently remains authoritative | NOTIF-BD-002 |
| Notification suppression key | Cross-event intent undefined | NOTIF-BD-003 / COMM-BD-003 |
| Announcement authority | Frontend/permission/server roles conflict | COMM-BD-001 |
| Non-member operational read state | No defined membership/receipt model | COMM-BD-002 |
| Attachment retention/permission | Product policy undefined | COMM-BD-004/005 |
| Read receipts | UI implication exceeds backend model | COMM-BD-006 |
| Canonical organisational threads | Singleton rule undefined | COMM-BD-007 |
| Typecheck closure | Unrelated pre-existing errors | Out of audit scope |

## 11. Evidence-based closure waves

| Wave | Objective | Findings/decisions | Exit evidence |
|---|---|---|---|
| **0 — Policy and fixture lock** | Decide data-affecting semantics and create safe multi-user fixtures | NOTIF-BD-003/004; COMM-BD-001–007 | Written decisions plus adversarial test fixture |
| **1 — Confidentiality** | Close parent/reference IDORs without widening DMs | COMM-002, COMM-006, COMM-015/016 access cases | Cross-role/member/non-member IDOR suite |
| **2 — Core delivery/upload** | Make selected channels and media transport work | NOTIF-001, COMM-001, COMM-007 | Channel matrix and file/voice E2E |
| **3 — Durable identities/data** | Enforce recipient/member/message/delete invariants safely | NOTIF-002/003, COMM-004/005/011 | Preflight register, constraints, concurrency tests |
| **4 — Contract/taxonomy** | Align event, input, DTO, spec, and generated clients | NOTIF-004/005/006/008, COMM-010/014/017 | Generated-client build and contract tests |
| **5 — History/read/realtime** | Ensure clients converge and show truthful unread/status | NOTIF-007/009, COMM-003/008/009/012/018/021 | Multi-client realtime/history/read suite |
| **6 — Scale** | Bound and index collection paths | COMM-013 plus history query plan | Representative EXPLAIN and pagination tests |
| **7 — Language and access** | Achieve Arabic and keyboard-functional parity | NOTIF-010, COMM-019/020 | Arabic RTL and keyboard rendered/E2E tests |

## 12. Parallel-execution and collision matrix

Parallel work is safe only when both source ownership and data contracts do not collide.

| Workstream | IDs | Primary collision surface | Safe to run in parallel with | Must not overlap with |
|---|---|---|---|---|
| **P1 Notification channel core** | NOTIF-001 | `lib/notifications.ts`, mail tests | P3, P5, P8 after event names frozen | P2 dedupe/recipient core; P4 event taxonomy in same service |
| **P2 Notification identity/dedupe** | NOTIF-002/003 | notification service + DB schema/migration | P5 frontend; P8 localisation | P1; P6 communication schema if migrations share numbering/review |
| **P3 Risk/report caller taxonomy** | NOTIF-004/005 | risk/report routes and workflow tests | P5, P7, P8 | P4 until canonical kind registry agreed |
| **P4 API/spec validation** | NOTIF-006/008, COMM-014/017 | OpenAPI, generated clients, route validators | P8 localisation | P1/P3/C-H message DTO changes unless one contract owner sequences generation |
| **P5 Notification frontend truthfulness** | NOTIF-007/009 | notification page/bell/socket query keys | P2, P3, P6 | P7 socket-provider consolidation if editing shared socket client |
| **P6 Communication confidentiality/data** | COMM-002/004/005/006/011/015/016 | conversation route, storage relation, DB migration | P1, P3, P8 | Any other `conversations.ts` or comm-schema work; sequence parent auth before storage UI |
| **P7 Communication transport/realtime** | COMM-001/007/008/009/018 | messages page, storage client, realtime server/provider | P2, P3 | P5 shared socket work; P9 message UI/accessibility; P6 if route DTOs are moving |
| **P8 Localisation** | NOTIF-010, COMM-019 | locale JSON, date helpers | P1–P6 where component lines are not shared | P9 when both edit `messages.tsx`; use separate locale and component commits |
| **P9 Communication presentation/history** | COMM-003/010/012/013/020/021 | messages page and list/message queries | P1–P4 | P6/P7 on `conversations.ts`/`messages.tsx`; split server pagination from client accessibility |

### Collision rules

1. Only one workstream at a time should own `routes/conversations.ts`.
2. Only one workstream at a time should own the large `messages.tsx`; extracting focused components first can reduce later collisions but is not required for defect closure.
3. Notification and communication schema changes may be logically independent but must use one migration owner to avoid ordering/prefix collisions.
4. OpenAPI and generated clients must be regenerated after all DTO decisions in a wave, not independently by multiple branches.
5. Socket cache invalidation and socket-provider consolidation must be sequenced so events are neither double-handled nor dropped.
6. Storage upload repair must not ship before parent-authorised download design is fixed or explicitly feature-gated.

## 13. Closure statement

This audit is complete as a current-head evidence inventory. It does **not** certify notification or Communication Centre functional closure. The next legitimate step is to approve the policy decisions and remediation waves, then implement each wave with the missing sentinels and authenticated multi-user evidence described above.