import { pool } from "@workspace/db";
import { sendEmail } from "./mailer";
import { logger } from "./logger";
import { realtime } from "./realtime";
import { z } from "zod";

// ── Notification Preferences Schema ──────────────────────────────────────────

export interface NotificationPreferences {
  inApp: {
    approvals: boolean;
    approvalDecisions: boolean;
    comments: boolean;
    assignments: boolean;
    mentions: boolean;
    dueDates: boolean;
    overdueItems: boolean;
    highRisks: boolean;
    criticalRisks: boolean;      // mandatory — always delivered
    systemNotifications: boolean;
  };
  email: {
    approvalRequests: boolean;
    approvalDecisions: boolean;
    assignments: boolean;
    mentions: boolean;
    passwordReset: boolean;      // mandatory — always delivered
    userInvitations: boolean;
    dueDateReminders: boolean;
    highRisks: boolean;
    criticalRisks: boolean;      // mandatory — always delivered
  };
  deliveryOption: "inapp_only" | "email_only" | "both";
  digest: "immediate" | "daily" | "weekly";
  quietHours: {
    enabled: boolean;
    start: string;   // "HH:MM" 24-h
    end: string;     // "HH:MM" 24-h
    timezone: string;
  };
}

export const NOTIFICATION_TIMEZONES = [
  "Africa/Khartoum", "Africa/Juba", "Africa/Cairo", "Africa/Nairobi",
  "Africa/Addis_Ababa", "Africa/Lagos", "Europe/London", "Europe/Berlin",
  "Asia/Dubai", "America/New_York", "America/Los_Angeles", "UTC",
] as const;

const timeOfDaySchema = z.string().regex(
  /^([01]\d|2[0-3]):[0-5]\d$/,
  "must use 24-hour HH:MM format",
);

const inAppPreferenceSchema = z.object({
  approvals: z.boolean(),
  approvalDecisions: z.boolean(),
  comments: z.boolean(),
  assignments: z.boolean(),
  mentions: z.boolean(),
  dueDates: z.boolean(),
  overdueItems: z.boolean(),
  highRisks: z.boolean(),
  criticalRisks: z.boolean(),
  systemNotifications: z.boolean(),
}).strict().partial();

const emailPreferenceSchema = z.object({
  approvalRequests: z.boolean(),
  approvalDecisions: z.boolean(),
  assignments: z.boolean(),
  mentions: z.boolean(),
  passwordReset: z.boolean(),
  userInvitations: z.boolean(),
  dueDateReminders: z.boolean(),
  highRisks: z.boolean(),
  criticalRisks: z.boolean(),
}).strict().partial();

const quietHoursSchema = z.object({
  enabled: z.boolean(),
  start: timeOfDaySchema,
  end: timeOfDaySchema,
  timezone: z.enum(NOTIFICATION_TIMEZONES),
}).strict().partial();

/**
 * Public persistence boundary for notification preferences. The partial nested
 * shape supports forward-compatible profile updates, while strict objects
 * reject misspelled categories rather than silently storing dead settings.
 * Daily and weekly digests deliberately remain unavailable until a scheduler
 * exists.
 */
export const notificationPreferencesSchema = z.object({
  inApp: inAppPreferenceSchema.optional(),
  email: emailPreferenceSchema.optional(),
  deliveryOption: z.enum(["inapp_only", "email_only", "both"]).optional(),
  digest: z.literal("immediate").optional(),
  quietHours: quietHoursSchema.optional(),
}).strict();

export type NotificationPreferencesPatch = z.infer<typeof notificationPreferencesSchema>;

const INTERNAL_NOTIFICATION_ROUTE_PREFIXES = [
  "/dashboard", "/projects", "/plans", "/reports", "/risks", "/messages",
  "/users", "/profile", "/drive", "/states", "/budget", "/notifications",
  "/files", "/program-resources", "/manual", "/audit-log", "/sync-status", "/ai",
] as const;

/**
 * Returns a safe in-app CAFA PMIS destination or null. New notification links
 * are constrained here before persistence; historical values are also passed
 * through it when served so an unsafe old row cannot initiate navigation.
 */
export function normaliseNotificationLink(link: unknown): string | null {
  if (typeof link !== "string" || !link || link !== link.trim()) return null;
  if (
    !link.startsWith("/") ||
    link.startsWith("//") ||
    link.includes("\\") ||
    /[\u0000-\u001F\u007F]/.test(link)
  ) return null;

  try {
    const url = new URL(link, "https://cafa-pmis.invalid");
    if (url.origin !== "https://cafa-pmis.invalid") return null;
    // Preserve saved notification links while keeping `/ai` as the sole
    // destination emitted for the unified AI workspace.
    const pathname = url.pathname === "/ai-settings" ? "/ai" : url.pathname;
    return INTERNAL_NOTIFICATION_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ? `${pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  inApp: {
    approvals: true,
    approvalDecisions: true,
    comments: true,
    assignments: true,
    mentions: true,
    dueDates: true,
    overdueItems: true,
    highRisks: true,
    criticalRisks: true,
    systemNotifications: true,
  },
  email: {
    approvalRequests: false,
    approvalDecisions: false,
    assignments: true,
    mentions: true,
    passwordReset: true,
    userInvitations: true,
    dueDateReminders: false,
    highRisks: true,
    criticalRisks: true,
  },
  deliveryOption: "both",
  digest: "immediate",
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "Africa/Khartoum",
  },
};

type InAppPreferenceKey = keyof NotificationPreferences["inApp"];
type EmailPreferenceKey = keyof NotificationPreferences["email"];
type NotificationKindDefinition = {
  inApp: InAppPreferenceKey;
  email: EmailPreferenceKey | null;
  mandatory?: boolean;
};

/**
 * Authoritative current notification taxonomy. New callers must use one of
 * these values; preference classification, email metadata and realtime payloads
 * all derive from this registry instead of separately maintained conditionals.
 *
 * CALLER DEDUP RULE — comment vs. mention disambiguation:
 * `comment_added` and `comment_replied` map to the "comments" preference key.
 * `mention` maps to the "mentions" preference key.
 * When an @mention occurs inside a comment, callers MUST emit only `mention`
 * (not both `mention` and `comment_added`/`comment_replied`) for the same
 * recipient and event. Using the more specific `mention` kind prevents a single
 * user action from producing two separate notifications to the same recipient.
 */
export const NOTIFICATION_KIND_REGISTRY = {
  system: { inApp: "systemNotifications", email: null },
  assigned: { inApp: "assignments", email: "assignments" },
  message: { inApp: "systemNotifications", email: null },
  mention: { inApp: "mentions", email: "mentions" },
  comment_added: { inApp: "comments", email: null },
  comment_replied: { inApp: "comments", email: null },
  review_requested: { inApp: "approvals", email: "approvalRequests" },
  submitted: { inApp: "approvals", email: "approvalRequests" },
  resubmitted: { inApp: "approvals", email: "approvalRequests" },
  technically_reviewed: { inApp: "approvals", email: "approvalRequests" },
  coordination_reviewed: { inApp: "approvals", email: "approvalRequests" },
  approved: { inApp: "approvalDecisions", email: "approvalDecisions" },
  rejected: { inApp: "approvalDecisions", email: "approvalDecisions", mandatory: true },
  returned: { inApp: "approvalDecisions", email: "approvalDecisions", mandatory: true },
  activated: { inApp: "approvalDecisions", email: "approvalDecisions" },
  closed: { inApp: "approvalDecisions", email: "approvalDecisions" },
  started: { inApp: "approvalDecisions", email: null },
  delayed: { inApp: "approvalDecisions", email: null },
  completed: { inApp: "approvalDecisions", email: null },
  cancelled: { inApp: "approvalDecisions", email: null },
  archived: { inApp: "approvalDecisions", email: null },
  reopened: { inApp: "approvalDecisions", email: null },
  project_created: { inApp: "approvalDecisions", email: null },
  project_assigned: { inApp: "assignments", email: "assignments" },
  plan_assigned: { inApp: "assignments", email: "assignments" },
  risk_assigned: { inApp: "assignments", email: "assignments" },
  document_uploaded: { inApp: "systemNotifications", email: null },
  risk_created: { inApp: "approvalDecisions", email: null },
  risk_updated: { inApp: "approvalDecisions", email: null },
  risk_high: { inApp: "highRisks", email: "highRisks" },
  risk_critical: { inApp: "criticalRisks", email: "criticalRisks", mandatory: true },
  risk_status_changed: { inApp: "highRisks", email: "highRisks" },
  risk_severity_downgraded: { inApp: "highRisks", email: "highRisks" },
  budget_high: { inApp: "systemNotifications", email: null },
  budget_exceeded: { inApp: "systemNotifications", email: null },
  password_changed: { inApp: "systemNotifications", email: null, mandatory: true },
  email_verified: { inApp: "systemNotifications", email: null },
  account_suspended: { inApp: "systemNotifications", email: null, mandatory: true },
  security_alert: { inApp: "systemNotifications", email: null, mandatory: true },
  risk_due_7d: { inApp: "dueDates", email: "dueDateReminders" },
  risk_due_3d: { inApp: "dueDates", email: "dueDateReminders" },
  risk_due_1d: { inApp: "dueDates", email: "dueDateReminders" },
  risk_overdue: { inApp: "overdueItems", email: "dueDateReminders" },
  project_due_7d: { inApp: "dueDates", email: "dueDateReminders" },
  project_due_3d: { inApp: "dueDates", email: "dueDateReminders" },
  project_due_1d: { inApp: "dueDates", email: "dueDateReminders" },
  project_overdue: { inApp: "overdueItems", email: "dueDateReminders" },
  plan_due_7d: { inApp: "dueDates", email: "dueDateReminders" },
  plan_due_3d: { inApp: "dueDates", email: "dueDateReminders" },
  plan_due_1d: { inApp: "dueDates", email: "dueDateReminders" },
  plan_overdue: { inApp: "overdueItems", email: "dueDateReminders" },
  activity_due_7d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_due_3d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_due_1d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_overdue: { inApp: "overdueItems", email: "dueDateReminders" },
} as const satisfies Record<string, NotificationKindDefinition>;

export type NotificationKind = keyof typeof NOTIFICATION_KIND_REGISTRY;

/** Legacy values are presentation-compatible only; no current caller writes them. */
export const LEGACY_NOTIFICATION_KIND_ALIASES = {
  technically_approved: "technically_reviewed",
  "notification.assigned": "assigned",
} as const satisfies Record<string, NotificationKind>;

/**
 * Maps an historical value to its canonical display value without mutating the
 * stored notification row. Unknown historic values remain readable as-is.
 */
export function presentNotificationKind(kind: string): string {
  return (LEGACY_NOTIFICATION_KIND_ALIASES as Record<string, NotificationKind>)[kind] ?? kind;
}

/** Maps all new writes to a supported canonical kind. */
function canonicalNotificationKind(kind: string): NotificationKind {
  const presented = presentNotificationKind(kind);
  if (presented in NOTIFICATION_KIND_REGISTRY) return presented as NotificationKind;
  logger.warn({ kind }, "[notifications] unsupported kind normalised to system");
  return "system";
}

// Mandatory kinds bypass all preference filtering.
export const MANDATORY_KINDS = new Set<NotificationKind>(
  (Object.entries(NOTIFICATION_KIND_REGISTRY) as [NotificationKind, NotificationKindDefinition][])
    .filter(([, definition]) => definition.mandatory)
    .map(([kind]) => kind),
);

function kindDefinition(kind: NotificationKind): NotificationKindDefinition {
  return NOTIFICATION_KIND_REGISTRY[kind];
}

function isInQuietHours(q: NotificationPreferences["quietHours"]): boolean {
  if (!q.enabled) return false;
  try {
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-GB", {
      timeZone: q.timezone || "UTC",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const { start, end } = q;
    return start <= end
      ? timeStr >= start && timeStr < end
      : timeStr >= start || timeStr < end;
  } catch {
    return false;
  }
}

function shouldCreateInApp(
  prefs: NotificationPreferences,
  inAppKey: keyof NotificationPreferences["inApp"],
  isMandatory: boolean,
): boolean {
  const categoryAllowed = isMandatory || prefs.inApp[inAppKey] !== false;
  const deliveryAllowsInApp = prefs.deliveryOption !== "email_only";
  return categoryAllowed && deliveryAllowsInApp;
}

function shouldSendEmail(
  prefs: NotificationPreferences,
  emailKey: keyof NotificationPreferences["email"] | null,
  isMandatory: boolean,
  emailVerified: boolean,
): boolean {
  const categoryAllowed = isMandatory || (emailKey !== null && prefs.email[emailKey] !== false);
  const deliveryAllowsEmail = prefs.deliveryOption !== "inapp_only";
  const quietSuppressed = !isMandatory && isInQuietHours(prefs.quietHours);
  // Optional emails require a verified email address. Mandatory security and
  // critical-risk emails bypass this gate and are always delivered regardless
  // of verification status.
  const verificationAllowed = isMandatory || emailVerified;
  return categoryAllowed && deliveryAllowsEmail && !quietSuppressed && verificationAllowed;
}

/**
 * Canonicalises stored preference JSON for every consumer. Historic malformed
 * or no-longer-supported values (including daily/weekly digest settings) are
 * never leaked through the profile API; they safely resolve to defaults.
 *
 * Mandatory category enforcement: regardless of what was stored or received,
 * criticalRisks (in-app and email) and passwordReset (email) are always forced
 * to true. This ensures the persisted row never silently disables them.
 */
export function normaliseNotificationPreferences(raw: unknown): NotificationPreferences {
  const parsed = notificationPreferencesSchema.safeParse(raw);
  const result: NotificationPreferences = parsed.success
    ? {
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        ...parsed.data,
        inApp: { ...DEFAULT_NOTIFICATION_PREFERENCES.inApp, ...(parsed.data.inApp ?? {}) },
        email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email, ...(parsed.data.email ?? {}) },
        quietHours: { ...DEFAULT_NOTIFICATION_PREFERENCES.quietHours, ...(parsed.data.quietHours ?? {}) },
      }
    : {
        // Existing malformed rows predate the validated API boundary. They remain
        // readable but use safe defaults rather than influencing delivery logic.
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        inApp: { ...DEFAULT_NOTIFICATION_PREFERENCES.inApp },
        email: { ...DEFAULT_NOTIFICATION_PREFERENCES.email },
        quietHours: { ...DEFAULT_NOTIFICATION_PREFERENCES.quietHours },
      };

  // Mandatory flags must always be true — silently coerce any persisted false
  result.inApp.criticalRisks = true;
  result.email.criticalRisks = true;
  result.email.passwordReset = true;

  return result;
}

type ActiveNotificationRecipient = {
  id: number;
  email: string | null;
  /** Null/undefined means the account predates verification and is treated as verified. */
  email_verified: boolean | null;
  /**
   * The user's canonical profile timezone (IANA identifier). When present this
   * is the authoritative timezone for quiet-hours evaluation; the stored
   * quietHours.timezone preference copy is only a fallback so that profile
   * timezone changes take effect immediately without requiring a notification
   * preferences re-save.
   */
  timezone: string | null;
  notification_preferences: unknown;
};

/**
 * The one authoritative recipient gate. Notification callers may hold historic
 * user IDs, but notifications are only ever delivered to an existing active
 * account. A lookup failure is deliberately a safe no-op.
 */
async function resolveActiveRecipient(userId: number): Promise<ActiveNotificationRecipient | null> {
  try {
    const { rows } = await pool.query<ActiveNotificationRecipient>(
      `SELECT id, email, email_verified, timezone, notification_preferences
       FROM users
       WHERE id = $1 AND status = 'active'
       LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  } catch (err) {
    logger.warn({ err }, "[notifications] active recipient lookup failed");
    return null;
  }
}

/**
 * Atomically claims a single logical notification event for one recipient.
 * `dedupeKey` is a documented, source-derived event identity (never a time
 * window or opaque hash). The winning caller alone owns downstream side effects.
 */
async function claimNotificationEvent(userId: number, dedupeKey: string): Promise<boolean> {
  const { rows } = await pool.query<{ id: number }>(
    `INSERT INTO notification_event_dedupes (user_id, event_key)
     VALUES ($1, $2)
     ON CONFLICT (user_id, event_key) DO NOTHING
     RETURNING id`,
    [userId, dedupeKey],
  );
  return rows.length > 0;
}

// ── Core notification creation ────────────────────────────────────────────────

export type CreateNotificationOpts = {
  userId: number;
  kind: string;
  entityType?: string | null;
  entityId?: number | null;
  message: string;
  link?: string | null;
  emailSubject?: string;
  /** If true, bypass preference filters (security/critical events). */
  mandatory?: boolean;
  /**
   * The caller has already dispatched a specialised transactional email. Keep
   * the in-app/realtime notification central without sending a second generic
   * notification email.
   */
  suppressEmail?: boolean;
  /**
   * Optional stable identity of one source event. When supplied, it is claimed
   * atomically per recipient before any in-app, realtime, or email side effect.
   */
  dedupeKey?: string;
};

export async function createNotification(opts: CreateNotificationOpts): Promise<number> {
  const recipient = await resolveActiveRecipient(opts.userId);
  if (!recipient) return 0;

  const kind = canonicalNotificationKind(opts.kind);
  const link = normaliseNotificationLink(opts.link);
  if (opts.link != null && link === null) {
    logger.warn({ link: opts.link, kind }, "[notifications] unsafe link omitted");
  }
  const definition = kindDefinition(kind);
  const isMandatory = opts.mandatory === true || MANDATORY_KINDS.has(kind);
  const basePrefs = isMandatory
    ? DEFAULT_NOTIFICATION_PREFERENCES
    : normaliseNotificationPreferences(recipient.notification_preferences);
  // Override the stored quietHours.timezone with the authoritative profile
  // timezone so that profile timezone changes take effect immediately — without
  // requiring the user to re-save their notification preferences.
  const prefs: NotificationPreferences = recipient.timezone
    ? { ...basePrefs, quietHours: { ...basePrefs.quietHours, timezone: recipient.timezone } }
    : basePrefs;
  // Treat null/undefined as verified for legacy accounts that predate the
  // email_verified column; only an explicit false withholds optional emails.
  const emailVerified = recipient.email_verified !== false;
  const createInApp = shouldCreateInApp(prefs, definition.inApp, isMandatory);
  const sendEmailChannel =
    !opts.suppressEmail &&
    shouldSendEmail(prefs, definition.email, isMandatory, emailVerified);

  // Do not consume an event key when this recipient is not eligible for either
  // channel under their current preferences.
  if (!createInApp && !sendEmailChannel) return 0;
  if (opts.dedupeKey && !(await claimNotificationEvent(opts.userId, opts.dedupeKey))) return 0;

  // The channels are deliberately evaluated and executed independently.
  // In particular, email-only must not return before email processing, and an
  // email failure must not roll back an already-created in-app notification.
  let id: number | null = null;
  if (createInApp) {
    const { rows } = await pool.query<{ id: number }>(
      `INSERT INTO notifications (user_id, kind, entity_type, entity_id, message, link)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
       [opts.userId, kind, opts.entityType ?? null, opts.entityId ?? null, opts.message, link],
    );
    id = rows[0].id;

    // The canonical event is recipient-only and carries just a stable
    // notification ID. Clients refetch their private inbox, so a delayed or
    // duplicate signal never creates a second notification row.
    await realtime.publishSupportingEventToUser(opts.userId, {
      entityType: "notification",
      entityId: id,
      action: "created",
    });

    // Kept only for older clients while they migrate to domain:event.
    await realtime.broadcastToUser(opts.userId, {
      module: "notifications",
      action: "created",
      entityId: id,
      data: {
         kind,
        message: opts.message,
         link,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
      },
    });
  }

  if (sendEmailChannel) {
    try {
      if (recipient.email) {
        await sendEmail({
          to: recipient.email,
           subject: opts.emailSubject ?? `CAFA PMIS: ${kind.replace(/_/g, " ")}`,
         html: `<p>${htmlEscape(opts.message)}</p>${link ? `<p><a href="${htmlEscape(link)}">Open in CAFA PMIS</a></p>` : ""}`,
           kind: `notification.${kind}`,
          meta: { notificationId: id, entityType: opts.entityType, entityId: opts.entityId },
        });
      }
    } catch (err) {
      logger.warn({ err }, "[notifications] email dispatch failed");
    }
  }

  return id ?? 0;
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

// ── Fan-out helpers ───────────────────────────────────────────────────────────

export async function actorsForEntity(entityType: string, entityId: number): Promise<Set<number>> {
  const userIds = new Set<number>();
  try {
    if (entityType === "project") {
      const a = await pool.query<{ user_id: number }>(
        `SELECT p.created_by_id AS user_id
           FROM projects p
           JOIN users u ON u.id = p.created_by_id AND u.status = 'active'
          WHERE p.id = $1
         UNION
         SELECT pa.user_id
           FROM project_assignments pa
           JOIN users u ON u.id = pa.user_id AND u.status = 'active'
          WHERE pa.project_id = $1 AND pa.user_id IS NOT NULL`,
        [entityId],
      );
      for (const r of a.rows) if (r.user_id) userIds.add(r.user_id);
    } else if (entityType === "report") {
      // author_id included so decisions (returned/approved/rejected) always reach the
      // report owner even when a different authorised user was the last submitter.
      const a = await pool.query<{ user_id: number }>(
        `SELECT r.submitted_by_id AS user_id
           FROM reports r
           JOIN users u ON u.id = r.submitted_by_id AND u.status = 'active'
          WHERE r.id = $1
         UNION
         SELECT r.author_id AS user_id
           FROM reports r
           JOIN users u ON u.id = r.author_id AND u.status = 'active'
          WHERE r.id = $1 AND r.author_id IS NOT NULL
         UNION
         SELECT pa.user_id
           FROM project_assignments pa
           JOIN reports r ON r.project_id = pa.project_id
           JOIN users u ON u.id = pa.user_id AND u.status = 'active'
          WHERE r.id = $1 AND pa.user_id IS NOT NULL`,
        [entityId],
      );
      for (const r of a.rows) if (r.user_id) userIds.add(r.user_id);
    } else if (entityType === "plan") {
      const a = await pool.query<{ user_id: number }>(
        `SELECT pl.created_by_id AS user_id
           FROM plans pl
           JOIN users u ON u.id = pl.created_by_id AND u.status = 'active'
          WHERE pl.id = $1
         UNION
         SELECT pl.responsible_user_id AS user_id
           FROM plans pl
           JOIN users u ON u.id = pl.responsible_user_id AND u.status = 'active'
          WHERE pl.id = $1 AND pl.responsible_user_id IS NOT NULL
         UNION
         SELECT pa.user_id
           FROM project_assignments pa
           JOIN plans pl ON pl.project_id = pa.project_id
           JOIN users u ON u.id = pa.user_id AND u.status = 'active'
          WHERE pl.id = $1 AND pa.user_id IS NOT NULL`,
        [entityId],
      );
      for (const r of a.rows) if (r.user_id) userIds.add(r.user_id);
    }
  } catch (err) {
    logger.warn({ err, entityType, entityId }, "[notifications] actorsForEntity failed");
  }
  return userIds;
}

export async function notifyEntityActors(opts: {
  entityType: string;
  entityId: number;
  kind: string;
  message: string;
  /** Source event identity when this fan-out may be retried. */
  dedupeKey?: string;
  link?: string | null;
  exceptUserId?: number | null;
  emailSubject?: string;
  mandatory?: boolean;
}): Promise<void> {
  const users = await actorsForEntity(opts.entityType, opts.entityId);
  if (opts.exceptUserId != null) users.delete(opts.exceptUserId);
  for (const userId of users) {
    const notification = {
      userId,
      kind: opts.kind,
      entityType: opts.entityType,
      entityId: opts.entityId,
      message: opts.message,
      link: opts.link ?? null,
      emailSubject: opts.emailSubject,
      mandatory: opts.mandatory,
      dedupeKey: opts.dedupeKey,
    };
    if (opts.dedupeKey) {
      await createNotificationDeduped(notification as CreateNotificationOpts & { dedupeKey: string });
    } else {
      await createNotification(notification);
    }
  }
}

// ── Dedup-aware wrappers ──────────────────────────────────────────────────────

/**
 * Atomically claims a documented source-event identity before delivery. Callers
 * must supply a source-derived key so unrelated events sharing an entity and
 * kind never collapse.
 */
export async function createNotificationDeduped(
  opts: CreateNotificationOpts & { dedupeKey: string },
): Promise<number> {
  return createNotification(opts);
}

/**
 * Like notifyEntityActors, but atomically dedupes the supplied source event for
 * each eligible recipient.
 */
export async function notifyEntityActorsDeduped(opts: {
  entityType: string;
  entityId: number;
  /** Entity used to resolve stakeholders when it differs from the event entity. */
  recipientEntityType?: string;
  recipientEntityId?: number;
  kind: string;
  message: string;
  dedupeKey: string;
  link?: string | null;
  exceptUserId?: number | null;
  emailSubject?: string;
  mandatory?: boolean;
}): Promise<void> {
  const users = await actorsForEntity(
    opts.recipientEntityType ?? opts.entityType,
    opts.recipientEntityId ?? opts.entityId,
  );
  if (opts.exceptUserId != null) users.delete(opts.exceptUserId);
  for (const userId of users) {
    await createNotificationDeduped({
      userId,
      kind: opts.kind,
      entityType: opts.entityType,
      entityId: opts.entityId,
      message: opts.message,
      dedupeKey: opts.dedupeKey,
      link: opts.link ?? null,
      emailSubject: opts.emailSubject,
      mandatory: opts.mandatory,
    });
  }
}

// ── Approver-chain helper ─────────────────────────────────────────────────────

/**
 * Notifies the next approver in the chain for a project/report/plan transition.
 *
 * - submit (state_authored / null workflowPath) → TC matching the entity's sector (if any);
 *   fallback: senior_program_coordinator; fallback: program_manager
 * - submit (technical_authored) → senior_program_coordinator directly (TC stage is skipped
 *   for TC-authored reports; fallback: program_manager). Never resolves a TC.
 * - technical_review → senior_program_coordinator
 * - coordination_review → program_manager
 * - all other actions → no-op (entity actors are notified separately by notifyEntityActorsDeduped)
 *
 * workflowPath is optional; when omitted or null the conservative state_authored
 * behaviour applies (matches getProjectActivityWorkflow fallback).
 */
export async function notifyNextApprover(opts: {
  action: string;
  entityType: string;
  entityId: number;
  sector?: string | null;
  workflowPath?: string | null;
  /**
   * HQ Sector Report routing (HQSR-BD-1/BD-6):
   *  - "spc_fallback"  → SPC-authored fallback report; coordination reviewer is
   *    PM, so submit notifies active PMs (fallback: super_admin, with warning).
   *  - "tc_authored" → TC-authored HQSR; next reviewer is SPC (fallback: PM,
   *    with warning). Never notifies sector TCs (HQSR-006).
   *  - null → non-HQSR entity; default routing applies.
   */
  hqsrPath?: "spc_fallback" | "tc_authored" | null;
  message: string;
  link: string;
  exceptUserId?: number | null;
  /** Source-derived transition identity supplied by workflow callers. */
  dedupeKey?: string;
}): Promise<void> {
  let roleRows: { id: number }[] = [];

  if (opts.action === "submit") {
    if (opts.hqsrPath === "spc_fallback") {
      // SPC-authored fallback HQ Sector Report: PM is the coordination reviewer.
      const pm = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
      );
      if (pm.rows.length > 0) {
        roleRows = pm.rows;
      } else {
        logger.warn(
          {
            entityType: opts.entityType,
            entityId: opts.entityId,
            reason: "no_active_pm_for_hqsr_spc_fallback",
            expectedReviewerRole: "program_manager",
            fallbackRecipientRole: "super_admin",
          },
          "[notifications] notifyNextApprover: no active PM for SPC-fallback HQ Sector Report — falling back to super_admin",
        );
        const sa = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role = 'super_admin' AND status = 'active'`,
        );
        roleRows = sa.rows;
      }
    } else if (opts.hqsrPath === "tc_authored") {
      // TC-authored HQ Sector Report (HQSR-006): the author is the TC, so the
      // next reviewer is the SPC (coordination reviewer) — never sector TCs.
      // Covers both new reports and historical rows with workflow_path = NULL.
      const sc = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE role = 'senior_program_coordinator' AND status = 'active'`,
      );
      if (sc.rows.length > 0) {
        roleRows = sc.rows;
      } else {
        logger.warn(
          {
            entityType: opts.entityType,
            entityId: opts.entityId,
            sector: opts.sector ?? null,
            reason: "no_active_spc",
            expectedReviewerRole: "senior_program_coordinator",
            fallbackRecipientRole: "program_manager",
          },
          "[notifications] notifyNextApprover: HQSR TC-authored submit — no active SPC found, falling back to PM",
        );
        const pm = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
        );
        roleRows = pm.rows;
      }
    } else if (opts.workflowPath === "technical_authored") {
      // PATH B: TC-authored — technical review is skipped, so the coordination
      // reviewer (SPC) is the next approver. Never notify a TC here.
      const sc = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE role = 'senior_program_coordinator' AND status = 'active'`,
      );
      if (sc.rows.length > 0) {
        roleRows = sc.rows;
      } else {
        const pm = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
        );
        roleRows = pm.rows;
      }
    } else if (opts.sector) {
      // Use unnest+trim to handle any legacy whitespace around commas in the stored
      // sector CSV (normalizeSector guarantees clean output but older records may differ).
      // DISTINCT prevents duplicate rows if future JOIN changes are added.
      const tc = await pool.query<{ id: number }>(
        `SELECT DISTINCT id FROM users
         WHERE role = 'technical_coordinator' AND status = 'active'
           AND EXISTS (
             SELECT 1
             FROM unnest(string_to_array(sector, ',')) AS seg
             WHERE trim(seg) = $1
           )`,
        [opts.sector],
      );
      if (tc.rows.length > 0) {
        roleRows = tc.rows;
      } else {
        const sc = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role = 'senior_program_coordinator' AND status = 'active'`,
        );
        const fallbackRecipientRole =
          sc.rows.length > 0 ? "senior_program_coordinator" : "program_manager";
        logger.warn(
          {
            entityType: opts.entityType,
            entityId: opts.entityId,
            sector: opts.sector,
            reason: "no_active_tc_for_sector",
            expectedReviewerRole: "technical_coordinator",
            fallbackRecipientRole,
          },
          "[notifications] notifyNextApprover: no TC found for sector — falling back to SPC",
        );
        if (sc.rows.length > 0) {
          roleRows = sc.rows;
        } else {
          const pm = await pool.query<{ id: number }>(
            `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
          );
          roleRows = pm.rows;
        }
      }
    } else {
      const sc = await pool.query<{ id: number }>(
        `SELECT id FROM users WHERE role = 'senior_program_coordinator' AND status = 'active'`,
      );
      if (sc.rows.length > 0) {
        roleRows = sc.rows;
      } else {
        const pm = await pool.query<{ id: number }>(
          `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
        );
        roleRows = pm.rows;
      }
    }
  } else if (opts.action === "technical_review") {
    const sc = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role = 'senior_program_coordinator' AND status = 'active'`,
    );
    roleRows = sc.rows;
  } else if (opts.action === "coordination_review") {
    const pm = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role = 'program_manager' AND status = 'active'`,
    );
    roleRows = pm.rows;
  } else {
    return;
  }

  for (const u of roleRows) {
    if (opts.exceptUserId != null && u.id === opts.exceptUserId) continue;
    await createNotificationDeduped({
      userId: u.id,
      kind: "review_requested",
      entityType: opts.entityType,
      entityId: opts.entityId,
      message: opts.message,
      link: opts.link,
      dedupeKey: opts.dedupeKey ??
        `review-request:${opts.entityType}:${opts.entityId}:${opts.action}:${opts.workflowPath ?? "default"}:${opts.hqsrPath ?? "standard"}`,
    });
  }
}

/**
 * Notify all active users holding any of the given roles.
 * Used for org-wide escalations (high/critical risk, executive directives).
 */
export async function notifyByRole(opts: {
  roles: string[];
  kind: string;
  message: string;
  link?: string | null;
  entityType?: string | null;
  entityId?: number | null;
  exceptUserId?: number | null;
  mandatory?: boolean;
  /** Optional source identity for role fan-out retries. */
  dedupeKey?: string;
}): Promise<void> {
  try {
    const { rows } = await pool.query<{ id: number }>(
      `SELECT id FROM users WHERE role = ANY($1::text[]) AND status = 'active'`,
      [opts.roles],
    );
    for (const u of rows) {
      if (opts.exceptUserId != null && u.id === opts.exceptUserId) continue;
      const notification = {
        userId: u.id,
        kind: opts.kind,
        message: opts.message,
        link: opts.link ?? null,
        entityType: opts.entityType ?? null,
        entityId: opts.entityId ?? null,
        mandatory: opts.mandatory,
        dedupeKey: opts.dedupeKey,
      };
      if (opts.dedupeKey) {
        await createNotificationDeduped(notification as CreateNotificationOpts & { dedupeKey: string });
      } else {
        await createNotification(notification);
      }
    }
  } catch (err) {
    logger.warn({ err }, "[notifications] notifyByRole failed");
  }
}
