import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { useLocationContext } from "@/contexts/location-context";
import {
  useListRisks,
  useListProjects,
  useListStates,
  useCreateRisk,
  useUpdateRisk,
  useGetMe,
  type ListRisksQueryResult,
  type ListRisksParams,
} from "@workspace/api-client-react";
import { CreateRiskBody, UpdateRiskBody } from "@workspace/api-zod";
import {
  Button, Card, Chip, Input, Label, Modal, SearchField, Separator, Skeleton, Tabs, TextArea,
} from "@heroui/react";
import { DataGrid, type DataGridColumn } from "@heroui-pro/react/data-grid";
import {
  AlertTriangle, AlertCircle, Plus, X, Clock, CheckCircle2, User, Filter,
  Calendar, Shield, FileText, History, MessageSquare,
} from "@/components/icons";
import { RISK_STATUS_OPTIONS, RISK_STATUS_VALUES, formatRiskStatus } from "@/lib/risk-statuses";
import { LocationSelector } from "@/components/location-selector";
import { StateLabel, getStateLabel } from "@/components/state-label";
import { CommentsPanel } from "@/components/comments-panel";
import { DriveAttachmentPanel, AttachmentCountBadge } from "@/components/drive-attachment-panel";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/error-state";
import { formatDate, formatDateTime, hasPerm, formatLocation } from "@/lib/format";
import { RecordDetailModal } from "@/components/record-detail-modal";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import { statusTone } from "@/components/view-modes/shared";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { OfflineDraftNotice } from "@/components/offline-draft-notice";
import { useDurableFormDraft } from "@/hooks/use-durable-form-draft";
import { useSyncContext } from "@/contexts/sync-context";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";
import { SelectField } from "@/components/select-field";
import { DateInput } from "@/components/form-controls";
import { FilterKpi } from "@/components/filter-kpi";
import { RegistryPagination } from "@/components/registry-pagination";

type Risk = ListRisksQueryResult["items"][number] & { riskLevel?: string | null };

// ── Constants ──────────────────────────────────────────────────────────────────
const CATEGORIES = ["security", "operational", "financial", "programmatic", "environmental"] as const;
const PROBABILITIES = ["low", "medium", "high"] as const;
const IMPACTS = ["low", "medium", "high"] as const;
const RISK_LEVELS = ["low", "medium", "high", "critical"] as const;
const FILTER_STATUSES = ["open", "under_mitigation", "closed"] as const;
const RISK_REGISTER_VIEWS = ["table", "card", "kanban"] as const;
type RiskRegisterView = typeof RISK_REGISTER_VIEWS[number];
const DEFAULT_LIMIT = 50;
type RiskRegisterState = {
  search: string;
  status: string;
  riskLevel: string;
  category: string;
  projectId: string;
  stateId: string;
  assignedToId: string;
  page: number;
  activeOnly: boolean;
  view: RiskRegisterView;
};

const isOneOf = <T extends readonly string[]>(value: string | null, options: T): value is T[number] =>
  value !== null && (options as readonly string[]).includes(value);

function validIdParam(value: string | null): string {
  return value !== null && /^\d+$/.test(value) && Number(value) > 0 ? value : "all";
}

/** Parse only the Risk Register's supported, user-shareable URL state. */
export function parseRiskRegisterState(location: string): RiskRegisterState {
  const queryIndex = location.indexOf("?");
  const params = new URLSearchParams(queryIndex >= 0 ? location.slice(queryIndex + 1) : "");
  const rawPage = params.get("page");
  const rawView = params.get("view");
  const page = rawPage !== null && /^\d+$/.test(rawPage) && Number(rawPage) > 0 ? Number(rawPage) : 1;
  return {
    search: params.get("search") ?? "",
    status: isOneOf(params.get("status"), FILTER_STATUSES) ? params.get("status")! : "all",
    riskLevel: isOneOf(params.get("riskLevel"), RISK_LEVELS) ? params.get("riskLevel")! : "all",
    category: isOneOf(params.get("category"), CATEGORIES) ? params.get("category")! : "all",
    projectId: validIdParam(params.get("projectId")),
    stateId: validIdParam(params.get("stateId")),
    assignedToId: validIdParam(params.get("assignedToId")),
    page,
    activeOnly: params.get("activeOnly") === "1" || params.get("activeOnly") === "true",
    view: isOneOf(rawView, RISK_REGISTER_VIEWS) ? rawView : "table",
  };
}

type RiskRegisterPatch = Partial<RiskRegisterState>;

/** Update managed keys while retaining unrelated query context and KPI entry state. */
export function buildRiskRegisterLocation(location: string, patch: RiskRegisterPatch): string {
  const queryIndex = location.indexOf("?");
  const path = queryIndex >= 0 ? location.slice(0, queryIndex) : location;
  const params = new URLSearchParams(queryIndex >= 0 ? location.slice(queryIndex + 1) : "");
  const next = { ...parseRiskRegisterState(location), ...patch };
  const values: Array<[keyof RiskRegisterState, string]> = [
    ["search", next.search.trim()],
    ["status", next.status],
    ["riskLevel", next.riskLevel],
    ["category", next.category],
    ["projectId", next.projectId],
    ["stateId", next.stateId],
    ["assignedToId", next.assignedToId],
    ["page", String(next.page)],
    ["activeOnly", next.activeOnly ? "1" : ""],
    ["view", next.view],
  ];
  for (const [key, value] of values) {
    const isDefault = value === "" || value === "all"
      || (key === "page" && value === "1")
      || (key === "view" && value === "table");
    if (isDefault) params.delete(key);
    else params.set(key, value);
  }
  const query = params.toString();
  return `${path || "/risks"}${query ? `?${query}` : ""}`;
}

function displayStatus(s: string | null | undefined, t: (key: string) => string) {
  const option = RISK_STATUS_OPTIONS.find((item) => item.value === (s || "open"));
  return option ? t(option.labelKey) : formatRiskStatus(s);
}

function displayLikelihood(l: string | null | undefined) {
  if (!l) return "—";
  const map: Record<string, string> = {
    low: "Low", medium: "Medium", high: "High",
    unlikely: "Unlikely", possible: "Possible", likely: "Likely", almost_certain: "Almost Certain",
  };
  return map[l] ?? l;
}

function displayRiskLevel(lvl: string | null | undefined) {
  if (!lvl) return "—";
  const map: Record<string, string> = {
    low: "Low", medium: "Medium", high: "High", critical: "Critical",
  };
  return map[lvl] ?? lvl.charAt(0).toUpperCase() + lvl.slice(1);
}

function displayImpact(val: string | null | undefined) {
  if (!val) return "—";
  const map: Record<string, string> = {
    low: "Low", medium: "Medium", high: "High",
    unlikely: "Unlikely", possible: "Possible", likely: "Likely", almost_certain: "Almost Certain",
  };
  return map[val] ?? val.charAt(0).toUpperCase() + val.slice(1);
}

function displayCategory(cat: string | null | undefined) {
  if (!cat) return "—";
  const map: Record<string, string> = {
    security: "Security",
    operational: "Operational",
    financial: "Financial",
    programmatic: "Programmatic",
    environmental: "Environmental",
  };
  return map[cat] ?? cat.charAt(0).toUpperCase() + cat.slice(1);
}

type RiskReferenceField = "stateId" | "projectId" | "assignedToId";
type ActiveAssignee = { id: number; name: string; role: string };

async function fetchActiveRiskAssignees(): Promise<ActiveAssignee[]> {
  const response = await fetch("/api/users/for-messaging?limit=100", { credentials: "include" });
  if (!response.ok) throw new Error("Could not load available responsible people.");

  const data: unknown = await response.json();
  return Array.isArray(data)
    ? data.filter((user): user is ActiveAssignee =>
      typeof user === "object" && user !== null
      && typeof (user as ActiveAssignee).id === "number"
      && typeof (user as ActiveAssignee).name === "string"
      && typeof (user as ActiveAssignee).role === "string")
    : [];
}

/** Maps an API reference error to the field it concerns and an i18n key (namespace "risks"). */
function getRiskReferenceError(error: unknown): { field: RiskReferenceField; message: string } | null {
  const apiError = error as {
    data?: { error?: string; message?: string };
    response?: { data?: { error?: string; message?: string } };
  };
  const code = apiError.data?.error ?? apiError.response?.data?.error;

  switch (code) {
    case "state_not_found":
      return { field: "stateId", message: "validation.stateNotFound" };
    case "project_not_found":
      return { field: "projectId", message: "validation.projectNotFound" };
    case "assigned_user_not_found":
      return { field: "assignedToId", message: "validation.assigneeNotFound" };
    case "assigned_user_not_active":
      return { field: "assignedToId", message: "validation.assigneeInactive" };
    default:
      return null;
  }
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation("risks");
  const s = status || "open";
  return <Chip size="sm" variant="soft" color={statusTone(s)}>{displayStatus(s, t)}</Chip>;
}

/** Risk level as a Chip: critical is solid red so it stands out from high. */
function RiskLevelChip({ level }: { level: string | null | undefined }) {
  const { t } = useTranslation("risks");
  if (!level) return <span className="text-[var(--muted)]">—</span>;
  const color = level === "critical" || level === "high" ? "danger" : level === "medium" ? "warning" : "success";
  return (
    <Chip size="sm" variant={level === "critical" ? "primary" : "soft"} color={color}>
      {t(`presentation.riskLevels.${level}`, { defaultValue: displayRiskLevel(level) })}
    </Chip>
  );
}

/** Heading for a group of form fields. */
function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 w-full border-b border-[var(--border)] pb-1 text-sm font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function FieldError({ id, children }: { id?: string; children: React.ReactNode }) {
  return <p id={id} className="mt-1 text-xs text-[var(--danger)]" role="alert">{children}</p>;
}

function RiskPresentationSkeleton({ view }: { view: RiskRegisterView }) {
  if (view === "card") {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="skeleton-card-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-4 rounded-xl border border-[var(--border)] p-4">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-5 w-3/5 rounded-md" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
              <Skeleton className="h-8 rounded-md" />
            </div>
            <Skeleton className="h-4 w-2/5 rounded-md" />
          </div>
        ))}
      </div>
    );
  }
  if (view === "kanban") {
    return (
      <div className="flex min-h-[280px] gap-4 overflow-x-auto p-4" data-testid="skeleton-board">
        {RISK_STATUS_OPTIONS.map((option) => (
          <div key={option.value} className="w-[clamp(260px,30vw,340px)] shrink-0 space-y-2">
            <Skeleton className="h-9 w-full rounded-lg" />
            <Skeleton className="h-28 w-full rounded-lg" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="divide-y divide-[var(--border)]" data-testid="skeleton-table">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-3">
          <Skeleton className="h-4 flex-[3] rounded-md" />
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-4 w-14 rounded-md" />
          <Skeleton className="h-4 w-14 rounded-md" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-20 rounded-md" />
          <Skeleton className="h-4 w-28 rounded-md" />
          <Skeleton className="h-4 w-20 rounded-md" />
        </div>
      ))}
    </div>
  );
}

// ── History entry type ─────────────────────────────────────────────────────────
type HistoryEntry = {
  id: number; action: string; newValue: string | null;
  createdAt: string; userName: string | null; userRole: string | null;
};

const HISTORY_DOT: Record<string, string> = {
  created: "bg-[var(--success)]", create: "bg-[var(--success)]",
  closed: "bg-[var(--muted)]",
};

/** One labelled value in the read-only details grid. */
function DetailItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="mb-1 text-xs font-medium text-[var(--muted)]">{label}</dt>
      <dd className="font-medium break-words">{children}</dd>
    </div>
  );
}

// ── Risk Detail Modal ──────────────────────────────────────────────────────────
function RiskDetailModal({
  risk, onClose, projects: _projects, states: _states, users, me, updateMutation, restoreFocusRef,
}: {
  risk: Risk | null;
  onClose: () => void;
  projects: { id: number; code: string; title: string }[] | undefined;
  states: { id: number; name: string }[] | undefined;
  users: { id: number; name: string; role: string }[] | undefined;
  me: { user: { id: number; role: string }; permissions?: string[] } | undefined;
  updateMutation: ReturnType<typeof useUpdateRisk>;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
}) {
  const { t, i18n } = useTranslation("risks");
  const [editMode, setEditMode] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const form = useForm<{
    title: string; description?: string; category: string;
    severity: string; likelihood: string; impact?: string;
    status: string; mitigationPlan?: string; assignedToId?: number | null; dueDate?: string;
  }>({
    resolver: zodResolver(UpdateRiskBody),
    defaultValues: {},
  });

  const {
    data: history,
    isLoading: historyLoading,
    isError: historyIsError,
    refetch: refetchHistory,
  } = useQuery<HistoryEntry[]>({
    queryKey: ["risk-history", risk?.id],
    queryFn: async () => {
      if (!risk) return [];
      const r = await fetch(`/api/risks/${risk.id}/history`, { credentials: "include" });
      if (!r.ok) throw new Error("Could not load risk history.");
      return r.json();
    },
    enabled: !!risk,
  });

  const onEdit = () => {
    if (!risk) return;
    setIsResetting(true);
    form.reset({
      title: risk.title,
      description: risk.description ?? "",
      category: risk.category,
      severity: risk.severity,
      likelihood: risk.likelihood,
      impact: (risk as Risk & { impact?: string | null }).impact ?? risk.severity,
      status: risk.status,
      mitigationPlan: risk.mitigationPlan ?? "",
      assignedToId: risk.assignedToId ?? null,
      dueDate: risk.dueDate ? String(risk.dueDate).slice(0, 10) : "",
    });
    setEditMode(true);
    requestAnimationFrame(() => setIsResetting(false));
  };

  const onSave = form.handleSubmit((values) => {
    if (!risk) return;
    const cleaned: Record<string, unknown> = { ...values };
    // #576: clearing assignee / due date must send an explicit null — a PATCH
    // that omits a key leaves the column unchanged, so omitting silently
    // ignored the user's clear action.
    cleaned.assignedToId = values.assignedToId ?? null;
    cleaned.dueDate = values.dueDate ? values.dueDate : null;
    if (!cleaned.description) delete cleaned.description;
    if (!cleaned.mitigationPlan) delete cleaned.mitigationPlan;
    updateMutation.mutate(
      { riskId: risk.id, data: UpdateRiskBody.parse(cleaned) },
      {
        onSuccess: () => { setEditMode(false); },
        onError: (error) => {
          const referenceError = getRiskReferenceError(error);
          if (referenceError?.field === "assignedToId") {
            form.setError("assignedToId", { message: t(referenceError.message) });
            return;
          }
          toast.error(error instanceof Error ? error.message : t("form.couldNotSave"));
        },
      },
    );
  });

  if (!risk) return null;

  const riskLevel = risk.riskLevel ?? "";
  const canUpdate = hasPerm(me?.permissions as string[], "risks.update");
  const historyEntries = history ?? [];
  const locationContext = formatLocation({ locationType: risk.locationType, stateName: risk.stateName, stateNameAr: risk.stateNameAr }, i18n.language);
  const projectContext = risk.projectTitle
    ? ` · ${risk.projectTitle}`
    : risk.projectId ? ` · ${t("projectRemoved", { defaultValue: "[Project removed]" })}` : "";
  const contextDescription = locationContext === "—"
    ? projectContext.replace(/^ · /, "")
    : `${locationContext}${projectContext}`;
  const errors = form.formState.errors;
  const impactValue = (risk as Risk & { impact?: string | null }).impact || risk.severity;

  return (
    <RecordDetailModal
      open={!!risk}
      onClose={() => { setEditMode(false); onClose(); }}
      restoreFocusRef={restoreFocusRef}
      title={risk.title}
      description={editMode ? t("editingRisk", { defaultValue: "Editing risk" }) : contextDescription}
      metadata={
        <>
          <RiskLevelChip level={riskLevel} />
          <StatusBadge status={risk.status} />
        </>
      }
    >
        <Tabs defaultSelectedKey="details" aria-label={t("detail.tabsAria", { defaultValue: "Risk sections" })} className="w-full min-w-0">
          <Tabs.ListContainer className="mb-4 w-full overflow-x-auto pb-1">
            <Tabs.List aria-label={t("detail.tabsAria", { defaultValue: "Risk sections" })}>
              <Tabs.Tab id="details"><Shield className="size-4 me-1" aria-hidden="true" />{t("detail.tabDetails")}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="comments"><MessageSquare className="size-4 me-1" aria-hidden="true" />{t("detail.tabComments")}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="history"><History className="size-4 me-1" aria-hidden="true" />{t("detail.tabHistory")}<Tabs.Indicator /></Tabs.Tab>
              <Tabs.Tab id="attachments"><FileText className="size-4 me-1" aria-hidden="true" />{t("detail.tabAttachments")}<Tabs.Indicator /></Tabs.Tab>
            </Tabs.List>
          </Tabs.ListContainer>

          <Tabs.Panel id="details" className="space-y-4">
            {!editMode ? (
              <>
                <dl className="grid gap-x-6 gap-y-4 text-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label={t("detail.category")}>
                    {risk.category ? t(`presentation.categories.${risk.category}`, { defaultValue: displayCategory(risk.category) }) : "—"}
                  </DetailItem>
                  <DetailItem label={t("detail.status")}><StatusBadge status={risk.status} /></DetailItem>
                  <DetailItem label={t("detail.probability")}>
                    {risk.likelihood ? t(`presentation.likelihoods.${risk.likelihood}`, { defaultValue: displayLikelihood(risk.likelihood) }) : "—"}
                  </DetailItem>
                  <DetailItem label={t("detail.impact")}>
                    {impactValue ? t(`presentation.impacts.${impactValue}`, { defaultValue: displayImpact(impactValue) }) : "—"}
                  </DetailItem>
                  <DetailItem label={t("detail.riskLevel")}><RiskLevelChip level={riskLevel} /></DetailItem>
                  <DetailItem label={t("detail.responsiblePerson")}>
                    <span className="flex min-w-0 items-center gap-1">
                      <User className="size-3 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                      <span className="break-words" dir="auto" title={risk.assignedToName ?? undefined}>{risk.assignedToName ?? t("unassigned")}</span>
                    </span>
                  </DetailItem>
                  <DetailItem label={t("detail.dateIdentified")}>
                    <span className="flex items-center gap-1">
                      <Calendar className="size-3 text-[var(--muted)]" aria-hidden="true" />
                      <bdi dir="ltr">{formatDate(risk.identifiedAt)}</bdi>
                    </span>
                  </DetailItem>
                  <DetailItem label={t("detail.dueDate")}>
                    <span className="flex items-center gap-1">
                      <Clock className="size-3 text-[var(--muted)]" aria-hidden="true" />
                      {risk.dueDate ? <bdi dir="ltr">{formatDate(risk.dueDate)}</bdi> : "—"}
                    </span>
                  </DetailItem>
                </dl>

                {risk.description && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-[var(--muted)]">{t("detail.description")}</p>
                    <p dir="auto" className="rounded-xl bg-[var(--default)] p-3 text-sm whitespace-pre-wrap break-words rtl:text-end">{risk.description}</p>
                  </div>
                )}

                {risk.mitigationPlan && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-[var(--muted)]">{t("detail.mitigationAction")}</p>
                    <p dir="auto" className="rounded-xl bg-[var(--default)] p-3 text-sm whitespace-pre-wrap break-words rtl:text-end">{risk.mitigationPlan}</p>
                  </div>
                )}

                {canUpdate && (
                  <Button variant="outline" onPress={onEdit} className="mt-2 w-full">{t("detail.editRisk")}</Button>
                )}
              </>
            ) : isResetting ? (
              /* Edit-mode skeleton — shown during the brief populate phase */
              <div className="space-y-5" aria-busy="true">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-36 rounded-md" />
                  <Skeleton className="h-10 rounded-xl" />
                  <Skeleton className="h-10 rounded-xl" />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Skeleton className="h-10 rounded-xl" />
                  <Skeleton className="h-10 rounded-xl" />
                </div>
                <Skeleton className="h-20 rounded-xl" />
              </div>
            ) : (
              <form onSubmit={onSave} className="space-y-5" noValidate>
                <FormSection title={t("sections.riskIdentification")}>
                  <div>
                    <Label htmlFor="edit-title" isRequired>{t("fields.title")}</Label>
                    <Input
                      id="edit-title"
                      fullWidth
                      dir="auto"
                      {...form.register("title")}
                      aria-invalid={!!errors.title}
                      aria-describedby={errors.title ? "edit-title-error" : undefined}
                    />
                    {errors.title && <FieldError id="edit-title-error">{t("validation.titleRequired")}</FieldError>}
                  </div>
                  <div className="max-w-2xl">
                    <Label htmlFor="edit-description">{t("fields.description")}</Label>
                    <TextArea
                      id="edit-description"
                      fullWidth
                      dir="auto"
                      rows={2}
                      className="resize-y"
                      {...form.register("description")}
                      aria-invalid={!!errors.description}
                    />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      id="edit-category"
                      label={t("fields.category")}
                      isRequired
                      isInvalid={!!errors.category}
                      value={form.watch("category") ?? ""}
                      onChange={(v) => form.setValue("category", v)}
                      className="w-full"
                      options={CATEGORIES.map((c) => ({ value: c, label: t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) }) }))}
                    />
                    <SelectField
                      id="edit-status"
                      label={t("fields.status")}
                      isRequired
                      isInvalid={!!errors.status}
                      value={form.watch("status") ?? ""}
                      onChange={(v) => form.setValue("status", v)}
                      className="w-full"
                      options={RISK_STATUS_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
                    />
                  </div>
                </FormSection>

                <FormSection title={t("sections.riskAssessment")}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <SelectField
                      id="edit-likelihood"
                      label={t("fields.probability")}
                      isRequired
                      isInvalid={!!errors.likelihood}
                      value={form.watch("likelihood") ?? ""}
                      onChange={(v) => form.setValue("likelihood", v)}
                      className="w-full"
                      options={PROBABILITIES.map((p) => ({ value: p, label: t(`presentation.likelihoods.${p}`, { defaultValue: displayLikelihood(p) }) }))}
                    />
                    <SelectField
                      id="edit-impact"
                      label={t("fields.impact")}
                      isRequired
                      isInvalid={!!errors.impact}
                      value={form.watch("impact") ?? ""}
                      // Kept in sync with severity on edit, exactly like the create form:
                      // impact is the authoritative level input, but any code path that still
                      // reads the legacy severity column directly (rather than through the
                      // impact ?? severity fallback computeRiskLevel/riskLevelSQL both use)
                      // must not see it silently go stale after the risk's first edit.
                      onChange={(v) => { form.setValue("impact", v); form.setValue("severity", v); }}
                      className="w-full"
                      options={IMPACTS.map((i) => ({ value: i, label: t(`presentation.impacts.${i}`, { defaultValue: displayImpact(i) }) }))}
                    />
                  </div>
                </FormSection>

                <FormSection title={t("sections.ownershipFollowUp")}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <SelectField
                        id="edit-assigned"
                        label={t("fields.responsiblePerson")}
                        isInvalid={!!errors.assignedToId}
                        aria-describedby={errors.assignedToId ? "edit-assigned-error" : undefined}
                        value={form.watch("assignedToId") ? String(form.watch("assignedToId")) : "__none__"}
                        onChange={(v) => {
                          form.setValue("assignedToId", v === "__none__" ? null : Number(v));
                          form.clearErrors("assignedToId");
                        }}
                        className="w-full"
                        options={[
                          { value: "__none__", label: t("unassigned") },
                          ...(users ?? []).map((u) => ({ value: String(u.id), label: u.name })),
                        ]}
                      />
                      {errors.assignedToId && <FieldError id="edit-assigned-error">{errors.assignedToId.message}</FieldError>}
                    </div>
                    <DateInput
                      id="edit-due-date"
                      label={t("fields.dueDate")}
                      className="max-w-xs"
                      value={form.watch("dueDate") ?? ""}
                      onChange={(v) => form.setValue("dueDate", v)}
                      isInvalid={!!errors.dueDate}
                    />
                  </div>
                  <div className="max-w-2xl">
                    <Label htmlFor="edit-mitigation">{t("fields.mitigationAction")}</Label>
                    <TextArea
                      id="edit-mitigation"
                      fullWidth
                      dir="auto"
                      rows={3}
                      className="resize-y"
                      {...form.register("mitigationPlan")}
                      aria-invalid={!!errors.mitigationPlan}
                    />
                  </div>
                </FormSection>

                <div className="flex gap-2 pt-1">
                  <Button variant="outline" onPress={() => setEditMode(false)}>{t("form.cancel")}</Button>
                  <Button type="submit" isPending={updateMutation.isPending} isDisabled={updateMutation.isPending} className="flex-1">
                    {updateMutation.isPending ? t("saving") : t("saveChanges")}
                  </Button>
                </div>
              </form>
            )}
          </Tabs.Panel>

          <Tabs.Panel id="comments">
            {me?.user && (
              <CommentsPanel
                entityType="risk"
                entityId={risk.id}
                currentUserId={me.user.id}
                currentUserRole={me.user.role}
              />
            )}
          </Tabs.Panel>

          <Tabs.Panel id="attachments" className="pt-2">
            <DriveAttachmentPanel
              module="risks"
              recordId={risk.id}
              canUpload={canUpdate}
              canDelete={me?.user?.role === "super_admin" || me?.user?.role === "program_manager"}
            />
          </Tabs.Panel>

          <Tabs.Panel id="history" className="space-y-2">
            {historyLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
            ) : historyIsError ? (
              <div className="rounded-xl border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] p-3 text-sm">
                <p>{t("history.loadError", { defaultValue: "Could not load history." })}</p>
                <Button variant="outline" size="sm" className="mt-2" onPress={() => refetchHistory()}>
                  {t("history.retry", { defaultValue: "Try again" })}
                </Button>
              </div>
            ) : historyEntries.length === 0 ? (
              <p className="py-8 text-center text-sm text-[var(--muted)]">{t("history.noHistory")}</p>
            ) : (
              <ol className="space-y-0">
                {historyEntries.map((h) => {
                  const actionLabel = (() => {
                    const a = h.action?.toLowerCase();
                    if (a === "create" || a === "created") return t("history.created");
                    if (a === "status_changed" || a === "status_change") {
                      const nv = h.newValue ? displayStatus(String(h.newValue), t) : "";
                      return nv ? t("history.statusChangedTo", { status: nv }) : t("history.statusChanged");
                    }
                    if (a === "closed") return t("history.closed");
                    if (a === "update" || a === "updated") return t("history.updated");
                    if (a === "mitigation_updated") return t("history.mitigationUpdated");
                    if (a === "assigned") return t("history.assigned");
                    if (a === "due_date_set") return t("history.dueDateSet");
                    return String(h.action ?? "").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
                  })();
                  const detail = (() => {
                    if (!h.newValue) return null;
                    const a = h.action?.toLowerCase();
                    if (a === "status_changed" || a === "status_change") return null;
                    const value = String(h.newValue);
                    if (value.startsWith("{") || value.startsWith("[")) return null;
                    return value.length > 140 ? `${value.slice(0, 140)}…` : value;
                  })();
                  const dotColor = HISTORY_DOT[h.action]
                    ?? (h.action === "status_changed" && h.newValue === "under_mitigation" ? "bg-[var(--accent)]" : "bg-[var(--warning)]");
                  return (
                    <li key={h.id} className="flex gap-3 text-sm">
                      <div className="flex flex-col items-center" aria-hidden="true">
                        <div className={`mt-1.5 size-2.5 shrink-0 rounded-full ${dotColor}`} />
                        <div className="mt-1 w-px flex-1 bg-[var(--border)]" />
                      </div>
                      <div className="min-w-0 flex-1 pb-3">
                        <p className="font-medium break-words">{actionLabel}</p>
                        {detail && <p dir="auto" className="mt-0.5 text-xs text-[var(--muted)] break-words rtl:text-end">{detail}</p>}
                        <div className="mt-1 text-xs text-[var(--muted)]">
                          <span dir="auto">{h.userName ?? t("history.system")}</span> · <bdi dir="ltr">{formatDateTime(h.createdAt)}</bdi>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Tabs.Panel>
        </Tabs>
    </RecordDetailModal>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function RisksPage() {
  const { t, i18n } = useTranslation("risks");
  const { t: commonT } = useTranslation("common");
  // Wouter's useLocation returns pathname only; useSearch provides the reactive query string.
  const [pathname, navigate] = useLocation();
  const rawSearch = useSearch();
  // Combine into a full location string that parseRiskRegisterState can parse.
  const location = rawSearch ? `${pathname}?${rawSearch}` : pathname;
  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const { isOnline } = useSyncContext();
  const isStateRole = me?.user?.role === "state_program_officer" || me?.user?.role === "state_office_manager";
  const meUser = me?.user as unknown as Record<string, unknown> | undefined;
  const meStateId = typeof meUser?.stateId === "number" ? (meUser.stateId as number) : null;
  const perms = me?.permissions as string[] | undefined;

  // Global location context: on mount, inherit from the header selector if no stateId URL param
  const { selectedStateId: ctxStateId } = useLocationContext();
  useEffect(() => {
    if (ctxStateId == null) return;
    const params = new URLSearchParams(window.location.search);
    if (!params.has("stateId") || params.get("stateId") === "all") {
      navigate(buildRiskRegisterLocation(
        window.location.pathname + window.location.search,
        { stateId: String(ctxStateId), page: 1 },
      ));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Run only on mount to inherit global context

  // The URL is the canonical source for filter and paging state. This makes
  // links, refreshes, and browser history reproduce the same scoped register.
  const registerState = useMemo(() => parseRiskRegisterState(location), [location]);
  const {
    search, status, riskLevel: riskLevelFilter, category: categoryFilter,
    projectId, stateId, assignedToId: assignedToFilter, page, activeOnly, view,
  } = registerState;
  const updateRegisterState = useCallback((patch: RiskRegisterPatch, replace = false) => {
    const nextLocation = buildRiskRegisterLocation(location, patch);
    if (nextLocation !== location) navigate(nextLocation, { replace });
  }, [location, navigate]);
  const [createOpen, setCreateOpen] = useState(false);
  // Location type for the risk creation form ("state" or "hq")
  const [riskLocationType, setRiskLocationType] = useState<"state" | "hq">("state");
  const [selected, setSelected] = useState<Risk | null>(null);
  const detailTriggerRef = useRef<HTMLElement | null>(null);

  const openRiskDetail = useCallback((risk: Risk, trigger?: HTMLElement | null) => {
    detailTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelected(risk);
  }, []);

  const query: ListRisksParams = {};
  if (status !== "all") query.status = status;
  if (projectId !== "all") query.projectId = Number(projectId);
  if (stateId !== "all") query.stateId = Number(stateId);
  if (categoryFilter !== "all") query.category = categoryFilter;
  if (riskLevelFilter !== "all") query.riskLevel = riskLevelFilter;
  if (assignedToFilter !== "all") query.assignedToId = Number(assignedToFilter);
  if (search.trim()) query.search = search.trim();
  if (activeOnly && status === "all") (query as Record<string, unknown>).activeOnly = "1";

  // Server-side pagination (cast as Record to add params not yet reflected in generated type)
  (query as Record<string, unknown>).page = page;
  (query as Record<string, unknown>).limit = DEFAULT_LIMIT;
  const { data: risksRaw, isLoading, isError, refetch } = useListRisks(query);
  const risks = useMemo(() => risksRaw?.items, [risksRaw]);

  // Empty-page recovery: reset to page 1 when data refresh causes page > totalPages.
  // Handles totalPages=0 (empty result) as well — 1 > 0 triggers but setPage(1) is
  // a no-op when page is already 1, so there is no render loop.
  useEffect(() => {
    const tp = risksRaw?.totalPages;
    if (tp !== undefined && page > tp) {
      updateRegisterState({ page: 1 }, true);
    }
  }, [risksRaw?.totalPages, page, location, updateRegisterState]);
  const { data: projects } = useListProjects();
  const { data: states } = useListStates();
  const canManageRisk = perms?.includes("risks.create") || perms?.includes("risks.update");
  const { data: assigneeData } = useQuery<ActiveAssignee[]>({
    queryKey: ["risk-active-assignees"],
    queryFn: fetchActiveRiskAssignees,
    enabled: !!canManageRisk,
  });
  const users = useMemo(
    () => {
      const activeAssignees = Array.isArray(assigneeData) ? assigneeData : [];
      const currentUser = me?.user;
      return currentUser && !activeAssignees.some((user) => user.id === currentUser.id)
        ? [currentUser, ...activeAssignees]
        : activeAssignees;
    },
    [assigneeData, me?.user],
  );

  // Summary counts — read from server envelope so values reflect the full scoped
  // register across all pages, not just the current page's items.
  const counts = useMemo(() => {
    const s = risksRaw?.summary;
    return {
      critical: s?.critical ?? 0,
      high:     s?.high     ?? 0,
      medium:   s?.medium   ?? 0,
      low:      s?.low      ?? 0,
      open:     s?.open     ?? 0,
    };
  }, [risksRaw]);

  const createMutation = useCreateRisk({
    mutation: {
      onSuccess: () => {
        toast.success(t("registerSuccess"));
        qc.invalidateQueries();
        setCreateOpen(false);
        createForm.reset();
        setRiskLocationType("state");
        void riskDraft.clear();
      },
      onError: (error) => {
        const referenceError = getRiskReferenceError(error);
        if (referenceError) {
          createForm.setError(referenceError.field, { message: t(referenceError.message) });
          return;
        }
        toast.error(error instanceof Error ? error.message : t("form.couldNotRegister"));
      },
    },
  });

  const updateMutation = useUpdateRisk({
    mutation: {
      onSuccess: (updated) => {
        toast.success(t("updateSuccess"));
        qc.invalidateQueries();
        setSelected((prev) => prev && prev.id === (updated as Risk).id ? (updated as Risk) : prev);
      },
    },
  });

  const createForm = useForm<{
    title: string; description?: string; category: string;
    severity: string; likelihood: string; impact?: string;
    stateId: number; projectId?: number; assignedToId?: number;
    mitigationPlan?: string; dueDate?: string;
  }>({
    resolver: zodResolver(CreateRiskBody),
    defaultValues: {
      title: "", description: "", category: "operational",
      severity: "medium", likelihood: "medium", impact: "medium",
      stateId: 0, mitigationPlan: "",
    },
  });
  const watchedCreateRisk = useWatch({ control: createForm.control });
  const riskDraft = useDurableFormDraft({
    enabled: createOpen && Array.isArray(states) && Array.isArray(projects),
    userId: me?.user?.id,
    module: "risks",
    recordKey: "new",
    label: "Risk draft",
    value: { ...watchedCreateRisk, locationType: riskLocationType },
    scope: {
      stateIds: isStateRole && meStateId ? [meStateId] : (states ?? []).map((state) => state.id),
      projectIds: (projects ?? []).map((project) => project.id),
    },
    onRecover: (draft) => {
      const validStates = new Set(
        isStateRole && meStateId ? [meStateId] : (states ?? []).map((state) => state.id),
      );
      const validProjects = new Set((projects ?? []).map((project) => project.id));
      const { locationType, ...recovered } = draft;
      if (recovered.stateId && !validStates.has(recovered.stateId)) recovered.stateId = 0;
      if (recovered.projectId && !validProjects.has(recovered.projectId)) delete recovered.projectId;
      setRiskLocationType(locationType === "hq" ? "hq" : "state");
      createForm.reset(recovered);
    },
  });

  const onCreate = createForm.handleSubmit(async (values) => {
    // For state risks, validate that stateId is set (Zod now accepts optional)
    if (riskLocationType !== "hq" && (!values.stateId || values.stateId === 0)) {
      createForm.setError("stateId", { message: t("validation.stateRequired") });
      return;
    }
    const cleaned: Record<string, unknown> = { ...values };
    cleaned.locationType = riskLocationType;
    if (riskLocationType === "hq") {
      delete cleaned.stateId; // HQ risks have no stateId
    }
    if (!cleaned.projectId) delete cleaned.projectId;
    if (!cleaned.assignedToId) delete cleaned.assignedToId;
    if (!cleaned.description) delete cleaned.description;
    if (!cleaned.mitigationPlan) delete cleaned.mitigationPlan;
    if (!cleaned.dueDate) delete cleaned.dueDate;
    if (!isOnline) {
      if (riskDraft.status === "pending") {
        toast.info(commonT("sync.draftAlreadyQueued"));
        setCreateOpen(false);
        return;
      }
      const saved = await riskDraft.saveNow({ ...values, locationType: riskLocationType });
      // Risk captures are operational-only. Queue the same scoped payload with
      // a stable local identity so dependent work can resolve it exactly once.
      if (saved && riskDraft.draftKey) {
        try {
          await fetch("/api/risks", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              ...cleaned,
              _localId: saved.localEntityId,
              _draftKey: riskDraft.draftKey,
            }),
          });
        } catch (err) {
          if (!isOfflineQueuedError(err)) throw err;
        }
      }
      toast.info(commonT("sync.riskDraftQueued"));
      setCreateOpen(false);
      return;
    }
    createMutation.mutate({ data: CreateRiskBody.parse(cleaned) });
  });

  const canCreate = hasPerm(perms, "risks.create");
  const activeFilters = [status !== "all", riskLevelFilter !== "all", categoryFilter !== "all",
    projectId !== "all", stateId !== "all", assignedToFilter !== "all", search !== ""].filter(Boolean).length;
  const riskKanbanColumns = useMemo<KanbanColumn[]>(
    () => RISK_STATUS_OPTIONS.map((option) => ({
      key: option.value,
      label: t(option.labelKey),
    })),
    [t],
  );
  const riskViewRecords = useMemo<ViewRecord[]>(
    () => (risks ?? []).map((risk) => {
      const level = risk.riskLevel ?? "";
      const impact = (risk as Risk & { impact?: string | null }).impact || risk.severity;
      const project = risk.projectTitle
        || (risk.projectId ? t("projectRemoved", { defaultValue: "[Project removed]" }) : "—");
      const category = risk.category
        ? t(`presentation.categories.${risk.category}`, { defaultValue: displayCategory(risk.category) })
        : "—";
      const likelihood = risk.likelihood
        ? t(`presentation.likelihoods.${risk.likelihood}`, { defaultValue: displayLikelihood(risk.likelihood) })
        : "—";
      const impactLabel = impact
        ? t(`presentation.impacts.${impact}`, { defaultValue: displayImpact(impact) })
        : "—";
      // The date is wrapped in Unicode isolates (LRI … PDI) so "15 Oct 2026"
      // keeps its order inside an Arabic label instead of being reshuffled.
      const isolate = (text: string) => `\u2066${text}\u2069`;
      const dateContext = risk.dueDate
        ? `${t("presentation.dueDate")}: ${isolate(formatDate(risk.dueDate))}`
        : `${t("presentation.identified")}: ${isolate(formatDate(risk.identifiedAt))}`;
      return {
        id: risk.id,
        title: risk.title,
        status: risk.status ?? "",
        ariaLabel: t("accessibility.openRisk", { title: risk.title, defaultValue: "Open risk: {{title}}" }),
        statusBadge: (
          <div className="flex max-w-[11rem] flex-wrap justify-end gap-1">
            <RiskLevelChip level={level} />
            <StatusBadge status={risk.status} />
          </div>
        ),
        tag: category,
        meta: [
          { label: t("presentation.project"), value: project },
          { label: t("presentation.owner"), value: risk.assignedToName || t("presentation.unassigned") },
          {
            label: t("presentation.assessment"),
            value: `${likelihood} / ${impactLabel}`,
          },
          { label: t("presentation.mitigation"), value: risk.mitigationPlan || "—" },
        ],
        stateNames: risk.stateName ? [risk.stateName] : [],
        stateNamesAr: risk.stateNameAr ? [risk.stateNameAr] : [],
        date: dateContext,
        onClick: (trigger) => openRiskDetail(risk, trigger),
      };
    }),
    [risks, t, openRiskDetail],
  );
  const boardHasUnsupportedStatuses = useMemo(
    () => (risks ?? []).some((risk) => !RISK_STATUS_VALUES.includes(risk.status as typeof RISK_STATUS_VALUES[number])),
    [risks],
  );

  function clearFilters() {
    updateRegisterState({
      search: "", status: "all", riskLevel: "all", category: "all",
      projectId: "all", stateId: "all", assignedToId: "all", page: 1,
    });
  }
  const emptyPresentation = (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-[var(--muted)]">
      <Shield className="size-8 opacity-30" aria-hidden="true" />
      {activeFilters > 0 ? (
        <>
          <p className="text-sm font-medium">{t("noRisksFiltered")}</p>
          <Button variant="ghost" size="sm" onPress={clearFilters}>{t("filters.clearFilters")}</Button>
        </>
      ) : (
        <p className="text-sm font-medium">{t("noRisks")}</p>
      )}
    </div>
  );

  const gridRef = useRef<HTMLDivElement | null>(null);
  /** Opens a table row's risk, passing the row element so focus returns to it. */
  const openRiskRow = useCallback((key: React.Key) => {
    const r = (risks ?? []).find((item) => String(item.id) === String(key));
    if (!r) return;
    const row = gridRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(String(key))}"]`) ?? null;
    openRiskDetail(r, row);
  }, [risks, openRiskDetail]);

  const columns = useMemo<DataGridColumn<Risk>[]>(() => [
    { id: "title", header: t("table.riskTitle"), isRowHeader: true, width: 240, pinned: "start", headerClassName: "w-[240px]",
      cell: (r) => (
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex min-w-0 items-start gap-1.5">
            <span dir="auto" className="line-clamp-2 whitespace-normal break-words font-medium leading-snug rtl:text-end" title={r.title}>{r.title}</span>
            <AttachmentCountBadge module="risks" recordId={r.id} />
          </div>
          {r.description && <span dir="auto" className="line-clamp-1 whitespace-normal text-xs text-[var(--muted)] rtl:text-end">{r.description}</span>}
        </div>
      ) },
    { id: "level", header: t("table.riskLevel"), width: 96, headerClassName: "w-[96px]",
      cell: (r) => <RiskLevelChip level={r.riskLevel ?? ""} /> },
    { id: "status", header: t("table.status"), width: 116, headerClassName: "w-[116px]",
      cell: (r) => <StatusBadge status={r.status} /> },
    { id: "dueDate", header: t("table.dueDate"), width: 112, headerClassName: "w-[112px]",
      cell: (r) => {
        const isDue = r.dueDate && new Date(r.dueDate) < new Date() && r.status !== "closed";
        if (!r.dueDate) return <span className="text-[var(--muted)]">—</span>;
        return (
          <span className={`flex items-center gap-1 whitespace-nowrap text-sm ${isDue ? "font-medium text-[var(--danger)]" : "text-[var(--muted)]"}`}>
            {isDue && <Clock className="size-3" aria-label={t("table.overdue", { defaultValue: "Overdue" })} />}
            <bdi dir="ltr">{formatDate(r.dueDate)}</bdi>
          </span>
        );
      } },
    { id: "assessment", header: `${t("table.probability")} / ${t("table.impact")}`, width: 120, headerClassName: "w-[120px]",
      cell: (r) => {
        const impact = (r as Risk & { impact?: string | null }).impact || r.severity;
        return (
          <span className="text-sm">
            {r.likelihood ? t(`presentation.likelihoods.${r.likelihood}`, { defaultValue: displayLikelihood(r.likelihood) }) : "—"}
            <span className="text-[var(--muted)]"> / </span>
            {impact ? t(`presentation.impacts.${impact}`, { defaultValue: displayImpact(impact) }) : "—"}
          </span>
        );
      } },
    { id: "category", header: t("table.category"), width: 96, headerClassName: "w-[96px]",
      cell: (r) => <span className="text-sm">{r.category ? t(`presentation.categories.${r.category}`, { defaultValue: displayCategory(r.category) }) : "—"}</span> },
    { id: "state", header: t("table.state"), width: 100, headerClassName: "w-[100px]",
      cell: (r) => <span className="text-sm">{formatLocation({ locationType: r.locationType, stateName: r.stateName, stateNameAr: r.stateNameAr }, i18n.language)}</span> },
    { id: "project", header: t("table.project"), width: 136, headerClassName: "w-[136px]",
      cell: (r) => (
        <span dir="auto" title={r.projectTitle ?? undefined} className="line-clamp-2 whitespace-normal break-words text-sm text-[var(--muted)] rtl:text-end">
          {r.projectTitle || (r.projectId ? t("projectRemoved", { defaultValue: "[Project removed]" }) : "—")}
        </span>
      ) },
    { id: "responsible", header: t("table.responsible"), width: 120, headerClassName: "w-[120px]",
      cell: (r) => <span dir="auto" className="line-clamp-2 whitespace-normal text-sm text-[var(--muted)] rtl:text-end">{r.assignedToName || "—"}</span> },
  ], [t, i18n.language]);

  const totalPages = (risksRaw as { totalPages?: number } | undefined)?.totalPages ?? 1;
  const total = (risksRaw as { total?: number } | undefined)?.total ?? 0;
  const pagination = (() => {
    if (totalPages <= 1) return null;
    return (
      <RegistryPagination
        className="px-4 py-3"
        page={page}
        totalPages={totalPages}
        onPageChange={(next) => updateRegisterState({ page: Math.min(totalPages, Math.max(1, next)) })}
        summary={t("pagination.pageOf", { page, totalPages, total, defaultValue: "Page {{page}} of {{totalPages}} ({{total}} risks)" })}
        labels={{
          region: t("pagination.region", { defaultValue: "Pagination" }),
          first: t("pagination.first", { defaultValue: "First page" }),
          previous: t("pagination.previous", { defaultValue: "Previous page" }),
          next: t("pagination.next", { defaultValue: "Next page" }),
          last: t("pagination.last", { defaultValue: "Last page" }),
          pageOf: `${page} / ${totalPages}`,
        }}
      />
    );
  })();

  const closeCreate = () => {
    setCreateOpen(false);
    createForm.reset();
    setRiskLocationType("state");
  };
  const openCreate = () => {
    setCreateOpen(true);
    // Auto-fill state for state-scoped users (SPO/SOM cannot select HQ)
    if (isStateRole && meStateId) { createForm.setValue("stateId", meStateId); }
  };
  const createErrors = createForm.formState.errors;
  const countLabel = t(total === 1 ? "page.risksCount" : "page.risksCountPlural", { count: total });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <AlertTriangle className="size-5 text-[var(--warning)]" aria-hidden="true" />
            {t("title")}
          </h1>
          <p className="mt-0.5 text-sm text-[var(--muted)]">{t("page.description")}</p>
        </div>
        {canCreate && (
          <Button className="shrink-0" onPress={openCreate}><Plus className="size-4" aria-hidden="true" />{t("newRisk")}</Button>
        )}
      </div>

      {canCreate && (
        <Modal isOpen={createOpen} onOpenChange={(open) => { if (!open) closeCreate(); }}>
          <Modal.Backdrop>
            <Modal.Container size="lg" scroll="inside">
              <Modal.Dialog className="sm:max-w-2xl max-w-2xl max-h-[90vh] overflow-y-auto">
                <Modal.CloseTrigger />
                <Modal.Header>
                  <Modal.Heading>{t("page.registerNewRisk")}</Modal.Heading>
                  <p className="text-sm text-[var(--muted)]">{t("page.registerNewRiskDesc")}</p>
                </Modal.Header>
                <form onSubmit={onCreate} className="contents" noValidate>
                  <Modal.Body className="space-y-5">
                    <OfflineDraftNotice status={riskDraft.status} error={riskDraft.error} />

                    <FormSection title={t("sections.riskIdentification")}>
                      <div>
                        <Label htmlFor="create-title" isRequired>{t("fields.title")}</Label>
                        <Input
                          id="create-title"
                          fullWidth
                          dir="auto"
                          {...createForm.register("title")}
                          placeholder={t("fields.titlePh")}
                          aria-invalid={!!createErrors.title}
                          aria-required="true"
                          aria-describedby={createErrors.title ? "create-title-error" : undefined}
                        />
                        {createErrors.title && <FieldError id="create-title-error">{t("validation.titleRequired")}</FieldError>}
                      </div>
                      <div className="max-w-2xl">
                        <Label htmlFor="create-description">{t("fields.description")}</Label>
                        <TextArea
                          id="create-description"
                          fullWidth
                          dir="auto"
                          rows={2}
                          className="resize-y"
                          {...createForm.register("description")}
                          placeholder={t("fields.descriptionPh")}
                          aria-invalid={!!createErrors.description}
                        />
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                          id="create-category"
                          label={t("fields.category")}
                          isRequired
                          isInvalid={!!createErrors.category}
                          value={createForm.watch("category") ?? ""}
                          onChange={(v) => createForm.setValue("category", v)}
                          className="w-full"
                          options={CATEGORIES.map((c) => ({ value: c, label: t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) }) }))}
                        />
                        <div className="flex flex-col gap-1">
                          <Label htmlFor="create-location" isRequired>{t("form.stateLocation")}</Label>
                          <LocationSelector
                            value={{ locationType: riskLocationType, stateId: createForm.watch("stateId") || null }}
                            onChange={({ locationType, stateId: sid }) => {
                              setRiskLocationType(locationType ?? "state");
                              createForm.setValue("stateId", sid ?? 0);
                              if (locationType === "hq") createForm.clearErrors("stateId");
                            }}
                            states={states ?? []}
                            isStateLocked={isStateRole}
                            lockedStateId={meStateId}
                            lockedStateName={(() => { const s = states?.find((st) => st.id === meStateId); return s ? getStateLabel(s, i18n.language) : undefined; })()}
                            placeholder={t("form.stateLocationPh")}
                            invalid={!!createErrors.stateId && riskLocationType !== "hq"}
                            id="create-location"
                            aria-required
                            aria-describedby={createErrors.stateId ? "create-state-error" : undefined}
                          />
                          {createErrors.stateId && riskLocationType !== "hq" && (
                            <FieldError id="create-state-error">{t("validation.stateRequired")}</FieldError>
                          )}
                        </div>
                      </div>
                    </FormSection>

                    <FormSection title={t("sections.riskAssessment")}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <SelectField
                          id="create-likelihood"
                          label={t("fields.probability")}
                          isRequired
                          isInvalid={!!createErrors.likelihood}
                          value={createForm.watch("likelihood") ?? ""}
                          onChange={(v) => createForm.setValue("likelihood", v)}
                          className="w-full"
                          options={PROBABILITIES.map((p) => ({ value: p, label: t(`presentation.likelihoods.${p}`, { defaultValue: displayLikelihood(p) }) }))}
                        />
                        <SelectField
                          id="create-impact"
                          label={t("fields.impact")}
                          isRequired
                          isInvalid={!!createErrors.impact}
                          value={createForm.watch("impact") ?? "medium"}
                          onChange={(v) => { createForm.setValue("impact", v); createForm.setValue("severity", v); }}
                          className="w-full"
                          options={IMPACTS.map((i) => ({ value: i, label: t(`presentation.impacts.${i}`, { defaultValue: displayImpact(i) }) }))}
                        />
                      </div>
                    </FormSection>

                    <FormSection title={t("sections.ownershipFollowUp")}>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div>
                          <SelectField
                            id="create-project"
                            label={t("fields.linkedProject")}
                            isInvalid={!!createErrors.projectId}
                            aria-describedby={createErrors.projectId ? "create-project-error" : undefined}
                            value={createForm.watch("projectId") ? String(createForm.watch("projectId")) : "__none__"}
                            onChange={(v) => {
                              createForm.setValue("projectId", v === "__none__" ? undefined : Number(v));
                              createForm.clearErrors("projectId");
                            }}
                            className="w-full"
                            options={[
                              { value: "__none__", label: t("form.none") },
                              ...(projects ?? []).map((p) => ({
                                value: String(p.id),
                                label: <span className="flex min-w-0 flex-col"><bdi dir="ltr" className="font-mono text-xs text-[var(--muted)]">{p.code}</bdi><span dir="auto" className="truncate">{p.title}</span></span>,
                                textValue: `${p.code} ${p.title}`,
                              })),
                            ]}
                          />
                          {createErrors.projectId && <FieldError id="create-project-error">{createErrors.projectId.message}</FieldError>}
                        </div>
                        <div>
                          <SelectField
                            id="create-assigned"
                            label={t("fields.responsiblePerson")}
                            isInvalid={!!createErrors.assignedToId}
                            aria-describedby={createErrors.assignedToId ? "create-assigned-error" : undefined}
                            value={createForm.watch("assignedToId") ? String(createForm.watch("assignedToId")) : "__none__"}
                            onChange={(v) => {
                              createForm.setValue("assignedToId", v === "__none__" ? undefined : Number(v));
                              createForm.clearErrors("assignedToId");
                            }}
                            className="w-full"
                            options={[
                              { value: "__none__", label: t("unassigned") },
                              ...(users ?? []).map((u) => ({ value: String(u.id), label: u.name })),
                            ]}
                          />
                          {createErrors.assignedToId && <FieldError id="create-assigned-error">{createErrors.assignedToId.message}</FieldError>}
                        </div>
                      </div>
                      <DateInput
                        id="create-due-date"
                        label={t("fields.dueDate")}
                        className="max-w-xs"
                        value={createForm.watch("dueDate") ?? ""}
                        onChange={(v) => createForm.setValue("dueDate", v)}
                        isInvalid={!!createErrors.dueDate}
                      />
                      <div className="max-w-2xl">
                        <Label htmlFor="create-mitigation">{t("fields.mitigationAction")}</Label>
                        <TextArea
                          id="create-mitigation"
                          fullWidth
                          dir="auto"
                          rows={3}
                          className="resize-y"
                          {...createForm.register("mitigationPlan")}
                          placeholder={t("fields.mitigationPh")}
                          aria-invalid={!!createErrors.mitigationPlan}
                        />
                      </div>
                    </FormSection>
                  </Modal.Body>
                  <Modal.Footer>
                    <Button variant="outline" onPress={closeCreate}>{t("form.cancel")}</Button>
                    <Button type="submit" isPending={createMutation.isPending} isDisabled={createMutation.isPending}>
                      {createMutation.isPending ? t("registering") : t("registerRisk")}
                    </Button>
                  </Modal.Footer>
                </form>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}

      {/* ── Initial load: full-page skeleton replaces KPI + filters + table ─── */}
      {isLoading && !risksRaw ? (
        <>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4" data-testid="skeleton-kpi">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-[128px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-12 w-full rounded-2xl" data-testid="skeleton-toolbar" />
          <Card className="p-0">
            <RiskPresentationSkeleton view={view} />
          </Card>
        </>
      ) : (
        <>
      {/* Summary — server envelope totals for the whole scoped register (risksRaw?.summary) */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
        <FilterKpi
          icon={AlertTriangle}
          status="danger"
          label={t("stats.critical")}
          value={<span className="text-[var(--danger)]">{counts.critical}</span>}
          sub={t("stats.criticalSub")}
          pressed={riskLevelFilter === "critical"}
          onToggle={() => updateRegisterState({ riskLevel: riskLevelFilter === "critical" ? "all" : "critical", page: 1 })}
        />
        <FilterKpi
          icon={AlertTriangle}
          status="danger"
          label={t("stats.high")}
          value={counts.high}
          sub={t("stats.highSub")}
          pressed={riskLevelFilter === "high"}
          onToggle={() => updateRegisterState({ riskLevel: riskLevelFilter === "high" ? "all" : "high", page: 1 })}
        />
        <FilterKpi
          icon={AlertCircle}
          status="warning"
          label={t("stats.medium")}
          value={counts.medium}
          sub={t("stats.mediumSub")}
          pressed={riskLevelFilter === "medium"}
          onToggle={() => updateRegisterState({ riskLevel: riskLevelFilter === "medium" ? "all" : "medium", page: 1 })}
        />
        <FilterKpi
          icon={CheckCircle2}
          status="success"
          label={t("stats.low")}
          value={counts.low}
          sub={t("stats.lowSub")}
          pressed={riskLevelFilter === "low"}
          onToggle={() => updateRegisterState({ riskLevel: riskLevelFilter === "low" ? "all" : "low", page: 1 })}
        />
      </div>

      {/* Registry toolbar: filters at the logical start, presentation at the end (as on Projects/Plans). */}
      <Card className="flex-row flex-wrap items-center gap-2 px-3 py-2.5" role="group" aria-label={t("accessibility.toolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 max-md:basis-full">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-[var(--muted)] select-none">
            <Filter className="size-4" aria-hidden="true" />
            {t("filters.toolbar")}
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <SearchField
            aria-label={t("filters.searchRisks")}
            value={search}
            onChange={(value) => updateRegisterState({ search: value, page: 1 })}
            className="w-full min-w-[12rem] flex-1 sm:max-w-[18rem]"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder={t("filters.searchPlaceholder")} />
              <SearchField.ClearButton aria-label={t("filters.clearFilters")} />
            </SearchField.Group>
          </SearchField>
          <SelectField
            aria-label={t("filters.riskLevel")}
            value={riskLevelFilter}
            onChange={(v) => updateRegisterState({ riskLevel: v, page: 1 })}
            triggerClassName="min-w-[8rem]"
            options={[
              { value: "all", label: t("filters.allLevels") },
              ...RISK_LEVELS.slice().reverse().map((l) => ({ value: l, label: t(`levels.${l}`) })),
            ]}
          />
          <SelectField
            aria-label={t("filters.status")}
            value={status}
            onChange={(v) => updateRegisterState({ status: v, page: 1 })}
            triggerClassName="min-w-[8rem]"
            options={[
              { value: "all", label: t("filters.allStatuses") },
              ...FILTER_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })),
            ]}
          />
          <SelectField
            aria-label={t("filters.category")}
            value={categoryFilter}
            onChange={(v) => updateRegisterState({ category: v, page: 1 })}
            triggerClassName="min-w-[8rem]"
            options={[
              { value: "all", label: t("filters.allCategories") },
              ...CATEGORIES.map((c) => ({ value: c, label: t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) }) })),
            ]}
          />
          <SelectField
            aria-label={t("filters.project")}
            value={projectId}
            onChange={(v) => updateRegisterState({ projectId: v, page: 1 })}
            triggerClassName="min-w-[9rem]"
            options={[
              { value: "all", label: t("filters.allProjects") },
              ...(projects ?? []).map((p) => ({ value: String(p.id), label: <bdi dir="ltr">{p.code}</bdi>, textValue: `${p.code} ${p.title}` })),
            ]}
          />
          <SelectField
            aria-label={t("filters.state")}
            value={stateId}
            onChange={(v) => updateRegisterState({ stateId: v, page: 1 })}
            triggerClassName="min-w-[8rem]"
            options={[
              { value: "all", label: t("filters.allStates") },
              ...(states ?? []).map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: getStateLabel(s, i18n.language) })),
            ]}
          />
          <SelectField
            aria-label={t("filters.responsible")}
            value={assignedToFilter}
            onChange={(v) => updateRegisterState({ assignedToId: v, page: 1 })}
            triggerClassName="min-w-[9rem]"
            options={[
              { value: "all", label: t("filters.allPersons") },
              ...(users ?? []).map((u) => ({ value: String(u.id), label: u.name })),
            ]}
          />
          {activeFilters > 0 && (
            <Button variant="ghost" size="sm" onPress={clearFilters} className="text-[var(--muted)]">
              <X className="size-4" aria-hidden="true" /> {t("filters.clearCount", { count: activeFilters })}
            </Button>
          )}
        </div>
        <Separator orientation="vertical" className="hidden h-6 shrink-0 md:block" />
        <ViewModeSwitcher
          available={[...RISK_REGISTER_VIEWS]}
          current={view}
          onChange={(mode) => {
            if (isOneOf(mode, RISK_REGISTER_VIEWS)) updateRegisterState({ view: mode });
          }}
        />
      </Card>

      {/* Register */}
      <Card className="gap-0 overflow-hidden p-0">
        <Card.Header className="flex-row items-center gap-2 border-b border-[var(--border)] px-5 py-3">
          <FileText className="size-4 text-[var(--muted)]" aria-hidden="true" />
          <Card.Title className="text-base font-medium">{isLoading ? t("page.loading") : countLabel}</Card.Title>
          {activeFilters > 0 && (
            <Chip size="sm" variant="secondary">
              {activeFilters > 1 ? t("page.filtersActive", { count: activeFilters }) : t("page.filterActive", { count: activeFilters })}
            </Chip>
          )}
        </Card.Header>
        {isLoading ? (
          <RiskPresentationSkeleton view={view} />
        ) : isError ? (
          <ErrorState
            variant="server"
            title={t("loadError")}
            description={t("loadErrorDesc")}
            onRetry={() => refetch()}
          />
        ) : view === "card" ? (
          <div className="p-4" role="region" aria-label={t("views.card")}>
            <CardGrid items={riskViewRecords} empty={emptyPresentation} />
          </div>
        ) : view === "kanban" ? (
          <div className="space-y-3 p-4" role="region" aria-label={t("views.board")}>
            <p className="text-sm text-[var(--muted)]">{t("views.boardDescription")}</p>
            {boardHasUnsupportedStatuses && (
              <p className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_35%,transparent)] px-3 py-2 text-xs" role="status">
                {t("views.unknownStatus")}
              </p>
            )}
            <KanbanBoard
              items={riskViewRecords}
              columns={riskKanbanColumns}
              empty={emptyPresentation}
              unknownStatusBehavior="omit"
              showEmptyColumns
            />
          </div>
        ) : (
          <div ref={gridRef} role="region" aria-label={t("accessibility.registerRegion")}>
            {/* Rows open the risk on click or Enter (t("accessibility.openRisk") names the action).
            The identification date lives in the record view, not the table. */}
            <DataGrid
              aria-label={t("accessibility.registerRegion")}
              data={risks ?? []}
              columns={columns}
              getRowId={(r) => r.id}
              onRowAction={openRiskRow}
              contentClassName="min-w-[1036px] table-fixed"
              verticalAlign="middle"
              renderEmptyState={() => emptyPresentation}
            />
          </div>
        )}
        {pagination && <div className="border-t border-[var(--border)]">{pagination}</div>}
      </Card>
        </>
      )}

      {/* Primary risk record view — list URL remains the source of register state. */}
      <RiskDetailModal
        risk={selected}
        onClose={() => setSelected(null)}
        projects={projects?.map((p) => ({ id: p.id, code: p.code, title: p.title })) ?? undefined}
        states={states}
        users={users}
        me={me}
        updateMutation={updateMutation}
        restoreFocusRef={detailTriggerRef}
      />
    </div>
  );
}
