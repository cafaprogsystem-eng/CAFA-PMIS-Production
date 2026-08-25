const LEGACY_NOTIFICATION_KIND_ALIASES: Record<string, string> = {
  technically_approved: "technically_reviewed",
  "notification.assigned": "assigned",
};

const CANONICAL_NOTIFICATION_KINDS = new Set([
  "system",
  "assigned",
  "message",
  "mention",
  "comment_added",
  "comment_replied",
  "review_requested",
  "submitted",
  "resubmitted",
  "technically_reviewed",
  "coordination_reviewed",
  "approved",
  "rejected",
  "returned",
  "activated",
  "closed",
  "started",
  "delayed",
  "completed",
  "cancelled",
  "archived",
  "reopened",
  "project_created",
  "project_assigned",
  "plan_assigned",
  "risk_assigned",
  "document_uploaded",
  "risk_created",
  "risk_updated",
  "risk_high",
  "risk_critical",
  "risk_status_changed",
  "risk_severity_downgraded",
  "budget_high",
  "budget_exceeded",
  "password_changed",
  "email_verified",
  "account_suspended",
  "security_alert",
  "risk_due_7d",
  "risk_due_3d",
  "risk_due_1d",
  "risk_overdue",
  "project_due_7d",
  "project_due_3d",
  "project_due_1d",
  "project_overdue",
  "plan_due_7d",
  "plan_due_3d",
  "plan_due_1d",
  "plan_overdue",
  "activity_due_7d",
  "activity_due_3d",
  "activity_due_1d",
  "activity_overdue",
]);

const ENTITY_TYPES = new Set([
  "project",
  "report",
  "plan",
  "risk",
  "comment",
  "conversation",
  "user",
  "document",
  "activity",
  "system",
]);

const LEGACY_DECORATIVE_PREFIX = /^(?:📌|📋)\uFE0F?(?:\s+|[:：\-–—]\s*)/u;

/**
 * Removes only the known decorative prefixes used by older notification
 * messages. Stored messages remain unchanged, and meaningful emoji elsewhere
 * in the message are preserved.
 */
export function presentNotificationMessage(message: string): string {
  const presented = message.replace(LEGACY_DECORATIVE_PREFIX, "").trimStart();
  return presented || message;
}

export function canonicalNotificationKind(kind: string): string {
  return LEGACY_NOTIFICATION_KIND_ALIASES[kind] ?? kind;
}

/** Returns an i18n key and never exposes an internal/unknown kind to users. */
export function notificationKindTranslationKey(kind: string): string {
  const canonical = canonicalNotificationKind(kind);
  return CANONICAL_NOTIFICATION_KINDS.has(canonical)
    ? `types.${canonical}`
    : "types.unknown";
}

export function entityTypeTranslationKey(entityType: string): string {
  return ENTITY_TYPES.has(entityType)
    ? `entityTypes.${entityType}`
    : "entityTypes.unknown";
}

export function formatNotificationTime(
  value: string,
  locale: string,
  now = Date.now(),
): { kind: "relative" | "date" | "invalid"; value: string } {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { kind: "invalid", value: "" };

  const minutes = Math.floor(Math.max(0, now - date.getTime()) / 60000);
  if (minutes < 1) return { kind: "relative", value: "justNow" };

  const relative = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return { kind: "relative", value: relative.format(-minutes, "minute") };

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return { kind: "relative", value: relative.format(-hours, "hour") };

  const days = Math.floor(hours / 24);
  if (days < 7) return { kind: "relative", value: relative.format(-days, "day") };

  return {
    kind: "date",
    value: new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date),
  };
}
