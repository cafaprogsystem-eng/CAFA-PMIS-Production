/**
 * Ported from artifacts/api-server/src/lib/attachmentLimits.ts.
 *
 * Single source of truth for the maximum attachment upload size, shared by
 * every upload surface (report/plan/project attachments, Filing & Archive
 * uploads, generic object-storage uploads, and the Drive facade).
 *
 * Adapted: the Express original reads process.env.MAX_ATTACHMENT_SIZE_MB
 * (default 25) — Workers has no process.env, and no Bindings entry for this
 * exists, so the default is hardcoded here. Add a Bindings field and switch
 * this to a function of `env` if per-environment configurability is ever
 * needed.
 */
export const MAX_ATTACHMENT_SIZE_MB = 25;
export const MAX_ATTACHMENT_BYTES = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;
