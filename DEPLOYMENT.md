# CAFA PMIS deployment guide

## Authority and scope

The authoritative staging and production deployment design and release procedure
is [the AWS deployment and operations runbook](docs/aws-deployment-runbook.md).
It defines the selected initial topology: one ECS Fargate task behind an ALB,
immutable ECR images, a private managed RDS PostgreSQL database, a private S3
attachment bucket, task IAM roles, Secrets Manager, ACM, and CloudWatch.

This document is the operator entry point. The staging-only CloudFormation
definition and migration-gated operator script live in
[`infra/aws-staging/`](infra/aws-staging/). They do not create a domain or
certificate, send email, or claim that an AWS deployment/certification has
passed. Missing AWS authorization or approved staging inputs fail closed.

## Release summary

1. Build the root `Dockerfile` and push an immutable ECR image digest.
2. Deploy that digest to isolated **staging** with its own origin, ECS service,
   task role, RDS database/credentials, S3 bucket, session secret, logs,
   backups, email policy, and E2E identities.
3. Run the canonical standalone migration task before the service update:

   ```sh
   node --enable-source-maps /app/scripts/migrate.mjs
   ```

   It uses tracked migrations and the database advisory lock. It is not a
   declarative schema push and does not seed data.
4. Require a successful migration task, then update the one-replica ECS service
   with `RUN_MIGRATIONS_ON_STARTUP=false` and `SCHEDULER_ENABLED=true`.
5. Require ALB readiness through `/api/readyz` and verify both:

   ```sh
   curl --fail --silent --show-error https://<environment-origin>/api/healthz
   curl --fail --silent --show-error https://<environment-origin>/api/readyz
   ```

6. Complete the staging checklist before promoting the **same tested digest** to
   production. Do not rebuild from the same source, substitute a mutable tag,
   or run a production service before its migration task succeeds.

The site, API, and Socket.IO use one HTTPS origin. Route `/`, `/api`, and
`/api/socket.io` through the same ALB target and sole application process.
Never configure the obsolete `/socket.io` path.

## Production runtime requirements

| Requirement | Value or rule |
| --- | --- |
| API replicas | Exactly one per environment initially. |
| Scheduler | The sole API task owns recurring work; `SCHEDULER_ENABLED=true`. |
| Schema change authority | One-shot migration task only; application service uses `RUN_MIGRATIONS_ON_STARTUP=false`. |
| Realtime | Socket.IO rooms/broadcasts are process-local; do not scale until a shared adapter and scheduler coordination are implemented and certified. |
| Health | `/api/healthz` is a public lightweight connectivity probe; `/api/readyz` is the deployment/ALB readiness signal. |
| Storage | `STORAGE_PROVIDER=s3`; private per-environment bucket and task IAM role; no static general AWS keys. |
| Public origin | `PUBLIC_APP_URL` is the exact HTTPS origin for its environment, with no path or wildcard. |
| Email | Staging is disabled by default or constrained to an approved sandbox/allowlist. |

## Environment and secrets

Start from [`.env.production.example`](.env.production.example) for names and
documentation only. Store sensitive values in AWS Secrets Manager, not a
checked-in `.env`, image layer, task definition plaintext, browser code, shell
history, or incident log. The complete name-only configuration inventory and
environment isolation matrix are in the AWS runbook.

Required production/staging task values include `DATABASE_URL`,
`SESSION_SECRET`, `PUBLIC_APP_URL`, `STORAGE_PROVIDER`, `S3_BUCKET`,
`S3_REGION`, `RUN_MIGRATIONS_ON_STARTUP`, and `SCHEDULER_ENABLED`. The runtime
refuses production startup for a missing session secret, malformed public
origin, or incomplete selected storage/email configuration.

## Recovery and rollback

Use [the backup and recovery guide](BACKUP_RESTORE.md) with the AWS runbook.
RDS automated backups/PITR and S3 versioning/lifecycle are managed-service
controls; a database restore does not restore attachment bytes.

Do not use `drizzle push`, `push-force`, a database reset, migration-history
edits, or force schema changes in staging or production. Roll back application
code only after assessing compatibility with the already-applied migration
history. Escalate data and attachment recovery to the authorised recovery owner.

## Retained local/VPS Docker Compose reference

`docker-compose.yml` and `nginx/nginx.conf` are retained for local or
explicitly approved VPS use. They are **not** the AWS release path:

- Compose creates a local PostgreSQL container and named volume; AWS uses
  private RDS instead.
- The Compose `migrate` service demonstrates migration-first ordering; AWS uses
  a standalone ECS migration task with the same image and canonical command.
- The Nginx example is a VPS reverse-proxy reference; AWS uses ALB/ACM for
  HTTPS and forwards `/api/socket.io/` to the application task.
- A VPS operator remains responsible for host patching, Docker, TLS renewal,
  database backup, and secure access. Those responsibilities are intentionally
  avoided by the initial Fargate design.

Never infer a production deployment procedure from an old VPS report. For AWS
network, IAM, release, alarm, recovery, and certification decisions, follow the
AWS runbook.
