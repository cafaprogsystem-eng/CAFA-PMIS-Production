import { RegistryPagination } from "@/components/registry-pagination";

type ReportPaginationFooterProps = {
  total: number;
  totalPages: number;
  page: number;
  pageSize: number;
  /** Localised type label for the result-count sentence (e.g. "Reports"). */
  label: string;
  onPrev: () => void;
  onNext: () => void;
  /** Jump to a page (first/last); falls back to stepping when omitted. */
  onPageChange?: (page: number) => void;
  className: string;
  /** The `reports` namespace `t` from the calling page — kept as a prop
   *  rather than its own useTranslation call so every view mode shares
   *  exactly one translation lookup for these keys. */
  t: (key: string, opts?: Record<string, unknown>) => string;
};

/**
 * §21–22: Result count — always visible; page controls appear only when
 * there is more than one page. Shared by the Table/Card/List/Compact views
 * (Kanban has no pagination footer) on the HeroUI registry pagination.
 */
export function ReportPaginationFooter({
  total,
  totalPages,
  page,
  pageSize,
  label,
  onPrev,
  onNext,
  onPageChange,
  className,
  t,
}: ReportPaginationFooterProps) {
  const summary = totalPages > 1
    ? t("pagination.showing", { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total, type: label })
    : t("pagination.totalCount", { total, type: label });
  if (totalPages <= 1) {
    return <div className={className}><span className="tabular-nums text-xs text-[var(--muted)]" aria-live="polite">{summary}</span></div>;
  }
  const go = (next: number) => {
    if (onPageChange) onPageChange(next);
    else if (next < page) onPrev();
    else if (next > page) onNext();
  };
  return (
    <div className={className}>
      <RegistryPagination
        page={page}
        totalPages={totalPages}
        onPageChange={go}
        summary={summary}
        labels={{
          region: t("pagination.region"),
          first: t("pagination.first"),
          previous: t("pagination.previous"),
          next: t("pagination.next"),
          last: t("pagination.last"),
          pageOf: t("pagination.pageOf", { page, total: totalPages }),
        }}
      />
    </div>
  );
}
