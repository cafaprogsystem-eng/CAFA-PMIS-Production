import { useState, useMemo, useEffect, Component } from "react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FolderKanban, Users, DollarSign, AlertTriangle, ArrowRight,
  Activity, CheckCircle2, FileText, Clock, Target,
  BarChart3, MapPin, Layers, Bell,
  Filter, X, ChevronUp, ChevronDown, ChevronRight, MessageSquare,
  TrendingUp as TrendingUpIcon, Info, RotateCcw,
  Search, Building2,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend, PieChart, Pie, Cell, LabelList,
} from "recharts";
import { Link, useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination, PaginationContent, PaginationItem,
  PaginationLink, PaginationPrevious, PaginationNext,
} from "@/components/ui/pagination";
import { CalendarProvider, CalendarGridCard, ScheduleCard, RemindersCard } from "@/components/calendar-widget";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { useUrlViewMode, RECORD_REGISTRY_VIEWS, type RecordRegistryView } from "@/lib/view-modes";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { Separator } from "@/components/ui/separator";
import { ErrorState } from "@/components/ui/error-state";
import type { ErrorVariant } from "@/components/ui/error-state";
import {
  Tooltip as UITooltip,
  TooltipContent as UITooltipContent,
  TooltipProvider as UITooltipProvider,
  TooltipTrigger as UITooltipTrigger,
} from "@/components/ui/tooltip";
import { SECTORS } from "@/lib/sectors";
import { formatStatusLabel, statusBadgeVariant } from "@/lib/format";
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
      <div>
        <h2 className="text-sm font-medium text-foreground tracking-tight">{title}</h2>
        {description && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{description}</p>}
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

/* ── Sort icon helper ────────────────────────────────────────────────── */
function SortIcon({ col, sortCol, sortDir }: { col: string; sortCol: string; sortDir: "asc" | "desc" }) {
  if (sortCol !== col) return <ChevronUp className="h-3 w-3 opacity-20" />;
  return sortDir === "asc" ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />;
}

/* ── Filter bar ──────────────────────────────────────────────────────── */
interface DashFilters { sector?: string; donor?: string; dateFrom?: string; dateTo?: string }

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

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/50 bg-card px-4 py-2.5 shadow-[0_1px_3px_0_rgb(0,0,0,0.03)]">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground/70 me-1">
        <Filter className="h-3.5 w-3.5" />
        {t("filters.filters")}
      </div>
      <Separator orientation="vertical" className="h-4 hidden sm:block" />

      <Select
        value={filters.sector ?? "all"}
        onValueChange={v => onChange({ ...filters, sector: v === "all" ? undefined : v })}
      >
        <SelectTrigger className="h-10 w-40 text-xs border-border/60 bg-muted/30 hover:bg-muted/50 transition-colors">
          <SelectValue placeholder={t("filters.allSectors")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("filters.allSectors")}</SelectItem>
          {sectorList.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
        </SelectContent>
      </Select>

      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={filters.dateFrom ?? ""}
          onChange={e => onChange({ ...filters, dateFrom: e.target.value || undefined })}
          className="h-10 rounded-md border border-border/60 bg-muted/30 px-2 text-xs hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
          placeholder={t("filters.dateFrom")}
          aria-label={t("filters.dateFrom")}
        />
        <span className="text-xs text-muted-foreground/60">—</span>
        <input
          type="date"
          value={filters.dateTo ?? ""}
          onChange={e => onChange({ ...filters, dateTo: e.target.value || undefined })}
          className="h-10 rounded-md border border-border/60 bg-muted/30 px-2 text-xs hover:bg-muted/50 focus:outline-none focus:ring-1 focus:ring-ring focus:bg-background transition-colors"
          placeholder={t("filters.dateTo")}
          aria-label={t("filters.dateTo")}
        />
      </div>

      {active && (
        <Button
          variant="ghost"
          size="sm"
          className="h-10 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1 ms-1"
          onClick={() => onChange({})}
        >
          <X className="h-3 w-3" />
          {t("filters.clear")}
        </Button>
      )}

      {active && (
        <span className="inline-flex items-center h-5 rounded-full bg-primary/10 text-primary text-xs font-medium px-2.5">{t("filters.active")}</span>
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
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Layers className="h-3.5 w-3.5 text-muted-foreground" />
            {t("drafts.myDrafts")}
          </CardTitle>
          {/* Header count — neutral badge; not shown while loading to avoid transient zeros */}
          {!isLoading && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-1.5 tabular-nums">
              {total}
            </span>
          )}
        </div>
        <CardDescription className="text-xs">
          {t("drafts.savedDrafts")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
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
          <div className="space-y-1.5">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <div key={i} className="h-9 rounded bg-muted/50 animate-pulse" />
            ))}
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
                  className="flex items-center justify-between rounded-md px-2 py-2.5 min-h-[40px] hover:bg-muted/50 transition-colors group"
                >
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    {label}
                  </span>
                  {/* Neutral count — drafts are not warnings; no red/amber */}
                  <span className={`text-xs tabular-nums font-medium ${count > 0 ? "text-foreground" : "text-muted-foreground/40"}`}>
                    {count}
                  </span>
                </Link>
              );
            })}
            {/* Total Drafts row removed — count is now in the card header */}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Notifications summary widget ────────────────────────────────────── */
function NotificationsSummaryWidget() {
  const { data: notifSummary, isLoading, isError, refetch } = useGetDashboardNotificationsSummary();
  const { t } = useTranslation(["dashboard", "notifications"]);
  const notificationModuleLabel = (module: string) =>
    t(entityTypeTranslationKey(NOTIF_MODULE_ENTITY_TYPES[module] ?? "unknown"), { ns: "notifications" });

  if (isLoading) return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" /> {t("sections.notifications")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-2 py-2.5 animate-pulse">
              <div className="h-[30px] w-[30px] rounded-full bg-muted/50 shrink-0" />
              <div className="h-3 flex-1 rounded bg-muted/50" />
              <div className="h-[18px] w-[18px] rounded-full bg-muted/40" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );

  if (isError) return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Bell className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" /> {t("sections.notifications")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-2 py-6 text-center">
          <AlertTriangle className="h-5 w-5 text-destructive/60" aria-hidden="true" />
          <p className="text-xs text-muted-foreground">{t("errorLoading", { ns: "notifications" })}</p>
          <Button variant="outline" size="sm" className="h-8" onClick={() => void refetch()}>
            {t("retry", { ns: "notifications" })}
          </Button>
        </div>
      </CardContent>
    </Card>
  );

  const totalUnread = notifSummary?.totalUnread ?? 0;
  const byModule = notifSummary?.byModule ?? [];
  const recent = notifSummary?.recent ?? [];

  return (
    <Card className="rounded-xl border-border shadow-sm flex flex-col">
      <CardHeader className="pb-3 shrink-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Bell className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            {t("sections.notifications")}
          </CardTitle>
          {totalUnread > 0 && (
            <span
              className="inline-flex items-center h-5 rounded-full bg-primary/10 text-primary text-xs font-medium px-2 tabular-nums"
              aria-label={t("notifications.unreadCount", { count: totalUnread })}
            >
              {totalUnread} {t("notifications.unread")}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-3 flex flex-col flex-1 min-h-0">
        {/* Scrollable content area — caps height to prevent card growing past adjacent charts */}
        <div className="overflow-y-auto max-h-[260px] space-y-0.5 pe-0.5">
          {byModule.length === 0 ? (
            <div className="flex flex-col items-center py-8 gap-2 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-400/70" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">{t("notifications.allCaughtUp")}</p>
            </div>
          ) : (
            byModule.slice(0, 5).map((m: { module: string; unread: number; total: number }) => {
              const meta = NOTIF_MODULE_META[m.module] ?? { icon: Bell, color: "text-muted-foreground", href: "/notifications" };
              const Icon = meta.icon;
              return (
                <Link key={m.module} href={meta.href}
                  className={`flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150 group ${m.unread > 0 ? "hover:bg-primary/[0.04]" : "hover:bg-muted/40"}`}>
                  <div className={`flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full transition-colors ${m.unread > 0 ? "bg-primary/10" : "bg-muted/40"}`}>
                    <Icon className={`h-3.5 w-3.5 ${m.unread > 0 ? "text-primary" : meta.color}`} aria-hidden="true" />
                  </div>
                  <span className={`text-sm flex-1 font-medium group-hover:text-primary transition-colors truncate ${m.unread > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                    {notificationModuleLabel(m.module)}
                  </span>
                  {m.unread > 0
                    ? <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] rounded-full bg-primary text-primary-foreground text-xs font-medium px-1 tabular-nums shrink-0" aria-label={`${m.unread} ${t("unread", { ns: "notifications" })}`}>{m.unread}</span>
                    : <span className="text-xs text-muted-foreground/50 tabular-nums shrink-0">{m.total}</span>
                  }
                </Link>
              );
            })
          )}

          {recent.length > 0 && (
            <>
              <Separator className="my-1.5" />
              <p className="px-2 pb-0.5 pt-1 text-xs font-medium text-muted-foreground/60">
                {t("notifications.recentActivity")}
              </p>
              {recent.slice(0, 3).map((n: { id: number; title: string; module: string; isRead: boolean }) => {
                const meta = NOTIF_MODULE_META[n.module] ?? { href: "/notifications", icon: Bell, color: "text-muted-foreground" };
                const RIcon = meta.icon;
                return (
                  <Link key={n.id} href={meta.href ?? "/notifications"}
                    className="flex items-start gap-2.5 rounded-lg px-2 py-2 hover:bg-muted/40 transition-colors duration-150 group">
                    <div className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${!n.isRead ? "bg-primary/10" : "bg-muted/40"}`}>
                      <RIcon className={`h-3 w-3 ${!n.isRead ? "text-primary" : "text-muted-foreground/60"}`} aria-hidden="true" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs leading-snug line-clamp-2 ${!n.isRead ? "font-medium text-foreground" : "text-muted-foreground"}`}>
                        {n.title}
                      </p>
                      <p className="text-xs text-muted-foreground/60 mt-0.5">{notificationModuleLabel(n.module)}</p>
                    </div>
                    {!n.isRead && <div className="mt-2 h-1.5 w-1.5 rounded-full bg-primary shrink-0 flex-none" aria-hidden="true" />}
                  </Link>
                );
              })}
            </>
          )}
        </div>

        {/* "View All" always visible outside scroll area */}
        <div className="pt-2 mt-auto shrink-0">
          <Link href="/notifications" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
            {t("notifications.viewAll")} <ArrowRight className="h-3 w-3 rtl:rotate-180" aria-hidden="true" />
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

/* ── Operational Follow-Up ───────────────────────────────────────────── */
/* Replaces the former "Executive Insights" section. State rankings, scores,
   tiers, and classified thresholds (Excellent/Good/Needs Follow-Up/Critical)
   have been removed — they were Dashboard-only and are not part of approved
   CAFA Business Logic. Only factual operational counts are shown. */

type OFUTile = {
  label:           string;
  sub:             string;
  count:           number | undefined;
  isLoading:       boolean;
  href?:           string;
  Icon:            React.ElementType;
  tileClass:       string;
  iconClass:       string;
  countClass:      string;
  /** When true, fall back to neutral surface/icon/count colour when count === 0 */
  neutralWhenZero?: boolean;
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
    {
      label: t("operationalFollowUp.draftProjects"), sub: t("drafts.savedDrafts"),
      count: draftProjectCount, isLoading: isDraftProjectsLoading,
      href: "/projects?status=draft", Icon: FolderKanban,
      tileClass:  "bg-slate-50/80 border-slate-200 hover:bg-slate-100/70 dark:bg-slate-900/30 dark:border-slate-700",
      iconClass:  "text-slate-400",
      countClass: "text-slate-700 dark:text-slate-300",
    },
    {
      label: t("operationalFollowUp.draftReports"), sub: t("drafts.savedDrafts"),
      count: draftReportCount, isLoading: isDraftReportsLoading,
      Icon: FileText,
      tileClass:  "bg-blue-50/60 border-blue-200 hover:bg-blue-50/90 dark:bg-blue-950/20 dark:border-blue-800",
      iconClass:  "text-blue-400",
      countClass: "text-blue-700 dark:text-blue-400",
    },
    {
      label: t("operationalFollowUp.lateReports"), sub: t("sections.overdueReportsDesc"),
      count: lateReportCount, isLoading: isLateLoading,
      Icon: Clock,
      tileClass:  "bg-red-50/60 border-red-200 hover:bg-red-50/90 dark:bg-red-950/20 dark:border-red-800",
      iconClass:  "text-red-400",
      countClass: "text-red-700 dark:text-red-400",
      neutralWhenZero: true,
    },
    {
      label: t("operationalFollowUp.criticalRisks"), sub: t("riskPanel.activeCriticalRisks"),
      count: criticalRiskCount, isLoading: isCriticalLoading,
      Icon: AlertTriangle,
      tileClass:  "bg-red-50/60 border-red-200 hover:bg-red-50/90 dark:bg-red-950/20 dark:border-red-800",
      iconClass:  "text-red-400",
      countClass: "text-red-700 dark:text-red-400",
      neutralWhenZero: true,
    },
    {
      label: t("operationalFollowUp.returnedReports"), sub: t("lateReports.returned"),
      count: returnedReportCount, isLoading: isReturnedLoading,
      Icon: RotateCcw,
      tileClass:  "bg-amber-50/60 border-amber-200 hover:bg-amber-50/90 dark:bg-amber-950/20 dark:border-amber-800",
      iconClass:  "text-amber-500",
      countClass: "text-amber-700 dark:text-amber-500",
      neutralWhenZero: true,
    },
  ];

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">{t("operationalFollowUp.title")}</CardTitle>
        <CardDescription className="text-xs">
          {t("operationalFollowUp.description")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {tiles.map(({ label, sub, count, isLoading, href, Icon, tileClass, iconClass, countClass, neutralWhenZero }) => {
            const useNeutral = neutralWhenZero && (count ?? 0) === 0;
            const appliedTile  = useNeutral ? "bg-card border-border hover:bg-muted/30 dark:hover:bg-muted/10" : tileClass;
            const appliedIcon  = useNeutral ? "text-muted-foreground/35" : iconClass;
            const appliedCount = useNeutral ? "text-muted-foreground" : countClass;
            const content = (
              <>
                <Icon className={`h-4 w-4 shrink-0 ${appliedIcon}`} aria-hidden="true" />
                {count === undefined ? (
                  <p className="text-xs text-muted-foreground italic">{t("operationalFollowUp.insufficientData")}</p>
                ) : (
                  <p className={`text-xl font-bold tabular-nums leading-none ${appliedCount}`}>
                    {count.toLocaleString()}
                  </p>
                )}
                <div>
                  <p className="text-xs font-medium leading-tight text-foreground">{label}</p>
                  <p className="text-[11px] text-muted-foreground leading-snug mt-0.5">{sub}</p>
                </div>
              </>
            );
            return isLoading ? (
              /* Per-tile loading skeleton */
              <div key={label} className="animate-pulse rounded-xl border border-border p-3 space-y-2" aria-hidden="true">
                <div className="h-3.5 w-3.5 rounded bg-muted/50" />
                <div className="h-5 w-8 rounded bg-muted/50" />
                <div className="h-2.5 w-20 rounded bg-muted/40" />
                <div className="h-2.5 w-28 rounded bg-muted/30" />
              </div>
            ) : (
              href ? (
                <Link
                  key={label}
                  href={href}
                  aria-label={`${label}: ${count ?? t("operationalFollowUp.insufficientData")}. ${sub}`}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 transition-colors ${appliedTile}`}
                >
                  {content}
                </Link>
              ) : (
                <div
                  key={label}
                  role="group"
                  aria-label={`${label}: ${count ?? t("operationalFollowUp.insufficientData")}. ${sub}`}
                  className={`flex flex-col gap-1.5 rounded-xl border p-3 ${appliedTile}`}
                >
                  {content}
                </div>
              )
            );
          })}
        </div>
        <p className="text-[11px] text-muted-foreground/55 mt-3 px-0.5">
          {t("operationalFollowUp.categoriesNote")}
        </p>
      </CardContent>
    </Card>
  );
}

/* ── Stable sortable table header ───────────────────────────────────── */
/*                                                                          *
 * This component MUST remain at module scope.                              *
 *                                                                          *
 * Defining it inside StatePerformanceTable (or any parent) assigns a new  *
 * function identity on every render. React treats each new identity as a  *
 * completely different component type and unmounts + remounts the entire  *
 * thead subtree on every cycle, corrupting hook reconciliation across the *
 * whole tree and causing the "change in hook order" crash.                *
 *                                                                          *
 * At module scope the identity is stable for the lifetime of the module. */
function SortableTableHeader({
  column, label, tooltip, activeSortColumn, sortDirection, onSort, className,
}: {
  column: SortableCol;
  label: string;
  tooltip?: string;
  activeSortColumn: SortableCol;
  sortDirection: "asc" | "desc";
  onSort: (col: SortableCol) => void;
  className?: string;
}) {
  const isActive = activeSortColumn === column;
  const ariaSort = isActive
    ? (sortDirection === "asc" ? "ascending" : "descending")
    : "none";
  return (
    <th
      scope="col"
      aria-sort={ariaSort as React.AriaAttributes["aria-sort"]}
      title={tooltip}
      className={`py-3 px-3 text-end text-xs font-medium text-muted-foreground whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      <button
        type="button"
        onClick={() => onSort(column)}
        className={`flex w-full items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${className?.includes("text-start") ? "justify-start text-start" : "justify-end text-end"}`}
      >
        {label}
        {tooltip && <Info className="h-3 w-3 opacity-40 shrink-0" aria-hidden="true" />}
        <SortIcon col={column} sortCol={activeSortColumn} sortDir={sortDirection} />
      </button>
    </th>
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

/* Column config — outside component so it's not recreated on each render.
   Labels are i18n keys resolved inside StatePerformanceTable using t(). */
const STATE_COL_KEY_DEFS: Array<{ col: SortableCol; labelKey: string; tooltipKey?: string }> = [
  { col: "totalProjects",          labelKey: "table.totalProjects" },
  { col: "activeProjects",         labelKey: "table.activeProjects" },
  { col: "reportsSubmitted",       labelKey: "table.reportsSubmitted" },
  { col: "reportsPending",         labelKey: "table.reportsPending" },
  { col: "openRisks",              labelKey: "table.openRisks" },
  { col: "criticalRisks",          labelKey: "table.criticalRisks" },
  { col: "activityCompletionPct",  labelKey: "table.activityPct" },
  { col: "reportingCompliancePct", labelKey: "table.compliancePct" },
];
// Legacy alias for components still using STATE_COL_DEFS
const STATE_COL_DEFS = STATE_COL_KEY_DEFS.map(d => ({ col: d.col, label: d.labelKey, tooltip: d.tooltipKey }));

function renderPct(pct: number | null | undefined, t: TFn): React.ReactNode {
  if (pct == null) return <span className="text-xs text-muted-foreground/40" aria-label={t("aria.dataUnavailable")}>—</span>;
  const barW = Math.min(100, Math.max(0, pct));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs tabular-nums text-foreground" aria-label={t("aria.percent", { value: pct })}><bdi dir="ltr">{pct}%</bdi></span>
      <div className="h-1.5 w-12 bg-muted/60 rounded-full overflow-hidden shrink-0" aria-hidden="true">
        <div className="h-full bg-primary/70 rounded-full transition-all" style={{ width: `${barW}%` }} />
      </div>
    </div>
  );
}

function StatePerformanceTable({
  states, isLoading, showAll,
}: {
  states: Array<{
    stateId: number; stateName: string; stateNameAr?: string | null; activeProjects: number; totalProjects?: number;
    progressPct: number; budgetUtilizationPct?: number | null; riskLevel: string;
    openRisks?: number | null; criticalRisks?: number | null;
    reportsSubmitted?: number | null; reportsPending?: number | null;
    activityCompletionPct?: number | null; reportingCompliancePct?: number | null;
  }>;
  isLoading: boolean;
  showAll: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const [sortCol, setSortCol] = useState<SortableCol>("stateName");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  /* Default to covered states; hidden for state-level users who always see all their states */
  const [showCoveredOnly, setShowCoveredOnly] = useState(true);
  // Resolved column defs with translated labels
  const stateColDefs = STATE_COL_KEY_DEFS.map(d => ({ col: d.col, label: t(d.labelKey) }));

  const colCount = STATE_COL_DEFS.length + 1; // +1 for the sticky State column

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

  const onSort = (col: SortableCol) => {
    if (sortCol === col) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  };

  /* renderTH removed — replaced by the module-scope SortableTableHeader component.
     See the comment above SortableTableHeader for why inner components must not be
     used here. */


  return (
    <div>
      {/* Sub-bar: sort hint (left) + covered/all toggle (right) */}
      <div className="flex items-center justify-between gap-3 px-4 py-2 border-b border-border/40 bg-muted/10">
        <p className="text-[11px] text-muted-foreground select-none">{t("stateTable.sortHint")}</p>
        {!showAll && (
          <div
            className="flex items-center gap-0.5 rounded-lg bg-muted/50 p-0.5 shrink-0"
            role="group"
            aria-label={t("aria.stateVisibility")}
          >
            <button
              type="button"
              aria-pressed={showCoveredOnly}
              onClick={() => setShowCoveredOnly(true)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                showCoveredOnly
                  ? "bg-card shadow-sm font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >{t("stateTable.coveredStates")}</button>
            <button
              type="button"
              aria-pressed={!showCoveredOnly}
              onClick={() => setShowCoveredOnly(false)}
              className={`text-xs px-2.5 py-1 rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                !showCoveredOnly
                  ? "bg-card shadow-sm font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >{t("stateTable.allStates")}</button>
          </div>
        )}
      </div>

      {/* Scrollable table container — page-level scroll is never triggered */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[900px] border-collapse">
          <thead>
            <tr className="border-b border-border/80 bg-muted/30 sticky top-0 z-20">
              {/* Sticky State column header */}
              <th
                scope="col"
                aria-sort={(sortCol === "stateName" ? (sortDir === "asc" ? "ascending" : "descending") : "none") as React.AriaAttributes["aria-sort"]}
                className="py-3 px-4 text-start text-xs font-medium text-muted-foreground sticky start-0 z-30 bg-muted/30 shadow-[1px_0_0_0_hsl(var(--border))] whitespace-nowrap"
              >
                <button
                  type="button"
                  onClick={() => onSort("stateName")}
                  className="flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {t("stateTable.stateColumn")} <SortIcon col="stateName" sortCol={sortCol} sortDir={sortDir} />
                </button>
              </th>
              {stateColDefs.map(c => (
                <SortableTableHeader
                  key={c.col}
                  column={c.col}
                  label={c.label}
                  activeSortColumn={sortCol}
                  sortDirection={sortDir}
                  onSort={onSort}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              /* Skeleton — matches column structure */
              [1, 2, 3, 4, 5].map(i => (
                <tr key={i} className="border-b animate-pulse">
                  <td className="py-3 px-4 sticky start-0 bg-card z-10">
                    <div className="h-3.5 w-28 rounded bg-muted/50" />
                  </td>
                  {stateColDefs.map(c => (
                    <td key={c.col} className="py-3 px-3">
                      <div className="h-3.5 w-8 rounded bg-muted/40 ms-auto" />
                    </td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              /* Empty state */
              <tr>
                <td colSpan={colCount} className="py-12 text-center">
                  <p className="text-sm font-medium text-foreground mb-1">{t("stateTable.noData")}</p>
                  <p className="text-xs text-muted-foreground">{t("stateTable.noAuthorisedStates")}</p>
                  {showCoveredOnly && !showAll && (
                    <button
                      type="button"
                      className="mt-3 text-xs text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                      onClick={() => setShowCoveredOnly(false)}
                    >
                      {t("stateTable.showAllStates")}
                    </button>
                  )}
                </td>
              </tr>
            ) : (
              sorted.map((state, rowIdx) => {
                const totalProj = state.totalProjects ?? state.activeProjects;
                /* Percentage columns are already null when data is unavailable (zero-denominator) */
                const actPct   = state.activityCompletionPct;
                const complPct = state.reportingCompliancePct;
                /* Count columns: COALESCE(0) in SQL — always a number; display as-is */
                const rptSub  = state.reportsSubmitted  ?? 0;
                const rptPend = state.reportsPending     ?? 0;
                const openR   = state.openRisks          ?? 0;
                const critR   = state.criticalRisks      ?? 0;
                return (
                  <tr
                    key={state.stateId}
                    className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${rowIdx % 2 === 1 ? "bg-muted/[0.03]" : ""}`}
                  >
                    {/* Sticky State cell */}
                    <td className={`py-3 px-4 font-medium sticky start-0 z-10 shadow-[1px_0_0_0_hsl(var(--border))] transition-colors ${rowIdx % 2 === 1 ? "bg-muted/[0.03]" : "bg-card"}`}>
                      <Link
                        href={`/states/${state.stateId}`}
                        aria-label={t("aria.viewState", { name: getStateLabel({ name: state.stateName, nameAr: state.stateNameAr }, i18n.language) })}
                        className="text-sm hover:text-primary transition-colors"
                      >
                        {getStateLabel({ name: state.stateName, nameAr: state.stateNameAr }, i18n.language)}
                      </Link>
                    </td>
                    {/* Total Projects */}
                    <td className="py-3 px-3 text-end tabular-nums text-sm">{totalProj}</td>
                    {/* Active Projects */}
                    <td className="py-3 px-3 text-end tabular-nums text-sm">{state.activeProjects}</td>
                    {/* Reports Submitted */}
                    <td className="py-3 px-3 text-end tabular-nums text-sm">{rptSub}</td>
                    {/* Reports Pending */}
                    <td className="py-3 px-3 text-end">
                      {rptPend > 0 ? (
                        <span className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-amber-100 text-amber-700 text-xs font-medium px-1.5 tabular-nums dark:bg-amber-950/40 dark:text-amber-400">
                          {rptPend}
                        </span>
                      ) : (
                        <span className="text-sm tabular-nums text-muted-foreground">0</span>
                      )}
                    </td>
                    {/* Open Risks */}
                    <td className="py-3 px-3 text-end tabular-nums text-sm">{openR}</td>
                    {/* Critical Risks */}
                    <td className="py-3 px-3 text-end">
                      {critR > 0 ? (
                        <span
                          className="inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-red-100 text-red-700 text-xs font-medium px-1.5 tabular-nums dark:bg-red-950/40 dark:text-red-400"
                          aria-label={t("aria.criticalRiskCount", { count: critR })}
                        >
                          {critR}
                        </span>
                      ) : (
                        <span className="text-sm tabular-nums text-muted-foreground">0</span>
                      )}
                    </td>
                    {/* Activity Completion */}
                    <td className="py-3 px-3 text-end">{renderPct(actPct, t)}</td>
                    {/* Reporting Compliance */}
                    <td className="py-3 px-3 text-end">{renderPct(complPct, t)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
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
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">
            {t(titleKey)}
          </CardTitle>
          {/* Header count — only shown when data is available to avoid transient zeros */}
          {!isLoading && (
            <span className={`inline-flex items-center justify-center h-5 min-w-5 rounded-full text-xs font-medium px-1.5 tabular-nums ${totalItems > 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {totalItems}
            </span>
          )}
        </div>
        <CardDescription className="text-xs">
          {t("queueSubtitle")}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0 pb-5">
        {isLoading ? (
          /* Subsection-aware skeleton — mirrors the Projects + Reports layout */
          <div className="space-y-3">
            <div className="flex gap-2">
              <div className="h-5 w-24 rounded-full bg-muted/50 animate-pulse" />
              <div className="h-5 w-24 rounded-full bg-muted/50 animate-pulse" />
            </div>
            <div className="space-y-1.5">
              {[1, 2, 3, 4].map(i => (
                <div key={i} className="h-9 rounded-lg bg-muted/50 animate-pulse" />
              ))}
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
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-0.5 text-xs">
                <span className="text-muted-foreground">{t("approvalQueue.projects")}</span>
                <span className="font-medium tabular-nums text-foreground">{totalProjects}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card px-2.5 py-0.5 text-xs">
                <span className="text-muted-foreground">{t("approvalQueue.reports")}</span>
                <span className="font-medium tabular-nums text-foreground">{totalReports}</span>
              </span>
            </div>

            {/* ── Actionable Projects ───────────────────────────────── */}
            {hasProjects && (
              <div className="mb-3">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                  {t("approvalQueue.projects")}
                </p>
                <div className="space-y-0.5">
                  {visibleProjects.map(p => (
                    <Link
                      key={`p-${p.id}`}
                      href={`/projects/${p.id}`}
                      aria-label={t("aria.reviewProject", { code: p.code })}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/40 group transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-none truncate">{p.code}</p>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{p.title}</p>
                      </div>
                      <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 shrink-0 whitespace-nowrap">
                        {formatStatusLabel(p.status)}
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {/* ── Actionable Reports ────────────────────────────────── */}
            {hasReports && (
              <div className={hasProjects ? "mt-2 pt-2.5 border-t border-border/60" : ""}>
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 px-1">
                  {t("approvalQueue.reports")}
                </p>
                <div className="space-y-0.5">
                  {visibleReports.map(r => (
                    <Link
                      key={`r-${r.id}`}
                      href={aqRtHref(r.reportType ?? "project")}
                      aria-label={t("aria.reviewReport", { title: r.title })}
                      className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-muted/40 group transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium leading-none truncate">{r.title}</p>
                        {r.stateName && (
                          <p className="text-xs text-muted-foreground truncate mt-0.5">{getStateLabel({ name: r.stateName, nameAr: (r as unknown as { stateNameAr?: string | null }).stateNameAr }, i18n.language)}</p>
                        )}
                      </div>
                      {/* Right: report type badge — more operationally useful than workflow status here */}
                      <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-xs font-medium px-2 py-0.5 shrink-0 whitespace-nowrap">
                        {aqRtLabel(r.reportType ?? "project", t)}
                      </span>
                    </Link>
                  ))}
                </div>

                {/* Report Type Breakdown — secondary compact line, below the report list.
                    Sum must equal totalReports (enforced in useMemo above). */}
                {reportBreakdown.length > 0 && (
                  <div className="mt-3 pt-2 border-t border-border/60 px-1">
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
              <div className="mt-3 pt-2.5 border-t border-border/60">
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpanded(prev => !prev)}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {expanded ? t("approvalQueue.showLess") : t("approvalQueue.showAll", { count: totalItems })}
                </button>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
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

/** Tailwind badge classes per stable follow-up reason code.
 *  Communicates severity at the individual reason level — never via card border. */
function followUpBadgeClass(code: string): string {
  if (code === "active_critical_risk")
    return "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-400";
  if (code === "returned_report" || code === "overdue_risk_mitigation")
    return "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400";
  if (code === "report_awaiting_approval")
    return "bg-blue-100 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400";
  // draft_project, draft_project_report — neutral
  return "bg-muted text-muted-foreground";
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
  if (rt === "activity")      return "Activity Report";
  if (rt === "project")       return "Project Report";
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
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium leading-snug">
            {t("sections.projectsNeedingAttention")}
          </CardTitle>
          {!isLoading && projects !== undefined && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-1.5 tabular-nums shrink-0">
              {projects.length}
            </span>
          )}
        </div>
        <CardDescription className="text-xs mt-0.5 leading-relaxed">
          {t("sections.projectsNeedingAttentionDesc")}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
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
                  <span
                    key={code}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-none ${followUpBadgeClass(code)}`}
                  >
                    <span className="tabular-nums font-semibold">{total}</span>
                    <span>{t(BREAKDOWN_LABEL_KEY[code as FollowUpReasonCode])}</span>
                  </span>
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
                    className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:bg-muted/30 hover:border-border transition-all duration-150 min-h-[48px]"
                  >
                    {/* Left: code · sector / project title */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-semibold text-foreground shrink-0">{p.projectCode}</span>
                        <span className="text-[11px] text-muted-foreground capitalize truncate">{p.sector}</span>
                      </div>
                      <p className="text-xs text-foreground/80 truncate mt-0.5 leading-snug">{p.projectTitle}</p>
                    </div>

                    {/* Right: reason badges (up to 2) + +N More */}
                    <div className="flex flex-wrap gap-1 justify-end shrink-0 max-w-[48%]">
                      {shown.map((reason, ri) => {
                        const label = reason.count > 1 ? `${reason.count} ${reason.label}` : reason.label;
                        return (
                          <span
                            key={ri}
                            className={`inline-flex items-center rounded-full text-[10px] font-medium px-1.5 py-0.5 leading-none whitespace-nowrap ${followUpBadgeClass(reason.code)}`}
                          >
                            {label}
                          </span>
                        );
                      })}
                      {extra.length > 0 && (
                        <UITooltipProvider>
                          <UITooltip>
                            <UITooltipTrigger asChild>
                              <span
                                className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 leading-none cursor-default"
                                aria-label={t("aria.moreFollowUpReasons", { count: extra.length, reasons: extra.map(r => r.label).join(", ") })}
                              >
                                {t("followUp.moreBadge", { count: extra.length })}
                              </span>
                            </UITooltipTrigger>
                            <UITooltipContent side="top" className="max-w-[220px] text-xs">
                              <ul className="list-disc list-inside space-y-0.5">
                                {extra.map((r, i) => (
                                  <li key={i}>{r.count > 1 ? `${r.count} ${r.label}` : r.label}</li>
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
                <button
                  type="button"
                  onClick={() => setExpanded(prev => !prev)}
                  aria-expanded={expanded}
                  className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                >
                  {expanded ? t("followUp.showLess") : t("followUp.showAll", { count: sorted.length })}
                </button>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
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
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-2">
        <div className="flex items-start gap-2 flex-wrap">
          <CardTitle className="text-sm font-medium leading-snug">
            {t("sections.overdueReports")}
          </CardTitle>
          {!isLoading && reports !== undefined && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-muted text-muted-foreground text-xs font-medium px-1.5 tabular-nums shrink-0">
              {reports.length}
            </span>
          )}
        </div>
        <CardDescription className="text-xs mt-0.5 leading-relaxed">
          {t("sections.overdueReportsDesc")}
        </CardDescription>
      </CardHeader>

      <CardContent className="pt-0">
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
                          className="flex items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 hover:bg-muted/30 hover:border-border transition-all duration-150 min-h-[48px]"
                        >
                          {/* Left: title / context */}
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-foreground leading-snug line-clamp-2">
                              {title}
                            </p>
                            {context && (
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{context}</p>
                            )}
                          </div>
                          {/* Right: type badge + days awaiting (neutral colour; fact communicated by inclusion) */}
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="inline-flex items-center rounded-full bg-muted text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 whitespace-nowrap">
                              {lrTypeLabel(r.reportType, t)}
                            </span>
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
                <button
                  type="button"
                  onClick={() => setExpanded(prev => !prev)}
                  aria-expanded={expanded}
                  className="text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded px-1"
                >
                  {expanded ? t("lateReports.showLess") : t("lateReports.showAll", { count: sorted.length })}
                </button>
              </div>
            )}
          </>
        )}

        {/* ── Footer — lightweight text links; not dominant buttons ── */}
        <div className="mt-3 pt-2.5 border-t border-border/50 flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/reports/project" className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
            {t("queue.viewProjectReports")}
          </Link>
          <Link href="/reports/activity" className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
            {t("queue.viewActivityReports")}
          </Link>
          <Link href="/reports/hq-sector" className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
            {t("queue.viewHqReports")}
          </Link>
          <Link href="/reports/program-state" className="text-xs text-muted-foreground hover:text-foreground hover:underline transition-colors">
            {t("queue.viewStateReports")}
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}


/* ── Chart helpers & semantic colour tokens ──────────────────────────── */
/** Compact axis tick: 1 234 567 → 1.2M, 850 000 → 850K, 1 200 → 1.2K */
const fmtCompact = (n: number): string => {
  if (n >= 1_000_000) return `${parseFloat((n / 1_000_000).toFixed(1))}M`;
  if (n >= 1_000)     return `${parseFloat((n / 1_000).toFixed(1))}K`;
  return String(Math.round(n));
};

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
  active:                "hsl(var(--primary))", // primary    — success/active
  completed:             "#14b8a6",              // teal-500
  on_hold:               "#f59e0b",              // amber-500
  returned:              "#f97316",              // orange-500
  closed:                "#64748b",              // slate-500
  cancelled:             "#ef4444",              // red-500
};

// Semantic colours — every metric must use the same colour across all charts
const CC = {
  achievement: "hsl(var(--primary))",   // blue  — beneficiaries achieved, indicator %
  target:      "#10b981",               // emerald — target lines / approved / completed
  budgetPct:   "#f59e0b",               // amber  — budget utilisation %, progress %, spent
  donor:       "#8b5cf6",               // violet — donor budget
  reportType:  "#06b6d4",               // cyan   — reports by type
  riskHigh:    "#ef4444",               // red
  riskMed:     "#f59e0b",               // amber
  riskLow:     "#10b981",               // emerald
  totalProj:   "#94a3b8",               // slate-400 — neutral "total" count bars
} as const;

/* ── Compact Overview KPI card (4-up executive row) ─────────────────── */
function OvKpiCard({
  icon: Icon, iconColor = "text-primary",
  label, value, sub, href, onClick, alert = false,
}: {
  icon: React.ElementType; iconColor?: string;
  label: string; value: React.ReactNode; sub?: React.ReactNode;
  href?: string; onClick?: () => void; alert?: boolean;
}) {
  const inner = (
    <div
      className={[
        "flex flex-col gap-2 rounded-xl border p-4 h-full min-h-[112px]",
        "shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] transition-all duration-150",
        alert
          ? "bg-red-50/50 dark:bg-red-950/15 border-red-300/60 dark:border-red-800/40"
          : "bg-card border-border/60",
        (href || onClick) ? "cursor-pointer hover:-translate-y-px hover:shadow-[0_4px_12px_0_rgb(0,0,0,0.07)]" : "",
        alert && (href || onClick) ? "hover:border-red-400/60 dark:hover:border-red-700/50" : (!alert && (href || onClick)) ? "hover:border-border" : "",
      ].filter(Boolean).join(" ")}
    >
      <Icon className={`h-[18px] w-[18px] shrink-0 ${alert ? "text-red-500 dark:text-red-400" : iconColor}`} aria-hidden="true" />
      <div>
        <p className={`text-[26px] font-semibold tabular-nums leading-none ${alert ? "text-red-700 dark:text-red-400" : "text-foreground"}`}>
          {value ?? "—"}
        </p>
        <p className={`text-[13px] font-medium mt-1.5 leading-tight ${alert ? "text-red-600/80 dark:text-red-500/70" : "text-foreground/80"}`}>
          {label}
        </p>
      </div>
      {sub && <p className="text-[12px] text-muted-foreground leading-tight mt-auto">{sub}</p>}
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className="text-start w-full h-full rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
        {inner}
      </button>
    );
  }
  return <div className="h-full">{inner}</div>;
}

/* ── Projects & States tab — KPI card skeleton ───────────────────────── */
function PsKpiSkeleton() {
  return (
    <div
      className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card p-4 min-h-[112px] shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] animate-pulse"
      aria-hidden="true"
    >
      <div className="h-[18px] w-[18px] rounded bg-muted/50" />
      <div className="space-y-1.5">
        <div className="h-[26px] w-14 rounded bg-muted/50" />
        <div className="h-3.5 w-28 rounded bg-muted/40" />
      </div>
      <div className="h-3 w-36 rounded bg-muted/30 mt-auto" />
    </div>
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
      statusLabel: string; statusCls: string; href: string; urgency: number;
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
        statusCls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
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
        statusCls: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400",
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
        statusCls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
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
        statusCls: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400",
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
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle className="text-[15px] font-semibold leading-snug">{t("priorityActions.title")}</CardTitle>
            <CardDescription className="text-xs mt-0.5">{t("priorityActions.description")}</CardDescription>
          </div>
          {!isLoading && items.length > 0 && (
            <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 text-xs font-semibold px-1.5 tabular-nums shrink-0">
              {items.length}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0 pb-4">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <div className="h-3 flex-1 rounded bg-muted/50" />
                <div className="h-5 w-24 rounded-full bg-muted/40" />
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-400/70" />
            <p className="text-sm text-muted-foreground">{t("priorityActions.empty")}</p>
          </div>
        ) : (
          <>
            <div className="divide-y divide-border/40">
              {items.map(item => (
                <Link
                  key={item.id}
                  href={item.href}
                  className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/40 transition-colors group -mx-2"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[13px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {item.title}
                      </span>
                      <span className="inline-flex items-center rounded-full border border-border/50 bg-muted/40 text-muted-foreground text-[10px] font-medium px-1.5 py-0.5 shrink-0">
                        {item.typeLabel}
                      </span>
                    </div>
                    {item.meta && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.meta}</p>
                    )}
                  </div>
                  <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium shrink-0 ${item.statusCls}`}>
                    {item.statusLabel}
                  </span>
                </Link>
              ))}
            </div>
            <div className="mt-3 pt-2.5 border-t border-border/60 flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href="/risks" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                {t("priorityActions.allRisks")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
              </Link>
              <Link href="/reports/project" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                {t("priorityActions.allReports")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
              </Link>
              <Link href="/projects" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                {t("priorityActions.allProjects")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
              </Link>
            </div>
          </>
        )}
      </CardContent>
    </Card>
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

/* ── Chart tooltip style ─────────────────────────────────────────────── */
const TT = {
  contentStyle: {
    backgroundColor: "hsl(var(--card))",
    borderColor:     "hsl(var(--border))",
    borderRadius:    "10px",
    fontSize:        "12px",
    boxShadow:       "0 4px 16px rgba(0,0,0,0.09)",
    padding:         "8px 12px",
  },
  labelStyle: { color: "hsl(var(--foreground))", fontWeight: 600, marginBottom: "4px", fontSize: "12px" },
  itemStyle:  { color: "hsl(var(--muted-foreground))", fontSize: "11px", lineHeight: "18px" },
  cursor:     { fill: "hsl(var(--muted)/0.35)" },
} as const;

/* ── ChartCard wrapper (consistent card + header styling) ────────────── */
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
  return (
    <Card className={`${colSpan ?? ""} ${className ?? ""} rounded-xl border-border shadow-sm`}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <CardTitle className="text-[15px] font-semibold leading-snug">{title}</CardTitle>
            {description && (
              <CardDescription className="text-xs mt-0.5 leading-relaxed">{description}</CardDescription>
            )}
          </div>
          {action}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
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
  payload?: Array<{ dataKey?: string; value?: number }>;
  label?: string;
}) {
  const { t } = useTranslation("dashboard");
  if (!active || !payload?.length) return null;
  const crit = Number(payload.find(p => p.dataKey === "critRisks")?.value ?? 0);
  const high = Number(payload.find(p => p.dataKey === "highRisks")?.value ?? 0);
  return (
    <div style={TT.contentStyle}>
      <p style={TT.labelStyle}>{label}</p>
      <p style={TT.itemStyle}>{t("riskPanel.activeCriticalRisks")}: {crit}</p>
      <p style={TT.itemStyle}>{t("riskPanel.activeHighRisks")}: {high}</p>
      <p style={{ ...TT.itemStyle, fontWeight: 600, color: "hsl(var(--foreground))" }}>
        {t("riskPanel.combined")} {crit + high}
      </p>
    </div>
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
  whenPositive: {
    countCls: string;
    iconCls: string;
    border: string;
    bg: string;
  } | null;   // null = always neutral (States Affected)
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
    {
      key:   "crit",
      label: t("riskPanel.activeCriticalRisks"),
      value: critTotal,
      Icon:  AlertTriangle,
      whenPositive: {
        countCls: "text-red-600 dark:text-red-400",
        iconCls:  "text-red-400 dark:text-red-500",
        border:   "border-red-200 dark:border-red-800/50",
        bg:       "bg-red-50/50 dark:bg-red-950/15",
      },
    },
    {
      key:   "high",
      label: t("riskPanel.activeHighRisks"),
      value: highTotal,
      Icon:  AlertTriangle,
      whenPositive: {
        countCls: "text-amber-600 dark:text-amber-400",
        iconCls:  "text-amber-400 dark:text-amber-500",
        border:   "border-amber-200 dark:border-amber-800/50",
        bg:       "bg-amber-50/50 dark:bg-amber-950/15",
      },
    },
    {
      key:   "states",
      label: t("riskPanel.statesAffected"),
      value: statesAffected,
      Icon:  MapPin,
      whenPositive: null,   // neutral regardless of value
    },
    {
      key:   "overdue",
      label: t("riskPanel.overdueMitigation"),
      value: overdueMitTotal,
      Icon:  Clock,
      whenPositive: {
        countCls: "text-amber-600 dark:text-amber-400",
        iconCls:  "text-amber-400 dark:text-amber-500",
        border:   "border-amber-200 dark:border-amber-800/50",
        bg:       "bg-amber-50/50 dark:bg-amber-950/15",
      },
    },
  ];

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" aria-label={t("aria.riskOverviewLoading")} aria-busy="true">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className="animate-pulse rounded-xl border border-border p-3 flex flex-col justify-between min-h-[76px] space-y-2">
            <div className="h-4 w-4 rounded bg-muted/50" />
            <div>
              <div className="h-5 w-10 rounded bg-muted/50" />
              <div className="h-3 w-28 rounded bg-muted/40 mt-1.5" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
      role="group"
      aria-label={t("aria.riskOverview")}
    >
      {items.map(({ key, label, value, Icon, whenPositive }) => {
        const isPos = whenPositive !== null && value !== null && value > 0;
        return (
          <div
            key={key}
            className={[
              "flex flex-col justify-between rounded-xl border p-3 min-h-[76px]",
              isPos
                ? `${whenPositive!.bg} ${whenPositive!.border}`
                : "bg-card border-border/60",
            ].join(" ")}
            role="note"
            aria-label={`${label}: ${value === null ? t("aria.dataUnavailable") : value}`}
          >
            <Icon
              className={`h-4 w-4 shrink-0 ${isPos ? whenPositive!.iconCls : "text-muted-foreground/35"}`}
              aria-hidden="true"
            />
            <div>
              {value === null ? (
                <p className="text-xl font-semibold tabular-nums leading-none text-muted-foreground/40" aria-hidden="true">
                  —
                </p>
              ) : (
                <p
                  className={`text-xl font-semibold tabular-nums leading-none ${isPos ? whenPositive!.countCls : "text-muted-foreground"}`}
                >
                  {value}
                </p>
              )}
              <p className="text-[11px] font-medium text-foreground/70 mt-1 leading-tight">
                {label}
              </p>
            </div>
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
  data, isLoading,
}: {
  data: RiskByStateEntry[];
  isLoading: boolean;
}) {
  // Content-aware plot height: 38 px per state row, min 220 px, max 360 px
  const plotHeight = Math.max(220, Math.min(360, data.length * 38));

  const { t } = useTranslation("dashboard");

  if (isLoading) {
    return (
      <Card className="rounded-xl border-border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-[15px] font-semibold leading-snug">{t("riskPanel.riskTitle")}</CardTitle>
          <CardDescription className="text-xs mt-0.5 leading-relaxed">{t("riskPanel.riskDesc")}</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 pb-5">
          {/* Skeleton matching horizontal bar structure + legend */}
          <div className="space-y-3 animate-pulse" aria-hidden="true">
            <div className="flex items-center gap-2 mb-1">
              <div className="h-2.5 w-16 rounded bg-muted/40" />
              <div className="h-2.5 w-16 rounded bg-muted/30" />
            </div>
            {[70, 55, 80, 45, 60].map((w, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="h-3 w-28 rounded bg-muted/50 shrink-0" />
                <div className="flex flex-col gap-1 flex-1">
                  <div className="h-3.5 rounded bg-red-200/60 dark:bg-red-900/30" style={{ width: `${w}%` }} />
                  <div className="h-3.5 rounded bg-amber-200/60 dark:bg-amber-900/30" style={{ width: `${Math.round(w * 0.6)}%` }} />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-xl border-border shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold leading-snug">{t("riskPanel.riskTitle")}</CardTitle>
        <CardDescription className="text-xs mt-0.5 leading-relaxed">{t("riskPanel.riskDesc")}</CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length === 0 ? (
          <div style={{ height: 120 }}>
            <ChartEmptyState message={t("riskPanel.noActiveRisks")} icon={AlertTriangle} />
          </div>
        ) : (
          <>
            <p className="sr-only">
              Horizontal grouped bar chart showing Active Critical and Active High Risk counts
              for {data.length} authorised State{data.length !== 1 ? "s" : ""}.
              States are ordered by combined risk count, descending, with state name as tie-breaker.
            </p>
            <div aria-hidden="true" style={{ height: plotHeight + 36 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data}
                  layout="vertical"
                  margin={{ top: 2, right: 44, left: 0, bottom: 4 }}
                  barCategoryGap="28%"
                  barGap={3}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    horizontal={false}
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.35}
                  />
                  <XAxis
                    type="number"
                    allowDecimals={false}
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    width={132}
                    tick={{ fill: "hsl(var(--foreground))", fontSize: 11 }}
                  />
                  <Tooltip content={RiskChartTooltip} cursor={TT.cursor} />
                  <Legend
                    iconSize={8}
                    iconType="circle"
                    wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }}
                  />
                  <Bar
                    dataKey="critRisks"
                    name={t("riskPanel.activeCriticalRisks")}
                    fill={CC.riskHigh}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={14}
                  >
                    <LabelList
                      dataKey="critRisks"
                      position="right"
                      formatter={(v: number) => v > 0 ? String(v) : ""}
                      style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}
                    />
                  </Bar>
                  <Bar
                    dataKey="highRisks"
                    name={t("riskPanel.activeHighRisks")}
                    fill={CC.riskMed}
                    radius={[0, 4, 4, 0]}
                    maxBarSize={14}
                  >
                    <LabelList
                      dataKey="highRisks"
                      position="right"
                      formatter={(v: number) => v > 0 ? String(v) : ""}
                      style={{ fontSize: 10, fill: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

/* ── Monthly Achievement Trend ───────────────────────────────────────── */
type MonthlyAchievementEntry = { month: string; achieved: number; target: number };

function MonthlyTrendChart({
  monthlyData, height, gradientSuffix,
}: {
  monthlyData: MonthlyAchievementEntry[] | undefined;
  height: number;
  gradientSuffix: string;
}) {
  const { t } = useTranslation("dashboard");
  const entries = monthlyData ?? [];
  return (
    <ChartCard
      colSpan="col-span-4"
      title={t("sections.monthlyTrend")}
      description={t("sections.monthlyTrendDesc")}
    >
      <div style={{ height }}>
        {entries.length === 0 ? (
          <ChartEmptyState message={t("noData")} />
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={entries} margin={{ top: 10, right: 16, left: 0, bottom: 4 }}>
              <defs>
                <linearGradient id={`colorAchieved${gradientSuffix}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={CC.achievement} stopOpacity={0.10} />
                  <stop offset="95%" stopColor={CC.achievement} stopOpacity={0} />
                </linearGradient>
                <linearGradient id={`colorTarget${gradientSuffix}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor={CC.target} stopOpacity={0.07} />
                  <stop offset="95%" stopColor={CC.target} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
              <XAxis
                dataKey="month"
                stroke="hsl(var(--muted-foreground))"
                fontSize={11} tickLine={false} axisLine={false} tickMargin={6}
              />
              <YAxis
                stroke="hsl(var(--muted-foreground))"
                fontSize={11} tickLine={false} axisLine={false}
                tickFormatter={fmtCompact}
                width={40}
              />
              <Tooltip
                contentStyle={TT.contentStyle}
                labelStyle={TT.labelStyle}
                itemStyle={TT.itemStyle}
                formatter={(value: number, name: string) => [fmt(value), name]}
              />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
              <Area
                type="monotone" dataKey="target" name={t("performanceTab.targetVsAchievement")}
                stroke={CC.target} strokeWidth={1.5} strokeDasharray="5 3"
                fillOpacity={1} fill={`url(#colorTarget${gradientSuffix})`}
                dot={false} activeDot={{ r: 3, strokeWidth: 0 }}
              />
              <Area
                type="monotone" dataKey="achieved" name={t("performanceTab.beneficiaryPerformance")}
                stroke={CC.achievement} strokeWidth={2}
                fillOpacity={1} fill={`url(#colorAchieved${gradientSuffix})`}
                dot={false} activeDot={{ r: 4, strokeWidth: 0 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </ChartCard>
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
          <p className="mt-0.5 text-foreground">{row.budgetBasis}</p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailCurrency")}</p>
          <p className={`mt-0.5 ${row.hasMissingCurrency ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
            <bdi dir="ltr">{row.currency ?? t("budgetWorkspace.missingCurrency")}</bdi>
          </p>
        </div>
        <div>
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailStatus")}</p>
          <p className="mt-0.5 text-foreground">{formatStatusLabel(row.projectStatus ?? "")}</p>
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
            <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{t("budgetWorkspace.projectDetailProjectLevel")}</p>
            <p className="mt-0.5 tabular-nums text-muted-foreground"><bdi dir="ltr">{fmtMoney(row.projectLevelSpent, row.currency)}</bdi></p>
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
          {t("budgetWorkspace.projectDetailStateExpUnavailable")}
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
  const { variant: statusVariant, className: statusCls } = statusBadgeVariant(row.projectStatus ?? "");
  const remNeg = row.remainingBalance != null && row.remainingBalance < 0 && !row.missingStateExpenditure;
  const unavailable = row.missingStateExpenditure;

  return (
    <Card className="group relative flex flex-col transition-shadow hover:shadow-sm">
      <button
        type="button"
        className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={t("aria.viewProject", { name: row.projectTitle })}
        onClick={event => onOpen(event.currentTarget)}
      />
      <CardContent className="relative z-10 flex flex-1 flex-col p-4 pointer-events-none">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="line-clamp-2 text-[15px] font-medium leading-snug group-hover:text-primary">{row.projectTitle}</h3>
            <p className="mt-1 truncate font-mono text-[11px] tracking-wide text-muted-foreground">{row.projectCode}</p>
          </div>
          <Badge variant={statusVariant} className={`shrink-0 text-[10px] ${statusCls ?? ""}`}>
            {formatStatusLabel(row.projectStatus)}
          </Badge>
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
      </CardContent>
    </Card>
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
  const { variant: statusVariant, className: statusCls } = statusBadgeVariant(row.projectStatus ?? "");
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
        <Badge variant={statusVariant} className={`shrink-0 text-[10px] ${statusCls ?? ""}`}>{formatStatusLabel(row.projectStatus)}</Badge>
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
  const cfgMap: Record<string, { label: string; cls: string }> = {
    linked:        { label: t("budgetWorkspace.linked"),   cls: "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400" },
    unlinked:      { label: t("budgetWorkspace.unlinked"), cls: "bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-950/30 dark:border-amber-800 dark:text-amber-400" },
    name_mismatch: { label: t("budgetWorkspace.dataIssues"), cls: "bg-orange-50 border-orange-200 text-orange-700 dark:bg-orange-950/30 dark:border-orange-800 dark:text-orange-400" },
    missing:       { label: t("budgetWorkspace.missingCurrency"), cls: "bg-red-50 border-red-200 text-red-700 dark:bg-red-950/30 dark:border-red-800 dark:text-red-400" },
  };
  const cfg = cfgMap[status] ?? { label: status, cls: "bg-muted border-border text-muted-foreground" };
  return (
    <span aria-label={t("aria.donorDataStatus", { status: cfg.label })} className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${cfg.cls}`}>
      {cfg.label}
    </span>
  );
}

function DonorAllocationBar({ share, label }: { share: number | null; label: string }) {
  if (share == null) return <span className="text-xs text-muted-foreground" aria-label={label}>—</span>;
  const barPct = Math.min(100, Math.max(0, share));
  return (
    <div className="flex items-center gap-2 min-w-[90px]">
      <span className="tabular-nums text-xs font-medium shrink-0 w-10 text-end"><bdi dir="ltr">{pct(share)}</bdi></span>
      <div
        className="flex-1 h-1.5 rounded-full bg-muted/50 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(share * 10) / 10}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className="h-full rounded-full bg-primary/60 transition-[width] duration-300"
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
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-4">
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
      </CardContent>
    </Card>
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

const DONOR_TABLE_COLS = 7 as const;

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

  const handleSort = (key: DonorSortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
    setDonorPage(1);
  };

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
        <Button variant="outline" size="sm" onClick={onRetry} className="text-xs gap-1.5">
          <RotateCcw className="h-3 w-3" aria-hidden="true" /> {t("budgetWorkspace.retry")}
        </Button>
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
        <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label={t("budgetWorkspace.selectDisplayCurrency")}>
          <span className="text-[11px] text-muted-foreground select-none">{t("budgetWorkspace.displayCurrency")}</span>
          {(activeCurrency !== undefined ? ["all", ...allCurrencies] : allCurrencies).map(c => {
            const isSelected = c === "all" ? activeCurrency === "all" : effectiveCurrency === c;
            return (
              <button
                key={c} type="button"
                onClick={() => {
                  if (onActiveCurrencyChange) onActiveCurrencyChange(c);
                  else setSelCurrency(c);
                }}
                aria-pressed={isSelected}
                className={`px-2.5 py-0.5 rounded-full border text-xs font-medium transition-colors ${
                  isSelected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                }`}
              >{c === "all" ? t("budgetWorkspace.allCurrencies") : c}</button>
            );
          })}
          <span className="w-full text-[10px] text-muted-foreground">{t("budgetWorkspace.selectedCurrencyNote")}</span>
        </div>
      )}

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" aria-label={t("budgetWorkspace.donorSummary")}>
        {[
          { label: t("budgetWorkspace.donorsRepresented"), value: summaryStats.donors,     warn: false },
          { label: t("budgetWorkspace.fundedProjects"),    value: summaryStats.projects,   warn: false },
          { label: t("budgetWorkspace.currenciesInUse"),  value: summaryStats.currencies, warn: false },
          { label: t("budgetWorkspace.donorDataIssues"),  value: summaryStats.issues,     warn: summaryStats.issues > 0 },
        ].map(stat => (
          <div
            key={stat.label}
            className={`rounded-lg border px-3 py-2.5 ${stat.warn ? "border-amber-200/70 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10" : "border-border/50 bg-muted/20"}`}
          >
            <p className={`text-[19px] font-semibold tabular-nums leading-none ${stat.warn ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
              {stat.value}
            </p>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5 leading-snug">{stat.label}</p>
          </div>
        ))}
      </div>

      {/* Data quality notice */}
      {issueRows.length > 0 && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-amber-200/70 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 px-3 py-2.5">
          <div className="flex items-start gap-2">
            <Info className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" aria-hidden="true" />
            <p className="text-xs text-amber-800 dark:text-amber-300">
              {t("budgetWorkspace.donorIssueNotice")}{" "}
              <span className="font-medium">{t("budgetWorkspace.projectsAffected", { count: summaryStats.issues })}</span>
            </p>
          </div>
          <Button
            variant="ghost" size="sm"
            className="text-xs h-auto py-0.5 px-2 shrink-0 text-amber-700 dark:text-amber-400 hover:bg-amber-100/50 dark:hover:bg-amber-900/20"
            onClick={() => setShowIssues(true)}
          >
            {t("budgetWorkspace.reviewDetails")}
          </Button>
        </div>
      )}

      {/* Projects-style registry toolbar: controls at the logical start, presentation at the end. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5" role="group" aria-label={t("budgetWorkspace.donorToolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground select-none">
            <Filter className="h-4 w-4" aria-hidden="true" />
            {t("common:filter")}
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input
            type="search"
            placeholder={t("budgetWorkspace.searchDonors")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="h-10 ps-8 text-sm border-border/60"
            aria-label={t("budgetWorkspace.searchDonors")}
          />
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1" role="group" aria-label={t("budgetWorkspace.filterDataStatus")}>
          {(["all", "linked", "unlinked", "issues"] as const).map(f => {
            const labels: Record<typeof f, string> = {
              all: t("budgetWorkspace.allRecords"), linked: t("budgetWorkspace.linked"), unlinked: t("budgetWorkspace.unlinked"), issues: t("budgetWorkspace.dataIssues"),
            };
            return (
              <button
                key={f} type="button"
                onClick={() => setStatusFilter(f)}
                aria-pressed={statusFilter === f}
                className={`h-10 rounded-md border px-2.5 text-sm font-medium transition-colors ${
                  statusFilter === f
                    ? "bg-primary/10 border-primary/30 text-primary"
                    : "bg-card border-border text-muted-foreground hover:text-foreground"
                }`}
              >{labels[f]}</button>
            );
          })}
        </div>
        </div>
        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
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
      <div className="rounded-xl border border-border/60 overflow-hidden overflow-x-auto" role="region" aria-label={t("budgetWorkspace.donorTable")}>
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <SortableTableHeader column="donorName"       label={t("budgetWorkspace.donor")} activeSortColumn={sortKey} sortDirection={sortDir} onSort={() => handleSort("donorName")} className="w-[200px] text-start" />
              <SortableTableHeader column="dataStatus"      label={t("budgetWorkspace.dataStatus")} activeSortColumn={sortKey} sortDirection={sortDir} onSort={() => handleSort("dataStatus")} className="w-[120px]" />
              <SortableTableHeader column="projectCount"    label={t("budgetWorkspace.fundedProjects")} activeSortColumn={sortKey} sortDirection={sortDir} onSort={() => handleSort("projectCount")} className="w-[130px]" />
              <th scope="col" className="w-[80px] py-2 px-3 text-end text-xs font-medium text-muted-foreground whitespace-nowrap">{t("budgetWorkspace.currency")}</th>
              <SortableTableHeader column="allocatedBudget" label={t("budgetWorkspace.allocatedBudget")} activeSortColumn={sortKey} sortDirection={sortDir} onSort={() => handleSort("allocatedBudget")} className="w-[150px]" />
              <SortableTableHeader column="portfolioShare"  label={t("budgetWorkspace.portfolioShare")} activeSortColumn={sortKey} sortDirection={sortDir} onSort={() => handleSort("portfolioShare")} className="w-[160px]" />
              <th scope="col" className="w-[80px] py-2 px-3 text-end text-xs font-medium text-muted-foreground whitespace-nowrap">{t("budgetWorkspace.action")}</th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pagedRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={DONOR_TABLE_COLS} className="text-center py-10 text-sm text-muted-foreground">
                  {donorTotal === 0 ? t("budgetWorkspace.noDonorsFiltered") : t("budgetWorkspace.noDonorsPage")}
                </TableCell>
              </TableRow>
            ) : pagedRows.flatMap(row => {
              const ds        = row.dataStatus ?? "unlinked";
              const pCount    = row.projectCount ?? row.projects ?? 0;
              const pList     = row.projectList ?? [];
              const isExp     = expandedDonor === row.donorKey;
              const budgetDisp = row.budgetInCurrency != null ? fmtMoney(row.budgetInCurrency, effectiveCurrency) : "—";
              const dispName  = row.donorName ?? row.donor ?? t("budgetWorkspace.unknownDonor");

              const mainRow = (
                <TableRow
                  key={row.donorKey}
                  className={`transition-colors ${isExp ? "bg-muted/20" : "hover:bg-muted/10"}`}
                >
                  {/* Donor */}
                  <TableCell className="py-2 align-middle">
                    <UITooltipProvider>
                      <UITooltip>
                        <UITooltipTrigger asChild>
                          <div className="flex max-w-[16rem] flex-col gap-0.5 text-start" aria-label={dispName} title={dispName}>
                            <span className="break-words text-sm font-medium text-foreground leading-tight line-clamp-2">
                              {dispName}
                            </span>
                            {ds === "unlinked" && (
                              <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium">
                                {t("budgetWorkspace.unlinkedDonorRecord")}
                              </span>
                            )}
                          </div>
                        </UITooltipTrigger>
                        {dispName.length > 26 && (
                          <UITooltipContent side="top" className="max-w-[240px] text-xs break-words">
                            {dispName}
                          </UITooltipContent>
                        )}
                      </UITooltip>
                    </UITooltipProvider>
                  </TableCell>
                  {/* Data Status */}
                  <TableCell className="py-2 align-middle">
                    <DonorStatusBadge status={ds} />
                  </TableCell>
                  {/* Funded Projects */}
                  <TableCell className="py-2 align-middle">
                    {pList.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExpandedDonor(isExp ? null : row.donorKey)}
                        aria-expanded={isExp}
                        aria-controls={`donor-detail-${row.donorKey}`}
                        className="flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        {t("budgetWorkspace.projectCount", { count: pCount })}
                        <ChevronRight className={`h-3 w-3 transition-transform duration-150 ${isExp ? "rotate-90" : ""}`} />
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("budgetWorkspace.projectCount", { count: pCount })}</span>
                    )}
                  </TableCell>
                  {/* Currency */}
                  <TableCell className="py-2 align-middle text-xs tabular-nums text-muted-foreground">
                    {row.currencyMixed
                      ? <span className="text-amber-600 dark:text-amber-400 text-[10px] font-medium">{t("budgetWorkspace.multiple")}</span>
                      : (row.currency ?? "—")}
                  </TableCell>
                  {/* Allocated Budget */}
                  <TableCell className="py-2 align-middle">
                    {effectiveCurrency
                      ? <span className="text-sm font-medium tabular-nums">{budgetDisp}</span>
                      : <DonorCurrencyAmounts row={row} />
                    }
                  </TableCell>
                  {/* Portfolio Share */}
                  <TableCell className="py-2 align-middle">
                    <DonorAllocationBar share={row.portfolioShare} label={`${dispName} portfolio share`} />
                  </TableCell>
                  {/* Action — expand/collapse funded project list.
                      Note: /projects?donor_id=… is NOT supported by the Projects
                      page (it only reads status/sector/stateId params) so that
                      link has been removed to avoid a misleading no-op action. */}
                  <TableCell className="py-2 align-middle text-end">
                    {pList.length > 0 ? (
                      <Button
                        variant="ghost" size="sm"
                        className="h-6 px-2 text-xs gap-1"
                        onClick={() => setExpandedDonor(isExp ? null : row.donorKey)}
                      >
                          {t("budgetWorkspace.details")}
                        <ChevronRight className={`h-3 w-3 transition-transform duration-150 ${isExp ? "rotate-90" : ""}`} />
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              );

              if (!isExp) return [mainRow];

              const detailRow = (
                <TableRow key={`${row.donorKey}-detail`} className="bg-muted/10">
                  <TableCell colSpan={DONOR_TABLE_COLS} id={`donor-detail-${row.donorKey}`} className="px-4 pb-3 pt-1">
                    <div className="space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                        Projects ({pList.length})
                      </p>
                      <div className="flex flex-wrap gap-1.5">
                        {pList.map(p => (
                          <Link key={p.id} href={`/projects/${p.id}`}>
                            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-card border border-border/50 text-xs hover:border-primary/40 hover:bg-primary/5 transition-colors cursor-pointer">
                              <span className="font-mono font-medium text-[10px] text-muted-foreground">{p.code}</span>
                              <span className="text-foreground max-w-[200px] truncate">{p.title}</span>
                            </span>
                          </Link>
                        ))}
                      </div>
                      {row.freeTextDonorName && ds === "name_mismatch" && (
                        <p className="text-[10px] text-muted-foreground mt-1">
                          <span className="font-medium">Free-text Donor value: </span>
                          <span className="font-mono bg-muted/50 px-1 rounded">{row.freeTextDonorName}</span>
                          {" — differs from canonical Donor name; please verify source data."}
                        </p>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );

              return [mainRow, detailRow];
            })}
          </TableBody>
        </Table>
      </div>
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
        <div className="flex items-center justify-between gap-3 border-t border-border/40 pt-3 flex-wrap" aria-label={t("budgetWorkspace.donorPagination")}>
          <p className="text-xs text-muted-foreground whitespace-nowrap" aria-live="polite">
            {t("budgetWorkspace.donorPaginationInfo", { from: (safePageD - 1) * donorPageSize + 1, to: Math.min(safePageD * donorPageSize, donorTotal), total: donorTotal, entity: t("budgetWorkspace.donorEntity") })}
          </p>
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={donorPageSize}
              onChange={e => { setDonorPageSize(Number(e.target.value)); setDonorPage(1); }}
              className="h-7 rounded border border-border bg-card text-xs px-1.5 text-muted-foreground focus-visible:outline-none focus-visible:ring-1"
              aria-label={t("aria.donorsPerPage")}
            >
              {[5, 10, 20].map(s => <option key={s} value={s}>{s} per page</option>)}
            </select>
            <Pagination className="w-auto mx-0">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    onClick={() => handleDonorPageChange(safePageD - 1)}
                    aria-disabled={safePageD <= 1}
                    tabIndex={safePageD <= 1 ? -1 : undefined}
                    className={safePageD <= 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
                  />
                </PaginationItem>
                <PaginationItem>
                  <span className="px-3 text-xs text-muted-foreground tabular-nums select-none" aria-current="page">
                    {safePageD} / {donorPages}
                  </span>
                </PaginationItem>
                <PaginationItem>
                  <PaginationNext
                    onClick={() => handleDonorPageChange(safePageD + 1)}
                    aria-disabled={safePageD >= donorPages}
                    tabIndex={safePageD >= donorPages ? -1 : undefined}
                    className={safePageD >= donorPages ? "pointer-events-none opacity-40" : "cursor-pointer"}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          </div>
        </div>
      )}

      {/* Data quality issues dialog */}
      <Dialog open={showIssues} onOpenChange={setShowIssues}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t("donorIssues.title")}</DialogTitle>
            <DialogDescription>
              {t("donorIssues.description")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5 mt-3">
            {issueRows.flatMap(d => {
              const pList    = d.projectList ?? [];
              const ds       = d.dataStatus ?? "unlinked";
              const issues   = d.dataIssues ?? [];
              const freeText = d.freeTextDonorName;
              return pList.map(p => (
                <div key={`${p.id}-${ds}`} className="flex items-start justify-between gap-3 rounded-lg border border-border/40 bg-muted/10 px-3 py-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap text-xs">
                      <span className="font-mono font-medium text-muted-foreground">{p.code}</span>
                      <span className="font-medium text-foreground truncate">{p.title}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground space-y-0.5">
                      {d.donorId != null && (
                        <div>{t("donorIssues.canonicalId")}: {d.donorId} · {t("donorIssues.name")}: <span className="font-medium">{d.donorName ?? d.donor}</span></div>
                      )}
                      {freeText && (
                        <div>{t("donorIssues.freeText")}: <span className="font-mono bg-muted/50 px-0.5 rounded">{freeText}</span></div>
                      )}
                      <div>{t("donorIssues.currency")}: {d.currency ? <span className="font-medium">{d.currency}</span> : <span className="italic">{t("donorIssues.missing")}</span>}</div>
                      {issues.length > 0 && (
                        <div>{t("donorIssues.issues", { count: issues.length })}: <span className="font-medium">{issues.join(", ")}</span></div>
                      )}
                    </div>
                  </div>
                  <DonorStatusBadge status={ds} />
                </div>
              ));
            })}
            {issueRows.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t("donorIssues.noneFound")}</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
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
export default function Dashboard() {
  const { t, i18n } = useTranslation("dashboard");
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

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, tabId: TabId) => {
    const idx = (TABS as readonly string[]).indexOf(tabId);
    let next: TabId | undefined;
    if (e.key === "ArrowLeft")  { e.preventDefault(); next = TABS[(idx - 1 + TABS.length) % TABS.length]; }
    if (e.key === "ArrowRight") { e.preventDefault(); next = TABS[(idx + 1) % TABS.length]; }
    if (e.key === "Home")       { e.preventDefault(); next = TABS[0]; }
    if (e.key === "End")        { e.preventDefault(); next = TABS[TABS.length - 1]; }
    if (next) { switchTab(next); setTimeout(() => document.getElementById(`tab-${next}`)?.focus(), 0); }
  };

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
        name:   toTitleCase(d.status),
        count:  d.count,
        status: d.status,
        color:  STATUS_COLORS[d.status] ?? "#94a3b8",
      })),
    [summary]
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
    { name: t("projectStatus.active"),    value: summary?.activeProjects ?? 0,    color: CC.achievement },
    { name: t("projectStatus.completed"), value: summary?.completedProjects ?? 0, color: CC.target },
    {
      name: t("projectStatus.other"),
      value: Math.max(0, (summary?.totalProjects ?? 0) - (summary?.activeProjects ?? 0) - (summary?.completedProjects ?? 0)),
      color: "hsl(var(--muted-foreground)/0.35)",
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
            <h1 className="text-[22px] font-semibold tracking-tight leading-tight text-foreground">
              {t("header.title")}
            </h1>
            <span className="hidden sm:inline-flex items-center rounded-full border border-border/60 bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              {t(`roles.${role}`, { defaultValue: ROLE_LABELS[role] ?? role })}
            </span>
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

      {/* ── Tabbed Panel ────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">

        {/* Tab bar */}
        <div
          role="tablist"
          aria-label={t("aria.dashboardSections")}
          className="flex overflow-x-auto border-b border-border/80 bg-muted/25"
          style={{ scrollbarWidth: "none" }}
        >
          {TAB_CONFIG.map(({ id, labelKey }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                id={`tab-${id}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`panel-${id}`}
                tabIndex={isActive ? 0 : -1}
                onClick={() => switchTab(id)}
                onKeyDown={e => handleTabKeyDown(e, id)}
                className={[
                  "relative flex-shrink-0 px-4 h-[38px] text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40 whitespace-nowrap border-b-2",
                  isActive
                    ? "text-primary border-primary font-semibold bg-background"
                    : "text-muted-foreground/70 border-transparent font-medium hover:text-foreground hover:bg-muted/40",
                ].join(" ")}
              >
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        {/* ── Tab panels ─────────────────────────────────────────────── */}
        <div className="p-5 sm:p-6">

          {/* ════════════════════════════════════════════════════════════
              OVERVIEW
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "overview" && (
            <CalendarProvider>
              <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="space-y-4">

                {/* ── Row 1: KPI Summary — 4 cards, equal width ─────────── */}
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  <OvKpiCard
                    icon={Activity} iconColor="text-blue-500"
                    label={t("overviewTab.activeProjects")}
                    value={fmt(summary?.activeProjects ?? 0)}
                    sub={t("overviewTab.totalProjects", { count: summary?.totalProjects ?? 0 })}
                  />
                  <OvKpiCard
                    icon={Users} iconColor="text-emerald-500"
                    label={t("overviewTab.beneficiariesReached")}
                    value={fmtCompact(summary?.totalBeneficiaries ?? 0)}
                    sub={t("overviewTab.viewBreakdown")}
                    onClick={() => setBenOpen(true)}
                  />
                  <OvKpiCard
                    icon={DollarSign} iconColor="text-amber-500"
                    label={t("overviewTab.budgetUtilisation")}
                    value={pct(summary?.burnRatePct)}
                    sub={t("overviewTab.spentToDate", { amount: fmtMoney(summary?.totalSpent, summary?.currency) })}
                    href="/budget"
                  />
                  <OvKpiCard
                    icon={AlertTriangle} iconColor="text-red-500"
                    label={t("overviewTab.activitiesAttention")}
                    value={fmt(summary?.delayedActivities ?? 0)}
                    sub={t("overviewTab.delayedOrPastDeadline")}
                    alert={!!(summary?.delayedActivities && summary.delayedActivities > 0)}
                  />
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
                      <div className="relative h-[340px]">
                        {projectStatusTotal === 0 ? (
                          <ChartEmptyState message={t("overviewTab.noProjectData")} icon={FolderKanban} />
                        ) : (
                          <>
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={projectStatusData}
                                  cx="50%" cy="40%"
                                  innerRadius={66} outerRadius={96}
                                  paddingAngle={3} dataKey="value" nameKey="name"
                                >
                                  {projectStatusData.map((entry, i) => (
                                    <Cell key={i} fill={entry.color} strokeWidth={0} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={TT.contentStyle}
                                  labelStyle={TT.labelStyle}
                                  itemStyle={TT.itemStyle}
                                  formatter={(v: number, name: string) => [
                                    `${fmt(v)} project${v !== 1 ? "s" : ""} (${Math.round((v / projectStatusTotal) * 100)}%)`,
                                    name,
                                  ]}
                                />
                                <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "8px" }} />
                              </PieChart>
                            </ResponsiveContainer>
                            {/* Centre total — uses pre-existing projectStatusTotal value; no new calculation */}
                            <div
                              className="absolute top-[40%] left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center pointer-events-none select-none"
                              aria-hidden="true"
                            >
                              <p className="text-xl font-bold tabular-nums text-foreground leading-none">{fmt(projectStatusTotal)}</p>
                              <p className="text-[10px] text-muted-foreground mt-0.5 leading-none">{t("overviewTab.projects")}</p>
                            </div>
                          </>
                        )}
                      </div>
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
            <div id="panel-performance" role="tabpanel" aria-labelledby="tab-performance" className="space-y-5">

              {/* ── 1. Performance KPI Summary ───────────────────────────── */}
              <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {isHierarchicalLoading || isSummaryLoading ? (
                  [1, 2, 3, 4].map(i => <div key={i} className="h-[112px] rounded-xl bg-muted/50 animate-pulse" />)
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
                        ? t("performanceTab.activitiesCompletedSub", { pct: Math.round((summary.activitiesCompleted / (summary.activitiesPlanned ?? 1)) * 100), planned: fmt(summary.activitiesPlanned ?? 0) })
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
                  <ChartCard
                    title={t("performanceTab.monthlyAchievementTrend")}
                    description={t("performanceTab.compareTargets")}
                  >
                    <div style={{ height: 340 }}>
                      {isSummaryLoading ? (
                        <div className="h-full rounded-lg bg-muted/40 animate-pulse" />
                      ) : (summary?.monthlyAchievement ?? []).length === 0 ? (
                        <ChartEmptyState message={t("chartEmpty.monthlyAchievement")} />
                      ) : (
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart
                            data={summary?.monthlyAchievement ?? []}
                            margin={{ top: 10, right: 16, left: 0, bottom: 4 }}
                          >
                            <defs>
                              <linearGradient id="colorAchievedPT" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={CC.achievement} stopOpacity={0.10} />
                                <stop offset="95%" stopColor={CC.achievement} stopOpacity={0} />
                              </linearGradient>
                              <linearGradient id="colorTargetPT" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor={CC.target} stopOpacity={0.07} />
                                <stop offset="95%" stopColor={CC.target} stopOpacity={0} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                            <XAxis dataKey="month" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickMargin={6} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtCompact} width={40} />
                            <Tooltip
                              contentStyle={TT.contentStyle} labelStyle={TT.labelStyle} itemStyle={TT.itemStyle}
                              formatter={(value: number, name: string) => [fmt(value), name]}
                            />
                            <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: "11px", paddingTop: "10px" }} />
                            <Area type="monotone" dataKey="target"   name="Target"   stroke={CC.target}      strokeWidth={1.5} strokeDasharray="5 3" fillOpacity={1} fill="url(#colorTargetPT)"   dot={false} activeDot={{ r: 3, strokeWidth: 0 }} />
                            <Area type="monotone" dataKey="achieved" name="Achieved" stroke={CC.achievement} strokeWidth={2}   fillOpacity={1} fill="url(#colorAchievedPT)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} />
                          </AreaChart>
                        </ResponsiveContainer>
                      )}
                    </div>
                  </ChartCard>
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
                                className="w-full grid items-center gap-x-2 px-2 py-1.5 rounded-lg hover:bg-muted/40 transition-colors text-start"
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
                                <div className="h-[3px] mx-7 mb-0.5 rounded-full bg-muted/50 overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all duration-300"
                                    style={{ width: `${Math.min(rate, 100)}%`, backgroundColor: CC.achievement }}
                                  />
                                </div>
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
                              <div className="relative h-1.5 rounded-full bg-muted/50 overflow-hidden mx-1" role="progressbar" aria-valuenow={achieved ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${sectorLabel}: ${achieved != null ? `${achieved}%` : t("aria.noData")}`}>
                                {achieved != null && (
                                  <div className="absolute inset-y-0 start-0 rounded-full transition-all duration-300" style={{ width: `${barWidth}%`, backgroundColor: CC.achievement }} />
                                )}
                              </div>
                            </div>
                          );
                        })}
                        <p className="text-[11px] text-muted-foreground/60 px-1 pt-1 leading-relaxed">
                          Achievement rate is the equal-weight average of project rates, where each project rate is the average of its valid indicator rates.
                        </p>
                      </div>
                    )}
                  </ChartCard>
                </div>

                {/* Beneficiary Performance — 5/12 */}
                <div className="col-span-12 lg:col-span-5">
                  <Card className="rounded-xl border-border shadow-sm">
                    <CardHeader className="pb-2">
                      <div>
                        <CardTitle className="text-[15px] font-semibold leading-snug">{t("performanceTab.beneficiaryPerformance")}</CardTitle>
                        <CardDescription className="text-xs mt-0.5">{t("performanceTab.reviewBeneficiary")}</CardDescription>
                      </div>
                      {/* Segmented view control */}
                      <div className="flex items-center gap-1 mt-2.5 bg-muted/40 rounded-lg p-0.5 w-fit" role="group" aria-label={t("aria.beneficiaryView")}>
                        {(["sector", "state", "gender"] as const).map(view => (
                          <button
                            key={view}
                            onClick={() => setPerfBenView(view)}
                            aria-pressed={perfBenView === view}
                            className={[
                              "px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              perfBenView === view
                                ? "bg-card text-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                            ].join(" ")}
                          >
                            {view === "gender" ? t("benView.gender") : view === "state" ? t("benView.byState") : t("benView.bySector")}
                          </button>
                        ))}
                      </div>
                    </CardHeader>
                    <CardContent className="pt-1 pb-5">
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
                            { label: t("beneficiaries.women"), value: benBreakdown.summary.female, color: "#ec4899" },
                            { label: t("beneficiaries.men"),   value: benBreakdown.summary.male,   color: CC.achievement },
                            { label: t("beneficiaries.girls"), value: benBreakdown.summary.girls,  color: "#f472b6" },
                            { label: t("beneficiaries.boys"),  value: benBreakdown.summary.boys,   color: "#60a5fa" },
                          ].map(({ label, value, color }) => {
                            const total = benBreakdown.summary.total || 1;
                            const pctVal = Math.round((value / total) * 100);
                            return (
                              <div key={label} className="space-y-1">
                                <div className="flex items-center justify-between text-xs">
                                  <span className="font-medium text-foreground">{label}</span>
                                  <span className="text-muted-foreground tabular-nums">
                                    {fmt(value)} <span className="text-muted-foreground/60">({pctVal}%)</span>
                                  </span>
                                </div>
                                <div className="h-1.5 rounded-full bg-muted/50 overflow-hidden" role="progressbar" aria-valuenow={pctVal} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pctVal}%`}>
                                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pctVal}%`, backgroundColor: color }} />
                                </div>
                              </div>
                            );
                          })}
                          <p className="text-[11px] text-muted-foreground/60 pt-1">
                            {t("benView.totalPrefix")} <span className="tabular-nums font-medium">{fmt(benBreakdown.summary.total)}</span> {t("benView.totalSuffix")}
                          </p>
                        </div>
                      ) : perfBenView === "state" ? (
                        /* By State */
                        (benBreakdown.byState ?? []).length === 0 ? (
                          <div className="py-6"><ChartEmptyState message={t("chartEmpty.stateBeneficiary")} icon={MapPin} /></div>
                        ) : (
                          <div style={{ height: 260 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={(benBreakdown.byState ?? []).slice(0, 10)} layout="vertical" margin={{ top: 2, right: 16, left: 0, bottom: 2 }} barCategoryGap="30%">
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                                <YAxis dataKey="stateName" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={82} />
                                <Tooltip contentStyle={TT.contentStyle} labelStyle={TT.labelStyle} itemStyle={TT.itemStyle} cursor={TT.cursor} formatter={(v: number) => [fmt(v), t("chartSeries.beneficiaries")]} />
                                <Bar dataKey="total" name={t("chartSeries.beneficiaries")} fill={CC.achievement} radius={[0, 3, 3, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )
                      ) : (
                        /* By Sector */
                        (benBreakdown.bySector ?? []).length === 0 ? (
                          <div className="py-6"><ChartEmptyState message={t("chartEmpty.sectorBeneficiary")} icon={BarChart3} /></div>
                        ) : (
                          <div style={{ height: 260 }}>
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={(benBreakdown.bySector ?? []).slice(0, 10)} layout="vertical" margin={{ top: 2, right: 16, left: 0, bottom: 2 }} barCategoryGap="30%">
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.4} />
                                <XAxis type="number" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={fmtCompact} />
                                <YAxis dataKey="sector" type="category" stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} width={92} tickFormatter={(v: string) => v.length > 13 ? `${v.slice(0, 12)}…` : v} />
                                <Tooltip contentStyle={TT.contentStyle} labelStyle={TT.labelStyle} itemStyle={TT.itemStyle} cursor={TT.cursor} formatter={(v: number) => [fmt(v), t("chartSeries.beneficiaries")]} />
                                <Bar dataKey="total" name={t("chartSeries.beneficiaries")} fill={CC.achievement} radius={[0, 3, 3, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )
                      )}
                    </CardContent>
                  </Card>
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
                      <Link href="/projects" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1 shrink-0">
                        {t("viewAll")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                      </Link>
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
                      const rows: { label: string; value: number; color: string; dotCls: string }[] = [
                        { label: t("activityStatus.completed"),  value: completed, color: CC.target,      dotCls: "bg-emerald-500" },
                        { label: t("activityStatus.inProgress"), value: inProg,    color: CC.achievement, dotCls: "bg-primary"     },
                        { label: t("activityStatus.delayed"),    value: delayed,   color: CC.budgetPct,   dotCls: "bg-amber-400"   },
                      ];
                      return (
                        <div className="space-y-3">
                          {rows.map(({ label, value, color, dotCls }) => {
                            // Only show percentage when denominator is valid
                            const pctVal = total > 0 ? Math.round((value / total) * 100) : null;
                            return (
                              <div key={label} className="space-y-1.5">
                                <div className="flex items-center justify-between text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotCls}`} aria-hidden="true" />
                                    <span className="font-medium text-foreground">{label}</span>
                                  </div>
                                  <span className="tabular-nums text-muted-foreground">
                                    {fmt(value)}{pctVal != null && <span className="text-muted-foreground/60"> ({pctVal}%)</span>}
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-muted/50 overflow-hidden" role="progressbar" aria-valuenow={pctVal ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pctVal != null ? `${pctVal}%` : t("aria.noData")}`}>
                                  <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pctVal ?? 0}%`, backgroundColor: color }} />
                                </div>
                              </div>
                            );
                          })}
                          <p className="text-[11px] text-muted-foreground/60 pt-0.5">
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
                      <Link href="/reports/project" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1 shrink-0">
                        {t("viewAll")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                      </Link>
                    }
                  >
                    {!reportsSummary ? (
                      <ChartEmptyState message={t("chartEmpty.reportingPerformance")} icon={FileText} />
                    ) : (
                      <div className="space-y-3">
                        {/* Submitted count — context header, not a progress row */}
                        <div className="flex items-center justify-between pb-2 border-b border-border/40">
                          <span className="text-xs text-muted-foreground">{t("reportingPerf.totalSubmitted")}</span>
                          <span className="text-xs font-semibold tabular-nums text-foreground">{fmt(reportsSummary.total)}</span>
                        </div>
                        {/* Approved / Pending / Overdue as proportions of total */}
                        {[
                          { label: t("reportingPerf.approved"),         value: reportsSummary.approved,                   color: CC.target,    dotCls: "bg-emerald-500" },
                          { label: t("reportingPerf.awaitingApproval"), value: reportsSummary.awaitingApproval,            color: CC.budgetPct, dotCls: "bg-amber-400"   },
                          { label: t("reportingPerf.overdue"),          value: reportsSummary.awaitingApprovalOver14Days, color: CC.riskHigh,  dotCls: "bg-red-500"     },
                        ].map(({ label, value, color, dotCls }) => {
                          const total  = reportsSummary.total;
                          const pctVal = total > 0 ? Math.round((value / total) * 100) : null;
                          return (
                            <div key={label} className="space-y-1.5">
                              <div className="flex items-center justify-between text-xs">
                                <div className="flex items-center gap-1.5">
                                  <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotCls}`} aria-hidden="true" />
                                  <span className="font-medium text-foreground">{label}</span>
                                </div>
                                <span className="tabular-nums text-muted-foreground">
                                  {fmt(value)}{pctVal != null && <span className="text-muted-foreground/60"> ({pctVal}%)</span>}
                                </span>
                              </div>
                              <div className="h-2 rounded-full bg-muted/50 overflow-hidden" role="progressbar" aria-valuenow={pctVal ?? 0} aria-valuemin={0} aria-valuemax={100} aria-label={`${label}: ${pctVal != null ? `${pctVal}%` : t("aria.noData")}`}>
                                <div className="h-full rounded-full transition-all duration-300" style={{ width: `${pctVal ?? 0}%`, backgroundColor: color }} />
                              </div>
                            </div>
                          );
                        })}
                        {/* Compliance rate — neutral, no threshold colours */}
                        <div className="flex items-center justify-between pt-1 border-t border-border/40">
                          <span className="text-xs text-muted-foreground">{t("complianceRate")}</span>
                          <span className="text-xs font-semibold tabular-nums text-foreground">
                            {reportsSummary.total > 0 ? `${Math.round((reportsSummary.approved / reportsSummary.total) * 100)}%` : "—"}
                          </span>
                        </div>
                      </div>
                    )}
                  </ChartCard>
                </div>
              </div>

              {/* ── 5. Project Performance ───────────────────────────────── */}
              <Card className="rounded-xl border-border shadow-sm">
                <CardHeader className="pb-3">
                  <CardTitle className="text-[15px] font-semibold">{t("performanceTab.projectPerformance")}</CardTitle>
                  <CardDescription className="text-xs mt-0.5">
                    {t("performanceTab.projectPerformanceDesc")}
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-0 pb-4">
                  {isHierarchicalLoading ? (
                    <div className="space-y-2 animate-pulse">
                      {[1,2,3,4,5].map(i => <div key={i} className="h-10 rounded-lg bg-muted/40" />)}
                    </div>
                  ) : (() => {
                    const allProjects = (hierarchicalData?.sectors ?? []).flatMap(s => s.projects);
                    if (allProjects.length === 0) {
                      return (
                        <div className="flex flex-col items-center justify-center py-8 gap-2 text-center">
                          <BarChart3 className="h-6 w-6 text-muted-foreground/30" />
                          <p className="text-sm text-muted-foreground/60">{t("projectPerfTable.noProjects")}</p>
                        </div>
                      );
                    }
                    return (
                      <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="border-b border-border/50">
                              <th className="text-start font-medium text-muted-foreground py-2 px-2 whitespace-nowrap">{t("projectPerfTable.code")}</th>
                              <th className="text-start font-medium text-muted-foreground py-2 px-2">{t("projectPerfTable.projectTitle")}</th>
                              <th className="text-start font-medium text-muted-foreground py-2 px-2 whitespace-nowrap hidden sm:table-cell">{t("projectPerfTable.sector")}</th>
                              <th className="text-start font-medium text-muted-foreground py-2 px-2 whitespace-nowrap hidden lg:table-cell">{t("projectPerfTable.state")}</th>
                              <th className="text-end font-medium text-muted-foreground py-2 px-2 whitespace-nowrap">{t("projectPerfTable.validIndicators")}</th>
                              <th className="text-end font-medium text-muted-foreground py-2 px-2 whitespace-nowrap">{t("projectPerfTable.missingData")}</th>
                              <th className="text-end font-medium text-muted-foreground py-2 px-2 whitespace-nowrap">{t("projectPerfTable.achievementRate")}</th>
                              <th className="py-2 px-2 w-[1%]" />
                            </tr>
                          </thead>
                          <tbody>
                            {allProjects.map(p => (
                              <tr key={p.projectId} className="border-b last:border-0 border-border/30 hover:bg-muted/30 transition-colors">
                                <td className="py-2 px-2 font-mono text-[11px] text-muted-foreground whitespace-nowrap align-middle">{p.projectCode}</td>
                                <td className="py-2 px-2 font-medium text-foreground align-middle max-w-[200px]">
                                  <span className="truncate block" title={p.projectTitle}>{p.projectTitle}</span>
                                </td>
                                <td className="py-2 px-2 text-muted-foreground whitespace-nowrap hidden sm:table-cell align-middle">
                                  {displayHierarchicalSectorLabel(
                                    p.sector,
                                    t("hierarchical.unresolvedSector"),
                                  )}
                                </td>
                                <td className="py-2 px-2 text-muted-foreground hidden lg:table-cell align-middle">
                                  <span className="truncate block max-w-[140px]"><LocalizedStateNames names={p.stateNames} namesAr={(p as unknown as { stateNamesAr?: string[] }).stateNamesAr} /></span>
                                </td>
                                <td className="py-2 px-2 text-end tabular-nums text-muted-foreground align-middle">{p.validIndicatorCount}</td>
                                <td className={`py-2 px-2 text-end tabular-nums align-middle ${p.missingIndicatorCount > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground"}`}>
                                  {p.missingIndicatorCount > 0 ? p.missingIndicatorCount : "—"}
                                </td>
                                <td className="py-2 px-2 text-end align-middle">
                                  {p.projectAchievementRate != null ? (
                                    <span className="font-semibold tabular-nums text-foreground">{p.projectAchievementRate}%</span>
                                  ) : (
                                    <span className="text-muted-foreground/60 italic">{t("performance.insufficientData")}</span>
                                  )}
                                </td>
                                <td className="py-2 px-2 align-middle whitespace-nowrap">
                                  <Link href={`/projects/${p.projectId}`} className="text-primary hover:text-primary/80 font-medium transition-colors text-[11px]">
                                    {t("projectPerfTable.viewProject")}
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </CardContent>
              </Card>

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
                  <Card className="rounded-xl border-border shadow-sm">
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <CardTitle className="text-[15px] font-semibold">{t("performanceTab.performanceAttention")}</CardTitle>
                          <CardDescription className="text-xs mt-0.5">{t("performanceTab.performanceAttentionDesc")}</CardDescription>
                        </div>
                        <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 text-xs font-semibold px-1.5 tabular-nums shrink-0">
                          {final.length}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent className="pt-0 pb-3">
                      <div className="divide-y divide-border/40">
                        {final.map(item => (
                          <Link
                            key={item.id} href={item.href}
                            className="flex items-center gap-3 py-2.5 px-2 rounded-lg hover:bg-muted/40 transition-colors group -mx-2"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-[13px] font-medium text-foreground truncate group-hover:text-primary transition-colors">
                                {item.title}
                              </p>
                              <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{item.context}</p>
                            </div>
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400 shrink-0">
                              {item.issue}
                            </span>
                          </Link>
                        ))}
                      </div>
                      {/* View All destinations */}
                      {(hasLateReports || hasCriticalRisks) && (
                        <div className="flex items-center gap-4 pt-3 mt-1 border-t border-border/40">
                          {hasLateReports && (
                            <Link href="/reports/project" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                              {t("performanceTab.viewAllOverdueReports")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                            </Link>
                          )}
                          {hasCriticalRisks && (
                            <Link href="/projects" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors flex items-center gap-1">
                              {t("performanceTab.viewAllCriticalRisks")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                            </Link>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })()}

            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              PROJECTS & STATES
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "projects" && (
            <div id="panel-projects" role="tabpanel" aria-labelledby="tab-projects" className="space-y-6">

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
                      /* Loading skeleton */
                      <div className="h-[260px] px-1 py-2 flex flex-col gap-1.5 animate-pulse" aria-hidden="true">
                        {[75, 58, 88, 50, 68, 42, 60].map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="h-2.5 w-20 rounded bg-muted/40 shrink-0" />
                            <div className="h-2.5 rounded bg-muted/50" style={{ width: `${w}%` }} />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div
                        aria-label={t("aria.projectsByState", { detail: stateChartData.map(d => t("aria.projectsByStateItem", { name: d.name, total: d.total, active: d.active })).join("; ") })}
                        style={{ height: Math.min(420, Math.max(260, stateChartData.length * 30)) }}
                      >
                        {stateChartData.length === 0 ? (
                          <div className="h-[260px] flex items-center justify-center">
                            <ChartEmptyState message={t("chartEmpty.stateCoverage")} icon={MapPin} />
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={stateChartData}
                              layout="vertical"
                              margin={{ top: 2, right: 16, left: 0, bottom: 28 }}
                              barCategoryGap="20%"
                              barGap={2}
                            >
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
                              <XAxis
                                type="number"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={11} tickLine={false} axisLine={false} tickMargin={4}
                                tickFormatter={fmtCompact}
                                allowDecimals={false}
                              />
                              <YAxis
                                dataKey="name" type="category"
                                stroke="hsl(var(--muted-foreground))"
                                fontSize={11} tickLine={false} axisLine={false} width={130}
                                tickFormatter={(v: string) => v.length > 18 ? `${v.slice(0, 17)}…` : v}
                              />
                              <Tooltip
                                contentStyle={TT.contentStyle}
                                labelStyle={TT.labelStyle}
                                itemStyle={TT.itemStyle}
                                cursor={TT.cursor}
                                formatter={(v: number, name: string, props: { payload?: { total?: number; active?: number } }) => {
                                  if (name === t("projectsTab.totalProjects")) return [fmt(v), t("stateChartTooltip.totalProjects")];
                                  const total   = props.payload?.total  ?? 0;
                                  const other   = total - v;
                                  return [fmt(v), other > 0 ? t("stateChartTooltip.activeWithOther", { count: fmt(other) }) : t("stateChartTooltip.activeProjects")];
                                }}
                              />
                              <Legend
                                verticalAlign="bottom"
                                height={24}
                                iconType="square"
                                iconSize={9}
                                wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))", paddingTop: 4 }}
                              />
                              <Bar dataKey="total"  name={t("projectsTab.totalProjects")}  fill={CC.totalProj}   radius={[0, 3, 3, 0]} maxBarSize={10} />
                              <Bar dataKey="active" name={t("projectsTab.activeProjects")} fill={CC.achievement} radius={[0, 3, 3, 0]} maxBarSize={10} />
                            </BarChart>
                          </ResponsiveContainer>
                        )}
                      </div>
                    )}
                    <p className="text-[11px] text-muted-foreground/60 px-1 pt-2 pb-1">
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
                      /* Loading skeleton — bar-row style */
                      <div className="h-[260px] px-1 py-2 flex flex-col gap-2 animate-pulse" aria-hidden="true">
                        {[70, 52, 88, 40, 60, 35, 48].map((w, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <div className="h-2.5 w-28 rounded bg-muted/40 shrink-0" />
                            <div className="h-2.5 rounded bg-muted/50" style={{ width: `${w}%` }} />
                          </div>
                        ))}
                      </div>
                    ) : statusChartData.length === 0 ? (
                      <div className="h-[260px] flex items-center justify-center">
                        <ChartEmptyState message={t("chartEmpty.projects")} icon={FolderKanban} />
                      </div>
                    ) : statusChartData.length <= 5 ? (
                      /* ── Donut chart — 5 or fewer distinct statuses ─────── */
                      <div
                        className="relative h-[300px]"
                        aria-label={t("aria.projectStatusDistribution", { detail: statusChartData.map(d => `${d.name} ${d.count}`).join(", ") })}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <PieChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                            <Pie
                              data={statusChartData}
                              cx="50%" cy="43%"
                              innerRadius={54} outerRadius={80}
                              paddingAngle={3}
                              dataKey="count"
                              onClick={(entry: Record<string, unknown>) => {
                                if (typeof entry.status === "string")
                                  navigate(`/projects?status=${entry.status}`);
                              }}
                              className="cursor-pointer"
                            >
                              {statusChartData.map((d, i) => (
                                <Cell key={i} fill={d.color} stroke="hsl(var(--card))" strokeWidth={2} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={TT.contentStyle}
                              labelStyle={TT.labelStyle}
                              itemStyle={TT.itemStyle}
                              formatter={(v: number, name: string) => [t("chartSeries.projectsCount", { count: fmt(v) }), name]}
                            />
                            <Legend
                              verticalAlign="bottom"
                              height={52}
                              iconType="square"
                              iconSize={9}
                              wrapperStyle={{ fontSize: 11, color: "hsl(var(--muted-foreground))", lineHeight: "22px" }}
                              formatter={(value, entry) => {
                                const count = (entry as unknown as { payload?: { count?: number } }).payload?.count ?? 0;
                                return `${value}: ${fmt(count)}`;
                              }}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                        {/* Centre label — total project count */}
                        <div
                          className="absolute pointer-events-none flex flex-col items-center"
                          style={{ top: "43%", left: "50%", transform: "translate(-50%, -50%)" }}
                        >
                          <span className="text-[20px] font-bold tabular-nums leading-none text-foreground">
                            {fmt(statusChartData.reduce((s, d) => s + d.count, 0))}
                          </span>
                          <span className="text-[10px] text-muted-foreground mt-1">{t("overviewTab.projects")}</span>
                        </div>
                      </div>
                    ) : (
                      /* ── Horizontal bar chart — more than 5 distinct statuses */
                      <div
                        style={{ height: Math.min(520, Math.max(260, statusChartData.length * 32)) }}
                        aria-label={t("aria.projectStatusDistribution", { detail: statusChartData.map(d => `${d.name} ${d.count}`).join(", ") })}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart
                            data={statusChartData}
                            layout="vertical"
                            margin={{ top: 2, right: 44, left: 0, bottom: 4 }}
                            barCategoryGap="26%"
                          >
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" strokeOpacity={0.35} />
                            <XAxis
                              type="number"
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11} tickLine={false} axisLine={false} tickMargin={4}
                              tickFormatter={fmtCompact}
                              allowDecimals={false}
                            />
                            <YAxis
                              dataKey="name" type="category"
                              stroke="hsl(var(--muted-foreground))"
                              fontSize={11} tickLine={false} axisLine={false} width={150}
                              tickFormatter={(v: string) => v.length > 22 ? `${v.slice(0, 21)}…` : v}
                            />
                            <Tooltip
                              contentStyle={TT.contentStyle}
                              labelStyle={TT.labelStyle}
                              itemStyle={TT.itemStyle}
                              cursor={TT.cursor}
                              formatter={(v: number) => [t("chartSeries.projectsCount", { count: fmt(v) }), t("chartSeries.statusCount")]}
                            />
                            <Bar
                              dataKey="count"
                              name={t("chartSeries.projects")}
                              radius={[0, 3, 3, 0]}
                              maxBarSize={14}
                              onClick={(entry: Record<string, unknown>) => {
                                if (typeof entry.status === "string")
                                  navigate(`/projects?status=${entry.status}`);
                              }}
                              className="cursor-pointer"
                            >
                              {statusChartData.map((d, i) => (
                                <Cell key={i} fill={d.color} />
                              ))}
                              <LabelList
                                dataKey="count"
                                position="right"
                                formatter={(v: number) => fmt(v)}
                                style={{ fontSize: 11, fill: "hsl(var(--muted-foreground))", fontVariantNumeric: "tabular-nums" }}
                              />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
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
              <Card className="rounded-xl border-border shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <CardTitle className="text-[15px] font-semibold leading-snug">
                        {isState ? t("projectsTab.stateImplementation") : t("projectsTab.stateImplementationOverview")}
                      </CardTitle>
                      <CardDescription className="text-xs mt-0.5">
                        {t("projectsTab.stateImplementationDesc")}
                      </CardDescription>
                    </div>
                    <Link href="/states" className="text-xs font-medium text-primary hover:underline flex items-center gap-1 shrink-0 mt-0.5">
                      {t("projectsTab.allStates")} <ArrowRight className="h-3 w-3 rtl:rotate-180" />
                    </Link>
                  </div>
                </CardHeader>
                <CardContent className="p-0">
                  <StateTableErrorBoundary>
                    <StatePerformanceTable states={states ?? []} isLoading={isStatesLoading} showAll={isState} />
                  </StateTableErrorBoundary>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════
              BUDGET & DONORS
              ════════════════════════════════════════════════════════════ */}
          {activeTab === "budget" && (
            <div id="panel-budget" role="tabpanel" aria-labelledby="tab-budget" className="space-y-6">
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
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBenOpen(true)}
                        className="text-xs gap-2 shrink-0"
                      >
                        <Users className="h-3.5 w-3.5" />
                        <span className="hidden sm:inline">{t("budgetTab.viewBeneficiaryBreakdown")}</span>
                        <span className="sm:hidden">{t("budgetTab.breakdown")}</span>
                      </Button>
                    }
                  />

                  {/* Budget summary cards */}
                  {summary?.currencyMixed ? (
                    /* Multi-currency — show per-currency grouped totals instead of a
                       meaningless cross-currency aggregate. Each row: Allocated, Spent,
                       Remaining, Utilisation Rate. */
                    <div className="rounded-xl border border-amber-200/70 dark:border-amber-700/40 bg-amber-50/40 dark:bg-amber-950/15 p-5 space-y-4">
                      <div className="flex items-center gap-2 text-xs text-amber-800 dark:text-amber-300 font-medium">
                        <DollarSign className="h-3.5 w-3.5 shrink-0 opacity-70" />
                        {t("budgetTab.multipleCurrencies")}
                      </div>
                      <div className="space-y-2">
                        {(summary.budgetByCurrency ?? []).map(bc => (
                          <div key={bc.currency} className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                            <div className="rounded-lg border border-border/50 bg-card px-3 py-2">
                              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t("budgetTab.allocatedLabel", { currency: bc.currency })}</p>
                              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{fmtMoney(bc.totalBudget, bc.currency)}</p>
                            </div>
                            <div className="rounded-lg border border-amber-200/50 dark:border-amber-800/30 bg-amber-50/20 dark:bg-amber-950/10 px-3 py-2">
                              <p className="text-[10px] font-medium text-amber-700/60 dark:text-amber-400/60 uppercase tracking-wider">{t("budgetTab.spentLabel", { currency: bc.currency })}</p>
                              <p className="mt-1 text-base font-semibold tabular-nums text-amber-700 dark:text-amber-400">{fmtMoney(bc.totalSpent, bc.currency)}</p>
                            </div>
                            <div className={`rounded-lg border px-3 py-2 ${(bc.budgetRemaining ?? 0) < 0 ? "border-orange-200/70 dark:border-orange-800/40 bg-orange-50/30 dark:bg-orange-950/10" : "border-emerald-200/70 dark:border-emerald-800/40 bg-emerald-50/40 dark:bg-emerald-950/10"}`}>
                              <p className={`text-[10px] font-medium uppercase tracking-wider ${(bc.budgetRemaining ?? 0) < 0 ? "text-orange-700/60 dark:text-orange-400/60" : "text-emerald-700/60 dark:text-emerald-400/60"}`}>{t("budgetTab.remainingLabel", { currency: bc.currency })}</p>
                              <p className={`mt-1 text-base font-semibold tabular-nums ${(bc.budgetRemaining ?? 0) < 0 ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtMoney(bc.budgetRemaining, bc.currency)}</p>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2">
                              <p className="text-[10px] font-medium text-muted-foreground/60 uppercase tracking-wider">{t("budgetTab.utilisationRate")}</p>
                              <p className="mt-1 text-base font-semibold tabular-nums text-foreground">{pct(bc.utilisationRate)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    /* Single-currency or loading state — four-card layout:
                       Allocated → Spent → Remaining → Utilisation Rate */
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {/* 1. Allocated Budget — label and note vary by scope.
                          State / TC users see project-level amounts, not an approved
                          State or Sector allocation, so the description must not
                          imply an exclusive State or Sector-level budget. */}
                      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] flex flex-col">
                        <p className="text-xs font-medium text-muted-foreground/60 leading-none uppercase tracking-widest">
                          {role === "state_program_officer" ? t("budgetTab.projectLevelBudget") : t("budgetTab.allocatedBudget")}
                        </p>
                        <p className="mt-4 text-[22px] font-medium tabular-nums text-foreground leading-none">{fmtMoney(summary?.totalBudget, summary?.currency)}</p>
                        <p className="mt-auto pt-3 text-xs text-muted-foreground">
                          {role === "state_program_officer"
                            ? t("budgetTab.projectLevelBudgetDesc")
                            : isTc
                            ? t("budgetTab.projectLevelSectorDesc")
                            : t("budgetTab.totalApprovedBudget")}
                        </p>
                      </div>
                      {/* 2. Spent */}
                      <div className="rounded-xl border border-amber-200/60 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10 p-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] flex flex-col">
                        <p className="text-xs font-medium text-amber-700/60 dark:text-amber-400/60 leading-none uppercase tracking-widest">{t("budgetTab.spent")}</p>
                        <p className="mt-4 text-[22px] font-medium tabular-nums text-amber-700 dark:text-amber-400 leading-none">{fmtMoney(summary?.totalSpent, summary?.currency)}</p>
                        <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("budgetTab.recordedExpenditure")}</p>
                      </div>
                      {/* 3. Remaining Balance — warning treatment for genuine negative balance */}
                      {(() => {
                        const rem = summary?.budgetRemaining;
                        const isNegative = rem != null && rem < 0;
                        return (
                          <div className={`rounded-xl border p-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] flex flex-col ${isNegative ? "border-orange-200/80 dark:border-orange-800/50 bg-orange-50/40 dark:bg-orange-950/15" : "border-emerald-200/80 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/15"}`}>
                            <p className={`text-xs font-medium leading-none uppercase tracking-widest ${isNegative ? "text-orange-700/60 dark:text-orange-400/60" : "text-emerald-700/60 dark:text-emerald-400/60"}`}>{t("budgetTab.remainingBalance")}</p>
                            <p className={`mt-4 text-[22px] font-medium tabular-nums leading-none ${isNegative ? "text-orange-700 dark:text-orange-400" : "text-emerald-700 dark:text-emerald-400"}`}>{fmtMoney(rem, summary?.currency)}</p>
                            <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("budgetTab.allocatedLessExpenditure")}</p>
                          </div>
                        );
                      })()}
                      {/* 4. Utilisation Rate */}
                      <div className="rounded-xl border border-border/60 bg-card p-6 shadow-[0_1px_3px_0_rgb(0,0,0,0.04)] flex flex-col">
                        <p className="text-xs font-medium text-muted-foreground/60 leading-none uppercase tracking-widest">{t("budgetTab.utilisationRate")}</p>
                        <p className="mt-4 text-[22px] font-medium tabular-nums text-foreground leading-none">{pct(summary?.burnRatePct)}</p>
                        <p className="mt-auto pt-3 text-xs text-muted-foreground">{t("budgetTab.spentAsPercentage")}</p>
                      </div>
                    </div>
                  )}

                  {/* Beneficiary summary — labels: Men, Women, Boys, Girls, Total Beneficiaries */}
                  <div className="grid gap-3 grid-cols-3 sm:grid-cols-5">
                    {[
                      { label: t("beneficiaries.men"),   value: fmt(benBreakdown?.summary?.male   ?? 0), highlight: false },
                      { label: t("beneficiaries.women"), value: fmt(benBreakdown?.summary?.female ?? 0), highlight: false },
                      { label: t("beneficiaries.boys"),  value: fmt(benBreakdown?.summary?.boys   ?? 0), highlight: false },
                      { label: t("beneficiaries.girls"), value: fmt(benBreakdown?.summary?.girls  ?? 0), highlight: false },
                      { label: t("beneficiaries.total"), value: fmt(benBreakdown?.summary?.total  ?? 0), highlight: true  },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl border p-4 flex flex-col items-center justify-center gap-1.5 ${s.highlight ? "border-primary/20 bg-primary/[0.03]" : "border-border/60 bg-muted/20"}`}>
                        <p className={`text-[18px] font-semibold tabular-nums leading-none ${s.highlight ? "text-primary" : "text-foreground"}`}>{s.value}</p>
                        <p className="text-xs text-muted-foreground font-medium leading-none text-center">{s.label}</p>
                      </div>
                    ))}
                  </div>

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
            <div id="panel-risks" role="tabpanel" aria-labelledby="tab-risks" className="space-y-6">

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

        </div>{/* /p-5 sm:p-6 */}
      </div>{/* /tabbed panel */}

      {/* ── Beneficiary Breakdown Dialog (always mounted at root) ────── */}
      <Dialog open={benOpen} onOpenChange={setBenOpen}>
        <DialogContent className="max-w-5xl max-h-[85vh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-4 border-b bg-muted/20">
            <DialogTitle className="text-lg font-semibold">{t("beneficiaries.dialogTitle")}</DialogTitle>
            <DialogDescription className="text-sm">
              {t("beneficiaries.dialogSubtitle")}
            </DialogDescription>
          </DialogHeader>
          <div className="overflow-y-auto px-6 py-5 space-y-8">
            {isBenLoading || !benBreakdown ? (
              <div className="flex h-40 items-center justify-center">
                <div className="animate-spin rounded-full h-6 w-6 border-2 border-primary border-t-transparent" />
              </div>
            ) : (
              <>
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{t("beneficiaries.overallSummary")}</h3>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {[
                      { label: t("beneficiaries.men"),   value: benBreakdown.summary.male   },
                      { label: t("beneficiaries.women"), value: benBreakdown.summary.female },
                      { label: t("beneficiaries.boys"),  value: benBreakdown.summary.boys   },
                      { label: t("beneficiaries.girls"), value: benBreakdown.summary.girls  },
                      { label: t("beneficiaries.totalBeneficiaries"), value: benBreakdown.summary.total, highlight: true },
                    ].map(s => (
                      <div key={s.label} className={`rounded-xl border p-4 ${"highlight" in s && s.highlight ? "bg-primary/5 border-primary/25" : "bg-muted/30 border-border"}`}>
                        <div className="text-xs text-muted-foreground font-medium">{s.label}</div>
                        <div className={`mt-1.5 text-xl font-bold tabular-nums ${"highlight" in s && s.highlight ? "text-primary" : ""}`}>
                          {fmt(s.value)}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                {[
                  { id: "byState",   title: t("beneficiaries.byState"),   headerLabel: t("table.state"), rows: benBreakdown.byState,   keyField: "stateId",   nameField: "stateName",    extra: false },
                  { id: "bySector",  title: t("beneficiaries.bySector"),  headerLabel: t("beneficiaries.sectorCol"), rows: benBreakdown.bySector,  keyField: "sector",    nameField: "sector",       extra: false },
                  { id: "byProject", title: t("beneficiaries.byProject"), headerLabel: t("beneficiaries.projectCol"), rows: benBreakdown.byProject, keyField: "projectId", nameField: "projectTitle", extra: true  },
                ].map(({ id, title, headerLabel, rows, keyField, nameField, extra }) => (
                  <section key={id} className="space-y-3">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</h3>
                    <div className="rounded-xl border border-border overflow-hidden overflow-x-auto" role="region" aria-label={t("aria.beneficiaryBreakdownRegion", { section: title })}>
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/40">
                            <TableHead className="font-semibold">{headerLabel}</TableHead>
                            {extra && <TableHead className="font-semibold">{t("beneficiaries.statesCol")}</TableHead>}
                            {extra && <TableHead className="font-semibold">{t("beneficiaries.sectorCol")}</TableHead>}
                            <TableHead className="text-end font-semibold">{t("beneficiaries.men")}</TableHead>
                            <TableHead className="text-end font-semibold">{t("beneficiaries.women")}</TableHead>
                            <TableHead className="text-end font-semibold">{t("beneficiaries.boys")}</TableHead>
                            <TableHead className="text-end font-semibold">{t("beneficiaries.girls")}</TableHead>
                            <TableHead className="text-end font-semibold">{t("beneficiaries.total")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(rows as any[]).map(r => (
                            <TableRow key={r[keyField]}>
                              <TableCell className="font-medium">
                                {extra ? (
                                  <>
                                    <div className="font-medium">{r.projectTitle}</div>
                                    <div className="text-xs text-muted-foreground">{r.projectCode}</div>
                                  </>
                                ) : (
                                  <span className="capitalize">{nameField === "stateName" ? getStateLabel({ name: r.stateName, nameAr: r.stateNameAr }, i18n.language) : r[nameField]}</span>
                                )}
                              </TableCell>
                              {extra && <TableCell className="text-sm"><LocalizedStateNames names={r.stateNames} namesAr={r.stateNamesAr} /></TableCell>}
                              {extra && <TableCell className="capitalize text-sm">{r.sector}</TableCell>}
                              <TableCell className="text-end tabular-nums">{fmt(r.male)}</TableCell>
                              <TableCell className="text-end tabular-nums">{fmt(r.female)}</TableCell>
                              <TableCell className="text-end tabular-nums">{fmt(r.boys)}</TableCell>
                              <TableCell className="text-end tabular-nums">{fmt(r.girls)}</TableCell>
                              <TableCell className="text-end tabular-nums font-semibold">{fmt(r.total)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </section>
                ))}
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
}


function BpSortableHeader({
  column, label, activeSortColumn, sortDir, onSort, className,
}: {
  column: BpSortKey;
  label: string;
  activeSortColumn: BpSortKey;
  sortDir: "asc" | "desc";
  onSort: (c: BpSortKey) => void;
  className?: string;
}) {
  const isActive = activeSortColumn === column;
  return (
    <th
      scope="col"
      aria-sort={(isActive ? (sortDir === "asc" ? "ascending" : "descending") : "none") as React.AriaAttributes["aria-sort"]}
      className={`py-2.5 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap${className ? ` ${className}` : ""}`}
    >
      <button type="button" onClick={() => onSort(column)} className="flex items-center gap-1 rounded text-start hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}
        {isActive
          ? (sortDir === "asc" ? <ChevronUp className="h-3 w-3 text-primary" /> : <ChevronDown className="h-3 w-3 text-primary" />)
          : <ChevronUp className="h-3 w-3 opacity-20" />}
      </button>
    </th>
  );
}

/* Module-scope component — must NOT be defined inside the parent component.
   See the comment above SortableTableHeader for why inner components break
   hook reconciliation. */
export function ProjectBudgetPerformanceTable({
  data, isLoading, isError, onRetry, role, spoStateId: _spoStateId,
}: ProjectBudgetPerformanceTableProps) {
  const { t } = useTranslation("dashboard");
  const isTc  = role === "technical_coordinator";
  const isSpo = role === "state_program_officer";
  const { openRecord } = useRecordDetail();

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

  const handleSort = (key: BpSortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setCurrentPage(1);
  };

  const handleFilterChange = () => setCurrentPage(1);

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
        <Button variant="outline" size="sm" onClick={onRetry} className="text-xs gap-1.5">
          <RotateCcw className="h-3 w-3" aria-hidden="true" /> {t("budgetWorkspace.retry")}
        </Button>
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
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2" aria-label={t("budgetWorkspace.projectSummary")}>
        {[
          { label: t("budgetWorkspace.projectsWithBudget"), value: summaryStats.withBudget },
          { label: t("budgetWorkspace.projectsWithoutBudget"), value: summaryStats.withoutBudget },
          { label: t("budgetWorkspace.projectsWithExpenditure"), value: summaryStats.withExpenditure },
          { label: t("budgetWorkspace.projectsWithNegativeBalance"), value: summaryStats.negativeBalance, warn: summaryStats.negativeBalance > 0 },
          { label: t("budgetWorkspace.currenciesInUse"), value: summaryStats.currencies },
        ].map(s => (
          <div
            key={s.label}
            className={`rounded-lg border px-3 py-2.5 ${("warn" in s && s.warn) ? "border-amber-200/70 dark:border-amber-800/40 bg-amber-50/30 dark:bg-amber-950/10" : "border-border/50 bg-muted/20"}`}
          >
            <p className={`text-[18px] font-semibold tabular-nums leading-none ${("warn" in s && s.warn) ? "text-amber-700 dark:text-amber-400" : "text-foreground"}`}>
              {s.value}
            </p>
            <p className="text-[10px] text-muted-foreground font-medium mt-0.5 leading-snug">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Projects-style registry toolbar: controls at the logical start, presentation at the end. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5" role="group" aria-label={t("budgetWorkspace.projectToolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground select-none">
            <Filter className="h-4 w-4" aria-hidden="true" />
            {t("common:filter")}
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <div className="relative min-w-[14rem] flex-1">
          <Search className="absolute start-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground pointer-events-none" aria-hidden="true" />
          <Input
            type="search"
            placeholder={t("budgetWorkspace.searchProjects")}
            value={search}
            onChange={e => { setSearch(e.target.value); handleFilterChange(); }}
            className="h-10 ps-8 text-sm border-border/60"
            aria-label={t("budgetWorkspace.searchProjects")}
          />
        </div>
        {/* Status filter */}
        <Select value={statusFilter} onValueChange={v => { setStatusFilter(v); handleFilterChange(); }}>
          <SelectTrigger className="h-10 w-auto min-w-[8.75rem] text-sm border-border/60" aria-label={t("budgetWorkspace.filterProjectStatus")}>
            <SelectValue placeholder={t("budgetWorkspace.allStatuses")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("budgetWorkspace.allStatuses")}</SelectItem>
            {allStatuses.map(s => <SelectItem key={s} value={s}>{formatStatusLabel(s)}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Currency filter */}
        {allCurrencies.length > 1 && (
            <Select value={currencyFilter} onValueChange={v => { setCurrencyFilter(v); handleFilterChange(); }}>
              <SelectTrigger className="h-10 w-auto min-w-[7.5rem] text-sm border-border/60" aria-label={t("budgetWorkspace.filterCurrency")}>
              <SelectValue placeholder={t("budgetWorkspace.allCurrencies")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("budgetWorkspace.allCurrencies")}</SelectItem>
              {allCurrencies.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        {/* Budget Basis filter */}
        <Select value={basisFilter} onValueChange={v => { setBasisFilter(v as BpBasisFilter); handleFilterChange(); }}>
          <SelectTrigger className="h-10 w-auto min-w-[10rem] text-sm border-border/60" aria-label={t("budgetWorkspace.filterBudgetBasis")}>
            <SelectValue placeholder={t("budgetWorkspace.allBudgetBases")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("budgetWorkspace.allBudgetBases")}</SelectItem>
            <SelectItem value="Project-Level Budget">{t("budgetWorkspace.projectBudgetBasis")}</SelectItem>
            <SelectItem value="State Allocation">{t("budgetWorkspace.stateAllocation")}</SelectItem>
          </SelectContent>
        </Select>
        {/* Data Availability filter */}
        <Select value={dataAvailFilter} onValueChange={v => { setDataAvailFilter(v as BpDataAvailFilter); handleFilterChange(); }}>
          <SelectTrigger className="h-10 w-auto min-w-[10rem] text-sm border-border/60" aria-label={t("budgetWorkspace.filterDataAvailability")}>
            <SelectValue placeholder={t("budgetWorkspace.allData")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("budgetWorkspace.allData")}</SelectItem>
            <SelectItem value="with_budget">{t("budgetWorkspace.withBudget")}</SelectItem>
            <SelectItem value="without_budget">{t("budgetWorkspace.withoutBudget")}</SelectItem>
            <SelectItem value="missing_currency">{t("budgetWorkspace.missingCurrency")}</SelectItem>
            <SelectItem value="missing_state_expenditure">{t("budgetWorkspace.missingStateExpenditure")}</SelectItem>
          </SelectContent>
        </Select>
        </div>
        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
        <div className="shrink-0" aria-label={t("budgetWorkspace.projectView")}>
          <ViewModeSwitcher
            available={[...RECORD_REGISTRY_VIEWS]}
            current={viewMode}
            onChange={setViewMode}
          />
        </div>
      </div>

      {(isTc || isSpo) && (
        <p className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
          {t("budgetWorkspace.projectBasisContext")}
        </p>
      )}

      {/* The table retains the full analytical baseline. Card and compact modes
          reuse its authorised, filtered, sorted and paginated page rows. */}
      {viewMode === "table" ? (
      <div className="rounded-xl border border-border/60 overflow-hidden overflow-x-auto" role="region" aria-label={t("budgetWorkspace.projectTable")}>
        <Table className="min-w-[1060px]">
          <TableHeader>
            <TableRow className="bg-muted/40 hover:bg-muted/40">
              <BpSortableHeader column="projectCode" label={t("budgetWorkspace.projectCode")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} className="text-start" />
              <BpSortableHeader column="projectTitle" label={t("budgetWorkspace.projectTitle")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} className="text-start" />
              <BpSortableHeader column="donorName" label={t("budgetWorkspace.donor")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} className="text-start" />
              <BpSortableHeader column="budgetBasis" label={t("budgetWorkspace.budgetBasis")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} className="text-start" />
              <BpSortableHeader column="allocatedBudget" label={t("budgetWorkspace.allocatedBudget")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} />
              <BpSortableHeader column="spent" label={t("budgetWorkspace.spent")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} />
              <BpSortableHeader column="remainingBalance" label={t("budgetWorkspace.remainingBalance")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} />
              <BpSortableHeader column="utilisationRate" label={t("budgetWorkspace.utilisationRate")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} />
              <BpSortableHeader column="projectStatus" label={t("budgetWorkspace.projectStatus")} activeSortColumn={sortKey} sortDir={sortDir} onSort={handleSort} className="text-start" />
              <th scope="col" className="py-2.5 px-3 text-xs font-medium text-muted-foreground whitespace-nowrap text-end">{t("budgetWorkspace.action")}</th>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={BP_TABLE_COLS} className="text-center py-10 text-sm text-muted-foreground">
                  {filteredRows.length === 0 && (data?.length ?? 0) > 0
                    ? t("budgetWorkspace.noProjectsFiltered")
                    : t("budgetWorkspace.noProjectsAvailable")}
                </TableCell>
              </TableRow>
            ) : pageRows.flatMap(row => {
              const isExp  = expandedId === row.projectId;
              const remNeg = row.remainingBalance != null && row.remainingBalance < 0;
              const { variant: statusVariant, className: statusCls } = statusBadgeVariant(row.projectStatus ?? "");

              const mainRow = (
                <TableRow
                  key={row.projectId}
                  className={`transition-colors ${isExp ? "bg-muted/20" : "hover:bg-muted/10"}`}
                >
                  {/* Project Code */}
                  <TableCell className="py-2.5 px-3 align-middle">
                    <Link href={`/projects/${row.projectId}`}>
                      <span className="font-mono text-xs text-primary hover:underline cursor-pointer whitespace-nowrap"><bdi dir="ltr">{row.projectCode}</bdi></span>
                    </Link>
                  </TableCell>
                  {/* Project Title — max 2 lines; full title in tooltip */}
                  <TableCell className="py-2.5 px-3 align-middle max-w-[220px]">
                    <UITooltipProvider>
                      <UITooltip>
                          <UITooltipTrigger asChild>
                            <Link
                              href={`/projects/${row.projectId}`}
                              className="text-xs text-foreground line-clamp-2 leading-tight block hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
                              aria-label={t("budgetWorkspace.viewProject", { project: row.projectTitle })}
                            >
                              {row.projectTitle}
                            </Link>
                          </UITooltipTrigger>
                        <UITooltipContent side="top" className="max-w-[320px] text-xs">
                          {row.projectTitle}
                        </UITooltipContent>
                      </UITooltip>
                    </UITooltipProvider>
                  </TableCell>
                  {/* Donor */}
                  <TableCell className="py-2.5 px-3 align-middle max-w-[140px]">
                    <span className="text-xs text-muted-foreground truncate block">{row.donorName ?? "—"}</span>
                  </TableCell>
                  {/* Budget Basis — full approved labels, no performance colours */}
                  <TableCell className="py-2.5 px-3 align-middle">
                    <UITooltipProvider>
                      <UITooltip>
                        <UITooltipTrigger asChild>
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                            {row.budgetBasis}
                            {((isTc || isSpo) && row.budgetBasis === "Project-Level Budget") && (
                              <Info className="h-3 w-3 opacity-40 shrink-0" aria-hidden="true" />
                            )}
                          </span>
                        </UITooltipTrigger>
                        {isTc && row.budgetBasis === "Project-Level Budget" && (
                          <UITooltipContent side="top" className="max-w-[240px] text-xs">
                            The displayed amount is the complete Project Budget and does not represent an exclusive Sector allocation.
                          </UITooltipContent>
                        )}
                        {isSpo && row.budgetBasis === "Project-Level Budget" && (
                          <UITooltipContent side="top" className="max-w-[280px] text-xs">
                            The displayed Budget and Expenditure are Project-level financial values and do not represent amounts allocated or spent exclusively in this State.
                          </UITooltipContent>
                        )}
                      </UITooltip>
                    </UITooltipProvider>
                  </TableCell>
                  {/* Allocated Budget — ISO code + amount inline */}
                  <TableCell className="py-2.5 px-3 align-middle text-end">
                    <span className="text-xs font-medium tabular-nums whitespace-nowrap">
                      {row.hasMissingCurrency
                        ? <span className="text-muted-foreground" aria-label={t("budgetWorkspace.missingCurrencyAria")}>—</span>
                        : <bdi dir="ltr">{fmtMoney(row.allocatedBudget, row.currency)}</bdi>
                      }
                    </span>
                  </TableCell>
                  {/* Spent — neutral primary text; "—" for State Allocation (no reliable state-level source) */}
                  <TableCell className="py-2.5 px-3 align-middle text-end">
                    {row.missingStateExpenditure
                      ? <span className="text-xs text-muted-foreground" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span>
                      : <span className="text-xs tabular-nums text-foreground whitespace-nowrap"><bdi dir="ltr">{fmtMoney(row.spent, row.currency)}</bdi></span>
                    }
                  </TableCell>
                  {/* Remaining Balance — neutral positive; factual warning only for negative */}
                  <TableCell className="py-2.5 px-3 align-middle text-end">
                    {row.missingStateExpenditure
                      ? <span className="text-xs text-muted-foreground" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span>
                      : <span className={`text-xs tabular-nums whitespace-nowrap ${remNeg ? "text-destructive dark:text-red-400 font-medium" : "text-foreground"}`}>
                          <bdi dir="ltr">{fmtMoney(row.remainingBalance, row.currency)}</bdi>
                        </span>
                    }
                  </TableCell>
                  {/* Utilisation Rate — neutral analytical bar, no colour thresholds */}
                  <TableCell className="py-2.5 px-3 align-middle">
                    {row.missingStateExpenditure
                      ? <div className="text-end"><span className="text-xs text-muted-foreground" aria-label={t("budgetWorkspace.stateExpenditureUnavailable")}>—</span></div>
                      : <div className="flex items-center gap-2 justify-end">
                          <span className="text-xs tabular-nums text-foreground"><bdi dir="ltr">{pct(row.utilisationRate)}</bdi></span>
                          {row.utilisationRate != null && (
                            <div
                              className="h-1.5 w-12 bg-muted/50 rounded-full overflow-hidden shrink-0"
                              role="progressbar"
                              aria-valuenow={Math.round(Math.min(100, row.utilisationRate))}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              aria-label={t("budgetWorkspace.utilisationValue", { value: pct(row.utilisationRate) })}
                            >
                              <div
                                className="h-full rounded-full bg-primary/60 transition-[width] duration-300"
                                style={{ width: `${Math.min(100, Math.max(0, row.utilisationRate))}%` }}
                              />
                            </div>
                          )}
                        </div>
                    }
                  </TableCell>
                  {/* Project Status — use approved badge architecture */}
                  <TableCell className="py-2.5 px-3 align-middle">
                    {row.projectStatus
                      ? <Badge variant={statusVariant} className={`text-[10px] px-1.5 py-0.5 ${statusCls ?? ""}`}>
                          {formatStatusLabel(row.projectStatus)}
                        </Badge>
                      : <span className="text-xs text-muted-foreground">—</span>
                    }
                  </TableCell>
                  {/* Action — expand toggle + View Project link (independent siblings, no nesting) */}
                  <TableCell className="py-2.5 px-3 align-middle">
                    <div className="flex items-center justify-end gap-1.5">
                      <UITooltipProvider>
                        <UITooltip>
                          <UITooltipTrigger asChild>
                            <button
                              type="button"
                              className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors shrink-0"
                              onClick={() => setExpandedId(isExp ? null : row.projectId)}
                              aria-expanded={isExp}
                              aria-controls={`bp-detail-${row.projectId}`}
                              aria-label={isExp
                                ? t("budgetWorkspace.collapseDetails", { project: row.projectCode })
                                : t("budgetWorkspace.expandDetails", { project: row.projectCode })}
                            >
                              <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-150 ${isExp ? "" : "-rotate-90"}`} />
                            </button>
                          </UITooltipTrigger>
                          <UITooltipContent side="top" className="text-xs">
                            {isExp ? t("budgetWorkspace.hideDetails") : t("budgetWorkspace.showDetails")}
                          </UITooltipContent>
                        </UITooltip>
                      </UITooltipProvider>
                      <Link
                        href={`/projects/${row.projectId}`}
                        aria-label={t("budgetWorkspace.viewProject", { project: row.projectCode })}
                      >
                        <span className="inline-flex items-center gap-0.5 h-6 px-2 text-xs text-primary hover:underline cursor-pointer whitespace-nowrap">
                          {t("budgetWorkspace.view")}
                          <ChevronRight className="h-3 w-3 rtl:rotate-180" />
                        </span>
                      </Link>
                    </div>
                  </TableCell>
                </TableRow>
              );

              if (!isExp) return [mainRow];

              const detailRow = (
                <TableRow key={`bp-detail-${row.projectId}`} className="bg-muted/10">
                  <TableCell colSpan={BP_TABLE_COLS} id={`bp-detail-${row.projectId}`} className="px-5 pb-4 pt-2">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-3 text-xs">
                      <div className="col-span-2 sm:col-span-3 lg:col-span-4">
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailTitle")}</p>
                        <p className="text-foreground leading-snug">{row.projectTitle}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailCode")}</p>
                        <p className="font-mono text-foreground">{row.projectCode}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailDonor")}</p>
                        <p className="text-foreground">{row.donorName ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailBudgetBasis")}</p>
                        <p className="text-foreground">{row.budgetBasis}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailCurrency")}</p>
                        <p className="text-foreground">
                          {row.currency
                            ? row.currency
                            : <span className="text-amber-600 dark:text-amber-400 font-medium">{t("budgetWorkspace.missingCurrency")}</span>
                          }
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailAllocated")}</p>
                        <p className="tabular-nums text-foreground">{fmtMoney(row.allocatedBudget, row.currency)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailExpenditure")}</p>
                        <p className="tabular-nums text-foreground">
                          {row.missingStateExpenditure ? "—" : fmtMoney(row.spent, row.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailRemaining")}</p>
                        <p className={`tabular-nums ${row.missingStateExpenditure ? "text-foreground" : (row.remainingBalance != null && row.remainingBalance < 0 ? "text-destructive dark:text-red-400 font-medium" : "text-foreground")}`}>
                          {row.missingStateExpenditure ? "—" : fmtMoney(row.remainingBalance, row.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailUtilisation")}</p>
                        <p className="tabular-nums text-foreground">{row.missingStateExpenditure ? "—" : pct(row.utilisationRate)}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailStatus")}</p>
                        <p className="text-foreground">{formatStatusLabel(row.projectStatus ?? "")}</p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailStates")}</p>
                        <p className="text-foreground"><LocalizedStateNames names={row.stateNames} namesAr={(row as unknown as { stateNamesAr?: string[] }).stateNamesAr} /></p>
                      </div>
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailSector")}</p>
                        <p className="text-foreground">{row.sector ?? "—"}</p>
                      </div>
                      {isSpo && row.stateAllocationAmount != null && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailStateAllocation")}</p>
                          <p className="tabular-nums text-foreground font-medium">{fmtMoney(row.stateAllocationAmount, row.currency)}</p>
                        </div>
                      )}
                      {/* Project-Level Expenditure — informational context for State Allocation rows only */}
                      {row.missingStateExpenditure && row.projectLevelSpent != null && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">Project-Level Expenditure</p>
                          <p className="tabular-nums text-muted-foreground">{fmtMoney(row.projectLevelSpent, row.currency)}</p>
                          <p className="text-[9px] text-muted-foreground/70 mt-0.5 leading-tight">Complete Project — not exclusive to this State.</p>
                        </div>
                      )}
                      {row.lastFinancialUpdate && (
                        <div>
                          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-0.5">{t("budgetWorkspace.projectDetailLastUpdate")}</p>
                          <p className="text-foreground">{row.lastFinancialUpdate.slice(0, 10)}</p>
                        </div>
                      )}
                      {/* State-level Expenditure unavailable notice */}
                      {row.missingStateExpenditure && (
                        <div className="col-span-2 sm:col-span-3 lg:col-span-4 pt-1">
                          <p className="text-[10px] text-amber-700 dark:text-amber-400 italic leading-snug">
                            State-level Expenditure data is unavailable. Spent, Remaining Balance and Utilisation Rate are not shown for State Allocation rows.
                          </p>
                        </div>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );

              return [mainRow, detailRow];
            })}
          </TableBody>
        </Table>
      </div>
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
        <div className="flex items-center justify-between gap-4 pt-1">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            Showing {(safePage - 1) * BP_PAGE_SIZE + 1}–{Math.min(safePage * BP_PAGE_SIZE, sortedRows.length)} of {sortedRows.length} projects
          </p>
          <Pagination className="w-auto mx-0">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                  aria-disabled={safePage <= 1}
                  className={safePage <= 1 ? "pointer-events-none opacity-40" : "cursor-pointer"}
                />
              </PaginationItem>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let page: number;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (safePage <= 3) {
                  page = i + 1;
                } else if (safePage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = safePage - 2 + i;
                }
                return (
                  <PaginationItem key={page}>
                    <PaginationLink
                      isActive={page === safePage}
                      onClick={() => setCurrentPage(page)}
                      className="cursor-pointer text-xs"
                    >
                      {page}
                    </PaginationLink>
                  </PaginationItem>
                );
              })}
              <PaginationItem>
                <PaginationNext
                  onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                  aria-disabled={safePage >= totalPages}
                  className={safePage >= totalPages ? "pointer-events-none opacity-40" : "cursor-pointer"}
                />
              </PaginationItem>
            </PaginationContent>
          </Pagination>
        </div>
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

const BP_TABLE_COLS = 10 as const;

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
