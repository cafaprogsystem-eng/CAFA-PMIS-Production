# Superseded backup and disaster recovery runbook

The former version of this document described host cron, VPS-local backup
directories, and host-level restore scripts. That is not the recovery model for
the selected AWS Fargate/RDS/S3 deployment and must not be used as a production
release or recovery authority.

Use [the canonical backup and recovery guide](../BACKUP_RESTORE.md), together
with [the AWS deployment and operations runbook](aws-deployment-runbook.md).
Those documents define RDS automated backups/PITR, private S3 version recovery,
isolated staging restore certification, and migration-aware rollback decisions.
