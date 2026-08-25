import { Fragment, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import {
  useGetMe, useListAuditLog, type AuditEntry, type ListAuditLogEntityType, type ListAuditLogParams,
} from "@workspace/api-client-react";
import {
  AUDIT_ACTION_CATEGORIES, normalizeAuditActionCategory, type AuditActionCategory,
} from "@workspace/api-zod";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/ui/error-state";
import {
  ChevronDown, ChevronUp, Filter, Info, RefreshCw, Search, ShieldAlert, X,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";

const ALL_MODULES = [
  "projects", "reports", "risks", "plans", "users", "auth", "beneficiaries",
  "messages", "manual", "comments", "files", "notifications", "states",
] as const;
const SCOPED_MODULES = ["projects", "reports", "risks", "plans"] as const;

const ACTION_STYLE: Record<string, string> = {
  created: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  updated: "border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  deleted: "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  approved: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300",
};

const AUDIT_METRICS: ReadonlyArray<{ category: AuditActionCategory; tone: string }> = [
  { category: "created", tone: "border-emerald-500/20 bg-emerald-500/5" },
  { category: "updated", tone: "border-blue-500/20 bg-blue-500/5" },
  { category: "deleted", tone: "border-rose-500/20 bg-rose-500/5" },
  { category: "approved", tone: "border-violet-500/20 bg-violet-500/5" },
];

function getAuditRouteState(rawSearch: string) {
  const params = new URLSearchParams(rawSearch);
  const safePage = Math.max(1, Number.parseInt(params.get("page") ?? "1", 10) || 1);
  const safeSize = [10, 25, 50, 100].includes(Number(params.get("pageSize"))) ? Number(params.get("pageSize")) : 25;
  const entityType = params.get("entityType");
  const module = params.get("module");
  const selectedModule = ALL_MODULES.includes(entityType as (typeof ALL_MODULES)[number])
    ? entityType
    : ALL_MODULES.includes(module as (typeof ALL_MODULES)[number]) ? module : null;
  const action = normalizeAuditActionCategory(params.get("action"));
  return {
    search: (params.get("search") ?? "").slice(0, 100),
    action: action ?? "all" as AuditActionCategory | "all",
    entityType: selectedModule ?? "all",
    dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(params.get("dateFrom") ?? "") ? params.get("dateFrom")! : "",
    dateTo: /^\d{4}-\d{2}-\d{2}$/.test(params.get("dateTo") ?? "") ? params.get("dateTo")! : "",
    page: safePage,
    pageSize: safeSize,
  };
}

const AUDIT_LABEL_KEYS: Record<string, string> = {
  projects: "auditLog.entityTypes.projects",
  plans: "auditLog.entityTypes.plans",
  reports: "auditLog.entityTypes.reports",
  risks: "auditLog.entityTypes.risks",
  users: "auditLog.entityTypes.users",
  beneficiaries: "auditLog.entityTypes.beneficiaries",
  messages: "auditLog.entityTypes.messages",
  manual: "auditLog.entityTypes.manual",
  comments: "auditLog.entityTypes.comments",
  files: "auditLog.entityTypes.files",
  notifications: "auditLog.entityTypes.notifications",
  states: "auditLog.entityTypes.states",
  auth: "auditLog.entityTypes.auth",
  created: "auditLog.actions.created",
  updated: "auditLog.actions.updated",
  deleted: "auditLog.actions.deleted",
  approved: "auditLog.actions.approved",
};

function formatAction(action: string, t: (key: string, values?: Record<string, unknown>) => string) {
  const category = normalizeAuditActionCategory(action);
  if (category) return t(`auditLog.actions.${category}`);
  const translatedKey = AUDIT_LABEL_KEYS[action.toLowerCase()];
  if (translatedKey) return t(translatedKey);
  return action.replace(/_/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function AuditMetric({
  label, value, tone, selected, isLoading, onSelect,
}: {
  label: string;
  value: number;
  tone: string;
  selected: boolean;
  isLoading: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`min-h-[72px] cursor-pointer rounded-lg border px-3 py-2 text-start transition-colors duration-150 hover:brightness-[0.97] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${tone} ${selected ? "border-primary/60 bg-primary/10 shadow-sm" : ""}`}
      aria-pressed={selected}
      aria-busy={isLoading}
      data-empty={!isLoading && value === 0 ? "true" : undefined}
      onClick={onSelect}
    >
      <span className="block text-[11px] font-medium uppercase tracking-wide opacity-80">{label}</span>
      <span className={`mt-0.5 block text-lg font-medium tabular-nums ${!isLoading && value === 0 ? "text-muted-foreground" : ""}`}>
        {isLoading ? <span aria-hidden="true">—</span> : value.toLocaleString()}
      </span>
    </button>
  );
}

function ActionBadge({ entry, t }: { entry: AuditEntry; t: (key: string, values?: Record<string, unknown>) => string }) {
  const category = entry.actionCategory ?? "updated";
  return (
    <Badge
      variant="outline"
      className={`whitespace-nowrap font-medium ${ACTION_STYLE[category] ?? "border-border bg-muted text-foreground"}`}
      aria-label={formatAction(entry.action, t)}
    >
      {formatAction(entry.action, t)}
    </Badge>
  );
}

function AuditDetails({ entry, t }: { entry: AuditEntry; t: (key: string, values?: Record<string, unknown>) => string }) {
  return (
    <div className="grid gap-4 border-t bg-muted/20 px-4 py-4 text-sm sm:grid-cols-2">
      <div className="space-y-2">
        <div><span className="text-muted-foreground">{t("auditLog.detail.action")}</span><p className="mt-0.5">{formatAction(entry.action, t)}</p></div>
        <div><span className="text-muted-foreground">{t("auditLog.detail.actor")}</span><p className="mt-0.5">{entry.userName ?? t("auditLog.system")}{entry.userEmail ? ` · ${entry.userEmail}` : ""}</p></div>
        <div><span className="text-muted-foreground">{t("auditLog.detail.context")}</span><p className="mt-0.5">{entry.entityReference ?? t("auditLog.detail.noReference")}</p></div>
        {entry.usedOverride && <div><span className="text-muted-foreground">{t("auditLog.detail.override")}</span><p className="mt-0.5">{entry.overrideReason ?? t("auditLog.detail.overrideUsed")}</p></div>}
      </div>
      <div>
        <span className="text-muted-foreground">{t("auditLog.detail.changes")}</span>
        {entry.changes.length ? (
          <dl className="mt-2 divide-y rounded-md border bg-background">
            {entry.changes.map((change) => (
              <div key={change.field} className="grid grid-cols-[minmax(70px,0.65fr)_1fr_1fr] gap-2 px-3 py-2 text-xs">
                 <dt className="break-words font-medium text-foreground">{formatAction(change.field, t)}</dt>
                 <dd className="break-words text-muted-foreground"><span className="me-1 text-[10px] font-medium uppercase">{t("auditLog.detail.before")}:</span>{change.before ?? "—"}</dd>
                 <dd className="break-words text-foreground"><span className="me-1 text-[10px] font-medium uppercase">{t("auditLog.detail.after")}:</span>{change.after ?? "—"}</dd>
              </div>
            ))}
          </dl>
        ) : <p className="mt-1">{t("auditLog.detail.noChanges")}</p>}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  const { t } = useTranslation("settings");
  const { data: me } = useGetMe();
  const [pathname, navigate] = useLocation();
  const rawSearch = useSearch();
  const route = useMemo(() => getAuditRouteState(rawSearch), [rawSearch]);
  const [expanded, setExpanded] = useState<number | null>(null);
  const role = me?.user.role ?? "";
  const isStateRole = role === "state_office_manager" || role === "state_program_officer";
  const isTC = role === "technical_coordinator";
  const availableModules = isStateRole || isTC ? SCOPED_MODULES : ALL_MODULES;
  const stateName = (me?.user as unknown as Record<string, string | undefined>)?.stateName ?? null;
  const userSector = (me?.user as unknown as Record<string, string | undefined>)?.sector ?? null;

  const updateRoute = (patch: Partial<typeof route>, replace = false) => {
    const next = { ...route, ...patch };
    const params = new URLSearchParams();
    if (next.search.trim()) params.set("search", next.search.trim());
    if (next.action !== "all") params.set("action", next.action);
    if (next.entityType !== "all") params.set("entityType", next.entityType);
    if (next.dateFrom) params.set("dateFrom", next.dateFrom);
    if (next.dateTo) params.set("dateTo", next.dateTo);
    if (next.page !== 1) params.set("page", String(next.page));
    if (next.pageSize !== 25) params.set("pageSize", String(next.pageSize));
    const nextLocation = params.size ? `${pathname}?${params.toString()}` : pathname;
    const currentLocation = rawSearch ? `${pathname}${rawSearch}` : pathname;
    if (nextLocation !== currentLocation) navigate(nextLocation, { replace });
    setExpanded(null);
  };

  const query = useMemo<ListAuditLogParams>(() => {
    const params: ListAuditLogParams = { page: route.page, pageSize: route.pageSize };
    if (route.search.trim()) params.search = route.search.trim();
    if (route.action !== "all") params.action = route.action;
    if (route.entityType !== "all") params.entityType = route.entityType as ListAuditLogEntityType;
    if (route.dateFrom) params.dateFrom = route.dateFrom;
    if (route.dateTo) params.dateTo = route.dateTo;
    return params;
  }, [route]);

  const audit = useListAuditLog(query);
  const result = audit.data;
  const hasFilters = route.search || route.action !== "all" || route.entityType !== "all" || route.dateFrom || route.dateTo;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-medium tracking-tight"><ShieldAlert className="h-6 w-6 text-primary" /> {t("auditLog.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("auditLog.subtitle")}</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => audit.refetch()} isLoading={audit.isFetching} loadingText={t("auditLog.refreshing")} aria-label={t("auditLog.refresh")}>
          <RefreshCw aria-hidden="true" /> {t("auditLog.refresh")}
        </Button>
      </div>

      {isStateRole && <Alert className="border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200"><Info className="h-4 w-4" /><AlertDescription>{t("auditLog.stateScope", { stateName: stateName ? ` (${stateName})` : "" })}</AlertDescription></Alert>}
      {isTC && <Alert className="border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"><Info className="h-4 w-4" /><AlertDescription>{t("auditLog.sectorScope", { sector: userSector ? ` (${userSector})` : "" })}</AlertDescription></Alert>}

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {AUDIT_METRICS.map(({ category, tone }) => (
          <AuditMetric
            key={category}
            label={t(`auditLog.metrics.${category}`)}
            value={result?.summary[category] ?? 0}
            tone={tone}
            selected={route.action === category}
            isLoading={audit.isLoading}
            onSelect={() => updateRoute({ action: route.action === category ? "all" : category, page: 1 })}
          />
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="flex flex-col gap-2 border-b p-3 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute inset-y-0 start-2.5 my-auto h-4 w-4 text-muted-foreground" /><Input className="ps-9" aria-label={t("auditLog.filters.searchLabel")} placeholder={t("auditLog.filters.searchPlaceholder")} value={route.search} onChange={(event) => updateRoute({ search: event.target.value, page: 1 }, true)} /></div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Select value={route.action} onValueChange={(action) => updateRoute({ action: action as AuditActionCategory | "all", page: 1 })}><SelectTrigger className="w-full sm:w-36" aria-label={t("auditLog.filters.actionLabel")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("auditLog.filters.allActions")}</SelectItem>{AUDIT_ACTION_CATEGORIES.map((category) => <SelectItem key={category} value={category}>{t(`auditLog.actions.${category}`)}</SelectItem>)}</SelectContent></Select>
              <Select value={route.entityType} onValueChange={(entityType) => updateRoute({ entityType, page: 1 })}><SelectTrigger className="w-full sm:w-40" aria-label={t("auditLog.filters.entityTypeLabel")}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">{t("auditLog.filters.allModules")}</SelectItem>{availableModules.map((item) => <SelectItem key={item} value={item}>{formatAction(item, t)}</SelectItem>)}</SelectContent></Select>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <Input type="date" className="w-full sm:w-[142px]" aria-label={t("auditLog.filters.from")} value={route.dateFrom} onChange={(event) => updateRoute({ dateFrom: event.target.value, page: 1 })} />
              <Input type="date" className="w-full sm:w-[142px]" aria-label={t("auditLog.filters.to")} value={route.dateTo} onChange={(event) => updateRoute({ dateTo: event.target.value, page: 1 })} />
            </div>
            {hasFilters && <Button variant="ghost" size="sm" onClick={() => updateRoute({ search: "", action: "all", entityType: "all", dateFrom: "", dateTo: "", page: 1 })}><X aria-hidden="true" /> {t("auditLog.filters.clear")}</Button>}
          </div>

          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs text-muted-foreground">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            <span aria-live="polite">{t("auditLog.matchingEvents", { count: result?.total ?? 0 })}</span>
            {result && <span>{t("auditLog.pageStatus", { page: result.page, totalPages: result.totalPages || 1 })}</span>}
          </div>

          {audit.isLoading ? <div className="divide-y">{Array.from({ length: 8 }, (_, index) => <div key={index} className="flex gap-4 px-4 py-3"><Skeleton className="h-4 w-32" /><Skeleton className="h-4 w-36" /><Skeleton className="h-5 w-24 rounded-full" /><Skeleton className="h-4 flex-1" /></div>)}</div>
          : audit.isError ? <ErrorState variant="server" title={t("auditLog.error.title")} description={t("auditLog.error.description")} onRetry={() => audit.refetch()} />
          : result?.items.length === 0 ? <div className="flex flex-col items-center gap-2 px-4 py-14 text-center text-muted-foreground"><ShieldAlert className="h-8 w-8 opacity-30" /><p className="text-sm font-medium">{hasFilters ? t("auditLog.noFilteredEntries") : t("auditLog.noEntries")}</p><p className="text-xs">{hasFilters ? t("auditLog.noFilteredEntriesDesc") : t("auditLog.noEntriesDesc")}</p></div>
          : <div className="overflow-x-auto" role="region" aria-label={t("auditLog.title")} tabIndex={0}>
            <Table className="min-w-[900px]">
              <TableHeader className="bg-muted/40"><TableRow><TableHead>{t("auditLog.timestamp")}</TableHead><TableHead>{t("auditLog.user")}</TableHead><TableHead>{t("auditLog.action")}</TableHead><TableHead>{t("auditLog.entity")}</TableHead><TableHead>{t("auditLog.change")}</TableHead><TableHead className="w-24 text-end">{t("auditLog.details")}</TableHead></TableRow></TableHeader>
              <TableBody>{result?.items.map((entry) => <Fragment key={entry.id}>
                <TableRow key={entry.id} className="group hover:bg-muted/40">
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{formatDateTime(entry.timestamp)}</TableCell>
                  <TableCell><div className="font-medium">{entry.userName ?? t("auditLog.system")}</div><div className="text-xs text-muted-foreground">{entry.userEmail ?? entry.userRole?.replace(/_/g, " ")}</div></TableCell>
                  <TableCell><ActionBadge entry={entry} t={t} /></TableCell>
                  <TableCell><div className="max-w-[250px] truncate text-sm" title={entry.entityReference ?? undefined}>{entry.entityReference ?? t("auditLog.noReference")}</div><div className="text-xs capitalize text-muted-foreground">{formatAction(entry.module, t)}</div></TableCell>
                  <TableCell className="max-w-[180px] text-xs text-muted-foreground">{entry.changeSummary}{entry.usedOverride && <span className="ms-2 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-700 dark:text-amber-300">{t("auditLog.override")}</span>}</TableCell>
                  <TableCell className="text-end"><Button variant="ghost" size="sm" aria-expanded={expanded === entry.id} aria-controls={`audit-detail-${entry.id}`} onClick={() => setExpanded(expanded === entry.id ? null : entry.id)}>{expanded === entry.id ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}<span className="sr-only">{expanded === entry.id ? t("auditLog.hideDetails") : t("auditLog.showDetails")}</span></Button></TableCell>
                </TableRow>
                {expanded === entry.id && <TableRow key={`detail-${entry.id}`} id={`audit-detail-${entry.id}`}><TableCell colSpan={6} className="p-0"><AuditDetails entry={entry} t={t} /></TableCell></TableRow>}
              </Fragment>)}</TableBody>
            </Table>
          </div>}

          {result && result.totalPages > 1 && <div className="flex flex-col gap-2 border-t px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="text-muted-foreground">{t("auditLog.showingRange", { from: (result.page - 1) * result.pageSize + 1, to: Math.min(result.page * result.pageSize, result.total), total: result.total })}</div>
            <div className="flex items-center gap-2"><Select value={String(route.pageSize)} onValueChange={(pageSize) => updateRoute({ pageSize: Number(pageSize), page: 1 })}><SelectTrigger className="h-9 w-24" aria-label={t("auditLog.filters.pageSizeLabel")}><SelectValue /></SelectTrigger><SelectContent>{[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{t("auditLog.pageSize", { count: size })}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => updateRoute({ page: result.page - 1 })}>{t("auditLog.previous")}</Button><Button variant="outline" size="sm" disabled={result.page >= result.totalPages} onClick={() => updateRoute({ page: result.page + 1 })}>{t("auditLog.next")}</Button></div>
          </div>}
        </CardContent>
      </Card>
    </div>
  );
}