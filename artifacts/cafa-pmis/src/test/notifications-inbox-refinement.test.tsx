import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import type React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import i18n from "@/i18n";
import NotificationsPage from "@/pages/notifications";
import { presentNotificationMessage } from "@/lib/notification-presentation";

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
      kind: "plan_due_1d",
      entityType: "plan",
      entityId: 10,
      message: "📌 Mid-year programme review / مراجعة منتصف العام",
      link: "/plans/10",
      readAt: null,
      createdAt: "2026-08-19T10:00:00.000Z",
    },
    {
      id: 2,
      kind: "project_assigned",
      entityType: "project",
      entityId: 11,
      message: "📋: AVeryLongUnbrokenProjectReferenceCAFA2026ABCDEFGHIJKLMNOPQRSTUVWXYZ",
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

describe("Notifications inbox visual refinement", () => {
  beforeEach(async () => {
    api.listNotifications.mockResolvedValue(notifications);
    api.markNotificationRead.mockResolvedValue({ ok: true });
    api.markAllNotificationsRead.mockResolvedValue({ ok: true });
    await i18n.changeLanguage("en");
  });

  afterEach(async () => {
    cleanup();
    vi.clearAllMocks();
    await i18n.changeLanguage("en");
  });

  it("NOTIF-INBOX-REFINE-01 suppresses only known decorative legacy prefixes at presentation time", () => {
    expect(presentNotificationMessage("📌 Mid-year plan")).toBe("Mid-year plan");
    expect(presentNotificationMessage("📋: Project update")).toBe("Project update");
    expect(presentNotificationMessage("✅ A meaningful status emoji remains")).toBe("✅ A meaningful status emoji remains");
    expect(presentNotificationMessage("Update includes 📌 a meaningful pin")).toBe("Update includes 📌 a meaningful pin");
    expect(presentNotificationMessage("📌")).toBe("📌");
  });

  it("NOTIF-INBOX-REFINE-02 keeps raw messages for filtering while rendering the cleaned title", async () => {
    renderWithQuery(<NotificationsPage />);

    expect(await screen.findByText("Mid-year programme review / مراجعة منتصف العام")).toBeInTheDocument();
    expect(screen.queryByText("📌 Mid-year programme review / مراجعة منتصف العام")).not.toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Search notifications…"), { target: { value: "📌" } });
    expect(await screen.findByText("Mid-year programme review / مراجعة منتصف العام")).toBeInTheDocument();
  });

  it("NOTIF-INBOX-REFINE-03 associates entity context with content instead of an isolated grid column", async () => {
    renderWithQuery(<NotificationsPage />);

    await screen.findByText("Mid-year programme review / مراجعة منتصف العام");
    const row = screen.getAllByText("Plan")[0]?.closest("[data-notification-row]");
    expect(row?.querySelector("[data-notification-content]")).toHaveTextContent("Plan");
    expect(row?.querySelector("[data-notification-time]")).toBeInTheDocument();
    expect(source("src/pages/notifications.tsx")).toContain("grid-cols-[2rem_minmax(0,1fr)_auto]");
    expect(source("src/pages/notifications.tsx")).not.toContain("8.5rem_7rem");
  });

  it("NOTIF-INBOX-REFINE-04 uses compact, predictable metadata and quiet action tracks", async () => {
    renderWithQuery(<NotificationsPage />);

    await screen.findByText(/Mid-year programme review/);
    const row = screen.getByText(/Mid-year programme review/).closest("[data-notification-row]");
    expect(row?.querySelector("[data-notification-time]")).toHaveClass("min-w-[4.5rem]");
    expect(row?.querySelector("[data-notification-actions]")).toHaveClass("sm:min-w-[4rem]");
    expect(source("src/pages/notifications.tsx")).toContain("whitespace-nowrap text-xs text-muted-foreground tabular-nums");
  });

  it("NOTIF-INBOX-REFINE-05 joins the unread dot and icon as one non-colour state treatment", async () => {
    renderWithQuery(<NotificationsPage />);

    const unreadTitle = await screen.findByText(/Mid-year programme review/);
    const unreadRow = unreadTitle.closest("[data-notification-row]");
    const readRow = screen.getByText(/AVeryLongUnbroken/).closest("[data-notification-row]");
    expect(unreadRow).toHaveAttribute("data-state", "unread");
    expect(unreadRow).toHaveClass("bg-primary/[0.025]");
    expect(unreadRow?.querySelector(".ring-1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Unread" })).toBeInTheDocument();
    expect(readRow).toHaveAttribute("data-state", "read");
    expect(readRow?.querySelector('[role="img"][aria-label="Unread"]')).not.toBeInTheDocument();
  });

  it("NOTIF-INBOX-REFINE-06 keeps desktop rows dense without restoring a heavy unread border", () => {
    const page = source("src/pages/notifications.tsx");

    expect(page).toContain("gap-y-1.5 px-4 py-2.5");
    expect(page).toContain("h-8 w-8 shrink-0");
    expect(page).not.toContain("border-s-2");
  });

  it("NOTIF-INBOX-REFINE-07 tightens the header and simplifies the owned toolbar surface", async () => {
    const { container } = renderWithQuery(<NotificationsPage />);

    await screen.findByRole("heading", { name: "Notifications" });
    await screen.findByText("1 unread");
    expect(container.firstElementChild).toHaveClass("space-y-3");
    expect(screen.getByRole("button", { name: "Mark all as read" })).toHaveClass("h-8", "shrink-0");
    expect(source("src/pages/notifications.tsx")).toContain("rounded-lg border border-border/60 bg-card/60 p-2");
    expect(source("src/pages/notifications.tsx")).not.toContain("rounded-xl border border-border/70 bg-card p-2.5");
  });

  it("NOTIF-INBOX-REFINE-08 aligns loading skeletons to the refined four-part row", () => {
    api.listNotifications.mockImplementation(() => new Promise(() => undefined));
    const { container } = renderWithQuery(<NotificationsPage />);

    expect(container.querySelectorAll('[role="listitem"]')).toHaveLength(6);
    expect(source("src/pages/notifications.tsx")).toContain("h-8 w-8 rounded-md");
    expect(source("src/pages/notifications.tsx")).toContain("sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]");
  });

  it("NOTIF-INBOX-REFINE-09 keeps responsive and RTL wrapping safeguards on the recomposed row", async () => {
    await i18n.changeLanguage("ar");
    const { container } = renderWithQuery(<NotificationsPage />);

    expect(await screen.findByRole("heading", { name: "الإشعارات" })).toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("dir", "rtl");
    const page = source("src/pages/notifications.tsx");
    expect(page).toContain("sm:hidden");
    expect(page).toContain("[overflow-wrap:anywhere]");
    expect(page).toContain('dir="auto"');
    expect(page).toContain("absolute end-0.5");
    expect(page).toContain("rtl:rotate-180");
  });

  it("NOTIF-INBOX-REFINE-10 preserves keyboard-labelled actions, safe navigation, bulk read, and pagination", async () => {
    renderWithQuery(<NotificationsPage />);

    fireEvent.click(await screen.findByRole("button", { name: "Mark all as read" }));
    await waitFor(() => expect(api.markAllNotificationsRead).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "Open notification" }));
    await waitFor(() => expect(api.markNotificationRead).toHaveBeenCalledWith(1));
    expect(navigation.setLocation).toHaveBeenCalledWith("/plans/10");
    expect(screen.getByRole("button", { name: "Load more" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark as read" })).toHaveClass("focus-visible:ring-2");
  });
});