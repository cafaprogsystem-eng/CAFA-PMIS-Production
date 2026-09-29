import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { MessageSquare, Users, User } from "@/components/icons";
import { Button, Chip, Popover, Spinner } from "@heroui/react";
import { Button as AriaButton } from "react-aria-components";

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
  return new Date(s).toLocaleDateString(language === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "short" });
}
/** Voice and attachment-only messages are stored with a fixed English body (as on the Messages page). */
function previewBody(body: string, t: (key: string) => string): string {
  if (body === "(Voice message)") return t("messages:voiceMessage");
  if (body === "(attachment)") return t("messages:attachmentPlaceholder");
  return body;
}
type ConversationListPage = { items: ConvItem[]; hasMore: boolean; nextCursor: string | null };

function convIcon(type: string) {
  if (type === "direct") return <User className="size-4 text-[var(--muted)]" aria-hidden="true" />;
  return <Users className="size-4 text-[var(--muted)]" aria-hidden="true" />;
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
  const [isOpen, setIsOpen] = useState(false);
  const go = (path: string) => { setIsOpen(false); setLocation(path); };

  return (
    <Popover isOpen={isOpen} onOpenChange={setIsOpen}>
      {/* A bare React Aria button keeps the Pro Navbar.Item look of its neighbours. */}
      <AriaButton className="navbar__item" aria-label={t("items.communicationCentre")}>
        <MessageSquare className="size-4" aria-hidden="true" />
        {hasUnread && (
          <span className="absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--danger)] px-1 text-[10px] font-semibold leading-none text-white">
            {unread! > 99 ? "99+" : unread}
          </span>
        )}
      </AriaButton>
      <Popover.Content placement="bottom end" className="w-[min(24rem,calc(100vw-1rem))] overflow-hidden p-0">
        <Popover.Dialog className="flex max-h-[min(32rem,calc(100dvh-1rem))] flex-col p-0" aria-label={t("items.communicationCentre")}>
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
            <Popover.Heading className="text-sm font-medium">{t("items.communicationCentre")}</Popover.Heading>
            <Button variant="ghost" size="sm" className="text-[var(--accent)]" onPress={() => go("/messages")}>
              {t("messages:viewAllConversations")}
            </Button>
          </div>

          <div className="min-h-0 overflow-y-auto">
            {isLoading ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-[var(--muted)]" role="status">
                <Spinner size="sm" aria-hidden="true" />
                <p>{t("messages:headerLoading")}</p>
              </div>
            ) : isError ? (
              <div className="px-4 py-7 text-center">
                <MessageSquare className="mx-auto mb-2 size-6 text-[var(--danger)] opacity-60" aria-hidden="true" />
                <p className="text-sm text-[var(--muted)]">{t("messages:headerError")}</p>
                <Button variant="secondary" size="sm" className="mt-3" onPress={() => void refetch()}>
                  {t("messages:retry")}
                </Button>
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <MessageSquare className="mx-auto mb-2 size-6 text-[var(--muted)] opacity-30" aria-hidden="true" />
                <p className="text-sm text-[var(--muted)]">{t("messages:headerNoConversations")}</p>
              </div>
            ) : (
              items.map((conv) => {
                const label = convLabel(conv, t);
                const hasConversationUnread = typeof conv.unreadCount === "number" && conv.unreadCount > 0;
                return (
                  <button
                    key={conv.id}
                    type="button"
                    title={label}
                    className={`flex w-full items-start gap-3 border-b border-[var(--border)] px-3 py-2.5 text-start transition-colors duration-150 last:border-0 hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)] ${hasConversationUnread ? "bg-[var(--accent)]/[0.04]" : ""}`}
                    onClick={() => go(`/messages/${conv.id}`)}
                  >
                    <div className="mt-0.5 shrink-0">{convIcon(conv.type)}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span dir="auto" className={`truncate text-page-start text-sm font-medium ${hasConversationUnread ? "text-[var(--foreground)]" : "text-[var(--foreground)]/80"}`}>
                          {label}
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-[var(--muted)]">{ago(conv.lastMessageAt, t, i18n.language)}</span>
                      </div>
                      {conv.lastMessageBody && (
                        <p dir="auto" className="mt-0.5 truncate text-page-start text-xs text-[var(--muted)]">{previewBody(conv.lastMessageBody, t)}</p>
                      )}
                    </div>
                    {hasConversationUnread && (
                      <Chip size="sm" variant="soft" color="accent" className="shrink-0"><bdi dir="ltr">{conv.unreadCount}</bdi></Chip>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
