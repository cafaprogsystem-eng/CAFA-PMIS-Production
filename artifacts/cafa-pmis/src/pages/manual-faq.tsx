import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  HelpCircle, Search, BookOpen, ChevronRight, ChevronDown,
  FolderKanban, FileText, AlertTriangle, CalendarClock,
  Bell, Users, Settings, Loader2, X, Archive, Bot,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { useLanguage } from "@/contexts/language-context";

async function apiFetch(path: string) {
  const res = await fetch(path, { credentials: "include" });
  if (!res.ok) throw new Error("request_failed");
  return res.json();
}

type FaqItem = { id: number; question: string; answer: string; order: number };
type FaqGroups = Record<string, FaqItem[]>;

const CAT_ICONS: Record<string, React.ElementType> = {
  Projects: FolderKanban,
  Planning: CalendarClock,
  Reports: FileText,
  Budgets: Settings,
  "Risk Register": AlertTriangle,
  "File & Archive": Archive,
  "Account & Access": Users,
  Notifications: Bell,
  AI: Bot,
  // Legacy keys for backward compat with existing DB data
  Risks: AlertTriangle,
  "User Accounts": Users,
  "Password Reset": Settings,
  "Offline Mode": Settings,
};

const CAT_COLORS: Record<string, string> = {
  Projects:         "bg-blue-50 text-blue-700 border-blue-200",
  Planning:         "bg-pink-50 text-pink-700 border-pink-200",
  Reports:          "bg-green-50 text-green-700 border-green-200",
  Budgets:          "bg-amber-50 text-amber-700 border-amber-200",
  "Risk Register":  "bg-orange-50 text-orange-700 border-orange-200",
  "File & Archive": "bg-teal-50 text-teal-700 border-teal-200",
  "Account & Access":"bg-indigo-50 text-indigo-700 border-indigo-200",
  Notifications:    "bg-violet-50 text-violet-700 border-violet-200",
  AI:               "bg-slate-50 text-slate-700 border-slate-200",
  // Legacy
  Risks:            "bg-orange-50 text-orange-700 border-orange-200",
  "User Accounts":  "bg-indigo-50 text-indigo-700 border-indigo-200",
  "Password Reset": "bg-teal-50 text-teal-700 border-teal-200",
  "Offline Mode":   "bg-slate-50 text-slate-700 border-slate-200",
};

const CATEGORY_LABEL_KEYS: Record<string, string> = {
  Projects: "faq.categories.projects",
  Planning: "faq.categories.planning",
  Reports: "faq.categories.reports",
  Budgets: "faq.categories.budgets",
  "Risk Register": "faq.categories.riskRegister",
  "File & Archive": "faq.categories.fileArchive",
  "Account & Access": "faq.categories.accountAccess",
  Notifications: "faq.categories.notifications",
  AI: "faq.categories.ai",
  Risks: "faq.categories.risks",
  "User Accounts": "faq.categories.userAccounts",
  "Password Reset": "faq.categories.passwordReset",
  "Offline Mode": "faq.categories.offlineMode",
};

export default function ManualFaqPage() {
  const { t } = useTranslation("knowledge");
  const { lang } = useLanguage();
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data: groups = {}, isLoading } = useQuery<FaqGroups>({
    queryKey: ["manual", "faqs", lang],
    queryFn: () => apiFetch(`/api/manual/faqs?locale=${lang}`),
  });

  const categories = Object.keys(groups);

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const result: FaqGroups = {};
    for (const [cat, items] of Object.entries(groups)) {
      if (activeCategory && cat !== activeCategory) continue;
      const filtered = q
        ? items.filter((i) => i.question.toLowerCase().includes(q) || i.answer.toLowerCase().includes(q))
        : items;
      if (filtered.length > 0) result[cat] = filtered;
    }
    return result;
  }, [groups, search, activeCategory]);

  const totalResults = Object.values(filteredGroups).reduce((s, a) => s + a.length, 0);

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      {/* Header */}
      <div className="bg-gradient-to-br from-[#1a2744] to-[#2d6a9f] text-white px-6 py-10">
        <div className="max-w-4xl mx-auto">
          <nav className="flex items-center gap-1.5 text-white/60 text-xs mb-4" aria-label={t("faq.breadcrumbLabel")}>
            <BookOpen className="h-3.5 w-3.5" aria-hidden="true" />
            <Link href="/manual">
              <span className="hover:text-white cursor-pointer transition-colors">{t("manual.title")}</span>
            </Link>
            <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
            <span className="text-white/90">{t("faq.title")}</span>
          </nav>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 rounded-lg bg-amber-400/20" aria-hidden="true">
              <HelpCircle className="h-6 w-6 text-amber-300" />
            </div>
            <h1 className="text-3xl font-bold">{t("faq.title")}</h1>
          </div>
          <p className="text-white/70 text-sm max-w-xl mb-7">
            {t("faq.subtitle")}
          </p>
          {/* Search */}
          <div className="relative max-w-xl">
            <label htmlFor="faq-search" className="sr-only">{t("faq.searchPlaceholder")}</label>
            <Search className="absolute start-4 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50 pointer-events-none" aria-hidden="true" />
            <input
              id="faq-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("faq.searchPlaceholder")}
              aria-label={t("faq.searchPlaceholder")}
              className="w-full ps-11 pe-10 py-3 rounded-xl bg-white/10 border border-white/20 text-white placeholder:text-white/40 text-sm focus:outline-none focus:ring-2 focus:ring-white/30 focus:bg-white/15 transition-all"
            />
            {search && (
              <button
                className="absolute end-3 top-1/2 -translate-y-1/2 text-white/50 hover:text-white"
                onClick={() => setSearch("")}
                aria-label={t("faq.clearSearch")}
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Category filter pills */}
        <div className="flex flex-wrap gap-2 mb-7" role="group" aria-label={t("faq.filterByCategory")}>
          <button
            onClick={() => setActiveCategory(null)}
            aria-pressed={!activeCategory}
            className={`text-xs px-3.5 py-1.5 rounded-full border transition-all font-medium ${
              !activeCategory
                ? "bg-[#1a3c5e] text-white border-[#1a3c5e]"
                : "bg-white text-slate-600 border-slate-200 hover:border-[#2d6a9f] hover:text-[#1a3c5e]"
            }`}
          >
            {t("faq.allCategories")}
            <span className="ms-1.5 opacity-60">
              {Object.values(groups).reduce((s, a) => s + a.length, 0)}
            </span>
          </button>
          {categories.map((cat) => {
            const Icon = CAT_ICONS[cat] ?? HelpCircle;
            const isActive = activeCategory === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveCategory(isActive ? null : cat)}
                aria-pressed={isActive}
                className={`flex items-center gap-1.5 text-xs px-3.5 py-1.5 rounded-full border transition-all font-medium ${
                  isActive
                    ? "bg-[#1a3c5e] text-white border-[#1a3c5e]"
                    : "bg-white text-slate-600 border-slate-200 hover:border-[#2d6a9f] hover:text-[#1a3c5e]"
                }`}
              >
                <Icon className="h-3 w-3" aria-hidden="true" />
                {categoryLabel(cat, t)}
                <span className="opacity-60">{groups[cat]?.length ?? 0}</span>
              </button>
            );
          })}
        </div>

        {/* Results count when searching */}
        {(search || activeCategory) && (
          <p className="text-xs text-muted-foreground mb-4" aria-live="polite">
            {t("faq.resultCount", { count: totalResults })}{search ? ` ${t("faq.matchingSearch", { query: search })}` : ""}{activeCategory ? ` ${t("faq.inCategory", { category: categoryLabel(activeCategory, t) })}` : ""}
          </p>
        )}

        {/* Loading */}
        {isLoading && (
          <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> {t("faq.loading")}
          </div>
        )}

        {/* Empty */}
        {!isLoading && totalResults === 0 && (
          <div className="text-center py-16 text-muted-foreground" role="status">
            <HelpCircle className="h-10 w-10 mx-auto mb-3 opacity-20" aria-hidden="true" />
            <p className="font-medium">{t("faq.noQuestions")}</p>
            <p className="text-xs mt-1">{t("faq.noQuestionsHint")}</p>
          </div>
        )}

        {/* FAQ groups */}
        <div className="space-y-6">
          {Object.entries(filteredGroups).map(([cat, items]) => {
            const Icon = CAT_ICONS[cat] ?? HelpCircle;
            const colorClass = CAT_COLORS[cat] ?? "bg-slate-50 text-slate-700 border-slate-200";
            return (
              <section key={cat} aria-labelledby={`cat-${cat.replace(/\s+/g, "-").toLowerCase()}`}>
                {/* Category header */}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold ${colorClass}`}>
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                    <span id={`cat-${cat.replace(/\s+/g, "-").toLowerCase()}`}>{categoryLabel(cat, t)}</span>
                  </div>
                  <Badge variant="outline" className="text-xs">{t("faq.resultCount", { count: items.length })}</Badge>
                </div>

                {/* FAQ items */}
                <div className="bg-white border border-slate-100 rounded-xl overflow-hidden divide-y divide-slate-50">
                  {items.map((faq) => {
                    const isOpen = openId === faq.id;
                    return (
                      <div key={faq.id}>
                        <button
                          className="w-full flex items-start justify-between px-5 py-4 text-start hover:bg-slate-50/80 transition-colors group gap-4"
                          onClick={() => setOpenId(isOpen ? null : faq.id)}
                          aria-expanded={isOpen}
                          aria-controls={`faq-answer-${faq.id}`}
                          id={`faq-question-${faq.id}`}
                        >
                          <span className="text-sm font-medium text-slate-800 group-hover:text-[#1a3c5e] leading-relaxed">
                            {highlightMatch(faq.question, search)}
                          </span>
                          <ChevronDown
                            className={`h-4 w-4 text-slate-400 shrink-0 mt-0.5 transition-transform ${isOpen ? "rotate-180" : ""}`}
                            aria-hidden="true"
                          />
                        </button>
                        <div
                          id={`faq-answer-${faq.id}`}
                          role="region"
                          aria-labelledby={`faq-question-${faq.id}`}
                          hidden={!isOpen}
                          className="px-5 pb-5 pt-1 bg-slate-50/40"
                        >
                          <p className="text-sm text-slate-600 leading-relaxed">
                            {highlightMatch(faq.answer, search)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>

        {/* Footer link */}
        <div className="mt-10 text-center">
          <p className="text-xs text-muted-foreground mb-3">{t("faq.cantFind")}</p>
          <Link href="/manual">
            <span className="text-sm text-[#2d6a9f] hover:text-[#1a3c5e] hover:underline cursor-pointer transition-colors">
              ← {t("faq.backToManual")}
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}

function categoryLabel(category: string, t: (key: string, values?: Record<string, unknown>) => string): string {
  const key = CATEGORY_LABEL_KEYS[category];
  return key ? t(key) : category;
}

function highlightMatch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text;
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="bg-yellow-100 text-yellow-900 rounded px-0.5">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
