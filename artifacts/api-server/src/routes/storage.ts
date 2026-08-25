import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { pool } from "@workspace/db";
import {
  ObjectStorageService,
  ObjectNotFoundError,
  isStorageConfigured,
} from "../lib/objectStorage";
import { hasPerm, permissionsFor, requirePerm } from "../middlewares/currentUser";
import { assertAttachmentMutationAllowed } from "../lib/reportAuth";
import { signUploadToken } from "../lib/uploadToken";
import { canAccessConversation } from "../lib/conversationAuth";
import { findConversationAttachmentByObjectPath } from "../lib/conversationAttachments";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

// ─── Upload policy ─────────────────────────────────────────────────────────────
const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB

const ALLOWED_CONTENT_TYPES = new Set([
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

function requireUser(req: Request, res: Response): boolean {
  if (!req.currentUser) {
    res.status(401).json({ error: "authentication_required" });
    return false;
  }
  return true;
}

// ─── GET /storage/status ───────────────────────────────────────────────────────
// Admin-only route that returns the current storage configuration status.
// Used to show a warning in the admin UI when file uploads are disabled.
router.get("/storage/status", requirePerm("settings.view"), (req: Request, res: Response) => {
  if (!requireUser(req, res)) return;
  res.json(isStorageConfigured());
});

// ─── POST /storage/uploads/request-url ────────────────────────────────────────
router.post(
  "/storage/uploads/request-url",
  async (req: Request, res: Response) => {
    if (!requireUser(req, res)) return;
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    const { name, size, contentType, scope } = parsed.data;
    const reportId = typeof req.body.reportId === "number" ? req.body.reportId : undefined;
    const entityType = req.body.entityType as "attachment" | "voice_note" | undefined;
    const isReportUpload =
      typeof reportId === "number" &&
      Number.isInteger(reportId) &&
      reportId > 0 &&
      (entityType === "attachment" || entityType === "voice_note");

    if (scope === "messages" && (req.body.reportId !== undefined || req.body.entityType !== undefined)) {
      res.status(400).json({ error: "invalid_upload_scope" });
      return;
    }

    const requiredPermission = scope === "messages"
      ? "messages.attachments.upload"
      : "documents.upload";
    const canRequestDocumentUpload = scope === "documents" && hasPerm(permissionsFor(req.currentUser!), "program_resources.upload");
    if (!hasPerm(permissionsFor(req.currentUser!), requiredPermission) && !canRequestDocumentUpload) {
      res.status(403).json({
        error: "forbidden",
        message: "You do not have permission to perform this action.",
        requiredPermission,
      });
      return;
    }

    if (isReportUpload) {
      const authCheck = await assertAttachmentMutationAllowed(req, reportId!);
      if (!authCheck.ok) {
        res.status(authCheck.status).json(authCheck.body);
        return;
      }
    }

    const storageStatus = isStorageConfigured();
    if (!storageStatus.configured) {
      res.status(503).json({
        error: "storage_not_configured",
        message:
          "File uploads are disabled because object storage is not configured. " +
          (storageStatus.reason ?? "Set STORAGE_PROVIDER and the required credentials."),
      });
      return;
    }

    if (typeof size === "number" && size > MAX_FILE_SIZE_BYTES) {
      res.status(413).json({
        error: "file_too_large",
        message: `File size exceeds the maximum allowed size of ${MAX_FILE_SIZE_BYTES / 1024 / 1024} MB`,
      });
      return;
    }

    const normalizedType = (contentType ?? "").split(";")[0].trim().toLowerCase();
    if (normalizedType && !ALLOWED_CONTENT_TYPES.has(normalizedType)) {
      res.status(415).json({
        error: "unsupported_media_type",
        message:
          "File type not allowed. Permitted types: PDF, Word, Excel, PowerPoint, CSV, images, ZIP, and audio.",
      });
      return;
    }

    // Object keys are server-generated, but the filename is later used in
    // Content-Disposition. Reject paths and control characters rather than
    // silently transforming an unsafe client filename.
    if (/[/\\\u0000-\u001f\u007f]/.test(name)) {
      res.status(400).json({ error: "invalid_file_name" });
      return;
    }
    const safeName = name.trim();
    if (!safeName || safeName.length > 255) {
      res.status(400).json({ error: "invalid_file_name" });
      return;
    }

    try {
      const uploadURL = await objectStorageService.getObjectEntityUploadURL(
        normalizedType || "application/octet-stream",
      );
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      // Issue a signed upload descriptor when the client must later register
      // the object with a parent record. Message descriptors bind the private
      // path and metadata to the requesting user before message creation.
      let uploadToken: string | undefined;
      if (isReportUpload && req.currentUser) {
        const iat = Math.floor(Date.now() / 1000);
        uploadToken = signUploadToken({
          objectPath,
          userId: req.currentUser.id,
          reportId: reportId!,
          entityType: entityType!,
          contentType: normalizedType || (contentType ?? ""),
          maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
          iat,
          exp: iat + 86400, // 24 hours
        });
      }
      if (scope === "messages" && req.currentUser) {
        const iat = Math.floor(Date.now() / 1000);
        uploadToken = signUploadToken({
          objectPath,
          userId: req.currentUser.id,
          reportId: 0,
          entityType: "message_attachment",
          scope: "messages",
          fileName: safeName,
          contentType: normalizedType || (contentType ?? ""),
          maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
          iat,
          exp: iat + 86400, // 24 hours
        });
      }
      if (scope === "documents" && req.currentUser) {
        const iat = Math.floor(Date.now() / 1000);
        uploadToken = signUploadToken({
          objectPath,
          userId: req.currentUser.id,
          reportId: 0,
          entityType: "attachment",
          scope: "documents",
          fileName: safeName,
          contentType: normalizedType || (contentType ?? ""),
          maxSize: typeof size === "number" ? size : MAX_FILE_SIZE_BYTES,
          iat,
          exp: iat + 86400,
        });
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

      res.json(RequestUploadUrlResponse.parse(responseBody));
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

// ─── GET /storage/public-objects/* ────────────────────────────────────────────
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;

    if (filePath.includes("..") || filePath.includes("//")) {
      res.status(400).json({ error: "invalid_path" });
      return;
    }

    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

// ─── GET /storage/objects/* ───────────────────────────────────────────────────
// Private objects — requires authentication + documents.view permission.
// Signed/private download links only; never exposes a raw public URL.
router.get(
  "/storage/objects/*path",
  requirePerm("documents.view"),
  async (req: Request, res: Response) => {
    if (!requireUser(req, res)) return;
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;

      if (wildcardPath.includes("..") || wildcardPath.includes("//")) {
        res.status(400).json({ error: "invalid_path" });
        return;
      }

      const objectPath = `/objects/${wildcardPath}`;
      // A Communication Centre attachment is never authorised by possession of
      // its storage path. Resolve it back to the parent message/conversation
      // before serving the object, including for callers that bypass the
      // message-bound proxy URL.
      const conversationAttachment = await findConversationAttachmentByObjectPath(objectPath);
      if (conversationAttachment) {
        const hasAccess = await canAccessConversation(conversationAttachment.conversationId, req.currentUser!);
        if (!hasAccess) {
          res.status(403).json({ error: "forbidden" });
          return;
        }
        if (conversationAttachment.availabilityStatus === "unavailable") {
          res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
          return;
        }
      }
      // Legacy private-object URLs may still exist in bookmarks or old
      // metadata. Do not stream an object when any canonical attachment owner
      // has been reconciled as unavailable, even if the caller knows its path.
      const unavailableOwner = await pool.query(
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
        res.status(410).json({ error: "file_unavailable", message: "File Unavailable" });
        return;
      }
      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
