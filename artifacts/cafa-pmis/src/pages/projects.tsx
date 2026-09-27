import { useState, useMemo, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import {
  useListProjects,
  useListStates,
  useGetMe,
  useTransitionProject,
  type ListProjectsQueryResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button as HButton, Card, Chip, Dropdown, Label, ProgressBar as HProgressBar, Separator, Skeleton } from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import { SelectField } from "@/components/select-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Empty, EmptyTitle, EmptyDescription, EmptyHeader } from "@/components/ui/empty";
import { ErrorState } from "@/components/ui/error-state";
import { Plus, FolderKanban, Filter, X, MoreHorizontal, Trash2, Send, Copy } from "@/components/icons";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate, formatStatusLabel, hasPerm } from "@/lib/format";
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

const STATUSES = ["draft", "submitted", "state_reviewed", "technically_approved", "coordination_approved", "approved", "active", "completed", "on_hold", "returned", "closed", "cancelled", "rejected"];

const PROJECT_VIEWS = ["table", "card", "list", "compact", "kanban", "calendar", "map"] as const;

// Kanban columns — one per workflow status, in workflow order, so no project
// falls into the first column; the board hides empty columns. Labels are
// resolved from projects:status.* at render.
const PROJECT_KANBAN_KEYS = [
  "draft", "submitted", "state_reviewed", "technically_approved", "coordination_approved", "approved",
  "active", "on_hold", "returned", "completed", "closed", "cancelled", "rejected",
] as const;
const KANBAN_TONE: Record<string, string> = {
  draft: "border border-[var(--border)] bg-[var(--default)] text-foreground",
  submitted: "border border-[color-mix(in_oklab,var(--accent)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--accent)]",
  technically_approved: "border border-[color-mix(in_oklab,var(--accent)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--accent)]",
  coordination_approved: "border border-[color-mix(in_oklab,var(--accent)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--accent)]",
  approved: "border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]",
  active: "border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]",
  state_reviewed: "border border-[color-mix(in_oklab,var(--accent)_30%,transparent)] bg-[color-mix(in_oklab,var(--accent)_10%,transparent)] text-[var(--accent)]",
  on_hold: "border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
  returned: "border border-[color-mix(in_oklab,var(--warning)_30%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] text-[var(--warning)]",
  completed: "border border-[color-mix(in_oklab,var(--success)_30%,transparent)] bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)]",
  cancelled: "border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] text-[var(--danger)]",
  closed: "border border-[var(--border)] bg-[var(--default)] text-[var(--muted)]",
  rejected: "border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--danger)_10%,transparent)] text-[var(--danger)]",
};

/** HeroUI Chip colour per project workflow status. */
const STATUS_CHIP: Record<string, "default" | "accent" | "success" | "warning" | "danger"> = {
  draft: "default", submitted: "accent", state_reviewed: "accent", technically_approved: "accent",
  coordination_approved: "accent", approved: "success", active: "success", completed: "success",
  on_hold: "warning", returned: "warning", closed: "default", cancelled: "danger", rejected: "danger",
};

function ProjectStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("projects");
  const label = t(`status.${status}`, { defaultValue: formatStatusLabel(status) });
  return (
    <Chip size="sm" variant="soft" color={STATUS_CHIP[status] ?? "default"} className="whitespace-nowrap">
      {label}
    </Chip>
  );
}

function CoverageBadge({ count }: { count: number }) {
  const { t } = useTranslation("projects");
  if (count === 0) return <Chip size="sm" variant="soft" className="whitespace-nowrap">{t("coverage.stateNotAssigned")}</Chip>;
  if (count === 1) return <Chip size="sm" variant="soft" color="accent" className="whitespace-nowrap">{t("coverage.singleState")}</Chip>;
  return <Chip size="sm" variant="soft" color="success" className="whitespace-nowrap">{t("coverage.multiState")}</Chip>;
}

/** Percentage bar on HeroUI ProgressBar; `color` is kept for callers and maps
 *  "bg-secondary" (budget spend) to the neutral tone. */
function ProgressBar({ value, max, color, label, className = "min-w-[120px]" }: { value: number; max: number; color?: string; label?: string; className?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <HProgressBar
      size="sm"
      value={pct}
      color="accent"
      aria-label={label ?? `${pct}%`}
      className={`${className} gap-1`}
    >
      <HProgressBar.Output className="text-xs tabular-nums text-[var(--muted)]" />
      <HProgressBar.Track><HProgressBar.Fill className={color === "bg-secondary" ? "bg-[var(--muted)]" : undefined} /></HProgressBar.Track>
    </HProgressBar>
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
        <div className="flex min-h-0 flex-1 flex-col">
          <ProjectRegistrationForm onClose={() => setOpen(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ProjectItem = ListProjectsQueryResult[number];

/* Row actions: HeroUI Dropdown with submit / duplicate / delete. */
function ProjectActionsMenu({ project, canDelete, onSubmit, onDuplicate, onDelete, label }: {
  project: ProjectItem;
  canDelete: boolean;
  onSubmit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  label: string;
}) {
  const { t } = useTranslation("projects");
  const isDraft = project.status === "draft";
  if (!isDraft && !canDelete) return null;
  return (
    <Dropdown>
      <HButton isIconOnly size="sm" variant="ghost" aria-label={label}>
        <MoreHorizontal className="size-4" aria-hidden="true" />
      </HButton>
      <Dropdown.Popover placement="bottom end" className="min-w-44">
        <Dropdown.Menu
          aria-label={label}
          onAction={(key) => { if (key === "submit") onSubmit(); else if (key === "duplicate") onDuplicate(); else if (key === "delete") onDelete(); }}
        >
          {isDraft ? (
            <Dropdown.Item id="submit" textValue={t("submit")}>
              <Send className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{t("submit")}</Label>
            </Dropdown.Item>
          ) : null}
          {isDraft || canDelete ? (
            <Dropdown.Item id="duplicate" textValue={t("duplicate")}>
              <Copy className="size-4 text-[var(--muted)]" aria-hidden="true" /><Label>{t("duplicate")}</Label>
            </Dropdown.Item>
          ) : null}
          {canDelete ? (
            <Dropdown.Item id="delete" textValue={t("deleteProject")} variant="danger">
              <Trash2 className="size-4" aria-hidden="true" /><Label>{t("deleteProject")}</Label>
            </Dropdown.Item>
          ) : null}
        </Dropdown.Menu>
      </Dropdown.Popover>
    </Dropdown>
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
  const [deleteTarget, setDeleteTarget] = useState<{ id: number; code: string; title: string } | null>(null);
  const [duplicateSourceId, setDuplicateSourceId] = useState<number | null>(null);
  const canDelete = hasPerm(me?.permissions, "projects.delete");
  const canContinueEdit = hasPerm(me?.permissions, "projects.update");
  const continueEdit = useCallback(
    (projectId: number) => setLocation(`/projects/${projectId}?edit=1`),
    [setLocation],
  );

  const { mutateAsync: transitionProject } = transitionMutation;
  const handleDirectSubmitProject = useCallback(async (project: ListProjectsQueryResult[number]) => {
    try {
      await transitionProject({ projectId: project.id, data: { action: "submit" } as never });
      toast.success(t("submitSuccess"));
      qc.invalidateQueries();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }, [transitionProject, t, qc]);

  const handleDuplicateProject = useCallback((project: ListProjectsQueryResult[number]) => {
    // Opens the full registration form prefilled from the source project
    // (title, budget, outputs/indicators/activities, state allocations, ...)
    // instead of POSTing a 5-field payload that was missing every field the
    // create endpoint actually requires (agreement number, reporting
    // frequency, at least one operational location, at least one output) —
    // that always failed validation in practice.
    setDuplicateSourceId(project.id);
  }, []);

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
        // Non-table views (Card/Kanban/Calendar/etc.) only ever render this
        // `actions` slot, so it must carry the same Submit/Duplicate/Delete
        // menu the table row has — otherwise those views have no way to
        // submit or delete a project at all.
        actions: (p.status === "draft" && canContinueEdit) || canDelete ? (
          <div className="flex items-center gap-1">
            {p.status === "draft" && canContinueEdit && (
              <ContinueEditingAction
                recordTitle={p.title}
                onClick={() => continueEdit(p.id)}
              />
            )}
            <ProjectActionsMenu
              project={p}
              canDelete={canDelete}
              label={t("projectActionsAria")}
              onSubmit={() => handleDirectSubmitProject(p)}
              onDuplicate={() => handleDuplicateProject(p)}
              onDelete={() => setDeleteTarget({ id: p.id, code: p.code ?? "", title: p.title })}
            />
          </div>
        ) : undefined,
      })),
    [projects, openRecord, t, tCommon, canContinueEdit, continueEdit, canDelete, handleDirectSubmitProject, handleDuplicateProject],
  );

  const kanbanColumns: KanbanColumn[] = useMemo(
    () => PROJECT_KANBAN_KEYS.map(key => ({ key, label: t(`status.${key}`, { defaultValue: formatStatusLabel(key) }), color: KANBAN_TONE[key] })),
    [t],
  );

  const isAr = i18n.language.startsWith("ar");
  // Long text wraps inside the cell instead of truncating (capped at three
  // lines as a guard; the full value stays in the title tooltip). English
  // text in the Arabic UI keeps its own direction (dir="auto") while the
  // inline-block wrapper keeps it aligned with the column.
  // Fixed layout with explicit header widths: the grid fits the standard
  // desktop content width (1,128 px), so no column slides under the pinned
  // project/actions columns. Narrower screens scroll between the pins.
  const columns = useMemo<DataGridColumn<ProjectItem>[]>(() => [
    { id: "project", header: t("table.project"), isRowHeader: true, width: 206, pinned: "start", headerClassName: "w-[206px]",
      cell: (p) => (
        <div className="flex min-w-0 flex-col">
          <span className="block"><span dir="auto" className="inline-block max-w-full whitespace-normal break-words line-clamp-3 align-top rtl:text-end font-medium leading-snug text-foreground" title={p.title}>{p.title}</span></span>
          {p.code && <span className="truncate font-mono text-xs text-[var(--muted)]"><bdi dir="ltr">{p.code}</bdi></span>}
        </div>
      ) },
    { id: "status", header: t("table.status"), width: 110, headerClassName: "w-[110px]", cell: (p) => <ProjectStatusBadge status={p.status} /> },
    { id: "sectorDonor", header: t("table.sectorDonor"), width: 140, headerClassName: "w-[140px]",
      cell: (p) => (
        <div className="flex min-w-0 flex-col">
          <span className="block"><span dir="auto" className="inline-block max-w-full whitespace-normal break-words line-clamp-3 align-top rtl:text-end text-sm leading-snug" title={p.sector}>{p.sector}</span></span>
          <span className="block"><span dir="auto" className="inline-block max-w-full whitespace-normal break-words line-clamp-3 align-top rtl:text-end text-xs leading-snug text-[var(--muted)]" title={p.donor}>{p.donor}</span></span>
        </div>
      ) },
    { id: "states", header: t("table.states"), width: 116, headerClassName: "w-[116px]",
      cell: (p) => {
        const names = isAr && p.stateNamesAr?.length === p.stateNames.length ? p.stateNamesAr : p.stateNames;
        return (
          <div className="flex max-w-[200px] flex-col items-start gap-1">
            <CoverageBadge count={p.stateNames.length} />
            <div className="flex flex-wrap gap-1">
              {names.slice(0, 3).map((n, i) => <Chip key={i} size="sm" variant="soft" className="whitespace-nowrap">{n}</Chip>)}
              {p.stateNames.length > 3 && <Chip size="sm" variant="soft">+{p.stateNames.length - 3}</Chip>}
            </div>
          </div>
        );
      } },
    { id: "budget", header: t("table.budget"), width: 140, headerClassName: "w-[140px]",
      cell: (p) => (
        <div className="flex flex-col gap-1">
          <ProgressBar className="w-full min-w-0" value={p.budgetSpent} max={p.budgetTotal} color="bg-secondary" label={`${t("table.budget")}: ${formatCurrency(p.budgetSpent)} ${t("detail.of")} ${formatCurrency(p.budgetTotal)}`} />
          <span className="text-xs leading-tight tabular-nums">
            <bdi dir="ltr" className="block font-medium text-foreground">{formatCurrency(p.budgetSpent)}</bdi>
            <span className="text-[var(--muted)]">{t("detail.of")} <bdi dir="ltr">{formatCurrency(p.budgetTotal)}</bdi></span>
          </span>
        </div>
      ) },
    { id: "beneficiaries", header: t("table.beneficiaries"), width: 120, headerClassName: "w-[120px]",
      cell: (p) => (
        <div className="flex flex-col gap-1">
          <ProgressBar className="w-full min-w-0" value={p.beneficiariesReached} max={p.beneficiariesTarget} label={`${t("table.beneficiaries")}: ${p.beneficiariesReached.toLocaleString()} ${t("detail.of")} ${p.beneficiariesTarget.toLocaleString()}`} />
          <span className="text-xs leading-tight tabular-nums">
            <bdi dir="ltr" className="block font-medium text-foreground">{p.beneficiariesReached.toLocaleString()}</bdi>
            <span className="text-[var(--muted)]">{t("detail.of")} <bdi dir="ltr">{p.beneficiariesTarget.toLocaleString()}</bdi></span>
          </span>
        </div>
      ) },
    { id: "endDate", header: t("table.endDate"), width: 116, headerClassName: "w-[116px]",
      cell: (p) => {
        const overdue = !!p.endDate && new Date(p.endDate) < new Date() && p.status !== "closed" && p.status !== "completed";
        return <span className={`whitespace-nowrap text-sm ${overdue ? "font-medium text-[var(--danger)]" : "text-[var(--muted)]"}`}><bdi dir="ltr">{formatDate(p.endDate)}</bdi></span>;
      } },
    { id: "actions", header: <span className="sr-only">{t("table.actions")}</span>, width: 180, pinned: "end", headerClassName: "w-[180px]", align: "end",
      cell: (p) => (
        <div className="flex items-center justify-end gap-1">
          {p.status === "draft" && canContinueEdit && (
            <ContinueEditingAction recordTitle={p.title} onClick={() => continueEdit(p.id)} />
          )}
          <ProjectActionsMenu
            project={p}
            canDelete={canDelete}
            label={p.status === "draft" ? tCommon("moreActions") : t("projectActionsAria")}
            onSubmit={() => handleDirectSubmitProject(p)}
            onDuplicate={() => handleDuplicateProject(p)}
            onDelete={() => setDeleteTarget({ id: p.id, code: p.code ?? "", title: p.title })}
          />
        </div>
      ) },
  ], [t, tCommon, isAr, canContinueEdit, canDelete, continueEdit, handleDirectSubmitProject, handleDuplicateProject]);

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
        <HButton
          variant="secondary"
          size="sm"
          className="mt-3"
          onPress={() => { setStatusFilter(""); setSectorFilter(""); setStateFilter(""); }}
        >
          <X className="size-3.5" aria-hidden="true" />
          {t("clearFilters")}
        </HButton>
      )}
    </Empty>
  );

  return (
    <div className="space-y-4">
      {/* ── Page header ── */}
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-foreground text-xl font-semibold">{t("title")}</h1>
            {!isLoading && !isError && projects && (
              <Chip size="sm" variant="soft" className="tabular-nums">{projects.length}</Chip>
            )}
          </div>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {t("managedProjects")}
          </p>
        </div>
        {canCreate && <NewProjectDialog />}
      </div>

      {/* Enterprise control bar: filters (start) + view switcher (end) */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2.5">

        {/* ── Start: filter region ── */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 select-none items-center gap-1.5 text-sm font-medium text-[var(--muted)]">
            <Filter className="size-4" aria-hidden="true" />
            {tCommon("filter")}
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />

          <SelectField
            aria-label={tCommon("status")}
            value={statusFilter || "all"}
            onChange={(v) => setStatusFilter(v === "all" ? "" : v)}
            triggerClassName="h-10 min-w-[9rem]"
            options={[{ value: "all", label: t("filters.allStatuses") }, ...STATUSES.map(st => ({ value: st, label: t(`status.${st}`, { defaultValue: formatStatusLabel(st) }) }))]}
          />
          <SelectField
            aria-label={tCommon("sector")}
            value={sectorFilter || "all"}
            onChange={(v) => setSectorFilter(v === "all" ? "" : v)}
            triggerClassName="h-10 min-w-[9rem]"
            options={[{ value: "all", label: t("filters.allSectors") }, ...SECTORS.map(sec => ({ value: sec, label: sec }))]}
          />
          <SelectField
            aria-label={tCommon("state")}
            value={stateFilter || "all"}
            onChange={(v) => setStateFilter(v === "all" ? "" : v)}
            triggerClassName="h-10 min-w-[9rem]"
            options={[{ value: "all", label: t("filters.allStates") }, ...(states ?? []).map(st => ({ value: String(st.id), label: <StateLabel state={st} />, textValue: st.name }))]}
          />

          {hasFilters && (
            <HButton
              variant="ghost"
              size="sm"
              className="shrink-0"
              onPress={() => { setStatusFilter(""); setSectorFilter(""); setStateFilter(""); }}
            >
              <X className="size-3.5" aria-hidden="true" />
              {t("clearFilters")}
            </HButton>
          )}
        </div>

        {/* ── Divider ── */}
        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />

        {/* ── Right: view-mode switcher ── */}
        <ViewModeSwitcher
          available={[...PROJECT_VIEWS]}
          current={viewMode}
          onChange={setViewMode}
        />
      </div>

      {isError ? (
        <Card className="p-0">
          <ErrorState
            variant="server"
            title={t("loadError")}
            description={t("loadErrorDesc")}
            onRetry={() => refetch()}
          />
        </Card>
      ) : isLoading ? (
        <Card className="p-0">
          <div className="divide-y divide-[var(--separator)]" aria-hidden="true">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3.5">
                <Skeleton className="h-4 w-20 shrink-0 rounded" />
                <Skeleton className="h-4 flex-1 rounded" />
                <Skeleton className="h-5 w-20 shrink-0 rounded-full" />
                <Skeleton className="hidden h-4 w-24 shrink-0 rounded md:block" />
                <Skeleton className="hidden h-4 w-32 shrink-0 rounded lg:block" />
                <Skeleton className="hidden h-4 w-16 shrink-0 rounded xl:block" />
              </div>
            ))}
          </div>
        </Card>
      ) : viewMode === "table" ? (
        !projects || projects.length === 0 ? <Card>{emptyNode}</Card> : (
          <DataGrid
            aria-label={t("title")}
            data={projects}
            columns={columns}
            getRowId={(p) => p.id}
            onRowAction={(key) => openRecord("project", Number(key))}
            contentClassName="min-w-[1128px] table-fixed"
            verticalAlign="middle"
          />
        )
      ) : viewMode === "card" ? (
        <CardGrid items={viewRecords} empty={emptyNode} />
      ) : viewMode === "list" ? (
        <Card className="p-0">
          <ListView items={viewRecords} empty={emptyNode} />
        </Card>
      ) : viewMode === "compact" ? (
        <Card className="p-0">
          <CompactView items={viewRecords} empty={emptyNode} />
        </Card>
      ) : viewMode === "kanban" ? (
        <div className="p-1">
          <KanbanBoard items={viewRecords} columns={kanbanColumns} empty={emptyNode} />
        </div>
      ) : viewMode === "calendar" ? (
        <Card>
          <CalendarGrid items={viewRecords} empty={emptyNode} />
        </Card>
      ) : viewMode === "map" ? (
        <Card>
          <StateMap items={viewRecords} states={states ?? []} empty={emptyNode} />
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

      {/* ── Duplicate Project Dialog ── */}
      <Dialog open={duplicateSourceId != null} onOpenChange={(o) => !o && setDuplicateSourceId(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
          <div className="px-6 pt-6 pb-4 border-b shrink-0">
            <DialogHeader>
              <DialogTitle>{t("duplicate")}</DialogTitle>
              <DialogDescription>{t("registerDesc")}</DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {duplicateSourceId != null && (
              <ProjectRegistrationForm
                duplicateFromProjectId={duplicateSourceId}
                onClose={() => setDuplicateSourceId(null)}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export { ProjectStatusBadge, ProgressBar };
