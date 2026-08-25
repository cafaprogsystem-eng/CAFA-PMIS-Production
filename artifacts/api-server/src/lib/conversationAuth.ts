/**
 * Canonical Conversation Centre access checks.
 *
 * Direct conversations are an explicit privacy boundary: membership is always
 * required, including for users with Full Operational Access. PM and Super
 * Admin may view operational (non-direct) conversations without being members.
 */
import { pool } from "@workspace/db";
import { hasFullOperationalAccess } from "./accessControl";

export type ConversationAccessUser = { id: number; role: string };

export async function isConversationMember(conversationId: number, userId: number): Promise<boolean> {
  const result = await pool.query(
    `SELECT 1 FROM conversation_members WHERE conversation_id=$1 AND user_id=$2`,
    [conversationId, userId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function canAccessConversation(
  conversationId: number,
  user: ConversationAccessUser,
): Promise<boolean> {
  if (await isConversationMember(conversationId, user.id)) return true;
  if (!hasFullOperationalAccess(user)) return false;

  const result = await pool.query<{ type: string }>(
    `SELECT type FROM conversations WHERE id=$1`,
    [conversationId],
  );
  // Missing conversations fail closed. Direct messages remain member-only.
  return result.rows[0]?.type !== undefined && result.rows[0].type !== "direct";
}