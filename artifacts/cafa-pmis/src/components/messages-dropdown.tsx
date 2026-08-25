import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { MessageSquare, Users, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type ConvItem = {
  id: number;
  name: string | null;
  type: string;
  lastMessageBody: string | null;
  lastMessageAt: string | null;
  unreadCount: number | null;
  memberCount: number;
};

function ago(s: string | null, t: (key: string, options?: Record<string, unknown>) => string, language: string) {
  if (!s) return "";
  const diff = Date.now() - new Date(s).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("messages:justNow");
  if (m < 60) return t("messages:minutesShort", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("messages:hoursShort", { count: h });
  const d = Math.floor(h / 24);
  if (d < 7) return t("messages:daysShort", { count: d });
  return new Date(s).toLocaleDateString(language === "ar" ? "ar" : "en-GB", { day: "numeric", month: "short" });
}
type ConversationListPage = { items: ConvItem[]; hasMore: boolean; nextCursor: string | null };

function convIcon(type: string) {
  if (type === "direct") return <User className="h-4 w-4 text-muted-foreground" />;
  return <Users className="h-4 w-4 text-muted-foreground" />;
}

function convLabel(
  conv: ConvItem,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (conv.name) return conv.name;
  switch (conv.type) {
    case "direct": return t("messages:convNameDirect");
    case "project": return t("messages:convNameProject");
    case "state": return t("messages:convNameState");
    case "sector": return t("messages:convNameSector");
    case "announcement": return t("messages:announcement");
    default: return t("messages:convNameGroup");
  }
}

export function MessagesDropdown() {
  const [, setLocation] = useLocation();
  const { t, i18n } = useTranslation(["nav", "messages"]);

  const { data: unreadData } = useQuery<{ total: number }>({
    queryKey: ["conversations-unread"],
    queryFn: async () => {
      const r = await fetch("/api/conversations/unread-count", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const { data: convs, isLoading, isError, refetch } = useQuery<ConversationListPage>({
    queryKey: ["conversations-header"],
    queryFn: async () => {
      const r = await fetch("/api/conversations?limit=8", { credentials: "include" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    },
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });

  const unread = unreadData?.total;
  const hasUnread = typeof unread === "number" && unread > 0;
  const items = convs?.items ?? [];

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label={t("items.communicationCentre")}>
          <MessageSquare className="h-5 w-5" />
          {hasUnread && (
            <Badge className="absolute -top-1 -end-1 h-5 min-w-5 px-1 flex items-center justify-center text-xs bg-red-500 hover:bg-red-500">
              {unread! > 99 ? "99+" : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(24rem,calc(100vw-1rem))] max-h-[min(32rem,calc(100dvh-1rem))] p-0 flex flex-col overflow-hidden"
        align="end"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-b shrink-0">
          <div className="font-medium text-sm">{t("items.communicationCentre")}</div>
          <button
            className="shrink-0 text-xs text-primary hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setLocation("/messages")}
          >
            {t("messages:viewAllConversations")}
          </button>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {isLoading ? (
            <div className="py-8 text-center text-sm text-muted-foreground" role="status">
              <MessageSquare className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
              <p>{t("messages:headerLoading")}</p>
            </div>
          ) : isError ? (
            <div className="py-7 px-4 text-center">
              <MessageSquare className="h-6 w-6 mx-auto mb-2 text-destructive/60" />
              <p className="text-sm text-muted-foreground">{t("messages:headerError")}</p>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-primary hover:underline rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => void refetch()}
              >
                {t("messages:retry")}
              </button>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 px-4 text-center">
              <MessageSquare className="h-6 w-6 mx-auto mb-2 text-muted-foreground/30" />
              <p className="text-sm text-muted-foreground">{t("messages:headerNoConversations")}</p>
            </div>
          ) : (
            items.map((conv) => {
              const label = convLabel(conv, t);
              const hasConversationUnread = typeof conv.unreadCount === "number" && conv.unreadCount > 0;
              return (
              <button
                key={conv.id}
                title={label}
                className={`flex w-full items-start gap-3 px-3 py-2.5 border-b last:border-0 text-start hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary transition-colors duration-150 ${hasConversationUnread ? "bg-primary/[0.03]" : ""}`}
                onClick={() => setLocation(`/messages/${conv.id}`)}
              >
                <div className="mt-0.5 shrink-0">{convIcon(conv.type)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className={`text-sm font-medium truncate ${hasConversationUnread ? "text-foreground" : "text-foreground/80"}`}>
                      {label}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">{ago(conv.lastMessageAt, t, i18n.language)}</span>
                  </div>
                  {conv.lastMessageBody && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{conv.lastMessageBody}</p>
                  )}
                </div>
                {hasConversationUnread && (
                  <Badge className="shrink-0 h-5 min-w-5 px-1 text-xs">{conv.unreadCount}</Badge>
                )}
              </button>
              );
            })
          )}
        </div>

        <div className="border-t px-3 py-2">
          <button
            className="w-full text-xs font-medium text-center text-primary hover:text-primary/80 transition-colors py-0.5 flex items-center justify-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setLocation("/messages")}
          >
            {t("messages:viewAllConversations")}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
