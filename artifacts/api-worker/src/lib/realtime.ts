import type { Bindings, QueryExecutor } from "./db";
import {
  canAccessOperationalRecord,
  type OperationalEntityType,
} from "./operational-access";

/**
 * Worker-side client for the Durable Object realtime hub
 * (durable-objects/realtime-hub.ts). Each exported function mirrors the
 * original artifacts/api-server/src/lib/realtime.ts RealtimeService method
 * of the same name — this is the file every `// Dropped: realtime.X
 * (Durable Objects phase).` comment across the codebase gets replaced with
 * a real call to.
 *
 * Every call here is best-effort (matches source's bestEffortDelivery):
 * realtime is an opportunistic refetch transport, never part of a database
 * mutation's success contract, so a delivery failure is logged and
 * swallowed rather than turning a durable write into a 5xx.
 */

export interface DeletionAudienceGrant {
  userId: number;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
  projectAssignmentId?: number;
  assignmentRemovedByDeletion?: boolean;
}

export interface BroadcastUpdateOpts {
  module: string;
  action: string;
  entityId?: number;
  actorId?: number;
  actorName?: string;
  data?: Record<string, unknown>;
  deletionAudience?: DeletionAudienceGrant[];
}

export interface DomainEventInput {
  entityType: string;
  entityId: number;
  action: string;
}

function hub(env: Bindings) {
  return env.REALTIME_HUB.get(env.REALTIME_HUB.idFromName("global"));
}

async function callHub(env: Bindings, path: string, body: Record<string, unknown>): Promise<void> {
  try {
    await hub(env).fetch(`https://realtime-hub${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (err) {
    console.warn("[realtime] best-effort delivery failed", path, err);
  }
}

/** Compatibility bridge for clients still listening to module:update. */
export async function broadcastUpdate(env: Bindings, opts: BroadcastUpdateOpts): Promise<void> {
  await callHub(env, "/internal/broadcast-update", opts as unknown as Record<string, unknown>);
}

/** Publish a supporting-surface refetch hint (state/user/file/conversation/attachment/...). */
export async function publishSupportingEvent(env: Bindings, input: DomainEventInput): Promise<void> {
  await callHub(env, "/internal/publish-supporting-event", input as unknown as Record<string, unknown>);
}

/** Send a supporting refetch hint only to one active user's own sessions. */
export async function publishSupportingEventToUser(env: Bindings, userId: number, input: DomainEventInput): Promise<void> {
  await callHub(env, "/internal/publish-supporting-event-to-user", { userId, ...input });
}

/** Minimal signal to drop protected client caches for a just-revoked account, before its sockets are disconnected. */
export async function publishAuthorizationChanged(env: Bindings, userId: number): Promise<void> {
  await callHub(env, "/internal/publish-authorization-changed", { userId });
}

export async function isUserOnline(env: Bindings, userId: number): Promise<boolean> {
  try {
    const res = await hub(env).fetch("https://realtime-hub/internal/is-user-online", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });
    const body = await res.json<{ online: boolean }>();
    return body.online === true;
  } catch (err) {
    console.warn("[realtime] isUserOnline failed", err);
    return false;
  }
}

/** Immediately terminate every realtime connection for a deactivated account. */
export async function disconnectUser(env: Bindings, userId: number): Promise<void> {
  await callHub(env, "/internal/disconnect-user", { userId });
}

/** Immediately terminate every realtime connection for one revoked session. */
export async function disconnectSession(env: Bindings, sessionId: string): Promise<void> {
  await callHub(env, "/internal/disconnect-session", { sessionId });
}

/** Push a new chat message to every member of the conversation. */
export async function broadcastMessage(env: Bindings, memberIds: number[], data: { id: number; conversationId: number }): Promise<void> {
  await callHub(env, "/internal/broadcast-message", { memberIds, ...data });
}

/** Notify every active member and authorised operational viewer outside the room. */
export async function broadcastConversationUpdate(
  env: Bindings,
  memberIds: number[],
  convId: number,
  change: { change?: string; messageId?: number; actorId?: number; actorName?: string } = {},
): Promise<void> {
  await callHub(env, "/internal/broadcast-conversation-update", { memberIds, convId, change });
}

/** Per-user conversation invalidation (e.g. "Delete for Me") — reaches only the actor's own sessions. */
export async function broadcastPersonalConversationUpdate(env: Bindings, userId: number, conversationId: number): Promise<void> {
  await callHub(env, "/internal/broadcast-personal-conversation-update", { userId, conversationId });
}

export async function broadcastLock(
  env: Bindings,
  entityType: OperationalEntityType,
  entityId: number,
  event: { action: "locked"; lockedBy: { id: number; name: string } } | { action: "unlocked" },
): Promise<void> {
  await callHub(env, "/internal/broadcast-lock", { entityType, entityId, event });
}

/**
 * Capture the exact currently authorised audience before a destructive
 * transaction removes the record that normal delivery re-authorises
 * against. Callers must publish it only after their COMMIT. Runs directly
 * against the caller's own db/transaction — no Durable Object round trip,
 * exactly like source (it's a plain pre-delete Postgres read).
 */
export async function captureOperationalAudience(
  db: QueryExecutor,
  entityType: OperationalEntityType,
  entityId: number,
  options: { projectAssignmentRemovedByDeletion?: boolean } = {},
): Promise<DeletionAudienceGrant[]> {
  let reportProjectId: number | null = null;
  if (entityType === "report") {
    const parent = await db.query<{ project_id: number | null }>(
      `SELECT project_id FROM reports WHERE id = $1`,
      [entityId],
    );
    reportProjectId = parent.rows[0]?.project_id ?? null;
  }
  const candidates = await db.query<{
    id: number; role: string; state_id: number | null; sector: string | null;
  }>(
    `SELECT id, role, state_id, sector FROM users WHERE status = 'active'`,
  );
  const recipients: DeletionAudienceGrant[] = [];
  for (const candidate of candidates.rows) {
    const sectors = candidate.role === "technical_coordinator"
      ? (candidate.sector ?? "").split(",").map((s) => s.trim()).filter(Boolean)
      : null;
    const allowed = await canAccessOperationalRecord(
      db,
      { id: candidate.id, role: candidate.role, stateId: candidate.state_id ?? null, sectors },
      entityType,
      entityId,
    );
    if (allowed) {
      recipients.push({
        userId: candidate.id,
        role: candidate.role,
        stateId: candidate.state_id ?? null,
        sectors,
        ...(candidate.role === "state_program_officer"
          ? entityType === "project"
            ? {
                projectAssignmentId: entityId,
                assignmentRemovedByDeletion: options.projectAssignmentRemovedByDeletion === true,
              }
            : reportProjectId !== null
              ? { projectAssignmentId: reportProjectId }
              : {}
          : {}),
      });
    }
  }
  return recipients;
}
