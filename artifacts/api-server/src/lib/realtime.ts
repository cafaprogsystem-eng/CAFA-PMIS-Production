import type { IncomingMessage, Server as HttpServer } from "http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { pool } from "@workspace/db";
import { logger } from "./logger";
import {
  getActiveSessionById,
  getActiveSessionFromToken,
  unsignSessionCookieValue,
} from "./session";
import {
  hasPerm,
  isDemoRoleHarnessEnabled,
  permissionsFor,
  type CurrentUser,
} from "../middlewares/currentUser";
import { isProductionEnv } from "./env";
import { canAccessConversation, type ConversationAccessUser } from "./conversationAuth";
import { resolveReportViewAccess } from "./reportAuth";
import { PresenceService, type PresenceTransition } from "./presence";
import {
  createCredentialedCorsOriginHandler,
  getConfiguredPublicAppOrigins,
  isAllowedCredentialedOrigin,
} from "./security-config";

/** Minimal cookie-string parser — no external dependency needed. */
function parseCookie(cookieStr: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of cookieStr.split(";")) {
    const idx = pair.indexOf("=");
    if (idx < 0) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(val);
  }
  return out;
}

const HQ_ROLES = new Set([
  "super_admin",
  "executive_director",
  "program_manager",
  "senior_program_coordinator",
  "technical_coordinator",
]);

export interface RealtimeUser {
  id: number;
  name: string;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
}

/**
 * Versioned operational invalidation contract.
 *
 * Domain events deliberately contain no record fields or actor identity. They
 * are hints only: clients refetch through normal HTTP authorisation, so
 * duplicate, delayed, or missed delivery is harmless. `scope` can reduce
 * candidate transport work in a future adapter, but is never an access grant.
 */
export const OPERATIONAL_ENTITY_TYPES = ["project", "report", "plan", "risk"] as const;
export type OperationalEntityType = (typeof OPERATIONAL_ENTITY_TYPES)[number];

/**
 * Supporting surfaces use the same identity-only refetch contract as
 * operational records, but their audiences are not record-watch rooms. Their
 * delivery boundary is defined below and rechecked immediately before emit.
 */
export const SUPPORTING_ENTITY_TYPES = [
  "notification",
  "user",
  "state",
  "conversation",
  "file",
  "program_resource",
  "attachment",
  "attachment_reconciliation",
] as const;
export type DomainEventAction = string;

export interface DomainEventScopeHint {
  stateIds?: number[];
  sectors?: string[];
  projectId?: number;
}

export interface DomainEvent {
  version: 1;
  entityType: RealtimeEntityType;
  entityId: number;
  action: DomainEventAction;
  revision?: number;
  occurredAt: string;
  scope?: DomainEventScopeHint;
}

export interface DomainEventInput {
  entityType: RealtimeEntityType;
  entityId: number;
  action: DomainEventAction;
  revision?: number;
  scope?: DomainEventScopeHint;
  /**
   * Private pre-delete access snapshot. It is never copied into DomainEvent or
   * emitted to the client; it only lets a post-commit deletion invalidate
   * viewers after the canonical record has been removed.
   */
  deletionAudience?: DeletionAudienceGrant[];
}

export interface OperationalRecordAccessUser {
  id: number;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
}

export interface RealtimeQueryExecutor {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

/**
 * Server-private authority captured immediately before a record is deleted.
 * It never crosses the socket boundary. The current session identity must
 * still match this scoped grant immediately before delivery.
 */
export interface DeletionAudienceGrant {
  userId: number;
  role: string;
  stateId: number | null;
  sectors: string[] | null;
  projectAssignmentId?: number;
  /**
   * Project deletion removes assignments in the same locked transaction after
   * this grant is captured. A post-commit lookup would necessarily be absent;
   * the capture is therefore the assignment proof for this one case.
   */
  assignmentRemovedByDeletion?: boolean;
}

export interface BroadcastEvent {
  module: string;
  action: string;
  entityId?: number;
  actorId?: number;
  actorName?: string;
  data?: Record<string, unknown>;
}

export type ConversationRealtimeChange =
  | "message:new"
  | "message:updated"
  | "message:deleted"
  | "message:reaction"
  | "message:pin"
  | "message:unpin"
  | "membership:changed"
  | "conversation:updated";

export interface ConversationRealtimeEvent {
  conversationId: number;
  change: ConversationRealtimeChange;
  messageId?: number;
  actorId?: number;
  actorName?: string;
}

interface ConversationAudienceUser {
  id: number;
  role: string;
}

export function parseRealtimeConversationId(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? (value as number) : null;
}

export function parseOperationalEntityType(value: unknown): OperationalEntityType | null {
  return typeof value === "string" && (OPERATIONAL_ENTITY_TYPES as readonly string[]).includes(value)
    ? value as OperationalEntityType
    : null;
}

export function parseSupportingEntityType(value: unknown): SupportingEntityType | null {
  return typeof value === "string" && (SUPPORTING_ENTITY_TYPES as readonly string[]).includes(value)
    ? value as SupportingEntityType
    : null;
}
export function parseOperationalEntityId(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0 ? value as number : null;
}

function recordRoom(entityType: OperationalEntityType, entityId: number): string {
  return `record:${entityType}:${entityId}`;
}

function validScopeHint(scope: DomainEventScopeHint | undefined): DomainEventScopeHint | undefined {
  if (!scope) return undefined;
  const stateIds = scope.stateIds?.filter((id) => Number.isSafeInteger(id) && id > 0);
  const sectors = scope.sectors?.filter((sector) => typeof sector === "string" && sector.trim().length > 0)
    .map((sector) => sector.trim());
  const projectId = parseOperationalEntityId(scope.projectId);
  const safe = {
    ...(stateIds?.length ? { stateIds: [...new Set(stateIds)] } : {}),
    ...(sectors?.length ? { sectors: [...new Set(sectors)] } : {}),
    ...(projectId ? { projectId } : {}),
  };
  return Object.keys(safe).length > 0 ? safe : undefined;
}

/** Validate and normalise all caller-provided values before a transport sees them. */
export function createDomainEvent(input: DomainEventInput, occurredAt = new Date().toISOString()): DomainEvent {
  const entityType = parseRealtimeEntityType(input.entityType);
  const entityId = parseOperationalEntityId(input.entityId);
  const action = typeof input.action === "string" ? input.action.trim() : "";
  const revision = input.revision;
  if (!entityType || !entityId || !action || action.length > 80) {
    throw new Error("invalid_domain_event");
  }
  if (revision !== undefined && (!Number.isSafeInteger(revision) || revision < 1)) {
    throw new Error("invalid_domain_event_revision");
  }
  return {
    version: 1,
    entityType,
    entityId,
    action,
    ...(revision !== undefined ? { revision } : {}),
    occurredAt,
    ...(validScopeHint(input.scope) ? { scope: validScopeHint(input.scope) } : {}),
  };
}

function accessUserForPermissions(user: OperationalRecordAccessUser): CurrentUser {
  return {
    id: user.id,
    name: "",
    email: "",
    role: user.role,
    roleLabel: "",
    scope: user.stateId === null ? "hq" : "state",
    stateId: user.stateId,
    stateName: null,
    sector: user.sectors?.join(",") ?? null,
    avatarUrl: null,
    sectors: user.sectors,
  };
}

function hasRecordReadPermission(user: OperationalRecordAccessUser, entityType: OperationalEntityType): boolean {
  const perms = permissionsFor(accessUserForPermissions(user));
  const required = entityType === "project"
    ? ["projects.view", "projects.view.state"]
    : entityType === "report"
      ? ["reports.view", "reports.view.state"]
      : entityType === "risk"
        ? ["risks.view", "risks.view.state"]
        // Plans predate a dedicated read capability. Existing routes grant
        // access through operational create/update/approval permissions.
        : ["plans.view", "plans.create", "plans.update", "plans.approve.coordination", "plans.approve.technical", "plans.approve.final"];
  return required.some((perm) => hasPerm(perms, perm));
}

/** Lock ownership is a write, not a read capability. */
export function canMutateOperationalRecord(
  user: OperationalRecordAccessUser,
  entityType: OperationalEntityType,
): boolean {
  const perms = permissionsFor(accessUserForPermissions(user));
  const required = entityType === "project"
    ? "projects.update"
    : entityType === "report"
      ? "reports.update"
      : entityType === "plan"
        ? "plans.update"
        : "risks.update";
  return hasPerm(perms, required);
}

function isStateScopedRole(role: string): boolean {
  return role === "state_program_officer" || role === "state_office_manager";
}

function stateScopeAllows(user: OperationalRecordAccessUser, stateId: number | null): boolean {
  return !isStateScopedRole(user.role) || (user.stateId !== null && stateId === user.stateId);
}

function sectorScopeAllows(user: OperationalRecordAccessUser, sectors: string[]): boolean {
  if (user.role !== "technical_coordinator") return true;
  // A malformed/missing TC assignment fails closed, as it does in HTTP routes.
  return (user.sectors ?? []).some((sector) => sectors.includes(sector));
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return stringList(parsed);
    } catch {
      return value.split(",").map((part) => part.trim()).filter(Boolean);
    }
  }
  return [];
}

function userSectorList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((sector) => sector.trim())
    .filter(Boolean);
}

/**
 * Non-Express record-read boundary used by watches and every operational
 * delivery. It mirrors the current HTTP state, assignment, and sector
 * restrictions while treating absent scope metadata as a denial.
 */
export async function canAccessOperationalRecord(
  user: OperationalRecordAccessUser,
  entityType: OperationalEntityType,
  entityId: number,
  db: RealtimeQueryExecutor = pool as unknown as RealtimeQueryExecutor,
): Promise<boolean> {
  if (!parseOperationalEntityId(entityId) || !hasRecordReadPermission(user, entityType)) return false;

  if (entityType === "project") {
    const result = await db.query<{ sector: string | null; sectors: unknown }>(
      `SELECT sector, COALESCE(sectors, '[]'::jsonb) AS sectors
         FROM projects
        WHERE id = $1 AND deleted_at IS NULL`,
      [entityId],
    );
    const row = result.rows[0];
    const sectors = [...new Set([
      ...(row?.sector ? [row.sector] : []),
      ...stringList(row?.sectors),
    ])];
    if (!row || !sectorScopeAllows(user, sectors)) return false;
    if (user.role === "state_program_officer") {
      if (user.stateId === null) return false;
      const assigned = await db.query(
        `SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
        [entityId, user.id],
      );
      return (assigned.rowCount ?? assigned.rows.length) > 0;
    }
    if (user.role === "state_office_manager") {
      if (user.stateId === null) return false;
      const linked = await db.query(
        `SELECT 1 FROM project_states WHERE project_id = $1 AND state_id = $2 LIMIT 1`,
        [entityId, user.stateId],
      );
      return (linked.rowCount ?? linked.rows.length) > 0;
    }
    return true;
  }

  if (entityType === "report") {
    const access = await resolveReportViewAccess(accessUserForPermissions(user), entityId, db);
    return access.allowed;
  }

  if (entityType === "plan") {
    const result = await db.query<{
      state_id: number | null;
      location_type: string | null;
      sectors: unknown;
    }>(
      `SELECT pl.state_id, pl.location_type,
              CASE
                WHEN jsonb_array_length(COALESCE(pl.sectors, '[]'::jsonb)) > 0 THEN pl.sectors
                WHEN NULLIF(pl.sector, '') IS NOT NULL THEN jsonb_build_array(pl.sector)
                WHEN NULLIF(p.sector, '') IS NOT NULL THEN jsonb_build_array(p.sector)
                ELSE '[]'::jsonb
              END AS sectors
         FROM plans pl
         LEFT JOIN projects p ON p.id = pl.project_id
        WHERE pl.id = $1`,
      [entityId],
    );
    const row = result.rows[0];
    if (
      !row ||
      (row.location_type === "hq" && isStateScopedRole(user.role)) ||
      !stateScopeAllows(user, row.state_id)
    ) return false;
    const sectors = stringList(row.sectors);
    return sectorScopeAllows(user, sectors);
  }

  const result = await db.query<{ state_id: number | null; sector: string | null }>(
    `SELECT r.state_id, p.sector
       FROM risks r
       LEFT JOIN projects p ON p.id = r.project_id AND p.deleted_at IS NULL
      WHERE r.id = $1`,
    [entityId],
  );
  const row = result.rows[0];
  return Boolean(row && stateScopeAllows(user, row.state_id) && sectorScopeAllows(user, row.sector ? [row.sector] : []));
}

export function messageRealtimeEvent(data: Record<string, unknown>): ConversationRealtimeEvent | null {
  const conversationId = parseRealtimeConversationId(data.conversationId);
  const messageId = parseRealtimeConversationId(data.id);
  if (!conversationId || !messageId) return null;
  return { conversationId, change: "message:new", messageId };
}

function conversationRoom(conversationId: number): string {
  return `conversation:${conversationId}`;
}

type RealtimeSocket = Socket & {
  rtUser: RealtimeUser;
  rtSessionId: string;
};

/**
 * Process-local transport seam for operational delivery only.
 *
 * The access checks stay in RealtimeService. A future distributed adapter can
 * replace these candidate lookups, but must not move or bypass the
 * per-recipient authorisation that follows them.
 */
export interface OperationalEventTransport {
  allCandidateSockets(): Promise<RealtimeSocket[]>;
  recordWatchers(entityType: OperationalEntityType, entityId: number): Promise<RealtimeSocket[]>;
}

class SocketIoOperationalEventTransport implements OperationalEventTransport {
  constructor(private readonly getIo: () => SocketIOServer | null) {}

  async allCandidateSockets(): Promise<RealtimeSocket[]> {
    return (await this.getIo()?.fetchSockets() ?? []) as unknown as RealtimeSocket[];
  }

  async recordWatchers(entityType: OperationalEntityType, entityId: number): Promise<RealtimeSocket[]> {
    const io = this.getIo();
    return (io ? await io.in(recordRoom(entityType, entityId)).fetchSockets() : []) as unknown as RealtimeSocket[];
  }
}

export function createRealtimeCorsOptions(
  allowedOrigins: readonly string[],
  allowAllWhenEmpty = !isProductionEnv(),
): {
  cors: { origin: ReturnType<typeof createCredentialedCorsOriginHandler>; credentials: true };
  allowRequest: (
    req: IncomingMessage,
    callback: (error: string | null, success: boolean) => void,
  ) => void;
} {
  return {
    cors: {
      origin: createCredentialedCorsOriginHandler(allowedOrigins, allowAllWhenEmpty),
      credentials: true,
    },
    allowRequest: (req, callback) => {
      const allowed = isAllowedCredentialedOrigin(
        req.headers.origin,
        allowedOrigins,
        allowAllWhenEmpty,
      );
      if (!allowed) {
        // Deliberately omit the raw Origin and all request headers: an attacker
        // controls them and they can include sensitive-looking values.
        logger.warn("[realtime] browser origin rejected");
      }
      callback(null, allowed);
    },
  };
}

export class RealtimeService {
  private io: SocketIOServer | null = null;

  private readonly operationalTransport: OperationalEventTransport;

  constructor(transport?: OperationalEventTransport) {
    this.operationalTransport = transport ?? new SocketIoOperationalEventTransport(() => this.io);
  }

  init(
    httpServer: HttpServer,
    sessionSecret: string,
    allowedOrigins: readonly string[] = getConfiguredPublicAppOrigins(),
  ): void {
    this.io = new SocketIOServer(httpServer, {
      ...createRealtimeCorsOptions(allowedOrigins),
      path: "/api/socket.io",
      // Presence relies on Socket.IO transport liveness, never on an HTTP or
      // browser heartbeat. These values also bound stale connection detection.
      pingInterval: 25_000,
      pingTimeout: 20_000,
    });

    this.io.use(async (socket: Socket, next) => {
      try {
        const cookieHeader = socket.handshake.headers.cookie ?? "";
        const cookies = parseCookie(cookieHeader);
        const signedSid = cookies["cafa_sid"];
        const unsigned = signedSid ? unsignSessionCookieValue(signedSid, sessionSecret) : false;
        const session = unsigned ? await getActiveSessionFromToken(unsigned) : null;
        if (!session) {
          next(new Error("unauthorized"));
          return;
        }

        let userId = session.userId;
        if (isDemoRoleHarnessEnabled()) {
          const devId = socket.handshake.auth?.["userId"];
          if (typeof devId === "number" && devId !== session.userId) {
            const { rows: sessionRows } = await pool.query(
              `SELECT role FROM users WHERE id = $1 AND status = 'active' LIMIT 1`,
              [session.userId],
            );
            if (sessionRows[0]?.role === "super_admin") userId = devId;
          }
        }

        const r = await pool.query<{
          id: number; name: string; role: string; state_id: number | null; status: string; sector: string | null;
        }>(
          `SELECT id, name, role, state_id, status, sector FROM users WHERE id = $1 LIMIT 1`,
          [userId],
        );
        const row = r.rows[0];
        if (!row || row.status !== "active") {
          next(new Error("unauthorized"));
          return;
        }

        (socket as Socket & { rtUser: RealtimeUser }).rtUser = {
          id: row.id,
          name: row.name,
          role: row.role,
          stateId: row.state_id ?? null,
          sectors: row.role === "technical_coordinator" && row.sector
            ? String(row.sector).split(",").map((sector) => sector.trim()).filter(Boolean)
            : null,
        };
        (socket as RealtimeSocket).rtSessionId = session.id;
        socket.data.rtUser = (socket as Socket & { rtUser: RealtimeUser }).rtUser;
        this.presence.register(socket.id, row.id, session.id);
        next();
      } catch (err) {
        logger.warn({ err }, "[realtime] socket auth error");
        next(new Error("auth_error"));
      }
    });

    this.io.on("connection", (socket: Socket) => {
      const realtimeSocket = socket as RealtimeSocket;
      const user = realtimeSocket.rtUser;

      void socket.join(`user:${user.id}`);
      if (HQ_ROLES.has(user.role)) void socket.join("hq");
      if (user.stateId) void socket.join(`state:${user.stateId}`);

      logger.debug({ userId: user.id, role: user.role }, "[realtime] connected");

      const acknowledgeRecordWatch = (
        callback: unknown,
        result: { ok: true; entityType: OperationalEntityType; entityId: number } | { ok: false; error: string },
      ) => {
        if (typeof callback === "function") (callback as (value: typeof result) => void)(result);
      };

      socket.on("watch:record", (data: unknown, callback?: unknown) => {
        const candidate = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const entityType = parseOperationalEntityType(candidate.entityType);
        const entityId = parseOperationalEntityId(candidate.entityId);
        if (!entityType || !entityId) {
          acknowledgeRecordWatch(callback, { ok: false, error: "invalid_record" });
          return;
        }
        void (async () => {
          const currentUser = await this.refreshSocketUser(realtimeSocket);
          const allowed = currentUser
            ? await canAccessOperationalRecord(currentUser, entityType, entityId)
            : false;
          if (!allowed) {
            await socket.leave(recordRoom(entityType, entityId));
            socket.emit("record:access", { entityType, entityId, allowed: false, reason: "access_revoked" });
            acknowledgeRecordWatch(callback, { ok: false, error: "record_forbidden" });
            return;
          }
          await socket.join(recordRoom(entityType, entityId));
          acknowledgeRecordWatch(callback, { ok: true, entityType, entityId });
        })().catch((err) => {
          logger.warn({ err, userId: user.id }, "[realtime] record watch failed");
          acknowledgeRecordWatch(callback, { ok: false, error: "record_unavailable" });
        });
      });

      socket.on("unwatch:record", (data: unknown, callback?: unknown) => {
        const candidate = data && typeof data === "object" ? data as Record<string, unknown> : {};
        const entityType = parseOperationalEntityType(candidate.entityType);
        const entityId = parseOperationalEntityId(candidate.entityId);
        if (!entityType || !entityId) {
          acknowledgeRecordWatch(callback, { ok: false, error: "invalid_record" });
          return;
        }
        void Promise.resolve(socket.leave(recordRoom(entityType, entityId))).then(() => {
          acknowledgeRecordWatch(callback, { ok: true, entityType, entityId });
        });
      });

      const acknowledge = (
        callback: unknown,
        result: { ok: true; conversationId: number } | { ok: false; error: string },
      ) => {
        if (typeof callback === "function") (callback as (value: typeof result) => void)(result);
      };

      socket.on(
        "conversation:join",
        (data: unknown, callback?: unknown) => {
          const conversationId = parseRealtimeConversationId(
            data && typeof data === "object"
              ? (data as Record<string, unknown>).conversationId
              : undefined,
          );
          if (!conversationId) {
            acknowledge(callback, { ok: false, error: "invalid_conversation_id" });
            return;
          }
          void (async () => {
            const currentUser = await this.refreshSocketUser(realtimeSocket);
            const allowed = currentUser
              ? await canAccessConversation(conversationId, currentUser)
              : false;
            if (!allowed) {
              acknowledge(callback, { ok: false, error: "conversation_forbidden" });
              return;
            }
            await socket.join(conversationRoom(conversationId));
            acknowledge(callback, { ok: true, conversationId });
          })().catch((err) => {
            logger.warn({ err, conversationId, userId: user.id }, "[realtime] conversation join failed");
            acknowledge(callback, { ok: false, error: "conversation_unavailable" });
          });
        },
      );

      socket.on(
        "conversation:leave",
        (data: unknown, callback?: unknown) => {
          const conversationId = parseRealtimeConversationId(
            data && typeof data === "object"
              ? (data as Record<string, unknown>).conversationId
              : undefined,
          );
          if (!conversationId) {
            acknowledge(callback, { ok: false, error: "invalid_conversation_id" });
            return;
          }
          void Promise.resolve(socket.leave(conversationRoom(conversationId))).then(() => {
            acknowledge(callback, { ok: true, conversationId });
          });
        },
      );

      socket.on(
        "user:typing",
        (data: unknown) => {
          const conversationId = parseRealtimeConversationId(
            data && typeof data === "object"
              ? (data as Record<string, unknown>).conversationId
              : undefined,
          );
          const isTyping =
            data && typeof data === "object" &&
            typeof (data as Record<string, unknown>).isTyping === "boolean"
              ? (data as Record<string, unknown>).isTyping as boolean
              : null;
          if (!conversationId || isTyping === null || !socket.rooms.has(conversationRoom(conversationId))) return;
          void this.emitAuthorizedConversation(conversationId, {
            conversationId,
            change: "conversation:updated",
            actorId: user.id,
            actorName: user.name,
          }, "user:typing", { isTyping });
        },
      );

      socket.on("disconnect", () => {
        this.presence.removeConnection(socket.id);
        logger.debug({ userId: user.id }, "[realtime] disconnected");
      });
    });

    logger.info("[realtime] Socket.IO server initialised on /api/socket.io");
  }

  /**
   * Queue a domain event while a transaction is still open, then call flush()
   * only after its COMMIT succeeded. There is intentionally no durable replay
   * outbox: these are duplicate-safe refetch hints, not a source of truth.
   */
  postCommit(): PostCommitDomainEvents {
    return new PostCommitDomainEvents((event) => this.publishDomainEvent(event));
  }

  /**
   * Publish a canonical operational event to recipients re-authorised at
   * delivery time. The process-local Socket.IO iteration is isolated here; a
   * future multi-replica adapter must preserve this callback contract and must
   * not treat a room membership as an authorisation decision.
   */
  async publishDomainEvent(input: DomainEventInput): Promise<void> {
    const event = createDomainEvent(input);
    if (!parseOperationalEntityType(event.entityType)) {
      throw new Error("supporting_events_require_publishSupportingEvent");
    }
    await this.bestEffortDelivery(
      "operational_event",
      () => this.emitAuthorizedDomainEvent(event, undefined, input.deletionAudience),
    );
  }

  /**
   * Capture the exact currently authorised audience before a destructive
   * transaction removes the record that normal delivery re-authorises against.
   * Callers must publish it only after their COMMIT. The IDs remain server-only;
   * active-session and read-permission checks still run immediately before send.
   */
  async captureOperationalAudience(
    entityType: OperationalEntityType,
    entityId: number,
    db: RealtimeQueryExecutor = pool as unknown as RealtimeQueryExecutor,
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
      id: number;
      role: string;
      state_id: number | null;
      sector: string | null;
    }>(
      `SELECT id, role, state_id, sector
         FROM users
        WHERE status = 'active'`,
    );
    const recipients: DeletionAudienceGrant[] = [];
    for (const candidate of candidates.rows) {
      const sectors = candidate.role === "technical_coordinator"
        ? userSectorList(candidate.sector)
        : null;
      const allowed = await canAccessOperationalRecord({
        id: candidate.id,
        role: candidate.role,
        stateId: candidate.state_id ?? null,
        sectors,
      }, entityType, entityId, db);
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

  /** Compatibility bridge for clients still listening to module:update. */
  broadcastUpdate(opts: {
    module: string;
    action: string;
    entityId?: number;
    actorId?: number;
    actorName?: string;
    stateIds?: number[];
    data?: Record<string, unknown>;
    deletionAudience?: DeletionAudienceGrant[];
  }): void {
    const entityType = parseOperationalEntityType(opts.module.replace(/s$/, ""));
    const entityId = parseOperationalEntityId(opts.entityId);
    if (!entityType || !entityId) return;
    const legacyEvent: BroadcastEvent = {
      module: opts.module,
      action: opts.action,
      entityId: opts.entityId,
    };
    // Existing callers invoke this after their successful COMMIT. Do not move
    // it into transaction bodies; use postCommit() for new transactional work.
    void this.emitAuthorizedDomainEvent(
      createDomainEvent({
        entityType,
        entityId,
        action: opts.action,
        scope: { stateIds: opts.stateIds },
      }),
      legacyEvent,
      opts.deletionAudience,
    ).catch((err) => logger.warn({ err, entityType, entityId }, "[realtime] domain delivery failed"));
  }

  async broadcastToUser(userId: number, event: BroadcastEvent): Promise<void> {
    await this.bestEffortDelivery("legacy_notification", async () => {
      if (!this.io) return;
      const sockets = await this.io.in(`user:${userId}`).fetchSockets();
      for (const rawSocket of sockets) {
        const socket = rawSocket as unknown as RealtimeSocket;
        const currentUser = await this.refreshSocketUser(socket);
        if (currentUser?.id === userId) socket.emit("notification:new", event);
      }
    });
  }

  /** Immediately terminate every realtime connection for one revoked session. */
  disconnectSession(sessionId: string): void {
    if (!this.io) return;
    this.presence.removeSession(sessionId);
    void this.io.fetchSockets().then((sockets) => {
      for (const rawSocket of sockets) {
        const socket = rawSocket as unknown as RealtimeSocket;
        if (socket.rtSessionId === sessionId) socket.disconnect(true);
      }
    }).catch((err) => {
      logger.warn({ err }, "[realtime] failed to disconnect revoked session");
    });
  }

  /** Immediately remove all realtime connections for a deactivated account. */
  disconnectUser(userId: number): void {
    this.presence.removeUser(userId);
    if (!this.io) return;
    void this.io.fetchSockets().then((sockets) => {
      for (const rawSocket of sockets) {
        const socket = rawSocket as unknown as RealtimeSocket;
        if (socket.rtUser?.id === userId) socket.disconnect(true);
      }
    }).catch((err) => {
      logger.warn({ err, userId }, "[realtime] failed to disconnect deactivated user");
    });
  }

  isUserOnline(userId: number): boolean {
    return this.presence.isOnline(userId);
  }

  /**
   * Per-user conversation invalidation. Used for a private mutation such as
   * Delete For Me: it reaches only the actor's sessions and carries no
   * recipient-specific state.
   */
  async broadcastPersonalConversationUpdate(userId: number, conversationId: number): Promise<void> {
    if (!this.io || !parseRealtimeConversationId(userId) || !parseRealtimeConversationId(conversationId)) return;
    await this.bestEffortDelivery("personal_conversation_update", async () => {
      const sockets = await this.io!.in(`user:${userId}`).fetchSockets();
      for (const rawSocket of sockets) {
        const socket = rawSocket as unknown as RealtimeSocket;
        const currentUser = await this.refreshSocketUser(socket);
        if (currentUser?.id === userId && await canAccessConversation(conversationId, currentUser)) {
          socket.emit("conversation:personal", { conversationId });
        }
      }
    });
  }

  /** Push a new chat message to every member of the conversation. */
  async broadcastMessage(memberIds: number[], data: Record<string, unknown>): Promise<void> {
    const event = messageRealtimeEvent(data);
    if (!event) return;
    await this.bestEffortDelivery("conversation_message", () =>
      this.emitAuthorizedConversation(event.conversationId, event, "message:new"));
  }

  /** Notify every active member and authorised operational viewer outside the room. */
  async broadcastConversationUpdate(
    memberIds: number[],
    convId: number,
    change: Partial<ConversationRealtimeEvent> = {},
  ): Promise<void> {
    const event: ConversationRealtimeEvent = {
      conversationId: convId,
      change: change.change ?? "conversation:updated",
      ...(parseRealtimeConversationId(change.messageId) ? { messageId: change.messageId } : {}),
      ...(parseRealtimeConversationId(change.actorId) ? { actorId: change.actorId } : {}),
      ...(typeof change.actorName === "string" ? { actorName: change.actorName } : {}),
    };
    await this.bestEffortDelivery("conversation_update", async () => {
      await this.emitAuthorizedConversation(convId, event, "conversation:changed");
      await this.publishSupportingEvent({
        entityType: "conversation",
        entityId: convId,
        action: event.change,
      });

      if (!this.io) return;
      // Query membership after the mutation so changes to the roster converge for
      // all remaining members. Callers additionally pass removed/new members when
      // their own list must refresh despite no longer/previously being in this set.
      const currentMembers = await pool.query<{ user_id: number }>(
        `SELECT user_id FROM conversation_members WHERE conversation_id=$1`,
        [convId],
      );
      const audienceIds = new Set([
        ...memberIds,
        ...currentMembers.rows.map((row) => row.user_id),
      ]);
      for (const userId of audienceIds) {
        await this.emitAuthorizedConversationUpdateToUser(userId, convId);
      }

      // Full Operational Access may permit a non-member to view a non-direct
      // conversation. Re-run canonical access per candidate rather than relying
      // on the role query as authority; Direct Messages remain member-only.
      const operationalUsers = await pool.query<ConversationAudienceUser>(
        `SELECT id, role FROM users
         WHERE status='active' AND role = ANY(ARRAY['program_manager','super_admin']::text[])`,
      );
      for (const user of operationalUsers.rows) {
        if (audienceIds.has(user.id)) continue;
        await this.emitAuthorizedConversationUpdateToUser(user.id, convId);
      }
    });
  }

  private async refreshSocketUser(
    socket: RealtimeSocket,
  ): Promise<(ConversationAccessUser & OperationalRecordAccessUser) | null> {
    const socketUser = socket.rtUser ?? socket.data.rtUser as RealtimeUser | undefined;
    if (!socketUser) return null;
    const activeSession = await getActiveSessionById(socket.rtSessionId);
    // The demo role harness deliberately impersonates an active user in
    // development; production sockets must still exactly match their session.
    if (!activeSession || (
      !isDemoRoleHarnessEnabled() &&
      activeSession.userId !== socketUser.id
    )) return null;
    const result = await pool.query<{
      id: number;
      name: string;
      role: string;
      state_id: number | null;
      sector: string | null;
      status: string;
    }>(
      `SELECT id, name, role, state_id, sector, status FROM users WHERE id=$1 LIMIT 1`,
      [socketUser.id],
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return null;
    socket.rtUser = {
      id: row.id,
      name: row.name,
      role: row.role,
      stateId: row.state_id ?? null,
      sectors: row.role === "technical_coordinator" && row.sector
        ? String(row.sector).split(",").map((sector) => sector.trim()).filter(Boolean)
        : null,
    };
    socket.data.rtUser = socket.rtUser;
    return {
      id: row.id,
      role: row.role,
      stateId: row.state_id ?? null,
      sectors: socket.rtUser.sectors,
    };
  }

  private readonly presence = new PresenceService({
    onTransition: (transition) => this.handlePresenceTransition(transition),
  });

  private async handlePresenceTransition(transition: PresenceTransition): Promise<void> {
    if (!transition.online) {
      await pool.query(
        `UPDATE users SET last_seen_at = $2 WHERE id = $1`,
        [transition.userId, transition.lastSeenAt],
      );
    }
    // A reconnect may arrive while a last-seen write is in flight. Do not let
    // that older offline transition broadcast after a newer online transition.
    if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
    await this.emitAuthorizedPresence(transition);
    if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
    await this.emitAuthorizedConversationPresence(transition);
  }

  private async emitAuthorizedPresence(transition: PresenceTransition): Promise<void> {
    if (!this.io) return;
    if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
    // Re-read and re-authorise every socket recipient immediately before
    // delivery. The event contains identity only: no session/device/network
    // information is ever sent.
    const sockets = await this.io.fetchSockets();
    for (const rawSocket of sockets) {
      if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
      const socket = rawSocket as unknown as RealtimeSocket;
      const currentUser = await this.refreshSocketUser(socket);
      if (!currentUser) continue;
      // Permission refresh is asynchronous. Recheck after it completes so an
      // older offline transition cannot emit after a reconnect advanced the
      // user's presence version.
      if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
      const viewer = {
        id: socket.rtUser.id,
        name: socket.rtUser.name,
        email: "",
        role: socket.rtUser.role,
        roleLabel: "",
        scope: socket.rtUser.stateId === null ? "hq" : "state",
        stateId: socket.rtUser.stateId,
        stateName: null,
        sector: null,
        avatarUrl: null,
        sectors: null,
      } satisfies CurrentUser;
      if (!hasPerm(permissionsFor(viewer), "users.view")) continue;
      socket.emit("presence:update", {
        userId: transition.userId,
        isOnline: transition.online,
        lastSeenAt: transition.lastSeenAt,
      });
    }
  }

  /**
   * Presence in Messages is scoped to an open, authorised conversation room.
   * This intentionally does not reuse the directory-wide users.view event:
   * a recipient learns only about a member of a conversation they can still
   * access, and only while that conversation is open in their socket.
   */
  private async emitAuthorizedConversationPresence(transition: PresenceTransition): Promise<void> {
    if (!this.io) return;
    const conversations = await pool.query<{ conversationId: number }>(
      `SELECT DISTINCT conversation_id AS "conversationId"
       FROM conversation_members
       WHERE user_id = $1`,
      [transition.userId],
    );
    if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;

    for (const { conversationId } of conversations.rows) {
      const sockets = await this.io.in(conversationRoom(conversationId)).fetchSockets();
      for (const rawSocket of sockets) {
        if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
        const socket = rawSocket as unknown as RealtimeSocket;
        const currentUser = await this.refreshSocketUser(socket);
        const allowed = currentUser
          ? await canAccessConversation(conversationId, currentUser)
          : false;
        if (!allowed) {
          await socket.leave(conversationRoom(conversationId));
          socket.emit("conversation:access", {
            conversationId,
            allowed: false,
            reason: "access_revoked",
          });
          continue;
        }
        if (!this.presence.isCurrentTransition(transition.userId, transition.version)) return;
        socket.emit("conversation:presence", {
          conversationId,
          userId: transition.userId,
          isOnline: transition.online,
          lastSeenAt: transition.lastSeenAt,
        });
      }
    }
  }

  /**
   * Re-check every socket currently in a conversation room before emitting.
   * This makes membership removal, role changes, and deactivation effective
   * without waiting for the client to reconnect.
   */
  private async emitAuthorizedConversation(
    conversationId: number,
    event: ConversationRealtimeEvent,
    eventName: "conversation:changed" | "message:new" | "user:typing",
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    if (!this.io) return;
    const sockets = await this.io.in(conversationRoom(conversationId)).fetchSockets();
    for (const rawSocket of sockets) {
      const socket = rawSocket as unknown as RealtimeSocket;
      const currentUser = await this.refreshSocketUser(socket);
      const allowed = currentUser
        ? await canAccessConversation(conversationId, currentUser)
        : false;
      if (!allowed) {
        await socket.leave(conversationRoom(conversationId));
        socket.emit("conversation:access", {
          conversationId,
          allowed: false,
          reason: "access_revoked",
        });
        continue;
      }
      socket.emit(eventName, eventName === "user:typing" ? { ...event, ...extra } : event);
    }
  }

  async broadcastLock(
    entityType: OperationalEntityType,
    entityId: number,
    event: { action: "locked" | "unlocked"; lockedBy?: { id: number; name: string } },
  ): Promise<void> {
    if (!this.io) return;
    const sockets = await this.operationalTransport.recordWatchers(entityType, entityId);
    for (const socket of sockets) {
      const currentUser = await this.refreshSocketUser(socket) as OperationalRecordAccessUser | null;
      const allowed = currentUser
        ? await canAccessOperationalRecord(currentUser, entityType, entityId)
        : false;
      if (!allowed) {
        await socket.leave(recordRoom(entityType, entityId));
        socket.emit("record:access", { entityType, entityId, allowed: false, reason: "access_revoked" });
        continue;
      }
      socket.emit("record:lock", { entityType, entityId, ...event });
    }
  }

  private async emitAuthorizedDomainEvent(
    event: DomainEvent,
    legacyEvent?: BroadcastEvent,
    preDeleteAudience: readonly DeletionAudienceGrant[] = [],
  ): Promise<void> {
    if (!this.io) return;
    const entityType = parseOperationalEntityType(event.entityType);
    if (!entityType) return;
    // Rooms are transport optimisation only. Iterate live sockets so users who
    // still run legacy clients receive a compatible update, but authorise every
    // socket against the canonical record just before emission.
    const sockets = await this.operationalTransport.allCandidateSockets();
    for (const socket of sockets) {
      const currentUser = await this.refreshSocketUser(socket) as OperationalRecordAccessUser | null;
      const normallyAllowed = currentUser
        ? await canAccessOperationalRecord(currentUser, entityType, event.entityId)
        : false;
      // A deleted record cannot be loaded by the canonical resolver. Its
      // audience was therefore captured before the destructive transaction,
      // but delivery still requires a live, active session with the applicable
      // read permission. The snapshot is never part of the public event.
      const grant = currentUser
        ? preDeleteAudience.find((entry) => entry.userId === currentUser.id)
        : undefined;
      const scopeStillMatches = Boolean(
        currentUser
        && grant
        && currentUser.role === grant.role
        && currentUser.stateId === grant.stateId
        && JSON.stringify([...(currentUser.sectors ?? [])].sort())
          === JSON.stringify([...(grant.sectors ?? [])].sort()),
      );
      const assignmentStillMatches = grant?.projectAssignmentId === undefined
        ? true
        : grant.assignmentRemovedByDeletion === true
          ? true
        : Boolean(
          currentUser
          && (await pool.query(
            `SELECT 1 FROM project_assignments WHERE project_id = $1 AND user_id = $2 LIMIT 1`,
            [grant.projectAssignmentId, currentUser.id],
          )).rowCount,
        );
      const allowed = normallyAllowed || Boolean(
        currentUser
        && event.action === "deleted"
        && scopeStillMatches
        && assignmentStillMatches
        && hasRecordReadPermission(currentUser, entityType),
      );
      if (!allowed) {
        await socket.leave(recordRoom(entityType, event.entityId));
        continue;
      }
      socket.emit("domain:event", event);
      if (legacyEvent) socket.emit("module:update", legacyEvent);
    }
  }

  get initialized(): boolean {
    return this.io !== null;
  }

  close(): void {
    this.presence.clear();
    this.io?.close();
    this.io = null;
  }

  /**
   * Publish a supporting-surface refetch hint. Unlike operational records,
   * these surfaces have distinct authorisation rules (directory viewers,
   * state-scoped staff, archive stewards, and parent-bound attachments).
   */
  async publishSupportingEvent(input: DomainEventInput): Promise<void> {
    const event = createDomainEvent(input);
    if (!parseSupportingEntityType(event.entityType)) {
      throw new Error("operational_events_require_publishDomainEvent");
    }
    await this.bestEffortDelivery("supporting_event", () => this.emitAuthorizedSupportingEvent(event));
  }

  /**
   * Send a supporting refetch hint only to one active user's own sessions.
   * This is used for private notification state and material authorisation
   * changes. The target ID is transport-only and is never part of the event.
   */
  async publishSupportingEventToUser(userId: number, input: DomainEventInput): Promise<void> {
    const event = createDomainEvent(input);
    if (!parseSupportingEntityType(event.entityType) || !parseOperationalEntityId(userId)) {
      throw new Error("invalid_private_supporting_event");
    }
    await this.bestEffortDelivery("private_supporting_event", () => this.emitAuthorizedSupportingEventToUser(userId, event));
  }

  /**
   * A just-revoked account cannot pass the normal active-user refresh check.
   * Its already-authenticated sessions still need one minimal signal to drop
   * protected client caches before the server disconnects them. This emits only
   * the target's own stable user ID after checking the session remains valid.
   */
  async publishAuthorizationChanged(userId: number): Promise<void> {
    if (!parseOperationalEntityId(userId)) return;
    const event = createDomainEvent({
      entityType: "user",
      entityId: userId,
      action: "authorization_changed",
    });
    await this.bestEffortDelivery("authorization_changed", async () => {
      if (!this.io) return;
      const sockets = await this.io.in(`user:${userId}`).fetchSockets();
      for (const rawSocket of sockets) {
        const socket = rawSocket as unknown as RealtimeSocket;
        if (socket.rtUser?.id !== userId) continue;
        if (!await getActiveSessionById(socket.rtSessionId)) continue;
        socket.emit("domain:event", event);
      }
    });
  }

  /**
   * Realtime is an opportunistic refetch transport, never part of a database
   * mutation's success contract. A post-commit socket/session lookup failure
   * must be observable in logs but cannot turn a durable write into a 5xx.
   */
  private async bestEffortDelivery(
    kind: string,
    deliver: () => Promise<void>,
  ): Promise<void> {
    try {
      await deliver();
    } catch (err) {
      logger.warn({ err, kind }, "[realtime] best-effort delivery failed");
    }
  }

  /**
   * Legacy list/detail clients still listen for conversation:updated. Recheck
   * each destination socket rather than trusting a user room or a stale member
   * list. A removed member gets only the established access-revoked envelope.
   */
  private async emitAuthorizedConversationUpdateToUser(userId: number, conversationId: number): Promise<void> {
    if (!this.io) return;
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const rawSocket of sockets) {
      const socket = rawSocket as unknown as RealtimeSocket;
      const currentUser = await this.refreshSocketUser(socket);
      if (currentUser?.id !== userId) continue;
      if (await canAccessConversation(conversationId, currentUser)) {
        socket.emit("conversation:updated", { convId: conversationId });
      } else {
        await socket.leave(conversationRoom(conversationId));
        socket.emit("conversation:access", {
          conversationId,
          allowed: false,
          reason: "access_revoked",
        });
      }
    }
  }

  private hasRealtimePermission(user: OperationalRecordAccessUser, permission: string): boolean {
    return hasPerm(permissionsFor(accessUserForPermissions(user)), permission);
  }

  private async canAccessSupportingEvent(
    user: ConversationAccessUser & OperationalRecordAccessUser,
    event: DomainEvent,
  ): Promise<boolean> {
    const entityType = parseSupportingEntityType(event.entityType);
    if (!entityType) return false;

    if (entityType === "notification") return false;
    if (entityType === "user") return this.hasRealtimePermission(user, "users.view");
    if (entityType === "conversation") return canAccessConversation(event.entityId, user);
    if (entityType === "attachment_reconciliation") {
      return this.hasRealtimePermission(user, "storage.admin");
    }
    if (entityType === "file" || entityType === "program_resource") {
      return this.hasRealtimePermission(user, "program_resources.view")
        || this.hasRealtimePermission(user, "documents.view");
    }
    if (entityType === "attachment") {
      const attachment = await pool.query<{ parentType: string; parentId: number }>(
        `SELECT parent_type AS "parentType", parent_id AS "parentId"
         FROM attachments WHERE id = $1`,
        [event.entityId],
      );
      const parent = attachment.rows[0];
      if (!parent || (parent.parentType !== "plan" && parent.parentType !== "risk")) return false;
      return canAccessOperationalRecord(user, parent.parentType, parent.parentId);
    }

    // State rows may be used as location reference data by authenticated HQ
    // roles only while active. State-scoped roles can receive the event only for
    // their own state; inactive rows remain registry-admin-only.
    const state = await pool.query<{ operationalStatus: string }>(
      `SELECT operational_status AS "operationalStatus" FROM states WHERE id = $1`,
      [event.entityId],
    );
    if (!state.rows[0]) return false;
    const isRegistryAdmin = user.role === "super_admin"
      || user.role === "executive_director"
      || user.role === "program_manager";
    if (isRegistryAdmin) return true;
    if (user.role === "state_office_manager" || user.role === "state_program_officer") {
      return user.stateId !== null && user.stateId === event.entityId;
    }
    return state.rows[0].operationalStatus === "active";
  }

  private async emitAuthorizedSupportingEventToUser(userId: number, event: DomainEvent): Promise<void> {
    if (!this.io) return;
    const sockets = await this.io.in(`user:${userId}`).fetchSockets();
    for (const rawSocket of sockets) {
      const socket = rawSocket as unknown as RealtimeSocket;
      const currentUser = await this.refreshSocketUser(socket);
      if (!currentUser || currentUser.id !== userId) continue;
      socket.emit("domain:event", event);
    }
  }

  private async emitAuthorizedSupportingEvent(event: DomainEvent): Promise<void> {
    if (!this.io) return;
    const sockets = await this.operationalTransport.allCandidateSockets();
    for (const socket of sockets) {
      const currentUser = await this.refreshSocketUser(socket);
      const allowed = currentUser
        ? await this.canAccessSupportingEvent(currentUser, event)
        : false;
      if (allowed) socket.emit("domain:event", event);
    }
  }
}

export const realtime = new RealtimeService();

/**
 * Transaction-local queue for duplicate-safe invalidation events.
 *
 * The owner calls flush() immediately after COMMIT and discard() from a
 * rollback path. This small boundary prevents the common error of emitting a
 * successful change before a database transaction has become durable.
 */
export class PostCommitDomainEvents {
  private readonly queued: DomainEventInput[] = [];
  private settled = false;

  constructor(private readonly publish: (event: DomainEventInput) => Promise<void>) {}

  enqueue(event: DomainEventInput): void {
    if (this.settled) throw new Error("post_commit_events_already_settled");
    // Validate now, so a bad event cannot surface after a database commit.
    createDomainEvent(event);
    this.queued.push(event);
  }

  async flush(): Promise<void> {
    if (this.settled) return;
    this.settled = true;
    await Promise.all(this.queued.map((event) => this.publish(event)));
  }

  discard(): void {
    this.settled = true;
    this.queued.length = 0;
  }
}

export type SupportingEntityType = (typeof SUPPORTING_ENTITY_TYPES)[number];

export type RealtimeEntityType = OperationalEntityType | SupportingEntityType;

export function parseRealtimeEntityType(value: unknown): RealtimeEntityType | null {
  return parseOperationalEntityType(value) ?? parseSupportingEntityType(value);
}
