import { Hono } from "hono";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  logAudit,
  hasPerm,
  permissionsFor,
  tcSectorRestriction,
  assertSectorAllowed,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { assertActiveState } from "../lib/state-master";
import { canAccessConversation, isConversationMember } from "../lib/conversation-auth";
import {
  conversationAttachmentAt,
  normaliseIncomingConversationAttachments,
  publicConversationAttachments,
} from "../lib/conversation-attachments";
import {
  ObjectNotFoundError,
  getObjectEntityFile,
  getObjectEntityMetadata,
  finalizeObjectEntityUpload,
  downloadObject,
  deleteObject,
} from "../lib/storage";
import { UploadTokenError, verifyUploadToken } from "../lib/upload-token";
import { contentDispositionHeader } from "../lib/content-disposition";
import {
  broadcastConversationUpdate,
  broadcastMessage,
  broadcastPersonalConversationUpdate,
  isUserOnline,
} from "../lib/realtime";

/**
 * Ported from artifacts/api-server/src/routes/conversations.ts (1904 lines).
 * The Communication Centre: conversations (direct/group/project/state/sector/
 * announcement), messages (with reply/forward/reactions/pin/edit/delete/hide),
 * and message attachments through the same ATT-02 upload-token verification
 * pattern used everywhere else in this migration.
 *
 * realtime.broadcast* / realtime.isUserOnline are now wired (Durable Objects
 * phase, see lib/realtime.ts) — all 13 call sites, matching the source
 * exactly. Still dropped — deferred to the separate notifications-engine
 * port: createNotificationDeduped. Every other call — auditing,
 * message_mentions inserts, the actual attachment verification/finalisation,
 * all scope guards — is preserved.
 */

const SAFE_INLINE_ATTACHMENT_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);

/* ── role helpers ──────────────────────────────────────────────── */
const ADMIN_ROLES = ["super_admin", "executive_director", "program_manager", "senior_program_coordinator"] as const;
type AdminRole = (typeof ADMIN_ROLES)[number];
function isAdminRole(role: string): role is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(role);
}

// Roles allowed to broadcast org-wide announcements (PM and above only)
const ANNOUNCEMENT_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);

const PIN_ROLES = new Set(["super_admin", "executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"]);

/* ── member guard ──────────────────────────────────────────────── */
async function assertMember(db: QueryExecutor, convId: number, userId: number): Promise<boolean> {
  return isConversationMember(db, convId, userId);
}

/**
 * Returns true when the user may access the conversation.
 * Members always have access. PM/super_admin bypass membership for non-direct
 * (group/project/state/sector/announcement) conversations.
 * Direct message privacy is always enforced regardless of role.
 */
async function assertMemberOrFullAccess(db: QueryExecutor, convId: number, user: CurrentUser): Promise<boolean> {
  return canAccessConversation(db, convId, user);
}

function publicMessage<T extends Record<string, unknown>>(message: T): T {
  const id = Number(message.id);
  const conversationId = Number(message.conversationId);
  if (!Number.isInteger(id) || !Number.isInteger(conversationId)) return message;
  return {
    ...message,
    attachments: publicConversationAttachments(conversationId, id, message.attachments),
  };
}

type HistoryCursor = { createdAt: string; id: number };
type ConversationCursor = { activityAt: string; id: number };

function encodeHistoryCursor(cursor: HistoryCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeHistoryCursor(value: unknown): HistoryCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 256) throw new Error("invalid_cursor");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" || decoded === null ||
      typeof (decoded as Record<string, unknown>).createdAt !== "string" ||
      !Number.isSafeInteger((decoded as Record<string, unknown>).id)
    ) throw new Error("invalid_cursor");
    const createdAt = (decoded as Record<string, unknown>).createdAt as string;
    if (Number.isNaN(Date.parse(createdAt))) throw new Error("invalid_cursor");
    return { createdAt, id: (decoded as Record<string, unknown>).id as number };
  } catch {
    throw new Error("invalid_cursor");
  }
}

function encodeConversationCursor(cursor: ConversationCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

function decodeConversationCursor(value: unknown): ConversationCursor | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 256) throw new Error("invalid_cursor");
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof decoded !== "object" || decoded === null ||
      typeof (decoded as Record<string, unknown>).activityAt !== "string" ||
      !Number.isSafeInteger((decoded as Record<string, unknown>).id)
    ) throw new Error("invalid_cursor");
    const activityAt = (decoded as Record<string, unknown>).activityAt as string;
    const id = (decoded as Record<string, unknown>).id as number;
    if (id <= 0 || Number.isNaN(Date.parse(activityAt))) throw new Error("invalid_cursor");
    return { activityAt, id };
  } catch {
    throw new Error("invalid_cursor");
  }
}

/**
 * Parses a path parameter as a strictly positive integer.
 * Rejects floats ("1.5"), NaN, and non-numeric strings.
 * Returns null when the value is invalid.
 */
function parsePositiveInt(raw: string | undefined): number | null {
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getConvById(db: QueryExecutor, convId: number, user: CurrentUser) {
  const r = await db.query<{
    id: number; type: string; name: string | null;
    projectId: number | null; stateId: number | null; sector: string | null;
    createdById: number; createdAt: string; updatedAt: string;
  }>(
    `SELECT id, type, name, project_id AS "projectId", state_id AS "stateId",
            sector, created_by_id AS "createdById",
            created_at AS "createdAt", updated_at AS "updatedAt"
     FROM conversations WHERE id=$1`,
    [convId],
  );
  if (!r.rows[0]) return null;
  const hasAccess = await assertMemberOrFullAccess(db, convId, user);
  if (!hasAccess) return null;
  return r.rows[0];
}

export const conversationsRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

conversationsRoutes.use("/conversations", attachCurrentUser, requireAuth);
conversationsRoutes.use("/conversations/*", attachCurrentUser, requireAuth);
conversationsRoutes.use("/messages/*", attachCurrentUser, requireAuth);

/* ── GET /conversations/unread-count ───────────────────────────── */
conversationsRoutes.get("/conversations/unread-count", async (c) => {
  const userId = c.get("currentUser")!.id;
  const { db, close } = openDb(c);
  try {
    const r = await db.query<{ total: string }>(
      `SELECT COUNT(m.id)::text AS total
       FROM messages m
       JOIN conversation_members cm ON cm.conversation_id = m.conversation_id AND cm.user_id = $1
       WHERE m.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM message_user_hides muh
            WHERE muh.message_id=m.id AND muh.user_id=$1
          )
         AND m.sender_id != $1
         AND m.created_at > COALESCE(cm.last_read_at, '1970-01-01'::timestamptz)`,
      [userId],
    );
    return c.json({ total: parseInt(r.rows[0]?.total ?? "0", 10) });
  } finally {
    close();
  }
});

/* ── GET /conversations ─────────────────────────────────────────── */
conversationsRoutes.get("/conversations", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const q = c.req.query();
    const rawType = q.type;
    const rawSearch = q.search;
    const rawUnread = q.unread;
    const rawLimit = q.limit ?? "50";
    if (!/^\d+$/.test(rawLimit)) return c.json({ error: "invalid_limit" }, 400);
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ error: "invalid_limit" }, 400);
    const supportedTypes = new Set(["direct", "group", "project", "state", "sector", "system", "announcement"]);
    if (rawType !== undefined && !supportedTypes.has(rawType)) return c.json({ error: "invalid_type" }, 400);
    if (rawUnread !== undefined && rawUnread !== "true" && rawUnread !== "false") return c.json({ error: "invalid_unread" }, 400);
    if (rawSearch !== undefined && rawSearch.length > 100) return c.json({ error: "invalid_search" }, 400);
    let cursor: ConversationCursor | null;
    try {
      cursor = decodeConversationCursor(q.cursor);
    } catch {
      return c.json({ error: "invalid_cursor" }, 400);
    }
    const type = rawType;
    const search = rawSearch?.trim();
    const unread = rawUnread;

    // Full Operational Access (PM/super_admin): LEFT JOIN so non-member conversations are
    // included, then filter to own conversations OR any non-direct conversation.
    // DM privacy is always enforced — direct conversations require actual membership.
    const isFullAccess = user.role === "program_manager" || user.role === "super_admin";
    const memberJoin = isFullAccess
      ? `LEFT JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1`
      : `JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.user_id = $1`;

    const whereConditions: string[] = [];
    const params: unknown[] = [userId];
    let p = 2;

    // Full-access: include enrolled conversations + all non-DM conversations
    if (isFullAccess) whereConditions.push(`(cm.user_id IS NOT NULL OR c.type != 'direct')`);

    if (type) { whereConditions.push(`c.type = $${p++}`); params.push(type); }
    // A personal unread state exists only for a member. Operational viewers of
    // non-direct conversations deliberately have no unread count or unread filter
    // match rather than a fabricated "everything since 1970" result.
    if (unread === "true") whereConditions.push(`COALESCE(uc.unread_count, 0) > 0`);

    /* ── M-02: Full-text search across name, content, participants, meta ── */
    if (search) {
      const sp = p++;
      params.push(`%${search}%`);
      whereConditions.push(`(
          c.name ILIKE $${sp}
          OR c.sector ILIKE $${sp}
          OR lm.body ILIKE $${sp}
          OR EXISTS (
            SELECT 1 FROM messages m_s
            WHERE m_s.conversation_id=c.id AND m_s.body ILIKE $${sp} AND m_s.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM message_user_hides muh
                WHERE muh.message_id=m_s.id AND muh.user_id=$1
              )
          )
          OR EXISTS (
            SELECT 1 FROM users u_s
            JOIN conversation_members cm_s ON cm_s.user_id=u_s.id AND cm_s.conversation_id=c.id
            WHERE u_s.name ILIKE $${sp}
          )
          OR EXISTS (SELECT 1 FROM states st WHERE st.id=c.state_id AND st.name ILIKE $${sp})
          OR EXISTS (SELECT 1 FROM projects pj WHERE pj.id=c.project_id AND pj.title ILIKE $${sp})
        )`);
    }

    if (cursor) {
      whereConditions.push(`(COALESCE(lm.created_at, c.updated_at), c.id) < ($${p++}::timestamptz, $${p++})`);
      params.push(cursor.activityAt, cursor.id);
    }

    const listLimitParam = p++;
    params.push(limit + 1);
    const whereClause = whereConditions.length ? `WHERE ${whereConditions.join(" AND ")}` : "";

    const rows = await db.query<Record<string, unknown>>(
      `WITH visible_messages AS (
         SELECT m.id, m.conversation_id, m.body, m.sender_id, m.created_at
         FROM messages m
         WHERE m.deleted_at IS NULL
           AND NOT EXISTS (
             SELECT 1 FROM message_user_hides muh
             WHERE muh.message_id=m.id AND muh.user_id=$1
           )
       ),
       last_msg AS (
         SELECT DISTINCT ON (conversation_id)
           conversation_id, id, body, sender_id, created_at
          FROM visible_messages
          ORDER BY conversation_id, created_at DESC, id DESC
       ),
       unread_counts AS (
         SELECT vm.conversation_id, COUNT(*)::int AS unread_count
         FROM visible_messages vm
         JOIN conversation_members own_cm
           ON own_cm.conversation_id=vm.conversation_id AND own_cm.user_id=$1
         WHERE vm.sender_id!=$1
           AND vm.created_at > COALESCE(own_cm.last_read_at, '1970-01-01'::timestamptz)
         GROUP BY vm.conversation_id
       )
       SELECT
         c.id, c.type, c.name,
         c.project_id AS "projectId", c.state_id AS "stateId", c.sector,
         c.created_at AS "createdAt", c.updated_at AS "updatedAt",
         lm.body AS "lastMessageBody",
         lm.created_at AS "lastMessageAt",
         u_lm.name AS "lastMessageSenderName",
          CASE WHEN cm.user_id IS NULL THEN NULL ELSE COALESCE(uc.unread_count, 0) END AS "unreadCount",
          COALESCE(lm.created_at, c.updated_at) AS "activityAt",
         (SELECT COUNT(*)::int FROM conversation_members cm2 WHERE cm2.conversation_id=c.id) AS "memberCount",
         CASE WHEN c.type='direct' THEN (
           SELECT u2.name FROM conversation_members cm2
           JOIN users u2 ON u2.id=cm2.user_id
           WHERE cm2.conversation_id=c.id AND cm2.user_id!=$1
           LIMIT 1
         ) END AS "otherMemberName",
         CASE WHEN c.type='direct' THEN (
           SELECT u2.role_label FROM conversation_members cm2
           JOIN users u2 ON u2.id=cm2.user_id
           WHERE cm2.conversation_id=c.id AND cm2.user_id!=$1
           LIMIT 1
         ) END AS "otherMemberRoleLabel",
         CASE WHEN c.type='direct' THEN (
           SELECT s.name FROM conversation_members cm2
           JOIN users u2 ON u2.id=cm2.user_id
           LEFT JOIN states s ON s.id=u2.state_id
           WHERE cm2.conversation_id=c.id AND cm2.user_id!=$1
           LIMIT 1
         ) END AS "otherMemberStateName",
         CASE WHEN c.type='direct' THEN (
           SELECT cm2.user_id FROM conversation_members cm2
           WHERE cm2.conversation_id=c.id AND cm2.user_id!=$1
           LIMIT 1
         ) END AS "otherMemberId"
       FROM conversations c
       ${memberJoin}
       LEFT JOIN last_msg lm ON lm.conversation_id=c.id
       LEFT JOIN users u_lm ON u_lm.id=lm.sender_id
        LEFT JOIN unread_counts uc ON uc.conversation_id=c.id
       ${whereClause}
        ORDER BY COALESCE(lm.created_at, c.updated_at) DESC, c.id DESC
        LIMIT $${listLimitParam}`,
      params,
    );
    const hasMore = rows.rows.length > limit;
    const itemsWithCursor = hasMore ? rows.rows.slice(0, limit) : rows.rows;
    const lastItem = itemsWithCursor.at(-1) as { activityAt?: string; id?: number } | undefined;
    const items = itemsWithCursor.map(({ activityAt: _activityAt, ...item }) => item);
    return c.json({
      items,
      hasMore,
      nextCursor: hasMore && lastItem?.activityAt && lastItem.id
        ? encodeConversationCursor({
          activityAt: new Date(lastItem.activityAt).toISOString(),
          id: Number(lastItem.id),
        })
        : null,
    });
  } finally {
    close();
  }
});

/* ── POST /conversations ─────────────────────────────────────────── */
conversationsRoutes.post("/conversations", requirePerm("messages.create"), async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, pool, close } = openDb(c);
  try {
    const body = (await c.req.json().catch(() => ({}))) as {
      type?: string; name?: string; memberIds?: number[];
      projectId?: number; stateId?: number; sector?: string;
      targetAll?: boolean; targetStateId?: number; targetSector?: string; targetRole?: string;
    };
    const {
      type = "direct", name, memberIds = [],
      projectId, stateId, sector,
      /* M-03 announcement targeting */
      targetAll, targetStateId, targetSector, targetRole,
    } = body;

    if (!Array.isArray(memberIds) || memberIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      return c.json({ error: "invalid_members" }, 400);
    }

    /* ── M-04: Strict sector validation ──────────────────────────── */
    if (type === "sector") {
      if (!sector || !VALID_SECTOR_SET.has(sector)) {
        return c.json({
          error: "invalid_sector",
          message: `Sector must be one of: ${[...VALID_SECTOR_SET].join(", ")}`,
        }, 400);
      }
    }

    /* ── M-03: Announcement — restricted creation ────────────────── */
    if (type === "announcement") {
      if (!ANNOUNCEMENT_ROLES.has(user.role)) {
        return c.json({ error: "forbidden", message: "Only Program Managers and above may send announcements." }, 403);
      }
      if (!name?.trim()) {
        return c.json({ error: "name_required", message: "Announcement subject is required." }, 400);
      }
    }

    /* ── C-01 AUTHORIZATION GUARDS ─────────────────────────────── */
    if (type === "state") {
      const activeState = Number.isInteger(stateId) && stateId ? await assertActiveState(db, stateId) : null;
      if (!activeState?.ok) {
        if (activeState && "error" in activeState && activeState.error === "inactive_state") {
          return c.json({ error: "inactive_state" }, 422);
        }
        return c.json({ error: "state_not_found" }, 404);
      }
      const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";
      if (isStateRole) {
        if (!stateId || user.stateId !== stateId) {
          return c.json({ error: "state_forbidden", message: "You may only create state conversations for your assigned state." }, 403);
        }
      }
    }

    if (type === "sector") {
      const sectorRestriction = tcSectorRestriction(user);
      if (sectorRestriction !== null) {
        if (!sectorRestriction.includes(sector!)) {
          return c.json({ error: "sector_forbidden", message: "You may only create sector conversations for your assigned sector(s)." }, 403);
        }
      }
    }

    if (type === "project") {
      if (!projectId) {
        return c.json({ error: "projectId required for project conversations" }, 400);
      }
      const projectExists = await db.query<{ sector: string | null }>(
        `SELECT sector FROM projects WHERE id=$1`, [projectId],
      );
      if (!projectExists.rows[0]) {
        return c.json({ error: "project_not_found" }, 404);
      }
      const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";
      if (isStateRole) {
        const stateCheck = await db.query(
          `SELECT 1 FROM project_states ps WHERE ps.project_id=$1 AND ps.state_id=$2
           UNION ALL
           SELECT 1 FROM project_assignments pa WHERE pa.project_id=$1 AND pa.user_id=$3
           LIMIT 1`,
          [projectId, user.stateId ?? -1, userId],
        );
        if (stateCheck.rows.length === 0) {
          return c.json({ error: "project_state_forbidden", message: "You may only create project conversations for projects in your assigned state." }, 403);
        }
      }
      const sectorRestriction = tcSectorRestriction(user);
      if (sectorRestriction !== null) {
        const guard = assertSectorAllowed(user, projectExists.rows[0].sector);
        if (!guard.ok) {
          return c.json({ ...guard.body, message: "You may only create project conversations for projects in your assigned sector(s)." }, guard.status as 403);
        }
      }
    }
    /* ── END AUTHORIZATION GUARDS ───────────────────────────────── */

    let allMemberIds: number[] = [...new Set([userId, ...memberIds])];
    const requestedOtherMemberIds = allMemberIds.filter((id) => id !== userId);
    if (requestedOtherMemberIds.length > 0) {
      const requestedUsers = await db.query<{ id: number; status: string }>(
        `SELECT id, status FROM users WHERE id = ANY($1::int[])`,
        [requestedOtherMemberIds],
      );
      if (
        requestedUsers.rows.length !== requestedOtherMemberIds.length ||
        requestedUsers.rows.some((member) => member.status !== "active")
      ) {
        return c.json({ error: "invalid_or_inactive_member" }, 400);
      }
    }

    if (type === "direct") {
      if (allMemberIds.length !== 2) {
        return c.json({ error: "Direct conversations require exactly 2 members" }, 400);
      }
    }

    // Auto-enroll members by type
    if (type === "project" && projectId) {
      const assigned = await db.query<{ user_id: number }>(
        `SELECT pa.user_id FROM project_assignments pa
         JOIN users u ON u.id=pa.user_id AND u.status='active'
         WHERE pa.project_id=$1`,
        [projectId],
      );
      allMemberIds = [...new Set([...allMemberIds, ...assigned.rows.map((r) => r.user_id)])];
    }
    if (type === "state" && stateId) {
      const stateUsers = await db.query<{ id: number }>(
        `SELECT id FROM users WHERE state_id=$1 AND status='active'`,
        [stateId],
      );
      allMemberIds = [...new Set([...allMemberIds, ...stateUsers.rows.map((r) => r.id)])];
    }
    /* ── M-04: Exact sector match for member auto-enrollment ──── */
    if (type === "sector" && sector) {
      const sectorUsers = await db.query<{ id: number }>(
        `SELECT id FROM users WHERE status='active' AND (
           sector = $1
           OR sector LIKE $1 || ',%'
           OR sector LIKE '%,' || $1
           OR sector LIKE '%,' || $1 || ',%'
         )`,
        [sector],
      );
      allMemberIds = [...new Set([...allMemberIds, ...sectorUsers.rows.map((r) => r.id)])];
    }

    /* ── M-03: Announcement — resolve recipients ─────────────────── */
    if (type === "announcement") {
      let recipientQuery = `SELECT id FROM users WHERE status='active'`;
      const rParams: unknown[] = [];
      let rp = 1;
      if (targetAll) {
        // all active — base query already covers this
      } else if (targetStateId) {
        recipientQuery += ` AND state_id=$${rp++}`;
        rParams.push(targetStateId);
      } else if (targetSector) {
        if (!VALID_SECTOR_SET.has(targetSector)) {
          return c.json({ error: "invalid_sector" }, 400);
        }
        recipientQuery += ` AND (sector=$${rp} OR sector LIKE $${rp} || ',%%' OR sector LIKE '%%,' || $${rp} OR sector LIKE '%%,' || $${rp} || ',%%')`;
        rParams.push(targetSector); rp++;
      } else if (targetRole) {
        recipientQuery += ` AND role=$${rp++}`;
        rParams.push(targetRole);
      } else {
        // Fail closed: no recognised target field was sent. Every other
        // branch here narrows the recipient set explicitly; silently falling
        // through to the unfiltered base query would broadcast to every
        // active user in the system — the same blast radius as
        // targetAll:true — for a caller (a future client, a script) that
        // never asked for that.
        return c.json({ error: "announcement_target_required" }, 400);
      }
      const recipients = await db.query<{ id: number }>(recipientQuery, rParams);
      allMemberIds = [...new Set([userId, ...recipients.rows.map((r) => r.id)])];
    }

    const client = await pool.connect();
    let convId = 0;
    let createdConversation = false;
    try {
      await client.query("BEGIN");
      const insertConversation = async () => {
        const convResult = await client.query<{ id: number }>(
          `INSERT INTO conversations (type, name, project_id, state_id, sector, created_by_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [type, name ?? null, projectId ?? null, stateId ?? null, sector ?? null, userId],
        );
        convId = convResult.rows[0].id;
        for (const mid of allMemberIds) {
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)`,
            [convId, mid],
          );
        }
        createdConversation = true;
      };

      if (type === "direct") {
        const [lowUserId, highUserId] = [...allMemberIds].sort((a, b) => a - b);
        await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [lowUserId, highUserId]);
        const key = await client.query<{ conversation_id: number }>(
          `SELECT conversation_id FROM direct_conversation_keys
           WHERE user_low_id=$1 AND user_high_id=$2`,
          [lowUserId, highUserId],
        );
        if (key.rows[0]) {
          convId = key.rows[0].conversation_id;
        } else {
          const historical = await client.query<{ id: number }>(
            `SELECT c.id
             FROM conversations c
             JOIN conversation_members cm ON cm.conversation_id=c.id
             WHERE c.type='direct'
             GROUP BY c.id
             HAVING COUNT(DISTINCT cm.user_id)=2
                AND BOOL_AND(cm.user_id = ANY(ARRAY[$1::int,$2::int]))
             ORDER BY c.id ASC
             LIMIT 1`,
            [lowUserId, highUserId],
          );
          if (historical.rows[0]) {
            convId = historical.rows[0].id;
            await client.query(
              `INSERT INTO direct_conversation_keys (user_low_id, user_high_id, conversation_id)
               VALUES ($1,$2,$3) ON CONFLICT (user_low_id, user_high_id) DO NOTHING`,
              [lowUserId, highUserId, convId],
            );
          } else {
            await insertConversation();
            await client.query(
              `INSERT INTO direct_conversation_keys (user_low_id, user_high_id, conversation_id)
               VALUES ($1,$2,$3)`,
              [lowUserId, highUserId, convId],
            );
          }
        }
      } else {
        const organisationalKey = type === "project" ? `project:${projectId}`
          : type === "state" ? `state:${stateId}`
            : type === "sector" ? `sector:${sector}`
              : null;
        if (organisationalKey) {
          await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [organisationalKey]);
          const key = await client.query<{ conversation_id: number }>(
            `SELECT conversation_id FROM organisational_conversation_keys WHERE entity_key=$1`,
            [organisationalKey],
          );
          if (key.rows[0]) {
            convId = key.rows[0].conversation_id;
          } else {
            const historical = await client.query<{ id: number }>(
              type === "project"
                ? `SELECT id FROM conversations WHERE type='project' AND project_id=$1 ORDER BY id ASC LIMIT 1`
                : type === "state"
                  ? `SELECT id FROM conversations WHERE type='state' AND state_id=$1 ORDER BY id ASC LIMIT 1`
                  : `SELECT id FROM conversations WHERE type='sector' AND sector=$1 ORDER BY id ASC LIMIT 1`,
              [type === "project" ? projectId! : type === "state" ? stateId! : sector!],
            );
            if (historical.rows[0]) {
              convId = historical.rows[0].id;
              await client.query(
                `INSERT INTO organisational_conversation_keys (entity_key, conversation_id)
                 VALUES ($1,$2) ON CONFLICT (entity_key) DO NOTHING`,
                [organisationalKey, convId],
              );
            } else {
              await insertConversation();
              await client.query(
                `INSERT INTO organisational_conversation_keys (entity_key, conversation_id) VALUES ($1,$2)`,
                [organisationalKey, convId],
              );
            }
          }
        } else {
          await insertConversation();
        }
      }

      if (!createdConversation) {
        // Reusing an existing direct/project/state/sector conversation (found
        // via its key table or, for legacy rows, the historical fallback
        // query) never inserted allMemberIds — the requesting user plus any
        // project/state/sector members auto-enrolled above — into
        // conversation_members. A member who joined the project/state/sector
        // after the conversation was first created (or the very requester,
        // on their first visit) would get a 200 here but then 403 on the next
        // GET, since conversation access requires actual membership. Sync the
        // gap now, still inside the advisory-locked transaction so a
        // concurrent create/reuse of the same conversation can't race this.
        const existingMembers = await client.query<{ user_id: number }>(
          `SELECT user_id FROM conversation_members WHERE conversation_id = $1`,
          [convId],
        );
        const existingMemberIds = new Set(existingMembers.rows.map((row) => row.user_id));
        const missingMemberIds = allMemberIds.filter((id) => !existingMemberIds.has(id));
        for (const mid of missingMemberIds) {
          await client.query(
            `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1, $2)`,
            [convId, mid],
          );
        }
      }
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }

    if (!createdConversation) {
      const existing = await db.query(
        `SELECT id, type, name, project_id AS "projectId", state_id AS "stateId",
                sector, created_by_id AS "createdById",
                created_at AS "createdAt", updated_at AS "updatedAt",
                (SELECT COUNT(DISTINCT user_id)::int FROM conversation_members WHERE conversation_id=c.id) AS "memberCount",
                0 AS "unreadCount", NULL AS "lastMessageBody", NULL AS "lastMessageAt",
                NULL AS "lastMessageSenderName"
         FROM conversations c WHERE c.id=$1`,
        [convId],
      );
      return c.json(existing.rows[0]);
    }

    await logAudit(db, { userId, action: "create", module: "conversation", entityId: convId, newValue: JSON.stringify({ type, name }) });
    await broadcastConversationUpdate(c.env, allMemberIds, convId, { change: "conversation:updated", actorId: userId, actorName: user.name });

    /* M-03: Notification creation dropped (not-yet-built notification engine). */

    const conv = await db.query(
      `SELECT id, type, name, project_id AS "projectId", state_id AS "stateId",
              sector, created_by_id AS "createdById",
              created_at AS "createdAt", updated_at AS "updatedAt",
              (SELECT COUNT(*)::int FROM conversation_members WHERE conversation_id=c.id) AS "memberCount",
              0 AS "unreadCount", NULL AS "lastMessageBody", NULL AS "lastMessageAt",
              NULL AS "lastMessageSenderName"
       FROM conversations c WHERE c.id=$1`,
      [convId],
    );
    return c.json(conv.rows[0], 201);
  } finally {
    close();
  }
});

/* ── GET /conversations/:id ─────────────────────────────────────── */
conversationsRoutes.get("/conversations/:id", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const conv = await getConvById(db, convId, user);
    if (!conv) return c.json({ error: "not_found" }, 404);

    const members = await db.query<{ id: number; name: string; role: string; roleLabel: string; lastSeenAt: string | null; isAdmin: boolean }>(
      `SELECT u.id, u.name, u.role, u.role_label AS "roleLabel", u.last_seen_at AS "lastSeenAt",
              cm.is_admin AS "isAdmin"
       FROM conversation_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.conversation_id=$1 ORDER BY u.name`,
      [convId],
    );
    const lastMsg = await db.query<{ body: string; lastMessageAt: string; lastMessageSenderName: string }>(
      `SELECT m.body, m.created_at AS "lastMessageAt", u.name AS "lastMessageSenderName"
       FROM messages m JOIN users u ON u.id=m.sender_id
       WHERE m.conversation_id=$1 AND m.deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=m.id AND muh.user_id=$2
         )
       ORDER BY m.created_at DESC LIMIT 1`,
      [convId, userId],
    );
    const unread = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM messages m
       JOIN conversation_members cm ON cm.conversation_id=m.conversation_id AND cm.user_id=$1
       WHERE m.conversation_id=$2 AND m.deleted_at IS NULL
         AND m.sender_id!=$1
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=m.id AND muh.user_id=$1
         )
         AND m.created_at > COALESCE(cm.last_read_at,'1970-01-01'::timestamptz)`,
      [userId, convId],
    );
    const membersWithPresence = await Promise.all(
      members.rows.map(async (member) => ({ ...member, isOnline: await isUserOnline(c.env, member.id) })),
    );
    return c.json({
      ...conv,
      members: membersWithPresence,
      memberCount: members.rows.length,
      lastMessageBody: lastMsg.rows[0]?.body ?? null,
      lastMessageAt: lastMsg.rows[0]?.lastMessageAt ?? null,
      lastMessageSenderName: lastMsg.rows[0]?.lastMessageSenderName ?? null,
      unreadCount: parseInt(unread.rows[0]?.count ?? "0", 10),
    });
  } finally {
    close();
  }
});

/* ── PATCH /conversations/:id ───────────────────────────────────── */
conversationsRoutes.patch("/conversations/:id", requirePerm("messages.manage_members"), async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const conv = await db.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`, [convId],
    );
    if (!conv.rows[0]) return c.json({ error: "not_found" }, 404);
    if (conv.rows[0].type === "direct") {
      return c.json({ error: "cannot rename direct conversations" }, 400);
    }
    const isCreator = conv.rows[0].created_by_id === userId;
    if (!isCreator && !isAdminRole(user.role)) {
      return c.json({ error: "forbidden", message: "Only the conversation creator or a manager may rename it." }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as { name?: string; description?: string };
    const { name, description } = body;
    if (!name?.trim()) return c.json({ error: "name is required" }, 400);

    await db.query(
      `UPDATE conversations SET name=$1, updated_at=NOW() WHERE id=$2`,
      [name.trim(), convId],
    );
    await logAudit(db, { userId, action: "conversation_rename", module: "messages", entityId: convId, newValue: name.trim() });
    await broadcastConversationUpdate(c.env, [], convId, { change: "conversation:updated", actorId: userId, actorName: user.name });
    const updated = await getConvById(db, convId, user);
    return c.json({ ...updated, description });
  } finally {
    close();
  }
});

/* ── DELETE /conversations/:id/members/:userId ──────────────────── */
conversationsRoutes.delete("/conversations/:id/members/:memberId", requirePerm("messages.manage_members"), async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const memberId = parsePositiveInt(c.req.param("memberId"));
    if (!memberId) return c.json({ error: "invalid_member_id" }, 400);

    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const conv = await db.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`, [convId],
    );
    if (!conv.rows[0]) return c.json({ error: "not_found" }, 404);
    if (conv.rows[0].type === "direct") {
      return c.json({ error: "cannot remove members from direct conversations" }, 400);
    }
    const isCreator = conv.rows[0].created_by_id === userId;
    const isSelf = memberId === userId;
    if (!isCreator && !isAdminRole(user.role) && !isSelf) {
      return c.json({ error: "forbidden", message: "Only the conversation creator, a manager, or the member themselves may remove a member." }, 403);
    }
    // Cannot remove the creator (regardless of role)
    if (memberId === conv.rows[0].created_by_id) {
      return c.json({ error: "cannot_remove_creator", message: "The conversation creator cannot be removed. Transfer ownership first." }, 400);
    }

    await db.query(
      `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [convId, memberId],
    );
    await logAudit(db, { userId, action: "member_removed", module: "messages", entityId: convId, newValue: String(memberId) });
    await broadcastConversationUpdate(c.env, [memberId], convId, { change: "membership:changed", actorId: userId, actorName: user.name });
    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── POST /conversations/:id/members ────────────────────────────── */
conversationsRoutes.post("/conversations/:id/members", requirePerm("messages.manage_members"), async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, pool, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);

    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const conv = await db.query<{ created_by_id: number; type: string }>(
      `SELECT created_by_id, type FROM conversations WHERE id=$1`,
      [convId],
    );
    if (!conv.rows[0]) return c.json({ error: "not_found" }, 404);
    if (conv.rows[0].type === "direct") {
      return c.json({ error: "cannot_add_members_to_direct_conversation" }, 400);
    }

    const isCreator = conv.rows[0].created_by_id === userId;
    const isPrivileged = isAdminRole(user.role);
    if (!isCreator && !isPrivileged) {
      return c.json({ error: "forbidden", message: "Only the conversation creator, Program Manager, or Senior Coordinator may add members." }, 403);
    }

    const body = (await c.req.json().catch(() => ({}))) as { userId?: number };
    const newUserId = body.userId;
    if (!Number.isSafeInteger(newUserId) || (newUserId as number) <= 0) {
      return c.json({ error: "invalid_member_id" }, 400);
    }

    const userCheck = await db.query<{ id: number; status: string }>(
      `SELECT id, status FROM users WHERE id=$1`,
      [newUserId],
    );
    if (!userCheck.rows[0]) {
      return c.json({ error: "user_not_found" }, 400);
    }
    if (userCheck.rows[0].status !== "active") {
      return c.json({ error: "user_not_active", message: "Only active users may be added to conversations." }, 400);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [convId, newUserId]);
      const existingMember = await client.query(
        `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 LIMIT 1`,
        [convId, newUserId],
      );
      const added = !existingMember.rows[0];
      if (added) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)`,
          [convId, newUserId],
        );
      }
      await client.query("COMMIT");
      if (added) {
        await broadcastConversationUpdate(c.env, [newUserId as number], convId, { change: "membership:changed", actorId: userId, actorName: user.name });
      }
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { client.release(); }

    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── POST /conversations/:id/read ───────────────────────────────── */
conversationsRoutes.post("/conversations/:id/read", async (c) => {
  const userId = c.get("currentUser")!.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);

    // A read receipt is a membership state, not an operational-view override.
    // PM/Super Admin may view non-direct conversations without a membership row,
    // but must not receive a misleading success response for a receipt we cannot
    // persist (and must never be silently added as members).
    if (!await assertMember(db, convId, userId)) {
      return c.json({ error: "read_receipt_forbidden" }, 403);
    }
    const result = await db.query(
      `UPDATE conversation_members SET last_read_at=NOW()
       WHERE conversation_id=$1 AND user_id=$2`,
      [convId, userId],
    );
    if ((result.rowCount ?? 0) !== 1) {
      return c.json({ error: "read_receipt_forbidden" }, 403);
    }
    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── GET /conversations/:id/messages ────────────────────────────── */
conversationsRoutes.get("/conversations/:id/messages", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const q = c.req.query();
    const rawLimit = q.limit ?? "60";
    if (!/^\d+$/.test(rawLimit)) return c.json({ error: "invalid_limit" }, 400);
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return c.json({ error: "invalid_limit" }, 400);
    let cursor: HistoryCursor | null;
    try {
      cursor = decodeHistoryCursor(q.cursor);
    } catch {
      return c.json({ error: "invalid_cursor" }, 400);
    }

    const params: unknown[] = [convId, userId, limit + 1];
    if (cursor) params.push(cursor.createdAt, cursor.id);
    const r = await db.query<Record<string, unknown>>(
      `SELECT
         m.id, m.conversation_id AS "conversationId",
         m.sender_id AS "senderId", u.name AS "senderName", u.role_label AS "senderRoleLabel",
          CASE WHEN m.deletion_type = 'for_everyone' THEN NULL ELSE m.body END AS body,
          CASE WHEN m.deletion_type = 'for_everyone' THEN NULL ELSE m.attachments END AS attachments,
         m.reply_to_id AS "replyToId",
          m.edited_at AS "editedAt",
          CASE WHEN m.deletion_type = 'for_everyone' THEN m.deleted_at ELSE NULL END AS "deletedAt",
          CASE WHEN m.deletion_type = 'for_everyone' THEN m.deletion_type ELSE NULL END AS "deletionType",
         m.is_pinned AS "isPinned", m.pinned_by AS "pinnedBy", m.pinned_at AS "pinnedAt",
         m.forwarded_from_message_id AS "forwardedFromId",
         m.created_at AS "createdAt",
          CASE WHEN rm.deleted_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM message_user_hides rmh
            WHERE rmh.message_id=rm.id AND rmh.user_id=$2
          ) THEN rm.body ELSE NULL END AS "replyBody",
          CASE WHEN rm.deleted_at IS NULL AND NOT EXISTS (
            SELECT 1 FROM message_user_hides rmh
            WHERE rmh.message_id=rm.id AND rmh.user_id=$2
          ) THEN ru.name ELSE NULL END AS "replySenderName",
         (SELECT COALESCE(json_agg(
           json_build_object('emoji', r.emoji, 'userId', r.user_id, 'userName', u3.name)
           ORDER BY r.created_at ASC
         ), '[]'::json)
          FROM message_reactions r JOIN users u3 ON u3.id=r.user_id
          WHERE r.message_id=m.id) AS "reactions"
       FROM messages m
       JOIN users u ON u.id=m.sender_id
        LEFT JOIN messages rm ON rm.id=m.reply_to_id
          AND rm.conversation_id=m.conversation_id
          AND NOT EXISTS (
            SELECT 1 FROM message_user_hides rmh
            WHERE rmh.message_id=rm.id AND rmh.user_id=$2
          )
       LEFT JOIN users ru ON ru.id=rm.sender_id
       WHERE m.conversation_id=$1
          AND NOT EXISTS (
            SELECT 1 FROM message_user_hides muh
            WHERE muh.message_id=m.id AND muh.user_id=$2
          )
           AND (
             m.deletion_type IS DISTINCT FROM 'for_me'
             OR m.deleted_by IS DISTINCT FROM $2
           )
          ${cursor ? "AND (m.created_at, m.id) < ($4::timestamptz, $5)" : ""}
        ORDER BY m.created_at DESC, m.id DESC
       LIMIT $3`,
      params,
    );
    const hasMore = r.rows.length > limit;
    const newestFirst = hasMore ? r.rows.slice(0, limit) : r.rows;
    const oldest = newestFirst.at(-1);
    return c.json({
      items: newestFirst.reverse().map((message) => publicMessage(message)),
      hasMore,
      nextCursor: hasMore && oldest
        ? encodeHistoryCursor({ createdAt: new Date(oldest.createdAt as string).toISOString(), id: Number(oldest.id) })
        : null,
    });
  } finally {
    close();
  }
});

/* ── POST /conversations/:id/messages ───────────────────────────── */
conversationsRoutes.post("/conversations/:id/messages", requirePerm("messages.send"), async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, pool, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    /* ── M-03: Announcements are read-only for non-creators ──── */
    const convMeta = await db.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`,
      [convId],
    );
    if (convMeta.rows[0]?.type === "announcement") {
      const isCreator = convMeta.rows[0].created_by_id === userId;
      if (!isCreator && !isAdminRole(user.role)) {
        return c.json({ error: "announcement_readonly", message: "Announcements are read-only. Only the creator may post follow-ups." }, 403);
      }
    }

    const body = (await c.req.json().catch(() => ({}))) as {
      body?: unknown; replyToId?: number; attachments?: Array<Record<string, unknown>>; forwardedFromId?: number;
      mentionedUserIds?: unknown;
    };
    const { body: rawBody, replyToId, attachments, forwardedFromId, mentionedUserIds: rawMentionedUserIds } = body;
    const messageBody = typeof rawBody === "string" ? rawBody.trim() : "";
    if (!messageBody && !attachments?.length) {
      return c.json({ error: "body or attachments required" }, 400);
    }

    // Validate mentionedUserIds: must be an array of positive integers if present
    let rawMentionIds: number[] = [];
    if (rawMentionedUserIds !== undefined) {
      if (!Array.isArray(rawMentionedUserIds) || rawMentionedUserIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        return c.json({ error: "invalid_mentioned_user_ids" }, 422);
      }
      rawMentionIds = [...new Set(rawMentionedUserIds as number[])];
    }

    // Enforce max body length
    if (messageBody.length > 10_000) {
      return c.json({ error: "message_too_long", message: "Messages may not exceed 10,000 characters." }, 400);
    }

    // A finalised key has no canonical message reference until the transaction
    // commits. If any later validation or database action fails, clean up only
    // those newly-finalised objects so a user-initiated retry starts cleanly.
    const finalizedObjectPaths: string[] = [];
    const discardFinalizedAttachments = async () => {
      await Promise.all(
        finalizedObjectPaths.map((objectPath) =>
          deleteObject(c.env, objectPath).catch(() => undefined),
        ),
      );
      finalizedObjectPaths.length = 0;
    };

    let safeAttachments;
    try {
      safeAttachments = normaliseIncomingConversationAttachments(attachments);
    } catch {
      return c.json({ error: "invalid_attachment", message: "Each attachment must reference a private uploaded object." }, 422);
    }
    if (attachments && attachments.length > 0 && safeAttachments.length === 0) {
      return c.json({ error: "invalid_attachment" }, 422);
    }
    if (safeAttachments.length > 0 && !hasPerm(permissionsFor(user), "messages.attachments.upload")) {
      return c.json({
        error: "forbidden",
        message: "You do not have permission to perform this action.",
        requiredPermission: "messages.attachments.upload",
      }, 403);
    }
    if (safeAttachments.length > 0) {
      for (let index = 0; index < safeAttachments.length; index++) {
        const incoming = attachments?.[index];
        const uploadToken = typeof incoming === "object" && incoming !== null
          ? (incoming as { uploadToken?: unknown }).uploadToken
          : undefined;
        if (typeof uploadToken !== "string") {
          await discardFinalizedAttachments();
          return c.json({ error: "uploadToken is required for message attachments" }, 400);
        }

        let descriptor;
        try {
          descriptor = verifyUploadToken(uploadToken, c.env.SESSION_SECRET);
        } catch (err) {
          if (err instanceof UploadTokenError) {
            await discardFinalizedAttachments();
            return c.json({ error: "invalid_upload_token" }, 400);
          }
          throw err;
        }

        const attachment = safeAttachments[index];
        if (descriptor.userId !== userId) {
          await discardFinalizedAttachments();
          return c.json({ error: "upload_token_user_mismatch" }, 403);
        }
        if (descriptor.entityType !== "message_attachment" || descriptor.scope !== "messages" || descriptor.reportId !== 0) {
          await discardFinalizedAttachments();
          return c.json({ error: "upload_token_entity_type_mismatch" }, 400);
        }
        if (
          descriptor.objectPath !== attachment.objectPath ||
          descriptor.fileName !== attachment.name ||
          descriptor.contentType !== attachment.contentType ||
          descriptor.maxSize !== attachment.size
        ) {
          await discardFinalizedAttachments();
          return c.json({ error: "attachment_metadata_mismatch" }, 422);
        }

        let storedMetadata;
        try {
          storedMetadata = await getObjectEntityMetadata(c.env, attachment.objectPath);
        } catch (err) {
          if (err instanceof ObjectNotFoundError) {
            await discardFinalizedAttachments();
            return c.json({ error: "attachment_upload_missing" }, 422);
          }
          throw err;
        }
        if (storedMetadata.size !== descriptor.maxSize) {
          await discardFinalizedAttachments();
          return c.json({ error: "attachment_size_mismatch" }, 422);
        }
        const storedContentType = storedMetadata.contentType
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (storedContentType !== descriptor.contentType) {
          await discardFinalizedAttachments();
          return c.json({ error: "attachment_content_type_mismatch" }, 422);
        }

        // Store only a fresh, server-controlled key. The signed PUT URL
        // remains scoped to the temporary upload key and cannot overwrite
        // this accepted message attachment after creation.
        const finalObjectPath = await finalizeObjectEntityUpload(c.env, attachment.objectPath);
        finalizedObjectPaths.push(finalObjectPath);
        let finalMetadata;
        try {
          finalMetadata = await getObjectEntityMetadata(c.env, finalObjectPath);
        } catch (error) {
          await discardFinalizedAttachments();
          throw error;
        }
        const finalContentType = finalMetadata.contentType
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (
          finalMetadata.size !== descriptor.maxSize ||
          finalContentType !== descriptor.contentType
        ) {
          await discardFinalizedAttachments();
          return c.json({ error: "finalized_attachment_metadata_mismatch" }, 422);
        }
        attachment.objectPath = finalObjectPath;
      }
    }
    if (replyToId !== undefined && (!Number.isInteger(replyToId) || replyToId <= 0)) {
      await discardFinalizedAttachments();
      return c.json({ error: "invalid_reply_reference" }, 400);
    }
    if (forwardedFromId !== undefined && (!Number.isInteger(forwardedFromId) || forwardedFromId <= 0)) {
      await discardFinalizedAttachments();
      return c.json({ error: "invalid_forward_reference" }, 400);
    }

    // Validate mention targets: each ID must be an active member of this conversation.
    // Membership is always required for DMs. For non-DM conversations, PM/super_admin
    // full operational access does not grant the ability to mention arbitrary users
    // outside actual membership — only real members can be mentioned.
    let validatedMentionedUserIds: number[] = [];
    if (rawMentionIds.length > 0) {
      const { rows: validMentions } = await db.query<{ id: number }>(
        `SELECT u.id FROM conversation_members cm
         JOIN users u ON u.id=cm.user_id
         WHERE cm.conversation_id=$1 AND u.status='active' AND u.id = ANY($2::int[])`,
        [convId, rawMentionIds],
      );
      const validSet = new Set(validMentions.map((r) => r.id));
      const invalidIds = rawMentionIds.filter((id) => !validSet.has(id));
      if (invalidIds.length > 0) {
        await discardFinalizedAttachments();
        return c.json({ error: "invalid_mentioned_user_ids", message: "One or more mentioned users are not active members of this conversation." }, 422);
      }
      // Exclude the sender from their own mention notifications
      validatedMentionedUserIds = rawMentionIds.filter((id) => id !== userId);
    }

    let client;
    try {
      client = await pool.connect();
    } catch (error) {
      // No transaction was started, so these newly-finalised objects cannot
      // have a canonical message reference and are safe to discard.
      await discardFinalizedAttachments();
      throw error;
    }
    let msgRow: Record<string, unknown>;
    let newMsgId: number;
    let commitAttempted = false;
    try {
      await client.query("BEGIN");
      if (replyToId !== undefined) {
        const replySource = await client.query<{ conversation_id: number; deleted_at: string | null }>(
          `SELECT conversation_id, deleted_at FROM messages
           WHERE id=$1
             AND NOT EXISTS (
               SELECT 1 FROM message_user_hides muh
               WHERE muh.message_id=messages.id AND muh.user_id=$2
             )
           FOR KEY SHARE`,
          [replyToId, userId],
        );
        if (!replySource.rows[0]) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          return c.json({ error: "reply_source_not_found" }, 404);
        }
        if (replySource.rows[0].conversation_id !== convId || replySource.rows[0].deleted_at) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          return c.json({ error: "reply_source_unavailable" }, 422);
        }
      }
      if (forwardedFromId !== undefined) {
        const forwardedSource = await client.query<{ conversation_id: number; deleted_at: string | null }>(
          `SELECT conversation_id, deleted_at FROM messages
           WHERE id=$1
             AND NOT EXISTS (
               SELECT 1 FROM message_user_hides muh
               WHERE muh.message_id=messages.id AND muh.user_id=$2
             )
           FOR KEY SHARE`,
          [forwardedFromId, userId],
        );
        if (!forwardedSource.rows[0]) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          return c.json({ error: "forward_source_not_found" }, 404);
        }
        if (forwardedSource.rows[0].deleted_at) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          return c.json({ error: "forward_source_unavailable" }, 422);
        }
        if (!await assertMemberOrFullAccess(client, forwardedSource.rows[0].conversation_id, user)) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          return c.json({ error: "forward_source_forbidden" }, 403);
        }
      }
      const ins = await client.query<{ id: number }>(
        `INSERT INTO messages (conversation_id, sender_id, body, attachments, reply_to_id, forwarded_from_message_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [convId, userId, messageBody, safeAttachments.length ? JSON.stringify(safeAttachments) : null, replyToId ?? null, forwardedFromId ?? null],
      );
      newMsgId = ins.rows[0].id;
      await client.query(
        `UPDATE conversations SET updated_at=NOW() WHERE id=$1`,
        [convId],
      );
      commitAttempted = true;
      await client.query("COMMIT");
      finalizedObjectPaths.length = 0;

      const full = await db.query<Record<string, unknown>>(
        `SELECT m.id, m.conversation_id AS "conversationId",
                m.sender_id AS "senderId", u.name AS "senderName", u.role_label AS "senderRoleLabel",
                m.body, m.attachments, m.reply_to_id AS "replyToId",
                m.edited_at AS "editedAt", m.deleted_at AS "deletedAt", m.deletion_type AS "deletionType",
                m.is_pinned AS "isPinned", m.pinned_by AS "pinnedBy", m.pinned_at AS "pinnedAt",
                m.forwarded_from_message_id AS "forwardedFromId",
                m.created_at AS "createdAt",
                CASE WHEN rm.deleted_at IS NULL THEN rm.body ELSE NULL END AS "replyBody",
                CASE WHEN rm.deleted_at IS NULL THEN ru.name ELSE NULL END AS "replySenderName",
                '[]'::json AS "reactions"
         FROM messages m
         JOIN users u ON u.id=m.sender_id
          LEFT JOIN messages rm ON rm.id=m.reply_to_id
            AND rm.conversation_id=m.conversation_id
            AND NOT EXISTS (
              SELECT 1 FROM message_user_hides rmh
              WHERE rmh.message_id=rm.id AND rmh.user_id=$2
            )
         LEFT JOIN users ru ON ru.id=rm.sender_id
          WHERE m.id=$1`,
        [newMsgId, userId],
      );
      msgRow = publicMessage(full.rows[0]);
      await logAudit(db, { userId, action: "message_create", module: "messages", entityId: newMsgId, newValue: JSON.stringify({ conversationId: convId, body: messageBody.slice(0, 200) }) });
      if (forwardedFromId) {
        await logAudit(db, { userId, action: "message_forward", module: "messages", entityId: newMsgId, newValue: JSON.stringify({ conversationId: convId, forwardedFromId, body: messageBody.slice(0, 200) }) });
      }
    } catch (err) {
      if (!commitAttempted) {
        // Only delete after a known successful rollback. A COMMIT transport
        // failure is indeterminate: the message may already be canonical, so
        // preserving the object is safer than corrupting that message.
        try {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
        } catch {
          // Preserve uncertain objects for the existing non-destructive
          // reconciliation/owner-disposition process.
        }
      }
      throw err;
    }
    finally { client.release(); }

    const otherMembers = await db.query<{ user_id: number }>(
      `SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id!=$2`,
      [convId, userId],
    );
    const memberIds = otherMembers.rows.map((m) => m.user_id);

    /* A message's reply preview is viewer-specific: a member may have hidden
     * the reply source. Emit only the stable identity needed by clients to
     * refetch their own authorised view; never fan out a sender-rendered DTO. */
    await broadcastMessage(c.env, [userId, ...memberIds], { id: newMsgId, conversationId: convId });
    await broadcastConversationUpdate(c.env, memberIds, convId);

    /* ── H-01/M-02: notification creation dropped (not-yet-built notification engine). ── */
    if (validatedMentionedUserIds.length > 0) {
      for (const mentionedUid of validatedMentionedUserIds) {
        await db.query(
          `INSERT INTO message_mentions (message_id, mentioned_user_id, mentioned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [newMsgId, mentionedUid, userId],
        );
      }
    }

    return c.json(msgRow, 201);
  } finally {
    close();
  }
});

/* ── POST /messages/:msgId/reactions ───────────────────────────── */
conversationsRoutes.post("/messages/:msgId/reactions", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const msgId = parsePositiveInt(c.req.param("msgId"));
    if (!msgId) return c.json({ error: "invalid_message_id" }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { emoji?: string };
    const emoji = body.emoji;
    const ALLOWED = ["👍", "❤️", "😂", "👏", "🎉", "🙏"];
    if (!emoji || !ALLOWED.includes(emoji)) return c.json({ error: "invalid_emoji" }, 400);

    const msgRow = await db.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1 AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!msgRow.rows[0]) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, msgRow.rows[0].conversation_id, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    // Idempotent toggle: use a single conditional DELETE/INSERT pair rather
    // than check-then-insert so concurrent requests on the same (message, user,
    // emoji) cannot race to produce a raw unique-constraint error.
    const deleted = await db.query<{ id: number }>(
      `DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 RETURNING id`,
      [msgId, userId, emoji],
    );
    if (!deleted.rows[0]) {
      // No unique constraint exists on (message_id, user_id, emoji) in the
      // tracked schema (lib/db/src/schema/index.ts only declares the id
      // primary key), so ON CONFLICT here has no matching constraint to
      // target and Postgres rejects the statement outright — this was
      // crashing every reaction toggle with a 500 (confirmed live). A plain
      // INSERT restores the common (non-racing) case; the schema migration
      // that would add the missing unique index and fully restore the
      // original race-safety intent is a separate, deliberate change —
      // fixed identically in api-server's routes/conversations.ts.
      await db.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)`,
        [msgId, userId, emoji],
      );
    }

    const reactions = await db.query(
      `SELECT r.emoji, r.user_id AS "userId", u.name AS "userName"
       FROM message_reactions r JOIN users u ON u.id=r.user_id
       WHERE r.message_id=$1 ORDER BY r.created_at ASC`,
      [msgId],
    );
    await broadcastConversationUpdate(c.env, [], msgRow.rows[0].conversation_id, { change: "message:reaction", messageId: msgId, actorId: userId, actorName: user.name });
    return c.json(reactions.rows);
  } finally {
    close();
  }
});

/* ── GET /conversations/:id/media ───────────────────────────────── */
conversationsRoutes.get("/conversations/:id/media", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const r = await db.query<{ messageId: number; attachments: unknown; sentAt: string; senderName: string }>(
      `SELECT m.id AS "messageId", m.attachments, m.created_at AS "sentAt", u.name AS "senderName"
       FROM messages m JOIN users u ON u.id=m.sender_id
       WHERE m.conversation_id=$1 AND m.deleted_at IS NULL AND m.attachments IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=m.id AND muh.user_id=$2
         )
       ORDER BY m.created_at DESC`,
      [convId, userId],
    );

    const photos: unknown[] = [];
    const docs: unknown[] = [];
    const voices: unknown[] = [];
    for (const row of r.rows) {
      const atts = publicConversationAttachments(convId, row.messageId, row.attachments);
      for (const att of atts) {
        const item = { ...att, sentAt: row.sentAt, senderName: row.senderName, messageId: row.messageId };
        if (att.type === "image") photos.push(item);
        else if (att.type === "voice") voices.push(item);
        else docs.push(item);
      }
    }
    return c.json({ photos, docs, voices });
  } finally {
    close();
  }
});

/* ── GET /conversations/:id/messages/:messageId/attachments/:index ─────────── */
conversationsRoutes.get("/conversations/:id/messages/:messageId/attachments/:index", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const messageId = parseInt(c.req.param("messageId"));
    const index = parseInt(c.req.param("index"));
    if (![convId, messageId, index].every(Number.isInteger) || convId <= 0 || messageId <= 0 || index < 0) {
      return c.json({ error: "not_found" }, 404);
    }

    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);
    const message = await db.query<{ attachments: unknown }>(
      `SELECT attachments FROM messages
       WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$3
         )`,
      [messageId, convId, user.id],
    );
    if (!message.rows[0]) return c.json({ error: "not_found" }, 404);
    const attachment = conversationAttachmentAt(message.rows[0].attachments, index);
    if (!attachment) return c.json({ error: "attachment_not_found" }, 404);
    if (attachment.availabilityStatus === "unavailable") {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }

    try {
      const objectFile = await getObjectEntityFile(c.env, attachment.objectPath);
      const response = await downloadObject(c.env, objectFile);
      const contentType = attachment.contentType?.toLowerCase();
      const canRenderInline = Boolean(contentType && SAFE_INLINE_ATTACHMENT_CONTENT_TYPES.has(contentType));
      const headers = new Headers(response.headers);
      // Message JSON is client-submitted metadata, so it cannot select an
      // arbitrary browser-rendered MIME type. This keeps hostile HTML/SVG
      // metadata from turning a private-file proxy into a same-origin XSS sink.
      headers.set("Content-Type", canRenderInline ? contentType! : "application/octet-stream");
      headers.set("Content-Disposition", contentDispositionHeader(attachment.name, canRenderInline ? "inline" : "attachment"));
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) return c.json({ error: "attachment_not_found" }, 404);
      throw err;
    }
  } finally {
    close();
  }
});

/* ── PATCH /messages/:msgId ─────────────────────────────────────── */
conversationsRoutes.patch("/messages/:msgId", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const msgId = parsePositiveInt(c.req.param("msgId"));
    if (!msgId) return c.json({ error: "invalid_message_id" }, 400);
    const bodyPayload = (await c.req.json().catch(() => ({}))) as { body?: unknown };
    const { body } = bodyPayload;

    // A missing/empty body previously fell through to body.trim() below and
    // threw a TypeError, surfaced as a generic 500 instead of a real 400.
    if (typeof body !== "string" || !body.trim()) return c.json({ error: "body_required" }, 400);
    if (body.length > 10_000) return c.json({ error: "message_too_long" }, 400);

    const existing = await db.query<{ sender_id: number; conversation_id: number; deleted_at: string | null; created_at: string }>(
      `SELECT sender_id, conversation_id, deleted_at, created_at FROM messages
       WHERE id=$1
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!existing.rows[0]) return c.json({ error: "not_found" }, 404);
    if (existing.rows[0].sender_id !== userId) return c.json({ error: "forbidden" }, 403);
    if (!await assertMemberOrFullAccess(db, existing.rows[0].conversation_id, user)) {
      return c.json({ error: "forbidden" }, 403);
    }
    if (existing.rows[0].deleted_at) return c.json({ error: "message_deleted" }, 400);

    const ageMs = Date.now() - new Date(existing.rows[0].created_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      return c.json({ error: "edit_window_expired", message: "Messages can only be edited within 15 minutes of sending." }, 403);
    }

    const edited = await db.query(
      `UPDATE messages
       SET body=$1, edited_at=NOW()
       WHERE id=$2
         AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [body.trim(), msgId],
    );
    if ((edited.rowCount ?? 0) !== 1) return c.json({ error: "message_already_deleted" }, 409);
    await logAudit(db, { userId, action: "message_edit", module: "messages", entityId: msgId, newValue: body.trim().slice(0, 200) });
    await broadcastConversationUpdate(c.env, [], existing.rows[0].conversation_id, { change: "message:updated", messageId: msgId, actorId: userId, actorName: user.name });
    const updated = await db.query<Record<string, unknown>>(
      `SELECT m.id, m.conversation_id AS "conversationId",
              m.sender_id AS "senderId", u.name AS "senderName", u.role_label AS "senderRoleLabel",
              m.body, m.attachments, m.reply_to_id AS "replyToId",
              m.edited_at AS "editedAt", m.deleted_at AS "deletedAt", m.deletion_type AS "deletionType",
              m.is_pinned AS "isPinned", m.pinned_by AS "pinnedBy", m.pinned_at AS "pinnedAt",
              m.forwarded_from_message_id AS "forwardedFromId",
              m.created_at AS "createdAt",
              CASE WHEN rm.deleted_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM message_user_hides rmh
                WHERE rmh.message_id=rm.id AND rmh.user_id=$2
              ) THEN rm.body ELSE NULL END AS "replyBody",
              CASE WHEN rm.deleted_at IS NULL AND NOT EXISTS (
                SELECT 1 FROM message_user_hides rmh
                WHERE rmh.message_id=rm.id AND rmh.user_id=$2
              ) THEN ru.name ELSE NULL END AS "replySenderName",
              COALESCE((SELECT json_agg(json_build_object('emoji', r.emoji, 'userId', r.user_id, 'userName', u3.name) ORDER BY r.created_at ASC)
                        FROM message_reactions r JOIN users u3 ON u3.id=r.user_id WHERE r.message_id=m.id), '[]'::json) AS "reactions"
       FROM messages m
       JOIN users u ON u.id=m.sender_id
        LEFT JOIN messages rm ON rm.id=m.reply_to_id
          AND rm.conversation_id=m.conversation_id
          AND NOT EXISTS (
            SELECT 1 FROM message_user_hides rmh
            WHERE rmh.message_id=rm.id AND rmh.user_id=$2
          )
       LEFT JOIN users ru ON ru.id=rm.sender_id
       WHERE m.id=$1`,
      [msgId, userId],
    );
    return c.json(publicMessage(updated.rows[0]));
  } finally {
    close();
  }
});

/* ── DELETE /messages/:msgId ────────────────────────────────────── */
conversationsRoutes.delete("/messages/:msgId", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const msgId = parsePositiveInt(c.req.param("msgId"));
    if (!msgId) return c.json({ error: "invalid_message_id" }, 400);
    const bodyPayload = (await c.req.json().catch(() => ({}))) as { deletionType?: string };
    const deletionType: "for_me" | "for_everyone" = bodyPayload.deletionType === "for_everyone" ? "for_everyone" : "for_me";

    // The WHERE clause only references $2 on the for_everyone branch. Postgres
    // rejects a Bind with more parameters than the parsed statement actually
    // references ("bind message supplies N parameters, but prepared statement
    // requires M") — passing [msgId, userId] unconditionally on every branch
    // crashed every default (for_me) deletion, the most common case, with a
    // 500 (confirmed live). Fixed identically in api-server's routes/conversations.ts.
    const existing = await db.query<{ sender_id: number; conversation_id: number; created_at: string; deleted_at: string | null; deletion_type: string | null }>(
      `SELECT sender_id, conversation_id, created_at, deleted_at, deletion_type FROM messages
       WHERE id=$1
         ${deletionType === "for_everyone" ? `AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )` : ""}`,
      deletionType === "for_everyone" ? [msgId, userId] : [msgId],
    );
    if (!existing.rows[0]) return c.json({ error: "not_found" }, 404);

    const hasAccess = await assertMemberOrFullAccess(db, existing.rows[0].conversation_id, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const isSender = existing.rows[0].sender_id === userId;
    const isAdmin = isAdminRole(user.role);

    if (deletionType === "for_everyone") {
      // Only sender (or admin) may delete for everyone, within 15 minutes
      if (!isSender && !isAdmin) {
        return c.json({ error: "forbidden", message: "Only the sender can delete for everyone." }, 403);
      }
      const ageMs = Date.now() - new Date(existing.rows[0].created_at).getTime();
      if (ageMs > 15 * 60 * 1000 && !isAdmin) {
        return c.json({ error: "delete_window_expired", message: "Delete for everyone is only available within 15 minutes of sending." }, 403);
      }
    }

    if (deletionType === "for_me") {
      // A private hide belongs only to a real member. Operational access to a
      // non-DM conversation is deliberately not converted into fake membership.
      if (!await assertMember(db, existing.rows[0].conversation_id, userId)) {
        return c.json({ error: "forbidden" }, 403);
      }
      if (existing.rows[0].deletion_type === "for_everyone") {
        return c.body(null, 204);
      }
      await db.query(
        `INSERT INTO message_user_hides (message_id, user_id)
         VALUES ($1,$2) ON CONFLICT (message_id, user_id) DO NOTHING`,
        [msgId, userId],
      );
      await logAudit(db, { userId, action: "message_hide", module: "messages", entityId: msgId });
      await broadcastPersonalConversationUpdate(c.env, userId, existing.rows[0].conversation_id);
      return c.body(null, 204);
    }

    const deleted = await db.query(
      `UPDATE messages
       SET deleted_at=NOW(), deleted_by=$2, deletion_type='for_everyone',
           is_pinned=FALSE, pinned_by=NULL, pinned_at=NULL
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [msgId, userId],
    );
    if ((deleted.rowCount ?? 0) !== 1) return c.json({ error: "message_already_deleted" }, 409);
    await logAudit(db, { userId, action: "message_delete", module: "messages", entityId: msgId, newValue: JSON.stringify({ deletionType: "for_everyone" }) });
    await broadcastConversationUpdate(c.env, [], existing.rows[0].conversation_id, { change: "message:deleted", messageId: msgId, actorId: userId, actorName: user.name });
    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── POST /messages/:msgId/pin ──────────────────────────────────── */
conversationsRoutes.post("/messages/:msgId/pin", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const msgId = parsePositiveInt(c.req.param("msgId"));
    if (!msgId) return c.json({ error: "invalid_message_id" }, 400);
    if (!PIN_ROLES.has(user.role)) {
      return c.json({ error: "forbidden", message: "Only managers and coordinators may pin messages." }, 403);
    }
    const msgRow = await db.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'
         AND NOT EXISTS (SELECT 1 FROM message_user_hides WHERE message_id=messages.id AND user_id=$2)`, [msgId, userId],
    );
    if (!msgRow.rows[0]) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, msgRow.rows[0].conversation_id, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const convId = msgRow.rows[0].conversation_id;
    const pinCount = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM messages
       WHERE conversation_id=$1 AND is_pinned=TRUE
         AND deletion_type IS DISTINCT FROM 'for_everyone'
         AND NOT EXISTS (SELECT 1 FROM message_user_hides WHERE message_id=messages.id AND user_id=$2)`,
      [convId, userId],
    );
    if (parseInt(pinCount.rows[0]?.count ?? "0", 10) >= 10) {
      return c.json({ error: "pin_limit_exceeded", message: "Maximum of 10 pinned messages per conversation." }, 400);
    }

    const pinned = await db.query(
      `UPDATE messages
       SET is_pinned=TRUE, pinned_by=$2, pinned_at=NOW()
       WHERE id=$1
         AND deletion_type IS DISTINCT FROM 'for_everyone'
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides
           WHERE message_id=messages.id AND user_id=$3
         )`,
      [msgId, userId, userId],
    );
    if ((pinned.rowCount ?? 0) !== 1) return c.json({ error: "message_already_deleted" }, 409);
    await logAudit(db, { userId, action: "message_pin", module: "messages", entityId: msgId });
    await broadcastConversationUpdate(c.env, [], convId, { change: "message:pin", messageId: msgId, actorId: userId, actorName: user.name });

    /* Notification creation dropped (not-yet-built notification engine). */
    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── DELETE /messages/:msgId/pin ────────────────────────────────── */
conversationsRoutes.delete("/messages/:msgId/pin", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const msgId = parsePositiveInt(c.req.param("msgId"));
    if (!msgId) return c.json({ error: "invalid_message_id" }, 400);
    if (!PIN_ROLES.has(user.role)) return c.json({ error: "forbidden" }, 403);

    const msgRow = await db.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!msgRow.rows[0]) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, msgRow.rows[0].conversation_id, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const unpinned = await db.query(
      `UPDATE messages SET is_pinned=FALSE, pinned_by=NULL, pinned_at=NULL
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [msgId],
    );
    if ((unpinned.rowCount ?? 0) !== 1) return c.json({ error: "message_already_deleted" }, 409);
    await logAudit(db, { userId, action: "message_unpin", module: "messages", entityId: msgId });
    await broadcastConversationUpdate(c.env, [], msgRow.rows[0].conversation_id, { change: "message:unpin", messageId: msgId, actorId: userId, actorName: user.name });
    return c.body(null, 204);
  } finally {
    close();
  }
});

/* ── GET /conversations/:id/pinned ──────────────────────────────── */
conversationsRoutes.get("/conversations/:id/pinned", async (c) => {
  const user = c.get("currentUser")!;
  const userId = user.id;
  const { db, close } = openDb(c);
  try {
    const convId = parsePositiveInt(c.req.param("id"));
    if (!convId) return c.json({ error: "not_found" }, 404);
    const hasAccess = await assertMemberOrFullAccess(db, convId, user);
    if (!hasAccess) return c.json({ error: "forbidden" }, 403);

    const r = await db.query<Record<string, unknown>>(
      `SELECT m.id, m.body, m.attachments, m.created_at AS "createdAt",
              m.pinned_at AS "pinnedAt", m.pinned_by AS "pinnedBy",
              u.name AS "senderName", pu.name AS "pinnedByName"
       FROM messages m
       JOIN users u ON u.id=m.sender_id
       LEFT JOIN users pu ON pu.id=m.pinned_by
        WHERE m.conversation_id=$1 AND m.is_pinned=TRUE
          AND m.deletion_type IS DISTINCT FROM 'for_everyone'
          AND NOT EXISTS (
            SELECT 1 FROM message_user_hides muh
            WHERE muh.message_id=m.id AND muh.user_id=$2
          )
       ORDER BY m.pinned_at DESC`,
      [convId, userId],
    );
    return c.json(r.rows.map((message) => publicMessage({
      ...message,
      conversationId: convId,
    })));
  } finally {
    close();
  }
});
