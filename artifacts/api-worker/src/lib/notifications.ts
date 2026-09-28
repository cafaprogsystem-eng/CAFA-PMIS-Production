/**
 * Ported from artifacts/api-server/src/lib/notifications.ts — the read-path
 * presentation helpers (normaliseNotificationLink, presentNotificationKind)
 * plus the preferences schema/constants/normaliser (needed by
 * routes/profile.ts). That file's other ~900 lines are the
 * creation/dedup engine used by every OTHER route that creates a
 * notification (comments, approvals, mentions...); those routes haven't
 * been ported yet, so there is nothing here yet that needs to create one —
 * only routes/notifications.ts's list/read endpoints and routes/profile.ts's
 * preferences read/write, which only read or persist existing rows.
 */
import { z } from "zod";

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
