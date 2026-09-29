import { useState, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, Search, FileText, Plus, Users, LayoutDashboard,
  FolderKanban, CalendarClock, PieChart, AlertTriangle, MessageSquare,
  Bell, Settings, ShieldCheck, ClipboardList, Wrench,
  BookMarked, Paperclip, X,
  Clock, ChevronRight, HelpCircle, ChevronDown,
  ArrowRight, Bot, Archive, UserCheck,
} from "@/components/icons";
import { Button, Card, Chip, Input, Modal, Spinner, TextArea } from "@heroui/react";
import { Field } from "@/components/form-controls";
import { SelectField } from "@/components/select-field";
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
  return <Icon className={className} aria-hidden="true" />;
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
  // Arabic month names with Western digits (the app-wide numbers rule).
  return new Date(iso).toLocaleDateString(lang === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "2-digit", month: "short", year: "numeric" });
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
      toast.error(e instanceof Error && !/^[a-z_]+$/.test(e.message) ? e.message : t("manual.createChapterFailed"));
    } finally {
      setCreating(false);
    }
  };

  const close = () => { reset(); onClose(); };

  return (
    <Modal isOpen={open} onOpenChange={(o) => { if (!o) close(); }}>
      <Modal.Backdrop isDismissable={!creating}>
        <Modal.Container size="md" scroll="inside">
          <Modal.Dialog className="sm:max-w-md">
            <Modal.CloseTrigger aria-label={t("manual.cancel")} />
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                <BookOpen className="size-5 text-[var(--accent)]" aria-hidden="true" />
                {t("manual.addChapterTitle")}
              </Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("manual.statusDraft")}</p>
            </Modal.Header>
            <Modal.Body className="space-y-3">
              <Field label={t("manual.chapterTitleLabel")} isRequired>
                {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("manual.chapterTitlePlaceholder")} className="w-full" dir="auto" />}
              </Field>
              <Field label={t("manual.slugLabel")}>
                {(id) => <Input id={id} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder={t("manual.slugPlaceholder")} className="w-full" dir="ltr" />}
              </Field>
              <Field label={t("manual.descriptionLabel")}>
                {(id) => <TextArea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full resize-none" dir="auto" />}
              </Field>
              <SelectField
                label={t("manual.statusLabel")}
                value={status}
                onChange={setStatus}
                options={[
                  { value: "draft", label: t("manual.statusDraft") },
                  { value: "published", label: t("manual.statusPublished") },
                ]}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button variant="secondary" onPress={close}>{t("manual.cancel")}</Button>
              <Button variant="primary" onPress={handleCreate} isDisabled={!title.trim()} isPending={creating}>
                {creating ? <><Spinner size="sm" color="current" />{t("manual.creating")}</> : t("manual.createChapter")}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
    <div className="absolute inset-x-0 top-full z-50 mt-1 max-h-80 overflow-hidden overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--overlay)] shadow-lg">
      {loading && (
        <div className="flex items-center gap-2 px-4 py-3 text-sm text-[var(--muted)]" role="status">
          <Spinner size="sm" />
          {t("manual.searchingLabel")}
        </div>
      )}
      {!loading && results.length === 0 && query.length >= 2 && (
        <div className="px-4 py-6 text-center text-sm text-[var(--muted)]" role="status">
          <Search className="mx-auto mb-2 size-8 opacity-20" aria-hidden="true" />
          <p>{t("manual.noSearchResults")}</p>
          <p className="mt-0.5 text-xs">{t("manual.noSearchResultsHint")}</p>
        </div>
      )}
      {!loading && results.length > 0 && (
        <>
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
            <span className="text-xs font-medium text-[var(--muted)]">
              {t("manual.searchResultsCount", { count: results.length, query })}
            </span>
            <Button isIconOnly size="sm" variant="ghost" onPress={onClear} aria-label={t("manual.clearSearch")}>
              <X className="size-3.5" aria-hidden="true" />
            </Button>
          </div>
          <ul id="manual-search-results" role="listbox" aria-label={t("manual.searchResultsLabel")}>
            {results.map((r, i) => (
              <li key={i}>
                <button
                  type="button"
                  id={`manual-search-option-${i}`}
                  role="option"
                  aria-selected={i === activeIndex}
                  className={`w-full border-b border-[var(--border)] px-4 py-3 text-start transition-colors last:border-0 hover:bg-[var(--default)] ${i === activeIndex ? "bg-[var(--default)]" : ""}`}
                  onClick={() => onSelect(r.slug)}
                >
                  <div className="flex items-start gap-2.5">
                    <FileText className="mt-0.5 size-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium">{r.chapterTitle}</p>
                      {r.sectionTitle && r.sectionTitle !== r.chapterTitle && (
                        <p className="truncate text-xs text-[var(--accent)]">{r.sectionTitle}</p>
                      )}
                      {r.excerpt && (
                        <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                          {r.excerpt.trim()}
                        </p>
                      )}
                    </div>
                    <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-[var(--muted)] rtl:rotate-180" aria-hidden="true" />
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

  // Shared look for the link cards (quick starts, modules, recent chapters).
  const linkCard = "group flex rounded-2xl border border-[var(--border)] bg-[var(--surface)] transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]";
  const iconTile = "shrink-0 rounded-lg bg-[var(--default)] p-1.5 text-[var(--muted)] transition-colors group-hover:bg-[var(--accent)]/10 group-hover:text-[var(--accent)]";

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <Card className="p-5 sm:p-6">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold">
              <BookOpen className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
              {t("manual.title")}
            </h1>
            <p className="mt-1 text-sm text-[var(--muted)]">{t("manual.description")}</p>
          </div>
          {canEdit && (
            <Button size="sm" variant="secondary" onPress={() => setAddChapterOpen(true)} className="shrink-0">
              <Plus className="size-3.5" aria-hidden="true" />
              {t("manual.addChapter")}
            </Button>
          )}
        </div>

        {/* Search */}
        <div ref={searchRef} className="relative max-w-2xl">
          <label htmlFor="manual-search" className="sr-only">{t("manual.searchAriaLabel")}</label>
          <Search className="pointer-events-none absolute start-3 top-1/2 z-10 size-4 -translate-y-1/2 text-[var(--muted)]" aria-hidden="true" />
          <Input
            id="manual-search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onKeyDown={handleSearchKeyDown}
            placeholder={t("manual.searchPlaceholder")}
            className="ps-9 pe-9 h-10 w-full"
            autoComplete="off"
            aria-label={t("manual.searchAriaLabel")}
            aria-expanded={showSearch}
            aria-haspopup="listbox"
            aria-controls="manual-search-results"
            aria-activedescendant={activeSearchIndex >= 0 ? `manual-search-option-${activeSearchIndex}` : undefined}
          />
          {searchQuery && (
            <Button
              isIconOnly
              size="sm"
              variant="ghost"
              className="absolute end-1.5 top-1/2 -translate-y-1/2"
              onPress={() => { setSearchQuery(""); setDebouncedQuery(""); }}
              aria-label={t("manual.clearSearch")}
            >
              <X className="size-3.5" aria-hidden="true" />
            </Button>
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
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
          <span>{t("manual.chapterCount", { count: chapters.filter(c => c.status === "published").length })}</span>
          <span aria-hidden="true">·</span>
          <span>{t("manual.sectionCountMeta", { count: totalSections })}</span>
          {totalSops > 0 && <><span aria-hidden="true">·</span><span>{t("manual.sopsCountMeta", { count: totalSops })}</span></>}
        </div>
      </Card>

      {/* ── Quick Start Guides ────────────────────────────────────── */}
      <section aria-labelledby="quick-start-heading">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="quick-start-heading" className="text-base font-semibold">{t("manual.quickStartGuides")}</h2>
          <span className="text-xs text-[var(--muted)]">{t("manual.quickStartSubtitle")}</span>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {QUICK_STARTS.map((qs) => {
            const Icon = ICON_MAP[qs.icon] ?? FileText;
            return (
              <Link key={qs.labelKey} href={qs.href} className={`${linkCard} items-center gap-3 px-4 py-3`}>
                <span className={iconTile}><Icon className="size-3.5" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium group-hover:text-[var(--accent)]">{t(qs.labelKey)}</span>
                  <span className="block text-xs text-[var(--muted)]">{t("manual.stepCount", { count: qs.steps })}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)] rtl:rotate-180" aria-hidden="true" />
              </Link>
            );
          })}
        </div>
      </section>

      {/* ── Browse By Module ─────────────────────────────────────── */}
      <section aria-labelledby="browse-modules-heading">
        <h2 id="browse-modules-heading" className="mb-3 text-base font-semibold">{t("manual.browseByModule")}</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PMIS_MODULES.map((mod) => {
            const Icon = ICON_MAP[mod.icon] ?? FileText;
            return (
              <Link key={mod.slug} href={mod.href} className={`${linkCard} h-full items-start gap-3 px-4 py-3.5`}>
                <span className={`${iconTile} mt-0.5`}><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium group-hover:text-[var(--accent)]">{t(mod.labelKey)}</span>
                  <span className="mt-0.5 block text-xs leading-snug text-[var(--muted)]">{t(mod.descKey)}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* ── Frequently Asked Questions ─────────────────────────── */}
        <section aria-labelledby="faq-heading">
          <h2 id="faq-heading" className="mb-3 text-base font-semibold">{t("manual.frequentlyAskedQuestions")}</h2>
          {landingFaqs.length > 0 ? (
            <Card className="gap-0 divide-y divide-[var(--border)] overflow-hidden p-0">
              {landingFaqs.map((faq) => {
                const isOpen = openFaqId === faq.id;
                return (
                  <div key={faq.id}>
                    <button
                      type="button"
                      className="group flex w-full items-start justify-between gap-3 px-4 py-3.5 text-start transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
                      onClick={() => setOpenFaqId(isOpen ? null : faq.id)}
                      aria-expanded={isOpen}
                      aria-controls={`faq-answer-${faq.id}`}
                    >
                      <span className="text-sm font-medium leading-snug group-hover:text-[var(--accent)]" dir="auto">{faq.question}</span>
                      <ChevronDown
                        className={`mt-0.5 size-4 shrink-0 text-[var(--muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
                        aria-hidden="true"
                      />
                    </button>
                    <div id={`faq-answer-${faq.id}`} role="region" hidden={!isOpen} className="bg-[var(--default)]/40 px-4 pb-4 pt-1">
                      <p className="text-sm leading-relaxed text-[var(--muted)]" dir="auto">{faq.answer}</p>
                    </div>
                  </div>
                );
              })}
            </Card>
          ) : (
            <Card className="items-center px-4 py-8 text-center text-sm text-[var(--muted)]">
              <HelpCircle className="size-8 opacity-20" aria-hidden="true" />
              {t("manual.noFaqsYet")}
            </Card>
          )}
          <div className="mt-3 text-center">
            <Link href="/manual/faq" className="text-sm text-[var(--accent)] hover:underline">
              {t("manual.viewAllFaqs")} <span aria-hidden="true" className="inline-block rtl:-scale-x-100">→</span>
            </Link>
          </div>
        </section>

        {/* ── Recently Updated ──────────────────────────────────── */}
        <section aria-labelledby="recent-heading">
          <h2 id="recent-heading" className="mb-3 text-base font-semibold">{t("manual.recentlyUpdated")}</h2>
          {recentChapters.length > 0 ? (
            <Card className="gap-0 divide-y divide-[var(--border)] overflow-hidden p-0">
              {recentChapters.map((ch) => (
                <Link
                  key={ch.id}
                  href={`/manual/${ch.slug}`}
                  className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
                >
                  <span className={iconTile}><ChapterIcon name={ch.icon} className="size-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium group-hover:text-[var(--accent)]">{ch.title}</span>
                    <span className="mt-0.5 flex items-center gap-2">
                      <Clock className="size-2.5 text-[var(--muted)]" aria-hidden="true" />
                      <span className="text-xs text-[var(--muted)]">{fmtRelative(ch.updatedAt, lang, t)}</span>
                      {ch.status === "draft" && <Chip size="sm" variant="soft" color="warning">{t("manual.draft")}</Chip>}
                    </span>
                  </span>
                  <ChevronRight className="size-3.5 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)] rtl:rotate-180" aria-hidden="true" />
                </Link>
              ))}
            </Card>
          ) : (
            <Card className="items-center px-4 py-8 text-center text-sm text-[var(--muted)]">
              <Clock className="size-8 opacity-20" aria-hidden="true" />
              {t("manual.noChaptersYet")}
            </Card>
          )}
        </section>
      </div>

      {/* ── Role Guides link ─────────────────────────────────────── */}
      <Card className="flex-row flex-wrap items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className="rounded-lg bg-[var(--accent)]/10 p-2 text-[var(--accent)]">
            <Users className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-medium">{t("roleGuide.title")}</p>
            <p className="mt-0.5 text-xs text-[var(--muted)]">{t("roleGuide.subtitle")}</p>
          </div>
        </div>
        <Link
          href={`/manual/guides/${me?.user.role ?? "viewer"}`}
          className="button button--secondary button--sm shrink-0 gap-1.5"
        >
          {t("manual.roleGuides")}
          <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
        </Link>
      </Card>

      <AddChapterModal open={addChapterOpen} onClose={() => setAddChapterOpen(false)} />
    </div>
  );
}
