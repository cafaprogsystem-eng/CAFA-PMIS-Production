# CAFA PMIS

CAFA PMIS is a web-based programme-management information system for CAFA
Development Organization. It manages projects, plans, reports, risks, budgets,
attachments, approvals, audit history, and the canonical 18-state Sudan
registry.

## Repository authority

This repository is the source handoff for application code and release
documentation. The authoritative deployment and recovery procedures are:

- [AWS deployment and operations runbook](docs/aws-deployment-runbook.md)
- [Deployment guide](DEPLOYMENT.md)
- [Backup and recovery guide](BACKUP_RESTORE.md)
- [GitHub handoff closure](docs/github-handoff-closure.md)
- [GitHub handoff manifest](docs/github-handoff-manifest.md)

The AWS documents describe an approved target architecture; they do **not**
claim that staging or production has been provisioned or certified.

## Prerequisites

- Node.js 24
- pnpm 10.26.1 (pinned in `package.json`)
- PostgreSQL 16 or a compatible local PostgreSQL instance for API/database work
- Docker, only when validating the container package locally

No Replit runtime, workspace path, globally installed package, or copied
production environment file is required for a clean local checkout.

## Repository map

| Area | Location |
| --- | --- |
| React PWA | `artifacts/cafa-pmis/` |
| Express API and API tests | `artifacts/api-server/` |
| Database schema and shared libraries | `lib/` |
| Canonical migration runner | `artifacts/api-server/src/lib/run-migrations.ts` |
| API contract source and generated outputs | `lib/api-spec/`, `lib/api-client-react/`, `lib/api-zod/` |
| Local release checks and operational scripts | `scripts/` |
| Staging CloudFormation and guarded operator script | `infra/aws-staging/` |
| Deployment, recovery, and handoff documentation | `docs/`, root Markdown files |

## Safe local setup

1. Clone the repository and create a local-only environment file:

   ```sh
   cp .env.example .env.local
   ```

2. Replace only the placeholders required for the work you are doing. Do not
   copy a staging or production `.env` file into the checkout. The local
   template is deliberately name-only and uses an explicitly selected
   S3-compatible development storage contract.

3. Install exactly the tracked dependency graph:

   ```sh
   pnpm install --frozen-lockfile
   ```

4. For a local database, configure `DATABASE_URL`, then run tracked migrations:

   ```sh
   pnpm --filter @workspace/api-server run migrate
   ```

   `drizzle push`, `push-force`, database reset, and migration-history edits are
   local development utilities only. They are never an AWS release procedure.

5. Start the API and PWA in separate terminals:

   ```sh
   pnpm --filter @workspace/api-server run dev
   pnpm --filter @workspace/cafa-pmis run dev
   ```

## Local quality gates

Run these from the repository root after a frozen install:

```sh
pnpm run release:readiness
pnpm run check:api-contract
pnpm run typecheck
pnpm --filter @workspace/cafa-pmis run lint
pnpm --filter @workspace/api-server test
pnpm --filter @workspace/cafa-pmis test
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/cafa-pmis run build
pnpm audit --prod --audit-level=high
```

`release:readiness` is a no-AWS static handoff preflight. It reports pass/fail
for the tracked source boundaries and prints the checks that are intentionally
deferred to isolated AWS staging. It does not claim to replace the commands
above.

For an ordered real-PostgreSQL migration bootstrap/no-op rerun, run the focused
test with a disposable database:

```sh
MIGRATION_TEST_DATABASE_URL=postgresql://<user>:<password>@<host>:<port>/<database> \
  pnpm --filter @workspace/api-server exec vitest run src/lib/migration-real-postgres.test.ts
```

Browser-based offline, sidebar, and landing-capture checks are fail-closed and
require an isolated non-production routed environment and test identities. See
[the E2E guide](artifacts/cafa-pmis/e2e/README.md). A skipped browser run is not
certification evidence.

## Configuration and secrets

`.env.example` is for local development only. `.env.production.example` lists
the AWS task-variable names without real values. The complete environment
classification—including production/staging, development, E2E-only, optional,
secret, and non-secret names—is maintained in the
[AWS runbook configuration inventory](docs/aws-deployment-runbook.md#6-configuration-and-secret-inventory).

Never commit or paste credentials, private keys, certificates, cookies,
connection strings with passwords, signed URLs, or populated environment files.
Use environment-specific secret storage. AWS workloads use task roles and
Secrets Manager; general static AWS access keys are not part of the application
contract.

## GitHub handoff and release governance

Before GitHub handoff, use the
[handoff manifest](docs/github-handoff-manifest.md) to include tracked source,
generated API declarations, migrations, approved visual baselines, landing
captures/provenance, templates, and documentation—and to exclude local,
Replit-specific, secret, cache, test-output, backup, and operator-state files.

The receiving repository should protect `main`: require pull requests, current
CI checks, review approval, and a linear history; restrict direct pushes and
force pushes. GitHub Actions should use a short-lived AWS OIDC role with
environment protections rather than stored AWS keys. Releases build once,
record the source revision and immutable ECR digest, certify that exact digest
in staging, then promote the **same digest** to production. See the
[AWS runbook release procedure](docs/aws-deployment-runbook.md#7-image-promotion-migration-and-release-procedure).

Historical environments and repositories may have contained credentials or
seeded account passwords. Treat that possibility as a rotation requirement:
rotate all deployment, database, session, storage, email, AI, and test
credentials before enabling an authoritative remote; do not record their values
in this repository or handoff notes.

## Staging boundary

Local checks establish source readiness only. AWS staging must still provide
real evidence for DNS/TLS/ALB routing, task-role S3 access, mail sandboxing,
secure-cookie/Socket.IO behaviour, production-build PWA/browser flows, isolated
fixture controls, scheduler ownership, migration execution, and RDS/S3 recovery.
The open certification register is in
[the handoff closure report](docs/github-handoff-closure.md#awsstaging-certification-register).