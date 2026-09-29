import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  HelpCircle, BookOpen, ChevronRight,
  FolderKanban, FileText, AlertTriangle, CalendarClock,
  Bell, Users, Settings, Archive, Bot,
} from "@/components/icons";
import { Accordion, Card, Chip, Label, SearchField, Spinner, Tag, TagGroup, type Selection } from "@heroui/react";
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

/** Soft chip colour per category (text + icon carry the meaning, colour only groups). */
const CAT_COLORS: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  Projects: "accent",
  Planning: "accent",
  Reports: "success",
  Budgets: "warning",
  "Risk Register": "danger",
  "File & Archive": "default",
  "Account & Access": "accent",
  Notifications: "default",
  AI: "default",
  // Legacy
  Risks: "danger",
  "User Accounts": "accent",
  "Password Reset": "default",
  "Offline Mode": "default",
};

const ALL = "__all";

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

  const allCount = Object.values(groups).reduce((sum, items) => sum + items.length, 0);
  const onCategory = (keys: Selection) => {
    const [key] = keys === "all" ? [] : [...keys];
    setActiveCategory(key === undefined || key === ALL ? null : String(key));
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <Card className="p-5 sm:p-6">
        <nav className="mb-3 flex items-center gap-1.5 text-xs text-[var(--muted)]" aria-label={t("faq.breadcrumbLabel")}>
          <BookOpen className="size-3.5" aria-hidden="true" />
          <Link href="/manual" className="hover:text-[var(--accent)]">{t("manual.title")}</Link>
          <ChevronRight className="size-3 rtl:rotate-180" aria-hidden="true" />
          <span className="text-[var(--foreground)]">{t("faq.title")}</span>
        </nav>
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <HelpCircle className="size-5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          {t("faq.title")}
        </h1>
        <p className="mb-5 mt-1 max-w-xl text-sm text-[var(--muted)]">{t("faq.subtitle")}</p>
        <SearchField value={search} onChange={setSearch} aria-label={t("faq.searchPlaceholder")} className="max-w-xl">
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input id="faq-search" placeholder={t("faq.searchPlaceholder")} />
            <SearchField.ClearButton aria-label={t("faq.clearSearch")} />
          </SearchField.Group>
        </SearchField>
      </Card>

      {/* Category filter */}
      <TagGroup
        selectionMode="single"
        disallowEmptySelection
        selectedKeys={[activeCategory ?? ALL]}
        onSelectionChange={onCategory}
      >
        <Label className="sr-only">{t("faq.filterByCategory")}</Label>
        <TagGroup.List className="flex-wrap">
          <Tag id={ALL} textValue={t("faq.allCategories")}>
            {t("faq.allCategories")} <bdi dir="ltr" className="opacity-60">{allCount}</bdi>
          </Tag>
          {categories.map((cat) => {
            const Icon = CAT_ICONS[cat] ?? HelpCircle;
            return (
              <Tag key={cat} id={cat} textValue={categoryLabel(cat, t)}>
                <Icon className="size-3" aria-hidden="true" />
                {categoryLabel(cat, t)} <bdi dir="ltr" className="opacity-60">{groups[cat]?.length ?? 0}</bdi>
              </Tag>
            );
          })}
        </TagGroup.List>
      </TagGroup>

      {/* Results count when searching */}
      {(search || activeCategory) && (
        <p className="text-xs text-[var(--muted)]" aria-live="polite">
          {t("faq.resultCount", { count: totalResults })}{search ? ` ${t("faq.matchingSearch", { query: search })}` : ""}{activeCategory ? ` ${t("faq.inCategory", { category: categoryLabel(activeCategory, t) })}` : ""}
        </p>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex items-center justify-center gap-2 py-12 text-[var(--muted)]" role="status">
          <Spinner size="sm" /> {t("faq.loading")}
        </div>
      )}

      {/* Empty */}
      {!isLoading && totalResults === 0 && (
        <Card className="items-center py-16 text-center text-[var(--muted)]" role="status">
          <HelpCircle className="size-10 opacity-20" aria-hidden="true" />
          <p className="font-medium">{t("faq.noQuestions")}</p>
          <p className="text-xs">{t("faq.noQuestionsHint")}</p>
        </Card>
      )}

      {/* FAQ groups */}
      {Object.entries(filteredGroups).map(([cat, items]) => {
        const Icon = CAT_ICONS[cat] ?? HelpCircle;
        const headingId = `cat-${cat.replace(/\s+/g, "-").toLowerCase()}`;
        return (
          <section key={cat} aria-labelledby={headingId}>
            {/* Category header */}
            <div className="mb-3 flex items-center gap-2.5">
              <Chip variant="soft" color={CAT_COLORS[cat] ?? "default"} className="gap-1.5 font-semibold">
                <Icon className="size-3.5" aria-hidden="true" />
                <span id={headingId} role="heading" aria-level={2}>{categoryLabel(cat, t)}</span>
              </Chip>
              <span className="text-xs text-[var(--muted)]">{t("faq.resultCount", { count: items.length })}</span>
            </div>

            {/* FAQ items */}
            <Accordion variant="surface" className="rounded-2xl border border-[var(--border)]">
              {items.map((faq) => (
                <Accordion.Item key={faq.id} id={String(faq.id)}>
                  <Accordion.Heading>
                    <Accordion.Trigger className="text-start text-sm font-medium leading-relaxed" dir="auto">
                      {highlightMatch(faq.question, search)}
                      <Accordion.Indicator />
                    </Accordion.Trigger>
                  </Accordion.Heading>
                  <Accordion.Panel>
                    <Accordion.Body className="text-sm leading-relaxed text-[var(--muted)]" dir="auto">
                      {highlightMatch(faq.answer, search)}
                    </Accordion.Body>
                  </Accordion.Panel>
                </Accordion.Item>
              ))}
            </Accordion>
          </section>
        );
      })}

      {/* Footer link */}
      <div className="pb-4 text-center">
        <p className="mb-3 text-xs text-[var(--muted)]">{t("faq.cantFind")}</p>
        <Link href="/manual" className="text-sm text-[var(--accent)] hover:underline">
          <span aria-hidden="true" className="inline-block rtl:-scale-x-100">←</span> {t("faq.backToManual")}
        </Link>
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
      <mark className="rounded bg-[var(--warning)]/20 px-0.5 text-inherit">{text.slice(idx, idx + query.length)}</mark>
      {text.slice(idx + query.length)}
    </>
  );
}
