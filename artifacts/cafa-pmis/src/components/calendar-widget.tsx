import { useState, useMemo, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, ChevronRight, MoreHorizontal,
  CalendarDays, RefreshCw, Filter, X, ArrowRight, Clock,
} from "@/components/icons";
import { useGetDashboardAgenda } from "@workspace/api-client-react";
import type { AgendaItem } from "@workspace/api-client-react";
import { Button, Card, Chip, Dropdown, Header, Label, Separator, type Key } from "@heroui/react";
import { HintTooltip } from "@/components/hint-tooltip";
import { ErrorState, type ErrorVariant } from "@/components/ui/error-state";

/* ─── constants ─────────────────────────────────────────────────────────── */
type ExtItem = AgendaItem & { dueLabel?: string };

/** Localised month name by 0-based index. */
function monthName(t: TFunction, index: number): string {
  return calendarText(t, `calendarWidget.months.${index}`);
}
/** Localised short day-of-week label by 0-based index (Mon..Sun). */
function dayName(t: TFunction, index: number): string {
  return calendarText(t, `calendarWidget.days.${index}`);
}

/**
 * Resolve calendar copy without ever displaying the i18next lookup key.
 * Production resources are guarded by the i18n source-contract tests, but the
 * fallback also protects users from a raw key if a partial bundle is deployed.
 */
function calendarText(t: TFunction, key: string, fallbackKey = "unknown"): string {
  const value = t(key, { defaultValue: "" });
  if (value && value !== key && !value.startsWith("calendarWidget.")) return value;

  const fallback = t(fallbackKey, { defaultValue: "" });
  if (fallback && fallback !== fallbackKey && !fallback.startsWith("calendarWidget.")) return fallback;
  return "Unknown";
}

function calendarYear(t: TFunction, year: number, language: string): string {
  const formattedYear = new Intl.NumberFormat(
    language === "ar" ? "ar" : "en-GB",
    { useGrouping: false },
  ).format(year);
  return calendarText(t, "calendarWidget.yearLabel", "unknown").replace("{{year}}", formattedYear);
}

function calendarDateLabel(
  t: TFunction,
  year: number,
  month: number,
  day: number,
  language: string,
): string {
  const date = new Date(year, month, day);
  const formatted = date.toLocaleDateString(language === "ar" ? "ar" : "en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  return calendarText(t, "calendarWidget.dateLabel").replace("{{date}}", formatted);
}

function toLocalDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/* ─── type metadata ─────────────────────────────────────────────────────── */
type ChipColor = "default" | "accent" | "success" | "warning" | "danger";
const TYPE_META: Record<string, { labelKey: string; color: ChipColor }> = {
  project:       { labelKey: "project",       color: "accent"  },
  plan:          { labelKey: "plan",          color: "default" },
  plan_activity: { labelKey: "plan_activity", color: "success" },
  report:        { labelKey: "report",        color: "warning" },
  risk:          { labelKey: "risk",          color: "danger"  },
};

/** Localised type label with a safe, localised fallback for unknown API values. */
function typeLabel(t: TFunction, type: string): string {
  const meta = TYPE_META[type];
  return meta
    ? calendarText(t, `calendarWidget.types.${meta.labelKey}`, "calendarWidget.unknownType")
    : calendarText(t, "calendarWidget.unknownType");
}

const DUE_META: Record<string, { labelKey: string; color: ChipColor }> = {
  overdue:  { labelKey: "overdue",  color: "danger"  },
  today:    { labelKey: "today",    color: "success" },
  upcoming: { labelKey: "upcoming", color: "accent"  },
};

/** Localised due label with a safe, localised fallback for unknown API values. */
function dueLabel(t: TFunction, due: string): string {
  const meta = DUE_META[due];
  return meta
    ? calendarText(t, `calendarWidget.due.${meta.labelKey}`, "calendarWidget.unknownDue")
    : calendarText(t, "calendarWidget.unknownDue");
}

/** Status values are API identifiers; never expose an unknown identifier in UI. */
function statusLabel(t: TFunction, status: string): string {
  const key = status.trim().toLowerCase();
  if (!key) return calendarText(t, "calendarWidget.unknownStatus");
  return calendarText(t, key, "calendarWidget.unknownStatus");
}

/* ─── colour priority logic ─────────────────────────────────────────────── */
const PENDING_STATUSES = new Set([
  "draft", "submitted", "in_progress", "pending",
  "technically_approved", "coordination_approved",
  "submitted_for_review", "under_review",
]);
const DONE_STATUSES = new Set([
  "completed", "approved", "closed", "published", "active", "archived",
]);

function getCircleClass(items: ExtItem[], isToday: boolean, isSelected: boolean): string {
  if (isSelected) return "bg-[var(--accent)] text-[var(--accent-foreground)]";
  if (!items.length) {
    if (isToday) return "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] text-[var(--accent)] font-semibold";
    return "text-foreground hover:bg-[var(--default)]";
  }
  if (items.some(i => i.dueLabel === "overdue"))
    return "bg-[var(--danger)] text-[var(--danger-foreground)]";
  if (isToday)
    return "bg-foreground text-[var(--background)] ring-2 ring-[var(--accent)]/30";
  if (items.some(i => PENDING_STATUSES.has(i.status ?? "")))
    return "bg-[var(--warning)] text-[var(--warning-foreground)]";
  if (items.every(i => DONE_STATUSES.has(i.status ?? "")))
    return "bg-[var(--success)] text-[var(--success-foreground)]";
  return "bg-violet-500 text-white";
}

function buildTooltip(t: TFunction, items: ExtItem[]): string {
  if (!items.length) return "";
  const counts: Record<string, number> = {};
  for (const i of items) {
    const label = typeLabel(t, i.type);
    counts[label] = (counts[label] ?? 0) + 1;
  }
  const parts = Object.entries(counts).map(([l, n]) => `${n} ${l}`);
  const pluralKey = items.length === 1 ? "one" : "other";
  return calendarText(t, `calendarWidget.scheduledItems_${pluralKey}`)
    .replace("{{count}}", String(items.length))
    .replace("{{parts}}", parts.join(", "));
}

/* ─── filter types ───────────────────────────────────────────────────────── */
type ReminderFilter     = "all" | "overdue" | "today" | "upcoming";
type ScheduleTypeFilter = "all" | "project" | "plan" | "plan_activity" | "report" | "risk";

/* ─── DateBadge ─────────────────────────────────────────────────────────── */
function DateBadge({ dateStr, color, locale }: { dateStr: string; color: string; locale: string }) {
  const d   = new Date(dateStr + "T00:00:00");
  const mon = d.toLocaleString(locale, { month: "short" });
  const day = d.getDate();
  return (
    <div className={`flex size-10 shrink-0 flex-col items-center justify-center rounded-xl font-medium leading-none ${color}`}>
      <span className="text-[10px] opacity-70">{mon}</span>
      <span className="text-sm font-semibold">{day}</span>
    </div>
  );
}

const DATE_COLORS = [
  "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)]",
  "bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-[var(--warning)]",
  "bg-[color-mix(in_oklab,var(--success)_14%,transparent)] text-[var(--success)]",
  "bg-[var(--default)] text-foreground",
];

/* Shared card header: title on the start, an icon-only options menu on the end. */
function CardMenuButton({ label }: { label: string }) {
  return (
    <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
      <MoreHorizontal className="size-4 text-[var(--muted)]" aria-hidden="true" />
    </Button>
  );
}

/* ─── Context ────────────────────────────────────────────────────────────── */
type CalCtx = {
  viewYear: number;
  viewMonth: number;
  selectedDate: string | null;
  scheduleTypeFilter: ScheduleTypeFilter;
  reminderFilter: ReminderFilter;
  items: ExtItem[];
  eventsByDate: Map<string, ExtItem[]>;
  selectedItems: ExtItem[];
  reminders: ExtItem[];
  hasMoreReminders: boolean;
  reminderCounts: { overdue: number; today: number; upcoming: number };
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isViewingCurrentMonth: boolean;
  todayStr: string;
  cells: (number | null)[];
  setSelectedDate: (d: string | null) => void;
  setScheduleTypeFilter: (f: ScheduleTypeFilter) => void;
  setReminderFilter: (f: ReminderFilter) => void;
  goToToday: () => void;
  prevMonth: () => void;
  nextMonth: () => void;
  doRefetch: () => void;
  navigate: (path: string) => void;
};

const CalendarContext = createContext<CalCtx | null>(null);

function useCalendarCtx(): CalCtx {
  const ctx = useContext(CalendarContext);
  if (!ctx) throw new Error("Calendar components must be rendered inside <CalendarProvider>");
  return ctx;
}

/** Keep an agenda failure distinct from a successful empty agenda. */
function agendaErrorVariant(error: unknown): ErrorVariant {
  const status = typeof error === "object" && error !== null
    ? Number((error as { status?: unknown; response?: { status?: unknown } }).status
      ?? (error as { response?: { status?: unknown } }).response?.status)
    : NaN;
  if (status === 401 || status === 403) return "permission";
  if (status >= 500) return "server";
  if (typeof navigator !== "undefined" && navigator.onLine === false) return "network";
  return "generic";
}

function AgendaErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation("common");
  const variant = agendaErrorVariant(error);
  const titleKey = variant === "permission"
    ? "calendarWidget.accessDeniedTitle"
    : variant === "network"
      ? "calendarWidget.unavailableTitle"
      : "calendarWidget.loadFailedTitle";
  const descriptionKey = variant === "permission"
    ? "calendarWidget.accessDeniedDescription"
    : variant === "network"
      ? "calendarWidget.unavailableDescription"
      : "calendarWidget.loadFailedDescription";
  return (
    <ErrorState
      compact
      variant={variant}
      title={calendarText(t, titleKey)}
      description={calendarText(t, descriptionKey)}
      retryLabel={calendarText(t, "calendarWidget.retry")}
      onRetry={onRetry}
    />
  );
}

/* ─── CalendarProvider ───────────────────────────────────────────────────── */
export function CalendarProvider({ children }: { children: React.ReactNode }) {
  const today    = useMemo(() => new Date(), []);
  const todayStr = toLocalDateStr(today);
  const [, navigate] = useLocation();

  const [viewYear,  setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth] = useState(today.getMonth());
  const [selectedDate,        setSelectedDate]        = useState<string | null>(todayStr);
  const [scheduleTypeFilter,  setScheduleTypeFilter]  = useState<ScheduleTypeFilter>("all");
  const [reminderFilter,      setReminderFilter]      = useState<ReminderFilter>("all");

  const { data: agendaData, isLoading, isFetching, isError, error, refetch } = useGetDashboardAgenda();
  // Never reinterpret retained/stale query data as the current agenda after a
  // failed request. An empty list is only meaningful after a successful query.
  const items = useMemo(
    () => isError ? [] : (agendaData?.items ?? []) as ExtItem[],
    [agendaData?.items, isError],
  );

  const eventsByDate = useMemo(() => {
    const map = new Map<string, ExtItem[]>();
    for (const i of items) {
      if (!i.date) continue;
      if (!map.has(i.date)) map.set(i.date, []);
      map.get(i.date)!.push(i);
    }
    return map;
  }, [items]);

  /* build calendar grid cells */
  const firstDay = new Date(viewYear, viewMonth, 1);
  let startDow = firstDay.getDay() - 1;
  if (startDow < 0) startDow = 6;
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(startDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const goToToday = () => {
    setViewYear(today.getFullYear());
    setViewMonth(today.getMonth());
    setSelectedDate(todayStr);
  };
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y - 1); setViewMonth(11); }
    else setViewMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y + 1); setViewMonth(0); }
    else setViewMonth(m => m + 1);
  };

  const selectedItems = useMemo(() => {
    if (!selectedDate) return [];
    return items.filter(i =>
      i.date === selectedDate &&
      (scheduleTypeFilter === "all" || i.type === scheduleTypeFilter),
    );
  }, [items, selectedDate, scheduleTypeFilter]);

  const { reminders, hasMoreReminders } = useMemo(() => {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = toLocalDateStr(cutoff);
    const all = items
      .filter(i => {
        if (i.date > cutoffStr) return false;
        if (reminderFilter !== "all" && (i.dueLabel ?? "upcoming") !== reminderFilter) return false;
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
    return { reminders: all.slice(0, 5), hasMoreReminders: all.length > 5 };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, reminderFilter]);

  const reminderCounts = useMemo(() => {
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() + 14);
    const cutoffStr = toLocalDateStr(cutoff);
    const base = items.filter(i => i.date <= cutoffStr);
    return {
      overdue:  base.filter(i => i.dueLabel === "overdue").length,
      today:    base.filter(i => i.dueLabel === "today").length,
      upcoming: base.filter(i => (i.dueLabel ?? "upcoming") === "upcoming").length,
    };
  }, [items, today]);

  const isViewingCurrentMonth =
    viewYear === today.getFullYear() && viewMonth === today.getMonth();

  const value: CalCtx = {
    viewYear, viewMonth, selectedDate, scheduleTypeFilter, reminderFilter,
    items, eventsByDate, selectedItems, reminders, hasMoreReminders, reminderCounts,
    isLoading, isFetching, isError, error, isViewingCurrentMonth, todayStr, cells,
    setSelectedDate, setScheduleTypeFilter, setReminderFilter,
    goToToday, prevMonth, nextMonth,
    doRefetch: () => { void refetch(); },
    navigate,
  };

  return <CalendarContext.Provider value={value}>{children}</CalendarContext.Provider>;
}

/* ─── CalendarGridCard ───────────────────────────────────────────────────── */
export function CalendarGridCard() {
  const { t, i18n } = useTranslation("common");
  const {
    viewYear, viewMonth, selectedDate, cells, eventsByDate,
    todayStr, isViewingCurrentMonth, goToToday, prevMonth, nextMonth,
    setSelectedDate, navigate, isError, error, doRefetch, isFetching,
  } = useCalendarCtx();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-base font-semibold text-foreground">{calendarText(t, "calendarWidget.calendar")}</span>
        <Dropdown>
          <CardMenuButton label={calendarText(t, "calendarWidget.calendarOptions")} />
          <Dropdown.Popover placement="bottom end" className="min-w-44">
            <Dropdown.Menu
              aria-label={calendarText(t, "calendarWidget.calendarOptions")}
              disabledKeys={isViewingCurrentMonth && selectedDate === todayStr ? ["today"] : []}
              onAction={(key: Key) => {
                if (key === "today") goToToday();
                else if (key === "prev") prevMonth();
                else if (key === "next") nextMonth();
                else navigate(String(key));
              }}
            >
              <Dropdown.Section>
                <Header>{calendarText(t, "calendarWidget.navigation")}</Header>
                <Dropdown.Item id="today" textValue={calendarText(t, "calendarWidget.goToToday")}>
                  <CalendarDays className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.goToToday")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="prev" textValue={calendarText(t, "calendarWidget.previousMonth")}>
                  <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.previousMonth")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="next" textValue={calendarText(t, "calendarWidget.nextMonth")}>
                  <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.nextMonth")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
              <Dropdown.Section>
                <Header>{calendarText(t, "calendarWidget.goTo")}</Header>
                <Dropdown.Item id="/projects" textValue={calendarText(t, "calendarWidget.allProjects")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.allProjects")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="/plans" textValue={calendarText(t, "calendarWidget.allPlans")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.allPlans")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="/reports" textValue={calendarText(t, "calendarWidget.allReports")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.allReports")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <Separator />
      {isError && (
        <div className="border-b border-[var(--separator)]" aria-live="assertive">
          <AgendaErrorState error={error} onRetry={doRefetch} />
        </div>
      )}
      {isFetching && !isError && (
        <p role="status" aria-live="polite" className="px-4 py-1 text-xs text-muted-foreground">
          {calendarText(t, "calendarWidget.refreshing")}
        </p>
      )}

      {/* Month navigation */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <Button isIconOnly size="sm" variant="ghost" onPress={prevMonth} aria-label={calendarText(t, "calendarWidget.previousMonth")}>
          <ChevronLeft className="size-4 text-[var(--muted)] rtl:rotate-180" aria-hidden="true" />
        </Button>
        <span className="text-sm font-medium text-foreground">
          {monthName(t, viewMonth)} {calendarYear(t, viewYear, i18n.language)}
        </span>
        <Button isIconOnly size="sm" variant="ghost" onPress={nextMonth} aria-label={calendarText(t, "calendarWidget.nextMonth")}>
          <ChevronRight className="size-4 text-[var(--muted)] rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-4 pb-1 flex-wrap">
        {[
          { color: "bg-[var(--danger)]",  label: calendarText(t, "calendarWidget.legendOverdue")   },
          { color: "bg-[var(--warning)]", label: calendarText(t, "calendarWidget.legendPending")   },
          { color: "bg-[var(--success)]", label: calendarText(t, "calendarWidget.legendDone")      },
          { color: "bg-violet-500",       label: calendarText(t, "calendarWidget.legendScheduled") },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-xs text-[var(--muted)]">
            <span className={`inline-block w-2 h-2 rounded-full ${color}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-3 pb-1" role="row" aria-label={calendarText(t, "calendarWidget.weekdays")}>
        {Array.from({ length: 7 }, (_, i) => dayName(t, i)).map((d, i) => (
          <div key={i} role="columnheader" className="min-w-0 text-center text-[10px] sm:text-xs font-medium text-[var(--muted)] py-1 leading-tight whitespace-nowrap">
            {d}
          </div>
        ))}
      </div>

      {/* Date cells */}
      <div className="grid grid-cols-7 px-3 pb-3 gap-y-0.5" role="grid" aria-label={calendarText(t, "calendarWidget.calendarDates")}>
        {cells.map((day, idx) => {
          if (!day) return <div key={`empty-${idx}`} aria-hidden="true" />;
          const dateStr    = `${viewYear}-${String(viewMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const isToday    = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const dateItems  = eventsByDate.get(dateStr) ?? [];
          const circleCls  = getCircleClass(dateItems, isToday, isSelected);
          const tipText    = buildTooltip(t, dateItems);

          const btn = (
            <button
              key={dateStr}
              onClick={() => setSelectedDate(isSelected ? null : dateStr)}
              aria-label={`${calendarDateLabel(t, viewYear, viewMonth, day, i18n.language)}${tipText ? `: ${tipText}` : ""}`}
              aria-pressed={isSelected}
              className={`relative mx-auto flex size-8 items-center justify-center rounded-full text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${circleCls}`}
            >
              {day}
            </button>
          );

          return (
            <div key={dateStr} className="flex items-center justify-center">
              {tipText ? (
                <HintTooltip content={tipText} className="max-w-40 text-center">{btn}</HintTooltip>
              ) : btn}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

/* ─── ScheduleCard ───────────────────────────────────────────────────────── */
export function ScheduleCard() {
  const { t, i18n } = useTranslation("common");
  const dateLocale = i18n.language === "ar" ? "ar" : "en-GB";
  const {
    isLoading, selectedDate, selectedItems, scheduleTypeFilter,
    todayStr, setSelectedDate, setScheduleTypeFilter, navigate, isError, error, doRefetch,
  } = useCalendarCtx();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex flex-wrap items-center gap-1.5 text-base font-semibold text-foreground">
          {calendarText(t, "calendarWidget.schedule")}
          {selectedDate && (
            <span className="text-xs font-normal text-[var(--muted)]">
              — {new Date(selectedDate + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
            </span>
          )}
          {scheduleTypeFilter !== "all" && (
            <Chip size="sm" variant="soft" color="accent">
              <Filter className="size-3" aria-hidden="true" />
              {typeLabel(t, scheduleTypeFilter)}
            </Chip>
          )}
        </span>
        <Dropdown>
          <CardMenuButton label={calendarText(t, "calendarWidget.scheduleOptions")} />
          <Dropdown.Popover placement="bottom end" className="min-w-48">
            <Dropdown.Menu
              aria-label={calendarText(t, "calendarWidget.scheduleOptions")}
              disabledKeys={[...(selectedDate === todayStr ? ["showToday"] : []), ...(!selectedDate ? ["clear"] : [])]}
              onAction={(key: Key) => {
                if (key === "showToday") setSelectedDate(todayStr);
                else if (key === "clear") setSelectedDate(null);
                else if (typeof key === "string" && key.startsWith("/")) navigate(key);
              }}
            >
              <Dropdown.Section>
                <Header>{calendarText(t, "calendarWidget.date")}</Header>
                <Dropdown.Item id="showToday" textValue={calendarText(t, "calendarWidget.showToday")}>
                  <CalendarDays className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.showToday")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="clear" textValue={calendarText(t, "calendarWidget.clearSelection")}>
                  <X className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.clearSelection")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
              <Dropdown.Section
                selectionMode="single"
                selectedKeys={[scheduleTypeFilter]}
                onSelectionChange={(keys) => { const k = [...keys][0]; if (k) setScheduleTypeFilter(String(k) as ScheduleTypeFilter); }}
              >
                <Header>{calendarText(t, "calendarWidget.filterByType")}</Header>
                {([
                  ["all", "calendarWidget.allTypes"], ["project", "calendarWidget.projectsOnly"], ["plan", "calendarWidget.plansOnly"],
                  ["report", "calendarWidget.reportsOnly"], ["risk", "calendarWidget.risksOnly"],
                ] as const).map(([id, key]) => (
                  <Dropdown.Item key={id} id={id} textValue={calendarText(t, key)}>
                    <Label>{calendarText(t, key)}</Label>
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Section>
              <Dropdown.Section>
                <Dropdown.Item id="/plans" textValue={calendarText(t, "calendarWidget.viewAllPlans")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.viewAllPlans")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="/projects" textValue={calendarText(t, "calendarWidget.viewAllProjects")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.viewAllProjects")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <Separator />

      <div className="divide-y divide-[var(--separator)]">
        {isError ? (
          <AgendaErrorState error={error} onRetry={doRefetch} />
        ) : isLoading ? (
          <div className="space-y-1 p-3 animate-pulse" aria-hidden="true">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl bg-[var(--default)]" />)}
          </div>
        ) : selectedItems.length === 0 ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 text-center px-4 min-h-[130px]">
            <CalendarDays className="h-5 w-5 text-muted-foreground/25" aria-hidden="true" />
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[180px]">
              {!selectedDate
                ? calendarText(t, "calendarWidget.selectDatePrompt")
                : scheduleTypeFilter !== "all"
                  ? calendarText(t, "calendarWidget.noTypedItems").replace("{{type}}", typeLabel(t, scheduleTypeFilter).toLowerCase())
                  : calendarText(t, "calendarWidget.noItemsForDate")}
            </p>
          </div>
        ) : (
          selectedItems.map((item, i) => {
            const meta     = TYPE_META[item.type] ?? TYPE_META.project;
            const colorCls = DATE_COLORS[i % DATE_COLORS.length];
            return (
              <Link
                key={item.id} href={item.link}
                className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
              >
                <DateBadge dateStr={item.date} color={colorCls} locale={dateLocale} />
                <div className="flex-1 min-w-0">
                  <p className="truncate text-sm font-medium leading-snug text-foreground">
                    {item.title}
                  </p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip size="sm" variant="soft" color={meta.color}>
                      {typeLabel(t, item.type)}
                    </Chip>
                    <span className="text-xs text-[var(--muted)]">
                       {statusLabel(t, item.status)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </Card>
  );
}

/* ─── RemindersCard ──────────────────────────────────────────────────────── */
export function RemindersCard() {
  const { t, i18n } = useTranslation("common");
  const dateLocale = i18n.language === "ar" ? "ar" : "en-GB";
  const {
    isLoading, reminders, reminderFilter, reminderCounts,
    setReminderFilter, doRefetch, navigate, isError, error,
  } = useCalendarCtx();

  return (
    <Card className="gap-0 overflow-hidden p-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3">
        <span className="flex items-center gap-1.5 text-base font-semibold text-foreground">
          {calendarText(t, "calendarWidget.reminders")}
          {reminderFilter !== "all" && (
            <Chip size="sm" variant="soft" color={DUE_META[reminderFilter]?.color ?? "default"}>
              <Filter className="size-3" aria-hidden="true" />
              {dueLabel(t, reminderFilter)}
            </Chip>
          )}
        </span>
        <Dropdown>
          <CardMenuButton label={calendarText(t, "calendarWidget.remindersOptions")} />
          <Dropdown.Popover placement="bottom end" className="min-w-52">
            <Dropdown.Menu
              aria-label={calendarText(t, "calendarWidget.remindersOptions")}
              onAction={(key: Key) => {
                if (key === "refresh") doRefetch();
                else if (typeof key === "string" && key.startsWith("/")) navigate(key);
              }}
            >
              <Dropdown.Section
                selectionMode="single"
                selectedKeys={[reminderFilter]}
                onSelectionChange={(keys) => { const k = [...keys][0]; if (k) setReminderFilter(String(k) as ReminderFilter); }}
              >
                <Header>{calendarText(t, "calendarWidget.filterDeadlines")}</Header>
                {([
                  ["all", "calendarWidget.allUpcoming", 0, "default"],
                  ["overdue", "calendarWidget.overdueOnly", reminderCounts.overdue, "danger"],
                  ["today", "calendarWidget.dueToday", reminderCounts.today, "success"],
                  ["upcoming", "calendarWidget.upcoming", reminderCounts.upcoming, "accent"],
                ] as const).map(([id, key, count, color]) => (
                  <Dropdown.Item key={id} id={id} textValue={calendarText(t, key)}>
                    <Label>{calendarText(t, key)}</Label>
                    {count > 0 && <Chip size="sm" variant="soft" color={color} className="ms-auto tabular-nums">{count}</Chip>}
                    <Dropdown.ItemIndicator />
                  </Dropdown.Item>
                ))}
              </Dropdown.Section>
              <Dropdown.Section>
                <Dropdown.Item id="refresh" textValue={calendarText(t, "calendarWidget.refresh")}>
                  <RefreshCw className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.refresh")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
              <Dropdown.Section>
                <Dropdown.Item id="/risks" textValue={calendarText(t, "calendarWidget.viewAllRisks")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.viewAllRisks")}</Label>
                </Dropdown.Item>
                <Dropdown.Item id="/projects" textValue={calendarText(t, "calendarWidget.viewAllProjects")}>
                  <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" aria-hidden="true" /><Label>{calendarText(t, "calendarWidget.viewAllProjects")}</Label>
                </Dropdown.Item>
              </Dropdown.Section>
            </Dropdown.Menu>
          </Dropdown.Popover>
        </Dropdown>
      </div>
      <Separator />

      <div className="divide-y divide-[var(--separator)]">
        {isError ? (
          <AgendaErrorState error={error} onRetry={doRefetch} />
        ) : isLoading ? (
          <div className="space-y-1 p-3 animate-pulse" aria-hidden="true">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-xl bg-[var(--default)]" />)}
          </div>
        ) : reminders.length === 0 ? (
          <div role="status" aria-live="polite" className="flex flex-col items-center justify-center gap-2 text-center px-4 min-h-[130px]">
            <Clock className="h-5 w-5 text-muted-foreground/25" aria-hidden="true" />
            <p className="text-xs text-muted-foreground leading-relaxed max-w-[180px]">
              {reminderFilter === "overdue"
                ? calendarText(t, "calendarWidget.noOverdue")
                : reminderFilter === "today"
                  ? calendarText(t, "calendarWidget.nothingDueToday")
                  : calendarText(t, "calendarWidget.noUpcoming")}
            </p>
          </div>
        ) : (
          reminders.map(item => {
            const due      = item.dueLabel ?? "upcoming";
            const dueMeta  = DUE_META[due] ?? DUE_META.upcoming;
            const typeMeta = TYPE_META[item.type] ?? TYPE_META.project;
            return (
              <Link
                key={item.id} href={item.link}
                className="group flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus)]"
              >
                <div className="flex-1 min-w-0">
                  {/* The whole row is the link; a native title shows the full
                      clamped text without nesting a second focus stop. */}
                  <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground" dir="auto" title={item.title}>
                    {item.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-xs text-[var(--muted)]">
                      {new Date(item.date + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
                    </span>
                    <Chip size="sm" variant="soft" color={typeMeta.color}>
                      {typeLabel(t, item.type)}
                    </Chip>
                  </div>
                </div>
                <Chip size="sm" variant="soft" color={dueMeta.color} className="shrink-0 self-center">
                  {dueLabel(t, due)}
                </Chip>
              </Link>
            );
          })
        )}
      </div>
      {/* Reminders are a mixed collection of projects, plans, activities, and
          reports. Each rendered item has its own canonical record link; there
          is intentionally no misleading single-module "View all" destination. */}
    </Card>
  );
}

/* ─── CalendarWidget — backward-compatible wrapper ───────────────────────── */
export function CalendarWidget() {
  return (
    <CalendarProvider>
      <div className="space-y-4">
        <CalendarGridCard />
        <ScheduleCard />
        <RemindersCard />
      </div>
    </CalendarProvider>
  );
}
