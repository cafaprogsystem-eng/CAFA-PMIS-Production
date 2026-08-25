# CAFA PMIS — Final Pre-Deployment System Audit

**Audit date:** 23 August 2026
**Repository baseline:** `main` at `a4b351a569bf85c5d1f591cb12cf99b035f3a4df`
**Scope:** Integrated release-readiness assessment before AWS deployment
**Evidence standard:** Current source, tracked tests, generated-contract checks, local routed smoke checks, production builds, and configuration rendering. No AWS service, staging route, production credentials, or production data was accessed.

> **Classification vocabulary:** **READY**, **FIX BEFORE DEPLOYMENT**,
> **AWS/STAGING VALIDATION ONLY**, and **NON-BLOCKING FOLLOW-UP**.

---

## 1. Executive Verdict

## FIXES REQUIRED BEFORE AWS DEPLOYMENT

The application has a strong tested baseline, but it is not yet safe to move to
AWS because four repository-evidenced release defects remain: insecure
production session/CORS/error defaults, high-severity runtime dependency
findings, contradictory storage deployment configuration, and an ambiguous,
unproven production migration path. These findings are application or release
configuration defects, not missing-AWS-environment findings.

All live AWS evidence (TLS and proxy behaviour, provider IAM, delivery,
backup/restore, and authenticated production-PWA browser certification) remains
separate and must occur after the blockers are corrected.

## 2. Repository Baseline

- **Branch:** `main...origin/main [ahead 651]`.
- **Commit:** `a4b351a569bf85c5d1f591cb12cf99b035f3a4df`
  (`2026-08-23T17:03:58Z`).
- **Working tree at audit start:** no tracked modifications; the supplied task
  brief was the sole untracked input under `attached_assets/`. `git diff --check`
  passed.
- **Workspace:** pnpm workspaces; React/Vite web app in
  `artifacts/cafa-pmis`, Express API in `artifacts/api-server`, PostgreSQL/Drizzle
  schema in `lib/db`, OpenAPI and generated clients in `lib/api-*`.
- **Production paths reviewed:** web/PWA → same-origin `/api` → Express →
  PostgreSQL; canonical attachments → `ObjectStorageService` → configured GCS
  or S3-compatible provider; optional email → configured provider; realtime →
  Socket.IO.
- **Release configuration:** `Dockerfile`, `docker-compose.yml`,
  `.env.production.example`, `DEPLOYMENT.md`, `BACKUP_RESTORE.md`, and the
  artifact production manifests.
- **PWA:** VitePWA build in `artifacts/cafa-pmis/vite.config.ts`; production
  shell and worker are generated during the web build.
- **CI:** `.github/workflows/api-contract.yml` runs frozen install, generated
  API drift guard, and workspace typecheck.

## 3. Release Gate Results

| Gate | Exact result | Classification / note |
| --- | --- | --- |
| Full API suite | **125 files, 2,906 tests passed** | READY |
| Full frontend suite | **133 files, 5,809 tests passed** | READY |
| Workspace typecheck | `pnpm run typecheck` passed for libraries, API, web, mockup, and scripts | READY |
| Frontend lint | `eslint src --max-warnings=0` passed | READY |
| API contract drift | Two generation passes and declaration comparison passed | READY |
| Production builds | Web build passed; PWA generated **90 precache entries**. API build passed. | READY; existing sourcemap-location and chunk-size warnings are non-blocking |
| Targeted security/RBAC/storage | API: **6 files, 61 tests passed** (attachment reconciliation/expiry/signing, report auth, attachment contract, communication IDOR, evidence access) | READY |
| Targeted locale/offline | Web: **3 files, 218 tests passed** (locale shell/glossary and offline suites selected by Vitest) | READY |
| Migration inventory | **53** tracked embedded migrations; duplicate names: **0** | Static integrity READY; no isolated fresh/upgrade DB proof |
| Offline browser inventory | **18 tests discovered** across desktop and mobile projects; **0 executed** | AWS/STAGING VALIDATION ONLY |
| Production offline preflight | Failed fast, as designed: `E2E_BASE_URL` and `E2E_USERNAME` absent | AWS/STAGING VALIDATION ONLY; not a test failure |
| Local routed health smoke | `/api/healthz` 200 with `no-store`; unauthenticated `/api/me` 401; web shell 200 | READY (local smoke only) |
| Desktop/mobile unauthenticated smoke | Login rendered at 1440×1000 and 390×844; sign-in, labels, reset link, and controls remained reachable | READY for unauthenticated smoke |
| Package audit | Metadata: **0 critical, 8 high, 6 moderate, 1 low** across 391 dependencies; 14 advisory records | FIX BEFORE DEPLOYMENT |
| Repository whitespace | `git diff --check` passed | READY |
| Fresh/upgrade migration | Not run: no isolated disposable PostgreSQL service was provisioned for this audit | FIX BEFORE DEPLOYMENT because the release procedure itself is contradictory; see section 8 |

## 4. Deployment Readiness Matrix

| Area | Status | Evidence | Deployment impact | Required action |
| --- | --- | --- | --- | --- |
| Authentication | FIX BEFORE DEPLOYMENT | `session.ts`, `app.ts`, `auth.ts` | HTTPS session and cross-origin boundary unsafe | Correct security defaults and add regression tests |
| Sessions | FIX BEFORE DEPLOYMENT | Cookies explicitly use `secure: false` | Session cookie may travel without Secure attribute | Set production Secure flag on set and clear |
| RBAC / IDOR | READY | Server guards plus 2,906 API tests | No current bypass evidenced | Exercise real role fixtures in staging |
| API contracts | READY | Two-pass Orval/declaration guard passed | Client/server contract stable | Keep guard mandatory in CI |
| API errors | FIX BEFORE DEPLOYMENT | Global error handler returns arbitrary `err.message` | Internal DB/provider messages can reach callers | Return generic production 5xx detail |
| Database | FIX BEFORE DEPLOYMENT | `DATABASE_URL` fails at import; no clean DB proof | Release schema path is not yet proven | Establish and test a single production migration authority |
| Migrations | CLOSED | Tracked, advisory-locked migration release command and API readiness verification | Single schema authority; production API does not mutate schema | Release job before API rollout |
| Canonical storage code | READY | Provider abstraction, signed upload binding, parent authority tests | Core lifecycle is implemented | Keep canonical path as the only normal-workflow authority |
| Storage deployment config | FIX BEFORE DEPLOYMENT | Compose hard-codes S3 while production example defaults to GCS; rendered S3 bucket is empty | Deploy can start with uploads disabled/wrong provider | Select one AWS path and make docs/env/compose agree |
| Attachments | READY | Parent-authorized proxy routes, reconciliation and cleanup tests | No source-level lifecycle bypass found | Validate real provider operations in staging |
| Offline drafts | READY | Account-scoped Dexie queue, idempotency and policy tests | Supported drafts/cached reads retained | Run authenticated production E2E later |
| Connectivity | READY | Same-origin two-failure health probe model and tests | Ordinary HTTP errors are not offline | Verify proxy path in staging |
| PWA / worker | AWS/STAGING VALIDATION ONLY | Build emits worker and 90 precache entries; 18 routed checks are gated | HTTPS offline reload cannot be certified locally | Run existing production-gated browser suite |
| Account isolation | READY | User-scoped IDs/cache keys and logout purge source/tests | No cross-account local-data path evidenced | Include multi-account browser evidence in staging |
| Arabic / RTL | READY | Locale integrity/RTL test coverage passed | Authenticated visual proof remains staging scope | Include Arabic route in staging smoke |
| Email | AWS/STAGING VALIDATION ONLY | Boot validates enabled-provider config; local mailer is stubbed | Actual mail delivery requires external provider | Verify sender, reset, invite, and verification delivery |
| Logging / audit | READY | Pino request serializer removes query strings; logger redacts secret headers; audit calls exist | Sink retention/access control is deployment-owned | Configure log sink and alerting in AWS |
| Health checks | READY | Public no-cache liveness endpoint returned 200 | Suitable for reachability and connectivity probe | Add AWS dependency/readiness monitoring as needed |
| Background jobs | FIX BEFORE DEPLOYMENT | Timers start per API process; no documented worker topology | Duplicate work risk if deployment scales | Define single-replica/worker policy before launch |
| Docker / runtime | FIX BEFORE DEPLOYMENT | Compose exposes API and bypasses DB health; provider variables conflict | Current production recipe is not authoritative | Publish a single AWS-safe runtime recipe |
| Build | READY | API + PWA builds pass | Artifacts generate reproducibly from lockfile | Pin base images as a non-blocking hardening follow-up |
| Tests | READY | 8,715 total unit tests pass | Strong local regression baseline | Preserve counts/checks in CI |
| Runtime dependency security | FIX BEFORE DEPLOYMENT | 8 high findings include direct file/email/runtime dependencies | Known vulnerable packages enter shipped graph | Upgrade and validate affected paths |
| Backup | AWS/STAGING VALIDATION ONLY | Backup/restore scripts exist; no offsite schedule/run proven | Operations cannot claim RPO/RTO yet | Configure encrypted, retained DB + object backups |
| Restore | AWS/STAGING VALIDATION ONLY | Restore script is destructive and guarded; no isolated restore run | Recovery is unproven | Run timed isolated restore and attachment inventory comparison |
| AWS configuration | FIX BEFORE DEPLOYMENT | Provider and migration topology are contradictory | No approved deployable runtime contract | Complete focused runtime/config remediation |
| Staging certification | AWS/STAGING VALIDATION ONLY | No routed HTTPS staging URL or isolated identities | Certification deliberately unavailable | Provision staging, then run certification |

## 5. Critical/High Open Findings

No known open **Critical** application defect was found.

The following **High** release findings are open and deduplicated:

1. **Production session and origin boundary fails open.** `session.ts` sets
   `secure: false`; `app.ts` permits every origin with credentials when
   `PUBLIC_APP_URL` is absent; unhandled exception text is returned to API
   callers. This is a concrete security defect.
2. **Known high-severity runtime dependency advisories.** `pnpm audit --prod`
   reports 8 high findings, including `xlsx`, `multer`, `nodemailer`, `ws`,
   `socket.io-parser`, `form-data`, and `ip-address` advisory paths.
3. **Production storage configuration is contradictory.** Compose forces
   `STORAGE_PROVIDER=s3` but supplies the obsolete AWS-named variables rather
   than the canonical configured S3 bucket; `.env.production.example` defaults
   to GCS. A rendered Compose configuration therefore has an empty canonical
   S3 bucket.
4. **Migration/runtime release authority is not proven or singular.** Runtime
   starts the embedded tracked runner, while documented manual deployment
   invokes a competing declarative schema push; a clean and upgrade sequence has not
   been exercised in an isolated database.

## 6. Authentication & Session Readiness

**Status: FIX BEFORE DEPLOYMENT.**

Positive evidence:

- Passwords use bcrypt, account status is checked, and login responses are
  generic for invalid credentials (`routes/auth.ts`).
- Invitations and reset/verification tokens are hashed, bounded, and
  atomically claimed or revoked.
- `SESSION_SECRET` causes startup failure in production when absent.
- Cookies are signed, `HttpOnly`, `SameSite=Lax`, scoped to `/`, and have
  8-hour/30-day durations.

Required correction:

- `lib/session.ts` explicitly uses `secure: false` for both creation and
  clearing. Under TLS it must use a production-aware Secure attribute.
- `app.ts` must reject production startup without an explicit public-origin
  allowlist rather than returning `true` to every CORS origin with
  `credentials: true`.
- The global 5xx response must not emit arbitrary exception text.

Smallest safe remediation: a focused security-configuration change with tests
for production cookie flags, missing-origin startup rejection, rejected foreign
origin, and redacted unhandled 500. It must not alter authentication roles or
workflow behavior.

## 7. RBAC & Scope Readiness

**Status: READY.**

All application routes are mounted after `attachCurrentUser` and `requireAuth`,
apart from intentional public authentication/health routes. Current-user
permissions fail closed for unknown roles, and representative state/sector,
project, report, risk, communication, and attachment guards have direct test
coverage. Authoritative identity and scope are server-derived.

Staging must still exercise super-admin, HQ, sector, and state test accounts
against a deployed proxy. This is execution evidence, not an open source
defect.

## 8. Database & Migration Readiness

**Status: FIX BEFORE DEPLOYMENT.**

The tracked runner has 53 unique names, runs before the API listens, and refuses
startup on migration failure. However, `scripts/migrate.mjs` and deployment
documentation instructed a competing schema push, while `index.ts` ran
`runMigrations()` against a separate `schema_migrations` history. Recent
embedded migrations also assume a baseline schema exists. No isolated database
was available to prove clean installation or forward upgrade.

Smallest safe remediation: designate one production migration authority,
document its exact invocation, serialize it before application replicas start,
and add a disposable clean-baseline plus representative-upgrade CI test. Do not
run destructive migration experiments against development data.

## 9. API Contract Readiness

**Status: READY.**

`pnpm run check:api-contract` regenerated the OpenAPI client and Zod artifacts
twice, rebuilt declarations, and found no generated-source drift. The API and
frontend typechecks also pass. Body parsing is capped at 1 MB and Zod validation
has a structured 400 response.

The production generic-error leak in section 6 is an error-boundary defect, not
generated contract drift.

## 10. Storage & Attachment Readiness

**Status: FIX BEFORE DEPLOYMENT for deployment configuration; READY for
canonical lifecycle implementation.**

`ObjectStorageService` supports Replit, GCS, and S3-compatible providers.
Production Replit storage fails closed. Canonical uploads use normalized
server-generated identities, bounded signed upload URLs, binding tokens, and
provider metadata checks. Retrieval is authorized from the owning parent, not
from object keys or browser-provided scope. Reconciliation inventories exact
owners and reports unavailable/missing objects safely; expiry cleanup uses
durable work, leases, retry, and deterministic identities.

The blocker is configuration: `docker-compose.yml` forces S3 but populates
`AWS_REGION`/`AWS_S3_BUCKET`, whereas the active canonical S3 implementation
reads `S3_REGION`/`S3_BUCKET`; the production example defaults to GCS. Choose
the AWS S3 path, pass its canonical variables or IAM role credentials, and make
the Compose/example/documentation contract identical before deployment.

## 11. Offline & Connectivity Readiness

**Status: READY for implementation; AWS/STAGING VALIDATION ONLY for
authenticated browser proof.**

The offline allow/block policy is explicit: approved cached reads and durable
draft work may proceed; submission, transitions, financial/admin changes,
attachments, AI, realtime, deletes, and unknown mutations require online
access. Queued mutations are account-scoped, durable, dependency-aware,
idempotent, and conflict-aware.

Connectivity has the required canonical states and confirms Offline only after
bounded same-origin `/api/healthz` transport failures. 401, 403, 422, 5xx,
cancellation, and socket disconnects do not become Offline automatically.

## 12. PWA Readiness

**Status: AWS/STAGING VALIDATION ONLY.**

The web build produces VitePWA registration, a versioned shell cache, an API
navigate-fallback denylist, and 90 precache entries. Development worker mode is
disabled. The production-gated routed Playwright configuration discovered 18
desktop/mobile checks, including offline reload and user-store assertions, but
correctly refused to run without an HTTPS routed `E2E_BASE_URL` and isolated
credentials. A Vite development session is not production PWA proof.

## 13. Arabic/RTL Readiness

**Status: READY.**

The locale integrity and shell tests selected for this audit passed. The login
smoke rendered cleanly at desktop and mobile sizes and retained explicit,
labelled fields and internal-access/no-registration copy. Authenticated
Arabic/RTL page navigation remains part of the existing staging browser suite;
it is not claimed as locally certified.

## 14. Email Readiness

**Status: AWS/STAGING VALIDATION ONLY.**

Startup calls `validateEmailConfig()` and refuses enabled email delivery when
provider credentials are incomplete. Password-reset, invite, verification, and
confirmation flows use generated links from public-origin configuration. Local
runtime is intentionally in stub mode and did not send email. Staging must
prove provider authentication, sender policy, deliverability, and link origin.

## 15. Logging & Monitoring Readiness

**Status: READY for application controls; AWS/STAGING VALIDATION ONLY for
operations.**

HTTP logs omit query strings, logger redaction covers authorization/cookie and
registration-token fields, and sensitive actions are audit logged. Error
diagnostics remain server-side once the section-6 generic-500 fix is applied.
AWS must provide centralized retention, restricted log access, error/worker
alerts, and an operator runbook.

## 16. Background Worker Readiness

**Status: FIX BEFORE DEPLOYMENT.**

Due-date checks, attachment-expiry sweeping, and idempotency pruning start in
or alongside the API process. Attachment cleanup has lease protection, but
there is no approved process topology or leader election for all schedulers,
and Socket.IO broadcasts are process-local. The AWS launch design must either
run one explicitly documented API/scheduler instance or introduce a separately
coordinated worker design before multiple replicas are allowed.

## 17. Security Readiness

**Status: FIX BEFORE DEPLOYMENT.**

Helmet, CSP, frame restrictions, `nosniff`, request-size limits, rate limits,
auth throttles, signed tokens, audit logs, and parent-authorized attachments
are present. The local health response showed these headers and no secrets.

`pnpm audit --prod --json` reported 0 critical, 8 high, 6 moderate, and 1 low
findings. High advisories include direct/runtime paths for spreadsheet parsing,
uploads, email, websockets/socket parsing, form data, and IP-address handling.
Upgrade only the affected packages to patched compatible releases, regenerate
the lockfile, and rerun API/file/email/realtime regression coverage; do not
perform a mass unrelated dependency upgrade.

## 18. Backup & Restore Requirements

**Status: AWS/STAGING VALIDATION ONLY.**

Repository scripts create a compressed PostgreSQL backup with basic listing
validation, retention folders, an explicit destructive restore confirmation,
and post-restore row-count reporting. They do not prove scheduled/offsite
backups, object-store preservation, retention, point-in-time recovery, or an
actual restoration.

AWS must back up PostgreSQL, canonical object storage, migration history and
deployment configuration through a secret-management procedure. Before go-live
certification, restore into an isolated environment and compare database rows
and canonical attachment/object inventory.

## 19. AWS Deployment Prerequisites

**Status: FIX BEFORE DEPLOYMENT for the configuration contract; AWS/STAGING
VALIDATION ONLY for service provisioning.**

AWS must supply:

- a version-pinned compute/container runtime and one approved API/worker
  topology;
- PostgreSQL/RDS with TLS, restricted network access, backup/PITR policy, and
  suitable connection limits;
- a private S3 bucket (or explicitly selected alternate provider), least-
  privilege IAM, bucket public-access block, encryption/versioning/lifecycle
  policy, and canonical `S3_*` values;
- HTTPS/DNS/reverse proxy or load balancer forwarding the same public origin to
  web and `/api`;
- distinct secret values for database, session, provider, email, and optional
  AI integration;
- SMTP/API email network access, logs, monitoring, alerting, and a safe health
  target.

No secret values are recorded here.

## 20. Production/Staging Separation Requirements

**Status: AWS/STAGING VALIDATION ONLY.**

Minimum separation is mandatory:

- independent databases and database credentials;
- independent buckets or non-overlapping enforced prefixes and IAM roles;
- independent domains/origins, session secrets, email sender/test accounts,
  logs, and backups;
- isolated controlled E2E identities and fixture provisioning only in staging;
- no production fault injection, test fixture creation, or storage cleanup
  experiments;
- deployment promotion only after staging migration, upload/download, email,
  role, offline-PWA, and restore evidence is recorded.

## 21. Task #800 Status

**AWS/STAGING VALIDATION ONLY — Awaiting AWS Staging**

Safe E2E identities, fixture provisioner, and secret handling can only be
certified against a routed isolated HTTPS staging environment. Missing staging
infrastructure is not an application defect.

## 22. Task #802 Status

**AWS/STAGING VALIDATION ONLY — Awaiting AWS Staging**

Authenticated offline browser certification requires a production-like PWA,
same-origin `/api`, valid HTTPS, and isolated credentials. The suite's
preflight correctly blocks rather than falsely passing without these inputs.

## 23. Pre-Deployment Blockers

| ID | Exact evidence and impact | Smallest safe remediation | Required regression coverage |
| --- | --- | --- | --- |
| B1 | `artifacts/api-server/src/lib/session.ts` sets `secure: false`; `app.ts` accepts all origins with credentials when `PUBLIC_APP_URL` is absent; its global handler returns arbitrary error messages. Session confidentiality and internal details are at risk. | Make cookie security production-aware, fail production startup without an origin allowlist, and redact unexpected 5xx detail. | Cookie set/clear headers, startup/origin rejection, foreign-origin CORS rejection, and generic-500 contract tests |
| B2 | **CLOSED (2026-08-23):** `pnpm audit --prod --json` reports 0 Critical / 0 High / 2 Moderate / 1 Low after minimal compatible package remediation. Full inventory and validation evidence: `docs/production-dependency-remediation.md`. | No further B2 remediation required. | Focused workbook, mailer, upload/cleanup, and websocket coverage; full API/frontend suites, typechecks, lint, builds, contract guard, frozen install, and health smoke |
| B3 | `docker-compose.yml` hard-codes `STORAGE_PROVIDER=s3` but sends obsolete `AWS_*` names; `.env.production.example` selects GCS. Rendered config has an empty canonical S3 bucket. | Publish one AWS storage configuration contract using canonical `S3_*` names and IAM/secret ownership. | Rendered-compose/config test plus staging authorized PUT, promote, download, unavailable-object, cleanup, and delete tests |
| B4 | **CLOSED (2026-08-23):** The built one-shot tracked migration command holds a PostgreSQL advisory lock, records checksums only after successful transactions, and is required before API rollout. API instances verify the exact migration head before listening; health and readiness are separate. Scheduler ownership is explicitly configured for one replica and all recurring work is stoppable. | Multi-replica scaling remains deliberately out of scope until scheduler coordination and a shared Socket.IO adapter are introduced. | Migration manifest/lock/rollback/no-op tests, scheduler lifecycle coverage, attachment cleanup and realtime-origin regressions, build/typecheck evidence. |

## 24. Non-Blocking Follow-Ups

- Pin Docker base-image digests and establish an image/CVE scan in CI after
  blocker remediation.
- Add deeper database readiness (not just liveness) and controlled graceful
  shutdown metrics once the approved AWS topology is selected.
- Add operational dashboards/alerts for attachment cleanup leases and provider
  reconciliation outcomes.
- Consider reducing the production initial JavaScript chunk; the build succeeds,
  but Vite reports a large initial chunk.

## 25. Files Changed During Audit

- `docs/final-go-live-audit.md` — replaced stale, contradicted historical
  conclusions with this evidence-backed final pre-deployment report.

No application behavior, schema, dependency, credential, or deployment
configuration was changed by this audit.

## 26. Tests Added/Updated

None. This was an audit-only task. Existing regression suites and the
repository's contract/build gates were executed; the blocker remediations above
must add their own focused regression tests.

## 27. AWS-Only Validation Items

After blockers are resolved and staging exists:

1. Provision isolated HTTPS staging with same-origin web and `/api`.
2. Run all 18 production-gated offline/attachment Playwright tests with
   controlled limited-scope and normal staff accounts.
3. Verify Secure cookie, explicit CORS allowlist, CSP/HSTS/proxy headers, IP
   forwarding, and load-balancer health behavior.
4. Validate the chosen bucket/IAM policy: head bucket, upload, promotion,
   parent-authorized download, unavailable-object response, cleanup lease, and
   deletion.
5. Run fresh and representative-upgrade migrations only against disposable
   staging databases, then verify a safe release rollout.
6. Deliver invitation, reset, verification, and confirmation emails from the
   approved domain.
7. Prove encrypted database/object backups and an isolated timed restore with
   attachment inventory comparison.
8. Record role/scope, Arabic/RTL, desktop/mobile, and error-path browser smoke
   evidence.

## 28. Recommended Next Task

**Protect production sessions and API errors from exposure**

This is the smallest focused remediation because it resolves the direct
session-cookie, CORS fail-open, and error-detail release blocker without
changing business workflows. It should complete before storage/migration
deployment architecture work begins.

## 29. Final Statement

**CAFA PMIS REQUIRES PRE-DEPLOYMENT FIXES BEFORE AWS DEPLOYMENT.**

Full production/staging certification will occur after AWS environments are
available. The current result does not treat the missing staging environment as
an application defect.