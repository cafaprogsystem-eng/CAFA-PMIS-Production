import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ReactNode } from "react";
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
  Search,
  Plus,
  MoreVertical,
  Send,
  Paperclip,
  Smile,
  ArrowLeft,
  Users,
  Edit2,
  Trash2,
  Reply,
  X,
  Check,
  MessageSquare,
  Building2,
  FolderKanban,
  MapPin,
  Layers,
  Megaphone,
  Mic,
  Play,
  Pause,
  DownloadCloud,
  GalleryHorizontal,
  Forward,
  StopCircle,
  Image as ImageIcon,
  Volume2,
  Copy,
  Pin,
  PinOff,
  CircleFill,
  Ban,
  File,
  FileText,
  FileSpreadsheet,
  FileArchive,
} from "@/components/icons";
import type { IconComponent } from "@/components/icons";
import {
  Alert, Avatar, Button, Chip, Dropdown, Input, Label, Modal, SearchField, Separator, Skeleton, Tabs, Tooltip,
} from "@heroui/react";
import { ErrorState } from "@/components/ui/error-state";
import { SelectField } from "@/components/select-field";
import { ConfirmModal } from "@/components/confirm-modal";
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
interface StateItem { id: number; name: string; nameAr?: string | null; code: string }
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
// Labels come from the `type_${type}` locale keys; this map only carries the icon.
const TYPE_ICON: Record<string, IconComponent> = {
  direct: MessageSquare,
  project: FolderKanban,
  state: MapPin,
  sector: Layers,
  group: Users,
  system: Building2,
  announcement: Megaphone,
};
const typeIcon = (type: string) => TYPE_ICON[type] ?? TYPE_ICON.group;
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
/** Byte size as "163 KB"; render it inside <bdi dir="ltr"> so it never reverses in Arabic. */
function formatFileSize(bytes?: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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
function convName(conv: ConvSummary, t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (conv.name) return conv.name;
  if (conv.type === "direct") return conv.otherMemberName ?? t("convNameDirect");
  if (conv.type === "project") return t("convNameProject");
  if (conv.type === "state") return t("convNameState");
  if (conv.type === "sector") return conv.sector ? t("sectorTeam", { sector: conv.sector }) : t("convNameSector");
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

/** Gravity file-type icon for an attachment name (replaces the old emoji icons). */
function FileTypeIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["xls", "xlsx", "csv"].includes(ext)) return <FileSpreadsheet className={`${className} shrink-0 text-emerald-600`} aria-hidden="true" />;
  if (["pdf", "doc", "docx", "ppt", "pptx", "txt"].includes(ext)) return <FileText className={`${className} shrink-0 text-rose-600`} aria-hidden="true" />;
  if (["zip", "rar", "7z"].includes(ext)) return <FileArchive className={`${className} shrink-0 text-amber-600`} aria-hidden="true" />;
  return <File className={`${className} shrink-0 text-[var(--muted)]`} aria-hidden="true" />;
}

/** Coloured initials (people) or a conversation-type icon, on the HeroUI Avatar. */
function ConvAvatar({ id, name, type, size = "md", className }: { id: number; name?: string | null; type?: string; size?: "sm" | "md"; className?: string }) {
  const Icon = typeIcon(type ?? "group");
  return (
    <Avatar size={size} className={cn("shrink-0", size === "sm" ? "size-7" : "size-9", className)}>
      <Avatar.Fallback className={cn("text-xs font-medium text-white", avatarColor(id))}>
        {name ? initials(name) : <Icon className="size-4" aria-hidden="true" />}
      </Avatar.Fallback>
    </Avatar>
  );
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

/** Server error codes arrive as the Error message; show a translated sentence, never the code. */
function apiErrorText(error: unknown, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const code = error instanceof Error ? error.message : "";
  return /^[a-z_]+$/.test(code) ? t(`apiErrors.${code}`, { defaultValue: t("apiErrors.default") }) : t("apiErrors.default");
}

/** Voice and attachment-only messages are stored with a fixed English body; show it translated. */
function displayBody(body: string | null | undefined, t: (key: string) => string): string {
  if (body === "(Voice message)") return t("voiceMessage");
  if (body === "(attachment)") return t("attachmentPlaceholder");
  return body ?? "";
}

/* ─── ImageLightbox ───────────────────────────────────────────────── */
function ImageLightbox({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useTranslation("messages");
  return (
    <Modal isOpen onOpenChange={(open) => { if (!open) onClose(); }}>
      <Modal.Backdrop isDismissable className="bg-black/90">
        <Modal.Container size="full" className="items-center justify-center bg-transparent shadow-none">
          <Modal.Dialog aria-label={t("openImage", { name: "" })} className="relative flex h-full w-full items-center justify-center bg-transparent p-4 shadow-none">
            <img src={url} alt="" className="max-h-[90vh] max-w-[90vw] rounded-lg object-contain shadow-2xl" />
            <Button isIconOnly variant="tertiary" aria-label={t("closeLightbox")} onPress={onClose}
              className="absolute end-4 top-4 bg-white/10 text-white hover:bg-white/20">
              <X className="size-5" aria-hidden="true" />
            </Button>
            <a href={url} download target="_blank" rel="noreferrer" aria-label={t("downloadAttachment", { name: "" })}
              className="absolute bottom-4 end-4 rounded-full bg-white/10 p-2.5 text-white transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">
              <DownloadCloud className="size-5" aria-hidden="true" />
            </a>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
    <div className={cn("mt-1.5 flex min-w-[180px] items-center gap-2 rounded-xl px-3 py-2",
      isOwn ? "bg-white/10" : "bg-[var(--default)]")}>
      <audio ref={audioRef} src={url}
        onTimeUpdate={() => setCurrentTime(audioRef.current?.currentTime ?? 0)}
        onDurationChange={() => setTotalDuration(audioRef.current?.duration ?? duration ?? 0)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }} />
      <button type="button" onClick={toggle} aria-label={playing ? t("pauseVoice") : t("playVoice")}
        className={cn("flex size-7 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
          isOwn ? "bg-white/20 text-white hover:bg-white/30" : "bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20")}>
        {playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}
      </button>
      {/* Audio time runs left to right in both languages. */}
      <div className="min-w-0 flex-1" dir="ltr">
        <input type="range" min={0} max={totalDuration || 100} value={currentTime} step={0.1} aria-label={t("seekVoice")}
          onChange={(e) => { if (audioRef.current) { audioRef.current.currentTime = parseFloat(e.target.value); }}}
          className={cn("h-1 w-full cursor-pointer appearance-none rounded-full",
            isOwn ? "accent-white" : "accent-[var(--accent)]")} />
        <p className={cn("mt-0.5 text-xs tabular-nums", isOwn ? "text-white/70" : "text-[var(--muted)]")}>
          {formatDuration(currentTime)} / {formatDuration(totalDuration)}
        </p>
      </div>
      <Volume2 className={cn("size-3.5 shrink-0", isOwn ? "text-white/60" : "text-[var(--muted)]")} aria-hidden="true" />
    </div>
  );
}

/* ─── EmojiReactionPicker ─────────────────────────────────────────── */
function EmojiReactionPicker({ onPick, isOwn }: { onPick: (e: string) => void; isOwn: boolean }) {
  const { t } = useTranslation("messages");
  return (
    <div className={cn(
      "absolute z-20 flex gap-0.5 rounded-2xl border border-[var(--border)] bg-[var(--overlay)] p-1 shadow-xl",
      isOwn ? "end-0" : "start-0",
    )} style={{ bottom: "calc(100% + 4px)" }}>
      {EMOJI_REACTIONS.map((e) => (
        <button key={e} type="button" onClick={() => onPick(e)} aria-label={t("reactWith", { emoji: e })}
          className="flex size-8 items-center justify-center rounded-xl text-lg transition-transform hover:scale-125 hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-90">
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
    <div className="mt-1.5 flex flex-wrap gap-1">
      {Object.entries(grouped).map(([emoji, info]) => (
        <button key={emoji} type="button" onClick={() => onToggle(emoji)}
          aria-label={t("toggleReaction", { emoji, count: info.count })}
          aria-pressed={info.mine}
          title={info.users.join(", ")}
          className={cn(
            "flex items-center gap-0.5 rounded-full border px-2 py-0.5 text-sm transition-all hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] active:scale-95",
            info.mine
              ? "border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]"
              : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)]/70 hover:bg-[var(--default)]",
          )}>
          {emoji}<span className="ms-0.5 text-xs font-semibold tabular-nums">{info.count}</span>
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

// On the sender's own (accent) bubble an accent-coloured mention was invisible.
function renderMentions(text: string, isOwn = false) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) =>
    part.startsWith("@")
      ? <mark key={i} dir="ltr" className={cn("rounded px-0.5 font-medium not-italic",
          isOwn ? "bg-white/20 text-[var(--accent-foreground)]" : "bg-[var(--accent)]/10 text-[var(--accent)]")}>{part}</mark>
      : part,
  );
}

type BubbleAction = { id: string; label: string; icon: IconComponent; danger?: boolean; disabled?: boolean; run: () => void };

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

  const hasCopyableText = !!msg.body && !["(Voice message)", "(attachment)"].includes(msg.body) && !isDeleted;
  const primaryActions: BubbleAction[] = [
    { id: "reply", label: t("reply"), icon: Reply, run: () => onReply(msg) },
    { id: "forward", label: t("forward"), icon: Forward, run: () => onForward(msg) },
    ...(hasCopyableText ? [{ id: "copy", label: t("copyText"), icon: Copy, run: () => { navigator.clipboard.writeText(msg.body).catch(() => {}); } }] : []),
    ...(canPin && !isDeleted ? [{ id: "pin", label: msg.isPinned ? t("unpin") : t("pinMessage"), icon: msg.isPinned ? PinOff : Pin, run: () => onPin(msg.id, !msg.isPinned) }] : []),
    ...(isOwn && !isDeleted ? [{ id: "edit", label: canEdit ? t("edit") : t("editExpired"), icon: Edit2, disabled: !canEdit, run: () => { if (canEdit) onEdit(msg); } }] : []),
  ];
  const deleteActions: BubbleAction[] = [
    { id: "delete-me", label: t("deleteForMe"), icon: Trash2, danger: true, run: () => onDeleteForMe(msg.id) },
    // Shown to the owner and to moderators; disabled once the window has passed.
    ...((isOwn || isModerator) ? [{
      id: "delete-everyone",
      label: canDeleteForEveryone ? t("deleteForEveryone") : t("deleteForEveryoneExpired"),
      icon: Trash2, danger: canDeleteForEveryone, disabled: !canDeleteForEveryone,
      run: () => { if (canDeleteForEveryone) onDeleteForEveryone(msg.id); },
    }] : []),
  ];
  const allActions = [...primaryActions, ...deleteActions];
  const menuItem = (action: BubbleAction) => (
    <Dropdown.Item key={action.id} id={action.id} textValue={action.label} variant={action.danger ? "danger" : undefined}>
      <action.icon className={cn("size-4 shrink-0", action.danger ? "text-[var(--danger)]" : "text-[var(--muted)]")} aria-hidden="true" />
      <Label>{action.label}</Label>
    </Dropdown.Item>
  );

  return (
    <div
      className={cn("group flex items-end gap-2", isOwn ? "flex-row-reverse" : "flex-row")}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {!isOwn && <ConvAvatar id={msg.senderId} name={msg.senderName} size="sm" className="mb-1" />}
      <div className={cn("w-fit max-w-[min(78%,42rem)] flex flex-col", isOwn ? "items-end" : "items-start")}>
        {showSender && isGroup && !isOwn && (
          <span dir="auto" className="mb-0.5 px-1 text-xs font-medium text-[var(--accent)]">{msg.senderName}</span>
        )}
        {/* Pinned indicator */}
        {msg.isPinned && (
          <div className="mb-0.5 flex items-center gap-1 px-1 text-xs text-[var(--warning)]">
            <Pin className="size-2.5" aria-hidden="true" /> <span>{t("pinned")}</span>
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
              "text-xs px-3 py-1.5 rounded-t-lg border-s-2 border-[var(--accent)] mb-0.5 max-w-full",
              "cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
              isOwn
                ? "bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/15"
                : "bg-[var(--default)] text-[var(--foreground)]/70 hover:bg-[var(--default-hover)]",
              "transition-colors duration-150",
            )}
          >
            <p dir="auto" className="text-xs font-medium opacity-70">{msg.replySenderName}</p>
            <p dir="auto" className="truncate">{displayBody(msg.replyBody, t)}</p>
          </div>
        )}
        {/* Main bubble */}
        <div className={cn(
          "relative px-3.5 py-2.5 rounded-xl text-sm leading-relaxed break-words [overflow-wrap:anywhere]",
          isDeleted
            ? "border border-dashed border-[var(--border)] bg-[var(--default)] italic text-[var(--muted)]"
            : isOwn
              ? "bg-[var(--accent)] text-[var(--accent-foreground)] rounded-ee-sm"
              : "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] rounded-es-sm",
        )}>
          {isDeleted ? (
            <span className="flex items-center gap-1.5 text-xs"><Ban className="size-3.5" aria-hidden="true" />{t("messageDeleted")}</span>
          ) : (
            <>
              {/* Forwarded label */}
              {isForwarded && (
                <div className="mb-1 flex items-center gap-1 text-xs italic opacity-70">
                  <Forward className="size-3 shrink-0 rtl:-scale-x-100" aria-hidden="true" />
                  <span>{t("forwarded")}</span>
                </div>
              )}
              {/* Message text */}
              {msg.body && msg.body !== "(Voice message)" && (
                <span dir="auto" className="whitespace-pre-wrap">{renderMentions(msg.body, isOwn)}</span>
              )}

              {/* Image attachments — inline preview grid */}
              {images.length > 0 && (
                <div className={cn("mt-1.5 grid gap-1", images.length > 1 ? "grid-cols-2" : "grid-cols-1")}>
                  {images.map((att, i) => att.availabilityStatus === "unavailable" ? (
                    <div key={i} role="status" className="flex min-h-24 items-center justify-center rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-3 text-xs text-[var(--muted)]">{t("fileUnavailable")}</div>
                  ) : (
                    <button key={i} type="button" className="group/img relative cursor-pointer overflow-hidden rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                      onClick={() => onLightbox(att.url)} aria-label={t("openImage", { name: att.name })}>
                      <img src={att.url} alt={att.name}
                        className="max-h-56 w-full rounded-lg object-cover transition-opacity group-hover/img:opacity-90 sm:max-h-64" />
                      <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/20 opacity-0 transition-opacity group-hover/img:opacity-100">
                        <ImageIcon className="size-6 text-white drop-shadow" aria-hidden="true" />
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Voice attachments */}
              {voices.map((att, i) => att.availabilityStatus === "unavailable" ? (
                <div key={i} role="status" className="mt-1.5 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-2.5 py-2 text-xs text-[var(--muted)]">{t("fileUnavailable")}</div>
              ) : <VoicePlayer key={i} url={att.url} duration={att.duration} isOwn={isOwn} />)}

              {/* File attachments */}
              {files.map((att, i) => att.availabilityStatus === "unavailable" ? (
                <div key={i} role="status"
                  className={cn("mt-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs", isOwn ? "bg-white/10 text-white/70" : "border border-[var(--border)] bg-[var(--default)] text-[var(--muted)]")}>
                  <FileTypeIcon name={att.name} /><span className="truncate">{t("fileUnavailable")}</span>
                </div>
              ) : (
                <a key={i} href={att.url} target="_blank" rel="noreferrer" download aria-label={t("downloadAttachment", { name: att.name })}
                  className={cn(
                    "mt-1.5 flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                    isOwn ? "bg-white/10 hover:bg-white/20" : "border border-[var(--border)] bg-[var(--default)] hover:bg-[var(--default-hover)]",
                  )}>
                  <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-md", isOwn ? "bg-white" : "bg-[var(--surface)]")}><FileTypeIcon name={att.name} /></span>
                  <div className="min-w-0 flex-1">
                    <p dir="ltr" className={cn("truncate font-medium rtl:text-end", isOwn ? "text-white" : "text-[var(--foreground)]")} title={att.name}>{att.name}</p>
                    {att.size && <p className={cn("text-xs", isOwn ? "text-white/60" : "text-[var(--muted)]")}><bdi dir="ltr">{formatFileSize(att.size)}</bdi></p>}
                  </div>
                  <DownloadCloud className={cn("size-3.5 shrink-0", isOwn ? "text-white/70" : "text-[var(--muted)]")} aria-hidden="true" />
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
        <div className="mt-0.5 flex items-center gap-1.5 px-1">
          <span className="text-xs tabular-nums text-[var(--muted)]"><bdi dir="ltr">{formatMsgTime(msg.createdAt, i18n.language)}</bdi></span>
          {msg.editedAt && !isDeleted && <span className="text-xs italic text-[var(--muted)]">{t("edited")}</span>}
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
            <Button isIconOnly size="sm" variant="ghost"
              aria-label={t("addReaction")}
              className="size-7 min-w-7 rounded-full text-[var(--muted)] hover:bg-[var(--warning)]/10 hover:text-[var(--warning)]"
              onPress={() => setShowEmojiPicker((v) => !v)}>
              <Smile className="size-3.5" aria-hidden="true" />
            </Button>
            {showEmojiPicker && (
              <EmojiReactionPicker isOwn={isOwn} onPick={(emoji) => {
                onReact(msg.id, emoji);
                setShowEmojiPicker(false);
              }} />
            )}
          </div>
        )}
        {/* More options: also opens on right-click and long-press */}
        <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
          <Button isIconOnly size="sm" variant="ghost"
            aria-label={t("messageOptions")}
            className="size-7 min-w-7 rounded-full text-[var(--muted)] hover:text-[var(--foreground)]">
            <MoreVertical className="size-3.5" aria-hidden="true" />
          </Button>
          <Dropdown.Popover placement={isOwn ? "bottom end" : "bottom start"} className="min-w-56">
            <Dropdown.Menu
              disabledKeys={allActions.filter((action) => action.disabled).map((action) => action.id)}
              onAction={(key) => allActions.find((action) => action.id === key)?.run()}
            >
              <Dropdown.Section>{primaryActions.map(menuItem)}</Dropdown.Section>
              <Dropdown.Section>
                <Separator />
                {deleteActions.map(menuItem)}
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
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
  const { data, isLoading, isError, refetch } = useQuery<{ photos: MediaItem[]; docs: MediaItem[]; voices: MediaItem[] }>({
    queryKey: ["media", convId],
    queryFn: () => apiFetch(`/api/conversations/${convId}/media`),
  });
  const photos = data?.photos ?? [];
  const docs = data?.docs ?? [];
  const voices = data?.voices ?? [];
  const tabs = [
    { id: "photos" as const, label: t("tabPhotos"), count: photos.length },
    { id: "docs" as const, label: t("tabDocs"), count: docs.length },
    { id: "voices" as const, label: t("tabVoice"), count: voices.length },
  ];

  const body = (current: "photos" | "docs" | "voices") => {
    if (isLoading) return <div className="flex min-h-32 items-center justify-center text-sm text-[var(--muted)]" role="status">{t("loading")}</div>;
    if (isError) {
      return (
        <div className="flex min-h-32 flex-col items-center justify-center gap-2 text-center">
          <p className="text-sm text-[var(--muted)]">{t("errLoadMedia")}</p>
          <Button type="button" variant="tertiary" size="sm" onPress={() => void refetch()}>{t("retry")}</Button>
        </div>
      );
    }
    if (current === "photos") {
      return (
        <div className="grid grid-cols-3 gap-1">
          {photos.length === 0 && <p className="col-span-3 py-8 text-center text-xs text-[var(--muted)]">{t("noPhotos")}</p>}
          {photos.map((p, i) => (
            <button key={i} type="button" className="aspect-square cursor-pointer overflow-hidden rounded-lg transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              onClick={() => onLightbox(p.url)} aria-label={t("openImage", { name: p.name })}>
              <img src={p.url} alt={p.name} className="size-full object-cover" />
            </button>
          ))}
        </div>
      );
    }
    if (current === "docs") {
      return (
        <div className="space-y-1.5">
          {docs.length === 0 && <p className="py-8 text-center text-xs text-[var(--muted)]">{t("noDocs")}</p>}
          {docs.map((d, i) => (
            <a key={i} href={d.url} target="_blank" rel="noreferrer" download aria-label={t("downloadAttachment", { name: d.name })}
              className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] p-2.5 no-underline transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
              <FileTypeIcon name={d.name} className="size-5" />
              <div className="min-w-0 flex-1">
                <p dir="ltr" className="truncate text-xs font-medium text-[var(--foreground)] rtl:text-end" title={d.name}>{d.name}</p>
                <p className="text-xs text-[var(--muted)]">
                  {d.size ? <><bdi dir="ltr">{formatFileSize(d.size)}</bdi> · </> : null}{d.senderName.split(" ")[0]}
                </p>
              </div>
              <DownloadCloud className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
            </a>
          ))}
        </div>
      );
    }
    return (
      <div className="space-y-2">
        {voices.length === 0 && <p className="py-8 text-center text-xs text-[var(--muted)]">{t("noVoice")}</p>}
        {voices.map((v, i) => (
          <div key={i} className="rounded-lg border border-[var(--border)] bg-[var(--default)] p-2.5">
            <p className="mb-1.5 text-xs text-[var(--muted)]">
              {v.senderName.split(" ")[0]} · {new Date(v.sentAt).toLocaleDateString(uiLocale(i18n.language), { month: "short", day: "numeric" })}
            </p>
            <VoicePlayer url={v.url} duration={v.duration} isOwn={false} />
          </div>
        ))}
      </div>
    );
  };

  return (
    <aside className="absolute inset-y-0 end-0 z-30 w-full max-w-sm bg-[var(--surface)] border-s border-[var(--border)] shadow-xl flex flex-col" aria-label={t("mediaGallery")}>
      <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
        <div className="flex items-center gap-2">
          <GalleryHorizontal className="size-4 text-[var(--accent)]" aria-hidden="true" />
          <span className="text-sm font-medium">{t("mediaGallery")}</span>
        </div>
        <Button isIconOnly size="sm" variant="ghost" onPress={onClose} aria-label={t("closeMediaGallery")}>
          <X className="size-4" aria-hidden="true" />
        </Button>
      </div>
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as typeof tab)} className="flex min-h-0 flex-1 flex-col">
        <Tabs.ListContainer className="shrink-0 px-3 pt-2">
          <Tabs.List aria-label={t("mediaGallery")} className="w-full">
            {tabs.map((item) => (
              <Tabs.Tab key={item.id} id={item.id} className="flex-1 gap-1 whitespace-nowrap px-2 text-xs">
                {item.label}
                {!isLoading && !isError && <span className="tabular-nums text-[var(--muted)]">({item.count})</span>}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>
        {tabs.map((item) => (
          <Tabs.Panel key={item.id} id={item.id} className="min-h-0 flex-1 overflow-y-auto p-3">
            {body(item.id)}
          </Tabs.Panel>
        ))}
      </Tabs>
    </aside>
  );
}

/* ─── ConversationItem ────────────────────────────────────────────── */
function UnreadCount({ value, label }: { value: number | string; label: string }) {
  return (
    <span className="ms-1 flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] px-1 text-[11px] font-medium tabular-nums text-[var(--accent-foreground)]" aria-label={label}>
      {value}
    </span>
  );
}

function ConversationItem({ conv, selected, onClick }: { conv: ConvSummary; selected: boolean; onClick: () => void }) {
  const { t, i18n } = useTranslation("messages");
  const name = convName(conv, t);
  const subtitle = convSubtitle(conv);
  const isDirect = conv.type === "direct";
  const avatarId = isDirect && conv.otherMemberId ? conv.otherMemberId : conv.id;
  const hasUnread = typeof conv.unreadCount === "number" && conv.unreadCount > 0;
  const unreadLabel = hasUnread ? (conv.unreadCount! > 99 ? "99+" : conv.unreadCount!) : null;
  const preview = conv.lastMessageBody
    ? (conv.lastMessageSenderName && !isDirect
        ? `${conv.lastMessageSenderName.split(" ")[0]}: ${displayBody(conv.lastMessageBody, t)}`
        : displayBody(conv.lastMessageBody, t))
    : null;
  return (
    <button onClick={onClick} type="button" title={name} aria-current={selected ? "page" : undefined}
      className={cn(
        "w-full flex items-center gap-3 px-3.5 py-2.5 text-start transition-colors border-e-2 border-transparent hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]",
        selected && "bg-[var(--accent)]/5 hover:bg-[var(--accent)]/5 border-[var(--accent)]",
      )}>
      <ConvAvatar id={avatarId} name={isDirect ? conv.otherMemberName : null} type={conv.type} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span dir="auto" className={cn("text-sm font-medium truncate", hasUnread ? "text-[var(--foreground)]" : "text-[var(--foreground)]/90")}>{name}</span>
            {conv.type === "announcement" && <Chip size="sm" variant="soft" color="danger" className="shrink-0 text-[10px]">{t("broadcast")}</Chip>}
          </div>
          <span className="text-[11px] text-[var(--muted)] shrink-0 ms-1 tabular-nums">
            {conv.lastMessageAt ? formatTime(conv.lastMessageAt, t, i18n.language) : ""}
          </span>
        </div>
        {isDirect && subtitle && <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{subtitle}</p>}
        <div className="mt-0.5 flex items-center justify-between">
          <p dir="auto" className={cn("flex-1 truncate text-xs text-page-start", hasUnread ? "font-medium text-[var(--foreground)]/80" : "text-[var(--muted)]")}>
            {preview ?? <span className="italic">{t("noMessages")}</span>}
          </p>
          {hasUnread && <UnreadCount value={unreadLabel!} label={`${unreadLabel} ${t("tabUnread")}`} />}
        </div>
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
    <div className="my-3 flex items-center gap-3" role="separator" aria-label={label}>
      <div className="h-px flex-1 bg-[var(--border)]" />
      <Chip size="sm" variant="tertiary" className="whitespace-nowrap text-xs">{label}</Chip>
      <div className="h-px flex-1 bg-[var(--border)]" />
    </div>
  );
}

/** Toggle pill used by the list filters and the creation-type chooser. */
function TogglePill({ pressed, onPress, danger, children }: { pressed: boolean; onPress: () => void; danger?: boolean; children: ReactNode }) {
  return (
    <button type="button" onClick={onPress} aria-pressed={pressed}
      className={cn(
        "flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        pressed
          ? danger ? "border-[var(--danger)] bg-[var(--danger)] text-[var(--danger-foreground)]" : "border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-foreground)]"
          : danger ? "border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)]",
      )}>
      {children}
    </button>
  );
}

/* ─── NewConversationModal ────────────────────────────────────────── */
const ANNOUNCEMENT_TARGET_ROLES = ["super_admin","executive_director","program_manager","senior_program_coordinator","technical_coordinator","state_office_manager","state_program_officer"];

function NewConversationModal({
  open, onClose, onCreate, userRole,
}: {
  open: boolean; onClose: () => void;
  onCreate: (body: Record<string, unknown>) => Promise<void>;
  userRole: string;
}) {
  const { t, i18n } = useTranslation("messages");
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
  const stateOptions = states.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }));
  const sectorOptions = SECTORS.map((s) => ({ value: s, label: s }));
  const selectedState = states.find((s) => String(s.id) === selectedStateId);

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
    catch (e: unknown) { toast.error(apiErrorText(e, t)); }
    finally { setBusy(false); }
  };

  const createTCGroup = () => {
    setType("group");
    setName(t("tcGroupName"));
    setDescription(t("tcGroupDescription"));
  };

  const availableTypes: string[] = ["direct", "group", "project", "state", "sector"];
  if (canAnnounce) availableTypes.push("announcement");

  const close = () => { onClose(); reset(); };

  return (
    <Modal isOpen={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Modal.Backdrop isDismissable={!busy}>
        <Modal.Container size="md" scroll="inside">
          <Modal.Dialog className="w-[calc(100%-1.5rem)] sm:max-w-md max-h-[min(90vh,42rem)]">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{confirmStep ? t("confirmAnnouncement") : t("newConversation")}</Modal.Heading>
              <p className="sr-only">{confirmStep ? t("confirmAnnouncementDescription") : t("newConversationDescription")}</p>
            </Modal.Header>

            <Modal.Body className="space-y-4">
              {confirmStep ? (
                <Alert status="danger">
                  <Alert.Indicator><Megaphone className="size-4" aria-hidden="true" /></Alert.Indicator>
                  <Alert.Content>
                    <Alert.Title>{t("broadcastAnnouncement")}</Alert.Title>
                    <Alert.Description className="space-y-2">
                      <span dir="auto" className="block font-medium text-[var(--foreground)]">{name}</span>
                      <span className="block text-xs">
                        {t("recipients")}:{" "}
                        {announcementTarget === "all" && t("allActiveUsers")}
                        {announcementTarget === "state" && `${t("stateLabel")}: ${selectedState ? (i18n.language.startsWith("ar") ? selectedState.nameAr || selectedState.name : selectedState.name) : selectedStateId}`}
                        {announcementTarget === "sector" && `${t("sectorLabel")}: ${selectedSector}`}
                        {announcementTarget === "role" && `${t("roleLabel")}: ${t(`role_${announcementRole}`)}`}
                      </span>
                      <span className="block text-xs font-medium">{t("announcementWarning")}</span>
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : (
                <>
                  {/* Quick actions */}
                  {(userRole === "super_admin" || userRole === "program_manager" || userRole === "executive_director") && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-[var(--muted)]">{t("quickCreate")}</p>
                      <button type="button" onClick={createTCGroup}
                        className="flex w-full items-center gap-2 rounded-xl border border-[var(--border)] px-3 py-2 text-start text-sm transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                        <Users className="size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                        <span className="font-medium">{t("tcGroupName")}</span>
                        <span className="ms-auto text-xs text-[var(--muted)]">{t("autoFill")}</span>
                      </button>
                    </div>
                  )}

                  {/* Type selector */}
                  <div className="space-y-1.5">
                    <p className="text-xs font-medium text-[var(--muted)]">{t("typeLabel")}</p>
                    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("typeLabel")}>
                      {availableTypes.map((typeKey) => {
                        const Icon = typeIcon(typeKey);
                        return (
                          <TogglePill key={typeKey} pressed={type === typeKey} danger={typeKey === "announcement"}
                            onPress={() => { setType(typeKey); setSelectedSector(""); setSelectedStateId(""); }}>
                            <Icon className="size-3" aria-hidden="true" />{t(`type_${typeKey}`)}
                          </TogglePill>
                        );
                      })}
                    </div>
                  </div>

                  {type === "announcement" ? (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="announcement-subject" isRequired>{t("subjectLabel")}</Label>
                        <Input id="announcement-subject" fullWidth dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("announcementSubjectPlaceholder")} />
                      </div>
                      <div className="space-y-1.5">
                        <p className="text-xs font-medium text-[var(--muted)]">{t("recipients")}</p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label={t("recipients")}>
                          {(["all", "state", "sector", "role"] as const).map((target) => (
                            <TogglePill key={target} pressed={announcementTarget === target} onPress={() => setAnnouncementTarget(target)}>
                              {target === "all" ? t("allUsers") : target === "state" ? t("byState") : target === "sector" ? t("bySector") : t("byRole")}
                            </TogglePill>
                          ))}
                        </div>
                        {announcementTarget === "state" && (
                          <SelectField aria-label={t("stateLabel")} placeholder={t("selectStatePlaceholder")} value={selectedStateId} onChange={setSelectedStateId} className="mt-2" options={stateOptions} />
                        )}
                        {announcementTarget === "sector" && (
                          <SelectField aria-label={t("sectorLabel")} placeholder={t("selectSectorPlaceholder")} value={selectedSector} onChange={setSelectedSector} className="mt-2" options={sectorOptions} />
                        )}
                        {announcementTarget === "role" && (
                          <SelectField aria-label={t("roleLabel")} placeholder={t("selectRolePlaceholder")} value={announcementRole} onChange={setAnnouncementRole} className="mt-2"
                            options={ANNOUNCEMENT_TARGET_ROLES.map((r) => ({ value: r, label: t(`role_${r}`) }))} />
                        )}
                      </div>
                    </div>
                  ) : (
                    <>
                      {/* Name */}
                      {type !== "direct" && type !== "state" && type !== "sector" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="conversation-name" isRequired>{t("nameLabel")}</Label>
                          <Input id="conversation-name" fullWidth dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t("conversationNamePlaceholder")} />
                        </div>
                      )}
                      {/* Description for groups */}
                      {type === "group" && (
                        <div className="space-y-1.5">
                          <Label htmlFor="conversation-description">{t("descriptionLabel")}</Label>
                          <Input id="conversation-description" fullWidth dir="auto" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={t("descriptionPlaceholder")} />
                        </div>
                      )}
                      {type === "state" && (
                        <SelectField id="conversation-state" label={t("stateLabel")} isRequired placeholder={t("selectStatePlaceholder")} value={selectedStateId} onChange={setSelectedStateId} options={stateOptions} />
                      )}
                      {type === "sector" && (
                        <SelectField id="conversation-sector" label={t("sectorLabel")} isRequired placeholder={t("selectSectorPlaceholder")} value={selectedSector} onChange={setSelectedSector} options={sectorOptions} />
                      )}
                      {/* Member search */}
                      {(type === "direct" || type === "group" || type === "project") && (
                        <div className="space-y-1.5">
                          <Label htmlFor="conversation-member-search" isRequired={type === "direct"}>
                            {type === "direct" ? t("selectUserLabel") : t("addMembersLabel")}
                          </Label>
                          {selectedUsers.length > 0 && (
                            <div className="flex flex-wrap gap-1.5" aria-label={t("selectedMembers")}>
                              {selectedUsers.map((u) => (
                                <Chip key={u.id} size="sm" variant="soft" color="accent" className="max-w-full gap-1 pe-1">
                                  <span className="truncate" title={u.name}>{u.name}</span>
                                  <button type="button" aria-label={t("removeMember", { name: u.name })} onClick={() => setSelectedUsers((s) => s.filter((x) => x.id !== u.id))}
                                    className="flex size-4 shrink-0 items-center justify-center rounded-full hover:bg-[var(--accent)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                                    <X className="size-2.5" aria-hidden="true" />
                                  </button>
                                </Chip>
                              ))}
                            </div>
                          )}
                          <SearchField aria-label={type === "direct" ? t("selectUserLabel") : t("addMembersLabel")} value={userSearch} onChange={setUserSearch}>
                            <SearchField.Group>
                              <SearchField.SearchIcon />
                              <SearchField.Input id="conversation-member-search" placeholder={t("searchUserPlaceholder")} />
                              <SearchField.ClearButton />
                            </SearchField.Group>
                          </SearchField>
                          {filteredUsers.length > 0 && (
                            <div className="max-h-40 overflow-y-auto rounded-xl border border-[var(--border)]" role="listbox" aria-label={t("memberResults")}>
                              {filteredUsers.slice(0, 8).map((u) => (
                                <button key={u.id}
                                  type="button"
                                  role="option"
                                  aria-selected={false}
                                  aria-label={`${u.name}, ${u.roleLabel}`}
                                  onClick={() => {
                                    setSelectedUsers((s) => type === "direct" ? [u] : [...s, u]);
                                    setUserSearch("");
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-start hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]">
                                  <ConvAvatar id={u.id} name={u.name} size="sm" />
                                  <div className="min-w-0 flex-1">
                                    <p dir="auto" className="truncate text-sm font-medium text-page-start">{u.name}</p>
                                    <p className="truncate text-xs text-[var(--muted)]">{u.roleLabel}</p>
                                  </div>
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </Modal.Body>

            <Modal.Footer>
              {confirmStep ? (
                <>
                  <Button variant="tertiary" onPress={() => setConfirmStep(false)} isDisabled={busy}>{t("back")}</Button>
                  <Button variant="danger" onPress={() => { void handleSubmit(); }} isPending={busy}>
                    <Megaphone className="size-4" aria-hidden="true" />
                    {busy ? t("sending") : t("sendAnnouncement")}
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="tertiary" onPress={close} isDisabled={busy}>{t("cancel")}</Button>
                  <Button variant={type === "announcement" ? "danger" : "primary"} onPress={handleNext} isPending={busy}>
                    {busy ? t("creating") : type === "announcement" ? t("previewArrow") : t("startConversation")}
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
    <Modal isOpen onOpenChange={(o) => { if (!o) onClose(); }}>
      <Modal.Backdrop isDismissable>
        <Modal.Container size="sm" scroll="inside">
          <Modal.Dialog>
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2"><Forward className="size-4 rtl:-scale-x-100" aria-hidden="true" /> {t("forwardMessage")}</Modal.Heading>
              <p className="sr-only">{t("forwardMessageDescription")}</p>
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <blockquote dir="auto" className="truncate rounded-xl border border-[var(--border)] bg-[var(--default)] p-3 text-sm italic text-[var(--muted)]">
                {displayBody(msg.body, t).slice(0, 100)}{msg.body.length > 100 ? "…" : ""}
              </blockquote>
              <SearchField aria-label={t("searchConversations")} value={search} onChange={setSearch}>
                <SearchField.Group>
                  <SearchField.SearchIcon />
                  <SearchField.Input id="forward-conversation-search" placeholder={t("searchConversations")} />
                  <SearchField.ClearButton />
                </SearchField.Group>
              </SearchField>
              <div className="max-h-56 divide-y divide-[var(--border)] overflow-y-auto rounded-xl border border-[var(--border)]">
                {filtered.map((c) => (
                  <button key={c.id} type="button" onClick={() => onForward(c.id)}
                    className="flex w-full items-center gap-2.5 px-3 py-2.5 text-start transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]">
                    <ConvAvatar id={c.type === "direct" && c.otherMemberId ? c.otherMemberId : c.id} name={c.type === "direct" ? c.otherMemberName : null} type={c.type} />
                    <div className="min-w-0 flex-1">
                      <p dir="auto" className="truncate text-sm font-medium text-page-start">{convName(c, t)}</p>
                      {c.memberCount > 0 && <p className="text-xs text-[var(--muted)]">{c.memberCount} {t("membersCount")}</p>}
                    </div>
                  </button>
                ))}
              </div>
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose}>{t("cancel")}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
  /* One object URL per recording, released when it is replaced or discarded. */
  const voicePreviewUrl = useMemo(() => voiceBlob ? URL.createObjectURL(voiceBlob) : null, [voiceBlob]);
  useEffect(() => () => { if (voicePreviewUrl) URL.revokeObjectURL(voicePreviewUrl); }, [voicePreviewUrl]);

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
        toast.error(apiErrorText(e, t));
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
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
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
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
  });

  const pinMut = useMutation({
    mutationFn: ({ msgId, shouldPin }: { msgId: number; shouldPin: boolean }) =>
      apiFetch(`/api/messages/${msgId}/pin`, { method: shouldPin ? "POST" : "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["messages", selectedId] });
      qc.invalidateQueries({ queryKey: ["pinned", selectedId] });
    },
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
  });

  const reactionMut = useMutation({
    mutationFn: ({ msgId, emoji }: { msgId: number; emoji: string }) =>
      apiFetch(`/api/messages/${msgId}/reactions`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["messages", selectedId] }),
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
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
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
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
    onError: (e: Error) => toast.error(apiErrorText(e, t)),
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

  // Confirmed in a ConfirmModal (the native confirm() had browser-language buttons).
  const [deleteEveryoneId, setDeleteEveryoneId] = useState<number | null>(null);
  const handleDeleteForEveryone = useCallback((id: number) => {
    setDeleteEveryoneId(id);
  }, []);

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

  const iconButton = "size-10 min-w-10 shrink-0 rounded-xl";

  return (
    <div className="-m-4 md:-m-5 lg:-m-6 xl:-m-8 h-[calc(100dvh-4rem)] min-h-[32rem] flex overflow-hidden bg-[var(--surface)] border-y border-[var(--border)] md:border md:rounded-xl">

      {/* ── Conversation list ───────────────────────────────────── */}
      <div className={cn(
        "flex flex-col bg-[var(--surface)] border-e border-[var(--border)]",
        "w-full md:w-[clamp(18rem,24vw,22rem)] shrink-0",
        selectedId ? "hidden md:flex" : "flex",
      )}>
        <div className="space-y-3 border-b border-[var(--border)] px-4 pb-2.5 pt-3.5">
          <div className="flex items-center justify-between gap-3">
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <MessageSquare className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              {t("title")}
            </h1>
            {/* Icon-only so the page title keeps one line in the narrow list. */}
            <Tooltip delay={300}>
              <Button isIconOnly onPress={() => setNewChatOpen(true)} size="sm" className="shrink-0" aria-label={t("newChat")}>
                <Plus className="size-4" aria-hidden="true" />
              </Button>
              <Tooltip.Content>{t("newChat")}</Tooltip.Content>
            </Tooltip>
          </div>
          <SearchField aria-label={t("searchConversations")} value={searchQ} onChange={setSearchQ}>
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("searchConversations")} />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <div className="scrollbar-hide -mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label={t("filterConversations")}>
            {TABS.map((tab) => (
              <TogglePill key={tab.id} pressed={filterTab === tab.id} onPress={() => setFilterTab(tab.id)}>
                {tab.label}
                {(tab.badge ?? 0) > 0 && (
                  <span className={cn("rounded-full px-1.5 text-[10px] leading-4 tabular-nums",
                    filterTab === tab.id ? "bg-white/25" : "bg-[var(--accent)] text-[var(--accent-foreground)]")}>
                    {tab.badge}
                  </span>
                )}
              </TogglePill>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {convsLoading ? (
            <div className="divide-y divide-[var(--border)]" aria-hidden="true">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <Skeleton className="size-9 shrink-0 rounded-full" />
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-3/4 rounded-md" />
                    <Skeleton className="h-3 w-1/2 rounded-md" />
                  </div>
                  <Skeleton className="h-3 w-8 shrink-0 rounded-md" />
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
            <div className="flex h-full flex-col items-center justify-center px-4 py-12 text-center">
              {filterTab !== "all" || searchQ.trim()
                ? <Search className="mb-3 size-8 text-[var(--muted)] opacity-40" aria-hidden="true" />
                : <MessageSquare className="mb-3 size-9 text-[var(--muted)] opacity-40" aria-hidden="true" />}
              <p className="text-sm font-medium text-[var(--muted)]">
                {filterTab !== "all" || searchQ.trim() ? t("noFilteredConversations") : t("noConversations")}
              </p>
              {filterTab === "all" && !searchQ.trim() && (
                <p className="mt-1 text-xs text-[var(--muted)]">{t("noConversationsHint")}</p>
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
                  <p className="mb-2 text-xs text-[var(--danger)]">{t("errLoadMoreConversations")}</p>
                  <Button size="sm" variant="tertiary" onPress={handleFetchMoreConversations}>
                    {t("loadMoreConversations")}
                  </Button>
                </div>
              ) : hasMoreConversations ? (
                <div className="flex justify-center border-t border-[var(--border)] p-2.5">
                  <Button size="sm" variant="ghost" isPending={isFetchingMoreConversations} onPress={handleFetchMoreConversations}>
                    {isFetchingMoreConversations ? t("loadingMoreConversations") : t("loadMoreConversations")}
                  </Button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {/* ── Chat + gallery ──────────────────────────────────────── */}
      {!selectedId ? (
        <div className="hidden md:flex flex-1 items-center justify-center bg-[var(--background)]">
          <div className="max-w-sm px-6 text-center">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-[var(--accent)]/10">
              <MessageSquare className="size-6 text-[var(--accent)]" aria-hidden="true" />
            </div>
            <p className="font-medium">{t("selectConversation")}</p>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("selectConversationHint")}</p>
            <Button onPress={() => setNewChatOpen(true)} size="sm" className="mt-4">
              <Plus className="size-4" aria-hidden="true" /> {t("newConversation")}
            </Button>
          </div>
        </div>
      ) : (
      <div className="relative flex flex-1 min-w-0 overflow-hidden">
          {/* Chat window */}
          <div className={cn("flex flex-col flex-1 min-w-0 relative", selectedId ? "flex" : "hidden md:flex")}>
            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-2.5 min-h-16 bg-[var(--surface)] border-b border-[var(--border)] shrink-0">
              <Button isIconOnly variant="ghost" className="md:hidden shrink-0 -ms-1 size-9 min-w-9" aria-label={t("backToConversations")} onPress={() => navigate("/messages")}>
                <ArrowLeft className="size-5 rtl:rotate-180" aria-hidden="true" />
              </Button>
              {convDetail && (
                <>
                  <div className="relative shrink-0">
                    <ConvAvatar
                      id={convDetail.type === "direct" ? convDetail.otherMemberId ?? convDetail.id : convDetail.id}
                      name={convDetail.type === "direct" ? convDetail.otherMemberName : null}
                      type={convDetail.type}
                    />
                    {presence?.online && (
                      <span className="absolute -bottom-0.5 -end-0.5 size-3 rounded-full border-2 border-[var(--surface)] bg-[var(--success)]" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <p dir="auto" className="truncate text-sm font-medium text-page-start" title={convName(convDetail, t)}>{convName(convDetail, t)}</p>
                      {isAnnouncement && <Chip size="sm" variant="soft" color="danger" className="shrink-0 text-[10px]">{t("broadcast")}</Chip>}
                    </div>
                    <p className="truncate text-xs text-[var(--muted)]">
                      {convDetail.type === "direct"
                        ? presence
                          ? <span className={cn("flex items-center gap-1", presence.online ? "text-[var(--success)]" : "")}>
                              {presence.online && <CircleFill className="size-2 text-[var(--success)]" aria-hidden="true" />}
                              {presence.online ? t("online") : presence.label}
                              {!presence.online && convSubtitle(convDetail) && ` · ${convSubtitle(convDetail)}`}
                            </span>
                          : convSubtitle(convDetail) ?? t("convNameDirect")
                        : (
                          <>
                            {t("memberCount", { count: convDetail.memberCount })}
                            {convDetail.members?.length > 0 && (
                              <span className="ms-1">· {convDetail.members.slice(0, 3).map((m) => m.name.split(" ")[0]).join("، ")}</span>
                            )}
                          </>
                        )}
                    </p>
                  </div>
                  <Chip size="sm" variant="tertiary" className="hidden shrink-0 sm:inline-flex">
                    {t(`type_${convDetail.type}`)}
                  </Chip>
                  <Button isIconOnly variant="ghost" size="sm" className="shrink-0 text-[var(--muted)]" aria-pressed={galleryOpen}
                    onPress={() => setGalleryOpen((v) => !v)} aria-label={t("mediaGallery")}>
                    <GalleryHorizontal className="size-4" aria-hidden="true" />
                  </Button>
                </>
              )}
            </div>

            {/* Pinned messages bar */}
            {pinnedMsgs.length > 0 && (
              <button
                type="button"
                aria-expanded={pinnedOpen}
                aria-controls="pinned-messages-panel"
                className="flex shrink-0 items-center gap-2 border-b border-[var(--warning)]/20 bg-[var(--warning)]/10 px-4 py-2 text-start text-xs transition-colors hover:bg-[var(--warning)]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
                onClick={() => setPinnedOpen((v) => !v)}>
                <Pin className="size-3 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                <div className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-[var(--warning)]">{t("pinnedLabel")}: </span>
                  <span dir="auto" className="text-[var(--foreground)]/80">
                    {displayBody(pinnedMsgs[0].body, t).slice(0, 70) || t("attachmentPlaceholder")}
                  </span>
                </div>
                {pinnedMsgs.length > 1 && (
                  <span className="shrink-0 font-medium text-[var(--warning)]">{t("pinnedCount", { count: pinnedMsgs.length })}</span>
                )}
              </button>
            )}

            {/* Pinned messages panel (overlay on the inline end) */}
            {pinnedOpen && (
              <div id="pinned-messages-panel" className="absolute inset-y-0 end-0 z-20 h-full w-full max-w-sm bg-[var(--surface)] border-s border-[var(--border)] flex flex-col shadow-xl">
                <div className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-4 py-3">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <Pin className="size-4 text-[var(--warning)]" aria-hidden="true" /> {t("pinnedMessages")}
                    <span className="font-normal tabular-nums text-[var(--muted)]">({pinnedMsgs.length})</span>
                  </div>
                  <Button isIconOnly size="sm" variant="ghost" aria-label={t("closePinnedMessages")} onPress={() => setPinnedOpen(false)}>
                    <X className="size-4" aria-hidden="true" />
                  </Button>
                </div>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
                  {pinnedMsgs.length === 0 ? (
                    <p className="py-8 text-center text-sm text-[var(--muted)]">{t("noPinnedMessages")}</p>
                  ) : (
                    pinnedMsgs.map((p) => (
                      <div key={p.id} className="rounded-xl border border-[var(--warning)]/20 bg-[var(--warning)]/5 p-3">
                        <p dir="auto" className="mb-1 truncate text-xs font-medium text-[var(--warning)] text-page-start" title={p.senderName}>{p.senderName}</p>
                        <p dir="auto" className="line-clamp-3 text-sm break-words [overflow-wrap:anywhere] text-page-start">{displayBody(p.body, t) || t("attachmentPlaceholder")}</p>
                        <p className="mt-1.5 text-xs text-[var(--muted)]">
                          {t("pinnedBy", { name: p.pinnedByName ?? t("someone") })} · <bdi dir="ltr">{formatMsgTime(p.pinnedAt, i18n.language)}</bdi>
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Messages area */}
            <div ref={messagesScrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 sm:px-5 py-3.5 space-y-0.5 bg-[var(--background)]">
              {msgsLoading ? (
                <div className="flex flex-col gap-3.5 py-2" aria-hidden="true">
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
                      {!row.own && <Skeleton className="mb-0.5 size-7 shrink-0 rounded-full" />}
                      <div className={cn("flex flex-col gap-1", row.own ? "items-end" : "items-start")}>
                        {row.widths.map((w, j) => (
                          <Skeleton key={j} className={cn("h-9 rounded-2xl", w)} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : msgsError ? (
                <div className="flex h-full items-center justify-center">
                  <ErrorState
                    variant="server"
                    title={t("errLoadMessages")}
                    description={t("errLoadMessagesDesc")}
                    onRetry={() => refetchMsgs()}
                  />
                </div>
              ) : grouped.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center py-12 text-center">
                  <div className="mx-auto mb-3 flex size-11 items-center justify-center rounded-xl bg-[var(--accent)]/10">
                    <MessageSquare className="size-5 text-[var(--accent)]" aria-hidden="true" />
                  </div>
                  <p className="text-sm font-medium">{t("noMessages")}</p>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">{t("noMessagesHint")}</p>
                </div>
              ) : (
                <>
                  {hasOlderMessages && (
                    <div className="flex justify-center py-2">
                      <Button variant="ghost" size="sm" isPending={isFetchingOlderMessages} onPress={() => void handleLoadOlderMessages()}>
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
              <div className="px-5 pb-1" aria-live="polite">
                <span className="flex items-center gap-1.5 text-xs italic text-[var(--muted)]">
                  <span className="flex gap-0.5" aria-hidden="true">
                    {[0, 150, 300].map((d) => (
                      <span key={d} className="size-1 animate-bounce rounded-full bg-[var(--muted)]" style={{ animationDelay: `${d}ms` }} />
                    ))}
                  </span>
                  {typingUsers.length === 1
                    ? t("typingOne", { names: typingUsers[0] })
                    : t("typingMany", { names: typingUsers.slice(0, 2).join("، ") })}
                </span>
              </div>
            )}

            {/* Reply / Edit preview bar */}
            {(replyTo || editingMsg) && (
              <div className="flex items-start gap-3 border-t border-[var(--border)] bg-[var(--default)] px-4 py-2">
                <div className={cn("w-0.5 shrink-0 self-stretch rounded-full", replyTo ? "bg-[var(--accent)]" : "bg-[var(--warning)]")} />
                <div className="min-w-0 flex-1">
                  <p className={cn("mb-0.5 text-xs font-semibold", replyTo ? "text-[var(--accent)]" : "text-[var(--warning)]")}>
                    {replyTo ? t("replyingTo", { name: replyTo.senderName }) : t("editingMessage")}
                  </p>
                  <p dir="auto" className="truncate text-xs text-[var(--muted)] text-page-start">{displayBody(replyTo ? replyTo.body : editingMsg?.body, t)}</p>
                </div>
                <Button isIconOnly size="sm" variant="ghost" className="size-6 min-w-6 shrink-0"
                  aria-label={t("cancelReplyOrEdit")}
                  onPress={() => { setReplyTo(null); setEditingMsg(null); setEditBody(""); }}>
                  <X className="size-3.5" aria-hidden="true" />
                </Button>
              </div>
            )}

            {/* Pending files preview */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2" aria-label={t("pendingAttachments")}>
                {pendingFiles.map((f, i) => (
                  <div key={i} className="relative min-w-0">
                    {f.type === "image" && pendingImagePreviews[pendingFiles.filter((x,j) => j < i && x.type === "image").length] ? (
                      <div className="relative size-14 overflow-hidden rounded-lg border border-[var(--border)] shadow-sm">
                        <img src={pendingImagePreviews[pendingFiles.filter((x,j) => j < i && x.type === "image").length]}
                          alt={f.name} className="size-full object-cover" />
                        <button type="button" aria-label={t("removeAttachment", { name: f.name })} onClick={() => {
                          const imgIdx = pendingFiles.slice(0, i).filter(x => x.type === "image").length;
                          setPendingFiles((p) => p.filter((_, j) => j !== i));
                          setPendingImagePreviews((p) => p.filter((_, j) => j !== imgIdx));
                        }} className="absolute end-0.5 top-0.5 flex size-5 items-center justify-center rounded-full bg-black/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                          <X className="size-2.5 text-white" aria-hidden="true" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex max-w-[min(15rem,calc(100vw-2rem))] items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--default)] px-2.5 py-1.5">
                        <FileTypeIcon name={f.name} className="size-3.5" />
                        <span dir="ltr" className="max-w-40 truncate text-xs" title={f.name}>{f.name}</span>
                        {f.size ? <span className="shrink-0 text-[10px] text-[var(--muted)]"><bdi dir="ltr">{formatFileSize(f.size)}</bdi></span> : null}
                        <button type="button" aria-label={t("removeAttachment", { name: f.name })} onClick={() => setPendingFiles((p) => p.filter((_, j) => j !== i))}
                          className="shrink-0 rounded-full text-[var(--muted)] hover:text-[var(--danger)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
                          <X className="size-3" aria-hidden="true" />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Composer */}
            {canSend ? (
              <div className="px-3 sm:px-4 py-2.5 bg-[var(--surface)] border-t border-[var(--border)] shrink-0 relative">
                {/* @mentions typeahead overlay */}
                {mentionQuery !== null && mentionOptions.length > 0 && (
                  <div id="message-mention-options" role="listbox" aria-label={t("mentionSuggestions")} className="absolute inset-x-4 bottom-full z-40 mb-1 max-h-56 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--overlay)] shadow-xl">
                    {mentionOptions.map((m, index) => (
                      <button id={`mention-option-${m.id}`} key={m.id} type="button"
                        onMouseDown={(e) => { e.preventDefault(); selectMention(m); }}
                        role="option" aria-selected={index === mentionActiveIndex}
                        className={cn("flex w-full items-center gap-2.5 px-3 py-2 text-start text-sm transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]", index === mentionActiveIndex && "bg-[var(--default)]")}>
                        <ConvAvatar id={m.id} name={m.name} size="sm" />
                        <span dir="auto" className="flex-1 font-medium text-page-start">{m.name}</span>
                        <span dir="ltr" className="text-xs text-[var(--muted)]">@{m.name.split(" ")[0]}</span>
                      </button>
                    ))}
                  </div>
                )}
                {editingMsg ? (
                  <div className="flex items-end gap-2">
                    <textarea ref={inputRef} value={editBody} onChange={(e) => setEditBody(e.target.value)}
                      rows={1} placeholder={t("editMessagePlaceholder")} aria-label={t("editingMessage")} dir={editBody ? "auto" : undefined}
                      className="flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--field-background)] px-4 py-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] min-h-[40px] max-h-32"
                      onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleEditSubmit(); }}} />
                    <Button isIconOnly onPress={() => { void handleEditSubmit(); }} isDisabled={!editBody.trim()} isPending={editMut.isPending}
                      aria-label={t("saveEdit")} className={iconButton}>
                      <Check className="size-4" aria-hidden="true" />
                    </Button>
                    <Button isIconOnly variant="ghost" className={iconButton}
                      aria-label={t("cancelEdit")}
                      onPress={() => { setEditingMsg(null); setEditBody(""); }}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : voiceState === "recording" ? (
                  /* ─ Recording state ─ */
                  <div className="flex items-center gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger)]/10 px-3 py-2.5" role="status">
                      <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-[var(--danger)]" aria-hidden="true" />
                      <span className="truncate text-sm font-medium text-[var(--danger)]">{t("recording")}</span>
                      <span className="ms-auto font-mono text-sm tabular-nums text-[var(--danger)]"><bdi dir="ltr">{formatDuration(recordingSeconds)}</bdi></span>
                    </div>
                    <Button isIconOnly variant="danger" onPress={stopVoiceRecording}
                      aria-label={t("stopRecording")} className={iconButton}>
                      <StopCircle className="size-5" aria-hidden="true" />
                    </Button>
                    <Button isIconOnly variant="ghost" className={iconButton} aria-label={t("cancelRecording")} onPress={cancelVoiceRecording}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : voiceState === "preview" && voiceBlob ? (
                  /* ─ Voice preview state ─ */
                  <div className="flex items-center gap-2">
                    <div className="flex-1 min-w-0 bg-[var(--default)] border border-[var(--border)] rounded-xl px-2 py-1.5">
                      <VoicePlayer url={voicePreviewUrl ?? ""} duration={voiceDuration} isOwn={false} />
                    </div>
                    <Button isIconOnly onPress={() => { void sendVoiceMessage(); }} isDisabled={!isOnline || sendMut.isPending} isPending={uploadBusy}
                      aria-label={t("sendVoiceMessage")} className={iconButton}>
                      <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                    </Button>
                    <Button isIconOnly variant="ghost" className={iconButton} aria-label={t("discardVoiceMessage")} onPress={cancelVoiceRecording}>
                      <X className="size-4" aria-hidden="true" />
                    </Button>
                  </div>
                ) : (
                  /* ─ Normal input state ─ */
                  <div className="relative">
                    {/* Emoji picker popup */}
                    {emojiPickerOpen && (
                      <div ref={emojiPickerRef}
                        className="absolute bottom-full end-0 z-30 mb-2 max-h-[min(24rem,70dvh)] w-[min(352px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl shadow-xl">
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
                          <Button isIconOnly variant="ghost"
                            className={cn(iconButton, "text-[var(--muted)] hover:text-[var(--accent)]")}
                            onPress={() => fileInputRef.current?.click()} isDisabled={!isOnline} isPending={uploadBusy} aria-label={t("attachFile")}
                            aria-describedby={!isOnline ? "message-attachment-online-notice" : undefined}>
                            <Paperclip className="size-4" aria-hidden="true" />
                          </Button>
                          <Button isIconOnly variant="ghost"
                            className={cn(iconButton, "text-[var(--muted)] hover:text-[var(--danger)]")}
                            onPress={() => { void startVoiceRecording(); }} isDisabled={!isOnline || uploadBusy} aria-label={t("recordVoice")}
                            aria-describedby={!isOnline ? "message-attachment-online-notice" : undefined}>
                            <Mic className="size-4" aria-hidden="true" />
                          </Button>
                        </>
                      )}
                      <textarea ref={inputRef} value={inputText}
                        onChange={handleInputChange}
                        onKeyDown={handleKeyDown}
                        dir={inputText ? "auto" : undefined}
                        aria-label={isAnnouncement ? t("announcementFollowUpPlaceholder") : t("typeMessage")}
                        aria-expanded={mentionOptions.length > 0}
                        aria-controls={mentionOptions.length > 0 ? "message-mention-options" : undefined}
                        aria-activedescendant={mentionOptions[mentionActiveIndex] ? `mention-option-${mentionOptions[mentionActiveIndex].id}` : undefined}
                        rows={1} placeholder={isAnnouncement ? t("announcementFollowUpPlaceholder") : t("typeMessagePlaceholder")}
                        className="flex-1 min-w-0 resize-none rounded-xl border border-[var(--border)] bg-[var(--field-background)] px-3 sm:px-4 py-2.5 text-sm outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--focus)] min-h-[40px] max-h-32" />
                      {/* Emoji input button */}
                      <Button isIconOnly variant="ghost"
                        className={cn(iconButton, emojiPickerOpen ? "bg-[var(--warning)]/10 text-[var(--warning)]" : "text-[var(--muted)] hover:bg-[var(--warning)]/10 hover:text-[var(--warning)]")}
                        onPress={() => setEmojiPickerOpen((v) => !v)}
                        aria-expanded={emojiPickerOpen}
                        aria-label={t("insertEmoji")}>
                        <Smile className="size-4" aria-hidden="true" />
                      </Button>
                      <Button isIconOnly onPress={() => { void handleSend(); }}
                        isDisabled={(!inputText.trim() && pendingFiles.length === 0) || (pendingFiles.length > 0 && !isOnline) || sendMut.isPending || uploadBusy}
                        aria-label={t("sendMessage")}
                        className={iconButton}>
                        <Send className="size-4 rtl:-scale-x-100" aria-hidden="true" />
                      </Button>
                    </div>
                    {!isOnline && canUploadAttachments && (
                      <p id="message-attachment-online-notice" role="status" className="mt-2 text-xs text-[var(--muted)]">
                        {t("attachmentOnlineRequired")}
                      </p>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex shrink-0 items-center justify-center border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3">
                <p className="flex items-center gap-1.5 text-xs italic text-[var(--muted)]">
                  <Megaphone className="size-3.5" aria-hidden="true" />
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

      <ConfirmModal
        isOpen={deleteEveryoneId !== null}
        title={t("deleteForEveryone")}
        message={t("confirmDeleteEveryone")}
        cancelLabel={t("cancel")}
        confirmLabel={t("deleteForEveryone")}
        isPending={deleteMut.isPending}
        onCancel={() => setDeleteEveryoneId(null)}
        onConfirm={() => {
          if (deleteEveryoneId !== null) deleteMut.mutate({ msgId: deleteEveryoneId, deletionType: "for_everyone" });
          setDeleteEveryoneId(null);
        }}
      />

      <NewConversationModal open={newChatOpen} onClose={() => setNewChatOpen(false)}
        onCreate={(body) => createConvMut.mutateAsync(body)} userRole={myRole} />
    </div>
  );
}
