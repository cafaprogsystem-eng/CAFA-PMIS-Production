import { Hono } from "hono";
import bcrypt from "bcryptjs";
import type { Bindings, QueryExecutor } from "../lib/db";
import { openDb } from "../lib/db";
import { attachCurrentUser, requireAuth, logAudit, type Variables } from "../lib/rbac";
import { validatePassword } from "../lib/password";
import { revokeAllSessionsForUser } from "../lib/session";
import {
  isPasswordChangeRateLimited,
  recordPasswordChangeAttempt,
} from "../lib/rate-limit-store";
import {
  ObjectNotFoundError,
  isStorageConfigured,
  getObjectEntityUploadURL,
  normalizeObjectEntityPath,
  getObjectEntityFile,
  getObjectEntityMetadata,
  finalizeObjectEntityUpload,
  downloadObject,
  deleteObjectSafely,
} from "../lib/storage";
import { signUploadToken, verifyUploadToken, UploadTokenError } from "../lib/upload-token";
import {
  NOTIFICATION_TIMEZONES,
  DEFAULT_NOTIFICATION_PREFERENCES,
  normaliseNotificationPreferences,
  notificationPreferencesSchema,
} from "../lib/notifications";

/**
 * Ported from artifacts/api-server/src/routes/profile.ts — this whole file
 * was silently missing from the Cloudflare port (no `// Dropped:` comment
 * anywhere, unlike realtime.ts's deliberate deferral), surfaced by a real
 * "could not load profile" report against the deployed production Worker.
 *
 * lib/storage.ts is function-based here (not the source's ObjectStorageService
 * class) and every function takes `env` first — same underlying R2 object
 * model otherwise (uploads/<uuid> -> finalized /objects/profiles/<uuid>).
 * signUploadToken/verifyUploadToken take the HMAC secret explicitly
 * (c.env.SESSION_SECRET) since Workers has no process.env.
 */

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

async function fetchProfile(db: QueryExecutor, userId: number) {
  const { rows } = await db.query<{
    id: number; name: string; email: string; username: string | null; role: string;
    roleLabel: string; scope: string; stateId: number | null; stateName: string | null;
    sector: string | null; phone: string | null; avatarPath: string | null;
    jobTitle: string | null; timezone: string | null; languagePreference: string;
    notificationPreferences: unknown; status: string; lastLoginAt: string | null;
    createdAt: string; updatedAt: string; hasInvite: boolean;
    emailVerified: boolean | null; emailVerifiedAt: string | null;
  }>(
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
  const { avatarPath, notificationPreferences, ...profileFields } = profile;
  return {
    ...profileFields,
    avatarUrl: isManagedProfilePhotoPath(avatarPath) ? "/api/profile/photo" : null,
    access: accessSummary(profile),
    notificationPreferences: normaliseNotificationPreferences(notificationPreferences),
  };
}

export const profileRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

profileRoutes.use("/profile/*", attachCurrentUser, requireAuth);

profileRoutes.get("/profile", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const profile = await fetchProfile(db, user.id);
    if (!profile) return c.json({ error: "not_found" }, 404);
    return c.json(profile);
  } finally {
    close();
  }
});

profileRoutes.patch("/profile", async (c) => {
  const user = c.get("currentUser")!;
  const body = await c.req.json().catch(() => ({}));
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return c.json({ error: "invalid_profile_update" }, 400);
  }
  const forbidden = Object.keys(body).filter((field) => !EDITABLE_PROFILE_FIELDS.has(field));
  if (forbidden.length) {
    return c.json({ error: "forbidden_profile_field" }, 400);
  }
  const { name, phone, jobTitle, languagePreference, timezone, notificationPreferences } = body as Record<string, unknown>;

  let normalisedName: string | null | undefined;
  let normalisedJobTitle: string | null | undefined;
  let normalisedPhone: string | null | undefined;
  try {
    normalisedName = normaliseText(name, "name");
    normalisedJobTitle = normaliseText(jobTitle, "jobTitle");
    normalisedPhone = normalisePhone(phone);
  } catch (error) {
    return c.json({ error: error instanceof Error ? error.message : "invalid_profile_update" }, 400);
  }
  if (languagePreference !== undefined && !["en", "ar"].includes(String(languagePreference))) {
    return c.json({ error: "invalid_language_preference" }, 400);
  }
  if (timezone !== undefined && timezone !== null && !VALID_TIMEZONES.has(String(timezone))) {
    return c.json({ error: "invalid_timezone" }, 400);
  }
  if (notificationPreferences !== undefined && notificationPreferences !== null) {
    const parsed = notificationPreferencesSchema.safeParse(notificationPreferences);
    if (!parsed.success) {
      return c.json({
        error: "invalid_notification_preferences",
        fields: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      }, 422);
    }
  }

  const { db, close } = openDb(c);
  try {
    const sets: string[] = [];
    const vals: unknown[] = [];
    let n = 1;
    const push = (col: string, val: unknown) => { sets.push(`${col} = $${n++}`); vals.push(val); };

    if (normalisedName !== undefined) push("name", normalisedName);
    if (normalisedPhone !== undefined) push("phone", normalisedPhone);
    if (normalisedJobTitle !== undefined) push("job_title", normalisedJobTitle);
    if (languagePreference !== undefined) push("language_preference", languagePreference);
    if (timezone !== undefined) push("timezone", timezone);
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
      vals.push(user.id);
      await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${n}`, vals);
      await logAudit(db, { userId: user.id, action: "update_profile", module: "profile", entityId: user.id });
    }

    const profile = await fetchProfile(db, user.id);
    return c.json(profile);
  } finally {
    close();
  }
});

profileRoutes.post("/profile/change-password", async (c) => {
  const user = c.get("currentUser")!;
  const session = c.get("authSession")!;
  const { db, close } = openDb(c);
  try {
    if (await isPasswordChangeRateLimited(db, user.id)) {
      return c.json({ error: "too_many_requests" }, 429);
    }
    await recordPasswordChangeAttempt(db, user.id);

    const body = await c.req.json().catch(() => ({}));
    const { currentPassword, newPassword } = body as Record<string, unknown>;
    if (!currentPassword || !newPassword) {
      return c.json({ error: "both_passwords_required" }, 400);
    }
    const strength = validatePassword(newPassword);
    if (!strength.ok) return c.json({ error: strength.error }, 400);

    const { rows } = await db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM users WHERE id = $1`, [user.id],
    );
    const row = rows[0];
    if (!row?.password_hash) return c.json({ error: "no_password_set" }, 400);
    const match = await bcrypt.compare(String(currentPassword), row.password_hash);
    if (!match) return c.json({ error: "incorrect_password" }, 401);
    const newHash = await bcrypt.hash(String(newPassword), 12);
    await db.query(`UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [newHash, user.id]);
    // Sign out every other session for this account — a stolen cookie or an
    // unattended device must not survive the owner deliberately changing the
    // password. The session making this request is kept alive.
    await revokeAllSessionsForUser(db, user.id, session.id);
    await logAudit(db, { userId: user.id, action: "change_password", module: "profile", entityId: user.id });
    return c.json({ message: "Password changed successfully." });
  } finally {
    close();
  }
});

profileRoutes.post("/profile/photo/upload-url", async (c) => {
  const user = c.get("currentUser")!;
  const body = await c.req.json().catch(() => ({}));
  const { size, contentType } = body as Record<string, unknown>;
  const normalisedType = normalizeImageType(contentType);
  if (!Number.isSafeInteger(size) || (size as number) < 1 || (size as number) > PROFILE_PHOTO_MAX_SIZE) {
    return c.json({ error: "photo_too_large" }, 413);
  }
  if (!PROFILE_PHOTO_TYPES.has(normalisedType)) {
    return c.json({ error: "unsupported_photo_type" }, 415);
  }
  const storageStatus = isStorageConfigured(c.env);
  if (!storageStatus.configured) {
    return c.json({ error: "storage_not_configured" }, 503);
  }
  const uploadURL = await getObjectEntityUploadURL(c.env, normalisedType);
  const objectPath = normalizeObjectEntityPath(c.env, uploadURL);
  const now = Math.floor(Date.now() / 1000);
  const uploadToken = signUploadToken({
    objectPath,
    userId: user.id,
    reportId: 0,
    entityType: "profile_photo",
    scope: "profile",
    contentType: normalisedType,
    maxSize: PROFILE_PHOTO_MAX_SIZE,
    iat: now,
    exp: now + 15 * 60,
  }, c.env.SESSION_SECRET);
  return c.json({ uploadURL, uploadToken });
});

profileRoutes.post("/profile/photo", async (c) => {
  const user = c.get("currentUser")!;
  const body = await c.req.json().catch(() => ({}));
  const uploadToken = (body as Record<string, unknown>).uploadToken;
  if (typeof uploadToken !== "string") return c.json({ error: "upload_token_required" }, 400);
  let descriptor;
  try {
    descriptor = verifyUploadToken(uploadToken, c.env.SESSION_SECRET);
  } catch (err) {
    return c.json({ error: err instanceof UploadTokenError ? err.message : "invalid_upload_token" }, 400);
  }
  if (descriptor.userId !== user.id || descriptor.entityType !== "profile_photo" || descriptor.scope !== "profile") {
    return c.json({ error: "photo_forbidden" }, 403);
  }

  const metadata = await getObjectEntityMetadata(c.env, descriptor.objectPath);
  const actualType = normalizeImageType(metadata.contentType);
  if (metadata.size < 1 || metadata.size > PROFILE_PHOTO_MAX_SIZE || metadata.size > descriptor.maxSize) {
    void deleteObjectSafely(c.env, descriptor.objectPath);
    return c.json({ error: "photo_too_large" }, 413);
  }
  if (actualType !== descriptor.contentType || !PROFILE_PHOTO_TYPES.has(actualType)) {
    void deleteObjectSafely(c.env, descriptor.objectPath);
    return c.json({ error: "unsupported_photo_type" }, 415);
  }
  const uploaded = await downloadObject(c.env, await getObjectEntityFile(c.env, descriptor.objectPath));
  const bytes = new Uint8Array(await uploaded.arrayBuffer()).slice(0, 12);
  if (!hasExpectedImageSignature(actualType, bytes)) {
    void deleteObjectSafely(c.env, descriptor.objectPath);
    return c.json({ error: "invalid_photo_content" }, 415);
  }
  const finalPath = await finalizeObjectEntityUpload(c.env, descriptor.objectPath, "profiles");
  if (!isManagedProfilePhotoPath(finalPath)) {
    return c.json({ error: "internal_error" }, 500);
  }

  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ previousAvatarPath: string | null }>(
      `WITH previous AS (
         SELECT avatar_url FROM users WHERE id = $2 FOR UPDATE
       ), updated AS (
         UPDATE users SET avatar_url = $1, updated_at = NOW() WHERE id = $2
       )
       SELECT avatar_url AS "previousAvatarPath" FROM previous`,
      [finalPath, user.id],
    );
    const previousPath = rows[0]?.previousAvatarPath;
    if (isManagedProfilePhotoPath(previousPath) && previousPath !== finalPath) {
      void deleteObjectSafely(c.env, previousPath);
    }
    await logAudit(db, { userId: user.id, action: "update_profile_photo", module: "profile", entityId: user.id });
    return c.json({ avatarUrl: "/api/profile/photo" });
  } finally {
    close();
  }
});

profileRoutes.delete("/profile/photo", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  try {
    const { rows } = await db.query<{ previousAvatarPath: string | null }>(
      `WITH previous AS (
         SELECT avatar_url FROM users WHERE id = $1 FOR UPDATE
       ), updated AS (
         UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1
       )
       SELECT avatar_url AS "previousAvatarPath" FROM previous`,
      [user.id],
    );
    const previousPath = rows[0]?.previousAvatarPath;
    if (isManagedProfilePhotoPath(previousPath)) {
      void deleteObjectSafely(c.env, previousPath);
    }
    await logAudit(db, { userId: user.id, action: "remove_profile_photo", module: "profile", entityId: user.id });
    return c.json({ avatarUrl: null });
  } finally {
    close();
  }
});

profileRoutes.get("/profile/photo", async (c) => {
  const user = c.get("currentUser")!;
  const { db, close } = openDb(c);
  let objectPath: string | null;
  try {
    const { rows } = await db.query<{ avatar_url: string | null }>(
      `SELECT avatar_url FROM users WHERE id = $1`, [user.id],
    );
    objectPath = rows[0]?.avatar_url ?? null;
  } finally {
    close();
  }
  if (!objectPath || !isManagedProfilePhotoPath(objectPath)) {
    return c.json({ error: "photo_not_found" }, 404);
  }
  try {
    const response = await downloadObject(c.env, await getObjectEntityFile(c.env, objectPath));
    return new Response(response.body, { status: response.status, headers: response.headers });
  } catch (err) {
    if (err instanceof ObjectNotFoundError) return c.json({ error: "photo_not_found" }, 404);
    throw err;
  }
});
