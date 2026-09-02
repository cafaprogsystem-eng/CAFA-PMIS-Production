import { Router, type IRouter, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { Readable } from "node:stream";
import { pool } from "@workspace/db";
import { logAudit } from "../middlewares/currentUser";
import { validatePassword } from "../lib/password";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  deleteStorageObjectSafely,
  isStorageConfigured,
} from "../lib/objectStorage";
import { signUploadToken, UploadTokenError, verifyUploadToken } from "../lib/uploadToken";
import { isProductionEnv } from "../lib/env";
import { revokeAllSessionsForUser } from "../lib/session";
import {
  NOTIFICATION_TIMEZONES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  normaliseNotificationPreferences,
  notificationPreferencesSchema,
} from "../lib/notifications";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const VALID_TIMEZONES = new Set<string>(NOTIFICATION_TIMEZONES);
const PROFILE_PHOTO_MAX_SIZE = 5 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const EDITABLE_PROFILE_FIELDS = new Set([
  "name",
  "phone",
  "jobTitle",
  "languagePreference",
  "timezone",
  "notificationPreferences",
]);

type AccessKind = "organisation_wide" | "state_scoped" | "sector_scoped" | "not_assigned";

function normalizeImageType(value: unknown): string {
  return typeof value === "string" ? value.split(";")[0].trim().toLowerCase() : "";
}

function normalisePhone(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") throw new Error("invalid_phone");
  const collapsed = value.trim().replace(/[\s().-]/g, "");
  const phone = collapsed.startsWith("00") ? `+${collapsed.slice(2)}` : collapsed;
  if (!/^\+[1-9]\d{6,14}$/.test(phone)) throw new Error("invalid_phone");
  return phone;
}

function normaliseText(value: unknown, field: "name" | "jobTitle"): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null && field === "jobTitle") return null;
  if (typeof value !== "string") throw new Error(`invalid_${field}`);
  const normalised = value.trim().replace(/\s+/gu, " ");
  const maxLength = field === "name" ? 150 : 120;
  if (!normalised || normalised.length > maxLength) throw new Error(`invalid_${field}`);
  return normalised;
}

function accessSummary(profile: {
  role: string; stateId: number | null; stateName: string | null; sector: string | null;
}): { kind: AccessKind; stateNames: string[]; sectors: string[] } {
  const sectors = String(profile.sector ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (["state_office_manager", "state_program_officer"].includes(profile.role)) {
    return profile.stateId && profile.stateName
      ? { kind: "state_scoped", stateNames: [profile.stateName], sectors: [] }
      : { kind: "not_assigned", stateNames: [], sectors: [] };
  }
  if (profile.role === "technical_coordinator") {
    return sectors.length
      ? { kind: "sector_scoped", stateNames: [], sectors }
      : { kind: "not_assigned", stateNames: [], sectors: [] };
  }
  return { kind: "organisation_wide", stateNames: [], sectors: [] };
}

function hasExpectedImageSignature(contentType: string, bytes: Uint8Array): boolean {
  if (contentType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === "image/png") {
    return bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value);
  }
  return contentType === "image/webp"
    && bytes.length >= 12
    && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
}

function isManagedProfilePhotoPath(value: unknown): value is string {
  return typeof value === "string" && /^\/objects\/profiles\/[0-9a-f-]{36}$/i.test(value);
}

async function fetchProfile(userId: number) {
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.email, u.username, u.role, u.role_label AS "roleLabel",
            u.scope, u.state_id AS "stateId", s.name AS "stateName",
            u.sector, u.phone, u.avatar_url AS "avatarPath",
            u.job_title AS "jobTitle", u.timezone,
            u.language_preference AS "languagePreference",
            u.notification_preferences AS "notificationPreferences",
            u.status, u.last_login_at AS "lastLoginAt",
            u.created_at AS "createdAt", u.updated_at AS "updatedAt",
            (u.invite_token IS NOT NULL AND u.invite_expires_at > NOW()) AS "hasInvite",
            u.email_verified AS "emailVerified",
            u.email_verified_at AS "emailVerifiedAt"
     FROM users u LEFT JOIN states s ON s.id = u.state_id
     WHERE u.id = $1`,
    [userId],
  );
  const profile = rows[0] ?? null;
  if (!profile) return null;
  // Profile reads are a contract boundary. Existing legacy JSON is retained in
  // storage, but callers always receive a complete supported shape.
  const { avatarPath, notificationPreferences, ...profileFields } = profile;
  return {
    ...profileFields,
    avatarUrl: isManagedProfilePhotoPath(avatarPath) ? "/api/profile/photo" : null,
    access: accessSummary(profile),
    notificationPreferences: normaliseNotificationPreferences(notificationPreferences),
  };
}

router.get("/profile", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  try {
    const profile = await fetchProfile(req.currentUser.id);
    if (!profile) { res.status(404).json({ error: "not_found" }); return; }
    res.json(profile);
  } catch (err) {
    req.log.error({ err }, "getProfile failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.patch("/profile", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  const body = req.body ?? {};
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    res.status(400).json({ error: "invalid_profile_update" }); return;
  }
  const forbidden = Object.keys(body).filter((field) => !EDITABLE_PROFILE_FIELDS.has(field));
  if (forbidden.length) {
    res.status(400).json({ error: "forbidden_profile_field" }); return;
  }
  const { name, phone, jobTitle, languagePreference, timezone, notificationPreferences } = body;

  let normalisedName: string | null | undefined;
  let normalisedJobTitle: string | null | undefined;
  let normalisedPhone: string | null | undefined;
  try {
    normalisedName = normaliseText(name, "name");
    normalisedJobTitle = normaliseText(jobTitle, "jobTitle");
    normalisedPhone = normalisePhone(phone);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "invalid_profile_update" }); return;
  }
  if (languagePreference !== undefined && !["en", "ar"].includes(String(languagePreference))) {
    res.status(400).json({ error: "invalid_language_preference" }); return;
  }
  if (timezone !== undefined && timezone !== null && !VALID_TIMEZONES.has(String(timezone))) {
    res.status(400).json({ error: "invalid_timezone" }); return;
  }
  if (notificationPreferences !== undefined) {
    if (notificationPreferences === null) {
      // Explicit null is a supported reset-to-defaults request.
    } else {
      const parsed = notificationPreferencesSchema.safeParse(notificationPreferences);
      if (!parsed.success) {
        res.status(422).json({
          error: "invalid_notification_preferences",
          fields: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
        return;
      }
    }
  }

  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    const push = (col: string, val: unknown) => { sets.push(`${col} = $${n++}`); vals.push(val); };

    if (normalisedName !== undefined)          push("name", normalisedName);
    if (normalisedPhone !== undefined)         push("phone", normalisedPhone);
    if (normalisedJobTitle !== undefined)      push("job_title", normalisedJobTitle);
    if (languagePreference !== undefined)      push("language_preference", languagePreference);
    if (timezone !== undefined)                push("timezone", timezone);
    if (notificationPreferences !== undefined) {
      // Always run through normaliseNotificationPreferences so mandatory
      // category flags (criticalRisks, passwordReset) are coerced to true
      // before the row is persisted — the stored value is always clean.
      const toStore = notificationPreferences === null
        ? DEFAULT_NOTIFICATION_PREFERENCES
        : normaliseNotificationPreferences(notificationPreferences);
      push("notification_preferences", JSON.stringify(toStore));
    }

    if (sets.length > 0) {
      sets.push(`updated_at = NOW()`);
      vals.push(req.currentUser.id);
      await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${n}`, vals);
      await logAudit({ userId: req.currentUser.id, action: "update_profile", module: "profile", entityId: req.currentUser.id });
    }

    const profile = await fetchProfile(req.currentUser.id);
    res.json(profile);
  } catch (err) {
    req.log.error({ err }, "updateProfile failed");
    res.status(500).json({ error: "internal_error" });
  }
});

const passwordChangeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
  keyGenerator: (req) => req.currentUser
    ? `profile-password:${req.currentUser.id}`
    : `profile-password:${ipKeyGenerator(req.ip ?? "")}`,
  skip: () => !isProductionEnv(),
});

router.post("/profile/change-password", passwordChangeLimiter, async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  const { currentPassword, newPassword } = req.body ?? {};
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: "both_passwords_required" }); return;
  }
  const strength = validatePassword(newPassword);
  if (!strength.ok) { res.status(400).json({ error: strength.error }); return; }

  try {
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE id = $1`, [req.currentUser.id]);
    const row = rows[0];
    if (!row?.password_hash) { res.status(400).json({ error: "no_password_set" }); return; }
    const match = await bcrypt.compare(String(currentPassword), row.password_hash);
    if (!match) { res.status(401).json({ error: "incorrect_password" }); return; }
    const newHash = await bcrypt.hash(String(newPassword), 12);
    await pool.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, req.currentUser.id]);
    // Sign out every other session for this account — a stolen cookie or an
    // unattended device must not survive the owner deliberately changing the
    // password. The session making this request is kept alive.
    await revokeAllSessionsForUser(req.currentUser.id, req.authSession?.id);
    await logAudit({ userId: req.currentUser.id, action: "change_password", module: "profile", entityId: req.currentUser.id });
    res.json({ message: "Password changed successfully." });
  } catch (err) {
    req.log.error({ err }, "changePassword failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/profile/photo/upload-url", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  const { size, contentType } = req.body ?? {};
  const normalisedType = normalizeImageType(contentType);
  if (!Number.isSafeInteger(size) || size < 1 || size > PROFILE_PHOTO_MAX_SIZE) {
    res.status(413).json({ error: "photo_too_large" }); return;
  }
  if (!PROFILE_PHOTO_TYPES.has(normalisedType)) {
    res.status(415).json({ error: "unsupported_photo_type" }); return;
  }
  const storageStatus = isStorageConfigured();
  if (!storageStatus.configured) {
    res.status(503).json({ error: "storage_not_configured" }); return;
  }
  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL(normalisedType);
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const now = Math.floor(Date.now() / 1000);
    const uploadToken = signUploadToken({
      objectPath,
      userId: req.currentUser.id,
      reportId: 0,
      entityType: "profile_photo",
      scope: "profile",
      contentType: normalisedType,
      maxSize: PROFILE_PHOTO_MAX_SIZE,
      iat: now,
      exp: now + 15 * 60,
    });
    res.json({ uploadURL, uploadToken });
  } catch (err) {
    req.log.error({ err }, "profile photo upload URL failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.post("/profile/photo", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  const uploadToken = req.body?.uploadToken;
  if (typeof uploadToken !== "string") { res.status(400).json({ error: "upload_token_required" }); return; }
  let descriptor;
  try {
    descriptor = verifyUploadToken(uploadToken);
  } catch (err) {
    res.status(400).json({ error: err instanceof UploadTokenError ? err.message : "invalid_upload_token" }); return;
  }
  if (descriptor.userId !== req.currentUser.id || descriptor.entityType !== "profile_photo" || descriptor.scope !== "profile") {
    res.status(403).json({ error: "photo_forbidden" }); return;
  }
  try {
    const metadata = await objectStorageService.getObjectEntityMetadata(descriptor.objectPath);
    const actualType = normalizeImageType(metadata.contentType);
    if (metadata.size < 1 || metadata.size > PROFILE_PHOTO_MAX_SIZE || metadata.size > descriptor.maxSize) {
      deleteStorageObjectSafely(descriptor.objectPath).catch((err) => req.log.warn({ err }, "rejected profile photo upload cleanup failed"));
      res.status(413).json({ error: "photo_too_large" }); return;
    }
    if (actualType !== descriptor.contentType || !PROFILE_PHOTO_TYPES.has(actualType)) {
      deleteStorageObjectSafely(descriptor.objectPath).catch((err) => req.log.warn({ err }, "rejected profile photo upload cleanup failed"));
      res.status(415).json({ error: "unsupported_photo_type" }); return;
    }
    const uploaded = await objectStorageService.downloadObject(
      await objectStorageService.getObjectEntityFile(descriptor.objectPath),
      0,
    );
    const bytes = new Uint8Array(await uploaded.arrayBuffer()).slice(0, 12);
    if (!hasExpectedImageSignature(actualType, bytes)) {
      deleteStorageObjectSafely(descriptor.objectPath).catch((err) => req.log.warn({ err }, "rejected profile photo upload cleanup failed"));
      res.status(415).json({ error: "invalid_photo_content" }); return;
    }
    const finalPath = await objectStorageService.finalizeObjectEntityUpload(descriptor.objectPath, "profiles");
    if (!isManagedProfilePhotoPath(finalPath)) {
      req.log.error({ finalPath }, "profile photo finalised outside managed namespace");
      res.status(500).json({ error: "internal_error" });
      return;
    }
    const { rows } = await pool.query(
      `WITH previous AS (
         SELECT avatar_url FROM users WHERE id = $2 FOR UPDATE
       ), updated AS (
         UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2
       )
       SELECT avatar_url AS "previousAvatarPath" FROM previous`,
      [finalPath, req.currentUser.id],
    );
    const previousPath = rows[0]?.previousAvatarPath;
    if (isManagedProfilePhotoPath(previousPath) && previousPath !== finalPath) {
      deleteStorageObjectSafely(previousPath).catch((err) => req.log.warn({ err }, "profile photo cleanup failed"));
    }
    await logAudit({ userId: req.currentUser.id, action: "update_profile_photo", module: "profile", entityId: req.currentUser.id });
    res.json({ avatarUrl: "/api/profile/photo" });
  } catch (err) {
    req.log.error({ err }, "profile photo completion failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.delete("/profile/photo", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  try {
    const { rows } = await pool.query(
      `WITH previous AS (
         SELECT avatar_url FROM users WHERE id = $1 FOR UPDATE
       ), updated AS (
         UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1
       )
       SELECT avatar_url AS "previousAvatarPath" FROM previous`,
      [req.currentUser.id],
    );
    const previousPath = rows[0]?.previousAvatarPath;
    if (isManagedProfilePhotoPath(previousPath)) {
      deleteStorageObjectSafely(previousPath).catch((err) => req.log.warn({ err }, "profile photo cleanup failed"));
    }
    await logAudit({ userId: req.currentUser.id, action: "remove_profile_photo", module: "profile", entityId: req.currentUser.id });
    res.json({ avatarUrl: null });
  } catch (err) {
    req.log.error({ err }, "profile photo removal failed");
    res.status(500).json({ error: "internal_error" });
  }
});

router.get("/profile/photo", async (req: Request, res: Response) => {
  if (!req.currentUser) { res.status(401).json({ error: "authentication_required" }); return; }
  try {
    const { rows } = await pool.query(`SELECT avatar_url FROM users WHERE id = $1`, [req.currentUser.id]);
    const objectPath = rows[0]?.avatar_url;
    if (!objectPath) { res.status(404).json({ error: "photo_not_found" }); return; }
    if (!isManagedProfilePhotoPath(objectPath)) { res.status(404).json({ error: "photo_not_found" }); return; }
    const response = await objectStorageService.downloadObject(await objectStorageService.getObjectEntityFile(objectPath));
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    if (response.body) Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    else res.end();
  } catch (err) {
    if (err instanceof ObjectNotFoundError) { res.status(404).json({ error: "photo_not_found" }); return; }
    req.log.error({ err }, "profile photo download failed");
    res.status(500).json({ error: "internal_error" });
  }
});

export default router;
