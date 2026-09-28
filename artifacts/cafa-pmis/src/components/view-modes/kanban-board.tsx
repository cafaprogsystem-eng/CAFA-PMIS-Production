import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "@heroui/react";
import { Kanban } from "@heroui-pro/react/kanban";
import { Calendar, MapPin } from "@/components/icons";
import { BidiIsolate } from "@/components/bidi-isolate";
import { RecordActions, openRow, statusTone, useOpenRecordLabel, useStateNames } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";

export interface KanbanColumn {
  key: string;
  label: string;
  /** @deprecated Column colour now follows the status (shared tone map); kept so callers still compile. */
  color?: string;
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

const TONE_DOT = {
  default: "bg-[var(--muted)]",
  accent: "bg-[var(--accent)]",
  success: "bg-[var(--success)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
} as const;

function RecordCardBody({ item }: { item: ViewRecord }) {
  const stateNames = useStateNames();
  const states = stateNames(item, 1);
  return (
    <>
      {item.code && <span className="truncate font-mono text-xs text-[var(--muted)]"><BidiIsolate>{item.code}</BidiIsolate></span>}
      <span dir="auto" className="font-semibold leading-snug break-words text-page-start">{item.title}</span>
      {item.tag && <span><Chip size="sm" variant="secondary">{item.tag}</Chip></span>}
      {item.meta && item.meta.length > 0 && (
        <span className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--muted)]">
          {item.meta.slice(0, 2).map(({ label, value }) => (
            <span key={label}>{label}: <span className="font-medium text-[var(--foreground)]" dir="auto">{value}</span></span>
          ))}
        </span>
      )}
      {item.actions && <RecordActions>{item.actions}</RecordActions>}
      {(states || item.date) && (
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-[var(--border)] pt-2 text-xs text-[var(--muted)]">
          {states && <span className="flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{states}</span>}
          {item.date && <span className="flex items-center gap-1"><Calendar className="size-3" aria-hidden="true" /><bdi dir="ltr">{item.date}</bdi></span>}
        </span>
      )}
    </>
  );
}

/**
 * Read-only status board on the HeroUI Pro Kanban (as in its "Project Board"
 * example, without drag and drop — status changes go through the workflow).
 * Pressing a card opens its record.
 */
export function KanbanBoard({
  items,
  columns,
  empty,
  unknownStatusBehavior = "first",
  showEmptyColumns = false,
}: KanbanBoardProps) {
  const { t } = useTranslation("common");
  const openLabel = useOpenRecordLabel();
  const ref = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return <div className="py-10 text-center">{empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}</div>;
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
    <div ref={ref} className="min-h-[280px]">
      <Kanban className="items-start">
        {visibleCols.map((col) => {
          const colItems = grouped.get(col.key) ?? [];
          return (
            <Kanban.Column key={col.key}>
              <Kanban.ColumnHeader>
                <Kanban.ColumnIndicator className={TONE_DOT[statusTone(col.key)]} />
                <Kanban.ColumnTitle>{col.label}</Kanban.ColumnTitle>
                <Kanban.ColumnCount>{colItems.length}</Kanban.ColumnCount>
              </Kanban.ColumnHeader>
              <Kanban.ColumnBody>
                <Kanban.CardList
                  aria-label={col.label}
                  items={colItems}
                  onAction={(key) => openRow(ref.current, items, key)}
                  renderEmptyState={() => t("viewModes.noRecordsFound")}
                >
                  {(item) => (
                    <Kanban.Card id={item.id} textValue={item.title} aria-label={item.onClick ? openLabel(item) : item.title}>
                      <RecordCardBody item={item} />
                    </Kanban.Card>
                  )}
                </Kanban.CardList>
              </Kanban.ColumnBody>
            </Kanban.Column>
          );
        })}
      </Kanban>
    </div>
  );
}
