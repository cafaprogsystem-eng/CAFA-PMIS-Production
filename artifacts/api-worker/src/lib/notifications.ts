/**
 * Ported from artifacts/api-server/src/lib/notifications.ts — the read-path
 * presentation helpers (normaliseNotificationLink, presentNotificationKind),
 * the preferences schema/constants/normaliser, and (as of the due-date
 * checker / monthly reporting reminder cron activation) the full
 * creation/dedup engine (createNotification, createNotificationDeduped,
 * getNotificationDeliveryEligibility) — every function takes `db` as an
 * explicit first argument per this worker's convention, instead of the
 * source's global `pool`.
 *
 * Dropped, not ported: the source's second, legacy realtime.broadcastToUser
 * call inside createNotification ("kept only for older clients while they
 * migrate to domain:event" per its own comment) — there are no older
 * clients in this Cloudflare port to migrate; the modern
 * publishSupportingEventToUser call below is the one real delivery path.
 */
import { z } from "zod";
import type { QueryExecutor, Bindings } from "./db";
import { sendEmail } from "./mailer";
import { publishSupportingEventToUser } from "./realtime";

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
    criticalRisks: boolean; // mandatory — always delivered
    systemNotifications: boolean;
  };
  email: {
    approvalRequests: boolean;
    approvalDecisions: boolean;
    assignments: boolean;
    mentions: boolean;
    passwordReset: boolean; // mandatory — always delivered
    userInvitations: boolean;
    dueDateReminders: boolean;
    highRisks: boolean;
    criticalRisks: boolean; // mandatory — always delivered
  };
  deliveryOption: "inapp_only" | "email_only" | "both";
  digest: "immediate" | "daily" | "weekly";
  quietHours: {
    enabled: boolean;
    start: string; // "HH:MM" 24-h
    end: string; // "HH:MM" 24-h
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

const INTERNAL_NOTIFICATION_ROUTE_PREFIXES = [
  "/dashboard", "/projects", "/plans", "/reports", "/risks", "/messages",
  "/users", "/profile", "/drive", "/states", "/budget", "/notifications",
  "/files", "/program-resources", "/manual", "/audit-log", "/sync-status", "/ai",
] as const;

const CONTROL_CHAR_PATTERN = new RegExp("[\\x00-\\x1F\\x7F]");

/**
 * Returns a safe in-app CAFA PMIS destination or null. Historical values are
 * passed through this when served so an unsafe old row cannot initiate
 * navigation.
 */
export function normaliseNotificationLink(link: unknown): string | null {
  if (typeof link !== "string" || !link || link !== link.trim()) return null;
  if (
    !link.startsWith("/") ||
    link.startsWith("//") ||
    link.includes("\\") ||
    CONTROL_CHAR_PATTERN.test(link)
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

/** Legacy values are presentation-compatible only; no current caller writes them. */
const LEGACY_NOTIFICATION_KIND_ALIASES: Record<string, string> = {
  technically_approved: "technically_reviewed",
  "notification.assigned": "assigned",
};

/**
 * Maps an historical value to its canonical display value without mutating
 * the stored notification row. Unknown historic values remain readable as-is.
 */
export function presentNotificationKind(kind: string): string {
  return LEGACY_NOTIFICATION_KIND_ALIASES[kind] ?? kind;
}

// ── Notification creation engine ──────────────────────────────────────────
// Copied verbatim from artifacts/api-server/src/lib/notifications.ts's
// mandatory/preference classification — every `mandatory: true` flag below
// is exactly as the source has it. Due-date/overdue reminders (risk/
// project/plan/activity/monthly-report) are deliberately NOT mandatory in
// the source: a user can turn them off via dueDates/overdueItems/
// dueDateReminders. Only risk_critical and the security/approval-decision
// kinds below bypass preferences.

type InAppPreferenceKey = keyof NotificationPreferences["inApp"];
type EmailPreferenceKey = keyof NotificationPreferences["email"];
type NotificationKindDefinition = {
  inApp: InAppPreferenceKey;
  email: EmailPreferenceKey | null;
  mandatory?: boolean;
};

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
  // DELIBERATE DEVIATION from the source system (a Cloudflare-cutover
  // operational decision, not a porting artifact): plan and monthly-report
  // deadline reminders are mandatory here — always delivered on both
  // channels regardless of the recipient's notification preferences. The
  // source left these as regular, user-toggleable dueDates/dueDateReminders
  // categories; risk/project/activity due-date reminders are UNCHANGED
  // (still user-toggleable) — this override is scoped to reports and plans
  // only.
  plan_due_7d: { inApp: "dueDates", email: "dueDateReminders", mandatory: true },
  plan_due_3d: { inApp: "dueDates", email: "dueDateReminders", mandatory: true },
  plan_due_1d: { inApp: "dueDates", email: "dueDateReminders", mandatory: true },
  plan_overdue: { inApp: "overdueItems", email: "dueDateReminders", mandatory: true },
  monthly_report_reminder: { inApp: "dueDates", email: "dueDateReminders", mandatory: true },
  activity_due_7d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_due_3d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_due_1d: { inApp: "dueDates", email: "dueDateReminders" },
  activity_overdue: { inApp: "overdueItems", email: "dueDateReminders" },
} as const satisfies Record<string, NotificationKindDefinition>;

export type NotificationKind = keyof typeof NOTIFICATION_KIND_REGISTRY;

function canonicalNotificationKind(kind: string): NotificationKind {
  const presented = presentNotificationKind(kind);
  if (presented in NOTIFICATION_KIND_REGISTRY) return presented as NotificationKind;
  console.warn("[notifications] unsupported kind normalised to system", { kind });
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

export function isInQuietHours(q: NotificationPreferences["quietHours"]): boolean {
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
    // start === end falls into the wrap-around branch below, which then
    // reduces to "timeStr >= start || timeStr < start" — true for every
    // possible timeStr. That's the correct reading of a zero-width window on
    // a 24-hour clock, so identical start/end times means always-quiet
    // instead of never-quiet.
    return start < end
      ? timeStr >= start && timeStr < end
      : timeStr >= start || timeStr < end;
  } catch {
    return false;
  }
}

function shouldCreateInApp(
  prefs: NotificationPreferences,
  inAppKey: InAppPreferenceKey,
  isMandatory: boolean,
): boolean {
  const categoryAllowed = isMandatory || prefs.inApp[inAppKey] !== false;
  const deliveryAllowsInApp = prefs.deliveryOption !== "email_only";
  return categoryAllowed && deliveryAllowsInApp;
}

function shouldSendEmail(
  prefs: NotificationPreferences,
  emailKey: EmailPreferenceKey | null,
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

type ActiveNotificationRecipient = {
  id: number;
  email: string | null;
  email_verified: boolean | null;
  timezone: string | null;
  notification_preferences: unknown;
};

/**
 * The one authoritative recipient gate. Notification callers may hold
 * historic user IDs, but notifications are only ever delivered to an
 * existing active account. A lookup failure is deliberately a safe no-op.
 */
async function resolveActiveRecipient(db: QueryExecutor, userId: number): Promise<ActiveNotificationRecipient | null> {
  try {
    const { rows } = await db.query<ActiveNotificationRecipient>(
      `SELECT id, email, email_verified, timezone, notification_preferences
         FROM users
        WHERE id = $1 AND status = 'active'
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  } catch (err) {
    console.warn("[notifications] active recipient lookup failed", err);
    return null;
  }
}

/**
 * Atomically claims a single logical notification event for one recipient.
 * `dedupeKey` is a documented, source-derived event identity (never a time
 * window or opaque hash). The winning caller alone owns downstream side effects.
 */
async function claimNotificationEvent(db: QueryExecutor, userId: number, dedupeKey: string): Promise<boolean> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO notification_event_dedupes (user_id, event_key)
     VALUES ($1, $2)
     ON CONFLICT (user_id, event_key) DO NOTHING
     RETURNING id`,
    [userId, dedupeKey],
  );
  return rows.length > 0;
}

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
   * Optional stable identity of one source event. When supplied, it is
   * claimed atomically per recipient before any in-app or email side effect.
   */
  dedupeKey?: string;
};

export type NotificationDeliveryEligibility = {
  active: boolean;
  inApp: boolean;
  email: boolean;
  emailAddress: string | null;
};

/**
 * Shared policy boundary for specialised workers (due-date checker, monthly
 * reporting reminders) that keep their own per-channel delivery ledger.
 */
export async function getNotificationDeliveryEligibility(
  db: QueryExecutor,
  userId: number,
  requestedKind: string,
): Promise<NotificationDeliveryEligibility> {
  const recipient = await resolveActiveRecipient(db, userId);
  if (!recipient) return { active: false, inApp: false, email: false, emailAddress: null };
  const kind = canonicalNotificationKind(requestedKind);
  const definition = kindDefinition(kind);
  const isMandatory = MANDATORY_KINDS.has(kind);
  const basePrefs = isMandatory
    ? DEFAULT_NOTIFICATION_PREFERENCES
    : normaliseNotificationPreferences(recipient.notification_preferences);
  const prefs: NotificationPreferences = recipient.timezone
    ? { ...basePrefs, quietHours: { ...basePrefs.quietHours, timezone: recipient.timezone } }
    : basePrefs;
  return {
    active: true,
    inApp: shouldCreateInApp(prefs, definition.inApp, isMandatory),
    email: Boolean(recipient.email) &&
      shouldSendEmail(prefs, definition.email, isMandatory, recipient.email_verified !== false),
    emailAddress: recipient.email,
  };
}

function htmlEscape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/**
 * Core notification creation — in-app row + realtime push + best-effort
 * email, gated by the recipient's own preferences (or bypassed entirely for
 * mandatory kinds). Channels are evaluated and executed independently: an
 * email failure must never roll back an already-created in-app row.
 */
export async function createNotification(db: QueryExecutor, env: Bindings, opts: CreateNotificationOpts): Promise<number> {
  const recipient = await resolveActiveRecipient(db, opts.userId);
  if (!recipient) return 0;

  const kind = canonicalNotificationKind(opts.kind);
  const link = normaliseNotificationLink(opts.link ?? null);
  if (opts.link != null && link === null) {
    console.warn("[notifications] unsafe link omitted", { link: opts.link, kind });
  }
  const definition = kindDefinition(kind);
  const isMandatory = opts.mandatory === true || MANDATORY_KINDS.has(kind);
  const basePrefs = isMandatory
    ? DEFAULT_NOTIFICATION_PREFERENCES
    : normaliseNotificationPreferences(recipient.notification_preferences);
  const prefs: NotificationPreferences = recipient.timezone
    ? { ...basePrefs, quietHours: { ...basePrefs.quietHours, timezone: recipient.timezone } }
    : basePrefs;
  const emailVerified = recipient.email_verified !== false;
  const createInApp = shouldCreateInApp(prefs, definition.inApp, isMandatory);
  const sendEmailChannel =
    !opts.suppressEmail &&
    shouldSendEmail(prefs, definition.email, isMandatory, emailVerified);

  // Do not consume an event key when this recipient is not eligible for
  // either channel under their current preferences.
  if (!createInApp && !sendEmailChannel) return 0;
  if (opts.dedupeKey && !(await claimNotificationEvent(db, opts.userId, opts.dedupeKey))) return 0;

  let id: number | null = null;
  if (createInApp) {
    const { rows } = await db.query<{ id: number }>(
      `INSERT INTO notifications (user_id, kind, entity_type, entity_id, message, link)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [opts.userId, kind, opts.entityType ?? null, opts.entityId ?? null, opts.message, link],
    );
    id = rows[0].id;

    // The canonical event is recipient-only and carries just a stable
    // notification ID. Clients refetch their private inbox, so a delayed or
    // duplicate signal never creates a second notification row.
    await publishSupportingEventToUser(env, opts.userId, {
      entityType: "notification",
      entityId: id,
      action: "created",
    });
  }

  if (sendEmailChannel && recipient.email) {
    try {
      await sendEmail(env, db, {
        to: recipient.email,
        subject: opts.emailSubject ?? `CAFA PMIS: ${kind.replace(/_/g, " ")}`,
        html: `<p>${htmlEscape(opts.message)}</p>${link ? `<p><a href="${htmlEscape(link)}">Open in CAFA PMIS</a></p>` : ""}`,
        kind: `notification.${kind}`,
        userId: opts.userId,
        meta: { notificationId: id, entityType: opts.entityType, entityId: opts.entityId },
      });
    } catch (err) {
      console.warn("[notifications] email dispatch failed", err);
    }
  }

  return id ?? 0;
}

export async function createNotificationDeduped(
  db: QueryExecutor, env: Bindings, opts: CreateNotificationOpts & { dedupeKey: string },
): Promise<number> {
  return createNotification(db, env, opts);
}
