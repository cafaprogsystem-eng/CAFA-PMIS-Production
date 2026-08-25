import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { ViewRecord } from "@/lib/view-modes";

interface CalendarGridProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const PENDING_STATUSES = new Set(["draft","submitted","in_progress","pending",
  "technically_approved","coordination_approved","submitted_for_review","under_review"]);
const DONE_STATUSES    = new Set(["completed","approved","closed","published","active","archived"]);

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Returns Tailwind classes for the date number circle.
 * Priority: past-with-items (overdue) > today-with-items > pending > completed > scheduled
 */
function getDateNumberClass(
  cellDate: Date,
  today: Date,
  isToday: boolean,
  items: ViewRecord[],
): string {
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  if (!items.length) {
    if (isToday) return "bg-primary text-primary-foreground";
    return "text-muted-foreground bg-transparent";
  }

  // Overdue: past dates (strictly before today) with items
  if (cellDate < todayMidnight) {
    return "bg-red-500 text-white ring-2 ring-red-100 shadow-sm";
  }

  // Today with scheduled items
  if (isToday) {
    return "bg-[#1a2744] text-white ring-2 ring-[#1a2744]/20 shadow-md";
  }

  // Future: check statuses
  const statuses = items.map(i => i.status ?? "").filter(Boolean);
  if (statuses.some(s => PENDING_STATUSES.has(s))) {
    return "bg-orange-400 text-white shadow-sm";
  }
  if (statuses.length > 0 && statuses.every(s => DONE_STATUSES.has(s))) {
    return "bg-emerald-500 text-white shadow-sm";
  }
  return "bg-violet-500 text-white shadow-sm";
}

/** Build tooltip text for a day's items */
function buildTooltip(items: ViewRecord[], t: (key: string, opts?: Record<string, unknown>) => string): string {
  if (!items.length) return "";
  return t("viewModes.scheduledItems_other", { count: items.length, defaultValue: `${items.length} scheduled items` });
}

export function CalendarGrid({ items, empty }: CalendarGridProps) {
  const { t } = useTranslation("common");
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => new Set());

  const prevMonth = () => {
    setExpandedDays(new Set());
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    setExpandedDays(new Set());
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
  };

  // Items grouped by day-of-month key for current view
  const itemsByDay = useMemo(() => {
    const map = new Map<number, ViewRecord[]>();
    for (const item of items) {
      const d = parseDate(item.date2 ?? item.date);
      if (!d) continue;
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      const key = d.getDate();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(item);
    }
    return map;
  }, [items, year, month]);

  const firstDay    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<number | null> = [
    ...Array(firstDay).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  const hasItems = items.some(item => {
    const d = parseDate(item.date2 ?? item.date);
    return d && d.getFullYear() === year && d.getMonth() === month;
  });

  const legendItems = [
    { color: "bg-red-500",     labelKey: "viewModes.legend.overdue" },
    { color: "bg-[#1a2744]",   labelKey: "viewModes.legend.today" },
    { color: "bg-orange-400",  labelKey: "viewModes.legend.pending" },
    { color: "bg-emerald-500", labelKey: "viewModes.legend.completed" },
    { color: "bg-violet-500",  labelKey: "viewModes.legend.scheduled" },
  ];

  return (
    <div className="space-y-3">
      {/* Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={prevMonth}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <h3 className="text-sm font-semibold">{MONTHS[month]} {year}</h3>
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={nextMonth}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 flex-wrap px-1">
        {legendItems.map(({ color, labelKey }) => (
          <span key={labelKey} className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className={`inline-block w-2.5 h-2.5 rounded-full ${color}`} />
            {t(labelKey)}
          </span>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Day headers */}
        <div className="grid grid-cols-7 bg-muted/40 border-b border-border">
          {DAYS.map(d => (
            <div key={d} className="text-center text-xs font-semibold text-muted-foreground py-2">{d}</div>
          ))}
        </div>

        {/* Cells */}
        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isToday   = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const dayItems  = day ? (itemsByDay.get(day) ?? []) : [];
            const cellDate  = day ? new Date(year, month, day) : null;
            const numCls    = cellDate
              ? getDateNumberClass(cellDate, today, isToday, dayItems)
              : "";
            const tipText   = buildTooltip(dayItems, t);
            const expanded = day ? expandedDays.has(day) : false;
            const visibleItems = expanded ? dayItems : dayItems.slice(0, 3);
            const overflowCount = Math.max(0, dayItems.length - visibleItems.length);
            const recordsId = day ? `calendar-day-${year}-${month}-${day}` : undefined;

            return (
              <div
                key={i}
                className={`min-h-[80px] sm:min-h-[90px] p-1.5 border-b border-r border-border/40 last:border-r-0 ${!day ? "bg-muted/20" : ""}`}
              >
                {day && (
                  <>
                    {/* Date number circle */}
                    <div className="flex items-center justify-start mb-1">
                      {tipText ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold transition-all cursor-default ${numCls}`}>
                              {day}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            {tipText}
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-medium ${numCls}`}>
                          {day}
                        </span>
                      )}
                    </div>

                    {/* Item chips */}
                    <div id={recordsId} className="space-y-0.5">
                      {visibleItems.map(item => {
                        // Pick chip color based on status
                        const s = item.status ?? "";
                        const chipCls = PENDING_STATUSES.has(s)
                          ? "bg-orange-50 border-orange-200 text-orange-800"
                          : DONE_STATUSES.has(s)
                            ? "bg-emerald-50 border-emerald-200 text-emerald-800"
                            : "bg-primary/10 border-primary/20 text-primary";

                        return (
                          <div key={item.id} className="flex items-start gap-0.5">
                            {item.onClick ? (
                              <button
                                type="button"
                                className={`min-w-0 flex-1 text-start text-xs leading-tight border rounded px-1 py-0.5 truncate cursor-pointer hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 transition-opacity ${chipCls}`}
                                onClick={(event) => item.onClick?.(event.currentTarget)}
                                title={item.title}
                                aria-label={`View ${item.title}`}
                              >
                                {item.title}
                              </button>
                            ) : (
                              <span className={`min-w-0 flex-1 text-xs leading-tight border rounded px-1 py-0.5 truncate ${chipCls}`} title={item.title}>
                                {item.title}
                              </span>
                            )}
                            {item.actions && <span className="shrink-0" onClick={(event) => event.stopPropagation()}>{item.actions}</span>}
                          </div>
                        );
                      })}
                      {overflowCount > 0 && (
                        <button
                          type="button"
                          className="w-full text-start text-xs text-primary px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          onClick={() => setExpandedDays((current) => new Set(current).add(day!))}
                          aria-expanded={false}
                          aria-controls={recordsId}
                        >
                          +{overflowCount} more
                        </button>
                      )}
                      {expanded && dayItems.length > 3 && (
                        <button
                          type="button"
                          className="w-full text-start text-xs text-primary px-1 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                          onClick={() => setExpandedDays((current) => {
                            const next = new Set(current);
                            next.delete(day!);
                            return next;
                          })}
                          aria-expanded
                          aria-controls={recordsId}
                        >
                          Show less
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {!hasItems && (
        <p className="text-center text-sm text-muted-foreground py-4">
          {t("viewModes.noItemsInMonth", { month: MONTHS[month], year })}
        </p>
      )}

      {items.length === 0 && (
        <div className="py-8 text-center">{empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}</div>
      )}
    </div>
  );
}
