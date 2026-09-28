import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
import { ContinueEditingAction } from "@/components/continue-editing-action";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useGetPlan, useCreatePlan, useUpdatePlan, useTransitionPlan, useDeletePlan, useReopenPlan,
  useListProjects, useListStates, useListRisks, useGetMe,
  type PlanDetail, type PlanInput,
} from "@workspace/api-client-react";
import {
  Alert, Button, Card, Chip, Dropdown, Input, Label, Modal, Skeleton, Spinner, Tabs, TextArea, TextField,
} from "@heroui/react";
import { DataGrid } from "@heroui-pro/react/data-grid";
import { SelectField } from "@/components/select-field";
import { DateInput } from "@/components/form-controls";
import { ConfirmModal } from "@/components/confirm-modal";
import { ArrowLeft, Plus, Trash2, Save, Send, CheckCircle2, X, ChevronRight, AlertTriangle, MapPin, AlertCircle, ChevronDown, ChevronUp, Pencil, MoreHorizontal, RotateCcw } from "@/components/icons";
import { toast } from "sonner";
import { formatDate, formatCurrency, formatStatusLabel, formatPlanType, hasPerm, formatLocation } from "@/lib/format";
import { statusTone } from "@/components/view-modes/shared";
import { getLinkedStateLabel } from "@/components/state-label";
import { CommentsPanel } from "@/components/comments-panel";
import { DriveAttachmentPanel } from "@/components/drive-attachment-panel";
import { SECTORS } from "@/lib/sectors";
import { PLAN_TRANSITIONS, PLAN_TRANSITION_PERMS } from "@workspace/plan-transitions";

const PLAN_TYPES = ["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"] as const;
const ACTIVITY_STATUSES = ["planned", "in_progress", "completed", "delayed", "cancelled"] as const;
const PRIORITIES = [
  { value: "high", color: "danger" },
  { value: "medium", color: "warning" },
  { value: "low", color: "default" },
] as const;
const CURRENCIES = ["USD", "EUR", "SDG", "AED"];

/**
 * PLAN-BD-4: Client-side mirror of the backend status/progress consistency contract.
 * Returns a British English validation message or null when valid.
 */
function validateActivityProgressConsistency(status: string, progressPct: number): string | null {
  // Returns a planning:validation.* key; the caller translates it.
  switch (status) {
    case "completed":
      if (progressPct !== 100) return "validation.progressCompleted";
      break;
    case "in_progress":
      if (progressPct < 1 || progressPct > 99) return "validation.progressInProgress";
      break;
    case "planned":
      if (progressPct < 0 || progressPct > 99) return "validation.progressPlanned";
      break;
    case "delayed":
      if (progressPct < 0 || progressPct > 99) return "validation.progressDelayed";
      break;
    case "cancelled":
      if (progressPct < 0 || progressPct > 100) return "validation.progressRange";
      break;
    default:
      return null;
  }
  return null;
}

// Statuses where direct editing is locked — must match the backend set.
// "rejected" is terminal: no edit/resubmit for anyone (spec §32 / acceptance criterion 11).
const POST_APPROVAL_LOCKED_STATUSES = new Set(["approved", "active", "in_progress", "delayed", "completed", "cancelled", "archived", "rejected"]);
// Subset that may be reopened — terminal plans (completed/cancelled/archived) excluded per spec §17.
const REOPENABLE_STATUSES = new Set(["approved", "active", "in_progress", "delayed"]);

/** Plan / activity status as a HeroUI Chip — same tones as the Plans registry. */
function PlanStatusBadge({ status }: { status: string }) {
  const { t } = useTranslation("planning");
  return (
    <Chip size="sm" variant="soft" color={statusTone(status)} className="whitespace-nowrap">
      {t(`status.${status}`, { defaultValue: t(`activity.status_${status}`, { defaultValue: formatStatusLabel(status) }) })}
    </Chip>
  );
}

/** View-mode label/value pair used in the Plan Details grid. */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs font-medium text-[var(--muted)]">{label}</span>
      <span className="break-words text-sm text-[var(--foreground)] rtl:text-end" dir="auto">{children}</span>
    </div>
  );
}

// Simple levenshtein for smart locality matching
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (j === 0 ? i : i === 0 ? j : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      d[i][j] = a[i - 1] === b[j - 1]
        ? d[i - 1][j - 1]
        : 1 + Math.min(d[i - 1][j], d[i][j - 1], d[i - 1][j - 1]);
    }
  }
  return d[m][n];
}
function normalizeStr(s: string) { return s.toLowerCase().replace(/\s+/g, " ").trim(); }
function findSimilarLocality(input: string, suggestions: string[]): string | null {
  const ni = normalizeStr(input);
  for (const s of suggestions) {
    const ns = normalizeStr(s);
    if (ns === ni) return null;
    if (levenshtein(ni, ns) <= 3) return s;
  }
  return null;
}

type ActivityFormData = {
  id?: number | null;
  title: string;
  stateId: number | null;
  stateName: string;
  stateNameAr?: string | null;
  localityName: string;
  plannedDate: string;
  targetBeneficiaries: number;
  budgetPlanned: number;
  budgetActual: number;
  priority: string;
  expectedResult: string;
  status: string;
  progressPct: number;
  responsibleName: string;
  description: string;
  riskId: number | null;
  mitigationAction: string;
  expectedOutput: string;
  performanceIndicator: string;
  objectiveIndex: number | null;
  startDate: string | null;
  endDate: string | null;
};

function emptyActivity(): ActivityFormData {
  return {
    title: "", stateId: null, stateName: "", localityName: "",
    plannedDate: "", targetBeneficiaries: 0, budgetPlanned: 0, budgetActual: 0,
    priority: "medium", expectedResult: "", status: "planned", progressPct: 0,
    responsibleName: "", description: "", riskId: null,
    mitigationAction: "", expectedOutput: "", performanceIndicator: "",
    objectiveIndex: null, startDate: null, endDate: null,
  };
}

type PlanFormData = {
  title: string;
  planType: string;
  sectors: string[];
  projectId: number | null;
  stateId: number | null;
  localities: string[];
  responsibleName: string;
  startDate: string;
  endDate: string;
  status: string;
  description: string;
  budgetPlanned: number;
  budgetActual: number;
  fundingSource: string;
  currency: string;
  activities: ActivityFormData[];
};

// TRANSITIONS: labels are translated at render time using t("transitions.X").
// from/perm are derived from the shared @workspace/plan-transitions table — the exact
// same table routes/plans.ts enforces server-side — instead of a hand-maintained copy
// that could (and once did) silently drift from the real backend rules. Display order
// and the purely visual bits (requiresComment, button variant) remain frontend-only.
const TRANSITION_ORDER = [
  "submit", "technical_review", "coordination_review", "final_approve",
  "activate", "start", "mark_delayed", "complete", "archive",
  "request_revision", "reject", "cancel",
] as const;
const REQUIRES_COMMENT_ACTIONS = new Set(["request_revision", "reject"]);
const TRANSITION_VARIANTS: Partial<Record<string, "default" | "destructive" | "outline">> = {
  mark_delayed: "outline",
  archive: "outline",
  request_revision: "outline",
  reject: "destructive",
  cancel: "destructive",
};
const TRANSITIONS: Array<{
  action: string; from: string[]; perm: string;
  requiresComment?: boolean; variant?: "default" | "destructive" | "outline";
}> = TRANSITION_ORDER.map((action) => ({
  action,
  from: PLAN_TRANSITIONS[action].from,
  perm: PLAN_TRANSITION_PERMS[action],
  requiresComment: REQUIRES_COMMENT_ACTIONS.has(action) || undefined,
  variant: TRANSITION_VARIANTS[action],
}));

// Free-text locality tag input with smart matching suggestions
function LocalityTagInput({
  localities, onChange, disabled, suggestions = [],
}: {
  localities: string[]; onChange: (v: string[]) => void; disabled?: boolean; suggestions?: string[];
}) {
  const { t } = useTranslation("planning");
  const [inputVal, setInputVal] = useState("");
  const [similar, setSimilar] = useState<string | null>(null);

  function addLocality(val?: string) {
    const v = (val ?? inputVal).trim();
    if (!v || localities.includes(v)) { setInputVal(""); setSimilar(null); return; }
    onChange([...localities, v]);
    setInputVal(""); setSimilar(null);
  }

  function onInputChange(v: string) {
    setInputVal(v);
    if (v.trim().length >= 3) {
      setSimilar(findSimilarLocality(v, suggestions.filter((s) => !localities.includes(s))));
    } else {
      setSimilar(null);
    }
  }

  return (
    <div className="space-y-2">
      {!disabled && (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <Input fullWidth dir="auto"
              placeholder={t("detail.localityPh")}
              value={inputVal}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }}
            />
            <Button variant="outline" onPress={() => addLocality()} isDisabled={!inputVal.trim()} className="shrink-0">
              <Plus className="size-3.5" aria-hidden="true" /> {t("detail.addLocality")}
            </Button>
          </div>
          {similar && (
            <Alert status="warning">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Description className="flex flex-wrap items-center gap-2">
                  {t("detail.similarTo", { name: similar })}
                  <Button size="sm" variant="outline" onPress={() => addLocality(similar)}>{t("detail.useExisting")}</Button>
                  <Button size="sm" variant="ghost" onPress={() => setSimilar(null)}>{t("detail.keepMine")}</Button>
                </Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </div>
      )}
      {localities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {localities.map((loc, i) => (
            <Chip key={i} size="sm" variant="soft" color="accent" className="gap-1">
              <MapPin className="size-3" aria-hidden="true" /> {loc}
              {!disabled && (
                <button
                  type="button"
                  aria-label={t("detail.removeLocality", { name: loc })}
                  onClick={() => onChange(localities.filter((_, j) => j !== i))}
                  className="ms-0.5 rounded-full p-0.5 outline-none hover:bg-[color-mix(in_oklab,var(--accent)_20%,transparent)] focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              )}
            </Chip>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">{t("detail.noLocalitiesYet")}</p>
      )}
    </div>
  );
}

// Smart locality input for a single activity locality field
function ActivityLocalityInput({
  value, onChange, disabled, suggestions = [],
}: {
  value: string; onChange: (v: string) => void; disabled?: boolean; suggestions?: string[];
}) {
  const { t } = useTranslation("planning");
  const [similar, setSimilar] = useState<string | null>(null);

  function onInputChange(v: string) {
    onChange(v);
    if (v.trim().length >= 3) {
      setSimilar(findSimilarLocality(v, suggestions.filter((s) => s !== v)));
    } else {
      setSimilar(null);
    }
  }

  return (
    <div className="space-y-1">
      <Input fullWidth dir="auto"
        placeholder={t("detail.activityLocalityPh")}
        value={value}
        onChange={(e) => onInputChange(e.target.value)}
        disabled={disabled}
      />
      {similar && !disabled && (
        <Alert status="warning">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Description className="flex flex-wrap items-center gap-1.5">
              {t("detail.similarTo", { name: similar })}
              <Button size="sm" variant="outline" onPress={() => { onChange(similar); setSimilar(null); }}>{t("detail.useExisting")}</Button>
              <Button size="sm" variant="ghost" onPress={() => setSimilar(null)}>{t("detail.keep")}</Button>
            </Alert.Description>
          </Alert.Content>
        </Alert>
      )}
    </div>
  );
}

// Sector multi-select chip picker
function SectorPicker({ selected, onChange, disabled }: { selected: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  function toggle(s: string) {
    if (disabled) return;
    onChange(selected.includes(s) ? selected.filter((x) => x !== s) : [...selected, s]);
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {SECTORS.map((s) => {
        const active = selected.includes(s);
        return (
          <Button
            key={s}
            size="sm"
            variant={active ? "primary" : "outline"}
            aria-pressed={active}
            onPress={() => toggle(s)}
            isDisabled={disabled}
          >
            {s}
          </Button>
        );
      })}
    </div>
  );
}

// Collapsible optional activity fields
function ActivityOptionalFields({
  a, idx, updateActivity, canEdit, risks,
}: {
  a: ActivityFormData; idx: number;
  updateActivity: (idx: number, patch: Partial<ActivityFormData>) => void;
  canEdit: boolean;
  risks: Array<{ id: number; title: string; severity: string }> | undefined;
}) {
  const { t } = useTranslation("planning");
  const { t: tRisks } = useTranslation("risks");
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-2 mt-2">
      <Button size="sm" variant="ghost" aria-expanded={open} onPress={() => setOpen(!open)}>
        {open ? <ChevronUp className="size-3.5" aria-hidden="true" /> : <ChevronDown className="size-3.5" aria-hidden="true" />}
        {open ? t("activity.hideOptional") : t("activity.showOptional")}
      </Button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid md:grid-cols-4 gap-2">
            <div>
              <SelectField
                label={t("activity.status")}
                value={a.status}
                onChange={(v) => {
                  const patch: Partial<ActivityFormData> = { status: v };
                  if (v === "completed") patch.progressPct = 100;
                  updateActivity(idx, patch);
                }}
                isDisabled={!canEdit}
                options={ACTIVITY_STATUSES.map((s) => ({ value: s, label: t(`activity.status_${s}`, { defaultValue: s }) }))}
              />
            </div>
            <div>
              <Label htmlFor={`pf-1-${idx}`} className="text-xs">{t("activity.progressPct")}</Label>
              <Input id={`pf-1-${idx}`} fullWidth type="number" min={0} max={100} value={a.progressPct} onChange={(e) => updateActivity(idx, { progressPct: Number(e.target.value) })} disabled={!canEdit} />
            </div>
            <div>
              <Label htmlFor={`pf-2-${idx}`} className="text-xs">{t("activity.budgetActual")}</Label>
              <Input id={`pf-2-${idx}`} fullWidth type="number" min={0} value={a.budgetActual} onChange={(e) => updateActivity(idx, { budgetActual: Number(e.target.value) })} disabled={!canEdit} />
            </div>
            <div>
              <SelectField
                label={t("activity.linkedRisk")}
                value={a.riskId ? String(a.riskId) : "__none__"}
                onChange={(v) => updateActivity(idx, { riskId: v === "__none__" ? null : Number(v) })}
                isDisabled={!canEdit}
                options={[
                  { value: "__none__", label: t("detail.none") },
                  ...(risks ?? []).map((r) => ({ value: String(r.id), label: `${r.title} (${tRisks(`presentation.riskLevels.${r.severity}`, { defaultValue: r.severity })})`, textValue: r.title })),
                ]}
              />
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`pf-3-${idx}`} className="text-xs">{t("activity.expectedOutput")}</Label>
              <Input id={`pf-3-${idx}`} fullWidth dir="auto" value={a.expectedOutput} onChange={(e) => updateActivity(idx, { expectedOutput: e.target.value })} disabled={!canEdit} />
            </div>
            <div>
              <Label htmlFor={`pf-4-${idx}`} className="text-xs">{t("activity.performanceIndicator")}</Label>
              <Input id={`pf-4-${idx}`} fullWidth dir="auto" value={a.performanceIndicator} onChange={(e) => updateActivity(idx, { performanceIndicator: e.target.value })} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <Label htmlFor={`pf-5-${idx}`} className="text-xs">{t("activity.activityName")}</Label>
            <TextArea id={`pf-5-${idx}`} fullWidth dir="auto" rows={2} value={a.description} onChange={(e) => updateActivity(idx, { description: e.target.value })} disabled={!canEdit} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Read-only view of the optional activity fields — renders nothing when no optional field is set. */
function ActivityOptionalFieldsReadOnly({
  a, risks,
}: {
  a: ActivityFormData;
  risks: Array<{ id: number; title: string; severity: string }> | undefined;
}) {
  const { t } = useTranslation("planning");
  const { t: tRisks } = useTranslation("risks");
  const linkedRisk = a.riskId != null ? risks?.find((r) => r.id === a.riskId) : undefined;
  const hasOptional =
    a.budgetActual > 0 || a.riskId != null ||
    !!a.expectedOutput.trim() || !!a.performanceIndicator.trim() || !!a.description.trim();
  if (!hasOptional) return null;
  return (
    <div className="border-t pt-3 mt-3">
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
        {a.budgetActual > 0 && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.budgetActual")}</dt>
            <dd className="tabular-nums"><bdi dir="ltr">{formatCurrency(a.budgetActual)}</bdi></dd>
          </div>
        )}
        {a.riskId != null && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.linkedRisk")}</dt>
            <dd dir="auto" className="rtl:text-end">{linkedRisk ? `${linkedRisk.title} (${tRisks(`presentation.riskLevels.${linkedRisk.severity}`, { defaultValue: linkedRisk.severity })})` : "—"}</dd>
          </div>
        )}
        {!!a.expectedOutput.trim() && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.expectedOutput")}</dt>
            <dd>{a.expectedOutput}</dd>
          </div>
        )}
        {!!a.performanceIndicator.trim() && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.performanceIndicator")}</dt>
            <dd>{a.performanceIndicator}</dd>
          </div>
        )}
        {!!a.description.trim() && (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.activityName")}</dt>
            <dd className="whitespace-pre-wrap">{a.description}</dd>
          </div>
        )}
      </dl>
    </div>
  );
}

export default function PlanDetailPage({
  planId: suppliedPlanId,
  embedded = false,
  onContinueEdit,
  onRecordLoaded,
}: {
  planId?: string;
  embedded?: boolean;
  onContinueEdit?: () => void;
  onRecordLoaded?: (header: { title: string; description?: string }) => void;
} = {}) {
  const { t, i18n } = useTranslation("planning");
  const { t: tRisks } = useTranslation("risks");
  const { t: tCommon } = useTranslation("common");
  const params = useParams<{ planId: string }>();
  const routePlanId = suppliedPlanId ?? params.planId;
  const isNew = routePlanId === "new";
  const planId = isNew ? null : Number(routePlanId);
  const [, setLocation] = useLocation();
  const qc = useQueryClient();

  // ?edit=1 query param: written by CreatePlanDialog on success; signals opening in edit mode.
  // Read once at mount — safe on direct refresh (stays in edit mode, which is correct).
  const hasEditParam = !embedded && typeof window !== "undefined" && new URLSearchParams(window.location.search).has("edit");
  // Guard against multiple effect runs setting isEditing more than once.
  const editParamApplied = useRef(false);

  const { data: me } = useGetMe();
  const perms = me?.permissions;
  // Edit Existing Plan requires plans.update — separate from plans.create, plans.reopen, plans.delete.
  // plans.create (create new) and projects.create MUST NOT grant editing of existing plans.
  const canEdit = hasPerm(perms, "*") || hasPerm(perms, "plans.update");
  // Deletion is a separate, explicitly-granted permission. plans.update does NOT imply plans.delete.
  const canDelete = hasPerm(perms, "*") || hasPerm(perms, "plans.delete");
  // Reopen is a separate, explicitly-granted permission — separate from edit, delete, and update.
  const canReopen = hasPerm(perms, "*") || hasPerm(perms, "plans.reopen");

  const { data: existing, isLoading, isError: planError } = useGetPlan(
    planId as number,
    { query: { enabled: !isNew && planId != null, queryKey: ["plan", planId] } },
  );

  useEffect(() => {
    if (!existing) return;
    onRecordLoaded?.({
      title: existing.title,
      description: [existing.code, t(`status.${existing.status}`, { defaultValue: formatStatusLabel(existing.status) })].filter(Boolean).join(" · "),
    });
  }, [existing, onRecordLoaded, t]);

  // ── Returned-for-revision banner (PLAN-012) ────────────────────────────────
  // Fetch plan comments when status is "draft" to detect prior revision requests.
  // Uses the same /api/comments endpoint as CommentsPanel — no new backend routes needed.
  const { data: planComments } = useQuery<Array<{ commentType: string; authorName: string; body: string; createdAt: string }>>({
    queryKey: ["comments", "plan", planId],
    queryFn: async () => {
      const res = await fetch(`/api/comments?entityType=plan&entityId=${planId}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !isNew && planId != null && !!(existing && existing.status === "draft"),
  });

  // Most recent revision_request comment — the reviewer's feedback for the author.
  const lastRevisionRequest = useMemo(() => {
    if (!planComments) return null;
    const requests = planComments.filter((c) => c.commentType === "revision_request");
    if (requests.length === 0) return null;
    return requests.reduce((latest, c) =>
      new Date(c.createdAt) > new Date(latest.createdAt) ? c : latest,
    );
  }, [planComments]);

  // Approval lock: derived from current plan status — backend is the authoritative gate.
  const isApprovalLocked = !isNew && !!existing && POST_APPROVAL_LOCKED_STATUSES.has(existing.status ?? "");
  const isReopenable = !isNew && !!existing && REOPENABLE_STATUSES.has(existing.status ?? "");

  // Existing plans start in view mode. Edit mode is requested via ?edit=1 param (spec §23).
  // isNew always redirects to /plans, so we never initialise edit mode from it.
  const [isEditing, setIsEditing] = useState(false);
  const { data: projects } = useListProjects();
  const { data: states } = useListStates();
  const { data: risksData } = useListRisks({ limit: 200 });
  const risks = risksData?.items;

  const initialType = (() => {
    const sp = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
    return (sp?.get("type") as typeof PLAN_TYPES[number]) ?? "monthly";
  })();

  const [form, setForm] = useState<PlanFormData>({
    title: "", planType: initialType,
    sectors: [], projectId: null, stateId: 0, localities: [],
    responsibleName: "", startDate: "", endDate: "",
    status: "draft", description: "",
    budgetPlanned: 0, budgetActual: 0, fundingSource: "", currency: "USD",
    activities: [],
  });
  const [transitionDialog, setTransitionDialog] = useState<{ action: string; label: string; requiresComment: boolean } | null>(null);
  const [transitionComment, setTransitionComment] = useState("");
  const [reopenDialogOpen, setReopenDialogOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");
  // ── Edit-mode inline field errors ─────────────────────────────────────────
  const [editFieldErrors, setEditFieldErrors] = useState<Record<string, string>>({});
  // ── Dedicated rejection dialog state ─────────────────────────────────────
  const [rejectDialog, setRejectDialog] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectReasonError, setRejectReasonError] = useState("");
  // Confirmations that used the browser's native confirm()
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  useEffect(() => {
    if (existing && !isNew) {
      const ext = existing as unknown as {
        sectors?: string[]; sector?: string; localities?: string[];
        responsibleName?: string; fundingSource?: string;
        activities?: Array<ActivityFormData & { id?: number }>;
      };
      // PLAN-009: the API's `sectors` field is the authoritative effective-sectors
      // array — no client-side fallback to the legacy single `sector` field.
      const loadedSectors = Array.isArray(ext.sectors) ? ext.sectors : [];
      setForm({
        title: existing.title,
        planType: existing.planType,
        sectors: loadedSectors,
        projectId: existing.projectId ?? null,
        stateId: existing.stateId ?? null,
        localities: Array.isArray(ext.localities) ? ext.localities : [],
        responsibleName: ext.responsibleName ?? "",
        // Slice to "YYYY-MM-DD" — API serialises PG date columns as full ISO strings
        // (e.g. "2026-07-01T00:00:00.000Z") which date inputs cannot parse and display blank.
        startDate: existing.startDate ? String(existing.startDate).slice(0, 10) : "",
        endDate: existing.endDate ? String(existing.endDate).slice(0, 10) : "",
        status: existing.status,
        description: (existing as unknown as PlanDetail).description ?? "",
        budgetPlanned: existing.budgetPlanned,
        budgetActual: existing.budgetActual,
        fundingSource: ext.fundingSource ?? "",
        currency: existing.currency ?? "USD",
        activities: (existing.activities ?? []).map((a) => {
          const raw = a as unknown as ActivityFormData & { id?: number };
          return {
            id: raw.id,
            title: raw.title ?? "",
            stateId: raw.stateId ?? null,
            stateName: raw.stateName ?? "",
            stateNameAr: raw.stateNameAr ?? null,
            localityName: raw.localityName ?? "",
            plannedDate: raw.plannedDate ?? "",
            targetBeneficiaries: raw.targetBeneficiaries ?? 0,
            budgetPlanned: Number(raw.budgetPlanned ?? 0),
            budgetActual: Number(raw.budgetActual ?? 0),
            priority: raw.priority ?? "medium",
            expectedResult: raw.expectedResult ?? "",
            status: raw.status ?? "planned",
            progressPct: raw.progressPct ?? 0,
            responsibleName: raw.responsibleName ?? "",
            description: raw.description ?? "",
            riskId: raw.riskId ?? null,
            mitigationAction: raw.mitigationAction ?? "",
            expectedOutput: raw.expectedOutput ?? "",
            performanceIndicator: raw.performanceIndicator ?? "",
            objectiveIndex: raw.objectiveIndex ?? null,
            startDate: raw.startDate ?? null,
            endDate: raw.endDate ?? null,
          };
        }),
      });
    }
  }, [existing, isNew]);

  // Retire the /plans/new full-page route — redirect to /plans so creation goes through the modal.
  useEffect(() => {
    if (isNew) setLocation("/plans");
  }, [isNew, setLocation]);

  // Open existing plan in edit mode when ?edit=1 is present (set by CreatePlanDialog on success).
  // Only activates once per mount and only when canEdit is true (plans.update required — spec §32).
  useEffect(() => {
    if (!editParamApplied.current && hasEditParam && canEdit && !isNew) {
      editParamApplied.current = true;
      setIsEditing(true);
    }
  }, [hasEditParam, canEdit, isNew]);

  const createMutation = useCreatePlan({
    mutation: {
      onSuccess: (created) => { toast.success(t("toast.planCreated")); qc.invalidateQueries(); setLocation(`/plans/${created.id}`); },
      onError: (e: Error) => toast.error(e.message),
    },
  });
  const updateMutation = useUpdatePlan({
    mutation: {
      onSuccess: () => { toast.success(t("toast.planSaved")); qc.invalidateQueries(); setIsEditing(false); setEditFieldErrors({}); },
      onError: (e: Error) => {
        const msg = e.message || "";
        if (msg.includes("responsible_user_not_active")) toast.error(t("toast.responsibleUserNotActive"));
        else if (msg.includes("responsible_user_not_found")) toast.error(t("toast.responsibleUserNotFound"));
        else if (msg.includes("end_date_before_start_date")) toast.error(t("toast.endDateBeforeStartDate"));
        else if (msg.includes("invalid_start_date") || msg.includes("invalid_end_date")) toast.error(t("toast.invalidDateFormat"));
        else toast.error(msg);
      },
    },
  });
  const transitionMutation = useTransitionPlan({
    mutation: {
      onSuccess: () => { toast.success(t("toast.workflowUpdated")); qc.invalidateQueries(); setTransitionDialog(null); setTransitionComment(""); },
      onError: (e: Error) => {
        const msg = e.message || "";
        if (msg.includes("plan_activities_incomplete")) toast.error(t("detail.planActivitiesIncomplete"));
        else if (msg.includes("at_least_one_activity_required")) toast.error(t("toast.activityRequired"));
        else if (msg.includes("unresolved_required_corrections")) toast.error(t("toast.resolveCorrections"));
        else if (msg.includes("comment_required")) toast.error(t("toast.commentRequired"));
        else toast.error(msg);
      },
    },
  });
  const deleteMutation = useDeletePlan({
    mutation: {
      onSuccess: () => { toast.success(t("toast.planDeleted")); qc.invalidateQueries(); setLocation("/plans"); },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  const reopenMutation = useReopenPlan({
    mutation: {
      onSuccess: (plan) => {
        const planCode = (plan as unknown as { code?: string }).code ?? "";
        toast.success(t("detail.planReopened"), { description: t("detail.planReopenedDesc", { code: planCode }) });
        qc.invalidateQueries();
        setReopenDialogOpen(false);
        setReopenReason("");
      },
      onError: (e: Error) => toast.error(e.message),
    },
  });

  function setField<K extends keyof PlanFormData>(k: K, v: PlanFormData[K]) { setForm((f) => ({ ...f, [k]: v })); }
  function updateActivity(idx: number, patch: Partial<ActivityFormData>) {
    setForm((f) => ({ ...f, activities: f.activities.map((a, i) => (i === idx ? { ...a, ...patch } : a)) }));
  }
  function addActivity() { setForm((f) => ({ ...f, activities: [...f.activities, emptyActivity()] })); }
  function removeActivity(idx: number) { setForm((f) => ({ ...f, activities: f.activities.filter((_, i) => i !== idx) })); }

  /** Returns per-field error map for inline display in edit mode after a failed save. */
  function getEditFieldErrors(): Record<string, string> {
    const errs: Record<string, string> = {};
    if (!form.title.trim()) errs.title = t("detail.planTitleRequired");
    if (!form.planType) errs.planType = t("detail.planTypeRequired");
    if (!form.stateId) errs.stateId = t("detail.stateRequired");
    if (form.sectors.length === 0) errs.sectors = t("detail.sectorsRequired");
    if (!form.responsibleName.trim()) errs.responsibleName = t("detail.responsibleRequired");
    if (!form.startDate) errs.startDate = t("detail.startDateRequired");
    if (!form.endDate) errs.endDate = t("detail.endDateRequired");
    if (form.startDate && form.endDate && form.endDate < form.startDate) {
      errs.endDate = t("detail.endDateAfterStart");
    }
    return errs;
  }

  function validate(forSubmit = false): string | null {
    if (!form.title.trim()) return t("validation.titleRequired");
    if (!form.planType) return t("validation.typeRequired");
    if (!form.stateId) return t("validation.stateRequired");
    if (form.sectors.length === 0) return t("validation.sectorRequired");
    if (!form.responsibleName.trim()) return t("validation.responsibleRequired");
    if (!form.startDate || !form.endDate) return t("validation.datesRequired");
    if (form.endDate < form.startDate) return t("validation.endBeforeStart");
    for (let i = 0; i < form.activities.length; i++) {
      const a = form.activities[i];
      const n = i + 1;
      if (!a.title.trim()) return t("validation.activityTitleRequired", { num: n });
      if (!a.localityName.trim()) return t("validation.activityLocalityRequired", { num: n });
      if (!a.plannedDate) return t("validation.activityDateRequired", { num: n });
      if (form.startDate && a.plannedDate < form.startDate) return t("validation.activityDateOutside", { num: n });
      if (form.endDate && a.plannedDate > form.endDate) return t("validation.activityDateOutside", { num: n });
      if (a.targetBeneficiaries < 0) return t("validation.activityBeneficiariesNegative", { num: n });
      if (a.budgetPlanned < 0) return t("validation.activityBudgetNegative", { num: n });
      if (!a.expectedResult.trim()) return t("validation.activityResultRequired", { num: n });
      const progressErr = validateActivityProgressConsistency(a.status, a.progressPct);
      if (progressErr) return t("validation.activityPrefix", { num: n, message: t(progressErr) });
    }
    if (forSubmit && form.activities.length === 0) return t("validation.activityRequiredToSubmit");
    return null;
  }

  function onSave() {
    const fieldErrs = getEditFieldErrors();
    setEditFieldErrors(fieldErrs);
    const err = validate(false);
    if (err) { toast.error(err); return; }
    const payload = {
      ...form,
      // map activities back to API shape
      activities: form.activities.map((a) => ({
        ...a,
        plannedDate: a.plannedDate || null,
        startDate: a.plannedDate || null,
        endDate: a.plannedDate || null,
        targetBeneficiaries: Number(a.targetBeneficiaries),
        budgetPlanned: Number(a.budgetPlanned),
        budgetActual: Number(a.budgetActual),
      })),
      budgetPlanned: Number(form.budgetPlanned ?? 0),
      budgetActual: Number(form.budgetActual ?? 0),
    } as unknown as PlanInput;
    if (isNew) createMutation.mutate({ data: payload });
    else if (planId) updateMutation.mutate({ planId, data: payload });
  }

  function onCancel() {
    // Ask before discarding unsaved changes (HeroUI alert dialog, same pattern as Delete)
    setDiscardConfirmOpen(true);
  }

  function discardChanges() {
    setDiscardConfirmOpen(false);
    {
      setIsEditing(false);
      setEditFieldErrors({});
      // Reset form to persisted data
      if (existing) {
        const ext = existing as unknown as {
          sectors?: string[]; sector?: string; localities?: string[];
          responsibleName?: string; fundingSource?: string;
          activities?: Array<ActivityFormData & { id?: number }>;
        };
        // PLAN-009: API `sectors` is authoritative — no legacy single-sector fallback.
        const loadedSectors = Array.isArray(ext.sectors) ? ext.sectors : [];
        setForm({
          title: existing.title,
          planType: existing.planType,
          sectors: loadedSectors,
          projectId: existing.projectId ?? null,
          stateId: existing.stateId ?? null,
          localities: Array.isArray(ext.localities) ? ext.localities : [],
          responsibleName: ext.responsibleName ?? "",
          startDate: existing.startDate ? String(existing.startDate).slice(0, 10) : "",
          endDate: existing.endDate ? String(existing.endDate).slice(0, 10) : "",
          status: existing.status,
          description: (existing as unknown as PlanDetail).description ?? "",
          budgetPlanned: existing.budgetPlanned,
          budgetActual: existing.budgetActual,
          fundingSource: ext.fundingSource ?? "",
          currency: existing.currency ?? "USD",
          activities: (existing.activities ?? []).map((a) => {
            const raw = a as unknown as ActivityFormData & { id?: number };
            return {
              id: raw.id,
              title: raw.title ?? "",
              stateId: raw.stateId ?? null,
              stateName: raw.stateName ?? "",
              stateNameAr: raw.stateNameAr ?? null,
              localityName: raw.localityName ?? "",
              plannedDate: raw.plannedDate ?? "",
              targetBeneficiaries: raw.targetBeneficiaries ?? 0,
              budgetPlanned: Number(raw.budgetPlanned ?? 0),
              budgetActual: Number(raw.budgetActual ?? 0),
              priority: raw.priority ?? "medium",
              expectedResult: raw.expectedResult ?? "",
              status: raw.status ?? "planned",
              progressPct: raw.progressPct ?? 0,
              responsibleName: raw.responsibleName ?? "",
              description: raw.description ?? "",
              riskId: raw.riskId ?? null,
              mitigationAction: raw.mitigationAction ?? "",
              expectedOutput: raw.expectedOutput ?? "",
              performanceIndicator: raw.performanceIndicator ?? "",
              objectiveIndex: raw.objectiveIndex ?? null,
              startDate: raw.startDate ?? null,
              endDate: raw.endDate ?? null,
            };
          }),
        });
      }
    }
  }

  function onTransition() {
    if (!planId || !transitionDialog) return;
    if (transitionDialog.action === "submit") {
      const err = validate(true);
      if (err) { toast.error(err); return; }
    }
    transitionMutation.mutate({
      planId,
      data: { action: transitionDialog.action, comment: transitionComment || undefined },
    });
  }

  // ── Dedicated rejection dialog handlers ───────────────────────────────────
  function onRejectConfirm() {
    if (!planId) return;
    const trimmed = rejectReason.trim();
    if (!trimmed) {
      setRejectReasonError(t("detail.rejectionReasonRequired"));
      return;
    }
    transitionMutation.mutate(
      { planId, data: { action: "reject", comment: trimmed } },
      {
        onSuccess: () => { setRejectDialog(false); setRejectReason(""); setRejectReasonError(""); },
        // onError: leave dialog open; error toast already handled by mutation default onError
      },
    );
  }

  function onRejectCancel() {
    if (transitionMutation.isPending) return;
    setRejectDialog(false);
    setRejectReason("");
    setRejectReasonError("");
  }

  /** Open the appropriate dialog for a transition action. */
  function openTransitionDialog(tr: { action: string; requiresComment?: boolean }) {
    if (tr.action === "reject") {
      setRejectReason("");
      setRejectReasonError("");
      setRejectDialog(true);
    } else {
      setTransitionDialog({ action: tr.action, label: t(`transitions.${tr.action}`), requiresComment: !!tr.requiresComment });
    }
  }

  // Locality suggestions = plan localities + project localities
  const projectLocalities = useMemo(() => {
    if (!form.projectId) return [];
    const proj = projects?.find((p) => p.id === form.projectId);
    const raw = proj as unknown as { localities?: Array<{ name?: string } | string> } | undefined;
    if (!raw?.localities) return [];
    return raw.localities.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
  }, [form.projectId, projects]);

  const localitySuggestions = useMemo(() => {
    const combined = [...new Set([...form.localities, ...projectLocalities])];
    return combined;
  }, [form.localities, projectLocalities]);

  const totals = useMemo(() => {
    const acts = form.activities;
    return {
      count: acts.length,
      totalBeneficiaries: acts.reduce((s, a) => s + Number(a.targetBeneficiaries ?? 0), 0),
      plannedBudget: acts.reduce((s, a) => s + Number(a.budgetPlanned ?? 0), 0),
      actualBudget: acts.reduce((s, a) => s + Number(a.budgetActual ?? 0), 0),
      completed: acts.filter((a) => a.status === "completed").length,
      delayed: acts.filter((a) => a.status === "delayed").length,
    };
  }, [form.activities]);

  if (!isNew && isLoading) {
    return (
      <div className="space-y-6">
        {!embedded && <nav aria-label={t("detail.breadcrumbAria")} className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-4 rounded" />
          <Skeleton className="h-4 w-32" />
        </nav>}
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-8 w-3/4 max-w-sm" />
            <Skeleton className="h-4 w-48" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-8 w-20 rounded-md" />
            <Skeleton className="h-8 w-24 rounded-md" />
          </div>
        </div>
        <div className="flex gap-1">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-9 w-24 rounded-md" />)}
        </div>
        <div className="grid gap-6">
          <Skeleton className="h-[240px] rounded-xl" />
          <Skeleton className="h-[180px] rounded-xl" />
        </div>
      </div>
    );
  }

  if (!isNew && planError) {
    return (
      <div className="space-y-6">
        {!embedded && <nav aria-label={t("detail.breadcrumbAria")} className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/plans" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" /> {t("detail.plans_breadcrumb")}
          </Link>
        </nav>}
        <Card>
          <Card.Content className="flex flex-col items-center gap-3 py-10">
            <AlertCircle className="size-8 text-[var(--danger)]" aria-hidden="true" />
            <p className="text-sm font-medium text-foreground">{t("detail.planNotFound")}</p>
            <Button variant="outline" size="sm" onPress={() => setLocation("/plans")}>
              {t("detail.backToPlans")}
            </Button>
          </Card.Content>
        </Card>
      </div>
    );
  }

  const availableTransitions = TRANSITIONS.filter(
    (tr) => existing && tr.from.includes(existing.status) && hasPerm(perms, tr.perm),
  );

  // /plans/new is retired — redirect effect above handles navigation; render nothing while it fires.
  if (isNew) return null;

  return (
    <div className="space-y-5">
      {/* ── Breadcrumb / Back navigation ───────────────────────────── */}
      <div className="space-y-2">
        {!embedded && <nav aria-label={t("detail.breadcrumbAria")} className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Link href="/plans" className="hover:text-foreground transition-colors flex items-center gap-1">
            <ArrowLeft className="h-3.5 w-3.5 rtl:rotate-180" />
            {t("detail.plans_breadcrumb")}
          </Link>
          {existing && (
            <>
              <ChevronRight className="h-3 w-3 flex-shrink-0 rtl:rotate-180" />
              <span className="font-mono text-xs text-foreground/60 truncate max-w-[180px]" title={existing.code ?? ""}>
                {existing.code ?? t("detail.plan")}
              </span>
            </>
          )}
        </nav>}

        {/* ── Plan Identity Header ──────────────────────────────────── */}
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
          {/* Left: Title + metadata */}
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <h1 className="text-foreground text-xl font-semibold leading-snug break-words">
              {isNew ? t("detail.newPlan") : existing?.title ?? t("detail.plan")}
            </h1>
            {existing && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Chip size="sm" variant="secondary" className="font-mono"><bdi dir="ltr">{existing.code}</bdi></Chip>
                <span className="text-muted-foreground/40">·</span>
                <span>{t(`planTypes.${existing.planType}_short`, { defaultValue: formatPlanType(existing.planType) })}</span>
                {(existing.locationType || existing.stateName) && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span>{formatLocation({ locationType: existing.locationType, stateName: existing.stateName, stateNameAr: existing.stateNameAr }, i18n?.language)}</span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Right: Status badge + action buttons */}
          <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
            {existing && <PlanStatusBadge status={existing.status} />}

            {/* Edit mode: Cancel + Save Changes in header (always visible regardless of scroll) */}
            {isEditing && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onPress={isNew ? () => setLocation("/plans") : onCancel}
                  isDisabled={createMutation.isPending || updateMutation.isPending}
                >
                  <X className="h-4 w-4" aria-hidden="true" /> {t("detail.cancelEdit")}
                </Button>
                <Button
                  size="sm"
                  onPress={onSave}
                  isPending={createMutation.isPending || updateMutation.isPending}
                >
                  <Save className="h-4 w-4" aria-hidden="true" />
                  {isNew ? t("createPlan") : t("detail.saveChanges")}
                </Button>
              </>
            )}

            {/* View mode: Edit Plan + transitions + overflow */}
            {!isEditing && !isNew && (
              <>
                {/* Edit Plan: only shown before Final Approval lock (spec §15) */}
                {canEdit && !isApprovalLocked && (
                  embedded && existing?.status === "draft" ? (
                    <ContinueEditingAction
                      recordTitle={existing.title}
                      onClick={() => onContinueEdit?.()}
                    />
                  ) : (
                    <Button size="sm" variant="outline" onPress={embedded ? onContinueEdit : () => setIsEditing(true)}>
                      <Pencil className="h-4 w-4" /> {t("detail.editPlan")}
                    </Button>
                  )
                )}
                {/* Reopen For Editing: shown for post-approval plans where user has plans.reopen (spec §3–5) */}
                {canReopen && isReopenable && (
                  <Button size="sm" variant="outline" onPress={() => setReopenDialogOpen(true)}>
                    <RotateCcw className="h-4 w-4" /> {t("detail.reopenForEditing")}
                  </Button>
                )}
                {/* Primary workflow transition */}
                {availableTransitions.slice(0, 1).map((tr) => (
                  <Button
                    key={tr.action}
                    size="sm"
                    variant={tr.variant === "destructive" ? "danger" : tr.variant === "outline" ? "outline" : "primary"}
                    onPress={() => openTransitionDialog(tr)}
                  >
                    {tr.action === "submit" && <Send className="h-4 w-4" />}
                    {tr.action === "activate" && <CheckCircle2 className="h-4 w-4" />}
                    {t(`transitions.${tr.action}`)}
                  </Button>
                ))}
                {/* Overflow: secondary transitions + Delete */}
                {(availableTransitions.length > 1 || canDelete) && (
                  <Dropdown>
                    <Button isIconOnly size="sm" variant="outline" aria-label={t("detail.moreActions")}>
                      <MoreHorizontal className="size-4" aria-hidden="true" />
                    </Button>
                    <Dropdown.Popover placement="bottom end" className="min-w-44">
                      <Dropdown.Menu
                        aria-label={t("detail.moreActions")}
                        onAction={(key) => {
                          if (key === "__delete__") { setDeleteConfirmOpen(true); return; }
                          const tr = availableTransitions.find((x) => x.action === key);
                          if (tr) openTransitionDialog(tr);
                        }}
                      >
                        {availableTransitions.slice(1).map((tr) => (
                          <Dropdown.Item key={tr.action} id={tr.action} textValue={t(`transitions.${tr.action}`)} variant={tr.variant === "destructive" ? "danger" : undefined}>
                            <Label>{t(`transitions.${tr.action}`)}</Label>
                          </Dropdown.Item>
                        ))}
                        {canDelete ? (
                          <Dropdown.Item id="__delete__" textValue={t("detail.deletePlanMenu")} variant="danger">
                            <Trash2 className="size-4" aria-hidden="true" /><Label>{t("detail.deletePlanMenu")}</Label>
                          </Dropdown.Item>
                        ) : null}
                      </Dropdown.Menu>
                    </Dropdown.Popover>
                  </Dropdown>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Returned-for-revision feedback banner (PLAN-012) ──────────────── */}
      {!isNew && existing && existing.status === "draft" && lastRevisionRequest && (
        <Alert status="warning" role="status" aria-label={t("detail.revisionRequestedAria")}>
          <Alert.Indicator />
          <Alert.Content className="gap-1">
            <Alert.Title>{t("detail.revisionRequested")}</Alert.Title>
            <Alert.Description>
              <span className="font-medium" dir="auto">{lastRevisionRequest.authorName}</span>
              {" · "}
              <bdi dir="ltr" className="text-xs">{formatDate(String(lastRevisionRequest.createdAt).slice(0, 10))}</bdi>
            </Alert.Description>
            {lastRevisionRequest.body && (
              <Alert.Description className="italic" dir="auto">"{lastRevisionRequest.body}"</Alert.Description>
            )}
            <Alert.Description className="text-xs">{t("detail.revisionFeedback")}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <Tabs defaultSelectedKey="overview" aria-label={t("detail.tabsAria")}>
        <Tabs.ListContainer className="overflow-x-auto">
          <Tabs.List aria-label={t("detail.tabsAria")}>
            <Tabs.Tab id="overview">{t("detail.tabPlan")}<Tabs.Indicator /></Tabs.Tab>
            {!isNew && hasPerm(perms, "comments.create") ? <Tabs.Tab id="comments">{t("detail.tabComments")}<Tabs.Indicator /></Tabs.Tab> : null}
            {!isNew ? <Tabs.Tab id="workflow">{t("detail.tabWorkflow")}<Tabs.Indicator /></Tabs.Tab> : null}
            {!isNew ? <Tabs.Tab id="attachments">{t("detail.tabAttachments")}<Tabs.Indicator /></Tabs.Tab> : null}
          </Tabs.List>
        </Tabs.ListContainer>

        <Tabs.Panel id="overview" className="space-y-6 pt-4">

          {/* Section 1: Plan Details — view mode shows structured read-only grid;
                                        edit mode shows the editable form controls */}
          <Card className="gap-3">
            <Card.Header className="pb-3">
              <Card.Title className="text-base font-semibold">{t("detail.section1")}</Card.Title>
            </Card.Header>
            <Card.Content>
              {!isEditing && existing ? (
                /* ── View Mode: two-column structured detail grid ──────── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  <DetailField label={t("detail.planType_label")}>
                    {t(`planTypes.${existing.planType}`, { defaultValue: formatPlanType(existing.planType) })}
                  </DetailField>
                  <DetailField label={t("detail.state_label")}>
                    {getLinkedStateLabel(existing, i18n?.language)}
                  </DetailField>
                  <DetailField label={t("detail.responsible_label")}>
                    {(existing as unknown as { responsibleUserName?: string }).responsibleUserName
                      ?? (existing as unknown as { responsibleName?: string }).responsibleName
                      ?? "—"}
                  </DetailField>
                  <DetailField label={t("detail.implementationPeriod")}>
                    {existing.startDate && existing.endDate
                      ? <bdi dir="ltr">{formatDate(String(existing.startDate).slice(0, 10))} – {formatDate(String(existing.endDate).slice(0, 10))}</bdi>
                      : existing.startDate
                        ? <bdi dir="ltr">{formatDate(String(existing.startDate).slice(0, 10))}</bdi>
                        : "—"}
                  </DetailField>
                  <DetailField label={t("detail.sectors_label")}>
                    {(() => {
                      // PLAN-009: API `sectors` is authoritative — no legacy fallback.
                      const ext = existing as unknown as { sectors?: string[] };
                      const sectors = Array.isArray(ext.sectors) ? ext.sectors : [];
                      return sectors.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 mt-0.5">
                          {sectors.map((s) => (
                            <Chip key={s} size="sm" variant="secondary">{s}</Chip>
                          ))}
                        </div>
                      );
                    })()}
                  </DetailField>
                  {/* Plan-level progress — null means no eligible activities; show — not 0% (PLAN-465) */}
                  <DetailField label={t("detail.planProgress")}>
                    {(existing as unknown as { progressPct?: number | null }).progressPct == null
                      ? <span className="text-[var(--muted)]" title={t("detail.noActivitiesForProgress")}>—</span>
                      : <bdi dir="ltr">{(existing as unknown as { progressPct: number }).progressPct}%</bdi>}
                  </DetailField>
                  <div className="md:col-span-2">
                    <DetailField label={t("detail.description_label")}>
                      {(existing as unknown as { description?: string }).description ? (
                        <span className="whitespace-pre-wrap">
                          {(existing as unknown as { description: string }).description}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </DetailField>
                  </div>
                  {/* UX hint: Final Approval date when available (spec §19) */}
                  {(() => {
                    const ext = existing as unknown as { lastFinalApprovedAt?: string | null };
                    if (!ext.lastFinalApprovedAt) return null;
                    const isPreviouslyApproved = existing.status !== "approved";
                    return (
                      <div className="md:col-span-2">
                        <p className="text-xs text-muted-foreground">
                          {isPreviouslyApproved
                            ? <>{t("detail.previouslyApproved")} · {t("detail.finalApproval", { date: formatDate(String(ext.lastFinalApprovedAt).slice(0, 10)) })}</>
                            : <>{t("detail.finalApproval", { date: formatDate(String(ext.lastFinalApprovedAt).slice(0, 10)) })}</>
                          }
                        </p>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                /* ── Edit Mode: existing editable form controls ─────────── */
                <div className="space-y-4">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label htmlFor="pf-6">{t("detail.planTitle")} <span className="text-destructive">*</span></Label>
                      <Input id="pf-6" fullWidth dir="auto"
                        placeholder={t("detail.planTitlePh")}
                        value={form.title}
                        onChange={(e) => { setField("title", e.target.value); if (editFieldErrors.title) setEditFieldErrors((p) => ({ ...p, title: "" })); }}
                        aria-describedby={editFieldErrors.title ? "edit-err-title" : undefined}
                      />
                      {editFieldErrors.title && <p id="edit-err-title" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.title}</p>}
                    </div>
                    <div>
                      <SelectField
                        label={<>{t("detail.planType")} <span className="text-[var(--danger)]">*</span></>}
                        value={form.planType}
                        onChange={(v) => { setField("planType", v); if (editFieldErrors.planType) setEditFieldErrors((p) => ({ ...p, planType: "" })); }}
                        options={PLAN_TYPES.map((tp) => ({ value: tp, label: t(`planTypes.${tp}`) }))}
                      />
                      {editFieldErrors.planType && <p id="edit-err-planType" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.planType}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <SelectField
                        label={<>{t("fields.state")} <span className="text-[var(--danger)]">*</span></>}
                        value={form.stateId ? String(form.stateId) : ""}
                        placeholder={t("detail.statePh")}
                        onChange={(v) => { setField("stateId", Number(v)); if (editFieldErrors.stateId) setEditFieldErrors((p) => ({ ...p, stateId: "" })); }}
                        options={(states ?? []).map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))}
                      />
                      {editFieldErrors.stateId && <p id="edit-err-state" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.stateId}</p>}
                    </div>
                    <div>
                      <Label htmlFor="pf-7">{t("detail.responsiblePerson")} <span className="text-destructive">*</span></Label>
                      <Input id="pf-7" fullWidth dir="auto"
                        placeholder={t("detail.responsiblePersonPh")}
                        value={form.responsibleName}
                        onChange={(e) => { setField("responsibleName", e.target.value); if (editFieldErrors.responsibleName) setEditFieldErrors((p) => ({ ...p, responsibleName: "" })); }}
                        aria-describedby={editFieldErrors.responsibleName ? "edit-err-responsible" : undefined}
                      />
                      {editFieldErrors.responsibleName && <p id="edit-err-responsible" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.responsibleName}</p>}
                    </div>
                  </div>

                  <div>
                    <Label>{t("detail.sectors")} <span className="text-destructive">*</span></Label>
                    <p className="text-xs text-muted-foreground mt-0.5 mb-2">{t("detail.sectorsDesc")}</p>
                    <SectorPicker selected={form.sectors} onChange={(v) => { setField("sectors", v); if (editFieldErrors.sectors) setEditFieldErrors((p) => ({ ...p, sectors: "" })); }} />
                    {(editFieldErrors.sectors || form.sectors.length === 0) && (
                      <p className="text-xs text-destructive mt-1">{editFieldErrors.sectors || t("detail.atLeastOneSector")}</p>
                    )}
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <DateInput
                        label={t("detail.startDate")}
                        isRequired
                        value={form.startDate}
                        onChange={(v) => { setField("startDate", v); if (editFieldErrors.startDate) setEditFieldErrors((p) => ({ ...p, startDate: "" })); }}
                        isInvalid={!!editFieldErrors.startDate}
                        describedBy={editFieldErrors.startDate ? "edit-err-startDate" : undefined}
                      />
                      {editFieldErrors.startDate && <p id="edit-err-startDate" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.startDate}</p>}
                    </div>
                    <div>
                      <DateInput
                        label={t("detail.endDate")}
                        isRequired
                        value={form.endDate}
                        min={form.startDate || undefined}
                        onChange={(v) => { setField("endDate", v); if (editFieldErrors.endDate) setEditFieldErrors((p) => ({ ...p, endDate: "" })); }}
                        isInvalid={!!editFieldErrors.endDate}
                        describedBy={editFieldErrors.endDate ? "edit-err-endDate" : undefined}
                      />
                      {editFieldErrors.endDate && <p id="edit-err-endDate" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.endDate}</p>}
                    </div>
                  </div>

                  <div>
                    <Label htmlFor="pf-8">{t("detail.description")}</Label>
                    <TextArea id="pf-8" fullWidth dir="auto" rows={3} placeholder={t("detail.descriptionPh")} value={form.description} onChange={(e) => setField("description", e.target.value)} />
                  </div>
                </div>
              )}
            </Card.Content>
          </Card>

          {/* Section 2: Optional Linkage */}
          <Card className="gap-3">
            <Card.Header className="pb-3">
              <Card.Title className="text-base">{t("detail.section2")} <span className="text-sm font-normal text-muted-foreground">{t("detail.section2Optional")}</span></Card.Title>
              <p className="text-xs text-muted-foreground mt-1">{t("detail.section2Desc")}</p>
            </Card.Header>
            <Card.Content>
              {!isEditing ? (
                /* Read-only: plain text — linked project reference or standalone label */
                <p className="text-sm text-foreground">
                  {form.projectId == null
                    ? <span className="text-muted-foreground">{t("detail.standalonePlan")}</span>
                    : (() => {
                        const linked = projects?.find((p) => p.id === form.projectId);
                        return linked
                          ? <span dir="auto"><bdi dir="ltr">{linked.code}</bdi> — {linked.title}</span>
                          : <span className="text-muted-foreground">—</span>;
                      })()}
                </p>
              ) : (
                <SelectField
                  aria-label={t("detail.section2")}
                  className="max-w-md"
                  value={form.projectId == null ? "__none__" : String(form.projectId)}
                  onChange={(v) => setField("projectId", v === "__none__" ? null : Number(v))}
                  isDisabled={!canEdit}
                  options={[
                    { value: "__none__", label: t("detail.standalonePlan") },
                    ...(projects ?? []).map((p) => ({ value: String(p.id), label: `${p.code} — ${p.title}`, textValue: p.title })),
                  ]}
                />
              )}
            </Card.Content>
          </Card>

          {/* Section 3: Localities */}
          <Card className="gap-3">
            <Card.Header className="pb-3">
              <Card.Title className="text-base">{t("detail.section3")}</Card.Title>
              <p className="text-xs text-muted-foreground mt-1">
                {t("detail.section3Desc")}{projectLocalities.length > 0 && t("detail.section3DescWithProject")}
              </p>
            </Card.Header>
            <Card.Content>
              {!isEditing ? (
                /* Read-only: compact locality chips or dash */
                form.localities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {form.localities.map((loc, i) => (
                      <Chip key={i} size="sm" variant="secondary" className="gap-1">
                        <MapPin className="size-3" aria-hidden="true" /> {loc}
                      </Chip>
                    ))}
                  </div>
                )
              ) : (
                <LocalityTagInput
                  localities={form.localities}
                  onChange={(v) => setField("localities", v)}
                  disabled={!canEdit}
                  suggestions={projectLocalities}
                />
              )}
            </Card.Content>
          </Card>

          {/* Section 4: Activities */}
          <Card className="gap-3">
            <Card.Header className="flex flex-row items-start justify-between space-y-0">
              <div>
                <Card.Title className="text-base">
                  {t("detail.section4")} <span className="text-destructive">*</span>
                  {totals.count > 0 && <span className="text-sm font-normal text-muted-foreground ms-2">({t("detail.section4Added", { count: totals.count })})</span>}
                </Card.Title>
                <p className="text-xs text-muted-foreground mt-1">{t("detail.section4Desc")}</p>
              </div>
              {isEditing && canEdit && (
                <Button size="sm" variant="outline" onPress={addActivity}>
                  <Plus className="h-3 w-3" /> {t("activity.addActivity")}
                </Button>
              )}
            </Card.Header>
            <Card.Content className="space-y-4">
              {form.activities.length === 0 && (
                <div className="rounded-xl border border-dashed border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] p-6 text-center">
                  <AlertTriangle className="mx-auto mb-2 size-5 text-[var(--warning)]" aria-hidden="true" />
                  <p className="text-sm font-medium">{t("activity.noActivities")}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">{t("activity.noActivitiesDesc")}</p>
                  {isEditing && canEdit && <Button size="sm" className="mt-3" onPress={addActivity}><Plus className="h-3 w-3" /> {t("activity.addFirstActivity")}</Button>}
                </div>
              )}

              {form.activities.map((a, idx) => (
                <div key={idx} className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]">
                  {/* Card header */}
                  <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
                    <span className="min-w-0 flex-1 break-words text-sm font-medium" dir="auto">
                      {t("activity.activityNum", { num: idx + 1 })}{a.title ? `: ${a.title}` : ""}
                    </span>
                    {isEditing && canEdit && (
                      <Button
                        isIconOnly size="sm"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onPress={() => removeActivity(idx)}
                        aria-label={t("activity.removeActivityAria", { name: a.title || String(idx + 1) })}
                      >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                      </Button>
                    )}
                  </div>

                  {/* Card body — read-only compact view when not editing (no disabled form chrome) */}
                  {!isEditing ? (
                    <div className="px-4 py-3">
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("fields.state")}</dt>
                          <dd>{a.stateName ? getLinkedStateLabel(a, i18n?.language) : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.locality")}</dt>
                          <dd dir="auto" className="rtl:text-end">{a.localityName || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.plannedDate")}</dt>
                          <dd><bdi dir="ltr">{a.plannedDate ? formatDate(a.plannedDate) : "—"}</bdi></dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.priority")}</dt>
                          <dd>{a.priority ? <Chip size="sm" variant="soft" color={PRIORITIES.find((p) => p.value === a.priority)?.color ?? "default"}>{t(`activity.priority_${a.priority}`, { defaultValue: formatStatusLabel(a.priority) })}</Chip> : "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.status")}</dt>
                          <dd>
                            <PlanStatusBadge status={a.status} />
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.progressPct")}</dt>
                          <dd className="tabular-nums"><bdi dir="ltr">{a.progressPct}%</bdi></dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.targetBeneficiaries")}</dt>
                          <dd className="tabular-nums"><bdi dir="ltr">{a.targetBeneficiaries != null ? a.targetBeneficiaries.toLocaleString() : "—"}</bdi></dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.plannedBudget")}</dt>
                          <dd className="tabular-nums"><bdi dir="ltr">{a.budgetPlanned != null ? formatCurrency(a.budgetPlanned) : "—"}</bdi></dd>
                        </div>
                        {a.responsibleName && (
                          <div>
                            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.responsiblePerson")}</dt>
                            <dd dir="auto" className="rtl:text-end">{a.responsibleName}</dd>
                          </div>
                        )}
                        {a.expectedResult && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.expectedResult")}</dt>
                            <dd className="whitespace-pre-wrap rtl:text-end" dir="auto">{a.expectedResult}</dd>
                          </div>
                        )}
                      </dl>
                      <ActivityOptionalFieldsReadOnly a={a} risks={risks} />
                    </div>
                  ) : (
                  <div className="px-4 py-3 space-y-2.5">
                    {/* Activity title */}
                    <div>
                      <Label htmlFor={`pf-9-${idx}`} className="text-sm">{t("activity.activityTitle")} <span className="text-destructive">*</span></Label>
                      <Input id={`pf-9-${idx}`} fullWidth dir="auto" placeholder={t("activity.activityTitlePh")} value={a.title} onChange={(e) => updateActivity(idx, { title: e.target.value })} disabled={!canEdit} />
                    </div>

                    {/* State | Locality */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <SelectField
                          label={<>{t("fields.state")} <span className="text-[var(--danger)]">*</span></>}
                          value={a.stateId ? String(a.stateId) : "__none__"}
                          placeholder={t("detail.statePh")}
                          onChange={(v) => {
                            const sid = v === "__none__" ? null : Number(v);
                            const found = v === "__none__" ? undefined : states?.find((s) => s.id === Number(v));
                            updateActivity(idx, { stateId: sid, stateName: found?.name ?? "", stateNameAr: found?.nameAr ?? null });
                          }}
                          isDisabled={!canEdit}
                          options={[{ value: "__none__", label: "—" }, ...(states ?? []).map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))]}
                        />
                      </div>
                      <div>
                        <Label className="text-sm">{t("activity.locality")} <span className="text-destructive">*</span></Label>
                        <ActivityLocalityInput
                          value={a.localityName}
                          onChange={(v) => updateActivity(idx, { localityName: v })}
                          disabled={!canEdit}
                          suggestions={localitySuggestions}
                        />
                      </div>
                    </div>

                    {/* Planned date | Priority */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <DateInput
                          label={t("activity.plannedDate")}
                          isRequired
                          value={a.plannedDate}
                          onChange={(v) => updateActivity(idx, { plannedDate: v })}
                          isDisabled={!canEdit}
                          min={form.startDate || undefined}
                          max={form.endDate || undefined}
                        />
                      </div>
                      <div>
                        <SelectField
                          label={<>{t("activity.priority")} <span className="text-[var(--danger)]">*</span></>}
                          value={a.priority}
                          onChange={(v) => updateActivity(idx, { priority: v })}
                          isDisabled={!canEdit}
                          options={PRIORITIES.map((p) => ({
                            value: p.value,
                            textValue: t(`activity.priority_${p.value}`),
                            label: <Chip size="sm" variant="soft" color={p.color}>{t(`activity.priority_${p.value}`)}</Chip>,
                          }))}
                        />
                      </div>
                    </div>

                    {/* Target beneficiaries | Planned budget */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={`pf-10-${idx}`} className="text-sm">{t("activity.targetBeneficiaries")} <span className="text-destructive">*</span></Label>
                        <Input id={`pf-10-${idx}`} fullWidth type="number" min={0} value={a.targetBeneficiaries} onChange={(e) => updateActivity(idx, { targetBeneficiaries: Number(e.target.value) })} disabled={!canEdit} />
                      </div>
                      <div>
                        <Label htmlFor={`pf-11-${idx}`} className="text-sm">{t("activity.plannedBudget")} <span className="text-destructive">*</span></Label>
                        <Input id={`pf-11-${idx}`} fullWidth type="number" min={0} value={a.budgetPlanned} onChange={(e) => updateActivity(idx, { budgetPlanned: Number(e.target.value) })} disabled={!canEdit} />
                      </div>
                    </div>

                    {/* Responsible person */}
                    <div className="max-w-sm">
                      <Label htmlFor={`pf-12-${idx}`} className="text-sm">{t("activity.responsiblePerson")}</Label>
                      <Input id={`pf-12-${idx}`} fullWidth dir="auto" placeholder={t("activity.responsiblePersonPh")} value={a.responsibleName} onChange={(e) => updateActivity(idx, { responsibleName: e.target.value })} disabled={!canEdit} />
                    </div>

                    {/* Expected result */}
                    <div>
                      <Label htmlFor={`pf-13-${idx}`} className="text-sm">{t("activity.expectedResult")} <span className="text-destructive">*</span></Label>
                      <TextArea id={`pf-13-${idx}`} fullWidth dir="auto" rows={2} placeholder={t("activity.expectedResultPh")} value={a.expectedResult} onChange={(e) => updateActivity(idx, { expectedResult: e.target.value })} disabled={!canEdit} className="resize-y" />
                    </div>

                    <ActivityOptionalFields a={a} idx={idx} updateActivity={updateActivity} canEdit={canEdit} risks={risks} />
                  </div>
                  )}
                </div>
              ))}
            </Card.Content>
          </Card>

          {/* Section 5: Budget & Totals */}
          <Card className="gap-3">
            <Card.Header><Card.Title className="text-base">{t("detail.section5")}</Card.Title></Card.Header>
            <Card.Content className="space-y-4">
              {!isEditing ? (
                /* View mode — clean read-only figures, no disabled form chrome (PLAN-552) */
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.currency")}</dt>
                    <dd className="text-sm font-medium">{form.currency || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.planBudgetPlanned")}</dt>
                    <dd className="text-sm font-medium tabular-nums"><bdi dir="ltr">{form.budgetPlanned != null ? formatCurrency(form.budgetPlanned, form.currency) : "—"}</bdi></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.planBudgetActual")}</dt>
                    <dd className="text-sm font-medium tabular-nums"><bdi dir="ltr">{form.budgetActual != null ? formatCurrency(form.budgetActual, form.currency) : "—"}</bdi></dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.fundingSource")}</dt>
                    <dd className="text-sm font-medium">{form.fundingSource || "—"}</dd>
                  </div>
                </dl>
              ) : (
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <SelectField
                    label={t("detail.currency")}
                    value={form.currency ?? "USD"}
                    onChange={(v) => setField("currency", v)}
                    isDisabled={!canEdit}
                    options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                  />
                </div>
                <div>
                  <Label htmlFor="pf-14">{t("detail.planBudgetPlanned")}</Label>
                  <Input id="pf-14" fullWidth type="number" min={0} value={form.budgetPlanned ?? 0} onChange={(e) => setField("budgetPlanned", Number(e.target.value))} disabled={!canEdit} />
                </div>
                <div>
                  <Label htmlFor="pf-15">{t("detail.planBudgetActual")}</Label>
                  <Input id="pf-15" fullWidth type="number" min={0} value={form.budgetActual ?? 0} onChange={(e) => setField("budgetActual", Number(e.target.value))} disabled={!canEdit} />
                </div>
                <div>
                  <Label htmlFor="pf-16">{t("detail.fundingSource")}</Label>
                  <Input id="pf-16" fullWidth dir="auto" placeholder={t("detail.fundingSourcePh")} value={form.fundingSource} onChange={(e) => setField("fundingSource", e.target.value)} disabled={!canEdit} />
                </div>
              </div>
              )}

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("detail.totalActivities")}</p>
                  <p className="font-bold text-2xl leading-none">{totals.count}</p>
                  <p className="text-xs text-muted-foreground mt-1">{totals.completed} {t("activity.completed")} · {totals.delayed > 0 ? <span className="text-warning">{t("detail.delayedCount", { count: totals.delayed })}</span> : t("detail.zeroDelayed")}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("detail.totalBeneficiaries")}</p>
                  <p className="font-bold text-2xl leading-none">{totals.totalBeneficiaries.toLocaleString()}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("detail.targetAcrossActivities")}</p>
                </div>
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground mb-1">{t("detail.activityBudget")}</p>
                  <p className="font-bold text-xl leading-none"><bdi dir="ltr">{formatCurrency(totals.plannedBudget)}</bdi></p>
                  <p className="text-xs text-muted-foreground mt-1">{t("detail.plannedTotal")}</p>
                </div>
                <div className={`rounded-lg border p-3 ${totals.plannedBudget > 0 && totals.actualBudget / totals.plannedBudget > 1 ? "bg-destructive/10 border-destructive/30" : "bg-success/10 border-success/30"}`}>
                  <p className="text-xs text-muted-foreground mb-1">{t("detail.burnRate")}</p>
                  <p className={`font-bold text-2xl leading-none ${totals.plannedBudget > 0 && totals.actualBudget / totals.plannedBudget > 1 ? "text-destructive" : "text-success"}`}>
                    <bdi dir="ltr">{totals.plannedBudget > 0 ? Math.round((totals.actualBudget / totals.plannedBudget) * 100) : 0}%</bdi>
                  </p>
                  <p className="text-xs text-muted-foreground mt-1"><bdi dir="ltr">{formatCurrency(totals.actualBudget)}</bdi> {t("detail.actual")}</p>
                </div>
              </div>
            </Card.Content>
          </Card>

          {/* Section 6: Linked Risks (read-only) */}
          {!isNew && existing && (
            <Card className="gap-3">
              <Card.Header>
                <Card.Title className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" /> {t("detail.section6")}
                </Card.Title>
              </Card.Header>
              <Card.Content className="p-0">
                {(existing.linkedRisks ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-6">{t("detail.noLinkedRisks")}</p>
                ) : (
                  <DataGrid
                    aria-label={t("detail.section6")}
                    data={existing.linkedRisks ?? []}
                    getRowId={(r) => r.id}
                    contentClassName="min-w-[640px]"
                    columns={[
                      { id: "title", header: t("detail.riskTitle"), isRowHeader: true,
                        cell: (r) => <span dir="auto" className="block whitespace-normal break-words rtl:text-end">{r.title}</span> },
                      { id: "severity", header: t("detail.riskSeverity"), width: 120,
                        cell: (r) => <Chip size="sm" variant="soft" color={r.severity === "critical" || r.severity === "high" ? "danger" : r.severity === "medium" ? "warning" : "default"}>{tRisks(`presentation.riskLevels.${r.severity}`, { defaultValue: r.severity })}</Chip> },
                      { id: "status", header: t("detail.riskStatus"), width: 150,
                        cell: (r) => <span className="text-sm">{tRisks(`status.${r.status}`, { defaultValue: formatStatusLabel(r.status) })}</span> },
                      { id: "identified", header: t("detail.riskIdentified"), width: 130,
                        cell: (r) => <bdi dir="ltr" className="text-sm text-[var(--muted)]">{formatDate(r.identifiedAt)}</bdi> },
                    ]}
                  />
                )}
              </Card.Content>
            </Card>
          )}

        </Tabs.Panel>

        {!isNew && planId && (
          <Tabs.Panel id="comments" className="pt-4">
            <CommentsPanel
              entityType="plan" entityId={planId}
              sections={["Basics", "Activities", "Budget", "Risks"]}
              currentUserId={me?.user?.id ?? null}
              currentUserRole={me?.user?.role ?? null}
            />
          </Tabs.Panel>
        )}

        {!isNew && planId && (
          <Tabs.Panel id="attachments" className="pt-4">
            <DriveAttachmentPanel
              module="plans"
              recordId={planId}
              canUpload={hasPerm(perms, "plans.update") || hasPerm(perms, "plans.create")}
              canDelete={canDelete}
            />
          </Tabs.Panel>
        )}

        {!isNew && existing && (
          <Tabs.Panel id="workflow" className="space-y-4 pt-4">
            <Card className="gap-3">
              <Card.Header><Card.Title className="text-base">{t("detail.workflowCurrentStatus")}</Card.Title></Card.Header>
              <Card.Content>
                <PlanStatusBadge status={existing.status} />
                <p className="text-sm text-muted-foreground mt-3">
                  {t("detail.workflowApprovalChain")} <span className="font-medium">{t("detail.workflowApprovalChainValue")}</span>
                </p>
              </Card.Content>
            </Card>
            <Card className="gap-3">
              <Card.Header><Card.Title className="text-base">{t("detail.workflowActionsAvailable")}</Card.Title></Card.Header>
              <Card.Content className="flex flex-row flex-wrap gap-2">
                {availableTransitions.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("detail.workflowNoTransitions")}</p>
                )}
                {availableTransitions.map((tr) => (
                  <Button
                    key={tr.action}
                    variant={tr.variant === "destructive" ? "danger" : tr.variant === "outline" ? "outline" : "primary"}
                    size="sm"
                    onPress={() => openTransitionDialog(tr)}
                  >
                    {tr.action === "submit" && <Send className="h-3 w-3" />}
                    {(tr.action === "final_approve" || tr.action === "complete") && <CheckCircle2 className="h-3 w-3" />}
                    {(tr.action === "reject" || tr.action === "cancel") && <X className="h-3 w-3" />}
                    {t(`transitions.${tr.action}`)}
                  </Button>
                ))}
              </Card.Content>
            </Card>
          </Tabs.Panel>
        )}
      </Tabs>

      {/* ── Sticky edit-mode footer (Phase 9) ─────────────────────────────── */}
      {/* Keeps Save Changes / Cancel reachable on long plans with many activities */}
      {isEditing && (
        <div
          className="sticky bottom-0 z-10 flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--background)] px-6 py-3"
          data-testid="edit-sticky-footer"
        >
          <Button
            variant="outline"
            onPress={isNew ? () => setLocation("/plans") : onCancel}
            isDisabled={createMutation.isPending || updateMutation.isPending}
          >
            <X className="h-4 w-4" aria-hidden="true" /> {t("detail.cancelEdit")}
          </Button>
          <Button
            onPress={onSave}
            isPending={createMutation.isPending || updateMutation.isPending}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {isNew ? t("createPlan") : t("detail.saveChanges")}
          </Button>
        </div>
      )}

      {/* ── Workflow transition ─────────────────────────────────────────── */}
      <Modal isOpen={!!transitionDialog} onOpenChange={(o) => { if (!o) { setTransitionDialog(null); setTransitionComment(""); } }}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{transitionDialog?.label}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">
                  {transitionDialog?.requiresComment ? t("detail.requiresRationale") : t("detail.confirmAction")}
                </p>
              </Modal.Header>
              <Modal.Body>
                <TextField value={transitionComment} onChange={setTransitionComment} isRequired={!!transitionDialog?.requiresComment} fullWidth>
                  <Label>{transitionDialog?.requiresComment ? t("detail.commentRequired") : t("detail.commentOptional")}</Label>
                  <TextArea rows={3} />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={() => { setTransitionDialog(null); setTransitionComment(""); }}>{t("detail.confirmCancel")}</Button>
                <Button
                  onPress={onTransition}
                  isPending={transitionMutation.isPending}
                  isDisabled={!transitionMutation.isPending && !!transitionDialog?.requiresComment && !transitionComment.trim()}
                >
                  {transitionMutation.isPending && <Spinner size="sm" color="current" />}
                  {t("detail.confirmConfirm")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Dedicated Rejection Dialog ───────────────────────────────────── */}
      <Modal isOpen={rejectDialog} onOpenChange={(o) => { if (!o) onRejectCancel(); }}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t("detail.rejectPlanTitle")}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">{t("detail.rejectPlanDesc")}</p>
              </Modal.Header>
              <Modal.Body>
                <TextField
                  value={rejectReason}
                  onChange={(v) => { setRejectReason(v); if (rejectReasonError) setRejectReasonError(""); }}
                  isRequired
                  isInvalid={!!rejectReasonError}
                  fullWidth
                >
                  <Label>{t("detail.rejectionReason")}</Label>
                  <TextArea id="reject-reason" rows={3} placeholder={t("detail.rejectionReasonPh")} autoFocus />
                  {rejectReasonError && (
                    <p id="reject-reason-error" role="alert" className="text-sm text-[var(--danger)]">{rejectReasonError}</p>
                  )}
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={onRejectCancel} isDisabled={transitionMutation.isPending}>
                  {t("detail.confirmCancel")}
                </Button>
                <Button variant="danger" onPress={onRejectConfirm} isPending={transitionMutation.isPending}>
                  {transitionMutation.isPending && <Spinner size="sm" color="current" />}
                  {transitionMutation.isPending ? t("detail.rejecting") : t("detail.rejectPlan")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── Reopen For Editing Dialog (spec §6) ──────────────────────────── */}
      <Modal isOpen={reopenDialogOpen} onOpenChange={(o) => { if (!o) { setReopenDialogOpen(false); setReopenReason(""); } }}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t("detail.reopenPlanTitle")}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">{t("detail.reopenPlanDesc")}</p>
              </Modal.Header>
              <Modal.Body className="space-y-3 text-sm">
                {existing && (
                  <dl className="space-y-1 rounded-xl bg-[var(--surface-secondary)] px-3 py-2.5">
                    <div><dt className="inline text-[var(--muted)]">{t("detail.planCode")} </dt><dd className="inline font-mono font-medium"><bdi dir="ltr">{(existing as unknown as { code?: string }).code ?? "—"}</bdi></dd></div>
                    <div><dt className="inline text-[var(--muted)]">{t("detail.planTitle_label")} </dt><dd className="inline font-medium" dir="auto">{existing.title}</dd></div>
                    <div className="flex items-center gap-1"><dt className="text-[var(--muted)]">{t("detail.currentStatus")} </dt><dd><PlanStatusBadge status={existing.status} /></dd></div>
                    {(() => {
                      const ext = existing as unknown as { lastFinalApprovedAt?: string | null };
                      return ext.lastFinalApprovedAt ? (
                        <div><dt className="inline text-[var(--muted)]">{t("detail.lastApproved")} </dt><dd className="inline"><bdi dir="ltr">{formatDate(String(ext.lastFinalApprovedAt).slice(0, 10))}</bdi></dd></div>
                      ) : null;
                    })()}
                  </dl>
                )}
                <TextField value={reopenReason} onChange={setReopenReason} isRequired fullWidth>
                  <Label>{t("detail.reasonForReopening")}</Label>
                  <TextArea id="reopen-reason" rows={3} placeholder={t("detail.reasonForReopeningPh")} />
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={() => { setReopenDialogOpen(false); setReopenReason(""); }} isDisabled={reopenMutation.isPending}>
                  {t("detail.confirmCancel")}
                </Button>
                <Button
                  onPress={() => { if (planId) reopenMutation.mutate({ planId, data: { reason: reopenReason } }); }}
                  isPending={reopenMutation.isPending}
                  isDisabled={!reopenMutation.isPending && !reopenReason.trim()}
                >
                  {reopenMutation.isPending ? <Spinner size="sm" color="current" /> : <RotateCcw className="size-4" aria-hidden="true" />}
                  {reopenMutation.isPending ? t("detail.reopening") : t("detail.reopenForEditing")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <ConfirmModal
        isOpen={discardConfirmOpen}
        title={t("detail.discardTitle")}
        message={t("detail.discardChanges")}
        confirmLabel={t("detail.discardConfirm")}
        cancelLabel={t("detail.keepEditing")}
        onConfirm={discardChanges}
        onCancel={() => setDiscardConfirmOpen(false)}
      />
      <ConfirmModal
        isOpen={deleteConfirmOpen}
        title={t("detail.deletePlanMenu")}
        message={t("detail.deletePlanConfirm")}
        confirmLabel={t("detail.deletePlanMenu")}
        cancelLabel={tCommon("cancel")}
        isPending={deleteMutation.isPending}
        onConfirm={() => { if (planId) deleteMutation.mutate({ planId }); }}
        onCancel={() => setDeleteConfirmOpen(false)}
      />
    </div>
  );
}
