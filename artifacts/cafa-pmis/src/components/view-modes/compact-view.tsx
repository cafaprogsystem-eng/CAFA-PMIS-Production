import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Chip } from "@heroui/react";
import { ListView as ProListView } from "@heroui-pro/react/list-view";
import { BidiIsolate } from "@/components/bidi-isolate";
import { RecordActions, openRow, useOpenRecordLabel } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";

interface CompactViewProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

/** Dense one-line records: HeroUI Pro ListView, secondary variant. */
export function CompactView({ items, empty }: CompactViewProps) {
  const { t } = useTranslation("common");
  const openLabel = useOpenRecordLabel();
  const ref = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return <div className="py-12 text-center">{empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}</div>;
  }

  return (
    <div ref={ref}>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--muted)]" aria-hidden="true">
        <span className="w-28 shrink-0">{t("viewModes.code")}</span>
        <span className="flex-1">{t("viewModes.title")}</span>
        <span className="hidden w-24 text-end sm:inline">{t("viewModes.status")}</span>
      </div>
      <ProListView
        aria-label={t("viewModes.compact")}
        variant="secondary"
        items={items}
        onAction={(key) => openRow(ref.current, items, key)}
      >
        {(item) => (
          <ProListView.Item
            id={item.id}
            textValue={item.title}
            aria-label={item.onClick ? openLabel(item) : item.title}
            className="py-1.5"
          >
            <ProListView.ItemContent className="gap-2 text-sm">
              {item.code && (
                <span className="w-28 shrink-0 truncate font-mono text-xs text-[var(--muted)]"><BidiIsolate>{item.code}</BidiIsolate></span>
              )}
              <ProListView.Title className="flex-1" dir="auto" title={item.title}>{item.title}</ProListView.Title>
              {item.tag && <Chip size="sm" variant="secondary" className="hidden shrink-0 sm:inline-flex">{item.tag}</Chip>}
              {item.meta?.slice(0, 1).map(({ value }) => (
                <span key={value} dir="auto" className="hidden shrink-0 text-xs text-[var(--muted)] md:inline">{value}</span>
              ))}
              {item.date && (
                <span className="hidden shrink-0 text-xs text-[var(--muted)] sm:inline"><bdi dir="ltr">{item.date}</bdi></span>
              )}
            </ProListView.ItemContent>
            <ProListView.ItemAction className="flex items-center gap-2">
              {item.statusBadge}
              {item.actions && <RecordActions>{item.actions}</RecordActions>}
            </ProListView.ItemAction>
          </ProListView.Item>
        )}
      </ProListView>
    </div>
  );
}
