import type { QueryClient } from "@tanstack/react-query";

const INTERNAL_NOTIFICATION_ROUTE_PREFIXES = [
  "/dashboard", "/projects", "/plans", "/reports", "/risks", "/messages",
  "/users", "/profile", "/document-management", "/files", "/drive", "/states", "/budget", "/notifications",
  "/program-resources", "/manual", "/audit-log", "/sync-status", "/ai",
] as const;

/**
 * Notification data is private to an authenticated recipient. Every query key
 * carries that recipient ID so a user switch cannot reuse another inbox.
 */
export function notificationQueryKey(
  userId: number,
  surface: "bell" | "page",
  ...parts: Array<string | number>
) {
  return ["notifications", userId, surface, ...parts] as const;
}

export function invalidateNotificationQueries(queryClient: QueryClient, userId: number): void {
  void queryClient.invalidateQueries({ queryKey: ["notifications", userId] });
}

export function clearNotificationQueries(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: ["notifications"] });
}

/**
 * Defence in depth for rows created before server-side link validation. The
 * server already returns null for unsafe values; this ensures a stale cache or
 * future API regression still cannot navigate outside CAFA PMIS.
 */
export function safeNotificationLink(link: unknown): string | null {
  if (typeof link !== "string" || !link || link !== link.trim()) return null;
  if (
    !link.startsWith("/") ||
    link.startsWith("//") ||
    link.includes("\\") ||
    [...link].some((char) => {
      const code = char.charCodeAt(0);
      return code <= 0x1f || code === 0x7f;
    })
  ) return null;

  try {
    const url = new URL(link, "https://cafa-pmis.invalid");
    if (url.origin !== "https://cafa-pmis.invalid") return null;
    // Historical notification links should reach the unified AI workspace
    // directly instead of relying on a second navigation destination.
    const pathname = url.pathname === "/ai-settings" ? "/ai" : url.pathname;
    return INTERNAL_NOTIFICATION_ROUTE_PREFIXES.some(
      (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
    ) ? `${pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
}