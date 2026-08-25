import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { QueryClient } from "@tanstack/react-query";
import {
  clearNotificationQueries,
  invalidateNotificationQueries,
  notificationQueryKey,
  safeNotificationLink,
} from "@/lib/notification-client";

describe("NOTIF-007 / NOTIF-009 notification client hardening", () => {
  it("NOTIF-CACHE-01: recipient ID is part of every private query key", () => {
    expect(notificationQueryKey(12, "bell")).toEqual(["notifications", 12, "bell"]);
    expect(notificationQueryKey(31, "page", "unread", "risk", 50))
      .toEqual(["notifications", 31, "page", "unread", "risk", 50]);
  });

  it("NOTIF-CACHE-02: realtime invalidation and auth cleanup target notification state", () => {
    const invalidateQueries = vi.fn();
    const removeQueries = vi.fn();
    const queryClient = { invalidateQueries, removeQueries } as unknown as QueryClient;

    invalidateNotificationQueries(queryClient, 12);
    clearNotificationQueries(queryClient);

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["notifications", 12] });
    expect(removeQueries).toHaveBeenCalledWith({ queryKey: ["notifications"] });
  });

  it("NOTIF-LINK-01: only recognised internal destinations are navigable", () => {
    expect(safeNotificationLink("/projects/42?tab=activity")).toBe("/projects/42?tab=activity");
    expect(safeNotificationLink("/ai")).toBe("/ai");
    expect(safeNotificationLink("/ai-settings?tab=logs")).toBe("/ai?tab=logs");
    for (const unsafe of [
      "https://unsafe.example",
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "//unsafe.example",
      "/\\unsafe.example",
      "/not-a-cafa-route",
    ]) {
      expect(safeNotificationLink(unsafe)).toBeNull();
    }
  });

  it("NOTIF-ERROR-01: bell and page retain explicit retry states instead of empty-response fallbacks", () => {
    const bell = readFileSync(resolve("src/components/notifications-bell.tsx"), "utf8");
    const page = readFileSync(resolve("src/pages/notifications.tsx"), "utf8");
    const socket = readFileSync(resolve("src/lib/socket.ts"), "utf8");

    expect(bell).toContain("isError");
    expect(bell).toContain('t("errorLoading")');
    expect(bell).toContain('t("retry")');
    expect(page).toContain("isError");
    expect(page).toContain('t("errorLoading")');
    expect(page).toContain('t("retry")');
    expect(socket).toContain("invalidateNotificationQueries(qc, userId)");
    expect(`${bell}\n${page}`).not.toContain("return { items: [], unread: 0 }");
  });
});