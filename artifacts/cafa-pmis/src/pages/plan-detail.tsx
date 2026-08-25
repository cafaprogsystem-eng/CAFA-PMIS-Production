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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowLeft, Plus, Trash2, Save, Send, CheckCircle2, X, ChevronRight, AlertTriangle, MapPin, AlertCircle, ChevronDown, ChevronUp, Pencil, MoreHorizontal, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { formatDate, formatCurrency, formatStatusLabel, formatPlanType, hasPerm, statusBadgeVariant, formatLocation } from "@/lib/format";
import { getLinkedStateLabel } from "@/components/state-label";
import { CommentsPanel } from "@/components/comments-panel";
import { DriveAttachmentPanel } from "@/components/drive-attachment-panel";
import { SECTORS } from "@/lib/sectors";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const PLAN_TYPES = ["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"] as const;
const ACTIVITY_STATUSES = ["planned", "in_progress", "completed", "delayed", "cancelled"] as const;
const PRIORITIES = [
  { value: "high", label: "High", cls: "bg-destructive/10 text-destructive border-destructive/20" },
  { value: "medium", label: "Medium", cls: "bg-warning/10 text-warning border-warning/20" },
  { value: "low", label: "Low", cls: "bg-muted text-muted-foreground border-border" },
] as const;
const CURRENCIES = ["USD", "EUR", "SDG", "AED"];

/**
 * PLAN-BD-4: Client-side mirror of the backend status/progress consistency contract.
 * Returns a British English validation message or null when valid.
 */
function validateActivityProgressConsistency(status: string, progressPct: number): string | null {
  switch (status) {
    case "completed":
      if (progressPct !== 100) return "Completed activities must have 100% progress.";
      break;
    case "in_progress":
      if (progressPct < 1 || progressPct > 99) return "In-progress activities must have progress between 1% and 99%.";
      break;
    case "planned":
    case "delayed":
      if (progressPct < 0 || progressPct > 99) return `${status.charAt(0).toUpperCase() + status.slice(1)} activities must have progress between 0% and 99%.`;
      break;
    case "cancelled":
      if (progressPct < 0 || progressPct > 100) return "Progress must be between 0% and 100%.";
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

/** Shared status badge — same appearance as Plans table and cards. */
function PlanStatusBadge({ status }: { status: string }) {
  const { variant, className } = statusBadgeVariant(status);
  return <Badge variant={variant} className={className}>{formatStatusLabel(status)}</Badge>;
}

/** View-mode label/value pair used in the Plan Details grid. */
function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 min-w-0">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm text-foreground break-words">{children}</span>
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

// TRANSITIONS: labels are translated at render time using t("transitions.X")
const TRANSITIONS: Array<{
  action: string; from: string[]; perm: string;
  requiresComment?: boolean; variant?: "default" | "destructive" | "outline";
}> = [
  { action: "submit", from: ["draft"], perm: "plans.create" },
  { action: "technical_review", from: ["submitted"], perm: "projects.approve.technical" },
  { action: "coordination_review", from: ["technically_approved"], perm: "plans.approve.coordination" },
  { action: "final_approve", from: ["coordination_approved"], perm: "plans.approve.final" },
  { action: "activate", from: ["approved"], perm: "plans.update" },
  { action: "start", from: ["active"], perm: "plans.update" },
  { action: "mark_delayed", from: ["active", "in_progress"], perm: "plans.update", variant: "outline" },
  { action: "complete", from: ["active", "in_progress", "delayed"], perm: "plans.update" },
  { action: "archive", from: ["completed", "cancelled"], perm: "plans.update", variant: "outline" },
  { action: "request_revision", from: ["submitted", "technically_approved", "coordination_approved"], perm: "projects.approve.technical", requiresComment: true, variant: "outline" },
  { action: "reject", from: ["submitted", "technically_approved", "coordination_approved"], perm: "projects.approve.technical", requiresComment: true, variant: "destructive" },
  { action: "cancel", from: ["draft", "submitted", "technically_approved", "coordination_approved", "approved", "active", "in_progress", "delayed"], perm: "plans.update", variant: "destructive" },
];

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
            <Input
              placeholder={t("detail.localityPh")}
              value={inputVal}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }}
            />
            <Button type="button" variant="outline" size="sm" onClick={() => addLocality()} disabled={!inputVal.trim()}>
              <Plus className="h-3 w-3" /> {t("detail.addLocality")}
            </Button>
          </div>
          {similar && (
            <Alert className="py-2 border-warning/30 bg-warning/10">
              <AlertCircle className="h-3.5 w-3.5 text-warning" />
              <AlertDescription className="text-xs text-warning flex items-center gap-2">
                {t("detail.similarTo", { name: similar })}
                <Button size="sm" variant="outline" className="border-warning/40" onClick={() => addLocality(similar)}>{t("detail.useExisting")}</Button>
                <Button size="sm" variant="ghost" onClick={() => setSimilar(null)}>{t("detail.keepMine")}</Button>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}
      {localities.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {localities.map((loc, i) => (
            <span key={i} className="inline-flex items-center gap-1 bg-primary/10 text-primary border border-primary/20 rounded-full px-2.5 py-0.5 text-xs font-medium">
              <MapPin className="h-2.5 w-2.5" /> {loc}
              {!disabled && (
                <button type="button" onClick={() => onChange(localities.filter((_, j) => j !== i))} className="ms-0.5 rounded-full hover:bg-blue-200 p-0.5">
                  <X className="h-2.5 w-2.5" />
                </button>
              )}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">{t("detail.noLocalitiesYet")}</p>
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
      <Input
        placeholder={t("detail.activityLocalityPh")}
        value={value}
        onChange={(e) => onInputChange(e.target.value)}
        disabled={disabled}
      />
      {similar && !disabled && (
        <Alert className="py-1.5 border-warning/30 bg-warning/10">
          <AlertCircle className="h-3 w-3 text-warning" />
          <AlertDescription className="text-xs text-warning flex items-center gap-1.5 flex-wrap">
            {t("detail.similarTo", { name: similar })}
            <Button size="sm" variant="outline" className="border-warning/30" onClick={() => { onChange(similar); setSimilar(null); }}>{t("detail.useExisting")}</Button>
            <Button size="sm" variant="ghost" onClick={() => setSimilar(null)}>{t("detail.keep")}</Button>
          </AlertDescription>
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
          <button
            key={s}
            type="button"
            onClick={() => toggle(s)}
            disabled={disabled}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:border-primary/50"
            } ${disabled ? "opacity-60 cursor-default" : "cursor-pointer"}`}
          >
            {s}
          </button>
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
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-2 mt-2">
      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? t("activity.hideOptional") : t("activity.showOptional")}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid md:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">{t("activity.status")}</Label>
              <Select value={a.status} onValueChange={(v) => {
                const patch: Partial<ActivityFormData> = { status: v };
                if (v === "completed") patch.progressPct = 100;
                updateActivity(idx, patch);
              }} disabled={!canEdit}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("activity.progressPct")}</Label>
              <Input type="number" min={0} max={100} value={a.progressPct} onChange={(e) => updateActivity(idx, { progressPct: Number(e.target.value) })} disabled={!canEdit} />
            </div>
            <div>
              <Label className="text-xs">{t("activity.budgetActual")}</Label>
              <Input type="number" min={0} value={a.budgetActual} onChange={(e) => updateActivity(idx, { budgetActual: Number(e.target.value) })} disabled={!canEdit} />
            </div>
            <div>
              <Label className="text-xs">{t("activity.linkedRisk")}</Label>
              <Select value={a.riskId ? String(a.riskId) : "__none__"} onValueChange={(v) => updateActivity(idx, { riskId: v === "__none__" ? null : Number(v) })} disabled={!canEdit}>
                <SelectTrigger><SelectValue placeholder={t("detail.none")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("detail.none")}</SelectItem>
                  {risks?.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.title} ({r.severity})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t("activity.expectedOutput")}</Label>
              <Input value={a.expectedOutput} onChange={(e) => updateActivity(idx, { expectedOutput: e.target.value })} disabled={!canEdit} />
            </div>
            <div>
              <Label className="text-xs">{t("activity.performanceIndicator")}</Label>
              <Input value={a.performanceIndicator} onChange={(e) => updateActivity(idx, { performanceIndicator: e.target.value })} disabled={!canEdit} />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("activity.activityName")}</Label>
            <Textarea rows={2} value={a.description} onChange={(e) => updateActivity(idx, { description: e.target.value })} disabled={!canEdit} />
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
            <dd className="tabular-nums">{formatCurrency(a.budgetActual)}</dd>
          </div>
        )}
        {a.riskId != null && (
          <div>
            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.linkedRisk")}</dt>
            <dd>{linkedRisk ? `${linkedRisk.title} (${linkedRisk.severity})` : "—"}</dd>
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
      description: [existing.code, formatStatusLabel(existing.status)].filter(Boolean).join(" · "),
    });
  }, [existing, onRecordLoaded]);

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
    if (!form.title.trim()) return "Plan Title is required";
    if (!form.planType) return "Plan Type is required";
    if (!form.stateId) return "State is required";
    if (form.sectors.length === 0) return "At least one Sector is required";
    if (!form.responsibleName.trim()) return "Responsible Person is required";
    if (!form.startDate || !form.endDate) return "Start and End Dates are required";
    if (form.endDate < form.startDate) return "End Date must be on or after Start Date";
    for (let i = 0; i < form.activities.length; i++) {
      const a = form.activities[i];
      if (!a.title.trim()) return `Activity #${i + 1}: Title is required`;
      if (!a.localityName.trim()) return `Activity #${i + 1}: Locality is required`;
      if (!a.plannedDate) return `Activity #${i + 1}: Planned Date is required`;
      if (form.startDate && a.plannedDate < form.startDate) return `Activity #${i + 1}: Planned Date must be within the plan schedule`;
      if (form.endDate && a.plannedDate > form.endDate) return `Activity #${i + 1}: Planned Date must be within the plan schedule`;
      if (a.targetBeneficiaries < 0) return `Activity #${i + 1}: Target Beneficiaries cannot be negative`;
      if (a.budgetPlanned < 0) return `Activity #${i + 1}: Budget cannot be negative`;
      if (!a.expectedResult.trim()) return `Activity #${i + 1}: Expected Result is required`;
      const progressErr = validateActivityProgressConsistency(a.status, a.progressPct);
      if (progressErr) return `Activity #${i + 1}: ${progressErr}`;
    }
    if (forSubmit && form.activities.length === 0) return "At least one Activity is required before submitting";
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
    // Confirm before discarding unsaved changes (same pattern as Delete confirmation)
    if (
      window.confirm(t("detail.discardChanges"))
    ) {
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
          <CardContent className="flex flex-col items-center gap-3 py-10">
            <AlertCircle className="h-8 w-8 text-destructive/50" />
            <p className="text-sm font-medium text-foreground">{t("detail.planNotFound")}</p>
            <Button variant="outline" size="sm" asChild>
              <Link href="/plans">{t("detail.backToPlans")}</Link>
            </Button>
          </CardContent>
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
            <h1 className="text-2xl font-bold tracking-tight leading-snug break-words">
              {isNew ? t("detail.newPlan") : existing?.title ?? t("detail.plan")}
            </h1>
            {existing && (
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <span className="font-mono text-xs bg-muted/60 px-1.5 py-0.5 rounded">{existing.code}</span>
                <span className="text-muted-foreground/40">·</span>
                <span>{formatPlanType(existing.planType)}</span>
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
                  onClick={isNew ? () => setLocation("/plans") : onCancel}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  aria-busy={createMutation.isPending || updateMutation.isPending}
                >
                  <X className="h-4 w-4" aria-hidden="true" /> {t("detail.cancelEdit")}
                </Button>
                <Button
                  size="sm"
                  onClick={onSave}
                  disabled={createMutation.isPending || updateMutation.isPending}
                  aria-busy={createMutation.isPending || updateMutation.isPending}
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
                    <Button size="sm" variant="outline" onClick={embedded ? onContinueEdit : () => setIsEditing(true)}>
                      <Pencil className="h-4 w-4" /> {t("detail.editPlan")}
                    </Button>
                  )
                )}
                {/* Reopen For Editing: shown for post-approval plans where user has plans.reopen (spec §3–5) */}
                {canReopen && isReopenable && (
                  <Button size="sm" variant="outline" onClick={() => setReopenDialogOpen(true)}>
                    <RotateCcw className="h-4 w-4" /> {t("detail.reopenForEditing")}
                  </Button>
                )}
                {/* Primary workflow transition */}
                {availableTransitions.slice(0, 1).map((tr) => (
                  <Button
                    key={tr.action}
                    size="sm"
                    variant={(tr.variant as "default" | "outline" | "destructive") ?? "default"}
                    onClick={() => openTransitionDialog(tr)}
                  >
                    {tr.action === "submit" && <Send className="h-4 w-4" />}
                    {tr.action === "activate" && <CheckCircle2 className="h-4 w-4" />}
                    {t(`transitions.${tr.action}`)}
                  </Button>
                ))}
                {/* Overflow: secondary transitions + Delete */}
                {(availableTransitions.length > 1 || canDelete) && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="sm" variant="outline" aria-label={t("detail.moreActions")}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-[160px]">
                      {availableTransitions.slice(1).map((tr) => (
                        <DropdownMenuItem
                          key={tr.action}
                          className={tr.variant === "destructive" ? "text-destructive focus:text-destructive" : ""}
                          onClick={() => openTransitionDialog(tr)}
                        >
                          {t(`transitions.${tr.action}`)}
                        </DropdownMenuItem>
                      ))}
                      {availableTransitions.length > 1 && canDelete && <DropdownMenuSeparator />}
                      {canDelete && (
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => { if (confirm(t("detail.deletePlanConfirm"))) deleteMutation.mutate({ planId: planId! }); }}
                        >
                          <Trash2 className="h-4 w-4 me-2" /> {t("detail.deletePlanMenu")}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Returned-for-revision feedback banner (PLAN-012) ──────────────── */}
      {!isNew && existing && existing.status === "draft" && lastRevisionRequest && (
        <div
          role="status"
          aria-label={t("detail.revisionRequestedAria")}
          className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-1.5"
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("detail.revisionRequested")}</span>
          </div>
          <p className="text-sm text-amber-700 dark:text-amber-300 ps-6">
            <span className="font-medium">{lastRevisionRequest.authorName}</span>
            {" · "}
            <span className="text-xs text-amber-600/80">{formatDate(String(lastRevisionRequest.createdAt).slice(0, 10))}</span>
          </p>
          {lastRevisionRequest.body && (
            <p className="text-sm text-amber-700/90 dark:text-amber-300/90 ps-6 italic">
              "{lastRevisionRequest.body}"
            </p>
          )}
          <p className="text-xs text-amber-600/70 dark:text-amber-400/70 ps-6">
            {t("detail.revisionFeedback")}
          </p>
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="overview">{t("detail.tabPlan")}</TabsTrigger>
          {!isNew && hasPerm(perms, "comments.create") && <TabsTrigger value="comments">{t("detail.tabComments")}</TabsTrigger>}
          {!isNew && <TabsTrigger value="workflow">{t("detail.tabWorkflow")}</TabsTrigger>}
          {!isNew && <TabsTrigger value="attachments">{t("detail.tabAttachments")}</TabsTrigger>}
        </TabsList>

        <TabsContent value="overview" className="space-y-6 mt-6">

          {/* Section 1: Plan Details — view mode shows structured read-only grid;
                                        edit mode shows the editable form controls */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold">{t("detail.section1")}</CardTitle>
            </CardHeader>
            <CardContent>
              {!isEditing && existing ? (
                /* ── View Mode: two-column structured detail grid ──────── */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-5">
                  <DetailField label={t("detail.planType_label")}>
                    {formatPlanType(existing.planType)}
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
                      ? `${formatDate(String(existing.startDate).slice(0, 10))} – ${formatDate(String(existing.endDate).slice(0, 10))}`
                      : existing.startDate
                        ? formatDate(String(existing.startDate).slice(0, 10))
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
                            <Badge key={s} variant="outline" className="text-xs font-normal">{s}</Badge>
                          ))}
                        </div>
                      );
                    })()}
                  </DetailField>
                  {/* Plan-level progress — null means no eligible activities; show — not 0% (PLAN-465) */}
                  <DetailField label={t("detail.planProgress")}>
                    {(existing as unknown as { progressPct?: number | null }).progressPct == null
                      ? <span className="text-muted-foreground" title={t("detail.noActivitiesForProgress")}>—</span>
                      : `${(existing as unknown as { progressPct: number }).progressPct}%`}
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
                      <Label>{t("detail.planTitle")} <span className="text-destructive">*</span></Label>
                      <Input
                        placeholder={t("detail.planTitlePh")}
                        value={form.title}
                        onChange={(e) => { setField("title", e.target.value); if (editFieldErrors.title) setEditFieldErrors((p) => ({ ...p, title: "" })); }}
                        aria-describedby={editFieldErrors.title ? "edit-err-title" : undefined}
                      />
                      {editFieldErrors.title && <p id="edit-err-title" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.title}</p>}
                    </div>
                    <div>
                      <Label>{t("detail.planType")} <span className="text-destructive">*</span></Label>
                      <Select value={form.planType} onValueChange={(v) => { setField("planType", v); if (editFieldErrors.planType) setEditFieldErrors((p) => ({ ...p, planType: "" })); }}>
                        <SelectTrigger aria-describedby={editFieldErrors.planType ? "edit-err-planType" : undefined}><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {PLAN_TYPES.map((tp) => <SelectItem key={tp} value={tp}>{t(`planTypes.${tp}`)}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {editFieldErrors.planType && <p id="edit-err-planType" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.planType}</p>}
                    </div>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <Label>{t("fields.state")} <span className="text-destructive">*</span></Label>
                      <Select value={form.stateId ? String(form.stateId) : ""} onValueChange={(v) => { setField("stateId", Number(v)); if (editFieldErrors.stateId) setEditFieldErrors((p) => ({ ...p, stateId: "" })); }}>
                        <SelectTrigger aria-describedby={editFieldErrors.stateId ? "edit-err-state" : undefined}><SelectValue placeholder={t("detail.statePh")} /></SelectTrigger>
                        <SelectContent>
                          {states?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
                        </SelectContent>
                      </Select>
                      {editFieldErrors.stateId && <p id="edit-err-state" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.stateId}</p>}
                    </div>
                    <div>
                      <Label>{t("detail.responsiblePerson")} <span className="text-destructive">*</span></Label>
                      <Input
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
                      <Label>{t("detail.startDate")} <span className="text-destructive">*</span></Label>
                      <Input type="date" value={form.startDate ?? ""} onChange={(e) => { setField("startDate", e.target.value); if (editFieldErrors.startDate) setEditFieldErrors((p) => ({ ...p, startDate: "" })); }} aria-describedby={editFieldErrors.startDate ? "edit-err-startDate" : undefined} />
                      {editFieldErrors.startDate && <p id="edit-err-startDate" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.startDate}</p>}
                    </div>
                    <div>
                      <Label>{t("detail.endDate")} <span className="text-destructive">*</span></Label>
                      <Input type="date" value={form.endDate ?? ""} onChange={(e) => { setField("endDate", e.target.value); if (editFieldErrors.endDate) setEditFieldErrors((p) => ({ ...p, endDate: "" })); }} aria-describedby={editFieldErrors.endDate ? "edit-err-endDate" : undefined} />
                      {editFieldErrors.endDate && <p id="edit-err-endDate" role="alert" className="text-xs text-destructive mt-1">{editFieldErrors.endDate}</p>}
                    </div>
                  </div>

                  <div>
                    <Label>{t("detail.description")}</Label>
                    <Textarea rows={3} placeholder={t("detail.descriptionPh")} value={form.description} onChange={(e) => setField("description", e.target.value)} />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Section 2: Optional Linkage */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("detail.section2")} <span className="text-sm font-normal text-muted-foreground">{t("detail.section2Optional")}</span></CardTitle>
              <p className="text-xs text-muted-foreground mt-1">{t("detail.section2Desc")}</p>
            </CardHeader>
            <CardContent>
              {!isEditing ? (
                /* Read-only: plain text — linked project reference or standalone label */
                <p className="text-sm text-foreground">
                  {form.projectId == null
                    ? <span className="text-muted-foreground">{t("detail.standalonePlan")}</span>
                    : (() => {
                        const linked = projects?.find((p) => p.id === form.projectId);
                        return linked
                          ? <span>{linked.code} — {linked.title}</span>
                          : <span className="text-muted-foreground">—</span>;
                      })()}
                </p>
              ) : (
                <Select
                  value={form.projectId == null ? "__none__" : String(form.projectId)}
                  onValueChange={(v) => setField("projectId", v === "__none__" ? null : Number(v))}
                  disabled={!canEdit}
                >
                  <SelectTrigger className="max-w-sm"><SelectValue placeholder={t("detail.standalonePlan")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t("detail.standalonePlan")}</SelectItem>
                    {projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </CardContent>
          </Card>

          {/* Section 3: Localities */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">{t("detail.section3")}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                {t("detail.section3Desc")}{projectLocalities.length > 0 && t("detail.section3DescWithProject")}
              </p>
            </CardHeader>
            <CardContent>
              {!isEditing ? (
                /* Read-only: compact locality chips or dash */
                form.localities.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {form.localities.map((loc, i) => (
                      <Badge key={i} variant="outline" className="text-xs font-normal">
                        <MapPin className="h-2.5 w-2.5 me-1" aria-hidden="true" /> {loc}
                      </Badge>
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
            </CardContent>
          </Card>

          {/* Section 4: Activities */}
          <Card>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">
                  {t("detail.section4")} <span className="text-destructive">*</span>
                  {totals.count > 0 && <span className="text-sm font-normal text-muted-foreground ms-2">({t("detail.section4Added", { count: totals.count })})</span>}
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">{t("detail.section4Desc")}</p>
              </div>
              {isEditing && canEdit && (
                <Button size="sm" variant="outline" onClick={addActivity}>
                  <Plus className="h-3 w-3" /> {t("activity.addActivity")}
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-4">
              {form.activities.length === 0 && (
                <div className="rounded-md border border-dashed border-warning/40 bg-warning/10 p-6 text-center">
                  <AlertTriangle className="h-5 w-5 text-warning mx-auto mb-2" />
                  <p className="text-sm text-warning font-medium">{t("activity.noActivities")}</p>
                  <p className="text-xs text-warning/80 mt-1">{t("activity.noActivitiesDesc")}</p>
                  {isEditing && canEdit && <Button size="sm" className="mt-3" onClick={addActivity}><Plus className="h-3 w-3" /> {t("activity.addFirstActivity")}</Button>}
                </div>
              )}

              {form.activities.map((a, idx) => (
                <div key={idx} className="rounded-lg border bg-muted/10">
                  {/* Card header */}
                  <div className="flex items-center justify-between px-4 py-2.5 border-b">
                    <span className="text-sm font-medium truncate flex-1">
                      {t("activity.activityNum", { num: idx + 1 })}{a.title ? `: ${a.title}` : ""}
                    </span>
                    {isEditing && canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 shrink-0"
                        onClick={() => removeActivity(idx)}
                        aria-label={`Remove activity ${a.title ? `"${a.title}"` : idx + 1}`}
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
                          <dd>{a.localityName || "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.plannedDate")}</dt>
                          <dd><bdi dir="ltr">{a.plannedDate ? formatDate(a.plannedDate) : "—"}</bdi></dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.priority")}</dt>
                          <dd>{PRIORITIES.find((p) => p.value === a.priority)?.label ?? a.priority ?? "—"}</dd>
                        </div>
                        <div>
                          <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.status")}</dt>
                          <dd>
                            {(() => { const { variant, className } = statusBadgeVariant(a.status); return <Badge variant={variant} className={className}>{formatStatusLabel(a.status)}</Badge>; })()}
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
                            <dd>{a.responsibleName}</dd>
                          </div>
                        )}
                        {a.expectedResult && (
                          <div className="sm:col-span-2">
                            <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("activity.expectedResult")}</dt>
                            <dd className="whitespace-pre-wrap">{a.expectedResult}</dd>
                          </div>
                        )}
                      </dl>
                      <ActivityOptionalFieldsReadOnly a={a} risks={risks} />
                    </div>
                  ) : (
                  <div className="px-4 py-3 space-y-2.5">
                    {/* Activity title */}
                    <div>
                      <Label className="text-sm">{t("activity.activityTitle")} <span className="text-destructive">*</span></Label>
                      <Input placeholder={t("activity.activityTitlePh")} value={a.title} onChange={(e) => updateActivity(idx, { title: e.target.value })} disabled={!canEdit} />
                    </div>

                    {/* State | Locality */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">{t("fields.state")} <span className="text-destructive">*</span></Label>
                        <Select
                          value={a.stateId ? String(a.stateId) : "__none__"}
                          onValueChange={(v) => {
                            const sid = v === "__none__" ? null : Number(v);
                            const sname = v === "__none__" ? "" : (states?.find((s) => s.id === Number(v))?.name ?? "");
                            updateActivity(idx, { stateId: sid, stateName: sname });
                          }}
                          disabled={!canEdit}
                        >
                          <SelectTrigger><SelectValue placeholder={t("detail.statePh")} /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">—</SelectItem>
                            {states?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
                          </SelectContent>
                        </Select>
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
                        <Label className="text-sm">{t("activity.plannedDate")} <span className="text-destructive">*</span></Label>
                        <Input type="date" value={a.plannedDate} onChange={(e) => updateActivity(idx, { plannedDate: e.target.value })} disabled={!canEdit} min={form.startDate || undefined} max={form.endDate || undefined} />
                      </div>
                      <div>
                        <Label className="text-sm">{t("activity.priority")} <span className="text-destructive">*</span></Label>
                        <Select value={a.priority} onValueChange={(v) => updateActivity(idx, { priority: v })} disabled={!canEdit}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {PRIORITIES.map((p) => (
                              <SelectItem key={p.value} value={p.value}>
                                <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${p.cls}`}>{p.label}</span>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Target beneficiaries | Planned budget */}
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-sm">{t("activity.targetBeneficiaries")} <span className="text-destructive">*</span></Label>
                        <Input type="number" min={0} value={a.targetBeneficiaries} onChange={(e) => updateActivity(idx, { targetBeneficiaries: Number(e.target.value) })} disabled={!canEdit} />
                      </div>
                      <div>
                        <Label className="text-sm">{t("activity.plannedBudget")} <span className="text-destructive">*</span></Label>
                        <Input type="number" min={0} value={a.budgetPlanned} onChange={(e) => updateActivity(idx, { budgetPlanned: Number(e.target.value) })} disabled={!canEdit} />
                      </div>
                    </div>

                    {/* Responsible person */}
                    <div className="max-w-sm">
                      <Label className="text-sm">{t("activity.responsiblePerson")}</Label>
                      <Input placeholder={t("activity.responsiblePersonPh")} value={a.responsibleName} onChange={(e) => updateActivity(idx, { responsibleName: e.target.value })} disabled={!canEdit} />
                    </div>

                    {/* Expected result */}
                    <div>
                      <Label className="text-sm">{t("activity.expectedResult")} <span className="text-destructive">*</span></Label>
                      <Textarea rows={2} placeholder={t("activity.expectedResultPh")} value={a.expectedResult} onChange={(e) => updateActivity(idx, { expectedResult: e.target.value })} disabled={!canEdit} className="resize-y" />
                    </div>

                    <ActivityOptionalFields a={a} idx={idx} updateActivity={updateActivity} canEdit={canEdit} risks={risks} />
                  </div>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Section 5: Budget & Totals */}
          <Card>
            <CardHeader><CardTitle className="text-base">{t("detail.section5")}</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {!isEditing ? (
                /* View mode — clean read-only figures, no disabled form chrome (PLAN-552) */
                <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.currency")}</dt>
                    <dd className="text-sm font-medium">{form.currency || "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.planBudgetPlanned")}</dt>
                    <dd className="text-sm font-medium tabular-nums">{form.budgetPlanned != null ? formatCurrency(form.budgetPlanned, form.currency) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.planBudgetActual")}</dt>
                    <dd className="text-sm font-medium tabular-nums">{form.budgetActual != null ? formatCurrency(form.budgetActual, form.currency) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs font-medium text-muted-foreground mb-0.5">{t("detail.fundingSource")}</dt>
                    <dd className="text-sm font-medium">{form.fundingSource || "—"}</dd>
                  </div>
                </dl>
              ) : (
              <div className="grid md:grid-cols-4 gap-4">
                <div>
                  <Label>{t("detail.currency")}</Label>
                  <Select value={form.currency ?? "USD"} onValueChange={(v) => setField("currency", v)} disabled={!canEdit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("detail.planBudgetPlanned")}</Label>
                  <Input type="number" min={0} value={form.budgetPlanned ?? 0} onChange={(e) => setField("budgetPlanned", Number(e.target.value))} disabled={!canEdit} />
                </div>
                <div>
                  <Label>{t("detail.planBudgetActual")}</Label>
                  <Input type="number" min={0} value={form.budgetActual ?? 0} onChange={(e) => setField("budgetActual", Number(e.target.value))} disabled={!canEdit} />
                </div>
                <div>
                  <Label>{t("detail.fundingSource")}</Label>
                  <Input placeholder={t("detail.fundingSourcePh")} value={form.fundingSource} onChange={(e) => setField("fundingSource", e.target.value)} disabled={!canEdit} />
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
                  <p className="font-bold text-xl leading-none">{formatCurrency(totals.plannedBudget)}</p>
                  <p className="text-xs text-muted-foreground mt-1">{t("detail.plannedTotal")}</p>
                </div>
                <div className={`rounded-lg border p-3 ${totals.plannedBudget > 0 && totals.actualBudget / totals.plannedBudget > 1 ? "bg-destructive/10 border-destructive/30" : "bg-success/10 border-success/30"}`}>
                  <p className="text-xs text-muted-foreground mb-1">{t("detail.burnRate")}</p>
                  <p className={`font-bold text-2xl leading-none ${totals.plannedBudget > 0 && totals.actualBudget / totals.plannedBudget > 1 ? "text-destructive" : "text-success"}`}>
                    {totals.plannedBudget > 0 ? Math.round((totals.actualBudget / totals.plannedBudget) * 100) : 0}%
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">{formatCurrency(totals.actualBudget)} {t("detail.actual")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Section 6: Linked Risks (read-only) */}
          {!isNew && existing && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-warning" /> {t("detail.section6")}
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {(existing.linkedRisks ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground p-6">{t("detail.noLinkedRisks")}</p>
                ) : (
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>{t("detail.riskTitle")}</TableHead>
                      <TableHead>{t("detail.riskSeverity")}</TableHead>
                      <TableHead>{t("detail.riskStatus")}</TableHead>
                      <TableHead>{t("detail.riskIdentified")}</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {existing.linkedRisks?.map((r) => (
                        <TableRow key={r.id}>
                          <TableCell>{r.title}</TableCell>
                          <TableCell><Badge variant="outline" className="capitalize">{r.severity}</Badge></TableCell>
                          <TableCell className="text-sm capitalize">{formatStatusLabel(r.status)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground">{formatDate(r.identifiedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )}

        </TabsContent>

        {!isNew && planId && (
          <TabsContent value="comments" className="mt-6">
            <CommentsPanel
              entityType="plan" entityId={planId}
              sections={["Basics", "Activities", "Budget", "Risks"]}
              currentUserId={me?.user?.id ?? null}
              currentUserRole={me?.user?.role ?? null}
            />
          </TabsContent>
        )}

        {!isNew && planId && (
          <TabsContent value="attachments" className="mt-6">
            <DriveAttachmentPanel
              module="plans"
              recordId={planId}
              canUpload={hasPerm(perms, "plans.update") || hasPerm(perms, "plans.create")}
              canDelete={canDelete}
            />
          </TabsContent>
        )}

        {!isNew && existing && (
          <TabsContent value="workflow" className="mt-6 space-y-4">
            <Card>
              <CardHeader><CardTitle className="text-base">{t("detail.workflowCurrentStatus")}</CardTitle></CardHeader>
              <CardContent>
                {(() => { const { variant, className } = statusBadgeVariant(existing.status); return <Badge variant={variant} className={className}>{formatStatusLabel(existing.status)}</Badge>; })()}
                <p className="text-sm text-muted-foreground mt-3">
                  {t("detail.workflowApprovalChain")} <span className="font-medium">{t("detail.workflowApprovalChainValue")}</span>
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="text-base">{t("detail.workflowActionsAvailable")}</CardTitle></CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {availableTransitions.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t("detail.workflowNoTransitions")}</p>
                )}
                {availableTransitions.map((tr) => (
                  <Button
                    key={tr.action}
                    variant={tr.variant ?? "default"}
                    size="sm"
                    onClick={() => openTransitionDialog(tr)}
                  >
                    {tr.action === "submit" && <Send className="h-3 w-3" />}
                    {(tr.action === "final_approve" || tr.action === "complete") && <CheckCircle2 className="h-3 w-3" />}
                    {(tr.action === "reject" || tr.action === "cancel") && <X className="h-3 w-3" />}
                    {t(`transitions.${tr.action}`)}
                  </Button>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        )}
      </Tabs>

      {/* ── Sticky edit-mode footer (Phase 9) ─────────────────────────────── */}
      {/* Keeps Save Changes / Cancel reachable on long plans with many activities */}
      {isEditing && (
        <div
          className="sticky bottom-0 border-t border-border bg-background z-10 px-6 py-3 flex items-center justify-between gap-3"
          data-testid="edit-sticky-footer"
        >
          <Button
            variant="outline"
            onClick={isNew ? () => setLocation("/plans") : onCancel}
            disabled={createMutation.isPending || updateMutation.isPending}
            aria-busy={createMutation.isPending || updateMutation.isPending}
          >
            <X className="h-4 w-4" aria-hidden="true" /> {t("detail.cancelEdit")}
          </Button>
          <Button
            onClick={onSave}
            disabled={createMutation.isPending || updateMutation.isPending}
            aria-busy={createMutation.isPending || updateMutation.isPending}
          >
            <Save className="h-4 w-4" aria-hidden="true" />
            {isNew ? t("createPlan") : t("detail.saveChanges")}
          </Button>
        </div>
      )}

      <Dialog open={!!transitionDialog} onOpenChange={(o) => { if (!o) { setTransitionDialog(null); setTransitionComment(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{transitionDialog?.label}</DialogTitle>
            <DialogDescription>
              {transitionDialog?.requiresComment ? t("detail.requiresRationale") : t("detail.confirmAction")}
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label>{transitionDialog?.requiresComment ? t("detail.commentRequired") : t("detail.commentOptional")}</Label>
            <Textarea rows={3} value={transitionComment} onChange={(e) => setTransitionComment(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setTransitionDialog(null); setTransitionComment(""); }}>{t("detail.confirmCancel")}</Button>
            <Button onClick={onTransition} disabled={transitionMutation.isPending || (transitionDialog?.requiresComment && !transitionComment.trim())}>
              {t("detail.confirmConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dedicated Rejection Dialog ───────────────────────────────────── */}
      <Dialog open={rejectDialog} onOpenChange={(o) => { if (!o) onRejectCancel(); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("detail.rejectPlanTitle")}</DialogTitle>
            <DialogDescription>
              {t("detail.rejectPlanDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reject-reason">
              {t("detail.rejectionReason")} <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="reject-reason"
              rows={3}
              placeholder={t("detail.rejectionReasonPh")}
              value={rejectReason}
              onChange={(e) => { setRejectReason(e.target.value); if (rejectReasonError) setRejectReasonError(""); }}
              aria-required="true"
              aria-invalid={!!rejectReasonError}
              aria-describedby={rejectReasonError ? "reject-reason-error" : undefined}
              autoFocus
            />
            {rejectReasonError && (
              <p id="reject-reason-error" role="alert" className="text-sm text-destructive">
                {rejectReasonError}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onRejectCancel} disabled={transitionMutation.isPending}>
              {t("detail.confirmCancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={onRejectConfirm}
              disabled={transitionMutation.isPending}
              aria-busy={transitionMutation.isPending}
            >
              {transitionMutation.isPending ? t("detail.rejecting") : t("detail.rejectPlan")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reopen For Editing Dialog (spec §6) ──────────────────────────── */}
      <Dialog open={reopenDialogOpen} onOpenChange={(o) => { if (!o) { setReopenDialogOpen(false); setReopenReason(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{t("detail.reopenPlanTitle")}</DialogTitle>
            <DialogDescription>
              {t("detail.reopenPlanDesc")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            {existing && (
              <div className="rounded-md bg-muted/60 border border-border/60 px-3 py-2.5 space-y-1">
                <div><span className="text-muted-foreground">{t("detail.planCode")} </span><span className="font-mono font-medium">{(existing as unknown as { code?: string }).code ?? "—"}</span></div>
                <div><span className="text-muted-foreground">{t("detail.planTitle_label")} </span><span className="font-medium">{existing.title}</span></div>
                <div><span className="text-muted-foreground">{t("detail.currentStatus")} </span><PlanStatusBadge status={existing.status} /></div>
                {(() => {
                  const ext = existing as unknown as { lastFinalApprovedAt?: string | null };
                  return ext.lastFinalApprovedAt ? (
                    <div><span className="text-muted-foreground">{t("detail.lastApproved")} </span>{formatDate(String(ext.lastFinalApprovedAt).slice(0, 10))}</div>
                  ) : null;
                })()}
              </div>
            )}
            <div>
              <Label htmlFor="reopen-reason" className="mb-1.5 block">
                {t("detail.reasonForReopening")} <span className="text-destructive">{t("detail.reasonForReopeningRequired")}</span>
              </Label>
              <Textarea
                id="reopen-reason"
                rows={3}
                placeholder={t("detail.reasonForReopeningPh")}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setReopenDialogOpen(false); setReopenReason(""); }} disabled={reopenMutation.isPending}>
              {t("detail.confirmCancel")}
            </Button>
            <Button
              onClick={() => { if (planId) reopenMutation.mutate({ planId, data: { reason: reopenReason } }); }}
              disabled={reopenMutation.isPending || !reopenReason.trim()}
            >
              <RotateCcw className="h-4 w-4" />
              {reopenMutation.isPending ? t("detail.reopening") : t("detail.reopenForEditing")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
