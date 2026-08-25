import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Bell, CheckCheck, FolderOpen, FileText, ClipboardList,
  AlertTriangle, MessageCircle, Upload, DollarSign, Info,
  Search, ExternalLink, Filter, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
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
  presentNotificationMessage,
} from "@/lib/notification-presentation";

type Resp = NotificationListPage;

const MODULE_OPTIONS = [
  { value: "all", labelKey: "filters.allModules" },
  { value: "project", labelKey: "filters.projects" },
  { value: "report", labelKey: "filters.reports" },
  { value: "plan", labelKey: "filters.plans" },
  { value: "risk", labelKey: "filters.risks" },
  { value: "comment", labelKey: "filters.comments" },
] as const;

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
  return <Info className={`${cls} text-muted-foreground`} />;
}

function NotificationTime({
  createdAt,
  locale,
  className = "",
}: {
  createdAt: string;
  locale: string;
  className?: string;
}) {
  const { t } = useTranslation("notifications");
  const time = formatNotificationTime(createdAt, locale);

  return (
    <time className={`block whitespace-nowrap text-xs text-muted-foreground tabular-nums ${className}`} dateTime={createdAt}>
      {time.kind === "relative"
        ? time.value === "justNow"
          ? t("time.justNow")
          : time.value
        : time.kind === "date"
          ? time.value
          : t("time.unknown")}
    </time>
  );
}

export default function NotificationsPage() {
  const { t, i18n } = useTranslation("notifications");
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const [tab, setTab] = useState<"all" | "unread">("all");
  const [module, setModule] = useState("all");
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(50);
  const { data: meData } = useGetMe();
  const userId = meData?.user?.id;

  const { data, isLoading, isError, refetch } = useQuery<Resp>({
    queryKey: notificationQueryKey(userId ?? 0, "page", tab, module, limit),
    queryFn: () => listNotifications({
      limit,
      unreadOnly: tab === "unread",
      ...(module !== "all" ? { module: module as "project" | "report" | "plan" | "risk" | "comment" } : {}),
    }),
    enabled: Boolean(userId),
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => markNotificationRead(id),
    onSuccess: () => {
      if (userId) invalidateNotificationQueries(qc, userId);
    },
  });

  const markAll = useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: () => {
      if (userId) invalidateNotificationQueries(qc, userId);
    },
  });

  const filtered = useMemo(() => {
    const allItems = data?.items ?? [];
    if (!search.trim()) return allItems;
    const q = search.toLowerCase();
    return allItems.filter((n) =>
      n.message.toLowerCase().includes(q) ||
      (n.entityType ? t(entityTypeTranslationKey(n.entityType)).toLowerCase().includes(q) : false) ||
      t(notificationKindTranslationKey(n.kind)).toLowerCase().includes(q),
    );
  }, [data?.items, search, t]);

  const unreadCount = data?.unread ?? 0;

  return (
    <div dir={i18n.dir()} className="mx-auto w-full max-w-6xl space-y-3">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <div className="min-w-0">
          <h1 className="text-2xl font-medium tracking-tight">{t("title")}</h1>
          <div className="mt-1 min-h-4 text-sm text-muted-foreground" aria-live="polite">
            {isLoading ? (
              <Skeleton className="h-3.5 w-24" />
            ) : isError ? (
              t("errorLoading")
            ) : unreadCount > 0 ? (
              t("unreadSummary", { count: unreadCount })
            ) : (
              t("noNotificationsDesc")
            )}
          </div>
        </div>
        {!isLoading && !isError && unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => markAll.mutate()}
            disabled={markAll.isPending}
            className="h-8 shrink-0 gap-1.5 border-border/70 bg-transparent text-muted-foreground hover:text-foreground sm:mt-0.5"
          >
            <CheckCheck className="h-4 w-4" />
            {t("markAllRead")}
          </Button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-card/60 p-2 sm:flex-row sm:items-center">
        <Tabs value={tab} onValueChange={(v) => setTab(v as "all" | "unread")}>
          <TabsList className="h-9 w-full bg-muted/50 p-1 sm:w-auto" aria-label={t("statusFilter")}>
            <TabsTrigger value="all" className="h-7 px-2.5 text-xs">{t("all")}</TabsTrigger>
            <TabsTrigger value="unread" className="h-7 gap-1 px-2.5 text-xs">
              {t("unread")}
              {unreadCount > 0 && (
                <Badge className="h-4 min-w-4 px-1 text-[10px] leading-none">{unreadCount > 99 ? "99+" : unreadCount}</Badge>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex w-full flex-col gap-2 sm:ms-auto sm:w-auto sm:flex-row">
          <div className="relative min-w-0 flex-1 sm:w-64">
            <Search className="absolute start-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              placeholder={t("searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-9 w-full ps-8"
            />
          </div>
          <Select value={module} onValueChange={setModule}>
            <SelectTrigger className="h-9 w-full gap-1.5 sm:w-44" aria-label={t("moduleFilter")}>
              <Filter className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MODULE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* List */}
      <div className="overflow-hidden rounded-lg border border-border/70 bg-card divide-y divide-border/70" role="list">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-x-3 px-4 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto] sm:gap-x-4"
              role="listitem"
            >
              <Skeleton className="h-8 w-8 rounded-md" />
              <div className="min-w-0 space-y-2">
                <Skeleton className="h-3.5 w-4/5 rounded" />
                <Skeleton className="h-3 w-28 rounded sm:hidden" />
              </div>
              <Skeleton className="h-3 w-16 rounded" />
              <Skeleton className="hidden h-8 w-16 rounded-md sm:block" />
            </div>
          ))
        ) : isError ? (
          <div className="px-4 py-10 text-center">
            <AlertTriangle className="h-8 w-8 text-destructive/60 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">{t("errorLoading")}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="px-4 py-10 text-center">
            <Bell className="h-8 w-8 text-muted-foreground/25 mx-auto mb-3" />
            <p className="text-sm font-medium text-muted-foreground">
              {search ? t("noNotificationsSearch") : t("noNotifications")}
            </p>
          </div>
        ) : (
          filtered.map((n) => {
            const link = safeNotificationLink(n.link);
            const isUnread = !n.readAt;
            const entityLabel = n.entityType
              ? t(entityTypeTranslationKey(n.entityType))
              : t("entityTypes.system");
            return (
              <div
                key={n.id}
                role="listitem"
                data-notification-row
                data-state={isUnread ? "unread" : "read"}
                className={`group grid grid-cols-[2rem_minmax(0,1fr)_auto] gap-x-3 gap-y-1.5 px-4 py-2.5 transition-colors duration-150 hover:bg-muted/40 sm:grid-cols-[2rem_minmax(0,1fr)_auto_auto] sm:items-center sm:gap-x-4 sm:gap-y-0 ${isUnread ? "bg-primary/[0.025]" : ""}`}
              >
                <div
                  className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/70 ${isUnread ? "ring-1 ring-primary/15" : ""}`}
                  title={t(notificationKindTranslationKey(n.kind))}
                >
                  <KindIcon kind={n.kind} />
                  <span className="sr-only">{t(notificationKindTranslationKey(n.kind))}</span>
                  {isUnread && (
                    <span
                      className="absolute end-0.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card"
                      aria-label={t("unreadStatus")}
                      role="img"
                    />
                  )}
                </div>
                <div data-notification-content className="min-w-0">
                  <div className="min-w-0">
                    <p
                      dir="auto"
                      className={`min-w-0 break-words [overflow-wrap:anywhere] text-sm leading-snug ${isUnread ? "font-medium text-foreground" : "text-foreground/85"}`}
                    >
                      {presentNotificationMessage(n.message)}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 sm:hidden">
                      <span data-notification-context className="text-xs text-muted-foreground">{entityLabel}</span>
                      <span className="text-muted-foreground/50" aria-hidden="true">•</span>
                      <NotificationTime createdAt={n.createdAt} locale={i18n.language} />
                    </div>
                  </div>
                  <div className="mt-1 hidden min-w-0 items-center gap-2 text-xs text-muted-foreground sm:flex">
                    <span data-notification-context className="min-w-0 truncate" title={entityLabel}>{entityLabel}</span>
                 </div>
                </div>
                <div data-notification-time className="hidden min-w-[4.5rem] justify-self-start sm:block">
                  <NotificationTime createdAt={n.createdAt} locale={i18n.language} />
                </div>
                <div data-notification-actions className="flex items-center justify-end gap-0.5 sm:min-w-[4rem] sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                  {link && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={t("openNotification")}
                      onClick={() => {
                        if (isUnread) markRead.mutate(n.id);
                        setLocation(link);
                      }}
                    >
                      <ExternalLink className="h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                    </button>
                  )}
                  {isUnread && (
                    <button
                      type="button"
                      className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      aria-label={t("markAsRead")}
                      title={t("markAsRead")}
                      onClick={() => markRead.mutate(n.id)}
                      disabled={markRead.isPending}
                    >
                      <Check className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Load more */}
      {!isLoading && !isError && data?.pagination.hasMore && (
        <div className="text-center">
          <Button variant="outline" size="sm" className="h-9" onClick={() => setLimit((l) => Math.min(l + 50, 200))}>
            {t("loadMore")}
          </Button>
        </div>
      )}
    </div>
  );
}
