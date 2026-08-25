# CAFA PMIS repository handover

## Current authority

This file replaces the obsolete VPS/Hostinger handover record. It contains no
deployment commands, account counts, seeded credentials, or historical test
claims.

The single current GitHub-handoff verdict is recorded in
[the final GitHub handoff closure](docs/github-handoff-closure.md). The
repository transfer contents and exclusions are defined by
[the GitHub handoff manifest](docs/github-handoff-manifest.md).

## Deployment and recovery

CAFA PMIS is designed for the managed AWS topology documented in the
[AWS deployment and operations runbook](docs/aws-deployment-runbook.md):
one ECS Fargate task per environment behind an ALB, immutable ECR image
digests, private RDS PostgreSQL, private S3, task roles, Secrets Manager, ACM,
and CloudWatch.

The selected production storage contract is names-only and private:

```text
STORAGE_PROVIDER=s3
S3_BUCKET=YOUR_PRIVATE_PRODUCTION_BUCKET
S3_REGION=YOUR_AWS_REGION
```

Use task-role credentials and the full runbook for prefix, IAM, encryption,
promotion, and recovery rules. Do not add static access keys or a public bucket
URL to the repository or task definition.

Use these documents in this order:

1. [README](README.md) for clean local setup and quality gates.
2. [Deployment guide](DEPLOYMENT.md) for the concise AWS operator entry point.
3. [AWS deployment and operations runbook](docs/aws-deployment-runbook.md) for
   topology, migration-first release, same-origin Socket.IO routing, image
   promotion, and staging/production certification.
4. [Backup and recovery guide](BACKUP_RESTORE.md) for RDS/S3 recovery
   boundaries and incident decisions.

Docker Compose and Nginx files are retained for local or separately approved
VPS reference only. They must not be used as an AWS release procedure.

## Transfer safety

- Include only the tracked source listed in the handoff manifest.
- Never transfer populated environment files, keys, certificates, session
  cookies, database backups, local Replit state, browser results, AWS operator
  state, or task-planning attachments.
- Rotate historical deployment, database, session, storage, mail, AI, and test
  credentials before enabling a new authoritative remote. Do not record values
  in repository files or handoff notes.
- Staging certification remains a required, separate exercise; no source
  handoff claims it has occurred.