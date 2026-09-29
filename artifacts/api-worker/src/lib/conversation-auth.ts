/**
 * Ported from artifacts/api-server/src/lib/conversationAuth.ts. Only the
 * read-side membership/access check is needed here — routes/storage.ts's
 * private-object proxy uses it as a second line of defence for message
 * attachments even though conversations.ts (conversation/message CRUD,
 * membership management) has not been ported to this worker yet. This check
 * is what keeps a Communication Centre attachment from being readable by
 * anyone who merely holds documents.view in the meantime; the full feature
 * port will grow this file's other call sites once conversations.ts lands.
 *
 * Direct conversations are an explicit privacy boundary: membership is
 * always required, including for users with Full Operational Access. PM and
 * Super Admin may view operational (non-direct) conversations without being
 * members.
 */
import type { QueryExecutor } from "./db";
import { hasFullOperationalAccess, type UserForAccess } from "./accessControl";

export async function isConversationMember(
  db: QueryExecutor,
  conversationId: number,
  userId: number,
): Promise<boolean> {
  const result = await db.query(
    `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
    [conversationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function canAccessConversation(
  db: QueryExecutor,
  conversationId: number,
  user: UserForAccess,
): Promise<boolean> {
  if (await isConversationMember(db, conversationId, user.id)) return true;
  if (!hasFullOperationalAccess(user)) return false;

  const result = await db.query<{ type: string }>(
    `SELECT type FROM conversations WHERE id=$1`,
    [conversationId],
  );
  // Missing conversations fail closed. Direct messages remain member-only.
  return result.rows[0]?.type !== undefined && result.rows[0].type !== "direct";
}
