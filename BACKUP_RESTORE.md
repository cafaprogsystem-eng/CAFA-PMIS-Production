# CAFA PMIS backup and recovery guide

## Authority

This guide is the recovery entry point for the selected AWS deployment model.
Read it with [the AWS deployment and operations runbook](docs/aws-deployment-runbook.md).
It describes required controls and response decisions; it does not create,
restore, or certify any AWS resource.

## Recovery model

| Asset | Primary recovery control | Important boundary |
| --- | --- | --- |
| PostgreSQL data | Environment-specific RDS automated backups and point-in-time recovery (PITR) | A restore is a controlled database operation, not an application deployment or schema reset. |
| Attachments | Environment-specific private S3 bucket with versioning and approved lifecycle/retention | Database backups contain metadata and canonical object keys, not attachment bytes. |
| Application | Previously tested immutable ECR image digest | A code rollback does not undo a completed migration or restore data. |
| Runtime secrets | AWS Secrets Manager and approved rotation/recovery process | Never recover secrets from repository, images, logs, shell history, or copied `.env` files. |

Production requires RDS deletion protection, automated backups/PITR, named
recovery ownership, and private S3 versioning before launch. Define recovery
point/recovery-time objectives, backup retention, S3 retention/lifecycle, and
approval channels during infrastructure provisioning rather than relying on
legacy VPS cron assumptions.

## Isolated restore certification

Before declaring recovery ready, an authorised operator must perform and record
an isolated **staging** exercise:

1. Create an isolated restore target according to approved AWS procedures; do
   not use production as the first test.
2. Restore a selected RDS backup/PITR point and apply only the approved
   application/release compatibility procedure.
3. Verify service startup, `/api/readyz`, controlled login/RBAC, and selected
   record integrity without treating a row count alone as proof.
4. Restore a representative S3 object version into the isolated staging bucket,
   retaining the canonical object key.
5. Verify its metadata and parent-authorised application download; confirm any
   reconciliation/cleanup outcome.
6. Record the recovery point, elapsed time, outcome, gaps, and authorised
   operator. An unrun or skipped exercise is not certification evidence.

If an attachment cannot be recovered, retain its metadata and canonical identity
and use the application reconciliation process. Do not invent a replacement
object key merely to make a database row appear healthy.

## Incident decision procedure

### Database unavailable, corrupt, or storage exhausted

1. Declare the incident and protect writes when directed by the recovery owner.
2. Inspect RDS availability, storage, connection, backup/PITR, and CloudWatch
   evidence; preserve relevant application and migration logs.
3. Determine whether an operational fix, PITR, snapshot restore, or a new
   isolated restore target is required under approved change control.
4. Verify application/schema compatibility before changing an ECS service.
5. After recovery, require `/api/readyz`, controlled functional verification,
   and review of attachment consistency before resuming normal operations.

Never expose RDS publicly, delete backup history, reset the schema, or edit
`schema_migrations` as an incident shortcut.

### Attachment/S3 failure

1. Confirm the active environment bucket, task role, prefix policy, encryption
   policy, VPC endpoint/NAT path, and CloudWatch access-denied evidence.
2. Separate a transient provider failure from a policy or cross-environment
   configuration error.
3. Suspend destructive cleanup when object authority is uncertain and escalate
   recovery decisions.
4. Recover only the required object version through the approved procedure,
   staging first where feasible; then validate via the parent-authorised route.

Never make a bucket public, share production bucket access with staging, grant
broad `s3:*`, or distribute raw object links to browsers.

### Failed migration or application rollback

The migration task is a release gate. If it fails, keep the prior healthy
application service in place, preserve the exit code/logs, determine whether
any migration committed, and escalate. Do not retry blindly, run a force schema
push, manipulate migration history, or start the new service against a partially
upgraded schema.

If a migration succeeded and the application is unhealthy, roll back only to an
image verified compatible with the already-applied additive schema history.
Data recovery is a separate decision; an application rollback does not reverse
data/schema changes.

## Required recovery evidence

- [ ] Named recovery owner and change/incident authority.
- [ ] RDS automated backup/PITR status and retention reviewed.
- [ ] Production deletion protection enabled.
- [ ] S3 Block Public Access, versioning, encryption, lifecycle/retention, and
  restore authority reviewed separately for each environment.
- [ ] Latest isolated RDS restore and representative S3-version recovery
  evidence recorded.
- [ ] Application readiness, authentication/RBAC, and attachment authorisation
  verified after restore.
- [ ] Recovery gaps and follow-up actions recorded without exposing secrets.

## Retained Compose/VPS material

Docker Compose backup commands, host cron jobs, local volume restores, and VPS
rebuild instructions are not the AWS recovery path. They may be used only for a
separately approved local/VPS deployment, with that operator owning its
database, filesystem, TLS, host patching, backup encryption, and recovery
testing. They must not be copied into an RDS/S3/Fargate production procedure.
