# Notifications Wave 3 — Caller & Taxonomy Closure

**Scope:** NOTIF-004 (Caller & Payload Correctness) and NOTIF-005 (Canonical
Notification Taxonomy Normalisation)  
**Baseline:** CURRENT HEAD, including the completed NOTIF-001/002/003 delivery,
active-recipient, actor-exclusion, and atomic event-dedupe contracts.  
**Out of scope:** NOTIF-006 through NOTIF-010 and unrelated Communication Centre
work.

## Outcome

| Finding | Disposition | Closure evidence |
| --- | --- | --- |
| NOTIF-004 | **CLOSED** | All production notification writes now go through the central service. Risk assignment and account-confirmation paths no longer bypass preferences, active-recipient filtering, realtime emission, or dedupe. Risk actor fan-out now identifies the risk event while resolving recipients from its linked project. |
| NOTIF-005 | **CLOSED** | A single current-kind registry controls in-app preference category, email category, mandatory delivery, new persisted values, and realtime payload values. Report technical-review notifications now emit `technically_reviewed`; historical `technically_approved` rows remain untouched and are mapped at presentation. |

No historical notification rows or dedupe records were rewritten or deleted. No
database migration was required.

## Canonical taxonomy and compatibility

The server registry is the authoritative source of truth for current
notification kinds and channel categorisation. It covers:

- communication: `message`, `mention`, `comment_added`, `comment_replied`;
- review lifecycle: `review_requested`, `submitted`, `resubmitted`,
  `technically_reviewed`, `coordination_reviewed`, `approved`, `rejected`,
  `returned`, `activated`, `closed`, `started`, `delayed`, `completed`,
  `cancelled`, `archived`, `reopened`;
- project and plan events: `project_created`, `project_assigned`,
  `plan_assigned`, `document_uploaded`, `budget_high`, `budget_exceeded`;
- risk events: `risk_created`, `risk_updated`, `risk_assigned`, `risk_high`,
  `risk_critical`, `risk_status_changed`, `risk_severity_downgraded`;
- account/system events: `system`, `password_changed`, `email_verified`,
  `account_suspended`, `security_alert`;
- all current risk/project/plan/activity due and overdue reminder kinds.

`technically_approved` remains a workflow-status value. It is no longer
emitted as a notification event. A legacy stored notification with that value
is presented as `technically_reviewed`; the stored row itself is not changed.
The pre-existing `notification.assigned` legacy value is similarly presented as
the canonical `assigned` assignment-category event. Unknown historical values
remain readable verbatim rather than being rewritten or silently discarded.

The notification list endpoint applies this compatibility presentation layer.
There was no separate generated notification DTO/OpenAPI enum to change in the
current API surface. The frontend continues to consume the list/realtime
`kind` field and receives canonical values for legacy aliases without a
client-side storage migration.

## Production caller matrix

All routes below use the central creation/delivery service directly or through
its documented wrappers. “Actor exclusion” means the initiating user is
removed from a recipient set where applicable.

| Producer and trigger | Kind(s) / entity | Recipient source and actor exclusion | Stable event identity / link |
| --- | --- | --- | --- |
| Projects — create | `project_created`, project | creator; self acknowledgement intentional | `project-created:{project}`; `/projects/{project}` |
| Projects — assignment at create | `project_assigned`, project | submitted assignee, excluding creator | `project-assignment:{project}:{user}:{role}`; project route |
| Projects — threshold check | `budget_high`, `budget_exceeded`, project | PM/SPC and project assignments; update actor may receive an operational alert | date-bucketed budget alert key; project route |
| Projects — transition | review/decision lifecycle kinds, project | project creator and assignments, excluding actor | `project-transition:{project}:{action}:{from}:{to}`; project route |
| Projects — next approver | `review_requested`, project | active routing-chain reviewer, excluding actor | transition key plus `:next-approver`; project route |
| Projects — document upload | `document_uploaded`, project | project actors, excluding uploader | `project-document-upload:{project}:{document}`; project route |
| Plans — create assignment | `plan_assigned`, plan | responsible user, excluding creator | `plan-assignment:{plan}:{user}`; `/plans/{plan}` |
| Plans — submit / transitions / reopen | lifecycle and `review_requested`, plan | plan actors or routing-chain reviewer, excluding actor | transition/reopen source keys; plan route |
| Reports — transition | lifecycle kinds including `technically_reviewed`, report | author, submitter, linked-project actors, excluding actor | `report-transition:{report}:{action}:{from}:{to}`; `reportDeepLink` |
| Reports — next approver | `review_requested`, report | workflow/sector/HQ-aware next approver, excluding actor | transition key plus `:next-approver`; `reportDeepLink` |
| Risks — linked-project create | `risk_created`, **risk** | linked-project actors, excluding creator | `risk-created:{risk}`; `/risks` |
| Risks — standalone create | `risk_created`, risk | PM/SPC plus matching active state staff, excluding creator | `risk-created:{risk}`; `/risks` |
| Risks — create or change assignment | `risk_assigned`, risk | explicit active assignee, excluding initiator | assignment transition keys; `/risks` |
| Risks — update | `risk_updated`, **risk** | linked-project actors, excluding updater | state-derived update key; `/risks` |
| Risks — high/critical escalation | `risk_high`, `risk_critical`, risk | operational leadership; critical is mandatory | risk alert source key; `/risks` |
| Risks — severity/status transition | `risk_severity_downgraded`, `risk_status_changed`, risk | assignee, matching state staff, PM/SPC; excluding actor | state-transition keys; `/risks` |
| Comments — add/reply | `comment_added`, `comment_replied`, parent entity | entity actors plus parent author, excluding commenter | shared `comment-event:{comment}` key; entity-specific internal link |
| Comments — mention | `mention`, parent entity | active mentioned user, excluding commenter | `comment-mention:{comment}`; entity-specific internal link |
| Conversations — message | `message`, conversation | other active members | `conversation-message:{message}`; `/messages/{conversation}` |
| Conversations — mention | `mention`, conversation | active mentioned members | `conversation-message-mention:{message}`; message route |
| Conversations — pin | `message`, conversation | other active members | `conversation-message-pin:{message}`; message route |
| Conversations — announcement | `message`, conversation | announcement audience | `conversation-announcement:{conversation}`; message route |
| Due-date checker | due/overdue kinds, risk/project/plan/activity | assigned/responsible/author/project actors; central service filters inactive recipients | `due-date:{type}:{entity}:{kind}:{date}`; internal entity route |
| Auth — password reset confirmed | `password_changed`, user | reset user; mandatory in-app confirmation | `password-changed:{reset-token}`; `/users`; specialised confirmation email remains separate |
| Auth — email verified | `email_verified`, user | verified user; mandatory in-app acknowledgement | `email-verified:{verification-token}`; `/profile` |

The wrapper inventory is also reconciled:

- `createNotification` enforces active-recipient resolution, preferences,
  realtime, email policy, and canonical new-write kind handling.
- `createNotificationDeduped` atomically claims a per-recipient source event
  before any channel side effect.
- `notifyEntityActors` and `notifyEntityActorsDeduped` resolve active entity
  actors; the deduped variant now supports a separate recipient entity for
  linked-risk stakeholder fan-out.
- `notifyByRole` resolves active role recipients and uses atomic dedupe when a
  caller supplies its source key.
- `notifyNextApprover` and `actorsForEntity` remain the approved workflow and
  stakeholder resolution paths.

There are no remaining production direct `INSERT INTO notifications` callers
outside the central service.

## Payload, route, and delivery reconciliation

- Risk assignment notifications now retain the assignment recipient exclusion,
  have a risk entity ID, use stable assignment-transition keys, and receive
  normal preference/realtime/email handling.
- Linked-risk create/update fan-out no longer writes a project entity ID for a
  risk event. Project stakeholders are used only to derive recipients.
- Review events distinguish `technically_reviewed` from the
  `technically_approved` workflow status.
- Route links were audited as internal routes. Reports use the established
  `reportDeepLink`; no caller constructs a user-controlled external link.
- Message, mention, pin, announcement, comments, and workflow transitions
  retain distinct source keys. Retrying the same logical source event converges
  through the existing atomic `(user_id, event_key)` claim.
- Account confirmation notifications retain their specialised transactional
  emails while suppressing a duplicate generic notification email.

## Regression coverage and verification

New `NOTIF-CALLER` sentinels cover:

1. producer-to-registry parity and the report technical-review value;
2. risk event identity, project-recipient derivation, and actor exclusion;
3. absence of direct production notification-table writes;
4. internal-route notification links;
5. distinct message, mention, pin, and announcement identities;
6. distinct workflow/comment retry keys; and
7. legacy stored-value readability.

Validated successfully:

- API build;
- web build;
- NOTIF-001 delivery matrix;
- NOTIF-002 active-recipient tests;
- NOTIF-003 atomic-dedupe/concurrency tests;
- PMR notification tests and routes;
- `NOTIF-CALLER` sentinels: **181 tests passing across the selected suite**;
- managed API and web workflows restarted and serving;
- browser screenshot of the running web artifact.

The workspace-wide API `tsc --noEmit` still reports pre-existing schema/type
diagnostics in unrelated risk-location and report-override code. It reports no
diagnostics from the notification service, caller-taxonomy test, auth,
comments, plans, projects, notification list route, or the changed report
transition mapping. The pre-existing risk-location diagnostic is in the same
route file but outside this notification scope.