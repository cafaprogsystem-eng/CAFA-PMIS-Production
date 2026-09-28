import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { Chip, ProgressBar } from "@heroui/react";
import { ListView as ProListView } from "@heroui-pro/react/list-view";
import { Calendar, MapPin, ChevronRight } from "@/components/icons";
import { BidiIsolate } from "@/components/bidi-isolate";
import { RecordActions, openRow, useOpenRecordLabel, useStateNames } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";

interface ListViewProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

/** Records as a HeroUI Pro ListView (primary variant). Each row opens its record. */
export function ListView({ items, empty }: ListViewProps) {
  const { t } = useTranslation("common");
  const openLabel = useOpenRecordLabel();
  const stateNames = useStateNames();
  const ref = useRef<HTMLDivElement>(null);

  if (items.length === 0) {
    return <div className="py-16 text-center">{empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}</div>;
  }

  return (
    <div ref={ref}>
      <ProListView
        aria-label={t("viewModes.list")}
        items={items}
        onAction={(key) => openRow(ref.current, items, key)}
      >
        {(item) => {
          const pct = item.progress && item.progress.max > 0
            ? Math.min(100, Math.round((item.progress.value / item.progress.max) * 100))
            : null;
          const states = stateNames(item);
          return (
            <ProListView.Item id={item.id} textValue={item.title} aria-label={item.onClick ? openLabel(item) : item.title}>
              <ProListView.ItemContent className="items-start">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {item.code && <span className="font-mono text-xs text-[var(--muted)]"><BidiIsolate>{item.code}</BidiIsolate></span>}
                    <ProListView.Title className="whitespace-normal break-words" dir="auto">{item.title}</ProListView.Title>
                    {item.tag && <Chip size="sm" variant="secondary">{item.tag}</Chip>}
                  </div>
                  {item.subtitle && <p className="text-xs text-[var(--muted)]" dir="auto">{item.subtitle}</p>}
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--muted)]">
                    {item.meta?.slice(0, 3).map(({ label, value }) => (
                      <span key={label}>
                        {label}: <span className="font-medium text-[var(--foreground)]" dir="auto">{value}</span>
                      </span>
                    ))}
                    {states && (
                      <span className="flex items-center gap-1"><MapPin className="size-3" aria-hidden="true" />{states}</span>
                    )}
                    {item.date && (
                      <span className="flex items-center gap-1"><Calendar className="size-3" aria-hidden="true" /><bdi dir="ltr">{item.date}</bdi></span>
                    )}
                  </div>
                </div>
              </ProListView.ItemContent>
              <ProListView.ItemAction className="flex items-center gap-3">
                {pct !== null && (
                  <span className="hidden items-center gap-2 sm:flex">
                    <ProgressBar aria-label={item.progress?.label ?? t("viewModes.progress")} value={pct} size="sm" className="w-20">
                      <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                    </ProgressBar>
                    <span className="w-9 text-xs tabular-nums text-[var(--muted)]"><bdi dir="ltr">{pct}%</bdi></span>
                  </span>
                )}
                {item.statusBadge}
                {item.actions && <RecordActions>{item.actions}</RecordActions>}
                {item.onClick && <ChevronRight className="size-4 text-[var(--muted)] rtl:rotate-180" aria-hidden="true" />}
              </ProListView.ItemAction>
            </ProListView.Item>
          );
        }}
      </ProListView>
    </div>
  );
}
