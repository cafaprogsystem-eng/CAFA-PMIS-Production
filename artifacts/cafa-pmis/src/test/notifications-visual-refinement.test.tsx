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

const notifications = {
  items: [
    {
      id: 1,
      kind: "comment_added",
      entityType: "project",
      entityId: 10,
      message: "A new comment was added to the long project name used for visual verification",
      link: "/projects/10",
      readAt: null,
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    {
      id: 2,
      kind: "approved",
      entityType: "report",
      entityId: 11,
      message: "A report was approved",
      link: null,
      readAt: "2026-08-18T10:00:00.000Z",
      createdAt: "2026-08-18T10:00:00.000Z",
    },
  ],
  unread: 1,
  pagination: { limit: 50, offset: 0, hasMore: true, nextOffset: 50 },
};

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("Notifications visual refinement — Phase 1", () => {
  beforeEach(async () => {
    api.listNotifications.mockResolvedValue(notifications);
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("NOTIF-VIS-01 keeps the page hierarchy compact and restrained", async () => {
    renderWithQuery(<NotificationsPage />);

    const heading = await screen.findByRole("heading", { name: "Notifications" });
    expect(heading).toHaveClass("text-2xl", "font-medium", "tracking-tight");
    expect(heading).not.toHaveClass("text-3xl", "font-bold");
    expect(source("src/pages/notifications.tsx")).toContain('!isLoading && !isError && unreadCount > 0');
  });

  it("NOTIF-VIS-02 presents notifications as one scannable inbox list", async () => {
    const { container } = renderWithQuery(<NotificationsPage />);
    await screen.findByText("A new comment was added to the long project name used for visual verification");

    const list = container.querySelector('[role="list"]');
    expect(list).toBeInTheDocument();
    expect(list).toHaveClass("divide-y");
    expect(source("src/pages/notifications.tsx")).not.toContain("shadow-sm");
  });

  it("NOTIF-VIS-03 distinguishes unread and read rows without relying on colour alone", async () => {
    renderWithQuery(<NotificationsPage />);

    const unread = await screen.findByText("A new comment was added to the long project name used for visual verification");
    expect(unread).toHaveClass("font-medium");
    expect(screen.getByRole("img", { name: "Unread" })).toBeInTheDocument();

    const read = screen.getByText("A report was approved");
    expect(read).toHaveClass("text-foreground/85");
    expect(screen.queryByText("Mark as read")).not.toBeInTheDocument();
  });

  it("NOTIF-VIS-04 wraps long notification content safely", async () => {
    const { container } = renderWithQuery(<NotificationsPage />);
    await screen.findByText("A new comment was added to the long project name used for visual verification");

    expect(container.querySelector(".break-words")).toBeInTheDocument();
    expect(source("src/pages/notifications.tsx")).toContain("min-w-0 break-words [overflow-wrap:anywhere] text-sm");
  });

  it("NOTIF-VIS-05 keeps loading, empty, and error states truthful", () => {
    const page = source("src/pages/notifications.tsx");
    const bell = source("src/components/notifications-bell.tsx");

    expect(page).toContain("isLoading ? (");
    expect(page).toContain("isError ? (");
    expect(page).toContain("filtered.length === 0 ? (");
    expect(page).toContain('t("errorLoading")');
    expect(bell).toContain("items.length === 0 ? (");
    expect(bell).toContain('t("retry")');
    expect(page).not.toContain("return { items: [], unread: 0 }");
  });

  it("NOTIF-VIS-06 keeps filters compact and responsive", async () => {
    renderWithQuery(<NotificationsPage />);

    expect(await screen.findByPlaceholderText("Search notifications…")).toHaveClass("h-9");
    expect(screen.getByRole("combobox")).toHaveClass("h-9", "sm:w-44");
    expect(screen.getByRole("tab", { name: "All" })).toHaveClass("h-7");
  });

  it("NOTIF-VIS-07 keeps the bell popover compact with clear preview hierarchy", async () => {
    renderWithQuery(<NotificationsBell />);
    fireEvent.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("View all notifications")).toBeInTheDocument();
    expect(source("src/components/notifications-bell.tsx")).toContain("w-[calc(100vw-2rem)] max-w-sm");
    expect(source("src/components/notifications-bell.tsx")).toContain("max-h-[min(420px,calc(100dvh-8rem))]");
  });

  it("NOTIF-VIS-08 keeps the unread badge legible for large counts", async () => {
    api.listNotifications.mockResolvedValueOnce({ ...notifications, unread: 120 });
    renderWithQuery(<NotificationsBell />);

    expect(await screen.findByLabelText("99+ Unread")).toBeInTheDocument();
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("NOTIF-VIS-09 keeps preference rows compact and scannable", () => {
    const { container } = renderWithQuery(<NotificationPreferencesPage />);

    expect(screen.getByRole("heading", { name: "Notification Preferences" })).toHaveClass("text-2xl", "font-semibold");
    expect(container.querySelector(".rounded-lg.shadow-none")).toBeInTheDocument();
    expect(source("src/pages/notification-preferences.tsx")).toContain("gap-4 py-2.5");
  });

  it("NOTIF-VIS-10 makes unavailable digest options visibly and truthfully Coming Soon", async () => {
    renderWithQuery(<NotificationPreferencesPage />);
    await userEvent.setup().click(screen.getByRole("tab", { name: "Delivery" }));

    expect(await screen.findAllByText("Coming soon")).toHaveLength(2);
    expect(screen.getByRole("radio", { name: /Daily digest/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: /Weekly digest/ })).toBeDisabled();
  });

  it("NOTIF-VIS-11 preserves Arabic and RTL presentation hooks", async () => {
    await i18n.changeLanguage("ar");
    const { container } = renderWithQuery(<NotificationsPage />);

    expect(await screen.findByRole("heading", { name: "الإشعارات" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    expect(source("src/pages/notifications.tsx")).toContain('dir="auto"');
    expect(source("src/pages/notifications.tsx")).toContain("rtl:rotate-180");
    expect(source("src/components/notifications-bell.tsx")).toContain("rtl:rotate-180");
  });

  it("NOTIF-VIS-12 preserves notification contracts while refining presentation", () => {
    const page = source("src/pages/notifications.tsx");
    const bell = source("src/components/notifications-bell.tsx");
    const prefs = source("src/pages/notification-preferences.tsx");

    for (const content of [page, bell]) {
      expect(content).toContain("listNotifications");
      expect(content).toContain("markNotificationRead");
      expect(content).toContain("markAllNotificationsRead");
      expect(content).toContain("safeNotificationLink");
    }
    expect(page).toContain("data?.pagination.hasMore");
    expect(prefs).toContain("digest: \"immediate\"");
    expect(prefs).toContain("disabled={mandatory}");
  });
});