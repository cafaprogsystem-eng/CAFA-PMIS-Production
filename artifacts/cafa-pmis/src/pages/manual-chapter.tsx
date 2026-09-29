import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen, FileText, Users, LayoutDashboard, FolderKanban, CalendarClock,
  PieChart, AlertTriangle, MessageSquare, Bell, CheckCircle2, Settings,
  ShieldCheck, ClipboardList, Wrench, BookMarked, Paperclip, Calendar,
  Search, ChevronRight, Pencil, Trash2, Plus, X, Save, FileDown,
  Download, ClipboardCheck, ThumbsUp, ThumbsDown, ArrowRight,
  Menu, Archive, Bot,
} from "@/components/icons";
import { Button, Card, Chip, Input, Skeleton, TextArea } from "@heroui/react";
import { ConfirmModal } from "@/components/confirm-modal";
import { Field } from "@/components/form-controls";
import { ManualMarkdown } from "@/lib/manual-markdown";
import { toast } from "sonner";
import { useGetMe } from "@workspace/api-client-react";
import { useLanguage } from "@/contexts/language-context";

type Section = {
  id: number;
  chapterId: number;
  title: string;
  content: string;
  order: number;
};

type SOP = {
  id: number;
  processName: string;
  purpose: string | null;
  responsibleRole: string | null;
  steps: string[] | null;
  requiredInputs: string | null;
  approvalFlow: string | null;
  outputs: string | null;
  timeline: string | null;
  relatedModule: string | null;
  notifications: string | null;
};

type ChapterDetail = {
  id: number;
  title: string;
  slug: string;
  description: string | null;
  icon: string;
  order: number;
  status: string;
  sectionCount: number;
  sopCount: number;
  updatedAt: string;
  sections: Section[];
  sops: SOP[];
};

type ChapterSummary = {
  id: number;
  title: string;
  slug: string;
  order: number;
  icon: string;
  sectionCount: number;
};

const ICON_MAP: Record<string, React.ElementType> = {
  BookOpen, FileText, Users, LayoutDashboard, FolderKanban, CalendarClock,
  PieChart, AlertTriangle, MessageSquare, Bell, CheckCircle2, Settings,
  ShieldCheck, ClipboardList, Wrench, BookMarked, Paperclip, Calendar, Search,
  Archive, Bot, Menu,
};

// ── Category organisation for left nav ──────────────────────────────────
type NavCategory = {
  labelKey: string;
  slugs: string[];
};

const NAV_CATEGORIES: NavCategory[] = [
  {
    labelKey: "manual.navCategories.gettingStarted",
    slugs: ["introduction", "getting-started", "navigation", "overview"],
  },
  {
    labelKey: "manual.navCategories.programmeManagement",
    slugs: ["projects", "planning", "reports", "budget", "approvals-workflow", "risks", "activity-reports"],
  },
  {
    labelKey: "manual.navCategories.communicationOperationalTools",
    slugs: ["communication", "notifications", "file-archive", "document-repository", "documents-attachments", "search-filters-export"],
  },
  {
    labelKey: "manual.navCategories.administration",
    slugs: ["ai-assistant", "admin-settings", "users", "user-roles-permissions", "user-roles", "audit-log", "states", "data-quality"],
  },
  {
    labelKey: "manual.navCategories.support",
    slugs: ["system-manual", "manual", "support", "glossary", "sops", "troubleshooting", "annexes"],
  },
];

function getCategoryForSlug(slug: string): string {
  for (const cat of NAV_CATEGORIES) {
    if (cat.slugs.some((s) => slug === s || slug.startsWith(s))) return cat.labelKey;
  }
  return "manual.navCategories.other";
}

function groupChaptersByCategory(chapters: ChapterSummary[]) {
  const grouped: Record<string, ChapterSummary[]> = {};
  const orderedCats: string[] = [];
  for (const ch of chapters) {
    const cat = getCategoryForSlug(ch.slug);
    if (!grouped[cat]) {
      grouped[cat] = [];
      orderedCats.push(cat);
    }
    grouped[cat].push(ch);
  }
  return { grouped, orderedCats };
}

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

/** Escapes text for the Word export, which is assembled as an HTML string. */
function escapeHtml(value: string | null | undefined): string {
  return (value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** API errors arrive as snake_case codes; show a translated sentence instead. */
function errorText(e: Error, fallback: string): string {
  return /^[a-z_]+$/.test(e.message) ? fallback : e.message;
}

/* ── SOP Card ──────────────────────────────────────────────────────── */
function SOPCard({ sop, canEdit, onDelete }: { sop: SOP; canEdit: boolean; onDelete: (id: number) => void }) {
  const { t } = useTranslation("knowledge");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const steps = Array.isArray(sop.steps) ? sop.steps : [];

  const fields: Array<[string, string | null, "chip" | "text"]> = [
    [t("chapter.purpose"), sop.purpose, "text"],
    [t("chapter.responsibleRole"), sop.responsibleRole, "chip"],
    [t("chapter.requiredInputs"), sop.requiredInputs, "text"],
    [t("chapter.approvalFlow"), sop.approvalFlow, "text"],
    [t("chapter.outputs"), sop.outputs, "text"],
    [t("chapter.timeline"), sop.timeline, "text"],
    [t("chapter.relatedModule"), sop.relatedModule, "chip"],
    [t("chapter.notifications"), sop.notifications, "text"],
  ];

  return (
    <Card className="space-y-3 border border-[var(--accent)]/20 bg-[var(--accent)]/5 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <h4 className="text-sm font-semibold" dir="auto">{sop.processName}</h4>
        </div>
        {canEdit && (
          <Button isIconOnly variant="ghost" size="sm" className="shrink-0 text-[var(--danger)]" aria-label={t("chapter.deleteSopTitle")} onPress={() => setConfirmDelete(true)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>

      <dl className="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
        {fields.filter(([, value]) => value).map(([label, value, kind]) => (
          <div key={label}>
            <dt className="mb-0.5 font-medium text-[var(--muted)]">{label}</dt>
            <dd dir="auto">{kind === "chip" ? <Chip size="sm" variant="soft">{value}</Chip> : value}</dd>
          </div>
        ))}
      </dl>

      {steps.length > 0 && (
        <div>
          <span className="mb-2 block text-xs font-medium text-[var(--muted)]">{t("chapter.steps")}</span>
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="w-5 shrink-0 font-semibold text-[var(--accent)]" aria-hidden="true"><bdi dir="ltr">{i + 1}.</bdi></span>
                <span dir="auto">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <ConfirmModal
        isOpen={confirmDelete}
        title={t("chapter.deleteSopTitle")}
        message={t("chapter.deleteSopDesc")}
        confirmLabel={t("chapter.deleteButton")}
        cancelLabel={t("chapter.cancel")}
        onConfirm={() => { setConfirmDelete(false); onDelete(sop.id); }}
        onCancel={() => setConfirmDelete(false)}
      />
    </Card>
  );
}

/* ── Main page ─────────────────────────────────────────────────────── */
export default function ManualChapter({ slug }: { slug: string }) {
  const { t } = useTranslation("knowledge");
  const { lang } = useLanguage();
  const { data: me } = useGetMe();
  const canEdit = ["super_admin", "program_manager"].includes(me?.user.role ?? "");
  const canEditContent = ["super_admin", "program_manager", "senior_program_coordinator"].includes(me?.user.role ?? "");
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  const [editingSectionId, setEditingSectionId] = useState<number | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editContent, setEditContent] = useState("");
  const [addingSection, setAddingSection] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionContent, setNewSectionContent] = useState("");
  const [deleteSectionId, setDeleteSectionId] = useState<number | null>(null);
  const [deleteChapterConfirm, setDeleteChapterConfirm] = useState(false);
  const [feedbackVoted, setFeedbackVoted] = useState<boolean | null>(null);
  const [feedbackStats, setFeedbackStats] = useState<{ helpful: number; notHelpful: number } | null>(null);

  const { data: chapter, isLoading } = useQuery<ChapterDetail>({
    queryKey: ["manual", "chapter", slug, lang],
    queryFn: () => apiFetch(`/api/manual/chapters/${slug}?locale=${lang}`),
  });

  const { data: allChapters = [] } = useQuery<ChapterSummary[]>({
    queryKey: ["manual", "chapters", lang],
    queryFn: () => apiFetch(`/api/manual/chapters?locale=${lang}`),
  });

  const { data: initialFeedback } = useQuery<{ helpful: number; notHelpful: number }>({
    queryKey: ["manual", "feedback", slug],
    queryFn: () => apiFetch(`/api/manual/chapters/${slug}/feedback`),
    enabled: !!slug,
  });

  useEffect(() => {
    if (initialFeedback && !feedbackStats) {
      setFeedbackStats(initialFeedback);
    }
  }, [initialFeedback, feedbackStats]);

  const submitFeedback = useMutation({
    mutationFn: (helpful: boolean) =>
      apiFetch(`/api/manual/chapters/${slug}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ helpful }),
      }),
    onSuccess: (data: { ok: boolean; stats: { helpful: number; notHelpful: number } }) => {
      setFeedbackStats(data.stats);
    },
  });

  useEffect(() => {
    if (slug) {
      fetch(`/api/manual/chapters/${slug}/view`, { method: "POST", credentials: "include" }).catch(() => {});
    }
  }, [slug]);

  const updateSection = useMutation({
    mutationFn: ({ id, title, content }: { id: number; title: string; content: string }) =>
      apiFetch(`/api/manual/sections/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content }),
      }),
    onSuccess: () => {
      toast.success(t("chapter.sectionSaved"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
      setEditingSectionId(null);
    },
    onError: (e) => toast.error(errorText(e, t("chapter.actionFailed"))),
  });

  const deleteSection = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/manual/sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.sectionDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
      setDeleteSectionId(null);
    },
    onError: (e) => toast.error(errorText(e, t("chapter.actionFailed"))),
  });

  const addSection = useMutation({
    mutationFn: () =>
      apiFetch(`/api/manual/chapters/${slug}/sections`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newSectionTitle, content: newSectionContent }),
      }),
    onSuccess: () => {
      toast.success(t("chapter.sectionAdded"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
      qc.invalidateQueries({ queryKey: ["manual", "chapters"] });
      setAddingSection(false);
      setNewSectionTitle("");
      setNewSectionContent("");
    },
    onError: (e) => toast.error(errorText(e, t("chapter.actionFailed"))),
  });

  const deleteSop = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/manual/sops/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.sopDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
    },
    onError: (e) => toast.error(errorText(e, t("chapter.actionFailed"))),
  });

  const deleteChapter = useMutation({
    mutationFn: () => apiFetch(`/api/manual/chapters/${chapter!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.chapterDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapters"] });
      navigate("/manual");
    },
    onError: (e) => toast.error(errorText(e, t("chapter.actionFailed"))),
  });

  const handleExportPDF = () => window.print();
  // Arabic month names with Western digits (the app-wide numbers rule).
  const fmtDay = (iso: string) =>
    new Date(iso).toLocaleDateString(lang === "ar" ? "ar-u-nu-latn" : "en-GB", { day: "numeric", month: "short", year: "numeric" });

  const handleExportWord = () => {
    if (!chapter) return;
    const htmlLocale = lang === "ar" ? "ar" : "en";
    const htmlDirection = lang === "ar" ? "rtl" : "ltr";
    const sections = chapter.sections
      .map((s) => `<h2>${escapeHtml(s.title)}</h2><pre style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif">${escapeHtml(s.content)}</pre>`)
      .join("\n");
    const sops = chapter.sops
      .map((sop) => {
        const steps = Array.isArray(sop.steps) ? sop.steps.map((s, i) => `<li>${i + 1}. ${escapeHtml(s)}</li>`).join("") : "";
        return `<h3>${escapeHtml(sop.processName)}</h3><p><b>${t("chapter.purpose")}:</b> ${escapeHtml(sop.purpose)}</p><p><b>${t("chapter.responsibleRole")}:</b> ${escapeHtml(sop.responsibleRole)}</p><ul>${steps}</ul>`;
      })
      .join("\n");
    const html = `<html lang="${htmlLocale}" dir="${htmlDirection}"><head><meta charset="utf-8"><title>${escapeHtml(chapter.title)}</title></head><body dir="${htmlDirection}"><h1>${escapeHtml(chapter.title)}</h1><p>${escapeHtml(chapter.description)}</p>${sections}${chapter.sops.length ? `<h2>${t("common:manualNav.standardOperatingProcedures")}</h2>${sops}` : ""}</body></html>`;
    const blob = new Blob([html], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `CAFA-Manual-${slug}.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="flex gap-4" role="status" aria-label={t("chapter.loading")}>
        <Card className="hidden w-56 shrink-0 space-y-1.5 p-3 md:flex">
          <Skeleton className="mb-2 h-4 w-28 rounded" />
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-7 rounded-lg" />)}
        </Card>
        <div className="min-w-0 flex-1 space-y-4">
          <Card className="flex-row items-center gap-3 p-5">
            <Skeleton className="size-9 rounded-lg" />
            <div className="space-y-2">
              <Skeleton className="h-5 w-48 rounded" />
              <Skeleton className="h-3 w-32 rounded" />
            </div>
          </Card>
          {[...Array(3)].map((_, i) => (
            <Card key={i} className="space-y-3 p-5">
              <Skeleton className="h-4 w-40 rounded" />
              <Skeleton className="h-3 rounded" />
              <Skeleton className="h-3 w-5/6 rounded" />
              <Skeleton className="h-3 w-4/6 rounded" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const chapterNav = (
    <nav aria-label={t("common:manualNav.chapters")}>
      {(() => {
        const { grouped, orderedCats } = groupChaptersByCategory(allChapters);
        return orderedCats.map((cat) => (
          <div key={cat} className="py-2">
            <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] rtl:tracking-normal">{t(cat)}</p>
            {(grouped[cat] ?? []).map((ch) => {
              const isActive = ch.slug === slug;
              return (
                <Link
                  key={ch.id}
                  href={`/manual/${ch.slug}`}
                  aria-current={isActive ? "page" : undefined}
                  onClick={() => setMobileNavOpen(false)}
                  className={`mx-2 flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${
                    isActive
                      ? "bg-[var(--accent)]/10 font-semibold text-[var(--accent)]"
                      : "text-[var(--muted)] hover:bg-[var(--default)] hover:text-[var(--foreground)]"
                  }`}
                >
                  <ChapterIcon name={ch.icon} className="size-3 shrink-0" />
                  <span className="truncate">{ch.title}</span>
                </Link>
              );
            })}
          </div>
        ));
      })()}
    </nav>
  );

  const manualHomeLink = (
    <Link href="/manual" className="flex items-center gap-1.5 text-xs font-medium text-[var(--accent)] hover:underline">
      <BookOpen className="size-3.5" aria-hidden="true" />
      {t("chapter.systemManualLink")}
    </Link>
  );

  if (!chapter) {
    return (
      <div className="flex gap-4">
        {/* Still show nav so user can navigate away */}
        <Card className="no-print sticky top-4 hidden max-h-[calc(100dvh-6rem)] w-56 shrink-0 overflow-y-auto p-0 md:block">
          <div className="border-b border-[var(--border)] p-3">{manualHomeLink}</div>
          {chapterNav}
        </Card>
        <Card className="flex flex-1 items-center justify-center">
          <div className="max-w-sm px-6 py-20 text-center text-[var(--muted)]">
            <BookOpen className="mx-auto mb-4 size-12 opacity-20" aria-hidden="true" />
            <h1 className="mb-1 text-base font-semibold text-[var(--foreground)]">{t("manual.topicNotFound")}</h1>
            <p className="mb-4 text-sm">{t("manual.topicNotFoundDesc")}</p>
            <Link href="/manual" className="button button--primary button--sm gap-1.5">
              <BookOpen className="size-3.5" aria-hidden="true" />
              {t("chapter.backToManual")}
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  const startEditing = (section: Section) => {
    setEditingSectionId(section.id);
    setEditTitle(section.title);
    setEditContent(section.content);
  };

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          .print-content { max-width: 100% !important; padding: 0 !important; }
        }
      `}</style>

      <div className="flex gap-4">
        {/* ── Mobile nav overlay ───────────────────────────────────── */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setMobileNavOpen(false)} aria-hidden="true" />
        )}

        {/* ── Start sidebar: chapter nav ────────────────────────────── */}
        <aside
          className={`no-print w-64 shrink-0 overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] ${
            mobileNavOpen ? "fixed inset-y-0 start-0 z-50 rounded-none shadow-xl" : "sticky top-4 hidden max-h-[calc(100dvh-6rem)]"
          } md:block`}
          aria-label={t("chapter.topicNavLabel")}
        >
          <div className="flex items-center justify-between border-b border-[var(--border)] p-3">
            {manualHomeLink}
            <Button isIconOnly size="sm" variant="ghost" className="md:hidden" onPress={() => setMobileNavOpen(false)} aria-label={t("manual.closeNavigation")}>
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          {chapterNav}
        </aside>

        {/* ── Main content ────────────────────────────────────────── */}
        <main className="min-w-0 flex-1 space-y-6" ref={contentRef}>
          {/* Chapter header */}
          <Card className="no-print p-4 md:p-5">
            <div className="mb-2 flex items-center gap-1.5 text-xs text-[var(--muted)]">
              {/* Mobile nav toggle */}
              <Button isIconOnly size="sm" variant="secondary" className="me-1 md:hidden" onPress={() => setMobileNavOpen(true)} aria-label={t("manual.openNavigation")}>
                <Menu className="size-4" aria-hidden="true" />
              </Button>
              <Link href="/manual" className="hover:text-[var(--accent)]">{t("chapter.manual")}</Link>
              <ChevronRight className="size-3 rtl:rotate-180" aria-hidden="true" />
              <span className="max-w-[200px] truncate font-medium text-[var(--foreground)]">{chapter.title}</span>
            </div>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="rounded-lg bg-[var(--accent)]/10 p-2 text-[var(--accent)]">
                  <ChapterIcon name={chapter.icon} className="size-5" />
                </span>
                <div>
                  <h1 className="text-xl font-semibold">{chapter.title}</h1>
                  {chapter.description && <p className="mt-0.5 text-xs text-[var(--muted)]">{chapter.description}</p>}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {chapter.status === "draft" && <Chip size="sm" variant="soft" color="warning">{t("manual.draft")}</Chip>}
                <Button variant="secondary" size="sm" onPress={handleExportPDF}>
                  <FileDown className="size-3.5" aria-hidden="true" />
                  {t("chapter.pdf")}
                </Button>
                <Button variant="secondary" size="sm" onPress={handleExportWord}>
                  <Download className="size-3.5" aria-hidden="true" />
                  {t("chapter.word")}
                </Button>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="text-[var(--danger)]" onPress={() => setDeleteChapterConfirm(true)}>
                    <Trash2 className="size-3.5" aria-hidden="true" />
                    {t("chapter.deleteChapterAction")}
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted)]">
              <span>{t("chapter.sectionCount", { count: chapter.sectionCount })}</span>
              {chapter.sopCount > 0 && <span>{t("chapter.sopCount", { count: chapter.sopCount })}</span>}
              <span>{t("chapter.updatedOn", { date: fmtDay(chapter.updatedAt) })}</span>
            </div>
          </Card>

          {/* Print header */}
          <div className="hidden border-b px-8 py-6 print:block">
            <h1 className="text-2xl font-bold">{chapter.title}</h1>
            <p className="mt-1 text-sm text-gray-600">{chapter.description}</p>
            <p className="mt-1 text-xs text-gray-400">{t("chapter.exportedLabel", { date: fmtDay(new Date().toISOString()) })}</p>
          </div>

          {/* Sections */}
          <div className="print-content mx-auto max-w-3xl space-y-6">
            {chapter.sections.map((section, idx) => (
              <Card key={section.id} id={`section-${section.id}`} className="scroll-mt-4 gap-0 overflow-hidden p-0">
                {/* Section header */}
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--default)]/50 px-5 py-3">
                  {/* gap, not a margin: a logical margin on the LTR number would point away from the title in Arabic */}
                  <h2 className="flex min-w-0 flex-1 items-center gap-2 text-sm font-semibold">
                    <bdi dir="ltr" className="text-[var(--accent)]">{chapter.order}.{idx + 1}</bdi>
                    {editingSectionId === section.id ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        aria-label={t("chapter.sectionTitleLabel")}
                        className="h-8 w-full max-w-sm text-sm font-semibold"
                        dir="auto"
                      />
                    ) : (
                      <span dir="auto">{section.title}</span>
                    )}
                  </h2>
                  {canEditContent && editingSectionId !== section.id && (
                    <div className="no-print flex items-center gap-1">
                      <Button isIconOnly variant="ghost" size="sm" aria-label={t("chapter.editSection", { title: section.title })} onPress={() => startEditing(section)}>
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </Button>
                      {canEdit && (
                        <Button isIconOnly variant="ghost" size="sm" className="text-[var(--danger)]" aria-label={t("chapter.deleteSectionAria", { title: section.title })} onPress={() => setDeleteSectionId(section.id)}>
                          <Trash2 className="size-3.5" aria-hidden="true" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Section content */}
                <div className="px-5 py-4">
                  {editingSectionId === section.id ? (
                    <div className="space-y-3">
                      <TextArea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={12}
                        aria-label={t("chapter.contentLabel")}
                        className="w-full resize-y font-mono text-xs"
                        placeholder={t("chapter.editContentPlaceholder")}
                        dir="auto"
                      />
                      <div className="flex gap-2">
                        <Button size="sm" variant="primary" onPress={() => updateSection.mutate({ id: section.id, title: editTitle, content: editContent })} isPending={updateSection.isPending}>
                          <Save className="size-3.5" aria-hidden="true" />
                          {updateSection.isPending ? t("chapter.savingSection") : t("chapter.saveSection")}
                        </Button>
                        <Button variant="secondary" size="sm" onPress={() => setEditingSectionId(null)}>
                          <X className="size-3.5" aria-hidden="true" />
                          {t("chapter.cancelEdit")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <ManualMarkdown content={section.content} emptyText={t("chapter.noContentYet")} />
                  )}
                </div>
              </Card>
            ))}

            {/* Add section */}
            {canEditContent && (
              <div className="no-print">
                {addingSection ? (
                  <Card className="space-y-3 border border-dashed border-[var(--accent)] p-4">
                    <h4 className="text-xs font-semibold text-[var(--accent)]">{t("chapter.newSection")}</h4>
                    <Field label={t("chapter.sectionTitleLabel")} isRequired>
                      {(id) => <Input id={id} value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} placeholder={t("chapter.sectionTitlePlaceholder")} className="w-full" dir="auto" />}
                    </Field>
                    <Field label={t("chapter.contentLabel")}>
                      {(id) => <TextArea id={id} value={newSectionContent} onChange={(e) => setNewSectionContent(e.target.value)} rows={6} className="w-full resize-y font-mono text-xs" placeholder={t("chapter.contentPlaceholder")} dir="auto" />}
                    </Field>
                    <div className="flex gap-2">
                      <Button size="sm" variant="primary" onPress={() => addSection.mutate()} isDisabled={!newSectionTitle} isPending={addSection.isPending}>
                        <Save className="size-3.5" aria-hidden="true" />
                        {addSection.isPending ? t("chapter.addingSection") : t("chapter.addSection")}
                      </Button>
                      <Button variant="secondary" size="sm" onPress={() => { setAddingSection(false); setNewSectionTitle(""); setNewSectionContent(""); }}>{t("chapter.cancelEdit")}</Button>
                    </div>
                  </Card>
                ) : (
                  <Button variant="tertiary" size="sm" className="w-full border border-dashed border-[var(--border)]" onPress={() => setAddingSection(true)}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("chapter.addSection")}
                  </Button>
                )}
              </div>
            )}

            {/* SOPs */}
            {(chapter.sops.length > 0 || canEdit) && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-[var(--border)] py-2">
                  <ClipboardCheck className="size-4 text-[var(--accent)]" aria-hidden="true" />
                  <h3 className="text-sm font-semibold">{t("chapter.standardOperatingProcedures")}</h3>
                </div>
                {chapter.sops.map((sop) => (
                  <SOPCard key={sop.id} sop={sop} canEdit={canEdit} onDelete={(id) => deleteSop.mutate(id)} />
                ))}
                {canEdit && (
                  <Button variant="tertiary" size="sm" className="no-print w-full border border-dashed border-[var(--border)]" onPress={() => toast.info(t("chapter.addSopHint"))}>
                    <Plus className="size-3.5" aria-hidden="true" />
                    {t("chapter.addSop")}
                  </Button>
                )}
              </div>
            )}
          </div>

          {/* ── Related articles ───────────────────────────────── */}
          {allChapters.filter((c) => c.slug !== slug).length > 0 && (
            <div className="no-print mx-auto max-w-3xl border-t border-[var(--border)] pt-6">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--muted)] rtl:tracking-normal">{t("chapter.relatedArticles")}</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {allChapters
                  .filter((c) => c.slug !== slug)
                  .slice(0, 4)
                  .map((c) => (
                    <Link
                      key={c.id}
                      href={`/manual/${c.slug}`}
                      className="group flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5 transition-colors hover:border-[var(--accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                    >
                      <span className="shrink-0 rounded-md bg-[var(--accent)]/10 p-1.5 text-[var(--accent)]">
                        <BookOpen className="size-3" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium group-hover:text-[var(--accent)]">{c.title}</span>
                        <span className="block text-xs text-[var(--muted)]">{t("chapter.sectionCount", { count: c.sectionCount })}</span>
                      </span>
                      <ArrowRight className="size-3.5 shrink-0 text-[var(--muted)] group-hover:text-[var(--accent)] rtl:rotate-180" aria-hidden="true" />
                    </Link>
                  ))}
              </div>
              <div className="mt-3 text-center">
                <Link href="/manual" className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)] hover:text-[var(--accent)]">
                  <BookOpen className="size-3.5" aria-hidden="true" /> {t("chapter.browseAllChapters")}
                </Link>
              </div>
            </div>
          )}

          {/* ── Article feedback ───────────────────────────────────── */}
          <Card className="no-print mx-auto max-w-3xl items-center px-5 py-5 text-center">
            {feedbackVoted === null ? (
              <>
                <p className="mb-1 text-sm font-medium">{t("chapter.wasThisHelpful")}</p>
                <div className="flex items-center justify-center gap-3">
                  <Button variant="secondary" size="sm" onPress={() => { setFeedbackVoted(true); submitFeedback.mutate(true); }}>
                    <ThumbsUp className="size-4 text-[var(--success)]" aria-hidden="true" /> {t("chapter.yesHelpful")}
                  </Button>
                  <Button variant="secondary" size="sm" onPress={() => { setFeedbackVoted(false); submitFeedback.mutate(false); }}>
                    <ThumbsDown className="size-4" aria-hidden="true" /> {t("chapter.notReally")}
                  </Button>
                </div>
                {feedbackStats && (feedbackStats.helpful + feedbackStats.notHelpful) > 0 && (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {t("chapter.readersFoundHelpful", { helpful: feedbackStats.helpful, total: feedbackStats.helpful + feedbackStats.notHelpful })}
                  </p>
                )}
              </>
            ) : (
              <div className="flex flex-col items-center gap-2" role="status">
                {feedbackVoted
                  ? <ThumbsUp className="size-6 text-[var(--success)]" aria-hidden="true" />
                  : <ThumbsDown className="size-6 text-[var(--muted)]" aria-hidden="true" />}
                <p className="text-sm font-medium">{t("chapter.thankYouFeedback")}</p>
                {feedbackStats && (feedbackStats.helpful + feedbackStats.notHelpful) > 0 && (
                  <p className="text-xs text-[var(--muted)]">
                    {t("chapter.readersFoundHelpful", { helpful: feedbackStats.helpful, total: feedbackStats.helpful + feedbackStats.notHelpful })}
                  </p>
                )}
              </div>
            )}
          </Card>
        </main>

        {/* ── End sidebar: table of contents ─────────────────────── */}
        <aside className="no-print sticky top-4 hidden max-h-[calc(100dvh-6rem)] w-52 shrink-0 self-start overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)] xl:block">
          <div className="border-b border-[var(--border)] p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)] rtl:tracking-normal">{t("chapter.onThisPage")}</p>
          </div>
          <nav className="space-y-0.5 p-2" aria-label={t("chapter.onThisPage")}>
            {chapter.sections.map((s, idx) => (
              <a
                key={s.id}
                href={`#section-${s.id}`}
                className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs text-[var(--muted)] transition-colors hover:bg-[var(--default)] hover:text-[var(--accent)]"
              >
                <span className="w-5 shrink-0 text-end opacity-70"><bdi dir="ltr">{chapter.order}.{idx + 1}</bdi></span>
                <span className="truncate">{s.title}</span>
              </a>
            ))}
            {chapter.sops.length > 0 && (
              <div className="mt-2 border-t border-[var(--border)] pt-2">
                <p className="mb-1 px-2 text-xs font-medium text-[var(--muted)]">{t("chapter.sops")}</p>
                {chapter.sops.map((sop) => (
                  <span key={sop.id} className="block truncate px-2 py-1 text-xs text-[var(--muted)]">{sop.processName}</span>
                ))}
              </div>
            )}
          </nav>
        </aside>
      </div>

      <ConfirmModal
        isOpen={deleteSectionId !== null}
        title={t("chapter.deleteSectionTitle")}
        message={t("chapter.deleteSectionDesc")}
        confirmLabel={t("chapter.delete")}
        cancelLabel={t("chapter.cancel")}
        isPending={deleteSection.isPending}
        onConfirm={() => deleteSectionId !== null && deleteSection.mutate(deleteSectionId)}
        onCancel={() => setDeleteSectionId(null)}
      />

      <ConfirmModal
        isOpen={deleteChapterConfirm}
        title={t("chapter.deleteChapterTitle")}
        message={t("chapter.deleteChapterDesc", { title: chapter.title })}
        confirmLabel={t("chapter.deleteChapterButton")}
        cancelLabel={t("chapter.cancel")}
        isPending={deleteChapter.isPending}
        onConfirm={() => deleteChapter.mutate()}
        onCancel={() => setDeleteChapterConfirm(false)}
      />
    </>
  );
}
