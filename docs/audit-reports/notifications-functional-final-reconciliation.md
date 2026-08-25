# Notifications Functional Final Reconciliation

**Reconciliation date:** 20 August 2026  
**Authority:** Current HEAD after the merged NOTIF-001 through NOTIF-010 work  
**Language standard:** British English

## Verdict

**ZERO-RESIDUAL COMPLETE — NOTIFICATIONS FUNCTIONAL MODULE**

NOTIF-001 through NOTIF-010 have no current Notification software residual.
Historical notification duplicates remain separately classified for human data
review. No historical notification rows were deleted, merged, rewritten, or
backfilled.

## Audit History

This reconciliation checked the current implementation and tests against:

- `docs/audit-reports/notifications-functional-audit.md`
- `docs/audit-reports/notifications-core-delivery-closure.md`
- `docs/audit-reports/notifications-recipient-dedupe-closure.md`
- `docs/audit-reports/notifications-caller-taxonomy-closure.md`
- `docs/audit-reports/notifications-api-preferences-list-closure.md`
- `docs/audit-reports/notifications-i18n-closure.md`
- the current Notification API, service, OpenAPI, generated client, locale
  resources, frontend surfaces, and regression suites.

The earlier audit's findings are historical evidence only. Current HEAD and
current test results are authoritative.

## NOTIF-001…010 Final Register

| ID | Original finding | Current implementation | Current tests | Final classification | Residual? |
| --- | --- | --- | --- | --- | --- |
| NOTIF-001 | In-app and email delivery decisions were coupled. | `both`, `inapp_only`, and `email_only` are evaluated independently; mandatory overrides, quiet hours, realtime ordering, and best-effort mail are preserved. | Delivery matrix and side-effect isolation tests. | CLOSED | None |
| NOTIF-002 | Missing or inactive recipients could receive notification side effects. | One central active-recipient lookup gates every notification path, including role and actor fan-out. | Recipient and actor-exclusion sentinels. | CLOSED | None |
| NOTIF-003 | Select-then-insert dedupe was race-prone. | `notification_event_dedupes` claims `(user_id, event_key)` atomically with `INSERT ... ON CONFLICT`. | Parallel ×2, parallel ×10, distinct-event tests. | CLOSED | None |
| NOTIF-004 | Production callers bypassed the central notification contract. | User-facing notification creation is centralised; risk payload identity and account confirmation handling are correct. | Caller centralisation and producer matrix tests. | CLOSED | None |
| NOTIF-005 | Notification kinds were inconsistent across callers and delivery maps. | `NOTIFICATION_KIND_REGISTRY` is the current taxonomy source of truth; historical aliases are presentation-only. | Registry parity, canonical write, and legacy alias tests. | CLOSED | None |
| NOTIF-006 | Preference JSON was not strictly validated. | Supported categories, delivery options, quiet hours, timezone, and immediate-only digest are validated and safely normalised on read. | Preference persistence and legacy-normalisation tests. | CLOSED | None |
| NOTIF-007 | Realtime invalidation did not converge all notification views. | Recipient-scoped bell/page cache keys share invalidation; authenticated realtime refreshes both surfaces. | Cache-key and invalidation tests. | CLOSED | None |
| NOTIF-008 | List bounds and ordering were not deterministic. | Inputs are bounded and validated; list ordering is newest-first with an ID tie-breaker and a stable response envelope. | IDOR, validation, ordering, and pagination tests. | CLOSED | None |
| NOTIF-009 | Fetch failures were represented as an empty inbox. | Page and bell retain truthful error states and visible Retry controls. | Frontend error-state tests. | CLOSED | None |
| NOTIF-010 | Arabic notification presentation and date handling were incomplete. | Page, bell, preferences, kind/entity labels, timestamps, RTL layout, accessibility text, and locale-key parity are covered. | Frontend localisation, namespace, infrastructure, and RTL suites. | CLOSED | None |

## Delivery Contract

The central service computes the in-app and email decisions independently:

- `both` evaluates both channels independently;
- `inapp_only` cannot invoke email;
- `email_only` does not create an in-app row or realtime event, but can invoke
  eligible email delivery;
- disabling one channel's category does not suppress an independently enabled
  category on the other channel;
- mandatory notification kinds bypass category preferences and quiet hours;
- quiet hours suppress only the intended non-mandatory email path;
- mailer failure remains best-effort and cannot roll back an in-app row.

The development mailer is intentionally stubbed. Actual provider delivery is an
external environment baseline, not a Notification software residual.

## Recipient / Self-Notification

Recipients must be existing active users. Missing, inactive, and unresolvable
recipients produce no row, realtime event, or email.

Actor-driven fan-out excludes the actor for the action they performed. This does
not suppress unrelated entity-owner or operational alerts where the product
contract intentionally includes the user.

Project, plan, report, risk, comments, conversation, due-date, PMR, and HQSR/TC
notification paths use the central service or its approved wrappers.

## Dedupe / Concurrency

Migration `031_notification_event_dedupes` tracks immutable source-event claims
with a unique `(user_id, event_key)` constraint. The winner alone performs
downstream side effects.

Current event identities distinguish messages, mentions, pins, announcements,
workflow transitions, comments, risk assignment, report transitions, and
date-bucketed reminders. Retries of the same logical event dedupe; different
logical events remain distinct.

## Callers / Taxonomy

No user-facing production `INSERT INTO notifications` exists outside the
central service. The remaining route writes are recipient-owned read mutations
and project cleanup deletion, not notification creation bypasses.

`NOTIFICATION_KIND_REGISTRY` controls current kind registration, preference
category, email policy, mandatory handling, persisted new values, and realtime
payload values. The frontend presentation helper maps canonical kinds to locale
keys; it does not define delivery taxonomy.

Historical aliases include:

- `technically_approved` → `technically_reviewed`;
- `notification.assigned` → `assigned`.

Unknown historical or future values are safely presented as a readable
Notification fallback in the UI. Stored rows are not changed.

## API / Ownership / Links

- Notification list and read mutations are recipient-private through
  user-bound SQL predicates.
- Direct notification IDs cannot be used to mark another user's notification
  as read.
- List filters, bounds, ordering, and response pagination match the OpenAPI
  contract and generated client.
- New links are restricted to recognised internal CAFA PMIS routes.
- Historical unsafe links are returned safely and cannot trigger navigation.
- Possessing a notification does not grant destination authorisation; target
  routes retain their own access checks.

## Preferences / Digest

Preference validation remains strict for supported delivery options, categories,
quiet-hour values, and timezones. Legacy malformed values are preserved in
storage but safely canonicalised at the response/delivery boundary.

Daily and weekly digest functionality remains **COMING SOON / unavailable**:

- only `immediate` is accepted by the API;
- daily and weekly controls remain visibly disabled in the UI;
- no scheduler is claimed or implemented;
- Arabic and English communicate the same unavailable boundary.

## Realtime / Cache

Realtime notification creation occurs only after an in-app row exists. Email-only
delivery does not emit an in-app realtime event. Atomic event claims prevent
duplicate realtime emissions.

Notification cache keys are recipient-scoped. Bell, page, and unread state share
the notification invalidation prefix. Logout and user switching clear
recipient-specific state and do not expose a previous user's inbox.

## Frontend Error Truthfulness

Notification fetch failures remain distinguishable from an empty inbox and from
confirmed unread zero. The page and bell render a visible localised error and
Retry action rather than substituting an empty response.

The protected `/notifications` route was also checked in a browser without
credentials: it redirected safely to the login page without runtime or console
errors. An authenticated browser session was unavailable, so authenticated
interactive coverage is recorded as a verification-environment limitation,
not a software residual.

## Arabic / Localisation

The English and Arabic `notifications` namespaces have identical structural key
sets. The Notification page, bell, preferences, kind/entity labels, errors,
loading/empty states, digest boundary, and accessibility labels use the active
locale.

Canonical and historical kinds are presented through the shared
presentation boundary. Unknown kinds resolve to a readable fallback rather than
raw snake_case.

Notification timestamps use locale-aware relative and date formatting. Stored
timestamps and timezone semantics are unchanged.

Persisted notification messages, usernames, project names, report titles, risk
titles, conversation names, and other user-generated/entity content remain
untranslated by design.

Arabic surfaces set RTL direction where Notification-owned portals or wrappers
need it and use logical directional CSS for notification borders, spacing,
actions, arrows, and alignment.

## Database / Migrations

Migration `031_notification_event_dedupes` and the tracked Drizzle schema define
the event-claim table and uniqueness invariant. The migration performs a
read-only historical duplicate preflight and does not modify existing
notifications.

No Notification startup DDL was found in the Notification service or routes.
The current migration chain owns the Notification schema change.

## Business Decisions

| Decision | Current classification | Reconciliation |
| --- | --- | --- |
| NOTIF-BD-001 — daily/weekly digest availability | ACCEPTED DESIGN CONSTRAINT | Immediate-only is the current product boundary until a scheduler exists. |
| NOTIF-BD-002 — internal notification links | CLOSED BY IMPLEMENTATION | New links use the internal route allow-list; historical unsafe links fail safely. |
| NOTIF-BD-003 — cross-event suppression | CLOSED BY IMPLEMENTATION | Source-event identities distinguish messages, mentions, pins, announcements, and transitions; only true retries dedupe. |
| NOTIF-BD-004 — self-notification | CLOSED BY IMPLEMENTATION | Actor-driven actions exclude the actor where intended without suppressing unrelated owner/operational alerts. |

## Historical Data Register

The prior preflight recorded **50 historical exact-duplicate notification
groups**. They remain untouched. No automatic deletion, merge, rewrite, or event
identity backfill was performed.

These groups are classified as **HISTORICAL DATA REVIEW** and do not keep the
Notification software closure open because new delivery uses atomic event
claims.

## Tests

### Notification-owned API suites

**10 files / 228 tests / 228 passed / 0 failed**

- `notifications-delivery.test.ts`
- `notifications-recipient-dedupe.test.ts`
- `notifications-caller-taxonomy.test.ts`
- `notification-link-safety.test.ts`
- `notifications-hardening.test.ts`
- `profile-notification-preferences.test.ts`
- `pmr-notifications.test.ts`
- `pmr-notifications-routes.test.ts`
- `tc-notification-sector.test.ts`
- `hqsr-tc-notification.test.ts`

This includes delivery matrix, recipient eligibility, actor exclusion,
concurrency dedupe, caller/taxonomy, links, API ownership, list validation,
preferences, and relevant workflow routing.

### Notification-owned frontend suites

**4 files / 76 tests / 76 passed / 0 failed**

- `notifications-hardening.test.ts`
- `notifications-i18n.test.tsx`
- `i18n-infrastructure.test.ts`
- `i18n-rtl-regression.test.ts`

This includes cache/error truthfulness, locale-key parity, canonical and
historical kind presentation, unknown fallback, page/bell/preferences Arabic
rendering, digest availability, timestamp formatting, and RTL infrastructure.

A broader API test invocation ran 99 files and found two unrelated failures in
Plans and Risks. Those failures are outside the Notification-owned matrix and
do not affect this verdict.

## TypeScript / Builds

- Notification-owned frontend TypeScript errors: **0**
- Frontend full typecheck: **passed** after rebuilding the existing composite
  `api-client-react` declarations
- API full typecheck: **blocked by pre-existing unrelated diagnostics** in
  object storage, Risk, Reports, Storage, and Plans aggregate test surfaces;
  no Notification-owned TypeScript diagnostics were reported
- Frontend production build: **passed**
- API production build: **passed**
- Managed API workflow: **running**
- Managed web workflow: **running**

The frontend build retains existing sourcemap and chunk-size warnings only.

## Software Residual Register

**NONE**

## Historical Data Review Register

- 50 historical exact-duplicate notification groups: **HISTORICAL DATA REVIEW**;
  no automatic remediation.
- Historical notification free-text and entity names: preserved as stored and
  intentionally not translated.
- Authenticated browser session: unavailable in the verification environment;
  protected-route redirect verified safely.
- External email provider delivery: development mailer is stubbed; provider
  delivery is an external baseline.

## Closure Decision

The Notification functional module meets the zero-residual closure standard:

**ZERO-RESIDUAL COMPLETE — NOTIFICATIONS FUNCTIONAL MODULE**

No Notification final reconciliation task or follow-up task was created.