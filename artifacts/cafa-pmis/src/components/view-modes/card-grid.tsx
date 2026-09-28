import { useTranslation } from "react-i18next";
import { Card, Chip, ProgressBar } from "@heroui/react";
import { Calendar, MapPin, ArrowRight } from "@/components/icons";
import { BidiIsolate } from "@/components/bidi-isolate";
import { RecordActions, useOpenRecordLabel, useStateNames } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";

interface CardGridProps {
  items: ViewRecord[];
  empty?: React.ReactNode;
}

function RecordCard({ item }: { item: ViewRecord }) {
  const { t } = useTranslation("common");
  const openLabel = useOpenRecordLabel();
  const stateNames = useStateNames();
  const pct =
    item.progress && item.progress.max > 0
      ? Math.min(100, Math.round((item.progress.value / item.progress.max) * 100))
      : null;
  const pctColor = pct === null ? "accent" : pct >= 90 ? "danger" : pct >= 70 ? "warning" : "accent";
  const states = stateNames(item);

  return (
    <Card className={`group relative gap-0 p-4 transition-shadow ${item.onClick ? "hover:shadow-md" : ""}`}>
      {/* The whole card opens the record; content sits above this button and
          lets clicks through, except the record's own actions. */}
      {item.onClick && (
        <button
          type="button"
          className="absolute inset-0 z-0 rounded-[inherit] outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
          aria-label={openLabel(item)}
          onClick={(event) => item.onClick?.(event.currentTarget)}
        />
      )}
      <div className="pointer-events-none relative z-10 flex flex-1 flex-col">
        {/* Title · code · status */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 dir="auto" className="text-[15px] font-medium leading-snug break-words line-clamp-3 rtl:text-end transition-colors group-hover:text-[var(--accent)]" title={item.title}>
              {item.title}
            </h3>
            {item.code && (
              <p className="mt-1 truncate font-mono text-[11px] tracking-wide text-[var(--muted)]">
                <BidiIsolate>{item.code}</BidiIsolate>
              </p>
            )}
          </div>
          <div className="shrink-0 pt-0.5">{item.statusBadge}</div>
        </div>

        {item.tag && (
          <div className="mt-3">
            <Chip size="sm" variant="secondary">{item.tag}</Chip>
          </div>
        )}

        {item.meta && item.meta.length > 0 && (
          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
            {item.meta.slice(0, 4).map(({ label, value }) => (
              <div key={label} className="min-w-0">
                <dt className="mb-0.5 text-[11px] text-[var(--muted)]">{label}</dt>
                <dd dir="auto" className="text-[13px] font-medium leading-snug break-words line-clamp-2 rtl:text-end" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        )}

        {pct !== null && item.progress && (
          <ProgressBar
            aria-label={item.progress.label ?? t("viewModes.progress")}
            value={pct}
            color={pctColor}
            size="sm"
            className="mt-4 gap-1.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--muted)]">{item.progress.label ?? t("viewModes.progress")}</span>
              <span className="font-semibold tabular-nums"><bdi dir="ltr">{pct}%</bdi></span>
            </div>
            <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
          </ProgressBar>
        )}

        {/* Footer: location · date · actions or open arrow */}
        <div className="min-h-4 flex-1" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--border)] pt-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted)]">
            {states && (
              <span className="flex min-w-0 items-center gap-1">
                <MapPin className="size-3 shrink-0" aria-hidden="true" />
                <span className="truncate">{states}</span>
              </span>
            )}
            {item.date && (
              <span className="flex shrink-0 items-center gap-1">
                <Calendar className="size-3" aria-hidden="true" />
                <bdi dir="ltr">{item.date}</bdi>
              </span>
            )}
          </div>
          {item.actions ? (
            <RecordActions className="pointer-events-auto">{item.actions}</RecordActions>
          ) : item.onClick ? (
            <ArrowRight className="size-3.5 shrink-0 text-[var(--muted)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--accent)] rtl:rotate-180 rtl:group-hover:-translate-x-0.5" aria-hidden="true" />
          ) : null}
        </div>
      </div>
    </Card>
  );
}

export function CardGrid({ items, empty }: CardGridProps) {
  const { t } = useTranslation("common");
  if (items.length === 0) {
    return (
      <div className="py-10 text-center">
        {empty ?? <p className="text-sm text-[var(--muted)]">{t("viewModes.noRecordsFound")}</p>}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <RecordCard key={item.id} item={item} />
      ))}
    </div>
  );
}
