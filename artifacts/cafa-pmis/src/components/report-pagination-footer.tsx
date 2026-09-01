import { Button } from "@/components/ui/button";

type ReportPaginationFooterProps = {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  /** Localised type label for the result-count sentence (e.g. "Reports"). */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  className: string;
  /** The `reports` namespace `t` from the calling page — kept as a prop
   *  rather than its own useTranslation call so every view mode shares
   *  exactly one translation lookup for these keys. */
  t: (key: string, opts?: Record<string, unknown>) => string;
};

/**
 * §21–22: Result count — always visible; pagination controls appear only
 * when there is more than one page. Previously this exact block (result
 * count + prev/next buttons) was hand-duplicated across all four Reports
 * view modes (Table/Card/List/Compact); Kanban has no pagination footer.
 */
export function ReportPaginationFooter({
  total,
  totalPages,
  page,
  pageSize,
  label,
  onPrev,
  onNext,
  className,
  t,
}: ReportPaginationFooterProps) {
  return (
    <div className={className}>
      <span className="tabular-nums">
        {totalPages > 1
          ? t("pagination.showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total, type: label })
          : t("pagination.totalCount", { total, type: label })}
      </span>
      {totalPages > 1 && (
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPrev}>
            {t("pagination.previous")}
          </Button>
          <span className="text-xs">{t("pagination.pageOf", { page, total: totalPages })}</span>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={onNext}>
            {t("pagination.next")}
          </Button>
        </div>
      )}
    </div>
  );
}
