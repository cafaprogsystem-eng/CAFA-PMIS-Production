# Notifications Recipient Integrity & Atomic Dedupe — Wave 2 Closure

**Closure date:** 19 August 2026  
**Scope:** `NOTIF-002`, `NOTIF-003`  
**Status:** Closed

## Status

- **NOTIF-002: CLOSED** — active-recipient eligibility is centrally enforced.
- **NOTIF-003: CLOSED** — event-aware deduplication is backed by a database
  uniqueness invariant and atomic `INSERT ... ON CONFLICT`.

## Recipient Invariant

All paths through `createNotification` now resolve the intended recipient using
one authoritative active-recipient lookup:

- the user must exist;
- the user must have `status = 'active'`;
- missing, inactive, or unresolvable recipients are a deterministic safe no-op;
- no notification row, realtime emission, or email is produced for an
  ineligible recipient.

Full Operational Access does not bypass this invariant. No historical ownership
or assignment data is changed.

`actorsForEntity` also joins active users for project creators/assignments,
report submitters/authors/project assignments, and plan
creators/responsible-users/project assignments. The central resolver remains the
final common safeguard for role fan-out, direct creation, and all wrappers.

## Self-Notification

Actor-driven fan-out continues to use the explicit `exceptUserId` actor
identity. The actor is removed only from the recipient set for the action they
performed; an unrelated matching entity owner is not suppressed. A sentinel
asserts this behaviour.

## Atomic Dedupe Model

Migration `031_notification_event_dedupes` creates the immutable
`notification_event_dedupes` table with the unique constraint:

```text
(user_id, event_key)
```

The service claims this key with:

```sql
INSERT ... ON CONFLICT (user_id, event_key) DO NOTHING RETURNING id
```

The winning caller alone creates the in-app row, emits realtime, and invokes
email. The claim exists separately from `notifications` because valid
email-only delivery must not fabricate an in-app notification row.

Keys are documented, source-derived event identities rather than generic
`entity + kind + time` values. Examples include:

- `conversation-message:<message id>`;
- `conversation-message-mention:<message id>`;
- `conversation-message-pin:<message id>`;
- `conversation-announcement:<conversation id>`;
- workflow transition keys containing entity ID, action, prior state, and next
  state;
- due-date reminder keys containing entity, reminder kind, and calendar-day
  bucket.

This keeps separate messages, mentions, pins, announcements, and workflow
transitions distinct while collapsing true delivery retries.

## Migration / Preflight

Before adding the new uniqueness invariant, a read-only historical preflight
grouped exact duplicate notification rows by recipient, kind, entity, message,
and link.

- **50 historical exact-duplicate groups were found.**
- No existing notification row was deleted, updated, or backfilled.
- The migration raises an operator warning if such groups exist, then creates
  an empty event-claim table because legacy notifications do not contain a
  reliable source-event identity.
- Development database verification confirmed both the new table and its unique
  constraint exist after the migration.

Historical duplicate review requires an explicit data-retention decision and is
intentionally not performed by this closure.

## Email / Realtime Safety

NOTIF-001’s independent channel contract remains intact:

- `both`, `inapp_only`, and `email_only` are still evaluated independently;
- the event claim runs only when at least one channel is eligible;
- email-only delivery claims the event without inserting an in-app row;
- duplicate callers send neither duplicate email nor duplicate realtime;
- mailer failure remains best-effort and cannot undo a successful in-app row.

The due-date scheduler now starts only after tracked migrations complete, so a
fresh deployment cannot invoke the event-claim table before it exists.

## Concurrency

Sentinels use parallel `Promise.all` creation attempts:

- same logical event ×2 creates once;
- same logical event ×10 creates once;
- the winner emits realtime once and invokes email once;
- different messages, a message versus a mention, and different workflow
  transitions each remain separate.

## Tests

Verified:

- Recipient and dedupe sentinels:
  `NOTIF-RECIP-01` through `NOTIF-RECIP-05`;
  `NOTIF-DEDUPE-01` through `NOTIF-DEDUPE-06`.
- NOTIF-001 delivery matrix regression.
- Existing PMR, HQSR, TC-sector, migration, and due-date/Risk regressions.
- **274 tests passed** across the targeted suites.
- API production build passed.
- API workflow restarted successfully; Migration 031 applied successfully.

The workspace-wide API TypeScript check remains blocked only by pre-existing
Risk, Reports, and Plan contract/test drift. It reports no error in the Wave 2
notification changes.

## Files Changed

- `artifacts/api-server/src/lib/notifications.ts`
- `artifacts/api-server/src/lib/notifications-recipient-dedupe.test.ts`
- `artifacts/api-server/src/lib/notifications-delivery.test.ts`
- `artifacts/api-server/src/lib/due-date-checker.ts`
- `artifacts/api-server/src/lib/run-migrations.ts`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/routes/conversations.ts`
- `artifacts/api-server/src/routes/projects.ts`
- `artifacts/api-server/src/routes/plans.ts`
- `artifacts/api-server/src/routes/reports.ts`
- `artifacts/api-server/src/routes/risks.ts`
- `lib/db/src/schema/index.ts`
- notification routing regression test fixtures

## Audit File

`docs/audit-reports/notifications-recipient-dedupe-closure.md`