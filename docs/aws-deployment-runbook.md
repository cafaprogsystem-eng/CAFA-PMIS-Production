# CAFA PMIS AWS deployment and operations runbook

**Status:** implementation-ready design with the staging CloudFormation
definition in `infra/aws-staging/template.yaml`; no AWS resources or
certification evidence are created by this document.
**Authority:** this is the canonical staging and production deployment source of
truth. `DEPLOYMENT.md` and `BACKUP_RESTORE.md` are operator entry points. Docker
Compose and the Nginx example remain local/VPS reference material only.

## 1. Decision and boundaries

CAFA PMIS will initially run as **one ECS Fargate task per environment** behind
an Application Load Balancer (ALB). Each task runs the existing single
container: Express serves the compiled PWA and `/api` from the same process,
and Socket.IO uses that process at `/api/socket.io`.

| Selected service | Role |
| --- | --- |
| Amazon ECR | Stores immutable, content-addressable release images. |
| ECS on Fargate | Runs one application/realtime/scheduler task and one short-lived migration task. |
| Application Load Balancer | Public HTTPS entry point, HTTP redirect, target health checks, and WebSocket forwarding. |
| Amazon RDS for PostgreSQL | Private managed database; no PostgreSQL container or host volume. |
| Amazon S3 | Private, separate attachment bucket per environment. |
| AWS Secrets Manager | Stores runtime secrets and injects them into the relevant ECS task. |
| AWS Certificate Manager | Supplies the ALB certificate. |
| Amazon CloudWatch | Receives application, migration, and platform logs; supplies metrics and alarms. |

Fargate is the selected initial target instead of Docker on EC2. It fits the
current single-container runtime without introducing host patching, Docker
daemon maintenance, local database volumes, host cron, or host-level TLS
renewal. It preserves a deliberate one-replica operating model and leaves a
defined path to scale later.

This is not a plan to create an AWS account, a domain, an image, certificate,
network, DNS record, role, database, bucket, or secret. Those are future,
approved infrastructure changes. The repository now contains the approved
staging-only definition and migration-gated operator script, but it does not
claim that either has been applied until the preflight and evidence report are
complete.

## 2. Environment topology and isolation

Staging and production are separate security and failure domains. Use separate
hostnames/origins and separate AWS resources; do not use an environment prefix
inside a shared database or attachment bucket as the isolation boundary.

```text
                         Internet
                            |
       +--------------------+--------------------+
       |                                         |
https://<staging-origin>                  https://<production-origin>
       |                                         |
 [staging ALB, public subnets]            [production ALB, public subnets]
       |                                         |
 [staging ECS service, private subnets]   [production ECS service, private subnets]
  one task: Express + PWA + Socket.IO      one task: Express + PWA + Socket.IO
  SCHEDULER_ENABLED=true                   SCHEDULER_ENABLED=true
       |                \                        |                \
       |                 \                       |                 \
[staging RDS]     [staging S3 bucket]     [production RDS]  [production S3 bucket]
private subnets     private objects          private subnets    private objects
       |                                         |
[staging Secrets Manager / task role]     [production Secrets Manager / task role]
       |                                         |
[staging CloudWatch logs/backups]         [production CloudWatch logs/backups]
```

| Boundary | Staging | Production | Required rule |
| --- | --- | --- | --- |
| Browser origin | `<staging-origin>` | `<production-origin>` | `PUBLIC_APP_URL` contains only that environment's HTTPS origin. |
| Compute | Staging ECS service and task role | Production ECS service and task role | Never share service, role, task definition revision, or runtime secret binding. |
| Database | Dedicated RDS instance/cluster, DB, credentials, backups | Dedicated RDS instance/cluster, DB, credentials, backups | No cross-environment database access. |
| Attachments | Dedicated private S3 bucket and policy | Dedicated private S3 bucket and policy | No shared bucket or cross-environment prefix access. |
| Sessions | Distinct `SESSION_SECRET` | Distinct `SESSION_SECRET` | Cookies from one environment must not validate in the other. |
| Observability | Separate log groups, alarms, dashboards, retention | Separate log groups, alarms, dashboards, retention | Do not mix production events with staging diagnostics. |
| Email | Disabled or sandbox/allowlisted delivery | Approved real sender/domain and delivery policy | Staging must not send to real user populations. |
| Browser tests | Isolated staff identities and non-production fixture controls | No fixture provisioning | E2E identities/credentials remain staging-only secrets. |

## 3. Network and security-group model

Each environment uses its own VPC (preferred) or, only if organisation policy
requires a shared VPC, separate private subnets, security groups, route
boundaries, roles, and endpoints. The initial availability layout should use at
least two Availability Zones where the selected RDS configuration supports it.

```text
VPC: one per environment
  Public subnets
    ALB: listeners 80 (redirect) and 443 (ACM TLS)
  Private application subnets
    ECS/Fargate task ENI: application port 8080 only
  Private database subnets
    RDS PostgreSQL: port 5432 only
```

| Security group | Inbound | Outbound | Notes |
| --- | --- | --- | --- |
| ALB | Internet to 80 and 443 | ECS task SG to 8080 | Redirect 80 to 443. Restrict 80 further only if an approved edge policy provides the redirect. |
| ECS task | ALB SG to 8080 only | RDS SG to 5432; approved AWS service endpoints and approved external providers over TLS | No direct internet listener and no SSH. |
| RDS | ECS task SG to 5432 only | Only what the managed service requires | Never public; do not allow a broad VPC CIDR rule. |

Use private application and database subnets. ECS outbound access must be
deliberately designed: private NAT egress and/or appropriate VPC endpoints for
ECR image retrieval, CloudWatch Logs, Secrets Manager, S3, STS/ECS task
credentials, and other selected AWS services. Permit HTTPS egress only to
approved external dependencies such as the configured email provider or
AI provider when enabled. Do not use a public IP on the application task.

Administrative access is controlled through named IAM identities, MFA, least
privilege, CloudTrail/audit review, and time-bound access. Use ECS Exec only if
approved and fully audited; no bastion, SSH, or public database endpoint is
part of this initial design. Database administration requires a separately
approved controlled access route and must never broaden the RDS security group
to the internet.

Each ECS task definition has two intentionally different IAM authorities:

- the **task execution role** retrieves the private ECR image, writes its
  designated CloudWatch stream, and obtains only the named Secrets Manager
  values required to start that task; and
- the **application task role** is the runtime identity. It receives only the
  environment bucket/prefix object permissions and any other narrowly approved
  AWS API access. It must not inherit deployment, ECR administration, broad
  Secrets Manager, or cross-environment access.

Cost drivers to review during provisioning include Fargate CPU/memory and
uptime, ALB hours and requests, NAT/egress or VPC-endpoint usage, RDS class and
storage/IO/backups, S3 storage/request/version retention, CloudWatch ingestion
and retention, Secrets Manager, and data transfer. Select budgets and alarms
from current AWS pricing at the time of provisioning; this runbook makes no
price claim.

## 4. Public routing and runtime contract

The browser always uses one HTTPS origin per environment:

| Request | ALB behaviour | Application behaviour |
| --- | --- | --- |
| `http://<origin>/*` | Redirect to the same HTTPS URL | Not served by the task as a public contract. |
| `https://<origin>/` and SPA paths | Forward to the sole task on port 8080 | Express serves Vite static files and the SPA fallback. |
| `https://<origin>/api/*` | Forward to the same task on port 8080 | Express API routes take priority over static content. |
| `https://<origin>/api/socket.io/*` | Forward HTTP polling and WebSocket upgrade to the same task on port 8080 | Socket.IO is configured at exactly `/api/socket.io`. |

TLS terminates at the ALB using ACM. The ALB must preserve `Host`,
`X-Forwarded-For`, and `X-Forwarded-Proto`. Express already trusts one proxy
hop, which is compatible with the ALB topology. `PUBLIC_APP_URL` is a validated
credentialed-origin allowlist and must be the canonical HTTPS origin, with no
path, credentials, query string, or wildcard.

Same-origin routing is required for the signed secure session cookie, HTTP and
Socket.IO credentialed-origin policy, and PWA requests. Do not split the PWA
and API onto different origins or mount this application below a path prefix
without an explicit application design change. Do not route the legacy
`/socket.io` path; the correct path is `/api/socket.io`.

Health semantics:

| Endpoint | Meaning | Use |
| --- | --- | --- |
| `/api/healthz` | Public, lightweight process/connectivity probe; no-cache response | Browser connectivity evidence and external availability monitor. |
| `/api/readyz` | Deployment readiness; returns 503 until the process has completed startup/schema verification and is listening | ALB target-group health check and release gate. |

After the task receives `SIGTERM`, it becomes not ready before HTTP shutdown and
stops realtime, scheduler work, and its database pool gracefully.

### One process, one scheduler, one realtime authority

Each environment starts with **one desired/running API task** and
`SCHEDULER_ENABLED=true`. That sole task owns:

- due-date notifications (startup, then every six hours);
- attachment upload expiry cleanup (startup, then every 15 minutes);
- idempotency-claim pruning (startup, then hourly); and
- Socket.IO's process-local rooms and broadcasts.

The historical-import lease heartbeat exists only while an approved import is
active; it is not a general recurring scheduler job.

Do not increase desired API count, deploy a parallel always-on scheduler, or
enable a second realtime task until both of these are implemented and
operationally certified:

1. durable cross-replica coordination/lease ownership for every recurring job;
2. a shared Socket.IO adapter and its backing service, with reconnect and
   failure behaviour tested.

The migration advisory lock serialises schema work; it is not scheduler
coordination and does not make Socket.IO broadcasts cross-process. Reserve RDS
connections for the API task, the one-shot migration task, and scheduled
database work.

## 5. Data, attachments, and email controls

### RDS PostgreSQL

Use a private managed RDS PostgreSQL deployment per environment. The database
secret belongs in Secrets Manager and is injected into only the task definitions
that need it. Enable encryption at rest and in transit according to the
organisation's database policy. Enable automated backups, point-in-time
recovery (PITR), deletion protection in production, and operational
storage-capacity monitoring. Treat backup retention, recovery objectives, and
restore authority as configuration decisions to approve before launch.

Do not run a Postgres container, persistent Docker volume, `drizzle push`,
`push-force`, schema reset, or migration-history edit in either AWS
environment.

### S3 attachments

Use one private S3 bucket per environment with Block Public Access enabled,
versioning enabled, encryption enabled, and an approved lifecycle/retention
policy. Define recovery retention before launch; do not use lifecycle expiry
to remove data without an approved records/recovery policy.

The application generates a short-lived signed `PutObject` URL for a temporary
private object under:

```text
<S3_PRIVATE_PREFIX>/uploads/<random-id>
```

It verifies authoritative object metadata, promotes a verified upload by
`CopyObject` to a server-controlled canonical key under:

```text
<S3_PRIVATE_PREFIX>/<namespace>/<id>
```

and deletes temporary or replaced objects. Downloads are obtained by the
backend with `GetObject` after parent authorisation; browsers do not receive
bucket credentials or raw permanent object authority. `S3_PUBLIC_PREFIX` is
only for application-managed optional public-prefix lookup and is not a reason
to relax bucket public access.

The normal application task role needs only the selected bucket and prefixes:

| Operation observed in the runtime | IAM action |
| --- | --- |
| Read/download and metadata validation | `s3:GetObject`, `s3:HeadObject` capability covered by object read permission |
| Direct-upload signing and server-owned writes | `s3:PutObject` |
| Promotion | `s3:GetObject`, `s3:PutObject` (copy source/destination) |
| Expiry/reconciliation/promotion cleanup | `s3:DeleteObject` |

Scope these actions to the environment bucket's
`<S3_PRIVATE_PREFIX>/*` and, only if enabled, `<S3_PUBLIC_PREFIX>/*`. The
application does not require broad bucket listing for normal attachment flows.
Keep an optional historical-import source role/credentials separate from the
normal task role: that feature reads from a configured legacy source bucket and
writes canonical bytes through the normal destination path. It must never
grant routine application access to arbitrary legacy buckets.

S3 object recovery is separate from database recovery. A database restore only
restores attachment metadata and canonical keys, not object bytes. Restore a
representative object version into the isolated staging bucket first, preserve
the canonical key, and verify parent-authorised download and reconciliation
before any production recovery action.

### Email

The supported active delivery providers are `smtp`, `resend`, and `sendgrid`.
With `EMAIL_ENABLED` other than `true`, the runtime is intentionally in stub
mode: it records/logs the attempted delivery and sends no email. When email is
enabled, startup fails if the chosen provider lacks its required variables.

| Provider | Required configuration when enabled |
| --- | --- |
| SMTP | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM_ADDRESS`; `SMTP_SECURE` as appropriate |
| Resend / SendGrid | `EMAIL_API_KEY`, `EMAIL_FROM_ADDRESS` |
| All providers | An approved sender/domain identity; `EMAIL_FROM_NAME` and optional `EMAIL_REPLY_TO` as operational configuration |

Production may enable delivery only after its sender/domain has been approved
and the administrator accepts the delivery and password-reset consequences.
Staging must start with `EMAIL_ENABLED=false`; if delivery testing is later
approved, use provider sandbox/test mode or a verified recipient allowlist
containing only named test identities. Do not point staging at production sender
credentials or send to imported/real staff populations.

## 6. Configuration and secret inventory

All values are injected at task start. Store sensitive values in Secrets
Manager; task-definition environment variables may contain non-secret
configuration. Names below are an inventory, not values.

| Name | Class | Used by | Environment rule |
| --- | --- | --- | --- |
| `NODE_ENV` | config | API/migration | `production` in both deployed environments. |
| `PORT` | config | API | `8080`; ALB forwards to this task port. |
| `STATIC_FILES_PATH` | config | API | `/app/public` in the image. |
| `DATABASE_URL` | secret | API and migration task | Separate RDS credential/endpoint per environment. |
| `SESSION_SECRET` | secret | API/realtime | Unique per environment; rotate through approved session-invalidation procedure. |
| `PUBLIC_APP_URL` | config | API, email links, CORS | Exactly one canonical HTTPS origin for the environment. |
| `RUN_MIGRATIONS_ON_STARTUP` | config | API | Always `false` in deployed API service. |
| `SCHEDULER_ENABLED` | config | API | `true` on the single application task; never enabled on migration tasks. |
| `STORAGE_PROVIDER` | config | API | `s3`. |
| `S3_BUCKET`, `S3_REGION` | config | API | Environment-specific private bucket/region. |
| `S3_ENDPOINT_URL` | config | API | Unset for standard AWS S3. |
| `S3_PRIVATE_PREFIX`, `S3_PUBLIC_PREFIX` | config | API | Approved prefix values; default `objects` and `public`. |
| `MAX_ATTACHMENT_SIZE_MB` | config | API | Approved upload size limit. |
| `EMAIL_ENABLED`, `EMAIL_PROVIDER` | config | API | Staging disabled by default; production per approval. |
| `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_REPLY_TO` | config | API | Environment-specific approved sender identity. |
| `EMAIL_API_KEY` | secret | API | Only for Resend or SendGrid. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE` | config | API | Only for SMTP. |
| `SMTP_USER`, `SMTP_PASS` | secret | API | Only for SMTP. |
| `AI_ENABLED` | config | API | Optional, explicitly enabled only when approved. |
| `AI_INTEGRATIONS_OPENAI_BASE_URL` | config | API | Optional AI integration endpoint. |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | secret | API | Optional AI integration credential. |
| `HISTORICAL_IMPORT_S3_BUCKET`, `HISTORICAL_IMPORT_S3_REGION`, `HISTORICAL_IMPORT_S3_ENDPOINT_URL` | config | API | Leave absent unless an approved historical import is occurring. |
| `HISTORICAL_IMPORT_S3_ACCESS_KEY_ID`, `HISTORICAL_IMPORT_S3_SECRET_ACCESS_KEY` | secret | API | Optional, restricted legacy-source access only; never substitute for the task role. |
| `LOG_LEVEL` | config | API | Set an approved production/staging verbosity. |
| `E2E_BASE_URL`, `E2E_USERNAME`, `E2E_PASSWORD` | staging-only secret/test config | certification runner, not ECS service | Isolated staff identity only; never provision or use as production runtime config. |
| `E2E_LIMITED_SCOPE_PASSWORD` | staging-only secret/test config | fixture command | Non-production only; fixture command refuses production. |

`BASE_PATH` is a build-time Vite setting. The AWS image builds the PWA at `/`;
do not inject a different base path at runtime. Replit object-storage variables,
GCS variables, local test variables, and AWS access-key environment variables
are not part of the selected AWS task contract. The standard AWS SDK credential
chain receives task-role credentials; never place general `AWS_ACCESS_KEY_ID` or
`AWS_SECRET_ACCESS_KEY` in an image, repository, task definition, or browser.

The following names exist only for local, alternate-provider, compatibility, or
test paths. They are not part of the selected AWS task contract and should not
be injected into the production service merely because they exist in source:

| Names | Disposition |
| --- | --- |
| `APP_BASE_URL`, `MAILER_ENABLED` | Legacy/compatibility aliases; use `PUBLIC_APP_URL` and `EMAIL_ENABLED` instead. |
| `AWS_REGION`, `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Do not use as application configuration; task-role credentials and `S3_REGION`/`S3_BUCKET` are the selected contract. |
| `GCS_PROJECT_ID`, `GCS_BUCKET_NAME`, `GCS_CLIENT_EMAIL`, `GCS_PRIVATE_KEY`, `GCS_PUBLIC_PREFIX`, `GCS_PRIVATE_PREFIX` | Alternate GCS provider only; not selected for AWS. |
| `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`, `REPLIT_DOMAINS` | Replit hosting/storage paths only; not an AWS task requirement. |
| `MIGRATION_TEST_DATABASE_URL` | Isolated migration-test runner only; never production runtime. |

## 7. Image promotion, migration, and release procedure

### Image identity and build

1. Build the existing root `Dockerfile`. It produces the API bundle and Vite
   PWA, then serves the PWA from `/app/public` in the final image.
2. Push the image to ECR with an immutable digest. A source revision label may
   be added for operator readability, but a mutable tag such as `latest` is not
   a release authority.
3. Record the tested image digest, source revision, build/provenance evidence,
   migration intent, and environment configuration revision in the deployment
   change record.

### Staging release

1. Confirm a current RDS backup/PITR window and no active incident.
2. Register a staging task definition that references the chosen immutable ECR
   digest and staging-only secrets/configuration.
3. Run a **standalone ECS Fargate migration task**, using the same image and
   staging `DATABASE_URL`, with:

   ```sh
   node --enable-source-maps /app/scripts/migrate.mjs
   ```

   The command runs the bundled tracked migrations, obtains the PostgreSQL
   advisory lock, validates recorded checksums, and exits non-zero on the first
   failure. It does not seed data or perform a declarative schema push.
4. Require task exit code zero and inspect the migration log before changing
   the service. On failure, stop: do not update the application service, retry
   blindly, edit `schema_migrations`, force a schema push, or deploy against a
   partially upgraded schema.
5. Update the staging ECS service to the same digest with desired count one,
   `RUN_MIGRATIONS_ON_STARTUP=false`, and `SCHEDULER_ENABLED=true`.
6. Require the ALB target to become healthy through `/api/readyz`, then verify:

   ```sh
   curl --fail --silent --show-error https://<staging-origin>/api/healthz
   curl --fail --silent --show-error https://<staging-origin>/api/readyz
   ```

7. Complete the applicable staging validation checklist below. A deployment
   that only reaches health endpoints is not a staging certification.

### Production promotion

1. Promote the **same tested immutable ECR image digest**; do not rebuild from
   the same source or substitute a mutable tag.
2. Confirm production change approval, recovery owner availability, backup/PITR
   posture, secrets/configuration review, and staging evidence.
3. Run the production one-shot migration task first with the exact command
   above and production-only database secret.
4. Require a successful migration exit code and log review before updating the
   production service. If it fails, stop the release and follow the failed
   migration incident procedure.
5. Update the production ECS service to the approved digest at desired count
   one. The application task verifies the entire tracked migration head before
   it listens.
6. Require healthy `/api/readyz`, then verify both health endpoints at the
   production origin. Perform the production smoke checklist.
7. Record the deployed digest, task-definition revision, migration task
   result/log pointer, start/end time, operator, and verification result.

Never make the application service responsible for applying production
migrations. Never run `push-force`, any force schema push, a migration-history
repair, or a database reset as a release shortcut.

### Rollback decision boundary

| Situation | Safe initial response |
| --- | --- |
| New image is unhealthy and no schema migration ran | Roll back the ECS service to the prior compatible image digest. |
| Migration succeeded and the new image is faulty | Roll back only to an application image known to be compatible with the now-applied additive migration history. |
| Migration failed before commit/complete | Keep the service on the prior healthy image; investigate from logs and database state under change control. |
| Migration/data change has damaged data | Escalate to the recovery owner. Choose a tested RDS PITR/restore plan; do not manipulate migration history or auto-reverse schema. |
| Attachment loss or mismatch | Preserve metadata and canonical keys; use the isolated S3 recovery procedure first. |

## 8. Observability, backup, recovery, and incidents

### Logs and alarms

Create separate CloudWatch log groups/streams for each environment and purpose:

- application service logs;
- migration task logs;
- ECS/ALB platform and deployment events; and
- optional certification-runner logs outside production service logs.

Use structured logs already emitted by the application. Retain only approved
fields: request logging removes query strings, and operators must not add
session cookies, authorisation headers, passwords, connection strings, signed
URLs, object paths, raw email content, or secret values to logs, alarms, ticket
comments, or dashboards.

Set minimum alert coverage for:

| Signal | Response trigger |
| --- | --- |
| ALB availability / target health and `/api/healthz` | Site or reachable task unavailable. |
| `/api/readyz` target health | Deployment cannot become ready or loses readiness. |
| ALB 5xx and application 5xx rate | Error budget/threshold breach. |
| ECS desired-versus-running count and task exits | Single application task stopped, repeatedly restarts, or cannot place. |
| Scheduler logs/outcomes | Due-date, attachment cleanup, or idempotency prune failure/absence. |
| Migration task exit/log error | Release blocking failure. |
| S3/IAM access-denied or storage-operation errors | Attachment path unavailable or role/policy regression. |
| RDS availability, connections, CPU, free storage, backup/PITR events | Database risk or depletion. |
| Backup/recovery status | Backup window/retention or restore evidence missing. |

Alarm ownership, acknowledgement deadlines, escalation contacts, retention, and
notification channels are infrastructure decisions to set during provisioning.

### Backup and restore expectations

- RDS automated backups and PITR are the primary database recovery mechanism.
  Production uses deletion protection. Set backup retention and recovery
  objectives explicitly before launch.
- A database snapshot/backup does not contain S3 attachment bytes. S3
  versioning, lifecycle/retention, and any replication policy are separate
  controls.
- Before declaring recovery ready, perform an isolated staging exercise:
  restore database data to an isolated target; validate application migration
  compatibility, readiness, login/RBAC, and selected records; restore a
  representative S3 object version to the staging bucket; verify it through the
  parent-authorised application route; and record the result. Do not use
  production as the first restore test.
- Recovery restores require an approved change, a named recovery owner, a
  defined write-freeze/communication plan, and post-recovery verification.

### Incident procedures

| Incident | Immediate operator action | Do not do |
| --- | --- | --- |
| Migration task fails | Stop the release, preserve logs/exit code, keep prior service image, assess whether any migration committed, escalate to database/release owner. | Retry blindly, edit migration history/checksums, force push schema, or start the new service. |
| App task is unhealthy | Inspect ALB/ECS/application logs and task events; verify secret/configuration revision and `/api/readyz`; roll back only when compatible. | Mask readiness failures with a health-only target check. |
| S3/IAM failure | Confirm environment bucket, task role, prefix policy, KMS/endpoint policy, and CloudWatch access-denied evidence; suspend destructive cleanup if object authority is uncertain. | Make the bucket public, add broad `s3:*`, or cross-wire staging/production buckets. |
| RDS unavailable or storage low | Declare incident, protect writes as needed, inspect RDS metrics/events and connection pressure, engage database owner; use approved PITR/restore decision if needed. | Expose RDS publicly, delete backup history, reset schema, or change connection limits blindly. |
| Release rollback question | Determine whether a migration completed and whether prior image supports the current schema; use the rollback boundary above and escalate data recovery. | Assume code rollback reverses database/data changes. |

## 9. Responsibilities and deployment access

| Party | Owns |
| --- | --- |
| Application | Image build contract, startup validation, schema-head verification, `/api/healthz`, `/api/readyz`, same-origin routing, scheduler lifecycle, application authorisation, and attachment parent checks. |
| AWS infrastructure owner | VPC/subnets/security groups, ECS/ECR/ALB/RDS/S3/ACM/Secrets Manager/CloudWatch configuration, IAM boundaries, backups/PITR, certificate/DNS integration, encryption, alarms, budgets, and audit logging. |
| Deployment operator | Change record, digest selection/promotion, migration task ordering, service update, health/readiness verification, release evidence, and rollback escalation. |
| Security/administration | IAM access approvals, MFA/audit review, secret rotation policy, sender/domain approval, staging recipient policy, recovery authorisation, and incident communications. |

The deployment operator receives scoped ability to register approved task
definition revisions, run the migration task, update the relevant service, and
read necessary health/log/deployment information. The operator does not receive
unrestricted secret read, RDS administration, S3 bulk delete, or production
IAM-policy administration by default.

## 10. Certification and launch checklists

All boxes intentionally remain unchecked until an isolated AWS staging
environment exists. A skipped or unconfigured test is not passing evidence.

### Pre-staging provisioning checklist

- [ ] Separate staging origin, ECS service/task role, RDS database/credentials,
  S3 bucket, Secrets Manager values, CloudWatch groups, backups, and test
  identities are designed and reviewed.
- [ ] ALB routes `/`, `/api`, and `/api/socket.io` to one task on 8080; port 80
  redirects to HTTPS and ACM covers the staging origin.
- [ ] ALB, ECS, and RDS security groups follow the narrow model in this runbook.
- [ ] Staging service desired count is one; migration task has no scheduler.
- [ ] `PUBLIC_APP_URL`, session secret, RDS secret, S3 bucket/region, and
  `RUN_MIGRATIONS_ON_STARTUP=false` have been reviewed without recording values.
- [ ] Staging email is disabled or an approved sandbox/allowlist policy exists.
- [ ] CloudWatch log separation, alarms, RDS backup/PITR, and S3 versioning/
  retention have been configured and their owners assigned.

### Staging validation checklist

- [ ] Immutable image digest, standalone migration task result, task logs, and
  migration checksum outcome recorded.
- [ ] `/api/healthz` and `/api/readyz` return success through the staging ALB.
- [ ] Authenticated same-origin login, secure cookie, CORS, and Socket.IO at
  `/api/socket.io` work with an isolated staff identity.
- [ ] Production-build PWA is installed/loaded from the routed staging origin;
  authenticated offline/reload and reconnect certification is run with
  `E2E_CERTIFY_PRODUCTION=true`, `E2E_BASE_URL`, `E2E_USERNAME`, and
  `E2E_PASSWORD`. All required outcomes are recorded.
- [ ] RBAC is exercised with isolated least-privilege and authorised identities.
- [ ] S3 upload, metadata verification, canonical promotion, parent-authorised
  download, expiry cleanup, and denied cross-scope access are exercised only
  against staging data. The limited-scope attachment fixture, if used, is
  enabled only with its explicit non-production prerequisite.
- [ ] Staging mail either remains stubbed or is proven only with the approved
  sandbox/allowlist; no real-user population receives staging email.
- [ ] Scheduler jobs emit expected lifecycle evidence once without duplicate
  ownership.
- [ ] Isolated RDS restore and representative S3-version recovery are rehearsed
  and recorded.

### Pre-production checklist

- [ ] Same immutable ECR digest passed the approved staging checks.
- [ ] Production origin, certificate, ALB routing/security groups, RDS,
  environment-specific S3 bucket, task role, secret values, logs, backups/PITR,
  deletion protection, S3 recovery controls, and alarms are reviewed.
- [ ] Production desired count is one; no Redis adapter or distributed scheduler
  configuration has been assumed.
- [ ] Production email sender/domain and delivery policy are approved, or email
  remains explicitly disabled with password-reset consequences accepted.
- [ ] Rollback-compatible prior image digest, recovery owner, incident contacts,
  and change window are recorded.
- [ ] Migration task procedure and schema/data rollback boundary are understood
  by the deployment and database owners.

### Production smoke checklist

- [ ] Production migration task completed successfully before service update.
- [ ] ALB target is healthy via `/api/readyz`.
- [ ] `/api/healthz` and `/api/readyz` succeed at the production origin.
- [ ] Landing/login load from the same production origin; no cross-origin API or
  legacy `/socket.io` route is used.
- [ ] A minimal approved authenticated smoke confirms session, authorised API,
  and Socket.IO connection without creating test fixtures or sending unapproved
  mail.
- [ ] CloudWatch logs, task count, ALB error metrics, scheduler startup, RDS
  metrics, and storage status are reviewed for the release window.

### Rollback, incident, and post-deployment checklist

- [ ] Any failed migration stopped the release and has a recorded escalation.
- [ ] Any rollback assessed application/schema compatibility before service
  change.
- [ ] Any data or attachment recovery used the approved isolated procedure,
  preserving migration history and canonical object keys.
- [ ] Deployed digest, task revision, migration evidence, health/readiness
  results, smoke result, alarms, and follow-up actions are recorded.
- [ ] Open certification gaps remain explicitly marked as gaps; no unrun AWS
  test is represented as passed.
