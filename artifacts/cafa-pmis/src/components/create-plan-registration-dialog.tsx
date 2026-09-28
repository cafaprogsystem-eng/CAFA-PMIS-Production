/**
 * CreatePlanRegistrationDialog — five-tab Plan creation workspace.
 *
 * Architecture contract:
 * • Mirrors the Project Registration UX: Modal shell → Pro Stepper → scrollable body → sticky footer.
 * • Parent state holds the complete form (planDetails, relatedProject, localities, activities[], budget).
 * • "Save As Draft" creates on first call (stores draftPlanId), PATCHes on subsequent calls.
 * • No record is created on tab navigation or dialog open — only on explicit Save/Complete.
 * • All five steps are freely navigable — no sequential gate. Step navigation never triggers validation.
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
  Alert, Button, Card, Chip, ComboBox, Input, Label, ListBox, Modal, Radio, RadioGroup, Spinner, TextArea, Tooltip,
} from "@heroui/react";
import { Stepper } from "@heroui-pro/react/stepper";
import { SelectField } from "@/components/select-field";
import { CheckItem, DateInput, RemovableTags } from "@/components/form-controls";
import { ConfirmModal } from "@/components/confirm-modal";
import { statusTone } from "@/components/view-modes/shared";
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
  Plus, Trash2, ChevronDown, ChevronUp, MapPin, AlertCircle, AlertTriangle,
} from "@/components/icons";
import { hasPerm, formatStatusLabel } from "@/lib/format";
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
  { value: "high",   color: "danger"  },
  { value: "medium", color: "warning" },
  { value: "low",    color: "default" },
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
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={inputId} className="text-xs font-medium">{t("createDialog.localityLabel")}</Label>
        <div className="flex gap-2">
          <Input
            id={inputId}
            fullWidth
            dir="auto"
            placeholder={t("detail.localityPh")}
            value={inputVal}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }}
            className="flex-1"
          />
          <Button variant="outline" size="sm" className="h-auto shrink-0" onPress={() => addLocality()} isDisabled={!inputVal.trim()}>
            {t("detail.addLocality")}
          </Button>
        </div>
        {similar && (
          <Alert status="warning" className="py-2">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description className="flex flex-wrap items-center gap-2 text-xs">
                {t("detail.similarTo", { name: similar })}
                <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onPress={() => addLocality(similar)}>{t("detail.useExisting")}</Button>
                <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onPress={() => setSimilar(null)}>{t("detail.keepMine")}</Button>
              </Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </div>
      {localities.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs text-[var(--muted)]">{t("createDialog.localityCount", { count: localities.length })}</p>
          <RemovableTags
            items={localities}
            aria-label={t("createDialog.addedLocalitiesAria")}
            onRemove={(loc) => { const i = localities.indexOf(loc); if (i >= 0) onAttemptRemove(i); }}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-4 text-center">
          <p className="text-sm font-medium text-[var(--foreground)]">{t("createDialog.noLocalitiesTitle")}</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">{t("createDialog.noLocalitiesDesc")}</p>
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
  id, value, onChange, localities, onGoToGeography,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  /** The Plan's approved locality list from Tab 3 */
  localities: string[];
  onGoToGeography: () => void;
}) {
  const { t } = useTranslation("planning");
  if (localities.length === 0) {
    return (
      <div className="space-y-1.5">
        <Label isRequired className="text-sm">{t("createDialog.localityLabel")}</Label>
        <div className="space-y-1.5 rounded-xl border border-dashed border-[var(--border)] px-3 py-2">
          <p className="text-xs leading-snug text-[var(--muted)]">{t("createDialog.localityDepMessage")}</p>
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onPress={onGoToGeography}>
            {t("createDialog.goToGeoCoverage")}
          </Button>
        </div>
      </div>
    );
  }
  return (
    <SelectField
      id={id}
      label={t("createDialog.localityLabel")}
      isRequired
      value={value || "__none__"}
      onChange={(v) => onChange(v === "__none__" ? "" : v)}
      placeholder={t("createDialog.selectLocality")}
      className="w-full"
      options={[
        { value: "__none__", label: "—", textValue: t("createDialog.selectLocality") },
        ...localities.map((loc) => ({ value: loc, label: loc })),
      ]}
    />
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
  const f = (n: string) => `cprd-act-${idx}-${n}`;
  return (
    <div className="mt-2 border-t border-[var(--border)] pt-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-1.5 text-xs text-[var(--muted)]"
        aria-expanded={open}
        onPress={() => setOpen(!open)}
      >
        {open ? <ChevronUp className="size-3" aria-hidden="true" /> : <ChevronDown className="size-3" aria-hidden="true" />}
        {open ? t("createDialog.hideOptional") : t("createDialog.showOptional")}
      </Button>
      {open && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-4">
            <SelectField
              label={t("createDialog.optStatus")}
              value={a.status}
              onChange={(v) => {
                const patch: Partial<ActivityForm> = { status: v };
                if (v === "completed") patch.progressPct = 100;
                updateActivity(idx, patch);
              }}
              className="w-full"
              options={ACTIVITY_STATUSES.map((s) => ({ value: s, label: t(`activity.status_${s}`) }))}
            />
            <div className="space-y-1">
              <Label htmlFor={f("progress")} className="text-sm">{t("createDialog.optProgress")}</Label>
              <Input id={f("progress")} fullWidth type="number" min={0} max={100} value={a.progressPct} onChange={(e) => updateActivity(idx, { progressPct: Number(e.target.value) })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={f("actual")} className="text-sm">{t("createDialog.optBudgetActual")}</Label>
              <Input id={f("actual")} fullWidth type="number" min={0} value={a.budgetActual} onChange={(e) => updateActivity(idx, { budgetActual: Number(e.target.value) })} />
            </div>
            <SelectField
              label={t("createDialog.optLinkedRisk")}
              value={a.riskId ? String(a.riskId) : "__none__"}
              onChange={(v) => updateActivity(idx, { riskId: v === "__none__" ? null : Number(v) })}
              className="w-full"
              options={[
                { value: "__none__", label: t("createDialog.optNone") },
                ...(risks ?? []).map((r) => ({
                  value: String(r.id),
                  label: `${r.title} (${t(`presentation.riskLevels.${r.severity}`, { ns: "risks", defaultValue: r.severity })})`,
                  textValue: r.title,
                })),
              ]}
            />
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor={f("output")} className="text-sm">{t("createDialog.optExpectedOutput")}</Label>
              <Input id={f("output")} fullWidth dir="auto" value={a.expectedOutput} onChange={(e) => updateActivity(idx, { expectedOutput: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label htmlFor={f("indicator")} className="text-sm">{t("createDialog.optPerfIndicator")}</Label>
              <Input id={f("indicator")} fullWidth dir="auto" value={a.performanceIndicator} onChange={(e) => updateActivity(idx, { performanceIndicator: e.target.value })} />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor={f("notes")} className="text-sm">{t("createDialog.optDescNotes")}</Label>
            <TextArea id={f("notes")} fullWidth dir="auto" rows={2} value={a.description} onChange={(e) => updateActivity(idx, { description: e.target.value })} />
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

  // ── Step navigation ────────────────────────────────────────────────────────
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  // On narrow screens the stepper scrolls sideways; keep the current step in
  // view by scrolling only the stepper strip, as the project form does.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[data-stepper-scroll] [id="plan-tab-${TABS[activeTabIndex]?.id}"]`);
    const strip = el?.closest<HTMLElement>("[data-stepper-scroll]");
    if (!el || !strip) return;
    const stripBox = strip.getBoundingClientRect();
    const box = el.getBoundingClientRect();
    if (box.left < stripBox.left) strip.scrollBy?.({ left: box.left - stripBox.left - 16, behavior: "smooth" });
    else if (box.right > stripBox.right) strip.scrollBy?.({ left: box.right - stripBox.right + 16, behavior: "smooth" });
  }, [activeTabIndex]);

  // ── Form state ─────────────────────────────────────────────────────────────
  const [planDetails, setPlanDetails] = useState<PlanDetailsForm>(() => makeEmptyDetails(defaultPlanType));
  const [relatedProjectId, setRelatedProjectId] = useState<number | null>(null);
  /** "standalone" = no project link; "linked" = user chose to link a project. */
  const [linkMode, setLinkMode] = useState<"standalone" | "linked">("standalone");
  /** Current search query for the project combobox. */
  const [projectSearch, setProjectSearch] = useState("");
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
  const isHqPlan = planDetails.stateId === "__HQ__";
  const currentState = states?.find((s) => String(s.id) === planDetails.stateId);
  // HQ plans have no State but still record the localities they cover, so the
  // coverage step must open for them too (it used to ask for a State forever).
  const currentStateName = isHqPlan
    ? t("createDialog.hqHeadquarters")
    : currentState ? getStateLabel(currentState, i18n?.language) : "";
  const errorText = (id: string, key?: string) =>
    key ? <p id={id} role="alert" className="text-xs text-[var(--danger)]">{t(key)}</p> : null;
  const stepErrors = [
    attemptedSave && hasDetailErrors,
    false,
    hasGeographyError,
    hasActivityError,
    hasBudgetFinishError,
  ];

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <>
      <Modal isOpen={open} onOpenChange={(next) => { if (!next) handleCancelClick(); }}>
        <Modal.Backdrop>
          <Modal.Container size="lg">
            <Modal.Dialog
              className="flex h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl"
              aria-labelledby="cprd-title"
              aria-describedby="cprd-desc"
            >
              <Modal.CloseTrigger />
              {/* ── Header ─────────────────────────────────────────────────── */}
              <Modal.Header className="shrink-0 border-b border-[var(--border)] px-6 pt-5 pb-3">
                <Modal.Heading id="cprd-title">{t("createDialog.title")}</Modal.Heading>
                <p id="cprd-desc" className="max-w-2xl text-sm text-[var(--muted)]">
                  {t("createDialog.subtitle")}
                </p>
                <OfflineDraftNotice status={planDraft.status} error={planDraft.error} />
              </Modal.Header>

              {/* ── Step navigation — HeroUI Pro Stepper, as in the project and
                  report forms. Every step stays clickable; a step with errors
                  says so under its title. ── */}
              <div className="shrink-0 border-b border-[var(--border)]">
                <div data-stepper-scroll className="overflow-x-auto px-6 py-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <Stepper
                    aria-label={t("createDialog.tabsAriaLabel")}
                    className="min-w-[720px]"
                    currentStep={activeTabIndex}
                    onStepChange={(index) => { if (TABS[index]) setActiveTabIndex(index); }}
                  >
                    {TABS.map((tab, i) => (
                      <Stepper.Step key={tab.id} id={`plan-tab-${tab.id}`}>
                        <Stepper.Indicator />
                        <Stepper.Content>
                          <Stepper.Title>{t(`createDialog.tab_${tab.id}`)}</Stepper.Title>
                          {stepErrors[i] && (
                            <Stepper.Description className="text-[var(--danger)]">{t("createDialog.stepHasErrors")}</Stepper.Description>
                          )}
                        </Stepper.Content>
                        <Stepper.Separator />
                      </Stepper.Step>
                    ))}
                  </Stepper>
                </div>
              </div>

              {/* ── Scrollable body ─────────────────────────────────────────── */}
              <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">

                {/* ── Step 1: Plan Details ─────────────────────────────────── */}
                {activeTab.id === "details" && (
                  <section id="plan-panel-details" role="region" aria-labelledby="plan-tab-details" className="space-y-4">
                    <div className="space-y-1">
                      <Label isRequired htmlFor="cprd-title-input" className="text-sm font-medium">{t("createDialog.planTitle")}</Label>
                      <Input
                        id="cprd-title-input"
                        fullWidth
                        dir="auto"
                        placeholder={t("createDialog.planTitlePh")}
                        value={planDetails.title}
                        onChange={(e) => setDetailField("title", e.target.value)}
                        aria-required="true"
                        aria-invalid={!!detailErrors.title || undefined}
                        aria-describedby={detailErrors.title ? "cprd-title-err" : undefined}
                        autoFocus
                      />
                      {errorText("cprd-title-err", detailErrors.title)}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <SelectField
                          id="cprd-type"
                          label={t("createDialog.planType")}
                          isRequired
                          isInvalid={!!detailErrors.planType}
                          aria-describedby={detailErrors.planType ? "cprd-type-err" : undefined}
                          value={planDetails.planType}
                          onChange={(v) => setDetailField("planType", v)}
                          placeholder={t("createDialog.planTypePh")}
                          className="w-full"
                          options={PLAN_TYPE_OPTIONS.map((opt) => ({ value: opt.value, label: t(`planTypes.${opt.value}`) }))}
                        />
                        {errorText("cprd-type-err", detailErrors.planType)}
                      </div>
                      <div className="space-y-1">
                        <SelectField
                          id="cprd-state"
                          label={t("createDialog.stateLocation")}
                          isRequired
                          isInvalid={!!detailErrors.stateId}
                          aria-describedby={detailErrors.stateId ? "cprd-state-err" : undefined}
                          value={planDetails.stateId}
                          onChange={handleStateChange}
                          placeholder={t("createDialog.stateLocationPh")}
                          className="w-full"
                          options={[
                            ...(!isStateRole ? [{ value: "__HQ__", label: t("createDialog.hqHeadquarters") }] : []),
                            ...(states ?? []).map((s) => ({
                              value: String(s.id),
                              label: <StateLabel state={s} />,
                              textValue: getStateLabel(s, i18n?.language),
                            })),
                          ]}
                        />
                        {errorText("cprd-state-err", detailErrors.stateId)}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label isRequired htmlFor="cprd-responsible" className="text-sm font-medium">{t("createDialog.responsiblePerson")}</Label>
                      <div className="max-w-sm">
                        <Input
                          id="cprd-responsible"
                          fullWidth
                          dir="auto"
                          placeholder={t("createDialog.responsiblePersonPh")}
                          value={planDetails.responsibleName}
                          onChange={(e) => setDetailField("responsibleName", e.target.value)}
                          aria-required="true"
                          aria-invalid={!!detailErrors.responsibleName || undefined}
                          aria-describedby={detailErrors.responsibleName ? "cprd-responsible-err" : undefined}
                        />
                      </div>
                      {errorText("cprd-responsible-err", detailErrors.responsibleName)}
                    </div>

                    <div className="space-y-1">
                      <Label isRequired id="cprd-sectors-label" className="text-sm font-medium">{t("createDialog.sectors")}</Label>
                      {availableSectors.length === 0 ? (
                        <p className="px-1 text-xs text-[var(--danger)]">{t("createDialog.noSectorsAssigned")}</p>
                      ) : (
                        <div
                          className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--border)] p-2 sm:grid-cols-3"
                          role="group"
                          aria-labelledby="cprd-sectors-label"
                          aria-required="true"
                          aria-describedby={detailErrors.sectors ? "cprd-sectors-err" : undefined}
                        >
                          {availableSectors.map((sector) => (
                            <CheckItem
                              key={sector}
                              isSelected={planDetails.sectors.includes(sector)}
                              onChange={() => toggleSector(sector)}
                              className="rounded-lg px-2 py-1.5 hover:bg-[var(--default)]"
                            >
                              {sector}
                            </CheckItem>
                          ))}
                        </div>
                      )}
                      {errorText("cprd-sectors-err", detailErrors.sectors)}
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <DateInput
                          id="cprd-start"
                          label={t("createDialog.startDate")}
                          isRequired
                          isInvalid={!!detailErrors.startDate}
                          describedBy={detailErrors.startDate ? "cprd-start-err" : undefined}
                          value={planDetails.startDate}
                          onChange={(v) => setDetailField("startDate", v)}
                        />
                        {errorText("cprd-start-err", detailErrors.startDate)}
                      </div>
                      <div className="space-y-1">
                        <DateInput
                          id="cprd-end"
                          label={t("createDialog.endDate")}
                          isRequired
                          isInvalid={!!detailErrors.endDate}
                          describedBy={detailErrors.endDate ? "cprd-end-err" : undefined}
                          value={planDetails.endDate}
                          onChange={(v) => setDetailField("endDate", v)}
                        />
                        {errorText("cprd-end-err", detailErrors.endDate)}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <Label isRequired htmlFor="cprd-description" className="text-sm font-medium">{t("createDialog.description")}</Label>
                      <TextArea
                        id="cprd-description"
                        fullWidth
                        dir="auto"
                        placeholder={t("createDialog.descriptionPh")}
                        rows={3}
                        value={planDetails.description}
                        onChange={(e) => setDetailField("description", e.target.value)}
                        aria-required="true"
                        aria-invalid={!!detailErrors.description || undefined}
                        aria-describedby={detailErrors.description ? "cprd-description-err" : undefined}
                        className="resize-y"
                      />
                      {errorText("cprd-description-err", detailErrors.description)}
                    </div>
                  </section>
                )}

                {/* ── Step 2: Related Project ──────────────────────────────── */}
                {activeTab.id === "project" && (
                  <section id="plan-panel-project" role="region" aria-labelledby="plan-tab-project" className="max-w-[640px] space-y-5">
                    <div>
                      <h3 className="text-sm font-semibold leading-tight">{t("createDialog.relatedProjectHeading")}</h3>
                      <p className="mt-1 text-xs text-[var(--muted)]">{t("createDialog.relatedProjectDesc")}</p>
                    </div>

                    <RadioGroup
                      aria-label={t("createDialog.projectLinkModeAriaLabel")}
                      value={linkMode}
                      onChange={(v) => {
                        if (v === linkMode) return;
                        markDirty();
                        if (v === "standalone") {
                          setLinkMode("standalone");
                          setRelatedProjectId(null);
                          setProjectSearch("");
                        } else {
                          setLinkMode("linked");
                        }
                      }}
                      className="grid grid-cols-1 gap-2 sm:grid-cols-2"
                    >
                      {(["standalone", "linked"] as const).map((mode) => (
                        <Radio
                          key={mode}
                          value={mode}
                          className="rounded-xl border border-[var(--border)] p-3 transition-colors data-[selected=true]:border-[var(--accent)] data-[selected=true]:bg-[color-mix(in_oklab,var(--accent)_6%,transparent)]"
                        >
                          <Radio.Content className="items-start">
                            <Radio.Control className="mt-0.5">
                              <Radio.Indicator />
                            </Radio.Control>
                            <span>
                              <span className="block text-sm font-medium leading-tight">
                                {mode === "standalone" ? t("createDialog.standalonePlanLabel") : t("createDialog.linkToProjectLabel")}
                              </span>
                              <span className="mt-0.5 block text-xs text-[var(--muted)]">
                                {mode === "standalone" ? t("createDialog.standalonePlanDesc") : t("createDialog.linkToProjectDesc")}
                              </span>
                            </span>
                          </Radio.Content>
                        </Radio>
                      ))}
                    </RadioGroup>

                    {linkMode === "standalone" && (
                      <div className="rounded-xl border border-[var(--border)] px-4 py-3">
                        <p className="text-sm font-medium">{t("createDialog.standaloneInfoTitle")}</p>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{t("createDialog.standaloneInfoDesc")}</p>
                      </div>
                    )}

                    {linkMode === "linked" && (
                      <div className="space-y-3">
                        {projectsLoading && (
                          <div className="flex items-center gap-2 py-2 text-sm text-[var(--muted)]">
                            <Spinner size="sm" aria-hidden="true" />
                            <span>{t("createDialog.loadingProjects")}</span>
                          </div>
                        )}

                        {projectsError && !projectsLoading && (
                          <Alert status="danger">
                            <Alert.Indicator />
                            <Alert.Content>
                              <Alert.Description>{t("createDialog.unableToLoadProjects")}</Alert.Description>
                            </Alert.Content>
                          </Alert>
                        )}

                        {!projectsLoading && !projectsError && (projects ?? []).length === 0 && (
                          <div className="space-y-2 rounded-xl border border-[var(--border)] px-4 py-4">
                            <p className="text-sm font-medium">{t("createDialog.noProjectsAvailable")}</p>
                            <p className="text-xs text-[var(--muted)]">{t("createDialog.noProjectsAvailableDesc")}</p>
                            <Button
                              variant="outline"
                              size="sm"
                              onPress={() => {
                                markDirty();
                                setLinkMode("standalone");
                                setRelatedProjectId(null);
                              }}
                            >
                              {t("createDialog.useStandalonePlan")}
                            </Button>
                          </div>
                        )}

                        {/* Project search — code · title · donor */}
                        {!projectsLoading && !projectsError && (projects ?? []).length > 0 && !relatedProjectId && (
                          <ComboBox
                            fullWidth
                            allowsEmptyCollection
                            inputValue={projectSearch}
                            onInputChange={setProjectSearch}
                            selectedKey={null}
                            defaultFilter={() => true}
                            onSelectionChange={(key) => {
                              if (key == null) return;
                              markDirty();
                              setRelatedProjectId(Number(key));
                              setProjectSearch("");
                              // The search field unmounts once a project is chosen; keep
                              // keyboard focus in the step instead of the dialog's close button.
                              setTimeout(() => document.getElementById("cprd-change-project")?.focus(), 0);
                            }}
                          >
                            <Label className="text-xs font-medium">{t("createDialog.selectProject")}</Label>
                            <ComboBox.InputGroup>
                              <Input placeholder={t("createDialog.searchProjectPh")} dir="auto" />
                              <ComboBox.Trigger />
                            </ComboBox.InputGroup>
                            <ComboBox.Popover>
                              <ListBox
                                className="max-h-72 overscroll-contain"
                                renderEmptyState={() => (
                                  <p className="px-3 py-4 text-center text-sm text-[var(--muted)]">{t("createDialog.noMatchingProjects")}</p>
                                )}
                              >
                                {filteredProjects.map((p) => {
                                  const donor = (p as unknown as { donor?: string }).donor;
                                  return (
                                    <ListBox.Item key={p.id} id={String(p.id)} textValue={`${p.code ?? ""} ${p.title ?? ""}`}>
                                      <span className="flex min-w-0 flex-col">
                                        <span className="font-mono text-[11px] text-[var(--muted)]"><bdi dir="ltr">{p.code}</bdi></span>
                                        <span className="text-sm font-medium leading-snug" dir="auto">{p.title}</span>
                                        {donor && <span className="truncate text-xs text-[var(--muted)]" dir="auto">{donor}</span>}
                                      </span>
                                    </ListBox.Item>
                                  );
                                })}
                              </ListBox>
                            </ComboBox.Popover>
                          </ComboBox>
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
                          const listSep = t("viewModes.listSeparator", { ns: "common", defaultValue: ", " });
                          return (
                            <Card className="p-0">
                              <div className="space-y-2 px-4 py-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <span className="font-mono text-[11px] text-[var(--muted)]"><bdi dir="ltr">{pd.code}</bdi></span>
                                  {pd.status && (
                                    <Chip size="sm" variant="soft" color={statusTone(pd.status)}>
                                      {t(`status.${pd.status}`, { ns: "projects", defaultValue: formatStatusLabel(pd.status) })}
                                    </Chip>
                                  )}
                                </div>
                                <p className="text-sm font-medium leading-snug rtl:text-end" dir="auto">{pd.title}</p>
                                {(pd.donor || stateNames.length > 0 || sectorList.length > 0) && (
                                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
                                    {pd.donor && (
                                      <span>
                                        <span className="text-[var(--muted)]">{t("createDialog.donorLabel")}</span>{" "}
                                        <span dir="auto">{pd.donor}</span>
                                      </span>
                                    )}
                                    {stateNames.length > 0 && (
                                      <span>
                                        <span className="text-[var(--muted)]">
                                          {stateNames.length === 1 ? t("createDialog.stateLabel_one") : t("createDialog.stateLabel_other")}
                                        </span>{" "}
                                        <span>{stateNames.map((name, index) => getStateLabel({ name, nameAr: stateNamesAr[index] }, i18n?.language)).join(listSep)}</span>
                                      </span>
                                    )}
                                    {sectorList.length > 0 && (
                                      <span>
                                        <span className="text-[var(--muted)]">
                                          {sectorList.length === 1 ? t("createDialog.sectorLabel_one") : t("createDialog.sectorLabel_other")}
                                        </span>{" "}
                                        <span>{sectorList.join(listSep)}</span>
                                      </span>
                                    )}
                                  </div>
                                )}
                                {projectLocalities.length > 0 && (
                                  <div className="pt-1">
                                    <p className="mb-1.5 text-xs text-[var(--muted)]">{t("createDialog.localitiesSuggestionsLabel")}</p>
                                    <div className="flex flex-wrap gap-1">
                                      {projectLocalities.slice(0, 10).map((l) => (
                                        <Chip key={l} size="sm" variant="secondary">{l}</Chip>
                                      ))}
                                      {projectLocalities.length > 10 && (
                                        <Chip size="sm" variant="tertiary">
                                          {t("createDialog.moreSuggestions", { count: projectLocalities.length - 10 })}
                                        </Chip>
                                      )}
                                    </div>
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 border-t border-[var(--border)] px-2 py-1.5">
                                <Button
                                  id="cprd-change-project"
                                  variant="ghost"
                                  size="sm"
                                  onPress={() => {
                                    markDirty();
                                    setRelatedProjectId(null);
                                    setProjectSearch("");
                                  }}
                                >
                                  {t("createDialog.changeProject")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-[var(--danger)]"
                                  aria-label={t("createDialog.removeLinkAria")}
                                  onPress={() => {
                                    markDirty();
                                    setRelatedProjectId(null);
                                    setLinkMode("standalone");
                                    setProjectSearch("");
                                  }}
                                >
                                  {t("createDialog.removeLink")}
                                </Button>
                              </div>
                            </Card>
                          );
                        })()}
                      </div>
                    )}
                  </section>
                )}

                {/* ── Step 3: Geographical Coverage ────────────────────────── */}
                {activeTab.id === "geography" && (
                  <section id="plan-panel-geography" role="region" aria-labelledby="plan-tab-geography" className="space-y-4">
                    <div>
                      <h3 className="mb-0.5 text-sm font-semibold">
                        {t("createDialog.geoCoverageHeading")}{" "}
                        <span className="text-[var(--danger)]" aria-label={t("createDialog.geoCoverageRequired")}>*</span>
                      </h3>
                      {currentStateName ? (
                        <>
                          <p className="mb-3 text-xs text-[var(--muted)]">{t("createDialog.addAtLeastOneLocality")}</p>
                          <div className="mb-4 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--default)] px-2.5 py-1">
                            <span className="text-xs text-[var(--muted)]">{t("createDialog.stateContextLabel")}</span>
                            <span className="text-xs font-medium">{currentStateName}</span>
                          </div>

                          {hasGeographyError && (
                            <Alert status="danger" id="geography-error" role="alert" className="mb-3">
                              <Alert.Indicator />
                              <Alert.Content>
                                <Alert.Description>{t("createDialog.atLeastOneLocality")}</Alert.Description>
                              </Alert.Content>
                            </Alert>
                          )}

                          <LocalityTagInput
                            localities={localities}
                            onChange={(v) => { markDirty(); setLocalities(v); }}
                            onAttemptRemove={handleAttemptRemoveLocality}
                            suggestions={localitySuggestions}
                          />

                          {/* Linked project suggestions (separate — not auto-applied) */}
                          {projectLocalities.length > 0 && (
                            <div className="mt-4 border-t border-[var(--border)] pt-3">
                              <p className="mb-2 text-xs font-medium text-[var(--muted)]">{t("createDialog.suggestedFromLinkedProject")}</p>
                              <div className="flex flex-wrap gap-1.5">
                                {projectLocalities
                                  .filter((pl) => !localities.some(
                                    (l) => l.toLowerCase().replace(/\s+/g, " ") === pl.toLowerCase().replace(/\s+/g, " ")
                                  ))
                                  .map((pl, i) => (
                                    <Button
                                      key={i}
                                      variant="outline"
                                      size="sm"
                                      className="h-7 rounded-full border-dashed px-2.5 text-xs"
                                      aria-label={t("createDialog.addSuggestedLocality", { name: pl })}
                                      onPress={() => {
                                        const norm = pl.toLowerCase().replace(/\s+/g, " ");
                                        const isDupe = localities.some((l) => l.toLowerCase().replace(/\s+/g, " ") === norm);
                                        if (!isDupe) {
                                          markDirty();
                                          setLocalities((prev) => [...prev, pl.trim()]);
                                        }
                                      }}
                                    >
                                      <Plus className="size-3" aria-hidden="true" /> {pl}
                                    </Button>
                                  ))}
                              </div>
                              <p className="mt-1.5 text-xs text-[var(--muted)]">{t("createDialog.suggestionsHint")}</p>
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="mt-3 rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
                          <MapPin className="mx-auto mb-2 size-6 text-[var(--muted)]" aria-hidden="true" />
                          <p className="mb-1 text-sm font-medium">{t("createDialog.selectStateFirst")}</p>
                          <p className="mb-4 text-xs text-[var(--muted)]">{t("createDialog.selectStateFirstDesc")}</p>
                          <Button
                            size="sm"
                            variant="outline"
                            onPress={() => setActiveTabIndex(0)}
                            aria-label={t("createDialog.goToPlanDetailsAria")}
                          >
                            {t("createDialog.goToPlanDetails")}
                          </Button>
                        </div>
                      )}
                    </div>
                  </section>
                )}

                {/* ── Step 4: Activities ───────────────────────────────────── */}
                {activeTab.id === "activities" && (
                  <section id="plan-panel-activities" role="region" aria-labelledby="plan-tab-activities" className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="flex items-baseline gap-2 text-sm font-semibold">
                          {t("createDialog.activitiesHeading")}
                          {activities.length > 0 && (
                            <span className="text-xs font-normal text-[var(--muted)]">
                              {t("createDialog.activitiesCount", { count: activities.length })}
                            </span>
                          )}
                        </h3>
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{t("createDialog.activitiesDesc")}</p>
                      </div>
                      {activities.length > 0 && (
                        <Button size="sm" variant="outline" onPress={addActivity} className="shrink-0 gap-1.5">
                          <Plus className="size-3.5" aria-hidden="true" /> {t("createDialog.addActivity")}
                        </Button>
                      )}
                    </div>

                    {activities.length === 0 && (
                      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center">
                        <p className="text-sm font-medium">{t("createDialog.noActivitiesTitle")}</p>
                        <p className="mt-1 text-xs text-[var(--muted)]">{t("createDialog.noActivitiesDesc")}</p>
                        <Button size="sm" variant="outline" className="mt-3 gap-1.5" onPress={addActivity}>
                          <Plus className="size-3.5" aria-hidden="true" /> {t("createDialog.addFirstActivity")}
                        </Button>
                      </div>
                    )}

                    {activities.map((a, idx) => {
                      const f = (n: string) => `cprd-act-${idx}-${n}`;
                      return (
                        <Card key={idx} className="gap-0 p-0">
                          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2">
                            <span className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto">
                              {a.title
                                ? t("createDialog.activityNumTitled", { num: idx + 1, title: a.title })
                                : t("createDialog.activityNum", { num: idx + 1 })}
                            </span>
                            <Tooltip delay={300}>
                              <Button
                                isIconOnly
                                size="sm"
                                variant="ghost"
                                className="shrink-0 text-[var(--danger)]"
                                onPress={() => handleRemoveActivity(idx)}
                                aria-label={t("createDialog.removeActivityAria", { num: idx + 1 })}
                              >
                                <Trash2 className="size-3.5" aria-hidden="true" />
                              </Button>
                              <Tooltip.Content>{t("createDialog.tooltipRemoveActivity")}</Tooltip.Content>
                            </Tooltip>
                          </div>

                          <div className="space-y-3 px-4 py-3">
                            <div className="space-y-1">
                              <Label isRequired htmlFor={f("title")} className="text-sm">{t("createDialog.activityTitle")}</Label>
                              <Input
                                id={f("title")}
                                fullWidth
                                dir="auto"
                                placeholder={t("createDialog.activityTitlePh")}
                                value={a.title}
                                onChange={(e) => updateActivity(idx, { title: e.target.value })}
                              />
                            </div>

                            {/* State (read-only — inherited from Plan Details) | Locality */}
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1">
                                <p className="text-sm font-medium">{t("createDialog.stateLabel")}</p>
                                <div
                                  className="space-y-0.5 py-1.5"
                                  role="note"
                                  aria-label={t("createDialog.stateContextAria", { state: currentStateName || t("createDialog.stateNotSet") })}
                                >
                                  <p className="text-sm leading-tight">
                                    {currentStateName || <span className="text-[var(--muted)]">—</span>}
                                  </p>
                                  <p className="text-[11px] leading-none text-[var(--muted)]">{t("createDialog.stateInherited")}</p>
                                </div>
                              </div>
                              <ActivityLocalitySelect
                                id={`activity-locality-${idx}`}
                                value={a.localityName}
                                onChange={(v) => updateActivity(idx, { localityName: v })}
                                localities={localities}
                                onGoToGeography={() => setActiveTabIndex(2)}
                              />
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <DateInput
                                id={f("date")}
                                label={t("createDialog.plannedDate")}
                                isRequired
                                value={a.plannedDate}
                                onChange={(v) => updateActivity(idx, { plannedDate: v })}
                                min={planDetails.startDate || undefined}
                                max={planDetails.endDate || undefined}
                              />
                              <SelectField
                                id={f("priority")}
                                label={t("createDialog.priority")}
                                isRequired
                                value={a.priority}
                                onChange={(v) => updateActivity(idx, { priority: v })}
                                className="w-full"
                                options={PRIORITIES.map((p) => ({
                                  value: p.value,
                                  label: <Chip size="sm" variant="soft" color={p.color}>{t(`activity.priority_${p.value}`)}</Chip>,
                                  textValue: t(`activity.priority_${p.value}`),
                                }))}
                              />
                            </div>

                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="space-y-1">
                                <Label isRequired htmlFor={f("beneficiaries")} className="text-sm">{t("createDialog.targetBeneficiaries")}</Label>
                                <Input
                                  id={f("beneficiaries")}
                                  fullWidth
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={a.targetBeneficiaries}
                                  onChange={(e) => updateActivity(idx, { targetBeneficiaries: Number(e.target.value) })}
                                />
                              </div>
                              <div className="space-y-1">
                                <Label isRequired htmlFor={f("budget")} className="text-sm">{t("createDialog.plannedBudget")}</Label>
                                <Input
                                  id={f("budget")}
                                  fullWidth
                                  type="number"
                                  min={0}
                                  value={a.budgetPlanned}
                                  onChange={(e) => updateActivity(idx, { budgetPlanned: Number(e.target.value) })}
                                />
                              </div>
                            </div>

                            <div className="max-w-sm space-y-1">
                              <Label htmlFor={f("responsible")} className="text-sm">{t("createDialog.responsiblePersonActivity")}</Label>
                              <Input
                                id={f("responsible")}
                                fullWidth
                                dir="auto"
                                placeholder={t("createDialog.responsiblePersonActivityPh")}
                                value={a.responsibleName}
                                onChange={(e) => updateActivity(idx, { responsibleName: e.target.value })}
                              />
                            </div>

                            <div className="space-y-1">
                              <Label isRequired htmlFor={f("result")} className="text-sm">{t("createDialog.expectedResult")}</Label>
                              <TextArea
                                id={f("result")}
                                fullWidth
                                dir="auto"
                                rows={2}
                                placeholder={t("createDialog.expectedResultPh")}
                                value={a.expectedResult}
                                onChange={(e) => updateActivity(idx, { expectedResult: e.target.value })}
                                className="resize-y"
                              />
                            </div>

                            <ActivityOptionalFields a={a} idx={idx} updateActivity={updateActivity} risks={risks} />
                          </div>
                        </Card>
                      );
                    })}
                  </section>
                )}

                {/* ── Step 5: Budget ───────────────────────────────────────── */}
                {activeTab.id === "budget" && (
                  <section id="plan-panel-budget" role="region" aria-labelledby="plan-tab-budget" className="space-y-6">
                    <div>
                      <h3 className="mb-3 text-sm font-semibold">{t("createDialog.budgetHeading")}</h3>
                      <div className="flex flex-wrap items-start gap-3">
                        <div className="w-full sm:w-36">
                          <SelectField
                            id="cprd-currency"
                            label={t("createDialog.currency")}
                            isRequired
                            value={budget.currency}
                            onChange={handleCurrencyChange}
                            className="w-full"
                            options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                          />
                        </div>
                        <div className="w-full space-y-1 sm:w-52">
                          <Label isRequired htmlFor="cprd-budget-planned">{t("createDialog.planPlannedBudget")}</Label>
                          <Input
                            id="cprd-budget-planned"
                            fullWidth
                            type="number"
                            min={0}
                            value={budget.budgetPlanned}
                            onChange={(e) => { markDirty(); setBudgetField("budgetPlanned", Number(e.target.value)); }}
                            aria-invalid={(saveFinishAttempted && (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0)) || undefined}
                            aria-describedby={
                              saveFinishAttempted && (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0)
                                ? "cprd-budget-planned-error"
                                : undefined
                            }
                          />
                          {saveFinishAttempted && (!Number.isFinite(budget.budgetPlanned) || budget.budgetPlanned < 0) && (
                            <p id="cprd-budget-planned-error" role="alert" className="text-xs text-[var(--danger)]">
                              {t("createDialog.validPlannedBudget")}
                            </p>
                          )}
                        </div>
                        <div className="w-full space-y-1 sm:w-56">
                          <Label htmlFor="cprd-funding-source">{t("createDialog.fundingSource")}</Label>
                          <Input
                            id="cprd-funding-source"
                            fullWidth
                            dir="auto"
                            placeholder={t("createDialog.fundingSourcePh")}
                            value={budget.fundingSource}
                            onChange={(e) => { markDirty(); setBudgetField("fundingSource", e.target.value); }}
                          />
                        </div>
                      </div>
                      {/* Plan budget actual is NOT manually entered during Registration —
                          actual expenditure comes from authoritative implementation data. */}
                    </div>

                    <div>
                      <p className="mb-3 text-xs font-medium text-[var(--muted)]">{t("createDialog.activitySummaryHeading")}</p>

                      {totals.count === 0 ? (
                        <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-5 text-center">
                          <p className="text-sm font-medium">{t("createDialog.noActivitiesBudgetTitle")}</p>
                          <p className="mt-1 text-xs text-[var(--muted)]">{t("createDialog.noActivitiesBudgetDesc")}</p>
                          <Button size="sm" variant="outline" className="mt-3" onPress={() => setActiveTabIndex(3)}>
                            {t("createDialog.goToActivities")}
                          </Button>
                        </div>
                      ) : (
                        <>
                          {/* Over-allocation — stated in words, not colour alone */}
                          {isOverAllocated && (
                            <Alert status="danger" role="alert" aria-live="polite" className="mb-3">
                              <Alert.Indicator />
                              <Alert.Content>
                                <Alert.Title>
                                  {t("createDialog.overAllocatedMessage", {
                                    currency: budget.currency,
                                    amount: Math.abs(remainingBudget).toLocaleString(),
                                  })}
                                </Alert.Title>
                                <Alert.Description>{t("createDialog.overAllocatedHint")}</Alert.Description>
                              </Alert.Content>
                              <Button size="sm" variant="outline" className="shrink-0" onPress={() => setActiveTabIndex(3)}>
                                {t("createDialog.goToActivities")}
                              </Button>
                            </Alert>
                          )}

                          {/* Summary figures — derived from the live activities */}
                          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                            <div className="rounded-xl border border-[var(--border)] p-3">
                              <p className="mb-1 text-xs text-[var(--muted)]">{t("createDialog.totalActivities")}</p>
                              <p className="text-2xl font-bold leading-none tabular-nums" aria-label={t("createDialog.activitiesCountAria", { count: totals.count })}>
                                {totals.count}
                              </p>
                            </div>
                            <div className="rounded-xl border border-[var(--border)] p-3">
                              <p className="mb-1 text-xs text-[var(--muted)]">{t("createDialog.totalTargetBeneficiaries")}</p>
                              <p
                                className="text-2xl font-bold leading-none tabular-nums"
                                aria-label={t("createDialog.beneficiariesAria", { count: totals.totalBeneficiaries.toLocaleString() })}
                              >
                                {totals.totalBeneficiaries.toLocaleString()}
                              </p>
                            </div>
                            <div className="rounded-xl border border-[var(--border)] p-3">
                              <p className="mb-1 text-xs text-[var(--muted)]">{t("createDialog.activityPlannedBudget")}</p>
                              <p className="text-xl font-bold leading-none" aria-label={`${budget.currency} ${totals.plannedBudget.toLocaleString()}`}>
                                <bdi dir="ltr">{budget.currency} {totals.plannedBudget.toLocaleString()}</bdi>
                              </p>
                            </div>
                            <div
                              className={`rounded-xl border p-3 ${isOverAllocated
                                ? "border-[color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)]"
                                : "border-[var(--border)]"}`}
                            >
                              <p className="mb-1 text-xs text-[var(--muted)]">{t("createDialog.remainingBudget")}</p>
                              {!Number.isFinite(budget.budgetPlanned) ? (
                                <p className="text-sm text-[var(--muted)]">{t("createDialog.setBudgetAbove")}</p>
                              ) : isOverAllocated ? (
                                <p
                                  className="text-xl font-bold leading-none text-[var(--danger)]"
                                  aria-label={`${budget.currency} ${Math.abs(remainingBudget).toLocaleString()} ${t("createDialog.overallocated")}`}
                                >
                                  <bdi dir="ltr">{budget.currency} {Math.abs(remainingBudget).toLocaleString()}</bdi>
                                  <span className="mt-0.5 block text-xs font-normal">{t("createDialog.overallocated")}</span>
                                </p>
                              ) : (
                                <p
                                  className="text-xl font-bold leading-none"
                                  aria-label={`${budget.currency} ${remainingBudget.toLocaleString()} ${t("createDialog.remaining")}`}
                                >
                                  <bdi dir="ltr">{budget.currency} {remainingBudget.toLocaleString()}</bdi>
                                  <span className="mt-0.5 block text-xs font-normal text-[var(--muted)]">{t("createDialog.remaining")}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </section>
                )}

                {/* PLAN-BD-2: Duplicate warning banner */}
                {isHardDuplicate && (
                  <div
                    role="alert"
                    aria-live="assertive"
                    className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--danger)_35%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-4 py-3 text-sm"
                    data-testid="duplicate-hard-warning"
                  >
                    <p className="mb-1 flex items-center gap-2 font-medium text-[var(--danger)]">
                      <AlertCircle className="size-4 shrink-0" aria-hidden="true" />
                      {t("createDialog.duplicateHardTitle", { defaultValue: "A Plan already exists for this scope and period." })}
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
                        <span className="ms-2 text-xs text-[var(--muted)]">
                          {t("createDialog.planRef", { id: hardDuplicateExisting.planId, defaultValue: "(Plan #{{id}})" })}
                        </span>
                      </div>
                    )}
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {t("createDialog.duplicateHardHint", { defaultValue: "Please continue editing the existing Plan rather than creating a duplicate." })}
                    </p>
                  </div>
                )}

                {isSoftDuplicate && (
                  <div
                    role="status"
                    aria-live="polite"
                    className="mt-4 rounded-xl border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] px-4 py-3 text-sm"
                    data-testid="duplicate-soft-warning"
                  >
                    <p className="mb-1 flex items-center gap-2 font-medium text-[var(--warning-foreground,var(--foreground))]">
                      <AlertTriangle className="size-4 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                      {t("createDialog.duplicateSoftTitle", { defaultValue: "A similar Plan already exists for this scope and period." })}
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {t("createDialog.duplicateSoftHint", { defaultValue: "Review the existing Plan before creating another one. You may continue if this is intentional." })}
                    </p>
                    {/* Wave 2: navigate to the accessible existing plan's detail view.
                        Rendered only when the backend returned an accessible planId. */}
                    {softDuplicatePlanId != null && (
                      <div className="mt-2 flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid="duplicate-soft-review-link"
                          onPress={() => {
                            const targetId = softDuplicatePlanId;
                            handleReset();
                            onOpenChange(false);
                            setLocation(`/plans/${targetId}`);
                          }}
                        >
                          {t("createDialog.reviewExistingPlan", { defaultValue: "Review Existing Plan" })}
                        </Button>
                        <span className="text-xs text-[var(--muted)]">
                          {t("createDialog.planRef", { id: softDuplicatePlanId, defaultValue: "(Plan #{{id}})" })}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* API-level error banner */}
                {apiError && (
                  <Alert status="danger" role="alert" className="mt-4">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description className="whitespace-pre-line">{apiError}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}

                {/* ── "Sections Need Attention" summary — only after a Save & Finish attempt ── */}
                {saveFinishAttempted && hasAnyFinishError && (() => {
                  const sections = [
                    hasDetailErrors && { step: 0, label: t("createDialog.sectionPlanDetails"), hint: t("createDialog.sectionPlanDetailsError") },
                    hasGeographyError && { step: 2, label: t("createDialog.sectionGeoCoverage"), hint: t("createDialog.sectionGeoCoverageError") },
                    hasActivityError && {
                      step: 3,
                      label: t("createDialog.sectionActivities"),
                      hint: activities.length === 0
                        ? t("createDialog.sectionActivitiesErrorEmpty")
                        : t("createDialog.sectionActivitiesErrorIncomplete"),
                    },
                    hasBudgetFinishError && {
                      step: 4,
                      label: t("createDialog.sectionBudget"),
                      hint: isOverAllocated
                        ? t("createDialog.sectionBudgetErrorOverallocated")
                        : t("createDialog.sectionBudgetErrorIncomplete"),
                    },
                  ].filter(Boolean) as Array<{ step: number; label: string; hint: string }>;
                  return (
                    <Alert status="danger" role="alert" aria-live="polite" className="mt-4">
                      <Alert.Indicator />
                      <Alert.Content>
                        <Alert.Title>{t("createDialog.sectionNeedsAttention", { count: sections.length })}</Alert.Title>
                        <ul className="mt-1 space-y-1">
                          {sections.map((sec) => (
                            <li key={sec.step} className="flex flex-wrap items-center gap-x-2">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-1.5 font-medium text-[var(--danger)] underline underline-offset-2"
                                onPress={() => setActiveTabIndex(sec.step)}
                              >
                                {sec.label}
                              </Button>
                              <span className="text-xs text-[var(--muted)]">{sec.hint}</span>
                            </li>
                          ))}
                        </ul>
                      </Alert.Content>
                    </Alert>
                  );
                })()}
              </div>

              {/* ── Sticky footer ─────────────────────────────────────────────── */}
              <div className="shrink-0 border-t border-[var(--border)] px-6 py-3">
                <div className="flex items-center justify-between gap-3">
                  {activeTabIndex === 0 ? (
                    <Button variant="outline" size="sm" onPress={handleCancelClick} isDisabled={isPending}>
                      {t("createDialog.cancel")}
                    </Button>
                  ) : (
                    <Button variant="outline" size="sm" onPress={goToPrevTab} isDisabled={isPending}>
                      {t("createDialog.previous")}
                    </Button>
                  )}

                  <div className="flex items-center gap-2">
                    {/* PLAN-BD-2: saving is disabled while a hard duplicate exists */}
                    <Button
                      variant="secondary"
                      size="sm"
                      onPress={handleSaveAsDraft}
                      isDisabled={isPending || isHardDuplicate}
                      isPending={isPending && !completeAfterCreate.current}
                    >
                      {isPending && !completeAfterCreate.current ? (
                        <><span aria-hidden="true">{t("createDialog.savingDraft")}</span><span className="sr-only">{t("createDialog.savingDraftSr")}</span></>
                      ) : t("createDialog.saveAsDraft")}
                    </Button>

                    {activeTabIndex < TABS.length - 1 ? (
                      <Button size="sm" onPress={goToNextTab} isDisabled={isPending}>
                        {t("createDialog.next")}
                      </Button>
                    ) : (
                      /* "Save & Finish" — saves as Draft and closes Registration.
                         Does NOT submit, trigger any approval, or change plan status.
                         Submit For Approval remains a separate explicit action in Plan Details. */
                      <Button
                        size="sm"
                        onPress={handleComplete}
                        isDisabled={isPending || isHardDuplicate}
                        isPending={isPending && completeAfterCreate.current}
                      >
                        {isPending && completeAfterCreate.current ? (
                          <><span aria-hidden="true">{t("createDialog.savingFinish")}</span><span className="sr-only">{t("createDialog.savingFinishSr")}</span></>
                        ) : t("createDialog.saveAndFinish")}
                      </Button>
                    )}
                  </div>
                </div>

                {draftPlanId != null && (
                  <p className="mt-2 text-end text-xs text-[var(--muted)]">
                    {t("createDialog.draftSaved", { id: draftPlanId })}
                  </p>
                )}
              </div>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* ── State change: clears localities (and activity localities) ──── */}
      <ConfirmModal
        isOpen={stateChangeConfirmOpen}
        tone="primary"
        title={t("createDialog.stateChangeTitle")}
        message={
          t("createDialog.stateChangeDesc")
          + (activities.some((a) => a.localityName) ? t("createDialog.stateChangeDescActivities") : "")
          + t("createDialog.stateChangeDescEnd")
        }
        cancelLabel={t("createDialog.cancel")}
        confirmLabel={t("createDialog.changeState")}
        onCancel={() => { setPendingStateId(null); setStateChangeConfirmOpen(false); }}
        onConfirm={confirmStateChange}
      />

      {/* ── Currency change while activities carry budgets ──────────────── */}
      <ConfirmModal
        isOpen={currencyChangeConfirm !== null}
        tone="primary"
        title={t("createDialog.currencyChangeTitle")}
        message={t("createDialog.currencyChangeDesc")}
        cancelLabel={t("createDialog.cancel")}
        confirmLabel={t("createDialog.changeCurrency")}
        onCancel={() => setCurrencyChangeConfirm(null)}
        onConfirm={() => {
          if (currencyChangeConfirm) {
            markDirty();
            setBudgetField("currency", currencyChangeConfirm);
          }
          setCurrencyChangeConfirm(null);
        }}
      />

      {/* ── Deleting an activity that has data ──────────────────────────── */}
      <ConfirmModal
        isOpen={activityDeleteConfirmIdx !== null}
        title={t("createDialog.activityDeleteTitle")}
        message={t("createDialog.activityDeleteDesc")}
        cancelLabel={t("createDialog.cancel")}
        confirmLabel={t("createDialog.removeActivity")}
        onCancel={() => setActivityDeleteConfirmIdx(null)}
        onConfirm={confirmRemoveActivity}
      />

      {/* ── Removing a locality that activities use ─────────────────────── */}
      <ConfirmModal
        isOpen={localityRemoveState !== null}
        tone="primary"
        title={t("createDialog.localityRemoveTitle")}
        message={localityRemoveState
          ? t("createDialog.localityRemoveDesc", { name: localityRemoveState.name, count: localityRemoveState.count })
          : ""}
        cancelLabel={t("createDialog.cancel")}
        confirmLabel={t("createDialog.removeLocality")}
        onCancel={() => setLocalityRemoveState(null)}
        onConfirm={confirmRemoveLocality}
      />

      {/* ── Cancel registration. While the server-side revocation is in
          flight the dialog can't be dismissed (Escape / outside press) and
          both buttons are locked; on failure it stays open for a retry. ── */}
      <ConfirmModal
        isOpen={cancelConfirmOpen}
        title={isClosingSession ? t("createDialog.cancelRegistrationTitle_closing") : t("createDialog.cancelRegistrationTitle")}
        message={closeSessionError
          ? t("createDialog.cancelRegistrationDesc_error")
          : draftPlanId != null
            ? t("createDialog.cancelRegistrationDesc_draft")
            : t("createDialog.cancelRegistrationDesc_new")}
        cancelLabel={t("createDialog.keepEditing")}
        confirmLabel={isClosingSession
          ? t("createDialog.closing")
          : closeSessionError
            ? t("createDialog.tryAgain")
            : draftPlanId != null
              ? t("createDialog.closeKeepDraft")
              : t("createDialog.discard")}
        isPending={isClosingSession}
        onCancel={() => { if (isClosingSession) return; setCloseSessionError(null); setCancelConfirmOpen(false); }}
        onConfirm={handleConfirmCancel}
      >
        {/* Error feedback — no credential values; factual message only */}
        {closeSessionError && (
          <Alert status="danger">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Description className="text-xs">{closeSessionError}</Alert.Description>
            </Alert.Content>
          </Alert>
        )}
      </ConfirmModal>
    </>
  );
}
