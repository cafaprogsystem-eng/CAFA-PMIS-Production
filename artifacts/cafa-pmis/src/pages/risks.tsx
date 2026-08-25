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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, AlertCircle, Plus, Search, X, Clock, CheckCircle2, User, Filter,
  Calendar, Shield, FileText, History, MessageSquare,
} from "lucide-react";
import { RISK_STATUS_OPTIONS, RISK_STATUS_VALUES, formatRiskStatus } from "@/lib/risk-statuses";
import { LocationSelector } from "@/components/location-selector";
import { StateLabel } from "@/components/state-label";
import { CommentsPanel } from "@/components/comments-panel";
import { DriveAttachmentPanel, AttachmentCountBadge } from "@/components/drive-attachment-panel";
import { toast } from "sonner";
import { ErrorState } from "@/components/ui/error-state";
import { formatDate, formatDateTime, hasPerm, severityBadgeVariant, formatLocation } from "@/lib/format";
import { RecordDetailModal } from "@/components/record-detail-modal";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { OfflineDraftNotice } from "@/components/offline-draft-notice";
import { useDurableFormDraft } from "@/hooks/use-durable-form-draft";
import { useSyncContext } from "@/contexts/sync-context";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";

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
const RISK_KANBAN_COLORS: Record<string, string> = {
  open: "border border-amber-200 bg-amber-50 text-amber-700",
  under_mitigation: "border border-blue-200 bg-blue-50 text-blue-700",
  closed: "border border-slate-200 bg-slate-100 text-slate-600",
  identified: "border border-violet-200 bg-violet-50 text-violet-700",
  assigned: "border border-indigo-200 bg-indigo-50 text-indigo-700",
  mitigation_plan: "border border-sky-200 bg-sky-50 text-sky-700",
  follow_up: "border border-cyan-200 bg-cyan-50 text-cyan-700",
  escalation: "border border-red-200 bg-red-50 text-red-700",
  mitigated: "border border-emerald-200 bg-emerald-50 text-emerald-700",
};

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

function getRiskReferenceError(error: unknown): { field: RiskReferenceField; message: string } | null {
  const apiError = error as {
    data?: { error?: string; message?: string };
    response?: { data?: { error?: string; message?: string } };
  };
  const code = apiError.data?.error ?? apiError.response?.data?.error;

  switch (code) {
    case "state_not_found":
      return { field: "stateId", message: "The selected state is no longer available." };
    case "project_not_found":
      return { field: "projectId", message: "The selected project is no longer available." };
    case "assigned_user_not_found":
      return { field: "assignedToId", message: "The selected responsible person is no longer available." };
    case "assigned_user_not_active":
      return { field: "assignedToId", message: "The selected responsible person is no longer active." };
    default:
      return null;
  }
}

function StatusBadge({ status }: { status: string | null | undefined }) {
  const { t } = useTranslation("risks");
  const s = status || "open";
  const cls =
    s === "closed" ? "bg-muted text-muted-foreground border border-border" :
    s === "under_mitigation" || s === "mitigation_plan" ? "bg-info/10 text-info border border-info/30" :
    s === "escalation" ? "bg-destructive/10 text-destructive border border-destructive/30" :
    "bg-warning/10 text-warning border border-warning/30";
  return <Badge className={cls}>{displayStatus(s, t)}</Badge>;
}

function RiskPresentationSkeleton({ view }: { view: RiskRegisterView }) {
  if (view === "card") {
    return (
      <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="skeleton-card-grid">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="space-y-4 rounded-xl border border-border p-4">
            <div className="flex justify-between gap-3">
              <Skeleton className="h-5 w-3/5" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
            <Skeleton className="h-4 w-2/5" />
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
    <div className="divide-y" data-testid="skeleton-table">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-6 py-3">
          <Skeleton className="h-4 flex-[3]" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-4 w-14" />
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-24 rounded-full" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-16" />
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
            form.setError("assignedToId", { message: referenceError.message });
            return;
          }
          toast.error(error instanceof Error ? error.message : "Could not save risk changes.");
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

  return (
    <RecordDetailModal
      open={!!risk}
      onClose={() => { setEditMode(false); onClose(); }}
      restoreFocusRef={restoreFocusRef}
      title={risk.title}
      description={editMode ? t("editingRisk", { defaultValue: "Editing risk" }) : contextDescription}
      metadata={
        <>
          <Badge variant={severityBadgeVariant(riskLevel)}>{riskLevel ? t(`presentation.riskLevels.${riskLevel}`, { defaultValue: displayRiskLevel(riskLevel) }) : "—"}</Badge>
          <StatusBadge status={risk.status} />
        </>
      }
    >
        <Tabs defaultValue="details" className="w-full min-w-0">
          <div className="mb-4 w-full overflow-x-auto pb-1">
            <TabsList className="w-max min-w-full">
              <TabsTrigger value="details"><Shield className="h-4 w-4 me-1" />{t("detail.tabDetails")}</TabsTrigger>
              <TabsTrigger value="comments"><MessageSquare className="h-4 w-4 me-1" />{t("detail.tabComments")}</TabsTrigger>
              <TabsTrigger value="history"><History className="h-4 w-4 me-1" />{t("detail.tabHistory")}</TabsTrigger>
              <TabsTrigger value="attachments"><FileText className="h-4 w-4 me-1" />{t("detail.tabAttachments")}</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="details" className="space-y-4">
            {!editMode ? (
              <>
                <dl className="grid gap-x-6 gap-y-4 text-sm grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.category")}</dt>
                    <dd className="font-medium break-words">{risk.category ? t(`presentation.categories.${risk.category}`, { defaultValue: displayCategory(risk.category) }) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.status")}</dt>
                    <dd><StatusBadge status={risk.status} /></dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.probability")}</dt>
                    <dd className="font-medium">{risk.likelihood ? t(`presentation.likelihoods.${risk.likelihood}`, { defaultValue: displayLikelihood(risk.likelihood) }) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.impact")}</dt>
                    <dd className="font-medium">{(() => { const iv = (risk as Risk & { impact?: string | null }).impact || risk.severity; return iv ? t(`presentation.impacts.${iv}`, { defaultValue: displayImpact(iv) }) : "—"; })()}</dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.riskLevel")}</dt>
                    <dd><Badge variant={severityBadgeVariant(riskLevel)}>{riskLevel ? t(`presentation.riskLevels.${riskLevel}`, { defaultValue: displayRiskLevel(riskLevel) }) : "—"}</Badge></dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.responsiblePerson")}</dt>
                    <dd className="flex min-w-0 items-center gap-1 font-medium">
                      <User className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="break-words" title={risk.assignedToName ?? undefined}>{risk.assignedToName ?? t("unassigned")}</span>
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.dateIdentified")}</dt>
                    <dd className="flex items-center gap-1 font-medium">
                      <Calendar className="h-3 w-3 text-muted-foreground" />
                      {formatDate(risk.identifiedAt)}
                    </dd>
                  </div>
                  <div>
                    <dt className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.dueDate")}</dt>
                    <dd className="flex items-center gap-1 font-medium">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      {risk.dueDate ? formatDate(risk.dueDate) : "—"}
                    </dd>
                  </div>
                </dl>

                {risk.description && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.description")}</p>
                    <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">{risk.description}</p>
                  </div>
                )}

                {risk.mitigationPlan && (
                  <div>
                    <p className="mb-1 text-xs font-medium text-muted-foreground">{t("detail.mitigationAction")}</p>
                    <p className="rounded-md bg-muted/40 p-3 text-sm whitespace-pre-wrap break-words">{risk.mitigationPlan}</p>
                  </div>
                )}

                {canUpdate && (
                  <Button variant="outline" onClick={onEdit} className="w-full mt-2">{t("detail.editRisk")}</Button>
                )}
              </>
            ) : isResetting ? (
              /* Edit-mode skeleton — shown during the brief populate phase */
              <div className="space-y-5" aria-busy="true">
                <div className="space-y-3">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-10 rounded-md" />
                  <Skeleton className="h-10 rounded-md" />
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-32" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-10 rounded-md" />
                    <Skeleton className="h-10 rounded-md" />
                  </div>
                </div>
                <div className="space-y-3">
                  <Skeleton className="h-4 w-40" />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Skeleton className="h-10 rounded-md" />
                    <Skeleton className="h-10 rounded-md" />
                  </div>
                  <Skeleton className="h-20 rounded-md" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-9 w-24 rounded-md" />
                  <Skeleton className="h-9 flex-1 rounded-md" />
                </div>
              </div>
            ) : (
              <form onSubmit={onSave} className="space-y-5">
                {/* Section: {t("sections.riskIdentification")} */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.riskIdentification")}</p>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="edit-title">{t("fields.title")}</Label>
                      <Input
                        id="edit-title"
                        {...form.register("title")}
                        aria-invalid={!!form.formState.errors.title}
                      />
                      {form.formState.errors.title && (
                        <p className="text-xs text-destructive mt-1">{form.formState.errors.title.message}</p>
                      )}
                    </div>
                    <div className="max-w-2xl">
                      <Label htmlFor="edit-description">{t("fields.description")}</Label>
                      <Textarea
                        id="edit-description"
                        rows={2}
                        className="resize-y"
                        {...form.register("description")}
                        aria-invalid={!!form.formState.errors.description}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="edit-category">{t("fields.category")}</Label>
                        <Select value={form.watch("category")} onValueChange={(v) => form.setValue("category", v)}>
                          <SelectTrigger id="edit-category" aria-invalid={!!form.formState.errors.category}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="edit-status">{t("fields.status")}</Label>
                        <div className="max-w-xs">
                          <Select value={form.watch("status")} onValueChange={(v) => form.setValue("status", v)}>
                            <SelectTrigger id="edit-status" aria-invalid={!!form.formState.errors.status}><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {RISK_STATUS_OPTIONS.map((option) => (
                                <SelectItem key={option.value} value={option.value}>
                                  {t(option.labelKey)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: {t("sections.riskAssessment")} */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.riskAssessment")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="edit-likelihood">{t("fields.probability")}</Label>
                      <div className="max-w-xs">
                        <Select value={form.watch("likelihood")} onValueChange={(v) => form.setValue("likelihood", v)}>
                          <SelectTrigger id="edit-likelihood" aria-invalid={!!form.formState.errors.likelihood}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROBABILITIES.map((p) => <SelectItem key={p} value={p}>{t(`presentation.likelihoods.${p}`, { defaultValue: displayLikelihood(p) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="edit-impact">{t("fields.impact")}</Label>
                      <div className="max-w-xs">
                        <Select value={form.watch("impact") ?? ""} onValueChange={(v) => form.setValue("impact", v)}>
                          <SelectTrigger id="edit-impact" aria-invalid={!!form.formState.errors.impact}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {IMPACTS.map((i) => <SelectItem key={i} value={i}>{t(`presentation.impacts.${i}`, { defaultValue: displayImpact(i) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Ownership & follow-up */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.ownershipFollowUp")}</p>
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="edit-assigned">{t("fields.responsiblePerson")}</Label>
                        <Select
                          value={form.watch("assignedToId") ? String(form.watch("assignedToId")) : "__none__"}
                          onValueChange={(v) => {
                            form.setValue("assignedToId", v === "__none__" ? null : Number(v));
                            form.clearErrors("assignedToId");
                          }}
                        >
                          <SelectTrigger id="edit-assigned" aria-invalid={!!form.formState.errors.assignedToId}><SelectValue placeholder={t("unassigned")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("unassigned")}</SelectItem>
                            {users?.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {form.formState.errors.assignedToId && (
                          <p className="text-xs text-destructive mt-1" role="alert">{form.formState.errors.assignedToId.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="edit-due-date">{t("fields.dueDate")}</Label>
                        <div className="max-w-xs">
                          <Input id="edit-due-date" type="date" {...form.register("dueDate")} aria-invalid={!!form.formState.errors.dueDate} />
                        </div>
                      </div>
                    </div>
                    <div className="max-w-2xl">
                      <Label htmlFor="edit-mitigation">{t("fields.mitigationAction")}</Label>
                      <Textarea
                        id="edit-mitigation"
                        rows={3}
                        className="resize-y"
                        {...form.register("mitigationPlan")}
                        aria-invalid={!!form.formState.errors.mitigationPlan}
                      />
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setEditMode(false)}>{t("form.cancel")}</Button>
                  <Button type="submit" disabled={updateMutation.isPending} className="flex-1">
                    {updateMutation.isPending ? t("saving") : t("saveChanges")}
                  </Button>
                </div>
              </form>
            )}
          </TabsContent>

          <TabsContent value="comments">
            {me?.user && (
              <CommentsPanel
                entityType="risk"
                entityId={risk.id}
                currentUserId={me.user.id}
                currentUserRole={me.user.role}
              />
            )}
          </TabsContent>

          <TabsContent value="attachments" className="pt-2">
            <DriveAttachmentPanel
              module="risks"
              recordId={risk.id}
              canUpload={canUpdate}
              canDelete={me?.user?.role === "super_admin" || me?.user?.role === "program_manager"}
            />
          </TabsContent>

          <TabsContent value="history" className="space-y-2">
            {historyLoading ? (
              <div className="space-y-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
            ) : historyIsError ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                <p className="text-foreground">{t("history.loadError", { defaultValue: "Could not load history." })}</p>
                <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => refetchHistory()}>
                  {t("history.retry", { defaultValue: "Try again" })}
                </Button>
              </div>
            ) : historyEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("history.noHistory")}</p>
            ) : (
              historyEntries.map((h) => {
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
                const dotColor =
                  h.action === "create" || h.action === "created" ? "bg-success" :
                  h.action === "closed" ? "bg-muted-foreground" :
                  h.action === "status_changed" && h.newValue === "under_mitigation" ? "bg-info" :
                  "bg-warning";
                return (
                  <div key={h.id} className="flex gap-3 text-sm">
                    <div className="flex flex-col items-center">
                      <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                      <div className="w-px flex-1 bg-border mt-1" />
                    </div>
                    <div className="min-w-0 flex-1 pb-3">
                      <p className="font-medium break-words">{actionLabel}</p>
                      {detail && <p className="mt-0.5 text-xs text-muted-foreground break-words">{detail}</p>}
                      <div className="mt-1 text-xs text-muted-foreground">
                        {h.userName ?? t("history.system")} · {formatDateTime(h.createdAt)}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </TabsContent>
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
          createForm.setError(referenceError.field, { message: referenceError.message });
          return;
        }
        toast.error(error instanceof Error ? error.message : "Could not register risk.");
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
      createForm.setError("stateId", { message: `${t("fields.state")} is required` });
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
      color: RISK_KANBAN_COLORS[option.value],
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
      const levelLabel = level
        ? t(`presentation.riskLevels.${level}`, { defaultValue: displayRiskLevel(level) })
        : "—";
      const dateContext = risk.dueDate
        ? `${t("presentation.dueDate")}: ${formatDate(risk.dueDate)}`
        : `${t("presentation.identified")}: ${formatDate(risk.identifiedAt)}`;
      return {
        id: risk.id,
        title: risk.title,
        status: risk.status ?? "",
        ariaLabel: t("accessibility.openRisk", { title: risk.title, defaultValue: "Open risk: {{title}}" }),
        statusBadge: (
          <div className="flex max-w-[11rem] flex-wrap justify-end gap-1">
            <Badge variant={severityBadgeVariant(level)}>{levelLabel}</Badge>
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
    <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
      <Shield className="h-8 w-8 opacity-30" aria-hidden="true" />
      {activeFilters > 0 ? (
        <>
          <p className="text-sm font-medium">{t("noRisksFiltered")}</p>
          <Button variant="ghost" size="sm" onClick={clearFilters}>{t("filters.clearFilters")}</Button>
        </>
      ) : (
        <p className="text-sm font-medium">{t("noRisks")}</p>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <AlertTriangle className="h-6 w-6 text-warning" />
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("page.description")}
          </p>
        </div>
        {canCreate && (
          <Dialog open={createOpen} onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) { createForm.reset(); setRiskLocationType("state"); }
        // Auto-fill state for state-scoped users (SPO/SOM cannot select HQ)
        if (open && isStateRole && meStateId) { createForm.setValue("stateId", meStateId); }
      }}>
            <DialogTrigger asChild>
          <Button className="shrink-0"><Plus className="h-4 w-4" />{t("newRisk")}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>{t("page.registerNewRisk")}</DialogTitle>
                <DialogDescription>
                  {t("page.registerNewRiskDesc")}
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={onCreate} className="space-y-5">
                <OfflineDraftNotice status={riskDraft.status} error={riskDraft.error} />

                {/* Section: {t("sections.riskIdentification")} */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.riskIdentification")}</p>
                  <div className="space-y-3">
                    <div>
                      <Label htmlFor="create-title">{t("fields.title")} <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <Input
                        id="create-title"
                        {...createForm.register("title")}
                        placeholder={t("fields.titlePh")}
                        aria-invalid={!!createForm.formState.errors.title}
                        aria-required="true"
                      />
                      {createForm.formState.errors.title && (
                        <p className="text-xs text-destructive mt-1" role="alert">{createForm.formState.errors.title.message}</p>
                      )}
                    </div>
                    <div className="max-w-2xl">
                      <Label htmlFor="create-description">{t("fields.description")}</Label>
                      <Textarea
                        id="create-description"
                        rows={2}
                        className="resize-y"
                        {...createForm.register("description")}
                        placeholder={t("fields.descriptionPh")}
                        aria-invalid={!!createForm.formState.errors.description}
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="create-category">{t("fields.category")} <span className="text-destructive" aria-hidden="true">*</span></Label>
                        <Select value={createForm.watch("category")} onValueChange={(v) => createForm.setValue("category", v)}>
                          <SelectTrigger id="create-category" aria-required="true" aria-invalid={!!createForm.formState.errors.category}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor="create-location">{t("form.stateLocation")} <span className="text-destructive" aria-hidden="true">*</span></Label>
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
                          lockedStateName={states?.find((s) => s.id === meStateId)?.name}
                          placeholder={t("common:risksPage.selectStatePlaceholder")}
                          invalid={!!createForm.formState.errors.stateId && riskLocationType !== "hq"}
                          id="create-location"
                          aria-required
                          aria-describedby={createForm.formState.errors.stateId ? "create-state-error" : undefined}
                        />
                        {createForm.formState.errors.stateId && riskLocationType !== "hq" && (
                          <p id="create-state-error" className="text-xs text-destructive mt-1" role="alert">
                            {createForm.formState.errors.stateId.message ?? `${t("fields.state")} is required`}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: {t("sections.riskAssessment")} */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.riskAssessment")}</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <Label htmlFor="create-likelihood">{t("fields.probability")} <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="max-w-xs">
                        <Select value={createForm.watch("likelihood")} onValueChange={(v) => createForm.setValue("likelihood", v)}>
                          <SelectTrigger id="create-likelihood" aria-required="true" aria-invalid={!!createForm.formState.errors.likelihood}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PROBABILITIES.map((p) => <SelectItem key={p} value={p}>{t(`presentation.likelihoods.${p}`, { defaultValue: displayLikelihood(p) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="create-impact">{t("fields.impact")} <span className="text-destructive" aria-hidden="true">*</span></Label>
                      <div className="max-w-xs">
                        <Select
                          value={createForm.watch("impact") ?? "medium"}
                          onValueChange={(v) => { createForm.setValue("impact", v); createForm.setValue("severity", v); }}
                        >
                          <SelectTrigger id="create-impact" aria-required="true" aria-invalid={!!createForm.formState.errors.impact}><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {IMPACTS.map((i) => <SelectItem key={i} value={i}>{t(`presentation.impacts.${i}`, { defaultValue: displayImpact(i) })}</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Section: Ownership & follow-up */}
                <div>
                  <p className="text-sm font-semibold text-foreground border-b border-border/40 pb-1 mb-3">{t("sections.ownershipFollowUp")}</p>
                  <div className="space-y-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <Label htmlFor="create-project">{t("fields.linkedProject")}</Label>
                        <Select
                          value={createForm.watch("projectId") ? String(createForm.watch("projectId")) : "__none__"}
                          onValueChange={(v) => {
                            createForm.setValue("projectId", v === "__none__" ? undefined : Number(v));
                            createForm.clearErrors("projectId");
                          }}
                        >
                          <SelectTrigger id="create-project" aria-invalid={!!createForm.formState.errors.projectId}><SelectValue placeholder={t("form.none")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("form.none")}</SelectItem>
                            {projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.title}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {createForm.formState.errors.projectId && (
                          <p className="text-xs text-destructive mt-1" role="alert">{createForm.formState.errors.projectId.message}</p>
                        )}
                      </div>
                      <div>
                        <Label htmlFor="create-assigned">{t("fields.responsiblePerson")}</Label>
                        <Select
                          value={createForm.watch("assignedToId") ? String(createForm.watch("assignedToId")) : "__none__"}
                          onValueChange={(v) => {
                            createForm.setValue("assignedToId", v === "__none__" ? undefined : Number(v));
                            createForm.clearErrors("assignedToId");
                          }}
                        >
                          <SelectTrigger id="create-assigned" aria-invalid={!!createForm.formState.errors.assignedToId}><SelectValue placeholder={t("unassigned")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">{t("unassigned")}</SelectItem>
                            {users?.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {createForm.formState.errors.assignedToId && (
                          <p className="text-xs text-destructive mt-1" role="alert">{createForm.formState.errors.assignedToId.message}</p>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label htmlFor="create-due-date">{t("fields.dueDate")}</Label>
                      <div className="max-w-xs">
                        <Input id="create-due-date" type="date" {...createForm.register("dueDate")} aria-invalid={!!createForm.formState.errors.dueDate} />
                      </div>
                    </div>
                    <div className="max-w-2xl">
                      <Label htmlFor="create-mitigation">{t("fields.mitigationAction")}</Label>
                      <Textarea
                        id="create-mitigation"
                        rows={3}
                        className="resize-y"
                        {...createForm.register("mitigationPlan")}
                        placeholder={t("fields.mitigationPh")}
                        aria-invalid={!!createForm.formState.errors.mitigationPlan}
                      />
                    </div>
                  </div>
                </div>

                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>{t("form.cancel")}</Button>
                  <Button type="submit" disabled={createMutation.isPending}>
                    {createMutation.isPending ? t("registering") : t("registerRisk")}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {/* ── Initial load: full-page skeleton replaces KPI + filters + table ─── */}
      {isLoading && !risksRaw ? (
        <>
          {/* KPI card skeletons — matches the 4-column summary strip */}
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4" data-testid="skeleton-kpi">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-[128px] rounded-xl" />
            ))}
          </div>
          {/* Filter toolbar skeleton */}
          <Skeleton className="h-10 rounded-xl w-full" data-testid="skeleton-toolbar" />
          {/* Table skeleton */}
          <Card>
            <CardContent className="p-0">
              <RiskPresentationSkeleton view={view} />
            </CardContent>
          </Card>
        </>
      ) : (
        <>
      {/* Summary cards — visible once data is available (initial or cached) */}
      <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          icon={AlertTriangle}
          iconBg="bg-destructive"
          label={t("stats.critical")}
          value={<span className="text-destructive">{counts.critical}</span>}
          sub={t("stats.criticalSub")}
          onClick={() => updateRegisterState({ riskLevel: riskLevelFilter === "critical" ? "all" : "critical", page: 1 })}
          className={`bg-destructive/10 border-destructive/30${riskLevelFilter === "critical" ? " ring-2 ring-primary" : ""}`}
        />
        <StatCard
          icon={AlertTriangle}
          iconBg="bg-orange-500"
          label={t("stats.high")}
          value={<span className="text-destructive/80">{counts.high}</span>}
          sub={t("stats.highSub")}
          onClick={() => updateRegisterState({ riskLevel: riskLevelFilter === "high" ? "all" : "high", page: 1 })}
          className={`bg-destructive/5 border-destructive/20${riskLevelFilter === "high" ? " ring-2 ring-primary" : ""}`}
        />
        <StatCard
          icon={AlertCircle}
          iconBg="bg-amber-400"
          label={t("stats.medium")}
          value={<span className="text-warning">{counts.medium}</span>}
          sub={t("stats.mediumSub")}
          onClick={() => updateRegisterState({ riskLevel: riskLevelFilter === "medium" ? "all" : "medium", page: 1 })}
          className={`bg-warning/10 border-warning/30${riskLevelFilter === "medium" ? " ring-2 ring-primary" : ""}`}
        />
        <StatCard
          icon={CheckCircle2}
          iconBg="bg-emerald-500"
          label={t("stats.low")}
          value={<span className="text-success">{counts.low}</span>}
          sub={t("stats.lowSub")}
          onClick={() => updateRegisterState({ riskLevel: riskLevelFilter === "low" ? "all" : "low", page: 1 })}
          className={`bg-success/10 border-success/30${riskLevelFilter === "low" ? " ring-2 ring-primary" : ""}`}
        />
      </div>

      {/* Projects-style registry toolbar: controls at the logical start, presentation at the end. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border bg-card px-3 py-2.5" role="group" aria-label={t("accessibility.toolbar")}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <div className="flex shrink-0 items-center gap-1.5 text-xs font-medium text-muted-foreground select-none">
            <Filter className="h-4 w-4" aria-hidden="true" />
            {t("filters.toolbar")}
          </div>
          <Separator orientation="vertical" className="hidden h-5 shrink-0 sm:block" />
          <div className="relative min-w-[14rem] flex-1">
              <Search className="absolute start-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input
                className="h-10 ps-8 border-border/60"
                placeholder={t("filters.searchPlaceholder")}
                value={search}
                onChange={(e) => updateRegisterState({ search: e.target.value, page: 1 })}
                aria-label={t("filters.searchRisks")}
              />
            </div>
            <Select value={riskLevelFilter} onValueChange={(v) => updateRegisterState({ riskLevel: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[8rem] w-auto max-w-[12rem] border-border/60" aria-label={t("filters.riskLevel")}><SelectValue placeholder={t("filters.riskLevel")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allLevels")}</SelectItem>
                <SelectItem value="critical">{t("levels.critical")}</SelectItem>
                <SelectItem value="high">{t("levels.high")}</SelectItem>
                <SelectItem value="medium">{t("levels.medium")}</SelectItem>
                <SelectItem value="low">{t("levels.low")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={(v) => updateRegisterState({ status: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[8rem] w-auto max-w-[12rem] border-border/60" aria-label={t("filters.status")}><SelectValue placeholder={t("filters.status")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
                <SelectItem value="open">{t("status.open")}</SelectItem>
                <SelectItem value="under_mitigation">{t("status.under_mitigation")}</SelectItem>
                <SelectItem value="closed">{t("status.closed")}</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={(v) => updateRegisterState({ category: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[8rem] w-auto max-w-[12rem] border-border/60" aria-label={t("filters.category")}><SelectValue placeholder={t("filters.category")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allCategories")}</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{t(`presentation.categories.${c}`, { defaultValue: displayCategory(c) })}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={projectId} onValueChange={(v) => updateRegisterState({ projectId: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[9rem] w-auto max-w-[14rem] border-border/60" aria-label={t("filters.project")}><SelectValue placeholder={t("filters.project")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allProjects")}</SelectItem>
                {projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={stateId} onValueChange={(v) => updateRegisterState({ stateId: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[8rem] w-auto max-w-[12rem] border-border/60" aria-label={t("filters.state")}><SelectValue placeholder={t("filters.state")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allStates")}</SelectItem>
                {states?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assignedToFilter} onValueChange={(v) => updateRegisterState({ assignedToId: v, page: 1 })}>
              <SelectTrigger className="h-10 min-w-[9rem] w-auto max-w-[13rem] border-border/60" aria-label={t("filters.responsible")}><SelectValue placeholder={t("filters.responsible")} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("filters.allPersons")}</SelectItem>
                {users?.map((u) => <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
            {activeFilters > 0 && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="h-9 px-2 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" /> {t("filters.clearCount", { count: activeFilters })}
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
      </div>

      {/* Risk table */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-6">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted-foreground" />
            {isLoading ? t("page.loading") : (() => { const total = risksRaw?.total ?? 0; return `${total} ${total === 1 ? t("page.risksCount", { count: total }).replace(/^\d+ /, "") : t("page.risksCountPlural", { count: total }).replace(/^\d+ /, "")}`; })()}
            {activeFilters > 0 && <Badge variant="secondary">{activeFilters > 1 ? t("page.filtersActive", { count: activeFilters }) : t("page.filterActive", { count: activeFilters })}</Badge>}
          </CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
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
              <p className="text-sm text-muted-foreground">{t("views.boardDescription")}</p>
              {boardHasUnsupportedStatuses && (
                <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning-foreground" role="status">
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
            <div className="overflow-x-auto" role="region" aria-label={t("common:risksPage.registerLabel")}>
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                  <TableRow>
                    <TableHead className="min-w-[200px]">{t("table.riskTitle")}</TableHead>
                    <TableHead>{t("table.category")}</TableHead>
                    <TableHead>{t("table.probability")}</TableHead>
                    <TableHead>{t("table.impact")}</TableHead>
                    <TableHead>{t("table.riskLevel")}</TableHead>
                    <TableHead>{t("table.status")}</TableHead>
                    <TableHead>{t("table.state")}</TableHead>
                    <TableHead>{t("table.project")}</TableHead>
                    <TableHead>{t("table.responsible")}</TableHead>
                    <TableHead>{t("table.dueDate")}</TableHead>
                    <TableHead>{t("table.identified")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {risks?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10">
                        <div className="flex flex-col items-center gap-2 text-muted-foreground">
                          <Shield className="h-8 w-8 opacity-30" />
                          {activeFilters > 0 ? (
                            <>
                              <p className="text-sm font-medium">{t("noRisksFiltered")}</p>
                              <Button variant="ghost" size="sm" onClick={clearFilters}>{t("filters.clearFilters")}</Button>
                            </>
                          ) : (
                            <p className="text-sm font-medium">{t("noRisks")}</p>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                  {risks?.map((r) => {
                    const lvl = r.riskLevel ?? "";
                    const impact = (r as Risk & { impact?: string | null }).impact || r.severity;
                    const isDue = r.dueDate && new Date(r.dueDate) < new Date() && r.status !== "closed";
                    return (
                      <TableRow
                        key={r.id}
                        className="cursor-pointer transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        onClick={(event) => openRiskDetail(r, event.currentTarget)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            openRiskDetail(r, event.currentTarget);
                          }
                        }}
                        tabIndex={0}
                        role="button"
                        aria-label={t("accessibility.openRisk", { title: r.title, defaultValue: "Open risk: {{title}}" })}
                      >
                        <TableCell className="font-medium max-w-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate" title={r.title}>{r.title}</span>
                            <AttachmentCountBadge module="risks" recordId={r.id} />
                          </div>
                          {r.description && <div className="text-xs text-muted-foreground truncate">{r.description}</div>}
                        </TableCell>
                        <TableCell className="text-sm capitalize">{r.category ? t(`presentation.categories.${r.category}`, { defaultValue: displayCategory(r.category) }) : "—"}</TableCell>
                        <TableCell className="text-sm">{r.likelihood ? t(`presentation.likelihoods.${r.likelihood}`, { defaultValue: displayLikelihood(r.likelihood) }) : "—"}</TableCell>
                        <TableCell className="text-sm">{impact ? t(`presentation.impacts.${impact}`, { defaultValue: displayImpact(impact) }) : "—"}</TableCell>
                        <TableCell>
                          <Badge variant={severityBadgeVariant(lvl)}>{lvl ? t(`presentation.riskLevels.${lvl}`, { defaultValue: displayRiskLevel(lvl) }) : "—"}</Badge>
                        </TableCell>
                        <TableCell><StatusBadge status={r.status} /></TableCell>
                        <TableCell className="text-sm">{formatLocation({ locationType: r.locationType, stateName: r.stateName, stateNameAr: r.stateNameAr }, i18n.language)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[150px] truncate">{r.projectTitle || (r.projectId ? t("projectRemoved", { defaultValue: "[Project removed]" }) : "—")}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{r.assignedToName || "—"}</TableCell>
                        <TableCell className={`text-sm whitespace-nowrap ${isDue ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                          {r.dueDate ? (
                            <span className="flex items-center gap-1">
                              {isDue && <Clock className="h-3 w-3" />}
                              {formatDate(r.dueDate)}
                            </span>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(r.identifiedAt)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
        {/* Pagination controls */}
        {(() => {
          const totalPages = (risksRaw as { totalPages?: number } | undefined)?.totalPages ?? 1;
          const total = (risksRaw as { total?: number } | undefined)?.total ?? 0;
          if (totalPages <= 1) return null;
          return (
            <div className="flex items-center justify-between px-6 py-3 border-t">
              <p className="text-sm text-muted-foreground" aria-live="polite" aria-current="page">
                {t("pagination.pageOf", { page, totalPages, total, defaultValue: "Page {{page}} of {{totalPages}} ({{total}} risks)" })}
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateRegisterState({ page: Math.max(1, page - 1) })}
                  disabled={page <= 1}
                  aria-label={t("pagination.previous", { defaultValue: "Previous page" })}
                >
                  {t("pagination.previous", { defaultValue: "Previous" })}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => updateRegisterState({ page: Math.min(totalPages, page + 1) })}
                  disabled={page >= totalPages}
                  aria-label={t("pagination.next", { defaultValue: "Next page" })}
                >
                  {t("pagination.next", { defaultValue: "Next" })}
                </Button>
              </div>
            </div>
          );
        })()}
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
