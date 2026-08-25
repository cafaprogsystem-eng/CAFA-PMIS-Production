import { Router, type IRouter } from "express";
import { Readable } from "stream";
import { pool } from "@workspace/db";
import {
  hasPerm,
  logAudit,
  permissionsFor,
  requirePerm,
  tcSectorRestriction,
  assertSectorAllowed,
} from "../middlewares/currentUser";
import { createNotificationDeduped } from "../lib/notifications";
import { VALID_SECTOR_SET } from "../lib/sectors";
import { assertActiveState } from "../lib/state-master";
import { realtime } from "../lib/realtime";
import {
  canAccessConversation,
  isConversationMember,
  type ConversationAccessUser,
} from "../lib/conversationAuth";
import {
  conversationAttachmentAt,
  normaliseIncomingConversationAttachments,
  publicConversationAttachments,
} from "../lib/conversationAttachments";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import { UploadTokenError, verifyUploadToken } from "../lib/uploadToken";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
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

/* ── member guard ──────────────────────────────────────────────── */
async function assertMember(convId: number, userId: number): Promise<boolean> {
  return isConversationMember(convId, userId);
}

/**
 * Returns true when the user may access the conversation.
 * Members always have access. PM/super_admin bypass membership for non-direct
 * (group/project/state/sector/announcement) conversations.
 * Direct message privacy is always enforced regardless of role.
 */
async function assertMemberOrFullAccess(convId: number, user: ConversationAccessUser): Promise<boolean> {
  return canAccessConversation(convId, user);
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

function attachmentContentDisposition(name: string, inline: boolean): string {
  const safe = name.replace(/["\\\u0000-\u001f\u007f]/g, "_").trim() || "attachment";
  const ascii = safe.replace(/[^\x20-\x7e]/g, "_");
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(safe)}`;
}

async function getConvById(convId: number, user: ConversationAccessUser) {
  const r = await pool.query<{
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
  const hasAccess = await assertMemberOrFullAccess(convId, user);
  if (!hasAccess) return null;
  return r.rows[0];
}

/* ── GET /conversations/unread-count ───────────────────────────── */
router.get("/conversations/unread-count", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const r = await pool.query<{ total: string }>(
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
    res.json({ total: parseInt(r.rows[0]?.total ?? "0", 10) });
  } catch (err) { next(err); }
});

/* ── GET /conversations ─────────────────────────────────────────── */
router.get("/conversations", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const rawType = req.query.type;
    const rawSearch = req.query.search;
    const rawUnread = req.query.unread;
    const rawLimit = req.query.limit ?? "50";
    if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
      res.status(400).json({ error: "invalid_limit" }); return;
    }
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: "invalid_limit" }); return;
    }
    const supportedTypes = new Set(["direct", "group", "project", "state", "sector", "system", "announcement"]);
    if (rawType !== undefined && (typeof rawType !== "string" || !supportedTypes.has(rawType))) {
      res.status(400).json({ error: "invalid_type" }); return;
    }
    if (rawUnread !== undefined && rawUnread !== "true" && rawUnread !== "false") {
      res.status(400).json({ error: "invalid_unread" }); return;
    }
    if (rawSearch !== undefined && (typeof rawSearch !== "string" || rawSearch.length > 100)) {
      res.status(400).json({ error: "invalid_search" }); return;
    }
    let cursor: ConversationCursor | null;
    try {
      cursor = decodeConversationCursor(req.query.cursor);
    } catch {
      res.status(400).json({ error: "invalid_cursor" }); return;
    }
    const type = rawType;
    const search = rawSearch?.trim();
    const unread = rawUnread;

    // Full Operational Access (PM/super_admin): LEFT JOIN so non-member conversations are
    // included, then filter to own conversations OR any non-direct conversation.
    // DM privacy is always enforced — direct conversations require actual membership.
    const isFullAccess = req.currentUser!.role === "program_manager" || req.currentUser!.role === "super_admin";
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

    const rows = await pool.query(
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
    res.json({
      items,
      hasMore,
      nextCursor: hasMore && lastItem?.activityAt && lastItem.id
        ? encodeConversationCursor({
          activityAt: new Date(lastItem.activityAt).toISOString(),
          id: Number(lastItem.id),
        })
        : null,
    });
  } catch (err) { next(err); }
});

/* ── POST /conversations ─────────────────────────────────────────── */
router.post("/conversations", requirePerm("messages.create"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const userId = user.id;
    const {
      type = "direct", name, memberIds = [],
      projectId, stateId, sector,
      /* M-03 announcement targeting */
      targetAll, targetStateId, targetSector, targetRole,
    } = req.body as {
      type?: string; name?: string; memberIds?: number[];
      projectId?: number; stateId?: number; sector?: string;
      targetAll?: boolean; targetStateId?: number; targetSector?: string; targetRole?: string;
    };

    if (!Array.isArray(memberIds) || memberIds.some((id) => !Number.isInteger(id) || id <= 0)) {
      res.status(400).json({ error: "invalid_members" }); return;
    }

    /* ── M-04: Strict sector validation ──────────────────────────── */
    if (type === "sector") {
      if (!sector || !VALID_SECTOR_SET.has(sector)) {
        res.status(400).json({
          error: "invalid_sector",
          message: `Sector must be one of: ${[...VALID_SECTOR_SET].join(", ")}`,
        });
        return;
      }
    }

    /* ── M-03: Announcement — restricted creation ────────────────── */
    if (type === "announcement") {
      if (!ANNOUNCEMENT_ROLES.has(user.role)) {
        res.status(403).json({ error: "forbidden", message: "Only Program Managers and above may send announcements." });
        return;
      }
      if (!name?.trim()) {
        res.status(400).json({ error: "name_required", message: "Announcement subject is required." });
        return;
      }
    }

    /* ── C-01 AUTHORIZATION GUARDS ─────────────────────────────── */
    if (type === "state") {
      const activeState = Number.isInteger(stateId) && stateId ? await assertActiveState(stateId) : null;
      if (!activeState?.ok) {
        if (activeState?.error === "inactive_state") {
          res.status(422).json({ error: "inactive_state" }); return;
        }
        res.status(404).json({ error: "state_not_found" }); return;
      }
      const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";
      if (isStateRole) {
        if (!stateId || user.stateId !== stateId) {
          res.status(403).json({ error: "state_forbidden", message: "You may only create state conversations for your assigned state." });
          return;
        }
      }
    }

    if (type === "sector") {
      const sectorRestriction = tcSectorRestriction(req);
      if (sectorRestriction !== null) {
        if (!sectorRestriction.includes(sector!)) {
          res.status(403).json({ error: "sector_forbidden", message: "You may only create sector conversations for your assigned sector(s)." });
          return;
        }
      }
    }

    if (type === "project") {
      if (!projectId) {
        res.status(400).json({ error: "projectId required for project conversations" });
        return;
      }
      const projectExists = await pool.query<{ sector: string | null }>(
        `SELECT sector FROM projects WHERE id=$1`, [projectId],
      );
      if (!projectExists.rows[0]) {
        res.status(404).json({ error: "project_not_found" }); return;
      }
      const isStateRole = user.role === "state_office_manager" || user.role === "state_program_officer";
      if (isStateRole) {
        const stateCheck = await pool.query(
          `SELECT 1 FROM project_states ps WHERE ps.project_id=$1 AND ps.state_id=$2
           UNION ALL
           SELECT 1 FROM project_assignments pa WHERE pa.project_id=$1 AND pa.user_id=$3
           LIMIT 1`,
          [projectId, user.stateId ?? -1, userId],
        );
        if (stateCheck.rows.length === 0) {
          res.status(403).json({ error: "project_state_forbidden", message: "You may only create project conversations for projects in your assigned state." });
          return;
        }
      }
      const sectorRestriction = tcSectorRestriction(req);
      if (sectorRestriction !== null) {
        const guard = assertSectorAllowed(req, projectExists.rows[0].sector);
        if (!guard.ok) {
          res.status(guard.status).json({ ...guard.body, message: "You may only create project conversations for projects in your assigned sector(s)." });
          return;
        }
      }
    }
    /* ── END AUTHORIZATION GUARDS ───────────────────────────────── */

    let allMemberIds: number[] = [...new Set([userId, ...memberIds])];
    const requestedOtherMemberIds = allMemberIds.filter((id) => id !== userId);
    if (requestedOtherMemberIds.length > 0) {
      const requestedUsers = await pool.query<{ id: number; status: string }>(
        `SELECT id, status FROM users WHERE id = ANY($1::int[])`,
        [requestedOtherMemberIds],
      );
      if (
        requestedUsers.rows.length !== requestedOtherMemberIds.length ||
        requestedUsers.rows.some((member) => member.status !== "active")
      ) {
        res.status(400).json({ error: "invalid_or_inactive_member" }); return;
      }
    }

    if (type === "direct") {
      if (allMemberIds.length !== 2) {
        res.status(400).json({ error: "Direct conversations require exactly 2 members" });
        return;
      }
    }

    // Auto-enroll members by type
    if (type === "project" && projectId) {
      const assigned = await pool.query<{ user_id: number }>(
        `SELECT pa.user_id FROM project_assignments pa
         JOIN users u ON u.id=pa.user_id AND u.status='active'
         WHERE pa.project_id=$1`,
        [projectId],
      );
      allMemberIds = [...new Set([...allMemberIds, ...assigned.rows.map((r) => r.user_id)])];
    }
    if (type === "state" && stateId) {
      const stateUsers = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE state_id=$1 AND status='active'`,
        [stateId],
      );
      allMemberIds = [...new Set([...allMemberIds, ...stateUsers.rows.map((r) => r.id)])];
    }
    /* ── M-04: Exact sector match for member auto-enrollment ──── */
    if (type === "sector" && sector) {
      const sectorUsers = await pool.query<{ id: number }>(
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
          res.status(400).json({ error: "invalid_sector" }); return;
        }
        recipientQuery += ` AND (sector=$${rp} OR sector LIKE $${rp} || ',%%' OR sector LIKE '%%,' || $${rp} OR sector LIKE '%%,' || $${rp} || ',%%')`;
        rParams.push(targetSector); rp++;
      } else if (targetRole) {
        recipientQuery += ` AND role=$${rp++}`;
        rParams.push(targetRole);
      }
      const recipients = await pool.query<{ id: number }>(recipientQuery, rParams);
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
      await client.query("COMMIT");
    } catch (err) { await client.query("ROLLBACK"); throw err; }
    finally { client.release(); }

    if (!createdConversation) {
      const existing = await pool.query(
        `SELECT id, type, name, project_id AS "projectId", state_id AS "stateId",
                sector, created_by_id AS "createdById",
                created_at AS "createdAt", updated_at AS "updatedAt",
                (SELECT COUNT(DISTINCT user_id)::int FROM conversation_members WHERE conversation_id=c.id) AS "memberCount",
                0 AS "unreadCount", NULL AS "lastMessageBody", NULL AS "lastMessageAt",
                NULL AS "lastMessageSenderName"
         FROM conversations c WHERE c.id=$1`,
        [convId],
      );
      res.status(200).json(existing.rows[0]);
      return;
    }

    await logAudit({ userId, action: "create", module: "conversation", entityId: convId, newValue: JSON.stringify({ type, name }) });

    /* M-01: Broadcast new conversation to all members */
    await realtime.broadcastConversationUpdate(allMemberIds, convId, {
      change: "conversation:updated",
      actorId: userId,
      actorName: user.name,
    });

    /* M-03: Notify announcement recipients */
    if (type === "announcement") {
      for (const mid of allMemberIds.filter((id) => id !== userId)) {
        await createNotificationDeduped({
          userId: mid,
          kind: "message",
          entityType: "conversation",
          entityId: convId,
          message: `Announcement: ${name}`,
          link: `/messages/${convId}`,
          dedupeKey: `conversation-announcement:${convId}`,
        });
      }
    }

    const conv = await pool.query(
      `SELECT id, type, name, project_id AS "projectId", state_id AS "stateId",
              sector, created_by_id AS "createdById",
              created_at AS "createdAt", updated_at AS "updatedAt",
              (SELECT COUNT(*)::int FROM conversation_members WHERE conversation_id=c.id) AS "memberCount",
              0 AS "unreadCount", NULL AS "lastMessageBody", NULL AS "lastMessageAt",
              NULL AS "lastMessageSenderName"
       FROM conversations c WHERE c.id=$1`,
      [convId],
    );
    res.status(201).json(conv.rows[0]);
  } catch (err) { next(err); }
});

/* ── GET /conversations/:id ─────────────────────────────────────── */
router.get("/conversations/:id", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const conv = await getConvById(convId, req.currentUser!);
    if (!conv) { res.status(404).json({ error: "not_found" }); return; }

    const members = await pool.query(
      `SELECT u.id, u.name, u.role, u.role_label AS "roleLabel", u.last_seen_at AS "lastSeenAt",
              cm.is_admin AS "isAdmin"
       FROM conversation_members cm JOIN users u ON u.id=cm.user_id
       WHERE cm.conversation_id=$1 ORDER BY u.name`,
      [convId],
    );
    const lastMsg = await pool.query(
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
    const unread = await pool.query<{ count: string }>(
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
    res.json({
      ...conv,
      members: members.rows.map((member) => ({
        ...member,
        isOnline: realtime.isUserOnline(member.id),
      })),
      memberCount: members.rows.length,
      lastMessageBody: lastMsg.rows[0]?.body ?? null,
      lastMessageAt: lastMsg.rows[0]?.lastMessageAt ?? null,
      lastMessageSenderName: lastMsg.rows[0]?.lastMessageSenderName ?? null,
      unreadCount: parseInt(unread.rows[0]?.count ?? "0", 10),
    });
  } catch (err) { next(err); }
});

/* ── PATCH /conversations/:id ───────────────────────────────────── */
router.patch("/conversations/:id", requirePerm("messages.manage_members"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const userId = user.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(convId, user);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const conv = await pool.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`, [convId],
    );
    if (!conv.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    if (conv.rows[0].type === "direct") {
      res.status(400).json({ error: "cannot rename direct conversations" }); return;
    }
    const isCreator = conv.rows[0].created_by_id === userId;
    if (!isCreator && !isAdminRole(user.role)) {
      res.status(403).json({ error: "forbidden", message: "Only the conversation creator or a manager may rename it." }); return;
    }

    const { name, description } = req.body as { name?: string; description?: string };
    if (!name?.trim()) { res.status(400).json({ error: "name is required" }); return; }

    await pool.query(
      `UPDATE conversations SET name=$1, updated_at=NOW() WHERE id=$2`,
      [name.trim(), convId],
    );
    await logAudit({ userId, action: "conversation_rename", module: "messages", entityId: convId, newValue: name.trim() });
    await realtime.broadcastConversationUpdate([], convId, {
      change: "conversation:updated",
      actorId: userId,
      actorName: user.name,
    });
    const updated = await getConvById(convId, user);
    res.json({ ...updated, description });
  } catch (err) { next(err); }
});

/* ── DELETE /conversations/:id/members/:userId ──────────────────── */
router.delete("/conversations/:id/members/:memberId", requirePerm("messages.manage_members"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const userId = user.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const memberId = parsePositiveInt(req.params.memberId as string);
    if (!memberId) { res.status(400).json({ error: "invalid_member_id" }); return; }

    const hasAccess = await assertMemberOrFullAccess(convId, user);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const conv = await pool.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`, [convId],
    );
    if (!conv.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    if (conv.rows[0].type === "direct") {
      res.status(400).json({ error: "cannot remove members from direct conversations" }); return;
    }
    const isCreator = conv.rows[0].created_by_id === userId;
    const isSelf = memberId === userId;
    if (!isCreator && !isAdminRole(user.role) && !isSelf) {
      res.status(403).json({ error: "forbidden", message: "Only the conversation creator, a manager, or the member themselves may remove a member." }); return;
    }
    // Cannot remove the creator (regardless of role)
    if (memberId === conv.rows[0].created_by_id) {
      res.status(400).json({ error: "cannot_remove_creator", message: "The conversation creator cannot be removed. Transfer ownership first." }); return;
    }

    await pool.query(
      `DELETE FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
      [convId, memberId],
    );
    await logAudit({ userId, action: "member_removed", module: "messages", entityId: convId, newValue: String(memberId) });
    await realtime.broadcastConversationUpdate([memberId], convId, {
      change: "membership:changed",
      actorId: userId,
      actorName: user.name,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── POST /conversations/:id/members ────────────────────────────── */
router.post("/conversations/:id/members", requirePerm("messages.manage_members"), async (req, res, next) => {
  try {
    const user = req.currentUser!;
    const userId = user.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }

    const hasAccess = await assertMemberOrFullAccess(convId, user);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const conv = await pool.query<{ created_by_id: number; type: string }>(
      `SELECT created_by_id, type FROM conversations WHERE id=$1`,
      [convId],
    );
    if (!conv.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    if (conv.rows[0].type === "direct") {
      res.status(400).json({ error: "cannot_add_members_to_direct_conversation" }); return;
    }

    const isCreator = conv.rows[0].created_by_id === userId;
    const isPrivileged = isAdminRole(user.role);
    if (!isCreator && !isPrivileged) {
      res.status(403).json({ error: "forbidden", message: "Only the conversation creator, Program Manager, or Senior Coordinator may add members." });
      return;
    }

    const { userId: newUserId } = req.body as { userId: number };
    if (!Number.isSafeInteger(newUserId) || newUserId <= 0) {
      res.status(400).json({ error: "invalid_member_id" }); return;
    }

    const userCheck = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM users WHERE id=$1`,
      [newUserId],
    );
    if (!userCheck.rows[0]) {
      res.status(400).json({ error: "user_not_found" }); return;
    }
    if (userCheck.rows[0].status !== "active") {
      res.status(400).json({ error: "user_not_active", message: "Only active users may be added to conversations." }); return;
    }

    const client = await pool.connect();
    let added = false;
    try {
      await client.query("BEGIN");
      await client.query(`SELECT pg_advisory_xact_lock($1::int, $2::int)`, [convId, newUserId]);
      const existingMember = await client.query(
        `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2 LIMIT 1`,
        [convId, newUserId],
      );
      if (!existingMember.rows[0]) {
        await client.query(
          `INSERT INTO conversation_members (conversation_id, user_id) VALUES ($1,$2)`,
          [convId, newUserId],
        );
        added = true;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally { client.release(); }

    /* M-01: Notify new member they've been added */
    if (added) {
      await realtime.broadcastConversationUpdate([newUserId], convId, {
        change: "membership:changed",
        actorId: userId,
        actorName: user.name,
      });
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── POST /conversations/:id/read ───────────────────────────────── */
router.post("/conversations/:id/read", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    if (!Number.isInteger(convId) || convId <= 0) {
      res.status(404).json({ error: "not_found" }); return;
    }

    // A read receipt is a membership state, not an operational-view override.
    // PM/Super Admin may view non-direct conversations without a membership row,
    // but must not receive a misleading success response for a receipt we cannot
    // persist (and must never be silently added as members).
    if (!await assertMember(convId, userId)) {
      res.status(403).json({ error: "read_receipt_forbidden" }); return;
    }
    const result = await pool.query(
      `UPDATE conversation_members SET last_read_at=NOW()
       WHERE conversation_id=$1 AND user_id=$2`,
      [convId, userId],
    );
    if ((result.rowCount ?? 0) !== 1) {
      res.status(403).json({ error: "read_receipt_forbidden" }); return;
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── GET /conversations/:id/messages ────────────────────────────── */
router.get("/conversations/:id/messages", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    if (!Number.isInteger(convId) || convId <= 0) {
      res.status(404).json({ error: "not_found" }); return;
    }
    const hasAccess = await assertMemberOrFullAccess(convId, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const rawLimit = req.query.limit ?? "60";
    if (typeof rawLimit !== "string" || !/^\d+$/.test(rawLimit)) {
      res.status(400).json({ error: "invalid_limit" }); return;
    }
    const limit = Number(rawLimit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      res.status(400).json({ error: "invalid_limit" }); return;
    }
    let cursor: HistoryCursor | null;
    try {
      cursor = decodeHistoryCursor(req.query.cursor);
    } catch {
      res.status(400).json({ error: "invalid_cursor" }); return;
    }

    const params: unknown[] = [convId, userId, limit + 1];
    if (cursor) params.push(cursor.createdAt, cursor.id);
    const r = await pool.query(
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
    res.json({
      items: newestFirst.reverse().map((message) => publicMessage(message)),
      hasMore,
      nextCursor: hasMore && oldest
        ? encodeHistoryCursor({ createdAt: new Date(oldest.createdAt as string).toISOString(), id: Number(oldest.id) })
        : null,
    });
  } catch (err) { next(err); }
});

/* ── POST /conversations/:id/messages ───────────────────────────── */
router.post("/conversations/:id/messages", requirePerm("messages.send"), async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(convId, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    /* ── M-03: Announcements are read-only for non-creators ──── */
    const convMeta = await pool.query<{ type: string; created_by_id: number }>(
      `SELECT type, created_by_id FROM conversations WHERE id=$1`,
      [convId],
    );
    if (convMeta.rows[0]?.type === "announcement") {
      const isCreator = convMeta.rows[0].created_by_id === userId;
      if (!isCreator && !isAdminRole(req.currentUser!.role)) {
        res.status(403).json({ error: "announcement_readonly", message: "Announcements are read-only. Only the creator may post follow-ups." });
        return;
      }
    }

    const { body, replyToId, attachments, forwardedFromId, mentionedUserIds: rawMentionedUserIds } = req.body as {
      body?: unknown; replyToId?: number; attachments?: unknown[]; forwardedFromId?: number;
      mentionedUserIds?: unknown;
    };
    const messageBody = typeof body === "string" ? body.trim() : "";
    if (!messageBody && !attachments?.length) {
      res.status(400).json({ error: "body or attachments required" });
      return;
    }

    // Validate mentionedUserIds: must be an array of positive integers if present
    let rawMentionIds: number[] = [];
    if (rawMentionedUserIds !== undefined) {
      if (!Array.isArray(rawMentionedUserIds) || rawMentionedUserIds.some((id) => !Number.isInteger(id) || id <= 0)) {
        res.status(422).json({ error: "invalid_mentioned_user_ids" }); return;
      }
      rawMentionIds = [...new Set(rawMentionedUserIds as number[])];
    }

    // Enforce max body length
    if (messageBody.length > 10_000) {
      res.status(400).json({ error: "message_too_long", message: "Messages may not exceed 10,000 characters." });
      return;
    }

    // A finalised key has no canonical message reference until the transaction
    // commits. If any later validation or database action fails, clean up only
    // those newly-finalised objects so a user-initiated retry starts cleanly.
    const finalizedObjectPaths: string[] = [];
    const discardFinalizedAttachments = async () => {
      await Promise.all(
        finalizedObjectPaths.map((objectPath) =>
          objectStorageService.deleteObject(objectPath).catch(() => undefined),
        ),
      );
      finalizedObjectPaths.length = 0;
    };

    let safeAttachments;
    try {
      safeAttachments = normaliseIncomingConversationAttachments(attachments);
    } catch {
      res.status(422).json({ error: "invalid_attachment", message: "Each attachment must reference a private uploaded object." });
      return;
    }
    if (attachments && attachments.length > 0 && safeAttachments.length === 0) {
      res.status(422).json({ error: "invalid_attachment" }); return;
    }
    if (safeAttachments.length > 0 && !hasPerm(permissionsFor(req.currentUser!), "messages.attachments.upload")) {
      res.status(403).json({
        error: "forbidden",
        message: "You do not have permission to perform this action.",
        requiredPermission: "messages.attachments.upload",
      });
      return;
    }
    if (safeAttachments.length > 0) {
      const rejectAttachment = async (status: number, payload: Record<string, string>) => {
        await discardFinalizedAttachments();
        res.status(status).json(payload);
      };
      try {
        for (let index = 0; index < safeAttachments.length; index++) {
        const incoming = attachments?.[index];
        const uploadToken = typeof incoming === "object" && incoming !== null
          ? (incoming as { uploadToken?: unknown }).uploadToken
          : undefined;
        if (typeof uploadToken !== "string") {
          return await rejectAttachment(400, { error: "uploadToken is required for message attachments" });
        }

        let descriptor;
        try {
          descriptor = verifyUploadToken(uploadToken);
        } catch (err) {
          if (err instanceof UploadTokenError) {
            return await rejectAttachment(400, { error: "invalid_upload_token" });
          }
          throw err;
        }

        const attachment = safeAttachments[index];
        if (descriptor.userId !== userId) {
          return await rejectAttachment(403, { error: "upload_token_user_mismatch" });
        }
        if (descriptor.entityType !== "message_attachment" || descriptor.scope !== "messages" || descriptor.reportId !== 0) {
          return await rejectAttachment(400, { error: "upload_token_entity_type_mismatch" });
        }
        if (
          descriptor.objectPath !== attachment.objectPath ||
          descriptor.fileName !== attachment.name ||
          descriptor.contentType !== attachment.contentType ||
          descriptor.maxSize !== attachment.size
        ) {
          return await rejectAttachment(422, { error: "attachment_metadata_mismatch" });
        }

        let storedMetadata;
        try {
          storedMetadata = await objectStorageService.getObjectEntityMetadata(attachment.objectPath);
        } catch (err) {
          if (err instanceof ObjectNotFoundError) {
            return await rejectAttachment(422, { error: "attachment_upload_missing" });
          }
          throw err;
        }
        if (storedMetadata.size !== descriptor.maxSize) {
          return await rejectAttachment(422, { error: "attachment_size_mismatch" });
        }
        const storedContentType = storedMetadata.contentType
          ?.split(";", 1)[0]
          ?.trim()
          .toLowerCase();
        if (storedContentType !== descriptor.contentType) {
          return await rejectAttachment(422, { error: "attachment_content_type_mismatch" });
        }

        // Store only a fresh, server-controlled key. The signed PUT URL
        // remains scoped to the temporary upload key and cannot overwrite
        // this accepted message attachment after creation.
        const finalObjectPath = await objectStorageService.finalizeObjectEntityUpload(
          attachment.objectPath,
        );
        finalizedObjectPaths.push(finalObjectPath);
        let finalMetadata;
        try {
          finalMetadata = await objectStorageService.getObjectEntityMetadata(finalObjectPath);
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
          return await rejectAttachment(422, { error: "finalized_attachment_metadata_mismatch" });
        }
        attachment.objectPath = finalObjectPath;
      }
      } catch (error) {
        await discardFinalizedAttachments();
        throw error;
      }
    }
    if (replyToId !== undefined && (!Number.isInteger(replyToId) || replyToId <= 0)) {
      await discardFinalizedAttachments();
      res.status(400).json({ error: "invalid_reply_reference" }); return;
    }
    if (forwardedFromId !== undefined && (!Number.isInteger(forwardedFromId) || forwardedFromId <= 0)) {
      await discardFinalizedAttachments();
      res.status(400).json({ error: "invalid_forward_reference" }); return;
    }

    // Validate mention targets: each ID must be an active member of this conversation.
    // Membership is always required for DMs. For non-DM conversations, PM/super_admin
    // full operational access does not grant the ability to mention arbitrary users
    // outside actual membership — only real members can be mentioned.
    let validatedMentionedUserIds: number[] = [];
    if (rawMentionIds.length > 0) {
      const { rows: validMentions } = await pool.query<{ id: number }>(
        `SELECT u.id FROM conversation_members cm
         JOIN users u ON u.id=cm.user_id
         WHERE cm.conversation_id=$1 AND u.status='active' AND u.id = ANY($2::int[])`,
        [convId, rawMentionIds],
      );
      const validSet = new Set(validMentions.map((r) => r.id));
      const invalidIds = rawMentionIds.filter((id) => !validSet.has(id));
      if (invalidIds.length > 0) {
        await discardFinalizedAttachments();
        res.status(422).json({ error: "invalid_mentioned_user_ids", message: "One or more mentioned users are not active members of this conversation." });
        return;
      }
      // Exclude the sender from their own mention notifications
      validatedMentionedUserIds = rawMentionIds.filter((id) => id !== userId);
    }

    const client = await pool.connect().catch(async (error) => {
      // No transaction was started, so these newly-finalised objects cannot
      // have a canonical message reference and are safe to discard.
      await discardFinalizedAttachments();
      throw error;
    });
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
          res.status(404).json({ error: "reply_source_not_found" }); return;
        }
        if (replySource.rows[0].conversation_id !== convId || replySource.rows[0].deleted_at) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          res.status(422).json({ error: "reply_source_unavailable" }); return;
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
          res.status(404).json({ error: "forward_source_not_found" }); return;
        }
        if (forwardedSource.rows[0].deleted_at) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          res.status(422).json({ error: "forward_source_unavailable" }); return;
        }
        if (!await assertMemberOrFullAccess(forwardedSource.rows[0].conversation_id, req.currentUser!)) {
          await client.query("ROLLBACK");
          await discardFinalizedAttachments();
          res.status(403).json({ error: "forward_source_forbidden" }); return;
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

      const full = await pool.query(
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
      await logAudit({ userId, action: "message_create", module: "messages", entityId: newMsgId, newValue: JSON.stringify({ conversationId: convId, body: messageBody.slice(0, 200) }) });
      if (forwardedFromId) {
        await logAudit({ userId, action: "message_forward", module: "messages", entityId: newMsgId, newValue: JSON.stringify({ conversationId: convId, forwardedFromId, body: messageBody.slice(0, 200) }) });
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

    const otherMembers = await pool.query<{ user_id: number }>(
      `SELECT user_id FROM conversation_members WHERE conversation_id=$1 AND user_id!=$2`,
      [convId, userId],
    );
    const memberIds = otherMembers.rows.map((m) => m.user_id);
    const senderName = req.currentUser!.name;

    /* ── M-01: Real-time push via Socket.IO ─────────────────── */
    // A message's reply preview is viewer-specific: a member may have hidden
    // the reply source. Emit only the stable identity needed by clients to
    // refetch their own authorised view; never fan out a sender-rendered DTO.
    await realtime.broadcastMessage([userId, ...memberIds], { id: newMsgId, conversationId: convId });
    await realtime.broadcastConversationUpdate(memberIds, convId);

    /* ── H-01: Deduplicated notifications (5-minute window) ──── */
    for (const m of otherMembers.rows) {
      await createNotificationDeduped({
        userId: m.user_id,
        kind: "message",
        entityType: "conversation",
        entityId: convId,
        message: `${senderName}: ${messageBody.slice(0, 80)}`,
        link: `/messages/${convId}`,
        dedupeKey: `conversation-message:${newMsgId}`,
      });
    }

    /* ── M-02: Structured @mention notifications ────────────── */
    // mentionedUserIds are validated by the send-message handler and contain
    // only active conversation members. Never resolve identities from text.
    if (validatedMentionedUserIds.length > 0) {
      for (const mentionedUid of validatedMentionedUserIds) {
        await pool.query(
          `INSERT INTO message_mentions (message_id, mentioned_user_id, mentioned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [newMsgId, mentionedUid, userId],
        );
        await createNotificationDeduped({
          userId: mentionedUid,
          kind: "mention",
          entityType: "conversation",
          entityId: convId,
          message: `${senderName} mentioned you in a message`,
          link: `/messages/${convId}`,
          dedupeKey: `conversation-message-mention:${newMsgId}:${mentionedUid}`,
        });
      }
    }

    res.status(201).json(msgRow);
  } catch (err) { next(err); }
});

/* ── POST /messages/:msgId/reactions ───────────────────────────── */
router.post("/messages/:msgId/reactions", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const msgId = parsePositiveInt(req.params.msgId as string);
    if (!msgId) { res.status(400).json({ error: "invalid_message_id" }); return; }
    const { emoji } = req.body as { emoji: string };
    const ALLOWED = ["👍", "❤️", "😂", "👏", "🎉", "🙏"];
    if (!ALLOWED.includes(emoji)) { res.status(400).json({ error: "invalid_emoji" }); return; }

    const msgRow = await pool.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1 AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!msgRow.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(msgRow.rows[0].conversation_id, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    // Idempotent toggle: use a single conditional DELETE/INSERT pair rather
    // than check-then-insert so concurrent requests on the same (message, user,
    // emoji) cannot race to produce a raw unique-constraint error.
    const deleted = await pool.query<{ id: number }>(
      `DELETE FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3 RETURNING id`,
      [msgId, userId, emoji],
    );
    if (!deleted.rows[0]) {
      await pool.query(
        `INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT (message_id, user_id, emoji) DO NOTHING`,
        [msgId, userId, emoji],
      );
    }

    const reactions = await pool.query(
      `SELECT r.emoji, r.user_id AS "userId", u.name AS "userName"
       FROM message_reactions r JOIN users u ON u.id=r.user_id
       WHERE r.message_id=$1 ORDER BY r.created_at ASC`,
      [msgId],
    );
    await realtime.broadcastConversationUpdate([], msgRow.rows[0].conversation_id, {
      change: "message:reaction",
      messageId: msgId,
      actorId: userId,
      actorName: req.currentUser!.name,
    });
    res.json(reactions.rows);
  } catch (err) { next(err); }
});

/* ── GET /conversations/:id/media ───────────────────────────────── */
router.get("/conversations/:id/media", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(convId, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const r = await pool.query(
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
      const atts = publicConversationAttachments(convId, row.messageId as number, row.attachments);
      for (const att of atts) {
        const item = { ...att, sentAt: row.sentAt, senderName: row.senderName, messageId: row.messageId };
        if (att.type === "image") photos.push(item);
        else if (att.type === "voice") voices.push(item);
        else docs.push(item);
      }
    }
    res.json({ photos, docs, voices });
  } catch (err) { next(err); }
});

/* ── GET /conversations/:id/messages/:messageId/attachments/:index ─────────── */
router.get("/conversations/:id/messages/:messageId/attachments/:index", async (req, res, next) => {
  try {
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const messageId = parseInt(req.params.messageId as string);
    const index = parseInt(req.params.index as string);
    if (![convId, messageId, index].every(Number.isInteger) || convId <= 0 || messageId <= 0 || index < 0) {
      res.status(404).json({ error: "not_found" }); return;
    }

    const hasAccess = await assertMemberOrFullAccess(convId, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }
    const message = await pool.query<{ attachments: unknown }>(
      `SELECT attachments FROM messages
       WHERE id=$1 AND conversation_id=$2 AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$3
         )`,
      [messageId, convId, req.currentUser!.id],
    );
    if (!message.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    const attachment = conversationAttachmentAt(message.rows[0].attachments, index);
    if (!attachment) { res.status(404).json({ error: "attachment_not_found" }); return; }
    if (attachment.availabilityStatus === "unavailable") {
      res.status(410).json({ error: "file_unavailable", message: "File Unavailable" }); return;
    }

    const objectFile = await objectStorageService.getObjectEntityFile(attachment.objectPath);
    const response = await objectStorageService.downloadObject(objectFile);
    const contentType = attachment.contentType?.toLowerCase();
    const canRenderInline = Boolean(contentType && SAFE_INLINE_ATTACHMENT_CONTENT_TYPES.has(contentType));
    res.status(response.status);
    // Message JSON is client-submitted metadata, so it cannot select an
    // arbitrary browser-rendered MIME type. This keeps hostile HTML/SVG
    // metadata from turning a private-file proxy into a same-origin XSS sink.
    res.setHeader(
      "Content-Type",
      canRenderInline ? contentType! : "application/octet-stream",
    );
    res.setHeader(
      "Content-Disposition",
      attachmentContentDisposition(attachment.name, canRenderInline),
    );
    response.headers.forEach((value, key) => {
      if (!["content-type", "content-disposition"].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "attachment_not_found" }); return;
    }
    next(err);
  }
});

/* ── PATCH /messages/:msgId ─────────────────────────────────────── */
router.patch("/messages/:msgId", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const msgId = parsePositiveInt(req.params.msgId as string);
    if (!msgId) { res.status(400).json({ error: "invalid_message_id" }); return; }
    const { body } = req.body as { body: string };

    if (body && body.length > 10_000) {
      res.status(400).json({ error: "message_too_long" }); return;
    }

    const existing = await pool.query<{ sender_id: number; conversation_id: number; deleted_at: string | null; created_at: string }>(
      `SELECT sender_id, conversation_id, deleted_at, created_at FROM messages
       WHERE id=$1
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!existing.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    if (existing.rows[0].sender_id !== userId) { res.status(403).json({ error: "forbidden" }); return; }
    if (!await assertMemberOrFullAccess(existing.rows[0].conversation_id, req.currentUser!)) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    if (existing.rows[0].deleted_at) { res.status(400).json({ error: "message_deleted" }); return; }

    const ageMs = Date.now() - new Date(existing.rows[0].created_at).getTime();
    if (ageMs > 15 * 60 * 1000) {
      res.status(403).json({ error: "edit_window_expired", message: "Messages can only be edited within 15 minutes of sending." });
      return;
    }

    const edited = await pool.query(
      `UPDATE messages
       SET body=$1, edited_at=NOW()
       WHERE id=$2
         AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [body.trim(), msgId],
    );
    if ((edited.rowCount ?? 0) !== 1) {
      res.status(409).json({ error: "message_already_deleted" }); return;
    }
    await logAudit({ userId, action: "message_edit", module: "messages", entityId: msgId, newValue: body.trim().slice(0, 200) });
    const updated = await pool.query(
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
    await realtime.broadcastConversationUpdate([], existing.rows[0].conversation_id, {
      change: "message:updated",
      messageId: msgId,
      actorId: userId,
      actorName: req.currentUser!.name,
    });
    res.json(publicMessage(updated.rows[0]));
  } catch (err) { next(err); }
});

/* ── DELETE /messages/:msgId ────────────────────────────────────── */
router.delete("/messages/:msgId", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const msgId = parsePositiveInt(req.params.msgId as string);
    if (!msgId) { res.status(400).json({ error: "invalid_message_id" }); return; }
    const deletionType: "for_me" | "for_everyone" = (req.body as { deletionType?: string })?.deletionType === "for_everyone" ? "for_everyone" : "for_me";

    const existing = await pool.query<{ sender_id: number; conversation_id: number; created_at: string; deleted_at: string | null; deletion_type: string | null }>(
      `SELECT sender_id, conversation_id, created_at, deleted_at, deletion_type FROM messages
       WHERE id=$1
         ${deletionType === "for_everyone" ? `AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )` : ""}`,
      [msgId, userId],
    );
    if (!existing.rows[0]) { res.status(404).json({ error: "not_found" }); return; }

    const hasAccess = await assertMemberOrFullAccess(existing.rows[0].conversation_id, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const isSender = existing.rows[0].sender_id === userId;
    const isAdmin = ["super_admin", "executive_director", "program_manager"].includes(req.currentUser!.role);

    if (deletionType === "for_everyone") {
      // Only sender (or admin) may delete for everyone, within 15 minutes
      if (!isSender && !isAdmin) {
        res.status(403).json({ error: "forbidden", message: "Only the sender can delete for everyone." }); return;
      }
      const ageMs = Date.now() - new Date(existing.rows[0].created_at).getTime();
      if (ageMs > 15 * 60 * 1000 && !isAdmin) {
        res.status(403).json({ error: "delete_window_expired", message: "Delete for everyone is only available within 15 minutes of sending." }); return;
      }
    }

    if (deletionType === "for_me") {
      // A private hide belongs only to a real member. Operational access to a
      // non-DM conversation is deliberately not converted into fake membership.
      if (!await assertMember(existing.rows[0].conversation_id, userId)) {
        res.status(403).json({ error: "forbidden" }); return;
      }
      if (existing.rows[0].deletion_type === "for_everyone") {
        res.status(204).end(); return;
      }
      await pool.query(
        `INSERT INTO message_user_hides (message_id, user_id)
         VALUES ($1,$2) ON CONFLICT (message_id, user_id) DO NOTHING`,
        [msgId, userId],
      );
      await logAudit({ userId, action: "message_hide", module: "messages", entityId: msgId });
      // Private hide state is never shared with conversation viewers. Notify
      // only this actor's other sessions to refetch their authorised view.
      realtime.broadcastPersonalConversationUpdate(userId, existing.rows[0].conversation_id);
      res.status(204).end(); return;
    }

    const deleted = await pool.query(
      `UPDATE messages
       SET deleted_at=NOW(), deleted_by=$2, deletion_type='for_everyone',
           is_pinned=FALSE, pinned_by=NULL, pinned_at=NULL
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [msgId, userId],
    );
    if ((deleted.rowCount ?? 0) !== 1) {
      res.status(409).json({ error: "message_already_deleted" }); return;
    }
    await logAudit({ userId, action: "message_delete", module: "messages", entityId: msgId, newValue: JSON.stringify({ deletionType: "for_everyone" }) });
    await realtime.broadcastConversationUpdate([], existing.rows[0].conversation_id, {
      change: "message:deleted",
      messageId: msgId,
      actorId: userId,
      actorName: req.currentUser!.name,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── POST /messages/:msgId/pin ──────────────────────────────────── */
const PIN_ROLES = new Set(["super_admin", "executive_director", "program_manager", "senior_program_coordinator", "technical_coordinator"]);
router.post("/messages/:msgId/pin", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const msgId = parsePositiveInt(req.params.msgId as string);
    if (!msgId) { res.status(400).json({ error: "invalid_message_id" }); return; }
    if (!PIN_ROLES.has(req.currentUser!.role)) {
      res.status(403).json({ error: "forbidden", message: "Only managers and coordinators may pin messages." }); return;
    }
    const msgRow = await pool.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'
         AND NOT EXISTS (SELECT 1 FROM message_user_hides WHERE message_id=messages.id AND user_id=$2)`, [msgId, userId],
    );
    if (!msgRow.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(msgRow.rows[0].conversation_id, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const convId = msgRow.rows[0].conversation_id;
    const pinCount = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM messages
       WHERE conversation_id=$1 AND is_pinned=TRUE
         AND deletion_type IS DISTINCT FROM 'for_everyone'
         AND NOT EXISTS (SELECT 1 FROM message_user_hides WHERE message_id=messages.id AND user_id=$2)`,
      [convId, userId],
    );
    if (parseInt(pinCount.rows[0]?.count ?? "0", 10) >= 10) {
      res.status(400).json({ error: "pin_limit_exceeded", message: "Maximum of 10 pinned messages per conversation." }); return;
    }

    const pinned = await pool.query(
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
    if ((pinned.rowCount ?? 0) !== 1) {
      res.status(409).json({ error: "message_already_deleted" }); return;
    }
    await logAudit({ userId, action: "message_pin", module: "messages", entityId: msgId });
    await realtime.broadcastConversationUpdate([], convId, {
      change: "message:pin",
      messageId: msgId,
      actorId: userId,
      actorName: req.currentUser!.name,
    });

    // Notify all conversation members (except the pinner) that a message was pinned
    const pinner = req.currentUser!.name;
    const { rows: members } = await pool.query<{ user_id: number }>(
      `SELECT user_id FROM conversation_members WHERE conversation_id = $1 AND user_id != $2`,
      [convId, userId],
    );
    for (const m of members) {
      await createNotificationDeduped({
        userId: m.user_id,
        kind: "message",
        entityType: "conversation",
        entityId: convId,
        message: `${pinner} pinned a message in a conversation`,
        link: `/messages/${convId}`,
        dedupeKey: `conversation-message-pin:${msgId}`,
      });
    }
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── DELETE /messages/:msgId/pin ────────────────────────────────── */
router.delete("/messages/:msgId/pin", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const msgId = parsePositiveInt(req.params.msgId as string);
    if (!msgId) { res.status(400).json({ error: "invalid_message_id" }); return; }
    if (!PIN_ROLES.has(req.currentUser!.role)) {
      res.status(403).json({ error: "forbidden" }); return;
    }
    const msgRow = await pool.query<{ conversation_id: number }>(
      `SELECT conversation_id FROM messages
       WHERE id=$1
         AND NOT EXISTS (
           SELECT 1 FROM message_user_hides muh
           WHERE muh.message_id=messages.id AND muh.user_id=$2
         )`,
      [msgId, userId],
    );
    if (!msgRow.rows[0]) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(msgRow.rows[0].conversation_id, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const unpinned = await pool.query(
      `UPDATE messages SET is_pinned=FALSE, pinned_by=NULL, pinned_at=NULL
       WHERE id=$1 AND deletion_type IS DISTINCT FROM 'for_everyone'`,
      [msgId],
    );
    if ((unpinned.rowCount ?? 0) !== 1) {
      res.status(409).json({ error: "message_already_deleted" }); return;
    }
    await logAudit({ userId, action: "message_unpin", module: "messages", entityId: msgId });
    await realtime.broadcastConversationUpdate([], msgRow.rows[0].conversation_id, {
      change: "message:unpin",
      messageId: msgId,
      actorId: userId,
      actorName: req.currentUser!.name,
    });
    res.status(204).end();
  } catch (err) { next(err); }
});

/* ── GET /conversations/:id/pinned ──────────────────────────────── */
router.get("/conversations/:id/pinned", async (req, res, next) => {
  try {
    const userId = req.currentUser!.id;
    const convId = parsePositiveInt(req.params.id as string);
    if (!convId) { res.status(404).json({ error: "not_found" }); return; }
    const hasAccess = await assertMemberOrFullAccess(convId, req.currentUser!);
    if (!hasAccess) { res.status(403).json({ error: "forbidden" }); return; }

    const r = await pool.query(
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
    res.json(r.rows.map((message) => publicMessage({
      ...message,
      conversationId: convId,
    })));
  } catch (err) { next(err); }
});

export default router;
