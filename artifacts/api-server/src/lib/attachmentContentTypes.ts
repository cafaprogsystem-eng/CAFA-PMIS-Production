/**
 * Single source of truth for the set of MIME types accepted by a generic
 * document/media attachment upload, shared by every upload surface
 * (routes/storage.ts's presigned-URL requests and routes/attachments.ts's
 * operation-based Plan/Risk attachment flow).
 *
 * Previously each module hand-maintained its own copy and they had already
 * drifted: attachments.ts silently rejected image/svg+xml and every audio
 * MIME type (voice-note-shaped uploads) that storage.ts accepted — the same
 * class of bug already fixed once for attachment size limits (see
 * attachmentLimits.ts). Importing this set everywhere keeps the two in sync.
 */
export const ALLOWED_ATTACHMENT_CONTENT_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "application/zip",
  "application/x-zip-compressed",
  "audio/webm",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
]);
