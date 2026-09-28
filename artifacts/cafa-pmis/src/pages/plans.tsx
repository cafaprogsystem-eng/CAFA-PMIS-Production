import { useState, useMemo, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
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
  useDeletePlan,
} from "@workspace/api-client-react";
import { CreatePlanRegistrationDialog } from "@/components/create-plan-registration-dialog";
import type {
  PlanSummary,
  PlanningDashboardTotals,
  PlanningDashboardUpcomingDeadlinesItem,
  PlanningDashboardDelayedActivitiesItem,
} from "@workspace/api-client-react";
import {
  Button, Card, Chip, Dropdown, Label, Modal, SearchField, Separator, Skeleton, Tooltip,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import React from "react";
import {
  CalendarClock,
  Plus,
  Activity,
  CheckCircle2,
  Filter,
  X,
  FileText,
  Clock,
  MoreHorizontal,
  Trash2,
  TriangleAlert,
} from "@/components/icons";
import { formatDate, formatPlanType, hasPerm, formatLocation } from "@/lib/format";
import { AttachmentCountBadge } from "@/components/drive-attachment-panel";
import { useViewMode } from "@/lib/view-modes";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { ListView } from "@/components/view-modes/list-view";
import { CompactView } from "@/components/view-modes/compact-view";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { CalendarGrid } from "@/components/view-modes/calendar-grid";
import { statusTone } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { ContinueEditingAction } from "@/components/continue-editing-action";
import { SelectField } from "@/components/select-field";
import { RegistryPagination } from "@/components/registry-pagination";
import { FilterKpi } from "@/components/filter-kpi";

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

// Kanban columns; labels are translated at render time in PlansPage.
const PLAN_KANBAN_COL_KEYS = [
  { key: "draft",                 statusKey: "draft" },
  { key: "submitted",             statusKey: "submitted" },
  { key: "technically_approved",  statusKey: "technically_approved" },
  { key: "coordination_approved", statusKey: "coordination_approved" },
  { key: "approved",              statusKey: "approved" },
  { key: "active",                statusKey: "active" },
  { key: "in_progress",           statusKey: "in_progress" },
  { key: "delayed",               statusKey: "delayed" },
  { key: "completed",             statusKey: "completed" },
  { key: "cancelled",             statusKey: "cancelled" },
] as const;

const PAGE_SIZES = [10, 20, 50] as const;

/* ── Module-scope table helpers ────────────────────────────────────────── */

type PlanItem = PlanSummary;

/** Plan workflow status as a HeroUI Chip, in the active language. */
function PlanStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("planning");
  return (
    <Chip size="sm" variant="soft" color={statusTone(status)} className="whitespace-nowrap">
      {t(`status.${status}`, { defaultValue: status.replace(/_/g, " ") })}
    </Chip>
  );
}

function usePlanTypeLabel() {
  const { t } = useTranslation("planning");
  return (type?: string | null) => (type ? t(`planTypes.${type}_short`, { defaultValue: formatPlanType(type) }) : "—");
}

/** Plans registry footer (HeroUI Pagination). Exported for the RTL control tests. */
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
    <RegistryPagination
      className="px-4 py-3"
      page={page}
      totalPages={totalPages}
      onPageChange={onPageChange}
      pageSize={pageSize}
      pageSizes={PAGE_SIZES}
      onPageSizeChange={onPageSizeChange}
      summary={totalCount === 0
        ? t("pagination.noPlans")
        : t("pagination.showing", {
            from: (page - 1) * pageSize + 1,
            to: Math.min(page * pageSize, totalCount),
            total: totalCount,
            item: totalCount === 1 ? t("pagination.plan") : t("pagination.plans"),
          })}
      labels={{
        rowsPerPage: t("pagination.rowsPerPage"),
        first: t("pagination.firstPage"),
        previous: t("pagination.previousPage"),
        next: t("pagination.nextPage"),
        last: t("pagination.lastPage"),
        pageOf: t("pagination.pageOf", { page, totalPages }),
      }}
    />
  );
}

/* ── Module-scope helpers ──────────────────────────────────────────────── */

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
// the component identity on each parent render.

/** Compact horizontal strip used for empty / error / loading states. */
function FollowUpStrip({ children }: { children: React.ReactNode }) {
  return <Card className="min-h-[64px] flex-row flex-wrap items-center gap-3 px-4 py-3">{children}</Card>;
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

  if (loading) {
    return (
      <FollowUpStrip>
        <Skeleton className="h-4 w-36 rounded" />
        <Skeleton className="ms-auto h-4 w-48 rounded" />
      </FollowUpStrip>
    );
  }

  if (error) {
    return (
      <FollowUpStrip>
        <CalendarClock className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--muted)]">{t("followUp.upcomingDeadlines")}</span>
        <span className="ms-auto text-xs text-[var(--danger)]">{t("followUp.dataUnavailable")}</span>
      </FollowUpStrip>
    );
  }

  if (items.length === 0) {
    return (
      <FollowUpStrip>
        <CalendarClock className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
        <span className="text-sm font-medium text-[var(--muted)]">
          {t("followUp.upcomingDeadlines")} <span className="font-normal">· {t("followUp.next30Days")}</span>
        </span>
        <span className="ms-auto text-xs text-[var(--muted)]">{t("followUp.noDeadlines")}</span>
      </FollowUpStrip>
    );
  }

  return (
    <Card className="gap-2 p-4">
      <p className="text-xs font-medium text-[var(--muted)]">
        {t("followUp.upcomingDeadlines")}
        <span className="ms-1.5 font-normal">· {t("followUp.next30Days")}</span>
      </p>
      <ul className="divide-y divide-[var(--border)]">
        {items.map((d) => (
          <li key={d.planId} className="flex min-w-0 items-center justify-between gap-3 py-2.5">
            <Link
              href={`/plans/${d.planId}`}
              dir="auto"
              className="min-w-0 break-words rounded-sm text-sm font-medium outline-none hover:underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              aria-label={t("followUp.viewPlan", { title: d.title })}
            >
              {d.title}
            </Link>
            <span className="shrink-0 whitespace-nowrap text-xs text-[var(--muted)]">
              {d.daysRemaining != null
                ? d.daysRemaining <= 0
                  ? t("followUp.dueToday")
                  : t("followUp.inDays", { days: d.daysRemaining })
                : <bdi dir="ltr">{formatDate(d.endDate)}</bdi>}
            </span>
          </li>
        ))}
      </ul>
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
  const items = rawItems as ExtendedDelayedItem[];
  const visible = showAll ? items : items.slice(0, DEFAULT_VISIBLE);
  const hasMore = items.length > DEFAULT_VISIBLE;

  if (loading) {
    return (
      <Card className="gap-2 p-4">
        <Skeleton className="h-4 w-44 rounded" />
        {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-lg" />)}
      </Card>
    );
  }

  // Error must not prevent the Plans list from loading; it is isolated here
  if (error) {
    return (
      <FollowUpStrip>
        <span className="text-sm font-medium text-[var(--muted)]">{t("followUp.delayedOrOverdue")}</span>
        <span className="ms-auto text-xs text-[var(--danger)]">{t("followUp.dataUnavailable")}</span>
      </FollowUpStrip>
    );
  }

  if (items.length === 0) {
    return (
      <FollowUpStrip>
        <CheckCircle2 className="size-4 shrink-0 text-[var(--success)]" aria-hidden="true" />
        <span className="text-sm text-[var(--muted)]">{t("followUp.noDelayed")}</span>
      </FollowUpStrip>
    );
  }

  const timingLabel = (a: ExtendedDelayedItem) => {
    if (a.timingState === "delayed_and_overdue") {
      return (a.daysPastDue ?? 0) > 0 ? t("followUp.delayedAndPastDue", { days: a.daysPastDue }) : t("followUp.delayedPastDue");
    }
    if (a.timingState === "overdue" && (a.daysPastDue ?? 0) > 0) return t("followUp.pastDue", { days: a.daysPastDue });
    if (a.timingState === "delayed") return t("followUp.delayed");
    return null;
  };

  return (
    <Card className="gap-2 p-4">
      <p className="text-xs font-medium text-[var(--muted)]">
        {t("followUp.delayedOrOverdue")}
        <span className="ms-1.5 font-normal">({items.length})</span>
      </p>
      <ul className="divide-y divide-[var(--border)]" aria-label={t("followUp.delayedOrOverdue")}>
        {visible.map((a) => {
          const timing = timingLabel(a);
          return (
            <li key={a.activityId} className="flex min-h-[44px] min-w-0 items-start justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/plans/${a.planId}`}
                  dir="auto"
                  className="inline-block max-w-full break-words text-sm font-medium hover:underline underline-offset-2 rtl:text-end"
                  aria-label={t("followUp.viewPlan", { title: a.planTitle })}
                  title={t("followUp.viewPlan", { title: a.planTitle })}
                >
                  {a.title}
                </Link>
                <p className="mt-0.5 break-words text-xs text-[var(--muted)]">
                  <span dir="auto">{a.planTitle}</span>
                  {a.stateName ? <span> · {getLinkedStateLabel(a, i18n.language)}</span> : null}
                </p>
              </div>
              {/* Date + factual timing label + workflow status */}
              <div className="flex min-w-[90px] shrink-0 flex-col items-end gap-1 text-end">
                {a.endDate ? <span className="text-xs text-[var(--muted)]"><bdi dir="ltr">{formatDate(a.endDate)}</bdi></span> : null}
                {timing && (
                  <Chip size="sm" variant="soft" color={a.timingState === "delayed" ? "default" : "warning"}>{timing}</Chip>
                )}
                {a.status && a.timingState !== "delayed" && a.timingState !== "delayed_and_overdue" && (
                  <span className="text-xs text-[var(--muted)]">{t(`status.${a.status}`, { defaultValue: a.status.replace(/_/g, " ") })}</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {hasMore && (
        <div className="border-t border-[var(--border)] pt-3">
          <Button size="sm" variant="ghost" aria-expanded={showAll} onPress={() => setShowAll((s) => !s)}>
            {showAll ? t("followUp.showLess") : t("followUp.showAll", { count: items.length })}
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Confirms deleting a Plan (a HeroUI alert dialog instead of the browser's native prompt). */
function DeletePlanModal({
  plan, onCancel, onConfirm, isPending,
}: {
  plan: { id: number; title: string } | null;
  onCancel: () => void;
  onConfirm: () => void;
  isPending: boolean;
}) {
  const { t } = useTranslation("planning");
  const { t: tCommon } = useTranslation("common");
  return (
    <Modal isOpen={!!plan} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Modal.Backdrop>
        <Modal.Container size="sm">
          <Modal.Dialog role="alertdialog">
            <Modal.Header>
              <Modal.Icon className="bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]">
                <TriangleAlert className="size-5" aria-hidden="true" />
              </Modal.Icon>
              <Modal.Heading>{t("detail.deletePlanMenu")}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("detail.deletePlanConfirm")}</p>
              {plan && <p dir="auto" className="text-sm font-medium">{plan.title}</p>}
            </Modal.Header>
            <Modal.Footer>
              <Button variant="secondary" autoFocus onPress={onCancel} isDisabled={isPending}>{tCommon("cancel")}</Button>
              <Button variant="danger" onPress={onConfirm} isPending={isPending}>{t("detail.deletePlanMenu")}</Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Row actions: HeroUI Dropdown with Delete. */
function PlanActionsMenu({ label, onDelete }: { label: string; onDelete: () => void }) {
  const { t } = useTranslation("planning");
  return (
    <Dropdown>
      <Button isIconOnly size="sm" variant="ghost" aria-label={label}>
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </Button>
      <Dropdown.Popover placement="bottom end" className="min-w-40">
        <Dropdown.Menu aria-label={label} onAction={(key) => { if (key === "delete") onDelete(); }}>
          <Dropdown.Item id="delete" textValue={t("detail.deletePlanMenu")} variant="danger">
            <Trash2 className="size-4" aria-hidden="true" /><Label>{t("detail.deletePlanMenu")}</Label>
          </Dropdown.Item>
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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

  // Delete is a separate, explicitly-granted permission — plans.update does not imply it.
  // Same contract as plan-detail.tsx's single-Plan delete action, now also reachable from
  // every list/board/calendar view instead of only the full detail page.
  const canDelete = hasPerm(me?.permissions, "*") || hasPerm(me?.permissions, "plans.delete");
  const qc = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; title: string } | null>(null);
  const deleteMutation = useDeletePlan({
    mutation: {
      onSuccess: () => { toast.success(t("toast.planDeleted")); qc.invalidateQueries(); setDeleteTarget(null); },
      onError: (e: Error) => toast.error(e.message),
    },
  });
  const handleDeletePlan = useCallback(
    (p: { id: number; title: string }) => setDeleteTarget({ id: p.id, title: p.title }),
    [],
  );
  const planTypeLabel = usePlanTypeLabel();

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
          tag: planTypeLabel(p.planType),
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
          // Delete now reaches every view mode, not just the full detail page.
          actions:
            (canEditDrafts && p.status === "draft") || canDelete ? (
              <div className="flex items-center gap-1">
                {/* Continue Editing — draft plans in the card / kanban / calendar views */}
                {canEditDrafts && p.status === "draft" && (
                  <ContinueEditingAction
                    recordTitle={p.title}
                    onClick={() => continueEdit(p.id)}
                  />
                )}
                {canDelete && <PlanActionsMenu label={t("table.actionsAria")} onDelete={() => handleDeletePlan(p)} />}
              </div>
            ) : undefined,
        };
      }),
    [paginatedPlans, t, i18n.language, openRecord, canEditDrafts, continueEdit, canDelete, handleDeletePlan, planTypeLabel],
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
    })),
    [t],
  );

  // Cast totals to include the new awaitingApproval field from the updated API.
  // The generated type will pick it up after the next codegen run.
  const extTotals = dashData?.totals as ExtendedTotals | undefined;

  const upcomingDeadlines = dashData?.upcomingDeadlines ?? [];
  const delayedActivities = dashData?.delayedActivities ?? [];

  const isFiltered =
    !!search || status !== "all" || stateId !== "all" || planType !== "all";

  // Shared empty node used by non-table view modes
  const emptyNode =
    totalCount === 0 && isFiltered ? (
      <div className="flex flex-col items-center gap-2 py-12 text-[var(--muted)] text-sm">
        <CalendarClock className="h-8 w-8 opacity-30" />
        <p className="font-medium">{t("plansPage.noPlansMatchFilters")}</p>
        <Button
          size="sm"
          variant="ghost"
          onPress={() => {
            setSearch("");
            setStatus("all");
            setStateId("all");
            setPlanType(lockedType ?? "all");
          }}
        >
          {t("filters.clearFilters")}
        </Button>
      </div>
    ) : (
      <div className="flex flex-col items-center gap-2 py-12 text-[var(--muted)] text-sm">
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

  // ── Table columns (Pro DataGrid; sorting stays client-side and controlled)
  const clearFilters = () => {
    setSearch("");
    setStatus("all");
    setStateId("all");
    setPlanType(lockedType ?? "all");
  };

  const columns = useMemo<DataGridColumn<PlanItem>[]>(() => [
    { id: "plan", header: t("table.plan"), isRowHeader: true, allowsSorting: true, width: 220, pinned: "start", headerClassName: "w-[220px]",
      cell: (p) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <Link
            href={`/plans/${p.id}`}
            dir="auto"
            className="block whitespace-normal break-words font-medium leading-snug text-[var(--foreground)] line-clamp-3 rtl:text-end hover:underline underline-offset-2"
            title={p.title}
          >
            {p.title}
          </Link>
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-xs text-[var(--muted)]" title={p.code ?? undefined}><bdi dir="ltr">{p.code ?? "—"}</bdi></span>
            <AttachmentCountBadge module="plans" recordId={p.id} />
          </div>
          {/* Continue Editing — draft plans in the table */}
          {canEditDrafts && p.status === "draft" && (
            <div className="mt-1"><ContinueEditingAction recordTitle={p.title} onClick={() => continueEdit(p.id)} /></div>
          )}
        </div>
      ) },
    { id: "type", header: t("table.type"), allowsSorting: true, width: 96, headerClassName: "w-[96px]",
      cell: (p) => <span className="text-sm text-[var(--muted)]">{planTypeLabel(p.planType)}</span> },
    { id: "status", header: t("table.status"), allowsSorting: true, width: 124, headerClassName: "w-[124px]",
      cell: (p) => <PlanStatusBadge status={p.status} /> },
    { id: "state", header: t("table.state"), allowsSorting: true, width: 104, headerClassName: "w-[104px]",
      cell: (p) => <span className="text-sm text-[var(--muted)]" dir="auto">{formatLocation({ locationType: p.locationType, stateName: p.stateName, stateNameAr: p.stateNameAr }, i18n.language)}</span> },
    { id: "responsible", header: t("table.responsible"), allowsSorting: true, width: 124, headerClassName: "w-[124px]",
      cell: (p) => <span dir="auto" className="block whitespace-normal break-words text-sm text-[var(--muted)] line-clamp-2 rtl:text-end">{p.responsibleUserName ?? p.responsibleName ?? "—"}</span> },
    { id: "period", header: t("table.period"), allowsSorting: true, width: 116, headerClassName: "w-[116px]",
      cell: (p) => p.startDate || p.endDate ? (
        <span className="text-xs leading-snug text-[var(--muted)]">
          <bdi dir="ltr" className="block whitespace-nowrap">{formatDate(p.startDate)}</bdi>
          <bdi dir="ltr" className="block whitespace-nowrap">– {formatDate(p.endDate)}</bdi>
        </span>
      ) : <span className="text-[var(--muted)]">—</span> },
    // Budget: not sortable across mixed currencies
    { id: "budget", header: t("table.budget"), align: "end", width: 120, headerClassName: "w-[120px]",
      cell: (p) => {
        if ((p as { budgetLegacyUnverified?: boolean }).budgetLegacyUnverified) {
          return (
            <Tooltip delay={300}>
              <Tooltip.Trigger className="cursor-help border-b border-dashed border-[var(--muted)] text-xs text-[var(--muted)]">
                {t("detail.budgetNotVerified")}
              </Tooltip.Trigger>
              <Tooltip.Content className="max-w-[280px]">{t("plansPage.budgetNotVerifiedTooltip")}</Tooltip.Content>
            </Tooltip>
          );
        }
        return <bdi dir="ltr" className="whitespace-nowrap text-sm font-medium tabular-nums">{formatPlanBudget(p.budgetPlanned, p.currency, false, t)}</bdi>;
      } },
    { id: "progress", header: t("table.progress"), allowsSorting: true, align: "end", width: 84, headerClassName: "w-[84px]",
      cell: (p) => p.progressPct == null ? (
        <Tooltip delay={300}>
          <Tooltip.Trigger aria-label={t("plansPage.progressNoActivities")} className="cursor-help text-[var(--muted)]">—</Tooltip.Trigger>
          <Tooltip.Content>{t("plansPage.progressNoActivities")}</Tooltip.Content>
        </Tooltip>
      ) : (
        <Tooltip delay={300}>
          <Tooltip.Trigger aria-label={t("plansPage.progressAverage", { pct: p.progressPct })} className="cursor-help text-sm font-medium tabular-nums">
            <bdi dir="ltr">{p.progressPct}%</bdi>
          </Tooltip.Trigger>
          <Tooltip.Content className="text-center">
            <p>{t("plansPage.progressAverage", { pct: p.progressPct })}</p>
            {p.activitiesCount != null && <p className="opacity-80">{t("plansPage.progressBasedOn", { count: p.activitiesCount })}</p>}
          </Tooltip.Content>
        </Tooltip>
      ) },
    { id: "actions", header: <span className="sr-only">{t("table.actions")}</span>, align: "end", width: 56, pinned: "end", headerClassName: "w-[56px]",
      cell: (p) => canDelete ? <PlanActionsMenu label={t("table.actionsAria")} onDelete={() => handleDeletePlan(p)} /> : null },
  ], [t, i18n.language, canEditDrafts, continueEdit, planTypeLabel, canDelete, handleDeletePlan]);

  const pagination = (
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
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* ── Page header ────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-foreground text-xl font-semibold">
            {isActionPlans ? t("headings.actionPlans") : t("plansPage.heading")}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {isActionPlans ? t("headings.actionPlansDesc") : t("plansPage.headingDesc")}
          </p>
        </div>
        {canCreate && (
          <Button className="shrink-0" onPress={() => setCreateDialogOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            {t("createPlan")}
          </Button>
        )}
      </div>

      {/* ── Plan summary KPIs (main Plans workspace only); the status ones are filter toggles ── */}
      {!isActionPlans && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {dashLoading ? (
            [...Array(5)].map((_, i) => <Skeleton key={i} className="h-28 rounded-3xl" />)
          ) : dashError ? (
            <Card className="col-span-full px-4 py-3 text-sm text-[var(--muted)]">{t("plansPage.summaryUnavailable")}</Card>
          ) : (
            <>
              <FilterKpi icon={CalendarClock} label={t("plansPage.totalPlans")} value={extTotals?.total ?? 0} />
              <FilterKpi
                icon={FileText}
                label={t("plansPage.draftPlans")}
                value={extTotals?.draft ?? 0}
                pressed={status === "draft"}
                onToggle={() => setStatus(status === "draft" ? "all" : "draft")}
              />
              <FilterKpi
                icon={Clock}
                status={(extTotals?.awaitingApproval ?? 0) > 0 ? "warning" : undefined}
                label={t("plansPage.awaitingApproval")}
                value={extTotals?.awaitingApproval ?? 0}
                pressed={status === "awaiting_approval"}
                onToggle={() => setStatus(status === "awaiting_approval" ? "all" : "awaiting_approval")}
              />
              <FilterKpi
                icon={Activity}
                label={t("plansPage.activePlans")}
                value={extTotals?.active ?? 0}
                pressed={status === "active_group"}
                onToggle={() => setStatus(status === "active_group" ? "all" : "active_group")}
              />
              <FilterKpi
                icon={CheckCircle2}
                status="success"
                label={t("plansPage.completedPlans")}
                value={extTotals?.completed ?? 0}
                pressed={status === "completed"}
                onToggle={() => setStatus(status === "completed" ? "all" : "completed")}
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

      {/* ── Control bar: filters (start) + view switcher (end), as on Projects ── */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:basis-full">
          <div className="flex shrink-0 select-none items-center gap-1.5 text-sm font-medium text-[var(--muted)]">
            <Filter className="size-4" aria-hidden="true" />
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <SearchField
            aria-label={t("filters.searchAriaLabel")}
            value={search}
            onChange={setSearch}
            className="w-full min-w-[12rem] sm:w-[16rem]"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("filters.searchPlansByTitleOrCode")} />
              <SearchField.ClearButton aria-label={t("filters.clearSearch")} />
            </SearchField.Group>
          </SearchField>
          {!lockedType && (
            <SelectField
              aria-label={t("filters.type")}
              value={planType}
              onChange={setPlanType}
              triggerClassName="h-10 min-w-[8rem]"
              options={[{ value: "all", label: t("filters.allTypes_select") }, ...PLAN_TYPE_VALUES.map((val) => ({ value: val, label: t(`planTypes.${val}_short`) }))]}
            />
          )}
          <SelectField
            aria-label={t("filters.status")}
            value={status}
            onChange={setStatus}
            triggerClassName="h-10 min-w-[9rem]"
            options={[
              { value: "all", label: t("filters.allStatuses_select") },
              { value: "awaiting_approval", label: t("filters.awaitingApproval") },
              { value: "active_group", label: t("filters.activeIncludingInProgress") },
              ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`, { defaultValue: s }) })),
            ]}
          />
          <SelectField
            aria-label={t("table.state")}
            value={stateId}
            onChange={setStateId}
            triggerClassName="h-10 min-w-[8rem]"
            options={[{ value: "all", label: t("filters.allStates_select") }, ...(states ?? []).map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))]}
          />
          {isFiltered && (
            <Button variant="ghost" size="sm" className="shrink-0" onPress={clearFilters}>
              <X className="size-3.5" aria-hidden="true" />
              {t("filters.clearFilters")}
            </Button>
          )}
        </div>
        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
        <ViewModeSwitcher available={[...PLAN_VIEWS]} current={viewMode} onChange={setViewMode} />
      </div>

      {/* ── Plans list / views ──────────────────────────────────────────── */}
      {isLoading ? (
        <Card className="p-0">
          <div className="divide-y divide-[var(--border)]">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="flex min-h-[56px] items-center gap-4 px-6 py-3.5">
                <div className="flex flex-[3] flex-col gap-1">
                  <Skeleton className="h-4 w-48 rounded" />
                  <Skeleton className="h-3 w-20 rounded" />
                </div>
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-5 w-28 rounded-full" />
                <Skeleton className="hidden h-4 w-24 rounded md:block" />
                <Skeleton className="hidden h-4 w-24 rounded lg:block" />
                <Skeleton className="ms-auto h-4 w-20 rounded" />
              </div>
            ))}
          </div>
        </Card>
      ) : plansError ? (
        <Card className="items-center gap-3 py-12">
          <CalendarClock className="size-8 text-[var(--muted)]" aria-hidden="true" />
          <p className="text-sm font-medium text-[var(--muted)]">{t("plansPage.unableToLoad")}</p>
          <Button variant="outline" size="sm" onPress={() => window.location.reload()}>{t("plansPage.retry")}</Button>
        </Card>
      ) : viewMode === "table" ? (
        <Card className="gap-0 overflow-hidden p-0">
          <DataGrid
            aria-label={t("plansPage.ariaTable")}
            data={paginatedPlans}
            columns={columns}
            getRowId={(p) => p.id}
            onRowAction={(key) => openRecord("plan", Number(key))}
            contentClassName="min-w-[1044px] table-fixed"
            verticalAlign="middle"
            sortDescriptor={sortField === "created" ? undefined : { column: sortField, direction: sortDir === "asc" ? "ascending" : "descending" }}
            onSortChange={(d) => { setSortField(String(d.column)); setSortDir(d.direction === "ascending" ? "asc" : "desc"); }}
            renderEmptyState={() => emptyNode}
          />
          <div className="border-t border-[var(--border)]">{pagination}</div>
        </Card>
      ) : viewMode === "card" ? (
        <CardGrid items={viewRecords} empty={emptyNode} />
      ) : viewMode === "list" ? (
        <Card className="p-2">
          <ListView items={viewRecords} empty={emptyNode} />
        </Card>
      ) : viewMode === "compact" ? (
        <Card className="p-0">
          <CompactView items={viewRecords} empty={emptyNode} />
        </Card>
      ) : viewMode === "kanban" ? (
        <KanbanBoard items={viewRecords} columns={planKanbanCols} empty={emptyNode} />
      ) : viewMode === "calendar" ? (
        <Card className="p-4">
          <CalendarGrid items={viewRecords} empty={emptyNode} />
        </Card>
      ) : null}
      {!isLoading && !plansError && viewMode !== "table" && pagination}

      {/* ── Create Plan modal (replaces /plans/new full-page form) ──────── */}
      <CreatePlanRegistrationDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        defaultPlanType={lockedType}
      />

      <DeletePlanModal
        plan={deleteTarget}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => { if (deleteTarget) deleteMutation.mutate({ planId: deleteTarget.id }); }}
        isPending={deleteMutation.isPending}
      />
    </div>
  );
}
