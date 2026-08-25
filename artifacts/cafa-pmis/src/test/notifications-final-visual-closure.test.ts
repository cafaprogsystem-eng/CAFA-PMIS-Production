import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function source(path: string) {
  return readFileSync(resolve(path), "utf8");
}

const page = source("src/pages/notifications.tsx");
const bell = source("src/components/notifications-bell.tsx");
const preferences = source("src/pages/notification-preferences.tsx");
const dashboard = source("src/pages/dashboard.tsx");
const presentation = source("src/lib/notification-presentation.ts");
const layout = source("src/components/layout.tsx");

describe("Notifications final visual closure", () => {
  it("NOTIF-FINAL-VIS-01 accounts for all Notification presentation surfaces", () => {
    expect(layout).toContain("<NotificationsBell />");
    expect(page).toContain("export default function NotificationsPage()");
    expect(preferences).toContain("export default function NotificationPreferencesPage()");
    expect(dashboard).toContain("function NotificationsSummaryWidget()");
  });

  it("NOTIF-FINAL-VIS-02 keeps the page hierarchy compact", () => {
    expect(page).toContain('className="text-2xl font-medium tracking-tight"');
    expect(page).not.toContain('className="text-3xl font-bold tracking-tight"');
    expect(page).toContain("rounded-lg border border-border/60 bg-card/60 p-2");
  });

  it("NOTIF-FINAL-VIS-03 keeps notification rows scannable and metadata subordinate", () => {
    expect(page).toContain("group grid grid-cols-[2rem_minmax(0,1fr)_auto]");
    expect(page).toContain("sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto]");
    expect(page).toContain("min-w-0 break-words [overflow-wrap:anywhere] text-sm leading-snug");
    expect(page).not.toContain("rounded bg-muted/80");
    expect(bell).toContain("flex w-full gap-2.5 border-b border-s-2");
  });

  it("NOTIF-FINAL-VIS-04 keeps unread and read presentation truthful", () => {
    expect(page).toContain("!isLoading && !isError && unreadCount > 0");
    expect(bell).toContain("const hasUnreadCount = Boolean(data) && !isError");
    expect(dashboard).toContain("if (isError) return (");
    expect(dashboard.indexOf("if (isError) return (")).toBeLessThan(dashboard.indexOf("const totalUnread"));
  });

  it("NOTIF-FINAL-VIS-05 keeps loading, empty, and error states distinct", () => {
    for (const surface of [page, bell]) {
      expect(surface).toContain("isLoading ? (");
      expect(surface).toContain("isError ? (");
      expect(surface).toContain('t("errorLoading")');
      expect(surface).toContain('t("retry")');
    }
    expect(page).toContain("filtered.length === 0 ? (");
    expect(bell).toContain("items.length === 0 ? (");
    expect(dashboard).toContain('t("errorLoading", { ns: "notifications" })');
  });

  it("NOTIF-FINAL-VIS-06 keeps the bell and popover coherent with the inbox", () => {
    expect(bell).toContain("relative h-9 w-9 rounded-lg");
    expect(bell).toContain("w-[calc(100vw-2rem)] max-w-sm");
    expect(bell).toContain("max-h-[min(420px,calc(100dvh-8rem))]");
    expect(bell).toContain('t("viewAll")');
  });

  it("NOTIF-FINAL-VIS-07 keeps preferences visually consistent", () => {
    expect(preferences).toContain("mx-auto max-w-3xl space-y-5 p-4 sm:p-6");
    expect(preferences).toContain("rounded-lg shadow-none");
    expect(preferences).toContain("gap-4 py-2.5");
    expect(preferences).toContain("grid grid-cols-1 gap-3 sm:grid-cols-2");
  });

  it("NOTIF-FINAL-VIS-08 keeps digest visibly unavailable", () => {
    expect(preferences).toContain('RadioGroupItem value="daily" id="dig-daily" disabled');
    expect(preferences).toContain('RadioGroupItem value="weekly" id="dig-weekly" disabled');
    expect(preferences).toContain('t("comingSoon")');
    expect(preferences).toContain('digest: "immediate"');
  });

  it("NOTIF-FINAL-VIS-09 keeps long and mixed-direction content overflow-safe", () => {
    expect(page).toContain("min-w-0 break-words");
    expect(page).toContain('dir="auto"');
    expect(bell).toContain("min-w-0 break-words");
    expect(page).toContain("flex flex-wrap items-center");
    expect(bell).toContain("flex flex-wrap items-center");
  });

  it("NOTIF-FINAL-VIS-10 preserves Arabic and RTL presentation", () => {
    expect(page).toContain("dir={i18n.dir()}");
    expect(bell).toContain("dir={i18n.dir()}");
    expect(preferences).toContain("dir={i18n.dir()}");
    expect(bell).toContain("rtl:rotate-180");
    expect(dashboard).toContain("rtl:rotate-180");
    expect(presentation).toContain("notificationKindTranslationKey");
    expect(presentation).toContain("entityTypeTranslationKey");
  });

  it("NOTIF-FINAL-VIS-11 preserves accessible keyboard and focus treatment", () => {
    expect(bell).toContain('aria-label={t("title")}');
    expect(bell).toContain("focus-visible:ring-2 focus-visible:ring-ring");
    expect(page).toContain('aria-label={t("openNotification")}');
    expect(page).toContain('aria-label={t("unreadStatus")}');
    expect(page).toContain('role="img"');
    expect(preferences).toContain("disabled={mandatory}");
  });

  it("NOTIF-FINAL-VIS-12 keeps Notification contracts outside visual code unchanged", () => {
    for (const surface of [page, bell]) {
      expect(surface).toContain("listNotifications");
      expect(surface).toContain("markNotificationRead");
      expect(surface).toContain("markAllNotificationsRead");
      expect(surface).toContain("safeNotificationLink");
    }
    expect(page).toContain("data?.pagination.hasMore");
    expect(dashboard).toContain("useGetDashboardNotificationsSummary");
    expect(dashboard).toContain("entityTypeTranslationKey");
  });
});