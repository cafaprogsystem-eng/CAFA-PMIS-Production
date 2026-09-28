import { Pagination } from "@heroui/react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "@/components/icons";
import { SelectField } from "@/components/select-field";

/**
 * Registry footer on the HeroUI Pagination: a summary, rows-per-page, and
 * first / previous / "page of" / next / last. Arrows follow reading direction.
 * Labels come from the caller's namespace.
 */
export function RegistryPagination({
  page,
  totalPages,
  onPageChange,
  summary,
  pageSize,
  pageSizes,
  onPageSizeChange,
  labels,
  className = "",
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  summary: string;
  pageSize?: number;
  pageSizes?: readonly number[];
  onPageSizeChange?: (size: number) => void;
  labels: {
    region?: string;
    rowsPerPage?: string;
    first: string;
    previous: string;
    next: string;
    last: string;
    pageOf: string;
  };
  className?: string;
}) {
  const atStart = page <= 1;
  const atEnd = page >= totalPages;
  return (
    <Pagination size="sm" className={`w-full flex-wrap gap-3 ${className}`} aria-label={labels.region}>
      <Pagination.Summary aria-live="polite" className="text-xs text-[var(--muted)]">{summary}</Pagination.Summary>
      <div className="flex flex-wrap items-center gap-3">
        {pageSizes && onPageSizeChange && pageSize != null && (
          <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]">
            <span className="hidden sm:inline" aria-hidden="true">{labels.rowsPerPage}</span>
            <SelectField
              aria-label={labels.rowsPerPage}
              value={String(pageSize)}
              onChange={(v) => onPageSizeChange(Number(v))}
              triggerClassName="h-8 min-w-[4.5rem]"
              options={pageSizes.map((n) => ({ value: String(n), label: String(n) }))}
            />
          </div>
        )}
        <Pagination.Content>
          <Pagination.Item>
            <Pagination.Link isDisabled={atStart} onPress={() => onPageChange(1)} aria-label={labels.first}>
              <ChevronsLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Pagination.Link>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Previous isDisabled={atStart} onPress={() => onPageChange(page - 1)} aria-label={labels.previous}>
              <ChevronLeft className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Pagination.Previous>
          </Pagination.Item>
          <Pagination.Item>
            <span className="px-2 text-xs tabular-nums text-[var(--muted)]"><bdi dir="ltr">{labels.pageOf}</bdi></span>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Next isDisabled={atEnd} onPress={() => onPageChange(page + 1)} aria-label={labels.next}>
              <ChevronRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Pagination.Next>
          </Pagination.Item>
          <Pagination.Item>
            <Pagination.Link isDisabled={atEnd} onPress={() => onPageChange(totalPages)} aria-label={labels.last}>
              <ChevronsRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
            </Pagination.Link>
          </Pagination.Item>
        </Pagination.Content>
      </div>
    </Pagination>
  );
}
