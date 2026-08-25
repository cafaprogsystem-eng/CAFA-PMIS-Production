import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { useRecentItems } from "@/hooks/use-recent-items";
import { timeAgo as itemTimeAgo } from "@/lib/recent-items";
import {
  Search,
  FolderKanban,
  FileText,
  User,
  Loader2,
  X,
  Clock,
  AlertTriangle,
  CalendarClock,
  Paperclip,
  ChevronRight,
  TrendingUp,
  Star,
} from "lucide-react";
import { useFavorites } from "@/hooks/use-favorites";
import { rankScore, buildRecentMap } from "@/lib/favorites";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { getLinkedStateLabel } from "@/components/state-label";

/* ─── Types ─────────────────────────────────────────────────────────────── */
interface SearchProject {
  id: number;
  code: string;
  title: string;
  status: string;
  sector: string | null;
}

interface SearchPlan {
  id: number;
  title: string;
  code: string;
  planType: string | null;
  status: string;
  projectTitle: string | null;
  stateName: string | null;
  stateNameAr?: string | null;
  updatedAt: string | null;
}

interface SearchReport {
  id: number;
  title: string;
  kind: string | null;
  status: string;
  reportType: string | null;
  projectTitle: string | null;
  stateName: string | null;
  stateNameAr?: string | null;
  updatedAt: string | null;
}

interface SearchRisk {
  id: number;
  title: string;
  category: string | null;
  severity: string;
  status: string;
  projectTitle: string | null;
  stateName: string | null;
  stateNameAr?: string | null;
  updatedAt: string | null;
}

interface SearchDocument {
  id: number;
  fileName: string;
  category: string | null;
  kind: string | null;
  projectId: number | null;
  projectTitle: string | null;
  uploadedAt: string | null;
}

interface SearchUser {
  id: number;
  name: string;
  email: string;
  roleLabel: string;
  status: string;
}

interface SearchResults {
  projects: SearchProject[];
  plans: SearchPlan[];
  reports: SearchReport[];
  risks: SearchRisk[];
  documents: SearchDocument[];
  users: SearchUser[];
}

type FlatItem =
  | { kind: "project"; data: SearchProject }
  | { kind: "plan"; data: SearchPlan }
  | { kind: "report"; data: SearchReport }
  | { kind: "risk"; data: SearchRisk }
  | { kind: "document"; data: SearchDocument }
  | { kind: "user"; data: SearchUser };

/* ─── Constants ─────────────────────────────────────────────────────────── */
const HISTORY_KEY = "cafa:search-history";
const MAX_HISTORY = 8;

/* ─── Helpers ───────────────────────────────────────────────────────────── */
function reportTypePath(reportType: string | null): string {
  if (reportType === "hq_sector") return "/reports/hq-sector";
  if (reportType === "program_state") return "/reports/program-state";
  return "/reports/project";
}

function totalResults(r: SearchResults) {
  return (
    r.projects.length +
    r.plans.length +
    r.reports.length +
    r.risks.length +
    r.documents.length +
    r.users.length
  );
}

function timeAgo(
  dateStr: string | null | undefined,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  if (isNaN(diff)) return "";
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return t("globalSearch.time.justNow");
  if (mins < 60) return t("globalSearch.time.minutes", { count: mins });
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return t("globalSearch.time.hours", { count: hrs });
  const days = Math.floor(hrs / 24);
  if (days < 30) return t("globalSearch.time.days", { count: days });
  const months = Math.floor(days / 30);
  if (months < 12) return t("globalSearch.time.months", { count: months });
  return t("globalSearch.time.years", { count: Math.floor(months / 12) });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, " ");
}

/* ─── Status badge ──────────────────────────────────────────────────────── */
function StatusBadge({ status, label }: { status: string; label: string }) {
  const s = status.toLowerCase();
  const cls =
    s === "active" || s === "open" || s === "in_progress"
      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
      : s === "approved" || s === "completed"
      ? "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
      : s === "submitted" || s === "under_review" || s === "technically_approved" || s === "coordination_approved"
      ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
      : s === "critical" || s === "high"
      ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
      : s === "archived" || s === "cancelled" || s === "rejected" || s === "closed"
      ? "bg-muted text-muted-foreground/60"
      : "bg-muted text-muted-foreground";

  return (
    <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded-full whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

/* ─── Severity dot ──────────────────────────────────────────────────────── */
function SeverityDot({ severity, title }: { severity: string; title: string }) {
  const s = severity.toLowerCase();
  const cls =
    s === "critical" ? "bg-red-500"
    : s === "high" ? "bg-orange-500"
    : s === "medium" ? "bg-amber-400"
    : "bg-green-400";
  return <span className={`inline-block h-1.5 w-1.5 rounded-full shrink-0 ${cls}`} title={title} />;
}

/* ─── Skeleton row ──────────────────────────────────────────────────────── */
function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2 animate-pulse">
      <div className="h-7 w-7 rounded-md bg-muted shrink-0" />
      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="h-2.5 w-3/5 rounded bg-muted" />
        <div className="h-2 w-2/5 rounded bg-muted/70" />
      </div>
      <div className="h-4 w-12 rounded-full bg-muted shrink-0" />
    </div>
  );
}

/* ─── Section header ─────────────────────────────────────────────────────── */
function SectionHeader({ label }: { label: string }) {
  return (
    <p className="px-3 pt-2.5 pb-1 text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 select-none">
      {label}
    </p>
  );
}

/* ─── Result row ─────────────────────────────────────────────────────────── */
interface ResultRowProps {
  isActive: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  icon: React.ReactNode;
  iconBg: string;
  title: string;
  subtitle?: string;
  badge?: React.ReactNode;
  time?: string | null;
  extraLeft?: React.ReactNode;
}

function ResultRow({
  isActive,
  onClick,
  onMouseEnter,
  icon,
  iconBg,
  title,
  subtitle,
  badge,
  time,
  extraLeft,
}: ResultRowProps) {
  return (
    <button
      role="option"
      aria-selected={isActive}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className={`w-full flex items-center gap-3 px-3 py-2 text-start transition-colors duration-150 ${
        isActive ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div className={`shrink-0 h-7 w-7 rounded-md flex items-center justify-center ${iconBg}`}>
        {icon}
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground truncate leading-snug">{title}</p>
        {(subtitle || extraLeft) && (
          <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
            {extraLeft}
            {subtitle}
          </p>
        )}
      </div>

      <div className="shrink-0 flex flex-col items-end gap-0.5 min-w-0">
        {badge}
        {time && (
          <span className="text-xs text-muted-foreground/50 whitespace-nowrap">{time}</span>
        )}
      </div>
    </button>
  );
}

/* ─── Quick link item ─────────────────────────────────────────────────────── */
function QuickLink({ label, href, onClick }: { label: string; href: string; onClick: () => void }) {
  const [, setLocation] = useLocation();
  return (
    <button
      onClick={() => { setLocation(href); onClick(); }}
      className="flex items-center justify-between w-full px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded-md transition-colors duration-150 group"
    >
      <span>{label}</span>
      <ChevronRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity rtl:rotate-180" />
    </button>
  );
}

/* ─── GlobalSearch component ─────────────────────────────────────────────── */
export function GlobalSearch() {
  const { t, i18n } = useTranslation("common");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [, setLocation] = useLocation();
  const { openRecord, openRecordPath } = useRecordDetail();
  const { items: recentItems } = useRecentItems();
  const { favorites, toggle: toggleFav, isFavorite } = useFavorites();

  /* ── Load recent searches ──────────────────────────────────────────── */
  useEffect(() => {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      if (stored) setRecentSearches(JSON.parse(stored));
    } catch { /* noop */ }
  }, []);

  function saveSearch(term: string) {
    const trimmed = term.trim();
    if (!trimmed || trimmed.length < 2) return;
    setRecentSearches((prev) => {
      const next = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, MAX_HISTORY);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }

  function removeSearch(term: string) {
    setRecentSearches((prev) => {
      const next = prev.filter((s) => s !== term);
      try { localStorage.setItem(HISTORY_KEY, JSON.stringify(next)); } catch { /* noop */ }
      return next;
    });
  }

  function clearHistory() {
    setRecentSearches([]);
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* noop */ }
  }

  /* ── Escape to close inline dropdown ──────────────────────────────── */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        setOpen(false);
        setQuery("");
        inputRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  /* ── Click outside to close ─────────────────────────────────────── */
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (
        panelRef.current &&
        !panelRef.current.contains(e.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  /* ── Debounced fetch ─────────────────────────────────────────────── */
  const fetchResults = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    try {
      const res = await fetch(
        `/api/search?q=${encodeURIComponent(q.trim())}&limit=5`,
        { credentials: "include", signal: abortRef.current.signal },
      );
      if (!res.ok) throw new Error("Search failed");
      const data: SearchResults = await res.json();
      setResults(data);
      setActiveIdx(-1);
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
    setOpen(true);
    if (!val.trim()) {
      setResults(null);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchResults(val), 280);
  };

  const handleFocus = () => {
    setOpen(true);
    if (query.trim() && !results) {
      fetchResults(query);
    }
  };

  /* ── Ranked results for keyboard nav + display ───────────────────── */
  const recentMap = useMemo(() => buildRecentMap(recentItems), [recentItems]);

  const sortedProjects = useMemo(() =>
    results?.projects
      ? [...results.projects].sort((a, b) => rankScore(`/projects/${b.id}`, favorites, recentMap) - rankScore(`/projects/${a.id}`, favorites, recentMap))
      : [],
    [results?.projects, favorites, recentMap]);

  const sortedPlans = useMemo(() =>
    results?.plans
      ? [...results.plans].sort((a, b) => rankScore(`/plans/${b.id}`, favorites, recentMap) - rankScore(`/plans/${a.id}`, favorites, recentMap))
      : [],
    [results?.plans, favorites, recentMap]);

  /* ── Flat list for keyboard nav ─────────────────────────────────── */
  const flatItems = useMemo<FlatItem[]>(() => {
    if (!results) return [];
    return [
      ...sortedProjects.map((d) => ({ kind: "project" as const, data: d })),
      ...sortedPlans.map((d) => ({ kind: "plan" as const, data: d })),
      ...results.reports.map((d) => ({ kind: "report" as const, data: d })),
      ...results.risks.map((d) => ({ kind: "risk" as const, data: d })),
      ...results.documents.map((d) => ({ kind: "document" as const, data: d })),
      ...results.users.map((d) => ({ kind: "user" as const, data: d })),
    ];
  }, [results, sortedProjects, sortedPlans]);

  /* ── Navigation ─────────────────────────────────────────────────── */
  const navigate = useCallback(
    (item: FlatItem, query?: string) => {
      if (query) saveSearch(query);
      if (item.kind === "project") {
        openRecord("project", item.data.id);
      } else if (item.kind === "plan") {
        openRecord("plan", item.data.id);
      } else if (item.kind === "report") {
        setLocation(reportTypePath(item.data.reportType));
      } else if (item.kind === "risk") {
        setLocation(`/risks`);
      } else if (item.kind === "document") {
        if (item.data.projectId) openRecord("project", item.data.projectId);
        else setLocation("/projects");
      } else {
        setLocation("/users");
      }
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    },
    [setLocation, openRecord],
  );

  const openSavedPath = (path: string) => {
    if (!openRecordPath(path)) setLocation(path);
    setOpen(false);
    setQuery("");
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Tab") {
      if (flatItems.length === 0) return;
      e.preventDefault();
      if (e.shiftKey) {
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else {
        setActiveIdx((i) => Math.min(i + 1, flatItems.length - 1));
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIdx >= 0 && flatItems[activeIdx]) {
        navigate(flatItems[activeIdx], query);
      } else if (query.trim()) {
        // Save search term even if Enter is pressed with no active item
        saveSearch(query);
        setOpen(false);
      }
    }
  };

  const clear = () => {
    setQuery("");
    setResults(null);
    setOpen(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    inputRef.current?.focus();
  };

  /* ── Derived state ──────────────────────────────────────────────── */
  const hasResults = results && totalResults(results) > 0;
  const isEmpty = results && totalResults(results) === 0 && !loading;
  const showEmpty = open && query.trim() === "" && !loading;
  const showLoading = loading && !results;

  /* ── Group offsets for keyboard nav ─────────────────────────────── */
  const offsets = useMemo(() => {
    if (!results) return { projects: 0, plans: 0, reports: 0, risks: 0, documents: 0, users: 0 };
    return {
      projects: 0,
      plans: results.projects.length,
      reports: results.projects.length + results.plans.length,
      risks: results.projects.length + results.plans.length + results.reports.length,
      documents:
        results.projects.length +
        results.plans.length +
        results.reports.length +
        results.risks.length,
      users:
        results.projects.length +
        results.plans.length +
        results.reports.length +
        results.risks.length +
        results.documents.length,
    };
  }, [results]);

  /* ── Panel visibility ────────────────────────────────────────────── */
  const showPanel = open && (hasResults || isEmpty || showLoading || showEmpty);

  return (
    <div className="relative w-full">
      {/* ── Input ─────────────────────────────────────────────────── */}
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-[15px] w-[15px] text-muted-foreground/55 pointer-events-none" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={handleChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder={t("globalSearch.placeholder")}
          autoComplete="off"
          spellCheck={false}
          aria-label={t("globalSearch.ariaLabel")}
          aria-expanded={showPanel}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          className="w-full h-10 rounded-xl border border-border/70 bg-muted/30 ps-9 pe-16 text-sm placeholder:text-muted-foreground/45 hover:bg-muted/50 hover:border-border focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40 focus:bg-background transition-all duration-150"
        />
        <div className="absolute end-2.5 top-1/2 -translate-y-1/2 flex items-center gap-1.5">
          {loading && (
            <Loader2 className="h-3.5 w-3.5 text-muted-foreground/50 animate-spin" />
          )}
          {query && !loading && (
            <button
              onClick={clear}
              aria-label={t("globalSearch.clearSearch")}
              tabIndex={-1}
              className="h-5 w-5 flex items-center justify-center rounded-full text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-3 w-3" />
            </button>
          )}
          {!query && (
            <button
              type="button"
              onClick={() => document.dispatchEvent(new CustomEvent("open-command-palette"))}
              className="hidden lg:flex items-center cursor-pointer"
              aria-label={t("globalSearch.openCommandPalette")}
              tabIndex={-1}
            >
              <kbd className="inline-flex items-center rounded border border-border/60 bg-muted/80 px-1.5 py-px text-xs font-medium text-muted-foreground/50 tracking-wide hover:border-border hover:bg-muted transition-colors">
                ⌘K
              </kbd>
            </button>
          )}
        </div>
      </div>

      {/* ── Dropdown panel ────────────────────────────────────────── */}
      {showPanel && (
        <div
          ref={panelRef}
          role="listbox"
          aria-label={t("globalSearch.searchResults")}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-50 rounded-xl border border-border/80 bg-popover shadow-xl shadow-black/[0.10] overflow-hidden animate-in fade-in-0 zoom-in-95 slide-in-from-top-2 duration-150"
        >
          {/* ── Loading skeleton ────────────────────────────────── */}
          {showLoading && (
            <div className="py-1.5">
              <div className="px-3 pt-2 pb-1">
                <div className="h-2 w-16 rounded bg-muted animate-pulse" />
              </div>
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <div className="px-3 pt-2 pb-1 mt-1">
                <div className="h-2 w-12 rounded bg-muted animate-pulse" />
              </div>
              <SkeletonRow />
              <SkeletonRow />
              <div className="h-1.5" />
            </div>
          )}

          {/* ── Empty state (no query — show recent + quick links) ── */}
          {showEmpty && !loading && (
            <div className="py-2">
              {/* Favorites section — always shown first if any exist */}
              {favorites.length > 0 && (
                <div className="px-3 pt-1.5 pb-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 mb-1 select-none flex items-center gap-1.5">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {t("globalSearch.favorites")}
                  </p>
                  <div className="space-y-0.5">
                    {favorites.slice(0, 5).map(fav => (
                      <div
                        key={fav.id}
                        role="option"
                        aria-selected="false"
                        title={fav.title}
                        className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                        onClick={() => openSavedPath(fav.path)}
                        onKeyDown={e => { if (e.key === "Enter") openSavedPath(fav.path); }}
                        tabIndex={0}
                      >
                        {fav.iconKey === "projects"  ? <FolderKanban  className="h-3.5 w-3.5 shrink-0 text-blue-500"   /> :
                         fav.iconKey === "plans"      ? <CalendarClock className="h-3.5 w-3.5 shrink-0 text-violet-500" /> :
                         fav.iconKey === "reports"    ? <FileText      className="h-3.5 w-3.5 shrink-0 text-amber-500"  /> :
                         fav.iconKey === "risks"      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500"    /> :
                                                        <Clock         className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />}
                        <span className="flex-1 text-xs text-foreground/80 truncate">{fav.title}</span>
                        <button
                          onClick={e => { e.stopPropagation(); toggleFav({ type: fav.type, title: fav.title, subtitle: fav.subtitle, path: fav.path, recordId: fav.recordId, iconKey: fav.iconKey, iconBg: fav.iconBg, status: fav.status }); }}
                          tabIndex={-1}
                          aria-label={t("globalSearch.removeFromFavorites")}
                          title={t("globalSearch.removeFromFavorites")}
                          className="h-5 w-5 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-amber-500 hover:bg-muted transition-all shrink-0"
                        >
                          <Star className="h-3 w-3 fill-amber-500" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-border/50 mt-2" />
                </div>
              )}
              {recentSearches.length > 0 ? (
                <>
                  <div className="flex items-center justify-between px-3 pt-1.5 pb-1">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 select-none flex items-center gap-1.5">
                      <Clock className="h-3 w-3" />
                      {t("globalSearch.recentSearches")}
                    </p>
                    <button
                      onClick={clearHistory}
                      className="text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    >
                      {t("globalSearch.clearAll")}
                    </button>
                  </div>
                  <div className="px-2 space-y-0.5">
                    {recentSearches.map((term) => (
                      <div
                        key={term}
                        className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 group cursor-pointer transition-colors"
                        onClick={() => {
                          setQuery(term);
                          fetchResults(term);
                        }}
                      >
                        <Clock className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                        <span className="flex-1 text-sm text-foreground/80 truncate">{term}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeSearch(term); }}
                          className="opacity-0 group-hover:opacity-100 h-4 w-4 flex items-center justify-center rounded text-muted-foreground/50 hover:text-foreground hover:bg-muted transition-all"
                          tabIndex={-1}
                          aria-label={`Remove "${term}" from history`}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  {recentItems.length > 0 && (
                    <div className="border-t border-border/50 mt-2 pt-2 px-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 mb-1 select-none flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {t("globalSearch.recentlyVisited")}
                      </p>
                      <div className="space-y-0.5">
                        {recentItems.slice(0, 5).map(item => {
                          const favId = `${item.iconKey}:${item.path}`;
                          const pinned = isFavorite(favId);
                          return (
                            <div
                              key={item.id}
                              role="option"
                              aria-selected="false"
                              title={item.title}
                              className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                               onClick={() => openSavedPath(item.path)}
                               onKeyDown={e => { if (e.key === "Enter") openSavedPath(item.path); }}
                              tabIndex={0}
                            >
                              {item.iconKey === "projects"  ? <FolderKanban  className="h-3.5 w-3.5 shrink-0 text-blue-500"   /> :
                               item.iconKey === "plans"      ? <CalendarClock className="h-3.5 w-3.5 shrink-0 text-violet-500" /> :
                               item.iconKey === "reports"    ? <FileText      className="h-3.5 w-3.5 shrink-0 text-amber-500"  /> :
                               item.iconKey === "risks"      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500"    /> :
                                                               <Clock         className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />}
                              <span className="flex-1 text-xs text-foreground/80 truncate">{item.title}</span>
                              <span className="text-xs text-muted-foreground/40 shrink-0 tabular-nums" title={new Date(item.ts).toLocaleString()}>
                                {itemTimeAgo(item.ts)}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); toggleFav({ type: item.type, title: item.title, subtitle: item.subtitle, path: item.path, recordId: item.recordId, iconKey: item.iconKey, iconBg: item.iconBg, status: item.status }); }}
                                tabIndex={-1}
                                aria-label={pinned ? "Remove from favorites" : "Pin to favorites"}
                                title={pinned ? "Remove from favorites" : "Pin to favorites"}
                                className={`h-5 w-5 flex items-center justify-center rounded shrink-0 transition-all ${pinned ? "text-amber-500 opacity-100" : "opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-amber-500"} hover:bg-muted`}
                              >
                                <Star className={`h-3 w-3 ${pinned ? "fill-amber-500" : ""}`} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="border-t border-border/50 mt-2 pt-2 px-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 mb-1 select-none flex items-center gap-1.5">
                      <TrendingUp className="h-3 w-3" />
                      {t("globalSearch.quickLinks")}
                    </p>
                    <div className="space-y-0.5">
                    <QuickLink label={t("globalSearch.groups.projects")} href="/projects" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.reports")} href="/reports" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.plans")} href="/plans" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.risks")} href="/risks" onClick={() => setOpen(false)} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="px-4 py-4">
                  {recentItems.length > 0 ? (
                    <>
                      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground/55 mb-1.5 select-none flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {t("globalSearch.recentlyVisited")}
                      </p>
                      <div className="space-y-0.5 mb-3">
                        {recentItems.slice(0, 5).map(item => {
                          const favId = `${item.iconKey}:${item.path}`;
                          const pinned = isFavorite(favId);
                          return (
                            <div
                              key={item.id}
                              role="option"
                              aria-selected="false"
                              title={item.title}
                              className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent/50 cursor-pointer transition-colors"
                              onClick={() => openSavedPath(item.path)}
                              onKeyDown={e => { if (e.key === "Enter") openSavedPath(item.path); }}
                              tabIndex={0}
                            >
                              {item.iconKey === "projects"  ? <FolderKanban  className="h-3.5 w-3.5 shrink-0 text-blue-500"   /> :
                               item.iconKey === "plans"      ? <CalendarClock className="h-3.5 w-3.5 shrink-0 text-violet-500" /> :
                               item.iconKey === "reports"    ? <FileText      className="h-3.5 w-3.5 shrink-0 text-amber-500"  /> :
                               item.iconKey === "risks"      ? <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-red-500"    /> :
                                                               <Clock         className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45" />}
                              <span className="flex-1 text-xs text-foreground/80 truncate">{item.title}</span>
                              <span className="text-xs text-muted-foreground/40 shrink-0 tabular-nums" title={new Date(item.ts).toLocaleString()}>
                                {itemTimeAgo(item.ts)}
                              </span>
                              <button
                                onClick={e => { e.stopPropagation(); toggleFav({ type: item.type, title: item.title, subtitle: item.subtitle, path: item.path, recordId: item.recordId, iconKey: item.iconKey, iconBg: item.iconBg, status: item.status }); }}
                                tabIndex={-1}
                                aria-label={pinned ? "Remove from favorites" : "Pin to favorites"}
                                title={pinned ? "Remove from favorites" : "Pin to favorites"}
                                className={`h-5 w-5 flex items-center justify-center rounded shrink-0 transition-all ${pinned ? "text-amber-500 opacity-100" : "opacity-0 group-hover:opacity-100 text-muted-foreground/40 hover:text-amber-500"} hover:bg-muted`}
                              >
                                <Star className={`h-3 w-3 ${pinned ? "fill-amber-500" : ""}`} />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-foreground mb-0.5">{t("globalSearch.searchEverything")}</p>
                      <p className="text-xs text-muted-foreground">
                        {t("globalSearch.searchEverythingHint")}
                      </p>
                    </>
                  )}
                  <div className="space-y-0.5">
                    <QuickLink label={t("globalSearch.groups.projects")} href="/projects" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.reports")} href="/reports" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.plans")} href="/plans" onClick={() => setOpen(false)} />
                    <QuickLink label={t("globalSearch.groups.risks")} href="/risks" onClick={() => setOpen(false)} />
                  </div>
                </div>
              )}
              <div className="h-1" />
            </div>
          )}

          {/* ── No results ──────────────────────────────────────── */}
          {isEmpty && !loading && (
            <div className="px-4 py-6 text-center">
              <Search className="h-8 w-8 text-muted-foreground/20 mx-auto mb-2" />
              <p className="text-sm font-medium text-foreground mb-1">
                {t("globalSearch.noResultsFor")} <span className="text-primary">"{query}"</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {t("globalSearch.noResultsTip")}
              </p>
            </div>
          )}

          {/* ── Results ─────────────────────────────────────────── */}
          {hasResults && !showLoading && (
            <div className="py-1.5 max-h-[420px] overflow-y-auto overscroll-contain [&::-webkit-scrollbar]:w-[3px] [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-thumb]:rounded-full">

              {/* Projects (ranked: favorites first → frequency → original) */}
              {sortedProjects.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.projects")} />
                  {sortedProjects.map((p, i) => (
                    <ResultRow
                      key={p.id}
                      isActive={activeIdx === offsets.projects + i}
                      onClick={() => navigate({ kind: "project", data: p }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.projects + i)}
                      icon={<FolderKanban className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />}
                      iconBg="bg-blue-500/10"
                      title={p.title}
                      subtitle={[p.code, p.sector].filter(Boolean).join(" · ")}
                      badge={<StatusBadge status={p.status} label={capitalize(p.status)} />}
                    />
                  ))}
                </section>
              )}

              {/* Plans (ranked: favorites first → frequency → original) */}
              {sortedPlans.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.plans")} />
                  {sortedPlans.map((pl, i) => (
                    <ResultRow
                      key={pl.id}
                      isActive={activeIdx === offsets.plans + i}
                      onClick={() => navigate({ kind: "plan", data: pl }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.plans + i)}
                      icon={<CalendarClock className="h-3.5 w-3.5 text-violet-600 dark:text-violet-400" />}
                      iconBg="bg-violet-500/10"
                      title={pl.title}
                      subtitle={[pl.code, pl.stateName ? getLinkedStateLabel(pl, i18n?.language) : pl.projectTitle].filter(Boolean).join(" · ")}
                      badge={<StatusBadge status={pl.status} label={capitalize(pl.status)} />}
                      time={timeAgo(pl.updatedAt, t)}
                    />
                  ))}
                </section>
              )}

              {/* Reports */}
              {results!.reports.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.reports")} />
                  {results!.reports.map((r, i) => (
                    <ResultRow
                      key={r.id}
                      isActive={activeIdx === offsets.reports + i}
                      onClick={() => navigate({ kind: "report", data: r }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.reports + i)}
                      icon={<FileText className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />}
                      iconBg="bg-amber-500/10"
                      title={r.title}
                      subtitle={[r.projectTitle ?? (r.stateName ? getLinkedStateLabel(r, i18n?.language) : null), r.kind].filter(Boolean).join(" · ")}
                      badge={<StatusBadge status={r.status} label={capitalize(r.status)} />}
                      time={timeAgo(r.updatedAt, t)}
                    />
                  ))}
                </section>
              )}

              {/* Risks */}
              {results!.risks.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.risks")} />
                  {results!.risks.map((r, i) => (
                    <ResultRow
                      key={r.id}
                      isActive={activeIdx === offsets.risks + i}
                      onClick={() => navigate({ kind: "risk", data: r }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.risks + i)}
                      icon={<AlertTriangle className="h-3.5 w-3.5 text-red-600 dark:text-red-400" />}
                      iconBg="bg-red-500/10"
                      title={r.title}
                      subtitle={[r.category, r.projectTitle ?? (r.stateName ? getLinkedStateLabel(r, i18n?.language) : null)].filter(Boolean).join(" · ")}
                      badge={<StatusBadge status={r.status} label={capitalize(r.status)} />}
                      time={timeAgo(r.updatedAt, t)}
                      extraLeft={<SeverityDot severity={r.severity} title={capitalize(r.severity)} />}
                    />
                  ))}
                </section>
              )}

              {/* Documents */}
              {results!.documents.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.documents")} />
                  {results!.documents.map((d, i) => (
                    <ResultRow
                      key={d.id}
                      isActive={activeIdx === offsets.documents + i}
                      onClick={() => navigate({ kind: "document", data: d }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.documents + i)}
                      icon={<Paperclip className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />}
                      iconBg="bg-teal-500/10"
                      title={d.fileName}
                      subtitle={[d.category, d.projectTitle].filter(Boolean).join(" · ")}
                      time={timeAgo(d.uploadedAt, t)}
                    />
                  ))}
                </section>
              )}

              {/* Users */}
              {results!.users.length > 0 && (
                <section>
                  <SectionHeader label={t("globalSearch.groups.users")} />
                  {results!.users.map((u, i) => (
                    <ResultRow
                      key={u.id}
                      isActive={activeIdx === offsets.users + i}
                      onClick={() => navigate({ kind: "user", data: u }, query)}
                      onMouseEnter={() => setActiveIdx(offsets.users + i)}
                      icon={<User className="h-3.5 w-3.5 text-muted-foreground" />}
                      iconBg="bg-muted"
                      title={u.name}
                      subtitle={u.email}
                      badge={
                        <span className="text-xs font-medium text-muted-foreground/70 whitespace-nowrap">
                          {u.roleLabel}
                        </span>
                      }
                    />
                  ))}
                </section>
              )}

              <div className="h-1.5" />
            </div>
          )}

          {/* ── Footer hint ─────────────────────────────────────── */}
          {(hasResults || !showEmpty) && !showLoading && (
            <div className="border-t border-border/40 px-3 py-1.5 flex items-center gap-3 text-xs text-muted-foreground/40 select-none">
              <span className="flex items-center gap-1"><kbd className="font-sans">↑↓</kbd> {t("globalSearch.hintNavigate")}</span>
              <span className="flex items-center gap-1"><kbd className="font-sans">↵</kbd> {t("globalSearch.hintOpen")}</span>
              <span className="flex items-center gap-1"><kbd className="font-sans">{t("keys.esc")}</kbd> {t("globalSearch.hintClose")}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
