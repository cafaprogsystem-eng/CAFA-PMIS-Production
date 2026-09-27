/**
 * Ported from artifacts/api-server/src/lib/conversationAttachments.ts — only
 * the read-side lookup routes/storage.ts's private-object proxy needs
 * (resolving a bare object path back to its parent message/conversation, so
 * possessing the path alone is never enough to read a Communication Centre
 * attachment). The write-side helpers (normaliseIncomingConversationAttachments,
 * publicConversationAttachments, conversationAttachmentAt) belong to
 * conversations.ts's own message create/read routes and will be ported
 * alongside that file, not here.
 */
import type { QueryExecutor } from "./db";

export type StoredConversationAttachment = {
  name: string;
  type: string;
  objectPath: string;
  contentType?: string;
  size?: number;
  duration?: number;
  availabilityStatus?: "available" | "unavailable";
};

type AttachmentRecord = Record<string, unknown>;

function attachmentArray(value: unknown): AttachmentRecord[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is AttachmentRecord => Boolean(item) && typeof item === "object");
  }
  if (typeof value === "string") {
    try {
      return attachmentArray(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Supports the stored objectPath format and the legacy private-object URL
 * format. Public-object URLs and arbitrary external URLs are deliberately not
 * accepted: those values cannot prove a parent-record relationship.
 */
export function normaliseConversationObjectPath(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  if (value.startsWith("/objects/") && !value.includes("..") && !value.includes("//")) return value;

  try {
    const pathname = new URL(value, "http://internal").pathname;
    const marker = "/api/storage/objects/";
    const markerIndex = pathname.indexOf(marker);
    if (markerIndex >= 0) {
      const suffix = pathname.slice(markerIndex + marker.length);
      if (suffix && !suffix.includes("..") && !suffix.includes("//")) return `/objects/${suffix}`;
    }
  } catch {
    // Invalid values are not safe attachment object references.
  }
  return null;
}

function attachmentFromRecord(record: AttachmentRecord): StoredConversationAttachment | null {
  const objectPath = normaliseConversationObjectPath(record.objectPath ?? record.url);
  if (!objectPath || typeof record.name !== "string" || typeof record.type !== "string") return null;

  const attachment: StoredConversationAttachment = {
    name: record.name.slice(0, 255),
    type: record.type,
    objectPath,
  };
  if (typeof record.contentType === "string" && record.contentType.length <= 255) {
    attachment.contentType = record.contentType;
  }
  if (typeof record.size === "number" && Number.isFinite(record.size) && record.size >= 0) attachment.size = record.size;
  if (typeof record.duration === "number" && Number.isFinite(record.duration) && record.duration >= 0) attachment.duration = record.duration;
  if (record.availabilityStatus === "unavailable") attachment.availabilityStatus = "unavailable";
  else if (record.availabilityStatus === "available") attachment.availabilityStatus = "available";
  return attachment;
}

/**
 * Used by the legacy generic object endpoint as a second line of defence.
 * A caller who obtains or guesses an internal path still has to pass the
 * message's parent-conversation access check.
 */
export async function findConversationAttachmentByObjectPath(
  db: QueryExecutor,
  objectPath: string,
): Promise<{
  messageId: number;
  conversationId: number;
  availabilityStatus?: "available" | "unavailable";
} | null> {
  const result = await db.query<{
    id: number;
    conversationId: number;
    attachments: unknown;
  }>(
    `SELECT id, conversation_id AS "conversationId", attachments
     FROM messages
     WHERE deleted_at IS NULL
       AND attachments IS NOT NULL
       AND attachments::text LIKE '%' || $1 || '%'`,
    [objectPath],
  );

  for (const row of result.rows) {
    const attachment = attachmentArray(row.attachments)
      .map(attachmentFromRecord)
      .find((candidate) => candidate?.objectPath === objectPath);
    if (attachment) {
      return {
        messageId: row.id,
        conversationId: row.conversationId,
        availabilityStatus: attachment.availabilityStatus,
      };
    }
  }
  return null;
}
