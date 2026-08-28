import { useState, useMemo, createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Link, useLocation } from "wouter";
import {
  ChevronLeft, ChevronRight, MoreHorizontal,
  CalendarDays, RefreshCw, Filter, X, ArrowRight, Clock,
} from "lucide-react";
import { useGetDashboardAgenda } from "@workspace/api-client-react";
import type { AgendaItem } from "@workspace/api-client-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel, DropdownMenuTrigger,
  DropdownMenuRadioGroup, DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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
const TYPE_META: Record<string, { labelKey: string; bg: string; text: string }> = {
  project:       { labelKey: "project",       bg: "bg-blue-50",   text: "text-blue-700"   },
  plan:          { labelKey: "plan",          bg: "bg-violet-50", text: "text-violet-700" },
  plan_activity: { labelKey: "plan_activity", bg: "bg-cyan-50",   text: "text-cyan-700"   },
  report:        { labelKey: "report",        bg: "bg-amber-50",  text: "text-amber-700"  },
  risk:          { labelKey: "risk",          bg: "bg-red-50",    text: "text-red-700"    },
};

/** Localised type label with a safe, localised fallback for unknown API values. */
function typeLabel(t: TFunction, type: string): string {
  const meta = TYPE_META[type];
  return meta
    ? calendarText(t, `calendarWidget.types.${meta.labelKey}`, "calendarWidget.unknownType")
    : calendarText(t, "calendarWidget.unknownType");
}

const DUE_META: Record<string, { labelKey: string; cls: string }> = {
  overdue:  { labelKey: "overdue",  cls: "bg-red-100 text-red-700"   },
  today:    { labelKey: "today",    cls: "bg-green-100 text-green-700" },
  upcoming: { labelKey: "upcoming", cls: "bg-blue-100 text-blue-700"  },
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
  if (isSelected) return "bg-[#1a3a5c] text-white shadow-md";
  if (!items.length) {
    if (isToday) return "bg-blue-100 text-blue-700";
    return "hover:bg-muted/50 text-foreground";
  }
  if (items.some(i => i.dueLabel === "overdue"))
    return "bg-red-500 text-white shadow-sm shadow-red-200 ring-2 ring-red-100";
  if (isToday)
    return "bg-[#1a2744] text-white shadow-md ring-2 ring-[#1a2744]/20";
  if (items.some(i => PENDING_STATUSES.has(i.status ?? "")))
    return "bg-orange-400 text-white shadow-sm shadow-orange-100";
  if (items.every(i => DONE_STATUSES.has(i.status ?? "")))
    return "bg-emerald-500 text-white shadow-sm shadow-emerald-100";
  return "bg-violet-500 text-white shadow-sm shadow-violet-100";
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
    <div className={`shrink-0 flex flex-col items-center justify-center w-8 h-8 rounded-lg ${color} font-medium leading-none`}>
      <span className="text-[8px] uppercase tracking-wider opacity-70">{mon}</span>
      <span className="text-sm">{day}</span>
    </div>
  );
}

const DATE_COLORS = [
  "bg-blue-50 text-blue-700",
  "bg-amber-50 text-amber-700",
  "bg-green-50 text-green-700",
  "bg-violet-50 text-violet-700",
];

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

  const { data: agendaData, isLoading, refetch } = useGetDashboardAgenda();
  const items = useMemo(() => (agendaData?.items ?? []) as ExtItem[], [agendaData?.items]);

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
    isLoading, isViewingCurrentMonth, todayStr, cells,
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
    setSelectedDate, navigate,
  } = useCalendarCtx();

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="text-[15px] font-semibold text-foreground">{calendarText(t, "calendarWidget.calendar")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-md hover:bg-muted/60 transition-colors" aria-label={calendarText(t, "calendarWidget.calendarOptions")}>
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel className="text-xs text-muted-foreground pb-1">{calendarText(t, "calendarWidget.navigation")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={goToToday} disabled={isViewingCurrentMonth && selectedDate === todayStr} className="gap-2 text-sm">
              <CalendarDays className="h-3.5 w-3.5" /> {calendarText(t, "calendarWidget.goToToday")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={prevMonth} className="gap-2 text-sm">
              <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.previousMonth")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={nextMonth} className="gap-2 text-sm">
              <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.nextMonth")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground pb-1">{calendarText(t, "calendarWidget.goTo")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => navigate("/projects")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.allProjects")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/plans")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.allPlans")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/reports")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.allReports")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Month navigation */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button onClick={prevMonth} aria-label={calendarText(t, "calendarWidget.previousMonth")} className="p-1 rounded-md hover:bg-muted/60 transition-colors">
          <ChevronLeft className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
        </button>
        <span className="text-sm font-medium text-foreground">
          {monthName(t, viewMonth)} {calendarYear(t, viewYear, i18n.language)}
        </span>
        <button onClick={nextMonth} aria-label={calendarText(t, "calendarWidget.nextMonth")} className="p-1 rounded-md hover:bg-muted/60 transition-colors">
          <ChevronRight className="h-4 w-4 text-muted-foreground rtl:rotate-180" />
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 px-4 pb-1 flex-wrap">
        {[
          { color: "bg-red-500",     label: calendarText(t, "calendarWidget.legendOverdue")   },
          { color: "bg-orange-400",  label: calendarText(t, "calendarWidget.legendPending")   },
          { color: "bg-emerald-500", label: calendarText(t, "calendarWidget.legendDone")      },
          { color: "bg-violet-500",  label: calendarText(t, "calendarWidget.legendScheduled") },
        ].map(({ color, label }) => (
          <span key={label} className="flex items-center gap-1 text-xs text-muted-foreground/70">
            <span className={`inline-block w-2 h-2 rounded-full ${color}`} aria-hidden="true" />
            {label}
          </span>
        ))}
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-3 pb-1" role="row" aria-label={calendarText(t, "calendarWidget.weekdays")}>
        {Array.from({ length: 7 }, (_, i) => dayName(t, i)).map((d, i) => (
          <div key={i} role="columnheader" className="min-w-0 text-center text-[10px] sm:text-xs font-medium text-muted-foreground/60 py-1 leading-tight whitespace-nowrap">
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
              className={`relative flex items-center justify-center h-7 w-7 mx-auto rounded-full text-xs font-medium transition-all duration-150 ${circleCls} ${!dateItems.length && !isToday && !isSelected ? "hover:bg-muted/50" : ""}`}
            >
              {day}
            </button>
          );

          return (
            <div key={dateStr} className="flex items-center justify-center">
              {tipText ? (
                <Tooltip>
                  <TooltipTrigger asChild>{btn}</TooltipTrigger>
                  <TooltipContent side="top" className="text-xs max-w-[160px] text-center leading-snug">
                    {tipText}
                  </TooltipContent>
                </Tooltip>
              ) : btn}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── ScheduleCard ───────────────────────────────────────────────────────── */
export function ScheduleCard() {
  const { t, i18n } = useTranslation("common");
  const dateLocale = i18n.language === "ar" ? "ar" : "en-GB";
  const {
    isLoading, selectedDate, selectedItems, scheduleTypeFilter,
    todayStr, setSelectedDate, setScheduleTypeFilter, navigate,
  } = useCalendarCtx();

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="text-[15px] font-semibold text-foreground flex items-center gap-1.5 flex-wrap">
          {calendarText(t, "calendarWidget.schedule")}
          {selectedDate && (
            <span className="font-normal text-muted-foreground text-xs">
              — {new Date(selectedDate + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
            </span>
          )}
          {scheduleTypeFilter !== "all" && (
            <span className="inline-flex items-center gap-0.5 bg-primary/10 text-primary text-xs font-medium rounded-full px-1.5 py-0.5">
              <Filter className="h-2.5 w-2.5" aria-hidden="true" />
              {typeLabel(t, scheduleTypeFilter)}
            </span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-md hover:bg-muted/60 transition-colors" aria-label={calendarText(t, "calendarWidget.scheduleOptions")}>
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground pb-1">{calendarText(t, "calendarWidget.date")}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => setSelectedDate(todayStr)} disabled={selectedDate === todayStr} className="gap-2 text-sm">
              <CalendarDays className="h-3.5 w-3.5" /> {calendarText(t, "calendarWidget.showToday")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => setSelectedDate(null)} disabled={!selectedDate} className="gap-2 text-sm">
              <X className="h-3.5 w-3.5" /> {calendarText(t, "calendarWidget.clearSelection")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground pb-1">{calendarText(t, "calendarWidget.filterByType")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={scheduleTypeFilter} onValueChange={v => setScheduleTypeFilter(v as ScheduleTypeFilter)}>
              <DropdownMenuRadioItem value="all"          className="text-sm">{calendarText(t, "calendarWidget.allTypes")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="project"      className="text-sm">{calendarText(t, "calendarWidget.projectsOnly")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="plan"         className="text-sm">{calendarText(t, "calendarWidget.plansOnly")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="report"       className="text-sm">{calendarText(t, "calendarWidget.reportsOnly")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="risk"         className="text-sm">{calendarText(t, "calendarWidget.risksOnly")}</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/plans")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.viewAllPlans")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/projects")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.viewAllProjects")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="divide-y divide-border/40">
        {isLoading ? (
          <div className="space-y-1 p-3 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-muted/40" />)}
          </div>
        ) : selectedItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-4 min-h-[130px]">
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
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors group"
              >
                <DateBadge dateStr={item.date} color={colorCls} locale={dateLocale} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate leading-snug group-hover:text-primary transition-colors">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${meta.bg} ${meta.text}`}>
                      {typeLabel(t, item.type)}
                    </span>
                    <span className="text-xs text-muted-foreground capitalize">
                       {statusLabel(t, item.status)}
                    </span>
                  </div>
                </div>
              </Link>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── RemindersCard ──────────────────────────────────────────────────────── */
export function RemindersCard() {
  const { t, i18n } = useTranslation("common");
  const dateLocale = i18n.language === "ar" ? "ar" : "en-GB";
  const {
    isLoading, reminders, reminderFilter, reminderCounts,
    setReminderFilter, doRefetch, navigate,
  } = useCalendarCtx();

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <span className="text-[15px] font-semibold text-foreground flex items-center gap-1.5">
          {calendarText(t, "calendarWidget.reminders")}
          {reminderFilter !== "all" && (
            <span className={`inline-flex items-center gap-0.5 text-xs font-medium rounded-full px-1.5 py-0.5 ${DUE_META[reminderFilter]?.cls ?? ""}`}>
              <Filter className="h-2.5 w-2.5" aria-hidden="true" />
              {dueLabel(t, reminderFilter)}
            </span>
          )}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="p-1 rounded-md hover:bg-muted/60 transition-colors" aria-label={calendarText(t, "calendarWidget.remindersOptions")}>
              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="text-xs text-muted-foreground pb-1">{calendarText(t, "calendarWidget.filterDeadlines")}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={reminderFilter} onValueChange={v => setReminderFilter(v as ReminderFilter)}>
              <DropdownMenuRadioItem value="all" className="text-sm">{calendarText(t, "calendarWidget.allUpcoming")}</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="overdue" className="text-sm">
                <span className="flex items-center justify-between w-full gap-2">
                  {calendarText(t, "calendarWidget.overdueOnly")}
                  {reminderCounts.overdue > 0 && (
                    <span className="bg-red-100 text-red-700 text-xs font-medium rounded-full px-1.5 py-0.5">
                      {reminderCounts.overdue}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="today" className="text-sm">
                <span className="flex items-center justify-between w-full gap-2">
                   {calendarText(t, "calendarWidget.dueToday")}
                  {reminderCounts.today > 0 && (
                    <span className="bg-green-100 text-green-700 text-xs font-medium rounded-full px-1.5 py-0.5">
                      {reminderCounts.today}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="upcoming" className="text-sm">
                <span className="flex items-center justify-between w-full gap-2">
                 {calendarText(t, "calendarWidget.upcoming")}
                  {reminderCounts.upcoming > 0 && (
                    <span className="bg-blue-100 text-blue-700 text-xs font-medium rounded-full px-1.5 py-0.5">
                      {reminderCounts.upcoming}
                    </span>
                  )}
                </span>
              </DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={doRefetch} className="gap-2 text-sm">
              <RefreshCw className="h-3.5 w-3.5" /> {calendarText(t, "calendarWidget.refresh")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate("/risks")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.viewAllRisks")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => navigate("/projects")} className="gap-2 text-sm">
              <ArrowRight className="h-3.5 w-3.5 rtl:rotate-180" /> {calendarText(t, "calendarWidget.viewAllProjects")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="divide-y divide-border/40">
        {isLoading ? (
          <div className="space-y-1 p-3 animate-pulse">
            {[1, 2, 3].map(i => <div key={i} className="h-10 rounded-lg bg-muted/40" />)}
          </div>
        ) : reminders.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 text-center px-4 min-h-[130px]">
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
                className="flex items-start gap-3 px-4 py-2.5 hover:bg-muted/40 transition-colors group"
              >
                <div className="flex-1 min-w-0">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <p className="text-sm font-medium text-foreground line-clamp-2 leading-snug group-hover:text-primary transition-colors">
                        {item.title}
                      </p>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="text-xs max-w-[240px] leading-snug">
                      {item.title}
                    </TooltipContent>
                  </Tooltip>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <span className="text-xs text-muted-foreground">
                      {new Date(item.date + "T00:00:00").toLocaleDateString(dateLocale, { month: "short", day: "numeric" })}
                    </span>
                    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-xs font-medium ${typeMeta.bg} ${typeMeta.text}`}>
                       {typeLabel(t, item.type)}
                    </span>
                  </div>
                </div>
                <span className={`shrink-0 self-center inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${dueMeta.cls}`}>
                  {dueLabel(t, due)}
                </span>
              </Link>
            );
          })
        )}
      </div>
      {/* Reminders are a mixed collection of projects, plans, activities, and
          reports. Each rendered item has its own canonical record link; there
          is intentionally no misleading single-module "View all" destination. */}
    </div>
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
