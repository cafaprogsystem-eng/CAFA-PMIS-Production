import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
import { useSyncContext } from "@/contexts/sync-context";
import { isOfflineQueuedError, isOfflineBlockedError } from "@/lib/offline/fetch-interceptor";
import { useParams, useLocation } from "wouter";
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { requestUploadUrl, useGetMe } from "@workspace/api-client-react";
import { useSocket } from "@/lib/socket";
import EmojiPickerLib from "emoji-picker-react";
import {
  Search, Plus, MoreVertical, Send, Paperclip, Smile,
  ArrowLeft, Users, Edit2, Trash2, Reply, X, Check,
  MessageSquare, Building2, FolderKanban, MapPin, Layers, Megaphone,
  Mic, Play, Pause, DownloadCloud, GalleryHorizontal,
  Forward, StopCircle, Image as ImageIcon, Volume2,
  Circle, Copy, Pin, PinOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/ui/error-state";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { SECTORS } from "@/lib/sectors";
import {
  canUploadMessageAttachments,
  uploadMessageAttachment,
} from "@/lib/message-upload";

/* ─── types ─────────────────────────────────────────────────────── */
interface Reaction { emoji: string; userId: number; userName: string }
/** Public attachment shape returned in Message responses. objectPath is NEVER present here. */
interface Attachment { type: string; url: string; name: string; size?: number; duration?: number; contentType?: string; availabilityStatus?: "available" | "unavailable" }
interface ConvSummary {
  id: number; type: string; name: string | null;
  projectId: number | null; stateId: number | null; sector: string | null;
  lastMessageBody: string | null; lastMessageAt: string | null;
  lastMessageSenderName: string | null;
  unreadCount: number | null; memberCount: number;
  createdAt: string; updatedAt: string;
  otherMemberName?: string | null;
  otherMemberRoleLabel?: string | null;
  otherMemberStateName?: string | null;
  otherMemberId?: number | null;
}
interface MemberInfo { id: number; name: string; role: string; roleLabel: string | null; lastSeenAt: string | null; isOnline: boolean; isAdmin: boolean }
interface ConvDetail extends ConvSummary {
  createdById: number;
  members: MemberInfo[];
}
interface Msg {
  id: number; conversationId: number; senderId: number;
  senderName: string; senderRoleLabel: string | null;
  body: string; attachments: Attachment[] | null;
  replyToId: number | null; replyBody: string | null; replySenderName: string | null;
  editedAt: string | null; deletedAt: string | null; deletionType: string | null; createdAt: string;
  isPinned: boolean; pinnedBy: number | null; pinnedAt: string | null;
  forwardedFromId: number | null;
  reactions: Reaction[];
}
interface MessagePage {
  items: Msg[];
  hasMore: boolean;
  nextCursor: string | null;
}
interface ConversationListPage {
  items: ConvSummary[];
  hasMore: boolean;
  nextCursor: string | null;
}

export function mergeConversationPages(pages: ConversationListPage[]): ConvSummary[] {
  const conversations = new Map<number, ConvSummary>();
  for (const page of pages) {
    for (const conversation of page.items) conversations.set(conversation.id, conversation);
  }
  return [...conversations.values()];
}
interface PinnedMsg { id: number; body: string; createdAt: string; pinnedAt: string; senderName: string; pinnedByName: string | null; }
interface UserItem { id: number; name: string; role: string; roleLabel: string; email: string }
interface StateItem { id: number; name: string; code: string }
interface MediaItem { type: string; url: string; name: string; size?: number; duration?: number; sentAt: string; senderName: string; messageId: number }

/**
 * Infinite-query pages arrive newest first, while each API page is already in
 * chronological display order. Reversing the pages puts older history first.
 * A Map protects the timeline from a transient overlap when a refetch races a
 * realtime insert and a cursor boundary moves between requests.
 */
export function mergeMessageHistory(pages: MessagePage[]): Msg[] {
  const messagesById = new Map<number, Msg>();
  for (const page of [...pages].reverse()) {
    for (const message of page.items) {
      messagesById.set(message.id, { ...message, reactions: message.reactions ?? [] });
    }
  }
  return [...messagesById.values()].sort((left, right) => {
    const timestampOrder = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime();
    return timestampOrder || left.id - right.id;
  });
}

/* ─── constants ─────────────────────────────────────────────────── */
const TYPE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  direct:       { label: "Direct",       icon: MessageSquare, color: "text-primary" },
  project:      { label: "Project",      icon: FolderKanban,  color: "text-info" },
  state:        { label: "State",        icon: MapPin,        color: "text-success" },
  sector:       { label: "Sector",       icon: Layers,        color: "text-warning" },
  group:        { label: "Group",        icon: Users,         color: "text-secondary" },
  system:       { label: "System",       icon: Building2,     color: "text-muted-foreground" },
  announcement: { label: "Announcement", icon: Megaphone,     color: "text-destructive" },
};
// Must match the server announcement policy: SA/ED/PM only.
const ANNOUNCEMENT_ROLES = new Set(["super_admin", "executive_director", "program_manager"]);
const EMOJI_REACTIONS = ["👍", "❤️", "😂", "👏", "🎉", "🙏"];

/* ─── helpers ────────────────────────────────────────────────────── */
function uiLocale(language: string): string {
  return language === "ar" ? "ar" : "en-GB";
}
function formatTime(iso: string, t?: (key: string) => string, language = "en") {
  const d = new Date(iso);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  const isYest = new Date(now.setDate(now.getDate() - 1)).toDateString() === d.toDateString();
  if (isToday) return d.toLocaleTimeString(uiLocale(language), { hour: "2-digit", minute: "2-digit" });
  if (isYest) return t ? t("yesterday") : "Yesterday";
  return d.toLocaleDateString(uiLocale(language), { month: "short", day: "numeric" });
}
function formatMsgTime(iso: string, language = "en") {
  return new Date(iso).toLocaleTimeString(uiLocale(language), { hour: "2-digit", minute: "2-digit" });
}
function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}
function onlineStatus(isOnline: boolean, lastSeenAt: string | null, t: (key: string, opts?: Record<string, unknown>) => string): { online: boolean; label: string } {
  if (isOnline) return { online: true, label: t("online") };
  if (!lastSeenAt) return { online: false, label: t("offline") };
  const diffMs = Date.now() - new Date(lastSeenAt).getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 60) return { online: false, label: t("lastSeenMins", { count: diffMins }) };
  if (diffMins < 1440) return { online: false, label: t("lastSeenHours", { count: Math.floor(diffMins / 60) }) };
  return { online: false, label: t("lastSeenDays", { count: Math.floor(diffMins / 1440) }) };
}
function convName(conv: ConvSummary, t?: (key: string, opts?: Record<string, unknown>) => string): string {
  if (conv.name) return conv.name;
  if (!t) {
    if (conv.type === "direct") return conv.otherMemberName ?? "Direct Message";
    if (conv.type === "project") return "Project Chat";
    if (conv.type === "state") return "State Office Chat";
    if (conv.type === "sector") return conv.sector ? `${conv.sector} Team` : "Sector Chat";
    return "Group Chat";
  }
  if (conv.type === "direct") return conv.otherMemberName ?? t("convNameDirect");
  if (conv.type === "project") return t("convNameProject");
  if (conv.type === "state") return t("convNameState");
  if (conv.type === "sector") return conv.sector ? `${conv.sector} Team` : t("convNameSector");
  return t("convNameGroup");
}
function convSubtitle(conv: ConvSummary): string | null {
  if (conv.type !== "direct") return null;
  const parts = [conv.otherMemberRoleLabel, conv.otherMemberStateName].filter(Boolean);
  return parts.join(" · ") || null;
}
function initials(name: string) {
  return name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}
const AVATAR_COLORS = [
  "bg-blue-500", "bg-violet-500", "bg-green-500", "bg-amber-500",
  "bg-pink-500", "bg-teal-500", "bg-rose-500", "bg-indigo-500",
];
function avatarColor(id: number) { return AVATAR_COLORS[id % AVATAR_COLORS.length]; }
function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "📄";
  if (["doc", "docx"].includes(ext)) return "📝";
  if (["xls", "xlsx"].includes(ext)) return "📊";
  if (["ppt", "pptx"].includes(ext)) return "📋";
  if (["zip", "rar"].includes(ext)) return "🗜️";
  if (["csv", "txt"].includes(ext)) return "📃";
  return "📎";
}

export function parseConversationRouteId(value: string | undefined): number | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

/* ─── fetch helper ───────────────────────────────────────────────── */
async function apiFetch(url: string, opts?: RequestInit) {
  // Conversation state changes frequently (messages, reads, membership). A
  // stale HTTP cache entry can otherwise survive a successful send and hide
  // the newly canonical message until an unrelated refresh.
  const res = await fetch(url, { credentials: "include", cache: "no-store", ...opts });
  if (!res.ok) { const err = await res.json().catch(() => ({})); throw new Error(err.error ?? `HTTP ${res.status}`); }
  if (res.status === 204) return null;
  return res.json();
}

/* ─── ImageLightbox ───────────────────────────────────────────────── */
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation("messages");
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center" onClick={onClose}>
      <img src={url} alt="" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()} />
      <button onClick={onClose} aria-label={t("closeLightbox")} className="absolute top-4 end-4 bg-white/10 hover:bg-white/20 rounded-full p-2 text-white transition-colors">
        <X className="h-5 w-5" />
      </button>
      <a href={url} download target="_blank" rel="noreferrer" aria-label={t("downloadAttachment", { name: "" })}
        className="absolute bottom-4 end-4 bg-white/10 hover:bg-white/20 rounded-full p-2 text-white transition-colors"
        onClick={(e) => e.stopPropagation()}>
        <DownloadCloud className="h-5 w-5" />
      </a>
    </div>
  );
}

/* ─── VoicePlayer ─────────────────────────────────────────────────── */
function VoicePlayer({ url, duration, isOwn }: { url: string; duration?: number; isOwn: boolean }) {
  const { t } = useTranslation("messages");
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(duration ?? 0);

  const toggle = () => {
    const a = audioRef.current;
    if (!a) return;
    if (playing) { a.pause(); setPlaying(false); }
    else { a.play().catch(() => {}); setPlaying(true); }
  };

  return (
    <div className={cn("flex items-center gap-2 min-w-[180px] mt-1.5 rounded-xl px-3 py-2",
      isOwn ? "bg-white/10" : "bg-accent/30")}>
      <audio ref={audioRef} src={url}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setTotalDuration(audioRef.current?.duration ?? duration ?? 0)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }} />
      <button onClick={toggle} aria-label={playing ? t("pauseVoice") : t("playVoice")}
        className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0 transition-colors",
          isOwn ? "bg-white/20 hover:bg-white/30 text-white" : "bg-primary/10 hover:bg-primary/20 text-primary")}>
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ms-0.5" />}
      </button>
      <div className="flex-1 min-w-0">
        <input type="range" min={0} max={totalDuration || 100} value={currentTime} step={0.1} aria-label={t("seekVoice")}
          onChange={(e) => { if (audioRef.current) { audioRef.current.currentTime = parseFloat(e.target.value); }}}
          className={cn("w-full h-1 cursor-pointer rounded-full appearance-none",
            isOwn ? "[&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-runnable-track]:bg-white/30" : "[&::-webkit-slider-thumb]:bg-primary [&::-webkit-slider-runnable-track]:bg-primary/20")} />
        <p className={cn("text-xs mt-0.5", isOwn ? "text-white/70" : "text-muted-foreground")}>
          {formatDuration(currentTime)} / {formatDuration(totalDuration)}
        </p>
      </div>
      <Volume2 className={cn("h-3.5 w-3.5 shrink-0", isOwn ? "text-white/60" : "text-muted-foreground")} />
    </div>
  );
}

/* ─── EmojiReactionPicker ─────────────────────────────────────────── */
function EmojiReactionPicker({ onPick, isOwn }: { onPick: (e: string) => void; isOwn: boolean }) {
  const { t } = useTranslation("messages");
  return (
    <div className={cn(
      "absolute z-20 flex gap-0.5 bg-card border border-border rounded-2xl shadow-xl p-1",
      isOwn ? "end-0" : "start-0",
    )} style={{ bottom: "calc(100% + 4px)" }}>
      {EMOJI_REACTIONS.map((e) => (
        <button key={e} onClick={() => onPick(e)} aria-label={t("reactWith", { emoji: e })}
          className="text-lg w-8 h-8 flex items-center justify-center hover:bg-muted/50 rounded-xl transition-transform hover:scale-125 active:scale-90">
          {e}
        </button>
      ))}
    </div>
  );
}

/* ─── ReactionsBar ────────────────────────────────────────────────── */
function ReactionsBar({ reactions, myId, onToggle }: {
  reactions: Reaction[]; myId: number; onToggle: (emoji: string) => void;
}) {
  const { t } = useTranslation("messages");
  const grouped = reactions.reduce<Record<string, { count: number; mine: boolean; users: string[] }>>((acc, r) => {
    if (!acc[r.emoji]) acc[r.emoji] = { count: 0, mine: false, users: [] };
    acc[r.emoji].count++;
    if (r.userId === myId) acc[r.emoji].mine = true;
    acc[r.emoji].users.push(r.userName.split(" ")[0]);
    return acc;
  }, {});

  if (!Object.keys(grouped).length) return null;
  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {Object.entries(grouped).map(([emoji, info]) => (
        <button key={emoji} onClick={() => onToggle(emoji)}
          aria-label={t("toggleReaction", { emoji, count: info.count })}
          title={info.users.join(", ")}
          className={cn(
            "flex items-center gap-0.5 text-sm px-2 py-0.5 rounded-full border transition-all hover:scale-105 active:scale-95",
            info.mine
              ? "bg-primary/10 border-primary/30 text-primary"
              : "bg-card border-border hover:bg-muted/50 text-foreground/70",
          )}>
          {emoji}<span className="text-xs font-semibold ms-0.5">{info.count}</span>
        </button>
      ))}
    </div>
  );
}

/* ─── MessageBubble ───────────────────────────────────────────────── */
// Mirrors conversations.ts's ADMIN_ROLES/isAdminRole: the same roles that can
// rename a conversation or add/remove members can also delete any message
// for everyone (and bypass the 15-minute window) — the backend already
// allows this; this constant just exposes the matching control in the UI.
const MESSAGE_MODERATION_ROLES = new Set(["super_admin", "executive_director", "program_manager", "senior_program_coordinator"]);
const BUBBLE_PIN_ROLES = new Set(["super_admin","executive_director","program_manager","senior_program_coordinator","technical_coordinator"]);

function renderMentions(text: string) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <mark key={i} className="bg-primary/10 text-primary rounded px-0.5 not-italic font-medium">{part}</mark>
      : part,
  );
}

function MessageBubble({
  msg, isOwn, showSender, isGroup, myId, myRole,
  onReply, onEdit, onDeleteForMe, onDeleteForEveryone, onReact, onForward, onLightbox, onPin,
  onScrollToMessage,
}: {
  msg: Msg; isOwn: boolean; showSender: boolean; isGroup: boolean; myId: number; myRole: string;
  onReply: (m: Msg) => void; onEdit: (m: Msg) => void;
  onDeleteForMe: (id: number) => void; onDeleteForEveryone: (id: number) => void;
  onReact: (msgId: number, emoji: string) => void;
  onForward: (m: Msg) => void;
  onLightbox: (url: string) => void;
  onPin: (id: number, shouldPin: boolean) => void;
  onScrollToMessage: (id: number) => void;
}) {
  const { t, i18n } = useTranslation("messages");
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isDeleted = !!msg.deletedAt && msg.deletionType !== "for_me";
  const withinWindow = Date.now() - new Date(msg.createdAt).getTime() < 15 * 60 * 1000;
  const canEdit = isOwn && withinWindow && !isDeleted;
  const isModerator = MESSAGE_MODERATION_ROLES.has(myRole);
  const canDeleteForEveryone = isModerator || (isOwn && withinWindow);
  const canPin = BUBBLE_PIN_ROLES.has(myRole);
  const isForwarded = !!msg.forwardedFromId;

  const images = (msg.attachments ?? []).filter((a) => a.type === "image");
  const voices = (msg.attachments ?? []).filter((a) => a.type === "voice");
  const files = (msg.attachments ?? []).filter((a) => a.type !== "image" && a.type !== "voice");
  const reactions = msg.reactions ?? [];

  const handleTouchStart = () => {
    longPressTimer.current = setTimeout(() => setMenuOpen(true), 600);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) { clearTimeout(longPressTimer.current); longPressTimer.current = null; }
  };
  const handleContextMenu = (e: React.MouseEvent) => { e.preventDefault(); setMenuOpen(true); };

  return (
    <div
      className={cn("flex items-end gap-2 group", isOwn ? "flex-row-reverse" : "flex-row")}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {!isOwn && (
        <Avatar className="h-7 w-7 shrink-0 mb-1">
          <AvatarFallback className={cn("text-xs text-white", avatarColor(msg.senderId))}>
            {initials(msg.senderName)}
          </AvatarFallback>
        </Avatar>
      )}
      <div className={cn("w-fit max-w-[min(78%,42rem)] flex flex-col", isOwn ? "items-end" : "items-start")}>
        {showSender && isGroup && !isOwn && (
          <span className="text-xs font-medium text-primary mb-0.5 px-1">{msg.senderName}</span>
        )}
        {/* Pinned indicator */}
        {msg.isPinned && (
          <div className="flex items-center gap-1 text-xs text-warning mb-0.5 px-1">
            <Pin className="h-2.5 w-2.5" /> <span>{t("pinned")}</span>
          </div>
        )}
        {/* Reply context — click to scroll to original */}
        {msg.replyToId && !isDeleted && (
          <div
            role="button"
            tabIndex={0}
            onClick={() => onScrollToMessage(msg.replyToId!)}
            onKeyDown={(e) => e.key === "Enter" && onScrollToMessage(msg.replyToId!)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-t-lg border-s-2 border-primary mb-0.5 max-w-full",
              "cursor-pointer select-none",
              isOwn
                ? "bg-primary/10 text-primary hover:bg-primary/15"
                : "bg-muted/70 text-foreground/70 hover:bg-muted",
              "transition-colors duration-150",
            )}
          >
            <p className="font-medium text-xs opacity-70">{msg.replySenderName}</p>
            <p className="truncate">{msg.replyBody}</p>
          </div>
        )}
        {/* Main bubble */}
        <div className={cn(
          "relative px-3.5 py-2.5 rounded-xl text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
          isDeleted
            ? "bg-muted/55 border border-dashed border-border text-muted-foreground italic"
            : isOwn
              ? "bg-primary text-primary-foreground rounded-ee-sm"
              : "bg-card border border-border/80 text-foreground rounded-es-sm",
        )}>
          {isDeleted ? (
            <span className="text-xs">🚫 {t("messageDeleted")}</span>
          ) : (
            <>
              {/* Forwarded label */}
              {isForwarded && (
                <div className={cn("flex items-center gap-1 text-xs mb-1 opacity-60 italic")}>
                  <Forward className="h-3 w-3 rotate-180 shrink-0" />
                  <span>{t("forwarded")}</span>
                </div>
              )}
              {/* Message text */}
              {msg.body && msg.body !== "(Voice message)" && (
                <span className="whitespace-pre-wrap">{renderMentions(msg.body)}</span>
              )}

              {/* Image attachments — inline preview grid */}
              {images.length > 0 && (
                <div className={cn("mt-1.5 grid gap-1", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                  {images.map((att, i) => att.availabilityStatus === "unavailable" ? (
                    <div key={i} role="status" className="flex min-h-24 items-center justify-center rounded-lg border border-warning/30 bg-warning/5 px-3 text-xs text-muted-foreground">{t("fileUnavailable")}</div>
                  ) : (
                    <button key={i} type="button" className="relative rounded-lg overflow-hidden cursor-pointer group/img focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                      onClick={() => onLightbox(att.url)} aria-label={t("openImage", { name: att.name })}>
                      <img src={att.url} alt={att.name}
                        className="w-full max-h-56 sm:max-h-64 object-cover rounded-lg transition-opacity group-hover/img:opacity-90" />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover/img:opacity-100 transition-opacity bg-black/20 rounded-lg">
                        <ImageIcon className="h-6 w-6 text-white drop-shadow" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Voice attachments */}
              {voices.map((att, i) => att.availabilityStatus === "unavailable" ? (
                <div key={i} role="status" className="mt-1.5 rounded-lg border border-warning/30 bg-warning/5 px-2.5 py-2 text-xs text-muted-foreground">{t("fileUnavailable")}</div>
              ) : <VoicePlayer key={i} url={att.url} duration={att.duration} isOwn={isOwn} />)}

              {/* File attachments */}
              {files.map((att, i) => att.availabilityStatus === "unavailable" ? (
                <div key={i} role="status"
                  className={cn("flex items-center gap-2 mt-1.5 px-2.5 py-2 rounded-lg text-xs", isOwn ? "bg-white/10 text-white/70" : "bg-muted/50 border border-border text-muted-foreground")}>
                  <span className="text-base shrink-0">{fileIcon(att.name)}</span><span className="truncate">{t("fileUnavailable")}</span>
                </div>
              ) : (
                <a key={i} href={att.url} target="_blank" rel="noreferrer" download aria-label={t("downloadAttachment", { name: att.name })}
                  className={cn(
                    "flex items-center gap-2 mt-1.5 px-2.5 py-2 rounded-lg text-xs no-underline transition-colors",
                    isOwn ? "bg-white/10 hover:bg-white/20" : "bg-muted/50 hover:bg-muted/70 border border-border",
                  )}>
                  <span className="text-base shrink-0">{fileIcon(att.name)}</span>
                  <div className="flex-1 min-w-0">
                    <p className={cn("truncate font-medium", isOwn ? "text-white" : "text-foreground")}>{att.name}</p>
                    {att.size && <p className={cn("text-xs", isOwn ? "text-white/60" : "text-muted-foreground")}>{formatFileSize(att.size)}</p>}
                  </div>
                  <DownloadCloud className={cn("h-3.5 w-3.5 shrink-0", isOwn ? "text-white/70" : "text-muted-foreground")} />
                </a>
              ))}
            </>
          )}
        </div>

        {/* Reactions bar */}
        {!isDeleted && reactions.length > 0 && (
          <ReactionsBar reactions={reactions} myId={myId} onToggle={(emoji) => onReact(msg.id, emoji)} />
        )}

        {/* Timestamp + status */}
        <div className="flex items-center gap-1.5 mt-0.5 px-1">
          <span className="text-xs text-muted-foreground">{formatMsgTime(msg.createdAt, i18n.language)}</span>
          {msg.editedAt && !isDeleted && <span className="text-xs text-muted-foreground italic">{t("edited")}</span>}
        </div>
      </div>

      {/* Hover actions */}
      <div className={cn(
        "opacity-100 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity flex items-center gap-0.5 mb-6 relative",
        isOwn ? "flex-row-reverse" : "",
      )}>
        {/* Emoji reaction button */}
        {!isDeleted && (
          <div className="relative">
            <Button variant="ghost" size="icon"
              aria-label={t("addReaction")}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-warning hover:bg-warning/10 rounded-full"
              onClick={() => setShowEmojiPicker((v) => !v)}>
              <Smile className="h-3.5 w-3.5" />
            </Button>
            {showEmojiPicker && (
              <EmojiReactionPicker isOwn={isOwn} onPick={(emoji) => {
                onReact(msg.id, emoji);
                setShowEmojiPicker(false);
              }} />
            )}
          </div>
        )}
        {/* More options dropdown */}
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon"
              aria-label={t("messageOptions")}
              className="h-7 w-7 shrink-0 text-muted-foreground hover:text-foreground rounded-full">
              <MoreVertical className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align={isOwn ? "end" : "start"} className="w-56">
            <DropdownMenuItem onClick={() => onReply(msg)} className="gap-2">
              <Reply className="h-3.5 w-3.5" /> {t("reply")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onForward(msg)} className="gap-2">
              <Forward className="h-3.5 w-3.5" /> {t("forward")}
            </DropdownMenuItem>
            {msg.body && !["(Voice message)", "(attachment)"].includes(msg.body) && !isDeleted && (
              <DropdownMenuItem
                onClick={() => { navigator.clipboard.writeText(msg.body).catch(() => {}); setMenuOpen(false); }}
                className="gap-2">
                <Copy className="h-3.5 w-3.5" /> {t("copyText")}
              </DropdownMenuItem>
            )}
            {canPin && !isDeleted && (
              <DropdownMenuItem onClick={() => { onPin(msg.id, !msg.isPinned); setMenuOpen(false); }} className="gap-2">
                {msg.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                {msg.isPinned ? t("unpin") : t("pinMessage")}
              </DropdownMenuItem>
            )}
            {isOwn && !isDeleted && (
              <DropdownMenuItem
                onClick={() => { if (canEdit) { onEdit(msg); setMenuOpen(false); } }}
                disabled={!canEdit}
                className="gap-2">
                <Edit2 className="h-3.5 w-3.5" />
                {canEdit ? t("edit") : t("editExpired")}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => { onDeleteForMe(msg.id); setMenuOpen(false); }}
              className="gap-2 text-destructive focus:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> {t("deleteForMe")}
            </DropdownMenuItem>
            {(isOwn || isModerator) && (
              <DropdownMenuItem
                onClick={() => { if (canDeleteForEveryone) { onDeleteForEveryone(msg.id); setMenuOpen(false); } }}
                disabled={!canDeleteForEveryone}
                className={cn("gap-2", canDeleteForEveryone ? "text-destructive focus:text-destructive" : "opacity-50")}>
                <Trash2 className="h-3.5 w-3.5" />
                {canDeleteForEveryone ? t("deleteForEveryone") : t("deleteForEveryoneExpired")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

/* ─── MediaGalleryPanel ───────────────────────────────────────────── */
function MediaGalleryPanel({ convId, onClose, onLightbox }: {
  convId: number; onClose: () => void; onLightbox: (url: string) => void;
}) {
  const { t, i18n } = useTranslation("messages");
  const [tab, setTab] = useState<"photos" | "docs" | "voices">("photos");
  const tabKeys = ["photos", "docs", "voices"] as const;
  const tabRefs = useRef<Partial<Record<(typeof tabKeys)[number], HTMLButtonElement>>>({});
  const { data, isLoading, isError, refetch } = useQuery<{ photos: MediaItem[]; docs: MediaItem[]; voices: MediaItem[] }>({
    queryKey: ["media", convId],
    queryFn: () => apiFetch(`/api/conversations/${convId}/media`),
  });
  const photos = data?.photos ?? [];
  const docs = data?.docs ?? [];
  const voices = data?.voices ?? [];
  const tabLabel = (tabKey: (typeof tabKeys)[number]) =>
    tabKey === "photos" ? t("tabPhotos") : tabKey === "docs" ? t("tabDocs") : t("tabVoice");
  const moveTab = (current: number, direction: -1 | 1) => {
    const nextTab = tabKeys[(current + direction + tabKeys.length) % tabKeys.length];
    setTab(nextTab);
    requestAnimationFrame(() => tabRefs.current[nextTab]?.focus());
  };

  return (
    <div className="absolute inset-y-0 end-0 z-30 w-full max-w-sm bg-card border-s border-border shadow-xl flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <GalleryHorizontal className="h-4 w-4 text-primary" />
          <span className="font-medium text-sm text-foreground">{t("mediaGallery")}</span>
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label={t("closeMediaGallery")}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      {/* Tabs */}
      <div className="flex border-b border-border px-2 pt-1" role="tablist" aria-label={t("mediaGallery")}>
        {tabKeys.map((tabKey, index) => (
          <button key={tabKey} id={`media-tab-${tabKey}`} onClick={() => setTab(tabKey)}
            type="button"
            role="tab"
            aria-selected={tab === tabKey}
            aria-controls={`media-tabpanel-${tabKey}`}
            tabIndex={tab === tabKey ? 0 : -1}
            ref={(element) => { tabRefs.current[tabKey] = element ?? undefined; }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveTab(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveTab(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                setTab(tabKeys[0]);
                requestAnimationFrame(() => tabRefs.current.photos?.focus());
              } else if (event.key === "End") {
                event.preventDefault();
                setTab(tabKeys[tabKeys.length - 1]);
                requestAnimationFrame(() => tabRefs.current.voices?.focus());
              }
            }}
            className={cn(
              "flex-1 min-w-0 pb-2 text-xs font-medium capitalize transition-colors border-b-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
              tab === tabKey ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
            )}>
            {tabKey === "photos" ? `📷 ${tabLabel(tabKey)} (${photos.length})` : tabKey === "docs" ? `📄 ${tabLabel(tabKey)} (${docs.length})` : `🎙 ${tabLabel(tabKey)} (${voices.length})`}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3">
        <div
          role="tabpanel"
          id={`media-tabpanel-${tab}`}
          aria-labelledby={`media-tab-${tab}`}
          tabIndex={0}
          className="min-h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
        >
        {isLoading && (
          <div className="flex items-center justify-center min-h-32 text-muted-foreground text-sm" role="status">{t("loading")}</div>
        )}
        {isError && (
          <div className="flex flex-col items-center justify-center min-h-32 gap-2 text-center">
            <p className="text-sm text-muted-foreground">{t("errLoadMedia")}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetch()}>{t("retry")}</Button>
          </div>
        )}
        {!isLoading && !isError && tab === "photos" && (
          <div className="grid grid-cols-3 gap-1">
            {photos.length === 0 && !isLoading && (
              <p className="col-span-3 text-center text-xs text-muted-foreground py-8">{t("noPhotos")}</p>
            )}
            {photos.map((p, i) => (
              <button key={i} type="button" className="aspect-square rounded-lg overflow-hidden cursor-pointer hover:opacity-90 transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                onClick={() => onLightbox(p.url)} aria-label={t("openImage", { name: p.name })}>
                <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}
        {!isLoading && !isError && tab === "docs" && (
          <div className="space-y-1.5">
            {docs.length === 0 && !isLoading && (
              <p className="text-center text-xs text-muted-foreground py-8">{t("noDocs")}</p>
            )}
            {docs.map((d, i) => (
              <a key={i} href={d.url} target="_blank" rel="noreferrer" download aria-label={t("downloadAttachment", { name: d.name })}
                className="flex items-center gap-2.5 p-2.5 rounded-lg border border-border hover:bg-muted/50 transition-colors no-underline">
                <span className="text-xl shrink-0">{fileIcon(d.name)}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground truncate">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.size ? formatFileSize(d.size) + " · " : ""}{d.senderName.split(" ")[0]}
                  </p>
                </div>
                <DownloadCloud className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </a>
            ))}
          </div>
        )}
        {!isLoading && !isError && tab === "voices" && (
          <div className="space-y-2">
            {voices.length === 0 && !isLoading && (
              <p className="text-center text-xs text-muted-foreground py-8">{t("noVoice")}</p>
            )}
            {voices.map((v, i) => (
              <div key={i} className="p-2.5 rounded-lg border border-border bg-muted/40">
                <p className="text-xs text-muted-foreground mb-1.5">
                    {v.senderName.split(" ")[0]} · {new Date(v.sentAt).toLocaleDateString(uiLocale(i18n.language), { month: "short", day: "numeric" })}
                </p>
                <VoicePlayer url={v.url} duration={v.duration} isOwn={false} />
              </div>
            ))}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}

/* ─── ConversationItem ────────────────────────────────────────────── */
function ConversationItem({ conv, selected, onClick }: { conv: ConvSummary; selected: boolean; onClick: () => void }) {
  const { t, i18n } = useTranslation("messages");
  const meta = TYPE_META[conv.type] ?? TYPE_META.group;
  const Icon = meta.icon;
  const name = convName(conv, t);
  const subtitle = convSubtitle(conv);
  const isDirect = conv.type === "direct";
  const avatarId = isDirect && conv.otherMemberId ? conv.otherMemberId : conv.id;
  const hasUnread = typeof conv.unreadCount === "number" && conv.unreadCount > 0;
  const unreadLabel = hasUnread ? (conv.unreadCount! > 99 ? "99+" : conv.unreadCount) : null;
  return (
    <button onClick={onClick} type="button" title={name} aria-current={selected ? "page" : undefined}
      className={cn(
        "w-full flex items-center gap-3 px-3.5 py-2.5 text-start transition-colors border-e-2 border-transparent hover:bg-muted/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
        selected && "bg-primary/5 hover:bg-primary/5 border-primary",
      )}>
      <div className={cn("shrink-0 h-9 w-9 rounded-full flex items-center justify-center", avatarColor(avatarId))}>
        {isDirect && conv.otherMemberName
          ? <span className="text-xs font-medium text-white">{initials(conv.otherMemberName)}</span>
          : <Icon className="h-4 w-4 text-white" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className={cn("text-sm font-medium truncate", selected ? "text-foreground" : "text-foreground/90")}>{name}</span>
            {conv.type === "announcement" && (
              <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">
                {t("broadcast")}
              </span>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground shrink-0 ms-1 tabular-nums">
            {conv.lastMessageAt ? formatTime(conv.lastMessageAt, t, i18n.language) : ""}
          </span>
        </div>
        {isDirect && subtitle ? (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{subtitle}</p>
        ) : (
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-xs text-muted-foreground truncate flex-1">
              {conv.lastMessageBody
                ? (conv.lastMessageSenderName && !isDirect
                    ? `${conv.lastMessageSenderName.split(" ")[0]}: ${conv.lastMessageBody}`
                    : conv.lastMessageBody)
                : <span className="italic">{t("noMessages")}</span>}
            </p>
            {hasUnread && (
              <span className="ms-1 shrink-0 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-medium" aria-label={`${unreadLabel} ${t("tabUnread")}`}>
                {unreadLabel}
              </span>
            )}
          </div>
        )}
        {isDirect && subtitle && (
          <div className="flex items-center justify-between mt-0.5">
            <p className="text-xs text-muted-foreground/70 truncate flex-1">
              {conv.lastMessageBody ?? <span className="italic">{t("noMessages")}</span>}
            </p>
            {hasUnread && (
              <span className="ms-1 shrink-0 h-5 min-w-5 px-1 flex items-center justify-center rounded-full bg-primary text-primary-foreground text-[11px] font-medium" aria-label={`${unreadLabel} ${t("tabUnread")}`}>
                {unreadLabel}
              </span>
            )}
          </div>
        )}
      </div>
    </button>
  );
}

/* ─── DateDivider ─────────────────────────────────────────────────── */
function DateDivider({ dateStr }: { dateStr: string }) {
  const { t, i18n } = useTranslation("messages");
  const d = new Date(dateStr);
  const now = new Date();
  let label: string;
  if (d.toDateString() === now.toDateString()) label = t("today");
  else if (d.toDateString() === new Date(now.setDate(now.getDate() - 1)).toDateString()) label = t("yesterday");
  else label = d.toLocaleDateString(uiLocale(i18n.language), { weekday: "long", month: "long", day: "numeric" });
  return (
    <div className="flex items-center gap-3 my-3">
      <div className="flex-1 h-px bg-border" />
      <span className="text-xs font-medium text-muted-foreground bg-muted/50 px-2 py-0.5 rounded-full whitespace-nowrap">{label}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}

/* ─── NewConversationModal ────────────────────────────────────────── */
function NewConversationModal({
  open, onClose, onCreate, userRole,
}: {
  open: boolean; onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
  userRole: string;
}) {
  const { t } = useTranslation("messages");
  const [type, setType] = useState<string>("direct");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUsers, setSelectedUsers] = useState<UserItem[]>([]);
  const [selectedSector, setSelectedSector] = useState<string>("");
  const [selectedStateId, setSelectedStateId] = useState<string>("");
  const [announcementTarget, setAnnouncementTarget] = useState<"all" | "state" | "sector" | "role">("all");
  const [announcementRole, setAnnouncementRole] = useState<string>("");
  const [confirmStep, setConfirmStep] = useState(false);
  const [busy, setBusy] = useState(false);

  const canAnnounce = ANNOUNCEMENT_ROLES.has(userRole);

  const { data: usersData } = useQuery<UserItem[]>({
    queryKey: ["users-for-messaging", userSearch],
    queryFn: () => apiFetch(`/api/users/for-messaging?search=${encodeURIComponent(userSearch)}&limit=30`),
    enabled: open,
  });
  const { data: statesData } = useQuery<StateItem[]>({
    queryKey: ["states-list"],
    queryFn: () => apiFetch(`/api/states`),
    enabled: open && (type === "state" || (type === "announcement" && announcementTarget === "state")),
  });
  const users = Array.isArray(usersData) ? usersData : [];
  const states = Array.isArray(statesData) ? statesData : [];
  const filteredUsers = users.filter(
    (u) => !selectedUsers.find((s) => s.id === u.id) &&
      (u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
       u.email.toLowerCase().includes(userSearch.toLowerCase())),
  );

  const reset = () => {
    setType("direct"); setName(""); setDescription(""); setSelectedUsers([]); setUserSearch("");
    setSelectedSector(""); setSelectedStateId("");
    setAnnouncementTarget("all"); setAnnouncementRole(""); setConfirmStep(false);
  };

  const buildPayload = (): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      type, name: name || undefined,
      memberIds: selectedUsers.map((u) => u.id),
    };
    if (description) base.description = description;
    if (type === "sector") base.sector = selectedSector;
    if (type === "state") base.stateId = selectedStateId ? parseInt(selectedStateId) : undefined;
    if (type === "announcement") {
      if (announcementTarget === "all") base.targetAll = true;
      if (announcementTarget === "state") base.targetStateId = selectedStateId ? parseInt(selectedStateId) : undefined;
      if (announcementTarget === "sector") base.targetSector = selectedSector;
      if (announcementTarget === "role") base.targetRole = announcementRole;
    }
    return base;
  };

  const handleNext = () => {
    if (type === "direct" && selectedUsers.length !== 1) { toast.error(t("errSelectOneUser")); return; }
    if (["group", "project"].includes(type) && !name.trim()) { toast.error(t("errNameRequired")); return; }
    if (type === "sector" && !selectedSector) { toast.error(t("errSelectSector")); return; }
    if (type === "state" && !selectedStateId) { toast.error(t("errSelectState")); return; }
    if (type === "announcement") {
      if (!name.trim()) { toast.error(t("errSubjectRequired")); return; }
      if (announcementTarget === "state" && !selectedStateId) { toast.error(t("errSelectState")); return; }
      if (announcementTarget === "sector" && !selectedSector) { toast.error(t("errSelectSector")); return; }
      if (announcementTarget === "role" && !announcementRole) { toast.error(t("errSelectRole")); return; }
      setConfirmStep(true); return;
    }
    handleSubmit();
  };

  const handleSubmit = async () => {
    setBusy(true);
    try { await onCreate(buildPayload()); onClose(); reset(); }
    catch (e: unknown) { toast.error((e as Error).message ?? t("errFailed")); }
    finally { setBusy(false); }
  };

  const createTCGroup = () => {
    setType("group");
    setName(t("tcGroupName"));
    setDescription(t("tcGroupDescription"));
  };

  const availableTypes: string[] = ["direct", "group", "project", "state", "sector"];
  if (canAnnounce) availableTypes.push("announcement");

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { onClose(); reset(); } }}>
      <DialogContent className="w-[calc(100%-1.5rem)] sm:max-w-md max-h-[min(90vh,42rem)] flex flex-col gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
          <DialogTitle className="text-base font-medium">{confirmStep ? t("confirmAnnouncement") : t("newConversation")}</DialogTitle>
          <DialogDescription className="sr-only">
            {confirmStep ? t("confirmAnnouncementDescription") : t("newConversationDescription")}
          </DialogDescription>
        </DialogHeader>

        {confirmStep ? (
          <div className="space-y-4 px-5 py-2 overflow-y-auto min-h-0">
            <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Megaphone className="h-4 w-4 text-destructive shrink-0" />
                <p className="font-medium text-destructive text-sm">{t("broadcastAnnouncement")}</p>
              </div>
              <p className="text-sm text-foreground font-medium mb-1">{name}</p>
              <p className="text-xs text-muted-foreground">
                {t("recipients")}:{" "}
                {announcementTarget === "all" && t("allActiveUsers")}
                {announcementTarget === "state" && `${t("stateLabel")}: ${states.find(s => String(s.id) === selectedStateId)?.name ?? selectedStateId}`}
                {announcementTarget === "sector" && `${t("sectorLabel")}: ${selectedSector}`}
                {announcementTarget === "role" && `${t("roleLabel")}: ${t(`role_${announcementRole}`)}`}
              </p>
              <p className="text-xs text-destructive mt-3 font-medium flex items-start gap-1.5">
                <span aria-hidden="true">⚠</span><span>{t("announcementWarning")}</span>
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-5 py-2 overflow-y-auto flex-1 min-h-0">
            {/* Quick actions */}
            {(userRole === "super_admin" || userRole === "program_manager" || userRole === "executive_director") && (
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("quickCreate")}</label>
                <button onClick={createTCGroup}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border hover:bg-muted/50 text-sm transition-colors text-start">
                  <Users className="h-4 w-4 text-info shrink-0" />
                  <span className="font-medium text-foreground">{t("tcGroupName")}</span>
                  <span className="ms-auto text-xs text-muted-foreground">{t("autoFill")}</span>
                </button>
              </div>
            )}

            {/* Type selector */}
            <div>
              <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("typeLabel")}</label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("typeLabel")}>
                {availableTypes.map((typeKey) => {
                  const M = TYPE_META[typeKey];
                  const Icon = M.icon;
                  return (
                    <button key={typeKey} onClick={() => { setType(typeKey); setSelectedSector(""); setSelectedStateId(""); }}
                      aria-pressed={type === typeKey}
                      className={cn(
                        "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        type === typeKey
                          ? typeKey === "announcement" ? "bg-destructive text-destructive-foreground border-destructive" : "bg-primary text-primary-foreground border-primary"
                          : typeKey === "announcement" ? "border-destructive/30 text-destructive hover:bg-destructive/10" : "border-border hover:bg-muted/50",
                      )}>
                      <Icon className="h-3 w-3" />{t(`type_${typeKey}`)}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Announcement */}
            {type === "announcement" ? (
              <div className="space-y-3">
                <div>
                  <label htmlFor="announcement-subject" className="text-xs font-medium text-muted-foreground mb-1 block">{t("subjectLabel")}</label>
                  <input id="announcement-subject" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("announcementSubjectPlaceholder")}
                    className="w-full h-9 px-3 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-destructive/30" />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground mb-2 block">{t("recipients")}</label>
                  <div className="flex flex-wrap gap-2">
                    {(["all", "state", "sector", "role"] as const).map((target) => (
                      <button key={target} onClick={() => setAnnouncementTarget(target)}
                        aria-pressed={announcementTarget === target}
                        className={cn(
                          "px-3 py-1 rounded-full text-xs border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                          announcementTarget === target ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted/50",
                        )}>
                        {target === "all" ? t("allUsers") : target === "state" ? t("byState") : target === "sector" ? t("bySector") : t("byRole")}
                      </button>
                    ))}
                  </div>
                  {announcementTarget === "state" && (
                    <Select value={selectedStateId} onValueChange={setSelectedStateId}>
                      <SelectTrigger aria-label={t("stateLabel")} className="mt-2 h-9 text-sm border-border"><SelectValue placeholder={t("selectStatePlaceholder")} /></SelectTrigger>
                      <SelectContent>{states.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {announcementTarget === "sector" && (
                    <Select value={selectedSector} onValueChange={setSelectedSector}>
                      <SelectTrigger aria-label={t("sectorLabel")} className="mt-2 h-9 text-sm border-border"><SelectValue placeholder={t("selectSectorPlaceholder")} /></SelectTrigger>
                      <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  )}
                  {announcementTarget === "role" && (
                    <Select value={announcementRole} onValueChange={setAnnouncementRole}>
                      <SelectTrigger aria-label={t("roleLabel")} className="mt-2 h-9 text-sm border-border"><SelectValue placeholder={t("selectRolePlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        {["super_admin","executive_director","program_manager","senior_program_coordinator","technical_coordinator","state_office_manager","state_program_officer"].map((r) => (
                          <SelectItem key={r} value={r}>{t(`role_${r}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>
              </div>
            ) : (
              <>
                {/* Name */}
                {type !== "direct" && type !== "state" && type !== "sector" && (
                  <div>
                    <label htmlFor="conversation-name" className="text-xs font-medium text-muted-foreground mb-1 block">{t("nameLabel")}</label>
                    <input id="conversation-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("conversationNamePlaceholder")}
                      className="w-full h-9 px-3 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                )}
                {/* Description for groups */}
                {type === "group" && (
                  <div>
                    <label htmlFor="conversation-description" className="text-xs font-medium text-muted-foreground mb-1 block">{t("descriptionLabel")}</label>
                    <input id="conversation-description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")}
                      className="w-full h-9 px-3 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
                  </div>
                )}
                {/* State */}
                {type === "state" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("stateLabelRequired")}</label>
                    <Select value={selectedStateId} onValueChange={setSelectedStateId}>
                      <SelectTrigger aria-label={t("stateLabelRequired")} className="h-9 text-sm border-border"><SelectValue placeholder={t("selectStatePlaceholder")} /></SelectTrigger>
                      <SelectContent>{states.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {/* Sector */}
                {type === "sector" && (
                  <div>
                    <label className="text-xs font-medium text-muted-foreground mb-1 block">{t("sectorLabelRequired")}</label>
                    <Select value={selectedSector} onValueChange={setSelectedSector}>
                      <SelectTrigger aria-label={t("sectorLabelRequired")} className="h-9 text-sm border-border"><SelectValue placeholder={t("selectSectorPlaceholder")} /></SelectTrigger>
                      <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                {/* Member search */}
                {(type === "direct" || type === "group" || type === "project") && (
                  <div>
                    <label htmlFor="conversation-member-search" className="text-xs font-medium text-muted-foreground mb-1 block">
                      {type === "direct" ? t("selectUserLabel") : t("addMembersLabel")}
                    </label>
                    {selectedUsers.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-2" aria-label={t("selectedMembers")}>
                        {selectedUsers.map((u) => (
                          <span key={u.id} className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full max-w-full">
                            <span className="truncate" title={u.name}>{u.name}</span>
                            <button type="button" aria-label={t("removeMember", { name: u.name })} onClick={() => setSelectedUsers((s) => s.filter((x) => x.id !== u.id))}
                              className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                              <X className="h-2.5 w-2.5" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="relative">
                      <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                      <input id="conversation-member-search" value={userSearch} onChange={(e) => setUserSearch(e.target.value)}
                        placeholder={t("searchUserPlaceholder")}
                        className="w-full h-9 ps-9 pe-3 text-sm rounded-lg border border-border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" />
                    </div>
                    {filteredUsers.length > 0 && (
                      <div className="mt-1 border border-border rounded-lg max-h-40 overflow-y-auto" role="listbox" aria-label={t("memberResults")}>
                        {filteredUsers.slice(0, 8).map((u) => (
                          <button key={u.id}
                            type="button"
                            role="option"
                            aria-label={`${u.name}, ${u.roleLabel}`}
                            onClick={() => {
                              setSelectedUsers((s) => type === "direct" ? [u] : [...s, u]);
                              setUserSearch("");
                            }}
                            className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary">
                            <Avatar className="h-6 w-6 shrink-0">
                              <AvatarFallback className={cn("text-[9px] text-white", avatarColor(u.id))}>{initials(u.name)}</AvatarFallback>
                            </Avatar>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm font-medium truncate">{u.name}</p>
                              <p className="text-xs text-muted-foreground truncate">{u.roleLabel}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <DialogFooter className="px-5 py-4 border-t border-border/70 shrink-0">
          {confirmStep ? (
            <>
              <Button variant="outline" onClick={() => setConfirmStep(false)} disabled={busy}>{t("back")}</Button>
              <Button onClick={handleSubmit} disabled={busy} variant="destructive">
                {busy ? t("sending") : t("sendAnnouncement")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => { onClose(); reset(); }} disabled={busy}>{t("cancel")}</Button>
              <Button onClick={handleNext} disabled={busy}
                className={type === "announcement" ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""}>
                {busy ? t("creating") : type === "announcement" ? t("previewArrow") : t("startConversation")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── ForwardDialog ────────────────────────────────────────────────── */
function ForwardDialog({
  msg, conversations, onClose, onForward,
}: {
  msg: Msg; conversations: ConvSummary[]; onClose: () => void;
  onForward: (convId: number) => void;
}) {
  const { t } = useTranslation("messages");
  const [search, setSearch] = useState("");
  const filtered = conversations.filter((c) => {
    const n = convName(c, t).toLowerCase();
    return n.includes(search.toLowerCase());
  });
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Forward className="h-4 w-4" /> {t("forwardMessage")}</DialogTitle>
          <DialogDescription className="sr-only">{t("forwardMessageDescription")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="rounded-lg bg-muted/40 border border-border p-3 text-sm text-muted-foreground italic truncate">
            "{msg.body.slice(0, 100)}{msg.body.length > 100 ? "…" : ""}"
          </div>
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input id="forward-conversation-search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label={t("searchConversations")} placeholder={t("searchConversations")}
              className="w-full h-9 ps-9 pe-3 text-sm rounded-lg border border-border focus:outline-none focus:ring-2 focus:ring-primary/30" />
          </div>
          <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
            {filtered.map((c) => (
              <button key={c.id} onClick={() => onForward(c.id)}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/50 text-start transition-colors">
                <div className={cn("h-8 w-8 rounded-full flex items-center justify-center shrink-0",
                  avatarColor(c.type === "direct" && c.otherMemberId ? c.otherMemberId : c.id))}>
                  {c.type === "direct" && c.otherMemberName
                    ? <span className="text-xs font-bold text-white">{initials(c.otherMemberName)}</span>
                    : (() => { const M = TYPE_META[c.type] ?? TYPE_META.group; const Icon = M.icon; return <Icon className="h-3.5 w-3.5 text-white" />; })()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{convName(c, t)}</p>
                  {c.memberCount > 0 && <p className="text-xs text-muted-foreground">{c.memberCount} {t("membersCount")}</p>}
                </div>
              </button>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t("cancel")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ─── Main MessagesPage ───────────────────────────────────────────── */
export default function Messages() {
  const { t, i18n } = useTranslation("messages");
  const params = useParams<{ conversationId?: string }>();
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { data: meData } = useGetMe();
  const { socket } = useSocket();
  const myId = meData?.user?.id ?? 0;
  const myRole = meData?.user?.role ?? "";
  const canUploadAttachments = canUploadMessageAttachments(meData?.permissions);
  const { isOnline } = useSyncContext();
  const requireAttachmentConnection = useCallback(() => {
    if (isOnline) return true;
    toast.error(t("attachmentOnlineRequired"));
    return false;
  }, [isOnline, t]);

  const selectedId = parseConversationRouteId(params.conversationId);
  const selectedIdRef = useRef(selectedId);
  useEffect(() => { selectedIdRef.current = selectedId; }, [selectedId]);

  /* ── state ─────────────────────────────────────────────────────── */
  const [searchQ, setSearchQ] = useState("");
  const [filterTab, setFilterTab] = useState<string>("all");
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [replyTo, setReplyTo] = useState<Msg | null>(null);
  const [editingMsg, setEditingMsg] = useState<Msg | null>(null);
  const [editBody, setEditBody] = useState("");

  const scrollToMessage = useCallback((id: number) => {
    const el = document.querySelector(`[data-msg-id="${id}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "background-color 0.2s ease";
    el.style.backgroundColor = "rgba(26, 58, 92, 0.12)";
    el.style.borderRadius = "12px";
    setTimeout(() => {
      el.style.backgroundColor = "";
      setTimeout(() => { el.style.transition = ""; el.style.borderRadius = ""; }, 300);
    }, 1200);
  }, []);
  const [inputText, setInputText] = useState("");
  const [pendingFiles, setPendingFiles] = useState<Attachment[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [typingUsers, setTypingUsers] = useState<string[]>([]);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [forwardMsg, setForwardMsg] = useState<Msg | null>(null);
  /* emoji input picker */
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const emojiPickerRef = useRef<HTMLDivElement>(null);
  /* @mentions typeahead — tracks partial query string and accumulated selected user IDs */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0);
  const [mentionedUserIds, setMentionedUserIds] = useState<number[]>([]);
  /* pinned messages panel */
  const [pinnedOpen, setPinnedOpen] = useState(false);
  /* voice recorder */
  const [voiceState, setVoiceState] = useState<"idle" | "recording" | "preview">("idle");
  const [voiceBlob, setVoiceBlob] = useState<Blob | null>(null);
  const [voiceDuration, setVoiceDuration] = useState(0);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const recordingSecondsRef = useRef(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* image pending preview */
  const [pendingImagePreviews, setPendingImagePreviews] = useState<string[]>([]);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const initiallyScrolledConversationRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  /* Keep per-conversation draft UI from leaking into the next route. */
  useEffect(() => {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    setTypingUsers([]);
    setReplyTo(null);
    setEditingMsg(null);
    setEditBody("");
    setMentionQuery(null);
    setMentionedUserIds([]);
    setPinnedOpen(false);
    setGalleryOpen(false);
    setLightboxUrl(null);
  }, [selectedId]);

  /* ── Communication realtime events — one app-level socket only ── */
  useEffect(() => {
    if (!socket || !myId) return;
    const isCurrentConversation = (conversationId: unknown): conversationId is number =>
      Number.isSafeInteger(conversationId) &&
      conversationId === selectedIdRef.current;
    const refreshConversation = (conversationId: number) => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["conversations-unread"] });
      if (isCurrentConversation(conversationId)) {
        void qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
        void qc.invalidateQueries({ queryKey: ["messages", conversationId] });
        void qc.invalidateQueries({ queryKey: ["pinned", conversationId] });
      }
    };
    const onMessage = (event: { conversationId?: unknown }) => {
      const conversationId = event.conversationId;
      if (!isPositiveInteger(conversationId)) return;
      refreshConversation(conversationId);
    };
    const onConversationChanged = (event: { conversationId?: unknown }) => {
      if (!isPositiveInteger(event.conversationId)) return;
      refreshConversation(event.conversationId);
    };
    const onConversationUpdated = (event: { convId?: unknown }) => {
      if (!isPositiveInteger(event.convId)) return;
      refreshConversation(event.convId);
    };
    const onPersonalConversationUpdate = (event: { conversationId?: unknown }) => {
      if (!isPositiveInteger(event.conversationId)) return;
      refreshConversation(event.conversationId);
    };
    const onConversationPresence = (event: {
      conversationId?: unknown;
      userId?: unknown;
      isOnline?: unknown;
      lastSeenAt?: unknown;
    }) => {
      if (!isCurrentConversation(event.conversationId)) return;
      const userId = event.userId;
      const isOnline = event.isOnline;
      if (!Number.isSafeInteger(userId) || typeof isOnline !== "boolean") return;
      const lastSeenAt = typeof event.lastSeenAt === "string" ? event.lastSeenAt : null;
      qc.setQueryData<ConvDetail>(["conversation", event.conversationId], (conversation) => conversation
        ? {
            ...conversation,
            members: conversation.members.map((member) => member.id === userId
              ? {
                  ...member,
                  isOnline,
                  lastSeenAt: isOnline ? member.lastSeenAt : lastSeenAt,
                }
              : member),
          }
        : conversation);
    };
    const onTyping = (data: {
      conversationId?: unknown; actorId?: unknown; actorName?: unknown; isTyping?: unknown;
    }) => {
      if (!isPositiveInteger(data.conversationId) || data.conversationId !== selectedIdRef.current) return;
      if (!isPositiveInteger(data.actorId) || data.actorId === myId || typeof data.actorName !== "string") return;
      if (typeof data.isTyping !== "boolean") return;
      const actorName = data.actorName;
      setTypingUsers((prev) =>
        data.isTyping
          ? (prev.includes(actorName) ? prev : [...prev, actorName])
          : prev.filter((name) => name !== actorName),
      );
    };
    const onAccessChange = (event: { conversationId?: unknown; allowed?: unknown }) => {
      if (event.allowed !== false || !Number.isSafeInteger(event.conversationId)) return;
      const conversationId = event.conversationId;
      if (conversationId !== selectedIdRef.current) return;
      setTypingUsers([]);
      qc.removeQueries({ queryKey: ["conversation", conversationId] });
      qc.removeQueries({ queryKey: ["messages", conversationId] });
      qc.removeQueries({ queryKey: ["pinned", conversationId] });
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      void qc.invalidateQueries({ queryKey: ["conversations-unread"] });
      navigate("/messages");
    };
    const onConnect = () => {
      void qc.invalidateQueries({ queryKey: ["conversations"] });
      const conversationId = selectedIdRef.current;
      if (conversationId) {
        void qc.invalidateQueries({ queryKey: ["conversation", conversationId] });
        void qc.invalidateQueries({ queryKey: ["messages", conversationId] });
        void qc.invalidateQueries({ queryKey: ["pinned", conversationId] });
      }
    };

    socket.on("message:new", onMessage);
    socket.on("conversation:changed", onConversationChanged);
    socket.on("conversation:updated", onConversationUpdated);
    socket.on("conversation:personal", onPersonalConversationUpdate);
    socket.on("conversation:presence", onConversationPresence);
    socket.on("user:typing", onTyping);
    socket.on("conversation:access", onAccessChange);
    socket.on("connect", onConnect);

    return () => {
      socket.off("message:new", onMessage);
      socket.off("conversation:changed", onConversationChanged);
      socket.off("conversation:updated", onConversationUpdated);
      socket.off("conversation:personal", onPersonalConversationUpdate);
      socket.off("conversation:presence", onConversationPresence);
      socket.off("user:typing", onTyping);
      socket.off("conversation:access", onAccessChange);
      socket.off("connect", onConnect);
    };
  }, [myId, navigate, qc, socket]);

  /* Join exactly the selected conversation. Socket.IO invokes connect again
     after a reconnect, so this also re-establishes access before refetching. */
  useEffect(() => {
    if (!socket || !selectedId) return;
    let live = true;
    const join = () => {
      socket.emit(
        "conversation:join",
        { conversationId: selectedId },
        (result: { ok?: boolean }) => {
          if (!live || result.ok) return;
          setTypingUsers([]);
          qc.removeQueries({ queryKey: ["conversation", selectedId] });
          qc.removeQueries({ queryKey: ["messages", selectedId] });
          qc.removeQueries({ queryKey: ["pinned", selectedId] });
          void qc.invalidateQueries({ queryKey: ["conversations"] });
          void qc.invalidateQueries({ queryKey: ["conversations-unread"] });
          navigate("/messages");
        },
      );
    };
    socket.on("connect", join);
    if (socket.connected) join();
    return () => {
      live = false;
      socket.off("connect", join);
      socket.emit("user:typing", { conversationId: selectedId, isTyping: false });
      socket.emit("conversation:leave", { conversationId: selectedId });
    };
  }, [navigate, qc, selectedId, socket]);

  /* ── conversations list ─────────────────────────────────────── */
  const conversationQuery = useMemo(() => {
    const params = new URLSearchParams({ limit: "50" });
    if (filterTab !== "all" && filterTab !== "unread") params.set("type", filterTab);
    if (filterTab === "unread") params.set("unread", "true");
    if (searchQ.trim()) params.set("search", searchQ.trim());
    return params;
  }, [filterTab, searchQ]);

  const {
    data: conversationPages,
    isLoading: convsLoading,
    isError: convsError,
    refetch: refetchConvs,
    fetchNextPage: fetchMoreConversations,
    hasNextPage: hasMoreConversations,
    isFetchingNextPage: isFetchingMoreConversations,
    isFetchNextPageError: moreConversationsError,
  } = useInfiniteQuery<ConversationListPage>({
    queryKey: ["conversations", filterTab, searchQ],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams(conversationQuery);
      if (typeof pageParam === "string") params.set("cursor", pageParam);
      return apiFetch(`/api/conversations?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    refetchInterval: 30_000,
    staleTime: 5_000,
  });
  const convList = useMemo(
    () => mergeConversationPages(conversationPages?.pages ?? []),
    [conversationPages?.pages],
  );
  const handleFetchMoreConversations = useCallback(() => {
    void fetchMoreConversations();
  }, [fetchMoreConversations]);
  const { data: unreadData } = useQuery<{ total: number }>({
    queryKey: ["conversations-unread"],
    queryFn: () => apiFetch("/api/conversations/unread-count"),
    refetchInterval: 30_000,
    staleTime: 5_000,
  });

  const { data: convDetail } = useQuery<ConvDetail>({
    queryKey: ["conversation", selectedId],
    queryFn: () => apiFetch(`/api/conversations/${selectedId}`),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  const {
    data: messageHistory,
    isLoading: msgsLoading,
    isError: msgsError,
    refetch: refetchMsgs,
    fetchNextPage: fetchOlderMessages,
    hasNextPage: hasOlderMessages,
    isFetchingNextPage: isFetchingOlderMessages,
  } = useInfiniteQuery<MessagePage>({
    queryKey: ["messages", selectedId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "80" });
      if (typeof pageParam === "string") params.set("cursor", pageParam);
      return apiFetch(`/api/conversations/${selectedId}/messages?${params}`);
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    enabled: !!selectedId,
    refetchInterval: 15_000,
    staleTime: 10_000,
  });
  const messages = useMemo(
    () => mergeMessageHistory(messageHistory?.pages ?? []),
    [messageHistory?.pages],
  );

  /* mark read when conv opens — skip when offline (not worth queuing) */
  useEffect(() => {
    if (!selectedId || !isOnline) return;
    fetch(`/api/conversations/${selectedId}/read`, { method: "POST", credentials: "include" }).catch(() => {});
    qc.invalidateQueries({ queryKey: ["conversations"] });
    qc.invalidateQueries({ queryKey: ["conversations-unread"] });
  }, [selectedId, isOnline, qc]);

  /* Scroll to the newest initial page once per conversation. Loading older
     history deliberately retains the reader's existing viewport. */
  useEffect(() => {
    if (!selectedId || messages.length === 0 || initiallyScrolledConversationRef.current === selectedId) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    initiallyScrolledConversationRef.current = selectedId;
  }, [messages.length, selectedId]);

  const handleLoadOlderMessages = useCallback(async () => {
    const container = messagesScrollRef.current;
    const priorHeight = container?.scrollHeight ?? 0;
    await fetchOlderMessages();
    requestAnimationFrame(() => {
      if (container) container.scrollTop += container.scrollHeight - priorHeight;
    });
  }, [fetchOlderMessages]);

  /* close emoji picker on outside click */
  useEffect(() => {
    if (!emojiPickerOpen) return;
    const handler = (e: MouseEvent) => {
      if (emojiPickerRef.current && !emojiPickerRef.current.contains(e.target as Node)) {
        setEmojiPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [emojiPickerOpen]);

  /* insert emoji at textarea cursor position */
  const insertEmojiIntoText = useCallback((emoji: string) => {
    const textarea = inputRef.current;
    if (!textarea) { setInputText((prev) => prev + emoji); return; }
    const start = textarea.selectionStart ?? inputText.length;
    const end = textarea.selectionEnd ?? inputText.length;
    const newText = inputText.slice(0, start) + emoji + inputText.slice(end);
    setInputText(newText);
    setTimeout(() => {
      const newPos = start + emoji.length;
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
      textarea.focus();
    }, 0);
  }, [inputText]);

  /* ── mutations ───────────────────────────────────────────────── */
  const sendMut = useMutation({
    mutationFn: (body: { body: string; replyToId?: number; attachments?: Attachment[]; mentionedUserIds?: number[] }) =>
      apiFetch(`/api/conversations/${selectedId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
    },
    // OfflineQueuedError / OfflineBlockedError are handled globally by the
    // MutationCache in App.tsx — suppress the local toast to avoid duplicates.
    onError: (e: Error) => {
      if (!isOfflineQueuedError(e) && !isOfflineBlockedError(e)) {
        toast.error(e.message);
      }
    },
  });

  const editMut = useMutation({
    mutationFn: ({ msgId, body }: { msgId: number; body: string }) =>
      apiFetch(`/api/messages/${msgId}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", selectedId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMut = useMutation({
    mutationFn: ({ msgId, deletionType }: { msgId: number; deletionType: "for_me" | "for_everyone" }) =>
      apiFetch(`/api/messages/${msgId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deletionType }),
      }),
    onSuccess: (_, { deletionType }) => {
      void qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      if (deletionType === "for_me") {
        void qc.invalidateQueries({ queryKey: ["conversation", selectedId] });
        void qc.invalidateQueries({ queryKey: ["conversations"] });
        void qc.invalidateQueries({ queryKey: ["conversations-unread"] });
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const pinMut = useMutation({
    mutationFn: ({ msgId, shouldPin }: { msgId: number; shouldPin: boolean }) =>
      apiFetch(`/api/messages/${msgId}/pin`, { method: shouldPin ? "POST" : "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["pinned", selectedId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const reactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: number; emoji: string }) =>
      apiFetch(`/api/messages/${msgId}/reactions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", selectedId] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const createConvMut = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch("/api/conversations", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["conversations"] });
      if (data?.id) navigate(`/messages/${data.id}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const forwardToConvMut = useMutation({
    mutationFn: ({ convId, body, forwardedFromId }: { convId: number; body: string; forwardedFromId?: number }) =>
      apiFetch(`/api/conversations/${convId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body, forwardedFromId }),
      }),
    onSuccess: (_, { convId }) => {
      toast.success(t("messageForwarded"));
      qc.invalidateQueries({ queryKey: ["conversations"] });
      navigate(`/messages/${convId}`);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  /* ── pinned messages ─────────────────────────────────────────── */
  const { data: pinnedMsgs = [] } = useQuery<PinnedMsg[]>({
    queryKey: ["pinned", selectedId],
    queryFn: () => apiFetch(`/api/conversations/${selectedId}/pinned`),
    enabled: !!selectedId,
    staleTime: 30_000,
  });

  /* ── action handlers ─────────────────────────────────────────── */
  const handleDeleteForMe = useCallback((id: number) => {
    deleteMut.mutate({ msgId: id, deletionType: "for_me" });
  }, [deleteMut]);

  const handleDeleteForEveryone = useCallback((id: number) => {
    if (!confirm(t("confirmDeleteEveryone"))) return;
    deleteMut.mutate({ msgId: id, deletionType: "for_everyone" });
  }, [deleteMut, t]);

  const handlePin = useCallback((id: number, shouldPin: boolean) => {
    pinMut.mutate({ msgId: id, shouldPin });
  }, [pinMut]);

  /* ── @mention helpers ────────────────────────────────────────── */
  const members = convDetail?.members ?? [];
  const mentionOptions = mentionQuery !== null
    ? members
        .filter((m) =>
          m.name.toLowerCase().startsWith(mentionQuery.toLowerCase()) ||
          m.name.toLowerCase().split(" ").some((w) => w.startsWith(mentionQuery.toLowerCase()))
        )
        .slice(0, 6)
    : [];

  useEffect(() => {
    setMentionActiveIndex(0);
  }, [mentionQuery]);

  const selectMention = useCallback((member: { id: number; name: string }) => {
    const textarea = inputRef.current;
    if (!textarea) return;
    const pos = textarea.selectionStart ?? inputText.length;
    const textBeforeCursor = inputText.slice(0, pos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    if (!match) return;
    const start = pos - match[0].length;
    const displayName = member.name.split(" ")[0];
    const newText = inputText.slice(0, start) + `@${displayName} ` + inputText.slice(pos);
    setInputText(newText);
    setMentionQuery(null);
    setMentionActiveIndex(0);
    // Track the selected user ID; display name is presentation only
    setMentionedUserIds((prev) => prev.includes(member.id) ? prev : [...prev, member.id]);
    setTimeout(() => {
      const newPos = start + displayName.length + 2;
      textarea.selectionStart = newPos;
      textarea.selectionEnd = newPos;
      textarea.focus();
    }, 0);
  }, [inputText]);

  /* ── send ────────────────────────────────────────────────────── */
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text && pendingFiles.length === 0) return;
    if (!selectedId) return;
    if (pendingFiles.length > 0 && !requireAttachmentConnection()) return;
    await sendMut.mutateAsync({
      body: text,
      replyToId: replyTo?.id,
      attachments: pendingFiles.length > 0 ? pendingFiles : undefined,
      mentionedUserIds: mentionedUserIds.length > 0 ? mentionedUserIds : undefined,
    });
    setInputText(""); setReplyTo(null); setPendingFiles([]); setPendingImagePreviews([]);
    setMentionedUserIds([]);
  }, [inputText, pendingFiles, selectedId, replyTo, sendMut, mentionedUserIds, requireAttachmentConnection]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOptions.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionActiveIndex((index) => (index + 1) % mentionOptions.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionActiveIndex((index) => (index - 1 + mentionOptions.length) % mentionOptions.length);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionQuery(null);
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && !e.shiftKey) {
        e.preventDefault();
        selectMention(mentionOptions[mentionActiveIndex]);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  /* ── file upload ─────────────────────────────────────────────── */
  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canUploadAttachments) return;
    if (!requireAttachmentConnection()) {
      e.currentTarget.value = "";
      return;
    }
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setUploadBusy(true);
    try {
      for (const file of files) {
        const fileType = file.type.startsWith("image/") ? "image" : "file";
        const attachment = await uploadMessageAttachment({
          blob: file,
          name: file.name,
          contentType: file.type,
          type: fileType,
          requestUploadUrl,
        });
        setPendingFiles((prev) => [...prev, attachment]);
        if (fileType === "image") {
          const reader = new FileReader();
          reader.onload = (ev) => { if (ev.target?.result) setPendingImagePreviews((prev) => [...prev, ev.target!.result as string]); };
          reader.readAsDataURL(file);
        }
      }
    } catch { toast.error(t("errUploadFailed")); }
    finally { setUploadBusy(false); e.target.value = ""; }
  };

  /* ── voice recording ─────────────────────────────────────────── */
  const startVoiceRecording = async () => {
    if (!canUploadAttachments) return;
    if (!requireAttachmentConnection()) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/mp4";
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType });
        setVoiceBlob(blob);
        setVoiceDuration(recordingSecondsRef.current);
        setVoiceState("preview");
        stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current = recorder;
      recordingSecondsRef.current = 0;
      recorder.start(250);
      setVoiceState("recording");
      setRecordingSeconds(0);
      recordingTimerRef.current = setInterval(() => {
        recordingSecondsRef.current++;
        setRecordingSeconds((s) => s + 1);
        if (recordingSecondsRef.current >= 600) stopVoiceRecording();
      }, 1000);
    } catch {
      toast.error(t("errMicDenied"));
    }
  };

  const stopVoiceRecording = () => {
    if (mediaRecorderRef.current?.state === "recording") mediaRecorderRef.current.stop();
    if (recordingTimerRef.current) { clearInterval(recordingTimerRef.current); recordingTimerRef.current = null; }
  };

  const cancelVoiceRecording = () => {
    stopVoiceRecording();
    setVoiceBlob(null);
    setVoiceState("idle");
    setRecordingSeconds(0);
    recordingSecondsRef.current = 0;
  };

  const sendVoiceMessage = async () => {
    if (!voiceBlob || !selectedId || !canUploadAttachments) return;
    if (!requireAttachmentConnection()) return;
    setUploadBusy(true);
    try {
      const ext = voiceBlob.type.includes("webm") ? "webm" : "mp4";
      const fileName = `voice-${Date.now()}.${ext}`;
      const attachment = await uploadMessageAttachment({
        blob: voiceBlob,
        name: fileName,
        contentType: voiceBlob.type,
        type: "voice",
        duration: voiceDuration,
        requestUploadUrl,
      });
      await sendMut.mutateAsync({
        body: "(Voice message)",
        attachments: [attachment],
      });
      setVoiceBlob(null);
      setVoiceState("idle");
      setRecordingSeconds(0);
      recordingSecondsRef.current = 0;
    } catch { toast.error(t("errVoiceSend")); }
    finally { setUploadBusy(false); }
  };

  /* ── typing indicator emit ───────────────────────────────────── */
  const emitTyping = useCallback(() => {
    if (!selectedId || !socket?.connected) return;
    socket.emit("user:typing", { conversationId: selectedId, isTyping: true });
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("user:typing", { conversationId: selectedId, isTyping: false });
    }, 2500);
  }, [selectedId, socket]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setInputText(val);
    emitTyping();
    const pos = e.target.selectionStart ?? val.length;
    const textBeforeCursor = val.slice(0, pos);
    const match = textBeforeCursor.match(/@(\w*)$/);
    setMentionQuery(match ? match[1] : null);
  }, [emitTyping]);

  /* ── edit submit ─────────────────────────────────────────────── */
  const handleEditSubmit = async () => {
    if (!editingMsg || !editBody.trim()) return;
    await editMut.mutateAsync({ msgId: editingMsg.id, body: editBody.trim() });
    setEditingMsg(null); setEditBody("");
  };

  /* ── group messages by date ─────────────────────────────────── */
  const grouped: Array<{ dateStr: string; msgs: Msg[] }> = [];
  for (const msg of messages) {
    const dateStr = msg.createdAt.slice(0, 10);
    const last = grouped[grouped.length - 1];
    if (last?.dateStr === dateStr) last.msgs.push(msg);
    else grouped.push({ dateStr, msgs: [msg] });
  }

  /* ── derived values ─────────────────────────────────────────── */
  const isGroup = convDetail ? convDetail.type !== "direct" : false;
  const isAnnouncement = convDetail?.type === "announcement";
  const isAnnouncementCreator = isAnnouncement && convDetail?.createdById === myId;
  const canSend = !isAnnouncement || isAnnouncementCreator || ANNOUNCEMENT_ROLES.has(myRole);
  const totalUnread = unreadData?.total ?? 0;

  /* online status for DM partner */
  const otherMember = convDetail?.type === "direct"
    ? convDetail.members.find((m) => m.id !== myId)
    : null;
  const presence = otherMember ? onlineStatus(otherMember.isOnline, otherMember.lastSeenAt, t) : null;

  const TABS = [
    { id: "all", label: t("tabAll") },
    { id: "unread", label: t("tabUnread"), badge: totalUnread },
    { id: "direct", label: t("tabDirect") },
    { id: "project", label: t("tabProjects") },
    { id: "state", label: t("tabStates") },
    { id: "sector", label: t("tabSectors") },
    { id: "announcement", label: t("tabBroadcasts") },
  ];

  return (
    <div className="-m-4 md:-m-5 lg:-m-6 xl:-m-8 h-[calc(100dvh-4rem)] min-h-[32rem] flex overflow-hidden bg-card border-y border-border/70 md:border md:rounded-xl">

      {/* ── Left panel ───────────────────────────────────────── */}
      <div className={cn(
        "flex flex-col bg-card border-e border-border/80",
        "w-full md:w-[clamp(18rem,24vw,22rem)] shrink-0",
        selectedId ? "hidden md:flex" : "flex",
      )}>
        <div className="px-4 pt-3.5 pb-2.5 border-b border-border/80">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
                <MessageSquare className="h-3.5 w-3.5 text-primary-foreground" />
              </div>
              <h1 className="font-semibold tracking-tight text-foreground text-xl">{t("title")}</h1>
            </div>
            <Button onClick={() => setNewChatOpen(true)} size="sm" className="h-8 text-xs gap-1 shrink-0">
              <Plus className="h-3.5 w-3.5" /> {t("newChat")}
            </Button>
          </div>
          <div className="relative mb-3">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input value={searchQ} onChange={(e) => setSearchQ(e.target.value)}
              aria-label={t("searchConversations")}
              placeholder={t("searchConversations")}
              className="w-full h-9 ps-9 pe-3 text-sm rounded-lg border border-border bg-muted/30 placeholder:text-muted-foreground/75 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 focus-visible:border-primary/50 transition" />
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1 scrollbar-hide">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => setFilterTab(tab.id)}
                type="button" aria-pressed={filterTab === tab.id}
                className={cn(
                  "shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full border border-transparent text-xs font-medium transition-colors whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                  filterTab === tab.id ? "bg-primary text-primary-foreground border-primary" : "bg-muted/35 text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                )}>
                {tab.label}
                {(tab.badge ?? 0) > 0 && (
                  <span className={cn("rounded-full text-xs px-1 leading-none",
                    filterTab === tab.id ? "bg-white/20" : "bg-primary text-primary-foreground")}>
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {convsLoading ? (
            <div className="divide-y divide-border/60">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Skeleton className="h-9 w-9 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1.5 min-w-0">
                    <Skeleton className="h-3.5 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-8 shrink-0" />
                </div>
              ))}
            </div>
          ) : convsError ? (
            <ErrorState
              variant="server"
              title={t("errLoadConversations")}
              description={t("errLoadConversationsDesc")}
              onRetry={() => refetchConvs()}
              compact
            />
          ) : convList.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full py-12 text-center px-4">
              {filterTab !== "all" || searchQ.trim()
                ? <Search className="h-8 w-8 text-muted-foreground/35 mb-3" />
                : <MessageSquare className="h-9 w-9 text-muted-foreground/35 mb-3" />}
              <p className="text-sm font-medium text-muted-foreground">
                {filterTab !== "all" || searchQ.trim() ? t("noFilteredConversations") : t("noConversations")}
              </p>
              {filterTab === "all" && !searchQ.trim() && (
                <p className="text-xs text-muted-foreground/70 mt-1">{t("noConversationsHint")}</p>
              )}
            </div>
          ) : (
            <>
              {convList.map((conv) => (
                <ConversationItem key={conv.id} conv={conv} selected={conv.id === selectedId}
                  onClick={() => navigate(`/messages/${conv.id}`)} />
              ))}
              {moreConversationsError ? (
                <div className="px-4 py-3 text-center">
                  <p className="text-xs text-destructive mb-2">{t("errLoadMoreConversations")}</p>
                  <Button size="sm" variant="outline" className="h-8 text-xs" onClick={handleFetchMoreConversations}>
                    {t("loadMoreConversations")}
                  </Button>
                </div>
              ) : hasMoreConversations ? (
                <div className="p-2.5 flex justify-center border-t border-border/60">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 text-xs text-muted-foreground hover:text-foreground"
                    disabled={isFetchingMoreConversations}
                    onClick={handleFetchMoreConversations}
                  >
                    {isFetchingMoreConversations ? t("loadingMoreConversations") : t("loadMoreConversations")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── Right panel: chat + gallery ────────────────────────── */}
      {!selectedId ? (
        <div className="hidden md:flex flex-1 items-center justify-center bg-muted/20">
          <div className="text-center max-w-sm px-6">
            <div className="h-14 w-14 rounded-xl border border-primary/10 bg-primary/5 flex items-center justify-center mx-auto mb-3">
              <MessageSquare className="h-6 w-6 text-primary/45" />
            </div>
            <p className="font-medium text-foreground">{t("selectConversation")}</p>
            <p className="text-sm text-muted-foreground mt-1">{t("selectConversationHint")}</p>
            <Button onClick={() => setNewChatOpen(true)} size="sm" className="mt-4 gap-1.5">
              <Plus className="h-3.5 w-3.5" /> {t("newConversation")}
            </Button>
          </div>
        </div>
      ) : (
      <div className="relative flex flex-1 min-w-0 overflow-hidden">
          {/* Chat window */}
          <div className={cn("flex flex-col flex-1 min-w-0 relative", selectedId ? "flex" : "hidden md:flex")}>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-2.5 min-h-16 bg-card/95 border-b border-border/80 shrink-0">
              <Button variant="ghost" size="icon" className="md:hidden shrink-0 -ms-1 h-9 w-9" aria-label={t("backToConversations")} onClick={() => navigate("/messages")}>
                <ArrowLeft className="h-5 w-5 rtl:rotate-180" />
              </Button>
              {convDetail && (
                <>
                  <div className="relative shrink-0">
                    {convDetail.type === "direct" && convDetail.otherMemberName ? (
                      <div className={cn("h-9 w-9 rounded-full flex items-center justify-center", avatarColor(convDetail.otherMemberId ?? convDetail.id))}>
                        <span className="text-xs font-medium text-white">{initials(convDetail.otherMemberName)}</span>
                      </div>
                    ) : (
                      <div className={cn("h-9 w-9 rounded-full flex items-center justify-center", avatarColor(convDetail.id))}>
                        {(() => { const M = TYPE_META[convDetail.type] ?? TYPE_META.group; const Icon = M.icon; return <Icon className="h-4 w-4 text-white" />; })()}
                      </div>
                    )}
                    {/* Online dot */}
                    {presence?.online && (
                      <span className="absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full bg-success border-2 border-card" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate" title={convName(convDetail, t)}>{convName(convDetail, t)}</p>
                      {isAnnouncement && (
                        <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide bg-destructive/10 text-destructive px-1.5 py-0.5 rounded-full">
                          {t("broadcast")}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">
                      {convDetail.type === "direct"
                        ? presence
                          ? <span className={cn("flex items-center gap-1", presence.online ? "text-success" : "")}>
                              {presence.online && <Circle className="h-2 w-2 fill-success text-success" />}
                              {presence.online ? t("online") : presence.label}
                              {!presence.online && convSubtitle(convDetail) && ` · ${convSubtitle(convDetail)}`}
                            </span>
                          : convSubtitle(convDetail) ?? t("convNameDirect")
                        : (
                          <>
                            {t("memberCount", { count: convDetail.memberCount })}
                            {convDetail.members?.length > 0 && (
                              <span className="ms-1">· {convDetail.members.slice(0, 3).map((m) => m.name.split(" ")[0]).join(", ")}</span>
                            )}
                          </>
                        )}
                    </p>
                  </div>
                  {/* Header actions */}
                  <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8 text-muted-foreground hover:text-primary"
                    onClick={() => setGalleryOpen((v) => !v)} aria-label={t("mediaGallery")}>
                    <GalleryHorizontal className="h-4 w-4" />
                  </Button>
                  <Badge variant="outline" className="shrink-0 capitalize text-[11px] hidden sm:inline-flex">
                    {t(`type_${convDetail.type}`) || (TYPE_META[convDetail.type]?.label ?? convDetail.type)}
                  </Badge>
                </>
              )}
            </div>

            {/* Pinned messages bar */}
            {pinnedMsgs.length > 0 && (
              <button
                type="button"
                aria-expanded={pinnedOpen}
                aria-controls="pinned-messages-panel"
                className="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20 text-xs shrink-0 cursor-pointer hover:bg-warning/15 transition-colors text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-warning"
                onClick={() => setPinnedOpen((v) => !v)}>
                <Pin className="h-3 w-3 text-warning shrink-0" />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-warning">{t("pinnedLabel")}: </span>
                  <span className="text-warning/80 truncate">
                    {pinnedMsgs[0].body?.slice(0, 70) || t("attachmentPlaceholder")}
                  </span>
                </div>
                {pinnedMsgs.length > 1 && (
                  <span className="text-warning font-medium shrink-0">{t("pinnedCount", { count: pinnedMsgs.length })}</span>
                )}
              </button>
            )}

            {/* Pinned messages viewer panel (absolute overlay) */}
            {pinnedOpen && (
              <div id="pinned-messages-panel" className="absolute inset-y-0 end-0 z-20 h-full w-full max-w-sm bg-card border-s border-border flex flex-col shadow-xl">
                <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-primary text-primary-foreground shrink-0">
                  <div className="flex items-center gap-2 font-medium text-sm">
                    <Pin className="h-3.5 w-3.5" /> {t("pinnedMessages")}
                    <span className="text-white/70 font-normal">({pinnedMsgs.length})</span>
                  </div>
                  <Button variant="ghost" size="icon"
                    aria-label={t("closePinnedMessages")}
                    className="h-7 w-7 text-white/70 hover:text-white hover:bg-white/10"
                    onClick={() => setPinnedOpen(false)}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-2">
                  {pinnedMsgs.length === 0 ? (
                    <p className="text-center text-muted-foreground text-sm py-8">{t("noPinnedMessages")}</p>
                  ) : (
                    pinnedMsgs.map((p) => (
                      <div key={p.id} className="p-3 rounded-xl border border-warning/20 bg-warning/5">
                        <p className="text-xs font-medium text-warning mb-1 truncate" title={p.senderName}>{p.senderName}</p>
                        <p className="text-sm text-foreground line-clamp-3 break-words [overflow-wrap:anywhere]">{p.body || t("attachmentPlaceholder")}</p>
                        <p className="text-xs text-muted-foreground mt-1.5">
                          {t("pinnedBy", { name: p.pinnedByName ?? t("someone") })} · {formatMsgTime(p.pinnedAt, i18n.language)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Messages area */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-3.5 space-y-0.5 bg-muted/20">
              {msgsLoading ? (
                <div className="flex flex-col gap-3.5 py-2">
                  {/* Alternating skeleton bubbles to simulate a real conversation */}
                  {[
                    { own: false, widths: ["w-48", "w-36"] },
                    { own: true,  widths: ["w-56"] },
                    { own: false, widths: ["w-64", "w-40"] },
                    { own: true,  widths: ["w-44", "w-32"] },
                    { own: false, widths: ["w-52"] },
                    { own: true,  widths: ["w-60"] },
                  ].map((row, i) => (
                    <div key={i} className={cn("flex items-end gap-2", row.own ? "flex-row-reverse" : "flex-row")}>
                      {!row.own && <Skeleton className="h-7 w-7 rounded-full shrink-0 mb-0.5" />}
                      <div className={cn("flex flex-col gap-1", row.own ? "items-end" : "items-start")}>
                        {row.widths.map((w, j) => (
                          <Skeleton key={j} className={cn("h-9 rounded-2xl", w)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : msgsError ? (
                <div className="flex items-center justify-center h-full">
                  <ErrorState
                    variant="server"
                    title={t("errLoadMessages")}
                    description={t("errLoadMessagesDesc")}
                    onRetry={() => refetchMsgs()}
                  />
                </div>
              ) : grouped.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full py-12 text-center">
                  <div className="h-11 w-11 rounded-xl border border-primary/10 bg-primary/5 flex items-center justify-center mx-auto mb-3">
                    <MessageSquare className="h-5 w-5 text-primary/35" />
                  </div>
                  <p className="text-sm font-medium text-foreground">{t("noMessages")}</p>
                  <p className="text-xs text-muted-foreground/60 mt-0.5">{t("noMessagesHint")}</p>
                </div>
              ) : (
                <>
                  {hasOlderMessages && (
                    <div className="flex justify-center py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => void handleLoadOlderMessages()}
                        disabled={isFetchingOlderMessages}
                      >
                        {isFetchingOlderMessages ? t("loadingOlderMessages") : t("loadOlderMessages")}
                      </Button>
                    </div>
                  )}
                  {grouped.map(({ dateStr, msgs: dayMsgs }) => (
                    <div key={dateStr}>
                      <DateDivider dateStr={dateStr} />
                      {dayMsgs.map((msg, i) => {
                        const isOwn = msg.senderId === myId;
                        const showSender = i === 0 || dayMsgs[i - 1].senderId !== msg.senderId;
                        return (
                          <div key={msg.id} data-msg-id={msg.id} className={cn(i === 0 ? "mt-2" : "mt-0.5", "mb-0.5")}>
                            <MessageBubble
                              msg={msg} isOwn={isOwn} showSender={showSender} isGroup={isGroup}
                              myId={myId} myRole={myRole}
                              onReply={(m) => { setReplyTo(m); inputRef.current?.focus(); }}
                              onEdit={(m) => { setEditingMsg(m); setEditBody(m.body); }}
                              onDeleteForMe={handleDeleteForMe}
                              onDeleteForEveryone={handleDeleteForEveryone}
                              onReact={(msgId, emoji) => reactionMut.mutate({ msgId, emoji })}
                              onForward={(m) => setForwardMsg(m)}
                              onLightbox={(url) => setLightboxUrl(url)}
                              onPin={handlePin}
                              onScrollToMessage={scrollToMessage}
                            />
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Typing indicator */}
            {typingUsers.length > 0 && (
              <div className="px-5 pb-1">
                <span className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                  <span className="flex gap-0.5">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="w-1 h-1 rounded-full bg-muted-foreground/60 animate-bounce" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  {typingUsers.length === 1
                    ? t("typingOne", { names: typingUsers[0] })
                    : t("typingMany", { names: typingUsers.slice(0, 2).join(", ") })}
                </span>
              </div>
            )}

            {/* Reply / Edit preview bar */}
            {(replyTo || editingMsg) && (
              <div className="px-4 py-2 bg-accent/20 border-t border-border flex items-start gap-3">
                <div className={cn("w-0.5 rounded-full shrink-0 self-stretch", replyTo ? "bg-primary" : "bg-warning")} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-primary mb-0.5">
                    {replyTo ? t("replyingTo", { name: replyTo.senderName }) : t("editingMessage")}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{replyTo ? replyTo.body : editingMsg?.body}</p>
                </div>
                <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0"
                  aria-label={t("cancelReplyOrEdit")}
                  onClick={() => { setReplyTo(null); setEditingMsg(null); setEditBody(""); }}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}

            {/* Pending files preview */}
            {pendingFiles.length > 0 && (
              <div className="px-4 py-2 border-t border-border flex gap-2 flex-wrap bg-card" aria-label={t("pendingAttachments")}>
                {pendingFiles.map((f, i) => (
                  <div key={i} className="relative min-w-0">
                    {f.type === "image" && pendingImagePreviews[pendingFiles.filter((x,j) => j < i && x.type === "image").length] ? (
                      <div className="relative h-14 w-14 rounded-lg overflow-hidden border border-border shadow-sm">
                        <img src={pendingImagePreviews[pendingFiles.filter((x,j) => j < i && x.type === "image").length]}
                          alt={f.name} className="h-full w-full object-cover" />
                        <button aria-label={t("removeAttachment", { name: f.name })} onClick={() => {
                          const imgIdx = pendingFiles.slice(0, i).filter(x => x.type === "image").length;
                          setPendingFiles((p) => p.filter((_, j) => j !== i));
                          setPendingImagePreviews((p) => p.filter((_, j) => j !== imgIdx));
                        }} className="absolute top-0.5 end-0.5 h-5 w-5 bg-black/60 rounded-full flex items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <X className="h-2.5 w-2.5 text-white" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 bg-muted/50 border border-border rounded-lg px-2.5 py-1.5 max-w-[min(15rem,calc(100vw-2rem))]">
                        <Paperclip className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs truncate max-w-40" title={f.name}>{f.name}</span>
                        {f.size ? <span className="text-[10px] text-muted-foreground shrink-0">{formatFileSize(f.size)}</span> : null}
                        <button type="button" aria-label={t("removeAttachment", { name: f.name })} onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                          className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
                          <X className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Input bar */}
            {canSend ? (
              <div className="px-3 sm:px-4 py-2.5 bg-card border-t border-border shrink-0 relative">
                {/* @mentions typeahead overlay */}
                {mentionQuery !== null && mentionOptions.length > 0 && (
                  <div id="message-mention-options" role="listbox" aria-label={t("mentionSuggestions")} className="absolute bottom-full inset-x-4 mb-1 max-h-56 overflow-y-auto bg-card border border-border rounded-xl shadow-xl z-40">
                    {mentionOptions.map((m, index) => (
                      <button id={`mention-option-${m.id}`} key={m.id}
                        onMouseDown={(e) => { e.preventDefault(); selectMention(m); }}
                        role="option" aria-selected={index === mentionActiveIndex}
                        className={cn("w-full flex items-center gap-2.5 px-3 py-2 hover:bg-muted/50 text-sm text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary", index === mentionActiveIndex && "bg-muted/50")}>
                        <div className={cn("h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0", avatarColor(m.id))}>
                          {initials(m.name)}
                        </div>
                        <span className="flex-1 font-medium text-foreground">{m.name}</span>
                        <span className="text-xs text-muted-foreground">@{m.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
                {editingMsg ? (
                  <div className="flex items-end gap-2">
                    <textarea ref={inputRef} value={editBody} onChange={(e) => setEditBody(e.target.value)}
                      rows={1} placeholder={t("editMessagePlaceholder")}
                      className="flex-1 resize-none rounded-xl border border-border bg-muted/40 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 min-h-[40px] max-h-32"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }}} />
                    <Button onClick={handleEditSubmit} disabled={!editBody.trim() || editMut.isPending}
                      aria-label={t("saveEdit")}
                      className="bg-warning hover:bg-warning/90 text-foreground h-10 w-10 rounded-xl p-0 shrink-0">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0"
                      aria-label={t("cancelEdit")}
                      onClick={() => { setEditingMsg(null); setEditBody(""); }}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : voiceState === "recording" ? (
                  /* ─ Recording state ─ */
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 flex items-center gap-2 bg-destructive/10 border border-destructive/20 rounded-xl px-3 py-2.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-destructive animate-pulse shrink-0" />
                      <span className="text-sm font-medium text-destructive truncate">{t("recording")}</span>
                      <span className="ms-auto text-sm font-mono text-destructive tabular-nums">{formatDuration(recordingSeconds)}</span>
                    </div>
                    <Button onClick={stopVoiceRecording}
                      aria-label={t("stopRecording")}
                      className="bg-destructive hover:bg-destructive/90 text-destructive-foreground h-10 w-10 rounded-xl p-0 shrink-0">
                      <StopCircle className="h-5 w-5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0" aria-label={t("cancelRecording")} onClick={cancelVoiceRecording}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : voiceState === "preview" && voiceBlob ? (
                  /* ─ Voice preview state ─ */
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 bg-accent/20 border border-border rounded-xl px-2 py-1.5">
                      <VoicePlayer url={URL.createObjectURL(voiceBlob)} duration={voiceDuration} isOwn={false} />
                    </div>
                    <Button onClick={sendVoiceMessage} disabled={!isOnline || uploadBusy || sendMut.isPending}
                      aria-label={t("sendVoiceMessage")}
                      className="h-10 w-10 rounded-xl p-0 shrink-0">
                      {uploadBusy ? <span className="animate-spin text-lg">⟳</span> : <Send className="h-4 w-4" />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-10 w-10 rounded-xl shrink-0" aria-label={t("discardVoiceMessage")} onClick={cancelVoiceRecording}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  /* ─ Normal input state ─ */
                  <div className="relative">
                    {/* Emoji picker popup */}
                    {emojiPickerOpen && (
                      <div ref={emojiPickerRef}
                        className="absolute bottom-full end-0 mb-2 z-30 w-[min(352px,calc(100vw-1.5rem))] max-h-[min(24rem,70dvh)] shadow-xl rounded-2xl overflow-hidden">
                        <EmojiPickerLib
                          onEmojiClick={(emojiData) => {
                            insertEmojiIntoText(emojiData.emoji);
                          }}
                          searchPlaceholder={t("searchEmoji")}
                          height={320}
                          width="100%"
                          lazyLoadEmojis
                        />
                      </div>
                    )}
                    <div className="flex items-end gap-1.5 sm:gap-2">
                      {canUploadAttachments && (
                        <>
                          <input type="file" multiple ref={fileInputRef} className="hidden"
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip"
                            onChange={handleFileChange} />
                          <Button variant="ghost" size="icon"
                            className="shrink-0 text-muted-foreground hover:text-primary h-10 w-10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={() => fileInputRef.current?.click()} disabled={!isOnline || uploadBusy} aria-label={t("attachFile")}
                            aria-describedby={!isOnline ? "message-attachment-online-notice" : undefined}>
                            <Paperclip className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon"
                            className="shrink-0 text-muted-foreground hover:text-destructive h-10 w-10 rounded-xl focus-visible:ring-2 focus-visible:ring-primary"
                            onClick={startVoiceRecording} disabled={!isOnline || uploadBusy} aria-label={t("recordVoice")}
                            aria-describedby={!isOnline ? "message-attachment-online-notice" : undefined}>
                            <Mic className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <textarea ref={inputRef} value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        aria-label={isAnnouncement ? t("announcementFollowUpPlaceholder") : t("typeMessage")}
                        aria-expanded={mentionOptions.length > 0}
                        aria-controls={mentionOptions.length > 0 ? "message-mention-options" : undefined}
                        aria-activedescendant={mentionOptions[mentionActiveIndex] ? `mention-option-${mentionOptions[mentionActiveIndex].id}` : undefined}
                        rows={1} placeholder={isAnnouncement ? t("announcementFollowUpPlaceholder") : t("typeMessagePlaceholder")}
                        className="flex-1 min-w-0 resize-none rounded-xl border border-border bg-muted/40 px-3 sm:px-4 py-2.5 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition min-h-[40px] max-h-32" />
                      {/* Emoji input button */}
                      <Button variant="ghost" size="icon"
                        className={cn(
                          "shrink-0 h-10 w-10 rounded-xl transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                          emojiPickerOpen ? "text-warning bg-warning/10" : "text-muted-foreground hover:text-warning hover:bg-warning/10",
                        )}
                        onClick={() => setEmojiPickerOpen((v) => !v)}
                        aria-label={t("insertEmoji")}>
                        <Smile className="h-4 w-4" />
                      </Button>
                      <Button onClick={handleSend}
                        disabled={(!inputText.trim() && pendingFiles.length === 0) || (pendingFiles.length > 0 && !isOnline) || sendMut.isPending || uploadBusy}
                        aria-label={t("sendMessage")}
                        className="h-10 w-10 rounded-xl p-0 shrink-0 focus-visible:ring-2 focus-visible:ring-primary">
                        <Send className="h-4 w-4" />
                      </Button>
                    </div>
                    {!isOnline && canUploadAttachments && (
                      <p id="message-attachment-online-notice" role="status" className="mt-2 text-xs text-muted-foreground">
                        {t("attachmentOnlineRequired")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="px-4 py-3 bg-card border-t border-border flex items-center justify-center shrink-0">
                <p className="text-xs text-muted-foreground italic flex items-center gap-1.5">
                  <Megaphone className="h-3.5 w-3.5" />
                  {t("announcementReadOnly")}
                </p>
              </div>
            )}
          </div>

          {/* Media gallery panel */}
          {galleryOpen && selectedId && (
            <MediaGalleryPanel convId={selectedId} onClose={() => setGalleryOpen(false)} onLightbox={setLightboxUrl} />
          )}
        </div>
      )}

      {/* Lightbox overlay */}
      {lightboxUrl && <ImageLightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}

      {/* Forward dialog */}
      {forwardMsg && (
        <ForwardDialog
          msg={forwardMsg}
          conversations={convList}
          onClose={() => setForwardMsg(null)}
          onForward={(convId) => {
            forwardToConvMut.mutate({ convId, body: forwardMsg.body, forwardedFromId: forwardMsg.id });
            setForwardMsg(null);
          }}
        />
      )}

      <NewConversationModal open={newChatOpen} onClose={() => setNewChatOpen(false)}
        onCreate={(body) => createConvMut.mutateAsync(body)} userRole={myRole} />
    </div>
  );
}
