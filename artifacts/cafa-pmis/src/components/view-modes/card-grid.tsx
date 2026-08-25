import { useTranslation } from "react-i18next";
import { Calendar, MapPin, ArrowRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { BidiIsolate } from "@/components/bidi-isolate";
import type { ViewRecord } from "@/lib/view-modes";

interface CardGridProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

/** Wraps a truncated metadata value in a tooltip showing the full text. */
function MetaValue({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className="text-[13px] font-medium truncate leading-snug">{value}</p>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-[240px] text-xs leading-normal break-words">
        {value}
      </TooltipContent>
    </Tooltip>
  );
}

function RecordCard({ item }: { item: ViewRecord }) {
  const { i18n } = useTranslation();
  const budgetPct =
    item.progress && item.progress.max > 0
      ? Math.min(100, Math.round((item.progress.value / item.progress.max) * 100))
      : null;

  return (
    <Card
      className={`group relative flex flex-col transition-all duration-150 ${item.onClick ? "cursor-pointer hover:shadow-sm hover:ring-1 hover:ring-border/60 hover:border-primary/20" : ""}`}
    >
      {item.onClick && (
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={item.ariaLabel ?? `View ${item.title}`}
          onClick={(event) => item.onClick?.(event.currentTarget)}
        />
      )}
      {/* 16px internal padding per spec */}
      <CardContent className="relative z-10 pointer-events-none p-4 flex flex-col flex-1">

        {/* ── 1. Title (primary) · 2. Code (secondary) · 3. Status badge (top-right) ── */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            {/* Title: 15px medium, max 2 lines, tooltip on truncation */}
            <Tooltip>
              <TooltipTrigger asChild>
                <h3 className="text-[15px] font-medium leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-150">
                  {item.title}
                </h3>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[280px] text-xs leading-normal break-words">
                {item.title}
              </TooltipContent>
            </Tooltip>
            {item.code && (
              <p className="text-[11px] font-mono text-muted-foreground truncate tracking-wide mt-1">
                <BidiIsolate>{item.code}</BidiIsolate>
              </p>
            )}
          </div>
          {/* Status badge only — actions moved to footer */}
          <div className="shrink-0 pt-0.5">
            {item.statusBadge}
          </div>
        </div>

        {/* ── 4. Sector tag — 10–12px gap below title area ── */}
        {item.tag && (
          <div className="mt-[11px]">
            <Badge
              variant="outline"
              className="text-xs px-2 py-0.5 font-normal text-muted-foreground border-border/60"
            >
              {item.tag}
            </Badge>
          </div>
        )}

        {/* ── 5–8. Metadata grid — 16px gap, 12px between rows ── */}
        {item.meta && item.meta.length > 0 && (
          <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {item.meta.slice(0, 4).map(({ label, value }) => (
              <div key={label} className="min-w-0">
                {/* 10px uppercase label with medium tracking */}
                <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5 leading-none">
                  {label}
                </p>
                <MetaValue value={value} />
              </div>
            ))}
          </div>
        )}

        {/* ── 9. Budget Spent progress — 16px gap above ── */}
        {budgetPct !== null && item.progress && (
          <div className="mt-4 space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{item.progress.label ?? "Progress"}</span>
              <span
                className={`font-semibold tabular-nums ${
                  budgetPct >= 90
                    ? "text-destructive"
                    : budgetPct >= 70
                    ? "text-warning"
                    : "text-foreground"
                }`}
              >
                <bdi dir="ltr">{budgetPct}%</bdi>
              </span>
            </div>
            <div className="h-1.5 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${
                  budgetPct >= 90
                    ? "bg-destructive/80"
                    : budgetPct >= 70
                    ? "bg-warning/80"
                    : "bg-primary/70"
                }`}
                style={{ width: `${budgetPct}%` }}
              />
            </div>
          </div>
        )}

        {/* ── 10. Footer: Location · End date (left) · Actions or arrow (right) ── */}
        <div className="mt-auto pt-3 border-t border-border/50 flex items-center justify-between gap-2">
          {/* Left: location + date */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            {item.stateNames && item.stateNames.length > 0 && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground min-w-0">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">
                  {(i18n.language.startsWith("ar") && item.stateNamesAr?.length === item.stateNames.length
                    ? item.stateNamesAr
                    : item.stateNames).slice(0, 2).join(", ")}
                  {item.stateNames.length > 2 ? ` +${item.stateNames.length - 2}` : ""}
                </span>
              </div>
            )}
            {item.date && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                <Calendar className="h-3 w-3" />
                <bdi dir="ltr">{item.date}</bdi>
              </div>
            )}
          </div>
          {/* Right: draft action button, or arrow affordance for non-draft cards */}
          {item.actions ? <div className="pointer-events-auto">{item.actions}</div> : (
            item.onClick ? (
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5 rtl:rotate-180 transition-all duration-150 shrink-0" />
            ) : null
          )}
        </div>

      </CardContent>
    </Card>
  );
}

export function CardGrid({ items, empty }: CardGridProps) {
  const { t } = useTranslation("common");
  if (items.length === 0) {
    return (
      <div className="py-10 text-center">
        {empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <RecordCard key={item.id} item={item} />
      ))}
    </div>
  );
}
