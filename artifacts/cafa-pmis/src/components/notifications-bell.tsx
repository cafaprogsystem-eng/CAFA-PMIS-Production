import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Bell, CheckCheck, FolderOpen, FileText, ClipboardList,
  AlertTriangle, MessageCircle, Upload, DollarSign, Info, ExternalLink, ArrowRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
  return <Info className={`${cls} text-muted-foreground`} />;
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

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative h-9 w-9 rounded-lg focus-visible:ring-2 focus-visible:ring-ring" aria-label={t("title")}>
          <Bell className="h-[18px] w-[18px]" aria-hidden="true" />
          {hasUnreadCount && unread > 0 && (
            /* -end-1: logical-end positioning (right in LTR, left in RTL) */
            <Badge
              className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center bg-destructive px-1 text-[10px] leading-none hover:bg-destructive"
              aria-label={`${unread > 99 ? "99+" : unread} ${t("unread")}`}
            >
              {unread > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent dir={i18n.dir()} className="w-[calc(100vw-2rem)] max-w-sm overflow-hidden p-0" align="end">
        <div className="flex items-center justify-between border-b px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium">{t("title")}</span>
            {hasUnreadCount && unread > 0 && (
              <Badge className="h-5 min-w-5 px-1.5 text-[10px] font-medium tabular-nums">{unread > 99 ? "99+" : unread}</Badge>
            )}
          </div>
          {hasUnreadCount && unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-xs text-muted-foreground hover:text-foreground"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
            >
              <CheckCheck className="h-3 w-3" aria-hidden="true" /> {t("markAllRead")}
            </Button>
          )}
        </div>

        <div className="max-h-[min(420px,calc(100dvh-8rem))] overflow-y-auto">
          {isLoading ? (
            <>
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex gap-2.5 border-b px-3.5 py-3 last:border-0">
                  <div className="mt-0.5 h-7 w-7 shrink-0 rounded-md bg-muted/70" />
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <div className="h-3.5 w-3/4 rounded bg-muted/60" />
                    <div className="h-[11px] w-1/4 rounded bg-muted/50" />
                  </div>
                </div>
              ))}
            </>
          ) : isError ? (
            <div className="px-4 py-8 text-center">
               <p className="text-sm text-muted-foreground">{t("errorLoading")}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={() => void refetch()}>
                 {t("retry")}
              </Button>
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-9 text-center">
              <Bell className="h-7 w-7 text-muted-foreground/30 mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">{t("noNotificationsDesc")}</p>
            </div>
          ) : (
            items.map((n) => {
              const link = safeNotificationLink(n.link);
              return (
                <button
                  key={n.id}
                  className={`flex w-full gap-2.5 border-b border-s-2 px-3.5 py-2.5 text-start transition-colors duration-150 last:border-0 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${!n.readAt ? "border-s-primary bg-primary/[0.035]" : "border-s-transparent"}`}
                  onClick={() => {
                    if (!n.readAt) markRead.mutate(n.id);
                    if (link) setLocation(link);
                  }}
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted/60">
                    <KindIcon kind={n.kind} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-1">
                      <p className={`min-w-0 break-words text-sm leading-snug ${!n.readAt ? "font-medium text-foreground" : "text-foreground/90"}`}>
                        {n.message}
                      </p>
                      {link && (
                        <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1">
                     <span className="rounded bg-muted/80 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                       {t(notificationKindTranslationKey(n.kind))}
                     </span>
                     {n.entityType && (
                         <span className="rounded bg-muted/50 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                         {t(entityTypeTranslationKey(n.entityType))}
                        </span>
                      )}
                     {(() => {
                       const time = formatNotificationTime(n.createdAt, i18n.language);
                       return (
                         <span className="text-xs text-muted-foreground tabular-nums">
                           {time.kind === "relative"
                             ? time.value === "justNow"
                               ? t("time.justNow")
                               : time.value
                             : time.kind === "date"
                               ? time.value
                               : t("time.unknown")}
                         </span>
                       );
                     })()}
                      {!n.readAt && (
                        <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" />
                      )}
                    </div>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="border-t px-3.5 py-2.5">
          <button
            className="flex w-full items-center justify-center gap-1 rounded-md py-1 text-center text-xs font-medium text-primary transition-colors hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setLocation("/notifications")}
          >
            {t("viewAll")} <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
