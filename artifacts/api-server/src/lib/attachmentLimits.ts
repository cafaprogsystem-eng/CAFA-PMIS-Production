/**
 * Single source of truth for the maximum attachment upload size, shared by
 * every upload surface (report/plan/project attachments, Filing & Archive
 * uploads, generic object-storage uploads, and the legacy Drive facade).
 *
 * Previously each module computed its own limit independently — two hardcoded
 * 20MB literals plus one env-driven 25MB default — so an operator setting
 * MAX_ATTACHMENT_SIZE_MB expected it to apply uniformly and it silently
 * didn't. Importing this constant everywhere makes that true.
 */
export const MAX_ATTACHMENT_SIZE_MB = Number(process.env.MAX_ATTACHMENT_SIZE_MB ?? "25");
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
