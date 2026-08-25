import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Calendar, MapPin } from "lucide-react";
import { BidiIsolate } from "@/components/bidi-isolate";
import { getStateLabel } from "@/components/state-label";
import type { ViewRecord } from "@/lib/view-modes";

export interface KanbanColumn {
  key: string;
  label: string;
  color: string;
}

interface KanbanBoardProps {
  items: ViewRecord[];
  columns: KanbanColumn[];
  empty?: React.ReactNode;
  statusKey?: string;
  /** Keep unknown legacy statuses out of authoritative boards instead of
   * silently assigning them to the first column. Existing boards retain the
   * historical fallback unless they opt into omission. */
  unknownStatusBehavior?: "first" | "omit";
  /** Show every supplied status column even when it has no records. */
  showEmptyColumns?: boolean;
}

function KanbanCard({ item }: { item: ViewRecord }) {
  const { i18n } = useTranslation();
  return (
    <div
      className={`relative bg-background rounded-lg border border-border p-3 shadow-sm transition-shadow ${item.onClick ? "cursor-pointer hover:shadow" : ""}`}
    >
      {item.onClick && (
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={item.ariaLabel ?? `View ${item.title}`}
          onClick={(event) => item.onClick?.(event.currentTarget)}
        />
      )}
      <div className="relative z-10 pointer-events-none space-y-2">
        {item.code && <p className="text-xs font-mono text-muted-foreground truncate"><BidiIsolate>{item.code}</BidiIsolate></p>}
        <p className="text-xs font-semibold leading-snug line-clamp-2">{item.title}</p>
        {item.tag && (
          <Badge variant="outline" className="text-xs px-1.5 py-0 h-4">{item.tag}</Badge>
        )}
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {item.meta?.slice(0, 2).map(({ label, value }) => (
            <span key={label} className="text-xs text-muted-foreground">
              {label}: <span className="font-medium">{value}</span>
            </span>
          ))}
        </div>
        {/* Per-item action slot (e.g. Continue Editing for draft plans) */}
        {item.actions ? <div className="pointer-events-auto">{item.actions}</div> : null}
        {(item.stateNames?.length || item.date) ? (
          <div className="flex items-center gap-2 pt-1 border-t border-border/50">
            {item.stateNames && item.stateNames.length > 0 && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <MapPin className="h-2.5 w-2.5" />
                {getStateLabel({ name: item.stateNames[0], nameAr: item.stateNamesAr?.[0] }, i18n?.language)}{item.stateNames.length > 1 ? ` +${item.stateNames.length - 1}` : ""}
              </span>
            )}
            {item.date && (
              <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                <Calendar className="h-2.5 w-2.5" />
                {item.date}
              </span>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function KanbanBoard({
  items,
  columns,
  empty,
  unknownStatusBehavior = "first",
  showEmptyColumns = false,
}: KanbanBoardProps) {
  const { t } = useTranslation("common");
  if (items.length === 0) {
    return <div className="py-10 text-center">{empty ?? <p className="text-sm text-muted-foreground">{t("viewModes.noRecordsFound")}</p>}</div>;
  }

  const grouped = new Map<string, ViewRecord[]>();
  for (const col of columns) grouped.set(col.key, []);
  for (const item of items) {
    const status = item.status ?? "";
    if (grouped.has(status)) {
      grouped.get(status)!.push(item);
    } else if (unknownStatusBehavior === "first") {
      // Put unknown statuses in first column
      const first = columns[0]?.key;
      if (first) grouped.get(first)!.push(item);
    }
  }

  const visibleCols = showEmptyColumns
    ? columns
    : columns.filter((col) => (grouped.get(col.key)?.length ?? 0) > 0);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4 min-h-[280px] scroll-smooth" style={{ WebkitOverflowScrolling: "touch" }}>
      {visibleCols.map((col) => {
        const colItems = grouped.get(col.key) ?? [];
        return (
          <div key={col.key} className="flex-shrink-0 w-[clamp(260px,30vw,340px)] flex flex-col gap-2">
            {/* Column header */}
            <div className={`rounded-lg px-3 py-2 flex items-center justify-between ${col.color}`}>
              <span className="text-xs font-semibold">{col.label}</span>
              <Badge variant="secondary" className="h-4 text-xs px-1.5">{colItems.length}</Badge>
            </div>
            {/* Cards */}
            <div className="space-y-2 flex-1">
              {colItems.map((item) => (
                <KanbanCard key={item.id} item={item} />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
