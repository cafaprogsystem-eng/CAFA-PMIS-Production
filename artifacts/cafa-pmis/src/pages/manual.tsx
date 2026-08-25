import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Search, FileText, Plus, Users, LayoutDashboard,
  FolderKanban, CalendarClock, PieChart, AlertTriangle, MessageSquare,
  Bell, Settings, ShieldCheck, ClipboardList, Wrench,
  BookMarked, Paperclip, Loader2, X,
  Clock, ChevronRight, HelpCircle, ChevronDown,
  ArrowRight, Bot, Archive, UserCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/language-context";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Chapter = {
  id: number; title: string; slug: string; description: string | null;
  icon: string; order: number; status: string;
  sectionCount: number; sopCount: number; updatedAt: string;
};

type SearchResult = {
  id: number; slug: string; chapterTitle: string; sectionTitle: string; excerpt: string;
};

type FaqItem = { id: number; question: string; answer: string; order: number };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen, FileText, Users, LayoutDashboard, FolderKanban, CalendarClock,
  PieChart, AlertTriangle, MessageSquare, Bell, Settings,
  ShieldCheck, ClipboardList, Wrench, BookMarked, Paperclip, Search,
  Bot, Archive, UserCheck,
};

function ChapterIcon({ name, className }: { name: string; className?: string }) {
  const Icon = ICON_MAP[name] ?? FileText;
  return <Icon className={className} />;
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, { credentials: "include", ...options });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "request_failed" }));
    throw new Error((err as { error?: string }).error ?? "request_failed");
  }
  return res.json();
}

function fmtDate(iso: string, lang: "en" | "ar") {
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-SD" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtRelative(iso: string, lang: "en" | "ar", t: (key: string, values?: Record<string, unknown>) => string) {
  const now = Date.now();
  const then = new Date(iso).getTime();
  const diff = now - then;
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return t("manual.relativeToday");
  if (days === 1) return t("manual.relativeYesterday");
  if (days < 7) return t("manual.relativeDaysAgo", { count: days });
  if (days < 30) return t("manual.relativeWeeksAgo", { count: Math.floor(days / 7) });
  return fmtDate(iso, lang);
}

// ---------------------------------------------------------------------------
// Module cards (current PMIS modules)
// ---------------------------------------------------------------------------
const PMIS_MODULES = [
  { slug: "dashboard",              icon: "LayoutDashboard", labelKey: "manual.modules.dashboard",            descKey: "manual.moduleDesc.dashboard",            href: "/manual/dashboard"              },
  { slug: "projects",               icon: "FolderKanban",    labelKey: "manual.modules.projects",             descKey: "manual.moduleDesc.projects",             href: "/manual/projects"               },
  { slug: "planning",               icon: "CalendarClock",   labelKey: "manual.modules.planning",             descKey: "manual.moduleDesc.planning",             href: "/manual/planning"               },
  { slug: "budget",                 icon: "PieChart",        labelKey: "manual.modules.budgets",              descKey: "manual.moduleDesc.budgets",              href: "/manual/budget"                 },
  { slug: "reports",                icon: "FileText",        labelKey: "manual.modules.reports",              descKey: "manual.moduleDesc.reports",              href: "/manual/reports"                },
  { slug: "risks",                  icon: "AlertTriangle",   labelKey: "manual.modules.riskRegister",         descKey: "manual.moduleDesc.riskRegister",         href: "/manual/risks"                  },
  { slug: "notifications",          icon: "Bell",            labelKey: "manual.modules.notifications",        descKey: "manual.moduleDesc.notifications",        href: "/manual/notifications"          },
  { slug: "communication",          icon: "MessageSquare",   labelKey: "manual.modules.communicationCentre",  descKey: "manual.moduleDesc.communicationCentre",  href: "/manual/communication"          },
  { slug: "document-repository",    icon: "Archive",         labelKey: "manual.modules.fileArchive",          descKey: "manual.moduleDesc.fileArchive",          href: "/manual/document-repository"    },
  { slug: "ai-assistant",           icon: "Bot",             labelKey: "manual.modules.ai",                   descKey: "manual.moduleDesc.ai",                   href: "/manual/ai-assistant"           },
  { slug: "admin-settings-users",   icon: "UserCheck",       labelKey: "manual.modules.userManagement",       descKey: "manual.moduleDesc.userManagement",       href: "/manual/admin-settings"         },
  { slug: "admin-settings-states",  icon: "ShieldCheck",     labelKey: "manual.modules.states",               descKey: "manual.moduleDesc.states",               href: "/manual/admin-settings"         },
  { slug: "approvals-workflow",     icon: "ClipboardList",   labelKey: "manual.modules.auditLog",             descKey: "manual.moduleDesc.auditLog",             href: "/manual/approvals-workflow"     },
  { slug: "user-roles-permissions", icon: "Users",           labelKey: "manual.modules.myProfile",            descKey: "manual.moduleDesc.myProfile",            href: "/manual/user-roles-permissions" },
  { slug: "introduction",           icon: "BookOpen",        labelKey: "manual.modules.gettingStarted",       descKey: "manual.moduleDesc.gettingStarted",       href: "/manual/introduction"           },
];

// ---------------------------------------------------------------------------
// Quick Start tasks
// ---------------------------------------------------------------------------
const QUICK_STARTS = [
  { labelKey: "manual.quickStart.createProject",               href: "/manual/projects",               icon: "FolderKanban",  steps: 8 },
  { labelKey: "manual.quickStart.continueEditingDraftProject", href: "/manual/projects",               icon: "FolderKanban",  steps: 3 },
  { labelKey: "manual.quickStart.createPlan",                  href: "/manual/planning",               icon: "CalendarClock", steps: 4 },
  { labelKey: "manual.quickStart.continueEditingDraftPlan",    href: "/manual/planning",               icon: "CalendarClock", steps: 3 },
  { labelKey: "manual.quickStart.submitReport",                href: "/manual/reports",                icon: "FileText",      steps: 5 },
  { labelKey: "manual.quickStart.reviewReport",                href: "/manual/approvals-workflow",     icon: "ClipboardList", steps: 4 },
  { labelKey: "manual.quickStart.registerRisk",                href: "/manual/risks",                  icon: "AlertTriangle", steps: 5 },
  { labelKey: "manual.quickStart.uploadDocument",              href: "/manual/document-repository",    icon: "Archive",       steps: 4 },
];

// ---------------------------------------------------------------------------
// Add Chapter modal
// ---------------------------------------------------------------------------
function AddChapterModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation("knowledge");
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState("draft");
  const [creating, setCreating] = useState(false);

  const reset = () => { setTitle(""); setSlug(""); setDescription(""); setStatus("draft"); };

  const handleCreate = async () => {
    if (!title.trim()) return;
    const autoSlug = slug.trim() || title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
    setCreating(true);
    try {
      await apiFetch("/api/manual/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), slug: autoSlug, description: description.trim() || null, status }),
      });
      toast.success(t("manual.chapterCreated"));
      qc.invalidateQueries({ queryKey: ["manual", "chapters"] });
      onClose();
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to create chapter");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) { reset(); onClose(); } }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-[#1a3c5e]" />
            {t("manual.addChapterTitle")}
          </DialogTitle>
          <DialogDescription>{t("manual.statusDraft")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div>
            <Label className="text-xs font-medium">{t("manual.chapterTitleLabel")}</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("manual.chapterTitlePlaceholder")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium">{t("manual.slugLabel")}</Label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("manual.slugPlaceholder")} className="mt-1" />
          </div>
          <div>
            <Label className="text-xs font-medium">{t("manual.descriptionLabel")}</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="mt-1 text-xs resize-none" />
          </div>
          <div>
            <Label className="text-xs font-medium">{t("manual.statusLabel")}</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">{t("manual.statusDraft")}</SelectItem>
                <SelectItem value="published">{t("manual.statusPublished")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={() => { reset(); onClose(); }}>{t("manual.cancel")}</Button>
          <Button size="sm" onClick={handleCreate} disabled={!title.trim() || creating} className="gap-1.5">
            {creating ? <><Loader2 className="h-4 w-4 animate-spin" />{t("manual.creating")}</> : t("manual.createChapter")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Search results dropdown
// ---------------------------------------------------------------------------
function SearchDropdown({
  results, query, loading, activeIndex, onSelect, onClear,
}: {
  results: SearchResult[];
  query: string;
  loading: boolean;
  activeIndex: number;
  onSelect: (slug: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation("knowledge");
  if (!query.trim() || query.length < 2) return null;

  return (
    <div className="absolute top-full inset-x-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 overflow-hidden max-h-80 overflow-y-auto">
      {loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("manual.searchingLabel")}
        </div>
      )}
      {!loading && results.length === 0 && query.length >= 2 && (
        <div className="px-4 py-6 text-center text-sm text-muted-foreground">
          <Search className="h-8 w-8 mx-auto mb-2 opacity-20" />
          <p>{t("manual.noSearchResults")}</p>
          <p className="text-xs mt-0.5">{t("manual.noSearchResultsHint")}</p>
        </div>
      )}
      {!loading && results.length > 0 && (
        <>
          <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">
              {t("manual.searchResultsCount", { count: results.length, query })}
            </span>
            <button onClick={onClear} className="text-xs text-muted-foreground hover:text-slate-800">
              <X className="h-3 w-3" />
            </button>
          </div>
          <ul id="manual-search-results" role="listbox" aria-label={t("manual.searchResultsLabel")}>
            {results.map((r, i) => (
              <li key={i}>
                <button
                  id={`manual-search-option-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`w-full text-start px-4 py-3 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-0 ${i === activeIndex ? "bg-slate-50" : ""}`}
                  onClick={() => onSelect(r.slug)}
                >
                  <div className="flex items-start gap-2.5">
                    <FileText className="h-3.5 w-3.5 text-[#2d6a9f] shrink-0 mt-0.5" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-800 truncate">{r.chapterTitle}</p>
                      {r.sectionTitle && r.sectionTitle !== r.chapterTitle && (
                        <p className="text-xs text-[#2d6a9f] truncate">{r.sectionTitle}</p>
                      )}
                      {r.excerpt && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">
                          {r.excerpt.trim()}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-300 shrink-0 mt-0.5 rtl:rotate-180" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Manual Landing Page
// ---------------------------------------------------------------------------
export default function ManualHome() {
  const { t } = useTranslation("knowledge");
  const { lang } = useLanguage();
  const { data: me } = useGetMe();
  const [, navigate] = useLocation();
  const canEdit = ["super_admin", "program_manager"].includes(me?.user.role ?? "");

  const [addChapterOpen, setAddChapterOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [openFaqId, setOpenFaqId] = useState<number | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    setActiveSearchIndex(-1);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Close search dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setSearchFocused(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Chapters
  const { data: chapters = [] } = useQuery<Chapter[]>({
    queryKey: ["manual", "chapters", lang],
    queryFn: () => apiFetch(`/api/manual/chapters?locale=${lang}`),
  });

  // Search
  const { data: searchResults = [], isLoading: searchLoading } = useQuery<SearchResult[]>({
    queryKey: ["manual", "search", lang, debouncedQuery],
    queryFn: () => apiFetch(`/api/manual/search?locale=${lang}&q=${encodeURIComponent(debouncedQuery)}`),
    enabled: debouncedQuery.length >= 2,
    staleTime: 30_000,
  });

  // FAQs (first category from grouped endpoint)
  const { data: faqGroups = {} } = useQuery<Record<string, FaqItem[]>>({
    queryKey: ["manual", "faqs", lang],
    queryFn: () => apiFetch(`/api/manual/faqs?locale=${lang}`),
    staleTime: 60_000,
  });

  // Pick 3–4 FAQs from available categories
  const landingFaqs = Object.values(faqGroups).flat().slice(0, 4);

  // Recently updated chapters (last 5 by updatedAt)
  const recentChapters = [...chapters]
    .filter(c => c.status === "published" || canEdit)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, 5);

  // Stats
  const totalSections = chapters.reduce((s, c) => s + c.sectionCount, 0);
  const totalSops = chapters.reduce((s, c) => s + c.sopCount, 0);

  const handleSelectSearchResult = useCallback((slug: string) => {
    setSearchQuery("");
    setDebouncedQuery("");
    setSearchFocused(false);
    navigate(`/manual/${slug}`);
  }, [navigate]);

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSearch || searchLoading || searchResults.length === 0) {
      if (event.key === "Escape") setSearchFocused(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveSearchIndex((current) => Math.min(current + 1, searchResults.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveSearchIndex((current) => Math.max(current - 1, 0));
    } else if (event.key === "Enter" && activeSearchIndex >= 0) {
      event.preventDefault();
      handleSelectSearchResult(searchResults[activeSearchIndex].slug);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setSearchFocused(false);
    }
  };

  const showSearch = searchFocused && searchQuery.length >= 2;

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      {/* ── Compact Header ──────────────────────────────────────────── */}
      <div className="bg-white border-b border-slate-100">
        <div className="max-w-5xl mx-auto px-6 py-8">
          <div className="flex items-start justify-between gap-4 mb-5">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{t("manual.title")}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                {t("manual.description")}
              </p>
            </div>
            {canEdit && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setAddChapterOpen(true)}
                className="gap-1.5 shrink-0"
              >
                <Plus className="h-3.5 w-3.5" />
                {t("manual.addChapter")}
              </Button>
            )}
          </div>

          {/* Search */}
          <div ref={searchRef} className="relative max-w-2xl">
            <label htmlFor="manual-search" className="sr-only">{t("manual.searchAriaLabel")}</label>
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              id="manual-search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => setSearchFocused(true)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t("manual.searchPlaceholder")}
              className="ps-9 pe-9 h-10"
              autoComplete="off"
              aria-label={t("manual.searchAriaLabel")}
              aria-expanded={showSearch}
              aria-haspopup="listbox"
              aria-controls="manual-search-results"
              aria-activedescendant={activeSearchIndex >= 0 ? `manual-search-option-${activeSearchIndex}` : undefined}
            />
            {searchQuery && (
              <button
                className="absolute end-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-800"
                onClick={() => { setSearchQuery(""); setDebouncedQuery(""); }}
                aria-label={t("manual.clearSearch")}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {showSearch && (
              <div role="region" aria-label={t("manual.searchResultsLabel")}>
                <SearchDropdown
                  results={searchResults}
                  query={debouncedQuery}
                  loading={searchLoading}
                  activeIndex={activeSearchIndex}
                  onSelect={handleSelectSearchResult}
                  onClear={() => { setSearchQuery(""); setDebouncedQuery(""); setSearchFocused(false); }}
                />
              </div>
            )}
          </div>

          {/* Compact metadata */}
          <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
            <span>{t("manual.chapterCount", { count: chapters.filter(c => c.status === "published").length })}</span>
            <span>·</span>
            <span>{t("manual.sectionCountMeta", { count: totalSections })}</span>
            {totalSops > 0 && <><span>·</span><span>{t("manual.sopsCountMeta", { count: totalSops })}</span></>}
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-10">

        {/* ── Quick Start Guides ────────────────────────────────────── */}
        <section aria-labelledby="quick-start-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="quick-start-heading" className="text-base font-bold text-slate-900">
              {t("manual.quickStartGuides")}
            </h2>
            <span className="text-xs text-muted-foreground">{t("manual.quickStartSubtitle")}</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QUICK_STARTS.map((qs) => {
              const Icon = ICON_MAP[qs.icon] ?? FileText;
              return (
                <Link key={qs.labelKey} href={qs.href}>
                  <div className="flex items-center gap-3 bg-white border border-slate-100 rounded-lg px-4 py-3 hover:border-[#2d6a9f] hover:shadow-sm cursor-pointer transition-all group">
                    <div className="p-1.5 rounded-md bg-[#eef4fb] text-[#2d6a9f] shrink-0 group-hover:bg-[#2d6a9f] group-hover:text-white transition-colors">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 group-hover:text-[#1a3c5e] truncate">{t(qs.labelKey)}</p>
                      <p className="text-xs text-muted-foreground">{t("manual.stepCount", { count: qs.steps })}</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-[#2d6a9f] shrink-0 rtl:rotate-180" />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ── Browse By Module ─────────────────────────────────────── */}
        <section aria-labelledby="browse-modules-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="browse-modules-heading" className="text-base font-bold text-slate-900">{t("manual.browseByModule")}</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PMIS_MODULES.map((mod) => {
              const Icon = ICON_MAP[mod.icon] ?? FileText;
              return (
                <Link key={mod.slug} href={mod.href}>
                  <div className="flex items-start gap-3 bg-white border border-slate-100 rounded-xl px-4 py-3.5 hover:border-[#2d6a9f] hover:shadow-sm cursor-pointer transition-all group h-full">
                    <div className="p-1.5 rounded-md bg-slate-50 text-slate-500 group-hover:bg-[#eef4fb] group-hover:text-[#2d6a9f] transition-colors shrink-0 mt-0.5">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800 group-hover:text-[#1a3c5e]">{t(mod.labelKey)}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{t(mod.descKey)}</p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* ── Frequently Asked Questions ─────────────────────────── */}
          <section aria-labelledby="faq-heading">
            <div className="flex items-center justify-between mb-4">
              <h2 id="faq-heading" className="text-base font-bold text-slate-900">
                {t("manual.frequentlyAskedQuestions")}
              </h2>
            </div>
            {landingFaqs.length > 0 ? (
              <div className="bg-white border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50">
                {landingFaqs.map((faq) => {
                  const isOpen = openFaqId === faq.id;
                  return (
                    <div key={faq.id}>
                      <button
                        className="w-full flex items-start justify-between px-4 py-3.5 text-start hover:bg-slate-50/80 transition-colors group gap-3"
                        onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                        aria-expanded={isOpen}
                        aria-controls={`faq-answer-${faq.id}`}
                      >
                        <span className="text-sm font-medium text-slate-800 group-hover:text-[#1a3c5e] leading-snug">
                          {faq.question}
                        </span>
                        <ChevronDown
                          className={`h-4 w-4 text-slate-400 shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                          aria-hidden="true"
                        />
                      </button>
                      <div
                        id={`faq-answer-${faq.id}`}
                        role="region"
                        hidden={!isOpen}
                        className="px-4 pb-4 pt-1 bg-slate-50/40"
                      >
                        <p className="text-sm text-slate-600 leading-relaxed">{faq.answer}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="bg-white border border-slate-100 rounded-xl px-4 py-8 text-center text-muted-foreground text-sm">
                <HelpCircle className="h-8 w-8 mx-auto mb-2 opacity-20" />
                {t("manual.noFaqsYet")}
              </div>
            )}
            <div className="mt-3 text-center">
              <Link href="/manual/faq">
                <button className="text-sm text-[#2d6a9f] hover:text-[#1a3c5e] hover:underline transition-colors">
                  {t("manual.viewAllFaqs")} →
                </button>
              </Link>
            </div>
          </section>

          {/* ── Recently Updated ──────────────────────────────────── */}
          <section aria-labelledby="recent-heading">
            <div className="flex items-center justify-between mb-4">
              <h2 id="recent-heading" className="text-base font-bold text-slate-900">
                {t("manual.recentlyUpdated")}
              </h2>
            </div>
            {recentChapters.length > 0 ? (
              <div className="bg-white border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50">
                {recentChapters.map((ch) => (
                  <Link key={ch.id} href={`/manual/${ch.slug}`}>
                    <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50 cursor-pointer transition-colors group">
                      <div className="p-1.5 rounded-md bg-slate-50 text-slate-400 group-hover:bg-[#eef4fb] group-hover:text-[#2d6a9f] transition-colors shrink-0">
                        <ChapterIcon name={ch.icon} className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-slate-800 group-hover:text-[#1a3c5e] truncate">{ch.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <Clock className="h-2.5 w-2.5 text-slate-400" />
                          <span className="text-xs text-muted-foreground">{fmtRelative(ch.updatedAt, lang, t)}</span>
                          {ch.status === "draft" && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 border-amber-200 text-amber-600 bg-amber-50">{t("manual.draft")}</Badge>
                          )}
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#2d6a9f] shrink-0 rtl:rotate-180" />
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="bg-white border border-slate-100 rounded-xl px-4 py-8 text-center text-muted-foreground text-sm">
                <Clock className="h-8 w-8 mx-auto mb-2 opacity-20" />
                {t("manual.noChaptersYet")}
              </div>
            )}
          </section>
        </div>

        {/* ── Role Guides link ─────────────────────────────────────── */}
        <section className="bg-white border border-slate-100 rounded-xl px-5 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#eef4fb] text-[#2d6a9f]">
              <Users className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-800">{t("roleGuide.title")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t("roleGuide.subtitle")}</p>
            </div>
          </div>
          <Link href={`/manual/guides/${me?.user.role ?? "viewer"}`}>
            <Button variant="outline" size="sm" className="gap-1.5 shrink-0">
              {t("manual.roleGuides")}
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" />
            </Button>
          </Link>
        </section>

      </div>

      <AddChapterModal open={addChapterOpen} onClose={() => setAddChapterOpen(false)} />
    </div>
  );
}
