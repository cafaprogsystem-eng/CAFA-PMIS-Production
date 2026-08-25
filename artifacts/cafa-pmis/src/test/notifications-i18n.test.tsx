import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import NotificationsPage from "@/pages/notifications";
import NotificationPreferencesPage from "@/pages/notification-preferences";
import { NotificationsBell } from "@/components/notifications-bell";
import {
  canonicalNotificationKind,
  formatNotificationTime,
  notificationKindTranslationKey,
} from "@/lib/notification-presentation";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
  saveProfile: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  listNotifications: api.listNotifications,
  markAllNotificationsRead: api.markAllNotificationsRead,
  markNotificationRead: api.markNotificationRead,
  useGetMe: () => ({ data: { user: { id: 7 } } }),
  useGetProfile: () => ({ data: null, isLoading: false, refetch: vi.fn() }),
  useUpdateProfile: () => ({ mutateAsync: api.saveProfile }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/notifications", vi.fn()],
  Link: ({ children }: { children: React.ReactNode }) => <a href="/profile">{children}</a>,
}));

const notificationPage = {
  items: [{
    id: 1,
    kind: "technically_approved",
    entityType: "report",
    entityId: 10,
    message: "Persisted message — Amina",
    link: "/reports/10",
    readAt: null,
    createdAt: "2026-08-19T10:00:00.000Z",
  }],
  unread: 1,
  pagination: { limit: 50, offset: 0, hasMore: false, nextOffset: null },
};

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function flattenKeys(value: Record<string, unknown>, prefix = ""): string[] {
  return Object.entries(value).flatMap(([key, child]) => {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    return typeof child === "object" && child !== null
      ? flattenKeys(child as Record<string, unknown>, fullKey)
      : [fullKey];
  });
}

describe("NOTIF-I18N notification localisation", () => {
  beforeEach(async () => {
    api.listNotifications.mockResolvedValue(notificationPage);
    await i18n.changeLanguage("ar");
  });

  afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("NOTIF-I18N-01: English and Arabic notification namespaces have identical structure", () => {
    const en = JSON.parse(readFileSync(resolve("src/locales/en/notifications.json"), "utf8")) as Record<string, unknown>;
    const ar = JSON.parse(readFileSync(resolve("src/locales/ar/notifications.json"), "utf8")) as Record<string, unknown>;
    expect(flattenKeys(ar).sort()).toEqual(flattenKeys(en).sort());
  });

  it("NOTIF-I18N-02: safely maps canonical and historical kinds without exposing unknown internal values", () => {
    expect(canonicalNotificationKind("technically_approved")).toBe("technically_reviewed");
    expect(canonicalNotificationKind("notification.assigned")).toBe("assigned");
    expect(notificationKindTranslationKey("technically_approved")).toBe("types.technically_reviewed");
    expect(notificationKindTranslationKey("future_internal_kind")).toBe("types.unknown");
    expect(i18n.t(notificationKindTranslationKey("technically_approved"), { ns: "notifications" })).toBe("تمت المراجعة الفنية");
    expect(i18n.t(notificationKindTranslationKey("future_internal_kind"), { ns: "notifications" })).toBe("إشعار");
  });

  it("NOTIF-I18N-03: localises the rendered page while preserving persisted notification messages", async () => {
    renderWithQuery(<NotificationsPage />);

    expect(await screen.findByRole("heading", { name: "الإشعارات" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("البحث في الإشعارات…")).toBeInTheDocument();
    expect(await screen.findByText("تمت المراجعة الفنية")).toBeInTheDocument();
    expect(screen.getByText("Persisted message — Amina")).toBeInTheDocument();
    expect(screen.getByLabelText("غير مقروء")).toBeInTheDocument();
    expect(screen.getByLabelText("فتح الإشعار")).toBeInTheDocument();
  });

  it("NOTIF-I18N-04: localises the rendered bell and its accessible trigger", async () => {
    renderWithQuery(<NotificationsBell />);

    fireEvent.click(screen.getByRole("button", { name: "الإشعارات" }));
    expect(await screen.findByText("تمت المراجعة الفنية")).toBeInTheDocument();
    expect(screen.getByText("عرض كل الإشعارات")).toBeInTheDocument();
  });

  it("NOTIF-I18N-05: localises preferences and keeps daily and weekly digests unavailable", async () => {
    renderWithQuery(<NotificationPreferencesPage />);

    expect(screen.getByRole("heading", { name: "تفضيلات الإشعارات" })).toBeInTheDocument();
    expect(screen.getByText("طلبات الاعتماد")).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole("tab", { name: "التسليم" }));
    expect(await screen.findByText("ملخص يومي")).toBeInTheDocument();
    expect(document.getElementById("dig-daily")).toBeDisabled();
    expect(screen.getByText("ملخص أسبوعي")).toBeInTheDocument();
    expect(document.getElementById("dig-weekly")).toBeDisabled();
  });

  it("NOTIF-I18N-06: formats recent notification timestamps in the active locale", () => {
    const ar = formatNotificationTime("2026-08-19T09:55:00.000Z", "ar", Date.parse("2026-08-19T10:00:00.000Z"));
    const en = formatNotificationTime("2026-08-01T09:55:00.000Z", "en-GB", Date.parse("2026-08-19T10:00:00.000Z"));

    expect(ar.kind).toBe("relative");
    expect(ar.value).not.toContain("ago");
    expect(en.kind).toBe("date");
    expect(en.value).toMatch(/Aug/);
  });
});