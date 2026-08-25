import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import {
  Search, FolderKanban, ChartNoAxesColumn, User, Loader2, X, Clock,
  AlertTriangle, CalendarClock, Paperclip, LayoutDashboard,
  MapPin, PieChart, ShieldAlert, UserCog, Bell, MessageSquare,
  BookOpen, Database, Bot, BookMarked, Archive,
  RefreshCw, ArrowRight, Zap, Star,
} from "lucide-react";
import { useGetMe } from "@workspace/api-client-react";
import { useRecentItems } from "@/hooks/use-recent-items";
import { timeAgo } from "@/lib/recent-items";
import { useFavorites } from "@/hooks/use-favorites";
import { rankScore, buildRecentMap } from "@/lib/favorites";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { getLinkedStateLabel } from "@/components/state-label";

/* ─── API result types (matches /api/search response) ─────────────────── */
interface ApiProject {
  id: number; code: string; title: string; status: string; sector: string | null;
}
interface ApiPlan {
  id: number; title: string; code: string; planType: string | null; status: string;
  projectTitle: string | null; stateName: string | null; stateNameAr?: string | null; updatedAt: string | null;
}
interface ApiReport {
  id: number; title: string; kind: string | null; status: string;
  reportType: string | null; projectTitle: string | null;
  stateName: string | null; stateNameAr?: string | null; updatedAt: string | null;
}
interface ApiRisk {
  id: number; title: string; category: string | null; severity: string; status: string;
  projectTitle: string | null; stateName: string | null; stateNameAr?: string | null; updatedAt: string | null;
}
interface ApiDocument {
  id: number; fileName: string; category: string | null; kind: string | null;
  projectId: number | null; projectTitle: string | null; uploadedAt: string | null;
}
interface ApiUser {
  id: number; name: string; email: string; roleLabel: string; status: string;
}
interface ApiResults {
  projects: ApiProject[]; plans: ApiPlan[]; reports: ApiReport[];
  risks: ApiRisk[]; documents: ApiDocument[]; users: ApiUser[];
}

/* ─── Palette item type ───────────────────────────────────────────────── */
interface PaletteItem {
  id: string;
  kind: "nav" | "action" | "project" | "plan" | "report" | "risk" | "document" | "user" | "recent-page" | "recent-search" | "favorite";
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  subtitle?: string;
  badge?: string;
  href?: string;
  action?: () => void;
  shortcut?: string[];
  /** Whether this item is currently pinned (shows filled star) */
  isPinned?: boolean;
  /** If provided, renders a ⭐ pin/unpin button on the right */
  onTogglePin?: (e: React.MouseEvent) => void;
  /** Translated "Add to favourites" label (injected by parent for i18n) */
  pinAriaLabel?: string;
  /** Translated "Remove from favourites" label (injected by parent for i18n) */
  unpinAriaLabel?: string;
}

/* ─── Constants ───────────────────────────────────────────────────────── */
const HISTORY_KEY = "cafa:search-history";
const OPEN_EVENT  = "open-command-palette";

/* ─── Helpers ─────────────────────────────────────────────────────────── */
function reportPath(rt: string | null) {
  if (rt === "hq_sector")    return "/reports/hq-sector";
  if (rt === "program_state") return "/reports/program-state";
  return "/reports/project";
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

function statusCls(s: string) {
  const v = s.toLowerCase();
  if (["active","open","in_progress"].includes(v))
    return "bg-success/10 text-success";
  if (["approved","completed"].includes(v))
    return "bg-primary/10 text-primary";
  if (["submitted","under_review","technically_approved","coordination_approved"].includes(v))
    return "bg-warning/10 text-warning";
  if (["critical","high"].includes(v))
    return "bg-destructive/10 text-destructive";
  if (["archived","cancelled","rejected"].includes(v))
    return "bg-muted text-muted-foreground/60";
  return "bg-muted text-muted-foreground";
}

function matchesQuery(text: string, q: string) {
  return text.toLowerCase().includes(q.toLowerCase());
}

/* ─── Icon map for recent items (module-level, static) ───────────────── */
const ICON_MAP: Record<string, React.ReactNode> = {
  dashboard:        <LayoutDashboard className="h-4 w-4 text-primary" />,
  projects:         <FolderKanban    className="h-4 w-4 text-blue-600" />,
  plans:            <CalendarClock   className="h-4 w-4 text-violet-600" />,
  reports:          <ChartNoAxesColumn className="h-4 w-4 text-amber-600" />,
  risks:            <AlertTriangle   className="h-4 w-4 text-red-600" />,
  budget:           <PieChart        className="h-4 w-4 text-green-600" />,
  notifications:    <Bell            className="h-4 w-4 text-sky-600" />,
  messages:         <MessageSquare   className="h-4 w-4 text-cyan-600" />,
  conversation:     <MessageSquare   className="h-4 w-4 text-cyan-600" />,
  users:            <UserCog         className="h-4 w-4 text-purple-600" />,
  states:           <MapPin          className="h-4 w-4 text-emerald-600" />,
  audit:            <ShieldAlert     className="h-4 w-4 text-rose-600" />,
  sops:             <BookMarked      className="h-4 w-4 text-orange-600" />,
  drive:            <Database        className="h-4 w-4 text-teal-600" />,
  manual:           <BookOpen        className="h-4 w-4 text-indigo-600" />,
  sync:             <RefreshCw       className="h-4 w-4 text-blue-600" />,
  page:             <Clock           className="h-4 w-4 text-muted-foreground/60" />,
};

/* ─── Sub-components ──────────────────────────────────────────────────── */
function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusCls(status)}`}>
      {cap(status)}
    </span>
  );
}

function Shortcut({ keys }: { keys: string[] }) {
  return (
    <span className="shrink-0 hidden sm:flex items-center gap-0.5">
      {keys.map((k) => (
        <kbd key={k} className="inline-flex items-center justify-center min-w-[20px] h-5 px-1 rounded border border-border/60 bg-muted/80 text-xs font-medium text-muted-foreground/60">
          {k}
        </kbd>
      ))}
    </span>
  );
}

function GroupHeader({ label, onClear, clearLabel, clearAriaLabel }: {
  label: string;
  onClear?: () => void;
  clearLabel?: string;
  clearAriaLabel?: string;
}) {
  return (
    <div className="px-4 pt-3 pb-1 flex items-center justify-between">
      <span className="text-xs font-semibold uppercase tracking-[0.10em] text-muted-foreground/50 select-none">
        {label}
      </span>
      {onClear && (
        <button
          onClick={onClear}
          tabIndex={-1}
          aria-label={clearAriaLabel ?? "Clear recent history"}
          className="text-xs text-muted-foreground/35 hover:text-muted-foreground transition-colors"
        >
          {clearLabel ?? "Clear"}
        </button>
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 animate-pulse">
      <div className="h-8 w-8 rounded-lg bg-muted shrink-0" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-2/5 rounded bg-muted" />
        <div className="h-2 w-1/3 rounded bg-muted/70" />
      </div>
      <div className="h-4 w-14 rounded-full bg-muted shrink-0" />
    </div>
  );
}

interface ItemRowProps {
  item: PaletteItem;
  isActive: boolean;
  onClick: () => void;
  onHover: () => void;
  itemRef?: (el: HTMLDivElement | null) => void;
}
function ItemRow({ item, isActive, onClick, onHover, itemRef }: ItemRowProps) {
  return (
    /* Use div + role="option" instead of <button> so the pin toggle button
       inside does not create an illegal button-in-button nesting (HTML spec
       forbids interactive content inside <button>). The palette's keyboard
       navigation is driven by the search input, so no native button behaviour
       is lost — items are activated via onClick and Enter at the input level. */
    <div
      ref={itemRef}
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      onMouseEnter={onHover}
      tabIndex={-1}
      className={`group w-full flex items-center gap-3 px-4 py-2.5 text-start transition-colors duration-150 cursor-default ${
        isActive ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className={`shrink-0 h-8 w-8 rounded-lg flex items-center justify-center ${item.iconBg}`}>
        {item.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground truncate leading-snug">{item.label}</p>
        {item.subtitle && (
          <p className="text-xs text-muted-foreground truncate leading-snug mt-0.5">{item.subtitle}</p>
        )}
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        {item.badge && <StatusBadge status={item.badge} />}
        {item.shortcut && <Shortcut keys={item.shortcut} />}
        {item.onTogglePin && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); item.onTogglePin!(e); }}
            tabIndex={-1}
            aria-label={item.isPinned ? (item.unpinAriaLabel ?? "Unpin from favourites") : (item.pinAriaLabel ?? "Pin to favourites")}
            title={item.isPinned ? (item.unpinAriaLabel ?? "Remove from favourites") : (item.pinAriaLabel ?? "Add to favourites")}
            className={`h-6 w-6 flex items-center justify-center rounded-md transition-all duration-150 ${
              item.isPinned
                ? "text-amber-500 opacity-100"
                : "text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-amber-500"
            } hover:bg-accent`}
          >
            <Star className={`h-3.5 w-3.5 ${item.isPinned ? "fill-amber-500" : ""}`} />
          </button>
        )}
        {!item.onTogglePin && isActive && !item.badge && !item.shortcut && (
          <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 rtl:rotate-180" />
        )}
      </div>
    </div>
  );
}

/* ─── CommandPalette ──────────────────────────────────────────────────── */
export function CommandPalette() {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<ApiResults | null>(null);
  const [activeIdx, setActiveIdx]   = useState(0);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const inputRef    = useRef<HTMLInputElement>(null);
  const listRef     = useRef<HTMLDivElement>(null);
  const modalRef    = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef    = useRef<AbortController | null>(null);
  const itemRefs    = useRef<(HTMLDivElement | null)[]>([]);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  const [, setLocation] = useLocation();
  const { openRecordPath } = useRecordDetail();
  const { data: meData } = useGetMe();
  const { items: recentItems, clear: clearRecent } = useRecentItems();
  const { favorites, toggle: toggleFav, isFavorite } = useFavorites();
  const { t: tNav, i18n } = useTranslation("nav");

  /* ── RBAC ──────────────────────────────────────────────────────────── */
  const myPerms        = meData?.permissions ?? [];
  const userRole       = meData?.user?.role ?? "";
  const isAuditVisible    = ["super_admin","executive_director","program_manager"].includes(userRole);
  const hasUsersPerm      = myPerms.includes("*") || myPerms.includes("users.view") || myPerms.includes("users.manage");
  const canViewBudget     = myPerms.includes("*") || myPerms.some(p => p.startsWith("budget.view"));
  const canViewMessages   = myPerms.includes("*") || myPerms.includes("messages.view");
  const canViewFileArchive = myPerms.includes("*") ||
    myPerms.includes("program_resources.view") ||
    myPerms.includes("documents.view");

  /* ── Static nav items (RBAC-aware, translated) ──────────────────────── */
  const allNavItems = useMemo<PaletteItem[]>(() => {
    const items: PaletteItem[] = [
      { id: "nav-/",         kind: "nav", label: tNav("items.dashboard"),           subtitle: tNav("cmdSubtitles.dashboard"),          href: "/",              icon: <LayoutDashboard className="h-4 w-4 text-primary"       />, iconBg: "bg-primary/10",   shortcut: ["G","D"] },
      { id: "nav-/projects", kind: "nav", label: tNav("items.projects"),            subtitle: tNav("cmdSubtitles.projects"),           href: "/projects",      icon: <FolderKanban    className="h-4 w-4 text-blue-600"     />, iconBg: "bg-blue-500/10"   },
      { id: "nav-/plans",    kind: "nav", label: tNav("items.plans"),               subtitle: tNav("cmdSubtitles.plans"),              href: "/plans",         icon: <CalendarClock   className="h-4 w-4 text-violet-600"   />, iconBg: "bg-violet-500/10" },
      { id: "nav-/reports",  kind: "nav", label: tNav("items.reports"),             subtitle: tNav("cmdSubtitles.reports"),            href: "/reports",       icon: <ChartNoAxesColumn className="h-4 w-4 text-amber-600"    />, iconBg: "bg-amber-500/10"  },
      { id: "nav-/risks",    kind: "nav", label: tNav("pageTitles.riskRegister"),   subtitle: tNav("cmdSubtitles.risks"),              href: "/risks",         icon: <AlertTriangle   className="h-4 w-4 text-red-600"      />, iconBg: "bg-red-500/10"    },
      { id: "nav-/notifs",   kind: "nav", label: tNav("items.notifications"),       subtitle: tNav("cmdSubtitles.notifications"),      href: "/notifications", icon: <Bell            className="h-4 w-4 text-sky-600"      />, iconBg: "bg-sky-500/10"    },
      { id: "nav-/states",   kind: "nav", label: tNav("items.states"),              subtitle: tNav("cmdSubtitles.states"),             href: "/states",        icon: <MapPin          className="h-4 w-4 text-emerald-600"  />, iconBg: "bg-emerald-500/10"},
      { id: "nav-/manual",   kind: "nav", label: tNav("items.systemManual"),        subtitle: tNav("cmdSubtitles.systemManual"),       href: "/manual",        icon: <BookOpen        className="h-4 w-4 text-indigo-600"   />, iconBg: "bg-indigo-500/10" },
    ];
    if (canViewFileArchive) items.splice(7, 0, { id: "nav-/document-management/file-archive", kind: "nav", label: tNav("items.fileArchive"), subtitle: tNav("cmdSubtitles.fileArchive"), href: "/document-management/file-archive", icon: <Archive className="h-4 w-4 text-teal-600" />, iconBg: "bg-teal-500/10" });
    if (canViewBudget)   items.push({ id: "nav-/budget",  kind: "nav", label: tNav("pageTitles.budgetAndFinance"),  subtitle: tNav("cmdSubtitles.budget"),              href: "/budget",     icon: <PieChart    className="h-4 w-4 text-green-600"  />, iconBg: "bg-green-500/10"  });
    if (canViewMessages) items.push({ id: "nav-/msgs",    kind: "nav", label: tNav("items.communicationCentre"),   subtitle: tNav("cmdSubtitles.communicationCentre"), href: "/messages",   icon: <MessageSquare className="h-4 w-4 text-cyan-600"  />, iconBg: "bg-cyan-500/10"   });
    if (hasUsersPerm)    items.push({ id: "nav-/users",   kind: "nav", label: tNav("pageTitles.userManagement"),   subtitle: tNav("cmdSubtitles.users"),               href: "/users",      icon: <UserCog     className="h-4 w-4 text-purple-600" />, iconBg: "bg-purple-500/10" });
    if (isAuditVisible)  items.push({ id: "nav-/audit",   kind: "nav", label: tNav("items.auditLog"),              subtitle: tNav("cmdSubtitles.auditLog"),            href: "/audit-log",  icon: <ShieldAlert className="h-4 w-4 text-rose-600"   />, iconBg: "bg-rose-500/10"   });
    items.push({ id: "nav-/ai",      kind: "nav", label: tNav("items.ai"),              subtitle: tNav("cmdSubtitles.ai"),              href: "/ai",         icon: <Bot         className="h-4 w-4 text-violet-600" />, iconBg: "bg-violet-500/10" });
    // Actions
    items.push(
      { id: "action-sync", kind: "action", label: tNav("items.syncStatus"),    subtitle: tNav("cmdSubtitles.syncStatus"),    href: "/sync-status", icon: <RefreshCw className="h-4 w-4 text-blue-600" />, iconBg: "bg-blue-500/10" },
    );
    return items;
  }, [canViewBudget, canViewMessages, canViewFileArchive, hasUsersPerm, isAuditVisible, tNav]);

  /* ── Open/close helpers ─────────────────────────────────────────────── */
  const openPalette = useCallback(() => {
    prevFocusRef.current = document.activeElement as HTMLElement;
    setQuery("");
    setResults(null);
    setActiveIdx(0);
    setOpen(true);
  }, []);

  const closePalette = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) setTimeout(() => prevFocusRef.current?.focus(), 10);
  }, []);

  const handleClearRecent = useCallback(() => {
    if (!window.confirm(tNav("commandPalette.clearHistoryConfirm"))) return;
    clearRecent();
    setRecentSearches([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
  }, [clearRecent, tNav]);

  /* ── Load recent search history ─────────────────────────────────────── */
  const loadRecent = useCallback(() => {
    try {
      const h = localStorage.getItem(HISTORY_KEY);
      if (h) setRecentSearches(JSON.parse(h));
    } catch { /* noop */ }
  }, []);

  const saveSearch = useCallback((term: string) => {
    if (!term.trim() || term.trim().length < 2) return;
    setRecentSearches(prev => {
      const next = [term.trim(), ...prev.filter(s => s !== term.trim())].slice(0, 8);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }, []);

  /* ── Event + keyboard open/close ────────────────────────────────────── */
  useEffect(() => {
    const onEvent = () => openPalette();
    document.addEventListener(OPEN_EVENT, onEvent);
    return () => document.removeEventListener(OPEN_EVENT, onEvent);
  }, [openPalette]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        if (open) closePalette(); else openPalette();
      }
      if (e.key === "Escape" && open) closePalette();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette, closePalette]);

  /* ── Body scroll lock + focus on open ──────────────────────────────── */
  useEffect(() => {
    if (open) {
      loadRecent();
      document.body.style.overflow = "hidden";
      setTimeout(() => inputRef.current?.focus(), 30);
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [open, loadRecent]);

  /* ── Focus trap ─────────────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    if (!modal) return;
    const getFocusable = () =>
      Array.from(modal.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ));
    const trapTab = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last  = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", trapTab);
    return () => document.removeEventListener("keydown", trapTab);
  }, [open]);

  /* ── Debounced API search ───────────────────────────────────────────── */
  const fetchResults = useCallback(async (q: string) => {
    if (!q.trim()) { setResults(null); setLoading(false); return; }
    setLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&limit=5`,
        { credentials: "include", signal: abortRef.current.signal }
      );
      if (!res.ok) throw new Error("Search failed");
      setResults(await res.json());
      setActiveIdx(0);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") return;
      setResults({ projects: [], plans: [], reports: [], risks: [], documents: [], users: [] });
    } finally {
      setLoading(false);
    }
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    setActiveIdx(0);
    if (!val.trim()) { setResults(null); if (debounceRef.current) clearTimeout(debounceRef.current); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(val), 250);
  };

  /* ── Build flat item list ────────────────────────────────────────────── */
  const groups = useMemo<{ label: string; items: PaletteItem[] }[]>(() => {
    const q = query.trim();

    /* Empty state — show recents + all nav */
    if (!q) {
      // ── Favorites ──────────────────────────────────────────────────
      const favoriteItems: PaletteItem[] = favorites.slice(0, 10).map(fav => ({
        id: `fav-${fav.id}`,
        kind: "favorite" as const,
        label: fav.title,
        subtitle: fav.subtitle,
        href: fav.path,
        icon: ICON_MAP[fav.iconKey] ?? <Clock className="h-4 w-4 text-muted-foreground/60" />,
        iconBg: fav.iconBg,
        badge: fav.status,
        isPinned: true,
        onTogglePin: (e: React.MouseEvent) => {
          e.stopPropagation();
          toggleFav({ type: fav.type, title: fav.title, subtitle: fav.subtitle, path: fav.path, recordId: fav.recordId, iconKey: fav.iconKey, iconBg: fav.iconBg, status: fav.status });
        },
      }));

      // ── Recent pages (with pin toggle) ─────────────────────────────
      const recentPageItems: PaletteItem[] = recentItems.slice(0, 8).map(item => {
        const favId = `${item.iconKey}:${item.path}`;
        const pinned = isFavorite(favId);
        return {
          id: `ri-${item.id}`,
          kind: "recent-page" as const,
          label: item.title,
          subtitle: [item.subtitle, timeAgo(item.ts)].filter(Boolean).join(" · "),
          href: item.path,
          icon: ICON_MAP[item.iconKey] ?? <Clock className="h-4 w-4 text-muted-foreground/60" />,
          iconBg: item.iconBg,
          badge: item.status,
          isPinned: pinned,
          onTogglePin: (e: React.MouseEvent) => {
            e.stopPropagation();
            toggleFav({ type: item.type, title: item.title, subtitle: item.subtitle, path: item.path, recordId: item.recordId, iconKey: item.iconKey, iconBg: item.iconBg, status: item.status });
          },
        };
      });

      const recentSearchItems: PaletteItem[] = recentSearches.slice(0, 3).map(s => ({
        id: `rs-${s}`,
        kind: "recent-search" as const,
        label: s,
        subtitle: tNav("commandPalette.recentSearchHint"),
        icon: <Search className="h-4 w-4 text-muted-foreground/60" />,
        iconBg: "bg-muted",
        action: () => { setQuery(s); fetchResults(s); },
      }));

      // Pin labels are passed through item metadata so the module-level ItemRow
      // component can display translated strings without needing hook access.
      const pinLabel   = tNav("commandPalette.pinLabel");
      const unpinLabel = tNav("commandPalette.unpinLabel");
      const withPinLabels = (items: PaletteItem[]) =>
        items.map(i => ({ ...i, pinAriaLabel: pinLabel, unpinAriaLabel: unpinLabel }));

      const groups: { label: string; items: PaletteItem[] }[] = [];
      if (favoriteItems.length > 0) {
        groups.push({ label: tNav("commandPalette.groups.favorites"), items: withPinLabels(favoriteItems) });
      }
      if (recentPageItems.length > 0 || recentSearchItems.length > 0) {
        groups.push({ label: tNav("commandPalette.groups.recent"), items: withPinLabels([...recentPageItems, ...recentSearchItems]) });
      }
      groups.push({ label: tNav("commandPalette.groups.quickNav"), items: allNavItems.filter(i => i.kind === "nav").slice(0, 8) });
      groups.push({ label: tNav("commandPalette.groups.actions"), items: allNavItems.filter(i => i.kind === "action") });
      return groups;
    }

    /* Query state — static matches + API results */
    const navMatches = allNavItems.filter(i => matchesQuery(i.label, q) || matchesQuery(i.subtitle ?? "", q));

    const toItems = {
      project: (p: ApiProject): PaletteItem => ({
        id: `proj-${p.id}`, kind: "project", label: p.title,
        subtitle: [p.code, p.sector].filter(Boolean).join(" · "),
        badge: p.status, href: `/projects/${p.id}`,
        icon: <FolderKanban className="h-4 w-4 text-blue-600" />, iconBg: "bg-blue-500/10",
      }),
      plan: (p: ApiPlan): PaletteItem => ({
        id: `plan-${p.id}`, kind: "plan", label: p.title,
        subtitle: [p.code, p.stateName ? getLinkedStateLabel(p, i18n?.language) : p.projectTitle].filter(Boolean).join(" · "),
        badge: p.status, href: `/plans/${p.id}`,
        icon: <CalendarClock className="h-4 w-4 text-violet-600" />, iconBg: "bg-violet-500/10",
      }),
      report: (r: ApiReport): PaletteItem => ({
        id: `rep-${r.id}`, kind: "report", label: r.title,
        subtitle: [r.projectTitle ?? (r.stateName ? getLinkedStateLabel(r, i18n?.language) : null), r.kind].filter(Boolean).join(" · "),
        badge: r.status, href: reportPath(r.reportType),
        icon: <ChartNoAxesColumn className="h-4 w-4 text-amber-600" />, iconBg: "bg-amber-500/10",
      }),
      risk: (r: ApiRisk): PaletteItem => ({
        id: `risk-${r.id}`, kind: "risk", label: r.title,
        subtitle: [r.category, r.projectTitle ?? (r.stateName ? getLinkedStateLabel(r, i18n?.language) : null)].filter(Boolean).join(" · "),
        badge: r.severity, href: "/risks",
        icon: <AlertTriangle className="h-4 w-4 text-red-600" />, iconBg: "bg-red-500/10",
      }),
      document: (d: ApiDocument): PaletteItem => ({
        id: `doc-${d.id}`, kind: "document", label: d.fileName,
        subtitle: [d.category, d.projectTitle].filter(Boolean).join(" · "),
        href: d.projectId ? `/projects/${d.projectId}` : "/document-management/file-archive",
        icon: <Paperclip className="h-4 w-4 text-teal-600" />, iconBg: "bg-teal-500/10",
      }),
      user: (u: ApiUser): PaletteItem => ({
        id: `usr-${u.id}`, kind: "user", label: u.name,
        subtitle: u.email,
        badge: u.roleLabel, href: "/users",
        icon: <User className="h-4 w-4 text-muted-foreground" />, iconBg: "bg-muted",
      }),
    };

    // Intelligent ranking: favorites first → frequent → recently opened → active → alpha
    const recentMap = buildRecentMap(recentItems);
    const sortByRank = <T extends { id: number }>(items: T[], getPath: (item: T) => string): T[] =>
      [...items].sort((a, b) => rankScore(getPath(b), favorites, recentMap) - rankScore(getPath(a), favorites, recentMap));

    const out: { label: string; items: PaletteItem[] }[] = [];
    if (navMatches.length)              out.push({ label: tNav("commandPalette.groups.navigation"), items: navMatches });
    if (results?.projects.length)       out.push({ label: tNav("commandPalette.groups.projects"),   items: sortByRank(results.projects, p => `/projects/${p.id}`).map(toItems.project) });
    if (results?.plans.length)          out.push({ label: tNav("commandPalette.groups.plans"),      items: sortByRank(results.plans,    p => `/plans/${p.id}`).map(toItems.plan) });
    if (results?.reports.length)        out.push({ label: tNav("commandPalette.groups.reports"),    items: sortByRank(results.reports,  r => reportPath(r.reportType)).map(toItems.report) });
    if (results?.risks.length)          out.push({ label: tNav("commandPalette.groups.risks"),      items: results.risks.map(toItems.risk) });
    if (results?.documents.length)      out.push({ label: tNav("commandPalette.groups.documents"),  items: results.documents.map(toItems.document) });
    if (results?.users.length)          out.push({ label: tNav("commandPalette.groups.users"),      items: results.users.map(toItems.user) });
    return out;
  }, [query, allNavItems, results, recentItems, recentSearches, fetchResults, favorites, isFavorite, toggleFav, tNav, i18n?.language]);

  /* ── Flat items for keyboard nav ─────────────────────────────────────── */
  const flatItems = useMemo<PaletteItem[]>(() => groups.flatMap(g => g.items), [groups]);

  const totalItems = flatItems.length;
  const hasResults = totalItems > 0;
  const showSkeleton = loading && !results && !!query.trim();
  const showEmpty    = !!query.trim() && !loading && !hasResults && results !== null;

  /* ── Scroll active into view ─────────────────────────────────────────── */
  useEffect(() => {
    itemRefs.current[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx]);

  /* ── Execute item ────────────────────────────────────────────────────── */
  const execItem = useCallback((item: PaletteItem) => {
    let openedRecord = false;
    if (query.trim()) saveSearch(query.trim());
    if (item.action) {
      item.action();
    } else if (item.kind === "recent-search") {
      // handled inside item.action already
      return;
    } else if (item.href) {
      openedRecord = openRecordPath(item.href);
      if (!openedRecord) setLocation(item.href);
    }
    closePalette(!openedRecord);
  }, [query, saveSearch, setLocation, closePalette, openRecordPath]);

  /* ── Keyboard handler (input) ────────────────────────────────────────── */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIdx(i => (i + 1) % Math.max(1, totalItems));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIdx(i => (i - 1 + Math.max(1, totalItems)) % Math.max(1, totalItems));
        break;
      case "Tab":
        if (totalItems === 0) break;
        e.preventDefault();
        if (e.shiftKey) setActiveIdx(i => (i - 1 + totalItems) % totalItems);
        else            setActiveIdx(i => (i + 1) % totalItems);
        break;
      case "Home":
        e.preventDefault();
        setActiveIdx(0);
        break;
      case "End":
        e.preventDefault();
        setActiveIdx(Math.max(0, totalItems - 1));
        break;
      case "Enter":
        e.preventDefault();
        if (flatItems[activeIdx]) execItem(flatItems[activeIdx]);
        break;
      default:
        break;
    }
  };

  /* ── Click outside ───────────────────────────────────────────────────── */
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) closePalette();
  };

  /* ── Render ──────────────────────────────────────────────────────────── */
  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      aria-hidden={!open}
      className={`fixed inset-0 z-[200] transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0 pointer-events-none"}`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
        onClick={() => closePalette()}
        aria-hidden="true"
      />

      {/* Modal container — centered */}
      <div
        className="relative flex items-start justify-center pt-[10vh] sm:pt-[14vh] px-4 h-full"
        onClick={handleBackdropClick}
      >
        <div
          ref={modalRef}
          role="dialog"
          aria-modal="true"
          aria-label={tNav("commandPalette.label")}
          className={`w-full max-w-[740px] bg-popover rounded-2xl border border-border shadow-2xl shadow-black/25 overflow-hidden flex flex-col transition-all duration-150 ${
            open ? "opacity-100 scale-100 translate-y-0" : "opacity-0 scale-95 -translate-y-2"
          }`}
          style={{ maxHeight: "min(640px, 80dvh)" }}
          onClick={e => e.stopPropagation()}
        >
          {/* ── Search input ──────────────────────────────────────── */}
          <div className="flex items-center gap-3 px-4 border-b border-border shrink-0 h-14">
            <Search className="shrink-0 h-4 w-4 text-muted-foreground/60" />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={handleChange}
              onKeyDown={onKeyDown}
              placeholder={tNav("commandPalette.searchPlaceholder")}
              autoComplete="off"
              spellCheck={false}
              dir="auto"
              aria-label={tNav("commandPalette.searchAriaLabel")}
              aria-autocomplete="list"
              aria-controls="cp-listbox"
              className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/45 outline-none border-none"
            />
            <div className="shrink-0 flex items-center gap-2">
              {loading && <Loader2 className="h-4 w-4 text-muted-foreground/50 animate-spin" />}
              {query && !loading && (
                <button
                  onClick={() => { setQuery(""); setResults(null); setActiveIdx(0); inputRef.current?.focus(); }}
                  className="h-5 w-5 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
                  tabIndex={-1}
                  aria-label={tNav("commandPalette.clearSearch")}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              <kbd className="hidden sm:inline-flex items-center rounded border border-border/60 bg-muted/80 px-1.5 py-px text-xs font-medium text-muted-foreground/50">
                Esc
              </kbd>
            </div>
          </div>

          {/* ── Result list ───────────────────────────────────────── */}
          <div
            ref={listRef}
            id="cp-listbox"
            role="listbox"
            aria-label={tNav("commandPalette.resultsAriaLabel")}
            className="flex-1 overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full"
          >
            {/* Loading skeleton */}
            {showSkeleton && (
              <div className="py-1">
                <div className="px-4 pt-3 pb-1"><div className="h-2 w-20 rounded bg-muted animate-pulse" /></div>
                <SkeletonRow /><SkeletonRow /><SkeletonRow />
                <div className="px-4 pt-3 pb-1"><div className="h-2 w-14 rounded bg-muted animate-pulse" /></div>
                <SkeletonRow /><SkeletonRow />
                <div className="h-2" />
              </div>
            )}

            {/* Empty state */}
            {showEmpty && (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
                <div className="h-12 w-12 rounded-xl bg-muted/60 flex items-center justify-center mb-3">
                  <Search className="h-6 w-6 text-muted-foreground/30" />
                </div>
                <p className="text-[14px] font-medium text-foreground mb-1">
                  {tNav("commandPalette.noResultsFor")} <span className="text-primary">"{query}"</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {tNav("commandPalette.noResultsTip")}
                </p>
              </div>
            )}

            {/* Results */}
            {!showSkeleton && !showEmpty && (
              <div className="pb-2">
                {(() => {
                  let globalIdx = 0;
                  return groups.map(group => {
                    if (group.items.length === 0) return null;
                    return (
                      <div key={group.label}>
                        <GroupHeader
                          label={group.label}
                          onClear={group.label === tNav("commandPalette.groups.recent") ? handleClearRecent : undefined}
                          clearLabel={tNav("commandPalette.clearRecent")}
                          clearAriaLabel={tNav("commandPalette.clearRecentLabel")}
                        />
                        {group.items.map(item => {
                          const idx = globalIdx++;
                          const isActive = activeIdx === idx;
                          return (
                            <ItemRow
                              key={item.id}
                              item={item}
                              isActive={isActive}
                              onClick={() => execItem(item)}
                              onHover={() => setActiveIdx(idx)}
                              itemRef={el => { itemRefs.current[idx] = el; }}
                            />
                          );
                        })}
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </div>

          {/* ── Footer keyboard hints ─────────────────────────────── */}
          <div className="shrink-0 border-t border-border/50 px-4 py-2 flex items-center gap-4 text-xs text-muted-foreground/40 select-none bg-muted/20">
            <span className="flex items-center gap-1">
              <kbd className="font-sans">↑↓</kbd> {tNav("commandPalette.hints.navigate")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans">↵</kbd> {tNav("commandPalette.hints.open")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans">{tNav("common:keys.tab")}</kbd> {tNav("commandPalette.hints.next")}
            </span>
            <span className="flex items-center gap-1">
              <kbd className="font-sans">{tNav("common:keys.esc")}</kbd> {tNav("commandPalette.hints.close")}
            </span>
            <span className="ms-auto flex items-center gap-1">
              <Zap className="h-3 w-3" />
              <span>{tNav("commandPalette.brand")}</span>
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
