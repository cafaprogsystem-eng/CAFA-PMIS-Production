import { Hono } from "hono";
import { RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import {
  attachCurrentUser,
  requireAuth,
  requirePerm,
  hasPerm,
  permissionsFor,
  type CurrentUser,
  type Variables,
} from "../lib/rbac";
import {
  ObjectNotFoundError,
  isStorageConfigured,
  searchPublicObject,
  getObjectEntityFile,
  getObjectEntityUploadURL,
  normalizeObjectEntityPath,
  downloadObject,
} from "../lib/storage";
import { signUploadToken } from "../lib/upload-token";
import { assertAttachmentMutationAllowed } from "../lib/report-auth";
import { canAccessConversation } from "../lib/conversation-auth";
import { findConversationAttachmentByObjectPath } from "../lib/conversation-attachments";
import { projectScopeSql, planScopeSql, reportScopeSql } from "./files";
import { MAX_ATTACHMENT_BYTES as MAX_FILE_SIZE_BYTES } from "../lib/attachment-limits";
import { ALLOWED_ATTACHMENT_CONTENT_TYPES as ALLOWED_CONTENT_TYPES } from "../lib/attachment-content-types";
import { hasUnsafeFileNameChar } from "../lib/safe-file-name";

/**
 * Ported from artifacts/api-server/src/routes/storage.ts (376 lines) —
 * second file of the attachments group, added to it because it issues the
 * upload tokens attachments.ts/reports.ts/voice-notes.ts/plans.ts/risks.ts
 * all depend on, and because its private-object proxy reuses
 * projectScopeSql/planScopeSql/reportScopeSql exported from the just-ported
 * routes/files.ts.
 *
 * Dropped: the gcs/replit ObjectStorageService provider branches (files.ts's
 * lib/storage.ts port already dropped these — R2 speaks the same
 * S3-compatible API the "s3" branch already targeted).
 *
 * NOT dropped, despite conversations.ts (conversation/message CRUD) not
 * being ported to this worker yet: the Communication Centre special case in
 * GET /storage/objects/* — canAccessConversation and
 * findConversationAttachmentByObjectPath are small, self-contained,
 * read-only DB checks against tables (messages, conversation_members,
 * conversations) that already exist in the shared schema, so they are
 * ported now (lib/conversation-auth.ts, lib/conversation-attachments.ts)
 * rather than deferred. Skipping them here would have been a real
 * authorization bypass the moment this route takes production traffic: any
 * caller holding the broad documents.view permission could otherwise read
 * another user's Communication Centre attachment by object path alone,
 * despite never having access to its conversation. The write-side of that
 * feature (composing/reading messages) is unaffected and still awaits
 * conversations.ts's own port.
 */

// The three record-scoped attachment tables /storage/objects/* can be asked
// to serve. Holding the broad `documents.view` permission is not enough on
// its own — each owner's own sector/state scope (the same rules
// projectScopeSql/planScopeSql/reportScopeSql apply in the Filing & Archive
// registry) must also allow this specific caller, or a TC/SPO who obtains an
// internal object path out of band (an old bookmark, a leaked log line) could
// read another sector's or state's attachment despite never having access to
// it through any canonical route.
const OBJECT_OWNER_TABLES: {
  table: string;
  alias: string;
  join: string;
  scope: (user: CurrentUser | undefined, params: unknown[]) => string;
}[] = [
  {
    table: "project_documents",
    alias: "pd",
    join: "JOIN projects p ON p.id = pd.project_id",
    scope: (user, params) => projectScopeSql(user, params, "p"),
  },
  {
    table: "plan_attachments",
    alias: "pa",
    join: "JOIN plans pl ON pl.id = pa.plan_id LEFT JOIN projects p ON p.id = pl.project_id",
    scope: planScopeSql,
  },
  {
    table: "report_attachments",
    alias: "ra",
    join: "JOIN reports r ON r.id = ra.report_id LEFT JOIN projects p ON p.id = r.project_id LEFT JOIN activities act ON act.id = r.activity_id",
    scope: reportScopeSql,
  },
];

// Returns true when `objectPath` is owned by one of the three tables above
// AND the current user's scope excludes it — the caller must be denied.
// Returns false when the object is either not owned by any of these tables
// (a different owner, e.g. program_resources, or the Communication Centre
// attachment already checked by the caller) or is owned and in scope.
async function scopedAttachmentOwnerDenies(
  db: QueryExecutor,
  user: CurrentUser | undefined,
  objectPath: string,
): Promise<boolean> {
  for (const { table, alias, join, scope } of OBJECT_OWNER_TABLES) {
    const params: unknown[] = [objectPath];
    const scopeSql = scope(user, params);
    const scoped = await db.query(
      `SELECT 1 FROM ${table} ${alias} ${join} WHERE ${alias}.object_path = $1 AND (${scopeSql}) LIMIT 1`,
      params,
    );
    if (scoped.rows.length > 0) return false;
    const exists = await db.query(`SELECT 1 FROM ${table} WHERE object_path = $1 LIMIT 1`, [objectPath]);
    if (exists.rows.length > 0) return true;
  }
  return false;
}

export const storageRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

storageRoutes.use("/storage/status", attachCurrentUser, requireAuth);
storageRoutes.use("/storage/uploads/request-url", attachCurrentUser, requireAuth);
storageRoutes.use("/storage/objects/*", attachCurrentUser, requireAuth);
// /storage/public-objects/* intentionally has no auth middleware — it serves
// the bucket's public/ prefix, matching the source route.

// ─── GET /storage/status ────────────────────────────────────────────────────
// Admin-only route that returns the current storage configuration status.
// Used to show a warning in the admin UI when file uploads are disabled.
storageRoutes.get("/storage/status", requirePerm("settings.view"), (c) => {
  return c.json(isStorageConfigured(c.env));
});

// ─── POST /storage/uploads/request-url ──────────────────────────────────────
storageRoutes.post("/storage/uploads/request-url", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const body = await c.req.json().catch(() => ({}));
    const parsed = RequestUploadUrlBody.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Missing or invalid required fields" }, 400);
    }

    const { name, size, contentType, scope, reportId, entityType } = parsed.data;
    const isReportUpload =
      typeof reportId === "number" &&
      Number.isInteger(reportId) &&
      reportId > 0 &&
      (entityType === "attachment" || entityType === "voice_note");

    if (scope === "messages" && (reportId !== undefined || entityType !== undefined)) {
      return c.json({ error: "invalid_upload_scope" }, 400);
    }

    const requiredPermission = scope === "messages" ? "messages.attachments.upload" : "documents.upload";
    const canRequestDocumentUpload = scope === "documents" && hasPerm(permissionsFor(user), "program_resources.upload");
    if (!hasPerm(permissionsFor(user), requiredPermission) && !canRequestDocumentUpload) {
      return c.json({
        error: "forbidden",
        message: "You do not have permission to perform this action.",
        requiredPermission,
      }, 403);
    }

    if (isReportUpload) {
      const authCheck = await assertAttachmentMutationAllowed(db, user, reportId!);
      if (!authCheck.ok) return c.json(authCheck.body, authCheck.status as 401 | 403 | 404 | 409);
    }

    const storageStatus = isStorageConfigured(c.env);
    if (!storageStatus.configured) {
      return c.json({
        error: "storage_not_configured",
        message:
          "File uploads are disabled because object storage is not configured. " +
          (storageStatus.reason ?? "Set the required R2 credentials."),
      }, 503);
    }

    if (typeof size === "number" && size > MAX_FILE_SIZE_BYTES) {
      return c.json({
        error: "file_too_large",
        message: `File size exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
      }, 413);
    }

    const normalizedType = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (normalizedType && !ALLOWED_CONTENT_TYPES.has(normalizedType)) {
      return c.json({
        error: "unsupported_media_type",
        message: "File type not allowed. Permitted types: PDF, Word, Excel, PowerPoint, CSV, images, ZIP, and audio.",
      }, 415);
    }

    // Object keys are server-generated, but the filename is later used in
    // Content-Disposition. Reject paths and control characters rather than
    // silently transforming an unsafe client filename.
    if (hasUnsafeFileNameChar(name)) {
      return c.json({ error: "invalid_file_name" }, 400);
    }
    const safeName = name.trim();
    if (!safeName || safeName.length > 255) {
      return c.json({ error: "invalid_file_name" }, 400);
    }

    const uploadURL = await getObjectEntityUploadURL(c.env, normalizedType || "application/octet-stream");
    const objectPath = normalizeObjectEntityPath(c.env, uploadURL);

    // Issue a signed upload descriptor when the client must later register
    // the object with a parent record. Message descriptors bind the private
    // path and metadata to the requesting user before message creation.
    let uploadToken: string | undefined;
    const iat = Math.floor(Date.now() / 1000);
    if (isReportUpload) {
      uploadToken = signUploadToken({
        objectPath,
        userId: user.id,
        reportId: reportId!,
        entityType: entityType!,
        contentType: normalizedType || (contentType ?? ""),
        maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
        iat,
        exp: iat + 86400, // 24 hours
      }, c.env.SESSION_SECRET);
    }
    if (scope === "messages") {
      uploadToken = signUploadToken({
        objectPath,
        userId: user.id,
        reportId: 0,
        entityType: "message_attachment",
        scope: "messages",
        fileName: safeName,
        contentType: normalizedType || (contentType ?? ""),
        maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
        iat,
        exp: iat + 86400, // 24 hours
      }, c.env.SESSION_SECRET);
    }
    if (scope === "documents") {
      uploadToken = signUploadToken({
        objectPath,
        userId: user.id,
        reportId: 0,
        entityType: "attachment",
        scope: "documents",
        fileName: safeName,
        contentType: normalizedType || (contentType ?? ""),
        maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
        iat,
        exp: iat + 86400,
      }, c.env.SESSION_SECRET);
    }

    const responseBody: Record<string, unknown> = {
      uploadURL,
      objectPath,
      metadata: {
        ...parsed.data,
        name: safeName,
        contentType: normalizedType || (contentType ?? ""),
      },
    };
    if (uploadToken !== undefined) {
      responseBody.uploadToken = uploadToken;
    }

    return c.json(RequestUploadUrlResponse.parse(responseBody));
  } finally {
    close();
  }
});

// ─── GET /storage/public-objects/* ──────────────────────────────────────────
storageRoutes.get("/storage/public-objects/:path{.+}", async (c) => {
  const filePath = c.req.param("path");
  if (filePath.includes("..") || filePath.includes("//")) {
    return c.json({ error: "invalid_path" }, 400);
  }

  const file = await searchPublicObject(c.env, filePath);
  if (!file) return c.json({ error: "File not found" }, 404);

  const response = await downloadObject(c.env, file);
  return new Response(response.body, { status: response.status, headers: response.headers });
});

// ─── GET /storage/objects/* ──────────────────────────────────────────────────
// Private objects — requires authentication + documents.view permission.
// Signed/private download links only; never exposes a raw public URL.
storageRoutes.get("/storage/objects/:path{.+}", requirePerm("documents.view"), async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const wildcardPath = c.req.param("path");
    if (wildcardPath.includes("..") || wildcardPath.includes("//")) {
      return c.json({ error: "invalid_path" }, 400);
    }

    const objectPath = `/objects/${wildcardPath}`;
    // A Communication Centre attachment is never authorised by possession of
    // its storage path. Resolve it back to the parent message/conversation
    // before serving the object, including for callers that bypass the
    // message-bound proxy URL.
    const conversationAttachment = await findConversationAttachmentByObjectPath(db, objectPath);
    if (conversationAttachment) {
      const hasAccess = await canAccessConversation(db, conversationAttachment.conversationId, user);
      if (!hasAccess) return c.json({ error: "forbidden" }, 403);
      if (conversationAttachment.availabilityStatus === "unavailable") {
        return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
      }
    } else if (await scopedAttachmentOwnerDenies(db, user, objectPath)) {
      // Owned by a project document, plan attachment, or report attachment
      // outside this caller's sector/state scope — deny regardless of the
      // broad documents.view permission the route-level middleware already
      // granted.
      return c.json({ error: "forbidden" }, 403);
    }

    // Legacy private-object URLs may still exist in bookmarks or old
    // metadata. Do not stream an object when any canonical attachment owner
    // has been reconciled as unavailable, even if the caller knows its path.
    const unavailableOwner = await db.query(
      `SELECT 1 FROM (
         SELECT availability_status FROM program_resources WHERE object_path = $1
         UNION ALL SELECT availability_status FROM project_documents WHERE object_path = $1
         UNION ALL SELECT availability_status FROM plan_attachments WHERE object_path = $1
         UNION ALL SELECT availability_status FROM report_attachments WHERE object_path = $1
         UNION ALL SELECT availability_status FROM voice_notes WHERE object_path = $1
       ) attachment_owners
       WHERE availability_status = 'unavailable'
       LIMIT 1`,
      [objectPath],
    );
    if (unavailableOwner.rows.length) {
      return c.json({ error: "file_unavailable", message: "File Unavailable" }, 410);
    }

    try {
      const objectFile = await getObjectEntityFile(c.env, objectPath);
      const response = await downloadObject(c.env, objectFile);
      return new Response(response.body, { status: response.status, headers: response.headers });
    } catch (error) {
      if (error instanceof ObjectNotFoundError) return c.json({ error: "Object not found" }, 404);
      throw error;
    }
  } finally {
    close();
  }
});
