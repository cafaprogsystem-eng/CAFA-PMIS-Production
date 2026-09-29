import { DurableObject } from "cloudflare:workers";
import pg from "pg";
import type { Bindings } from "../lib/db";
import {
  canAccessOperationalRecord,
  hasRecordReadPermission,
  parseOperationalEntityId,
  parseOperationalEntityType,
  type OperationalEntityType,
  type OperationalRecordAccessUser,
} from "../lib/operational-access";
import { canAccessConversation } from "../lib/conversation-auth";
import { hasPerm, permissionsFor, type CurrentUser } from "../lib/rbac";

/**
 * Ported from artifacts/api-server/src/lib/realtime.ts (RealtimeService, a
 * Socket.IO server) + lib/presence.ts (PresenceService).
 *
 * One global instance (idFromName("global")) holds every live WebSocket
 * connection for the whole system via the Hibernation API. This replaces
 * Socket.IO's @socket.io/postgres-adapter entirely: that adapter existed
 * only to make presence/broadcast correct across multiple ECS task
 * processes, and a single Durable Object instance IS the single point of
 * coordination — there is no "other instance" to synchronize with.
 *
 * Authorization is re-checked live against Postgres at delivery time for
 * every candidate connection, exactly like the source system's own explicit
 * design principle ("rooms are transport optimisation only, never an
 * authorization boundary") — connect-time role/state/sector attributes are
 * cached on each WebSocket's hibernation attachment only as a fast identity
 * lookup, never trusted for an access decision.
 */

const PRESENCE_GRACE_MS = 5_000;

interface ConnectionAttachment {
  userId: number;
  name: string;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
  sessionId: string;
  conversationIds: number[];
  recordKeys: string[]; // "entityType:entityId"
}

interface FreshUser {
  id: number;
  name: string;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
  status: string;
}

interface DeletionAudienceGrant {
  userId: number;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
  projectAssignmentId?: number;
  assignmentRemovedByDeletion?: boolean;
}

function asCurrentUser(user: FreshUser | ConnectionAttachment): CurrentUser {
  const stateId = "stateId" in user ? user.stateId : null;
  return {
    id: "id" in user ? user.id : user.userId,
    name: user.name,
    email: "",
    role: user.role,
    roleLabel: "",
    scope: stateId === null ? "hq" : "state",
    stateId,
    stateName: null,
    sector: user.sectors?.join(",") ?? null,
    sectors: user.sectors,
    avatarUrl: null,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function send(ws: WebSocket, type: string, payload: Record<string, unknown> = {}): void {
  try {
    ws.send(JSON.stringify({ type, ...payload }));
  } catch {
    // Socket already closed/closing — nothing to do.
  }
}

function ack(ws: WebSocket, cid: unknown, payload: Record<string, unknown>): void {
  if (typeof cid !== "string" && typeof cid !== "number") return;
  send(ws, "ack", { cid, ...payload });
}

export class RealtimeHub extends DurableObject<Bindings> {
  constructor(ctx: DurableObjectState, env: Bindings) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(
        `CREATE TABLE IF NOT EXISTS pending_offline (
           user_id INTEGER PRIMARY KEY,
           deadline_ms INTEGER NOT NULL
         )`,
      );
    });
  }

  private openPool(): pg.Pool {
    return new pg.Pool({ connectionString: this.env.HYPERDRIVE.connectionString, max: 3 });
  }

  private attachmentOf(ws: WebSocket): ConnectionAttachment | null {
    return (ws.deserializeAttachment() as ConnectionAttachment | null) ?? null;
  }

  private async freshUsersById(pool: pg.Pool, ids: number[]): Promise<Map<number, FreshUser>> {
    const map = new Map<number, FreshUser>();
    if (ids.length === 0) return map;
    const { rows } = await pool.query<{
      id: number; name: string; role: string; state_id: number | null; sector: string | null; status: string;
    }>(
      `SELECT id, name, role, state_id, sector, status FROM users WHERE id = ANY($1::int[])`,
      [ids],
    );
    for (const row of rows) {
      map.set(row.id, {
        id: row.id,
        name: row.name,
        role: row.role,
        stateId: row.state_id,
        sectors: row.role === "technical_coordinator" && row.sector
          ? String(row.sector).split(",").map((s) => s.trim()).filter(Boolean)
          : null,
        status: row.status,
      });
    }
    return map;
  }

  private async freshUser(pool: pg.Pool, id: number): Promise<FreshUser | null> {
    return (await this.freshUsersById(pool, [id])).get(id) ?? null;
  }

  // ─── HTTP entrypoint ──────────────────────────────────────────────────────

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleUpgrade(request);
    }
    if (request.method !== "POST") return new Response("not_found", { status: 404 });
    const url = new URL(request.url);
    const body = await request.json().catch(() => null) as Record<string, unknown> | null;
    if (!body) return jsonResponse({ ok: false, error: "invalid_body" }, 400);
    switch (url.pathname) {
      case "/internal/broadcast-update": return this.handleBroadcastUpdate(body);
      case "/internal/publish-supporting-event": return this.handlePublishSupportingEvent(body);
      case "/internal/publish-supporting-event-to-user": return this.handlePublishSupportingEventToUser(body);
      case "/internal/publish-authorization-changed": return this.handlePublishAuthorizationChanged(body);
      case "/internal/is-user-online": return this.handleIsUserOnline(body);
      case "/internal/disconnect-user": return this.handleDisconnectUser(body);
      case "/internal/disconnect-session": return this.handleDisconnectSession(body);
      case "/internal/broadcast-message": return this.handleBroadcastMessage(body);
      case "/internal/broadcast-conversation-update": return this.handleBroadcastConversationUpdate(body);
      case "/internal/broadcast-personal-conversation-update": return this.handleBroadcastPersonalConversationUpdate(body);
      case "/internal/broadcast-lock": return this.handleBroadcastLock(body);
      default: return jsonResponse({ ok: false, error: "not_found" }, 404);
    }
  }

  private async handleUpgrade(request: Request): Promise<Response> {
    const identityHeader = request.headers.get("X-CAFA-Realtime-User");
    if (!identityHeader) return new Response("unauthorized", { status: 401 });
    let identity: {
      id: number; name: string; role: string; stateId: number | null; sectors: string[] | null; sessionId: string;
    };
    try {
      identity = JSON.parse(identityHeader);
    } catch {
      return new Response("unauthorized", { status: 401 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const wasOffline = this.ctx.getWebSockets(`user:${identity.id}`).length === 0;
    this.ctx.acceptWebSocket(server, [`user:${identity.id}`]);
    const attachment: ConnectionAttachment = {
      userId: identity.id,
      name: identity.name,
      role: identity.role,
      stateId: identity.stateId,
      sectors: identity.sectors,
      sessionId: identity.sessionId,
      conversationIds: [],
      recordKeys: [],
    };
    server.serializeAttachment(attachment);

    if (wasOffline) {
      this.ctx.storage.sql.exec(`DELETE FROM pending_offline WHERE user_id = ?`, identity.id);
      const pool = this.openPool();
      try {
        await this.broadcastPresenceTransition(identity.id, true, null, pool);
      } finally {
        await pool.end();
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ─── WebSocket lifecycle (Hibernation API) ───────────────────────────────

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message);
    } catch {
      return;
    }
    const type = parsed.type;
    const cid = parsed.cid;
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;

    if (type === "watch:record") {
      const entityType = parseOperationalEntityType(parsed.entityType);
      const entityId = parseOperationalEntityId(parsed.entityId);
      if (!entityType || !entityId) return ack(ws, cid, { ok: false, error: "invalid_record" });
      const pool = this.openPool();
      try {
        const fresh = await this.freshUser(pool, attachment.userId);
        const allowed = fresh && fresh.status === "active"
          ? await canAccessOperationalRecord(pool, fresh, entityType, entityId)
          : false;
        if (!allowed) {
          send(ws, "record:access", { entityType, entityId, allowed: false, reason: "access_revoked" });
          return ack(ws, cid, { ok: false, error: "record_forbidden" });
        }
        const key = `${entityType}:${entityId}`;
        if (!attachment.recordKeys.includes(key)) attachment.recordKeys.push(key);
        ws.serializeAttachment(attachment);
        ack(ws, cid, { ok: true, entityType, entityId });
      } catch {
        ack(ws, cid, { ok: false, error: "record_unavailable" });
      } finally {
        await pool.end();
      }
      return;
    }

    if (type === "unwatch:record") {
      const entityType = parseOperationalEntityType(parsed.entityType);
      const entityId = parseOperationalEntityId(parsed.entityId);
      if (!entityType || !entityId) return ack(ws, cid, { ok: false, error: "invalid_record" });
      const key = `${entityType}:${entityId}`;
      attachment.recordKeys = attachment.recordKeys.filter((k) => k !== key);
      ws.serializeAttachment(attachment);
      return ack(ws, cid, { ok: true, entityType, entityId });
    }

    if (type === "conversation:join") {
      const conversationId = parseOperationalEntityId(parsed.conversationId);
      if (!conversationId) return ack(ws, cid, { ok: false, error: "invalid_conversation_id" });
      const pool = this.openPool();
      try {
        const fresh = await this.freshUser(pool, attachment.userId);
        const allowed = fresh && fresh.status === "active"
          ? await canAccessConversation(pool, conversationId, { id: fresh.id, role: fresh.role })
          : false;
        if (!allowed) return ack(ws, cid, { ok: false, error: "conversation_forbidden" });
        if (!attachment.conversationIds.includes(conversationId)) attachment.conversationIds.push(conversationId);
        ws.serializeAttachment(attachment);
        ack(ws, cid, { ok: true, conversationId });
      } catch {
        ack(ws, cid, { ok: false, error: "conversation_unavailable" });
      } finally {
        await pool.end();
      }
      return;
    }

    if (type === "conversation:leave") {
      const conversationId = parseOperationalEntityId(parsed.conversationId);
      if (!conversationId) return ack(ws, cid, { ok: false, error: "invalid_conversation_id" });
      attachment.conversationIds = attachment.conversationIds.filter((id) => id !== conversationId);
      ws.serializeAttachment(attachment);
      return ack(ws, cid, { ok: true, conversationId });
    }

    if (type === "user:typing") {
      const conversationId = parseOperationalEntityId(parsed.conversationId);
      const isTyping = typeof parsed.isTyping === "boolean" ? parsed.isTyping : null;
      if (!conversationId || isTyping === null || !attachment.conversationIds.includes(conversationId)) return;
      const pool = this.openPool();
      try {
        await this.emitAuthorizedConversation(pool, conversationId, "user:typing", {
          conversationId,
          change: "conversation:updated",
          actorId: attachment.userId,
          actorName: attachment.name,
          isTyping,
        });
      } finally {
        await pool.end();
      }
      return;
    }
  }

  override async webSocketClose(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    await this.handleDisconnect(ws);
  }

  private async handleDisconnect(ws: WebSocket): Promise<void> {
    const attachment = this.attachmentOf(ws);
    if (!attachment) return;
    const remaining = this.ctx.getWebSockets(`user:${attachment.userId}`).filter((s) => s !== ws);
    if (remaining.length > 0) return; // still online via another connection

    const deadline = Date.now() + PRESENCE_GRACE_MS;
    this.ctx.storage.sql.exec(
      `INSERT INTO pending_offline (user_id, deadline_ms) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET deadline_ms = excluded.deadline_ms`,
      attachment.userId, deadline,
    );
    const currentAlarm = await this.ctx.storage.getAlarm();
    if (currentAlarm === null || currentAlarm > deadline) {
      await this.ctx.storage.setAlarm(deadline);
    }
  }

  // ─── Presence grace-period alarm ─────────────────────────────────────────

  override async alarm(): Promise<void> {
    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<{ user_id: number }>(`SELECT user_id FROM pending_offline WHERE deadline_ms <= ?`, now)
      .toArray();
    if (due.length > 0) {
      this.ctx.storage.sql.exec(`DELETE FROM pending_offline WHERE deadline_ms <= ?`, now);
      const pool = this.openPool();
      try {
        const lastSeenAt = new Date(now).toISOString();
        for (const row of due) {
          // A reconnect that raced past the deadline already deleted this
          // user's row (see handleUpgrade) before this alarm fired, so any
          // row still present here is authoritative — no separate version
          // counter is needed the way the source's PresenceService required.
          await pool.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [row.user_id, lastSeenAt]);
          await this.broadcastPresenceTransition(row.user_id, false, lastSeenAt, pool);
        }
      } finally {
        await pool.end();
      }
    }
    const next = this.ctx.storage.sql
      .exec<{ next_deadline: number | null }>(`SELECT MIN(deadline_ms) AS next_deadline FROM pending_offline`)
      .one();
    if (next?.next_deadline != null) {
      await this.ctx.storage.setAlarm(next.next_deadline);
    }
  }

  // ─── Presence delivery ────────────────────────────────────────────────────

  private async isPendingOffline(userId: number): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<{ user_id: number }>(`SELECT user_id FROM pending_offline WHERE user_id = ?`, userId)
      .toArray();
    return row.length > 0;
  }

  /**
   * Directory-wide presence:update to any connected socket whose (freshly
   * re-checked) user has users.view, plus conversation-scoped
   * conversation:presence to sockets currently joined to a conversation this
   * user belongs to and the recipient can still access. Two separate
   * authorization surfaces, exactly mirroring source's emitAuthorizedPresence
   * / emitAuthorizedConversationPresence.
   */
  private async broadcastPresenceTransition(
    userId: number, online: boolean, lastSeenAt: string | null, pool: pg.Pool,
  ): Promise<void> {
    const sockets = this.ctx.getWebSockets();
    if (sockets.length === 0) return;
    const distinctIds = [...new Set(sockets.map((ws) => this.attachmentOf(ws)?.userId).filter((id): id is number => id != null))];
    const fresh = await this.freshUsersById(pool, distinctIds);

    for (const ws of sockets) {
      const att = this.attachmentOf(ws);
      if (!att) continue;
      const viewer = fresh.get(att.userId);
      if (!viewer || viewer.status !== "active") continue;
      if (hasPerm(permissionsFor(asCurrentUser(viewer)), "users.view")) {
        send(ws, "presence:update", { userId, isOnline: online, lastSeenAt });
      }
    }

    const convRows = await pool.query<{ conversation_id: number }>(
      `SELECT DISTINCT conversation_id FROM conversation_members WHERE user_id = $1`,
      [userId],
    );
    for (const { conversation_id: conversationId } of convRows.rows) {
      for (const ws of sockets) {
        const att = this.attachmentOf(ws);
        if (!att || !att.conversationIds.includes(conversationId)) continue;
        const viewer = fresh.get(att.userId);
        if (!viewer || viewer.status !== "active") continue;
        const allowed = await canAccessConversation(pool, conversationId, { id: viewer.id, role: viewer.role });
        if (!allowed) {
          att.conversationIds = att.conversationIds.filter((id) => id !== conversationId);
          ws.serializeAttachment(att);
          send(ws, "conversation:access", { conversationId, allowed: false, reason: "access_revoked" });
          continue;
        }
        send(ws, "conversation:presence", { conversationId, userId, isOnline: online, lastSeenAt });
      }
    }
  }

  // ─── Conversation delivery ────────────────────────────────────────────────

  /**
   * Re-checks every socket currently joined to the conversation room before
   * emitting — membership removal, role changes, and deactivation take
   * effect immediately rather than waiting for a reconnect.
   */
  private async emitAuthorizedConversation(
    pool: pg.Pool,
    conversationId: number,
    eventName: "conversation:changed" | "message:new" | "user:typing",
    payload: Record<string, unknown>,
  ): Promise<void> {
    const sockets = this.ctx.getWebSockets().filter((ws) => this.attachmentOf(ws)?.conversationIds.includes(conversationId));
    if (sockets.length === 0) return;
    const distinctIds = [...new Set(sockets.map((ws) => this.attachmentOf(ws)!.userId))];
    const fresh = await this.freshUsersById(pool, distinctIds);
    for (const ws of sockets) {
      const att = this.attachmentOf(ws)!;
      const viewer = fresh.get(att.userId);
      const allowed = viewer && viewer.status === "active"
        ? await canAccessConversation(pool, conversationId, { id: viewer.id, role: viewer.role })
        : false;
      if (!allowed) {
        att.conversationIds = att.conversationIds.filter((id) => id !== conversationId);
        ws.serializeAttachment(att);
        send(ws, "conversation:access", { conversationId, allowed: false, reason: "access_revoked" });
        continue;
      }
      send(ws, eventName, payload);
    }
  }

  /** Re-checks a specific user's own sockets (not room-scoped) before emitting conversation:updated. */
  private async emitAuthorizedConversationUpdateToUser(pool: pg.Pool, userId: number, conversationId: number): Promise<void> {
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    if (sockets.length === 0) return;
    const fresh = await this.freshUser(pool, userId);
    if (!fresh || fresh.status !== "active") return;
    const allowed = await canAccessConversation(pool, conversationId, { id: fresh.id, role: fresh.role });
    for (const ws of sockets) {
      if (allowed) {
        send(ws, "conversation:updated", { convId: conversationId });
      } else {
        const att = this.attachmentOf(ws);
        if (att) {
          att.conversationIds = att.conversationIds.filter((id) => id !== conversationId);
          ws.serializeAttachment(att);
        }
        send(ws, "conversation:access", { conversationId, allowed: false, reason: "access_revoked" });
      }
    }
  }

  // ─── Supporting-event authorization ───────────────────────────────────────

  private async canAccessSupportingEvent(
    pool: pg.Pool, user: FreshUser, entityType: string, entityId: number,
  ): Promise<boolean> {
    if (entityType === "notification") return false;
    if (entityType === "user") return hasPerm(permissionsFor(asCurrentUser(user)), "users.view");
    if (entityType === "conversation") return canAccessConversation(pool, entityId, { id: user.id, role: user.role });
    if (entityType === "attachment_reconciliation") {
      return hasPerm(permissionsFor(asCurrentUser(user)), "storage.admin");
    }
    if (entityType === "file" || entityType === "program_resource") {
      const perms = permissionsFor(asCurrentUser(user));
      return hasPerm(perms, "program_resources.view") || hasPerm(perms, "documents.view");
    }
    if (entityType === "attachment") {
      const result = await pool.query<{ parent_type: string; parent_id: number }>(
        `SELECT parent_type, parent_id FROM attachments WHERE id = $1`,
        [entityId],
      );
      const parent = result.rows[0];
      if (!parent || (parent.parent_type !== "plan" && parent.parent_type !== "risk")) return false;
      return canAccessOperationalRecord(pool, user, parent.parent_type as OperationalEntityType, parent.parent_id);
    }
    // entityType === "state"
    const state = await pool.query<{ operational_status: string }>(
      `SELECT operational_status FROM states WHERE id = $1`,
      [entityId],
    );
    if (!state.rows[0]) return false;
    const isRegistryAdmin = user.role === "super_admin" || user.role === "executive_director" || user.role === "program_manager";
    if (isRegistryAdmin) return true;
    if (user.role === "state_office_manager" || user.role === "state_program_officer") {
      return user.stateId !== null && user.stateId === entityId;
    }
    return state.rows[0].operational_status === "active";
  }

  // ─── Internal broadcast handlers (called from the Worker's lib/realtime.ts) ─

  private async handleBroadcastUpdate(body: Record<string, unknown>): Promise<Response> {
    const entityType = parseOperationalEntityType(String(body.module ?? "").replace(/s$/, ""));
    const entityId = parseOperationalEntityId(body.entityId);
    if (!entityType || !entityId) return jsonResponse({ ok: true });
    const action = String(body.action ?? "");
    const domainEvent = { version: 1, entityType, entityId, action, occurredAt: new Date().toISOString() };
    const legacyEvent = {
      module: body.module, action, entityId: body.entityId,
      ...(body.actorId !== undefined ? { actorId: body.actorId } : {}),
      ...(body.actorName !== undefined ? { actorName: body.actorName } : {}),
      ...(body.data !== undefined ? { data: body.data } : {}),
    };
    const deletionAudience = Array.isArray(body.deletionAudience) ? body.deletionAudience as DeletionAudienceGrant[] : [];

    const pool = this.openPool();
    try {
      const sockets = this.ctx.getWebSockets();
      const distinctIds = [...new Set(sockets.map((ws) => this.attachmentOf(ws)?.userId).filter((id): id is number => id != null))];
      const fresh = await this.freshUsersById(pool, distinctIds);

      for (const ws of sockets) {
        const att = this.attachmentOf(ws);
        if (!att) continue;
        const user = fresh.get(att.userId);
        if (!user || user.status !== "active") continue;
        const asAccessUser: OperationalRecordAccessUser = { id: user.id, role: user.role, stateId: user.stateId, sectors: user.sectors };
        const normallyAllowed = await canAccessOperationalRecord(pool, asAccessUser, entityType, entityId);

        let allowed = normallyAllowed;
        if (!allowed && action === "deleted" && deletionAudience.length > 0) {
          const grant = deletionAudience.find((g) => g.userId === user.id);
          const scopeStillMatches = Boolean(
            grant
            && user.role === grant.role
            && user.stateId === grant.stateId
            && JSON.stringify([...(user.sectors ?? [])].sort()) === JSON.stringify([...(grant.sectors ?? [])].sort()),
          );
          const assignmentStillMatches = grant?.projectAssignmentId === undefined
            ? true
            : grant.assignmentRemovedByDeletion === true
              ? true
              : Boolean((await pool.query(
                  `SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
                  [grant.projectAssignmentId, user.id],
                )).rowCount);
          allowed = Boolean(grant && scopeStillMatches && assignmentStillMatches && hasRecordReadPermission(asAccessUser, entityType));
        }

        if (!allowed) {
          att.recordKeys = att.recordKeys.filter((k) => k !== `${entityType}:${entityId}`);
          ws.serializeAttachment(att);
          continue;
        }
        send(ws, "domain:event", domainEvent);
        send(ws, "module:update", legacyEvent);
      }
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handlePublishSupportingEvent(body: Record<string, unknown>): Promise<Response> {
    const entityType = String(body.entityType ?? "");
    const entityId = parseOperationalEntityId(body.entityId);
    if (!entityId) return jsonResponse({ ok: true });
    const domainEvent = { version: 1, entityType, entityId, action: String(body.action ?? ""), occurredAt: new Date().toISOString() };

    const pool = this.openPool();
    try {
      const sockets = this.ctx.getWebSockets();
      const distinctIds = [...new Set(sockets.map((ws) => this.attachmentOf(ws)?.userId).filter((id): id is number => id != null))];
      const fresh = await this.freshUsersById(pool, distinctIds);
      for (const ws of sockets) {
        const att = this.attachmentOf(ws);
        if (!att) continue;
        const user = fresh.get(att.userId);
        if (!user || user.status !== "active") continue;
        const allowed = await this.canAccessSupportingEvent(pool, user, entityType, entityId);
        if (allowed) send(ws, "domain:event", domainEvent);
      }
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handlePublishSupportingEventToUser(body: Record<string, unknown>): Promise<Response> {
    const userId = parseOperationalEntityId(body.userId);
    const entityType = String(body.entityType ?? "");
    const entityId = parseOperationalEntityId(body.entityId);
    if (!userId || !entityId) return jsonResponse({ ok: true });
    const domainEvent = { version: 1, entityType, entityId, action: String(body.action ?? ""), occurredAt: new Date().toISOString() };
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    for (const ws of sockets) {
      const att = this.attachmentOf(ws);
      if (att?.userId === userId) send(ws, "domain:event", domainEvent);
    }
    return jsonResponse({ ok: true });
  }

  private async handlePublishAuthorizationChanged(body: Record<string, unknown>): Promise<Response> {
    const userId = parseOperationalEntityId(body.userId);
    if (!userId) return jsonResponse({ ok: true });
    const domainEvent = { version: 1, entityType: "user", entityId: userId, action: "authorization_changed", occurredAt: new Date().toISOString() };
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    if (sockets.length === 0) return jsonResponse({ ok: true });
    const pool = this.openPool();
    try {
      for (const ws of sockets) {
        const att = this.attachmentOf(ws);
        if (att?.userId !== userId) continue;
        const session = await pool.query(
          `SELECT 1 FROM auth_sessions WHERE id = $1 AND revoked_at IS NULL AND expires_at > NOW()`,
          [att.sessionId],
        );
        if ((session.rowCount ?? 0) > 0) send(ws, "domain:event", domainEvent);
      }
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handleIsUserOnline(body: Record<string, unknown>): Promise<Response> {
    const userId = parseOperationalEntityId(body.userId);
    if (!userId) return jsonResponse({ online: false });
    const hasConnection = this.ctx.getWebSockets(`user:${userId}`).length > 0;
    const online = hasConnection || await this.isPendingOffline(userId);
    return jsonResponse({ online });
  }

  private async handleDisconnectUser(body: Record<string, unknown>): Promise<Response> {
    const userId = parseOperationalEntityId(body.userId);
    if (!userId) return jsonResponse({ ok: true });
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    for (const ws of sockets) {
      try { ws.close(4001, "revoked"); } catch { /* already closing */ }
    }
    this.ctx.storage.sql.exec(`DELETE FROM pending_offline WHERE user_id = ?`, userId);
    if (sockets.length > 0) {
      const pool = this.openPool();
      try {
        const lastSeenAt = new Date().toISOString();
        await pool.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [userId, lastSeenAt]);
        await this.broadcastPresenceTransition(userId, false, lastSeenAt, pool);
      } finally {
        await pool.end();
      }
    }
    return jsonResponse({ ok: true });
  }

  private async handleDisconnectSession(body: Record<string, unknown>): Promise<Response> {
    const sessionId = typeof body.sessionId === "string" ? body.sessionId : null;
    if (!sessionId) return jsonResponse({ ok: true });
    const allSockets = this.ctx.getWebSockets();
    let userId: number | null = null;
    const toClose: WebSocket[] = [];
    for (const ws of allSockets) {
      const att = this.attachmentOf(ws);
      if (att?.sessionId === sessionId) {
        toClose.push(ws);
        userId = att.userId;
      }
    }
    if (userId === null) return jsonResponse({ ok: true });
    const remaining = this.ctx.getWebSockets(`user:${userId}`).filter((ws) => !toClose.includes(ws));
    for (const ws of toClose) {
      try { ws.close(4001, "revoked"); } catch { /* already closing */ }
    }
    if (remaining.length === 0) {
      this.ctx.storage.sql.exec(`DELETE FROM pending_offline WHERE user_id = ?`, userId);
      const pool = this.openPool();
      try {
        const lastSeenAt = new Date().toISOString();
        await pool.query(`UPDATE users SET last_seen_at = $2 WHERE id = $1`, [userId, lastSeenAt]);
        await this.broadcastPresenceTransition(userId, false, lastSeenAt, pool);
      } finally {
        await pool.end();
      }
    }
    return jsonResponse({ ok: true });
  }

  private async handleBroadcastMessage(body: Record<string, unknown>): Promise<Response> {
    const conversationId = parseOperationalEntityId(body.conversationId);
    const messageId = parseOperationalEntityId(body.id);
    if (!conversationId || !messageId) return jsonResponse({ ok: true });
    const pool = this.openPool();
    try {
      await this.emitAuthorizedConversation(pool, conversationId, "message:new", { conversationId, change: "message:new", messageId });
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handleBroadcastConversationUpdate(body: Record<string, unknown>): Promise<Response> {
    const convId = parseOperationalEntityId(body.convId);
    if (!convId) return jsonResponse({ ok: true });
    const memberIds = Array.isArray(body.memberIds) ? (body.memberIds as unknown[]).map(Number).filter((n) => Number.isSafeInteger(n)) : [];
    const change = (body.change ?? {}) as Record<string, unknown>;
    const event: Record<string, unknown> = {
      conversationId: convId,
      change: change.change ?? "conversation:updated",
      ...(parseOperationalEntityId(change.messageId) ? { messageId: change.messageId } : {}),
      ...(parseOperationalEntityId(change.actorId) ? { actorId: change.actorId } : {}),
      ...(typeof change.actorName === "string" ? { actorName: change.actorName } : {}),
    };

    const pool = this.openPool();
    try {
      await this.emitAuthorizedConversation(pool, convId, "conversation:changed", event);
      await this.handlePublishSupportingEvent({ entityType: "conversation", entityId: convId, action: event.change });

      const currentMembers = await pool.query<{ user_id: number }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id = $1`,
        [convId],
      );
      const audienceIds = new Set<number>([...memberIds, ...currentMembers.rows.map((r) => r.user_id)]);
      for (const userId of audienceIds) {
        await this.emitAuthorizedConversationUpdateToUser(pool, userId, convId);
      }

      const operationalUsers = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE status = 'active' AND role = ANY(ARRAY['program_manager','super_admin']::text[])`,
      );
      for (const row of operationalUsers.rows) {
        if (audienceIds.has(row.id)) continue;
        await this.emitAuthorizedConversationUpdateToUser(pool, row.id, convId);
      }
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handleBroadcastPersonalConversationUpdate(body: Record<string, unknown>): Promise<Response> {
    const userId = parseOperationalEntityId(body.userId);
    const conversationId = parseOperationalEntityId(body.conversationId);
    if (!userId || !conversationId) return jsonResponse({ ok: true });
    const sockets = this.ctx.getWebSockets(`user:${userId}`);
    if (sockets.length === 0) return jsonResponse({ ok: true });
    const pool = this.openPool();
    try {
      const fresh = await this.freshUser(pool, userId);
      if (!fresh || fresh.status !== "active") return jsonResponse({ ok: true });
      const allowed = await canAccessConversation(pool, conversationId, { id: fresh.id, role: fresh.role });
      if (!allowed) return jsonResponse({ ok: true });
      for (const ws of sockets) send(ws, "conversation:personal", { conversationId });
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }

  private async handleBroadcastLock(body: Record<string, unknown>): Promise<Response> {
    const entityType = parseOperationalEntityType(body.entityType);
    const entityId = parseOperationalEntityId(body.entityId);
    if (!entityType || !entityId) return jsonResponse({ ok: true });
    const key = `${entityType}:${entityId}`;
    const event = body.event as Record<string, unknown>;
    const sockets = this.ctx.getWebSockets().filter((ws) => this.attachmentOf(ws)?.recordKeys.includes(key));
    if (sockets.length === 0) return jsonResponse({ ok: true });
    const pool = this.openPool();
    try {
      const distinctIds = [...new Set(sockets.map((ws) => this.attachmentOf(ws)!.userId))];
      const fresh = await this.freshUsersById(pool, distinctIds);
      for (const ws of sockets) {
        const att = this.attachmentOf(ws)!;
        const user = fresh.get(att.userId);
        const asAccessUser: OperationalRecordAccessUser | null = user
          ? { id: user.id, role: user.role, stateId: user.stateId, sectors: user.sectors }
          : null;
        const allowed = asAccessUser && user!.status === "active"
          ? await canAccessOperationalRecord(pool, asAccessUser, entityType, entityId)
          : false;
        if (!allowed) {
          att.recordKeys = att.recordKeys.filter((k) => k !== key);
          ws.serializeAttachment(att);
          send(ws, "record:access", { entityType, entityId, allowed: false, reason: "access_revoked" });
          continue;
        }
        send(ws, "record:lock", { entityType, entityId, ...event });
      }
    } finally {
      await pool.end();
    }
    return jsonResponse({ ok: true });
  }
}
