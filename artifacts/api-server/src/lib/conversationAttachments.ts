/**
 * Conversation message attachment helpers.
 *
 * Object paths are storage internals. Clients receive only a message-bound
 * proxy URL, and the proxy re-resolves the stored attachment through the
 * parent message and conversation authorisation check.
 */
import { pool } from "@workspace/db";

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

export function normaliseIncomingConversationAttachments(value: unknown): StoredConversationAttachment[] {
  if (!Array.isArray(value)) return [];
  const attachments = value.map((item) => attachmentFromRecord(item as AttachmentRecord));
  if (attachments.some((attachment) => attachment === null)) {
    throw new Error("invalid_conversation_attachment");
  }
  return attachments as StoredConversationAttachment[];
}

export function publicConversationAttachments(
  conversationId: number,
  messageId: number,
  value: unknown,
): Array<Omit<StoredConversationAttachment, "objectPath"> & { url: string }> {
  return attachmentArray(value).flatMap((record, index) => {
    const attachment = attachmentFromRecord(record);
    if (!attachment) return [];
    const { objectPath: _internalPath, ...publicAttachment } = attachment;
    return [{
      ...publicAttachment,
      url: `/api/conversations/${conversationId}/messages/${messageId}/attachments/${index}`,
    }];
  });
}

export function conversationAttachmentAt(
  value: unknown,
  index: number,
): StoredConversationAttachment | null {
  if (!Number.isInteger(index) || index < 0) return null;
  const record = attachmentArray(value)[index];
  return record ? attachmentFromRecord(record) : null;
}

/**
 * Used by the legacy generic object endpoint as a second line of defence.
 * A caller who obtains or guesses an internal path still has to pass the
 * message's parent-conversation access check.
 */
export async function findConversationAttachmentByObjectPath(objectPath: string): Promise<{
  messageId: number;
  conversationId: number;
  availabilityStatus?: "available" | "unavailable";
} | null> {
  const result = await pool.query<{
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