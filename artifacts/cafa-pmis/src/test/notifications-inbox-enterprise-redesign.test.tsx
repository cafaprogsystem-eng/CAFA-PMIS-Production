import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import NotificationsPage from "@/pages/notifications";

const api = vi.hoisted(() => ({
  listNotifications: vi.fn(),
  markAllNotificationsRead: vi.fn(),
  markNotificationRead: vi.fn(),
}));

const navigation = vi.hoisted(() => ({ setLocation: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({
  listNotifications: api.listNotifications,
  markAllNotificationsRead: api.markAllNotificationsRead,
  markNotificationRead: api.markNotificationRead,
  useGetMe: () => ({ data: { user: { id: 7 } } }),
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/notifications", navigation.setLocation],
}));

const notifications = {
  items: [
    {
      id: 1,
      kind: "comment_added",
      entityType: "project",
      entityId: 10,
      message: "A linked notification with a deliberately long mixed-direction label: مشروع CAFA-2026-01",
      link: "/projects/10",
      readAt: null,
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    {
      id: 2,
      kind: "approved",
      entityType: "report",
      entityId: 11,
      message: "An unread notification without a destination",
      link: null,
      readAt: null,
      createdAt: "2026-08-18T10:00:00.000Z",
    },
    {
      id: 3,
      kind: "system",
      entityType: null,
      entityId: null,
      message: "A read system notification",
      link: null,
      readAt: "2026-08-18T10:00:00.000Z",
      createdAt: "2026-08-18T10:00:00.000Z",
    },
  ],
  unread: 2,
  pagination: { limit: 50, offset: 0, hasMore: true, nextOffset: 50 },
};

function renderWithQuery(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

describe("Notifications inbox enterprise redesign", () => {
  beforeEach(async () => {
    api.listNotifications.mockResolvedValue(notifications);
    api.markNotificationRead.mockResolvedValue({ ok: true });
    api.markAllNotificationsRead.mockResolvedValue({ ok: true });
    await i18n.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("NOTIF-INBOX-VIS-01 uses a wider, bounded enterprise workspace", async () => {
    const { container } = renderWithQuery(<NotificationsPage />);
    await screen.findByRole("heading", { name: "Notifications" });

    expect(container.firstElementChild).toHaveClass("mx-auto", "max-w-6xl");
    expect(container.firstElementChild).not.toHaveClass("max-w-4xl");
  });

  it("NOTIF-INBOX-VIS-02 keeps the header quiet and makes the unread summary actionable only in bulk", async () => {
    renderWithQuery(<NotificationsPage />);

    expect(await screen.findByText("2 unread")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark all as read" })).toHaveClass("h-8");
    expect(screen.queryByText("Mark as read")).not.toBeInTheDocument();
  });

  it("NOTIF-INBOX-VIS-03 composes status, search, and module filtering as one responsive toolbar", async () => {
    renderWithQuery(<NotificationsPage />);

    expect(await screen.findByRole("tablist", { name: "Notification status" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search notifications…")).toHaveClass("h-9");
    expect(screen.getByRole("combobox", { name: "Filter by module" })).toHaveClass("h-9", "sm:w-44");
    expect(source("src/pages/notifications.tsx")).toContain("flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 p-2");
  });

  it("NOTIF-INBOX-VIS-04 renders one unified list surface with a stable desktop row grid", async () => {
    const { container } = renderWithQuery(<NotificationsPage />);
    await screen.findByText("A read system notification");

    expect(container.querySelector('[role="list"]')).toHaveClass("divide-y", "rounded-lg");
    expect(container.querySelectorAll('[data-notification-row]')).toHaveLength(3);
    expect(source("src/pages/notifications.tsx")).toContain("sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]");
  });

  it("NOTIF-INBOX-VIS-05 replaces the continuous unread border with dot, weight, and restrained row treatment", async () => {
    renderWithQuery(<NotificationsPage />);

    const unread = await screen.findByText(/linked notification/);
    expect(unread).toHaveClass("font-medium");
    expect(screen.getAllByRole("img", { name: "Unread" })).toHaveLength(2);
    expect(source("src/pages/notifications.tsx")).not.toContain("border-s-2");
  });

  it("NOTIF-INBOX-VIS-06 keeps primary content dominant and removes visible event badges", async () => {
    renderWithQuery(<NotificationsPage />);
    await screen.findByText(/linked notification/);

    expect(source("src/pages/notifications.tsx")).not.toContain("rounded bg-muted/80 px-1.5");
    expect(source("src/pages/notifications.tsx")).toContain('className="sr-only">{t(notificationKindTranslationKey(n.kind))}</span>');
  });

  it("NOTIF-INBOX-VIS-07 preserves safe open and read actions without visible action noise", async () => {
    renderWithQuery(<NotificationsPage />);

    const markReadButtons = await screen.findAllByRole("button", { name: "Mark as read" });
    fireEvent.click(markReadButtons[0]);
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith(1));
    expect(navigation.setLocation).not.toHaveBeenCalled();

    api.markNotificationRead.mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Open notification" }));
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith(1));
    expect(navigation.setLocation).toHaveBeenCalledWith("/projects/10");

    fireEvent.click(markReadButtons[1]);
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith(2));
  });

  it("NOTIF-INBOX-VIS-08 matches loading skeletons to the row grid", () => {
    const page = source("src/pages/notifications.tsx");

    expect(page).toContain('Array.from({ length: 6 })');
    expect(page).toContain('role="listitem"');
    expect(page).toContain("sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]");
  });

  it("NOTIF-INBOX-VIS-09 keeps error, empty, and retry states truthful within the list surface", async () => {
    api.listNotifications.mockRejectedValueOnce(new Error("offline"));
    renderWithQuery(<NotificationsPage />);

    expect((await screen.findAllByText("Notifications could not be loaded.")).length).toBeGreaterThan(1);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(source("src/pages/notifications.tsx")).toContain("filtered.length === 0 ? (");
  });

  it("NOTIF-INBOX-VIS-10 reflows entity context and time beneath content on mobile", async () => {
    renderWithQuery(<NotificationsPage />);
    await screen.findByText(/linked notification/);

    expect(screen.getAllByText("Project").length).toBeGreaterThan(0);
    expect(source("src/pages/notifications.tsx")).toContain("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden");
    expect(source("src/pages/notifications.tsx")).toContain('data-notification-content className="min-w-0"');
  });

  it("NOTIF-INBOX-VIS-11 preserves long mixed-direction content, RTL direction, and keyboard focus treatment", async () => {
    await i18n.changeLanguage("ar");
    const { container } = renderWithQuery(<NotificationsPage />);

    expect(await screen.findByRole("heading", { name: "الإشعارات" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    const page = source("src/pages/notifications.tsx");
    expect(page).toContain('dir="auto"');
    expect(page).toContain("[overflow-wrap:anywhere]");
    expect(page).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(page).toContain("rtl:rotate-180");
  });

  it("NOTIF-INBOX-VIS-12 retains localisation, pagination, and notification data contracts", () => {
    const page = source("src/pages/notifications.tsx");
    const en = JSON.parse(readFileSync(resolve("src/locales/en/notifications.json"), "utf8")) as Record<string, string>;
    const ar = JSON.parse(readFileSync(resolve("src/locales/ar/notifications.json"), "utf8")) as Record<string, string>;

    expect(en.unreadSummary).toBeDefined();
    expect(ar.unreadSummary).toBeDefined();
    for (const contract of ["listNotifications", "markNotificationRead", "markAllNotificationsRead", "safeNotificationLink", "data?.pagination.hasMore"]) {
      expect(page).toContain(contract);
    }
  });
});