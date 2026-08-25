# CAFA PMIS final GitHub handoff closure

**Evidence date:** 24 August 2026
**Scope:** current tracked source and local command evidence only
**Single GitHub-handoff verdict:** **READY FOR GITHUB HANDOFF**

This verdict means the repository can be transferred as source with its
documented local gates and safety boundaries. It is **not** an AWS staging or
production certification, deployment approval, or statement that an AWS
environment exists.

## Evidence basis

The following evidence was established from the current repository rather than
earlier project claims:

| Area | Current evidence |
| --- | --- |
| Frozen dependency graph | Root `package.json` pins `pnpm@10.26.1`; `pnpm-lock.yaml` is tracked; a no-environment-file temporary clone completed `pnpm install --frozen-lockfile`. |
| Canonical migrations | `run-migrations.ts` maintains ordered migration name/checksum identity, a PostgreSQL advisory lock, schema-head verification, and migration `055_revocable_authenticated_sessions`; runtime-authority and real-PostgreSQL bootstrap/no-op tests are present. |
| Authentication | `auth_sessions` holds hashed opaque tokens; HTTP and Socket.IO resolve an active unrevoked session; numeric legacy user-ID cookies are rejected; logout/revocation tests cover the authority boundary. |
| Origin/realtime policy | Shared security configuration validates exact `PUBLIC_APP_URL` origins and production fails closed; realtime CORS tests cover polling, WebSocket upgrades, and rejected foreign origins. |
| Demo and fixtures | The role harness requires explicit non-production mode; seed and fixture provisioners reject production. |
| Storage | Production validates the explicitly selected provider and rejects incomplete Replit/S3 configuration; the selected AWS contract is private S3, canonical promotion, and parent-authorised download. |
| User-facing safeguards | Source/tests cover the 18-state registry, i18n namespace parity/fallbacks, offline/PWA data boundaries, Manual lifecycle safeguards, Calendar/raw-key/global-search localization, eight sidebar baselines, and four approved landing captures with provenance. |
| Package/infrastructure | The root Dockerfile builds the API and PWA, has a production health check, and starts the bundled API. Staging CloudFormation, preflight, migration-first deployment script, same-origin `/api/socket.io` route, and one-replica scheduler topology are tracked. |

## Handoff inventory and boundaries

| Boundary | Handoff status |
| --- | --- |
| Frontend, API, shared contracts, database migrations, PWA, E2E/visual checks, Docker, IaC, scripts, and documentation | Tracked source; include as described by the [handoff manifest](github-handoff-manifest.md). |
| Committed API declarations, sidebar baselines, landing assets, and provenance | Required release evidence; include. |
| Local Replit state, caches, environment files, logs, browser output, fixture descriptors, backups, AWS operator state, and task attachments | Excluded by ignore rules and handoff manifest; do not transfer as release source. |
| Planning/archive boundary | 651 tracked `Pasted-*.txt` planning inputs, one hidden editor remnant, and an unreferenced historical release ZIP were removed. `.gitignore`, `.dockerignore`, and `release:readiness` now prevent their return. |

## Configuration contract

The [AWS runbook](aws-deployment-runbook.md#6-configuration-and-secret-inventory)
is the definitive names-only configuration inventory. Its categories are:

| Class | Names/rules |
| --- | --- |
| Production/staging secret | `DATABASE_URL`, `SESSION_SECRET`, `EMAIL_API_KEY` or `SMTP_PASS` when mail is enabled, optional AI key, and approved historical-import credentials only when an approved import runs. |
| Production/staging non-secret | `NODE_ENV`, `PORT`, `STATIC_FILES_PATH`, `PUBLIC_APP_URL`, migration/scheduler flags, S3 identifiers/prefixes, mail provider/sender settings, and logging settings. |
| Development-only | Local database and explicitly selected local storage values in `.env.example`; development may use a local emulator but never copies a production secret. |
| E2E/staging-only | `E2E_BASE_URL`, isolated test identity credentials, fixture flags, and visual/landing fixture acknowledgements. They are never ECS production runtime configuration. |
| Optional | Mail and AI configuration only when approved and explicitly enabled; alternate GCS/historical import compatibility paths remain unselected for AWS. |

Production fails before it listens when the session secret, validated public
origin, or selected storage provider contract is absent or malformed. The local
template no longer teaches Replit production hosting, legacy email aliases, or
credential-shaped sample values.

## Local validation matrix

Run from a clean checkout with no copied secret environment file:

| Gate | Command | Evidence status |
| --- | --- | --- |
| Frozen install | `pnpm install --frozen-lockfile` | Pass |
| Handoff static preflight | `pnpm run release:readiness` | Pass in a clean temporary Git checkout made from the final candidate; it deliberately fails a dirty/untracked transfer tree. |
| API contract drift | `pnpm run check:api-contract` | Pass |
| Typecheck | `pnpm run typecheck` | Pass |
| Web lint | `pnpm --filter @workspace/cafa-pmis run lint` | Pass, zero warnings |
| API suite | `pnpm --filter @workspace/api-server test` | Pass: 135 files / 2,985 tests; 1 file / 1 test intentionally skipped; 0 failures |
| PWA suite | `pnpm --filter @workspace/cafa-pmis test` | Pass: 138 files / 5,842 tests; 0 skipped; 0 failures |
| Production builds | API and PWA build commands in [README](../README.md#local-quality-gates) | Pass |
| Dependency audit | `pnpm audit --prod --audit-level=high` | Pass at the release threshold; 1 low and 2 moderate findings remain visible for follow-up. |
| Fresh migration bootstrap/no-op | production container start/restart against disposable PostgreSQL | Pass: first start applied tracked migrations through `055_revocable_authenticated_sessions`; restart acquired migration authority and started without reapplying them. |

The CI workflow applies frozen install, API contract, typecheck, lint, API/PWA
tests, production builds, dependency audit, and a disposable-PostgreSQL
migration bootstrap check. The Vitest configurations cap worker fan-out at four
and use bounded 30-second test/hook limits so rendered suites stay reproducible
on shared runners without masking failures. Browser suites are intentionally
absent from repository CI until a safe isolated routed fixture and secrets are
provided; they must never be made green by skips.

## Findings register

| Classification | Finding and disposition |
| --- | --- |
| **Fix Before GitHub Handoff** | **Resolved:** root onboarding/quality-gate guidance was missing; `README.md`, a static preflight, handoff manifest, and this report now provide it. |
| **Fix Before GitHub Handoff** | **Resolved:** `HANDOVER.md` previously claimed a Hostinger/VPS release and historical test/data outcomes. It now delegates to current AWS and handoff authority. |
| **Fix Before GitHub Handoff** | **Resolved:** `.env.example` previously taught Replit and legacy aliases. It now contains only safe local, current names. |
| **Fix Before GitHub Handoff** | **Resolved:** tracked pasted task briefs and an unreferenced historical release archive contradicted the intended handoff boundary; they were removed and are now blocked from Git, Docker, and the local preflight. One removed planning input contained a private-key header; rotate the associated historical credential before any remote is enabled. |
| **Fix Before GitHub Handoff** | **Resolved:** default uncapped test-worker contention produced unrelated suite timeouts on shared runners. Both suites now have a bounded four-worker, 30-second runner policy; full API and PWA suites pass under it. |
| **Fix Before GitHub Handoff** | **Resolved:** public PWA/manual copy that still referred to 15 states now uses the canonical 18-state registry. |
| **GitHub Handoff Execution** | Create the remote, commit the intended tracked set, keep `main` protected, require the listed CI checks/review/linear history, and use a restricted GitHub Actions OIDC role for AWS. Rotate any historical deployment, database, session, storage, mail, AI, and test credentials before enabling remote use—without recording values here. |
| **AWS/Staging Validation Only** | No AWS resource, DNS, certificate, IAM role, ECR image, container, RDS, S3 object, SMTP service, or production environment was accessed. Complete the register below against isolated staging. |
| **Editorial Follow-Up** | Historical implementation reports are clearly non-authoritative where retained. The AWS runbook, not old VPS/Hostinger reports, governs release/recovery decisions. |
| **Non-Blocking Follow-Up** | PWA feature implementation and static guard tests exist; final authenticated browser/device evidence belongs to staging rather than a local source handoff. |

No unresolved **Fix Before GitHub Handoff** finding remains.

## AWS/Staging certification register

All entries below are deliberately **deferred**, not failed or passed:

| Certification item | Required evidence |
| --- | --- |
| CloudFormation and environment isolation | Approved account/region/hostname/certificate, static validation, provisioning result, separate resources and secrets. |
| Immutable image and migration-first release | ECR digest, source provenance, standalone migration task exit/log/checksum evidence before service update. |
| ALB/TLS/same-origin routing | HTTPS origin, `/`, `/api`, `/api/socket.io`, health/readiness, polling, and WebSocket upgrade through the ALB. |
| Secure authentication | Isolated login, secure cookie, revoked logout, protected HTTP, CORS, and Socket.IO session behaviour. |
| PWA/offline/browser | Routed production build, installed service worker, authenticated offline/reconnect/account isolation, Arabic/RTL and Calendar/global search user flows. |
| Attachment storage | Task-role S3 upload, metadata verification, canonical promotion, parent-authorised download, denied cross-scope access, cleanup, and recovery. |
| Email/scheduler | Stub or sandbox/allowlist mail; one scheduler owner with expected lifecycle evidence and no duplicate work. |
| Recovery | Isolated RDS restore/PITR and representative S3 version restore with post-recovery application authorisation checks. |
| Visual release evidence | Safe non-production sidebar and landing recapture comparison with all eight/four approved artefacts reviewed. |

## Limitations

- Docker is not assumed available on every source-review runner; a successful
  local container build/startup must be recorded separately where Docker is
  supported.
- A final Docker rebuild retry reached frozen install but was blocked by
  `registry.npmjs.org` DNS resolution (`EAI_AGAIN`) after an earlier
  build/startup check had passed. This is a runner-network limitation, not a
  source or lockfile failure; repeat the container check in CI/staging.
- A local/Replit preview cannot certify deployed PWA reload/offline behaviour,
  TLS, ALB routing, task IAM, S3, mail, or recovery.
- No authenticated browser result is fabricated. Missing credentials or an
  isolated routed fixture is a staging prerequisite, not a passing test.

## Changes made for this closure

- Added safe root setup, local quality-gate, configuration, governance, and
  staging-boundary guidance.
- Added a deterministic no-AWS handoff preflight and GitHub handoff manifest.
- Removed non-release task-planning attachments and a historical release archive
  from the tracked handoff set; added Git/Docker/preflight enforcement.
- Replaced obsolete Hostinger/VPS handoff instructions and current-authority
  claims; corrected the local configuration template and Replit project notes.
- Marked the historical PWA implementation audit as non-certification evidence.
- Expanded repository CI quality gates and made the test-runner resource policy
  reproducible on shared runners.
- Corrected stale user-facing state-count metadata from 15 to the canonical 18.

**Business-logic changes:** none. This closure changes documentation, handoff
preflight, CI/test-runner coverage, and stale user-facing metadata only.