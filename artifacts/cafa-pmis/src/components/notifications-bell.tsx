import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Bell, CheckCheck, FolderOpen, FileText, ClipboardList,
  AlertTriangle, MessageCircle, Upload, DollarSign, Info, ExternalLink, ArrowRight,
} from "@/components/icons";
import { Button, Chip, Popover, Skeleton } from "@heroui/react";
import { Button as AriaButton } from "react-aria-components";
import {
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  useGetMe,
  type NotificationListPage,
} from "@workspace/api-client-react";
import {
  invalidateNotificationQueries,
  notificationQueryKey,
  safeNotificationLink,
} from "@/lib/notification-client";
import {
  entityTypeTranslationKey,
  formatNotificationTime,
  notificationKindTranslationKey,
} from "@/lib/notification-presentation";

type Resp = NotificationListPage;

function KindIcon({ kind }: { kind: string }) {
  const cls = "h-4 w-4 shrink-0";
  if (kind.startsWith("project") || kind === "project_transition" || kind === "project_assigned")
    return <FolderOpen className={`${cls} text-blue-500`} />;
  if (kind === "document_uploaded")
    return <Upload className={`${cls} text-violet-500`} />;
  if (kind.startsWith("report"))
    return <FileText className={`${cls} text-amber-500`} />;
  if (kind.startsWith("plan"))
    return <ClipboardList className={`${cls} text-green-500`} />;
  if (kind.startsWith("risk"))
    return <AlertTriangle className={`${cls} text-red-500`} />;
  if (kind.startsWith("comment") || kind === "mention")
    return <MessageCircle className={`${cls} text-sky-500`} />;
  if (kind.startsWith("budget"))
    return <DollarSign className={`${cls} text-emerald-500`} />;
  return <Info className={`${cls} text-[var(--muted)]`} />;
}

export function NotificationsBell() {
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { t, i18n } = useTranslation("notifications");
  const { data: meData } = useGetMe();
  const userId = meData?.user?.id;

  const { data, isLoading, isError, refetch } = useQuery<Resp>({
    queryKey: notificationQueryKey(userId ?? 0, "bell"),
    queryFn: () => listNotifications({ limit: 20 }),
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => { if (userId) invalidateNotificationQueries(qc, userId); },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => { if (userId) invalidateNotificationQueries(qc, userId); },
  });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;
  const hasUnreadCount = Boolean(data) && !isError;
  const [isOpen, setIsOpen] = useState(false);
  const go = (path: string) => { setIsOpen(false); setLocation(path); };
  // Western digits in both languages (the app-wide numbers rule).
  const timeLocale = i18n.language === "ar" ? "ar-u-nu-latn" : "en-GB";

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      {/* A bare React Aria button keeps the Pro Navbar.Item look of its neighbours. */}
      <AriaButton className="navbar__item" aria-label={t("title")}>
        <Bell className="size-4" aria-hidden="true" />
        {hasUnreadCount && unread > 0 && (
          /* -end-0.5: logical-end positioning (right in LTR, left in RTL) */
          <span
            className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white"
            aria-label={`${unread > 99 ? "99+" : unread} ${t("unread")}`}
          >
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </AriaButton>
      <Popover.Content placement="bottom end" className="w-[calc(100vw-2rem)] max-w-sm overflow-hidden p-0">
        <Popover.Dialog className="p-0" aria-label={t("title")}>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2.5">
            <div className="flex items-center gap-2">
              <Popover.Heading className="text-sm font-medium">{t("title")}</Popover.Heading>
              {hasUnreadCount && unread > 0 && (
                <Chip size="sm" variant="soft" color="accent"><bdi dir="ltr">{unread > 99 ? "99+" : unread}</bdi></Chip>
              )}
            </div>
            {hasUnreadCount && unread > 0 && (
              <Button variant="ghost" size="sm" onPress={() => markAll.mutate()} isDisabled={markAll.isPending}>
                <CheckCheck className="size-3.5" aria-hidden="true" /> {t("markAllRead")}
              </Button>
            )}
          </div>

          <div className="max-h-[min(420px,calc(100dvh-8rem))] overflow-y-auto">
            {isLoading ? (
              [1, 2, 3].map((i) => (
                <div key={i} className="flex gap-2.5 border-b border-[var(--border)] px-3.5 py-3 last:border-0">
                  <Skeleton className="mt-0.5 size-7 shrink-0 rounded-md" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4 rounded" />
                    <Skeleton className="h-[11px] w-1/4 rounded" />
                  </div>
                </div>
              ))
            ) : isError ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-[var(--muted)]">{t("errorLoading")}</p>
                <Button variant="secondary" size="sm" className="mt-3" onPress={() => void refetch()}>
                  {t("retry")}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-9 text-center">
                <Bell className="mx-auto mb-2 size-7 text-[var(--muted)] opacity-30" aria-hidden="true" />
                <p className="text-sm text-[var(--muted)]">{t("noNotificationsDesc")}</p>
              </div>
            ) : (
              items.map((n) => {
                const link = safeNotificationLink(n.link);
                const time = formatNotificationTime(n.createdAt, timeLocale);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`flex w-full gap-2.5 border-b border-s-2 border-b-[var(--border)] px-3.5 py-2.5 text-start transition-colors duration-150 last:border-b-0 hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] ${!n.readAt ? "border-s-[var(--accent)] bg-[var(--accent)]/[0.04]" : "border-s-transparent"}`}
                    onClick={() => {
                      if (!n.readAt) markRead.mutate(n.id);
                      if (link) go(link);
                    }}
                  >
                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-[var(--default)]">
                      <KindIcon kind={n.kind} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-1">
                        <p dir="auto" className={`min-w-0 break-words text-page-start text-sm leading-snug ${!n.readAt ? "font-medium text-[var(--foreground)]" : "text-[var(--foreground)]/90"}`}>
                          {n.message}
                        </p>
                        {link && <ExternalLink className="mt-0.5 size-3 shrink-0 text-[var(--muted)]" aria-hidden="true" />}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                        <Chip size="sm" variant="soft">{t(notificationKindTranslationKey(n.kind))}</Chip>
                        {n.entityType && (
                          <Chip size="sm" variant="tertiary">{t(entityTypeTranslationKey(n.entityType))}</Chip>
                        )}
                        <span className="text-xs tabular-nums text-[var(--muted)]">
                          {time.kind === "relative"
                            ? time.value === "justNow" ? t("time.justNow") : time.value
                            : time.kind === "date" ? time.value : t("time.unknown")}
                        </span>
                        {!n.readAt && <span className="size-1.5 shrink-0 rounded-full bg-[var(--accent)]" aria-hidden="true" />}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          <div className="border-t border-[var(--border)] px-3.5 py-2">
            <Button variant="ghost" size="sm" className="w-full text-[var(--accent)]" onPress={() => go("/notifications")}>
              {t("viewAll")} <ArrowRight className="size-3 rtl:rotate-180" aria-hidden="true" />
            </Button>
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
