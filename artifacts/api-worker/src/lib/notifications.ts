/**
 * Ported from artifacts/api-server/src/lib/notifications.ts — the read-path
 * presentation helpers only (normaliseNotificationLink,
 * presentNotificationKind). That file's other ~900 lines are the
 * preferences schema and creation/dedup engine used by every OTHER route
 * that creates a notification (comments, approvals, mentions...); those
 * routes haven't been ported yet, so there is nothing here yet that needs
 * to create one — only routes/notifications.ts's own list/read endpoints,
 * which read existing rows.
 */

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
