# Notifications Functional Audit

**Audit date:** 19 August 2026  
**Current HEAD:** `6c36ad0`  
**Scope:** Notification creation, recipient derivation, preferences, in-app and email delivery, read state, deep links, realtime invalidation, API/schema contracts, localisation, and tests.  
**Nature of work:** Evidence-only audit. No production behaviour, schema, API, frontend, realtime, localisation, preference, or data changes were made.

## 1. Executive conclusion

The current notification subsystem has materially improved since `docs/notifications-audit.md`: approver routing, preference-aware creation, deduplication helpers, email integration, and Socket.IO user delivery now exist. The historical conclusion that all actionable gaps were closed is no longer supported by current HEAD.

Ten current defects are confirmed:

- one **High** delivery defect makes `email_only` deliver through neither channel;
- six **Medium** defects affect recipient eligibility, concurrency, bypassed service behaviour, event taxonomy, preference validation, and Arabic operation;
- three **Low** defects affect page freshness, list robustness, and visible error handling.

The strongest existing invariants are the user predicates on notification list/read routes and active-role filtering inside the approver-chain helper. Possession of a notification is not treated as an authorisation grant: its link still reaches a separately protected destination route.

## 2. Method and limits

Current code was treated as authoritative. Historical reports were reconciled only after direct comparison. Evidence sources were:

- runtime routes and service code;
- every direct `createNotification*` call and direct notification-table insert found by source search;
- frontend pages, bell, socket client, profile preferences, English/Arabic namespaces;
- declarative Drizzle schema, OpenAPI, generated Zod/client surfaces, and the live development PostgreSQL catalogue;
- focused and full automated test runs;
- clean workflow restart/log inspection;
- a read-only browser smoke check.

The development database contained no estimated rows in the audited communication tables, so no production-like recipient sample or destructive/concurrency probe was run. The browser had no authenticated session; protected routes were therefore verified only through their redirect-to-login boundary. No production database was queried.

## 3. Implementation and data map

### 3.1 Runtime API

| Route | Behaviour | Isolation |
|---|---|---|
| `GET /api/notifications` | Returns `{items, unread}`; filters by unread/module; nominal limit cap 200 | SQL always includes `user_id = currentUser.id` |
| `PATCH /api/notifications/:id/read` | Sets one row's `read_at` | `WHERE id = ? AND user_id = currentUser.id` |
| `POST /api/notifications/read-all` | Marks all unread rows read | `WHERE user_id = currentUser.id` |
| `GET /api/profile` | Returns `notificationPreferences` | Current user only |
| `PATCH /api/profile` | Persists `notification_preferences` JSON | Current user only; payload structure is not runtime-validated |

All routes are mounted below router-level `requireAuth`.

### 3.2 Creation and delivery paths

`artifacts/api-server/src/lib/notifications.ts` is the intended centre:

1. merge stored preferences with defaults;
2. classify a `kind` into in-app/email categories;
3. apply mandatory-kind, delivery-option, and quiet-hour rules;
4. insert the notification;
5. broadcast `notification:new` to the user's Socket.IO room;
6. optionally send email and log it through the mailer;
7. provide actor, deduplication, approver-chain, and role fan-out helpers.

Active callers occur in project, plan, report, risk, comment, conversation, and due-date-checker flows. The risk routes still contain two direct `INSERT INTO notifications` paths for `risk_assigned`, outside the centre.

### 3.3 Recipient derivation

- `notifyNextApprover` resolves active technical coordinators, Senior Program Coordinators, Program Managers, and super-admin fallbacks.
- `notifyRole` filters `users.status = 'active'`.
- `actorsForEntity` derives creators, authors, submitters, responsible users, and project assignments but does not join/filter active users.
- direct `createNotification` accepts a numeric user ID without validating that the user still exists and is active.
- most actor fan-outs support `exceptUserId`; self-notification is caller-dependent rather than a core invariant.

### 3.4 Read state, ordering, and bounds

Read state is stored as nullable `notifications.read_at`. The same list response supplies both items and unread total. Retrieval is nominally bounded to 200 but its `limit` parsing accepts invalid/negative input. Ordering is `created_at DESC` without an ID tie-breaker.

### 3.5 Preferences and email

Preferences include:

- ten in-app categories;
- nine email categories;
- `both`, `inapp_only`, or `email_only`;
- immediate/daily/weekly digest;
- quiet hours with timezone.

The UI persists the whole object via profile update. The API's generated schema describes a structured object, but the runtime profile route accepts any JSON value. Daily/weekly digest values are stored but not scheduled or processed. In this audit environment, startup correctly reported mailer stub mode because `EMAIL_ENABLED` is not `true`; this is an environment limit, not itself a code defect.

### 3.6 Realtime and caches

The server authenticates Socket.IO, places sockets in `user:{id}` rooms, and broadcasts notification creation to the recipient. The global client invalidates `["notifications"]` and `["conversations"]`. The bell uses `["notifications"]`; the page uses `["notifications-page", ...]`, so the page does not receive immediate cache invalidation and relies on 30-second polling.

### 3.7 Deep links

Notification links are stored strings and rendered as application navigation destinations. No notification route validates an allow-list, but every observed target is an internal path and the destination APIs/pages retain their own authorisation gates. A notification record is therefore not a permission grant. Whether to enforce an allow-list is a product/security-hardening decision, recorded separately below.

### 3.8 Schema and contracts

The declarative `notifications` table has an integer primary key and fields for user, kind, entity, message, link, read time, and creation time. The live development catalogue additionally has:

- `idx_notifications_user_created (user_id, created_at DESC)`;
- `idx_notifications_user_read (user_id, read_at)`;
- no foreign key to users;
- no uniqueness constraint supporting deduplication.

The runtime notification routes are absent from `lib/api-spec/openapi.yaml`; the frontend therefore uses raw fetch rather than generated notification hooks. Profile preference shapes do exist in the generated API, but the runtime route bypasses that validation.

### 3.9 Frontend and localisation

- `notifications.tsx` provides All/Unread tabs, search, module filter, item navigation, mark-one-read, and mark-all-read.
- `notifications-bell.tsx` provides a 20-item popover and unread badge.
- `notification-preferences.tsx` provides in-app, email, delivery, digest, and quiet-hour controls.
- `locales/en/notifications.json` exists and says daily/weekly digest is “coming soon”.
- `locales/ar/notifications.json` is `{}`.
- notification list/filter/category labels and `en-GB` date/time handling include hard-coded English paths.

## 4. Confirmed finding register

Every item below is demonstrable from current HEAD. Business decisions are not included in this table.

| ID | Severity | Evidence | Affected area | Invariant | Impact | Recommended closure | Dependency | Parallel-safety group |
|---|---|---|---|---|---|---|---|---|
| **NOTIF-001** | **High** | `createNotification` returns at the in-app gate when `delivery === "email_only"` or the in-app category is disabled, before reaching the email branch (`notifications.ts`, core creation) | Delivery preferences, email | An enabled delivery channel must be evaluated independently of other channels | `email_only` sends neither in-app nor email; disabling an in-app category can suppress an enabled email category | Separate in-app insertion/realtime and email decisions; add matrix tests for every channel/category/mandatory/quiet-hours combination | Mailer test double and preference contract | **N-A core-delivery** |
| **NOTIF-002** | **Medium** | `createNotification` and its email lookup select by ID only; `actorsForEntity` unions assignment/author IDs without active-user joins | Recipient isolation, data lifecycle | Notifications must target existing active recipients unless an explicit security-retention policy says otherwise | Inactive existing users can accumulate rows and receive attempted email/realtime delivery; missing/deleted IDs can leave orphan rows and empty-room broadcasts | Centralise active-recipient resolution; filter actor fan-out and email lookup; define behaviour for missing users | User lifecycle semantics | **N-B recipient-policy** |
| **NOTIF-003** | **Medium** | `createNotificationDeduped` performs `SELECT` then `INSERT`; live DB has no matching unique constraint | Concurrency, duplicates | Concurrent equivalent events inside the window should create at most one notification | Races can create duplicate rows/badges/emails | Introduce an atomic dedupe key/window design or lock-safe insert; stress-test parallel requests | Dedupe semantics in NOTIF-BD-003 | **N-C schema-concurrency** |
| **NOTIF-004** | **Medium** | `routes/risks.ts` directly inserts `risk_assigned` at two sites | Risk assignment, preferences, realtime, email | Every user-facing notification should use the central creation contract | Risk assignment ignores preferences, mandatory rules, realtime push, email, and dedupe | Route both paths through the notification service after confirming self-notification policy | Risk mutation tests | **N-D caller-normalisation** |
| **NOTIF-005** | **Medium** | report transition map emits `technically_approved`; category maps recognise `technically_reviewed` | Report workflow taxonomy | A workflow event kind must have one canonical registered meaning across caller and delivery maps | Event falls into generic system in-app category and has no email category | Adopt one canonical kind and add a registry/sentinel covering all emitted kinds | Report workflow compatibility | **N-D caller-normalisation** |
| **NOTIF-006** | **Medium** | `PATCH /profile` JSON-stringifies `notificationPreferences` without structural validation; generated schema is not invoked | Preferences API/data | Stored preferences must conform to the service's supported shape and enums | Malformed values can create silent, unpredictable delivery or quiet-hour behaviour; client/server contract can drift | Parse with the shared generated schema, reject unknown/invalid enum/time values with 422, and test legacy merge behaviour | API contract regeneration | **N-E contract-validation** |
| **NOTIF-007** | **Low** | socket handler invalidates `["notifications"]`; page query key starts `["notifications-page"]` | Realtime page freshness | All visible notification caches should converge immediately after an authenticated push | Bell updates immediately while an open page can remain stale for up to 30 seconds | Invalidate a shared prefix or both keys; add cache-invalidation test | Frontend query-key convention | **N-F frontend-cache** |
| **NOTIF-008** | **Low** | route uses `Math.min(parseInt(limit ?? "50"), 200)` and orders only by `created_at DESC` | List API, determinism | Public list input must be finite/positive and pagination order deterministic | Invalid/negative limits can reach SQL and equal timestamps can reorder between reads | Validate 1–200 with a 400/422 contract and add `id DESC` tie-breaker; consider cursor pagination | OpenAPI addition | **N-E contract-validation** |
| **NOTIF-009** | **Low** | page/bell fetch handlers return empty arrays/counts on non-OK responses | Frontend failure state, accessibility | Service failure must not be represented as “no notifications” | Users cannot distinguish an empty inbox from an API/auth/server failure | Throw query errors and render/retry an error state without clearing the last good badge | Shared error component | **N-F frontend-cache** |
| **NOTIF-010** | **Medium** | Arabic namespace is empty; page/preferences contain hard-coded English labels and English date handling | Localisation, date/time semantics | Selecting supported Arabic must provide equivalent comprehensible notification operation | Arabic users receive fallback English and non-localised dates/categories | Populate Arabic namespace, move static arrays/labels into translations, and format with active language/timezone | Approved Arabic terminology | **N-G localisation** |

## 5. Product/business decisions — not defects

| ID | Question | Evidence and reason decision is required | Closure needed before |
|---|---|---|---|
| **NOTIF-BD-001** | Are daily and weekly digest options meant to be selectable now? | UI stores them and explicitly labels them “coming soon”; backend has no digest scheduler | Implementing digest or hiding/disabling the choices |
| **NOTIF-BD-002** | Must stored links be constrained to an allow-list of internal route patterns? | Current observed links are internal and destination authorisation remains authoritative; no exploit is confirmed | Adding link validation or migration |
| **NOTIF-BD-003** | Should multiple messages, mentions, announcements, and pins in one conversation suppress each other when kind/entity/window match? | Current dedupe key omits event/message identity and can intentionally collapse distinct events | Atomic dedupe schema and Communication Centre notification tests |
| **NOTIF-BD-004** | Should an actor ever be notified about their own action when they are also the assigned/recipient user? | Most actor fan-outs exclude the caller, but direct assignment paths are caller-specific | Normalising self-notification behaviour |

## 6. Security, isolation, and transaction assessment

### 6.1 Confirmed secure boundaries

- list, mark-one, and mark-all operations are user-owned in SQL;
- route-level authentication wraps the subsystem;
- observed deep-link destinations enforce their own access;
- approver role queries filter active users;
- mandatory security/critical kinds bypass preference filtering.

### 6.2 Residual security/data risks

- inactive-recipient filtering is not a core invariant (NOTIF-002);
- dedupe is not atomic (NOTIF-003);
- arbitrary preference JSON crosses the runtime boundary (NOTIF-006);
- no notification foreign key exists, so lifecycle cleanup depends on application behaviour.

### 6.3 Transaction boundaries

The central service inserts before realtime/email. Email failure is caught and does not roll back the row. This is a reasonable best-effort boundary, but `email_only` currently cannot reach it. Notification calls made after domain transitions are generally secondary effects; the audit did not claim atomic domain-event delivery because no outbox exists and no requirement defines it.

## 7. Historical reconciliation

| Historical assertion | Current status | Current-head evidence |
|---|---|---|
| Reports have no technical-review step | **Resolved / historical assertion invalid now** | Current report transitions include `technical_review` |
| `GET /notifications/unread-count` supplies the badge | **Cannot confirm; historical route description is inaccurate** | Unread total is returned inline by `GET /notifications` |
| Bell owns the Socket.IO subscription and lists five items | **Cannot confirm; historical implementation description is inaccurate** | Subscription is in global socket module; bell requests 20 |
| Notification dedupe and approver-chain hardening exist | **Still valid** | Current service contains both helpers and focused tests |
| All actionable notification gaps were resolved | **No longer valid** | NOTIF-001 through NOTIF-010 are current-head defects |
| Technical-review taxonomy is aligned | **Not valid** | Caller emits `technically_approved`; service maps `technically_reviewed` |

## 8. Test and validation evidence

| Validation | Result | What it proves / does not prove |
|---|---|---|
| `pnpm --filter @workspace/api-server exec vitest run src/test/tc-notification-sector.test.ts src/test/hqsr-tc-notification.test.ts src/test/hqsr-spc-fallback.test.ts src/test/pmr-notifications-routes.test.ts src/test/pmr-notifications.test.ts src/test/pm-full-operational-access.test.ts` | **6 files, 90 tests passed** | Covers TC sector routing, HQSR TC/fallback routing, PMR routes/service, and PM full operational access; does not exercise generic notification routes/preferences/email matrix or Communication Centre CRUD |
| `pnpm --filter @workspace/api-server test` | **87 files, 2,305 tests passed** | Broad regression confidence; no dedicated conversation-route suite |
| `pnpm --filter @workspace/cafa-pmis test` | **90 files, 5,172 tests passed** | Broad frontend regression confidence; no notification/messages page-specific suite was found |
| `pnpm --filter @workspace/api-server typecheck` | **Failed: 13 pre-existing errors in 4 unrelated files** | Not a clean typecheck signal for HEAD; errors were in risk/report/plan tests/routes, not audit docs |
| `pnpm --filter @workspace/cafa-pmis typecheck` | **Failed: 31 pre-existing errors in 7 unrelated files** | Not a clean typecheck signal for HEAD; errors were predominantly report/plan/risk surfaces |
| Workflow restart/log check | **API and web running cleanly** | API built/started, health check 200, Socket.IO initialised; mailer explicitly in stub mode |
| Browser smoke | **Protected routes redirected to login; repeated expected `/api/me` 401s; no other console errors** | Auth boundary works without a session; no authenticated notification interaction was exercised |
| Live development catalogue | **Reachable; metadata captured** | Confirms indexes and absence of FK/dedupe uniqueness in development; not production schema parity |

The API run emitted one non-fatal due-date-checker warning caused by mocked query data; all tests still passed.

## 9. Missing sentinel coverage

No current tests were found for:

1. channel matrix including `email_only`, in-app-disabled/email-enabled, mandatory, and quiet hours;
2. inactive/missing/deleted recipients across direct, actor, role, and approver paths;
3. concurrent `createNotificationDeduped`;
4. `risk_assigned` preference/realtime/email behaviour;
5. registry parity between every emitted kind and category maps;
6. malformed preference payloads and legacy preference merge;
7. list limit validation and deterministic ordering;
8. page and bell cache convergence on `notification:new`;
9. non-OK frontend rendering;
10. Arabic rendering and locale-aware date/time.

## 10. Residual register

| Residual | Status |
|---|---|
| Authenticated browser behaviour for list/read/preferences/bell | **Not exercised** — no session or credentials were available |
| Production recipient/data distribution | **Not inspected** — no production query was required or run |
| Actual email provider delivery | **Not exercised** — development mailer was intentionally in stub mode |
| High-concurrency duplicate rate | **Not measured** — defect is established structurally; no data-writing stress test was run |
| Digest expectations, link allow-list, self-notification, cross-event dedupe | **Open decisions**, not defects |
| Typecheck closure | **Outside this audit** — pre-existing failures recorded honestly |

## 11. Recommended notification closure order

1. **Wave N1 — delivery correctness:** NOTIF-001 and channel-matrix tests.
2. **Wave N2 — identity and atomicity:** NOTIF-002 and NOTIF-003 after business decisions.
3. **Wave N3 — caller/taxonomy normalisation:** NOTIF-004 and NOTIF-005.
4. **Wave N4 — contract and list hardening:** NOTIF-006 and NOTIF-008.
5. **Wave N5 — frontend truthfulness/freshness:** NOTIF-007 and NOTIF-009.
6. **Wave N6 — Arabic parity:** NOTIF-010.

These are recommendations only; this audit does not declare functional closure or create remediation tasks.