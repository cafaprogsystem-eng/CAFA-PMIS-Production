import { useState, useMemo, useEffect, useCallback } from "react";
import { useLocationContext } from "@/contexts/location-context";
import { useTranslation } from "react-i18next";
import { StateLabel, getLinkedStateLabel } from "@/components/state-label";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { Link, useLocation } from "wouter";
import {
  useListPlans,
  useListStates,
  useGetMe,
  useGetPlanningDashboard,
} from "@workspace/api-client-react";
import { CreatePlanRegistrationDialog } from "@/components/create-plan-registration-dialog";
import type {
  PlanningDashboardTotals,
  PlanningDashboardUpcomingDeadlinesItem,
  PlanningDashboardDelayedActivitiesItem,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/ui/stat-card";
import React from "react";
import {
  CalendarClock,
  Plus,
  Activity,
  CheckCircle2,
  Filter,
  Search,
  X,
  FileText,
  Clock,
  ChevronUp,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
} from "lucide-react";
import { formatDate, formatStatusLabel, formatPlanType, hasPerm, statusBadgeVariant, formatLocation } from "@/lib/format";
import { AttachmentCountBadge } from "@/components/drive-attachment-panel";
import { useViewMode } from "@/lib/view-modes";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { ListView } from "@/components/view-modes/list-view";
import { CompactView } from "@/components/view-modes/compact-view";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { CalendarGrid } from "@/components/view-modes/calendar-grid";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { ContinueEditingAction } from "@/components/continue-editing-action";

/* ── Module-scope constants ────────────────────────────────────────────── */

const PLAN_TYPE_VALUES = [
  "monthly",
  "quarterly",
  "annual",
  "action",
  "operational",
  "emergency",
  "custom",
] as const;

const STATUSES = [
  "draft",
  "submitted",
  "technically_approved",
  "coordination_approved",
  "approved",
  "active",
  "in_progress",
  "delayed",
  "completed",
  "cancelled",
  "archived",
  "rejected",
] as const;

/**
 * These aggregate filters are registry views, not workflow statuses. They
 * intentionally remain client-side so the API's lifecycle status meaning is
 * unchanged while the KPI and toolbar share one filter state.
 */
const AWAITING_APPROVAL_STATUSES = new Set([
  "submitted",
  "technically_approved",
  "coordination_approved",
]);
const ACTIVE_STATUSES = new Set(["active", "in_progress"]);
const AGGREGATE_STATUS_FILTERS = new Set(["awaiting_approval", "active_group"]);

function matchesPlanStatusFilter(statusValue: string, filter: string): boolean {
  if (filter === "awaiting_approval") return AWAITING_APPROVAL_STATUSES.has(statusValue);
  if (filter === "active_group") return ACTIVE_STATUSES.has(statusValue);
  return filter === "all" || statusValue === filter;
}

const PLAN_VIEWS = ["table", "card", "list", "compact", "kanban", "calendar"] as const;

// Column header colours mirror the semantic badge variants in badge.tsx.
// Labels are replaced with translated strings at render time in PlansPage.
const PLAN_KANBAN_COL_KEYS = [
  { key: "draft",                 statusKey: "draft",                  color: "border border-slate-200 bg-slate-50 text-slate-600" },
  { key: "submitted",             statusKey: "submitted",              color: "border border-blue-200 bg-blue-50 text-blue-700" },
  { key: "technically_approved",  statusKey: "technically_approved",   color: "border border-indigo-200 bg-indigo-50 text-indigo-700" },
  { key: "coordination_approved", statusKey: "coordination_approved",  color: "border border-violet-200 bg-violet-50 text-violet-700" },
  { key: "approved",              statusKey: "approved",               color: "border border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "active",                statusKey: "active",                 color: "border border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "in_progress",           statusKey: "in_progress",            color: "border border-sky-200 bg-sky-50 text-sky-700" },
  { key: "delayed",               statusKey: "delayed",                color: "border border-amber-200 bg-amber-50 text-amber-700" },
  { key: "completed",             statusKey: "completed",              color: "border border-indigo-200 bg-indigo-50 text-indigo-700" },
  { key: "cancelled",             statusKey: "cancelled",              color: "border border-slate-200 bg-slate-100 text-slate-600" },
] as const;

const PAGE_SIZES = [10, 20, 50] as const;

/* ── Module-scope table helpers ────────────────────────────────────────── */

/** Status badge using the verified Plan status taxonomy. */
function PlanStatusBadge({ status }: { status: string }) {
  const { variant, className } = statusBadgeVariant(status);
  return (
    <Badge variant={variant} className={className}>
      {formatStatusLabel(status)}
    </Badge>
  );
}

/** Sortable column header — defined at module scope to avoid re-creation. */
function SortableHead({
  field,
  label,
  sortField,
  sortDir,
  onSort,
  className,
}: {
  field: string;
  label: string;
  sortField: string;
  sortDir: "asc" | "desc";
  onSort: (f: string) => void;
  className?: string;
}) {
  const active = sortField === field;
  return (
    // scope="col" is applied via the TableHead element rendered below;
    // the aria-sort attribute communicates current sort state to screen readers.
    <TableHead
      aria-sort={active ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
      tabIndex={0}
      aria-label={`Sort by ${label}${active ? `, currently ${sortDir === "asc" ? "ascending" : "descending"}` : ""}`}
      className={["cursor-pointer select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring", className].filter(Boolean).join(" ")}
      onClick={() => onSort(field)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSort(field);
        }
      }}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active ? (
          sortDir === "asc" ? (
            <ChevronUp className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          ) : (
            <ChevronDown className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
          )
        ) : (
          <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" aria-hidden="true" />
        )}
      </span>
    </TableHead>
  );
}

export function PlanPagination({
  page,
  pageSize,
  totalCount,
  totalPages,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  const { t } = useTranslation("planning");
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-4 py-3 border-t border-border/50 text-xs text-muted-foreground">
      <span>
        {totalCount === 0
          ? t("pagination.noPlans")
          : t("pagination.showing", {
              from: (page - 1) * pageSize + 1,
              to: Math.min(page * pageSize, totalCount),
              total: totalCount,
              item: totalCount === 1 ? t("pagination.plan") : t("pagination.plans"),
            })}
      </span>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="hidden sm:inline">{t("pagination.rowsPerPage")}</span>
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-7 w-16 text-xs" aria-label={t("pagination.rowsPerPageAria")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)} className="text-xs">
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPageChange(1)} aria-label={t("pagination.firstPage")}>
            <ChevronsLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === 1} onClick={() => onPageChange(page - 1)} aria-label={t("pagination.previousPage")}>
            <ChevronLeft className="h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
          <span className="px-2">{t("pagination.pageOf", { page, totalPages })}</span>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPageChange(page + 1)} aria-label={t("pagination.nextPage")}>
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled={page === totalPages} onClick={() => onPageChange(totalPages)} aria-label={t("pagination.lastPage")}>
            <ChevronsRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </Button>
        </div>
      </div>
    </div>
  );
}

/* ── Module-scope helpers ──────────────────────────────────────────────── */

/**
 * Formats a plan-level budget amount using its explicit ISO currency code.
 * Never assumes a default currency — if currency is missing, shows the raw
 * number without a currency symbol so the data-quality issue is visible.
 *
 * Replaces formatCurrency() which hardcodes "$".
 */
/**
 * Formats a plan-level budget amount for display in a string context (card/list/compact views).
 *
 * Display rules:
 *   budgetLegacyUnverified=true → "Budget Not Verified"  (ambiguous legacy record)
 *   amount=null                 → "—"                    (no budget entered after schema fix)
 *   amount≥0, currency present  → "USD 75,000"           (factual stored value)
 *   amount≥0, no currency       → "75,000 · Missing Currency"
 */
function formatPlanBudget(
  amount: number | null | undefined,
  currency: string | null | undefined,
  legacyUnverified = false,
  tFn?: (key: string) => string,
): string {
  if (legacyUnverified) return tFn ? tFn("detail.budgetNotVerified") : "Budget Not Verified";
  if (amount == null) return "—";
  const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount);
  const cur = currency?.trim();
  return cur ? `${cur} ${num}` : `${num} · ${tFn ? tFn("detail.missingCurrency") : "Missing Currency"}`;
}

/** The tooltip shown for legacy-unverified budget records. */
const LEGACY_BUDGET_TOOLTIP =
  "Budget information could not be verified because this Plan was created before missing Budget values were stored separately.";

/* ── Extended types for new API fields ─────────────────────────────────── */
// The generated schema predates the stateName, daysPastDue, and timingState
// additions. Cast at usage sites until codegen is re-run.
type ActivityTimingState = "delayed" | "overdue" | "delayed_and_overdue";

type ExtendedDelayedItem = PlanningDashboardDelayedActivitiesItem & {
  stateName?: string | null;
  stateNameAr?: string | null;
  /** Positive integer when end_date < today; null when future or missing. Never negative. */
  daysPastDue?: number | null;
  /** Factual UI classification — not a workflow status. */
  timingState?: ActivityTimingState | null;
};

/* ── Module-scope follow-up sub-components ─────────────────────────────── */
// Defined at module scope (not inside PlansPage) so React never recreates
// the component identity on each parent render, which would unmount/remount
// the whole subtree and reset focus state.

/** Compact horizontal strip used for empty / error / loading states. */
function FollowUpStrip({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={[
        "flex items-center gap-3 px-4 rounded-xl border border-border/60 bg-card",
        "min-h-[76px]",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}

function UpcomingDeadlines({
  items,
  loading,
  error,
}: {
  items: PlanningDashboardUpcomingDeadlinesItem[];
  loading: boolean;
  error: boolean;
}) {
  const { t } = useTranslation("planning");

  // Loading — compact skeleton strip so the page doesn't shift
  if (loading) {
    return (
      <FollowUpStrip>
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="h-4 w-48 rounded ms-auto" />
      </FollowUpStrip>
    );
  }

  // Error — distinct from "no deadlines" so the user knows the data failed
  if (error) {
    return (
      <FollowUpStrip>
        <CalendarClock className="h-4 w-4 text-muted-foreground/50 shrink-0" aria-hidden="true" />
        <span className="text-sm font-medium text-muted-foreground">{t("followUp.upcomingDeadlines")}</span>
        <span className="ms-auto text-xs text-destructive">{t("followUp.dataUnavailable")}</span>
      </FollowUpStrip>
    );
  }

  // Empty — compact strip (~76 px), neutral, no decorative checkmark
  if (items.length === 0) {
    return (
      <FollowUpStrip>
        <CalendarClock className="h-4 w-4 text-muted-foreground/50 shrink-0" aria-hidden="true" />
        <div>
          <span className="text-sm font-medium text-muted-foreground">{t("followUp.upcomingDeadlines")}</span>
          <span className="mx-1.5 text-muted-foreground/40">·</span>
          <span className="text-xs text-muted-foreground/60">{t("followUp.next30Days")}</span>
        </div>
        <span className="ms-auto text-xs text-muted-foreground/70">
          {t("followUp.noDeadlines")}
        </span>
      </FollowUpStrip>
    );
  }

  // Has items — full card
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">
          {t("followUp.upcomingDeadlines")}
          <span className="ms-1.5 font-normal text-muted-foreground/60">
            · {t("followUp.next30Days")}
          </span>
        </p>
        <ul className="divide-y divide-border/50">
          {items.map((d) => (
            <li
              key={d.planId}
              className="flex items-center justify-between gap-3 py-2.5 min-w-0"
            >
              <Link
                href={`/plans/${d.planId}`}
                className="text-sm font-medium truncate hover:underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded-sm"
                aria-label={t("followUp.viewPlan", { title: d.title })}
              >
                {d.title}
              </Link>
              <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
                {d.daysRemaining != null
                  ? d.daysRemaining <= 0
                    ? t("followUp.dueToday")
                    : t("followUp.inDays", { days: d.daysRemaining })
                  : formatDate(d.endDate)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

const DEFAULT_VISIBLE = 5;

function DelayedActivities({
  items: rawItems,
  loading,
  error,
}: {
  items: PlanningDashboardDelayedActivitiesItem[];
  loading: boolean;
  error: boolean;
}) {
  const { t, i18n } = useTranslation("planning");
  const [showAll, setShowAll] = useState(false);
  // Cast to extended type — API now returns stateName + daysPastDue
  const items = rawItems as ExtendedDelayedItem[];
  const visible = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hasMore = items.length > DEFAULT_VISIBLE;

  // Loading
  if (loading) {
    return (
      <Card>
        <CardContent className="p-4 space-y-2">
          <Skeleton className="h-4 w-44 rounded" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-md" />
          ))}
        </CardContent>
      </Card>
    );
  }

  // Error — must not prevent the Plans list from loading; error is isolated here
  if (error) {
    return (
      <FollowUpStrip>
        <span className="text-sm font-medium text-muted-foreground">
          {t("followUp.delayedOrOverdue")}
        </span>
        <span className="ms-auto text-xs text-destructive">{t("followUp.dataUnavailable")}</span>
      </FollowUpStrip>
    );
  }

  // Empty — compact strip, neutral
  if (items.length === 0) {
    return (
      <FollowUpStrip>
        <CheckCircle2 className="h-4 w-4 text-emerald-500/70 shrink-0" aria-hidden="true" />
        <span className="text-sm text-muted-foreground">
          {t("followUp.noDelayed")}
        </span>
      </FollowUpStrip>
    );
  }

  // Has items
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground mb-3">
          {t("followUp.delayedOrOverdue")}
          <span className="ms-1.5 font-normal text-muted-foreground/60">
            ({items.length})
          </span>
        </p>
        <ul className="divide-y divide-border/50" aria-label={t("followUp.delayedOrOverdue")}>
          {visible.map((a) => (
            <li
              key={a.activityId}
              className="flex items-start justify-between gap-3 py-2.5 min-h-[44px] min-w-0"
            >
              {/* Primary + secondary */}
              <div className="flex-1 min-w-0">
                <Link
                  href={`/plans/${a.planId}`}
                  className="text-sm font-medium truncate hover:underline underline-offset-2 block"
                  aria-label={t("followUp.viewPlan", { title: a.planTitle })}
                  title={t("followUp.viewPlan", { title: a.planTitle })}
                >
                  {a.title}
                </Link>
                <p className="text-xs text-muted-foreground truncate mt-0.5">
                  {a.planTitle}
                  {a.stateName ? (
                    <span className="text-muted-foreground/60"> · {getLinkedStateLabel(a, i18n.language)}</span>
                  ) : null}
                </p>
              </div>
              {/* Date + factual timing label + workflow status */}
              <div className="shrink-0 text-end min-w-[90px]">
                {a.endDate ? (
                  <p className="text-xs text-muted-foreground">{formatDate(a.endDate)}</p>
                ) : null}
                {/* Timing label — derives from server-computed timingState */}
                {a.timingState === "delayed_and_overdue" && (a.daysPastDue ?? 0) > 0 ? (
                  // Explicitly delayed AND past due date
                  <p
                    className="text-xs text-amber-600 dark:text-amber-400 font-medium"
                    aria-label={t("followUp.delayedAndPastDue", { days: a.daysPastDue })}
                  >
                    {t("followUp.delayedAndPastDue", { days: a.daysPastDue })}
                  </p>
                ) : a.timingState === "delayed_and_overdue" ? (
                  // Delayed + overdue but daysPastDue not populated (edge case)
                  <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    {t("followUp.delayedPastDue")}
                  </p>
                ) : a.timingState === "overdue" && (a.daysPastDue ?? 0) > 0 ? (
                  // Overdue by date, not explicitly delayed
                  <p
                    className="text-xs text-amber-600 dark:text-amber-400 font-medium"
                    aria-label={t("followUp.pastDue", { days: a.daysPastDue })}
                  >
                    {t("followUp.pastDue", { days: a.daysPastDue })}
                  </p>
                ) : a.timingState === "delayed" ? (
                  // Explicitly delayed but due date has not yet passed
                  <p
                    className="text-xs text-muted-foreground/80 font-medium"
                    aria-label={t("followUp.delayed")}
                  >
                    {t("followUp.delayed")}
                  </p>
                ) : null}
                {/* Workflow status — shown in muted text below timing label */}
                {a.status && a.timingState !== "delayed" && a.timingState !== "delayed_and_overdue" && (
                  <p className="text-xs text-muted-foreground/60 capitalize mt-0.5">
                    {a.status.replace(/_/g, " ")}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {hasMore && (
          <div className="mt-3 pt-3 border-t border-border/50">
            <button
              type="button"
              className="text-xs text-primary hover:underline underline-offset-2 font-medium"
              aria-expanded={showAll}
              onClick={() => setShowAll((s) => !s)}
            >
              {showAll
                ? t("followUp.showLess")
                : t("followUp.showAll", { count: items.length })}
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Extended totals type ──────────────────────────────────────────────── */
// The generated PlanningDashboardTotals type predates the awaitingApproval
// field added to the API. Extend it here until a codegen regeneration
// picks up the new field.
type ExtendedTotals = PlanningDashboardTotals & {
  awaitingApproval?: number;
  statusBreakdown?: Record<string, number>;
};

/* ── Main page component ───────────────────────────────────────────────── */

export default function PlansPage({ lockedType }: { lockedType?: string } = {}) {
  // ── All hooks unconditional at top (hooks rules, no early return before these)
  const { t, i18n } = useTranslation("planning");
  const { data: me } = useGetMe();
  const { openRecord } = useRecordDetail();
  const [, setLocation] = useLocation();
  const continueEdit = useCallback(
    (planId: number) => setLocation(`/plans/${planId}?edit=1`),
    [setLocation],
  );

  const moduleKey = lockedType ? `plans_${lockedType}` : "plans";
  const [viewMode, setViewMode] = useViewMode(moduleKey, [...PLAN_VIEWS], "table");

  const [planType, setPlanType] = useState<string>(lockedType ?? "all");
  const [status, setStatus] = useState<string>("all");
  const [stateId, setStateId] = useState<string>("all");

  // Sync with global location context — updates the local filter when the header selector changes
  const { selectedStateId: ctxStateId } = useLocationContext();
  useEffect(() => {
    setStateId(ctxStateId != null ? String(ctxStateId) : "all");
  }, [ctxStateId]);

  const [search, setSearch] = useState<string>("");

  // Create Plan modal — replaces the old /plans/new full-page form (spec §2).
  const [createDialogOpen, setCreateDialogOpen] = useState(false);

  // Pagination — client-side; reset to page 1 whenever filters or sort change
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(20);

  // Sorting — default: most-recently-created first (mirrors server ORDER BY)
  const [sortField, setSortField] = useState<string>("created");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  // Dashboard data — drives the summary strip and follow-up sections.
  // These are unaffected by the list filters (they show all plans in scope).
  const {
    data: dashData,
    isLoading: dashLoading,
    isError: dashError,
  } = useGetPlanningDashboard();

  // Filtered plan list — drives the table / card / kanban views
  const query: Record<string, string | number> = {};
  const effectiveType = lockedType ?? (planType !== "all" ? planType : undefined);
  if (effectiveType) query.planType = effectiveType;
  // Aggregate KPI filters are represented locally because they span multiple
  // workflow statuses. Direct lifecycle filters can still use the API query.
  if (status !== "all" && !AGGREGATE_STATUS_FILTERS.has(status)) query.status = status;
  if (stateId !== "all") query.stateId = Number(stateId);
  if (search.trim()) query.search = search.trim();

  const { data: plans, isLoading, isError: plansError } = useListPlans(query);
  const { data: states } = useListStates();

  // Aggregate filters are registry subsets, not backend workflow statuses.
  const statusFilteredPlans = useMemo(
    () => (plans ?? []).filter((plan) => matchesPlanStatusFilter(plan.status, status)),
    [plans, status],
  );

  // Sort client-side — spread first to avoid mutating React Query cache
  const sortedPlans = useMemo(() => {
    const arr = [...statusFilteredPlans];
    if (sortField === "created") {
      // Default: created_at DESC already from server; only re-sort if direction flips
      return sortDir === "desc" ? arr : arr.reverse();
    }
    arr.sort((a, b) => {
      const strCmp = (x: string, y: string) => {
        const c = x.localeCompare(y, "en");
        return sortDir === "asc" ? c : -c;
      };
      const numCmp = (x: number, y: number) => {
        const c = x - y;
        return sortDir === "asc" ? c : -c;
      };
      switch (sortField) {
        case "plan":        return strCmp(a.code ?? "", b.code ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "type":        return strCmp(a.planType ?? "", b.planType ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "status":      return strCmp(a.status ?? "", b.status ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "state":       return strCmp(a.stateName ?? "", b.stateName ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "responsible": return strCmp(a.responsibleUserName ?? a.responsibleName ?? "", b.responsibleUserName ?? b.responsibleName ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "period":      return strCmp(a.startDate ?? "", b.startDate ?? "") || numCmp(b.id ?? 0, a.id ?? 0);
        case "progress":    return numCmp(
          a.progressPct ?? -1,
          b.progressPct ?? -1,
        ) || numCmp(b.id ?? 0, a.id ?? 0);
        default:            return numCmp(b.id ?? 0, a.id ?? 0); // stable fallback
      }
    });
    return arr;
  }, [statusFilteredPlans, sortField, sortDir]);

  const totalCount = sortedPlans.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  const paginatedPlans = useMemo(
    () => sortedPlans.slice((page - 1) * pageSize, page * pageSize),
    [sortedPlans, page, pageSize],
  );

  // Reset to page 1 whenever filters or sort change (prevents empty-page states)
  useEffect(() => {
    setPage(1);
  }, [planType, status, stateId, search, sortField, sortDir, pageSize]);

  const canEditDrafts = hasPerm(me?.permissions, "*") || hasPerm(me?.permissions, "plans.update");

  const viewRecords: ViewRecord[] = useMemo(
    () =>
      paginatedPlans.map((p) => {
        const progressPct = p.progressPct;
        return {
          id: p.id,
          title: p.title,
          code: p.code,
          subtitle: getLinkedStateLabel(p, i18n.language),
          status: p.status,
          statusBadge: <PlanStatusBadge status={p.status} />,
          tag: p.planType,
          date: formatDate(p.startDate),
          date2: formatDate(p.endDate),
          meta: [
            { label: t("table.state"),       value: getLinkedStateLabel(p, i18n.language) },
            { label: t("table.responsible"), value: p.responsibleUserName ?? p.responsibleName ?? "—" },
            { label: t("table.budget"),      value: formatPlanBudget(p.budgetPlanned, p.currency, !!(p as { budgetLegacyUnverified?: boolean }).budgetLegacyUnverified, t) },
            { label: t("table.progress"),    value: progressPct == null ? "—" : `${progressPct}%` },
          ],
          progress: progressPct == null ? undefined : { value: progressPct, max: 100, label: t("table.progress") },
          onClick: (trigger) => openRecord("plan", p.id, trigger),
          // Continue Editing is separate from View and is available only for
          // drafts when the existing plans.update permission allows editing.
          actions:
            canEditDrafts && p.status === "draft" ? (
              <ContinueEditingAction
                recordTitle={p.title}
                onClick={() => continueEdit(p.id)}
              />
            ) : undefined,
        };
      }),
    [paginatedPlans, t, i18n.language, openRecord, canEditDrafts, continueEdit],
  );

  // ── Derived values (useMemo before any conditional early return)
  const isActionPlans = lockedType === "action";
  // Create Plan requires plans.create — projects.create does NOT substitute (spec §4).
  const canCreate = hasPerm(me?.permissions, "*") || hasPerm(me?.permissions, "plans.create");

  // Build kanban columns with translated labels
  const planKanbanCols: KanbanColumn[] = useMemo(
    () => PLAN_KANBAN_COL_KEYS.map((col) => ({
      key: col.key,
      label: t(`status.${col.statusKey}`),
      color: col.color,
    })),
    [t],
  );

  // Cast totals to include the new awaitingApproval field from the updated API.
  // The generated type will pick it up after the next codegen run.
  const extTotals = dashData?.totals as ExtendedTotals | undefined;

  const upcomingDeadlines = dashData?.upcomingDeadlines ?? [];
  const delayedActivities = dashData?.delayedActivities ?? [];

  // Sort toggle — same field flips direction; new field defaults to asc
  function toggleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
  }

  const isFiltered =
    !!search || status !== "all" || stateId !== "all" || planType !== "all";

  // Shared empty node used by non-table view modes
  const emptyNode =
    totalCount === 0 && isFiltered ? (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
        <CalendarClock className="h-8 w-8 opacity-30" />
        <p className="font-medium">{t("plansPage.noPlansMatchFilters")}</p>
        <button
          type="button"
          className="text-xs text-primary underline underline-offset-2"
          onClick={() => {
            setSearch("");
            setStatus("all");
            setStateId("all");
            setPlanType(lockedType ?? "all");
          }}
        >
          {t("filters.clearFilters")}
        </button>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground text-sm">
        <CalendarClock className="h-8 w-8 opacity-30" />
        <p className="font-medium">{t("plansPage.noPlansAvailable")}</p>
        {canCreate && (
          <p
            className="text-xs"
            dangerouslySetInnerHTML={{ __html: t("plansPage.clickToCreate") }}
          />
        )}
      </div>
    );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {isActionPlans ? t("headings.actionPlans") : t("plansPage.heading")}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isActionPlans
              ? t("headings.actionPlansDesc")
              : t("plansPage.headingDesc")}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ViewModeSwitcher
            available={[...PLAN_VIEWS]}
            current={viewMode}
            onChange={setViewMode}
          />
          {canCreate && (
            <Button className="gap-1.5" onClick={() => setCreateDialogOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              {t("createPlan")}
            </Button>
          )}
        </div>
      </div>

      {/* ── Plan summary KPI strip (only for the main Plans workspace) ── */}
      {!isActionPlans && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {dashLoading ? (
            [...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))
          ) : dashError ? (
            <div className="col-span-full rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
              {t("plansPage.summaryUnavailable")}
            </div>
          ) : (
            <>
              <StatCard icon={CalendarClock} iconBg="bg-slate-500" label={t("plansPage.totalPlans")} value={extTotals?.total ?? 0} />
              <StatCard
                icon={FileText}
                iconBg="bg-slate-400"
                label={t("plansPage.draftPlans")}
                value={extTotals?.draft ?? 0}
                secondary
                onClick={() => setStatus(status === "draft" ? "all" : "draft")}
                pressed={status === "draft"}
              />
              <StatCard
                icon={Clock}
                iconBg="bg-amber-500"
                label={t("plansPage.awaitingApproval")}
                value={extTotals?.awaitingApproval ?? 0}
                alert={!dashLoading && (extTotals?.awaitingApproval ?? 0) > 0}
                onClick={() => setStatus(status === "awaiting_approval" ? "all" : "awaiting_approval")}
                pressed={status === "awaiting_approval"}
              />
              <StatCard
                icon={Activity}
                iconBg="bg-blue-500"
                label={t("plansPage.activePlans")}
                value={extTotals?.active ?? 0}
                onClick={() => setStatus(status === "active_group" ? "all" : "active_group")}
                pressed={status === "active_group"}
              />
              <StatCard
                icon={CheckCircle2}
                iconBg="bg-emerald-500"
                label={t("plansPage.completedPlans")}
                value={extTotals?.completed ?? 0}
                onClick={() => setStatus(status === "completed" ? "all" : "completed")}
                pressed={status === "completed"}
              />
            </>
          )}
        </div>
      )}

      {/* ── Planning Follow-Up ──────────────────────────────────────────── */}
      {!isActionPlans && (
        <div className="flex flex-col gap-3">
          <UpcomingDeadlines items={upcomingDeadlines} loading={dashLoading} error={dashError} />
          <DelayedActivities items={delayedActivities} loading={dashLoading} error={dashError} />
        </div>
      )}

      {/* ── Filter toolbar ──────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
        <Separator orientation="vertical" className="h-5" />
        {/* Search — title or code */}
        <div className="relative">
          <Search className="absolute start-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("filters.searchPlansByTitleOrCode")}
            className="ps-7 pe-7 h-9 min-w-[8rem] w-full max-w-[13rem] text-sm"
            aria-label={t("filters.searchAriaLabel")}
          />
          {search && (
            <button
              type="button"
              aria-label={t("filters.clearSearch")}
              className="absolute end-2 top-2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Type filter — hidden when a type is already locked by parent route */}
        {!lockedType && (
          <Select value={planType} onValueChange={setPlanType}>
            <SelectTrigger className="h-9 min-w-[7rem] w-auto max-w-[11rem] text-sm">
              <SelectValue placeholder={t("filters.allTypes_select")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allTypes_select")}</SelectItem>
              {PLAN_TYPE_VALUES.map((val) => (
                <SelectItem key={val} value={val}>{t(`planTypes.${val}_short`)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Status filter — Title Case labels, raw enum values preserved */}
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="h-9 min-w-[7rem] w-auto max-w-[11rem] text-sm">
            <SelectValue placeholder={t("filters.allStatuses_select")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses_select")}</SelectItem>
            <SelectItem value="awaiting_approval">{t("filters.awaitingApproval")}</SelectItem>
            <SelectItem value="active_group">{t("filters.activeIncludingInProgress")}</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{formatStatusLabel(s)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* State filter */}
        <Select value={stateId} onValueChange={setStateId}>
          <SelectTrigger className="h-9 min-w-[7rem] w-auto max-w-[11rem] text-sm">
            <SelectValue placeholder={t("filters.allStates_select")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStates_select")}</SelectItem>
            {states?.map((s) => (
              <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* Clear Filters — only shown when one or more filters are active */}
        {isFiltered && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 px-2.5 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setSearch("");
              setStatus("all");
              setStateId("all");
              setPlanType(lockedType ?? "all");
            }}
          >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
            {t("filters.clearFilters")}
          </Button>
        )}
      </div>

      {/* ── Plans list / views ──────────────────────────────────────────── */}
      {isLoading ? (
        /* Loading skeleton — approximates final Plan cell + 7 columns */
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3.5 min-h-[56px]">
                  {/* Plan cell: title + code */}
                  <div className="flex flex-col gap-1 flex-[3]">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-20" />
                  </div>
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-5 w-28 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-32 whitespace-nowrap" />
                  <Skeleton className="h-4 w-20 ms-auto" />
                  <Skeleton className="h-4 w-10" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : plansError ? (
        /* Error state — section-isolated, does not crash the workspace */
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <CalendarClock className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm font-medium text-muted-foreground">
              {t("plansPage.unableToLoad")}
            </p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              {t("plansPage.retry")}
            </Button>
          </CardContent>
        </Card>
      ) : viewMode === "table" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto" role="region" aria-label={t("plansPage.ariaTable")}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    {/* Plan = Title (primary) + Code (secondary) — combined to prevent code wrapping */}
                    <SortableHead field="plan" label={t("table.plan")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="min-w-[220px]" />
                    <SortableHead field="type" label={t("table.type")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead field="status" label={t("table.status")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead field="state" label={t("table.state")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead field="responsible" label={t("table.responsible")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    <SortableHead field="period" label={t("table.period")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} />
                    {/* Budget: not sortable across mixed currencies — no sort indicator */}
                    <TableHead className="text-end">{t("table.budget")}</TableHead>
                    {/* Progress header — tooltip clarifies "Progress" = avg activity progress, not performance */}
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <SortableHead field="progress" label={t("table.progress")} sortField={sortField} sortDir={sortDir} onSort={toggleSort} className="text-end cursor-help" />
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-[220px] text-center">
                          {t("plansPage.progressTooltip")}
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Empty state — distinguishes filtered-empty from scope-empty */}
                  {totalCount === 0 && (
                    <TableRow>
                      <TableCell colSpan={8} className="text-center py-10">
                        {isFiltered ? (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <CalendarClock className="h-8 w-8 opacity-30" />
                            <p className="text-sm font-medium">{t("plansPage.noPlansMatchFilters")}</p>
                            <button
                              type="button"
                              className="text-xs text-primary underline underline-offset-2"
                              onClick={() => {
                                setSearch("");
                                setStatus("all");
                                setStateId("all");
                                setPlanType(lockedType ?? "all");
                              }}
                            >
                              {t("filters.clearFilters")}
                            </button>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-2 text-muted-foreground">
                            <CalendarClock className="h-8 w-8 opacity-30" />
                            <p className="text-sm font-medium">{t("plansPage.noPlansAvailable")}</p>
                            {canCreate && (
                              <p
                                className="text-xs"
                                dangerouslySetInnerHTML={{ __html: t("plansPage.clickToCreate") }}
                              />
                            )}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                  {paginatedPlans.map((p) => {
                    const progressPct = p.progressPct;
                    return (
                      <TableRow
                        key={p.id}
                        className="hover:bg-muted/50 transition-colors min-h-[52px]"
                      >
                        {/* Plan cell: Title (primary link) + Code (secondary, nowrap) */}
                        <TableCell className="py-3">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <Link
                              href={`/plans/${p.id}`}
                              className="text-sm font-medium line-clamp-2 hover:underline underline-offset-2 leading-snug"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.title}
                            </Link>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              <span
                                className="font-mono text-xs text-muted-foreground whitespace-nowrap"
                                title={p.code ?? undefined}
                              >
                                <bdi dir="ltr">{p.code ?? "—"}</bdi>
                              </span>
                              <AttachmentCountBadge module="plans" recordId={p.id} />
                            </div>
                            {/* Continue Editing shortcut for draft plans — spec §26 */}
                            {canEditDrafts && p.status === "draft" && (
                              <ContinueEditingAction
                                recordTitle={p.title}
                                onClick={() => continueEdit(p.id)}
                              />
                            )}
                          </div>
                        </TableCell>
                        {/* Type — shared formatPlanType label */}
                        <TableCell className="text-sm text-muted-foreground max-w-[120px]">
                          <span className="truncate block">{formatPlanType(p.planType)}</span>
                        </TableCell>
                        {/* Status — verified Title Case badge */}
                        <TableCell>
                          <PlanStatusBadge status={p.status} />
                        </TableCell>
                        {/* State / Location — HQ or state name via formatLocation */}
                        <TableCell className="text-sm text-muted-foreground max-w-[140px]">
                          <span className="truncate block">{formatLocation({ locationType: p.locationType, stateName: p.stateName, stateNameAr: p.stateNameAr }, i18n.language)}</span>
                        </TableCell>
                        {/* Responsible — resolved user name (responsible_user_id → users.name)
                            falling back to the free-text responsible_name for plans where
                            the responsible person was recorded as text rather than a user account */}
                        <TableCell className="text-sm text-muted-foreground max-w-[160px]">
                          <span className="truncate block">{p.responsibleUserName ?? p.responsibleName ?? "—"}</span>
                        </TableCell>
                        {/* Period — British en-dash format, no fabricated dates */}
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {p.startDate || p.endDate
                            ? `${formatDate(p.startDate)} – ${formatDate(p.endDate)}`
                            : "—"}
                        </TableCell>
                        {/* Budget — ISO currency code; legacy-unverified records show translated label */}
                        <TableCell className="text-end text-sm font-medium tabular-nums">
                          {(() => {
                            const legacyUnverified = !!(p as { budgetLegacyUnverified?: boolean }).budgetLegacyUnverified;
                            if (legacyUnverified) {
                              return (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span className="text-muted-foreground/70 text-xs cursor-help border-b border-dashed border-muted-foreground/40">
                                        {t("detail.budgetNotVerified")}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="left" className="max-w-[280px]">
                                      {LEGACY_BUDGET_TOOLTIP}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              );
                            }
                            return formatPlanBudget(p.budgetPlanned, p.currency, false, t);
                          })()}
                        </TableCell>
                        {/* Progress — avg activity progress; null = no activities; 0% = genuine zero */}
                        <TableCell className="text-end text-sm font-medium tabular-nums">
                          {progressPct == null ? (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-muted-foreground/60 cursor-help">—</span>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  No Activities available for Progress calculation.
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          ) : (
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span
                                    aria-label={`Average Activity progress: ${progressPct}%`}
                                    className="cursor-help"
                                  >
                                    <bdi dir="ltr">{progressPct}%</bdi>
                                  </span>
                                </TooltipTrigger>
                                <TooltipContent side="left" className="text-center">
                                  <p>Average Activity progress: <bdi dir="ltr">{progressPct}%</bdi></p>
                                  {(p.activitiesCount as number | null) != null && (
                                    <p className="text-primary-foreground/70">Based on {p.activitiesCount} {(p.activitiesCount as number) === 1 ? "Activity" : "Activities"}</p>
                                  )}
                                </TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <PlanPagination
              page={page}
              pageSize={pageSize}
              totalCount={totalCount}
              totalPages={totalPages}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size);
                setPage(1);
              }}
            />
          </CardContent>
        </Card>
      ) : viewMode === "card" ? (
        <CardGrid items={viewRecords} empty={emptyNode} />
      ) : viewMode === "list" ? (
        <Card>
          <CardContent className="p-0">
            <ListView items={viewRecords} empty={emptyNode} />
          </CardContent>
        </Card>
      ) : viewMode === "compact" ? (
        <Card>
          <CardContent className="p-0">
            <CompactView items={viewRecords} empty={emptyNode} />
          </CardContent>
        </Card>
      ) : viewMode === "kanban" ? (
        <div className="p-1">
          <KanbanBoard items={viewRecords} columns={planKanbanCols} empty={emptyNode} />
        </div>
      ) : viewMode === "calendar" ? (
        <Card>
          <CardContent className="p-4">
            <CalendarGrid items={viewRecords} empty={emptyNode} />
          </CardContent>
        </Card>
      ) : null}
      {!isLoading && !plansError && viewMode !== "table" && (
        <PlanPagination
          page={page}
          pageSize={pageSize}
          totalCount={totalCount}
          totalPages={totalPages}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(1);
          }}
        />
      )}

      {/* ── Create Plan modal (replaces /plans/new full-page form) ──────── */}
      <CreatePlanRegistrationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultPlanType={lockedType}
      />
    </div>
  );
}
