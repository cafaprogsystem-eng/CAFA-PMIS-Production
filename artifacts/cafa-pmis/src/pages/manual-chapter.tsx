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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
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
    slugs: ["system-manual", "manual", "training", "training-center", "support", "glossary", "sops", "troubleshooting", "annexes"],
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

/* ── Content renderer ──────────────────────────────────────────────── */
function RenderContent({ content }: { content: string }) {
  const { t } = useTranslation("knowledge");
  if (!content.trim()) return <p className="text-muted-foreground text-xs italic">{t("chapter.noContentYet")}</p>;

  const blocks = content.split(/\n\n+/);
  return (
    <div className="space-y-3 text-sm leading-relaxed text-slate-700">
      {blocks.map((block, i) => {
        const trimmed = block.trim();
        if (!trimmed) return null;

        if (trimmed.startsWith("## ")) {
          return (
            <h4 key={i} className="font-semibold text-slate-900 text-sm mt-4 mb-1">
              {trimmed.slice(3)}
            </h4>
          );
        }

        const lines = trimmed.split("\n");
        if (lines.length > 1 && lines.every((l) => l.startsWith("- "))) {
          return (
            <ul key={i} className="space-y-1.5 ps-1">
              {lines.map((l, j) => (
                <li key={j} className="flex items-start gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-[#2d6a9f] shrink-0" />
                  <span dangerouslySetInnerHTML={{ __html: l.slice(2).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
                </li>
              ))}
            </ul>
          );
        }

        if (lines.length > 1 && lines.every((l, idx) => idx === 0 || /^\d+\./.test(l.trim()) || /^\d+\./.test(l.trim()))) {
          const numbered = lines.filter((l) => /^\d+\./.test(l.trim()));
          if (numbered.length > 1) {
            return (
              <ol key={i} className="space-y-1.5 ps-1">
                {numbered.map((l, j) => (
                  <li key={j} className="flex items-start gap-2">
                    <span className="shrink-0 font-medium text-[#2d6a9f] text-xs mt-0.5 w-4">{j + 1}.</span>
                    <span dangerouslySetInnerHTML={{ __html: l.replace(/^\d+\.\s*/, "").replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>") }} />
                  </li>
                ))}
              </ol>
            );
          }
        }

        return (
          <p
            key={i}
            dangerouslySetInnerHTML={{
              __html: trimmed.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"),
            }}
          />
        );
      })}
    </div>
  );
}

/* ── SOP Card ──────────────────────────────────────────────────────── */
function SOPCard({ sop, canEdit, onDelete }: { sop: SOP; canEdit: boolean; onDelete: (id: number) => void }) {
  const { t } = useTranslation("knowledge");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const steps = Array.isArray(sop.steps) ? sop.steps : [];

  return (
    <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-[#2d6a9f] shrink-0 mt-0.5" />
          <h4 className="font-semibold text-sm text-slate-900">{sop.processName}</h4>
        </div>
        {canEdit && (
          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500 shrink-0" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-3 w-3" />
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {sop.purpose && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.purpose")}</span>
            <span className="text-slate-700">{sop.purpose}</span>
          </div>
        )}
        {sop.responsibleRole && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.responsibleRole")}</span>
            <Badge variant="outline" className="text-xs font-normal">{sop.responsibleRole}</Badge>
          </div>
        )}
        {sop.requiredInputs && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.requiredInputs")}</span>
            <span className="text-slate-700">{sop.requiredInputs}</span>
          </div>
        )}
        {sop.approvalFlow && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.approvalFlow")}</span>
            <span className="text-slate-700">{sop.approvalFlow}</span>
          </div>
        )}
        {sop.outputs && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.outputs")}</span>
            <span className="text-slate-700">{sop.outputs}</span>
          </div>
        )}
        {sop.timeline && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.timeline")}</span>
            <span className="text-slate-700">{sop.timeline}</span>
          </div>
        )}
        {sop.relatedModule && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.relatedModule")}</span>
            <Badge variant="secondary" className="text-xs font-normal">{sop.relatedModule}</Badge>
          </div>
        )}
        {sop.notifications && (
          <div>
            <span className="font-medium text-slate-600 block mb-0.5">{t("chapter.notifications")}</span>
            <span className="text-slate-700">{sop.notifications}</span>
          </div>
        )}
      </div>

      {steps.length > 0 && (
        <div>
          <span className="font-medium text-xs text-slate-600 block mb-2">{t("chapter.steps")}</span>
          <ol className="space-y-1.5">
            {steps.map((step, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                <span className="shrink-0 font-semibold text-[#2d6a9f] w-5">{i + 1}.</span>
                <span className="text-slate-700">{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chapter.deleteSopTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chapter.deleteSopDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chapter.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => onDelete(sop.id)}>
              {t("chapter.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
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
    onError: (e) => toast.error(e.message),
  });

  const deleteSection = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/manual/sections/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.sectionDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
      setDeleteSectionId(null);
    },
    onError: (e) => toast.error(e.message),
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
    onError: (e) => toast.error(e.message),
  });

  const deleteSop = useMutation({
    mutationFn: (id: number) => apiFetch(`/api/manual/sops/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.sopDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapter", slug] });
    },
    onError: (e) => toast.error(e.message),
  });

  const deleteChapter = useMutation({
    mutationFn: () => apiFetch(`/api/manual/chapters/${chapter!.id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success(t("chapter.chapterDeleted"));
      qc.invalidateQueries({ queryKey: ["manual", "chapters"] });
      navigate("/manual");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleExportPDF = () => window.print();

  const handleExportWord = () => {
    if (!chapter) return;
    const htmlLocale = lang === "ar" ? "ar" : "en";
    const htmlDirection = lang === "ar" ? "rtl" : "ltr";
    const sections = chapter.sections
      .map((s) => `<h2>${s.title}</h2><pre style="white-space:pre-wrap;font-family:Calibri,Arial,sans-serif">${s.content}</pre>`)
      .join("\n");
    const sops = chapter.sops
      .map((sop) => {
        const steps = Array.isArray(sop.steps) ? sop.steps.map((s, i) => `<li>${i + 1}. ${s}</li>`).join("") : "";
        return `<h3>${sop.processName}</h3><p><b>${t("chapter.purpose")}:</b> ${sop.purpose ?? ""}</p><p><b>${t("chapter.responsibleRole")}:</b> ${sop.responsibleRole ?? ""}</p><ul>${steps}</ul>`;
      })
      .join("\n");
    const html = `<html lang="${htmlLocale}" dir="${htmlDirection}"><head><meta charset="utf-8"><title>${chapter.title}</title></head><body dir="${htmlDirection}"><h1>${chapter.title}</h1><p>${chapter.description ?? ""}</p>${sections}${chapter.sops.length ? `<h2>${t("common:manualNav.standardOperatingProcedures")}</h2>${sops}` : ""}</body></html>`;
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
      <div className="flex gap-0 min-h-screen">
        {/* Skeleton: left nav */}
          <div className="no-print w-56 shrink-0 border-e border-slate-100 bg-white">
          <div className="p-3 border-b border-slate-100">
            <div className="h-4 bg-slate-100 rounded animate-pulse w-28" />
          </div>
          <div className="p-2 space-y-1.5">
            {[...Array(8)].map((_, i) => (
              <div key={i} className="h-7 bg-slate-50 rounded animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
            ))}
          </div>
        </div>
        {/* Skeleton: main content */}
        <div className="flex-1 bg-[#f5f6fa]">
          <div className="bg-white border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-100 animate-pulse" />
              <div className="space-y-2">
                <div className="h-5 w-48 bg-slate-100 rounded animate-pulse" />
                <div className="h-3 w-32 bg-slate-50 rounded animate-pulse" />
              </div>
            </div>
          </div>
          <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-100 p-5 space-y-3">
                <div className="h-4 w-40 bg-slate-100 rounded animate-pulse" />
                <div className="space-y-2">
                  <div className="h-3 bg-slate-50 rounded animate-pulse" />
                  <div className="h-3 bg-slate-50 rounded animate-pulse w-5/6" />
                  <div className="h-3 bg-slate-50 rounded animate-pulse w-4/6" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!chapter) {
    return (
      <div className="flex gap-0 min-h-screen">
        {/* Still show nav so user can navigate away */}
        <aside className="no-print w-56 shrink-0 border-e border-slate-100 bg-white sticky top-0 h-screen overflow-y-auto hidden md:block">
          <div className="p-3 border-b border-slate-100">
            <Link href="/manual">
              <button className="flex items-center gap-1.5 text-xs text-[#2d6a9f] hover:underline font-medium">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t("chapter.systemManualLink")}
              </button>
            </Link>
          </div>
          <nav aria-label={t("common:manualNav.chapters")}>
            {(() => {
              const { grouped, orderedCats } = groupChaptersByCategory(allChapters);
              return orderedCats.map((cat) => (
                <div key={cat} className="py-2">
                  <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(cat)}</p>
                  {(grouped[cat] ?? []).map((ch) => (
                    <Link key={ch.id} href={`/manual/${ch.slug}`}>
                      <div className={`flex items-center gap-2 mx-2 px-2 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                        ch.slug === slug ? "bg-[#eef4fb] text-[#1a3c5e] font-semibold" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                      }`}>
                        <span className="truncate">{ch.title}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              ));
            })()}
          </nav>
        </aside>
        <div className="flex-1 flex items-center justify-center bg-[#f5f6fa]">
          <div className="text-center py-20 text-muted-foreground max-w-sm px-6">
            <BookOpen className="h-12 w-12 mx-auto mb-4 opacity-20" aria-hidden="true" />
            <h1 className="text-base font-semibold text-slate-700 mb-1">{t("manual.topicNotFound")}</h1>
            <p className="text-sm text-muted-foreground mb-4">
              {t("manual.topicNotFoundDesc")}
            </p>
            <Link href="/manual">
              <Button size="sm" className="gap-1.5">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t("chapter.backToManual")}
              </Button>
            </Link>
          </div>
        </div>
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

      <div className="flex gap-0 min-h-screen">
        {/* ── Mobile nav overlay ───────────────────────────────────── */}
        {mobileNavOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* ── Left sidebar: chapter nav ─────────────────────────────── */}
        <aside
          className={`no-print w-64 shrink-0 border-e border-slate-100 bg-white sticky top-0 h-screen overflow-y-auto
            ${mobileNavOpen ? "fixed inset-y-0 start-0 z-50 shadow-xl" : "hidden"} md:block`}
          aria-label={t("chapter.topicNavLabel") || "Topic navigation"}
        >
          <div className="p-3 border-b border-slate-100 flex items-center justify-between">
            <Link href="/manual">
              <button className="flex items-center gap-1.5 text-xs text-[#2d6a9f] hover:underline font-medium">
                <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
                {t("chapter.systemManualLink")}
              </button>
            </Link>
            <button
              className="md:hidden p-1 rounded text-slate-400 hover:text-slate-700"
              onClick={() => setMobileNavOpen(false)}
              aria-label={t("manual.closeNavigation")}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <nav aria-label={t("common:manualNav.chapters")}>
            {(() => {
              const { grouped, orderedCats } = groupChaptersByCategory(allChapters);
              return orderedCats.map((cat) => (
                <div key={cat} className="py-2">
                  <p className="px-4 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(cat)}</p>
                  {(grouped[cat] ?? []).map((ch) => {
                    const isActive = ch.slug === slug;
                    return (
                      <Link key={ch.id} href={`/manual/${ch.slug}`}>
                        <div
                          className={`flex items-center gap-2 mx-2 px-2.5 py-1.5 rounded-md text-xs cursor-pointer transition-colors ${
                            isActive
                              ? "bg-[#eef4fb] text-[#1a3c5e] font-semibold"
                              : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          }`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => setMobileNavOpen(false)}
                        >
                          <ChapterIcon name={ch.icon} className={`h-3 w-3 shrink-0 ${isActive ? "text-[#2d6a9f]" : "text-slate-400"}`} />
                          <span className="truncate">{ch.title}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              ));
            })()}
          </nav>
        </aside>

        {/* ── Main content ────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 bg-[#f5f6fa]" ref={contentRef}>
          {/* Chapter header */}
          <div className="bg-white border-b border-slate-100 px-4 md:px-6 py-5 no-print">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-2">
              {/* Mobile nav toggle */}
              <button
                className="md:hidden me-1 p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                onClick={() => setMobileNavOpen(true)}
                aria-label={t("manual.openNavigation")}
              >
                <Menu className="h-4 w-4" aria-hidden="true" />
              </button>
              <Link href="/manual">
                <span className="hover:text-[#2d6a9f] cursor-pointer">{t("chapter.manual")}</span>
              </Link>
              <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
              <span className="text-slate-700 font-medium truncate max-w-[200px]">{chapter.title}</span>
            </div>
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[#eef4fb] text-[#2d6a9f]">
                  <ChapterIcon name={chapter.icon} className="h-5 w-5" />
                </div>
                <div>
                  <h1 className="text-xl font-bold text-slate-900">{chapter.title}</h1>
                  {chapter.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{chapter.description}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {chapter.status === "draft" && (
                  <Badge variant="outline" className="text-xs border-amber-200 text-amber-600 bg-amber-50">{t("manual.draft")}</Badge>
                )}
                <Button variant="outline" size="sm" onClick={handleExportPDF} className="gap-1.5 h-8">
                  <FileDown className="h-3.5 w-3.5" />
                  {t("chapter.pdf")}
                </Button>
                <Button variant="outline" size="sm" onClick={handleExportWord} className="gap-1.5 h-8">
                  <Download className="h-3.5 w-3.5" />
                  {t("chapter.word")}
                </Button>
                {canEdit && (
                  <Button variant="ghost" size="sm" onClick={() => setDeleteChapterConfirm(true)} className="gap-1.5 h-8 text-red-500 hover:text-red-600 hover:bg-red-50">
                    <Trash2 className="h-3.5 w-3.5" />
                    {t("chapter.deleteChapterAction")}
                  </Button>
                )}
              </div>
            </div>
            <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground">
              <span>{t("chapter.sectionCount", { count: chapter.sectionCount })}</span>
              {chapter.sopCount > 0 && <span>{t("chapter.sopCount", { count: chapter.sopCount })}</span>}
              <span>{t("chapter.updatedOn", { date: new Date(chapter.updatedAt).toLocaleDateString(lang === "ar" ? "ar-SD" : "en-GB") })}</span>
            </div>
          </div>

          {/* Print header */}
          <div className="hidden print:block px-8 py-6 border-b">
            <h1 className="text-2xl font-bold">{chapter.title}</h1>
            <p className="text-sm text-gray-600 mt-1">{chapter.description}</p>
            <p className="text-xs text-gray-400 mt-1">{t("chapter.exportedLabel", { date: new Date().toLocaleDateString() })}</p>
          </div>

          {/* Sections */}
          <div className="print-content max-w-3xl mx-auto px-6 py-6 space-y-6">
            {chapter.sections.map((section, idx) => (
              <div key={section.id} id={`section-${section.id}`} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                {/* Section header */}
                <div className="flex items-center justify-between px-5 py-3 border-b border-slate-50 bg-slate-50/50">
                  <h2 className="text-sm font-semibold text-slate-900">
                    <span className="text-[#2d6a9f] me-2">{chapter.order}.{idx + 1}</span>
                    {editingSectionId === section.id ? (
                      <Input
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        className="inline-block h-7 text-sm font-semibold w-72 py-0"
                      />
                    ) : (
                      section.title
                    )}
                  </h2>
                  {canEditContent && editingSectionId !== section.id && (
                    <div className="flex items-center gap-1 no-print">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-[#2d6a9f]" onClick={() => startEditing(section)}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      {canEdit && (
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-500" onClick={() => setDeleteSectionId(section.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Section content */}
                <div className="px-5 py-4">
                  {editingSectionId === section.id ? (
                    <div className="space-y-3">
                      <Textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        rows={12}
                        className="text-xs font-mono resize-y"
                        placeholder={t("chapter.editContentPlaceholder")}
                      />
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1.5 h-7" onClick={() => updateSection.mutate({ id: section.id, title: editTitle, content: editContent })} disabled={updateSection.isPending}>
                          <Save className="h-3 w-3" />
                          {updateSection.isPending ? t("chapter.savingSection") : t("chapter.saveSection")}
                        </Button>
                        <Button variant="outline" size="sm" className="h-7" onClick={() => setEditingSectionId(null)}>
                          <X className="h-3 w-3" />
                          {t("chapter.cancelEdit")}
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <RenderContent content={section.content} />
                  )}
                </div>
              </div>
            ))}

            {/* Add section */}
            {canEditContent && (
              <div className="no-print">
                {addingSection ? (
                  <div className="bg-white rounded-xl border border-dashed border-[#2d6a9f] p-4 space-y-3">
                    <h4 className="text-xs font-semibold text-[#2d6a9f]">{t("chapter.newSection")}</h4>
                    <div>
                      <Label className="text-xs">{t("chapter.sectionTitleLabel")}</Label>
                      <Input value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} placeholder={t("chapter.sectionTitlePlaceholder")} className="mt-1" />
                    </div>
                    <div>
                      <Label className="text-xs">{t("chapter.contentLabel")}</Label>
                      <Textarea value={newSectionContent} onChange={(e) => setNewSectionContent(e.target.value)} rows={6} className="mt-1 text-xs font-mono resize-y" placeholder={t("chapter.contentPlaceholder")} />
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" className="gap-1.5 h-7" onClick={() => addSection.mutate()} disabled={!newSectionTitle || addSection.isPending}>
                        <Save className="h-3 w-3" />
                        {addSection.isPending ? t("chapter.addingSection") : t("chapter.addSection")}
                      </Button>
                      <Button variant="outline" size="sm" className="h-7" onClick={() => { setAddingSection(false); setNewSectionTitle(""); setNewSectionContent(""); }}>{t("chapter.cancelEdit")}</Button>
                    </div>
                  </div>
                ) : (
                  <Button variant="outline" size="sm" className="gap-1.5 w-full border-dashed text-muted-foreground hover:text-[#2d6a9f] hover:border-[#2d6a9f]" onClick={() => setAddingSection(true)}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("chapter.addSection")}
                  </Button>
                )}
              </div>
            )}

            {/* SOPs */}
            {(chapter.sops.length > 0 || canEdit) && (
              <div className="space-y-3">
                <div className="flex items-center gap-2 py-2 border-b border-slate-200">
                  <ClipboardCheck className="h-4 w-4 text-[#2d6a9f]" />
                  <h3 className="text-sm font-semibold text-slate-900">{t("chapter.standardOperatingProcedures")}</h3>
                </div>
                {chapter.sops.map((sop) => (
                  <SOPCard key={sop.id} sop={sop} canEdit={canEdit} onDelete={(id) => deleteSop.mutate(id)} />
                ))}
                {canEdit && (
                  <Button variant="outline" size="sm" className="gap-1.5 w-full border-dashed text-muted-foreground hover:text-[#2d6a9f] hover:border-[#2d6a9f] no-print" onClick={() => toast.info(t("chapter.addSopHint"))}>
                    <Plus className="h-3.5 w-3.5" />
                    {t("chapter.addSop")}
                  </Button>
                )}
              </div>
            )}
          </div>
          {/* ── Related articles ───────────────────────────────── */}
          {allChapters.filter((c) => c.slug !== slug).length > 0 && (
            <div className="mt-10 pt-6 border-t border-slate-100 no-print">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">{t("chapter.relatedArticles")}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {allChapters
                  .filter((c) => c.slug !== slug)
                  .slice(0, 4)
                  .map((c) => (
                    <Link key={c.id} href={`/manual/${c.slug}`}>
                      <div className="flex items-center gap-2.5 bg-white border border-slate-100 rounded-lg px-3.5 py-2.5 hover:border-[#2d6a9f] hover:shadow-sm cursor-pointer transition-all group">
                        <div className="p-1.5 rounded-md bg-[#eef4fb] text-[#2d6a9f] shrink-0 group-hover:bg-[#2d6a9f] group-hover:text-white transition-colors">
                          <BookOpen className="h-3 w-3" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate group-hover:text-[#1a3c5e]">{c.title}</p>
                          <p className="text-xs text-muted-foreground">{t("chapter.sectionCount", { count: c.sectionCount })}</p>
                        </div>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-300 group-hover:text-[#2d6a9f] shrink-0 rtl:rotate-180" />
                      </div>
                    </Link>
                  ))}
              </div>
              <div className="mt-3 text-center">
                <Link href="/manual">
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground gap-1.5">
                    <BookOpen className="h-3.5 w-3.5" /> {t("chapter.browseAllChapters")}
                  </Button>
                </Link>
              </div>
            </div>
          )}

          {/* ── Article feedback ───────────────────────────────────── */}
          <div className="mt-8 pt-6 border-t border-slate-100 no-print">
            <div className="bg-slate-50 rounded-xl px-5 py-5 text-center">
              {feedbackVoted === null ? (
                <>
                  <p className="text-sm font-medium text-slate-700 mb-3">{t("chapter.wasThisHelpful")}</p>
                  <div className="flex items-center justify-center gap-3">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-emerald-200 text-emerald-700 hover:bg-emerald-50 hover:border-emerald-400"
                      onClick={() => {
                        setFeedbackVoted(true);
                        submitFeedback.mutate(true);
                      }}
                    >
                      <ThumbsUp className="h-4 w-4" /> {t("chapter.yesHelpful")}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-2 border-slate-200 text-slate-600 hover:bg-slate-100"
                      onClick={() => {
                        setFeedbackVoted(false);
                        submitFeedback.mutate(false);
                      }}
                    >
                      <ThumbsDown className="h-4 w-4" /> {t("chapter.notReally")}
                    </Button>
                  </div>
                  {feedbackStats && (feedbackStats.helpful + feedbackStats.notHelpful) > 0 && (
                    <p className="text-xs text-muted-foreground mt-3">
                      {t("chapter.readersFoundHelpful", { helpful: feedbackStats.helpful, total: feedbackStats.helpful + feedbackStats.notHelpful })}
                    </p>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center gap-2">
                  {feedbackVoted ? (
                    <ThumbsUp className="h-6 w-6 text-emerald-500" />
                  ) : (
                    <ThumbsDown className="h-6 w-6 text-slate-400" />
                  )}
                  <p className="text-sm font-medium text-slate-700">{t("chapter.thankYouFeedback")}</p>
                  {feedbackStats && (feedbackStats.helpful + feedbackStats.notHelpful) > 0 && (
                    <p className="text-xs text-muted-foreground">
                      {t("chapter.readersFoundHelpful", { helpful: feedbackStats.helpful, total: feedbackStats.helpful + feedbackStats.notHelpful })}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </main>

        {/* ── Right sidebar: table of contents ────────────────────── */}
        <aside className="no-print w-52 shrink-0 border-s border-slate-100 bg-white sticky top-0 h-screen overflow-y-auto hidden xl:block">
          <div className="p-3 border-b border-slate-100">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("chapter.onThisPage")}</p>
          </div>
          <nav className="p-2 space-y-0.5">
            {chapter.sections.map((s, idx) => (
              <a
                key={s.id}
                href={`#section-${s.id}`}
                className="flex items-start gap-2 px-2 py-1.5 text-xs text-slate-600 hover:text-[#2d6a9f] hover:bg-slate-50 rounded-md transition-colors"
              >
                <span className="text-slate-400 shrink-0 w-5 text-end"><bdi dir="ltr">{chapter.order}.{idx + 1}</bdi></span>
                <span className="truncate">{s.title}</span>
              </a>
            ))}
            {chapter.sops.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <p className="px-2 text-xs font-medium text-muted-foreground mb-1">{t("chapter.sops")}</p>
                {chapter.sops.map((sop) => (
                  <span key={sop.id} className="block px-2 py-1 text-xs text-slate-500 truncate">{sop.processName}</span>
                ))}
              </div>
            )}
          </nav>
        </aside>
      </div>

      {/* Delete section dialog */}
      <AlertDialog open={deleteSectionId !== null} onOpenChange={() => setDeleteSectionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chapter.deleteSectionTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("chapter.deleteSectionDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chapter.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteSectionId !== null && deleteSection.mutate(deleteSectionId)}>
              {t("chapter.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete chapter dialog */}
      <AlertDialog open={deleteChapterConfirm} onOpenChange={setDeleteChapterConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("chapter.deleteChapterTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("chapter.deleteChapterDesc", { title: chapter.title })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("chapter.cancel")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => deleteChapter.mutate()}>
              {t("chapter.deleteChapterButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
