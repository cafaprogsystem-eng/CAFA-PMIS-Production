/**
 * CreatePlanRegistrationDialog — five-tab Plan creation workspace.
 *
 * Architecture contract:
 * • Mirrors the Project Registration UX: Dialog shell → tab-nav strip → scrollable body → sticky footer.
 * • Parent state holds the complete form (planDetails, relatedProject, localities, activities[], budget).
 * • "Save As Draft" creates on first call (stores draftPlanId), PATCHes on subsequent calls.
 * • No record is created on tab navigation or dialog open — only on explicit Save/Complete.
 * • All five Tabs are freely navigable — no sequential gate. Tab navigation never triggers validation.
 * • Dependencies (e.g. Geographical Coverage requiring a State) are explained inside the tab, not blocked.
 * • Save As Draft validates Plan Details required fields (matches API minimum) before dispatching.
 * • Save & Finish validates Plan Details required fields, shows "Sections Need Attention" summary on failure.
 * • Complete Plan closes and navigates to /plans/:id.
 * • TC sector scope enforced client-side; backend remains authoritative.
 * • All hooks before any early return (Rules of Hooks / Strict Mode safe).
 * • Single create mutation; completeAfterCreate ref set BEFORE dispatch to avoid race.
 * • Synchronous isInflight ref prevents double-submit on first save.
 */

import { useState, useRef, useMemo, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { StateLabel, getStateLabel } from "@/components/state-label";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { toast } from "sonner";
import {
  useCreatePlan,
  useUpdatePlan,
  useListProjects,
  useListStates,
  useListRisks,
  useGetMe,
} from "@workspace/api-client-react";
import { SECTORS } from "@/lib/sectors";
import {
  Plus, Trash2, ChevronDown, ChevronUp, MapPin, X, AlertCircle, AlertTriangle,
  Check, ChevronsUpDown, Loader2,
} from "lucide-react";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { hasPerm, statusBadgeVariant, formatStatusLabel } from "@/lib/format";
import { ContinueEditingAction } from "@/components/continue-editing-action";
import { OfflineDraftNotice } from "@/components/offline-draft-notice";
import { useDurableFormDraft } from "@/hooks/use-durable-form-draft";
import { useSyncContext } from "@/contexts/sync-context";

// ─── Constants ────────────────────────────────────────────────────────────────

const PLAN_TYPE_OPTIONS = [
  { value: "monthly",     label: "Monthly" },
  { value: "quarterly",   label: "Quarterly" },
  { value: "annual",      label: "Annual" },
  { value: "action",      label: "Action" },
  { value: "operational", label: "Operational" },
  { value: "emergency",   label: "Emergency Response" },
  { value: "custom",      label: "Custom" },
] as const;

const CURRENCIES = ["USD", "SDG", "EUR", "AED"];

const ACTIVITY_STATUSES = ["planned", "in_progress", "completed", "delayed", "cancelled"] as const;

/**
 * PLAN-BD-4: Client-side mirror of the backend status/progress consistency contract.
 * Returns an i18n key (namespace "planning") for the violated rule, or null when
 * the status/progress combination is valid.  The caller resolves the key via
 * t() so the surfaced message is localised.
 */
function validateActivityProgressConsistency(status: string, progressPct: number): string | null {
  switch (status) {
    case "completed":
      if (progressPct !== 100) return "createDialog.progressCompleted";
      break;
    case "in_progress":
      if (progressPct < 1 || progressPct > 99) return "createDialog.progressInProgress";
      break;
    case "planned":
    case "delayed":
      if (progressPct < 0 || progressPct > 99) return "createDialog.progressPlannedDelayed";
      break;
    case "cancelled":
      if (progressPct < 0 || progressPct > 100) return "createDialog.progressCancelled";
      break;
    default:
      return null;
  }
  return null;
}

const PRIORITIES = [
  { value: "high",   label: "High",   cls: "bg-destructive/10 text-destructive border-destructive/20" },
  { value: "medium", label: "Medium", cls: "bg-warning/10 text-warning border-warning/20" },
  { value: "low",    label: "Low",    cls: "bg-muted text-muted-foreground border-border" },
] as const;

// ─── Tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: "details"    as const, label: "Plan Details"          },
  { id: "project"    as const, label: "Related Project"       },
  { id: "geography"  as const, label: "Geographical Coverage" },
  { id: "activities" as const, label: "Activities"            },
  { id: "budget"     as const, label: "Budget"                },
] as const;

// ─── Types ────────────────────────────────────────────────────────────────────

interface PlanDetailsForm {
  title: string;
  planType: string;
  stateId: string;
  responsibleName: string;
  sectors: string[];
  startDate: string;
  endDate: string;
  description: string;
}

interface ActivityForm {
  title: string;
  stateId: number | null;
  stateName: string;
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
}

interface BudgetForm {
  currency: string;
  budgetPlanned: number;
  budgetActual: number;
  fundingSource: string;
}

type DetailsErrors = Partial<Record<keyof PlanDetailsForm, string>>;

// ─── Pure helpers (module scope — Strict Mode safe, no hooks) ─────────────────

function emptyActivity(): ActivityForm {
  return {
    title: "", stateId: null, stateName: "", localityName: "",
    plannedDate: "", targetBeneficiaries: 0, budgetPlanned: 0, budgetActual: 0,
    priority: "medium", expectedResult: "", status: "planned", progressPct: 0,
    responsibleName: "", description: "", riskId: null,
    mitigationAction: "", expectedOutput: "", performanceIndicator: "",
  };
}

/**
 * Validates the MINIMUM fields required for Save As Draft.
 * Only Plan title and State are mandatory — all other Plan Details fields
 * (type, responsible person, sectors, dates, description) may be completed later.
 * If the user has entered both dates, an obviously invalid range is still rejected
 * so knowingly bad data is never persisted, but absence of dates is fine.
 *
 * Each entry is an i18n key (namespace "planning") resolved via t() at render
 * time so validation copy is localised, while callers still rely only on the
 * presence/absence of keys (Object.keys length) for the go/no-go decision.
 */
function validateDraftFields(form: PlanDetailsForm): DetailsErrors {
  const e: DetailsErrors = {};
  if (!form.title.trim()) e.title   = "detail.planTitleRequired";
  if (!form.stateId)      e.stateId = "detail.stateRequired";
  // Conditional date-range check: only fires when the user has actually entered both dates.
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    e.endDate = "detail.endDateAfterStart";
  }
  return e;
}

/**
 * Validates the COMPLETE Plan Details dataset required for Save & Finish.
 * Intentionally written as an independent, explicit validator — not an extension of
 * validateDraftFields — so the full set of required completion fields is always obvious.
 * Also covers Submit For Approval readiness (description required since spec §13.5).
 *
 * Each entry is an i18n key (namespace "planning") resolved via t() at render time.
 */
function validateFinishFields(form: PlanDetailsForm): DetailsErrors {
  const e: DetailsErrors = {};
  if (!form.title.trim())           e.title           = "detail.planTitleRequired";
  if (!form.planType)               e.planType         = "detail.planTypeRequired";
  if (!form.stateId)                e.stateId          = "detail.stateRequired";
  if (!form.responsibleName.trim()) e.responsibleName  = "detail.responsibleRequired";
  if (form.sectors.length === 0)    e.sectors          = "detail.sectorsRequired";
  if (!form.startDate)              e.startDate        = "detail.startDateRequired";
  if (!form.endDate)                e.endDate          = "detail.endDateRequired";
  if (form.startDate && form.endDate && form.endDate < form.startDate) {
    e.endDate = "detail.endDateAfterStart";
  }
  if (!form.description.trim())     e.description     = "createDialog.descriptionRequired";
  return e;
}

/**
 * Returns true when an Activity satisfies all fields required for a completed
 * Plan Registration.  Responsible person is intentionally optional.
 * State is inherited from the Plan and is NOT a per-activity required field.
 */
function isActivityComplete(
  a: ActivityForm,
  planStartDate: string,
  planEndDate: string,
  planLocalities: string[],
): boolean {
  if (!a.title.trim()) return false;
  // Locality must be non-empty and belong to the Plan's approved coverage
  if (!a.localityName || !planLocalities.includes(a.localityName)) return false;
  if (!a.plannedDate) return false;
  if (planStartDate && a.plannedDate < planStartDate) return false;
  if (planEndDate && a.plannedDate > planEndDate) return false;
  if (!a.priority) return false;
  const ben = Number(a.targetBeneficiaries);
  if (!Number.isFinite(ben) || ben < 0 || !Number.isInteger(ben)) return false;
  const bud = Number(a.budgetPlanned);
  if (!Number.isFinite(bud) || bud < 0) return false;
  if (!a.expectedResult.trim()) return false;
  return true;
}

/** Levenshtein distance for smart locality matching. */
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
function findSimilar(input: string, suggestions: string[]): string | null {
  const ni = normalizeStr(input);
  for (const s of suggestions) {
    const ns = normalizeStr(s);
    if (ns === ni) return null;
    if (levenshtein(ni, ns) <= 3) return s;
  }
  return null;
}

// ─── Sub-components (module scope — never recreated inside parent render) ─────

/** Free-text locality tag input with smart-match suggestions. */
function LocalityTagInput({
  localities, onChange, onAttemptRemove, suggestions = [],
}: {
  localities: string[];
  onChange: (v: string[]) => void;
  /** Called when user clicks the X on a chip — parent handles confirmation */
  onAttemptRemove: (idx: number) => void;
  suggestions?: string[];
}) {
  const { t } = useTranslation("planning");
  const [inputVal, setInputVal] = useState("");
  const [similar, setSimilar] = useState<string | null>(null);
  const inputId = "plan-locality-input";

  /** Case-and-whitespace normalised dedupe check. */
  function normLoc(s: string) { return s.toLowerCase().replace(/\s+/g, " ").trim(); }

  function addLocality(val?: string) {
    const v = (val ?? inputVal).trim();
    if (!v) { setInputVal(""); setSimilar(null); return; }
    const norm = normLoc(v);
    const isDupe = localities.some((l) => normLoc(l) === norm);
    if (isDupe) { setInputVal(""); setSimilar(null); return; }
    onChange([...localities, v]);
    setInputVal(""); setSimilar(null);
  }

  function onInputChange(v: string) {
    setInputVal(v);
    if (v.trim().length >= 3) {
      setSimilar(findSimilar(v, suggestions.filter((s) => !localities.includes(s))));
    } else {
      setSimilar(null);
    }
  }

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        <Label htmlFor={inputId} className="text-xs font-medium">{t("createDialog.localityLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            placeholder={t("detail.localityPh")}
            value={inputVal}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }}
            className="flex-1"
          />
          <Button type="button" variant="outline" size="sm" onClick={() => addLocality()} disabled={!inputVal.trim()}>
            {t("detail.addLocality")}
          </Button>
        </div>
        {similar && (
          <Alert className="py-2 border-warning/30 bg-warning/10">
            <AlertCircle className="h-3.5 w-3.5 text-warning" />
            <AlertDescription className="text-xs text-warning flex items-center gap-2">
              {t("detail.similarTo", { name: similar })}
              <Button size="sm" variant="outline" className="h-5 text-xs px-2 py-0 border-warning/40" onClick={() => addLocality(similar)}>{t("detail.useExisting")}</Button>
              <Button size="sm" variant="ghost" className="h-5 text-xs px-2 py-0" onClick={() => setSimilar(null)}>{t("detail.keepMine")}</Button>
            </AlertDescription>
          </Alert>
        )}
      </div>
      {localities.length > 0 ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-foreground">{t("detail.addLocality")}</span>
            <span className="text-xs text-muted-foreground">{t("createDialog.localityCount", { count: localities.length })}</span>
          </div>
          <div className="flex flex-wrap gap-1.5" aria-label={t("createDialog.addedLocalitiesAria")}>
          {localities.map((loc, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 bg-muted border border-border/60 rounded-full px-2.5 py-0.5 text-xs font-medium"
            >
              {loc}
              <button
                type="button"
                aria-label={t("createDialog.removeLocalityAria", { name: loc })}
                onClick={() => onAttemptRemove(i)}
                className="ms-0.5 rounded-full hover:bg-muted-foreground/20 p-0.5 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-4 text-center">
          <p className="text-sm font-medium text-foreground">{t("createDialog.noActivitiesTitle")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{t("createDialog.noActivitiesDesc")}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Activity locality selector — restricted to the Plan's approved Geographical
 * Coverage (Tab 3).  If no localities have been added yet, shows a dependency
 * message with a shortcut to Tab 3 instead of a broken empty select.
 */
function ActivityLocalitySelect({
  value, onChange, localities, onGoToGeography,
}: {
  value: string;
  onChange: (v: string) => void;
  /** The Plan's approved locality list from Tab 3 */
  localities: string[];
  onGoToGeography: () => void;
}) {
  const { t } = useTranslation("planning");
  if (localities.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 space-y-1.5">
        <p className="text-xs text-muted-foreground leading-snug">
          {t("createDialog.localityDepMessage")}
        </p>
        <Button
          size="sm"
          variant="outline"
          type="button"
          onClick={onGoToGeography}
          className="h-6 text-xs px-2"
        >
          {t("createDialog.goToGeoCoverage")}
        </Button>
      </div>
    );
  }
  return (
    <Select
      value={value || "__none__"}
      onValueChange={(v) => onChange(v === "__none__" ? "" : v)}
    >
      <SelectTrigger>
        <SelectValue placeholder={t("createDialog.selectLocality")} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__none__">—</SelectItem>
        {localities.map((loc) => (
          <SelectItem key={loc} value={loc}>{loc}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Collapsible optional fields on an activity card. */
function ActivityOptionalFields({
  a, idx, updateActivity, risks,
}: {
  a: ActivityForm;
  idx: number;
  updateActivity: (idx: number, patch: Partial<ActivityForm>) => void;
  risks: Array<{ id: number; title: string; severity: string }> | undefined;
}) {
  const { t } = useTranslation("planning");
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t pt-2 mt-2">
      <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setOpen(!open)}>
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? t("createDialog.hideOptional") : t("createDialog.showOptional")}
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <div className="grid md:grid-cols-4 gap-2">
            <div>
              <Label className="text-xs">{t("createDialog.optStatus")}</Label>
              <Select value={a.status} onValueChange={(v) => {
                const patch: Partial<ActivityForm> = { status: v };
                if (v === "completed") patch.progressPct = 100;
                updateActivity(idx, patch);
              }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ACTIVITY_STATUSES.map((s) => <SelectItem key={s} value={s}>{t(`activity.status_${s}`)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{t("createDialog.optProgress")}</Label>
              <Input type="number" min={0} max={100} value={a.progressPct} onChange={(e) => updateActivity(idx, { progressPct: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">{t("createDialog.optBudgetActual")}</Label>
              <Input type="number" min={0} value={a.budgetActual} onChange={(e) => updateActivity(idx, { budgetActual: Number(e.target.value) })} />
            </div>
            <div>
              <Label className="text-xs">{t("createDialog.optLinkedRisk")}</Label>
              <Select value={a.riskId ? String(a.riskId) : "__none__"} onValueChange={(v) => updateActivity(idx, { riskId: v === "__none__" ? null : Number(v) })}>
                <SelectTrigger><SelectValue placeholder={t("createDialog.optNone")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">{t("createDialog.optNone")}</SelectItem>
                  {risks?.map((r) => <SelectItem key={r.id} value={String(r.id)}>{r.title} ({r.severity})</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">{t("createDialog.optExpectedOutput")}</Label>
              <Input value={a.expectedOutput} onChange={(e) => updateActivity(idx, { expectedOutput: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">{t("createDialog.optPerfIndicator")}</Label>
              <Input value={a.performanceIndicator} onChange={(e) => updateActivity(idx, { performanceIndicator: e.target.value })} />
            </div>
          </div>
          <div>
            <Label className="text-xs">{t("createDialog.optDescNotes")}</Label>
            <Textarea rows={2} value={a.description} onChange={(e) => updateActivity(idx, { description: e.target.value })} />
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PLAN-BD-2: Duplicate check types ───────────────────────────────────────

type DuplicateCheckResult =
  | { matchType: "none" }
  | { matchType: "soft"; count?: number; planId?: number | null }
  | { matchType: "hard"; existing: { planId: number | null; title: string; status: string; planType: string; startDate: string; endDate: string } };

type DuplicateCheckState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "result"; result: DuplicateCheckResult }
  | { kind: "error" };

/**
 * Calls the preflight duplicate-check endpoint.
 *
 * This is best-effort — the backend CREATE guard is authoritative.
 * Network errors should not block creation (backend will catch true duplicates).
 */
async function checkDuplicatePlan(params: {
  planType: string;
  startDate: string;
  endDate: string;
  stateId?: number | null;
  projectId?: number | null;
  locationType?: string | null;
  /** ID of the plan currently being edited, so the preflight won't block
   *  the user from saving their own draft (self-duplicate exclusion). */
  draftPlanId?: number | null;
}): Promise<DuplicateCheckResult> {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  const qs = new URLSearchParams({ planType: params.planType, startDate: params.startDate, endDate: params.endDate });
  if (params.projectId != null) qs.set("projectId", String(params.projectId));
  if (params.stateId != null) qs.set("stateId", String(params.stateId));
  if (params.locationType) qs.set("locationType", params.locationType);
  if (params.draftPlanId != null) qs.set("draftPlanId", String(params.draftPlanId));
  const res = await fetch(`${base}/api/plans/duplicate-check?${qs.toString()}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error("duplicate_check_failed");
  return res.json() as Promise<DuplicateCheckResult>;
}

// ─── Registration session helper ─────────────────────────────────────────────

/**
 * Revokes the server-side Plan Registration session.
 *
 * Throws when the server returns a non-ok status so the caller can surface
 * a meaningful error to the user.  Network-level errors (fetch throws) are
 * also propagated.
 *
 * The raw token is sent in the request body over HTTPS only.  It is never
 * logged, stored, or placed in a URL or query parameter.
 */
async function closeRegistrationApi(planId: number, token: string): Promise<void> {
  const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
  const res = await fetch(`${base}/api/plans/${planId}/close-registration`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ registrationToken: token }),
  });
  if (!res.ok) {
    throw new Error("registration_close_failed");
  }
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface CreatePlanRegistrationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-fill plan type, e.g. when opened from Action Plans workspace. */
  defaultPlanType?: string;
}

// ─── Initial state factories ──────────────────────────────────────────────────

function makeEmptyDetails(defaultPlanType = ""): PlanDetailsForm {
  return {
    title: "", planType: defaultPlanType,
    stateId: "", responsibleName: "", sectors: [],
    startDate: "", endDate: "", description: "",
  };
}

function makeEmptyBudget(): BudgetForm {
  return { currency: "USD", budgetPlanned: 0, budgetActual: 0, fundingSource: "" };
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CreatePlanRegistrationDialog({
  open, onOpenChange, defaultPlanType,
}: CreatePlanRegistrationDialogProps) {
  const { t, i18n } = useTranslation("planning");
  const qc = useQueryClient();
  const [, setLocation] = useLocation();
  const { isOnline } = useSyncContext();
  const { t: commonT } = useTranslation("common");

  // ── Data fetching (all hooks before any early return) ──────────────────────
  const { data: me }       = useGetMe();
  const canResumeExistingDraft = hasPerm(me?.permissions, "plans.update");
  // State-scoped users (SPO/SOM) cannot create HQ plans — hide HQ option for them.
  const isStateRole = me?.user?.role === "state_program_officer" || me?.user?.role === "state_office_manager";
  const { data: states }   = useListStates();
  const { data: projects, isLoading: projectsLoading, isError: projectsError } = useListProjects();
  const { data: risksData } = useListRisks({ limit: 200 });
  const risks = risksData?.items;

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const [activeTabIndex, setActiveTabIndex] = useState(0);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [planDetails, setPlanDetails] = useState<PlanDetailsForm>(() => makeEmptyDetails(defaultPlanType));
  const [relatedProjectId, setRelatedProjectId] = useState<number | null>(null);
  /** "standalone" = no project link; "linked" = user chose to link a project. */
  const [linkMode, setLinkMode] = useState<"standalone" | "linked">("standalone");
  /** Current search query for the project combobox. */
  const [projectSearch, setProjectSearch] = useState("");
  /** Controls the project combobox popover open state. */
  const [projectComboOpen, setProjectComboOpen] = useState(false);
  const [localities, setLocalities] = useState<string[]>([]);
  const [activities, setActivities] = useState<ActivityForm[]>([]);
  const [budget, setBudget] = useState<BudgetForm>(makeEmptyBudget);

  // ── Draft tracking ─────────────────────────────────────────────────────────
  /** null = no draft created yet; number = plan ID of the saved draft. */
  const [draftPlanId, setDraftPlanId] = useState<number | null>(null);

  /**
   * registrationToken: the opaque bearer token returned by POST /plans when a
   * Draft is first created.  Must be presented on every subsequent PATCH call
   * so the server can validate the active Registration session.
   *
   * Stored only in React state — never in localStorage or a query parameter.
   * Cleared by handleReset (Save & Finish, Cancel, or explicit close).
   * On page refresh the dialog closes and this state is lost, which is the
   * intended safe behaviour — the saved Draft remains; editing requires plans.update.
   */
  const [registrationToken, setRegistrationToken] = useState<string | null>(null);

  // ── PLAN-BD-2: Duplicate preflight state ──────────────────────────────────
  /**
   * duplicateCheck: result of the most recent preflight call.
   * "idle"   = no check run yet (fields not complete enough).
   * "loading" = check in-flight.
   * "result" = last check returned; inspect result.matchType.
   * "error"  = network/server error — does NOT block creation (backend guard is authoritative).
   */
  const [duplicateCheck, setDuplicateCheck] = useState<DuplicateCheckState>({ kind: "idle" });

  // ── Validation ─────────────────────────────────────────────────────────────
  const [attemptedSave, setAttemptedSave] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // ── Cancel confirmation dialog ─────────────────────────────────────────────
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);

  // ── State-change confirmation dialog ───────────────────────────────────────
  /**
   * stateChangeConfirmOpen: true when the user has chosen a new State while
   * Localities already exist.  Shows a confirmation before clearing them.
   */
  const [stateChangeConfirmOpen, setStateChangeConfirmOpen] = useState(false);
  /** The stateId the user intends to switch to — applied on confirmation. */
  const [pendingStateId, setPendingStateId] = useState<string | null>(null);
  /**
   * localityRemoveState: set when the user tries to remove a locality that is
   * currently assigned to one or more Activities — triggers a confirm dialog
   * before any mutation occurs.
   */
  const [localityRemoveState, setLocalityRemoveState] = useState<{
    idx: number; name: string; count: number;
  } | null>(null);
  /**
   * currencyChangeConfirm: when non-null, holds the new currency code the user
   * selected while Activities with non-zero budgets exist.  Opens a safety
   * AlertDialog before applying the change.
   */
  const [currencyChangeConfirm, setCurrencyChangeConfirm] = useState<string | null>(null);
  /**
   * activityDeleteConfirmIdx: index of the Activity the user is attempting to
   * delete that contains entered data.  Opens the AlertDialog for confirmation.
   * null = no dialog open; empty activities delete immediately without confirmation.
   */
  const [activityDeleteConfirmIdx, setActivityDeleteConfirmIdx] = useState<number | null>(null);

  /**
   * saveFinishAttempted: true once the user has clicked "Save & Finish" and
   * validation failed.  Drives the "Sections Need Attention" summary banner.
   * Separate from attemptedSave so the two validation UX paths stay independent.
   * Cleared on reset.
   */
  const [saveFinishAttempted, setSaveFinishAttempted] = useState(false);

  /**
   * isClosingSession: true while the explicit POST /close-registration call is
   * in-flight.  Disables both AlertDialog buttons and shows "Closing…" text.
   * Prevents double-submit on the confirmation dialog.
   */
  const [isClosingSession, setIsClosingSession] = useState(false);

  /**
   * closeSessionError: non-null when a server-side revocation call has failed.
   * Displayed inside the AlertDialog so the user can retry.
   * The message text never contains the raw token.
   */
  const [closeSessionError, setCloseSessionError] = useState<string | null>(null);

  // ── Intent flags (set synchronously BEFORE dispatch to avoid race) ─────────
  /**
   * completeAfterCreate: true when the current in-flight create is intended to
   * complete the registration (not just save a draft). Set to true BEFORE mutate()
   * is called so onSuccess always sees the correct intent regardless of timing.
   */
  const completeAfterCreate = useRef(false);

  /**
   * isInflight: synchronous double-submit guard. Set to true immediately on
   * the first save click; cleared in onSuccess / onError. Prevents a second
   * POST from racing the first before isPending propagates through React state.
   */
  const isInflight = useRef(false);

  /**
   * isDirtyRef: comprehensive form dirtiness tracker.
   * Set to true whenever ANY form field changes (details, project, localities,
   * activities, budget). Used by handleCancelClick to decide whether a
   * confirmation dialog is required. Cleared on reset.
   */
  const isDirtyRef = useRef(false);

  /** Strict Mode / reset guard. */
  const resetGuard = useRef(false);

  // ── TC sector scope ────────────────────────────────────────────────────────
  const isTc = me?.user?.role === "technical_coordinator";
  const tcSectorString = isTc
    ? (me?.user as unknown as Record<string, string | undefined>)?.sector ?? ""
    : "";
  const tcSectors: string[] | null = isTc
    ? tcSectorString.split(",").map((s) => s.trim()).filter(Boolean)
    : null;
  const availableSectors: string[] = tcSectors ?? [...SECTORS];

  // Keep only operational content in browser storage. Budget figures and
  // aggregate calculations stay online-only and are never queued from a draft.
  const offlineDraftValue = useMemo(() => ({
    planDetails,
    relatedProjectId,
    linkMode,
    localities,
    activities: activities.map(({
      budgetPlanned: _planned, budgetActual: _actual,
      status: _status, progressPct: _progress, ...activity
    }) => activity),
  }), [planDetails, relatedProjectId, linkMode, localities, activities]);
  const planDraft = useDurableFormDraft({
    enabled: open && Array.isArray(states) && Array.isArray(projects) && Array.isArray(risks),
    userId: me?.user?.id,
    module: "plans",
    recordKey: draftPlanId == null ? "new" : String(draftPlanId),
    label: "Plan draft",
    value: offlineDraftValue,
    scope: {
      stateIds: (states ?? []).map((state) => state.id),
      sectors: availableSectors,
      projectIds: (projects ?? []).map((project) => project.id),
    },
    onRecover: (draft) => {
      const permittedStates = new Set((states ?? []).map((state) => state.id));
      const permittedProjects = new Set((projects ?? []).map((project) => project.id));
      const permittedRisks = new Set((risks ?? []).map((risk) => risk.id));
      const permittedSectors = new Set(availableSectors);
      const recoveredState = draft.planDetails?.stateId;
      const stateId = recoveredState && recoveredState !== "__HQ__"
        && !permittedStates.has(Number(recoveredState))
        ? ""
        : recoveredState;
      const recoveredSectors = (draft.planDetails?.sectors ?? []).filter((sector) => permittedSectors.has(sector));
      setPlanDetails((current) => ({
        ...current,
        ...draft.planDetails,
        ...(stateId !== undefined ? { stateId } : {}),
        ...(draft.planDetails?.sectors ? { sectors: recoveredSectors } : {}),
      }));
      setRelatedProjectId(
        draft.relatedProjectId != null && !permittedProjects.has(draft.relatedProjectId)
          ? null
          : draft.relatedProjectId ?? null,
      );
      setLinkMode(draft.linkMode ?? "standalone");
      setLocalities(draft.localities ?? []);
      setActivities((draft.activities ?? []).map((activity) => ({
        ...activity,
        budgetPlanned: 0,
        budgetActual: 0,
        status: "planned",
        progressPct: 0,
        riskId: activity.riskId && !permittedRisks.has(activity.riskId) ? null : activity.riskId,
      })));
    },
  });

  // ── Computed totals from activities (memoised) ─────────────────────────────
  const totals = useMemo(() => {
    const acts = activities;
    return {
      count: acts.length,
      totalBeneficiaries: acts.reduce((s, a) => s + Number(a.targetBeneficiaries ?? 0), 0),
      plannedBudget: acts.reduce((s, a) => s + Number(a.budgetPlanned ?? 0), 0),
      actualBudget: acts.reduce((s, a) => s + Number(a.budgetActual ?? 0), 0),
      completed: acts.filter((a) => a.status === "completed").length,
      delayed: acts.filter((a) => a.status === "delayed").length,
    };
  }, [activities]);

  // ── Locality suggestions from selected project ─────────────────────────────
  const projectLocalities = useMemo(() => {
    if (!relatedProjectId) return [];
    const proj = projects?.find((p) => p.id === relatedProjectId);
    const raw = proj as unknown as { localities?: Array<{ name?: string } | string> } | undefined;
    if (!raw?.localities) return [];
    return raw.localities.map((l) => (typeof l === "string" ? l : l.name ?? "")).filter(Boolean);
  }, [relatedProjectId, projects]);

  const localitySuggestions = useMemo(
    () => [...new Set([...localities, ...projectLocalities])],
    [localities, projectLocalities],
  );

  // ── Project combobox filtering (code · title · donor) ─────────────────────
  const filteredProjects = useMemo(() => {
    const q = projectSearch.toLowerCase().trim();
    if (!q) return projects ?? [];
    return (projects ?? []).filter((p) => {
      const donor = (p as unknown as { donor?: string }).donor ?? "";
      return (
        (p.code?.toLowerCase().includes(q) ?? false) ||
        (p.title?.toLowerCase().includes(q) ?? false) ||
        donor.toLowerCase().includes(q)
      );
    });
  }, [projects, projectSearch]);

  // ── PLAN-BD-2: Debounced duplicate preflight ──────────────────────────────
  //
  // Fires after a 500ms debounce whenever the canonical identity fields change.
  // Required fields for the check: planType + startDate + endDate + at least
  // one of (stateId, locationType=hq).  We skip the check for irregular types
  // too to avoid unnecessary network calls (soft warning runs silently).
  //
  // The preflight is best-effort: network errors set kind="error" and do NOT
  // block creation — the backend CREATE guard handles true duplicates.
  //
  // Reset to "idle" on dialog open (handled by handleReset clearing planDetails).
  useEffect(() => {
    const { planType, startDate, endDate, stateId } = planDetails;
    const isHqPlan = stateId === "__HQ__";

    // Skip if required identity fields are missing.
    const hasRequiredFields =
      planType && startDate && endDate && (isHqPlan || stateId);
    if (!hasRequiredFields) {
      setDuplicateCheck({ kind: "idle" });
      return;
    }

    // Only structured types get a preflight (irregular = soft warning from server,
    // but we still run for soft awareness).
    setDuplicateCheck({ kind: "loading" });

    // Stale-response guard: if identity fields change while the fetch is
    // in-flight, the cleanup sets cancelled=true so the old response never
    // overwrites the state driven by the newer set of fields.
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await checkDuplicatePlan({
          planType,
          startDate,
          endDate,
          stateId: isHqPlan ? null : (stateId ? Number(stateId) : null),
          projectId: relatedProjectId,
          locationType: isHqPlan ? "hq" : null,
          // Self-duplicate exclusion: when editing an existing draft, pass its
          // ID so the preflight doesn't block the user from updating their own plan.
          draftPlanId: draftPlanId ?? null,
        });
        if (!cancelled) setDuplicateCheck({ kind: "result", result });
      } catch {
        // Network / server error — do not block creation.
        if (!cancelled) setDuplicateCheck({ kind: "error" });
      }
    }, 500);

    return () => {
      cancelled = true;  // Mark this invocation stale before cleanup fires.
      clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDetails.planType, planDetails.startDate, planDetails.endDate, planDetails.stateId, relatedProjectId, draftPlanId]);

  // ── Derived duplicate check state ─────────────────────────────────────────
  const isHardDuplicate =
    duplicateCheck.kind === "result" &&
    duplicateCheck.result.matchType === "hard";
  const isSoftDuplicate =
    duplicateCheck.kind === "result" &&
    duplicateCheck.result.matchType === "soft";
  const hardDuplicateExisting =
    isHardDuplicate && duplicateCheck.kind === "result" && duplicateCheck.result.matchType === "hard"
      ? duplicateCheck.result.existing
      : null;
  // Wave 2 soft-duplicate UX: accessible existing plan ID (null when the actor
  // cannot see the matched plan — no navigation is exposed in that case).
  // Derived from the CURRENT duplicateCheck state only, so the existing
  // stale-response guard automatically protects this link too.
  const softDuplicatePlanId =
    duplicateCheck.kind === "result" && duplicateCheck.result.matchType === "soft"
      ? duplicateCheck.result.planId ?? null
      : null;

  // ── Validation errors (only shown after a save attempt) ───────────────────
  // saveFinishAttempted uses the full finish validator (includes description).
  // attemptedSave only (Save As Draft) uses the draft validator (no description).
  const detailErrors: DetailsErrors = saveFinishAttempted
    ? validateFinishFields(planDetails)
    : (attemptedSave ? validateDraftFields(planDetails) : {});
  const hasDetailErrors = Object.keys(detailErrors).length > 0;

  // Geographical Coverage error — only flagged after a Save & Finish attempt.
  // Save As Draft is explicitly excluded from this requirement.
  const hasGeographyError = saveFinishAttempted && localities.length === 0;
  // Activities error — only flagged after Save & Finish attempt.
  const hasActivityError = saveFinishAttempted && (
    activities.length === 0 ||
    !activities.some((a) =>
      isActivityComplete(a, planDetails.startDate, planDetails.endDate, localities)
    )
  );
  // Budget derived values — always kept in sync with the live activities state.
  const remainingBudget = budget.budgetPlanned - totals.plannedBudget;
  const isOverAllocated = Number.isFinite(remainingBudget) && remainingBudget < 0;
  // Budget error — only flagged after Save & Finish attempt.
  const hasBudgetFinishError = saveFinishAttempted && (
    !CURRENCIES.includes(budget.currency) ||
    !Number.isFinite(budget.budgetPlanned) ||
    budget.budgetPlanned < 0 ||
    isOverAllocated
  );
  const hasAnyFinishError = hasDetailErrors || hasGeographyError || hasActivityError || hasBudgetFinishError;

  // ── Single create mutation — handles both draft-save and complete flows ─────
  const createMutation = useCreatePlan({
    mutation: {
      onSuccess: (created) => {
        isInflight.current = false;
        const id    = (created as unknown as { id: number }).id;
        const code  = (created as unknown as { code?: string }).code ?? "";
        const token = (created as unknown as { registrationToken?: string }).registrationToken ?? null;

        if (completeAfterCreate.current) {
          // ── Complete flow (first save = Save & Finish) ──────────────────
          // The POST body included closeRegistration=true so the server has
          // already closed the Registration Session inside the creation
          // transaction.  No second revocation request is needed or sent.
          // The response does not include a registrationToken.
          completeAfterCreate.current = false;
          qc.invalidateQueries({ queryKey: ["/api/plans"] });
          qc.invalidateQueries({ queryKey: ["/api/plans/dashboard"] });
          toast.success(t("createDialog.registrationCompleted"), {
            description: code
              ? t("createDialog.registrationCompletedDesc", { code })
              : t("createDialog.registrationCompletedDescGeneric"),
          });
          void planDraft.clear();
          handleReset();
          onOpenChange(false);
          setLocation(`/plans/${id}`);
        } else {
          // ── Draft-save flow: store token → stay open → show toast ─────────
          // The registration token is held in React state for the active
          // Registration lifecycle only. It is cleared on reset/close.
          setDraftPlanId(id);
          setRegistrationToken(token);
          toast.success(t("createDialog.draftSavedToast"), {
            description: code
              ? t("createDialog.draftSavedToastDesc", { code })
              : t("createDialog.draftSavedToastDescGeneric"),
          });
          qc.invalidateQueries({ queryKey: ["/api/plans"] });
          qc.invalidateQueries({ queryKey: ["/api/plans/dashboard"] });
          setApiError(null);
          void planDraft.clear();
        }
      },
      onError: (e: Error) => {
        isInflight.current = false;
        completeAfterCreate.current = false;
        const msg = e.message ?? "";
        if (msg.includes("403") || msg.toLowerCase().includes("permission")) {
          setApiError(t("createDialog.permissionError"));
        } else {
          setApiError(t("createDialog.saveError"));
        }
      },
    },
  });

  // ── Update mutation — used for both draft-save and complete when draftPlanId set
  const updateMutation = useUpdatePlan({
    mutation: {
      onSuccess: (_data, variables) => {
        isInflight.current = false;
        const planId = variables.planId as number;
        const updatedCode = (_data as unknown as { code?: string })?.code ?? "";

        if (completeAfterCreate.current) {
          // ── Complete flow: toast → close → navigate to Plan Details ───────
          completeAfterCreate.current = false;
          qc.invalidateQueries({ queryKey: ["/api/plans"] });
          qc.invalidateQueries({ queryKey: ["/api/plans/dashboard"] });
          toast.success(t("createDialog.registrationCompleted"), {
            description: updatedCode
              ? t("createDialog.registrationCompletedDesc", { code: updatedCode })
              : t("createDialog.registrationCompletedDescGeneric"),
          });
          void planDraft.clear();
          handleReset();
          onOpenChange(false);
          setLocation(`/plans/${planId}`);
        } else {
          // ── Draft-save flow ────────────────────────────────────────────────
          toast.success(t("createDialog.draftSavedChangesToast"), { description: t("createDialog.draftSavedChangesToastDesc") });
          qc.invalidateQueries({ queryKey: ["/api/plans"] });
          qc.invalidateQueries({ queryKey: ["/api/plans/dashboard"] });
          setApiError(null);
          void planDraft.clear();
        }
      },
      onError: (e: Error) => {
        isInflight.current = false;
        completeAfterCreate.current = false;
        setApiError(t("createDialog.saveError"));
        console.error(e);
      },
    },
  });

  // ── Reset ──────────────────────────────────────────────────────────────────
  function handleReset() {
    if (resetGuard.current) return;
    resetGuard.current = true;
    setPlanDetails(makeEmptyDetails(defaultPlanType));
    setRelatedProjectId(null);
    setLinkMode("standalone");
    setProjectSearch("");
    setProjectComboOpen(false);
    setLocalities([]);
    setActivities([]);
    setBudget(makeEmptyBudget());
    setDraftPlanId(null);
    // Clear the registration session token — the active session has been explicitly
    // revoked server-side before this is called (or there was no draft yet).
    setRegistrationToken(null);
    setActiveTabIndex(0);
    setAttemptedSave(false);
    // Clear duplicate preflight state on reset.
    setDuplicateCheck({ kind: "idle" });
    setSaveFinishAttempted(false);
    setApiError(null);
    // Clear close-session states so they do not leak into the next Registration.
    setIsClosingSession(false);
    setCloseSessionError(null);
    // Clear state-change confirmation states.
    setStateChangeConfirmOpen(false);
    setPendingStateId(null);
    setLocalityRemoveState(null);
    setActivityDeleteConfirmIdx(null);
    setCurrencyChangeConfirm(null);
    isInflight.current = false;
    completeAfterCreate.current = false;
    isDirtyRef.current = false;
    setTimeout(() => { resetGuard.current = false; }, 0);
  }

  /** Mark form as dirty on any field change. */
  function markDirty() { isDirtyRef.current = true; }

  // ── Helpers: planDetails ───────────────────────────────────────────────────
  function setDetailField<K extends keyof PlanDetailsForm>(k: K, v: PlanDetailsForm[K]) {
    markDirty();
    setPlanDetails((f) => ({ ...f, [k]: v }));
    setApiError(null);
  }

  function toggleSector(sector: string) {
    markDirty();
    setPlanDetails((f) => ({
      ...f,
      sectors: f.sectors.includes(sector)
        ? f.sectors.filter((s) => s !== sector)
        : [...f.sectors, sector],
    }));
    setApiError(null);
  }

  // ── Helpers: localities ────────────────────────────────────────────────────
  function handleStateChange(v: string) {
    if (v === planDetails.stateId) return; // no-op — state unchanged
    if (localities.length > 0) {
      // Localities already exist — ask before discarding them.
      setPendingStateId(v);
      setStateChangeConfirmOpen(true);
      return;
    }
    setDetailField("stateId", v);
  }

  function confirmStateChange() {
    if (pendingStateId == null) return;
    setLocalities([]);
    // Also clear locality assignments from all Activities — they are no longer
    // valid after the State (and therefore Geographical Coverage) changes.
    setActivities((prev) => prev.map((a) => ({ ...a, localityName: "" })));
    setDetailField("stateId", pendingStateId);
    setPendingStateId(null);
    setStateChangeConfirmOpen(false);
  }

  // ── Helpers: activities ────────────────────────────────────────────────────
  function addActivity() { markDirty(); setActivities((a) => [...a, emptyActivity()]); }
  function removeActivity(idx: number) { markDirty(); setActivities((a) => a.filter((_, i) => i !== idx)); }
  function updateActivity(idx: number, patch: Partial<ActivityForm>) {
    markDirty();
    setActivities((a) => a.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  }

  /**
   * Delete an Activity.  When the card has entered data, opens an AlertDialog
   * for confirmation instead of the browser-native window.confirm().
   * Empty / untouched Activities are removed immediately.
   */
  function handleRemoveActivity(idx: number) {
    const a = activities[idx];
    const hasData = !!(
      a.title.trim() || a.localityName || a.plannedDate || a.expectedResult.trim() ||
      a.targetBeneficiaries > 0 || a.budgetPlanned > 0 || a.responsibleName.trim()
    );
    if (hasData) {
      setActivityDeleteConfirmIdx(idx);
    } else {
      removeActivity(idx);
    }
  }

  /** Confirmed: remove the Activity that triggered the AlertDialog. */
  function confirmRemoveActivity() {
    if (activityDeleteConfirmIdx !== null) {
      removeActivity(activityDeleteConfirmIdx);
    }
    setActivityDeleteConfirmIdx(null);
  }

  /**
   * Intercepts locality removal — if any Activity references the locality,
   * opens a confirm dialog before mutating.  Otherwise removes immediately.
   */
  function handleAttemptRemoveLocality(idx: number) {
    const name = localities[idx];
    const count = activities.filter((a) => a.localityName === name).length;
    if (count > 0) {
      setLocalityRemoveState({ idx, name, count });
    } else {
      markDirty();
      setLocalities((prev) => prev.filter((_, i) => i !== idx));
    }
  }

  /** Confirms locality removal and clears the locality from affected Activities. */
  function confirmRemoveLocality() {
    if (!localityRemoveState) return;
    const { idx, name } = localityRemoveState;
    markDirty();
    setLocalities((prev) => prev.filter((_, i) => i !== idx));
    setActivities((prev) =>
      prev.map((a) => (a.localityName === name ? { ...a, localityName: "" } : a))
    );
    setLocalityRemoveState(null);
  }

  // ── Helpers: budget ────────────────────────────────────────────────────────
  function setBudgetField<K extends keyof BudgetForm>(k: K, v: BudgetForm[K]) {
    markDirty();
    setBudget((b) => ({ ...b, [k]: v }));
  }

  // ── Build API payload ──────────────────────────────────────────────────────
  function buildPayload(status: string) {
    const isHqPlan = planDetails.stateId === "__HQ__";
    return {
      title:           planDetails.title.trim(),
      planType:        planDetails.planType,
      ...(isHqPlan
        ? { locationType: "hq" as const }
        : { stateId: Number(planDetails.stateId) }),
      responsibleName: planDetails.responsibleName.trim(),
      sectors:         planDetails.sectors,
      startDate:       planDetails.startDate as unknown as Date,
      endDate:         planDetails.endDate   as unknown as Date,
      description:     planDetails.description.trim() || undefined,
      status,
      projectId:       relatedProjectId ?? undefined,
      localities,
      currency:        budget.currency,
      budgetPlanned:   budget.budgetPlanned,
      budgetActual:    budget.budgetActual,
      fundingSource:   budget.fundingSource || undefined,
      activities:      activities.map((a) => ({
        ...a,
        plannedDate: a.plannedDate || null,
        startDate:   a.plannedDate || null,
        endDate:     a.plannedDate || null,
        targetBeneficiaries: Number(a.targetBeneficiaries),
        budgetPlanned:       Number(a.budgetPlanned),
        budgetActual:        Number(a.budgetActual),
      })),
    };
  }

  // ── Shared pre-dispatch validation ────────────────────────────────────────
  /**
   * Returns true when all preconditions pass and dispatch should proceed.
   * Sets the appropriate state (attemptedSave, apiError) on failure.
   */
  function checkBeforeDispatch(requireDescription = false): boolean {
    setAttemptedSave(true);
    const errors = requireDescription
      ? validateFinishFields(planDetails)
      : validateDraftFields(planDetails);
    if (Object.keys(errors).length > 0) return false;
    // Save & Finish also requires at least one Locality in Geographical Coverage.
    // Save As Draft does NOT require any Localities.
    if (requireDescription && localities.length === 0) return false;
    // Save & Finish requires at least one complete Activity.
    // Save As Draft is permissive — zero or incomplete Activities are fine.
    if (requireDescription) {
      if (activities.length === 0) return false;
      const hasComplete = activities.some((a) =>
        isActivityComplete(a, planDetails.startDate, planDetails.endDate, localities)
      );
      if (!hasComplete) return false;
    }
    // Save & Finish requires valid Budget — Save As Draft is permissive.
    if (requireDescription) {
      if (!CURRENCIES.includes(budget.currency)) return false;
      if (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0) return false;
      if (isOverAllocated) return false;
    }
    // ── Activity status/progress consistency validation (PLAN-BD-4) ──────────
    // Check all activities regardless of whether requireDescription is set —
    // contradictory status+progress combinations are always invalid (draft or finish).
    const progressErrors: string[] = [];
    for (let i = 0; i < activities.length; i++) {
      const a = activities[i];
      const errKey = validateActivityProgressConsistency(a.status, a.progressPct);
      if (errKey) {
        progressErrors.push(
          t("createDialog.activityProgressError", {
            num: i + 1,
            title: a.title.trim() || t("createDialog.untitledActivity"),
            message: t(errKey),
          }),
        );
      }
    }
    if (progressErrors.length > 0) {
      setApiError(progressErrors.join("\n"));
      return false;
    }
    if (isTc && tcSectors !== null && tcSectors.length === 0) {
      setApiError(t("createDialog.tcNoSectors"));
      return false;
    }
    if (isInflight.current) return false; // synchronous double-submit guard
    return true;
  }

  /** Change Plan currency — requires confirmation when Activities have non-zero budgets. */
  function handleCurrencyChange(newCurrency: string) {
    if (totals.plannedBudget > 0) {
      setCurrencyChangeConfirm(newCurrency);
    } else {
      markDirty();
      setBudgetField("currency", newCurrency);
    }
  }

  // ── Save As Draft ──────────────────────────────────────────────────────────
  async function handleSaveAsDraft() {
    if (!isOnline) {
      await planDraft.saveNow();
      toast.info(commonT("sync.planDraftSaved"));
      onOpenChange(false);
      return;
    }
    if (!checkBeforeDispatch()) return;

    // Ensure complete intent is OFF (this is a draft save, not a complete)
    completeAfterCreate.current = false;
    isInflight.current = true;

    const payload = buildPayload("draft");

    if (draftPlanId == null) {
      createMutation.mutate({
        data: payload as unknown as Parameters<typeof createMutation.mutate>[0]["data"],
      });
    } else {
      // Include the registration session token — the PATCH handler requires it
      // to validate the active Registration session server-side.
      updateMutation.mutate({
        planId: draftPlanId,
        data: { ...payload, registrationToken } as unknown as Parameters<typeof updateMutation.mutate>[0]["data"],
      });
    }
  }

  // ── Save & Finish ──────────────────────────────────────────────────────────
  function handleComplete() {
    if (!isOnline) {
      toast.error(commonT("sync.planFinishOnlineRequired"));
      return;
    }
    // Mark that Save & Finish has been attempted — drives the "Sections Need
    // Attention" summary banner independently from the Save As Draft path.
    setSaveFinishAttempted(true);
    if (!checkBeforeDispatch(true)) return;

    // Set completion intent BEFORE dispatch so onSuccess always sees it
    completeAfterCreate.current = true;
    isInflight.current = true;

    const payload = buildPayload("draft");

    if (draftPlanId == null) {
      // First save — initial Save & Finish.
      // Pass closeRegistration=true so the server closes the Registration
      // Session inside the same creation transaction.  No second revocation
      // request will be needed — the backend guarantees atomicity.
      createMutation.mutate({
        data: { ...payload, closeRegistration: true } as unknown as Parameters<typeof createMutation.mutate>[0]["data"],
      });
    } else {
      // Draft exists — update then complete.
      // closeRegistration=true signals the server to atomically revoke the
      // Registration session within the same PATCH transaction.
      updateMutation.mutate({
        planId: draftPlanId,
        data: { ...payload, registrationToken, closeRegistration: true } as unknown as Parameters<typeof updateMutation.mutate>[0]["data"],
      });
    }
  }

  // ── Tab navigation ─────────────────────────────────────────────────────────
  // Tabs are freely navigable — no sequential gate. Navigation itself never
  // triggers validation. Validation happens only on explicit Save/Finish actions.
  function goToNextTab() {
    setActiveTabIndex((i) => Math.min(i + 1, TABS.length - 1));
  }

  function goToPrevTab() {
    setActiveTabIndex((i) => Math.max(i - 1, 0));
  }

  // ── Cancel handling ────────────────────────────────────────────────────────
  function handleCancelClick() {
    if (!isDirtyRef.current && draftPlanId == null) {
      handleReset();
      onOpenChange(false);
    } else {
      // Clear any stale error from a previous failed close attempt before
      // re-opening the confirmation dialog.
      setCloseSessionError(null);
      setCancelConfirmOpen(true);
    }
  }

  /**
   * Handles explicit user-initiated close of the Registration workspace.
   *
   * When a persisted Draft with an active Registration session exists, this
   * MUST await server-side revocation before clearing the client token and
   * closing the workspace.  If revocation fails, the dialog stays open so
   * the user can retry — the token is preserved for the retry attempt.
   *
   * When no persisted Draft exists there is no session to revoke, so the
   * dialog closes immediately.
   */
  async function handleConfirmCancel() {
    if (!draftPlanId || !registrationToken) {
      // No persisted draft / no active session token — close immediately.
      setCancelConfirmOpen(false);
      setCloseSessionError(null);
      handleReset();
      onOpenChange(false);
      return;
    }

    // Persisted draft with active Registration session: must await server revocation.
    setIsClosingSession(true);
    setCloseSessionError(null);

    try {
      await closeRegistrationApi(draftPlanId, registrationToken);
      // ── Success: revocation confirmed server-side ──
      // Now safe to clear the token and close the workspace.
      setCancelConfirmOpen(false);
      handleReset();             // clears token + isClosingSession + error
      onOpenChange(false);
      setLocation("/plans");
    } catch {
      // ── Failure: keep dialog open for retry ──
      // Do NOT clear the token — it is still needed for a subsequent retry.
      // Error text is factual and contains no credential value.
      setIsClosingSession(false);
      setCloseSessionError(t("createDialog.unableToCloseRegistration"));
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;
  const activeTab = TABS[activeTabIndex];
  const currentStateName = states?.find((s) => String(s.id) === planDetails.stateId)?.name ?? "";

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Dialog open={open} onOpenChange={(next) => { if (!next) handleCancelClick(); }}>
        <DialogContent
          className="max-w-4xl h-[90vh] p-0 gap-0 flex flex-col overflow-hidden"
          aria-labelledby="cprd-title"
          aria-describedby="cprd-desc"
        >
          {/* ── Sticky Header ────────────────────────────────────────────── */}
          <div className="px-6 pt-4 pb-3 border-b shrink-0">
            <DialogHeader className="pe-8">
              <DialogTitle id="cprd-title" className="text-lg font-semibold leading-tight">{t("createDialog.title")}</DialogTitle>
              <DialogDescription id="cprd-desc" className="text-[13px] text-muted-foreground mt-0.5 max-w-2xl">
                {t("createDialog.description")}
              </DialogDescription>
            </DialogHeader>
            <OfflineDraftNotice status={planDraft.status} error={planDraft.error} />
          </div>

          {/* ── Tab navigation strip ──────────────────────────────────────── */}
          <div
            role="tablist"
            aria-label={t("createDialog.tabsAriaLabel")}
            className="border-b bg-muted/30 shrink-0 px-4"
          >
            <div className="flex overflow-x-auto py-1.5 gap-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {TABS.map((tab, i) => {
                const isActive = activeTabIndex === i;
                const hasError =
                  (i === 0 && attemptedSave && hasDetailErrors) ||
                  (i === 2 && hasGeographyError) ||
                  (i === 3 && hasActivityError) ||
                  (i === 4 && hasBudgetFinishError);
                return (
                  <button
                    key={tab.id}
                    id={`plan-tab-${tab.id}`}
                    role="tab"
                    aria-selected={isActive}
                    aria-controls={`plan-panel-${tab.id}`}
                    type="button"
                    onClick={() => setActiveTabIndex(i)}
                    className={[
                      "flex flex-1 min-w-max items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition-colors",
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/70",
                    ].join(" ")}
                  >
                    <span className={[
                      "flex items-center justify-center w-5 h-5 shrink-0 rounded-full text-xs font-semibold",
                      isActive
                        ? "bg-white/20 text-primary-foreground"
                        : "bg-border/60 text-muted-foreground",
                    ].join(" ")}>
                      {i + 1}
                    </span>
                    <span>{t(`createDialog.tab_${tab.id}`)}</span>
                    {hasError && (
                      <span className="w-1.5 h-1.5 shrink-0 rounded-full bg-destructive inline-block" aria-label={t("createDialog.validationError")} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Scrollable body ───────────────────────────────────────────── */}
          <div className="overflow-y-auto flex-1 min-h-0 px-6 py-4">

            {/* ── Tab 1: Plan Details ─────────────────────────────────────── */}
            {activeTab.id === "details" && (
              <div
                id="plan-panel-details"
                role="tabpanel"
                aria-labelledby="plan-tab-details"
                className="space-y-4"
              >
                {/* Plan title */}
                <div className="space-y-1">
                  <Label htmlFor="cprd-title-input" className="text-sm font-medium">
                    {t("createDialog.planTitle")} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id="cprd-title-input"
                    placeholder={t("createDialog.planTitlePh")}
                    value={planDetails.title}
                    onChange={(e) => setDetailField("title", e.target.value)}
                    aria-required="true"
                    aria-describedby={detailErrors.title ? "cprd-title-err" : undefined}
                    autoFocus
                  />
                  {detailErrors.title && (
                    <p id="cprd-title-err" role="alert" className="text-xs text-destructive">{t(detailErrors.title!)}</p>
                  )}
                </div>

                {/* Plan type | State */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="cprd-type" className="text-sm font-medium">
                      {t("createDialog.planType")} <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Select value={planDetails.planType} onValueChange={(v) => setDetailField("planType", v)}>
                      <SelectTrigger id="cprd-type" aria-required="true" aria-describedby={detailErrors.planType ? "cprd-type-err" : undefined}>
                        <SelectValue placeholder={t("createDialog.planTypePh")} />
                      </SelectTrigger>
                      <SelectContent>
                        {PLAN_TYPE_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>{t(`planTypes.${opt.value}`)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {detailErrors.planType && (
                      <p id="cprd-type-err" role="alert" className="text-xs text-destructive">{t(detailErrors.planType!)}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="cprd-state" className="text-sm font-medium">
                      {t("createDialog.stateLocation")} <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Select value={planDetails.stateId} onValueChange={handleStateChange}>
                      <SelectTrigger id="cprd-state" aria-required="true" aria-describedby={detailErrors.stateId ? "cprd-state-err" : undefined}>
                        <SelectValue placeholder={t("createDialog.stateLocationPh")} />
                      </SelectTrigger>
                      <SelectContent>
                        {!isStateRole && (
                          <SelectGroup>
                            <SelectLabel>{t("createDialog.organisation")}</SelectLabel>
                            <SelectItem value="__HQ__">{t("createDialog.hqHeadquarters")}</SelectItem>
                          </SelectGroup>
                        )}
                        <SelectGroup>
                          <SelectLabel>{t("createDialog.states")}</SelectLabel>
                          {(states ?? []).map((s) => (
                            <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>
                          ))}
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                    {detailErrors.stateId && (
                      <p id="cprd-state-err" role="alert" className="text-xs text-destructive">{t(detailErrors.stateId!)}</p>
                    )}
                  </div>
                </div>

                {/* Responsible person */}
                <div className="space-y-1">
                  <Label htmlFor="cprd-responsible" className="text-sm font-medium">
                    {t("createDialog.responsiblePerson")} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <div className="max-w-sm">
                    <Input
                      id="cprd-responsible"
                      placeholder={t("createDialog.responsiblePersonPh")}
                      value={planDetails.responsibleName}
                      onChange={(e) => setDetailField("responsibleName", e.target.value)}
                      aria-required="true"
                      aria-describedby={detailErrors.responsibleName ? "cprd-responsible-err" : undefined}
                    />
                  </div>
                  {detailErrors.responsibleName && (
                    <p id="cprd-responsible-err" role="alert" className="text-xs text-destructive">{t(detailErrors.responsibleName!)}</p>
                  )}
                </div>

                {/* Sector(s) */}
                <div className="space-y-1">
                  <Label className="text-sm font-medium">
                    {t("createDialog.sectors")} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  {availableSectors.length === 0 ? (
                    <p className="text-xs text-destructive px-1">{t("createDialog.noSectorsAssigned")}</p>
                  ) : (
                    <div
                      className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-1.5 border rounded-md bg-muted/20"
                      role="group"
                      aria-label={t("createDialog.sectorsAriaLabel")}
                      aria-required="true"
                    >
                      {availableSectors.map((sector) => {
                        const checked = planDetails.sectors.includes(sector);
                        return (
                          <label
                            key={sector}
                            className={`flex items-center gap-2 text-sm cursor-pointer rounded px-2 py-[7px] select-none transition-colors leading-tight ${
                              checked
                                ? "bg-primary/10 text-primary font-medium"
                                : "hover:bg-muted/60 text-foreground"
                            }`}
                          >
                            <input
                              type="checkbox"
                              className="accent-primary shrink-0 mt-px"
                              checked={checked}
                              onChange={() => toggleSector(sector)}
                              aria-label={sector}
                            />
                            <span className="min-w-0">{sector}</span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                  {detailErrors.sectors && (
                    <p role="alert" className="text-xs text-destructive">{t(detailErrors.sectors!)}</p>
                  )}
                </div>

                {/* Start date | End date */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label htmlFor="cprd-start" className="text-sm font-medium">
                      {t("createDialog.startDate")} <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Input
                      id="cprd-start"
                      type="date"
                      value={planDetails.startDate}
                      onChange={(e) => setDetailField("startDate", e.target.value)}
                      aria-required="true"
                      aria-describedby={detailErrors.startDate ? "cprd-start-err" : undefined}
                    />
                    {detailErrors.startDate && (
                      <p id="cprd-start-err" role="alert" className="text-xs text-destructive">{t(detailErrors.startDate!)}</p>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="cprd-end" className="text-sm font-medium">
                      {t("createDialog.endDate")} <span className="text-destructive" aria-hidden="true">*</span>
                    </Label>
                    <Input
                      id="cprd-end"
                      type="date"
                      value={planDetails.endDate}
                      onChange={(e) => setDetailField("endDate", e.target.value)}
                      aria-required="true"
                      aria-describedby={detailErrors.endDate ? "cprd-end-err" : undefined}
                    />
                    {detailErrors.endDate && (
                      <p id="cprd-end-err" role="alert" className="text-xs text-destructive">{t(detailErrors.endDate!)}</p>
                    )}
                  </div>
                </div>

                {/* Description */}
                <div className="space-y-1">
                  <Label htmlFor="cprd-description" className="text-sm font-medium">
                    {t("createDialog.description")} <span className="text-destructive" aria-hidden="true">*</span>
                  </Label>
                  <Textarea
                    id="cprd-description"
                    placeholder={t("createDialog.descriptionPh")}
                    rows={3}
                    value={planDetails.description}
                    onChange={(e) => setDetailField("description", e.target.value)}
                    aria-required="true"
                    aria-describedby={detailErrors.description ? "cprd-description-err" : undefined}
                    className="resize-y"
                  />
                  {detailErrors.description && (
                    <p id="cprd-description-err" role="alert" className="text-xs text-destructive">{t(detailErrors.description!)}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 2: Related Project ──────────────────────────────────── */}
            {activeTab.id === "project" && (
              <div
                id="plan-panel-project"
                role="tabpanel"
                aria-labelledby="plan-tab-project"
                className="space-y-5 max-w-[640px]"
              >
                {/* ── Heading ──────────────────────────────────────────────── */}
                <div>
                  <h3 className="text-sm font-semibold leading-tight">{t("createDialog.relatedProjectHeading")}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("createDialog.relatedProjectDesc")}
                  </p>
                </div>

                {/* ── Two-option choice ────────────────────────────────────── */}
                <div role="group" aria-label={t("createDialog.projectLinkModeAriaLabel")} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {/* Standalone Plan */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={linkMode === "standalone"}
                    onClick={() => {
                      if (linkMode !== "standalone") {
                        markDirty();
                        setLinkMode("standalone");
                        setRelatedProjectId(null);
                        setProjectSearch("");
                        setProjectComboOpen(false);
                      }
                    }}
                    className={[
                      "flex items-start gap-3 rounded-md border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      linkMode === "standalone"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-border/80 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <span className={[
                      "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      linkMode === "standalone" ? "border-primary" : "border-muted-foreground/40",
                    ].join(" ")} aria-hidden="true">
                      {linkMode === "standalone" && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span>
                      <span className="text-sm font-medium leading-tight block">{t("createDialog.standalonePlanLabel")}</span>
                      <span className="text-xs text-muted-foreground mt-0.5 block">
                        {t("createDialog.standalonePlanDesc")}
                      </span>
                    </span>
                  </button>

                  {/* Link To Existing Project */}
                  <button
                    type="button"
                    role="radio"
                    aria-checked={linkMode === "linked"}
                    onClick={() => {
                      if (linkMode !== "linked") {
                        markDirty();
                        setLinkMode("linked");
                      }
                    }}
                    className={[
                      "flex items-start gap-3 rounded-md border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      linkMode === "linked"
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-border/80 hover:bg-muted/40",
                    ].join(" ")}
                  >
                    <span className={[
                      "mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                      linkMode === "linked" ? "border-primary" : "border-muted-foreground/40",
                    ].join(" ")} aria-hidden="true">
                      {linkMode === "linked" && <span className="h-2 w-2 rounded-full bg-primary" />}
                    </span>
                    <span>
                      <span className="text-sm font-medium leading-tight block">{t("createDialog.linkToProjectLabel")}</span>
                      <span className="text-xs text-muted-foreground mt-0.5 block">
                        {t("createDialog.linkToProjectDesc")}
                      </span>
                    </span>
                  </button>
                </div>

                {/* ── Standalone informational state ───────────────────────── */}
                {linkMode === "standalone" && (
                  <div className="rounded-md border border-border bg-muted/20 px-4 py-3">
                    <p className="text-sm font-medium text-foreground">{t("createDialog.standaloneInfoTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {t("createDialog.standaloneInfoDesc")}
                    </p>
                  </div>
                )}

                {/* ── Linked state ─────────────────────────────────────────── */}
                {linkMode === "linked" && (
                  <div className="space-y-3">

                    {/* Loading */}
                    {projectsLoading && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                        <span>{t("createDialog.loadingProjects")}</span>
                      </div>
                    )}

                    {/* Error */}
                    {projectsError && !projectsLoading && (
                      <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription className="text-sm">
                          {t("createDialog.unableToLoadProjects")}
                        </AlertDescription>
                      </Alert>
                    )}

                    {/* No projects in authorised scope */}
                    {!projectsLoading && !projectsError && (projects ?? []).length === 0 && (
                      <div className="rounded-md border border-border bg-muted/20 px-4 py-4 space-y-2">
                        <p className="text-sm font-medium">{t("createDialog.noProjectsAvailable")}</p>
                        <p className="text-xs text-muted-foreground">
                          {t("createDialog.noProjectsAvailableDesc")}
                        </p>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            markDirty();
                            setLinkMode("standalone");
                            setRelatedProjectId(null);
                          }}
                        >
                          {t("createDialog.useStandalonePlan")}
                        </Button>
                      </div>
                    )}

                    {/* Project selector — shown when projects exist and none selected yet */}
                    {!projectsLoading && !projectsError && (projects ?? []).length > 0 && !relatedProjectId && (
                      <div className="space-y-1.5">
                        <Label className="text-xs font-medium" id="cprd-project-label">
                          {t("createDialog.selectProject")}
                        </Label>
                        <Popover open={projectComboOpen} onOpenChange={setProjectComboOpen}>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              role="combobox"
                              aria-expanded={projectComboOpen}
                              aria-haspopup="listbox"
                              aria-labelledby="cprd-project-label"
                              className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                              <span>{t("createDialog.searchProjectPh")}</span>
                              <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" aria-hidden="true" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="p-0"
                            style={{ width: "var(--radix-popover-trigger-width)" }}
                            align="start"
                          >
                            <Command shouldFilter={false}>
                              <CommandInput
                                placeholder={t("createDialog.searchProjectPh")}
                                value={projectSearch}
                                onValueChange={setProjectSearch}
                              />
                              <CommandList
                              onWheel={(e) => e.stopPropagation()}
                              className="overscroll-contain"
                            >
                                {filteredProjects.length === 0 && (
                                  <CommandEmpty>{t("createDialog.noMatchingProjects")}</CommandEmpty>
                                )}
                                <CommandGroup>
                                  {filteredProjects.map((p) => {
                                    const donor = (p as unknown as { donor?: string }).donor;
                                    return (
                                      <CommandItem
                                        key={p.id}
                                        value={String(p.id)}
                                        onSelect={() => {
                                          markDirty();
                                          setRelatedProjectId(p.id);
                                          setProjectSearch("");
                                          setProjectComboOpen(false);
                                        }}
                                        className="flex items-start gap-2 py-2"
                                      >
                                        <Check className="mt-[3px] h-3.5 w-3.5 shrink-0 opacity-0 group-data-[selected=true]:opacity-100" aria-hidden="true" />
                                        <span className="flex flex-col min-w-0">
                                          <span className="text-[11px] font-mono text-muted-foreground"><bdi dir="ltr">{p.code}</bdi></span>
                                          <span className="text-sm font-medium leading-snug">{p.title}</span>
                                          {donor && (
                                            <span className="text-xs text-muted-foreground truncate">{donor}</span>
                                          )}
                                        </span>
                                      </CommandItem>
                                    );
                                  })}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                    )}

                    {/* Selected project preview */}
                    {relatedProjectId != null && (() => {
                      const proj = projects?.find((p) => p.id === relatedProjectId);
                      if (!proj) return null;
                      const pd = proj as unknown as {
                        code?: string; title?: string; status?: string;
                        donor?: string; stateNames?: string[]; stateNamesAr?: string[]; sector?: string; sectors?: string[];
                      };
                      const stateNames: string[] = pd.stateNames ?? [];
                      const stateNamesAr: string[] = pd.stateNamesAr ?? [];
                      const sectorList: string[] = pd.sectors ?? (pd.sector ? [pd.sector] : []);
                      const { variant, className: badgeCls } = statusBadgeVariant(pd.status ?? "");
                      return (
                        <div className="rounded-md border bg-card">
                          <div className="px-4 py-3 space-y-2">
                            {/* Code + Status */}
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[11px] font-mono text-muted-foreground">{pd.code}</span>
                              {pd.status && (
                                <Badge
                                  variant={variant}
                                  className={`${badgeCls ?? ""} text-xs`}
                                  aria-label={`Status: ${formatStatusLabel(pd.status)}`}
                                >
                                  {formatStatusLabel(pd.status)}
                                </Badge>
                              )}
                            </div>
                            {/* Title */}
                            <p className="text-sm font-medium leading-snug">{pd.title}</p>
                            {/* Labelled metadata row */}
                            {(pd.donor || stateNames.length > 0 || sectorList.length > 0) && (
                              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                {pd.donor && (
                                  <span>
                                    <span className="text-muted-foreground">{t("createDialog.donorLabel")}</span>{" "}
                                    <span className="text-foreground">{pd.donor}</span>
                                  </span>
                                )}
                                {stateNames.length > 0 && (
                                  <span>
                                    <span className="text-muted-foreground">
                                      {stateNames.length === 1 ? t("createDialog.stateLabel_one") : t("createDialog.stateLabel_other")}
                                    </span>{" "}
                                    <span className="text-foreground">{stateNames.map((name, index) => getStateLabel({ name, nameAr: stateNamesAr[index] }, i18n?.language)).join(", ")}</span>
                                  </span>
                                )}
                                {sectorList.length > 0 && (
                                  <span>
                                    <span className="text-muted-foreground">
                                      {sectorList.length === 1 ? t("createDialog.sectorLabel_one") : t("createDialog.sectorLabel_other")}
                                    </span>{" "}
                                    <span className="text-foreground">{sectorList.join(", ")}</span>
                                  </span>
                                )}
                              </div>
                            )}
                            {/* Locality suggestions */}
                            {projectLocalities.length > 0 && (
                              <div className="pt-1">
                                <p className="text-xs text-muted-foreground mb-1.5">
                                  {t("createDialog.localitiesSuggestionsLabel")}
                                </p>
                                <div className="flex flex-wrap gap-1">
                                  {projectLocalities.slice(0, 10).map((l) => (
                                    <Badge key={l} variant="outline" className="text-xs font-normal">{l}</Badge>
                                  ))}
                                  {projectLocalities.length > 10 && (
                                    <Badge variant="outline" className="text-xs font-normal text-muted-foreground">
                                      {t("createDialog.moreSuggestions", { count: projectLocalities.length - 10 })}
                                    </Badge>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Actions */}
                          <div className="flex items-center gap-4 px-4 py-2.5 border-t bg-muted/10 rounded-b-md">
                            <button
                              type="button"
                              onClick={() => {
                                markDirty();
                                setRelatedProjectId(null);
                                setProjectSearch("");
                              }}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            >
                              {t("createDialog.changeProject")}
                            </button>
                            <button
                              type="button"
                              aria-label={t("createDialog.removeLinkAria")}
                              onClick={() => {
                                markDirty();
                                setRelatedProjectId(null);
                                setLinkMode("standalone");
                                setProjectSearch("");
                                setProjectComboOpen(false);
                              }}
                              className="text-xs text-muted-foreground hover:text-destructive transition-colors underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                            >
                              {t("createDialog.removeLink")}
                            </button>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            )}

            {/* ── Tab 3: Geographical Coverage ───────────────────────────── */}
            {activeTab.id === "geography" && (
              <div
                id="plan-panel-geography"
                role="tabpanel"
                aria-labelledby="plan-tab-geography"
                className="space-y-4"
              >
                {/* Section heading */}
                <div>
                  <h3 className="text-sm font-semibold mb-0.5">
                    {t("createDialog.geoCoverageHeading")}{" "}
                    <span className="text-destructive" aria-label={t("createDialog.geoCoverageRequired")}>*</span>
                  </h3>
                  {currentStateName ? (
                    <>
                      <p className="text-xs text-muted-foreground mb-3">
                        {t("createDialog.addAtLeastOneLocality")}
                      </p>
                      {/* State context — read-only, Plan Details is authoritative */}
                      <div className="inline-flex items-center gap-1.5 mb-4 rounded-md bg-muted/60 border border-border/50 px-2.5 py-1">
                        <span className="text-xs text-muted-foreground">{t("createDialog.stateContextLabel")}</span>
                        <span className="text-xs font-medium text-foreground">{currentStateName}</span>
                      </div>

                      {/* Section-level validation message — only after Save & Finish attempt */}
                      {hasGeographyError && (
                        <div
                          role="alert"
                          id="geography-error"
                          className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive"
                        >
                          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{t("createDialog.atLeastOneLocality")}</span>
                        </div>
                      )}

                      {/* Locality input + chip list */}
                      <LocalityTagInput
                        localities={localities}
                        onChange={(v) => { markDirty(); setLocalities(v); }}
                        onAttemptRemove={handleAttemptRemoveLocality}
                        suggestions={localitySuggestions}
                      />

                      {/* Linked project suggestions (separate — not auto-applied) */}
                      {projectLocalities.length > 0 && (
                        <div className="mt-4 pt-3 border-t">
                          <p className="text-xs font-medium text-muted-foreground mb-2">
                            {t("createDialog.suggestedFromLinkedProject")}
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {projectLocalities
                              .filter((pl) => !localities.some(
                                (l) => l.toLowerCase().replace(/\s+/g, " ") === pl.toLowerCase().replace(/\s+/g, " ")
                              ))
                              .map((pl, i) => (
                                <button
                                  key={i}
                                  type="button"
                                  aria-label={t("createDialog.addSuggestedLocality", { name: pl })}
                                  onClick={() => {
                                    const norm = pl.toLowerCase().replace(/\s+/g, " ");
                                    const isDupe = localities.some(
                                      (l) => l.toLowerCase().replace(/\s+/g, " ") === norm,
                                    );
                                    if (!isDupe) {
                                      markDirty();
                                      setLocalities((prev) => [...prev, pl.trim()]);
                                    }
                                  }}
                                  className="inline-flex items-center gap-1 bg-card border border-dashed border-border/60 rounded-full px-2.5 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                                >
                                  <Plus className="h-2.5 w-2.5" /> {pl}
                                </button>
                              ))}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Suggestions must be explicitly added before they count as Plan coverage.
                          </p>
                        </div>
                      )}
                    </>
                  ) : (
                    /* No State selected — show dependency state only */
                    <div className="rounded-lg border bg-muted/40 p-6 text-center mt-3">
                      <MapPin className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
                      <p className="text-sm font-medium text-foreground mb-1">
                        {t("createDialog.selectStateFirst")}
                      </p>
                      <p className="text-xs text-muted-foreground mb-4">
                        {t("createDialog.selectStateFirstDesc")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        onClick={() => setActiveTabIndex(0)}
                        aria-label={t("createDialog.goToPlanDetailsAria")}
                      >
                        {t("createDialog.goToPlanDetails")}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ── Tab 4: Activities ───────────────────────────────────────── */}
            {activeTab.id === "activities" && (
              <div
                id="plan-panel-activities"
                role="tabpanel"
                aria-labelledby="plan-tab-activities"
                className="space-y-4"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-semibold flex items-baseline gap-2">
                      {t("createDialog.activitiesHeading")}
                      {activities.length > 0 && (
                        <span className="text-xs font-normal text-muted-foreground">
                          {t("createDialog.activitiesCount", { count: activities.length })}
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{t("createDialog.activitiesDesc")}</p>
                  </div>
                  {activities.length > 0 && (
                    <Button size="sm" variant="outline" onClick={addActivity} type="button" className="gap-1.5">
                      <Plus className="h-3 w-3 shrink-0" /> {t("createDialog.addActivity")}
                    </Button>
                  )}
                </div>

                {activities.length === 0 && (
                  <div className="rounded-md border border-dashed border-border bg-muted/30 p-6 text-center">
                    <p className="text-sm font-medium text-foreground">{t("createDialog.noActivitiesTitle")}</p>
                    <p className="text-xs text-muted-foreground mt-1">{t("createDialog.noActivitiesDesc")}</p>
                    <Button size="sm" variant="outline" className="mt-3" onClick={addActivity} type="button">
                  <Plus className="h-3 w-3" /> {t("createDialog.addFirstActivity")}
                    </Button>
                  </div>
                )}

                {activities.map((a, idx) => (
                  <div key={idx} className="rounded-lg border bg-muted/10">
                    {/* Card header */}
                    <div className="flex items-center justify-between px-4 py-2.5 border-b">
                      <span className="text-sm font-medium truncate flex-1">
                        {t("createDialog.activityNum", { num: idx + 1 })}{a.title ? `: ${a.title}` : ""}
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0"
                            onClick={() => handleRemoveActivity(idx)}
                            type="button"
                            aria-label={t("createDialog.removeActivityAria", { num: idx + 1 })}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("createDialog.tooltipRemoveActivity")}</TooltipContent>
                      </Tooltip>
                    </div>

                    {/* Card body */}
                    <div className="px-4 py-3 space-y-2.5">
                      {/* Activity title */}
                      <div>
                        <Label className="text-sm">{t("createDialog.activityTitle")} <span className="text-destructive">*</span></Label>
                        <Input
                          placeholder={t("createDialog.activityTitlePh")}
                          value={a.title}
                          onChange={(e) => updateActivity(idx, { title: e.target.value })}
                        />
                      </div>

                      {/* State (read-only — inherited from Plan Details) | Locality */}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">{t("createDialog.stateLabel")}</Label>
                          {/* State is authoritative in Tab 1 — contextual info, not an editable field */}
                          <div
                            className="py-1.5 space-y-0.5"
                            role="note"
                            aria-label={t("createDialog.stateContextAria", { state: currentStateName || t("createDialog.stateNotSet") })}
                          >
                            <p className="text-sm text-foreground leading-tight">
                              {currentStateName || <span className="italic text-muted-foreground/60">—</span>}
                            </p>
                            <p className="text-[10px] text-muted-foreground leading-none">{t("createDialog.stateInherited")}</p>
                          </div>
                        </div>
                        <div>
                          <Label className="text-sm" htmlFor={`activity-locality-${idx}`}>
                            {t("createDialog.localityLabel")} <span className="text-destructive">*</span>
                          </Label>
                          <ActivityLocalitySelect
                            value={a.localityName}
                            onChange={(v) => updateActivity(idx, { localityName: v })}
                            localities={localities}
                            onGoToGeography={() => setActiveTabIndex(2)}
                          />
                        </div>
                      </div>

                      {/* Planned date | Priority */}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">{t("createDialog.plannedDate")} <span className="text-destructive">*</span></Label>
                          <Input
                            type="date"
                            value={a.plannedDate}
                            onChange={(e) => updateActivity(idx, { plannedDate: e.target.value })}
                            min={planDetails.startDate || undefined}
                            max={planDetails.endDate || undefined}
                          />
                        </div>
                        <div>
                          <Label className="text-sm">{t("createDialog.priority")} <span className="text-destructive">*</span></Label>
                          <Select value={a.priority} onValueChange={(v) => updateActivity(idx, { priority: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {PRIORITIES.map((p) => (
                                <SelectItem key={p.value} value={p.value}>
                                  <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${p.cls}`}>{t(`activity.priority_${p.value}`)}</span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Target beneficiaries | Planned budget */}
                      <div className="grid md:grid-cols-2 gap-3">
                        <div>
                          <Label className="text-sm">{t("createDialog.targetBeneficiaries")} <span className="text-destructive">*</span></Label>
                          <Input
                            type="number"
                            min={0}
                            value={a.targetBeneficiaries}
                            step={1}
                            onChange={(e) => updateActivity(idx, { targetBeneficiaries: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <Label className="text-sm">{t("createDialog.plannedBudget")} <span className="text-destructive">*</span></Label>
                          <Input
                            type="number"
                            min={0}
                            value={a.budgetPlanned}
                            onChange={(e) => updateActivity(idx, { budgetPlanned: Number(e.target.value) })}
                          />
                        </div>
                      </div>

                      {/* Responsible person */}
                      <div className="max-w-sm">
                        <Label className="text-sm">{t("createDialog.responsiblePersonActivity")}</Label>
                        <Input
                          placeholder={t("createDialog.responsiblePersonActivityPh")}
                          value={a.responsibleName}
                          onChange={(e) => updateActivity(idx, { responsibleName: e.target.value })}
                        />
                      </div>

                      {/* Expected result */}
                      <div>
                        <Label className="text-sm">{t("createDialog.expectedResult")} <span className="text-destructive">*</span></Label>
                        <Textarea
                          rows={2}
                          placeholder={t("createDialog.expectedResultPh")}
                          value={a.expectedResult}
                          onChange={(e) => updateActivity(idx, { expectedResult: e.target.value })}
                          className="resize-y"
                        />
                      </div>

                      <ActivityOptionalFields a={a} idx={idx} updateActivity={updateActivity} risks={risks} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Tab 5: Budget ───────────────────────────────────────────── */}
            {activeTab.id === "budget" && (
              <div
                id="plan-panel-budget"
                role="tabpanel"
                aria-labelledby="plan-tab-budget"
                className="space-y-6"
              >
                {/* ── Budget fields ──────────────────────────────────────────── */}
                <div>
                  <h3 className="text-sm font-semibold mb-3">{t("createDialog.budgetHeading")}</h3>
                  <div className="flex flex-wrap gap-3">
                    <div className="max-w-xs w-full sm:w-auto sm:min-w-[140px]">
                      <Label htmlFor="cprd-currency">{t("createDialog.currency")} <span className="text-destructive">*</span></Label>
                      <Select value={budget.currency} onValueChange={handleCurrencyChange}>
                        <SelectTrigger id="cprd-currency"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CURRENCIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="max-w-sm w-full sm:w-auto sm:min-w-[200px]">
                      <Label htmlFor="cprd-budget-planned">
                        {t("createDialog.planPlannedBudget")} <span className="text-destructive">*</span>
                      </Label>
                      <Input
                        id="cprd-budget-planned"
                        type="number"
                        min={0}
                        value={budget.budgetPlanned}
                        onChange={(e) => { markDirty(); setBudgetField("budgetPlanned", Number(e.target.value)); }}
                        aria-describedby={
                          saveFinishAttempted && (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0)
                            ? "cprd-budget-planned-error"
                            : undefined
                        }
                      />
                      {saveFinishAttempted && (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0) && (
                        <p id="cprd-budget-planned-error" role="alert" className="text-xs text-destructive mt-0.5">
                          {t("createDialog.validPlannedBudget")}
                        </p>
                      )}
                    </div>
                    <div className="max-w-xs w-full sm:w-auto sm:min-w-[180px]">
                      <Label htmlFor="cprd-funding-source">{t("createDialog.fundingSource")}</Label>
                      <Input
                        id="cprd-funding-source"
                        placeholder={t("createDialog.fundingSourcePh")}
                        value={budget.fundingSource}
                        onChange={(e) => { markDirty(); setBudgetField("fundingSource", e.target.value); }}
                      />
                    </div>
                  </div>
                  {/* Plan budget actual is NOT manually entered during Registration —
                      actual expenditure comes from authoritative implementation data. */}
                </div>

                {/* ── Activity Summary ───────────────────────────────────────── */}
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-3">
                    {t("createDialog.activitySummaryHeading")}
                  </p>

                  {totals.count === 0 ? (
                    /* Empty state — neutral, not warning-styled */
                    <div className="rounded-md border border-dashed border-border bg-muted/30 px-4 py-5 text-center">
                      <p className="text-sm font-medium text-foreground">{t("createDialog.noActivitiesBudgetTitle")}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {t("createDialog.noActivitiesBudgetDesc")}
                      </p>
                      <Button
                        size="sm"
                        variant="outline"
                        type="button"
                        className="mt-3 gap-1.5"
                        onClick={() => setActiveTabIndex(3)}
                      >
                        {t("createDialog.goToActivities")}
                      </Button>
                    </div>
                  ) : (
                    <>
                      {/* Over-allocation inline warning — not communicated by colour alone */}
                      {isOverAllocated && (
                        <div
                          role="alert"
                          aria-live="polite"
                          className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2"
                        >
                          <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-destructive font-medium">
                              {t("createDialog.overAllocatedMessage", {
                                currency: budget.currency,
                                amount: Math.abs(remainingBudget).toLocaleString(),
                              })}
                            </p>
                            <p className="text-xs text-destructive/80 mt-0.5">
                              {t("createDialog.overAllocatedHint")}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            className="shrink-0 h-7 text-xs px-2 border-destructive/30 text-destructive hover:bg-destructive/10"
                            onClick={() => setActiveTabIndex(3)}
                          >
                            {t("createDialog.goToActivities")}
                          </Button>
                        </div>
                      )}

                      {/* Summary stat cards — derived from live shared activities state */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-xs text-muted-foreground mb-1">{t("createDialog.totalActivities")}</p>
                          <p className="font-bold text-2xl leading-none" aria-label={t("createDialog.activitiesCountAria", { count: totals.count })}>
                            {totals.count}
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-xs text-muted-foreground mb-1">{t("createDialog.totalTargetBeneficiaries")}</p>
                          <p
                            className="font-bold text-2xl leading-none"
                            aria-label={t("createDialog.beneficiariesAria", { count: totals.totalBeneficiaries.toLocaleString() })}
                          >
                            {totals.totalBeneficiaries.toLocaleString()}
                          </p>
                        </div>
                        <div className="rounded-lg border bg-muted/30 p-3">
                          <p className="text-xs text-muted-foreground mb-1">{t("createDialog.activityPlannedBudget")}</p>
                          <p
                            className="font-bold text-xl leading-none"
                            aria-label={`${budget.currency} ${totals.plannedBudget.toLocaleString()}`}
                          >
                            {budget.currency} {totals.plannedBudget.toLocaleString()}
                          </p>
                        </div>
                        <div className={`rounded-lg border p-3 ${isOverAllocated ? "bg-destructive/10 border-destructive/30" : "bg-muted/30"}`}>
                          <p className="text-xs text-muted-foreground mb-1">{t("createDialog.remainingBudget")}</p>
                          {!Number.isFinite(budget.budgetPlanned) ? (
                            <p className="text-sm text-muted-foreground italic">{t("createDialog.setBudgetAbove")}</p>
                          ) : isOverAllocated ? (
                            <p
                              className="font-bold text-xl leading-none text-destructive"
                              aria-label={`${budget.currency} ${Math.abs(remainingBudget).toLocaleString()} ${t("createDialog.overallocated")}`}
                            >
                              {budget.currency} {Math.abs(remainingBudget).toLocaleString()}
                              <span className="block text-xs font-normal text-destructive/80 mt-0.5">{t("createDialog.overallocated")}</span>
                            </p>
                          ) : (
                            <p
                              className="font-bold text-xl leading-none"
                              aria-label={`${budget.currency} ${remainingBudget.toLocaleString()} ${t("createDialog.remaining")}`}
                            >
                              {budget.currency} {remainingBudget.toLocaleString()}
                              <span className="block text-xs font-normal text-muted-foreground mt-0.5">{t("createDialog.remaining")}</span>
                            </p>
                          )}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* PLAN-BD-2: Duplicate warning banner */}
            {isHardDuplicate && (
              <div
                role="alert"
                aria-live="assertive"
                className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm"
                data-testid="duplicate-hard-warning"
              >
                <p className="font-medium text-destructive mb-1 flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  A Plan already exists for this scope and period.
                </p>
                {hardDuplicateExisting?.planId != null
                  && hardDuplicateExisting.status === "draft"
                  && canResumeExistingDraft && (
                  <div className="mt-2">
                    <ContinueEditingAction
                      recordTitle={hardDuplicateExisting.title}
                      onClick={() => {
                        const targetId = hardDuplicateExisting!.planId!;
                        handleReset();
                        onOpenChange(false);
                        setLocation(`/plans/${targetId}?edit=1`);
                      }}
                    />
                    <span className="text-muted-foreground ms-2 text-xs"><bdi dir="ltr">(Plan #{hardDuplicateExisting.planId})</bdi></span>
                  </div>
                )}
                <p className="text-xs text-muted-foreground mt-1">
                  Please continue editing the existing Plan rather than creating a duplicate.
                </p>
              </div>
            )}

            {isSoftDuplicate && (
              <div
                role="status"
                aria-live="polite"
                className="mt-4 rounded-md border border-amber-400/40 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 text-sm"
                data-testid="duplicate-soft-warning"
              >
                <p className="font-medium text-amber-700 dark:text-amber-400 mb-1 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                  A similar Plan already exists for this scope and period.
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-500">
                  Review the existing Plan before creating another one. You may continue if this is intentional.
                </p>
                {/* Wave 2: navigate to the accessible existing plan's detail view.
                    Rendered only when the backend returned an accessible planId. */}
                {softDuplicatePlanId != null && (
                  <div className="mt-2">
                    <button
                      type="button"
                      data-testid="duplicate-soft-review-link"
                      className="underline underline-offset-2 text-amber-700 dark:text-amber-400 hover:no-underline font-medium"
                      onClick={() => {
                        const targetId = softDuplicatePlanId;
                        handleReset();
                        onOpenChange(false);
                        setLocation(`/plans/${targetId}`);
                      }}
                    >
                      Review Existing Plan
                    </button>
                    <span className="text-muted-foreground ms-2 text-xs"><bdi dir="ltr">(Plan #{softDuplicatePlanId})</bdi></span>
                  </div>
                )}
              </div>
            )}

            {/* API-level error banner */}
            {apiError && (
              <div
                role="alert"
                className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {apiError}
              </div>
            )}

            {/* ── "Sections Need Attention" summary — shown only after Save & Finish attempt ── */}
            {saveFinishAttempted && hasAnyFinishError && (() => {
              const sectionCount =
                (hasDetailErrors ? 1 : 0) +
                (hasGeographyError ? 1 : 0) +
                (hasActivityError ? 1 : 0) +
                (hasBudgetFinishError ? 1 : 0);
              return (
                <div
                  role="alert"
                  aria-live="polite"
                  className="mt-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm"
                >
                  <p className="font-medium text-destructive mb-2">
                    {t("createDialog.sectionNeedsAttention", { count: sectionCount })}
                  </p>
                  <ul className="space-y-1">
                    {hasDetailErrors && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
                        <button
                          type="button"
                          className="text-destructive underline underline-offset-2 hover:no-underline text-sm font-medium"
                          onClick={() => setActiveTabIndex(0)}
                        >
                          {t("createDialog.sectionPlanDetails")}
                        </button>
                        <span className="text-destructive/80 text-xs">{t("createDialog.sectionPlanDetailsError")}</span>
                      </li>
                    )}
                    {hasGeographyError && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
                        <button
                          type="button"
                          className="text-destructive underline underline-offset-2 hover:no-underline text-sm font-medium"
                          onClick={() => setActiveTabIndex(2)}
                        >
                          {t("createDialog.sectionGeoCoverage")}
                        </button>
                        <span className="text-destructive/80 text-xs">{t("createDialog.sectionGeoCoverageError")}</span>
                      </li>
                    )}
                    {hasActivityError && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
                        <button
                          type="button"
                          className="text-destructive underline underline-offset-2 hover:no-underline text-sm font-medium"
                          onClick={() => setActiveTabIndex(3)}
                        >
                          {t("createDialog.sectionActivities")}
                        </button>
                        <span className="text-destructive/80 text-xs">
                          {activities.length === 0
                            ? t("createDialog.sectionActivitiesErrorEmpty")
                            : t("createDialog.sectionActivitiesErrorIncomplete")}
                        </span>
                      </li>
                    )}
                    {hasBudgetFinishError && (
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" aria-hidden="true" />
                        <button
                          type="button"
                          className="text-destructive underline underline-offset-2 hover:no-underline text-sm font-medium"
                          onClick={() => setActiveTabIndex(4)}
                        >
                          {t("createDialog.sectionBudget")}
                        </button>
                        <span className="text-destructive/80 text-xs">
                          {isOverAllocated
                            ? t("createDialog.sectionBudgetErrorOverallocated")
                            : t("createDialog.sectionBudgetErrorIncomplete")}
                        </span>
                      </li>
                    )}
                  </ul>
                </div>
              );
            })()}
          </div>

          {/* ── Sticky footer ─────────────────────────────────────────────── */}
          <div className="border-t bg-background px-6 py-3 shrink-0">
            <div className="flex items-center justify-between gap-3">
              {/* Left: Cancel or Previous */}
              {activeTabIndex === 0 ? (
                <Button variant="outline" size="sm" onClick={handleCancelClick} disabled={isPending} type="button">
                  {t("createDialog.cancel")}
                </Button>
              ) : (
                <Button variant="outline" size="sm" onClick={goToPrevTab} disabled={isPending} type="button">
                  {t("createDialog.previous")}
                </Button>
              )}

              {/* Right: Save As Draft + Next or Save & Finish */}
              <div className="flex items-center gap-2">
                {/* PLAN-BD-2: Disable save buttons when a hard duplicate exists */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveAsDraft}
                  disabled={isPending || isHardDuplicate}
                  aria-disabled={isHardDuplicate || undefined}
                  aria-busy={isPending && !completeAfterCreate.current}
                  type="button"
                >
                  {isPending && !completeAfterCreate.current ? (
                    <><span aria-hidden="true">{t("createDialog.savingDraft")}</span><span className="sr-only">{t("createDialog.savingDraftSr")}</span></>
                  ) : t("createDialog.saveAsDraft")}
                </Button>

                {activeTabIndex < TABS.length - 1 ? (
                  <Button size="sm" onClick={goToNextTab} disabled={isPending} type="button">
                    {t("createDialog.next")}
                  </Button>
                ) : (
                  /* "Save & Finish" — saves as Draft and closes Registration.
                     Does NOT submit, trigger any approval, or change plan status.
                     Submit For Approval remains a separate explicit action in Plan Details. */
                  <Button
                    size="sm"
                    onClick={handleComplete}
                    disabled={isPending || isHardDuplicate}
                    aria-disabled={isHardDuplicate || undefined}
                    aria-busy={isPending && completeAfterCreate.current}
                    type="button"
                  >
                    {isPending && completeAfterCreate.current ? (
                      <><span aria-hidden="true">{t("createDialog.savingFinish")}</span><span className="sr-only">{t("createDialog.savingFinishSr")}</span></>
                    ) : t("createDialog.saveAndFinish")}
                  </Button>
                )}
              </div>
            </div>

            {/* Draft saved indicator */}
            {draftPlanId != null && (
              <p className="text-xs text-muted-foreground mt-2 text-end">
                {t("createDialog.draftSaved", { id: draftPlanId })}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── State-change confirmation AlertDialog ────────────────────────── */}
      <AlertDialog
        open={stateChangeConfirmOpen}
        onOpenChange={(next) => {
          if (!next) {
            setPendingStateId(null);
            setStateChangeConfirmOpen(false);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createDialog.stateChangeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("createDialog.stateChangeDesc")}
              {activities.some((a) => a.localityName)
                ? t("createDialog.stateChangeDescActivities")
                : ""}
              {t("createDialog.stateChangeDescEnd")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setPendingStateId(null);
                setStateChangeConfirmOpen(false);
              }}
            >
              {t("createDialog.cancel")}
            </AlertDialogCancel>
            <Button variant="default" onClick={confirmStateChange}>
              {t("createDialog.changeState")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Currency change confirmation AlertDialog ──────────────────────── */}
      <AlertDialog
        open={currencyChangeConfirm !== null}
        onOpenChange={(next) => { if (!next) setCurrencyChangeConfirm(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createDialog.currencyChangeTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("createDialog.currencyChangeDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setCurrencyChangeConfirm(null)}>
              {t("createDialog.cancel")}
            </AlertDialogCancel>
            <Button
              variant="default"
              onClick={() => {
                if (currencyChangeConfirm) {
                  markDirty();
                  setBudgetField("currency", currencyChangeConfirm);
                }
                setCurrencyChangeConfirm(null);
              }}
            >
              {t("createDialog.changeCurrency")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Activity deletion confirmation AlertDialog ───────────────────── */}
      <AlertDialog
        open={activityDeleteConfirmIdx !== null}
        onOpenChange={(next) => { if (!next) setActivityDeleteConfirmIdx(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createDialog.activityDeleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("createDialog.activityDeleteDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setActivityDeleteConfirmIdx(null)}>
              {t("createDialog.cancel")}
            </AlertDialogCancel>
            <Button variant="destructive" onClick={confirmRemoveActivity}>
              {t("createDialog.removeActivity")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Locality removal confirmation AlertDialog ────────────────────── */}
      <AlertDialog
        open={localityRemoveState !== null}
        onOpenChange={(next) => { if (!next) setLocalityRemoveState(null); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("createDialog.localityRemoveTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {localityRemoveState
                ? t("createDialog.localityRemoveDesc", {
                    name: localityRemoveState.name,
                    count: localityRemoveState.count,
                  })
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setLocalityRemoveState(null)}>
              {t("createDialog.cancel")}
            </AlertDialogCancel>
            <Button variant="default" onClick={confirmRemoveLocality}>
              {t("createDialog.removeLocality")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Cancel confirmation AlertDialog ──────────────────────────────── */}
      {/*
        onOpenChange is guarded: when isClosingSession is true the dialog cannot
        be dismissed via Escape or clicking outside — the revocation is in-flight
        and the user must wait for it to complete or fail before choosing to retry.
      */}
      <AlertDialog
        open={cancelConfirmOpen}
        onOpenChange={(next) => {
          if (isClosingSession) return;       // block dismiss while revocation in-flight
          if (!next) setCloseSessionError(null); // clear error on natural close
          setCancelConfirmOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isClosingSession ? t("createDialog.cancelRegistrationTitle_closing") : t("createDialog.cancelRegistrationTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {closeSessionError
                ? t("createDialog.cancelRegistrationDesc_error")
                : draftPlanId != null
                  ? t("createDialog.cancelRegistrationDesc_draft")
                  : t("createDialog.cancelRegistrationDesc_new")}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Error feedback — no credential values; factual message only */}
          {closeSessionError && (
            <Alert className="mx-6 mb-0 mt-1 py-2 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
              <AlertDescription className="text-xs text-destructive">
                {closeSessionError}
              </AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            {/* "Keep editing" — always closes the AlertDialog (unless revocation is in-flight) */}
            <AlertDialogCancel
              disabled={isClosingSession}
              onClick={() => setCloseSessionError(null)}
            >
              {t("createDialog.keepEditing")}
            </AlertDialogCancel>

            {/*
              Confirm button is a plain Button (not AlertDialogAction) so the
              AlertDialog does not auto-close on click — we manage open state
              manually to handle the async revocation pending/error cycle.
            */}
            <Button
              variant="destructive"
              disabled={isClosingSession}
              onClick={handleConfirmCancel}
            >
              {isClosingSession
                ? t("createDialog.closing")
                : closeSessionError
                  ? t("createDialog.tryAgain")
                  : draftPlanId != null
                    ? t("createDialog.closeKeepDraft")
                    : t("createDialog.discard")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
