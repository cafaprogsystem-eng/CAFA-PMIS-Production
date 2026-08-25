/**
 * Attachment queue for offline form submissions.
 *
 * When a user tries to upload a file while offline the binary cannot be
 * serialised reliably into IndexedDB across all browsers and quota scenarios.
 * Instead we:
 *   1. Record the file metadata in the Dexie `attachmentQueue` store.
 *   2. Require the user to re-select the file once online. Files are never
 *      retained for replay, even in memory, until a separately reviewed
 *      durable attachment design exists.
 *
 * The main form record syncs independently — a pending attachment never
 * blocks the parent form from syncing.
 */

import { db, getOfflineUser } from "./db";
import type { AttachmentQueueItem } from "./db";

export type { AttachmentQueueItem };

/**
 * In-memory File cache.
 * Key = AttachmentQueueItem.id (UUID).
 * Lost on page reload — this is intentional and safe: we never serialise
 * raw binary data into IndexedDB.
 */
export interface QueueAttachmentOptions {
  fileName: string;
  fileSize: number;
  contentType: string;
  /** Accepted for compatibility; binary data is intentionally never retained. */
  file?: File;
}

/**
 * Record an attachment that could not be uploaded while offline.
 * Returns the queue item id (UUID).
 */
export async function queueAttachment(
  opts: QueueAttachmentOptions,
): Promise<string> {
  const userId = getOfflineUser();
  if (userId === null) {
    throw new Error("Cannot queue attachment metadata without an authenticated user");
  }
  const id = crypto.randomUUID();

  const item: AttachmentQueueItem = {
    id,
    userId,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    contentType: opts.contentType,
    status: "re-select-required",
    createdAt: Date.now(),
    uploadedAt: null,
    lastError: null,
    objectPath: null,
  };

  await db.attachmentQueue.put(item);
  return id;
}

/**
 * Attempt to upload one attachment if its File is still in the in-memory cache.
 * Returns true if the upload succeeded, false otherwise.
 */
export async function tryUploadAttachment(id: string): Promise<boolean> {
  const item = await db.attachmentQueue.get(id);
  if (!item || item.userId !== getOfflineUser() || item.status === "uploaded") return false;

  await db.attachmentQueue.update(id, {
    status: "re-select-required",
    lastError: "Files cannot be stored or replayed offline. Re-select this file after reconnecting.",
  });
  return false;
}

/**
 * Upload all attachments that have a File in the in-memory cache.
 * Attachments without a cached File are downgraded to "re-select-required".
 * Called automatically when connectivity is restored.
 */
export async function processAllPendingAttachments(): Promise<void> {
  const userId = getOfflineUser();
  if (userId === null) return;
  await db.attachmentQueue
    .where("userId")
    .equals(userId)
    .and((item) => item.status === "pending" || item.status === "failed")
    .modify({ status: "re-select-required" });
}

/**
 * Permanently remove an attachment queue entry.
 * Call after the user has manually re-uploaded or chosen to skip.
 */
export async function dismissAttachment(id: string): Promise<void> {
  const item = await db.attachmentQueue.get(id);
  if (!item || item.userId !== getOfflineUser()) return;
  await db.attachmentQueue.delete(id);
}

/** Clear all attachment queue data and in-memory file references. Called on logout. */
export async function clearAllAttachmentData(): Promise<void> {
  await db.attachmentQueue.clear();
}
