import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListProjects,
  useListStates,
  useGetMe,
  useTransitionProject,
  useCreateProject,
  type ListProjectsQueryResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Empty, EmptyTitle, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ErrorState } from "@/components/ui/error-state";
import { Plus, FolderKanban, Filter, X, MoreHorizontal, Trash2, Send, Copy } from "lucide-react";
import { toast } from "sonner";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatCurrency, formatDate, formatStatusLabel, hasPerm, statusBadgeVariant } from "@/lib/format";
import { ProjectRegistrationForm } from "@/components/project-registration-form";
import { DeleteProjectDialog } from "@/components/delete-project-dialog";
import { SECTORS } from "@/lib/sectors";
import { useViewMode } from "@/lib/view-modes";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { ListView } from "@/components/view-modes/list-view";
import { CompactView } from "@/components/view-modes/compact-view";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { CalendarGrid } from "@/components/view-modes/calendar-grid";
import { StateMap } from "@/components/view-modes/state-map";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
import { useRecordDetail } from "@/contexts/record-detail-context";
import { useLocationContext } from "@/contexts/location-context";
import { ContinueEditingAction } from "@/components/continue-editing-action";

const STATUSES = ["draft", "submitted", "state_reviewed", "technically_approved", "coordination_approved", "approved", "active", "closed", "rejected"];

const PROJECT_VIEWS = ["table", "card", "list", "compact", "kanban", "calendar", "map"] as const;

// Column header colors mirror the semantic badge variants defined in badge.tsx.
// When badge.tsx variant colors change, update the matching entry here too.
const PROJECT_KANBAN_COLS: KanbanColumn[] = [
  { key: "draft",                  label: "Draft",                   color: "border border-slate-200 bg-slate-50 text-slate-600" },
  { key: "submitted",              label: "Submitted",               color: "border border-blue-200 bg-blue-50 text-blue-700" },
  { key: "technically_approved",   label: "Technically Approved",    color: "border border-indigo-200 bg-indigo-50 text-indigo-700" },
  { key: "coordination_approved",  label: "Coordination Approved",   color: "border border-violet-200 bg-violet-50 text-violet-700" },
  { key: "approved",               label: "Approved",                color: "border border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "active",                 label: "Active",                  color: "border border-emerald-200 bg-emerald-50 text-emerald-700" },
  { key: "closed",                 label: "Closed",                  color: "border border-slate-200 bg-slate-100 text-slate-600" },
  { key: "rejected",               label: "Rejected",                color: "border border-red-200 bg-red-50 text-red-700" },
];

function ProjectStatusBadge({ status }: { status: string }) {
  const { variant, className } = statusBadgeVariant(status);
  const label = formatStatusLabel(status);
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge variant={variant} className={className} aria-label={label}>
          {label}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}

function CoverageBadge({ count }: { count: number }) {
  const { t } = useTranslation("projects");
  if (count === 0) return <Badge variant="outline" className="text-xs text-muted-foreground">{t("coverage.stateNotAssigned")}</Badge>;
  if (count === 1) return <Badge variant="submitted" className="text-xs cursor-default">{t("coverage.singleState")}</Badge>;
  return <Badge variant="completed" className="text-xs cursor-default">{t("coverage.multiState")}</Badge>;
}

function ProgressBar({ value, max, color = "bg-primary" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="space-y-1 min-w-[120px]">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span><bdi dir="ltr">{pct}%</bdi></span>
      </div>
      <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function NewProjectDialog() {
  const [open, setOpen] = useState(false);
  const { t } = useTranslation("projects");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="h-10 gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          {t("newProject")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogHeader>
            <DialogTitle>{t("registerNew")}</DialogTitle>
            <DialogDescription>
              {t("registerDesc")}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-6">
          <ProjectRegistrationForm onClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { openRecord } = useRecordDetail();
  const [, setLocation] = useLocation();
  const { t, i18n } = useTranslation("projects");
  const { t: tCommon } = useTranslation("common");
  const initialParams = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : new URLSearchParams();
  const [statusFilter, setStatusFilter] = useState<string>(initialParams.get("status") ?? "");
  const [sectorFilter, setSectorFilter] = useState<string>(initialParams.get("sector") ?? "");
  const [stateFilter, setStateFilter] = useState<string>(initialParams.get("stateId") ?? "");

  // Sync with global location context — updates the local filter when the header selector changes
  const { selectedStateId: ctxStateId } = useLocationContext();
  useEffect(() => {
    setStateFilter(ctxStateId != null ? String(ctxStateId) : "");
  }, [ctxStateId]);

  const [viewMode, setViewMode] = useViewMode("projects", [...PROJECT_VIEWS], "table");

  const params = useMemo(() => {
    const p: { stateId?: number; status?: string; sector?: string } = {};
    if (stateFilter) p.stateId = Number(stateFilter);
    if (statusFilter) p.status = statusFilter;
    if (sectorFilter) p.sector = sectorFilter;
    return p;
  }, [statusFilter, sectorFilter, stateFilter]);

  const { data: projects, isLoading, isError, refetch } = useListProjects(params);
  const { data: states } = useListStates();
  const { data: me } = useGetMe();
  const canCreate = hasPerm(me?.permissions, "projects.create");

  const qc = useQueryClient();
  const transitionMutation = useTransitionProject();
  const createMutation = useCreateProject();
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; code: string; title: string } | null>(null);
  const canDelete = hasPerm(me?.permissions, "projects.delete");
  const canContinueEdit = hasPerm(me?.permissions, "projects.update");
  const continueEdit = useCallback(
    (projectId: number) => setLocation(`/projects/${projectId}?edit=1`),
    [setLocation],
  );

  async function handleDirectSubmitProject(project: ListProjectsQueryResult[number]) {
    try {
      await transitionMutation.mutateAsync({ projectId: project.id, data: { action: "submit" } as never });
      toast.success(t("submitSuccess"));
      qc.invalidateQueries();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleDuplicateProject(project: ListProjectsQueryResult[number]) {
    try {
      const payload = {
        title: `Copy of ${project.title}`,
        donor: project.donor,
        sector: project.sector,
        budgetTotal: project.budgetTotal,
        endDate: project.endDate,
      };
      await createMutation.mutateAsync({ data: payload as never });
      toast.success(t("createSuccess"));
      qc.invalidateQueries();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  const viewRecords: ViewRecord[] = useMemo(
    () =>
      (projects ?? []).map((p) => ({
        id: p.id,
        title: p.title,
        code: p.code,
        subtitle: p.donor,
        status: p.status,
        statusBadge: <ProjectStatusBadge status={p.status} />,
        tag: p.sector,
        date: formatDate(p.endDate),
        meta: [
          { label: tCommon("donor"), value: p.donor },
          { label: tCommon("budget"), value: formatCurrency(p.budgetTotal) },
          { label: tCommon("beneficiaries"), value: `${p.beneficiariesReached.toLocaleString()} / ${p.beneficiariesTarget.toLocaleString()}` },
          { label: tCommon("endDate"), value: formatDate(p.endDate) },
        ],
        progress: { value: p.budgetSpent, max: p.budgetTotal, label: t("card.budgetSpent") },
        stateNames: p.stateNames,
        stateNamesAr: p.stateNamesAr,
        onClick: (trigger) => openRecord("project", p.id, trigger),
        // Draft editing is a direct route, distinct from the read-only viewer.
        actions: p.status === "draft" && canContinueEdit ? (
          <ContinueEditingAction
            recordTitle={p.title}
            onClick={() => continueEdit(p.id)}
          />
        ) : undefined,
      })),
    [projects, openRecord, t, tCommon, canContinueEdit, continueEdit],
  );

  const hasFilters = !!(statusFilter || sectorFilter || stateFilter);

  const emptyNode = (
    <Empty>
      <EmptyHeader>
        <FolderKanban className="h-10 w-10 text-muted-foreground" aria-hidden="true" />
        <EmptyTitle>{t("noProjects")}</EmptyTitle>
        <EmptyDescription>
          {hasFilters ? t("noProjectsFiltered") : t("noProjectsAdjust")}
        </EmptyDescription>
      </EmptyHeader>
      {hasFilters && (
        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          onClick={() => { setStatusFilter(""); setSectorFilter(""); setStateFilter(""); }}
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
          {t("clearFilters")}
        </Button>
      )}
    </Empty>
  );

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-3xl font-bold tracking-tight">{t("title")}</h1>
            {!isLoading && !isError && projects && (
              <span className="text-sm font-medium text-muted-foreground bg-muted rounded-full px-2.5 py-0.5 tabular-nums">
                {projects.length}
              </span>
            )}
          </div>
          <p className="text-sm text-muted-foreground mt-2">
            {t("managedProjects")}
          </p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {/* Enterprise control bar: filters (left) + view switcher (right) */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5">

        {/* ── Left: filter region ── */}
        <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground shrink-0 select-none">
            <Filter className="h-4 w-4" aria-hidden="true" />
            {tCommon("filter")}
          </div>
          <Separator orientation="vertical" className="h-5 hidden sm:block shrink-0" />

          <Select value={statusFilter || "all"} onValueChange={(v) => setStatusFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-10 min-w-[7rem] w-auto max-w-[12rem] text-sm border-border/60" aria-label={tCommon("status")}>
              <SelectValue placeholder={t("filters.allStatuses")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
              {STATUSES.map(s => (
                <SelectItem key={s} value={s}>
                  {s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sectorFilter || "all"} onValueChange={(v) => setSectorFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-10 min-w-[7rem] w-auto max-w-[12rem] text-sm border-border/60" aria-label={tCommon("sector")}>
              <SelectValue placeholder={t("filters.allSectors")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allSectors")}</SelectItem>
              {SECTORS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>

          <Select value={stateFilter || "all"} onValueChange={(v) => setStateFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="h-10 min-w-[7rem] w-auto max-w-[12rem] text-sm border-border/60" aria-label={tCommon("state")}>
              <SelectValue placeholder={t("filters.allStates")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStates")}</SelectItem>
              {states?.map(s => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
            </SelectContent>
          </Select>

          {hasFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 px-2.5 text-sm text-muted-foreground hover:text-foreground gap-1.5 shrink-0"
              onClick={() => { setStatusFilter(""); setSectorFilter(""); setStateFilter(""); }}
            >
              <X className="h-3.5 w-3.5" />
              {t("clearFilters")}
            </Button>
          )}
        </div>

        {/* ── Divider ── */}
        <Separator orientation="vertical" className="h-6 hidden md:block shrink-0" />

        {/* ── Right: view-mode switcher ── */}
        <ViewModeSwitcher
          available={[...PROJECT_VIEWS]}
          current={viewMode}
          onChange={setViewMode}
        />
      </div>

      {isError ? (
        <Card>
          <CardContent className="p-0">
            <ErrorState
              variant="server"
              title={t("loadError")}
              description={t("loadErrorDesc")}
              onRetry={() => refetch()}
            />
          </CardContent>
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-border/60">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                  <Skeleton className="h-4 w-20 shrink-0" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-5 w-20 shrink-0" />
                  <Skeleton className="h-4 w-24 shrink-0 hidden md:block" />
                  <Skeleton className="h-4 w-32 shrink-0 hidden lg:block" />
                  <Skeleton className="h-4 w-16 shrink-0 hidden xl:block" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : viewMode === "table" ? (
        <Card>
          <CardContent className="p-0">
            {!projects || projects.length === 0 ? emptyNode : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("table.project")}</TableHead>
                      <TableHead>{t("table.status")}</TableHead>
                      <TableHead>{t("table.sector")}</TableHead>
                      <TableHead>{t("table.donor")}</TableHead>
                      <TableHead>{t("table.states")}</TableHead>
                      <TableHead>{t("table.budget")}</TableHead>
                      <TableHead>{t("table.beneficiaries")}</TableHead>
                      <TableHead className="whitespace-nowrap">{t("table.endDate")}</TableHead>
                      <TableHead className="w-[160px]">{t("table.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {projects.map(p => (
                      <TableRow
                        key={p.id}
                        className="cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        tabIndex={0}
                        aria-label={`View ${p.title}`}
                        onClick={(event) => openRecord("project", p.id, event.currentTarget)}
                        onKeyDown={(event) => {
                          if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
                          event.preventDefault();
                          openRecord("project", p.id, event.currentTarget);
                        }}
                      >
                        <TableCell className="min-w-[200px] max-w-[280px]">
                          <div className="font-medium truncate">{p.title}</div>
                          {p.code && <div className="text-xs font-mono text-muted-foreground truncate"><bdi dir="ltr">{p.code}</bdi></div>}
                        </TableCell>
                        <TableCell><ProjectStatusBadge status={p.status} /></TableCell>
                        <TableCell className="max-w-[140px] truncate text-sm">{p.sector}</TableCell>
                        <TableCell className="max-w-[140px] truncate text-sm text-muted-foreground">{p.donor}</TableCell>
                        <TableCell>
                          <div className="flex flex-col gap-1 max-w-[200px]">
                            <CoverageBadge count={p.stateNames.length} />
                            <div className="flex flex-wrap gap-1">
                              {(i18n.language.startsWith("ar") && p.stateNamesAr?.length === p.stateNames.length
                                ? p.stateNamesAr
                                : p.stateNames).slice(0, 3).map((n, i) => (
                                <Badge key={i} variant="outline" className="text-xs">{n}</Badge>
                              ))}
                              {p.stateNames.length > 3 && <Badge variant="outline" className="text-xs">+{p.stateNames.length - 3}</Badge>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <ProgressBar value={p.budgetSpent} max={p.budgetTotal} color="bg-secondary" />
                            <div className="text-xs text-muted-foreground">{formatCurrency(p.budgetSpent)} / {formatCurrency(p.budgetTotal)}</div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="space-y-1">
                            <ProgressBar value={p.beneficiariesReached} max={p.beneficiariesTarget} />
                            <div className="text-xs text-muted-foreground">{p.beneficiariesReached.toLocaleString()} / {p.beneficiariesTarget.toLocaleString()}</div>
                          </div>
                        </TableCell>
                        <TableCell className={`text-sm whitespace-nowrap ${p.endDate && new Date(p.endDate) < new Date() && p.status !== "closed" && p.status !== "completed" ? "text-destructive font-medium" : "text-muted-foreground"}`}>{formatDate(p.endDate)}</TableCell>
                        <TableCell onClick={(e) => e.stopPropagation()} className="py-2">
                          {p.status === "draft" ? (
                            <div className="flex items-center gap-1">
                              {canContinueEdit && (
                                <ContinueEditingAction
                                  recordTitle={p.title}
                                  onClick={() => continueEdit(p.id)}
                                />
                              )}
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={tCommon("moreActions")}>
                                    <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem onClick={() => handleDirectSubmitProject(p)} className="gap-2">
                                    <Send className="h-3.5 w-3.5" /> {t("submit")}
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDuplicateProject(p)} className="gap-2">
                                    <Copy className="h-3.5 w-3.5" /> {t("duplicate")}
                                  </DropdownMenuItem>
                                  {canDelete && (
                                    <>
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setDeleteTarget({ id: p.id, code: p.code ?? "", title: p.title })}
                                        className="gap-2 text-destructive focus:text-destructive"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" /> Delete Project
                                      </DropdownMenuItem>
                                    </>
                                  )}
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </div>
                          ) : canDelete ? (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("projectActionsAria")}>
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-40">
                                <DropdownMenuItem
                                  onClick={() => setDeleteTarget({ id: p.id, code: p.code ?? "", title: p.title })}
                                  className="gap-2 text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5" /> Delete Project
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
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
          <KanbanBoard items={viewRecords} columns={PROJECT_KANBAN_COLS} empty={emptyNode} />
        </div>
      ) : viewMode === "calendar" ? (
        <Card>
          <CardContent className="p-4">
            <CalendarGrid items={viewRecords} empty={emptyNode} />
          </CardContent>
        </Card>
      ) : viewMode === "map" ? (
        <Card>
          <CardContent className="p-4">
            <StateMap items={viewRecords} states={states ?? []} empty={emptyNode} />
          </CardContent>
        </Card>
      ) : null}

      {/* ── Delete Project Dialog ── */}
      {deleteTarget && (
        <DeleteProjectDialog
          projectId={deleteTarget.id}
          projectCode={deleteTarget.code}
          projectTitle={deleteTarget.title}
          open={!!deleteTarget}
          onOpenChange={(o) => !o && setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export { ProjectStatusBadge, ProgressBar };
