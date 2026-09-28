import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button, Tooltip } from "@heroui/react";
import { ChevronLeft, ChevronRight } from "@/components/icons";
import { RecordActions, useOpenRecordLabel } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";

interface CalendarGridProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

/*
 * Month calendar of records by date. Kept as a HeroUI-built grid rather than
 * the Pro Agenda: every record here carries its own actions (Continue Editing,
 * the actions menu), which Agenda events cannot hold.
 */

const PENDING_STATUSES = new Set(["draft","submitted","in_progress","pending",
  "technically_approved","coordination_approved","submitted_for_review","under_review"]);
const DONE_STATUSES    = new Set(["completed","approved","closed","published","active","archived"]);

type Tone = "overdue" | "today" | "pending" | "completed" | "scheduled";

/** Theme token per legend tone (used for the day badge and legend dot). */
const TONE_BG: Record<Tone, string> = {
  overdue: "bg-[var(--danger)] text-[var(--danger-foreground)]",
  today: "bg-[var(--foreground)] text-[var(--background)]",
  pending: "bg-[var(--warning)] text-[var(--warning-foreground)]",
  completed: "bg-[var(--success)] text-[var(--success-foreground)]",
  scheduled: "bg-[var(--accent)] text-[var(--accent-foreground)]",
};

function parseDate(d: string | null | undefined): Date | null {
  if (!d) return null;
  const parsed = new Date(d);
  return isNaN(parsed.getTime()) ? null : parsed;
}

/** Tone of a day that has records: past (overdue) > today > pending > all done > scheduled. */
function dayTone(cellDate: Date, today: Date, isToday: boolean, items: ViewRecord[]): Tone {
  const todayMidnight = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  if (cellDate < todayMidnight) return "overdue";
  if (isToday) return "today";
  const statuses = items.map(i => i.status ?? "").filter(Boolean);
  if (statuses.some(s => PENDING_STATUSES.has(s))) return "pending";
  if (statuses.length > 0 && statuses.every(s => DONE_STATUSES.has(s))) return "completed";
  return "scheduled";
}

function entryClass(status: string) {
  if (PENDING_STATUSES.has(status)) return "bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-[var(--foreground)] border-[color-mix(in_oklab,var(--warning)_35%,transparent)]";
  if (DONE_STATUSES.has(status)) return "bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--foreground)] border-[color-mix(in_oklab,var(--success)_35%,transparent)]";
  return "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--foreground)] border-[color-mix(in_oklab,var(--accent)_30%,transparent)]";
}

export function CalendarGrid({ items, empty }: CalendarGridProps) {
  const { t, i18n } = useTranslation("common");
  const openLabel = useOpenRecordLabel();
  const locale = i18n?.resolvedLanguage ?? i18n?.language ?? "en";
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [expandedDays, setExpandedDays] = useState<Set<number>>(() => new Set());

  const monthLabel = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(year, month, 1));
  const monthName = new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(year, month, 1));
  // 2023-01-01 was a Sunday: weekday names Sun → Sat in the active language.
  const dayNames = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(locale, { weekday: "short" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2023, 0, 1 + i)));
  }, [locale]);

  const prevMonth = () => {
    setExpandedDays(new Set());
    if (month === 0) { setYear(y => y - 1); setMonth(11); } else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    setExpandedDays(new Set());
    if (month === 11) { setYear(y => y + 1); setMonth(0); } else setMonth(m => m + 1);
  };

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

  const hasItems = itemsByDay.size > 0;
  const legend: Tone[] = ["overdue", "today", "pending", "completed", "scheduled"];

  return (
    <div className="space-y-3">
      {/* Navigation — arrows follow reading direction */}
      <div className="flex items-center justify-between">
        <Button isIconOnly size="sm" variant="secondary" aria-label={t("viewModes.previousMonth")} onPress={prevMonth}>
          <ChevronLeft className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
        <h3 className="text-sm font-semibold" aria-live="polite">{monthLabel}</h3>
        <Button isIconOnly size="sm" variant="secondary" aria-label={t("viewModes.nextMonth")} onPress={nextMonth}>
          <ChevronRight className="size-4 rtl:rotate-180" aria-hidden="true" />
        </Button>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-4 px-1">
        {legend.map((tone) => (
          <span key={tone} className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className={`inline-block size-2.5 rounded-full ${TONE_BG[tone].split(" ")[0]}`} aria-hidden="true" />
            {t(`viewModes.legend.${tone}`)}
          </span>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-[var(--border)]">
        <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--default)]">
          {dayNames.map((d) => (
            <div key={d} className="py-2 text-center text-xs font-semibold text-[var(--muted)]">{d}</div>
          ))}
        </div>

        <div className="grid grid-cols-7">
          {cells.map((day, i) => {
            const isToday   = day === today.getDate() && month === today.getMonth() && year === today.getFullYear();
            const dayItems  = day ? (itemsByDay.get(day) ?? []) : [];
            const cellDate  = day ? new Date(year, month, day) : null;
            const tone      = cellDate && dayItems.length ? dayTone(cellDate, today, isToday, dayItems) : null;
            const expanded  = day ? expandedDays.has(day) : false;
            const visibleItems = expanded ? dayItems : dayItems.slice(0, 3);
            const overflowCount = Math.max(0, dayItems.length - visibleItems.length);
            const recordsId = day ? `calendar-day-${year}-${month}-${day}` : undefined;
            const numberClass = tone
              ? TONE_BG[tone]
              : isToday ? TONE_BG.scheduled : "text-[var(--muted)]";

            return (
              <div
                key={i}
                className={`min-h-[84px] border-b border-e border-[var(--border)] p-1.5 sm:min-h-[96px] [&:nth-child(7n)]:border-e-0 ${!day ? "bg-[color-mix(in_oklab,var(--default)_50%,transparent)]" : ""}`}
              >
                {day && (
                  <>
                    <div className="mb-1 flex items-center justify-start">
                      {tone ? (
                        <Tooltip delay={300}>
                          <Tooltip.Trigger className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-semibold ${numberClass}`}>
                            {day}
                          </Tooltip.Trigger>
                          <Tooltip.Content>{t("viewModes.scheduledItems", { count: dayItems.length })}</Tooltip.Content>
                        </Tooltip>
                      ) : (
                        <span className={`inline-flex size-6 items-center justify-center rounded-full text-xs font-medium ${numberClass}`}>{day}</span>
                      )}
                    </div>

                    <div id={recordsId} className="space-y-0.5">
                      {visibleItems.map(item => {
                        const cls = entryClass(item.status ?? "");
                        return (
                          <div key={item.id} className="flex items-start gap-0.5">
                            {item.onClick ? (
                              <button
                                type="button"
                                dir="auto"
                                className={`min-w-0 flex-1 truncate rounded-md border px-1 py-0.5 text-start text-xs leading-tight outline-none transition-opacity hover:opacity-80 focus-visible:ring-2 focus-visible:ring-[var(--focus)] ${cls}`}
                                onClick={(event) => item.onClick?.(event.currentTarget)}
                                title={item.title}
                                aria-label={openLabel(item)}
                              >
                                {item.title}
                              </button>
                            ) : (
                              <span dir="auto" className={`min-w-0 flex-1 truncate rounded-md border px-1 py-0.5 text-xs leading-tight ${cls}`} title={item.title}>
                                {item.title}
                              </span>
                            )}
                            {item.actions && <RecordActions className="shrink-0">{item.actions}</RecordActions>}
                          </div>
                        );
                      })}
                      {overflowCount > 0 && (
                        <button
                          type="button"
                          className="w-full rounded px-1 text-start text-xs text-[var(--accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                          onClick={() => setExpandedDays((current) => new Set(current).add(day))}
                          aria-expanded={false}
                          aria-controls={recordsId}
                        >
                          {t("viewModes.moreItems", { count: overflowCount })}
                        </button>
                      )}
                      {expanded && dayItems.length > 3 && (
                        <button
                          type="button"
                          className="w-full rounded px-1 text-start text-xs text-[var(--accent)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                          onClick={() => setExpandedDays((current) => {
                            const next = new Set(current);
                            next.delete(day);
                            return next;
                          })}
                          aria-expanded
                          aria-controls={recordsId}
                        >
                          {t("viewModes.showLess")}
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
        <p className="py-4 text-center text-sm text-[var(--muted)]">
          {t("viewModes.noItemsInMonth", { month: monthName, year })}
        </p>
      )}

      {items.length === 0 && (
        <div className="py-8 text-center">{empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}</div>
      )}
    </div>
  );
}
