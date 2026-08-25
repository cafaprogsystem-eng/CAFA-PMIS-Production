# Secure realtime domain-event contract

Operational modules publish a **version 1** `domain:event` only after the
database mutation has committed:

```ts
{
  version: 1,
  entityType:
    | "project" | "report" | "plan" | "risk"
    | "notification" | "user" | "state" | "conversation"
    | "file" | "program_resource" | "attachment" | "attachment_reconciliation",
  entityId: number,
  action: string,
  revision?: number,
  occurredAt: string, // ISO-8601
  scope?: { stateIds?: number[]; sectors?: string[]; projectId?: number }
}
```

This is a refetch hint, not record data. Clients must refetch through the HTTP
API and tolerate duplicate, delayed, or missed events. `scope` is safe routing
metadata only; it never grants access.

## Publishing rule

For an explicit database transaction, call `realtime.postCommit().enqueue(...)`
inside the transaction, call `flush()` immediately after `COMMIT`, and call
`discard()` from the rollback path. An autocommit statement may publish only
after its query has resolved successfully.

Operational records use their canonical record-read boundary. Supporting
surfaces use their own canonical audiences: notification and authorisation
events are private to the affected user's sessions; directory, State,
conversation, archive and attachment signals are rechecked against the same
permissions and parent access as their HTTP reads.

## Delivery rule

The server revalidates the recipient's active server session, user status,
current permissions, and record scope immediately before each delivery.
Socket.IO rooms only narrow candidate transports; they are never proof of
authorisation. Record watches and lock events use the same record-access
boundary.

`module:update` remains a temporary compatibility event for existing clients.
It is generated server-side from the same authorised domain delivery and must
not be used by new modules.

## Deployment boundary

The initial publisher is process-local through `OperationalEventTransport`.
A future multi-replica adapter must implement the same candidate lookup
boundary while leaving recipient reauthorisation in `RealtimeService`; adding a
shared transport alone (for example Redis) is not sufficient.