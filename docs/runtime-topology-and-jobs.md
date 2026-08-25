# Production runtime topology and recurring work

For the selected AWS deployment, this runtime runs as one ECS Fargate task
behind an ALB in each isolated environment. The ALB forwards the same HTTPS
origin's `/`, `/api`, and `/api/socket.io` requests to the task on port 8080;
RDS and S3 remain private managed dependencies. See
[the AWS deployment and operations runbook](aws-deployment-runbook.md) for the
network, IAM, release, recovery, and certification procedures.

## Approved initial topology

Production and staging run **one API replica** with `SCHEDULER_ENABLED=true`.
Schema changes run first as the one-shot migration release task using
`node --enable-source-maps /app/scripts/migrate.mjs`;
the API runs with `RUN_MIGRATIONS_ON_STARTUP=false` and only verifies the
tracked migration head before it listens. `/api/healthz` is a lightweight
connectivity probe; `/api/readyz` is the non-sensitive deployment readiness
signal.

For a new database, the release job applies the immutable tracked
`000_initial_schema_baseline` before the ordered additive history. Existing
installations are adopted into that baseline history only when their canonical
`projects` relation already exists; they are never recreated or reset.

Do not scale API replicas until both conditions are met:

1. a durable, cross-replica scheduler lease/coordination mechanism is in place;
2. Socket.IO has a shared adapter. Broadcasts are process-local today, so a
   second replica does not receive another process's realtime events.

Pool sizing must reserve connections for the API process, the one-shot migration
job, and the scheduler's short database operations. The migration advisory lock
serialises schema work but does not replace sensible connection limits.

## Job inventory

| Job | Frequency | Persistence / idempotency evidence | Shutdown behaviour |
| --- | --- | --- | --- |
| Due-date notifications | immediately, then 6 hours | notification event keys are claimed per recipient before delivery | timer clears and any active pass is awaited |
| Attachment upload expiry sweep | immediately, then 15 minutes | parent-independent cleanup outbox, leases, retry state, and missing-object success handling | timer clears and active sweep is awaited |
| Idempotency claim pruning | immediately, then hourly | delete is safe to repeat; in-process overlap guard prevents duplicate local work | timer clears and active prune is awaited |
| Historical import lease heartbeat | only while an administrator import is active, every minute | operation/run scoped lease heartbeat | stopped in the import's `finally`; not a scheduler-owned recurring job |

The attachment S3 provider selection, task-IAM/default credential chain, object
authorisation, promotion, and lifecycle contracts are unchanged by this runtime
policy. E2E fixture and demo-seed provisioning are development/staging-only and
must never be invoked in production.

## Rollback boundary

Do not reset migration history, recreate the production database, or
automatically roll back schema changes. Roll back application code only when it
is compatible with the already-applied additive migration history; restore data
through the backup/recovery runbook when required.