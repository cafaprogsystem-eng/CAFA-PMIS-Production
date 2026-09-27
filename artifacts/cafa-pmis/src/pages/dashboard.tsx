import { Fragment, useState, useMemo, useEffect, Component } from "react";
import { useTranslation } from "react-i18next";
import { getStateLabel } from "@/components/state-label";
function LocalizedStateNames({
  names,
  namesAr,
  fallback = "—",
}: {
  names?: string[] | null;
  namesAr?: string[] | null;
  fallback?: string;
}) {
  const { i18n } = useTranslation();
  if (!names?.length) return <>{fallback}</>;
  return <>{names.map((name, index) => getStateLabel({ name, nameAr: namesAr?.[index] }, i18n.language)).join(", ")}</>;
}

import {
  useGetDashboardSummary,
  useGetStatePerformance,
  useGetSectorPerformance,
  useGetPendingApprovals,
  useGetBeneficiariesBreakdown,
  useGetReportsSummary,
  getGetDonorPortfolioQueryKey,
  getGetDashboardSummaryQueryKey,
  getGetSectorPerformanceQueryKey,
  type DonorPortfolioEntry,
  getGetProjectBudgetPerformanceQueryKey,
  type ProjectBudgetPerformanceEntry,
  useGetDashboardNotificationsSummary,
  useGetDashboardAttentionProjects,
  useGetDashboardLateReports,
  useListProjects,
  useListPlans,
  useListReports,
  useListDonors,
  useGetMe,
  customFetch,
  type PendingApprovals,
  type LateReport,
  type StatePerformance,
  type FollowUpProject,
  type FollowUpReasonCode,
} from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";
import {
  displayHierarchicalSectorLabel,
  useHierarchicalPerformance,
} from "@/hooks/use-hierarchical-performance";
import { useLocationContext } from "@/contexts/location-context";
import { Alert, Button as HButton, Modal, Pagination as HPagination, Spinner, Calendar, DateField, DatePicker, Card as UICard, Chip, Label as HLabel, Link as HLink, ProgressBar, SearchField, Separator as HSeparator, Skeleton as HSkeleton, Tabs, ToggleButton } from "@heroui/react";
import { KPI } from "@heroui-pro/react/kpi";
import { parseDate, type CalendarDate } from "@internationalized/date";
import { Sheet } from "@heroui-pro/react/sheet";
import { KPIGroup } from "@heroui-pro/react/kpi-group";
import { useIsMobile } from "@/hooks/use-mobile";
import { SelectField } from "@/components/select-field";
import { BarChart as ProBarChart } from "@heroui-pro/react/bar-chart";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { Segment } from "@heroui-pro/react/segment";
import { AreaChart as ProAreaChart } from "@heroui-pro/react/area-chart";
import { PieChart as ProPieChart } from "@heroui-pro/react/pie-chart";
import { ChartTooltip } from "@heroui-pro/react/chart-tooltip";
import {
  FolderKanban, Users, DollarSign, AlertTriangle, ArrowRight,
  Activity, CheckCircle2, FileText, Clock, Target,
  BarChart3, MapPin, Layers, Bell,
  Filter, X, ChevronDown, ChevronRight, MessageSquare,
  TrendingUp as TrendingUpIcon, Info, RotateCcw,
  Building2, Wallet, PiggyBank,
} from "@/components/icons";
import { Cell } from "recharts";
import { Link, useLocation } from "wouter";
import { CalendarProvider, CalendarGridCard, ScheduleCard, RemindersCard } from "@/components/calendar-widget";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { useUrlViewMode, RECORD_REGISTRY_VIEWS, type RecordRegistryView } from "@/lib/view-modes";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { ErrorState } from "@/components/ui/error-state";
import type { ErrorVariant } from "@/components/ui/error-state";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import { SECTORS } from "@/lib/sectors";
import { formatMonthLabel, formatStatusLabel } from "@/lib/format";
import { entityTypeTranslationKey } from "@/lib/notification-presentation";

/* ── Follow-Up Project types — imported from generated API client ────────
 * FollowUpReasonCode, FollowUpReason, FollowUpProject are defined in the
 * OpenAPI spec and generated into @workspace/api-client-react.
 * Use reason.code for ALL logic; reason.label is display-only.
 * ────────────────────────────────────────────────────────────────────── */

/* ── Helpers ─────────────────────────────────────────────────────────── */
const fmt = (n: number) => n?.toLocaleString() ?? "0";

function dashboardErrorVariant(error: unknown): ErrorVariant {
  const response = error as { status?: number; response?: { status?: number }; message?: string } | null;
  const status = response?.status ?? response?.response?.status;
  if (status === 400 && /dashboard_invalid_filter/i.test(response?.message ?? "")) return "warning";
  if (status === 401 || status === 403) return "permission";
  if (status != null && status >= 500) return "server";
  if (
    (typeof navigator !== "undefined" && navigator.onLine === false)
    || /network|failed to fetch|connection/i.test(response?.message ?? "")
  ) return "network";
  return "generic";
}

/**
 * DEFECT-03 fix: adaptive percentage precision.
 *   0        → "0%"
 *   0 < v < 1 → up to 2 d.p., no trailing zeros  (e.g. "0.11%", "0.5%")
 *   v >= 1   → up to 1 d.p., no trailing zeros   (e.g. "7.5%", "42%")
 *   v > 100% → preserved as-is with 1 d.p. rule
 */
function fmtPct(v: number): string {
  if (v === 0) return "0%";
  if (v > 0 && v < 1) {
    const s = v.toFixed(2).replace(/\.?0+$/, "");
    return `${s}%`;
  }
  const s = v.toFixed(1).replace(/\.?0+$/, "");
  return `${s}%`;
}

/** DEFECT-02 fix: null/undefined → "—" instead of "0%" */
const pct = (v?: number | null): string => (v == null ? "—" : fmtPct(v));

/**
 * DEFECT-05 fix: ISO-code currency formatter.
 * Returns "—" for null/undefined amount, or when currency is null (mixed).
 * Example: fmtMoney(1_250_000, "USD") → "USD 1,250,000"
 */
function fmtMoney(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount == null) return "—";
  if (!currency) return "—";
  return `${currency} ${new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(amount)}`;
}


// ROLE_LABELS kept for backward compatibility — use t("roles.*") inside components for display
const ROLE_LABELS: Record<string, string> = {
  super_admin: "System Administrator",
  executive_director: "Executive Director",
  program_manager: "Programme Manager",
  senior_program_coordinator: "Senior Programme Coordinator",
  technical_coordinator: "Technical Coordinator",
  state_office_manager: "State Manager",
  state_program_officer: "State Programme Officer",
};

const NOTIF_MODULE_META: Record<string, { icon: React.ElementType; color: string; href: string }> = {
  projects:     { icon: FolderKanban,  color: "text-blue-500",    href: "/projects"         },
  reports:      { icon: FileText,      color: "text-violet-500",  href: "/reports/project"  },
  risks:        { icon: AlertTriangle, color: "text-orange-500",  href: "/risks"            },
  plans:        { icon: BarChart3,     color: "text-teal-500",    href: "/plans"            },
  comments:     { icon: MessageSquare, color: "text-pink-500",    href: "/notifications"    },
  conversation: { icon: MessageSquare, color: "text-pink-500",    href: "/conversations"    },
  user:         { icon: Users,         color: "text-indigo-500",  href: "/users"            },
};

const NOTIF_MODULE_ENTITY_TYPES: Record<string, string> = {
  projects: "project",
  reports: "report",
  risks: "risk",
  plans: "plan",
  comments: "comment",
  conversation: "conversation",
  user: "user",
};

/* ── Section header ──────────────────────────────────────────────────── */
function SectionHeader({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-6">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold text-foreground">{title}</h2>
        {description && <p className="text-sm text-[var(--muted)] leading-relaxed">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/* ── Chart empty state ───────────────────────────────────────────────── */
function ChartEmptyState({ message, icon: Icon = BarChart3 }: { message?: string; icon?: React.ElementType }) {
  const { t } = useTranslation("dashboard");
  const resolvedMessage = message ?? t("noData");
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2.5 text-center px-6">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted/50">
        <Icon className="h-5 w-5 text-muted-foreground/30" />
      </div>
      <p className="text-xs text-muted-foreground/60 max-w-[180px] leading-relaxed">{resolvedMessage}</p>
    </div>
  );
}


/* PerformanceBadge removed — state scoring model (Excellent ≥80 / Good ≥60 / Needs Follow-Up ≥40 / Critical <40)
   is Dashboard-only and not part of approved CAFA Business Logic. */

/* ── Filter bar ──────────────────────────────────────────────────────── */
interface DashFilters { sector?: string; donor?: string; dateFrom?: string; dateTo?: string }

function safeParseDate(value?: string): CalendarDate | null {
  if (!value) return null;
  try { return parseDate(value); } catch { return null; }
}

/* One end of the dashboard date filter — HeroUI DatePicker bound to a
   YYYY-MM-DD string, so either end can be set on its own. */
function FilterDate({ value, onChange, label }: { value?: string; onChange: (v?: string) => void; label: string }) {
  const parsed = safeParseDate(value);
  return (
    <DatePicker aria-label={label} value={parsed} onChange={(d) => onChange(d ? d.toString() : undefined)} className="w-40">
      <DateField.Group fullWidth className="h-10">
        <DateField.Input>{(segment) => <DateField.Segment segment={segment} />}</DateField.Input>
        <DateField.Suffix>
          <DatePicker.Trigger>
            <DatePicker.TriggerIndicator />
          </DatePicker.Trigger>
        </DateField.Suffix>
      </DateField.Group>
      <DatePicker.Popover className="w-[22rem] max-w-[calc(100vw-2rem)]">
        <Calendar aria-label={label} className="w-full">
          <Calendar.Header>
            <Calendar.Heading />
            <Calendar.NavButton slot="previous" />
            <Calendar.NavButton slot="next" />
          </Calendar.Header>
          <Calendar.Grid>
            <Calendar.GridHeader>{(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}</Calendar.GridHeader>
            <Calendar.GridBody>{(date) => <Calendar.Cell date={date} />}</Calendar.GridBody>
          </Calendar.Grid>
        </Calendar>
      </DatePicker.Popover>
    </DatePicker>
  );
}

function FilterBar({
  filters, onChange, restrictedSectors,
}: {
  filters: DashFilters;
  onChange: (f: DashFilters) => void;
  restrictedSectors: string[] | null;
}) {
  const { t } = useTranslation("dashboard");
  const sectorList = restrictedSectors !== null ? restrictedSectors : [...SECTORS];
  const active = Object.values(filters).some(Boolean);
  // The donor filter's query-building and fail-closed "unsupported filter"
  // handling (unsupportedSecondaryFilters, in the Dashboard component below)
  // already existed, but no control ever set filters.donor — this closes
  // that gap without changing the shared fail-closed behaviour, which
  // already applies identically to Sector today.
  const { data: donorsData } = useListDonors();
  const donorList = donorsData ?? [];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">
      <div className="me-1 flex items-center gap-1.5 text-sm font-medium text-[var(--muted)]">
        <Filter className="size-4" aria-hidden="true" />
        {t("filters.filters")}
      </div>
      <HSeparator orientation="vertical" className="hidden h-5 sm:block" />

      <SelectField
        aria-label={t("filters.allSectors")}
        value={filters.sector ?? "all"}
        onChange={v => onChange({ ...filters, sector: v === "all" ? undefined : v })}
        triggerClassName="h-10 w-44"
        options={[{ value: "all", label: t("filters.allSectors") }, ...sectorList.map(sec => ({ value: sec, label: sec }))]}
      />

      <SelectField
        aria-label={t("filters.allDonors")}
        value={filters.donor ?? "all"}
        onChange={v => onChange({ ...filters, donor: v === "all" ? undefined : v })}
        triggerClassName="h-10 w-44"
        options={[{ value: "all", label: t("filters.allDonors") }, ...donorList.map(d => ({ value: d.name, label: d.name }))]}
      />

      <div className="flex items-center gap-1.5">
        <FilterDate label={t("filters.dateFrom")} value={filters.dateFrom} onChange={v => onChange({ ...filters, dateFrom: v })} />
        <span className="text-sm text-[var(--muted)]" aria-hidden="true">—</span>
        <FilterDate label={t("filters.dateTo")} value={filters.dateTo} onChange={v => onChange({ ...filters, dateTo: v })} />
      </div>

      {active && (
        <>
          <HButton variant="ghost" size="sm" className="ms-1" onPress={() => onChange({})}>
            <X className="size-3.5" aria-hidden="true" />
            {t("filters.clear")}
          </HButton>
          <Chip size="sm" variant="soft" color="accent">{t("filters.active")}</Chip>
        </>
      )}
    </div>
  );
}

/* ── Drafts In My Scope widget ───────────────────────────────────────── */
const DRAFT_ROWS = [
  { key: "projects",       href: "/projects?status=draft" },
  { key: "plans",          href: "/planning?status=draft" },
  { key: "projectReports", href: "/reports/project?status=draft" },
  { key: "activityReports", href: "/reports/activity?status=draft" },
  { key: "hqReports",      href: "/reports/hq-sector?status=draft" },
  { key: "stateReports",   href: "/reports/program-state?status=draft" },
] as const;

export function MyDraftsWidget() {
  const { t } = useTranslation("dashboard");
  const { data: draftProjects, isLoading: dpLoad, isError: dpError, error: dpFailure, refetch: refetchProjects } = useListProjects({ status: "draft" });
  const { data: draftPlans, isLoading: dplLoad, isError: dplError, error: dplFailure, refetch: refetchPlans } = useListPlans({ status: "draft" });
  const { data: draftProjectReports, isLoading: drLoad, isError: drError, error: drFailure, refetch: refetchProjectReports } = useListReports({ reportType: "project", status: "draft" });
  const { data: draftActivityReports, isLoading: daLoad, isError: daError, error: daFailure, refetch: refetchActivityReports } = useListReports({ reportType: "activity", status: "draft" });
  const { data: draftHqReports, isLoading: dhLoad, isError: dhError, error: dhFailure, refetch: refetchHqReports } = useListReports({ reportType: "hq_sector", status: "draft" });
  const { data: draftStateReports, isLoading: dsLoad, isError: dsError, error: dsFailure, refetch: refetchStateReports } = useListReports({ reportType: "program_state", status: "draft" });
  const isLoading = dpLoad || dplLoad || drLoad || daLoad || dhLoad || dsLoad;
  const draftFailure = [
    [dpError, dpFailure, refetchProjects], [dplError, dplFailure, refetchPlans],
    [drError, drFailure, refetchProjectReports], [daError, daFailure, refetchActivityReports],
    [dhError, dhFailure, refetchHqReports], [dsError, dsFailure, refetchStateReports],
  ].find(([failed]) => failed) as [boolean, unknown, () => unknown] | undefined;

  // Counts parallel DRAFT_ROWS order — all hooks unconditional above
  // useListReports now returns ReportPage, so unwrap .items for count.
  const counts = [
    draftProjects?.length              ?? 0,
    draftPlans?.length                 ?? 0,
    draftProjectReports?.items?.length ?? 0,
    draftActivityReports?.items?.length ?? 0,
    draftHqReports?.items?.length      ?? 0,
    draftStateReports?.items?.length   ?? 0,
  ];
  const total  = counts.reduce((s, c) => s + c, 0);
  return (
    <UICard>
      <UICard.Header className="gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <UICard.Title className="flex items-center gap-2 text-base">
            <Layers className="size-4 text-[var(--muted)]" aria-hidden="true" />
            {t("drafts.myDrafts")}
          </UICard.Title>
          {/* Header count — neutral; not shown while loading to avoid transient zeros */}
          {!isLoading && <Chip size="sm" variant="soft" className="tabular-nums">{total}</Chip>}
        </div>
        <UICard.Description>{t("drafts.savedDrafts")}</UICard.Description>
      </UICard.Header>
      <UICard.Content>
        {draftFailure ? (
          <ErrorState
            compact
            variant={dashboardErrorVariant(draftFailure[1])}
            title={t("queryState.loadFailedTitle")}
            description={t("queryState.partial")}
            retryLabel={t("queryState.retry")}
            onRetry={() => { void draftFailure[2](); }}
          />
        ) : isLoading ? (
          <div className="space-y-1.5" aria-hidden="true">
            {[1, 2, 3, 4, 5, 6].map(i => <HSkeleton key={i} className="h-9 rounded-xl" />)}
          </div>
        ) : (
          <div className="space-y-0.5">
            {DRAFT_ROWS.map((row, idx) => {
              const count = counts[idx];
              const label = t(`drafts.${row.key}`);
              return (
                <Link
                  key={row.key}
                  href={row.href}
                  aria-label={t("drafts.view", { count, label })}
                  className="group flex min-h-[40px] items-center justify-between rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                >
                  <span className="text-sm text-[var(--muted)] transition-colors group-hover:text-foreground">
                    {label}
                  </span>
                  {/* Neutral count — drafts are not warnings; no red/amber */}
                  <span className={`text-sm font-medium tabular-nums ${count > 0 ? "text-foreground" : "text-[var(--muted)]"}`}>
                    {count}
                  </span>
                </Link>
              );
            })}
            {/* Total Drafts row removed — count is now in the card header */}
          </div>
        )}
      </UICard.Content>
    </UICard>
  );
}

/* ── Notifications summary widget ────────────────────────────────────── */
function NotificationsSummaryWidget() {
  const { data: notifSummary, isLoading, isError, refetch } = useGetDashboardNotificationsSummary();
  const { t } = useTranslation(["dashboard", "notifications"]);
  const notificationModuleLabel = (module: string) =>
    t(entityTypeTranslationKey(NOTIF_MODULE_ENTITY_TYPES[module] ?? "unknown"), { ns: "notifications" });

  const heading = (
    <UICard.Title className="flex items-center gap-2 text-base">
      <Bell className="size-4 text-muted-foreground" aria-hidden="true" /> {t("sections.notifications")}
    </UICard.Title>
  );

  if (isLoading) return (
    <UICard>
      <UICard.Header>{heading}</UICard.Header>
      <UICard.Content>
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5 animate-pulse">
              <div className="size-8 rounded-full bg-[var(--default)] shrink-0" />
              <div className="h-3 flex-1 rounded bg-[var(--default)]" />
            </div>
          ))}
        </div>
      </UICard.Content>
    </UICard>
  );

  if (isError) return (
    <UICard>
      <UICard.Header>{heading}</UICard.Header>
      <UICard.Content>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <AlertTriangle className="size-5 text-destructive/70" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{t("errorLoading", { ns: "notifications" })}</p>
          <HButton variant="outline" size="sm" onPress={() => void refetch()}>
            {t("retry", { ns: "notifications" })}
          </HButton>
        </div>
      </UICard.Content>
    </UICard>
  );

  const totalUnread = notifSummary?.totalUnread ?? 0;
  const byModule = notifSummary?.byModule ?? [];
  const recent = notifSummary?.recent ?? [];

  return (
    <UICard className="flex flex-col">
      <UICard.Header className="flex-row items-center justify-between gap-2">
        {heading}
        {totalUnread > 0 && (
          <Chip size="sm" variant="soft" color="accent" aria-label={t("notifications.unreadCount", { count: totalUnread })}>
            {totalUnread} {t("notifications.unread")}
          </Chip>
        )}
      </UICard.Header>
      <UICard.Content className="flex flex-col flex-1 min-h-0">
        {/* Scrollable content area — caps height to prevent card growing past adjacent charts */}
        <div className="overflow-y-auto max-h-[260px] space-y-0.5 pe-0.5">
          {byModule.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <CheckCircle2 className="size-6 text-success" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">{t("notifications.allCaughtUp")}</p>
            </div>
          ) : (
            byModule.slice(0, 5).map((m: { module: string; unread: number; total: number }) => {
              const meta = NOTIF_MODULE_META[m.module] ?? { icon: Bell, color: "text-muted-foreground", href: "/notifications" };
              const Icon = meta.icon;
              return (
                <Link key={m.module} href={meta.href}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors duration-150 hover:bg-[var(--default)]">
                  <div className={`flex size-8 shrink-0 items-center justify-center rounded-full ${m.unread > 0 ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--default)] text-muted-foreground"}`}>
                    <Icon className="size-4" aria-hidden="true" />
                  </div>
                  <span className={`text-sm flex-1 font-medium truncate ${m.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                    {notificationModuleLabel(m.module)}
                  </span>
                  {m.unread > 0
                    ? <Chip size="sm" variant="primary" color="accent" className="tabular-nums" aria-label={`${m.unread} ${t("unread", { ns: "notifications" })}`}>{m.unread}</Chip>
                    : <span className="text-xs text-muted-foreground tabular-nums shrink-0">{m.total}</span>
                  }
                </Link>
              );
            })
          )}

          {recent.length > 0 && (
            <>
              <HSeparator className="my-1.5" />
              <p className="px-2 pb-0.5 pt-1 text-xs font-medium text-muted-foreground">
                {t("notifications.recentActivity")}
              </p>
              {recent.slice(0, 3).map((n: { id: number; title: string; module: string; isRead: boolean }) => {
                const meta = NOTIF_MODULE_META[n.module] ?? { href: "/notifications", icon: Bell, color: "text-muted-foreground" };
                const RIcon = meta.icon;
                return (
                  <Link key={n.id} href={meta.href ?? "/notifications"}
                    className="flex items-start gap-2.5 rounded-xl px-2 py-2 hover:bg-[var(--default)] transition-colors duration-150">
                    <div className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${!n.isRead ? "bg-[var(--accent-soft)] text-[var(--accent)]" : "bg-[var(--default)] text-muted-foreground"}`}>
                      <RIcon className="size-3" aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug line-clamp-2 ${!n.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">{notificationModuleLabel(n.module)}</p>
                    </div>
                    {!n.isRead && <div className="mt-2 size-1.5 rounded-full bg-[var(--accent)] shrink-0" aria-hidden="true" />}
                  </Link>
                );
              })}
            </>
          )}
        </div>

        {/* "View All" always visible outside scroll area */}
        <div className="pt-3 mt-auto shrink-0">
          <HLink href="/notifications" className="inline-flex items-center gap-1 text-sm">
            {t("notifications.viewAll")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
          </HLink>
        </div>
      </UICard.Content>
    </UICard>
  );
}

/* ── Operational Follow-Up ───────────────────────────────────────────── */
/* Replaces the former "Executive Insights" section. State rankings, scores,
   tiers, and classified thresholds (Excellent/Good/Needs Follow-Up/Critical)
   have been removed — they were Dashboard-only and are not part of approved
   CAFA Business Logic. Only factual operational counts are shown. */

type OFUTone = "default" | "accent" | "danger" | "warning";
type OFUTile = {
  label:     string;
  sub:       string;
  count:     number | undefined;
  isLoading: boolean;
  href?:     string;
  Icon:      React.ElementType;
  tone:      OFUTone;
  /** When true, fall back to the neutral tone when count === 0 */
  neutralWhenZero?: boolean;
};

const OFU_ICON_TONE: Record<OFUTone, string> = {
  default: "bg-[var(--default)] text-[var(--muted)]",
  accent:  "bg-[color-mix(in_oklab,var(--accent)_12%,transparent)] text-[var(--accent)]",
  danger:  "bg-[color-mix(in_oklab,var(--danger)_12%,transparent)] text-[var(--danger)]",
  warning: "bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-[var(--warning)]",
};

export function OperationalFollowUp({
  draftProjectCount,   isDraftProjectsLoading,
  draftReportCount,    isDraftReportsLoading,
  lateReportCount,     isLateLoading,
  criticalRiskCount,   isCriticalLoading,
  returnedReportCount, isReturnedLoading,
}: {
  draftProjectCount:    number | undefined; isDraftProjectsLoading: boolean;
  draftReportCount:     number | undefined; isDraftReportsLoading:  boolean;
  lateReportCount:      number | undefined; isLateLoading:          boolean;
  criticalRiskCount:    number | undefined; isCriticalLoading:      boolean;
  returnedReportCount:  number | undefined; isReturnedLoading:      boolean;
}) {
  const { t } = useTranslation("dashboard");
  const tiles: OFUTile[] = [
    { label: t("operationalFollowUp.draftProjects"), sub: t("drafts.savedDrafts"),
      count: draftProjectCount, isLoading: isDraftProjectsLoading,
      href: "/projects?status=draft", Icon: FolderKanban, tone: "default" },
    { label: t("operationalFollowUp.draftReports"), sub: t("drafts.savedDrafts"),
      count: draftReportCount, isLoading: isDraftReportsLoading, Icon: FileText, tone: "accent" },
    { label: t("operationalFollowUp.lateReports"), sub: t("sections.overdueReportsDesc"),
      count: lateReportCount, isLoading: isLateLoading, Icon: Clock, tone: "danger", neutralWhenZero: true },
    { label: t("operationalFollowUp.criticalRisks"), sub: t("riskPanel.activeCriticalRisks"),
      count: criticalRiskCount, isLoading: isCriticalLoading, Icon: AlertTriangle, tone: "danger", neutralWhenZero: true },
    { label: t("operationalFollowUp.returnedReports"), sub: t("lateReports.returned"),
      count: returnedReportCount, isLoading: isReturnedLoading, Icon: RotateCcw, tone: "warning", neutralWhenZero: true },
  ];

  return (
    <ChartCard title={t("operationalFollowUp.title")} description={t("operationalFollowUp.description")}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
        {tiles.map(({ label, sub, count, isLoading, href, Icon, tone, neutralWhenZero }) => {
          const applied: OFUTone = neutralWhenZero && (count ?? 0) === 0 ? "default" : tone;
          const tileCls = "flex flex-col gap-3 rounded-2xl border border-[var(--border)] p-3";
          const content = (
            <>
              <div className="flex items-center gap-2">
                <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${OFU_ICON_TONE[applied]}`}>
                  <Icon className="size-4" aria-hidden="true" />
                </span>
                <span className="text-sm font-medium leading-tight text-foreground">{label}</span>
              </div>
              {count === undefined ? (
                <p className="text-xs text-[var(--muted)]">{t("operationalFollowUp.insufficientData")}</p>
              ) : (
                <p className={`text-2xl font-semibold tabular-nums leading-none ${applied === "default" ? "text-foreground" : ""}`}
                  style={applied === "default" ? undefined : { color: `var(--${applied})` }}>
                  {count.toLocaleString()}
                </p>
              )}
              <p className="text-xs leading-snug text-[var(--muted)]">{sub}</p>
            </>
          );
          const aria = `${label}: ${count ?? t("operationalFollowUp.insufficientData")}. ${sub}`;
          if (isLoading) {
            return (
              <div key={label} className={tileCls} aria-hidden="true">
                <div className="flex items-center gap-2"><HSkeleton className="size-8 rounded-lg" /><HSkeleton className="h-3.5 w-20 rounded" /></div>
                <HSkeleton className="h-6 w-10 rounded" />
                <HSkeleton className="h-3 w-28 rounded" />
              </div>
            );
          }
          return href ? (
            <Link key={label} href={href} aria-label={aria}
              className={`${tileCls} transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]`}>
              {content}
            </Link>
          ) : (
            <div key={label} role="group" aria-label={aria} className={tileCls}>
              {content}
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">{t("operationalFollowUp.categoriesNote")}</p>
    </ChartCard>
  );
}

/* ── Enhanced State Performance Table ───────────────────────────────── */
type SortableCol = "stateName" | "totalProjects" | "activeProjects" | "openRisks" | "criticalRisks" |
  "reportsSubmitted" | "reportsPending" | "activityCompletionPct" |
  "reportingCompliancePct" |
  // Donor portfolio columns
  "donorName" | "dataStatus" | "projectCount" | "allocatedBudget" | "portfolioShare" |
  // Project budget performance columns
  "projectCode" | "projectTitle" | "sector" | "budgetBasis" | "currency" |
  "spent" | "remainingBalance" | "utilisationRate" | "projectStatus";

function renderPct(pct: number | null | undefined, t: TFn): React.ReactNode {
  if (pct == null) return <span className="text-xs text-[var(--muted)]" aria-label={t("aria.dataUnavailable")}>—</span>;
  const barW = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-sm tabular-nums text-foreground" aria-label={t("aria.percent", { value: pct })}><bdi dir="ltr">{pct}%</bdi></span>
      <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--default)]" aria-hidden="true">
        <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${barW}%` }} />
      </div>
    </div>
  );
}

type StatePerfRow = {
  stateId: number; stateName: string; stateNameAr?: string | null; activeProjects: number; totalProjects?: number;
  progressPct: number; budgetUtilizationPct?: number | null; riskLevel: string;
  openRisks?: number | null; criticalRisks?: number | null;
  reportsSubmitted?: number | null; reportsPending?: number | null;
  activityCompletionPct?: number | null; reportingCompliancePct?: number | null;
};

/* ── State Implementation Overview — HeroUI Pro DataGrid ────────────── *
 * Sorting stays controlled here so null values always sort last,        *
 * whatever the direction. The State column is pinned to the inline      *
 * start so it stays visible while the metrics scroll.                   */
function StatePerformanceTable({
  states, isLoading, showAll,
}: {
  states: StatePerfRow[];
  isLoading: boolean;
  showAll: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const [sortCol, setSortCol] = useState<SortableCol>("stateName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  /* Default to covered states; hidden for state-level users who always see all their states */
  const [showCoveredOnly, setShowCoveredOnly] = useState(true);

  const sorted = useMemo(() => {
    const base = showAll
      ? states
      : showCoveredOnly
        ? states.filter(s => (s.totalProjects ?? s.activeProjects) > 0)
        : states;
    return [...base].sort((a, b) => {
      const rawA = (a as Record<string, unknown>)[sortCol];
      const rawB = (b as Record<string, unknown>)[sortCol];
      /* Null/undefined always sort last regardless of direction */
      if (rawA == null && rawB == null) return 0;
      if (rawA == null) return 1;
      if (rawB == null) return -1;
      if (typeof rawA === "string" && typeof rawB === "string") {
        return sortDir === "asc" ? rawA.localeCompare(rawB) : rawB.localeCompare(rawA);
      }
      const av = rawA as number;
      const bv = rawB as number;
      return sortDir === "asc" ? av - bv : bv - av;
    });
  }, [states, sortCol, sortDir, showAll, showCoveredOnly]);

  const columns = useMemo<DataGridColumn<StatePerfRow>[]>(() => {
    const countBadge = (n: number, color: "warning" | "danger", label?: string) => n > 0
      ? <Chip size="sm" variant="soft" color={color} className="tabular-nums" aria-label={label}>{n}</Chip>
      : <span className="tabular-nums text-[var(--muted)]">0</span>;
    const num = (n: number) => <span className="tabular-nums">{n}</span>;
    return [
      { id: "stateName", header: t("stateTable.stateColumn"), isRowHeader: true, allowsSorting: true, pinned: "start", width: 180,
        cell: (st) => {
          const name = getStateLabel({ name: st.stateName, nameAr: st.stateNameAr }, i18n.language);
          return (
            <Link href={`/states/${st.stateId}`} aria-label={t("aria.viewState", { name })}
              className="font-medium text-foreground transition-colors hover:text-[var(--accent)]">
              {name}
            </Link>
          );
        } },
      { id: "totalProjects", header: t("table.totalProjects"), align: "end", allowsSorting: true, minWidth: 110,
        cell: (st) => num(st.totalProjects ?? st.activeProjects) },
      { id: "activeProjects", header: t("table.activeProjects"), align: "end", allowsSorting: true, minWidth: 110,
        cell: (st) => num(st.activeProjects) },
      { id: "reportsSubmitted", header: t("table.reportsSubmitted"), align: "end", allowsSorting: true, minWidth: 110,
        cell: (st) => num(st.reportsSubmitted ?? 0) },
      { id: "reportsPending", header: t("table.reportsPending"), align: "end", allowsSorting: true, minWidth: 110,
        cell: (st) => countBadge(st.reportsPending ?? 0, "warning") },
      { id: "openRisks", header: t("table.openRisks"), align: "end", allowsSorting: true, minWidth: 100,
        cell: (st) => num(st.openRisks ?? 0) },
      { id: "criticalRisks", header: t("table.criticalRisks"), align: "end", allowsSorting: true, minWidth: 100,
        cell: (st) => countBadge(st.criticalRisks ?? 0, "danger", t("aria.criticalRiskCount", { count: st.criticalRisks ?? 0 })) },
      { id: "activityCompletionPct", header: t("table.activityPct"), align: "end", allowsSorting: true, minWidth: 130,
        cell: (st) => renderPct(st.activityCompletionPct, t) },
      { id: "reportingCompliancePct", header: t("table.compliancePct"), align: "end", allowsSorting: true, minWidth: 130,
        cell: (st) => renderPct(st.reportingCompliancePct, t) },
    ];
  }, [t, i18n.language]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-[var(--muted)]">{t("stateTable.sortHint")}</p>
        {!showAll && (
          <Segment
            size="sm"
            aria-label={t("aria.stateVisibility")}
            selectedKey={showCoveredOnly ? "covered" : "all"}
            onSelectionChange={(key) => setShowCoveredOnly(key === "covered")}
          >
            <Segment.Item id="covered">{t("stateTable.coveredStates")}</Segment.Item>
            <Segment.Item id="all">{t("stateTable.allStates")}</Segment.Item>
          </Segment>
        )}
      </div>
      {isLoading ? (
        <div className="flex flex-col gap-2" aria-hidden="true">
          {[1, 2, 3, 4, 5].map(i => <HSkeleton key={i} className="h-10 rounded-lg" />)}
        </div>
      ) : (
        <DataGrid
          aria-label={t("projectsTab.stateImplementationOverview")}
          data={sorted}
          columns={columns}
          getRowId={(st) => st.stateId}
          contentClassName="min-w-[900px]"
          sortDescriptor={{ column: sortCol, direction: sortDir === "asc" ? "ascending" : "descending" }}
          onSortChange={(d) => { setSortCol(d.column as SortableCol); setSortDir(d.direction === "ascending" ? "asc" : "desc"); }}
          renderEmptyState={() => (
            <div className="flex flex-col items-center gap-1 py-8 text-center">
              <p className="text-sm font-medium text-foreground">{t("stateTable.noData")}</p>
              <p className="text-xs text-[var(--muted)]">{t("stateTable.noAuthorisedStates")}</p>
              {showCoveredOnly && !showAll && (
                <HButton size="sm" variant="ghost" className="mt-2" onPress={() => setShowCoveredOnly(false)}>
                  {t("stateTable.showAllStates")}
                </HButton>
              )}
            </div>
          )}
        />
      )}
    </div>
  );
}

/* ── Approval Queue helpers (module-scope) ───────────────────────────── */
type TFn = (key: string, opts?: Record<string, unknown>) => string;

/** Maps a report's `reportType` field to a localised visible label. */
function aqRtLabel(rt: string, t: TFn): string {
  if (rt === "hq_sector")     return t("reportTypes.hqSectorReports");
  if (rt === "program_state") return t("reportTypes.stateProgrammeReports");
  if (rt === "project")       return t("reportTypes.projectReports");
  if (rt === "monthly")       return t("reportTypes.monthlyReports");
  // Graceful fallback for unexpected types
  return t("reportTypes.genericReports", { type: rt.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) });
}

/** Routes a report's `reportType` to the correct factual list destination. */
function aqRtHref(rt: string): string {
  if (rt === "hq_sector")     return "/reports/hq-sector";
  if (rt === "program_state") return "/reports/program-state";
  return "/reports/project";
}

/* ── Enhanced Approval Queue ─────────────────────────────────────────── */
const PROJECT_STATUS_CHIP: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  active: "accent", approved: "success", completed: "success", technically_approved: "success",
  coordination_approved: "success", on_hold: "warning", returned: "warning", submitted: "default",
  rejected: "danger", cancelled: "danger",
};

function ApprovalQueueWidget({
  approvals, isLoading, role,
}: {
  approvals: PendingApprovals | undefined;
  isLoading: boolean;
  role: string;
  /** @deprecated Not used — total is now derived from approvals directly for accuracy */
  pendingCount?: number;
}) {
  const { t, i18n } = useTranslation("dashboard");
  // Expand/collapse state — must be before any derived consts (hooks-before-returns rule)
  const [expanded, setExpanded] = useState(false);

  const isSeniorCoord = role === "senior_program_coordinator";
  const isTc          = role === "technical_coordinator";

  // Authoritative totals derived from the actionable dataset — never from summary estimates
  const approvalProjects = approvals?.projects ?? [];
  const approvalReports  = approvals?.reports  ?? [];
  const totalProjects    = approvalProjects.length;
  const totalReports     = approvalReports.length;
  const totalItems       = totalProjects + totalReports;

  // Report type breakdown derived from the actionable reports list (must equal totalReports)
  const reportBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const r of approvalReports) {
      const rt = r.reportType ?? "project";
      counts[rt] = (counts[rt] ?? 0) + 1;
    }
    const entries = Object.entries(counts)
      .map(([rt, count]) => ({ rt, count }))
      .sort((a, b) => b.count - a.count);
    // Data-integrity guard: breakdown sum must equal totalReports
    const sum = entries.reduce((acc, e) => acc + e.count, 0);
    if (sum !== totalReports) {
      console.warn(
        `[ApprovalQueue] Report breakdown sum (${sum}) ≠ totalReports (${totalReports}). ` +
        "An unexpected reportType value may be present.",
      );
    }
    return entries;
  }, [approvals]); // eslint-disable-line react-hooks/exhaustive-deps

  const hasProjects = totalProjects > 0;
  const hasReports  = totalReports  > 0;
  const isEmpty     = !hasProjects && !hasReports;

  // Default visible: 4 projects + 4 reports. Show All reveals the full queue.
  const hasMore        = totalItems > 8;
  const visibleProjects = expanded ? approvalProjects : approvalProjects.slice(0, 4);
  const visibleReports  = expanded ? approvalReports  : approvalReports.slice(0, 4);

  const titleKey = isSeniorCoord ? "coordinationQueue" : isTc ? "reviewQueue" : "approvalQueue.title";

  return (
    <UICard>
      <UICard.Header className="gap-0.5">
        <div className="flex items-center justify-between gap-2">
          <UICard.Title className="text-base">{t(titleKey)}</UICard.Title>
          {/* Header count — only shown when data is available to avoid transient zeros */}
          {!isLoading && (
            <Chip size="sm" variant={totalItems > 0 ? "primary" : "soft"} color={totalItems > 0 ? "accent" : "default"} className="tabular-nums">
              {totalItems}
            </Chip>
          )}
        </div>
        <UICard.Description>{t("queueSubtitle")}</UICard.Description>
      </UICard.Header>
      <UICard.Content>
        {isLoading ? (
          /* Subsection-aware skeleton — mirrors the Projects + Reports layout */
          <div className="space-y-3" aria-hidden="true">
            <div className="flex gap-2">
              <HSkeleton className="h-6 w-24 rounded-full" />
              <HSkeleton className="h-6 w-24 rounded-full" />
            </div>
            <div className="space-y-1.5">
              {[1, 2, 3, 4].map(i => <HSkeleton key={i} className="h-10 rounded-xl" />)}
            </div>
          </div>
        ) : isEmpty ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            <p className="text-sm text-muted-foreground">{t("approvalQueue.noItems")}</p>
          </div>
        ) : (
          <div>
            {/* ── Approval Summary Strip ────────────────────────────── */}
            <div className="flex items-center gap-2 mb-4">
              <Chip size="sm" variant="soft">
                {t("approvalQueue.projects")} <span className="font-semibold tabular-nums">{totalProjects}</span>
              </Chip>
              <Chip size="sm" variant="soft">
                {t("approvalQueue.reports")} <span className="font-semibold tabular-nums">{totalReports}</span>
              </Chip>
            </div>

            {/* ── Actionable Projects ───────────────────────────────── */}
            {hasProjects && (
              <div className="mb-3">
                <p className="mb-1.5 px-1 text-xs font-medium text-[var(--muted)]">
                  {t("approvalQueue.projects")}
                </p>
                <div className="space-y-0.5">
                  {visibleProjects.map(p => (
                    <Link
                      key={`p-${p.id}`}
                      href={`/projects/${p.id}`}
                      aria-label={t("aria.reviewProject", { code: p.code })}
                      className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-medium leading-none"><bdi dir="ltr">{p.code}</bdi></p>
                        <p className="mt-1 truncate text-sm text-[var(--muted)]">{p.title}</p>
                      </div>
                      <Chip size="sm" variant="soft" color={PROJECT_STATUS_CHIP[p.status] ?? "default"} className="shrink-0 whitespace-nowrap">
                        {t(`projectStatus.${p.status}`, { defaultValue: formatStatusLabel(p.status) })}
                      </Chip>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── Actionable Reports ────────────────────────────────── */}
            {hasReports && (
              <div className={hasProjects ? "mt-2 pt-2.5 border-t border-[var(--separator)]" : ""}>
                <p className="mb-1.5 px-1 text-xs font-medium text-[var(--muted)]">
                  {t("approvalQueue.reports")}
                </p>
                <div className="space-y-0.5">
                  {visibleReports.map(r => (
                    <Link
                      key={`r-${r.id}`}
                      href={aqRtHref(r.reportType ?? "project")}
                      aria-label={t("aria.reviewReport", { title: r.title })}
                      className="group flex items-center justify-between gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium leading-tight">{r.title}</p>
                        {r.stateName && (
                          <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language)}</p>
                        )}
                      </div>
                      {/* Right: report type badge — more operationally useful than workflow status here */}
                      <Chip size="sm" variant="soft" className="shrink-0 whitespace-nowrap">
                        {aqRtLabel(r.reportType ?? "project", t)}
                      </Chip>
                    </Link>
                  ))}
                </div>

                {/* Report Type Breakdown — secondary compact line, below the report list.
                    Sum must equal totalReports (enforced in useMemo above). */}
                {reportBreakdown.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-[var(--separator)] px-1">
                    <p className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{t("approvalQueue.reportBreakdown")}</span>
                      {" · "}
                      {reportBreakdown.map((e, i) => (
                        <span key={e.rt}>
                          {i > 0 && " · "}
                          {aqRtLabel(e.rt, t)} {e.count}
                        </span>
                      ))}
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* ── Show All / Show Less ──────────────────────────────── */}
            {hasMore && (
              <div className="mt-3 pt-2.5 border-t border-[var(--separator)]">
                <HButton size="sm" variant="ghost" aria-expanded={expanded} onPress={() => setExpanded(prev => !prev)}>
                  {expanded ? t("approvalQueue.showLess") : t("approvalQueue.showAll", { count: totalItems })}
                </HButton>
              </div>
            )}
          </div>
        )}
      </UICard.Content>
    </UICard>
  );
}

// ── Follow-Up Projects Panel ──────────────────────────────────────────────

// ── Projects Needing Attention ────────────────────────────────────────────
/* ── Follow-Up Projects & Reports panels — module-level helpers ─────── *
 * All constants and pure functions are at module scope so they are        *
 * stable across renders and satisfy react/no-unstable-nested-components.  */

/** Operational follow-up priority. Lower number = higher urgency. */
const FOLLOW_UP_PRIORITY: Record<string, number> = {
  active_critical_risk:     0,
  overdue_risk_mitigation:  1,
  returned_report:          2,
  report_awaiting_approval: 3,
  draft_project_report:     4,
  draft_project:            5,
};

/** HeroUI Chip colour per stable follow-up reason code — severity shows on each
 *  reason, never via the card border: critical → danger, returned/overdue →
 *  warning, awaiting approval → accent, drafts → neutral. */
function followUpChipColor(code: string): "danger" | "warning" | "accent" | "default" {
  if (code === "active_critical_risk") return "danger";
  if (code === "returned_report" || code === "overdue_risk_mitigation") return "warning";
  if (code === "report_awaiting_approval") return "accent";
  return "default";
}

/** Translated, pluralised reason label; the API label is English-only. */
function followUpReasonLabel(reason: { code: string; count: number; label: string }, t: TFn): string {
  return t(`followUpReason.${reason.code}`, { count: reason.count, defaultValue: reason.count > 1 ? `${reason.count} ${reason.label}` : reason.label });
}

/** Display order for the breakdown strip: operational priority descending. */
const BREAKDOWN_ORDER: FollowUpReasonCode[] = [
  "active_critical_risk",
  "overdue_risk_mitigation",
  "returned_report",
  "report_awaiting_approval",
  "draft_project_report",
  "draft_project",
];

/** Readable plural label for each reason code in the breakdown strip.
 *  Kept separate from server-generated labels so UI copy can evolve independently. */
const BREAKDOWN_LABEL_KEY: Record<FollowUpReasonCode, string> = {
  active_critical_risk:     "breakdownLabels.activeCriticalRisks",
  overdue_risk_mitigation:  "breakdownLabels.overdueMitigationActions",
  returned_report:          "breakdownLabels.returnedReports",
  report_awaiting_approval: "breakdownLabels.reportsAwaitingApproval",
  draft_project_report:     "breakdownLabels.draftProjectReports",
  draft_project:            "breakdownLabels.draftProjects",
};

/** Human-readable label for a report type code. */
function lrTypeLabel(rt: string | null | undefined, t: TFn): string {
  if (rt === "hq_sector")     return t("reportTypes.hqSector");
  if (rt === "program_state") return t("reportTypes.stateProgramme");
  if (rt === "activity")      return t("reportTypes.activity");
  if (rt === "project")       return t("reportTypes.project");
  if (!rt)                    return t("reportTypes.report");
  return rt.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/** Route destination for a given report type. */
export function lrHref(rt: string | null | undefined, reportId?: number): string {
  const base = rt === "hq_sector"
    ? "/reports/hq-sector"
    : rt === "program_state"
      ? "/reports/program-state"
      : rt === "activity"
        ? "/reports/activity"
        : "/reports/project";
  return reportId === undefined ? base : `${base}?open=${reportId}`;
}

/** Readable workflow status label used in the report row tooltip. */
function lrStatusLabel(status: string, t: TFn): string {
  if (status === "submitted")             return t("reportStatus.submitted");
  if (status === "coordination_approved") return t("reportStatus.coordinationApproved");
  if (status === "technically_approved")  return t("reportStatus.technicallyApproved");
  return status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

/* ── Projects Requiring Follow-Up ────────────────────────────────────── */
function FollowUpProjectsPanel({
  projects, isLoading,
}: {
  projects: FollowUpProject[] | undefined;
  isLoading: boolean;
}) {
  const { t } = useTranslation("dashboard");
  // Unconditional hooks before any early return — required by Rules of Hooks
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_DEFAULT = 6;

  // Sum factual reason counts per code across all projects for the breakdown strip.
  // Categories may overlap — the sum is NOT the unique project count.
  const breakdownItems = useMemo(() => {
    if (!projects) return [];
    return BREAKDOWN_ORDER
      .map(code => {
        const total = projects.reduce((acc, p) => {
          const r = p.followUpReasons.find(fr => fr.code === code);
          return acc + (r?.count ?? 0);
        }, 0);
        return { code, total };
      })
      .filter(item => item.total > 0);
  }, [projects]);

  // Operational sort: lowest FOLLOW_UP_PRIORITY wins; project code ascending as tie-breaker.
  const sorted = useMemo(() => {
    if (!projects) return [];
    return [...projects].sort((a, b) => {
      const ap = Math.min(99, ...a.followUpReasons.map(r => FOLLOW_UP_PRIORITY[r.code] ?? 99));
      const bp = Math.min(99, ...b.followUpReasons.map(r => FOLLOW_UP_PRIORITY[r.code] ?? 99));
      if (ap !== bp) return ap - bp;
      return (a.projectCode ?? "").localeCompare(b.projectCode ?? "");
    });
  }, [projects]);

  const hasMore = sorted.length > VISIBLE_DEFAULT;
  const visible = expanded ? sorted : sorted.slice(0, VISIBLE_DEFAULT);

  return (
    <UICard>
      <UICard.Header className="gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <UICard.Title className="text-base">{t("sections.projectsNeedingAttention")}</UICard.Title>
          {!isLoading && projects !== undefined && (
            <Chip size="sm" variant="soft" className="tabular-nums">{projects.length}</Chip>
          )}
        </div>
        <UICard.Description>{t("sections.projectsNeedingAttentionDesc")}</UICard.Description>
      </UICard.Header>

      <UICard.Content>
        {isLoading ? (
          /* ── Loading skeleton ── */
          <div className="space-y-1 py-1" aria-hidden="true">
            <div className="flex flex-wrap gap-1.5 mb-3 animate-pulse">
              {[80, 104, 72].map((w, i) => (
                <div key={i} className="h-5 rounded-full bg-muted/50" style={{ width: w }} />
              ))}
            </div>
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5 animate-pulse">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-28 rounded bg-muted/50" />
                  <div className="h-3 w-44 rounded bg-muted/40" />
                </div>
                <div className="h-4 w-20 rounded-full bg-muted/40 shrink-0" />
              </div>
            ))}
          </div>
        ) : !projects || projects.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            <p className="text-sm text-muted-foreground">{t("followUp.noProjects")}</p>
          </div>
        ) : (
          <>
            {/* ── Breakdown strip ── */}
            {breakdownItems.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 mb-3 pb-3 border-b border-border/50">
                {breakdownItems.map(({ code, total }) => (
                  <Chip key={code} size="sm" variant="soft" color={followUpChipColor(code)}>
                    <span className="tabular-nums font-semibold">{total}</span>
                    <span>{t(BREAKDOWN_LABEL_KEY[code as FollowUpReasonCode])}</span>
                  </Chip>
                ))}
                {/* Overlap notice — categories may count the same project more than once */}
                <UITooltipProvider>
                  <UITooltip>
                    <UITooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex items-center rounded-full text-muted-foreground/50 hover:text-muted-foreground transition-colors px-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label={t("followUp.overlapNote")}
                      >
                        <Info className="h-3 w-3" />
                      </button>
                    </UITooltipTrigger>
                    <UITooltipContent side="top" className="max-w-[200px] text-xs">
                      {t("followUp.overlapNote")}
                    </UITooltipContent>
                  </UITooltip>
                </UITooltipProvider>
              </div>
            )}

            {/* ── Project rows ── */}
            <div className="space-y-0.5" role="list" aria-label={t("aria.projectsFollowUpList")}>
              {visible.map(p => {
                const shown = p.followUpReasons.slice(0, 2);
                const extra = p.followUpReasons.slice(2);
                return (
                  <Link
                    key={p.projectId}
                    href={`/projects/${p.projectId}`}
                    role="listitem"
                    className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                  >
                    {/* Left: code · sector / project title */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="shrink-0 font-mono text-xs font-medium text-foreground"><bdi dir="ltr">{p.projectCode}</bdi></span>
                        <span className="truncate text-xs text-[var(--muted)]">{p.sector}</span>
                      </div>
                      <p className="mt-0.5 truncate text-sm leading-snug text-foreground">{p.projectTitle}</p>
                    </div>

                    {/* Right: reason badges (up to 2) + +N More */}
                    <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[48%]">
                      {shown.map((reason, ri) => {
                        return (
                          <Chip key={ri} size="sm" variant="soft" color={followUpChipColor(reason.code)} className="whitespace-nowrap">
                            {followUpReasonLabel(reason, t)}
                          </Chip>
                        );
                      })}
                      {extra.length > 0 && (
                        <UITooltipProvider>
                          <UITooltip>
                            <UITooltipTrigger asChild>
                              <span
                                className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 leading-none cursor-default"
                                aria-label={t("aria.moreFollowUpReasons", { count: extra.length, reasons: extra.map(r => followUpReasonLabel(r, t)).join(", ") })}
                              >
                                {t("followUp.moreBadge", { count: extra.length })}
                              </span>
                            </UITooltipTrigger>
                            <UITooltipContent side="top" className="max-w-[220px] text-xs">
                              <ul className="list-disc list-inside space-y-0.5">
                                {extra.map((r, i) => (
                                  <li key={i}>{followUpReasonLabel(r, t)}</li>
                                ))}
                              </ul>
                            </UITooltipContent>
                          </UITooltip>
                        </UITooltipProvider>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>

            {/* ── Show All / Show Less ── */}
            {hasMore && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <HButton size="sm" variant="ghost" onPress={() => setExpanded(prev => !prev)} aria-expanded={expanded}>
                  {expanded ? t("followUp.showLess") : t("followUp.showAll", { count: sorted.length })}
                </HButton>
              </div>
            )}
          </>
        )}
      </UICard.Content>
    </UICard>
  );
}

/* ── Reports Awaiting Approval ───────────────────────────────────────── */
function LateReportsPanel({
  reports, isLoading,
}: {
  reports: LateReport[] | undefined;
  isLoading: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  // Unconditional hooks before any early return — required by Rules of Hooks
  const [expanded, setExpanded] = useState(false);
  const VISIBLE_DEFAULT = 5;

  // Sort: days waiting descending; report title ascending as deterministic tie-breaker.
  const sorted = useMemo(() => {
    if (!reports) return [];
    return [...reports].sort((a, b) => {
      const diff = (b.daysWaiting ?? 0) - (a.daysWaiting ?? 0);
      if (diff !== 0) return diff;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });
  }, [reports]);

  const hasMore = sorted.length > VISIBLE_DEFAULT;
  const visible = expanded ? sorted : sorted.slice(0, VISIBLE_DEFAULT);

  return (
    <UICard>
      <UICard.Header className="gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <UICard.Title className="text-base">{t("sections.overdueReports")}</UICard.Title>
          {!isLoading && reports !== undefined && (
            <Chip size="sm" variant="soft" className="tabular-nums">{reports.length}</Chip>
          )}
        </div>
        <UICard.Description>{t("sections.overdueReportsDesc")}</UICard.Description>
      </UICard.Header>

      <UICard.Content>
        {isLoading ? (
          /* ── Loading skeleton ── */
          <div className="space-y-1 py-1" aria-hidden="true">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="flex items-center gap-3 rounded-lg px-3 py-2.5 animate-pulse">
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-40 rounded bg-muted/50" />
                  <div className="h-3 w-28 rounded bg-muted/40" />
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="h-4 w-16 rounded-full bg-muted/40" />
                  <div className="h-3 w-8 rounded bg-muted/40" />
                </div>
              </div>
            ))}
          </div>
        ) : !reports || reports.length === 0 ? (
          /* ── Empty state ── */
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400" />
            <p className="text-sm text-muted-foreground">
              {t("lateReports.noReports")}
            </p>
          </div>
        ) : (
          <>
            {/* ── Report rows ── */}
            <UITooltipProvider>
              <div className="space-y-0.5" role="list" aria-label={t("lateReports.awaitingApproval")}>
                {visible.map(r => {
                  const title   = r.title ?? r.projectTitle ?? t("fallbacks.untitled");
                  const context = [r.stateName ? getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language) : null, r.submittedByName].filter(Boolean).join(" · ");
                  const days    = r.daysWaiting ?? 0;
                  return (
                    <UITooltip key={r.id}>
                      <UITooltipTrigger asChild>
                        <Link
                          href={lrHref(r.reportType, r.id)}
                          role="listitem"
                          className="flex min-h-[48px] items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                        >
                          {/* Left: title / context */}
                          <div className="flex-1 min-w-0">
                            <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                              {title}
                            </p>
                            {context && (
                              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{context}</p>
                            )}
                          </div>
                          {/* Right: type badge + days awaiting (neutral colour; fact communicated by inclusion) */}
                          <div className="flex items-center gap-2 shrink-0">
                            <Chip size="sm" variant="soft" className="whitespace-nowrap">
                              {lrTypeLabel(r.reportType, t)}
                            </Chip>
                            <span
                              className="text-xs font-medium tabular-nums text-foreground/70 min-w-[28px] text-end"
                              aria-label={t("lateReports.daysAwaitingApproval", { days })}
                            >
                              {days}{t("lateReports.daysSuffix")}
                            </span>
                          </div>
                        </Link>
                      </UITooltipTrigger>
                      <UITooltipContent side="top" className="max-w-[220px] text-xs space-y-0.5">
                        <p className="font-medium leading-snug">{title}</p>
                        <p className="text-muted-foreground">{t("lateReports.statusPrefix")} {lrStatusLabel(r.status, t)}</p>
                        <p className="text-muted-foreground">{t("lateReports.daysAwaitingApproval", { days })}</p>
                      </UITooltipContent>
                    </UITooltip>
                  );
                })}
              </div>
            </UITooltipProvider>

            {/* ── Show All / Show Less ── */}
            {hasMore && (
              <div className="mt-2">
                <HButton size="sm" variant="ghost" onPress={() => setExpanded(prev => !prev)} aria-expanded={expanded}>
                  {expanded ? t("lateReports.showLess") : t("lateReports.showAll", { count: sorted.length })}
                </HButton>
              </div>
            )}
          </>
        )}

        {/* ── Footer — lightweight text links; not dominant buttons ── */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--separator)] pt-3">
          <Link href="/reports/project" className="text-sm text-[var(--muted)] transition-colors hover:text-foreground hover:underline">
            {t("queue.viewProjectReports")}
          </Link>
          <Link href="/reports/activity" className="text-sm text-[var(--muted)] transition-colors hover:text-foreground hover:underline">
            {t("queue.viewActivityReports")}
          </Link>
          <Link href="/reports/hq-sector" className="text-sm text-[var(--muted)] transition-colors hover:text-foreground hover:underline">
            {t("queue.viewHqReports")}
          </Link>
          <Link href="/reports/program-state" className="text-sm text-[var(--muted)] transition-colors hover:text-foreground hover:underline">
            {t("queue.viewStateReports")}
          </Link>
        </div>
      </UICard.Content>
    </UICard>
  );
}


/* ── Chart helpers & semantic colour tokens ──────────────────────────── */
/** Compact axis tick: 1 234 567 → 1.2M, 850 000 → 850K, 1 200 → 1.2K */
const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000)     return `${parseFloat((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
};

/* ── HeroUI ProgressBar row: label, "count (pct%)", track ─────────────── */
type ProgressColor = "default" | "accent" | "success" | "warning" | "danger";
function StatusProgressRow({ label, value, total, color, fill }: {
  label: string; value: number; total: number; color?: ProgressColor; fill?: string;
}) {
  const pctVal = total > 0 ? Math.round((value / total) * 100) : null;
  return (
    <ProgressBar
      size="sm"
      color={color ?? "accent"}
      value={pctVal ?? 0}
      valueLabel={pctVal != null ? `${fmt(value)} (${pctVal}%)` : fmt(value)}
      className="w-full gap-1.5"
    >
      <HLabel className="text-sm font-medium text-foreground">{label}</HLabel>
      <ProgressBar.Output className="text-sm tabular-nums text-[var(--muted)]" />
      <ProgressBar.Track>
        <ProgressBar.Fill style={fill ? { backgroundColor: fill } : undefined} />
      </ProgressBar.Track>
    </ProgressBar>
  );
}

/* ── HeroUI Pro horizontal bar chart (the "Horizontal" example) ───────── *
 * Mirrors for RTL: values grow from the inline start and the category    *
 * axis sits on the start side.                                           */
function HorizontalBars<T extends Record<string, unknown>>({
  data, categoryKey, bars, height = 260, categoryWidth = 90, isRtl, valueFormatter = fmt, categoryFormatter, stacked = false, tooltip, onBarClick,
}: {
  data: T[];
  categoryKey: string;
  /** colorKey: read each bar's fill from that field of its row. */
  bars: { dataKey: string; name: string; fill: string; colorKey?: string }[];
  tooltip?: React.ReactElement;
  onBarClick?: (row: T) => void;
  height?: number;
  categoryWidth?: number;
  isRtl: boolean;
  valueFormatter?: (v: number) => string;
  categoryFormatter?: (v: string) => string;
  stacked?: boolean;
}) {
  const round = (end: boolean): [number, number, number, number] =>
    !end ? [0, 0, 0, 0] : isRtl ? [24, 0, 0, 24] : [0, 24, 24, 0];
  return (
    <ProBarChart className="[&_svg]:[direction:ltr]" data={data as Record<string, number | string>[]} height={height} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 8 }}>
      <ProBarChart.Grid horizontal={false} />
      <ProBarChart.XAxis type="number" tickMargin={4} reversed={isRtl} tickFormatter={fmtCompact} allowDecimals={false} />
      <ProBarChart.YAxis
        dataKey={categoryKey} type="category" tickMargin={4} width={categoryWidth}
        orientation={isRtl ? "right" : "left"} tickFormatter={categoryFormatter}
      />
      {bars.map((b, i) => (
        <ProBarChart.Bar
          key={b.dataKey}
          dataKey={b.dataKey}
          name={b.name}
          fill={b.fill}
          barSize={stacked ? 14 : bars.length > 1 ? 8 : 14}
          radius={round(!stacked || i === bars.length - 1)}
          stackId={stacked ? "stack" : undefined}
          onClick={onBarClick ? (entry: { payload?: T }) => entry.payload && onBarClick(entry.payload) : undefined}
          className={onBarClick ? "cursor-pointer" : undefined}
        >
          {b.colorKey && data.map((row, j) => <Cell key={j} fill={String(row[b.colorKey!])} />)}
        </ProBarChart.Bar>
      ))}
      <ProBarChart.Tooltip content={tooltip ?? <ProBarChart.TooltipContent valueFormatter={(v) => valueFormatter(Number(v))} />} />
    </ProBarChart>
  );
}

/* ── Project status → display label and semantic colour ─────────────── */
function toTitleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
const STATUS_COLORS: Record<string, string> = {
  draft:                 "#94a3b8",              // slate-400  — neutral
  submitted:             "#3b82f6",              // blue-500   — informational
  coordination_approved: "#8b5cf6",              // violet-500
  technically_approved:  "#8b5cf6",              // violet-500 (same family)
  approved:              "#22c55e",              // green-500
  active:                "hsl(var(--cafa-primary))", // primary    — success/active
  completed:             "#14b8a6",              // teal-500
  on_hold:               "#f59e0b",              // amber-500
  returned:              "#f97316",              // orange-500
  closed:                "#64748b",              // slate-500
  cancelled:             "#ef4444",              // red-500
};


/* ── KPI card — HeroUI Pro KPI ("With Footer" pattern) ─────────────── *
 * Used by the Performance and Projects & States tabs, whose values are
 * already formatted strings (percent, "138 / 155", "Insufficient data"),
 * so the value renders in KPI's value slot rather than KPI.Value.          */
function kpiStatus(iconColor: string, alert: boolean): "success" | "warning" | "danger" | undefined {
  if (alert || /red/.test(iconColor)) return "danger";
  if (/amber|orange/.test(iconColor)) return "warning";
  if (/emerald|teal|green/.test(iconColor)) return "success";
  return undefined;
}

function OvKpiCard({
  icon: Icon, iconColor = "text-primary",
  label, value, sub, href, onClick, alert = false,
}: {
  icon: React.ElementType; iconColor?: string;
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  href?: string; onClick?: () => void; alert?: boolean;
}) {
  const { t } = useTranslation("common");
  return (
    <KPI className="h-full justify-start">
      <KPI.Header>
        <KPI.Icon status={kpiStatus(iconColor, alert)}><Icon aria-hidden="true" /></KPI.Icon>
        <KPI.Title>{label}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        <dd className="kpi__value tabular-nums">{value ?? "—"}</dd>
      </KPI.Content>
      {(sub || href || onClick) && (
        <KPI.Footer className="mt-auto flex flex-col items-start gap-1">
          {sub && <span className="text-sm text-muted-foreground">{sub}</span>}
          {href && <HLink href={href} className="inline-flex items-center gap-1 text-sm" aria-label={`${t("view")} — ${label}`}>{t("view")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" /></HLink>}
          {!href && onClick && <HLink onPress={onClick} className="inline-flex items-center gap-1 text-sm" aria-label={`${t("view")} — ${label}`}>{t("view")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" /></HLink>}
        </KPI.Footer>
      )}
    </KPI>
  );
}

/* ── Projects & States tab — KPI card skeleton ───────────────────────── */
function PsKpiSkeleton() {
  return (
    <UICard className="min-h-[150px] gap-3" aria-hidden="true">
      <div className="flex items-center gap-2"><HSkeleton className="size-8 rounded-lg" /><HSkeleton className="h-4 w-28 rounded" /></div>
      <HSkeleton className="h-7 w-16 rounded" />
      <HSkeleton className="mt-auto h-3 w-36 rounded" />
    </UICard>
  );
}

/* ── Projects & States tab — "Insufficient Data" node ────────────────── */
function PsInsufficient() {
  const { t } = useTranslation("dashboard");
  return (
    <span className="text-[14px] font-normal text-muted-foreground/70 italic leading-snug">
      {t("performance.insufficientData")}
    </span>
  );
}
const PS_INSUFFICIENT = <PsInsufficient />;

/* ── Priority Actions Panel ─────────────────────────────────────────── */
function PriorityActionsPanel({
  lateReports, approvals, attentionProjects, isLoading,
}: {
  lateReports: LateReport[] | undefined;
  approvals: PendingApprovals | undefined;
  attentionProjects: FollowUpProject[] | undefined;
  isLoading: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const items = useMemo(() => {
    type PItem = {
      id: string; title: string; typeLabel: string; meta: string;
      statusLabel: string; statusColor: "danger" | "warning"; href: string; urgency: number;
    };
    const result: PItem[] = [];

    // Overdue reports — highest urgency
    for (const r of (lateReports ?? []).slice(0, 3)) {
      result.push({
        id: `lr-${r.id}`,
        title: r.title ?? r.projectTitle ?? t("fallbacks.untitledReport"),
        typeLabel: t("priorityActions.typeReport"),
        meta: r.daysWaiting != null ? t("priorityActions.daysOverdue", { count: r.daysWaiting }) : (r.stateName ? getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language) : ""),
        statusLabel: t("priorityActions.statusOverdue"),
        statusColor: "danger",
        href: lrHref(r.reportType, r.id),
        urgency: 1,
      });
    }

    // Projects with critical risks — use reason.code (stable) and reason.count for display
    for (const p of (attentionProjects ?? [])
      .filter(p => p.followUpReasons.some(r => r.code === "active_critical_risk"))
      .slice(0, 2)
    ) {
      const critCount = p.followUpReasons.find(r => r.code === "active_critical_risk")?.count ?? 1;
      result.push({
        id: `cr-${p.projectId}`,
        title: p.projectTitle ?? p.projectCode,
        typeLabel: t("priorityActions.typeProject"),
        meta: t("priorityActions.criticalRiskCount", { count: critCount }),
        statusLabel: t("priorityActions.statusCritical"),
        statusColor: "danger",
        href: `/projects/${p.projectId}`,
        urgency: 1,
      });
    }

    // Projects awaiting approval
    for (const p of (approvals?.projects ?? []).slice(0, 2)) {
      result.push({
        id: `ap-${p.id}`,
        title: `${p.code}${p.title ? ` — ${p.title}` : ""}`,
        typeLabel: t("priorityActions.typeProject"),
        meta: (p.status ?? "").replace(/_/g, " "),
        statusLabel: t("priorityActions.statusAwaitingApproval"),
        statusColor: "warning",
        href: `/projects/${p.id}`,
        urgency: 2,
      });
    }

    // Reports awaiting review
    for (const r of (approvals?.reports ?? []).slice(0, 2)) {
      result.push({
        id: `ar-${r.id}`,
        title: r.title ?? t("fallbacks.untitledReport"),
        typeLabel: t("priorityActions.typeReport"),
        meta: r.stateName ? getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language) : "",
        statusLabel: t("priorityActions.statusAwaitingReview"),
        statusColor: "warning",
        href: lrHref(r.reportType, r.id),
        urgency: 2,
      });
    }

    // Deduplicate, sort by urgency, take top 5
    const seen = new Set<string>();
    return result
      .sort((a, b) => a.urgency - b.urgency)
      .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
      .slice(0, 5);
  }, [lateReports, approvals, attentionProjects, t, i18n.language]);

  return (
    <UICard>
      <UICard.Header className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <UICard.Title className="text-base">{t("priorityActions.title")}</UICard.Title>
          <UICard.Description>{t("priorityActions.description")}</UICard.Description>
        </div>
        {!isLoading && items.length > 0 && (
          <Chip size="sm" variant="soft" color="warning" className="tabular-nums">{items.length}</Chip>
        )}
      </UICard.Header>
      <UICard.Content>
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-3 flex-1 rounded bg-[var(--default)]" />
                <div className="h-5 w-24 rounded-full bg-[var(--default)]" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CheckCircle2 className="size-6 text-success" />
            <p className="text-sm text-muted-foreground">{t("priorityActions.empty")}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border">
              {items.map(item => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-3 py-2.5 px-2 rounded-xl hover:bg-[var(--default)] transition-colors -mx-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-sm font-medium text-foreground truncate">{item.title}</span>
                      <Chip size="sm" variant="soft" color="default">{item.typeLabel}</Chip>
                    </div>
                    {item.meta && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">{item.meta}</p>
                    )}
                  </div>
                  <Chip size="sm" variant="soft" color={item.statusColor} className="shrink-0">{item.statusLabel}</Chip>
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-border flex flex-wrap items-center gap-x-4 gap-y-1">
              <HLink href="/risks" className="inline-flex items-center gap-1 text-sm">
                {t("priorityActions.allRisks")} <ArrowRight className="size-3.5 rtl:rotate-180" />
              </HLink>
              <HLink href="/reports/project" className="inline-flex items-center gap-1 text-sm">
                {t("priorityActions.allReports")} <ArrowRight className="size-3.5 rtl:rotate-180" />
              </HLink>
              <HLink href="/projects" className="inline-flex items-center gap-1 text-sm">
                {t("priorityActions.allProjects")} <ArrowRight className="size-3.5 rtl:rotate-180" />
              </HLink>
            </div>
          </>
        )}
      </UICard.Content>
    </UICard>
  );
}

/* ── Tab configuration ───────────────────────────────────────────────── */
/* ═══════════════════════════════════════════════════════════════════════
 * MODULE-SCOPE CHART INFRASTRUCTURE
 *
 * All components below MUST remain at module scope.
 *
 * Defining them inside Dashboard (or any other parent) assigns a new
 * function identity on every parent render.  React treats each new identity
 * as a completely different component type, unmounts + remounts the entire
 * subtree on every cycle, and corrupts hook reconciliation across the tree
 * — producing the "change in order of Hooks" crash.
 *
 * At module scope the identity is stable for the lifetime of the module.
 * ═══════════════════════════════════════════════════════════════════════ */


/* ── ChartCard wrapper (consistent card + header styling) ────────────── */
/* Projects-by-state tooltip: total, and active with the non-active remainder. */
function StateBarsTooltip({ active, label, payload }: {
  active?: boolean; label?: string;
  payload?: Array<{ dataKey?: string; value?: number; color?: string; payload?: { total?: number } }>;
}) {
  const { t } = useTranslation("dashboard");
  if (!active || !payload?.length) return null;
  const total = Number(payload[0]?.payload?.total ?? 0);
  return (
    <ChartTooltip>
      <ChartTooltip.Header>{label}</ChartTooltip.Header>
      {payload.map((entry) => {
        const v = Number(entry.value ?? 0);
        const name = entry.dataKey === "total"
          ? t("stateChartTooltip.totalProjects")
          : total - v > 0 ? t("stateChartTooltip.activeWithOther", { count: fmt(total - v) }) : t("stateChartTooltip.activeProjects");
        return (
          <ChartTooltip.Item key={String(entry.dataKey)}>
            <ChartTooltip.Indicator color={entry.color} />
            <ChartTooltip.Label>{name}</ChartTooltip.Label>
            <ChartTooltip.Value>{fmt(v)}</ChartTooltip.Value>
          </ChartTooltip.Item>
        );
      })}
    </ChartTooltip>
  );
}

/* Budget & Donors summary — Pro KPI "With Footer", value is pre-formatted money. */
function BudgetKpi({ icon: Icon, status, title, value, note, progress }: {
  icon: React.ElementType;
  status?: "success" | "warning" | "danger";
  title: string;
  value: string;
  note: string;
  progress?: number | null;
}) {
  return (
    <KPI className="h-full justify-start">
      <KPI.Header>
        <KPI.Icon status={status}><Icon aria-hidden="true" /></KPI.Icon>
        <KPI.Title>{title}</KPI.Title>
      </KPI.Header>
      <KPI.Content>
        <dd className="kpi__value tabular-nums">{value}</dd>
      </KPI.Content>
      {progress != null && <KPI.Progress value={Math.min(100, Math.max(0, progress))} status={status} />}
      <KPI.Footer className="mt-auto">
        <span className="text-sm text-[var(--muted)]">{note}</span>
      </KPI.Footer>
    </KPI>
  );
}

/* ── Table pagination — HeroUI Pagination with summary and page size ─── */
function pageWindow(page: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "ellipsis")[] = [1];
  if (page > 3) out.push("ellipsis");
  for (let p = Math.max(2, page - 1); p <= Math.min(total - 1, page + 1); p++) out.push(p);
  if (page < total - 2) out.push("ellipsis");
  out.push(total);
  return out;
}

function TablePagination({
  page, pageCount, onPageChange, summary, label, pageSize, pageSizes, onPageSizeChange, pageSizeLabel,
}: {
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  summary: string;
  label: string;
  pageSize?: number;
  pageSizes?: number[];
  onPageSizeChange?: (size: number) => void;
  pageSizeLabel?: string;
}) {
  const { t } = useTranslation("dashboard");
  const { t: tc } = useTranslation("common");
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--separator)] pt-3" aria-label={label}>
      <HPagination size="sm" className="w-full flex-wrap gap-3">
        <HPagination.Summary aria-live="polite">{summary}</HPagination.Summary>
        <div className="flex items-center gap-2">
          {pageSizes && onPageSizeChange && pageSize != null && (
            <SelectField
              aria-label={pageSizeLabel}
              value={String(pageSize)}
              onChange={v => onPageSizeChange(Number(v))}
              triggerClassName="h-8 min-w-[7.5rem]"
              options={pageSizes.map(n => ({ value: String(n), label: t("budgetWorkspace.perPage", { count: n }) }))}
            />
          )}
          <HPagination.Content>
            <HPagination.Item>
              <HPagination.Previous isDisabled={page <= 1} onPress={() => onPageChange(page - 1)} aria-label={tc("previous")}>
                <HPagination.PreviousIcon className="rtl:rotate-180" />
                <span className="hidden sm:inline">{tc("previous")}</span>
              </HPagination.Previous>
            </HPagination.Item>
            {pageWindow(page, pageCount).map((p, i) => p === "ellipsis" ? (
              <HPagination.Item key={`e${i}`}><HPagination.Ellipsis /></HPagination.Item>
            ) : (
              <HPagination.Item key={p}>
                <HPagination.Link isActive={p === page} onPress={() => onPageChange(p)} className="tabular-nums">{p}</HPagination.Link>
              </HPagination.Item>
            ))}
            <HPagination.Item>
              <HPagination.Next isDisabled={page >= pageCount} onPress={() => onPageChange(page + 1)} aria-label={tc("next")}>
                <span className="hidden sm:inline">{tc("next")}</span>
                <HPagination.NextIcon className="rtl:rotate-180" />
              </HPagination.Next>
            </HPagination.Item>
          </HPagination.Content>
        </div>
      </HPagination>
    </div>
  );
}

/* ── Beneficiary breakdown — HeroUI Modal, Pro KPIGroup and DataGrid ── */
type BenRow = { male: number; female: number; boys: number; girls: number; total: number } & Record<string, unknown>;

function BeneficiaryBreakdownModal({ isOpen, onOpenChange, data, isLoading }: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  data: { summary: { male: number; female: number; boys: number; girls: number; total: number }; byState?: unknown[]; bySector?: unknown[]; byProject?: unknown[] } | undefined;
  isLoading: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const isMobile = useIsMobile();
  const numCols: DataGridColumn<BenRow>[] = (["male", "female", "boys", "girls", "total"] as const).map(k => ({
    id: k,
    header: t(k === "male" ? "beneficiaries.men" : k === "female" ? "beneficiaries.women" : k === "total" ? "beneficiaries.total" : `beneficiaries.${k}`),
    align: "end", width: 110, allowsSorting: true,
    sortFn: (a, b) => a[k] - b[k],
    cell: (r) => <span className={`tabular-nums ${k === "total" ? "font-semibold" : ""}`}>{fmt(r[k])}</span>,
  }));
  const sections: { id: string; title: string; rows: BenRow[]; first: DataGridColumn<BenRow>[]; key: (r: BenRow) => string | number }[] = data ? [
    { id: "byState", title: t("beneficiaries.byState"), rows: (data.byState ?? []) as BenRow[], key: r => String(r.stateId),
      first: [{ id: "name", header: t("table.state"), isRowHeader: true, minWidth: 160, width: 180,
        cell: r => <span className="font-medium">{getStateLabel({ name: String(r.stateName ?? ""), nameAr: r.stateNameAr as string | null | undefined }, i18n.language)}</span> }] },
    { id: "bySector", title: t("beneficiaries.bySector"), rows: (data.bySector ?? []) as BenRow[], key: r => String(r.sector),
      first: [{ id: "name", header: t("beneficiaries.sectorCol"), isRowHeader: true, width: 200,
        cell: r => <span className="font-medium">{String(r.sector ?? "—")}</span> }] },
    { id: "byProject", title: t("beneficiaries.byProject"), rows: (data.byProject ?? []) as BenRow[], key: r => String(r.projectId),
      first: [
        { id: "name", header: t("beneficiaries.projectCol"), isRowHeader: true, width: 240,
          cell: r => (
            <div className="flex min-w-0 flex-col">
              <span className="truncate font-medium">{String(r.projectTitle ?? "")}</span>
              <span className="font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{String(r.projectCode ?? "")}</bdi></span>
            </div>
          ) },
        { id: "states", header: t("beneficiaries.statesCol"), width: 160,
          cell: r => <span className="text-sm"><LocalizedStateNames names={r.stateNames as string[]} namesAr={r.stateNamesAr as string[] | undefined} /></span> },
        { id: "sector", header: t("beneficiaries.sectorCol"), width: 150, cell: r => <span className="text-sm">{String(r.sector ?? "—")}</span> },
      ] },
  ] : [];

  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="max-h-[85vh] sm:max-w-5xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading>{t("beneficiaries.dialogTitle")}</Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("beneficiaries.dialogSubtitle")}</p>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-6 overflow-y-auto">
              {isLoading || !data ? (
                <div className="flex h-40 items-center justify-center" role="status">
                  <Spinner aria-label={t("common:loading")} />
                </div>
              ) : (
                <>
                  <section className="flex flex-col gap-3">
                    <h3 className="text-sm font-semibold text-foreground">{t("beneficiaries.overallSummary")}</h3>
                    <KPIGroup orientation={isMobile ? "vertical" : "horizontal"}>
                      {[
                        { label: t("beneficiaries.men"),   value: data.summary.male },
                        { label: t("beneficiaries.women"), value: data.summary.female },
                        { label: t("beneficiaries.boys"),  value: data.summary.boys },
                        { label: t("beneficiaries.girls"), value: data.summary.girls },
                        { label: t("beneficiaries.totalBeneficiaries"), value: data.summary.total, total: true },
                      ].map((b, index) => (
                        <Fragment key={b.label}>
                          {index > 0 && <KPIGroup.Separator />}
                          <KPI>
                            <KPI.Header>
                              {b.total && <KPI.Icon status="success"><Users aria-hidden="true" /></KPI.Icon>}
                              <KPI.Title>{b.label}</KPI.Title>
                            </KPI.Header>
                            <KPI.Content><KPI.Value value={b.value} maximumFractionDigits={0} /></KPI.Content>
                          </KPI>
                        </Fragment>
                      ))}
                    </KPIGroup>
                  </section>
                  {sections.map(sec => (
                    <section key={sec.id} className="flex flex-col gap-3">
                      <h3 className="text-sm font-semibold text-foreground">{sec.title}</h3>
                      <DataGrid
                        aria-label={t("aria.beneficiaryBreakdownRegion", { section: sec.title })}
                        data={sec.rows}
                        columns={[...sec.first, ...numCols]}
                        getRowId={sec.key}
                        contentClassName={sec.id === "byProject" ? "min-w-[1100px]" : "min-w-[720px]"}
                        defaultSortDescriptor={{ column: "total", direction: "descending" }}
                        renderEmptyState={() => <p className="py-6 text-center text-sm text-[var(--muted)]">{t("chartEmpty.beneficiary")}</p>}
                      />
                    </section>
                  ))}
                </>
              )}
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

function ChartCard({
  title, description, children, colSpan, action, className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  colSpan?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  // HeroUI Card, laid out like the HeroUI Pro chart examples.
  return (
    <UICard className={`${colSpan ?? ""} ${className ?? ""}`}>
      <UICard.Header className="flex-row items-start justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <UICard.Title className="text-base">{title}</UICard.Title>
          {description && <UICard.Description>{description}</UICard.Description>}
        </div>
        {action}
      </UICard.Header>
      <UICard.Content>{children}</UICard.Content>
    </UICard>
  );
}

/* ── Risk Chart Tooltip ──────────────────────────────────────────────── *
 * Custom tooltip for the horizontal Risk chart. Shows State name,         *
 * Active Critical Risks, Active High Risks, and Combined total.           *
 * Defined at module scope to satisfy react/no-unstable-nested-components. */
function RiskChartTooltip({
  active, payload, label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey?: string; value?: number; color?: string }>;
  label?: string;
}) {
  const { t } = useTranslation("dashboard");
  if (!active || !payload?.length) return null;
  const crit = Number(payload.find(p => p.dataKey === "critRisks")?.value ?? 0);
  const high = Number(payload.find(p => p.dataKey === "highRisks")?.value ?? 0);
  return (
    <ChartTooltip>
      <ChartTooltip.Header>{label}</ChartTooltip.Header>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color="var(--danger)" />
        <ChartTooltip.Label>{t("riskPanel.activeCriticalRisks")}</ChartTooltip.Label>
        <ChartTooltip.Value>{crit}</ChartTooltip.Value>
      </ChartTooltip.Item>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color="var(--warning)" />
        <ChartTooltip.Label>{t("riskPanel.activeHighRisks")}</ChartTooltip.Label>
        <ChartTooltip.Value>{high}</ChartTooltip.Value>
      </ChartTooltip.Item>
      <div className="mt-1 flex items-center justify-between border-t border-[var(--separator)] pt-1.5">
        <span className="text-xs font-medium text-[var(--muted)]">{t("riskPanel.combined")}</span>
        <span className="text-xs font-semibold text-foreground">{crit + high}</span>
      </div>
    </ChartTooltip>
  );
}

/* ── Risk Summary Strip ──────────────────────────────────────────────── *
 * Compact 4-item factual overview strip for the Risks & Follow-Up tab.   *
 * Displays:                                                               *
 *   1. Active Critical Risks  — red when > 0, neutral when 0             *
 *   2. Active High Risks      — amber when > 0, neutral when 0           *
 *   3. States Affected        — always neutral                            *
 *   4. Overdue Mitigation Actions — amber when > 0, neutral when 0       *
 * "—" is shown when data is unavailable or failed; never converts to 0.  *
 * Defined at module scope to satisfy react/no-unstable-nested-components. */
type RiskSummaryItem = {
  key: string;
  label: string;
  value: number | null;
  Icon: React.ElementType;
  /** Pro KPI status when the count is positive; undefined = always neutral. */
  whenPositive?: "danger" | "warning";
};

function RiskSummaryStrip({
  critTotal, highTotal, statesAffected, overdueMitTotal, isLoading,
}: {
  critTotal: number | null;
  highTotal: number | null;
  statesAffected: number | null;
  overdueMitTotal: number | null;
  isLoading: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const items: RiskSummaryItem[] = [
    { key: "crit",    label: t("riskPanel.activeCriticalRisks"), value: critTotal,       Icon: AlertTriangle, whenPositive: "danger" },
    { key: "high",    label: t("riskPanel.activeHighRisks"),     value: highTotal,       Icon: AlertTriangle, whenPositive: "warning" },
    { key: "states",  label: t("riskPanel.statesAffected"),      value: statesAffected,  Icon: MapPin },
    { key: "overdue", label: t("riskPanel.overdueMitigation"),   value: overdueMitTotal, Icon: Clock,         whenPositive: "warning" },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-label={t("aria.riskOverviewLoading")} aria-busy="true">
        {[0, 1, 2, 3].map(i => <PsKpiSkeleton key={i} />)}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4" role="group" aria-label={t("aria.riskOverview")}>
      {items.map(({ key, label, value, Icon, whenPositive }) => {
        const status = whenPositive && value !== null && value > 0 ? whenPositive : undefined;
        return (
          <div key={key} role="note" aria-label={`${label}: ${value === null ? t("aria.dataUnavailable") : value}`}>
            <KPI className="h-full justify-start">
              <KPI.Header>
                <KPI.Icon status={status}><Icon aria-hidden="true" /></KPI.Icon>
                <KPI.Title>{label}</KPI.Title>
              </KPI.Header>
              <KPI.Content>
                <dd className="kpi__value tabular-nums" style={status ? { color: `var(--${status})` } : undefined}>
                  {value === null ? <span className="text-[var(--muted)]" aria-hidden="true">—</span> : value}
                </dd>
              </KPI.Content>
            </KPI>
          </div>
        );
      })}
    </div>
  );
}

/* ── Risk Horizontal Chart ───────────────────────────────────────────── *
 * Compact horizontal grouped bar chart — Active Critical and Active High  *
 * Risks per authorised State.                                             *
 * - Content-aware height: ~38 px per State, min 220 px, max 360 px.      *
 * - Full State names on Y-axis; count labels at end of non-zero bars.    *
 * - Custom tooltip: State, Critical, High, Combined.                     *
 * - Empty and loading states handled internally.                         *
 * Defined at module scope — no nested JSX components.                    */
type RiskByStateEntry = { name: string; critRisks: number; highRisks: number };

function RiskHorizontalChart({
  data, isLoading, isRtl,
}: {
  data: RiskByStateEntry[];
  isLoading: boolean;
  isRtl: boolean;
}) {
  // Content-aware plot height: 38 px per state row, min 220 px, max 360 px
  const plotHeight = Math.max(220, Math.min(360, data.length * 38));
  const { t } = useTranslation("dashboard");

  return (
    <ChartCard title={t("riskPanel.riskTitle")} description={t("riskPanel.riskDesc")}>
      {isLoading ? (
        <div className="flex flex-col gap-2 py-2" aria-hidden="true">
          {[70, 55, 80, 45, 60].map((w, i) => <HSkeleton key={i} className="h-3 rounded" style={{ width: `${w}%` }} />)}
        </div>
      ) : data.length === 0 ? (
        <div style={{ height: 120 }}>
          <ChartEmptyState message={t("riskPanel.noActiveRisks")} icon={AlertTriangle} />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="sr-only">{t("riskPanel.chartSummary", { count: data.length })}</p>
          <ChartLegend items={[
            { label: t("riskPanel.activeCriticalRisks"), color: "var(--danger)" },
            { label: t("riskPanel.activeHighRisks"),     color: "var(--warning)" },
          ]} />
          <div aria-hidden="true">
            <HorizontalBars
              data={data}
              categoryKey="name"
              categoryWidth={132}
              height={plotHeight}
              isRtl={isRtl}
              bars={[
                { dataKey: "critRisks", name: t("riskPanel.activeCriticalRisks"), fill: "var(--danger)" },
                { dataKey: "highRisks", name: t("riskPanel.activeHighRisks"),     fill: "var(--warning)" },
              ]}
              tooltip={<RiskChartTooltip />}
            />
          </div>
        </div>
      )}
    </ChartCard>
  );
}

/* ── Monthly Achievement Trend ───────────────────────────────────────── */
type MonthlyAchievementEntry = { month: string; achieved: number; target: number };

function MonthlyTrendChart({
  monthlyData, height, gradientSuffix, isLoading,
  titleKey = "sections.monthlyTrend",
  descriptionKey = "sections.monthlyTrendDesc",
  emptyMessageKey = "noData",
}: {
  monthlyData: MonthlyAchievementEntry[] | undefined;
  height: number;
  gradientSuffix: string;
  isLoading?: boolean;
  titleKey?: string;
  descriptionKey?: string;
  emptyMessageKey?: string;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const entries = monthlyData ?? [];
  const monthLabel = (value: string | number) => formatMonthLabel(value, i18n.language);
  const targetLabel = t("performanceTab.targetVsAchievement");
  const achievedLabel = t("performanceTab.beneficiaryPerformance");
  const showChart = !isLoading && entries.length > 0;
  return (
    <ChartCard
      colSpan="col-span-4"
      title={t(titleKey)}
      description={t(descriptionKey)}
    >
      {showChart && (
        <div className="mb-3">
          <ChartLegend items={[
            { label: achievedLabel, color: "var(--chart-3)" },
            { label: targetLabel, color: "var(--chart-1)", dashed: true },
          ]} />
        </div>
      )}
      <div style={{ height }}>
        {isLoading ? (
          <div className="h-full rounded-xl bg-[var(--default)] animate-pulse" />
        ) : entries.length === 0 ? (
          <ChartEmptyState message={t(emptyMessageKey)} />
        ) : (
          // HeroUI Pro AreaChart, as in its "Multi Area" example.
          <ProAreaChart data={entries} height={height}>
            <defs>
              <linearGradient id={`trend-achieved-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-3)" stopOpacity={0.2} />
                <stop offset="100%" stopColor="var(--chart-3)" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id={`trend-target-${gradientSuffix}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.12} />
                <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <ProAreaChart.Grid vertical={false} />
            <ProAreaChart.XAxis dataKey="month" tickMargin={8} tickFormatter={monthLabel} />
            <ProAreaChart.YAxis tickFormatter={fmtCompact} width={40} />
            <ProAreaChart.Area
              dataKey="target" name={targetLabel} type="monotone"
              stroke="var(--chart-1)" strokeWidth={2} strokeDasharray="5 3"
              fill={`url(#trend-target-${gradientSuffix})`} dot={false}
            />
            <ProAreaChart.Area
              dataKey="achieved" name={achievedLabel} type="monotone"
              stroke="var(--chart-3)" strokeWidth={2}
              fill={`url(#trend-achieved-${gradientSuffix})`} dot={false}
            />
            <ProAreaChart.Tooltip content={<SeriesTooltip labelFormatter={monthLabel} />} />
          </ProAreaChart>
        )}
      </div>
    </ChartCard>
  );
}

/* ── Chart legend + tooltips (HeroUI Pro chart examples) ──────────────── */
function ChartLegend({ items }: { items: { label: string; color: string; dashed?: boolean }[] }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {items.map((item) => (
        <div key={item.label} className="flex items-center gap-1.5">
          <span
            className="size-3 shrink-0 rounded-full"
            style={item.dashed ? { border: `2px dashed ${item.color}` } : { backgroundColor: item.color }}
            aria-hidden="true"
          />
          <span className="text-xs text-muted-foreground">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

type SeriesTooltipProps = {
  active?: boolean;
  label?: string | number;
  labelFormatter?: (label: string | number) => string;
  payload?: Array<{ dataKey?: unknown; name?: unknown; value?: unknown; color?: string; stroke?: string }>;
};

function SeriesTooltip({ active, label, payload, labelFormatter }: SeriesTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <ChartTooltip>
      <ChartTooltip.Header>{label != null && labelFormatter ? labelFormatter(label) : label}</ChartTooltip.Header>
      {payload.map((entry) => (
        <ChartTooltip.Item key={String(entry.dataKey)}>
          <ChartTooltip.Indicator color={entry.color ?? entry.stroke} />
          <ChartTooltip.Label>{String(entry.name ?? "")}</ChartTooltip.Label>
          <ChartTooltip.Value>{fmt(Number(entry.value))}</ChartTooltip.Value>
        </ChartTooltip.Item>
      ))}
    </ChartTooltip>
  );
}

type ShareTooltipProps = {
  active?: boolean;
  payload?: Array<{ name?: unknown; value?: unknown; payload?: { fill?: string; color?: string } }>;
  total: number;
};

function ShareTooltip({ active, payload, total }: ShareTooltipProps) {
  const entry = payload?.[0];
  if (!active || !entry) return null;
  const value = Number(entry.value);
  return (
    <ChartTooltip>
      <ChartTooltip.Item>
        <ChartTooltip.Indicator color={entry.payload?.color ?? entry.payload?.fill} />
        <ChartTooltip.Label>{String(entry.name ?? "")}</ChartTooltip.Label>
        <ChartTooltip.Value>{fmt(value)} ({total ? Math.round((value / total) * 100) : 0}%)</ChartTooltip.Value>
      </ChartTooltip.Item>
    </ChartTooltip>
  );
}

/* ── State Implementation Overview — local error boundary ────────────── *
 * Isolates table render failures so a broken table never replaces the     *
 * entire Dashboard with the global error page.  Other tabs and cards      *
 * remain fully operational when the table fails.                          */
class StateTableErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack: string }) {
    console.error("[StateTable] Render error:", error, info.componentStack);
  }

  handleRetry = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return <StateTableErrorFallback onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}

/* Functional fallback so the class boundary can use translated copy via the
   useTranslation hook (class components cannot call hooks directly). */
function StateTableErrorFallback({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10 text-center px-4">
      <AlertTriangle className="h-8 w-8 text-destructive/60" aria-hidden="true" />
      <div>
        <p className="text-sm font-medium text-foreground">{t("stateTableError.title")}</p>
        <p className="text-xs text-muted-foreground mt-1">
          {t("stateTableError.description")}
        </p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground shadow-sm hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
      >
        <RotateCcw className="h-3 w-3" aria-hidden="true" />
        {t("stateTableError.retry")}
      </button>
    </div>
  );
}

function BudgetDataAvailability({ row }: { row: ProjectBudgetPerformanceEntry }) {
  const { t } = useTranslation("dashboard");
  const labels = [
    row.hasBudgetData ? t("budgetWorkspace.budgetRecorded") : t("budgetWorkspace.budgetUnavailable"),
    row.hasRecordedExpenditure ? t("budgetWorkspace.expenditureRecorded") : t("budgetWorkspace.noExpenditureRecorded"),
    row.hasMissingCurrency ? t("budgetWorkspace.currencyMissing") : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="flex flex-wrap gap-1.5" aria-label={t("budgetWorkspace.dataAvailability")}>
      {labels.map(label => (
        <span
          key={label}
          className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] ${
            label.includes("unavailable") || label.includes("missing")
              ? "border-amber-200/70 bg-amber-50/40 text-amber-700 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-400"
              : "border-border/60 bg-muted/30 text-muted-foreground"
          }`}
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function ProjectBudgetCondensedDetails({
  row,
  isSpo,
  compact = false,
}: {
  row: ProjectBudgetPerformanceEntry;
  isSpo: boolean;
  compact?: boolean;
}) {
  const { t } = useTranslation("dashboard");
  const stateExpenditureUnavailable = row.missingStateExpenditure;
  const money = (amount: number | null | undefined) =>
    stateExpenditureUnavailable ? "—" : fmtMoney(amount, row.currency);

  return (
    <div className={`space-y-3 ${compact ? "pt-2" : "border-t border-border/50 pt-3"}`}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailAllocated")}</p>
          <p className="mt-0.5 tabular-nums text-foreground"><bdi dir="ltr">{fmtMoney(row.allocatedBudget, row.currency)}</bdi></p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailExpenditure")}</p>
          <p className="mt-0.5 tabular-nums text-foreground" aria-label={stateExpenditureUnavailable ? t("budgetWorkspace.stateExpenditureUnavailable") : undefined}>
            <bdi dir="ltr">{money(row.spent)}</bdi>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailRemaining")}</p>
          <p className={`mt-0.5 tabular-nums ${
            stateExpenditureUnavailable
              ? "text-muted-foreground"
              : row.remainingBalance != null && row.remainingBalance < 0
              ? "font-medium text-destructive dark:text-red-400"
              : "text-foreground"
          }`}>
            <bdi dir="ltr">{money(row.remainingBalance)}</bdi>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailUtilisation")}</p>
          <p className="mt-0.5 tabular-nums text-foreground"><bdi dir="ltr">{stateExpenditureUnavailable ? "—" : pct(row.utilisationRate)}</bdi></p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailBudgetBasis")}</p>
          <p className="mt-0.5 text-foreground">{row.budgetBasis === "State Allocation" ? t("budgetWorkspace.stateAllocation") : row.budgetBasis === "Project-Level Budget" ? t("budgetWorkspace.projectBudgetBasis") : row.budgetBasis}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailCurrency")}</p>
          <p className={`mt-0.5 ${row.hasMissingCurrency ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
            <bdi dir="ltr">{row.currency ?? t("budgetWorkspace.missingCurrency")}</bdi>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailStatus")}</p>
          <p className="mt-0.5 text-foreground">{row.projectStatus ? t(`projectStatus.${row.projectStatus}`, { defaultValue: formatStatusLabel(row.projectStatus) }) : "—"}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailStates")}</p>
          <p className="mt-0.5 text-foreground"><LocalizedStateNames names={row.stateNames} namesAr={(row as unknown as { stateNamesAr?: string[] }).stateNamesAr} /></p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailSector")}</p>
          <p className="mt-0.5 text-foreground">{row.sector ?? row.sectorNames?.join(", ") ?? "—"}</p>
        </div>
        {isSpo && row.stateAllocationAmount != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailStateAllocation")}</p>
            <p className="mt-0.5 font-medium tabular-nums text-foreground"><bdi dir="ltr">{fmtMoney(row.stateAllocationAmount, row.currency)}</bdi></p>
          </div>
        )}
        {stateExpenditureUnavailable && row.projectLevelSpent != null && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectLevelExpenditureLabel")}</p>
            <p className="mt-0.5 tabular-nums text-muted-foreground"><bdi dir="ltr">{fmtMoney(row.projectLevelSpent, row.currency)}</bdi></p>
            <p className="mt-0.5 text-[10px] leading-tight text-muted-foreground">{t("budgetWorkspace.projectLevelExpenditureNote")}</p>
          </div>
        )}
        {row.lastFinancialUpdate && (
          <div>
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailLastUpdate")}</p>
            <p className="mt-0.5 text-foreground"><bdi dir="ltr">{row.lastFinancialUpdate.slice(0, 10)}</bdi></p>
          </div>
        )}
      </div>
      <BudgetDataAvailability row={row} />
      {stateExpenditureUnavailable && (
        <p className="text-[10px] italic leading-snug text-amber-700 dark:text-amber-400">
          {t("budgetWorkspace.stateExpenditureUnavailableNote")}
        </p>
      )}
      {!stateExpenditureUnavailable && row.remainingBalance != null && row.remainingBalance < 0 && (
        <p className="text-[10px] font-medium text-destructive dark:text-red-400">{t("budgetWorkspace.projectDetailWarning")}</p>
      )}
      {(row.budgetBasis === "Project-Level Budget" && (isSpo || row.sector != null)) && (
        <p className="text-[10px] leading-snug text-muted-foreground">
          {t("budgetWorkspace.projectDetailProjectLevelNote")}
        </p>
      )}
    </div>
  );
}

function ProjectBudgetCard({
  row,
  isExpanded,
  isSpo,
  onToggleDetails,
  onOpen,
}: {
  row: ProjectBudgetPerformanceEntry;
  isExpanded: boolean;
  isSpo: boolean;
  onToggleDetails: () => void;
  onOpen: (trigger: HTMLElement | null) => void;
}) {
  const { t } = useTranslation("dashboard");
  const remNeg = row.remainingBalance != null && row.remainingBalance < 0 && !row.missingStateExpenditure;
  const unavailable = row.missingStateExpenditure;

  return (
    <UICard className="group relative flex flex-col p-0">
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
        aria-label={t("aria.viewProject", { name: row.projectTitle })}
        onClick={event => onOpen(event.currentTarget)}
      />
      <UICard.Content className="relative z-10 flex flex-1 flex-col p-4 pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-snug group-hover:text-primary">{row.projectTitle}</h3>
            <p className="mt-1 truncate font-mono text-[11px] tracking-wide text-muted-foreground">{row.projectCode}</p>
          </div>
          <Chip size="sm" variant="soft" color={PROJECT_STATUS_CHIP[row.projectStatus] ?? "default"} className="shrink-0">
            {t(`projectStatus.${row.projectStatus}`, { defaultValue: formatStatusLabel(row.projectStatus) })}
          </Chip>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{row.donorName ?? t("budgetWorkspace.unknownDonor")}</span>
          <span aria-hidden="true">·</span>
          <span>{row.currency ?? t("budgetWorkspace.missingCurrency")}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
          <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.allocated")}</p><p className="mt-0.5 font-medium tabular-nums">{fmtMoney(row.allocatedBudget, row.currency)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.spent")}</p><p className="mt-0.5 tabular-nums" aria-label={unavailable ? t("budgetWorkspace.stateExpenditureUnavailable") : undefined}>{unavailable ? "—" : fmtMoney(row.spent, row.currency)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.remainingBalance")}</p><p className={`mt-0.5 tabular-nums ${remNeg ? "font-medium text-destructive dark:text-red-400" : "text-foreground"}`}>{unavailable ? "—" : fmtMoney(row.remainingBalance, row.currency)}</p></div>
          <div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.utilisationRate")}</p><p className="mt-0.5 tabular-nums">{unavailable ? "—" : pct(row.utilisationRate)}</p></div>
        </div>
        <div className="mt-3">
          <p className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.budgetBasis")}</p>
          <p className="text-xs text-foreground">{row.budgetBasis}</p>
        </div>
        <div className="mt-3"><BudgetDataAvailability row={row} /></div>
        <div className="mt-auto flex items-center justify-between gap-2 border-t border-border/50 pt-3">
          <span className="min-w-0 truncate text-xs text-muted-foreground"><LocalizedStateNames names={row.stateNames} namesAr={(row as unknown as { stateNamesAr?: string[] }).stateNamesAr} fallback={t("budgetWorkspace.noMatchingProjects")} /></span>
          <button
            type="button"
            className="pointer-events-auto relative z-10 inline-flex min-h-8 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onToggleDetails}
            aria-expanded={isExpanded}
            aria-controls={`bp-card-detail-${row.projectId}`}
          >
            {isExpanded ? t("budgetWorkspace.hideDetails") : t("budgetWorkspace.details")}
            <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
          </button>
        </div>
        {isExpanded && (
          <div id={`bp-card-detail-${row.projectId}`} className="pointer-events-auto">
            <ProjectBudgetCondensedDetails row={row} isSpo={isSpo} />
          </div>
        )}
      </UICard.Content>
    </UICard>
  );
}

function ProjectBudgetCompactRow({
  row,
  isExpanded,
  isSpo,
  onToggleDetails,
  onOpen,
}: {
  row: ProjectBudgetPerformanceEntry;
  isExpanded: boolean;
  isSpo: boolean;
  onToggleDetails: () => void;
  onOpen: (trigger: HTMLElement | null) => void;
}) {
  const { t } = useTranslation("dashboard");
  const unavailable = row.missingStateExpenditure;
  return (
    <div className={`relative border-b last:border-b-0 ${isExpanded ? "bg-muted/20" : "hover:bg-muted/30"}`}>
      <button
        type="button"
        className="absolute inset-0 z-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        aria-label={t("aria.viewProject", { name: row.projectTitle })}
        onClick={event => onOpen(event.currentTarget)}
      />
      <div className="relative z-10 flex min-h-12 items-center gap-2 px-3 py-2 text-xs pointer-events-none">
        <span className="w-24 shrink-0 truncate font-mono text-[10px] text-muted-foreground"><bdi dir="ltr">{row.projectCode}</bdi></span>
        <span className="min-w-0 flex-1 truncate font-medium">{row.projectTitle}</span>
        <span className="hidden min-w-[9rem] truncate text-muted-foreground sm:inline">{row.donorName ?? "—"}</span>
        <span className="hidden w-24 truncate text-muted-foreground md:inline">{row.budgetBasis}</span>
        <span className="hidden w-24 text-end tabular-nums lg:inline"><bdi dir="ltr">{fmtMoney(row.allocatedBudget, row.currency)}</bdi></span>
        <span className="hidden w-24 text-end tabular-nums lg:inline" aria-label={unavailable ? t("budgetWorkspace.stateExpenditureUnavailable") : undefined}><bdi dir="ltr">{unavailable ? "—" : fmtMoney(row.spent, row.currency)}</bdi></span>
        <span className="hidden w-16 text-end tabular-nums xl:inline"><bdi dir="ltr">{unavailable ? "—" : pct(row.utilisationRate)}</bdi></span>
        <Chip size="sm" variant="soft" color={PROJECT_STATUS_CHIP[row.projectStatus] ?? "default"} className="shrink-0">{t(`projectStatus.${row.projectStatus}`, { defaultValue: formatStatusLabel(row.projectStatus) })}</Chip>
        <button
          type="button"
          className="pointer-events-auto relative z-10 inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onToggleDetails}
          aria-expanded={isExpanded}
          aria-controls={`bp-compact-detail-${row.projectId}`}
          aria-label={`${isExpanded ? t("budgetWorkspace.hideDetails") : t("budgetWorkspace.details")} ${row.projectCode}`}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
        </button>
      </div>
      {isExpanded && (
        <div id={`bp-compact-detail-${row.projectId}`} className="relative z-10 px-3 pb-3 ps-[6.5rem]">
          <ProjectBudgetCondensedDetails row={row} isSpo={isSpo} compact />
        </div>
      )}
    </div>
  );
}

/* ── Donor Portfolio ─────────────────────────────────────────────────── */
type DonorSortKey       = "donorName" | "projectCount" | "allocatedBudget" | "dataStatus" | "portfolioShare";
type DonorStatusFilterVal = "all" | "linked" | "unlinked" | "issues";

// Extended row type — server adds canonical fields on top of the legacy schema
type DonorRow = DonorPortfolioEntry & {
  donorKey:        string;
  budgetInCurrency: number | null;
  portfolioShare:  number | null;
};

function DonorStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("dashboard");
  const cfgMap: Record<string, { label: string; color: "success" | "warning" | "danger" }> = {
    linked:        { label: t("budgetWorkspace.linked"),          color: "success" },
    unlinked:      { label: t("budgetWorkspace.unlinked"),        color: "warning" },
    name_mismatch: { label: t("budgetWorkspace.dataIssues"),      color: "warning" },
    missing:       { label: t("budgetWorkspace.missingCurrency"), color: "danger"  },
  };
  const cfg = cfgMap[status];
  return (
    <Chip size="sm" variant="soft" color={cfg?.color ?? "default"} aria-label={t("aria.donorDataStatus", { status: cfg?.label ?? status })}>
      {cfg?.label ?? status}
    </Chip>
  );
}

function DonorAllocationBar({ share, label }: { share: number | null; label: string }) {
  if (share == null) return <span className="text-xs text-muted-foreground" aria-label={label}>—</span>;
  const barPct = Math.min(100, Math.max(0, share));
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <span className="tabular-nums text-xs font-medium shrink-0 w-10 text-end"><bdi dir="ltr">{pct(share)}</bdi></span>
      <div
        className="flex-1 h-1.5 rounded-full bg-[var(--default)] overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(share * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300"
          style={{ width: `${barPct}%` }}
        />
      </div>
    </div>
  );
}

function DonorProjectLinks({ row }: { row: DonorRow }) {
  const projects = row.projectList ?? [];
  return (
    <div className="flex flex-wrap gap-1.5">
      {projects.map(project => (
        <Link key={project.id} href={`/projects/${project.id}`}>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border/50 bg-card px-2 py-1 text-xs transition-colors hover:border-primary/40 hover:bg-primary/5">
            <span className="font-mono text-[10px] font-medium text-muted-foreground"><bdi dir="ltr">{project.code}</bdi></span>
            <span className="max-w-[200px] truncate text-foreground">{project.title}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

function DonorCurrencyAmounts({ row }: { row: DonorRow }) {
  const { t } = useTranslation("dashboard");
  const amounts = row.budgetByCurrency?.length
    ? row.budgetByCurrency
    : row.currency
    ? [{ currency: row.currency, allocatedBudget: row.allocatedBudget ?? row.budgetTotal, budgetSpent: row.budgetSpent }]
    : [];

  if (!amounts.length) {
    return <p className="text-xs text-muted-foreground">{t("budgetWorkspace.missingCurrency")}</p>;
  }

  return (
    <div className="space-y-1.5">
      {amounts.map(amount => (
        <div key={amount.currency} className="flex items-center justify-between gap-3 text-xs">
          <span className="font-medium text-muted-foreground">{amount.currency}</span>
          <span className="text-end tabular-nums text-foreground">
            <bdi dir="ltr">{fmtMoney(amount.allocatedBudget ?? ("budgetTotal" in amount ? amount.budgetTotal : null), amount.currency)}</bdi>
          </span>
          <span className="text-end tabular-nums text-muted-foreground">
            {amount.budgetSpent == null ? t("budgetWorkspace.stateExpenditureUnavailable") : <bdi dir="ltr">{`${t("budgetWorkspace.spent")} ${fmtMoney(amount.budgetSpent, amount.currency)}`}</bdi>}
          </span>
        </div>
      ))}
    </div>
  );
}

function DonorPortfolioCard({
  row,
  effectiveCurrency,
  isExpanded,
  onToggleDetails,
}: {
  row: DonorRow;
  effectiveCurrency: string | null;
  isExpanded: boolean;
  onToggleDetails: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const displayName = row.donorName ?? row.donor ?? t("budgetWorkspace.unknownDonor");
  const projectCount = row.projectCount ?? row.projects ?? 0;
  const projects = row.projectList ?? [];
  return (
    <UICard className="flex flex-col p-0">
      <UICard.Content className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-snug">{displayName}</h3>
            {row.freeTextDonorName && row.dataStatus === "name_mismatch" && (
              <p className="mt-1 truncate text-[10px] text-muted-foreground">Source value: {row.freeTextDonorName}</p>
            )}
          </div>
          <DonorStatusBadge status={row.dataStatus ?? "unlinked"} />
        </div>
        <div className="mt-4">
          <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.portfolioByCurrency")}</p>
          <DonorCurrencyAmounts row={row} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/50 pt-3 text-xs">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.fundedProjects")}</p>
            <p className="mt-0.5 font-medium text-foreground"><bdi dir="ltr">{projectCount}</bdi></p>
          </div>
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.portfolioShare")} {effectiveCurrency ? `(${effectiveCurrency})` : ""}</p>
            <div className="mt-1">
              <DonorAllocationBar share={row.portfolioShare} label={`${displayName} portfolio share`} />
            </div>
          </div>
        </div>
        {row.dataIssues?.length ? (
          <p className="mt-3 text-[10px] text-amber-700 dark:text-amber-400">
            {t("donorCommon.dataQuality")} {row.dataIssues.join(", ").replaceAll("_", " ")}
          </p>
        ) : null}
        {projects.length > 0 && (
          <div className="mt-auto pt-3">
            <button
              type="button"
              className="inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onToggleDetails}
              aria-expanded={isExpanded}
              aria-controls={`donor-card-detail-${row.donorKey}`}
            >
              {isExpanded ? t("budgetWorkspace.hideProjects") : `${t("budgetWorkspace.showProjects")} (${projectCount})`}
              <ChevronDown className={`h-3 w-3 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
            </button>
            {isExpanded && (
              <div id={`donor-card-detail-${row.donorKey}`} className="mt-2 border-t border-border/50 pt-3">
                <DonorProjectLinks row={row} />
              </div>
            )}
          </div>
        )}
      </UICard.Content>
    </UICard>
  );
}

function DonorPortfolioCompactRow({
  row,
  effectiveCurrency,
  isExpanded,
  onToggleDetails,
}: {
  row: DonorRow;
  effectiveCurrency: string | null;
  isExpanded: boolean;
  onToggleDetails: () => void;
}) {
  const { t } = useTranslation("dashboard");
  const displayName = row.donorName ?? row.donor ?? t("budgetWorkspace.unknownDonor");
  const projectCount = row.projectCount ?? row.projects ?? 0;
  const projects = row.projectList ?? [];
  const currencySummary = row.budgetByCurrency?.length
    ? row.budgetByCurrency.map(amount => fmtMoney(amount.allocatedBudget ?? amount.budgetTotal, amount.currency)).join(" · ")
    : row.currency ? fmtMoney(row.allocatedBudget ?? row.budgetTotal, row.currency) : "—";
  return (
    <div className={`border-b last:border-b-0 ${isExpanded ? "bg-muted/20" : "hover:bg-muted/30"}`}>
      <div className="flex min-h-12 items-center gap-2 px-3 py-2 text-xs">
        <span className="min-w-0 flex-1 truncate font-medium">{displayName}</span>
        <DonorStatusBadge status={row.dataStatus ?? "unlinked"} />
        <span className="hidden w-20 text-end text-muted-foreground sm:inline">{t("budgetWorkspace.projectCount", { count: projectCount })}</span>
        <span className="hidden max-w-[18rem] flex-1 truncate text-end tabular-nums text-muted-foreground md:inline"><bdi dir="ltr">{currencySummary}</bdi></span>
        <span className="hidden w-32 lg:inline">
          <DonorAllocationBar share={row.portfolioShare} label={`${displayName} portfolio share${effectiveCurrency ? ` in ${effectiveCurrency}` : ""}`} />
        </span>
        {projects.length > 0 && (
          <button
            type="button"
            className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={onToggleDetails}
            aria-expanded={isExpanded}
            aria-controls={`donor-compact-detail-${row.donorKey}`}
            aria-label={`${isExpanded ? t("budgetWorkspace.hideProjects") : t("budgetWorkspace.showProjects")} ${displayName}`}
          >
            <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "" : "-rotate-90"}`} />
          </button>
        )}
      </div>
      {isExpanded && (
        <div id={`donor-compact-detail-${row.donorKey}`} className="px-3 pb-3">
          <DonorProjectLinks row={row} />
          {row.dataIssues?.length ? <p className="mt-2 text-[10px] text-amber-700 dark:text-amber-400">{t("donorCommon.dataQuality")} {row.dataIssues.join(", ").replaceAll("_", " ")}</p> : null}
        </div>
      )}
    </div>
  );
}

function DonorPortfolioSkeleton({ mode }: { mode: RecordRegistryView }) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t("aria.loadingDonorPortfolio")}>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="h-11 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />
        ))}
      </div>
      <div className="h-8 rounded-lg border border-border/40 bg-muted/20 animate-pulse" />
      {mode === "card" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="h-64 rounded-xl border border-border/60 bg-muted/10 animate-pulse" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="h-9 bg-muted/30 animate-pulse" />
          {[0, 1, 2, 3, 4].map(i => (
            <div key={i} className="h-12 border-t border-border/30 bg-muted/10 animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}

export interface DonorPortfolioTableProps {
  data:      DonorPortfolioEntry[] | undefined;
  isLoading: boolean;
  isError:   boolean;
  onRetry:   () => void;
  /** Optional controlled currency for consumers that pair the registry with external KPI cards. */
  activeCurrency?: string | null;
  onActiveCurrencyChange?: (currency: string) => void;
}


/* ── Donor Portfolio — HeroUI Pro DataGrid ───────────────────────────── *
 * Funded projects are child rows (Pro "Expandable Rows"), so the donor   *
 * column carries the expand chevron. Sorting stays controlled: numeric   *
 * columns keep nulls last whatever the direction.                        */
type DonorGridRow =
  | { id: string; kind: "donor"; row: DonorRow; children: DonorGridRow[] }
  | { id: string; kind: "project"; project: { id: number; code: string; title: string } }
  | { id: string; kind: "note"; freeText: string };

function DonorPortfolioGrid({
  rows, effectiveCurrency, sortKey, sortDir, onSort, expandedKey, onExpandedChange, emptyMessage,
}: {
  rows: DonorRow[];
  effectiveCurrency: string | null;
  sortKey: DonorSortKey;
  sortDir: "asc" | "desc";
  onSort: (key: DonorSortKey, dir: "asc" | "desc") => void;
  expandedKey: string | null;
  onExpandedChange: (key: string | null) => void;
  emptyMessage: string;
}) {
  const { t } = useTranslation("dashboard");
  const gridRows = useMemo<DonorGridRow[]>(() => rows.map(row => {
    const children: DonorGridRow[] = (row.projectList ?? []).map(p => ({ id: `${row.donorKey}:p${p.id}`, kind: "project" as const, project: p }));
    if (row.freeTextDonorName && row.dataStatus === "name_mismatch") {
      children.push({ id: `${row.donorKey}:note`, kind: "note", freeText: row.freeTextDonorName });
    }
    return { id: row.donorKey, kind: "donor", row, children };
  }), [rows]);

  const columns = useMemo<DonorGridRow extends never ? never : DataGridColumn<DonorGridRow>[]>(() => [
    { id: "donorName", header: t("budgetWorkspace.donor"), isRowHeader: true, allowsSorting: true, minWidth: 260,
      cell: (g) => {
        if (g.kind === "project") {
          return (
            <Link href={`/projects/${g.project.id}`} className="flex min-w-0 items-center gap-2 text-sm hover:text-[var(--accent)]">
              <span className="font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{g.project.code}</bdi></span>
              <span className="truncate text-foreground">{g.project.title}</span>
            </Link>
          );
        }
        if (g.kind === "note") {
          return (
            <p className="text-xs text-[var(--muted)]">
              {t("budgetWorkspace.freeTextDonorValue")}{" "}
              <span className="rounded bg-[var(--default)] px-1 font-mono">{g.freeText}</span>{" "}
              {t("budgetWorkspace.freeTextDonorMismatch")}
            </p>
          );
        }
        const name = g.row.donorName ?? g.row.donor ?? t("budgetWorkspace.unknownDonor");
        return (
          <div className="flex min-w-0 max-w-[16rem] flex-col gap-0.5" title={name}>
            <span className="line-clamp-2 break-words text-sm font-medium leading-tight text-foreground">{name}</span>
            {(g.row.dataStatus ?? "unlinked") === "unlinked" && (
              <span className="text-xs font-medium text-[var(--warning)]">{t("budgetWorkspace.unlinkedDonorRecord")}</span>
            )}
          </div>
        );
      } },
    { id: "dataStatus", header: t("budgetWorkspace.dataStatus"), allowsSorting: true, width: 130,
      cell: (g) => g.kind === "donor" ? <DonorStatusBadge status={g.row.dataStatus ?? "unlinked"} /> : null },
    { id: "projectCount", header: t("budgetWorkspace.fundedProjects"), allowsSorting: true, align: "end", width: 130,
      cell: (g) => g.kind === "donor"
        ? <span className="text-sm tabular-nums text-[var(--muted)]">{t("budgetWorkspace.projectCount", { count: g.row.projectCount ?? g.row.projects ?? 0 })}</span>
        : null },
    { id: "currency", header: t("budgetWorkspace.currency"), align: "end", width: 100,
      cell: (g) => g.kind !== "donor" ? null : g.row.currencyMixed
        ? <Chip size="sm" variant="soft" color="warning">{t("budgetWorkspace.multiple")}</Chip>
        : <span className="text-sm tabular-nums text-[var(--muted)]">{g.row.currency ?? "—"}</span> },
    { id: "allocatedBudget", header: t("budgetWorkspace.allocatedBudget"), allowsSorting: true, align: "end", minWidth: 170,
      cell: (g) => g.kind !== "donor" ? null : effectiveCurrency
        ? <span className="text-sm font-medium tabular-nums"><bdi dir="ltr">{g.row.budgetInCurrency != null ? fmtMoney(g.row.budgetInCurrency, effectiveCurrency) : "—"}</bdi></span>
        : <DonorCurrencyAmounts row={g.row} /> },
    { id: "portfolioShare", header: t("budgetWorkspace.portfolioShare"), allowsSorting: true, width: 170,
      cell: (g) => g.kind === "donor"
        ? <DonorAllocationBar share={g.row.portfolioShare} label={t("budgetWorkspace.portfolioShareOf", { donor: g.row.donorName ?? g.row.donor ?? "" })} />
        : null },
  ], [t, effectiveCurrency]);

  return (
    <DataGrid
      aria-label={t("budgetWorkspace.donorTable")}
      data={gridRows}
      columns={columns}
      getRowId={(g) => g.id}
      getChildren={(g) => (g.kind === "donor" && g.children.length > 0 ? g.children : undefined)}
      treeColumn="donorName"
      expandedKeys={expandedKey ? [expandedKey] : []}
      onExpandedChange={(keys) => {
        const next = [...keys].map(String).find(k => k !== expandedKey);
        onExpandedChange(next ?? (keys.size === 0 ? null : expandedKey));
      }}
      contentClassName="min-w-[900px]"
      sortDescriptor={{ column: sortKey, direction: sortDir === "asc" ? "ascending" : "descending" }}
      onSortChange={(d) => onSort(d.column as DonorSortKey, d.direction === "ascending" ? "asc" : "desc")}
      renderEmptyState={() => <p className="py-8 text-center text-sm text-[var(--muted)]">{emptyMessage}</p>}
    />
  );
}

export function DonorPortfolioTable({
  data, isLoading, isError, onRetry, activeCurrency, onActiveCurrencyChange,
}: DonorPortfolioTableProps) {
  const { t } = useTranslation("dashboard");
  // ── All hooks MUST be declared before any conditional return ─────────
  const [selCurrency,   setSelCurrency]   = useState<string | null>(null);
  const [sortKey,       setSortKey]       = useState<DonorSortKey>("allocatedBudget");
  const [sortDir,       setSortDir]       = useState<"asc" | "desc">("desc");
  const [search,        setSearch]        = useState("");
  const [statusFilter,  setStatusFilter]  = useState<DonorStatusFilterVal>("all");
  const [expandedDonor, setExpandedDonor] = useState<string | null>(null);
  const [showIssues,    setShowIssues]    = useState(false);
  const [donorPage,     setDonorPage]     = useState(1);
  const [donorPageSize, setDonorPageSize] = useState(5);
  const [viewMode, setViewMode] = useUrlViewMode("donorPortfolioView", RECORD_REGISTRY_VIEWS, "table");

  const allCurrencies = useMemo(() => {
    if (!data) return [] as string[];
    const seen = new Set<string>();
    for (const d of data) {
      for (const bc of d.budgetByCurrency ?? []) { if (bc.currency) seen.add(bc.currency); }
      if (d.currency) seen.add(d.currency);
    }
    return Array.from(seen).sort();
  }, [data]);

  const effectiveCurrency = useMemo(() => {
    if (activeCurrency === "all") return null;
    if (activeCurrency && allCurrencies.includes(activeCurrency)) return activeCurrency;
    return selCurrency ?? allCurrencies[0] ?? null;
  }, [activeCurrency, allCurrencies, selCurrency]);

  // Reset to page 1 when any filter or resolved local/controlled currency changes.
  useEffect(() => { setDonorPage(1); }, [search, statusFilter, effectiveCurrency]);

  // The Budget overview uses this to keep its separate KPI cards on the same
  // currency as this registry. Dashboard leaves it undefined and stays local.
  useEffect(() => {
    if (onActiveCurrencyChange && effectiveCurrency && activeCurrency !== effectiveCurrency) {
      onActiveCurrencyChange(effectiveCurrency);
    }
  }, [activeCurrency, effectiveCurrency, onActiveCurrencyChange]);

  const rowsWithBudget = useMemo((): DonorRow[] => {
    if (!data) return [];
    return data.map(d => {
      const donorKey = d.donorId != null
        ? `canonical:${d.donorId}`
        : `free:${(d.donorName ?? d.donor ?? "").toLowerCase().trim()}`;

      let budgetInCurrency: number | null = null;
      if (effectiveCurrency) {
        if (!d.currencyMixed && d.currency === effectiveCurrency) {
          budgetInCurrency = d.allocatedBudget ?? d.budgetTotal;
        } else if (d.budgetByCurrency?.length) {
          const bc = d.budgetByCurrency.find(b => b.currency === effectiveCurrency);
          if (bc) budgetInCurrency = bc.allocatedBudget ?? bc.budgetTotal;
        }
      }
      return { ...d, donorKey, budgetInCurrency, portfolioShare: null };
    });
  }, [data, effectiveCurrency]);

  const currencyTotal = useMemo(
    () => rowsWithBudget.reduce((s, r) => s + (r.budgetInCurrency ?? 0), 0),
    [rowsWithBudget],
  );

  const visibleRows = useMemo((): DonorRow[] => {
    const q = search.trim().toLowerCase();

    let rows: DonorRow[] = rowsWithBudget.map(r => ({
      ...r,
      portfolioShare: currencyTotal > 0 && r.budgetInCurrency != null
        ? (r.budgetInCurrency / currencyTotal) * 100
        : null,
    }));

    if (q) {
      rows = rows.filter(r => {
        const nameMatch = (r.donorName ?? r.donor ?? "").toLowerCase().includes(q);
        const projMatch = (r.projectList ?? []).some(
          p => p.code.toLowerCase().includes(q) || p.title.toLowerCase().includes(q),
        );
        return nameMatch || projMatch;
      });
    }

    if (statusFilter === "linked")   rows = rows.filter(r => (r.dataStatus ?? "unlinked") === "linked");
    if (statusFilter === "unlinked") rows = rows.filter(r => (r.dataStatus ?? "unlinked") === "unlinked");
    if (statusFilter === "issues")   rows = rows.filter(r => (r.dataStatus ?? "unlinked") !== "linked" || (r.dataIssues?.length ?? 0) > 0);

    const statusOrder: Record<string, number> = { linked: 0, name_mismatch: 1, unlinked: 2, missing: 3 };
    const nameOf = (r: DonorRow) => r.donorName ?? r.donor ?? "";

    return [...rows].sort((a, b) => {
      // Numeric columns: null always sorts last regardless of sort direction.
      // Do NOT compare numeric values across currencies — this sort operates
      // within the selected-currency dataset only.
      if (sortKey === "allocatedBudget" || sortKey === "portfolioShare") {
        const av = sortKey === "allocatedBudget" ? a.budgetInCurrency : a.portfolioShare;
        const bv = sortKey === "allocatedBudget" ? b.budgetInCurrency : b.portfolioShare;
        if (av == null && bv == null) return nameOf(a).localeCompare(nameOf(b));
        if (av == null) return 1;   // null → end
        if (bv == null) return -1;  // null → end
        const cmp = sortDir === "asc" ? av - bv : bv - av;
        return cmp !== 0 ? cmp : nameOf(a).localeCompare(nameOf(b));
      }
      // Non-numeric columns — apply direction at the end
      let cmp = 0;
      if (sortKey === "donorName") {
        cmp = nameOf(a).localeCompare(nameOf(b));
      } else if (sortKey === "projectCount") {
        cmp = (a.projectCount ?? a.projects ?? 0) - (b.projectCount ?? b.projects ?? 0);
      } else if (sortKey === "dataStatus") {
        cmp = (statusOrder[a.dataStatus ?? "missing"] ?? 3) - (statusOrder[b.dataStatus ?? "missing"] ?? 3);
      }
      if (cmp === 0) cmp = nameOf(a).localeCompare(nameOf(b));
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [rowsWithBudget, currencyTotal, search, statusFilter, sortKey, sortDir]);

  const summaryStats = useMemo(() => {
    if (!data) return { donors: 0, projects: 0, currencies: 0, issues: 0 };
    const projectIds  = new Set<number>();
    const currencySet = new Set<string>();
    const issueIds    = new Set<number>();
    for (const d of data) {
      for (const p of d.projectList ?? [])     projectIds.add(p.id);
      for (const bc of d.budgetByCurrency ?? []) if (bc.currency) currencySet.add(bc.currency);
      if (d.currency) currencySet.add(d.currency);
      const hasIssue = (d.dataStatus ?? "") !== "linked" || (d.dataIssues?.length ?? 0) > 0;
      if (hasIssue) for (const p of d.projectList ?? []) issueIds.add(p.id);
    }
    const projectCount = projectIds.size
      || data.reduce((s, d) => s + (d.projectCount ?? d.projects ?? 0), 0);
    return { donors: data.length, projects: projectCount, currencies: currencySet.size, issues: issueIds.size };
  }, [data]);

  const issueRows = useMemo(
    () => (data ?? []).filter(d => (d.dataStatus ?? "") !== "linked" || (d.dataIssues?.length ?? 0) > 0),
    [data],
  );


  // ── Pagination ────────────────────────────────────────────────────────
  const donorTotal = visibleRows.length;
  const donorPages = Math.max(1, Math.ceil(donorTotal / donorPageSize));
  const safePageD  = Math.min(donorPage, donorPages);
  const pagedRows  = visibleRows.slice((safePageD - 1) * donorPageSize, safePageD * donorPageSize);

  // Change page and close any expanded row that is no longer visible
  const handleDonorPageChange = (newPage: number) => {
    const sp = Math.min(Math.max(1, newPage), donorPages);
    if (expandedDonor != null) {
      const nextRows = visibleRows.slice((sp - 1) * donorPageSize, sp * donorPageSize);
      if (!nextRows.some(r => r.donorKey === expandedDonor)) setExpandedDonor(null);
    }
    setDonorPage(sp);
  };

  // ── Loading / error / empty states ──────────────────────────────────
  if (isLoading) return <DonorPortfolioSkeleton mode={viewMode as RecordRegistryView} />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <AlertTriangle className="h-7 w-7 text-destructive/50" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">{t("budgetWorkspace.donorLoadTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("budgetWorkspace.donorLoadDescription")}</p>
        </div>
        <HButton variant="secondary" size="sm" onPress={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden="true" /> {t("budgetWorkspace.retry")}
        </HButton>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-muted-foreground">
        <Building2 className="h-6 w-6 opacity-20" aria-hidden="true" />
        <p className="text-sm">{t("budgetWorkspace.noDonorData")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Currency selector — shown only when portfolio spans multiple currencies */}
      {allCurrencies.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label={t("budgetWorkspace.selectDisplayCurrency")}>
          <span className="text-xs text-[var(--muted)] select-none">{t("budgetWorkspace.displayCurrency")}</span>
          {(activeCurrency !== undefined ? ["all", ...allCurrencies] : allCurrencies).map(c => {
            const isSelected = c === "all" ? activeCurrency === "all" : effectiveCurrency === c;
            return (
              <ToggleButton
                key={c}
                size="sm"
                isSelected={isSelected}
                onChange={() => {
                  if (onActiveCurrencyChange) onActiveCurrencyChange(c);
                  else setSelCurrency(c);
                }}
              >{c === "all" ? t("budgetWorkspace.allCurrencies") : c}</ToggleButton>
            );
          })}
          <span className="w-full text-xs text-[var(--muted)]">{t("budgetWorkspace.selectedCurrencyNote")}</span>
        </div>
      )}

      {/* Summary strip */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={t("budgetWorkspace.donorSummary")}>
        {[
          { label: t("budgetWorkspace.donorsRepresented"), value: summaryStats.donors,     warn: false },
          { label: t("budgetWorkspace.fundedProjects"),    value: summaryStats.projects,   warn: false },
          { label: t("budgetWorkspace.currenciesInUse"),  value: summaryStats.currencies, warn: false },
          { label: t("budgetWorkspace.donorDataIssues"),  value: summaryStats.issues,     warn: summaryStats.issues > 0 },
        ].map(stat => (
          <div key={stat.label} className="flex flex-col-reverse gap-1 rounded-xl bg-[var(--default)] px-3 py-2.5">
            <dt className="text-xs text-[var(--muted)]">{stat.label}</dt>
            <dd className="text-xl font-semibold tabular-nums leading-none" style={{ color: stat.warn ? "var(--warning)" : "var(--foreground)" }}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Data quality notice */}
      {issueRows.length > 0 && (
        <Alert status="warning">
          <Alert.Indicator><Info className="size-4" aria-hidden="true" /></Alert.Indicator>
          <Alert.Content>
            <Alert.Description>
              {t("budgetWorkspace.donorIssueNotice")}{" "}
              <span className="font-medium">{t("budgetWorkspace.projectsAffected", { count: summaryStats.issues })}</span>
            </Alert.Description>
          </Alert.Content>
          <HButton size="sm" variant="ghost" className="shrink-0" onPress={() => setShowIssues(true)}>
            {t("budgetWorkspace.reviewDetails")}
          </HButton>
        </Alert>
      )}

      {/* Projects-style registry toolbar: controls at the logical start, presentation at the end. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5" role="group" aria-label={t("budgetWorkspace.donorToolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--muted)] select-none">
            <Filter className="size-4" aria-hidden="true" />
            {t("common:filter")}
          </div>
          <HSeparator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <SearchField value={search} onChange={setSearch} aria-label={t("budgetWorkspace.searchDonors")} className="min-w-[14rem] flex-1">
            <SearchField.Group className="w-full">
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("budgetWorkspace.searchDonors")} className="h-10" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <Segment
            size="sm"
            aria-label={t("budgetWorkspace.filterDataStatus")}
            selectedKey={statusFilter}
            onSelectionChange={(key) => setStatusFilter(key as DonorStatusFilterVal)}
            className="shrink-0"
          >
            <Segment.Item id="all">{t("budgetWorkspace.allRecords")}</Segment.Item>
            <Segment.Item id="linked">{t("budgetWorkspace.linked")}</Segment.Item>
            <Segment.Item id="unlinked">{t("budgetWorkspace.unlinked")}</Segment.Item>
            <Segment.Item id="issues">{t("budgetWorkspace.dataIssues")}</Segment.Item>
          </Segment>
        </div>
        <HSeparator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
        <div className="shrink-0" aria-label={t("budgetWorkspace.donorView")}>
          <ViewModeSwitcher
            available={[...RECORD_REGISTRY_VIEWS]}
            current={viewMode}
            onChange={setViewMode}
          />
        </div>
      </div>

      {/* Analytical table remains the baseline; card and compact modes consume the
          same filtered, sorted and paginated donor rows. */}
      {viewMode === "table" ? (
        <DonorPortfolioGrid
          rows={pagedRows}
          effectiveCurrency={effectiveCurrency}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key, dir) => { setSortKey(key); setSortDir(dir); setDonorPage(1); }}
          expandedKey={expandedDonor}
          onExpandedChange={setExpandedDonor}
          emptyMessage={donorTotal === 0 ? t("budgetWorkspace.noDonorsFiltered") : t("budgetWorkspace.noDonorsPage")}
        />
      ) : viewMode === "card" ? (
        pagedRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            {t("budgetWorkspace.noMatchingDonors")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("budgetWorkspace.donorCards")}>
            {pagedRows.map(row => (
              <DonorPortfolioCard
                key={row.donorKey}
                row={row}
                effectiveCurrency={effectiveCurrency}
                isExpanded={expandedDonor === row.donorKey}
                onToggleDetails={() => setExpandedDonor(expandedDonor === row.donorKey ? null : row.donorKey)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60" aria-label={t("budgetWorkspace.donorCompact")}>
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="flex-1">{t("budgetWorkspace.donor")}</span>
            <span className="hidden w-20 text-end sm:inline">{t("budgetWorkspace.projects")}</span>
            <span className="hidden flex-1 text-end md:inline">{t("budgetWorkspace.portfolioByCurrency")}</span>
            <span className="hidden w-32 text-end lg:inline">{t("budgetWorkspace.portfolioShare")}</span>
          </div>
          {pagedRows.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">{t("budgetWorkspace.noMatchingDonors")}</p>
          ) : pagedRows.map(row => (
            <DonorPortfolioCompactRow
              key={row.donorKey}
              row={row}
              effectiveCurrency={effectiveCurrency}
              isExpanded={expandedDonor === row.donorKey}
              onToggleDetails={() => setExpandedDonor(expandedDonor === row.donorKey ? null : row.donorKey)}
            />
          ))}
        </div>
      )}

      {/* Pagination footer — always inside the Donor Portfolio card */}
      {donorTotal > 0 && (
        <TablePagination
          label={t("budgetWorkspace.donorPagination")}
          page={safePageD}
          pageCount={donorPages}
          onPageChange={handleDonorPageChange}
          summary={t("budgetWorkspace.donorPaginationInfo", { from: (safePageD - 1) * donorPageSize + 1, to: Math.min(safePageD * donorPageSize, donorTotal), total: donorTotal, entity: t("budgetWorkspace.donorEntity") })}
          pageSize={donorPageSize}
          pageSizes={[5, 10, 20]}
          onPageSizeChange={(n) => { setDonorPageSize(n); setDonorPage(1); }}
          pageSizeLabel={t("aria.donorsPerPage")}
        />
      )}

      {/* Data quality issues — HeroUI Modal */}
      <Modal isOpen={showIssues} onOpenChange={setShowIssues}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog className="max-h-[80vh]">
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t("donorIssues.title")}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">{t("donorIssues.description")}</p>
              </Modal.Header>
              <Modal.Body className="flex flex-col gap-2 overflow-y-auto">
                {issueRows.flatMap(d => {
                  const pList    = d.projectList ?? [];
                  const ds       = d.dataStatus ?? "unlinked";
                  const issues   = d.dataIssues ?? [];
                  const freeText = d.freeTextDonorName;
                  return pList.map(p => (
                    <div key={`${p.id}-${ds}`} className="flex items-start justify-between gap-3 rounded-xl bg-[var(--default)] px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-sm">
                          <span className="font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{p.code}</bdi></span>
                          <span className="truncate font-medium text-foreground">{p.title}</span>
                        </div>
                        <dl className="mt-1 grid gap-0.5 text-xs text-[var(--muted)]">
                          {d.donorId != null && (
                            <div>{t("donorIssues.canonicalId")}: {d.donorId} · {t("donorIssues.name")}: <span className="font-medium text-foreground">{d.donorName ?? d.donor}</span></div>
                          )}
                          {freeText && (
                            <div>{t("donorIssues.freeText")}: <span className="rounded bg-[var(--surface)] px-1 font-mono">{freeText}</span></div>
                          )}
                          <div>{t("donorIssues.currency")}: {d.currency ? <span className="font-medium text-foreground">{d.currency}</span> : <span className="italic">{t("donorIssues.missing")}</span>}</div>
                          {issues.length > 0 && (
                            <div>{t("donorIssues.issues", { count: issues.length })}: <span className="font-medium text-foreground">{issues.join(", ")}</span></div>
                          )}
                        </dl>
                      </div>
                      <DonorStatusBadge status={ds} />
                    </div>
                  ));
                })}
                {issueRows.length === 0 && (
                  <p className="py-4 text-center text-sm text-[var(--muted)]">{t("donorIssues.noneFound")}</p>
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

type BpSortKey =
  | "projectCode" | "projectTitle" | "donorName"
  | "budgetBasis" | "allocatedBudget" | "spent"
  | "remainingBalance" | "utilisationRate" | "projectStatus";

const TABS = ["overview", "performance", "projects", "budget", "risks"] as const;
type TabId = typeof TABS[number];

// TAB_CONFIG labelKey is a dashboard translation key; resolved with t() at render time
const TAB_CONFIG: Array<{ id: TabId; labelKey: string }> = [
  { id: "overview",    labelKey: "tabs.overview" },
  { id: "performance", labelKey: "tabs.performance" },
  { id: "projects",    labelKey: "tabs.projects" },
  { id: "budget",      labelKey: "tabs.budget" },
  { id: "risks",       labelKey: "tabs.risks" },
];

/* ── Budget & Donors — single access helper ─────────────────────────── *
 * Single source of truth for frontend role authorisation.               *
 * Mirrors BUDGET_DONORS_ROLES in api-server/src/routes/dashboard.ts.   *
 * Do NOT replace with broad groups (isStrategic, isOperational, isState)*
 * — state_office_manager is explicitly excluded despite being a state   *
 * role, and executive_director / super_admin remain approved.           */
const BUDGET_DONORS_ROLE_SET = new Set([
  "super_admin", "executive_director",
  "program_manager", "senior_program_coordinator",
  "technical_coordinator",
  "state_program_officer",
]);
function canViewBudgetAndDonors(role: string): boolean {
  return BUDGET_DONORS_ROLE_SET.has(role);
}

/* ── Main Dashboard ──────────────────────────────────────────────────── */
/* ── Project Performance — HeroUI Pro DataGrid ───────────────────────── */
type HierarchicalProject = NonNullable<ReturnType<typeof useHierarchicalPerformance>["data"]>["sectors"][number]["projects"][number];

function ProjectPerformanceGrid({ projects }: { projects: HierarchicalProject[] }) {
  const { t, i18n } = useTranslation("dashboard");
  const columns = useMemo<DataGridColumn<HierarchicalProject>[]>(() => [
    { id: "code", header: t("projectPerfTable.code"), width: 150, allowsSorting: true,
      sortFn: (a, b) => a.projectCode.localeCompare(b.projectCode),
      cell: (p) => <span className="whitespace-nowrap font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{p.projectCode}</bdi></span> },
    { id: "title", header: t("projectPerfTable.projectTitle"), isRowHeader: true, minWidth: 220, allowsSorting: true,
      sortFn: (a, b) => a.projectTitle.localeCompare(b.projectTitle, i18n.language),
      cell: (p) => <span className="block truncate font-medium text-foreground" title={p.projectTitle}>{p.projectTitle}</span> },
    { id: "sector", header: t("projectPerfTable.sector"), minWidth: 140,
      cell: (p) => <span className="text-[var(--muted)]">{displayHierarchicalSectorLabel(p.sector, t("hierarchical.unresolvedSector"))}</span> },
    { id: "state", header: t("projectPerfTable.state"), minWidth: 140,
      cell: (p) => <span className="block max-w-[180px] truncate text-[var(--muted)]"><LocalizedStateNames names={p.stateNames} namesAr={(p as unknown as { stateNamesAr?: string[] }).stateNamesAr} /></span> },
    { id: "valid", header: t("projectPerfTable.validIndicators"), align: "end", width: 120, allowsSorting: true,
      sortFn: (a, b) => a.validIndicatorCount - b.validIndicatorCount,
      cell: (p) => <span className="tabular-nums text-[var(--muted)]">{p.validIndicatorCount}</span> },
    { id: "missing", header: t("projectPerfTable.missingData"), align: "end", width: 110, allowsSorting: true,
      sortFn: (a, b) => a.missingIndicatorCount - b.missingIndicatorCount,
      cell: (p) => p.missingIndicatorCount > 0
        ? <Chip size="sm" variant="soft" color="warning" className="tabular-nums">{p.missingIndicatorCount}</Chip>
        : <span className="text-[var(--muted)]">—</span> },
    { id: "rate", header: t("projectPerfTable.achievementRate"), align: "end", width: 130, allowsSorting: true,
      sortFn: (a, b) => (a.projectAchievementRate ?? -1) - (b.projectAchievementRate ?? -1),
      cell: (p) => p.projectAchievementRate != null
        ? <span className="font-semibold tabular-nums text-foreground"><bdi dir="ltr">{p.projectAchievementRate}%</bdi></span>
        : <span className="text-xs text-[var(--muted)]">{t("performance.insufficientData")}</span> },
    { id: "open", header: <span className="sr-only">{t("projectPerfTable.viewProject")}</span>, width: 90,
      cell: (p) => (
        <HLink href={`/projects/${p.projectId}`} className="text-sm no-underline whitespace-nowrap">
          {t("projectPerfTable.viewProject")}
        </HLink>
      ) },
  ], [t, i18n.language]);
  return (
    <DataGrid
      aria-label={t("performanceTab.projectPerformance")}
      data={projects}
      columns={columns}
      getRowId={(p) => p.projectId}
      defaultSortDescriptor={{ column: "rate", direction: "descending" }}
    />
  );
}

export default function Dashboard() {
  const { t, i18n } = useTranslation("dashboard");
  const isMobile = useIsMobile();
  const isRtl = i18n.language?.startsWith("ar") ?? false;
  const { data: me } = useGetMe();
  const role = me?.user.role ?? "state_program_officer";
  const userSectors = useMemo(() => {
    const rawSector = ((me?.user as unknown) as Record<string, string | undefined>)?.sector;
    return rawSector ? rawSector.split(",").map(s => s.trim()).filter(Boolean) : null;
  }, [me]);

  // Role groups
  const isStrategic  = ["super_admin", "executive_director"].includes(role);
  const isOperational = ["program_manager", "senior_program_coordinator"].includes(role);
  const isTc         = role === "technical_coordinator";
  const isState      = ["state_office_manager", "state_program_officer"].includes(role);
  const showInsights = isStrategic || isOperational;
  // Fail-closed: approved roles that are missing required scope configuration.
  // TC without an assigned Sector and SPO without an assigned State must show a
  // configuration message rather than falling back to org-wide data.
  const spoStateId      = (me?.user as unknown as Record<string, unknown>)?.stateId;
  const tcMissingScope  = isTc && !(userSectors?.length);
  const spoMissingScope = role === "state_program_officer" && !spoStateId;

  // Global location context — replaces the local stateId dropdown on Dashboard
  const { selectedStateId } = useLocationContext();

  // Filter state (sector, donor, dateFrom, dateTo — stateId handled by global context)
  const [filters, setFilters] = useState<DashFilters>({});
  const restrictedSectors = isTc ? (userSectors ?? []) : null;

  // API params
  const summaryParams = useMemo(() => ({
    ...(selectedStateId  ? { stateId: selectedStateId } : {}),
    ...(filters.sector   ? { sector:   filters.sector   } : {}),
    ...(filters.donor    ? { donor:    filters.donor    } : {}),
    ...(filters.dateFrom ? { dateFrom: filters.dateFrom } : {}),
    ...(filters.dateTo   ? { dateTo:   filters.dateTo   } : {}),
  }), [filters, selectedStateId]);

  const stateParams = useMemo(() => ({
    ...(selectedStateId ? { stateId: selectedStateId } : {}),
    ...(filters.sector ? { sector: filters.sector } : {}),
  }), [selectedStateId, filters.sector]);

  // Data hooks — top-level so tab switches never trigger refetches
  // Non-financial fields are returned to all authenticated roles by the server.
  // Financial fields are nulled/omitted server-side for non-Budget roles.
  // Frontend financial cards remain gated by canViewBudgetAndDonors(role) for render.
  const {
    data: summary, isLoading: isSummaryLoading, isFetching: isSummaryFetching,
    isError: isSummaryError, error: summaryError, refetch: refetchSummary,
  } = useGetDashboardSummary(summaryParams, { query: { queryKey: getGetDashboardSummaryQueryKey(summaryParams) } });
  const { data: states, isLoading: isStatesLoading, isError: isStatesError, error: statesError, refetch: refetchStates } = useGetStatePerformance(stateParams);
  const { isError: isSectorError, error: sectorError, refetch: refetchSector } =
    useGetSectorPerformance({ query: { queryKey: getGetSectorPerformanceQueryKey() } });
  const { data: approvals, isLoading: isApprovalsLoading, isError: isApprovalsError, error: approvalsError, refetch: refetchApprovals } = useGetPendingApprovals();
  // Custom query hooks that pass selectedStateId as a real ?stateId query param so
  // the backend actually filters projects to the selected location. The generated
  // hooks don't accept stateId params, so we use useQuery + customFetch directly.
  const donorPortfolioUrl = useMemo(() => {
    const base = "/api/dashboard/donor-portfolio";
    return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
  }, [selectedStateId]);
  const { data: donorPortfolio, isLoading: isDonorLoading, isError: isDonorError, refetch: refetchDonor } = useQuery({
    queryKey: [...getGetDonorPortfolioQueryKey(), selectedStateId],
    queryFn: ({ signal }) => customFetch<DonorPortfolioEntry[]>(donorPortfolioUrl, { signal }),
    enabled: canViewBudgetAndDonors(role),
  });

  const projectBudgetPerfUrl = useMemo(() => {
    const base = "/api/dashboard/project-budget-performance";
    return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
  }, [selectedStateId]);
  const { data: projectBudgetPerf, isLoading: isProjBudgetLoading, isError: isProjBudgetError, refetch: refetchProjBudget } = useQuery({
    queryKey: [...getGetProjectBudgetPerformanceQueryKey(), selectedStateId],
    queryFn: ({ signal }) => customFetch<ProjectBudgetPerformanceEntry[]>(projectBudgetPerfUrl, { signal }),
    enabled: canViewBudgetAndDonors(role),
  });
  const { data: reportsSummary, isLoading: isReportsSummaryLoading, isError: isReportsSummaryError, error: reportsSummaryError, refetch: refetchReportsSummary } = useGetReportsSummary();
  const [benOpen, setBenOpen]                                      = useState(false);
  const [perfBenView, setPerfBenView]                              = useState<"sector" | "state" | "gender">("sector");
  const [expandedSector, setExpandedSector]                        = useState<string | null>(null);
  const { data: benBreakdown, isLoading: isBenLoading, isError: isBenError, error: benError, refetch: refetchBeneficiaries } =
    useGetBeneficiariesBreakdown(summaryParams);
  const {
    data: hierarchicalData, isLoading: isHierarchicalLoading,
    isError: isHierarchicalError, refetch: refetchHierarchical,
  } = useHierarchicalPerformance(summaryParams);
  const { data: attentionProjects, isLoading: isAttentionLoading, isError: isAttentionError, error: attentionError, refetch: refetchAttention } = useGetDashboardAttentionProjects();
  const { data: lateReports, isLoading: isLateLoading, isError: isLateError, error: lateError, refetch: refetchLate } = useGetDashboardLateReports();
  // Draft data for OperationalFollowUp tile counts (React Query deduplicates network requests
  // with MyDraftsWidget's identical calls)
  const { data: psDraftProjects, isLoading: isDraftProjectsLoading, isError: isDraftProjectsError, error: draftProjectsError, refetch: refetchDraftProjects } = useListProjects({ status: "draft" });
  const [, navigate] = useLocation();

  /* ── Projects & States tab — follow-up count & breakdown ────────────── *
   * Unique project count across all genuine operational follow-up          *
   * conditions.  Returns null only when every source query has failed so   *
   * the UI shows "Insufficient Data" rather than a misleading 0.          *
   *                                                                        *
   * Follow-up conditions included:                                         *
   *   • Draft Project or Draft Report (staff reminder to submit)           *
   *   • Overdue report (submitted but awaiting >14 days)                   *
   *   • Active critical risk                                               *
   *   • Returned report (returned for revision)                            *
   *                                                                        *
   * Each project is counted once in psFollowUpCount regardless of how     *
   * many conditions apply.  psBreakdown shows per-category counts so a    *
   * project may appear in more than one category column.                   */
  /* Projects & States tab — follow-up KPI count and compact breakdown.
   * The /dashboard/attention-projects endpoint now returns a deduplicated
   * FollowUpProject[] with all follow-up conditions pre-computed server-side.
   * The count is the length of the returned array; breakdown is derived from
   * the reason labels. Returns null when the fetch has not yet completed (to
   * avoid displaying a misleading 0). */
  const { psFollowUpCount, psBreakdown } = useMemo<{
    psFollowUpCount: number | null;
    psBreakdown: string;
  }>(() => {
    if (attentionProjects === undefined) return { psFollowUpCount: null, psBreakdown: "" };

    const followUp = attentionProjects;   // typed FollowUpProject[] by the generated hook
    const total = followUp.length;        // unique deduplicated project count

    // Stable code predicate — never inspect reason.label.
    const hascode = (p: FollowUpProject, code: FollowUpReasonCode) =>
      p.followUpReasons.some(r => r.code === code);

    // Sum reason.count for source-record metrics (spec §4: "Sum reason.count where
    // the metric represents source records").
    const sumCount = (code: FollowUpReasonCode) =>
      followUp.reduce((acc, p) => {
        const r = p.followUpReasons.find(fr => fr.code === code);
        return acc + (r?.count ?? 0);
      }, 0);

    // Draft projects — project-level boolean: count unique projects
    const draftProjCount = followUp.filter(p => hascode(p, "draft_project")).length;
    // All other categories — sum factual record counts from reason.count
    const draftRptTotal  = sumCount("draft_project_report");
    const awaitingTotal  = sumCount("report_awaiting_approval");
    const returnedTotal  = sumCount("returned_report");
    const critTotal      = sumCount("active_critical_risk");
    const mitTotal       = sumCount("overdue_risk_mitigation");

    const parts: string[] = [];
    if (draftProjCount > 0) parts.push(t("projectsTab.breakdown.draftProject", { count: draftProjCount }));
    if (draftRptTotal  > 0) parts.push(t("projectsTab.breakdown.draftReport",  { count: draftRptTotal  }));
    if (awaitingTotal  > 0) parts.push(t("projectsTab.breakdown.awaiting",     { count: awaitingTotal  }));
    if (returnedTotal  > 0) parts.push(t("projectsTab.breakdown.returned",     { count: returnedTotal  }));
    if (critTotal      > 0) parts.push(t("projectsTab.breakdown.criticalRisk", { count: critTotal      }));
    if (mitTotal       > 0) parts.push(t("projectsTab.breakdown.overdueMit",   { count: mitTotal       }));

    return { psFollowUpCount: total, psBreakdown: parts.join(" · ") };
  }, [attentionProjects, t]);

  /* ── Tab state (URL-synced) ─────────────────────────────────────────── */
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    try {
      const p = new URLSearchParams(window.location.search).get("tab");
      return (TABS as readonly string[]).includes(p ?? "") ? (p as TabId) : "overview";
    } catch { return "overview"; }
  });

  const switchTab = (tab: TabId) => {
    setActiveTab(tab);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch { /* ignore */ }
  };

  // Keep URL-restored tab state coherent when a user follows a dashboard link
  // or uses the browser’s Back/Forward controls.
  useEffect(() => {
    const syncTabFromUrl = () => {
      const tab = new URLSearchParams(window.location.search).get("tab");
      setActiveTab((TABS as readonly string[]).includes(tab ?? "") ? tab as TabId : "overview");
    };
    window.addEventListener("popstate", syncTabFromUrl);
    return () => window.removeEventListener("popstate", syncTabFromUrl);
  }, []);

  /* ── Derived chart data (must be before any early return) ───────────── */
  /* statusChartData uses useMemo — Hooks must be called unconditionally.   */
  /* Placing this after an early return would change the hook call order    */
  /* between the loading and loaded renders, triggering the Rules-of-Hooks  */
  /* violation and crashing the Dashboard.                                  */
  // Project status distribution — scope-aware; each project counted once by current status
  const statusChartData = useMemo(() =>
    (summary?.byStatus ?? [])
      .filter(d => d.count > 0)
      .sort((a, b) => b.count - a.count)
      .map(d => ({
        name:   t(`projectStatus.${d.status}`, { defaultValue: toTitleCase(d.status) }),
        count:  d.count,
        status: d.status,
        color:  STATUS_COLORS[d.status] ?? "#94a3b8",
      })),
    [summary, t]
  );

  /* ── Loading skeleton ───────────────────────────────────────────────── */
  if (isSummaryLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="h-7 w-56 rounded-lg bg-muted/50 animate-pulse" />
          <div className="h-4 w-96 max-w-full rounded bg-muted/50 animate-pulse" />
        </div>
        <div className="h-12 rounded-xl bg-muted/50 animate-pulse" />
        <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
          <div className="h-10 bg-muted/30 border-b border-border animate-pulse" />
          <div className="p-6 space-y-6">
            {/* Row 1: KPI Cards */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-[112px] rounded-xl bg-muted/50 animate-pulse" />
              ))}
            </div>
            {/* Row 2: Charts + Notifications */}
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 sm:col-span-7 lg:col-span-5 h-[380px] rounded-xl bg-muted/50 animate-pulse" />
              <div className="col-span-12 sm:col-span-5 lg:col-span-4 h-[380px] rounded-xl bg-muted/50 animate-pulse" />
              <div className="col-span-12 lg:col-span-3 h-[200px] rounded-xl bg-muted/50 animate-pulse" />
            </div>
            {/* Lower section: 2-column operational layout */}
            <div className="grid grid-cols-12 gap-4 items-start">
              <div className="col-span-12 lg:col-span-8 space-y-4">
                <div className="h-[180px] rounded-xl bg-muted/50 animate-pulse" />
                <div className="h-[160px] rounded-xl bg-muted/50 animate-pulse" />
              </div>
              <div className="col-span-12 lg:col-span-4 space-y-4">
                <div className="h-[300px] rounded-xl bg-muted/50 animate-pulse" />
                <div className="h-[130px] rounded-xl bg-muted/50 animate-pulse" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Several secondary dashboard endpoints do not yet share the complete
  // location/sector/donor/date filter contract. Any such narrowing must fail
  // closed rather than mixing filtered primary facts with organisation-wide
  // approvals, follow-up, reporting, or financial data.
  // State-scoped roles are already RBAC-clamped by the server and remain valid.
  const unsupportedSecondaryFilters = Boolean(
    filters.sector
    || filters.donor
    || filters.dateFrom
    || filters.dateTo
    || (selectedStateId != null && !isState),
  );
  const failedQuery = [
    [isSummaryError, summaryError, refetchSummary],
    [isStatesError, statesError, refetchStates],
    [isSectorError, sectorError, refetchSector],
    [isApprovalsError, approvalsError, refetchApprovals],
    [isReportsSummaryError, reportsSummaryError, refetchReportsSummary],
    [isBenError, benError, refetchBeneficiaries],
    [isHierarchicalError, undefined, refetchHierarchical],
    [isAttentionError, attentionError, refetchAttention],
    [isLateError, lateError, refetchLate],
    [isDraftProjectsError, draftProjectsError, refetchDraftProjects],
    ...(activeTab === "budget" && canViewBudgetAndDonors(role)
      ? [[isDonorError, undefined, refetchDonor], [isProjBudgetError, undefined, refetchProjBudget]]
      : []),
  ].find(([failed]) => failed) as [boolean, unknown, () => unknown] | undefined;

  // A dashboard-wide aggregate is never complete if a primary constituent
  // failed. Fail closed rather than rendering a mix of current and stale/zero
  // values. The filter bar remains available so the user can correct scope.
  if (failedQuery || unsupportedSecondaryFilters) {
    const variant = unsupportedSecondaryFilters ? "warning" : dashboardErrorVariant(failedQuery?.[1]);
    const title = unsupportedSecondaryFilters
      ? t("queryState.unsupported")
      : variant === "permission"
        ? t("queryState.restricted")
        : variant === "network"
          ? t("queryState.unavailable")
          : t("queryState.loadFailedTitle");
    return (
      <div className="space-y-5">
        <FilterBar filters={filters} onChange={setFilters} restrictedSectors={restrictedSectors} />
        <div aria-live="assertive">
          <ErrorState
            variant={variant}
            title={title}
            description={unsupportedSecondaryFilters ? t("queryState.unsupportedDescription") : t("queryState.loadFailedDescription")}
            retryLabel={t("queryState.retry")}
            onRetry={failedQuery ? () => { void failedQuery[2](); } : undefined}
          />
        </div>
      </div>
    );
  }


  /* ── Derived chart data (non-hook) ─────────────────────────────────── */
  // statusChartData useMemo was moved before the isSummaryLoading early return
  // above — it must not appear after any conditional return.

  // Covered states only (total > 0); sorted desc total then alpha name
  const stateChartData = (states ?? [])
    .map(s => ({
      name:   getStateLabel({ name: s.stateName, nameAr: s.stateNameAr }, i18n.language),
      total:  (s as StatePerformance & { totalProjects?: number }).totalProjects ?? s.activeProjects,
      active: s.activeProjects,
    }))
    .filter(d => d.total > 0)                                                               // show only states with at least one project
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));                    // desc total, alpha tie-break


  // Active High and Critical Risk counts per state — uses the two factual fields
  // returned by computeStateImplementation. Only states with at least one active high or critical
  // risk are included; ordered by combined count descending, state name ascending as tie-breaker.
  // Full state names are preserved — no truncation at the data level.
  const riskByStateData = (states ?? [])
    .map(s => ({
      name:      getStateLabel({ name: s.stateName, nameAr: s.stateNameAr }, i18n.language),
      critRisks: (s as StatePerformance & { critOnlyRisks?: number }).critOnlyRisks ?? 0,
      highRisks: (s as StatePerformance & { highOnlyRisks?: number }).highOnlyRisks ?? 0,
    }))
    .filter(d => d.critRisks > 0 || d.highRisks > 0)
    .sort((a, b) =>
      (b.critRisks + b.highRisks) - (a.critRisks + a.highRisks) || a.name.localeCompare(b.name),
    )
    .slice(0, 10);

  // Risk Summary Strip aggregates — null while loading; "—" shown in UI for failed/missing data.
  // Do not convert undefined (failed/pending) into zero.
  const riskCritTotal = states !== undefined
    ? (states as Array<StatePerformance & { critOnlyRisks?: number }>)
        .reduce((acc, s) => acc + (s.critOnlyRisks ?? 0), 0)
    : null;
  const riskHighTotal = states !== undefined
    ? (states as Array<StatePerformance & { highOnlyRisks?: number }>)
        .reduce((acc, s) => acc + (s.highOnlyRisks ?? 0), 0)
    : null;
  /** Count of authorised States containing at least one Active Critical or Active High Risk. */
  const riskStatesAffected = states !== undefined ? riskByStateData.length : null;
  /** Sum of overdue mitigation action counts across all follow-up projects in authorised scope. */
  const riskOverdueMit = attentionProjects !== undefined
    ? attentionProjects.reduce((acc, p) => {
        const r = p.followUpReasons.find(fr => fr.code === "overdue_risk_mitigation");
        return acc + (r?.count ?? 0);
      }, 0)
    : null;


  // Project implementation status — derived from existing summary fields; no new API calls
  const projectStatusData = [
    { name: t("projectStatus.active"),    value: summary?.activeProjects ?? 0,    color: "var(--chart-3)" },
    { name: t("projectStatus.completed"), value: summary?.completedProjects ?? 0, color: "var(--chart-1)" },
    {
      name: t("projectStatus.other"),
      value: Math.max(0, (summary?.totalProjects ?? 0) - (summary?.activeProjects ?? 0) - (summary?.completedProjects ?? 0)),
      color: "var(--chart-5)",
    },
  ].filter(d => d.value > 0);
  const projectStatusTotal = projectStatusData.reduce((s, d) => s + d.value, 0);

  /* ── Render ─────────────────────────────────────────────────────────── */
  /* TT, ChartCard, MonthlyTrendChart are now at module scope — see the     */
  /* MODULE-SCOPE CHART INFRASTRUCTURE section above the Dashboard function */
  return (
    <div className="space-y-5">
      {isSummaryFetching && !isSummaryLoading && (
        <p role="status" aria-live="polite" className="sr-only">
          {t("queryState.refreshing")}
        </p>
      )}

      {/* ── Page Header ─────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1.5">
          <div className="flex items-center gap-2.5">
            <h1 className="text-foreground text-xl font-semibold leading-tight">
              {t("header.title")}
            </h1>
            <Chip size="sm" variant="soft" color="default" className="hidden sm:inline-flex">
              {t(`roles.${role}`, { defaultValue: ROLE_LABELS[role] ?? role })}
            </Chip>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            {t("header.description")}
          </p>
        </div>
      </div>

      {/* ── Global Filter Bar ────────────────────────────────────────── */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        restrictedSectors={restrictedSectors}
      />

      {/* ── Filter scope notice — Performance and Risks tabs ────────── */}
      {(activeTab === "performance" || activeTab === "risks") && (
        <UITooltipProvider>
          <div className="flex items-center gap-1.5 px-0.5" role="note" aria-label={t("aria.filterApplicability")}>
            <Info className="h-3.5 w-3.5 text-muted-foreground/50 shrink-0" aria-hidden="true" />
            <span className="text-xs text-muted-foreground/60 font-medium select-none">
              {t("header.filterScopeNote")}
            </span>
            <UITooltip>
              <UITooltipTrigger asChild>
                <button
                  type="button"
                  className="inline-flex items-center justify-center rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  aria-label={t("aria.filterScopeDetails")}
                >
                  <Info className="h-3 w-3 text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors" />
                </button>
              </UITooltipTrigger>
              <UITooltipContent
                side="bottom"
                align="start"
                className="max-w-xs text-xs leading-relaxed bg-popover text-popover-foreground border border-border shadow-md"
              >
                {activeTab === "risks" ? (
                  <span>
                    {t("filterScope.risksDetail")}
                  </span>
                ) : (
                  <span>
                    {t("filterScope.performanceDetail")}
                  </span>
                )}
              </UITooltipContent>
            </UITooltip>
          </div>
        </UITooltipProvider>
      )}

      {/* ── Tabs (HeroUI Tabs; the selected tab's content is the single panel) ── */}
      <Tabs selectedKey={activeTab} onSelectionChange={(key) => switchTab(key as TabId)}>
        <Tabs.ListContainer className="overflow-x-auto">
          <Tabs.List aria-label={t("aria.dashboardSections")}>
            {TAB_CONFIG.map(({ id, labelKey }) => (
              <Tabs.Tab key={id} id={id} className="whitespace-nowrap">
                {t(labelKey)}
                <Tabs.Indicator />
              </Tabs.Tab>
            ))}
          </Tabs.List>
        </Tabs.ListContainer>

        {/* ── Tab panel ──────────────────────────────────────────────── */}
        <Tabs.Panel id={activeTab} className="mt-4">

          {/* ════════════════════════════════════════════════════════════
              OVERVIEW
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <CalendarProvider>
              <div id="panel-overview" className="space-y-4">

                {/* ── Row 1: KPI Summary — HeroUI Pro KPI cards ("With Footer") ─── */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <KPI>
                    <KPI.Header>
                      <KPI.Icon><Activity aria-hidden="true" /></KPI.Icon>
                      <KPI.Title>{t("overviewTab.activeProjects")}</KPI.Title>
                    </KPI.Header>
                    <KPI.Content>
                      <KPI.Value value={summary?.activeProjects ?? 0} maximumFractionDigits={0} />
                    </KPI.Content>
                    <KPI.Footer>
                      <span className="text-sm text-muted-foreground">{t("overviewTab.totalProjects", { count: summary?.totalProjects ?? 0 })}</span>
                    </KPI.Footer>
                  </KPI>
                  <KPI>
                    <KPI.Header>
                      <KPI.Icon status="success"><Users aria-hidden="true" /></KPI.Icon>
                      <KPI.Title>{t("overviewTab.beneficiariesReached")}</KPI.Title>
                    </KPI.Header>
                    <KPI.Content>
                      <KPI.Value value={summary?.totalBeneficiaries ?? 0} notation="compact" maximumFractionDigits={1} />
                    </KPI.Content>
                    <KPI.Footer>
                      <HLink className="text-sm" onPress={() => setBenOpen(true)}>{t("overviewTab.viewBreakdown")}</HLink>
                    </KPI.Footer>
                  </KPI>
                  <KPI>
                    <KPI.Header>
                      <KPI.Icon status="warning"><DollarSign aria-hidden="true" /></KPI.Icon>
                      <KPI.Title>{t("overviewTab.budgetUtilisation")}</KPI.Title>
                    </KPI.Header>
                    <KPI.Content>
                      {summary?.burnRatePct == null
                        ? <span className="text-2xl font-semibold text-muted-foreground">—</span>
                        : <KPI.Value value={summary.burnRatePct / 100} style="percent" maximumFractionDigits={0} />}
                    </KPI.Content>
                    {summary?.burnRatePct != null && (
                      <KPI.Progress value={Math.min(100, Math.max(0, summary.burnRatePct))} status="warning" />
                    )}
                    <KPI.Footer className="flex flex-col items-start gap-1">
                      <span className="text-sm text-muted-foreground">
                        {summary?.currencyMixed
                          ? t("overviewTab.mixedCurrencyUnavailable")
                          : t("overviewTab.spentToDate", { amount: fmtMoney(summary?.totalSpent, summary?.currency) })}
                      </span>
                      <HLink href="/budget" className="text-sm">{t("overviewTab.viewBudget")}</HLink>
                    </KPI.Footer>
                  </KPI>
                  <KPI>
                    <KPI.Header>
                      <KPI.Icon status={summary?.delayedActivities ? "danger" : undefined}><AlertTriangle aria-hidden="true" /></KPI.Icon>
                      <KPI.Title>{t("overviewTab.activitiesAttention")}</KPI.Title>
                    </KPI.Header>
                    <KPI.Content>
                      <KPI.Value value={summary?.delayedActivities ?? 0} maximumFractionDigits={0} />
                    </KPI.Content>
                    <KPI.Footer>
                      <span className="text-sm text-muted-foreground">{t("overviewTab.delayedOrPastDeadline")}</span>
                    </KPI.Footer>
                  </KPI>
                </div>

                {/* ── Row 2: Monthly Trend (5/12) · Project Status (4/12) · Notifications (3/12) ── */}
                <div className="grid grid-cols-12 gap-4 items-start">

                  {/* Monthly Achievement Trend — 5 columns on desktop */}
                  <div className="col-span-12 sm:col-span-7 lg:col-span-5">
                    <MonthlyTrendChart monthlyData={summary?.monthlyAchievement} height={340} gradientSuffix="Ov" />
                  </div>

                  {/* Project Implementation Status — 4 columns on desktop */}
                  <div className="col-span-12 sm:col-span-5 lg:col-span-4">
                    <ChartCard
                      title={t("overviewTab.projectImplementationStatus")}
                      description={t("overviewTab.progressDistribution")}
                    >
                      {projectStatusTotal === 0 ? (
                        <div className="h-[340px]">
                          <ChartEmptyState message={t("overviewTab.noProjectData")} icon={FolderKanban} />
                        </div>
                      ) : (
                        // HeroUI Pro PieChart, as in its "Donut With Content" example.
                        <div className="flex min-h-[340px] flex-col items-center justify-center gap-4">
                          <div className="relative">
                            <ProPieChart height={220} width={220}>
                              <ProPieChart.Pie
                                cornerRadius={12} cx="50%" cy="50%"
                                data={projectStatusData} dataKey="value" nameKey="name"
                                innerRadius="68%" paddingAngle={-20} strokeWidth={0}
                              >
                                {projectStatusData.map((entry) => (
                                  <ProPieChart.Cell key={entry.name} fill={entry.color} />
                                ))}
                              </ProPieChart.Pie>
                              <ProPieChart.Tooltip content={<ShareTooltip total={projectStatusTotal} />} />
                            </ProPieChart>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
                              <span className="text-3xl font-bold tabular-nums text-foreground">{fmt(projectStatusTotal)}</span>
                              <span className="text-sm text-muted-foreground">{t("overviewTab.projects")}</span>
                            </div>
                          </div>
                          <div className="flex flex-col gap-2">
                            {projectStatusData.map((entry) => (
                              <div key={entry.name} className="flex items-center gap-3">
                                <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} aria-hidden="true" />
                                <span className="w-24 text-sm text-foreground">{entry.name}</span>
                                <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(entry.value)}</span>
                                <span className="text-xs text-muted-foreground">({Math.round((entry.value / projectStatusTotal) * 100)}%)</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </ChartCard>
                  </div>

                  {/* Notifications — 3 columns on desktop, full width on tablet/mobile */}
                  <div className="col-span-12 lg:col-span-3">
                    <NotificationsSummaryWidget />
                  </div>
                </div>

                {/* ── Operational lower section ──────────────────────────
                    Desktop: Left col (8/12) = Priority Actions + Reminders
                             Right col (4/12) = Calendar + Schedule
                    Mobile order: Priority → Calendar → Schedule → Reminders
                    All cards content-aware height; columns independent (items-start). */}
                <div className="grid grid-cols-12 gap-4 items-start">

                  {/* Priority Actions — left col, row 1 */}
                  <div className="col-span-12 lg:col-span-8 lg:row-start-1 order-1 lg:order-none">
                    <PriorityActionsPanel
                      lateReports={lateReports}
                      approvals={approvals}
                      attentionProjects={attentionProjects}
                      isLoading={isLateLoading || isApprovalsLoading || isAttentionLoading}
                    />
                  </div>

                  {/* Calendar — right col, row 1 */}
                  <div className="col-span-12 lg:col-span-4 lg:col-start-9 lg:row-start-1 order-2 lg:order-none">
                    <CalendarGridCard />
                  </div>

                  {/* Schedule — right col, row 2 */}
                  <div className="col-span-12 lg:col-span-4 lg:col-start-9 lg:row-start-2 order-3 lg:order-none">
                    <ScheduleCard />
                  </div>

                  {/* Reminders — left col, row 2 */}
                  <div className="col-span-12 lg:col-span-8 lg:col-start-1 lg:row-start-2 order-4 lg:order-none">
                    <RemindersCard />
                  </div>
                </div>

              </div>
            </CalendarProvider>
          )}

          {/* ════════════════════════════════════════════════════════════
              PROGRAMME PERFORMANCE
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "performance" && (
            <div id="panel-performance" className="space-y-5">

              {/* ── 1. Performance KPI Summary ───────────────────────────── */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {isHierarchicalLoading || isSummaryLoading ? (
                  [1, 2, 3, 4].map(i => <PsKpiSkeleton key={i} />)
                ) : (
                  <>
                    {/* Average Sector Achievement Rate — indicator→project→sector hierarchy */}
                    <OvKpiCard
                      icon={TrendingUpIcon} iconColor="text-primary"
                      label={t("performanceTab.avgSectorAchievement")}
                      value={hierarchicalData?.averageSectorAchievementRate != null
                        ? `${Math.round(hierarchicalData.averageSectorAchievementRate)}%`
                        : t("performanceTab.insufficientData")}
                      sub={hierarchicalData?.averageSectorAchievementRate != null
                        ? t("performanceTab.avgSectorAchievementSub")
                        : t("performanceTab.avgSectorAchievementNoData")}
                    />
                    {/* Beneficiaries Reached */}
                    <OvKpiCard
                      icon={Users} iconColor="text-emerald-500"
                      label={t("performanceTab.beneficiariesReached")}
                      value={summary?.totalBeneficiaries != null
                        ? fmtCompact(summary.totalBeneficiaries)
                        : t("performanceTab.insufficientData")}
                      sub={summary?.totalBeneficiaries != null
                        ? t("performanceTab.beneficiariesReachedSub")
                        : t("performanceTab.beneficiariesReachedNoData")}
                      onClick={() => setBenOpen(true)}
                    />
                    {/* Activities Completed */}
                    <OvKpiCard
                      icon={CheckCircle2} iconColor="text-teal-500"
                      label={t("performanceTab.activitiesCompleted")}
                      value={summary?.activitiesCompleted != null
                        ? fmt(summary.activitiesCompleted)
                        : t("performanceTab.insufficientData")}
                      sub={summary?.activitiesCompleted != null && (summary?.activitiesPlanned ?? 0) > 0
                        ? t("performanceTab.activitiesCompletedSub", { completed: fmt(summary.activitiesCompleted), total: fmt(summary.activitiesPlanned ?? 0) })
                        : summary?.activitiesCompleted != null
                          ? t("performanceTab.activitiesCompletedNoPlanned")
                          : t("performanceTab.activitiesCompletedNoData")}
                    />
                    {/* Reporting Compliance */}
                    <OvKpiCard
                      icon={FileText} iconColor="text-violet-500"
                      label={t("performanceTab.reportingCompliance")}
                      value={reportsSummary?.total != null ? `${reportsSummary.approved} / ${reportsSummary.total}` : t("performanceTab.insufficientData")}
                      sub={reportsSummary
                        ? t("performanceTab.reportingComplianceSub", { count: fmt(reportsSummary.awaitingApproval) })
                        : t("performanceTab.reportingComplianceNoData")}
                    />
                  </>
                )}
              </div>

              {/* ── 2. Achievement Trends Row ────────────────────────────── */}
              <div className="grid grid-cols-12 gap-4 items-start">

                {/* Monthly Achievement Trend — 7/12 */}
                <div className="col-span-12 lg:col-span-7">
                  <MonthlyTrendChart
                    monthlyData={summary?.monthlyAchievement}
                    height={340}
                    gradientSuffix="PT"
                    isLoading={isSummaryLoading}
                    titleKey="performanceTab.monthlyAchievementTrend"
                    descriptionKey="performanceTab.compareTargets"
                    emptyMessageKey="chartEmpty.monthlyAchievement"
                  />
                </div>

                {/* Sector Performance — 5/12 */}
                <div className="col-span-12 lg:col-span-5">
                  <ChartCard
                    title={t("performanceTab.sectorPerformance")}
                    description={t("performanceTab.sectorAchievementDesc")}
                  >
                    {isHierarchicalLoading ? (
                      <div className="space-y-2 animate-pulse pt-1">
                        {[1,2,3,4,5].map(i => <div key={i} className="h-8 rounded-lg bg-muted/40" />)}
                      </div>
                    ) : (hierarchicalData?.sectors ?? []).length === 0 ? (
                      <ChartEmptyState message={t("chartEmpty.sectorPerformance")} icon={BarChart3} />
                    ) : (
                      <div className="space-y-0.5 pt-1">
                        {/* Column headers */}
                        <div className="grid items-center gap-x-2 px-2 pb-2 border-b border-border/40"
                          style={{ gridTemplateColumns: "1.5rem 1fr 64px 36px" }}>
                          <span />
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("sectorPerfTable.sector")}</span>
                          <span className="text-[10px] font-medium text-muted-foreground text-end uppercase tracking-wider">{t("sectorPerfTable.rate")}</span>
                          <span className="text-[10px] font-medium text-muted-foreground text-center uppercase tracking-wider">{t("sectorPerfTable.projs")}</span>
                        </div>
                        {/* Sector rows */}
                        {hierarchicalData!.sectors.map(s => {
                          const sectorKey = s.sector ?? "__unresolved__";
                          const sectorLabel = displayHierarchicalSectorLabel(
                            s.sector,
                            t("hierarchical.unresolvedSector"),
                          );
                          const isExpanded = expandedSector === sectorKey;
                          const rate = s.sectorAchievementRate;
                          return (
                            <div key={sectorKey}>
                              <button
                                type="button"
                                onClick={() => setExpandedSector(isExpanded ? null : sectorKey)}
                                className="w-full grid items-center gap-x-2 px-2 py-1.5 rounded-lg hover:bg-[var(--default)] transition-colors text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                                style={{ gridTemplateColumns: "1.5rem 1fr 64px 36px" }}
                                aria-expanded={isExpanded}
                                aria-label={t(isExpanded ? "hierarchical.sectorAriaCollapse" : "hierarchical.sectorAriaExpand", { sector: sectorLabel, rate: rate != null ? `${rate}%` : t("performanceTab.insufficientData") })}
                              >
                                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground/50 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
                                <span className="text-xs font-medium text-foreground truncate">{sectorLabel}</span>
                                <span className={`text-xs tabular-nums text-end ${rate == null ? "text-muted-foreground/50 font-normal" : "font-semibold text-foreground"}`}>
                                  <bdi dir="ltr">{rate != null ? `${rate}%` : "—"}</bdi>
                                </span>
                                <span className="text-xs text-muted-foreground text-center tabular-nums">{s.projectCount}</span>
                              </button>
                              {rate != null && (
                                <ProgressBar size="sm" value={Math.min(rate, 100)} aria-label={`${sectorLabel}: ${rate}%`} className="mx-7 mb-1 w-auto">
                                  <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                                </ProgressBar>
                              )}
                              {/* Drill-down panel */}
                              {isExpanded && (
                                <div className="mx-2 mb-1 mt-0.5 rounded-lg border border-border/40 bg-muted/20 overflow-hidden">
                                  <div className="grid items-center gap-x-2 px-3 py-1.5 border-b border-border/40 bg-muted/30"
                                    style={{ gridTemplateColumns: "1fr 52px 36px 36px" }}>
                                    <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">{t("hierarchical.colProject")}</span>
                                    <span className="text-[10px] text-muted-foreground font-medium text-end uppercase tracking-wider">{t("hierarchical.colRate")}</span>
                                    <span className="text-[10px] text-muted-foreground font-medium text-center uppercase tracking-wider" title={t("hierarchical.validIndicators")}>{t("hierarchical.colValid")}</span>
                                    <span className="text-[10px] text-muted-foreground font-medium text-center uppercase tracking-wider" title={t("hierarchical.missingIndicators")}>{t("hierarchical.colMissing")}</span>
                                  </div>
                                  {s.projects.map(p => (
                                    <div key={p.projectId}
                                      className="grid items-center gap-x-2 px-3 py-2 border-b last:border-0 border-border/30 hover:bg-muted/20 transition-colors"
                                      style={{ gridTemplateColumns: "1fr 52px 36px 36px" }}>
                                      <div className="min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate"><bdi dir="ltr">{p.projectCode}</bdi></p>
                                        <p className="text-[10px] text-muted-foreground truncate" title={p.projectTitle}>{p.projectTitle}</p>
                                      </div>
                                      <span className={`text-xs tabular-nums text-end ${p.projectAchievementRate == null ? "text-muted-foreground/50 font-normal" : "font-semibold text-foreground"}`}>
                                        <bdi dir="ltr">{p.projectAchievementRate != null ? `${p.projectAchievementRate}%` : "—"}</bdi>
                                      </span>
                                      <span className="text-xs text-muted-foreground text-center tabular-nums">{p.validIndicatorCount}</span>
                                      <span className={`text-xs text-center tabular-nums ${p.missingIndicatorCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                                        {p.missingIndicatorCount > 0 ? p.missingIndicatorCount : "—"}
                                      </span>
                                    </div>
                                  ))}
                                  <div className="px-3 py-1.5">
                                    <span className="text-[10px] text-muted-foreground">
                                      {t("hierarchical.validProjectsSummary", { valid: s.validProjectCount, total: s.projectCount })}
                                      {s.insufficientProjectCount > 0 && ` · ${t("hierarchical.insufficientSuffix", { count: s.insufficientProjectCount })}`}
                                    </span>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {/* Footer validity summary */}
                        <div className="pt-2 px-2 border-t border-border/40 mt-1">
                          <p className="text-[11px] text-muted-foreground/60 leading-relaxed">
                            {t("hierarchical.validSectorsSummary", { valid: hierarchicalData!.validSectorCount, total: hierarchicalData!.sectors.length })}
                          </p>
                        </div>
                      </div>
                    )}
                  </ChartCard>
                </div>
              </div>

              {/* ── 3. Target Versus Achievement  +  Beneficiary Performance ── */}
              <div className="grid grid-cols-12 gap-4 items-start">

                {/* Target Versus Achievement — 7/12 */}
                <div className="col-span-12 lg:col-span-7">
                  <ChartCard
                    title={t("performanceTab.targetVsAchievement")}
                    description={t("performanceTab.reviewProgress")}
                  >
                    {(hierarchicalData?.sectors ?? []).length === 0 ? (
                      <ChartEmptyState message={t("chartEmpty.sectorTargets")} icon={Target} />
                    ) : (
                      <div className="space-y-3 py-1">
                        {/* Column headers */}
                        <div className="grid gap-x-3 px-1 pb-1 border-b border-border/40" style={{ gridTemplateColumns: "1fr 48px 52px 60px" }}>
                          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{t("hierarchical.colSector")}</span>
                          <span className="text-[10px] font-medium text-muted-foreground text-end uppercase tracking-wider">{t("hierarchical.colTarget")}</span>
                          <span className="text-[10px] font-medium text-muted-foreground text-end uppercase tracking-wider">{t("hierarchical.colAchieved")}</span>
                          <span className="text-[10px] font-medium text-muted-foreground text-end uppercase tracking-wider">{t("hierarchical.colGap")}</span>
                        </div>
                        {hierarchicalData!.sectors.map(s => {
                          const achieved = s.sectorAchievementRate;
                          const sectorLabel = displayHierarchicalSectorLabel(
                            s.sector,
                            t("hierarchical.unresolvedSector"),
                          );
                          // Negative gap = over-achievement (sector rate > 100%)
                          const gap = achieved != null ? Math.round((100 - achieved) * 10) / 10 : null;
                          const gapLabel = gap == null ? "—"
                            : gap < 0   ? `+${Math.abs(gap)}%`   // over-achieved
                            : gap === 0 ? t("hierarchical.onTarget")
                            :             `−${gap}%`;
                          const barWidth = achieved != null ? Math.min(achieved, 100) : 0;
                          return (
                            <div key={s.sector ?? "__unresolved__"} className="space-y-1.5">
                              <div className="grid gap-x-3 px-1 items-center" style={{ gridTemplateColumns: "1fr 48px 52px 60px" }}>
                                <span className="text-xs font-medium text-foreground truncate cursor-default" title={sectorLabel}>{sectorLabel}</span>
                                <span className="text-xs text-muted-foreground/70 text-end tabular-nums"><bdi dir="ltr">100%</bdi></span>
                                <span className="text-xs font-semibold text-foreground text-end tabular-nums">
                                  <bdi dir="ltr">{achieved != null ? `${achieved}%` : "—"}</bdi>
                                </span>
                                <span className="text-xs text-muted-foreground text-end tabular-nums" aria-label={t("aria.gap", { value: gapLabel })}>
                                  <bdi dir="ltr">{gapLabel}</bdi>
                                </span>
                              </div>
                              <ProgressBar size="sm" value={barWidth} aria-label={`${sectorLabel}: ${achieved != null ? `${achieved}%` : t("aria.noData")}`} className="mx-1 w-auto">
                                <ProgressBar.Track><ProgressBar.Fill /></ProgressBar.Track>
                              </ProgressBar>
                            </div>
                          );
                        })}
                        <p className="text-xs text-[var(--muted)] px-1 pt-1 leading-relaxed">
                          {t("hierarchical.achievementNote")}
                        </p>
                      </div>
                    )}
                  </ChartCard>
                </div>

                {/* Beneficiary Performance — 5/12 */}
                <div className="col-span-12 lg:col-span-5">
                  <UICard>
                    <UICard.Header className="gap-3">
                      <div className="flex flex-col gap-0.5">
                        <UICard.Title className="text-base">{t("performanceTab.beneficiaryPerformance")}</UICard.Title>
                        <UICard.Description>{t("performanceTab.reviewBeneficiary")}</UICard.Description>
                      </div>
                      <Segment
                        size="sm"
                        aria-label={t("aria.beneficiaryView")}
                        selectedKey={perfBenView}
                        onSelectionChange={(key) => setPerfBenView(key as "sector" | "state" | "gender")}
                        className="w-fit"
                      >
                        {(["sector", "state", "gender"] as const).map(view => (
                          <Segment.Item key={view} id={view}>
                            {view === "gender" ? t("benView.gender") : view === "state" ? t("benView.byState") : t("benView.bySector")}
                          </Segment.Item>
                        ))}
                      </Segment>
                    </UICard.Header>
                    <UICard.Content>
                      {isBenLoading ? (
                        <div className="space-y-2 animate-pulse pt-1">
                          {[1, 2, 3, 4].map(i => <div key={i} className="h-7 rounded bg-muted/40" />)}
                        </div>
                      ) : !benBreakdown ? (
                        <div className="py-6"><ChartEmptyState message={t("chartEmpty.beneficiary")} icon={Users} /></div>
                      ) : perfBenView === "gender" ? (
                        /* Gender breakdown */
                        <div className="space-y-3 pt-1">
                          {[
                            { label: t("beneficiaries.women"), value: benBreakdown.summary.female, fill: "var(--chart-5)" },
                            { label: t("beneficiaries.men"),   value: benBreakdown.summary.male,   fill: "var(--chart-3)" },
                            { label: t("beneficiaries.girls"), value: benBreakdown.summary.girls,  fill: "var(--chart-4)" },
                            { label: t("beneficiaries.boys"),  value: benBreakdown.summary.boys,   fill: "var(--chart-2)" },
                          ].map(({ label, value, fill }) => (
                            <StatusProgressRow key={label} label={label} value={value} total={benBreakdown.summary.total || 1} fill={fill} />
                          ))}
                          <p className="text-xs text-[var(--muted)] pt-1">
                            {t("benView.totalPrefix")} <span className="tabular-nums font-medium">{fmt(benBreakdown.summary.total)}</span> {t("benView.totalSuffix")}
                          </p>
                        </div>
                      ) : perfBenView === "state" ? (
                        /* By State */
                        (benBreakdown.byState ?? []).length === 0 ? (
                          <div className="py-6"><ChartEmptyState message={t("chartEmpty.stateBeneficiary")} icon={MapPin} /></div>
                        ) : (
                          <HorizontalBars
                            data={(benBreakdown.byState ?? []).slice(0, 10)}
                            categoryKey="stateName"
                            categoryWidth={82}
                            isRtl={isRtl}
                            bars={[{ dataKey: "total", name: t("chartSeries.beneficiaries"), fill: "var(--chart-3)" }]}
                          />
                        )
                      ) : (
                        /* By Sector */
                        (benBreakdown.bySector ?? []).length === 0 ? (
                          <div className="py-6"><ChartEmptyState message={t("chartEmpty.sectorBeneficiary")} icon={BarChart3} /></div>
                        ) : (
                          <HorizontalBars
                            data={(benBreakdown.bySector ?? []).slice(0, 10)}
                            categoryKey="sector"
                            categoryWidth={92}
                            isRtl={isRtl}
                            categoryFormatter={(v: string) => v.length > 13 ? `${v.slice(0, 12)}…` : v}
                            bars={[{ dataKey: "total", name: t("chartSeries.beneficiaries"), fill: "var(--chart-3)" }]}
                          />
                        )
                      )}
                    </UICard.Content>
                  </UICard>
                </div>
              </div>

              {/* ── 4. Activities And Reporting Performance ──────────────── */}
              <div className="grid grid-cols-12 gap-4 items-start">

                {/* Activity Completion Status — 6/12 */}
                <div className="col-span-12 lg:col-span-6">
                  <ChartCard
                    title={t("performanceTab.activityCompletion")}
                    description={t("performanceTab.monitorActivity")}
                    action={
                      <HLink href="/projects" className="inline-flex shrink-0 items-center gap-1 text-sm no-underline">
                        {t("viewAll")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                      </HLink>
                    }
                  >
                    {isSummaryLoading ? (
                      <div className="space-y-3 animate-pulse">
                        {[1, 2, 3].map(i => <div key={i} className="h-9 rounded bg-muted/40" />)}
                      </div>
                    ) : summary?.activitiesPlanned == null ? (
                      <ChartEmptyState message={t("chartEmpty.activity")} icon={Activity} />
                    ) : summary.activitiesPlanned === 0 ? (
                      <ChartEmptyState message={t("chartEmpty.plannedActivities")} icon={Activity} />
                    ) : (() => {
                      const total     = summary.activitiesPlanned;
                      const completed = summary.activitiesCompleted ?? 0;
                      const delayed   = summary.delayedActivities   ?? 0;
                      const inProg    = Math.max(0, total - completed - delayed);
                      const rows: { label: string; value: number; color: ProgressColor }[] = [
                        { label: t("activityStatus.completed"),  value: completed, color: "success" },
                        { label: t("activityStatus.inProgress"), value: inProg,    color: "accent"  },
                        { label: t("activityStatus.delayed"),    value: delayed,   color: "warning" },
                      ];
                      return (
                        <div className="space-y-3">
                          {rows.map(({ label, value, color }) => (
                            <StatusProgressRow key={label} label={label} value={value} total={total} color={color} />
                          ))}
                          <p className="text-xs text-[var(--muted)] pt-0.5">
                            <span className="tabular-nums font-medium">{fmt(total)}</span> {t("activityStatus.totalPlannedSuffix")}
                          </p>
                        </div>
                      );
                    })()}
                  </ChartCard>
                </div>

                {/* Reporting Performance — 6/12 */}
                <div className="col-span-12 lg:col-span-6">
                  <ChartCard
                    title={t("performanceTab.reportingPerformance")}
                    description={t("performanceTab.monitorReporting")}
                    action={
                      <HLink href="/reports/project" className="inline-flex shrink-0 items-center gap-1 text-sm no-underline">
                        {t("viewAll")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                      </HLink>
                    }
                  >
                    {!reportsSummary ? (
                      <ChartEmptyState message={t("chartEmpty.reportingPerformance")} icon={FileText} />
                    ) : (
                      <div className="space-y-3">
                        {/* Submitted count — context header, not a progress row */}
                        <div className="flex items-center justify-between pb-2 border-b border-[var(--separator)]">
                          <span className="text-sm text-[var(--muted)]">{t("reportingPerf.totalSubmitted")}</span>
                          <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(reportsSummary.total)}</span>
                        </div>
                        {/* Approved / Pending / Overdue as proportions of total */}
                        {[
                          { label: t("reportingPerf.approved"),         value: reportsSummary.approved,                   color: "success" as const },
                          { label: t("reportingPerf.awaitingApproval"), value: reportsSummary.awaitingApproval,            color: "warning" as const },
                          { label: t("reportingPerf.overdue"),          value: reportsSummary.awaitingApprovalOver14Days, color: "danger"  as const },
                        ].map(({ label, value, color }) => (
                          <StatusProgressRow key={label} label={label} value={value} total={reportsSummary.total} color={color} />
                        ))}
                        {/* Compliance rate — neutral, no threshold colours */}
                        <div className="flex items-center justify-between pt-2 border-t border-[var(--separator)]">
                          <span className="text-sm text-[var(--muted)]">{t("complianceRate")}</span>
                          <span className="text-sm font-semibold tabular-nums text-foreground">
                            {reportsSummary.total > 0 ? `${Math.round((reportsSummary.approved / reportsSummary.total) * 100)}%` : "—"}
                          </span>
                        </div>
                      </div>
                    )}
                  </ChartCard>
                </div>
              </div>

              {/* ── 5. Project Performance ───────────────────────────────── */}
              <ChartCard
                title={t("performanceTab.projectPerformance")}
                description={t("performanceTab.projectPerformanceDesc")}
              >
                {isHierarchicalLoading ? (
                  <div className="space-y-2">
                    {[1,2,3,4,5].map(i => <HSkeleton key={i} className="h-10 rounded-lg" />)}
                  </div>
                ) : (() => {
                  const allProjects = (hierarchicalData?.sectors ?? []).flatMap(s => s.projects);
                  if (allProjects.length === 0) {
                    return <ChartEmptyState message={t("projectPerfTable.noProjects")} icon={BarChart3} />;
                  }
                  return (
                    <ProjectPerformanceGrid projects={allProjects} />
                  );
                })()}
              </ChartCard>

              {/* ── 6. Performance Attention ─────────────────────────────── */}
              {(() => {
                type PAItem = { id: string; title: string; issue: string; context: string; href: string; urgency: number };
                const items: PAItem[] = [];

                // Overdue reports — highest urgency
                for (const r of (lateReports ?? []).slice(0, 2)) {
                  items.push({
                    id: `lr-${r.id}`,
                    title: r.title ?? r.projectTitle ?? t("fallbacks.untitledReport"),
                    issue: t("priorityActions.daysOverdue", { count: r.daysWaiting ?? 0 }),
                    context: r.stateName
                      ? getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language)
                      : "—",
                    href: r.reportType === "hq_sector" ? "/reports/hq-sector" : r.reportType === "program_state" ? "/reports/program-state" : "/reports/project",
                    urgency: 1,
                  });
                }

                // Projects with critical risks — use reason.code and reason.count
                for (const p of (attentionProjects ?? [])
                  .filter(ap => ap.followUpReasons.some(r => r.code === "active_critical_risk"))
                  .slice(0, 2)
                ) {
                  const critCount = p.followUpReasons.find(r => r.code === "active_critical_risk")?.count ?? 1;
                  items.push({
                    id: `cr-${p.projectId}`,
                    title: p.projectTitle ?? p.projectCode,
                    issue: t("priorityActions.criticalRiskCount", { count: critCount }),
                    context: p.sector,
                    href: `/projects/${p.projectId}`,
                    urgency: 1,
                  });
                }

                const seen = new Set<string>();
                const final = items
                  .sort((a, b) => a.urgency - b.urgency)
                  .filter(i => { if (seen.has(i.id)) return false; seen.add(i.id); return true; })
                  .slice(0, 5);

                if (final.length === 0) return null;

                const hasLateReports      = final.some(i => i.id.startsWith("lr-"));
                const hasCriticalRisks    = final.some(i => i.id.startsWith("cr-"));

                return (
                  <UICard>
                    <UICard.Header className="flex-row items-start justify-between gap-3">
                      <div className="flex flex-col gap-0.5">
                        <UICard.Title className="text-base">{t("performanceTab.performanceAttention")}</UICard.Title>
                        <UICard.Description>{t("performanceTab.performanceAttentionDesc")}</UICard.Description>
                      </div>
                      <Chip size="sm" variant="soft" color="warning" className="shrink-0 tabular-nums">{final.length}</Chip>
                    </UICard.Header>
                    <UICard.Content>
                      <div className="divide-y divide-[var(--separator)]">
                        {final.map(item => (
                          <Link
                            key={item.id} href={item.href}
                            className="group -mx-2 flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-[var(--default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                          >
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
                              <p className="mt-0.5 truncate text-xs text-[var(--muted)]">{item.context}</p>
                            </div>
                            <Chip size="sm" variant="soft" color="warning" className="shrink-0">{item.issue}</Chip>
                          </Link>
                        ))}
                      </div>
                      {/* View All destinations */}
                      {(hasLateReports || hasCriticalRisks) && (
                        <div className="mt-1 flex flex-wrap items-center gap-4 border-t border-[var(--separator)] pt-3">
                          {hasLateReports && (
                            <HLink href="/reports/project" className="inline-flex items-center gap-1 text-sm no-underline">
                              {t("performanceTab.viewAllOverdueReports")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                            </HLink>
                          )}
                          {hasCriticalRisks && (
                            <HLink href="/projects" className="inline-flex items-center gap-1 text-sm no-underline">
                              {t("performanceTab.viewAllCriticalRisks")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                            </HLink>
                          )}
                        </div>
                      )}
                    </UICard.Content>
                  </UICard>
                );
              })()}

            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              PROJECTS & STATES
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "projects" && (
            <div id="panel-projects" className="space-y-6">

              {/* ── Tab header ──────────────────────────────────────────── */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-[17px] font-semibold text-foreground leading-tight tracking-tight">
                    {t("projectsTab.heading")}
                  </h2>
                  <p className="mt-2 text-[13px] text-muted-foreground leading-snug max-w-xl">
                    {t("projectsTab.description")}
                  </p>
                </div>
              </div>

              {/* ── KPI summary — 4 factual cards ───────────────────────── */}
              <div
                className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"
                aria-label={t("aria.projectsStatesMetrics")}
              >
                {/* 1 — Total Projects */}
                {isSummaryLoading ? <PsKpiSkeleton /> : (
                  <OvKpiCard
                    icon={FolderKanban}
                    iconColor="text-primary"
                    label={t("projectsTab.totalProjects")}
                    value={summary !== undefined ? fmt(summary.totalProjects) : PS_INSUFFICIENT}
                    sub={t("projectsTab.withinScope")}
                    href="/projects"
                  />
                )}

                {/* 2 — Active Projects */}
                {isSummaryLoading ? <PsKpiSkeleton /> : (
                  <OvKpiCard
                    icon={Activity}
                    iconColor="text-emerald-500"
                    label={t("projectsTab.activeProjects")}
                    value={summary !== undefined ? fmt(summary.activeProjects) : PS_INSUFFICIENT}
                    sub={t("projectsTab.inImplementation")}
                  />
                )}

                {/* 3 — States Covered */}
                {isStatesLoading ? <PsKpiSkeleton /> : (
                  <OvKpiCard
                    icon={MapPin}
                    iconColor="text-sky-500"
                    label={t("projectsTab.statesCovered")}
                    value={summary !== undefined ? fmt(summary.statesCount) : PS_INSUFFICIENT}
                    sub={t("projectsTab.statesWithCoverage")}
                  />
                )}

                {/* 4 — Projects Requiring Follow-Up */}
                {(isAttentionLoading || isLateLoading)
                  ? <PsKpiSkeleton />
                  : (
                    <OvKpiCard
                      icon={AlertTriangle}
                      iconColor="text-amber-500"
                      label={t("projectsTab.requireFollowUp")}
                      value={psFollowUpCount !== null ? fmt(psFollowUpCount) : PS_INSUFFICIENT}
                      sub={
                        psFollowUpCount !== null && psBreakdown
                          ? psBreakdown
                          : t("projectsTab.basedOnIssues")
                      }
                    />
                  )
                }
              </div>

              {(isStrategic || isOperational) && (
                <div className="grid gap-6 md:grid-cols-7">

                  {/* Projects by State — grouped bar chart */}
                  <ChartCard
                    colSpan="col-span-4"
                    title={t("sections.projectsByState")}
                    description={t("sections.projectsByStateDesc")}
                  >
                    {isStatesLoading ? (
                      <div className="flex h-[260px] flex-col gap-2 py-2" aria-hidden="true">
                        {[75, 58, 88, 50, 68, 42, 60].map((w, i) => (
                          <HSkeleton key={i} className="h-3 rounded" style={{ width: `${w}%` }} />
                        ))}
                      </div>
                    ) : stateChartData.length === 0 ? (
                      <div className="h-[260px] flex items-center justify-center">
                        <ChartEmptyState message={t("chartEmpty.stateCoverage")} icon={MapPin} />
                      </div>
                    ) : (
                      <div
                        className="flex flex-col gap-3"
                        aria-label={t("aria.projectsByState", { detail: stateChartData.map(d => t("aria.projectsByStateItem", { name: d.name, total: d.total, active: d.active })).join("; ") })}
                      >
                        <ChartLegend items={[
                          { label: t("projectsTab.totalProjects"),  color: "var(--chart-1)" },
                          { label: t("projectsTab.activeProjects"), color: "var(--chart-3)" },
                        ]} />
                        <HorizontalBars
                          data={stateChartData}
                          categoryKey="name"
                          categoryWidth={130}
                          height={Math.min(420, Math.max(240, stateChartData.length * 30))}
                          isRtl={isRtl}
                          categoryFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v}
                          bars={[
                            { dataKey: "total",  name: t("projectsTab.totalProjects"),  fill: "var(--chart-1)" },
                            { dataKey: "active", name: t("projectsTab.activeProjects"), fill: "var(--chart-3)" },
                          ]}
                          tooltip={<StateBarsTooltip />}
                        />
                      </div>
                    )}
                    <p className="pt-2 text-xs text-[var(--muted)]">
                      {t("stateChartTooltip.multiStateNote")}
                    </p>
                  </ChartCard>

                  {/* Project Status Distribution */}
                  <ChartCard
                    colSpan="col-span-3"
                    className="self-start"
                    title={t("sections.reportsStatus")}
                    description={t("sections.reportsStatusDesc")}
                  >
                    {isSummaryLoading ? (
                      <div className="flex h-[260px] flex-col gap-2 py-2" aria-hidden="true">
                        {[70, 52, 88, 40, 60, 35, 48].map((w, i) => (
                          <HSkeleton key={i} className="h-3 rounded" style={{ width: `${w}%` }} />
                        ))}
                      </div>
                    ) : statusChartData.length === 0 ? (
                      <div className="h-[260px] flex items-center justify-center">
                        <ChartEmptyState message={t("chartEmpty.projects")} icon={FolderKanban} />
                      </div>
                    ) : statusChartData.length <= 5 ? (
                      /* ── Pro "Donut With Content" — 5 or fewer statuses ─── */
                      <div
                        className="flex flex-col items-center gap-4"
                        aria-label={t("aria.projectStatusDistribution", { detail: statusChartData.map(d => `${d.name} ${d.count}`).join(", ") })}
                      >
                        <div className="relative">
                          <ProPieChart height={200} width={200}>
                            <ProPieChart.Pie
                              cornerRadius={12} cx="50%" cy="50%"
                              data={statusChartData} dataKey="count" nameKey="name"
                              innerRadius="68%" paddingAngle={-20} strokeWidth={0}
                              onClick={(entry: Record<string, unknown>) => {
                                if (typeof entry.status === "string")
                                  navigate(`/projects?status=${entry.status}`);
                              }}
                              className="cursor-pointer"
                            >
                              {statusChartData.map((d) => (
                                <ProPieChart.Cell key={d.status} fill={d.color} />
                              ))}
                            </ProPieChart.Pie>
                            <ProPieChart.Tooltip content={<ShareTooltip total={statusChartData.reduce((sum, d) => sum + d.count, 0)} />} />
                          </ProPieChart>
                          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
                            <span className="text-3xl font-bold tabular-nums text-foreground">
                              {fmt(statusChartData.reduce((sum, d) => sum + d.count, 0))}
                            </span>
                            <span className="text-sm text-[var(--muted)]">{t("overviewTab.projects")}</span>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          {statusChartData.map((d) => (
                            <div key={d.status} className="flex items-center gap-3">
                              <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: d.color }} aria-hidden="true" />
                              <span className="min-w-24 text-sm text-foreground">{d.name}</span>
                              <span className="text-sm font-semibold tabular-nums text-foreground">{fmt(d.count)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      /* ── Horizontal bars — more than 5 distinct statuses ── */
                      <div aria-label={t("aria.projectStatusDistribution", { detail: statusChartData.map(d => `${d.name} ${d.count}`).join(", ") })}>
                        <HorizontalBars
                          data={statusChartData}
                          categoryKey="name"
                          categoryWidth={150}
                          height={Math.min(520, Math.max(260, statusChartData.length * 32))}
                          isRtl={isRtl}
                          categoryFormatter={(v: string) => v.length > 22 ? `${v.slice(0, 21)}…` : v}
                          bars={[{ dataKey: "count", name: t("chartSeries.projects"), fill: "var(--chart-3)", colorKey: "color" }]}
                          onBarClick={(row) => navigate(`/projects?status=${row.status}`)}
                        />
                      </div>
                    )}
                  </ChartCard>
                </div>
              )}

              {showInsights && (
                <OperationalFollowUp
                  draftProjectCount={psDraftProjects?.length}
                  isDraftProjectsLoading={isDraftProjectsLoading}
                  draftReportCount={reportsSummary?.draft}
                  isDraftReportsLoading={isReportsSummaryLoading}
                  lateReportCount={reportsSummary?.awaitingApprovalOver14Days}
                  isLateLoading={isReportsSummaryLoading}
                  criticalRiskCount={summary ? (summary.criticalRisks ?? 0) : undefined}
                  isCriticalLoading={isSummaryLoading}
                  returnedReportCount={reportsSummary?.returned}
                  isReturnedLoading={isReportsSummaryLoading}
                />
              )}

              {/* State Performance Table */}
              <ChartCard
                title={isState ? t("projectsTab.stateImplementation") : t("projectsTab.stateImplementationOverview")}
                description={t("projectsTab.stateImplementationDesc")}
                action={
                  <HLink href="/states" className="inline-flex shrink-0 items-center gap-1 text-sm no-underline">
                    {t("projectsTab.allStates")} <ArrowRight className="size-3.5 rtl:rotate-180" aria-hidden="true" />
                  </HLink>
                }
              >
                <StateTableErrorBoundary>
                  <StatePerformanceTable states={states ?? []} isLoading={isStatesLoading} showAll={isState} />
                </StateTableErrorBoundary>
              </ChartCard>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              BUDGET & DONORS
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "budget" && (
            <div id="panel-budget" className="space-y-6">
              {canViewBudgetAndDonors(role) ? (
                <>
                  {/* Fail-closed: approved role but scope not yet configured.
                      TC without Sectors and SPO without State must NOT fall back to
                      org-wide data — show a configuration message instead. */}
                  {/* Fail-closed: approved role but scope not configured — shown instead of data */}
                  {(tcMissingScope || spoMissingScope) && (
                    <div className="flex flex-col items-center justify-center py-16 gap-2 text-center text-muted-foreground">
                      <AlertTriangle className="h-7 w-7 opacity-30" />
                      <p className="text-sm font-medium">
                        {tcMissingScope ? t("budgetTab.sectorRequired") : t("budgetTab.stateRequired")}
                      </p>
                      <p className="text-xs max-w-xs leading-relaxed">
                        {tcMissingScope ? t("budgetTab.sectorRequiredDesc") : t("budgetTab.stateRequiredDesc")}
                      </p>
                    </div>
                  )}
                  {!tcMissingScope && !spoMissingScope && (
                    <>
                  {/* Section heading — description varies by role so state_program_officer
                      and TC users do not see language implying org-wide budget data. */}
                  <SectionHeader
                    title={t("budgetTab.heading")}
                    description={
                      role === "state_program_officer"
                        ? t("budgetTab.sectionHeadingState")
                        : isTc
                        ? t("budgetTab.sectionHeadingSector")
                        : t("budgetTab.sectionHeadingOrg")
                    }
                    action={
                      <HButton
                        variant="secondary"
                        size="sm"
                        onPress={() => setBenOpen(true)}
                        className="shrink-0"
                      >
                        <Users className="size-4" aria-hidden="true" />
                        <span className="hidden sm:inline">{t("budgetTab.viewBeneficiaryBreakdown")}</span>
                        <span className="sm:hidden">{t("budgetTab.breakdown")}</span>
                      </HButton>
                    }
                  />

                  {/* Budget summary cards */}
                  {summary?.currencyMixed ? (
                    /* Multi-currency — per-currency totals instead of a meaningless
                       cross-currency aggregate: Allocated, Spent, Remaining, Utilisation. */
                    <UICard>
                      <UICard.Header className="flex-row items-center gap-2">
                        <Chip size="sm" variant="soft" color="warning">
                          <DollarSign className="size-3.5" aria-hidden="true" />
                          {t("budgetTab.multipleCurrencies")}
                        </Chip>
                      </UICard.Header>
                      <UICard.Content className="flex flex-col gap-3">
                        {(summary.budgetByCurrency ?? []).map(bc => {
                          const negative = (bc.budgetRemaining ?? 0) < 0;
                          return (
                            <dl key={bc.currency} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                              {[
                                { label: t("budgetTab.allocatedLabel", { currency: bc.currency }), value: fmtMoney(bc.totalBudget, bc.currency) },
                                { label: t("budgetTab.spentLabel", { currency: bc.currency }), value: fmtMoney(bc.totalSpent, bc.currency), tone: "warning" },
                                { label: t("budgetTab.remainingLabel", { currency: bc.currency }), value: fmtMoney(bc.budgetRemaining, bc.currency), tone: negative ? "danger" : "success" },
                                { label: t("budgetTab.utilisationRate"), value: pct(bc.utilisationRate) },
                              ].map(cell => (
                                <div key={cell.label} className="flex flex-col gap-1 rounded-xl bg-[var(--default)] px-3 py-2.5">
                                  <dt className="text-xs text-[var(--muted)]">{cell.label}</dt>
                                  <dd className="text-base font-semibold tabular-nums text-foreground"
                                    style={cell.tone ? { color: `var(--${cell.tone})` } : undefined}>{cell.value}</dd>
                                </div>
                              ))}
                            </dl>
                          );
                        })}
                      </UICard.Content>
                    </UICard>
                  ) : (
                    /* Single currency: Allocated → Spent → Remaining → Utilisation.
                       State / TC users see project-level amounts, not an approved State
                       or Sector allocation, so the note must not imply one. */
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <BudgetKpi
                        icon={Wallet}
                        title={role === "state_program_officer" ? t("budgetTab.projectLevelBudget") : t("budgetTab.allocatedBudget")}
                        value={fmtMoney(summary?.totalBudget, summary?.currency)}
                        note={role === "state_program_officer"
                          ? t("budgetTab.projectLevelBudgetDesc")
                          : isTc
                          ? t("budgetTab.projectLevelSectorDesc")
                          : t("budgetTab.totalApprovedBudget")}
                      />
                      <BudgetKpi
                        icon={DollarSign}
                        status="warning"
                        title={t("budgetTab.spent")}
                        value={fmtMoney(summary?.totalSpent, summary?.currency)}
                        note={t("budgetTab.recordedExpenditure")}
                      />
                      <BudgetKpi
                        icon={PiggyBank}
                        status={summary?.budgetRemaining != null && summary.budgetRemaining < 0 ? "danger" : "success"}
                        title={t("budgetTab.remainingBalance")}
                        value={fmtMoney(summary?.budgetRemaining, summary?.currency)}
                        note={t("budgetTab.allocatedLessExpenditure")}
                      />
                      <BudgetKpi
                        icon={TrendingUpIcon}
                        title={t("budgetTab.utilisationRate")}
                        value={pct(summary?.burnRatePct)}
                        note={t("budgetTab.spentAsPercentage")}
                        progress={summary?.burnRatePct}
                      />
                    </div>
                  )}

                  {/* Beneficiary summary — Men, Women, Boys, Girls, Total */}
                  <KPIGroup orientation={isMobile ? "vertical" : "horizontal"}>
                    {[
                      { label: t("beneficiaries.men"),   value: benBreakdown?.summary?.male   ?? 0 },
                      { label: t("beneficiaries.women"), value: benBreakdown?.summary?.female ?? 0 },
                      { label: t("beneficiaries.boys"),  value: benBreakdown?.summary?.boys   ?? 0 },
                      { label: t("beneficiaries.girls"), value: benBreakdown?.summary?.girls  ?? 0 },
                      { label: t("beneficiaries.total"), value: benBreakdown?.summary?.total  ?? 0, total: true },
                    ].map((b, index) => (
                      <Fragment key={b.label}>
                        {index > 0 && <KPIGroup.Separator />}
                        <KPI>
                          <KPI.Header>
                            {b.total && <KPI.Icon status="success"><Users aria-hidden="true" /></KPI.Icon>}
                            <KPI.Title>{b.label}</KPI.Title>
                          </KPI.Header>
                          <KPI.Content>
                            <KPI.Value value={b.value} maximumFractionDigits={0} />
                          </KPI.Content>
                        </KPI>
                      </Fragment>
                    ))}
                  </KPIGroup>

                  {/* Donor Portfolio — approved for all Budget & Donors roles.
                      Data is already scoped server-side to each user's authorised
                      State (state roles) or Sector (TC) or org-wide (strategic/operational).
                      Frontend gate mirrors backend userScope roles. */}
                  {canViewBudgetAndDonors(role) && (
                    <ChartCard
                      title={t("budgetTab.donorPortfolio")}
                      description={
                        role === "state_program_officer"
                          ? t("budgetTab.donorPortfolioState")
                          : isTc
                          ? t("budgetTab.donorPortfolioSector")
                          : t("budgetTab.donorPortfolioOrg")
                      }
                    >
                      <DonorPortfolioTable
                        data={donorPortfolio}
                        isLoading={isDonorLoading}
                        isError={isDonorError}
                        onRetry={() => { void refetchDonor(); }}
                      />
                    </ChartCard>
                  )}

                  {/* Project Budget Performance — approved for all Budget & Donors roles.
                      Scoped server-side identically to the Donor Portfolio. */}
                  {canViewBudgetAndDonors(role) && (
                    <ChartCard
                      title={t("budgetTab.projectBudgetPerformance")}
                      description={t("budgetTab.projectBudgetPerformanceDesc")}
                    >
                      <ProjectBudgetPerformanceTable
                        data={projectBudgetPerf}
                        isLoading={isProjBudgetLoading}
                        isError={isProjBudgetError}
                        onRetry={() => { void refetchProjBudget(); }}
                        role={role}
                        spoStateId={spoStateId}
                      />
                    </ChartCard>
                  )}

                    </>
                  )}
                </>
              ) : (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-center text-muted-foreground">
                  <DollarSign className="h-6 w-6 opacity-20" />
                  <p className="text-sm">{t("budgetTab.restrictedRole")}</p>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              RISKS & FOLLOW-UP
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "risks" && (
            <div id="panel-risks" className="space-y-6">

              {/* Section header */}
              <SectionHeader
                title={t("risksTab.heading")}
                description={t("risksTab.description")}
              />

              {/* Risk Summary Strip + Horizontal Chart (strategic roles only) */}
              {isStrategic && (
                <>
                  <RiskSummaryStrip
                    critTotal={riskCritTotal}
                    highTotal={riskHighTotal}
                    statesAffected={riskStatesAffected}
                    overdueMitTotal={riskOverdueMit}
                    isLoading={isStatesLoading}
                  />
                  <RiskHorizontalChart
                    data={riskByStateData}
                    isLoading={isStatesLoading}
                    isRtl={isRtl}
                  />
                </>
              )}

              {/* Follow-Up Projects + Reports Awaiting Approval
                  Independent content-aware heights: flex items-start with self-start on each card.
                  Projects: ~54 % width on desktop; Reports: fills remaining space.
                  Both stack to full-width on mobile / narrow tablet. */}
              <div className="flex flex-col md:flex-row gap-6 items-start">
                <div className="w-full md:w-[54%] self-start">
                  <FollowUpProjectsPanel projects={attentionProjects} isLoading={isAttentionLoading} />
                </div>
                <div className="w-full md:flex-1 self-start">
                  <LateReportsPanel reports={lateReports} isLoading={isLateLoading} />
                </div>
              </div>

              {/* Approval Queue + Drafts In My Scope
                   Independent-height two-column layout: Approval Queue ~57 % width on
                   desktop; Drafts fills the remainder. Both stack on mobile/tablet. */}
              <div className="flex flex-col md:flex-row gap-6 items-start">
                <div className="w-full md:w-[57%] self-start">
                  <ApprovalQueueWidget
                    approvals={approvals}
                    isLoading={isApprovalsLoading}
                    role={role}
                  />
                </div>
                <div className="w-full md:flex-1 self-start">
                  <MyDraftsWidget />
                </div>
              </div>
            </div>
          )}

        </Tabs.Panel>
      </Tabs>

      {/* ── Beneficiary Breakdown (always mounted at root) ─────────────── */}
      <BeneficiaryBreakdownModal
        isOpen={benOpen}
        onOpenChange={setBenOpen}
        data={benBreakdown}
        isLoading={isBenLoading}
      />

    </div>
  );
}



export function ProjectBudgetPerformanceTable({
  data, isLoading, isError, onRetry, role, spoStateId: _spoStateId,
}: ProjectBudgetPerformanceTableProps) {
  const { t } = useTranslation("dashboard");
  const isTc  = role === "technical_coordinator";
  const isSpo = role === "state_program_officer";
  const { openRecord } = useRecordDetail();
  // row.budgetBasis is compared against its raw English business-term values
  // elsewhere (e.g. `row.budgetBasis === "Project-Level Budget"`), so only the
  // display copy is translated here — the comparisons themselves are untouched.
  const formatBudgetBasisLabel = (basis: string) =>
    basis === "Project-Level Budget" ? t("budgetWorkspace.projectBudgetBasis")
    : basis === "State Allocation" ? t("budgetWorkspace.stateAllocation")
    : basis;

  // ── All hooks MUST be declared before any conditional return ──────────
  const [search,         setSearch]         = useState("");
  const [statusFilter,   setStatusFilter]   = useState<string>("all");
  const [currencyFilter, setCurrencyFilter] = useState<string>("all");
  const [basisFilter,    setBasisFilter]    = useState<BpBasisFilter>("all");
  const [dataAvailFilter,setDataAvailFilter]= useState<BpDataAvailFilter>("all");
  const [sortKey,        setSortKey]        = useState<BpSortKey>("projectCode");
  const [sortDir,        setSortDir]        = useState<"asc" | "desc">("asc");
  const [currentPage,    setCurrentPage]    = useState(1);
  const [expandedId,     setExpandedId]     = useState<number | null>(null);
  const [viewMode, setViewMode] = useUrlViewMode("projectBudgetView", RECORD_REGISTRY_VIEWS, "table");

  const summaryStats = useMemo(() => {
    if (!data) return { withBudget: 0, withoutBudget: 0, withExpenditure: 0, negativeBalance: 0, currencies: 0 };
    const currSet = new Set<string>();
    let withBudget = 0, withoutBudget = 0, withExp = 0, negBal = 0;
    for (const e of data) {
      if (e.hasBudgetData) withBudget++;
      else withoutBudget++;
      if (e.hasRecordedExpenditure) withExp++;
      if (e.remainingBalance != null && e.remainingBalance < 0) negBal++;
      if (e.currency) currSet.add(e.currency);
    }
    return { withBudget, withoutBudget, withExpenditure: withExp, negativeBalance: negBal, currencies: currSet.size };
  }, [data]);

  const allCurrencies = useMemo(() => {
    if (!data) return [] as string[];
    const seen = new Set<string>();
    for (const e of data) { if (e.currency) seen.add(e.currency); }
    return Array.from(seen).sort();
  }, [data]);

  const allStatuses = useMemo(() => {
    if (!data) return [] as string[];
    const seen = new Set<string>();
    for (const e of data) { if (e.projectStatus) seen.add(e.projectStatus); }
    return Array.from(seen).sort();
  }, [data]);

  const filteredRows = useMemo(() => {
    if (!data) return [] as ProjectBudgetPerformanceEntry[];
    const q = search.trim().toLowerCase();
    return data.filter(e => {
      if (q) {
        const codeMatch  = e.projectCode.toLowerCase().includes(q);
        const titleMatch = e.projectTitle.toLowerCase().includes(q);
        const donorMatch = (e.donorName ?? "").toLowerCase().includes(q);
        if (!codeMatch && !titleMatch && !donorMatch) return false;
      }
      if (statusFilter !== "all" && e.projectStatus !== statusFilter) return false;
      if (currencyFilter !== "all" && (e.currency ?? "") !== currencyFilter) return false;
      if (basisFilter !== "all" && e.budgetBasis !== basisFilter) return false;
      if (dataAvailFilter === "with_budget"               && !e.hasBudgetData)           return false;
      if (dataAvailFilter === "without_budget"            && e.hasBudgetData)            return false;
      if (dataAvailFilter === "missing_currency"          && !e.hasMissingCurrency)      return false;
      if (dataAvailFilter === "missing_state_expenditure" && !e.missingStateExpenditure) return false;
      return true;
    });
  }, [data, search, statusFilter, currencyFilter, basisFilter, dataAvailFilter]);

  const sortedRows = useMemo(() => {
    const numericKeys: BpSortKey[] = ["allocatedBudget","spent","remainingBalance","utilisationRate"];
    const isNumeric = numericKeys.includes(sortKey);
    // Currency-safe: when multiple currencies are visible and sorting a financial column,
    // group by currency code first (deterministic alphabetical order) then sort within the group.
    // When a single currency is selected, compare numerically without currency grouping.
    const singleCurrency = currencyFilter !== "all";
    return [...filteredRows].sort((a, b) => {
      if (isNumeric && !singleCurrency) {
        const currCmp = (a.currency ?? "").localeCompare(b.currency ?? "");
        if (currCmp !== 0) return currCmp;
      }
      if (isNumeric) {
        const av = (a as unknown as Record<string, unknown>)[sortKey] as number | null | undefined;
        const bv = (b as unknown as Record<string, unknown>)[sortKey] as number | null | undefined;
        if (av == null && bv == null) return a.projectCode.localeCompare(b.projectCode);
        if (av == null) return 1;
        if (bv == null) return -1;
        const cmp = sortDir === "asc" ? av - bv : bv - av;
        return cmp !== 0 ? cmp : a.projectCode.localeCompare(b.projectCode);
      }
      const av = (a as unknown as Record<string, unknown>)[sortKey];
      const bv = (b as unknown as Record<string, unknown>)[sortKey];
      const as_ = av != null ? String(av) : "";
      const bs_ = bv != null ? String(bv) : "";
      const cmp = as_.localeCompare(bs_);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortKey, sortDir, currencyFilter]);

  const totalPages = Math.max(1, Math.ceil(sortedRows.length / BP_PAGE_SIZE));
  const safePage   = Math.min(currentPage, totalPages);
  const pageRows   = sortedRows.slice((safePage - 1) * BP_PAGE_SIZE, safePage * BP_PAGE_SIZE);


  const handleFilterChange = () => setCurrentPage(1);
  const statusText = (status: string) => t(`projectStatus.${status}`, { defaultValue: formatStatusLabel(status) });
  const sheetRow = viewMode === "table" && expandedId != null ? (data ?? []).find(r => r.projectId === expandedId) ?? null : null;

  const bpColumns: DataGridColumn<ProjectBudgetPerformanceEntry>[] = [
    { id: "projectCode", header: t("budgetWorkspace.projectCode"), allowsSorting: true, width: 130,
      cell: (row) => (
        <Link href={`/projects/${row.projectId}`} className="whitespace-nowrap font-mono text-xs text-[var(--accent)] hover:underline">
          <bdi dir="ltr">{row.projectCode}</bdi>
        </Link>
      ) },
    { id: "projectTitle", header: t("budgetWorkspace.projectTitle"), isRowHeader: true, allowsSorting: true, width: 240,
      cell: (row) => (
        <Link href={`/projects/${row.projectId}`} title={row.projectTitle}
          aria-label={t("budgetWorkspace.viewProject", { project: row.projectTitle })}
          className="line-clamp-2 text-sm leading-tight text-foreground hover:text-[var(--accent)]">
          {row.projectTitle}
        </Link>
      ) },
    { id: "donorName", header: t("budgetWorkspace.donor"), allowsSorting: true, width: 120,
      cell: (row) => <span className="block max-w-[160px] truncate text-sm text-[var(--muted)]">{row.donorName ?? "—"}</span> },
    { id: "budgetBasis", header: t("budgetWorkspace.budgetBasis"), allowsSorting: true, width: 170,
      cell: (row) => {
        const note = row.budgetBasis === "Project-Level Budget"
          ? isTc ? t("budgetWorkspace.projectLevelBudgetTcTooltip") : isSpo ? t("budgetWorkspace.projectLevelBudgetSpoTooltip") : undefined
          : undefined;
        return (
          <span className="inline-flex items-center gap-1 whitespace-nowrap text-sm text-[var(--muted)]" title={note}>
            {formatBudgetBasisLabel(row.budgetBasis)}
            {note && <Info className="size-3 shrink-0 opacity-50" aria-hidden="true" />}
          </span>
        );
      } },
    { id: "allocatedBudget", header: t("budgetWorkspace.allocatedBudget"), allowsSorting: true, align: "end", width: 140,
      cell: (row) => row.hasMissingCurrency
        ? <span className="text-[var(--muted)]" aria-label={t("budgetWorkspace.missingCurrencyAria")}>—</span>
        : <span className="whitespace-nowrap text-sm font-medium tabular-nums"><bdi dir="ltr">{fmtMoney(row.allocatedBudget, row.currency)}</bdi></span> },
    { id: "spent", header: t("budgetWorkspace.spent"), allowsSorting: true, align: "end", width: 130,
      cell: (row) => row.missingStateExpenditure
        ? <span className="text-[var(--muted)]" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span>
        : <span className="whitespace-nowrap text-sm tabular-nums"><bdi dir="ltr">{fmtMoney(row.spent, row.currency)}</bdi></span> },
    { id: "remainingBalance", header: t("budgetWorkspace.remainingBalance"), allowsSorting: true, align: "end", width: 140,
      cell: (row) => row.missingStateExpenditure
        ? <span className="text-[var(--muted)]" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span>
        : <span className="whitespace-nowrap text-sm tabular-nums"
            style={row.remainingBalance != null && row.remainingBalance < 0 ? { color: "var(--danger)", fontWeight: 500 } : undefined}>
            <bdi dir="ltr">{fmtMoney(row.remainingBalance, row.currency)}</bdi>
          </span> },
    { id: "utilisationRate", header: t("budgetWorkspace.utilisationRate"), allowsSorting: true, align: "end", width: 130,
      cell: (row) => row.missingStateExpenditure
        ? <span className="text-[var(--muted)]" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span>
        : (
          <div className="flex items-center justify-end gap-2">
            <span className="text-sm tabular-nums"><bdi dir="ltr">{pct(row.utilisationRate)}</bdi></span>
            {row.utilisationRate != null && (
              <div className="h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-[var(--default)]" role="progressbar"
                aria-valuenow={Math.round(Math.min(100, row.utilisationRate))} aria-valuemin={0} aria-valuemax={100}
                aria-label={t("budgetWorkspace.utilisationValue", { value: pct(row.utilisationRate) })}>
                <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.min(100, Math.max(0, row.utilisationRate))}%` }} />
              </div>
            )}
          </div>
        ) },
    { id: "projectStatus", header: t("budgetWorkspace.projectStatus"), allowsSorting: true, width: 130,
      cell: (row) => row.projectStatus
        ? <Chip size="sm" variant="soft" color={PROJECT_STATUS_CHIP[row.projectStatus] ?? "default"}>{statusText(row.projectStatus)}</Chip>
        : <span className="text-[var(--muted)]">—</span> },
    { id: "actions", header: <span className="sr-only">{t("budgetWorkspace.action")}</span>, align: "end", width: 150,
      cell: (row) => (
        <div className="flex items-center justify-end gap-1">
          <HButton size="sm" variant="ghost" onPress={() => setExpandedId(row.projectId)}
            aria-label={t("budgetWorkspace.expandDetails", { project: row.projectCode })}>
            {t("budgetWorkspace.details")}
          </HButton>
          <HLink href={`/projects/${row.projectId}`} className="inline-flex items-center gap-0.5 whitespace-nowrap text-sm no-underline"
            aria-label={t("budgetWorkspace.viewProject", { project: row.projectCode })}>
            {t("budgetWorkspace.view")}
            <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
          </HLink>
        </div>
      ) },
  ];

  // ── Loading / error / empty states ──────────────────────────────────
  if (isLoading) return <ProjectBudgetPerformanceSkeleton mode={viewMode as RecordRegistryView} />;

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-3 text-center">
        <AlertTriangle className="h-7 w-7 text-destructive/50" aria-hidden="true" />
        <div>
          <p className="text-sm font-medium text-foreground">{t("budgetWorkspace.projectLoadTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("budgetWorkspace.projectLoadDescription")}</p>
        </div>
        <HButton variant="secondary" size="sm" onPress={onRetry}>
          <RotateCcw className="size-3.5" aria-hidden="true" /> {t("budgetWorkspace.retry")}
        </HButton>
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 gap-2 text-center text-muted-foreground">
        <DollarSign className="h-6 w-6 opacity-20" aria-hidden="true" />
        <p className="text-sm">{t("budgetWorkspace.noProjectsAvailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary strip */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5" aria-label={t("budgetWorkspace.projectSummary")}>
        {[
          { label: t("budgetWorkspace.projectsWithBudget"), value: summaryStats.withBudget, warn: false },
          { label: t("budgetWorkspace.projectsWithoutBudget"), value: summaryStats.withoutBudget, warn: false },
          { label: t("budgetWorkspace.projectsWithExpenditure"), value: summaryStats.withExpenditure, warn: false },
          { label: t("budgetWorkspace.projectsWithNegativeBalance"), value: summaryStats.negativeBalance, warn: summaryStats.negativeBalance > 0 },
          { label: t("budgetWorkspace.currenciesInUse"), value: summaryStats.currencies, warn: false },
        ].map(stat => (
          <div key={stat.label} className="flex flex-col-reverse gap-1 rounded-xl bg-[var(--default)] px-3 py-2.5">
            <dt className="text-xs text-[var(--muted)]">{stat.label}</dt>
            <dd className="text-xl font-semibold tabular-nums leading-none" style={{ color: stat.warn ? "var(--warning)" : "var(--foreground)" }}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* Projects-style registry toolbar: controls at the logical start, presentation at the end. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5" role="group" aria-label={t("budgetWorkspace.projectToolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-sm font-medium text-[var(--muted)] select-none">
            <Filter className="size-4" aria-hidden="true" />
            {t("common:filter")}
          </div>
          <HSeparator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <SearchField value={search} onChange={(v) => { setSearch(v); handleFilterChange(); }} aria-label={t("budgetWorkspace.searchProjects")} className="min-w-[14rem] flex-1">
            <SearchField.Group className="w-full">
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("budgetWorkspace.searchProjects")} className="h-10" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
          <SelectField
            aria-label={t("budgetWorkspace.filterProjectStatus")}
            value={statusFilter}
            onChange={v => { setStatusFilter(v); handleFilterChange(); }}
            triggerClassName="h-10 min-w-[8.75rem]"
            options={[{ value: "all", label: t("budgetWorkspace.allStatuses") }, ...allStatuses.map(st => ({ value: st, label: statusText(st) }))]}
          />
          {allCurrencies.length > 1 && (
            <SelectField
              aria-label={t("budgetWorkspace.filterCurrency")}
              value={currencyFilter}
              onChange={v => { setCurrencyFilter(v); handleFilterChange(); }}
              triggerClassName="h-10 min-w-[7.5rem]"
              options={[{ value: "all", label: t("budgetWorkspace.allCurrencies") }, ...allCurrencies.map(c => ({ value: c, label: c }))]}
            />
          )}
          <SelectField
            aria-label={t("budgetWorkspace.filterBudgetBasis")}
            value={basisFilter}
            onChange={v => { setBasisFilter(v as BpBasisFilter); handleFilterChange(); }}
            triggerClassName="h-10 min-w-[10rem]"
            options={[
              { value: "all", label: t("budgetWorkspace.allBudgetBases") },
              { value: "Project-Level Budget", label: t("budgetWorkspace.projectBudgetBasis") },
              { value: "State Allocation", label: t("budgetWorkspace.stateAllocation") },
            ]}
          />
          <SelectField
            aria-label={t("budgetWorkspace.filterDataAvailability")}
            value={dataAvailFilter}
            onChange={v => { setDataAvailFilter(v as BpDataAvailFilter); handleFilterChange(); }}
            triggerClassName="h-10 min-w-[10rem]"
            options={[
              { value: "all", label: t("budgetWorkspace.allData") },
              { value: "with_budget", label: t("budgetWorkspace.withBudget") },
              { value: "without_budget", label: t("budgetWorkspace.withoutBudget") },
              { value: "missing_currency", label: t("budgetWorkspace.missingCurrency") },
              { value: "missing_state_expenditure", label: t("budgetWorkspace.missingStateExpenditure") },
            ]}
          />
        </div>
        <HSeparator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
        <div className="shrink-0" aria-label={t("budgetWorkspace.projectView")}>
          <ViewModeSwitcher
            available={[...RECORD_REGISTRY_VIEWS]}
            current={viewMode}
            onChange={setViewMode}
          />
        </div>
      </div>

      {(isTc || isSpo) && (
        <p className="rounded-xl bg-[var(--default)] px-3 py-2 text-xs text-[var(--muted)]">
          {t("budgetWorkspace.projectBasisContext")}
        </p>
      )}

      {/* The table retains the full analytical baseline. Card and compact modes
          reuse its authorised, filtered, sorted and paginated page rows. */}
      {viewMode === "table" ? (
        <>
          <DataGrid
            aria-label={t("budgetWorkspace.projectTable")}
            data={pageRows}
            columns={bpColumns}
            getRowId={(row) => row.projectId}
            contentClassName="min-w-[1380px]"
            sortDescriptor={{ column: sortKey, direction: sortDir === "asc" ? "ascending" : "descending" }}
            onSortChange={(d) => { setSortKey(d.column as BpSortKey); setSortDir(d.direction === "ascending" ? "asc" : "desc"); setCurrentPage(1); }}
            renderEmptyState={() => (
              <p className="py-8 text-center text-sm text-[var(--muted)]">
                {filteredRows.length === 0 && (data?.length ?? 0) > 0
                  ? t("budgetWorkspace.noProjectsFiltered")
                  : t("budgetWorkspace.noProjectsAvailable")}
              </p>
            )}
          />
          {/* Row details — HeroUI Pro Sheet from the inline end. */}
          <Sheet
            isOpen={sheetRow != null}
            onOpenChange={(open) => { if (!open) setExpandedId(null); }}
            placement={document.documentElement.dir === "rtl" ? "left" : "right"}
          >
            <Sheet.Backdrop>
              <Sheet.Content className="w-[min(440px,100vw)]">
                <Sheet.Dialog>
                  <Sheet.CloseTrigger />
                  {sheetRow && (
                    <>
                      <Sheet.Header className="ltr:pe-10 rtl:ps-10">
                        <span className="font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{sheetRow.projectCode}</bdi></span>
                        <Sheet.Heading>{sheetRow.projectTitle}</Sheet.Heading>
                        {sheetRow.donorName && <p className="text-sm text-[var(--muted)]">{sheetRow.donorName}</p>}
                      </Sheet.Header>
                      <Sheet.Body>
                        <ProjectBudgetCondensedDetails row={sheetRow} isSpo={isSpo} compact />
                      </Sheet.Body>
                      <Sheet.Footer>
                        <HLink href={`/projects/${sheetRow.projectId}`} className="inline-flex items-center gap-1 text-sm no-underline">
                          {t("budgetWorkspace.view")} <ChevronRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
                        </HLink>
                      </Sheet.Footer>
                    </>
                  )}
                </Sheet.Dialog>
              </Sheet.Content>
            </Sheet.Backdrop>
          </Sheet>
        </>
      ) : viewMode === "card" ? (
        pageRows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/60 py-10 text-center text-sm text-muted-foreground">
            {t("budgetWorkspace.noMatchingProjects")}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label={t("budgetWorkspace.projectCards")}>
            {pageRows.map(row => (
              <ProjectBudgetCard
                key={row.projectId}
                row={row}
                isSpo={isSpo}
                isExpanded={expandedId === row.projectId}
                onToggleDetails={() => setExpandedId(expandedId === row.projectId ? null : row.projectId)}
                onOpen={trigger => openRecord("project", row.projectId, trigger)}
              />
            ))}
          </div>
        )
      ) : (
        <div className="overflow-hidden rounded-xl border border-border/60" aria-label={t("budgetWorkspace.projectCompact")}>
          <div className="flex items-center gap-2 border-b bg-muted/30 px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            <span className="w-24 shrink-0">{t("budgetWorkspace.code")}</span>
            <span className="min-w-0 flex-1">{t("budgetWorkspace.projectTitle")}</span>
            <span className="hidden min-w-[9rem] sm:inline">{t("budgetWorkspace.donor")}</span>
            <span className="hidden w-24 md:inline">{t("budgetWorkspace.basis")}</span>
            <span className="hidden w-24 text-end lg:inline">{t("budgetWorkspace.allocated")}</span>
            <span className="hidden w-24 text-end lg:inline">{t("budgetWorkspace.spent")}</span>
            <span className="hidden w-16 text-end xl:inline">{t("budgetWorkspace.utilisation")}</span>
          </div>
          {pageRows.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">{t("budgetWorkspace.noMatchingProjects")}</p>
          ) : pageRows.map(row => (
            <ProjectBudgetCompactRow
              key={row.projectId}
              row={row}
              isSpo={isSpo}
              isExpanded={expandedId === row.projectId}
              onToggleDetails={() => setExpandedId(expandedId === row.projectId ? null : row.projectId)}
              onOpen={trigger => openRecord("project", row.projectId, trigger)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <TablePagination
          label={t("budgetWorkspace.projectPagination")}
          page={safePage}
          pageCount={totalPages}
          onPageChange={setCurrentPage}
          summary={t("budgetWorkspace.donorPaginationInfo", { from: (safePage - 1) * BP_PAGE_SIZE + 1, to: Math.min(safePage * BP_PAGE_SIZE, sortedRows.length), total: sortedRows.length, entity: t("budgetWorkspace.projectEntity") })}
        />
      )}
    </div>
  );
}

export interface ProjectBudgetPerformanceTableProps {
  data:           ProjectBudgetPerformanceEntry[] | undefined;
  isLoading:      boolean;
  isError:        boolean;
  onRetry:        () => void;
  role:           string;
  spoStateId:     unknown;
}

type BpDataAvailFilter = "all" | "with_budget" | "without_budget" | "missing_currency" | "missing_state_expenditure";

const BP_PAGE_SIZE = 10;


type BpBasisFilter = "all" | "Project-Level Budget" | "State Allocation";

function ProjectBudgetPerformanceSkeleton({ mode }: { mode: RecordRegistryView }) {
  const { t } = useTranslation("dashboard");
  return (
    <div className="space-y-4" aria-busy="true" aria-label={t("aria.loadingProjectBudget")}>
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {[0,1,2,3,4].map(i => (
          <div key={i} className="h-11 rounded-lg border border-border/40 bg-muted/30 animate-pulse" />
        ))}
      </div>
      <div className="h-9 rounded-lg border border-border/40 bg-muted/20 animate-pulse" />
      {mode === "card" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map(i => <div key={i} className="h-72 rounded-xl border border-border/60 bg-muted/10 animate-pulse" />)}
        </div>
      ) : (
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <div className="h-9 bg-muted/30 animate-pulse" />
          {[0,1,2,3,4,5,6,7,8,9].map(i => (
            <div key={i} className="h-12 border-t border-border/30 bg-muted/10 animate-pulse" style={{ animationDelay: `${i * 60}ms` }} />
          ))}
        </div>
      )}
    </div>
  );
}
