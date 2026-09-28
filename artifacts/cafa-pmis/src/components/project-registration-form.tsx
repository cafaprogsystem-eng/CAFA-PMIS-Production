import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { StateLabel, getStateLabel } from "@/components/state-label";
import {
  useCreateProject,
  useGetProject,
  useListProjectStateAllocations,
  useListStates,
  useListUsers,
  useListDonors,
  useCreateDonor,
  useCheckProjectDuplicate,
  useMergeProjectData,
  useGetMe,
  requestUploadUrl,
  type DuplicateProjectInfo,
} from "@workspace/api-client-react";
import { FormVoiceRecorder, type PendingNote } from "@/components/form-voice-recorder";
import {
  Alert, Button, Card, Chip, Input, Label, Modal, Skeleton, Spinner, TextArea, TextField, Tooltip,
} from "@heroui/react";
import {
  Form,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  useFormField,
} from "@/components/ui/form";
import { CheckItem, FormDate, FormInput, FormSelect, FormTextArea, RemovableTags } from "@/components/form-controls";
import { SelectField } from "@/components/select-field";
import { useToast } from "@/hooks/use-toast";
import {
  Upload, X, FileText, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, GitMerge, Lock, TriangleAlert,
} from "@/components/icons";
import { SECTORS, SUB_SECTORS, ASSISTANCE_MODALITIES } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { OfflineDraftNotice } from "@/components/offline-draft-notice";
import { useDurableFormDraft } from "@/hooks/use-durable-form-draft";
import { useSyncContext } from "@/contexts/sync-context";
import { StateReferenceStatus } from "@/components/state-reference-status";
import { deriveStateReferenceData } from "@/lib/state-reference-data";

// ── Local helpers ──────────────────────────────────────────────────────────────

/** Consistent section heading used across all 7 tab panels. Visual-only; not exported. */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      {description && <p className="text-xs text-[var(--muted)] mt-0.5">{description}</p>}
    </div>
  );
}

/**
 * Icon-only HeroUI button with a HeroUI tooltip. The tooltip opens on hover
 * and on keyboard focus (a Radix tooltip around a HeroUI button only does hover).
 */
function IconAction({
  label, tooltip, onPress, danger, className, children,
}: {
  label: string;
  tooltip?: string;
  onPress: () => void;
  danger?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Tooltip delay={300}>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={label}
        onPress={onPress}
        className={cn("text-[var(--muted)]", danger && "hover:text-[var(--danger)]", className)}
      >
        {children}
      </Button>
      <Tooltip.Content>{tooltip ?? label}</Tooltip.Content>
    </Tooltip>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENCIES = ["USD", "SDG", "EUR", "AED"];

const CLASSIFICATIONS = ["emergency", "recovery", "development", "nexus"] as const;

const ACTIVITY_STATUSES = ["planned", "in_progress", "completed", "on_hold"] as const;

const PERSONNEL_ROLES = [
  "project_manager",
  "technical_coordinator",
  "finance_focal_point",
  "meal_focal_point",
  "state_focal_point",
] as const;

/** Stored unit values (kept as-is for existing records) and their label keys. */
const INDICATOR_UNITS: Record<string, string> = {
  "People Reached": "people_reached",
  "Households Assisted": "households_assisted",
  "Facilities Supported": "facilities_supported",
  "Communities Served": "communities_served",
  "Trainings Conducted": "trainings_conducted",
  "Volunteers Trained": "volunteers_trained",
  "count": "count",
  "%": "percent",
};

type TFn = (key: string, options?: Record<string, unknown>) => string;

function indicatorUnitOptions(t: TFn, current?: string) {
  const options = Object.entries(INDICATOR_UNITS).map(([value, key]) => ({ value, label: t(`form.options.indicatorUnit.${key}`), textValue: value }));
  // Keep a unit that isn't in the list (older records) selectable as-is.
  if (current && !(current in INDICATOR_UNITS)) options.push({ value: current, label: current, textValue: current });
  return options;
}

function personnelRoleLabel(t: TFn, role?: string) {
  return role ? t(`form.options.personnelRole.${role}`, { defaultValue: role }) : "";
}

const DOC_AGREEMENT_KINDS = ["pca", "ip_agreement", "grant_agreement", "mou", "contract", "partnership_agreement"];

const DOC_BUDGET_KINDS = ["detailed_budget", "approved_budget", "financial_annex"];

const DOC_OPTIONAL_KINDS = ["proposal", "logframe", "workplan", "donor_communications", "amendments", "technical_annexes", "other"];

const ACCEPTED_DOC_TYPES = ".pdf,.doc,.docx,.xls,.xlsx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

// ── Tab definitions ────────────────────────────────────────────────────────────

const TABS = [
  { id: "basic"     as const, labelKey: "form.tabs.basic"     },
  { id: "location"  as const, labelKey: "form.tabs.location"  },
  { id: "donor"     as const, labelKey: "form.tabs.donor"     },
  { id: "timeline"  as const, labelKey: "form.tabs.timeline"  },
  { id: "team"      as const, labelKey: "form.tabs.team"      },
  { id: "documents" as const, labelKey: "form.tabs.documents" },
  { id: "review"    as const, labelKey: "form.tabs.review"    },
] as const;

type TabId = typeof TABS[number]["id"];

const TAB_FIELDS: Record<TabId, string[]> = {
  basic:     ["title", "description", "classification", "sectors", "reportingFrequency"],
  location:  ["hasHqOperations", "stateIds", "localities", "beneficiariesMale", "beneficiariesFemale", "beneficiariesBoys", "beneficiariesGirls", "beneficiariesTarget"],
  donor:     ["donorId", "donor", "newDonorName", "agreementNumber"],
  timeline:  ["startDate", "endDate", "reportingStartDate", "reportingEndDate", "budgetTotal", "outputs"],
  team:      ["assignments"],
  documents: ["documents"],
  review:    [],
};

// ── Zod Schemas ────────────────────────────────────────────────────────────────

const indicatorSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  unit: z.string().min(1, "Required"),
  target: z.coerce.number().min(0, "Required"),
});

const activitySchema = z.object({
  /** Present for activities loaded from the API; absent for newly added activities. */
  id: z.number().int().positive().optional(),
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  indicatorIndex: z.coerce.number().optional(),
  budgetPlanned: z.coerce.number().min(0, "Required"),
  plannedStart: z.string().min(1, "Required"),
  plannedEnd: z.string().min(1, "Required"),
  target: z.coerce.number().optional(),
  stateId: z.coerce.number({ required_error: "State is required" }).int().positive("State is required"),
  localityName: z.string().min(1, "Locality is required"),
  status: z.string().default("planned"),
  /** Read-only: recorded expenditure from the API. Not editable through the form. */
  budgetSpent: z.number().optional(),
});

const outputSchema = z.object({
  title: z.string().min(1, "Required"),
  description: z.string().optional(),
  target: z.coerce.number().optional(),
  indicators: z.array(indicatorSchema).min(1, "At least one indicator is required"),
  activities: z.array(activitySchema).min(1, "At least one activity is required"),
});

const documentSchema = z.object({
  /** DB primary key — present for documents loaded from an existing project. */
  id: z.number().optional(),
  category: z.enum(["agreement", "budget", "optional"]),
  kind: z.string().min(1, "Required"),
  fileName: z.string(),
  contentType: z.string(),
  size: z.number(),
  objectPath: z.string().optional().default(""),
  // Retain the server-issued descriptor through React Hook Form parsing so the
  // create/edit endpoints can verify project document ownership.
  uploadToken: z.string().optional(),
});

const stateAllocationSchema = z.object({
  stateId: z.number(),
  budgetAllocation: z.coerce.number().optional(),
  beneficiaryTarget: z.coerce.number().optional(),
  beneficiaryMale: z.coerce.number().optional(),
  beneficiaryFemale: z.coerce.number().optional(),
  beneficiaryBoys: z.coerce.number().optional(),
  beneficiaryGirls: z.coerce.number().optional(),
  activityTarget: z.coerce.number().optional(),
  indicatorTarget: z.coerce.number().optional(),
  stateLead: z.string().optional(),
  notes: z.string().optional(),
});

const schema = z.object({
  title: z.string().min(3, "Required (min 3 chars)"),
  description: z.string().min(50, "Required — describe the project background, rationale, objectives and intended outcomes (min 50 characters)"),
  classification: z.string().optional(),
  sectors: z.array(z.string()).min(1, "Select at least one sector"),
  subSectors: z.array(z.string()).default([]),
  assistanceModality: z.string().optional(),
  donorId: z.number().optional(),
  donor: z.string().optional(),
  newDonorName: z.string().optional(),
  agreementNumber: z.string().min(1, "Agreement Number is required"),
  agreementStart: z.string().optional(),
  agreementEnd: z.string().optional(),
  signedDate: z.string().optional(),
  internalNotes: z.string().optional(),
  startDate: z.string().min(1, "Required"),
  endDate: z.string().min(1, "Required"),
  reportingStartDate: z.string().min(1, "Reporting start date is required"),
  reportingEndDate: z.string().min(1, "Reporting end date is required"),
  budgetTotal: z.coerce.number().min(0, "Required"),
  directCost: z.coerce.number().optional(),
  indirectCost: z.coerce.number().optional(),
  cafaContribution: z.coerce.number().optional(),
  budgetVersion: z.string().optional(),
  currency: z.string().default("USD"),
  activityTarget: z.coerce.number().default(0),
  indicatorTarget: z.coerce.number().default(0),
  beneficiariesTarget: z.coerce.number().default(0),
  beneficiariesMale: z.coerce.number().default(0),
  beneficiariesFemale: z.coerce.number().default(0),
  beneficiariesBoys: z.coerce.number().default(0),
  beneficiariesGirls: z.coerce.number().default(0),
  hasHqOperations: z.boolean().default(false),
  // Required for NEW projects (enforced via createSchema below); optional in edit
  // mode so historical projects with a null frequency can still be edited without
  // being forced to configure one.
  reportingFrequency: z.enum(["monthly", "quarterly", "annual"]).optional(),
  stateIds: z.array(z.number()).default([]),
  localities: z.array(z.string()),
  stateAllocations: z.array(stateAllocationSchema).default([]),
  assignments: z.array(z.object({
    userId: z.number().optional(),
    name: z.string().optional(),
    role: z.string().min(1, "Required"),
  })),
  outputs: z.array(outputSchema).min(1, "At least one output is required"),
  documents: z.array(documentSchema),
}).superRefine((data, ctx) => {
  if (!data.hasHqOperations && data.stateIds.length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Select at least one Operational Location: tick HQ or one or more states.",
      path: ["stateIds"],
    });
  }
  if (data.reportingStartDate > data.reportingEndDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Reporting end date must be on or after reporting start date",
      path: ["reportingEndDate"],
    });
  }
  // The End Date input's native `min` attribute has no effect at submit time
  // (the form uses noValidate), and reporting dates only mirror start/end
  // until a user customises them — so this was the only remaining path that
  // could let a project save with its implementation period inverted.
  if (data.startDate && data.endDate && data.startDate > data.endDate) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "End Date cannot be before Start Date",
      path: ["endDate"],
    });
  }
});

// Create mode: Scheduled Reporting Frequency is mandatory (server also enforces 400).
const createSchema = schema.superRefine((data, ctx) => {
  if (!data.reportingFrequency) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Scheduled Reporting Frequency is required",
      path: ["reportingFrequency"],
    });
  }
});

/** Schema messages (kept in English above) → projects:form.validation keys. */
const VALIDATION_MESSAGE_KEYS: Record<string, string> = {
  "Required": "required",
  "State is required": "stateRequired",
  "Locality is required": "localityRequired",
  "At least one indicator is required": "indicatorRequired",
  "At least one activity is required": "activityRequired",
  "Required (min 3 chars)": "titleMin",
  "Required — describe the project background, rationale, objectives and intended outcomes (min 50 characters)": "descriptionMin",
  "Select at least one sector": "sectorRequired",
  "Agreement Number is required": "agreementRequired",
  "Reporting start date is required": "reportingStartRequired",
  "Reporting end date is required": "reportingEndRequired",
  "At least one output is required": "outputRequired",
  "Select at least one Operational Location: tick HQ or one or more states.": "locationRequired",
  "Reporting end date must be on or after reporting start date": "reportingCoverageOrder",
  "End Date cannot be before Start Date": "endBeforeStart",
  "Scheduled Reporting Frequency is required": "frequencyRequired",
};

/** FormMessage that shows the schema message in the active language. */
function FieldMessage() {
  const { t } = useTranslation("projects");
  const { error, formMessageId } = useFormField();
  const message = error?.message ? String(error.message) : "";
  if (!message) return null;
  const key = VALIDATION_MESSAGE_KEYS[message];
  return (
    <p id={formMessageId} className="text-xs font-medium text-[var(--danger)]">
      {key ? t(`form.validation.${key}`, { defaultValue: message }) : message}
    </p>
  );
}

type FormValues = z.infer<typeof schema>;

// ── Date normalisation (PG date columns may return JS Date or string) ──────────
function normDate(v: unknown): string {
  if (!v) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

// ── Map GET /projects/:id response → form values ───────────────────────────────
interface ProjectApiIndicator { id: number; outputId: number; title: string; unit?: string; target?: number; description?: string }
interface ProjectApiActivity  { id: number; outputId: number; indicatorId?: number; title: string; description?: string; status?: string; plannedStart?: unknown; plannedEnd?: unknown; target?: number; budgetPlanned?: number; budgetSpent?: number; stateId?: number; localityName?: string }
interface ProjectApiOutput    { id: number; title: string; description?: string; target?: number }

function mapProjectToFormValues(
  projectData: {
    project: Record<string, unknown>;
    outputs: ProjectApiOutput[];
    indicators: ProjectApiIndicator[];
    activities: ProjectApiActivity[];
    states: Array<{ id: number; name: string }>;
  },
  stateAllocations: Array<Record<string, unknown>>,
): FormValues {
  const { project, outputs, indicators, activities, states } = projectData;

  const mappedOutputs: FormValues["outputs"] = outputs.map(out => {
    const outInds = indicators.filter(i => i.outputId === out.id);
    const outActs = activities.filter(a => a.outputId === out.id);
    return {
      title: out.title,
      description: out.description ?? "",
      target: out.target ?? 0,
      indicators: outInds.map(ind => ({
        title: ind.title,
        description: ind.description ?? "",
        unit: ind.unit ?? "count",
        target: ind.target ?? 0,
      })),
      activities: outActs.map(act => {
        const indIdx = act.indicatorId !== undefined
          ? outInds.findIndex(i => i.id === act.indicatorId)
          : -1;
        return {
          id: act.id,                                     // PRJ-BD-03: carry through for spend preservation
          title: act.title,
          description: act.description ?? "",
          indicatorIndex: indIdx >= 0 ? indIdx : undefined,
          budgetPlanned: act.budgetPlanned ?? 0,
          plannedStart: normDate(act.plannedStart),
          plannedEnd: normDate(act.plannedEnd),
          target: act.target ?? 0,
          stateId: act.stateId ?? 0,
          localityName: act.localityName ?? "",
          status: act.status ?? "planned",
          budgetSpent: act.budgetSpent,                   // #487: carry spend for removal warning
        };
      }),
    };
  });

  const docs = (project.documents as Array<Record<string, unknown>>) ?? [];
  const mappedDocs: FormValues["documents"] = docs.map(d => ({
    id: d.id !== undefined ? Number(d.id) : undefined,
    category: (d.category as "agreement" | "budget" | "optional") ?? "optional",
    kind: String(d.kind ?? ""),
    fileName: String(d.fileName ?? ""),
    contentType: String(d.contentType ?? ""),
    size: Number(d.size ?? 0),
    objectPath: String(d.objectPath ?? ""),
  }));

  const rawAssignments = (project.assignments as Array<Record<string, unknown>>) ?? [];
  const mappedAssignments: FormValues["assignments"] = rawAssignments.length > 0
    ? rawAssignments.map(a => ({ userId: a.userId !== undefined ? Number(a.userId) : undefined, name: String(a.name ?? ""), role: String(a.role ?? "project_manager") }))
    : [{ role: "project_manager", name: "", userId: undefined }];

  const rawLocalities = (project.localities as Array<{ name: string }>) ?? [];

  const mappedStateAllocations: FormValues["stateAllocations"] = stateAllocations.map(a => ({
    stateId: Number(a.stateId ?? 0),
    budgetAllocation: a.budgetAllocation !== undefined ? Number(a.budgetAllocation) : undefined,
    beneficiaryTarget: a.beneficiaryTarget !== undefined ? Number(a.beneficiaryTarget) : undefined,
    beneficiaryMale: a.beneficiaryMale !== undefined ? Number(a.beneficiaryMale) : undefined,
    beneficiaryFemale: a.beneficiaryFemale !== undefined ? Number(a.beneficiaryFemale) : undefined,
    beneficiaryBoys: a.beneficiaryBoys !== undefined ? Number(a.beneficiaryBoys) : undefined,
    beneficiaryGirls: a.beneficiaryGirls !== undefined ? Number(a.beneficiaryGirls) : undefined,
    activityTarget: a.activityTarget !== undefined ? Number(a.activityTarget) : undefined,
    indicatorTarget: a.indicatorTarget !== undefined ? Number(a.indicatorTarget) : undefined,
    stateLead: String(a.stateLead ?? ""),
    notes: String(a.notes ?? ""),
  }));

  return {
    title: String(project.title ?? ""),
    description: String(project.description ?? ""),
    classification: String(project.classification ?? ""),
    sectors: (project.sectors as string[]) ?? (project.sector ? [String(project.sector)] : []),
    subSectors: (project as Record<string, unknown>).subSectors as string[] ?? [],
    assistanceModality: (project as Record<string, unknown>).assistanceModality as string | undefined ?? undefined,
    donorId: project.donorId !== undefined ? Number(project.donorId) : undefined,
    donor: String(project.donor ?? ""),
    newDonorName: "",
    agreementNumber: String(project.agreementNumber ?? ""),
    agreementStart: normDate(project.agreementStart),
    agreementEnd: normDate(project.agreementEnd),
    signedDate: normDate(project.signedDate),
    internalNotes: String(project.internalNotes ?? ""),
    startDate: normDate(project.startDate),
    endDate: normDate(project.endDate),
    reportingStartDate: normDate(project.reportingStartDate) || normDate(project.startDate),
    reportingEndDate: normDate(project.reportingEndDate) || normDate(project.endDate),
    budgetTotal: Number(project.budgetTotal ?? 0),
    directCost: Number(project.directCost ?? 0),
    indirectCost: Number(project.indirectCost ?? 0),
    cafaContribution: Number(project.cafaContribution ?? 0),
    budgetVersion: String(project.budgetVersion ?? ""),
    currency: String(project.currency ?? "USD"),
    beneficiariesTarget: Number(project.beneficiariesTarget ?? 0),
    beneficiariesMale: Number(project.beneficiariesMale ?? 0),
    beneficiariesFemale: Number(project.beneficiariesFemale ?? 0),
    beneficiariesBoys: Number(project.beneficiariesBoys ?? 0),
    beneficiariesGirls: Number(project.beneficiariesGirls ?? 0),
    activityTarget: Number(project.activityTarget ?? 0),
    indicatorTarget: Number(project.indicatorTarget ?? 0),
    hasHqOperations: Boolean(project.hasHqOperations),
    // null (historical / not configured) maps to undefined so the select shows
    // its "Not configured" placeholder rather than forcing a value on open.
    reportingFrequency: (project.reportingFrequency ?? undefined) as "monthly" | "quarterly" | "annual" | undefined,
    stateIds: states.map(s => s.id),
    localities: rawLocalities.map(l => l.name),
    stateAllocations: mappedStateAllocations,
    assignments: mappedAssignments,
    outputs: mappedOutputs.length > 0 ? mappedOutputs : [],
    documents: mappedDocs,
  };
}

// ── PATCH mutation for draft project updates ────────────────────────────────────
function usePatchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ projectId, data }: { projectId: number; data: unknown }) => {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? "Failed to update project");
      }
      return res.json() as Promise<{ id: number }>;
    },
    onSuccess: () => { qc.invalidateQueries(); },
  });
}

// ── Upload helper ──────────────────────────────────────────────────────────────

async function uploadFile(file: File): Promise<{
  fileName: string;
  contentType: string;
  size: number;
  objectPath: string;
  uploadToken?: string;
}> {
  // The project record finalises ownership when it is created. This helper
  // only asks the configured object-storage provider for a scoped upload URL;
  // no legacy Drive façade, provider ID, or storage URL reaches the UI.
  const descriptor = await requestUploadUrl({
    name: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    scope: "documents",
  });
  const uploaded = await fetch(descriptor.uploadURL, {
    method: "PUT",
    body: file,
    headers: { "Content-Type": file.type || "application/octet-stream" },
  });
  if (!uploaded.ok) throw new Error("Upload failed. Please try again.");
  return {
    fileName: file.name,
    contentType: file.type || "application/octet-stream",
    size: file.size,
    objectPath: descriptor.objectPath,
    uploadToken: descriptor.uploadToken,
  };
}

// ── Output Section (sub-component with nested field arrays) ────────────────────

interface OutputSectionProps {
  form: ReturnType<typeof useForm<FormValues>>;
  outputIndex: number;
  onRemove: () => void;
  canRemove: boolean;
  projectStart: string;
  projectEnd: string;
  stateIds: number[];
  states: Array<{ id: number; name: string }>;
  freeLocalities: string[];
  /** Currency code for formatting recorded expenditure (e.g. "USD", "SDG"). */
  currency: string;
  /** True when editing an existing project (so persisted activities have spend data). */
  editMode: boolean;
}

function OutputSection({
  form,
  outputIndex,
  onRemove,
  canRemove,
  projectStart,
  projectEnd,
  stateIds,
  states,
  freeLocalities,
  currency,
  editMode,
}: OutputSectionProps) {
  const { t } = useTranslation("projects");
  const [expanded, setExpanded] = useState(true);
  const [collapsedActivities, setCollapsedActivities] = useState<Set<string>>(new Set());
  /** #487: Tracks an activity pending removal when it has recorded expenditure. */
  const [pendingRemoveActivity, setPendingRemoveActivity] = useState<{ ai: number; id: string; title: string } | null>(null);

  const indicators = useFieldArray({
    control: form.control,
    name: `outputs.${outputIndex}.indicators`,
  });
  const activities = useFieldArray({
    control: form.control,
    name: `outputs.${outputIndex}.activities`,
  });

  // Watch indicators to build the "Linked Indicator" dropdown
  const watchedIndicators = useWatch({
    control: form.control,
    name: `outputs.${outputIndex}.indicators`,
  });
  // Watch output title and activities for collapsed summary
  const watchedOutputTitle = useWatch({
    control: form.control,
    name: `outputs.${outputIndex}.title`,
  });
  const watchedActivities = useWatch({
    control: form.control,
    name: `outputs.${outputIndex}.activities`,
  });

  const indicatorOptions = (watchedIndicators ?? []).map((ind, i) => ({
    index: i,
    label: ind.title || t("form.output.indicatorLabel", { outputNum: outputIndex + 1, indNum: i + 1 }),
  }));

  const toggleActivity = (id: string) => {
    setCollapsedActivities(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const doRemoveActivity = (ai: number, id: string) => {
    activities.remove(ai);
    setCollapsedActivities(prev => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  /** #487: Intercepts activity removal to show confirmation when spend exists. */
  const requestRemoveActivity = (ai: number, act: { id: string; budgetSpent?: number; title?: string }) => {
    const currentValues = form.getValues(`outputs.${outputIndex}.activities.${ai}`);
    const persistedId = currentValues?.id;
    const spend = currentValues?.budgetSpent ?? act.budgetSpent;
    if (editMode && persistedId && persistedId > 0 && spend && spend > 0) {
      setPendingRemoveActivity({ ai, id: act.id, title: currentValues?.title ?? "" });
    } else {
      doRemoveActivity(ai, act.id);
    }
  };

  const indicatorCount = indicators.fields.length;
  const activityCount = activities.fields.length;

  return (
    <div className="rounded-lg border bg-card">
      {/* ── Output header ── */}
      <div className="flex items-start justify-between p-3">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="flex items-start gap-3 text-start flex-1 min-w-0 hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] rounded-md"
        >
          {expanded
            ? <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
            : <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 rtl:rotate-180" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight">{t("form.output.outputLabel", { number: outputIndex + 1 })}</p>
            {watchedOutputTitle && (
              <p className="text-sm text-muted-foreground truncate max-w-sm mt-0.5">{watchedOutputTitle}</p>
            )}
            <p className="text-xs text-muted-foreground mt-1">
              {t("form.output.indicatorCount", { count: indicatorCount })} · {t("form.output.activityCount", { count: activityCount })}
            </p>
          </div>
        </button>
        {canRemove && (
          <IconAction label={t("form.output.removeOutput")} onPress={onRemove} danger className="ms-2 shrink-0">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </IconAction>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          {/* ── Output fields ── */}
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name={`outputs.${outputIndex}.title`} render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.output.outputTitle")} <span className="text-destructive">*</span></FormLabel>
                <FormInput {...field} placeholder={t("form.output.outputTitlePlaceholder")} />
                <FieldMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name={`outputs.${outputIndex}.description`} render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.output.description")}</FormLabel>
                <FormTextArea {...field} rows={2} placeholder={t("form.output.outputDescPlaceholder")} />
                <FieldMessage />
              </FormItem>
            )} />
            <div className="md:w-1/3">
              <FormField control={form.control} name={`outputs.${outputIndex}.target`} render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.output.outputTarget")}</FormLabel>
                  <FormInput type="number" min="0" {...field} value={field.value ?? ""} placeholder={t("form.output.outputTargetPlaceholder")} />
                  <FieldMessage />
                </FormItem>
              )} />
            </div>
          </div>

          {/* ── Indicators ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{t("form.output.indicators")}</h4>
                {indicatorCount > 0 && <Chip size="sm" variant="secondary">{indicatorCount}</Chip>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onPress={() => indicators.append({ title: "", unit: "People Reached", target: 0 })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("form.buttons.addIndicator")}
              </Button>
            </div>

            {indicators.fields.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                {t("form.output.noIndicators")}
              </div>
            )}

            {indicators.fields.map((ind, ii) => (
              <div key={ind.id} className="rounded-lg bg-muted/30 border p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    {t("form.output.indicatorLabel", { outputNum: outputIndex + 1, indNum: ii + 1 })}
                  </span>
                  <IconAction label={t("form.output.removeIndicator")} onPress={() => indicators.remove(ii)} danger>
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </IconAction>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.title`} render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("form.output.indicatorName")} <span className="text-destructive">*</span></FormLabel>
                      <FormInput {...field} placeholder={t("form.output.indicatorNamePlaceholder")} className="text-sm" />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.target`} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.output.target")} <span className="text-destructive">*</span></FormLabel>
                      <FormInput type="number" min="0" {...field} className="text-sm" />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.unit`} render={({ field }) => (
                    <FormItem>
                      <FormSelect
                        label={t("form.output.unit")}
                        isRequired
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        options={indicatorUnitOptions(t, field.value)}
                      />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.description`} render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("form.output.description")}</FormLabel>
                      <FormInput {...field} value={field.value ?? ""} placeholder={t("form.output.indicatorDescPlaceholder")} className="text-sm" />
                    </FormItem>
                  )} />
                </div>
              </div>
            ))}
          </div>

          {/* ── Activities ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{t("form.output.activities")}</h4>
                {activityCount > 0 && <Chip size="sm" variant="secondary">{activityCount}</Chip>}
              </div>
              <Button
                variant="outline"
                size="sm"
                onPress={() => activities.append({
                  title: "",
                  budgetPlanned: 0,
                  plannedStart: "",
                  plannedEnd: "",
                  status: "planned",
                  stateId: 0 as unknown as number,
                  localityName: "",
                })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("form.buttons.addActivity")}
              </Button>
            </div>

            {activities.fields.length === 0 && (
              <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                {t("form.output.noActivities")}
              </div>
            )}

            {activities.fields.map((act, ai) => {
              const isCollapsed = collapsedActivities.has(act.id);
              const watchedAct = watchedActivities?.[ai];
              const actStatusLabel = t(`activityStatus.${watchedAct?.status || "planned"}`);
              const linkedState = watchedAct?.stateId
                ? states.find(s => s.id === Number(watchedAct.stateId))?.name
                : null;

              return (
                <div key={act.id} className="rounded-md border bg-muted/20">
                  {/* Activity card header */}
                  <div className="flex items-start justify-between px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleActivity(act.id)}
                      aria-expanded={!isCollapsed}
                      className="flex items-start gap-3 text-start flex-1 min-w-0 hover:text-[var(--accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)] rounded-md"
                    >
                      {isCollapsed
                        ? <ChevronRight className="h-4 w-4 mt-0.5 shrink-0 rtl:rotate-180" aria-hidden="true" />
                        : <ChevronDown className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-tight">{t("form.output.activityLabel", { outputNum: outputIndex + 1, actNum: ai + 1 })}</p>
                        {watchedAct?.title && (
                          <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">{watchedAct.title}</p>
                        )}
                        {isCollapsed && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {actStatusLabel}
                            {linkedState ? ` · ${linkedState}` : ""}
                            {watchedAct?.plannedStart ? ` · ${watchedAct.plannedStart}` : ""}
                            {watchedAct?.plannedEnd ? `–${watchedAct.plannedEnd}` : ""}
                          </p>
                        )}
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0 ms-2">
                      {!isCollapsed && watchedAct?.status && (
                        <Chip size="sm" variant="secondary">{actStatusLabel}</Chip>
                      )}
                      <IconAction
                        label={t("form.output.removeActivity")}
                        danger
                        onPress={() => requestRemoveActivity(ai, { id: act.id, budgetSpent: watchedAct?.budgetSpent, title: watchedAct?.title })}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </IconAction>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="px-4 pb-4 space-y-4 border-t pt-4">
                      {/* #487: Read-only recorded expenditure — shown in edit mode for existing activities with spend */}
                      {editMode && watchedAct?.id && (watchedAct.budgetSpent ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5 rounded-lg border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-3 py-2 text-xs text-[var(--warning-foreground,var(--foreground))]" aria-live="polite">
                          <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" aria-hidden="true" />
                          <span>
                            <span className="font-medium">{t("form.output.recordedExpenditure")}</span>{" "}
                            <bdi dir="ltr">{new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(watchedAct.budgetSpent ?? 0)} {currency}</bdi>
                            {" "}<span className="text-[var(--muted)]">{t("form.output.recordedExpenditureReadOnly")}</span>
                          </span>
                        </div>
                      )}

                      {/* Group A — Activity identity */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.title`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityName")} <span className="text-destructive">*</span></FormLabel>
                            <FormInput {...field} placeholder={t("form.output.activityNamePlaceholder")} className="text-sm" />
                            <FieldMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.indicatorIndex`} render={({ field }) => (
                          <FormItem>
                            <FormSelect
                              label={t("form.output.linkedIndicator")}
                              value={indicatorOptions.length === 0 ? "" : field.value !== undefined ? String(field.value) : "__none__"}
                              onChange={(v) => field.onChange(v === "__none__" || v === "" ? undefined : Number(v))}
                              isDisabled={indicatorOptions.length === 0}
                              placeholder={indicatorOptions.length === 0 ? t("form.output.noIndicatorsAvailable") : t("form.output.selectIndicator")}
                              options={[
                                { value: "__none__", label: t("form.output.noIndicatorOption") },
                                ...indicatorOptions.map(opt => ({ value: String(opt.index), label: opt.label })),
                              ]}
                            />
                            {indicatorOptions.length === 0 && (
                              <p className="text-xs text-muted-foreground mt-1">{t("form.output.addIndicatorHint")}</p>
                            )}
                            <FieldMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.description`} render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>{t("form.output.activityDesc")}</FormLabel>
                            <FormTextArea {...field} value={field.value ?? ""} rows={2} placeholder={t("form.output.activityDescPlaceholder")} className="text-sm" />
                          </FormItem>
                        )} />
                      </div>

                      {/* Group B — Schedule and resources */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.plannedStart`} render={({ field }) => (
                          <FormItem>
                            <FormDate label={t("form.output.activityStart")} isRequired value={field.value} onChange={field.onChange} min={projectStart || undefined} max={projectEnd || undefined} />
                            <FieldMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.plannedEnd`} render={({ field }) => (
                          <FormItem>
                            <FormDate label={t("form.output.activityEnd")} isRequired value={field.value} onChange={field.onChange} min={projectStart || undefined} max={projectEnd || undefined} />
                            <FieldMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.budgetPlanned`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityBudget")} <span className="text-destructive">*</span></FormLabel>
                            <FormInput type="number" min="0" step="0.01" {...field} className="text-sm" />
                            <FieldMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.target`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityTarget")}</FormLabel>
                            <FormInput type="number" min="0" {...field} value={field.value ?? ""} placeholder="0" className="text-sm" />
                            <FieldMessage />
                          </FormItem>
                        )} />
                      </div>

                      {/* Group C — Implementation assignment */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.status`} render={({ field }) => (
                          <FormItem>
                            <FormSelect
                              label={t("form.output.activityStatus")}
                              value={field.value ?? ""}
                              onChange={field.onChange}
                              options={ACTIVITY_STATUSES.map(s => ({ value: s, label: t(`activityStatus.${s}`) }))}
                            />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.stateId`} render={({ field }) => {
                          const current = field.value ? String(field.value) : "__none__";
                          const opts = stateIds.length > 0
                            ? states.filter((s) => stateIds.includes(s.id))
                            : states;
                          return (
                            <FormItem>
                              <FormSelect
                                label={t("form.output.state")}
                                isRequired
                                value={current}
                                onChange={(v) => field.onChange(v === "__none__" || v === "" ? undefined : Number(v))}
                                placeholder={t("form.output.selectState")}
                                options={[
                                  { value: "__none__", label: t("form.output.selectStateNone") },
                                  ...opts.map(s => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name })),
                                ]}
                              />
                              <FieldMessage />
                            </FormItem>
                          );
                        }} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.localityName`} render={({ field }) => {
                          const selectedStateId = form.watch(`outputs.${outputIndex}.activities.${ai}.stateId`);
                          const hasState = selectedStateId && Number(selectedStateId) > 0;
                          return (
                            <FormItem>
                              <FormSelect
                                label={t("form.output.locality")}
                                isRequired
                                value={!hasState ? "" : field.value ?? "__none__"}
                                onChange={(v) => field.onChange(v === "__none__" || v === "" ? undefined : v)}
                                isDisabled={!hasState}
                                placeholder={!hasState ? t("form.output.selectStateFirst") : freeLocalities.length ? t("form.output.selectLocality") : t("form.output.addLocalitiesFirst")}
                                options={[
                                  { value: "__none__", label: t("form.output.selectLocalityNone") },
                                  ...freeLocalities.map((loc) => ({ value: loc, label: loc })),
                                ]}
                              />
                              <FieldMessage />
                            </FormItem>
                          );
                        }} />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* #487: Financed-activity removal confirmation dialog */}
      <Modal isOpen={!!pendingRemoveActivity} onOpenChange={(open) => { if (!open) setPendingRemoveActivity(null); }}>
        <Modal.Backdrop>
          <Modal.Container size="sm">
            <Modal.Dialog role="alertdialog" aria-labelledby="remove-activity-dialog-title" aria-describedby="remove-activity-dialog-desc">
              <Modal.Header>
                <Modal.Icon className="bg-[var(--danger)]/10 text-[var(--danger)]">
                  <TriangleAlert className="size-5" aria-hidden="true" />
                </Modal.Icon>
                <Modal.Heading id="remove-activity-dialog-title">{t("form.output.removeFinancedTitle")}</Modal.Heading>
                <p id="remove-activity-dialog-desc" className="text-sm text-[var(--muted)]">{t("form.output.removeFinancedDescription")}</p>
              </Modal.Header>
              <Modal.Footer>
                <Button variant="secondary" autoFocus onPress={() => setPendingRemoveActivity(null)}>
                  {t("form.output.keepActivity")}
                </Button>
                <Button
                  variant="danger"
                  onPress={() => {
                    if (pendingRemoveActivity) {
                      doRemoveActivity(pendingRemoveActivity.ai, pendingRemoveActivity.id);
                      setPendingRemoveActivity(null);
                    }
                  }}
                >
                  {t("form.output.removeActivityConfirm")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Document Upload Slot ───────────────────────────────────────────────────────

interface DocUploadSlotProps {
  category: "agreement" | "budget" | "optional";
  /** Document kind codes offered for this category (labels come from projects:documentKinds). */
  kinds: readonly string[];
  form: ReturnType<typeof useForm<FormValues>>;
  /** PRJ-BD-04 lifecycle gate for this project. */
  docGate: "mutable" | "operational" | "frozen";
  /** Current user's role — determines override eligibility. */
  userRole: string;
  /** DB project id — required for override-delete API call. */
  projectId?: number;
}

export function DocUploadSlot({ category, kinds, form, docGate, userRole, projectId }: DocUploadSlotProps) {
  const { toast } = useToast();
  const { t } = useTranslation("projects");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selectedKind, setSelectedKind] = useState(kinds[0] ?? "other");
  const docKindLabel = (kind: string) => t(`documentKinds.${kind}`, { defaultValue: kind });
  // Override delete dialog state (operational projects, PM/SA only)
  const [overrideDeleteDialog, setOverrideDeleteDialog] = useState<{ docId: number; fileName: string; objectPath: string } | null>(null);
  const [overrideReason, setOverrideReason] = useState("");
  const [overrideReasonError, setOverrideReasonError] = useState("");
  const [isOverrideDeleting, setIsOverrideDeleting] = useState(false);

  const isOverrideActor = userRole === "program_manager" || userRole === "super_admin";

  const allDocs = useWatch({ control: form.control, name: "documents" }) ?? [];
  const categoryDocs = allDocs.filter(d => d.category === category);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const uploaded = await uploadFile(file);
      const current = form.getValues("documents");
      form.setValue("documents", [
        ...current,
        { ...uploaded, category, kind: selectedKind },
      ], { shouldValidate: true });
      toast({ title: t("form.toasts.fileUploaded"), description: file.name });
    } catch (err) {
      const message = err instanceof Error ? err.message : t("form.toasts.uploadFailedDesc");
      setUploadError(message);
      toast({ title: t("form.toasts.uploadFailed"), description: message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  // Keyed by objectPath (unique per uploaded blob), not fileName — two
  // documents in different categories (or even the same one) can share a
  // display file name, and removing one must never also remove the other.
  const removeDoc = (objectPath: string) => {
    const current = form.getValues("documents");
    form.setValue("documents", current.filter(d => d.objectPath !== objectPath));
  };

  const openOverrideDialog = (docId: number, fileName: string, objectPath: string) => {
    setOverrideDeleteDialog({ docId, fileName, objectPath });
    setOverrideReason("");
    setOverrideReasonError("");
  };

  const closeOverrideDialog = () => {
    setOverrideDeleteDialog(null);
    setOverrideReason("");
    setOverrideReasonError("");
  };

  const handleOverrideDelete = async () => {
    if (!overrideDeleteDialog || !projectId) return;
    const reason = overrideReason.trim();
    if (!reason) {
      setOverrideReasonError(t("detail.docs.overrideReasonRequired"));
      return;
    }
    setIsOverrideDeleting(true);
    setOverrideReasonError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/documents/${overrideDeleteDialog.docId}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrideReason: reason }),
        credentials: "include",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { message?: string };
        setOverrideReasonError(data.message ?? t("detail.docs.overrideDeleteFailed"));
        return;
      }
      removeDoc(overrideDeleteDialog.objectPath);
      toast({ title: t("detail.docs.overrideDeleted"), description: overrideDeleteDialog.fileName });
      closeOverrideDialog();
    } catch {
      setOverrideReasonError(t("detail.docs.overrideDeleteFailed"));
    } finally {
      setIsOverrideDeleting(false);
    }
  };

  return (
    <div className="space-y-2">
      {categoryDocs.length > 0 && (
        <div className="space-y-1">
          {categoryDocs.map((doc) => (
            <div key={doc.id ?? doc.fileName} className="flex items-center gap-2 rounded-lg bg-[var(--surface-secondary)] p-2 text-sm">
              <FileText className="h-3.5 w-3.5 text-[var(--muted)] shrink-0" aria-hidden="true" />
              <span className="flex-1 min-w-0 break-words" dir="auto">{doc.fileName}</span>
              <span className="text-xs text-[var(--muted)]">{docKindLabel(doc.kind)}</span>
              {/* Delete button — gated by lifecycle status */}
              {docGate === "mutable" && (
                <IconAction
                  label={t("detail.docs.deleteAria", { name: doc.fileName })}
                  onPress={() => removeDoc(doc.objectPath)}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </IconAction>
              )}
              {docGate === "operational" && isOverrideActor && doc.id !== undefined && (
                <IconAction
                  label={t("detail.docs.deleteOverrideAria", { name: doc.fileName })}
                  tooltip={t("detail.docs.overrideTooltip")}
                  className="text-[var(--warning)]"
                  onPress={() => openOverrideDialog(doc.id!, doc.fileName, doc.objectPath)}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </IconAction>
              )}
              {docGate === "operational" && !isOverrideActor && (
                <Tooltip delay={300}>
                  <Tooltip.Trigger
                    aria-label={t("detail.docs.lockedTooltip")}
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[var(--muted)]"
                  >
                    <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                  </Tooltip.Trigger>
                  <Tooltip.Content>{t("detail.docs.lockedTooltip")}</Tooltip.Content>
                </Tooltip>
              )}
              {/* docGate === "frozen": no delete or lock icon — fully read-only */}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <SelectField
          aria-label={t("form.documents.kindLabel")}
          value={selectedKind}
          onChange={setSelectedKind}
          options={kinds.map(k => ({ value: k, label: docKindLabel(k) }))}
          className="min-w-0 flex-1"
          triggerClassName="h-9"
        />
        {/* Upload button — hidden for frozen projects */}
        {docGate !== "frozen" ? (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED_DOC_TYPES}
              className="hidden"
              onChange={handleFileChange}
              disabled={uploading}
            />
            <Button
              variant="outline"
              size="sm"
              className="h-9"
              isPending={uploading}
              onPress={() => fileInputRef.current?.click()}
            >
              {uploading ? <Spinner size="sm" color="current" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
              {uploading ? t("form.buttons.uploading") : t("form.buttons.upload")}
            </Button>
          </>
        ) : (
          <Tooltip delay={300}>
            <Tooltip.Trigger className="inline-flex">
              <Button variant="outline" size="sm" className="h-9" isDisabled>
                <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                {t("form.documents.locked")}
              </Button>
            </Tooltip.Trigger>
            <Tooltip.Content>{t("form.documents.closedUploadTooltip")}</Tooltip.Content>
          </Tooltip>
        )}
      </div>
      {uploadError && (
        <p className="text-xs text-[var(--danger)] mt-1" role="alert">{uploadError}</p>
      )}

      {/* Override delete dialog — operational projects, PM/SA only */}
      <Modal isOpen={!!overrideDeleteDialog} onOpenChange={(open) => { if (!open) closeOverrideDialog(); }}>
        <Modal.Backdrop>
          <Modal.Container size="md">
            <Modal.Dialog>
              <Modal.CloseTrigger />
              <Modal.Header>
                <Modal.Heading>{t("detail.docs.overrideTitle")}</Modal.Heading>
                <p className="text-sm text-[var(--muted)]">{t("detail.docs.overrideDescription")}</p>
              </Modal.Header>
              <Modal.Body>
                <TextField
                  value={overrideReason}
                  onChange={(v) => { setOverrideReason(v); if (overrideReasonError) setOverrideReasonError(""); }}
                  isInvalid={!!overrideReasonError}
                  fullWidth
                >
                  <Label>{t("detail.docs.overrideReasonLabel")}</Label>
                  <TextArea rows={3} placeholder={t("form.documents.overrideReasonPlaceholder")} />
                  {overrideReasonError && <p className="text-sm text-[var(--danger)]" role="alert">{overrideReasonError}</p>}
                </TextField>
              </Modal.Body>
              <Modal.Footer>
                <Button variant="secondary" onPress={closeOverrideDialog} isDisabled={isOverrideDeleting}>
                  {t("form.buttons.cancel")}
                </Button>
                <Button variant="danger" onPress={handleOverrideDelete} isPending={isOverrideDeleting}>
                  {isOverrideDeleting && <Spinner size="sm" color="current" />}
                  {isOverrideDeleting ? t("detail.docs.deleting") : t("detail.docs.deleteDocument")}
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </div>
  );
}

// ── Main Form ──────────────────────────────────────────────────────────────────

// ── DuplicateDetectionModal ───────────────────────────────────────────────────

interface DuplicateModalProps {
  open: boolean;
  onClose: () => void;
  existing: DuplicateProjectInfo;
  newStateNames: string[];
  newSectors: string[];
  newLocalities: string[];
  canMerge: boolean;
  canCreateAnyway: boolean;
  isMerging: boolean;
  onMerge: (kind: "states" | "sectors" | "both") => void;
  onOpenExisting: () => void;
  onCreateAnyway: () => void;
}

function DuplicateDetectionModal({
  open, onClose, existing,
  newStateNames, newSectors, newLocalities,
  canMerge, canCreateAnyway, isMerging,
  onMerge, onOpenExisting, onCreateAnyway,
}: DuplicateModalProps) {
  const { t } = useTranslation("projects");
  const existingSectors = existing.sectors.length > 0 ? existing.sectors : (existing.sector ? [existing.sector] : []);
  const addedStates = newStateNames.filter(n => !existing.stateNames.includes(n));
  const addedSectors = newSectors.filter(s => !existingSectors.includes(s));
  const addedLocalities = newLocalities.filter(l => !existing.localities.includes(l));

  const chips = (items: string[], added: string[]) => (
    <div className="flex flex-wrap gap-1">
      {items.map(n => (
        <Chip key={n} size="sm" variant="soft" color={added.includes(n) ? "success" : "default"}>
          {n}{added.includes(n) ? t("form.duplicate.newBadge") : t("form.duplicate.existsBadge")}
        </Chip>
      ))}
    </div>
  );

  return (
    <Modal isOpen={open} onOpenChange={(v) => !v && onClose()}>
      <Modal.Backdrop>
        <Modal.Container size="lg" scroll="inside">
          <Modal.Dialog className="sm:max-w-2xl">
            <Modal.CloseTrigger />
            <Modal.Header>
              <Modal.Heading className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-[var(--warning)] shrink-0" aria-hidden="true" />
                {t("form.duplicate.title")}
              </Modal.Heading>
              <p className="text-sm text-[var(--muted)]">{t("form.duplicate.description")}</p>
            </Modal.Header>
            <Modal.Body className="space-y-4">
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3 space-y-2">
                  <p className="font-semibold text-xs text-[var(--muted)]">{t("form.duplicate.existingProject")}</p>
                  <div><span className="text-[var(--muted)]">{t("form.duplicate.code")} </span><code className="font-mono text-xs"><bdi dir="ltr">{existing.code}</bdi></code></div>
                  <div><span className="text-[var(--muted)]">{t("form.duplicate.title_field")} </span><span className="font-medium" dir="auto">{existing.title}</span></div>
                  <div><span className="text-[var(--muted)]">{t("form.duplicate.agreement")} </span><bdi dir="ltr">{existing.agreementNumber ?? "—"}</bdi></div>
                  <div><span className="text-[var(--muted)]">{t("form.duplicate.donor")} </span>{existing.donor}</div>
                  <div>
                    <p className="text-[var(--muted)] mb-1">{t("form.duplicate.states")}</p>
                    <div className="flex flex-wrap gap-1">
                      {existing.stateNames.length > 0
                        ? existing.stateNames.map(n => <Chip key={n} size="sm" variant="secondary">{n}</Chip>)
                        : <span className="italic text-[var(--muted)]">{t("form.duplicate.none")}</span>}
                    </div>
                  </div>
                  <div>
                    <p className="text-[var(--muted)] mb-1">{t("form.duplicate.sectors")}</p>
                    <div className="flex flex-wrap gap-1">
                      {existingSectors.length > 0
                        ? existingSectors.map(s => <Chip key={s} size="sm" variant="secondary">{s}</Chip>)
                        : <span className="italic text-[var(--muted)]">{t("form.duplicate.none")}</span>}
                    </div>
                  </div>
                  {existing.localities.length > 0 && (
                    <div><span className="text-[var(--muted)]">{t("form.duplicate.localities")} </span><span className="text-xs">{existing.localities.slice(0, 5).join(t("listSeparator", { defaultValue: ", " }))}{existing.localities.length > 5 ? ` ${t("form.duplicate.moreLocalities", { count: existing.localities.length - 5 })}` : ""}</span></div>
                  )}
                </div>

                <div className="rounded-xl border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-3 space-y-2">
                  <p className="font-semibold text-xs text-[var(--muted)]">{t("form.duplicate.newEntry")}</p>
                  <div>
                    <p className="text-[var(--muted)] mb-1">{t("form.duplicate.states")}</p>
                    {newStateNames.length > 0
                      ? chips(newStateNames, addedStates)
                      : <span className="italic text-[var(--muted)]">{t("form.duplicate.noneSelected")}</span>}
                  </div>
                  <div>
                    <p className="text-[var(--muted)] mb-1">{t("form.duplicate.sectors")}</p>
                    {newSectors.length > 0
                      ? chips(newSectors, addedSectors)
                      : <span className="italic text-[var(--muted)]">{t("form.duplicate.noneSelected")}</span>}
                  </div>
                  {newLocalities.length > 0 && (
                    <div>
                      <p className="text-[var(--muted)] mb-1">{t("form.duplicate.localities")}</p>
                      {chips(newLocalities, addedLocalities)}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {canMerge ? (
                  <>
                    {addedStates.length === 0 && addedSectors.length === 0 && addedLocalities.length === 0 && (
                      <p className="text-sm text-center text-[var(--muted)] py-2">{t("form.duplicate.nothingToMerge")}</p>
                    )}
                    {addedStates.length > 0 && (
                      <Button fullWidth isPending={isMerging} onPress={() => onMerge("states")}>
                        {isMerging ? <Spinner size="sm" color="current" /> : <GitMerge className="h-4 w-4" aria-hidden="true" />}
                        {t("form.buttons.addStates", { states: addedStates.join(", ") })}
                      </Button>
                    )}
                    {addedSectors.length > 0 && (
                      <Button fullWidth isPending={isMerging} onPress={() => onMerge("sectors")}>
                        {isMerging ? <Spinner size="sm" color="current" /> : <GitMerge className="h-4 w-4" aria-hidden="true" />}
                        {t("form.buttons.addSectors", { sectors: addedSectors.join(", ") })}
                      </Button>
                    )}
                    {addedStates.length > 0 && addedSectors.length > 0 && (
                      <Button fullWidth variant="secondary" isPending={isMerging} onPress={() => onMerge("both")}>
                        {isMerging ? <Spinner size="sm" color="current" /> : <GitMerge className="h-4 w-4" aria-hidden="true" />}
                        {t("form.buttons.addBoth")}
                      </Button>
                    )}
                  </>
                ) : (
                  <Alert status="warning">
                    <Alert.Indicator />
                    <Alert.Content>
                      <Alert.Description>{t("form.duplicate.noMergePermission")}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                <Button fullWidth variant="outline" onPress={onOpenExisting}>
                  {t("form.buttons.openExisting")}
                </Button>
                {canCreateAnyway ? (
                  <Button fullWidth variant="danger-soft" onPress={onCreateAnyway}>
                    {t("form.buttons.createAnyway")}
                  </Button>
                ) : (
                  <p className="text-xs text-[var(--muted)] text-center pt-1">
                    {t("form.duplicate.noDuplicatePermission")}
                  </p>
                )}
              </div>
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

// ── ProjectRegistrationForm ───────────────────────────────────────────────────

interface Props {
  open?: boolean;
  onClose: () => void;
  editProjectId?: number;
  /**
   * Prefill the create form from an existing project's full content (title,
   * budget, outputs/indicators/activities, state allocations, etc.) without
   * entering edit mode — editProjectId stays unset, so submit still POSTs a
   * brand-new project through the normal create validation (required
   * agreement number, reporting frequency, at least one output) instead of
   * the incomplete 5-field payload the "Duplicate" action used to send
   * directly to the API.
   */
  duplicateFromProjectId?: number;
}

export function ProjectRegistrationForm({ open = true, onClose, editProjectId, duplicateFromProjectId }: Props) {
  const { t, i18n } = useTranslation("projects");
  const { t: commonT } = useTranslation("common");
  const { t: tUsers } = useTranslation("users");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { isOnline } = useSyncContext();
  const createProject = useCreateProject();
  const mergeProject = useMergeProjectData();
  const { data: me } = useGetMe();
  const currentUser = me?.user as unknown as Record<string, unknown> | undefined;
  const isStateScopedAuthor = ["state_program_officer", "state_office_manager"].includes(String(currentUser?.role ?? ""));
  const authorisedStateId = typeof currentUser?.stateId === "number" ? currentUser.stateId : null;
  const authorisedSector = typeof currentUser?.sector === "string" ? currentUser.sector : null;

  const statesQuery = useListStates();
  const stateReference = deriveStateReferenceData(statesQuery);
  const statesLoaded = stateReference.status === "ready" || stateReference.status === "empty";
  const { data: usersData, isSuccess: usersLoaded } = useListUsers({ status: "active" });
  const { data: donorsData } = useListDonors();
  const createDonor = useCreateDonor();

  const [localityInput, setLocalityInput] = useState("");
  const [showNewDonor, setShowNewDonor] = useState(false);
  const [pendingVoiceNote, setPendingVoiceNote] = useState<PendingNote | null>(null);
  const [showDuplicateModal, setShowDuplicateModal] = useState(false);
  const [forceCreate, setForceCreate] = useState(false);
  const [agreementWarningAck, setAgreementWarningAck] = useState(false);
  const [dupCheckKey, setDupCheckKey] = useState({ agreementNumber: "", donor: "", title: "" });
  // Must live above the `if (!open) return null` guard — hooks cannot be conditional
  const [isSavingDraft, setIsSavingDraft] = useState(false);

  // ── Edit mode: load existing draft ─────────────────────────────────────────
  // Also fires for duplicateFromProjectId, which reuses the exact same fetch
  // + mapProjectToFormValues plumbing to prefill a brand-new (non-edit) form.
  const sourceProjectId = editProjectId ?? duplicateFromProjectId;
  const { data: editData, isLoading: isEditLoading } = useGetProject(
    sourceProjectId ?? 0,
    { query: { enabled: !!sourceProjectId, staleTime: 60_000 } } as Parameters<typeof useGetProject>[1],
  );
  const { data: editStateAllocations } = useListProjectStateAllocations(
    sourceProjectId ?? 0,
    { query: { enabled: !!sourceProjectId, staleTime: 60_000 } } as Parameters<typeof useListProjectStateAllocations>[1],
  );
  const editLoadedRef = useRef(false);
  // Guards the duplicate-check debounce while form.reset() is populating edit data.
  const isInitialisingRef = useRef(false);
  const reportingCoverageCustomisedRef = useRef(false);
  const patchProject = usePatchProject();

  const states = stateReference.states;
  const users = usersData?.items ?? [];
  const donors = donorsData ?? [];

  const form = useForm<FormValues>({
    resolver: zodResolver(editProjectId ? schema : createSchema),
    defaultValues: {
      title: "",
      description: "",
      classification: "",
      sectors: [],
      subSectors: [],
      assistanceModality: undefined,
      donor: "",
      donorId: undefined,
      newDonorName: "",
      agreementNumber: "",
      agreementStart: "",
      agreementEnd: "",
      signedDate: "",
      internalNotes: "",
      startDate: "",
      endDate: "",
      reportingStartDate: "",
      reportingEndDate: "",
      budgetTotal: 0,
      directCost: undefined,
      indirectCost: undefined,
      cafaContribution: undefined,
      currency: "USD",
      beneficiariesTarget: 0,
      beneficiariesMale: 0,
      beneficiariesFemale: 0,
      beneficiariesBoys: 0,
      beneficiariesGirls: 0,
      activityTarget: 0,
      indicatorTarget: 0,
      hasHqOperations: false,
      reportingFrequency: undefined,
      stateIds: [],
      localities: [],
      stateAllocations: [],
      assignments: [{ role: "project_manager", name: "", userId: undefined }],
      outputs: [],
      documents: [],
    },
  });

  const operationalProjectDraft = useWatch({ control: form.control });
  const projectDraft = useDurableFormDraft({
    // A loaded empty list means the current user has no reference access; it
    // must still trigger recovery so stale values are cleared rather than kept.
    enabled: open && statesLoaded && usersLoaded,
    userId: me?.user?.id,
    module: "projects",
    recordKey: editProjectId == null ? "new" : String(editProjectId),
    label: "Project draft",
    // Financial values, allocations, documents, and aggregate targets are
    // excluded by design: these fields remain an explicitly online action.
    value: {
      title: operationalProjectDraft.title,
      description: operationalProjectDraft.description,
      classification: operationalProjectDraft.classification,
      sectors: operationalProjectDraft.sectors,
      subSectors: operationalProjectDraft.subSectors,
      assistanceModality: operationalProjectDraft.assistanceModality,
      agreementNumber: operationalProjectDraft.agreementNumber,
      agreementStart: operationalProjectDraft.agreementStart,
      agreementEnd: operationalProjectDraft.agreementEnd,
      signedDate: operationalProjectDraft.signedDate,
      internalNotes: operationalProjectDraft.internalNotes,
      startDate: operationalProjectDraft.startDate,
      endDate: operationalProjectDraft.endDate,
      reportingStartDate: operationalProjectDraft.reportingStartDate,
      reportingEndDate: operationalProjectDraft.reportingEndDate,
      hasHqOperations: operationalProjectDraft.hasHqOperations,
      reportingFrequency: operationalProjectDraft.reportingFrequency,
      stateIds: operationalProjectDraft.stateIds,
      localities: operationalProjectDraft.localities,
      assignments: operationalProjectDraft.assignments,
      outputs: (operationalProjectDraft.outputs ?? []).map((output) => ({
        title: output.title,
        description: output.description,
        indicators: output.indicators,
        activities: (output.activities ?? []).map(({
          budgetPlanned: _budget, budgetSpent: _spent, target: _target,
          status: _status, ...activity
        }) => activity),
      })),
    },
    scope: {
      stateIds: isStateScopedAuthor && authorisedStateId ? [authorisedStateId] : states.map((state) => state.id),
      sectors: authorisedSector ? [authorisedSector] : operationalProjectDraft.sectors,
      projectIds: editProjectId ? [editProjectId] : [],
    },
    onRecover: (draft) => {
      const validStates = new Set(isStateScopedAuthor && authorisedStateId ? [authorisedStateId] : states.map((state) => state.id));
      const validUsers = new Set(users.map((user) => user.id));
      const recoveredSectors = (draft.sectors ?? []).filter((sector) => !authorisedSector || sector === authorisedSector);
      const validSubSectors = new Set(
        recoveredSectors.flatMap((sector) => SUB_SECTORS[sector as keyof typeof SUB_SECTORS] ?? []),
      );
      const recovered = {
        ...draft,
        stateIds: (draft.stateIds ?? []).filter((stateId) => validStates.has(stateId)),
        sectors: recoveredSectors,
        subSectors: (draft.subSectors ?? []).filter((subSector) => validSubSectors.has(subSector)),
        assignments: (draft.assignments ?? []).map((assignment) =>
          assignment.userId && !validUsers.has(assignment.userId)
            ? { role: assignment.role }
            : assignment,
        ),
        outputs: (draft.outputs ?? []).map((output) => ({
          ...output,
          activities: (output.activities ?? []).map((activity) => ({
            ...activity,
            stateId: activity.stateId && !validStates.has(activity.stateId) ? undefined : activity.stateId,
          })),
        })),
      };
      form.reset({ ...form.getValues(), ...recovered } as FormValues);
    },
  });

  const { control, watch } = form;
  const projectStart = watch("startDate");
  const projectEnd = watch("endDate");
  const previousImplementationDates = useRef({ start: projectStart, end: projectEnd });
  useEffect(() => {
    const previous = previousImplementationDates.current;
    // Only mirror real changes to the implementation period. Running this on
    // mount validated the still-empty reporting dates, and that async result
    // could land after edit data loaded — leaving a stale "required" error on
    // fields that were filled in.
    if (projectStart === previous.start && projectEnd === previous.end) return;
    const reportingStart = form.getValues("reportingStartDate");
    const reportingEnd = form.getValues("reportingEndDate");
    if (
      !reportingCoverageCustomisedRef.current
      && ((reportingStart && reportingStart !== previous.start) || (reportingEnd && reportingEnd !== previous.end))
    ) {
      reportingCoverageCustomisedRef.current = true;
    }
    if (!reportingCoverageCustomisedRef.current) {
      form.setValue("reportingStartDate", projectStart, { shouldValidate: true });
      form.setValue("reportingEndDate", projectEnd, { shouldValidate: true });
    }
    previousImplementationDates.current = { start: projectStart, end: projectEnd };
  }, [form, projectStart, projectEnd]);
  const selectedStateIds = watch("stateIds");
  const hasHqOpsValue = watch("hasHqOperations");
  const freeLocalities = watch("localities");
  const sectors = watch("sectors");
  const donorId = watch("donorId");
  const watchedStateAllocations = watch("stateAllocations");
  const watchedBudgetTotal = watch("budgetTotal");

  useEffect(() => {
    // Duplicating reuses the source project's own location — a state-scoped
    // author's own state must not silently override it.
    if (!isStateScopedAuthor || editProjectId || duplicateFromProjectId) return;
    const soleStateId = authorisedStateId && stateReference.isReady ? authorisedStateId : undefined;
    form.setValue("hasHqOperations", false, { shouldValidate: true });
    form.setValue("stateIds", soleStateId ? [soleStateId] : [], { shouldValidate: true });
    form.setValue("stateAllocations", soleStateId ? [{ stateId: soleStateId }] : []);
  }, [authorisedStateId, editProjectId, duplicateFromProjectId, form, isStateScopedAuthor, stateReference.isReady]);

  // ── Duplicate detection debounce ───────────────────────────────────────────
  const watchedAgreement = watch("agreementNumber");
  const watchedDonor = watch("donor");
  const watchedTitle = watch("title");
  useEffect(() => {
    if (forceCreate) return;
    // Skip while edit data is being loaded — form.reset() triggers watchers but
    // those aren't user changes; the project must not detect itself as a duplicate.
    if (isInitialisingRef.current) return;
    const t = setTimeout(() => {
      setDupCheckKey({
        agreementNumber: watchedAgreement?.trim() ?? "",
        donor: watchedDonor?.trim() ?? "",
        title: watchedTitle?.trim() ?? "",
      });
    }, 700);
    return () => clearTimeout(t);
  }, [watchedAgreement, watchedDonor, watchedTitle, forceCreate]);

  const { data: duplicateResult } = useCheckProjectDuplicate(
    {
      agreementNumber: dupCheckKey.agreementNumber,
      donor: dupCheckKey.donor,
      title: dupCheckKey.title,
      // In edit mode exclude the current project so it can never match itself
      ...(editProjectId ? { excludeId: editProjectId } : {}),
    },
    { query: { queryKey: ["duplicate-check", dupCheckKey, editProjectId ?? null], enabled: dupCheckKey.agreementNumber.length >= 3 && !forceCreate, staleTime: 30_000 } },
  );

  // Show modal automatically when an exact match is detected
  useEffect(() => {
    if (!forceCreate && duplicateResult?.matchType === "exact") {
      setShowDuplicateModal(true);
    }
  }, [duplicateResult?.matchType, forceCreate]);

  // ── Reset form with loaded edit (or duplicate-source) data ─────────────────
  useEffect(() => {
    if (!sourceProjectId || editLoadedRef.current) return;
    if (!editData) return;
    const allocs = ((editStateAllocations ?? []) as Array<Record<string, unknown>>);
    const mapped = mapProjectToFormValues(
      editData as Parameters<typeof mapProjectToFormValues>[0],
      allocs,
    );
    if (duplicateFromProjectId && !editProjectId) {
      // Duplicating: this becomes a brand-new project, not a copy of the
      // source's identity. Documents belong to the source project's own
      // storage and must not be silently claimed by the new one; activity
      // ids are the source's own row ids and must not be sent as if they
      // belonged to (not-yet-existing) rows on the new project.
      mapped.title = `Copy of ${mapped.title}`;
      mapped.documents = [];
      mapped.outputs = mapped.outputs.map((out) => ({
        ...out,
        activities: out.activities.map(({ id: _sourceActivityId, budgetSpent: _sourceBudgetSpent, ...act }) => act),
      }));
    }
    // Block duplicate detection while form.reset() fires watchers (700ms debounce
    // + 300ms buffer = 1000ms). Cleared after that window so user changes still work.
    isInitialisingRef.current = true;
    reportingCoverageCustomisedRef.current =
      mapped.reportingStartDate !== mapped.startDate || mapped.reportingEndDate !== mapped.endDate;
    // The loaded period is the baseline, not a user change to mirror.
    previousImplementationDates.current = { start: mapped.startDate, end: mapped.endDate };
    form.reset(mapped);
    editLoadedRef.current = true;
    const t = setTimeout(() => { isInitialisingRef.current = false; }, 1000);
    return () => clearTimeout(t);
  }, [sourceProjectId, editProjectId, duplicateFromProjectId, editData, editStateAllocations, form]);

  // RBAC helpers
  const userRole = me?.user?.role ?? "";

  // PRJ-BD-04: Document lifecycle gate derived from the project's current status.
  // new/create mode: always mutable.
  const projectStatus = editProjectId
    ? ((editData as { project?: Record<string, unknown> } | undefined)?.project?.status as string | undefined)
    : undefined;
  // PRJ-BD-04: Frozen set matches server — both "completed" and "closed" are fully locked.
  const docGate: "mutable" | "operational" | "frozen" =
    ["closed", "completed"].includes(projectStatus ?? "")
      ? "frozen"
      : ["approved", "active"].includes(projectStatus ?? "")
      ? "operational"
      : "mutable";

  const canMerge = ["super_admin", "program_manager", "executive_director"].includes(userRole)
    || (me?.permissions ? Object.keys(me.permissions).includes("projects.update") : false);
  const canCreateAnyway = ["super_admin", "program_manager", "executive_director"].includes(userRole);

  const outputs = useFieldArray({ control, name: "outputs" });
  const assignments = useFieldArray({ control, name: "assignments" });


  // Auto-compute beneficiariesTarget from M+F+B+G
  const bMale = Number(watch("beneficiariesMale") || 0);
  const bFemale = Number(watch("beneficiariesFemale") || 0);
  const bBoys = Number(watch("beneficiariesBoys") || 0);
  const bGirls = Number(watch("beneficiariesGirls") || 0);
  useEffect(() => {
    const total = bMale + bFemale + bBoys + bGirls;
    if (total > 0) form.setValue("beneficiariesTarget", total);
  }, [bMale, bFemale, bBoys, bGirls, form]);

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<TabId>("basic");
  // On narrow screens the step bar scrolls; keep the current step in view.
  useEffect(() => {
    document.getElementById(`prj-tab-${activeTab}`)?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [activeTab]);
  const activeTabIndex = TABS.findIndex(t => t.id === activeTab);
  const goToNextTab = () => {
    if (activeTab === "timeline") {
      const reportingStart = form.getValues("reportingStartDate");
      const reportingEnd = form.getValues("reportingEndDate");
      if (reportingStart && reportingEnd && reportingStart > reportingEnd) {
        form.setError("reportingEndDate", {
          type: "validate",
          message: t("form.validation.reportingCoverageOrder"),
        }, { shouldFocus: true });
        return;
      }
      form.clearErrors("reportingEndDate");
    }
    setActiveTab(TABS[Math.min(activeTabIndex + 1, TABS.length - 1)].id);
  };
  const goToPrevTab = () => setActiveTab(TABS[Math.max(activeTabIndex - 1, 0)].id);

  if (!open) return null;

  // Show loading skeleton while fetching project for edit (or duplicate-source)
  if (sourceProjectId && isEditLoading) {
    return (
      <div aria-busy="true" aria-label={t("form.loadingAriaLabel")}>
        <span className="sr-only">{t("form.loadingAriaLabel")}</span>
        {/* Tab nav skeleton */}
        <div className="mb-6 rounded-3xl bg-[var(--default)] p-1">
          <div className="flex gap-1 overflow-x-auto">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-3xl" />
            ))}
          </div>
        </div>
        {/* Panel body skeleton */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-9 w-full rounded-xl" />
            </div>
          </div>
        </div>
        {/* Footer skeleton */}
        <div className="mt-6 border-t border-[var(--border)]">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-9 w-20 rounded-full" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-28 rounded-full" />
                <Skeleton className="h-9 w-28 rounded-full" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const addLocality = () => {
    const val = localityInput.trim();
    if (!val) return;
    const current = form.getValues("localities");
    if (current.some(l => l.toLowerCase() === val.toLowerCase())) {
      toast({ title: t("form.toasts.duplicateLocality"), description: t("form.toasts.duplicateLocalityDesc", { val }), variant: "destructive" });
      return;
    }
    form.setValue("localities", [...current, val]);
    setLocalityInput("");
  };

  const removeLocality = (loc: string) => {
    form.setValue("localities", form.getValues("localities").filter(l => l !== loc));
  };

  const toggleSector = (sector: string) => {
    const current = form.getValues("sectors");
    if (current.includes(sector)) {
      const next = current.filter(s => s !== sector);
      form.setValue("sectors", next, { shouldValidate: true });
      // If the primary sector (first item) changed, clear sub-sectors
      if (current[0] === sector) {
        form.setValue("subSectors", []);
      }
    } else {
      const next = [...current, sector];
      form.setValue("sectors", next, { shouldValidate: true });
      // If this is the first sector being added, sub-sectors were for a different parent — clear
      if (current.length === 0) {
        form.setValue("subSectors", []);
      }
    }
  };

  const toggleState = (id: number) => {
    if (isStateScopedAuthor) return;
    const current = form.getValues("stateIds");
    const currentAllocations = form.getValues("stateAllocations");
    if (current.includes(id)) {
      form.setValue("stateIds", current.filter(s => s !== id), { shouldValidate: true });
      form.setValue("stateAllocations", currentAllocations.filter(a => a.stateId !== id));
    } else {
      form.setValue("stateIds", [...current, id], { shouldValidate: true });
      form.setValue("stateAllocations", [...currentAllocations, { stateId: id }]);
    }
  };

  const onSubmit = async (values: FormValues) => {
    if (!isOnline) {
      await projectDraft.saveNow();
      toast({
        title: commonT("sync.localDraftSaved"),
        description: commonT("sync.projectDraftOperationalOnly"),
      });
      onClose();
      return;
    }
    if (!stateReference.isReady) {
      form.setError("root" as never, {
        type: "manual",
        message: t("form.location.statesUnavailable"),
      });
      setActiveTab("location");
      return;
    }
    // In edit mode: skip duplicate detection
    if (!editProjectId && !forceCreate && duplicateResult?.matchType === "exact") {
      setShowDuplicateModal(true);
      return;
    }

    // Validate that at least one document was uploaded (skip for edits — existing docs count)
    if (!editProjectId && values.documents.length === 0) {
      form.setError("root" as never, {
        type: "manual",
        message: t("form.errors.uploadRequired"),
      });
      return;
    }
    form.clearErrors("root" as never);

    try {
      // If new donor name entered, create donor first
      let resolvedDonorId = values.donorId;
      let resolvedDonorName = values.donor ?? "";

      if (showNewDonor && values.newDonorName?.trim()) {
        const newDonor = await createDonor.mutateAsync({ data: { name: values.newDonorName.trim() } });
        resolvedDonorId = newDonor.id;
        resolvedDonorName = newDonor.name;
      } else if (!resolvedDonorId && !resolvedDonorName) {
        resolvedDonorName = "Unknown";
      }

      // If donorId selected, get name from list
      if (resolvedDonorId && !resolvedDonorName) {
        const found = donors.find(d => d.id === resolvedDonorId);
        if (found) resolvedDonorName = found.name;
      }

      // ── Edit mode: PATCH existing draft ──────────────────────────────────────
      if (editProjectId) {
        const patchPayload = {
          title: values.title,
          description: values.description,
          classification: values.classification || undefined,
          sectors: values.sectors,
          sector: values.sectors[0],
          subSectors: values.subSectors,
          assistanceModality: values.assistanceModality || undefined,
          donorId: resolvedDonorId,
          donor: resolvedDonorName,
          agreementNumber: values.agreementNumber,
          agreementStart: values.agreementStart || undefined,
          agreementEnd: values.agreementEnd || undefined,
          signedDate: values.signedDate || undefined,
          internalNotes: values.internalNotes || undefined,
          startDate: values.startDate,
          endDate: values.endDate,
          reportingStartDate: values.reportingStartDate,
          reportingEndDate: values.reportingEndDate,
          budgetTotal: values.budgetTotal,
          directCost: values.directCost,
          indirectCost: values.indirectCost,
          cafaContribution: values.cafaContribution,
          currency: values.currency,
          beneficiariesTarget: values.beneficiariesTarget,
          beneficiariesMale: values.beneficiariesMale,
          beneficiariesFemale: values.beneficiariesFemale,
          beneficiariesBoys: values.beneficiariesBoys,
          beneficiariesGirls: values.beneficiariesGirls,
          activityTarget: values.activityTarget ?? 0,
          indicatorTarget: values.indicatorTarget ?? 0,
          hasHqOperations: values.hasHqOperations ?? false,
          // null = leave unconfigured (historical projects); a selected value updates it.
          reportingFrequency: values.reportingFrequency ?? null,
          stateIds: values.stateIds,
          localities: values.localities,
          stateAllocations: values.stateAllocations.filter(a => a.stateId).map(a => ({
            stateId: a.stateId,
            budgetAllocation: a.budgetAllocation,
            beneficiaryTarget: a.beneficiaryTarget,
            beneficiaryMale: a.beneficiaryMale,
            beneficiaryFemale: a.beneficiaryFemale,
            beneficiaryBoys: a.beneficiaryBoys,
            beneficiaryGirls: a.beneficiaryGirls,
            activityTarget: a.activityTarget,
            indicatorTarget: a.indicatorTarget,
            stateLead: a.stateLead,
            notes: a.notes,
          })),
          assignments: values.assignments.filter(a => a.role),
          documents: values.documents,
          outputs: values.outputs.map(out => ({
            title: out.title,
            description: out.description,
            target: out.target,
            indicators: out.indicators,
            activities: out.activities.map(act => ({
              // PRJ-BD-03: include id so backend can preserve budget_spent/progress_pct
              ...(act.id !== undefined && act.id > 0 ? { id: act.id } : {}),
              title: act.title,
              description: act.description,
              budgetPlanned: act.budgetPlanned,
              plannedStart: act.plannedStart,
              plannedEnd: act.plannedEnd,
              target: act.target,
              stateId: act.stateId,
              localityName: act.localityName,
              status: act.status,
              indicatorIndex: act.indicatorIndex,
            })),
          })),
        };
        await patchProject.mutateAsync({ projectId: editProjectId, data: patchPayload });
        if (pendingVoiceNote) {
          try {
            const ext = pendingVoiceNote.mimeType.includes("ogg") ? "ogg" : pendingVoiceNote.mimeType.includes("mp4") ? "m4a" : "webm";
            const fileName = `voice-note-project-${editProjectId}-${Date.now()}.${ext}`;
            const { uploadURL, objectPath } = await requestUploadUrl({ name: fileName, size: pendingVoiceNote.blob.size, contentType: pendingVoiceNote.mimeType });
            await fetch(uploadURL, { method: "PUT", body: pendingVoiceNote.blob, headers: { "Content-Type": pendingVoiceNote.mimeType } });
            await fetch("/api/voice-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ entityType: "project", entityId: editProjectId, fileName, objectPath, contentType: pendingVoiceNote.mimeType, durationSeconds: pendingVoiceNote.durationSeconds }) });
            URL.revokeObjectURL(pendingVoiceNote.blobUrl);
            setPendingVoiceNote(null);
          } catch {
            toast({ title: t("form.toasts.voiceNoteNotSaved"), description: t("form.toasts.voiceNoteNotSavedUpdate"), variant: "destructive" });
          }
        }
        toast({ title: t("form.toasts.draftUpdated"), description: t("form.toasts.draftUpdatedDesc") });
        void projectDraft.clear();
        onClose();
        return;
      }

      // ── Create mode: POST new project ─────────────────────────────────────────
      const newProject = await createProject.mutateAsync({
        data: {
          title: values.title,
          description: values.description,
          classification: values.classification || undefined,
          sectors: values.sectors,
          sector: values.sectors[0],
          subSectors: values.subSectors,
          assistanceModality: values.assistanceModality || undefined,
          donorId: resolvedDonorId,
          donor: resolvedDonorName,
          agreementNumber: values.agreementNumber,
          agreementStart: values.agreementStart || undefined,
          agreementEnd: values.agreementEnd || undefined,
          signedDate: values.signedDate || undefined,
          internalNotes: values.internalNotes || undefined,
          startDate: values.startDate,
          endDate: values.endDate,
          reportingStartDate: values.reportingStartDate,
          reportingEndDate: values.reportingEndDate,
          budgetTotal: values.budgetTotal,
          directCost: values.directCost,
          indirectCost: values.indirectCost,
          cafaContribution: values.cafaContribution,
          currency: values.currency,
          beneficiariesTarget: values.beneficiariesTarget,
          beneficiariesMale: values.beneficiariesMale,
          beneficiariesFemale: values.beneficiariesFemale,
          beneficiariesBoys: values.beneficiariesBoys,
          beneficiariesGirls: values.beneficiariesGirls,
          activityTarget: values.activityTarget ?? 0,
          indicatorTarget: values.indicatorTarget ?? 0,
          ...(({ hasHqOperations: values.hasHqOperations ?? false, reportingFrequency: values.reportingFrequency }) as any),
          stateIds: values.stateIds,
          localities: values.localities,
          stateAllocations: values.stateAllocations.filter(a => a.stateId).map(a => ({
            stateId: a.stateId,
            budgetAllocation: a.budgetAllocation ?? undefined,
            beneficiaryTarget: a.beneficiaryTarget ?? undefined,
            beneficiaryMale: a.beneficiaryMale ?? undefined,
            beneficiaryFemale: a.beneficiaryFemale ?? undefined,
            beneficiaryBoys: a.beneficiaryBoys ?? undefined,
            beneficiaryGirls: a.beneficiaryGirls ?? undefined,
            activityTarget: a.activityTarget ?? undefined,
            indicatorTarget: a.indicatorTarget ?? undefined,
            stateLead: a.stateLead || undefined,
            notes: a.notes || undefined,
          })),
          assignments: values.assignments.filter(a => a.role),
          documents: values.documents,
          outputs: values.outputs.map(out => ({
            title: out.title,
            description: out.description,
            target: out.target,
            indicators: out.indicators,
            activities: out.activities.map((act, _ai) => ({
              title: act.title,
              description: act.description,
              budgetPlanned: act.budgetPlanned,
              plannedStart: act.plannedStart,
              plannedEnd: act.plannedEnd,
              target: act.target,
              stateId: act.stateId,
              localityName: act.localityName,
              status: act.status,
              indicatorIndex: act.indicatorIndex,
            })),
          })),
        },
      });

      // Upload pending voice note if recorded (non-blocking)
      if (pendingVoiceNote && newProject?.id) {
        try {
          const ext = pendingVoiceNote.mimeType.includes("ogg") ? "ogg"
            : pendingVoiceNote.mimeType.includes("mp4") ? "m4a" : "webm";
          const fileName = `voice-note-project-${newProject.id}-${Date.now()}.${ext}`;
          const { uploadURL, objectPath } = await requestUploadUrl({
            name: fileName,
            size: pendingVoiceNote.blob.size,
            contentType: pendingVoiceNote.mimeType,
          });
          await fetch(uploadURL, {
            method: "PUT",
            body: pendingVoiceNote.blob,
            headers: { "Content-Type": pendingVoiceNote.mimeType },
          });
          await fetch("/api/voice-notes", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entityType: "project",
              entityId: newProject.id,
              fileName,
              objectPath,
              contentType: pendingVoiceNote.mimeType,
              durationSeconds: pendingVoiceNote.durationSeconds,
            }),
          });
          URL.revokeObjectURL(pendingVoiceNote.blobUrl);
          setPendingVoiceNote(null);
        } catch {
          toast({ title: t("form.toasts.voiceNoteNotSaved"), description: t("form.toasts.voiceNoteNotSavedCreate"), variant: "destructive" });
        }
      }

      // "listProjects" never matched the generated hook's real query key
      // (["/api/projects", ...]), so the projects list kept showing stale
      // data until a manual reload after creating a project.
      await queryClient.invalidateQueries();
      toast({ title: t("form.toasts.projectRegistered"), description: t("form.toasts.projectRegisteredDesc") });
      void projectDraft.clear();
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not create project";
      toast({ title: t("form.toasts.error"), description: message, variant: "destructive" });
    }
  };

  // ── Error-routing submit handler ──────────────────────────────────────────
  const handleFormSubmit = form.handleSubmit(onSubmit, (errors) => {
    const errKeys = Object.keys(errors);
    for (const tab of TABS) {
      if (TAB_FIELDS[tab.id].some(f => errKeys.includes(f))) {
        setActiveTab(tab.id);
        break;
      }
    }
  });

  const tabsWithErrors = TABS.map(tab => ({
    ...tab,
    hasError: Object.keys(form.formState.errors).some(f => TAB_FIELDS[tab.id].includes(f)),
  }));

  // ── Save As Draft (bypasses validation) ──────────────────────────────────
  const handleSaveAsDraft = async () => {
    if (!stateReference.isReady) {
      form.setError("root" as never, {
        type: "manual",
        message: t("form.location.statesUnavailable"),
      });
      setActiveTab("location");
      return;
    }
    if (isSavingDraft || createProject.isPending || patchProject.isPending) return;
    const values = form.getValues();
    setIsSavingDraft(true);
    try {
      if (!isOnline) {
        await projectDraft.saveNow();
        toast({
          title: commonT("sync.localDraftSaved"),
          description: commonT("sync.projectDraftOperationalOnly"),
        });
        onClose();
        return;
      }
      // Resolve donor name (same logic as onSubmit)
      let resolvedDonorId = values.donorId;
      let resolvedDonorName = values.donor ?? "";
      if (showNewDonor && values.newDonorName?.trim()) {
        const newDonor = await createDonor.mutateAsync({ data: { name: values.newDonorName.trim() } });
        resolvedDonorId = newDonor.id;
        resolvedDonorName = newDonor.name;
      } else if (!resolvedDonorId && !resolvedDonorName) {
        resolvedDonorName = "Unknown";
      }
      if (resolvedDonorId && !resolvedDonorName) {
        const found = donors.find(d => d.id === resolvedDonorId);
        if (found) resolvedDonorName = found.name;
      }

      const draftPayload = {
        title: values.title,
        description: values.description,
        classification: values.classification || undefined,
        sectors: values.sectors,
        sector: values.sectors[0],
        subSectors: values.subSectors,
        assistanceModality: values.assistanceModality || undefined,
        donorId: resolvedDonorId,
        donor: resolvedDonorName,
        agreementNumber: values.agreementNumber,
        agreementStart: values.agreementStart || undefined,
        agreementEnd: values.agreementEnd || undefined,
        signedDate: values.signedDate || undefined,
        internalNotes: values.internalNotes || undefined,
        startDate: values.startDate,
        endDate: values.endDate,
        reportingStartDate: values.reportingStartDate,
        reportingEndDate: values.reportingEndDate,
        budgetTotal: values.budgetTotal,
        directCost: values.directCost,
        indirectCost: values.indirectCost,
        cafaContribution: values.cafaContribution,
        currency: values.currency,
        beneficiariesTarget: values.beneficiariesTarget,
        beneficiariesMale: values.beneficiariesMale,
        beneficiariesFemale: values.beneficiariesFemale,
        beneficiariesBoys: values.beneficiariesBoys,
        beneficiariesGirls: values.beneficiariesGirls,
        activityTarget: values.activityTarget ?? 0,
        indicatorTarget: values.indicatorTarget ?? 0,
        hasHqOperations: values.hasHqOperations ?? false,
        reportingFrequency: editProjectId ? (values.reportingFrequency ?? null) : values.reportingFrequency,
        stateIds: values.stateIds,
        localities: values.localities,
        stateAllocations: values.stateAllocations.filter(a => a.stateId).map(a => ({
          stateId: a.stateId,
          budgetAllocation: a.budgetAllocation ?? undefined,
          beneficiaryTarget: a.beneficiaryTarget ?? undefined,
          beneficiaryMale: a.beneficiaryMale ?? undefined,
          beneficiaryFemale: a.beneficiaryFemale ?? undefined,
          beneficiaryBoys: a.beneficiaryBoys ?? undefined,
          beneficiaryGirls: a.beneficiaryGirls ?? undefined,
          activityTarget: a.activityTarget ?? undefined,
          indicatorTarget: a.indicatorTarget ?? undefined,
          stateLead: a.stateLead || undefined,
          notes: a.notes || undefined,
        })),
        assignments: values.assignments.filter(a => a.role),
        documents: values.documents,
        outputs: values.outputs.map(out => ({
          title: out.title,
          description: out.description,
          target: out.target,
          indicators: out.indicators,
          activities: out.activities.map(act => ({
            // PRJ-BD-03: include id so backend can preserve budget_spent/progress_pct
            ...(act.id !== undefined && act.id > 0 ? { id: act.id } : {}),
            title: act.title,
            description: act.description,
            budgetPlanned: act.budgetPlanned,
            plannedStart: act.plannedStart,
            plannedEnd: act.plannedEnd,
            target: act.target,
            stateId: act.stateId,
            localityName: act.localityName,
            status: act.status,
            indicatorIndex: act.indicatorIndex,
          })),
        })),
      };

      if (editProjectId) {
        await patchProject.mutateAsync({ projectId: editProjectId, data: draftPayload });
        toast({ title: t("form.toasts.draftUpdated"), description: t("form.toasts.draftUpdatedDesc") });
      } else {
        await createProject.mutateAsync({ data: draftPayload });
        toast({ title: t("form.toasts.projectSaved"), description: t("form.toasts.projectSavedDesc") });
      }
      onClose();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Could not save draft";
      toast({ title: t("form.toasts.errorSavingDraft"), description: message, variant: "destructive" });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const isActioning = isSavingDraft || createProject.isPending || patchProject.isPending;

  return (
    <>
    <Form {...form}>
      <form onSubmit={handleFormSubmit} noValidate className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
            <OfflineDraftNotice status={projectDraft.status} error={projectDraft.error} />

            {/* ── Tab navigation bar ── */}
            {/* Step bar: HeroUI Tabs styling on an always-mounted tablist — every
                panel stays in the DOM (hidden) so react-hook-form can focus and
                validate fields on any step. */}
            <div className="tabs mb-6" data-orientation="horizontal">
              <div className="tabs__list-container overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                <nav
                  role="tablist"
                  aria-label={t("form.navAriaLabel")}
                  aria-orientation="horizontal"
                  data-orientation="horizontal"
                  className="tabs__list"
                >
                  {TABS.map((tab, idx) => {
                    const isActive = activeTab === tab.id;
                    const hasError = tabsWithErrors[idx]?.hasError;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        id={`prj-tab-${tab.id}`}
                        aria-selected={isActive}
                        aria-controls={`prj-panel-${tab.id}`}
                        tabIndex={isActive ? 0 : -1}
                        data-selected={isActive || undefined}
                        onClick={() => setActiveTab(tab.id)}
                        onKeyDown={(e) => {
                          // Arrow keys follow the visual order, which flips in RTL.
                          const rtl = document.documentElement.dir === "rtl";
                          const next = rtl ? "ArrowLeft" : "ArrowRight";
                          const prev = rtl ? "ArrowRight" : "ArrowLeft";
                          let target: number | null = null;
                          if (e.key === next) target = Math.min(idx + 1, TABS.length - 1);
                          if (e.key === prev) target = Math.max(idx - 1, 0);
                          if (e.key === "Home") target = 0;
                          if (e.key === "End") target = TABS.length - 1;
                          if (target === null) return;
                          e.preventDefault();
                          setActiveTab(TABS[target].id);
                          document.getElementById(`prj-tab-${TABS[target].id}`)?.focus();
                        }}
                        className="tabs__tab w-auto flex-1 shrink-0 whitespace-nowrap px-2"
                      >
                        {isActive && <span className="tabs__indicator" aria-hidden="true" />}
                        {t(tab.labelKey)}
                        {hasError && (
                          <span
                            className="absolute top-1 end-1.5 h-2 w-2 rounded-full bg-[var(--danger)]"
                            role="img"
                            aria-label={t("form.tabErrorAriaLabel")}
                          />
                        )}
                      </button>
                    );
                  })}
                </nav>
              </div>
            </div>

            {/* ── Panel 1: Basic Information ── */}
            <section id="prj-panel-basic" role="tabpanel" aria-labelledby="prj-tab-basic" hidden={activeTab !== "basic"} className="space-y-4">
              <SectionHeading title={t("form.basic.projectDetailsSection")} />
              <FormField control={control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.basic.title")} <span className="text-destructive">*</span></FormLabel>
                  <FormInput {...field} placeholder={t("form.basic.titlePlaceholder")} />
                  <FieldMessage />
                </FormItem>
              )} />
              <FormField control={control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.basic.description")} <span className="text-destructive">*</span></FormLabel>
                  <FormTextArea {...field} rows={3} className="resize-y" placeholder={t("form.basic.descriptionPlaceholder")} />
                  <FormDescription>{t("form.basic.descriptionHint")}</FormDescription>
                  <FieldMessage />
                </FormItem>
              )} />
              <FormField control={control} name="classification" render={({ field }) => (
                <FormItem>
                  <FormSelect
                    label={t("form.basic.classification")}
                    value={field.value || "__none__"}
                    onChange={(v) => field.onChange(v === "__none__" ? "" : v)}
                    placeholder={t("form.basic.classificationPlaceholder")}
                    options={[
                      { value: "__none__", label: t("form.basic.classificationNone") },
                      ...CLASSIFICATIONS.map(c => ({ value: c, label: t(`form.options.classification.${c}`) })),
                    ]}
                  />
                </FormItem>
              )} />

              {/* Scheduled Reporting Frequency (Task #325) */}
              <FormField control={control} name="reportingFrequency" render={({ field }) => (
                <FormItem className="max-w-xs">
                  <FormSelect
                    label={t("form.reportingFrequency.label")}
                    isRequired={!editProjectId}
                    value={field.value ?? ""}
                    onChange={field.onChange}
                    placeholder={editProjectId ? t("form.reportingFrequency.notConfigured") : t("form.reportingFrequency.placeholder")}
                    data-testid="select-reporting-frequency"
                    options={(["monthly", "quarterly", "annual"] as const).map(f => ({ value: f, label: t(`form.reportingFrequency.${f}`) }))}
                  />
                  <FormDescription>{t("form.reportingFrequency.hint")}</FormDescription>
                  <FieldMessage />
                </FormItem>
              )} />

              <SectionHeading title={t("form.basic.sectorCoverageSection")} />
              {/* Sectors multi-select */}
              <FormField control={control} name="sectors" render={() => (
                <FormItem>
                  <FormLabel>{t("form.basic.sectors")} <span className="text-destructive">*</span></FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border rounded-md">
                    {SECTORS.map(sector => (
                      <CheckItem key={sector} isSelected={sectors.includes(sector)} onChange={() => toggleSector(sector)}>
                        {sector}
                      </CheckItem>
                    ))}
                  </div>
                  <RemovableTags items={sectors} onRemove={toggleSector} aria-label={t("form.basic.sectors")} className="mt-1" />
                  <FieldMessage />
                </FormItem>
              )} />

              {/* Sub-Sectors multi-select — shows sub-sectors from ALL selected sectors */}
              {sectors.length > 0 && (
                <FormField control={control} name="subSectors" render={({ field }) => {
                  // Build grouped available sub-sectors from all selected sectors
                  const grouped = sectors
                    .filter((s): s is keyof typeof SUB_SECTORS => s in SUB_SECTORS)
                    .map(s => ({ sector: s, subs: SUB_SECTORS[s] ?? [] }))
                    .filter(g => g.subs.length > 0);
                  const current: string[] = field.value ?? [];
                  if (grouped.length === 0) return <></>;
                  return (
                    <FormItem>
                      <FormLabel className="text-sm">{t("form.basic.subSectors")} <span className="text-muted-foreground font-normal">{t("form.basic.subSectorsOptional")}</span></FormLabel>
                      <div className="p-3 border rounded-md border-dashed space-y-3">
                        {grouped.map(({ sector, subs }) => (
                          <div key={sector}>
                            {grouped.length > 1 && <p className="text-xs font-medium text-muted-foreground mb-1">{sector}</p>}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-1">
                              {subs.map(sub => (
                                <CheckItem
                                  key={sub}
                                  isSelected={current.includes(sub)}
                                  onChange={() => {
                                    const next = current.includes(sub)
                                      ? current.filter(s => s !== sub)
                                      : [...current, sub];
                                    field.onChange(next);
                                  }}
                                >
                                  {sub}
                                </CheckItem>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      <RemovableTags
                        items={current}
                        onRemove={(s) => field.onChange(current.filter(x => x !== s))}
                        aria-label={t("form.basic.subSectors")}
                        className="mt-1"
                      />
                    </FormItem>
                  );
                }} />
              )}

              {/* Assistance Modality — independent of sector */}
              <FormField control={control} name="assistanceModality" render={({ field }) => (
                <FormItem>
                  <FormSelect
                    label={<>{t("form.basic.assistanceModality")} <span className="text-[var(--muted)] font-normal">{t("form.basic.assistanceModalityOptional")}</span></>}
                    value={field.value ?? "__none__"}
                    onChange={v => field.onChange(v === "__none__" || v === "" ? undefined : v)}
                    placeholder={t("form.basic.assistanceModalityPlaceholder")}
                    options={[
                      { value: "__none__", label: t("form.basic.notSpecified") },
                      ...ASSISTANCE_MODALITIES.map(m => ({ value: m, label: m })),
                    ]}
                  />
                  <FieldMessage />
                </FormItem>
              )} />
            </section>

            {/* ── Panel 2: Location & Coverage ── */}
            <section id="prj-panel-location" role="tabpanel" aria-labelledby="prj-tab-location" hidden={activeTab !== "location"} className="space-y-4">
              <SectionHeading title={t("form.location.operationalLocationsSection")} />
              <FormField control={control} name="stateIds" render={() => (
                <FormItem>
                  <div className="flex items-center gap-3 mb-1">
                    <FormLabel>{t("form.location.operationalLocationsLabel")} <span className="text-destructive">*</span></FormLabel>
                    {!hasHqOpsValue && selectedStateIds.length === 0 && <span className="text-xs text-muted-foreground italic">{t("form.location.selectAtLeastOneState")}</span>}
                    {selectedStateIds.length === 1 && <Chip size="sm" variant="soft" color="accent">{t("form.location.singleState")}</Chip>}
                    {selectedStateIds.length > 1 && <Chip size="sm" variant="soft" color="accent">{t("form.location.multiState", { count: selectedStateIds.length })}</Chip>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{t("form.location.operationalLocationsHint")}</p>
                  {stateReference.status !== "ready" ? (
                    <StateReferenceStatus
                      status={stateReference.status}
                      loadingText={t("form.location.statesLoading")}
                      errorText={t("form.location.statesError")}
                      emptyText={t("form.location.statesEmpty")}
                      retryText={t("form.location.statesRetry")}
                      onRetry={() => { void stateReference.retry(); }}
                    />
                  ) : isStateScopedAuthor ? (
                    <div className="rounded-md border bg-muted/30 p-3">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Lock className="h-4 w-4" aria-hidden="true" />
                        {states.find((state) => state.id === authorisedStateId)
                          ? <StateLabel state={states.find((state) => state.id === authorisedStateId)!} />
                          : t("form.location.statesEmpty")}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{t("form.location.assignedStateLocked")}</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border rounded-md max-h-60 overflow-y-auto">
                      <FormField control={control} name="hasHqOperations" render={({ field }) => (
                        <CheckItem isSelected={!!field.value} onChange={field.onChange} className="col-span-full border-b pb-2 mb-1 font-medium">
                          {t("form.location.hq")}
                        </CheckItem>
                      )} />
                      {states.map(state => (
                        <CheckItem key={state.id} isSelected={selectedStateIds.includes(state.id)} onChange={() => toggleState(state.id)}>
                          <StateLabel state={state} />
                        </CheckItem>
                      ))}
                    </div>
                  )}
                  <FieldMessage />
                </FormItem>
              )} />
              <div className="space-y-2">
                <Label htmlFor="prj-locality-input">{t("form.location.localitiesLabel")}</Label>
                <div className="flex gap-2">
                  <Input id="prj-locality-input" fullWidth value={localityInput} onChange={e => setLocalityInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }} placeholder={t("form.location.localitiesPlaceholder")} />
                  <Button variant="outline" onPress={addLocality}>{t("form.buttons.add")}</Button>
                </div>
                <RemovableTags items={freeLocalities} onRemove={removeLocality} aria-label={t("form.location.localitiesLabel")} className="mt-2" />
              </div>
              <div>
                <SectionHeading title={t("form.location.targetBeneficiaries")} />
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FormField control={control} name="beneficiariesMale" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.adultMen")}</FormLabel><FormInput type="number" min="0" {...field} /></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesFemale" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.adultWomen")}</FormLabel><FormInput type="number" min="0" {...field} /></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesBoys" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.boysUnder18")}</FormLabel><FormInput type="number" min="0" {...field} /></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesGirls" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.girlsUnder18")}</FormLabel><FormInput type="number" min="0" {...field} /></FormItem>
                    )} />
                  </div>
                  <FormField control={control} name="beneficiariesTarget" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.location.totalBeneficiaries")}</FormLabel>
                      <FormInput type="number" min="0" {...field} className="font-semibold" />
                      <FieldMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              {selectedStateIds.length > 0 && (
                <div>
                  <SectionHeading title={t("form.location.stateAllocationSection")} />
                  <p className="text-xs text-muted-foreground mb-2">{t("form.location.stateAllocationHint")}</p>
                  <div className="space-y-2">
                    {selectedStateIds.map((stateId) => {
                      const rowIndex = watchedStateAllocations.findIndex(a => a.stateId === stateId);
                      if (rowIndex === -1) return null;
                      const state = states.find(s => s.id === stateId);
                      return (
                        <div key={stateId} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1fr] gap-2 p-3 border rounded-md items-end">
                          <div className="text-sm font-medium">
                            {state ? <StateLabel state={state} /> : `#${stateId}`}
                          </div>
                          <FormField control={control} name={`stateAllocations.${rowIndex}.budgetAllocation`} render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">{t("form.location.stateAllocationBudget")}</FormLabel>
                              <FormInput type="number" min="0" {...field} value={field.value ?? ""} />
                            </FormItem>
                          )} />
                          <FormField control={control} name={`stateAllocations.${rowIndex}.beneficiaryTarget`} render={({ field }) => (
                            <FormItem>
                              <FormLabel className="text-xs">{t("form.location.stateAllocationBeneficiaries")}</FormLabel>
                              <FormInput type="number" min="0" {...field} value={field.value ?? ""} />
                            </FormItem>
                          )} />
                        </div>
                      );
                    })}
                  </div>
                  {(() => {
                    const allocatedBudget = watchedStateAllocations.reduce((sum, a) => sum + (Number(a.budgetAllocation) || 0), 0);
                    if (allocatedBudget <= 0 || !watchedBudgetTotal) return null;
                    return (
                      <p className={`text-xs mt-2 ${allocatedBudget > watchedBudgetTotal ? "text-destructive font-medium" : "text-muted-foreground"}`}>
                        {t("form.location.stateAllocationAllocated")} {allocatedBudget.toLocaleString()} {t("form.location.stateAllocationOfTotal", { total: watchedBudgetTotal.toLocaleString() })}
                        {allocatedBudget > watchedBudgetTotal && ` — ${t("form.location.stateAllocationExceeds")}`}
                      </p>
                    );
                  })()}
                </div>
              )}
            </section>

            {/* ── Panel 3: Donor & Agreement ── */}
            <section id="prj-panel-donor" role="tabpanel" aria-labelledby="prj-tab-donor" hidden={activeTab !== "donor"} className="space-y-4">
              <SectionHeading title={t("form.donor.donorInfoSection")} />
              {!showNewDonor ? (
                <div className="space-y-2">
                  <FormField control={control} name="donorId" render={({ field }) => (
                    <FormItem>
                      <div className="flex items-end gap-2">
                        <FormSelect
                          label={t("form.donor.donorOrg")}
                          className="min-w-0 flex-1"
                          value={field.value ? String(field.value) : "__none__"}
                          placeholder={t("form.donor.selectDonorPlaceholder")}
                          options={[
                            { value: "__none__", label: t("form.donor.selectDonorNone") },
                            ...donors.map(d => ({ value: String(d.id), label: `${d.name}${d.abbreviation ? ` (${d.abbreviation})` : ""}` })),
                          ]}
                          onChange={(v) => {
                            if (v === "__none__" || v === "") {
                              field.onChange(undefined);
                              form.setValue("donor", "");
                            } else {
                              field.onChange(Number(v));
                              const found = donors.find(d => d.id === Number(v));
                              form.setValue("donor", found?.name ?? "");
                            }
                          }}
                        />
                        <Button
                          variant="outline"
                          onPress={() => { setShowNewDonor(true); field.onChange(undefined); }}
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("form.buttons.new")}
                        </Button>
                      </div>
                    </FormItem>
                  )} />
                  {!donorId && (
                    <FormField control={control} name="donor" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("form.donor.orEnterDonorName")}</FormLabel>
                        <FormInput {...field} placeholder={t("form.donor.donorNamePlaceholder")} />
                      </FormItem>
                    )} />
                  )}
                </div>
              ) : (
                <div className="border border-dashed rounded-md p-3 bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("form.donor.newDonor")}</span>
                    <IconAction label={t("form.donor.cancelNewDonor")} onPress={() => setShowNewDonor(false)}>
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </IconAction>
                  </div>
                  <FormField control={control} name="newDonorName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.donor.newDonorNameLabel")} <span className="text-destructive">*</span></FormLabel>
                      <FormInput {...field} value={field.value ?? ""} placeholder={t("form.donor.newDonorNamePlaceholder")} />
                    </FormItem>
                  )} />
                </div>
              )}

              <SectionHeading title={t("form.donor.agreementDetailsSection")} />
              <FormField control={control} name="agreementNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.donor.agreementNumber")} <span className="text-destructive">*</span></FormLabel>
                  <FormInput {...field} placeholder={t("form.donor.agreementNumberPlaceholder")} />
                  <FieldMessage />
                </FormItem>
              )} />
              {/* Agreement warning: same number but different project title */}
              {!forceCreate && duplicateResult?.matchType === "agreement_warning" && duplicateResult.existingProject && !agreementWarningAck && (
                <Alert status="warning">
                  <Alert.Indicator />
                  <Alert.Content>
                    <Alert.Description>
                      {t("form.donor.agreementExists", { code: duplicateResult.existingProject.code, title: duplicateResult.existingProject.title })}
                    </Alert.Description>
                  </Alert.Content>
                  <Button size="sm" variant="secondary" className="shrink-0" onPress={() => setAgreementWarningAck(true)}>
                    {t("form.buttons.confirm")}
                  </Button>
                </Alert>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={control} name="agreementStart" render={({ field }) => (
                  <FormItem>
                    <FormDate label={t("form.donor.agreementStart")} value={field.value} onChange={field.onChange} />
                  </FormItem>
                )} />
                <FormField control={control} name="agreementEnd" render={({ field }) => (
                  <FormItem>
                    <FormDate label={t("form.donor.agreementEnd")} value={field.value} onChange={field.onChange} />
                  </FormItem>
                )} />
                <FormField control={control} name="signedDate" render={({ field }) => (
                  <FormItem>
                    <FormDate label={t("form.donor.signedDate")} value={field.value} onChange={field.onChange} />
                  </FormItem>
                )} />
              </div>
              <FormField control={control} name="internalNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.donor.internalNotes")}</FormLabel>
                  <FormTextArea {...field} rows={2} placeholder={t("form.donor.internalNotesPlaceholder")} />
                </FormItem>
              )} />
            </section>

            {/* ── Panel 4: Timeline & Budget ── */}
            <section id="prj-panel-timeline" role="tabpanel" aria-labelledby="prj-tab-timeline" hidden={activeTab !== "timeline"} className="space-y-5">
              <div>
                <SectionHeading title={t("form.timeline.implementationPeriod")} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:max-w-sm">
                  <FormField control={control} name="startDate" render={({ field }) => (
                    <FormItem>
                      <FormDate label={t("form.timeline.startDate")} isRequired value={field.value} onChange={field.onChange} />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormDate label={t("form.timeline.endDate")} isRequired value={field.value} onChange={field.onChange} min={projectStart || undefined} />
                      <FieldMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              <div>
                <SectionHeading
                  title={t("form.timeline.reportingConfiguration")}
                  description={t("form.timeline.reportingConfigurationDescription")}
                />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:max-w-sm">
                  <FormField control={control} name="reportingStartDate" render={({ field }) => (
                    <FormItem>
                      <FormDate label={t("form.timeline.reportingStartDate")} isRequired value={field.value} onChange={(value) => {
                        reportingCoverageCustomisedRef.current = true;
                        field.onChange(value);
                      }} />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={control} name="reportingEndDate" render={({ field }) => (
                    <FormItem>
                      <FormDate label={t("form.timeline.reportingEndDate")} isRequired value={field.value} onChange={(value) => {
                        reportingCoverageCustomisedRef.current = true;
                        field.onChange(value);
                      }} />
                      <FieldMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
              <div>
                <SectionHeading title={t("form.timeline.funding")} />
                <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <FormField control={control} name="budgetTotal" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.totalBudget")} <span className="text-destructive">*</span></FormLabel>
                    <FormInput type="number" min="0" step="0.01" {...field} />
                    <FieldMessage />
                  </FormItem>
                )} />
                <FormField control={control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormSelect
                      label={t("form.timeline.currency")}
                      value={field.value ?? ""}
                      onChange={field.onChange}
                      options={CURRENCIES.map(c => ({ value: c, label: c }))}
                    />
                  </FormItem>
                )} />
                <FormField control={control} name="directCost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.directCosts")}</FormLabel>
                    <FormInput type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" />
                  </FormItem>
                )} />
                <FormField control={control} name="indirectCost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.indirectCosts")}</FormLabel>
                    <FormInput type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" />
                  </FormItem>
                )} />
                <FormField control={control} name="cafaContribution" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.cafaContribution")}</FormLabel>
                    <FormInput type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" />
                  </FormItem>
                )} />
              </div>
              {/* Budget Summary */}
              {(() => {
                const total = Number(watch("budgetTotal") || 0);
                const direct = Number(watch("directCost") || 0);
                const indirect = Number(watch("indirectCost") || 0);
                const cafa = Number(watch("cafaContribution") || 0);
                const allocated = direct + indirect + cafa;
                const remaining = total - allocated;
                const currency = watch("currency") || "USD";
                const fmt = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);
                if (total === 0) return null;
                return (
                  <div className="rounded-md border bg-muted/40 p-3 text-sm space-y-1">
                    <p className="font-semibold text-xs text-muted-foreground mb-2">{t("form.timeline.budgetSummaryTitle")}</p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div><span className="text-muted-foreground">{t("form.timeline.budgetTotal")}</span> <span className="font-medium">{fmt(total)}</span></div>
                      <div><span className="text-muted-foreground">{t("form.timeline.budgetDirect")}</span> <span className="font-medium">{fmt(direct)}</span></div>
                      <div><span className="text-muted-foreground">{t("form.timeline.budgetIndirect")}</span> <span className="font-medium">{fmt(indirect)}</span></div>
                      <div><span className="text-muted-foreground">{t("form.timeline.budgetCafa")}</span> <span className="font-medium">{fmt(cafa)}</span></div>
                    </div>
                    <div className={`text-xs font-medium mt-1 ${remaining < 0 ? "text-destructive" : "text-green-600"}`}>
                      {remaining >= 0 ? t("form.timeline.unallocated", { amount: fmt(remaining) }) : t("form.timeline.overBudget", { amount: fmt(Math.abs(remaining)) })}
                    </div>
                  </div>
                );
              })()}
              </div>
              </div>
              <div>
                <SectionHeading title={t("form.timeline.resultsFramework")} description={t("form.timeline.resultsFrameworkDesc")} />
                <div className="space-y-3">
              {outputs.fields.map((out, index) => (
                <OutputSection
                  key={out.id}
                  form={form}
                  outputIndex={index}
                  onRemove={() => outputs.remove(index)}
                  canRemove={outputs.fields.length > 1}
                  projectStart={projectStart}
                  projectEnd={projectEnd}
                  stateIds={selectedStateIds}
                  states={states}
                  freeLocalities={freeLocalities}
                  currency={form.getValues("currency") || "USD"}
                  editMode={!!editProjectId}
                />
              ))}
              <Button
                variant="outline"
                size="sm"
                onPress={() => outputs.append({ title: "", description: "", target: undefined, indicators: [], activities: [] })}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("form.buttons.addOutput")}
              </Button>
                </div>
              </div>
            </section>

            {/* ── Panel 5: Project Team ── */}
            <section id="prj-panel-team" role="tabpanel" aria-labelledby="prj-tab-team" hidden={activeTab !== "team"} className="space-y-3">
              <SectionHeading title={t("form.team.projectTeamSection")} />
              {assignments.fields.map((asgn, idx) => (
                <div key={asgn.id} className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 border rounded-md">
                  <FormField control={control} name={`assignments.${idx}.role`} render={({ field }) => (
                    <FormItem>
                      <FormSelect
                        label={t("form.team.role")}
                        isRequired
                        value={field.value ?? ""}
                        onChange={field.onChange}
                        placeholder={t("form.team.selectRolePlaceholder")}
                        options={PERSONNEL_ROLES.map(r => ({ value: r, label: personnelRoleLabel(t, r) }))}
                      />
                      <FieldMessage />
                    </FormItem>
                  )} />
                  <FormField control={control} name={`assignments.${idx}.userId`} render={({ field }) => (
                    <FormItem>
                      <FormSelect
                        label={t("form.team.systemUser")}
                        value={field.value ? String(field.value) : "__none__"}
                        onChange={(v) => field.onChange(v === "__none__" || v === "" ? undefined : Number(v))}
                        placeholder={t("form.team.selectUserPlaceholder")}
                        options={[
                          { value: "__none__", label: t("form.team.externalPerson") },
                          ...users.map((u) => {
                            const role = tUsers(`roles.${u.role}`, { defaultValue: u.roleLabel ?? u.role });
                            return { value: String(u.id), label: `${u.name} (${role})`, textValue: u.name };
                          }),
                        ]}
                      />
                    </FormItem>
                  )} />
                  <div className="flex items-end gap-2">
                    <FormField control={control} name={`assignments.${idx}.name`} render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>{t("form.team.externalName")}</FormLabel>
                        <FormInput {...field} value={field.value ?? ""} placeholder={t("form.team.externalNamePlaceholder")} className="text-sm" />
                      </FormItem>
                    )} />
                    {assignments.fields.length > 1 && (
                      <IconAction
                        label={t("form.team.removeAssignment", { role: personnelRoleLabel(t, watch(`assignments.${idx}.role`)) || t("form.team.role") })}
                        danger
                        className="mb-0.5"
                        onPress={() => assignments.remove(idx)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </IconAction>
                    )}
                  </div>
                </div>
              ))}
              <Button variant="outline" size="sm" onPress={() => assignments.append({ role: "state_focal_point", name: "", userId: undefined })}>
                <Plus className="h-3.5 w-3.5" aria-hidden="true" /> {t("form.buttons.addPersonnel")}
              </Button>
            </section>

            {/* ── Panel 6: Documents ── */}
            <section id="prj-panel-documents" role="tabpanel" aria-labelledby="prj-tab-documents" hidden={activeTab !== "documents"} className="space-y-4">
              {/* Document gate status messages — shown when not in mutable (draft) mode */}
              {docGate === "operational" && (
                <Alert status="warning" role="note">
                  <Alert.Indicator><Lock className="size-4" aria-hidden="true" /></Alert.Indicator>
                  <Alert.Content><Alert.Description>{t("detail.docs.lockedOperational")}</Alert.Description></Alert.Content>
                </Alert>
              )}
              {docGate === "frozen" && (
                <Alert status="default" role="note">
                  <Alert.Indicator><Lock className="size-4" aria-hidden="true" /></Alert.Indicator>
                  <Alert.Content><Alert.Description>{t("detail.docs.lockedFrozen")}</Alert.Description></Alert.Content>
                </Alert>
              )}
              <SectionHeading title={t("form.documents.projectDocumentsSection")} />
              <p className="text-sm text-muted-foreground">{t("form.documents.requiredNote")}</p>
              <Card data-testid="doc-card" className="border border-[var(--warning)]/40">
                <Card.Header>
                  <Card.Title className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full bg-[var(--warning)]" aria-hidden="true" />
                    {t("form.documents.agreementTitle")}
                    <span className="text-xs font-normal text-[var(--muted)]">{t("form.documents.agreementRequired")}</span>
                  </Card.Title>
                </Card.Header>
                <Card.Content><DocUploadSlot category="agreement" kinds={DOC_AGREEMENT_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></Card.Content>
              </Card>
              <Card data-testid="doc-card" className="border border-[var(--accent)]/30">
                <Card.Header>
                  <Card.Title className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full bg-[var(--accent)]" aria-hidden="true" />
                    {t("form.documents.budgetTitle")}
                    <span className="text-xs font-normal text-[var(--muted)]">{t("form.documents.budgetRequired")}</span>
                  </Card.Title>
                </Card.Header>
                <Card.Content><DocUploadSlot category="budget" kinds={DOC_BUDGET_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></Card.Content>
              </Card>
              <Card data-testid="doc-card">
                <Card.Header>
                  <Card.Title className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="h-2 w-2 rounded-full bg-[var(--muted)]" aria-hidden="true" />
                    {t("form.documents.supportingTitle")}
                    <span className="text-xs font-normal text-[var(--muted)]">{t("form.documents.supportingOptional")}</span>
                  </Card.Title>
                </Card.Header>
                <Card.Content><DocUploadSlot category="optional" kinds={DOC_OPTIONAL_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></Card.Content>
              </Card>
              <div>
                <SectionHeading title={t("form.documents.voiceNoteTitle")} description={t("form.documents.voiceNoteDesc")} />
                <FormVoiceRecorder value={pendingVoiceNote} onChange={setPendingVoiceNote} />
              </div>
            </section>

            {/* ── Panel 7: Review ── */}
            <section id="prj-panel-review" role="tabpanel" aria-labelledby="prj-tab-review" hidden={activeTab !== "review"} className="space-y-4">
              <SectionHeading title={t("form.review.reviewSummarySection")} />
              <div className="rounded-lg border bg-muted/20 p-4 space-y-4 text-sm">
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.basicInfo")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.title")}</dt><dd className="font-medium">{watch("title") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.classification")}</dt><dd>{watch("classification") ? t(`form.options.classification.${watch("classification")}`, { defaultValue: watch("classification") }) : "—"}</dd></div>
                    <div className="md:col-span-2"><dt className="text-xs text-muted-foreground">{t("form.review.sectors")}</dt><dd>{watch("sectors")?.join(", ") || "—"}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.locationCoverage")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.targetStates")}</dt><dd>{selectedStateIds.map(id => states.find(s => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s).map(s => getStateLabel(s, i18n.language)).join("، ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.localities")}</dt><dd>{freeLocalities.join(", ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.totalBeneficiaries")}</dt><dd className="font-medium">{watch("beneficiariesTarget") || "—"}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.donorAgreement")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.donor")}</dt><dd>{watch("donorId") ? (donors.find(d => d.id === watch("donorId"))?.name ?? watch("donor") ?? "—") : (watch("donor") || watch("newDonorName") || "—")}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.agreementNumber")}</dt><dd className="font-mono text-xs">{watch("agreementNumber") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.agreementPeriod")}</dt><dd>{[watch("agreementStart"), watch("agreementEnd")].filter(Boolean).join(" – ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.signedDate")}</dt><dd>{watch("signedDate") || "—"}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.timelineBudget")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.implementationPeriod")}</dt><dd>{[watch("startDate"), watch("endDate")].filter(Boolean).join(" – ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.reportingPeriod")}</dt><dd>{[watch("reportingStartDate"), watch("reportingEndDate")].filter(Boolean).join(" – ") || "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.totalBudget")}</dt><dd className="font-medium">{watch("budgetTotal") ? new Intl.NumberFormat("en-US", { style: "currency", currency: watch("currency") || "USD", maximumFractionDigits: 0 }).format(Number(watch("budgetTotal"))) : "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.outputsDefined")}</dt><dd>{outputs.fields.length}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.projectTeam")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    {assignments.fields.length > 0 ? assignments.fields.map((_, idx) => {
                      const a = watch(`assignments.${idx}`);
                      const roleLabel = personnelRoleLabel(t, a?.role) || "—";
                      const memberName = a?.userId ? (users.find(u => u.id === a.userId)?.name ?? a.name ?? "") : (a?.name ?? "");
                      return <div key={idx}><dt className="text-xs text-muted-foreground">{roleLabel}</dt><dd>{memberName || "—"}</dd></div>;
                    }) : <div><dt className="text-xs text-muted-foreground">{t("form.review.personnel")}</dt><dd>{t("form.review.noneAssigned")}</dd></div>}
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.documentsSection")}</p>
                  <dl><div><dt className="text-xs text-muted-foreground">{t("form.review.uploaded")}</dt><dd>{t("form.review.documentCount", { count: watch("documents")?.length ?? 0 })}</dd></div></dl>
                </div>
              </div>
              {(form.formState.errors as Record<string, { message?: string }>).root?.message && (
                <Alert status="danger">
                  <Alert.Indicator />
                  <Alert.Content><Alert.Description>{(form.formState.errors as Record<string, { message?: string }>).root!.message}</Alert.Description></Alert.Content>
                </Alert>
              )}
            </section>

        </div>
            {/* ── Persistent footer ── */}
            <div className="shrink-0 border-t border-[var(--border)] bg-[var(--overlay)]">
              <div className="px-6 py-3">
                {/* Mobile: stacked (col-reverse keeps primary action at top); Desktop: single row */}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">

                  {/* Left: Cancel */}
                  <Button
                    variant="secondary"
                    onPress={onClose}
                    isDisabled={isActioning}
                    className="w-full sm:w-auto"
                  >
                    {t("form.buttons.cancel")}
                  </Button>

                  {/* Right: Save As Draft | Previous | Continue / Create Project */}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">

                    {/* Save As Draft — always visible, secondary outlined */}
                    <Button
                      variant="outline"
                      isDisabled={!isSavingDraft && (isActioning || !stateReference.isReady)}
                      isPending={isSavingDraft}
                      onPress={handleSaveAsDraft}
                      className="w-full sm:w-auto"
                    >
                      {isSavingDraft && <Spinner size="sm" color="current" />}
                      {isSavingDraft ? t("form.buttons.saving") : t("form.buttons.saveAsDraft")}
                    </Button>

                    {/* Previous — only when not on first tab */}
                    {activeTabIndex > 0 && (
                      <Button
                        variant="ghost"
                        onPress={goToPrevTab}
                        isDisabled={isActioning || !stateReference.isReady}
                        className="w-full sm:w-auto"
                      >
                        {t("form.buttons.previous")}
                      </Button>
                    )}

                    {/* Continue (all tabs except last) or Create Project / Save changes (last tab) */}
                    {activeTabIndex < TABS.length - 1 ? (
                      <Button
                        onPress={goToNextTab}
                        isDisabled={isSavingDraft}
                        className="w-full sm:w-auto"
                      >
                        {t("form.buttons.continue")}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        isDisabled={!(createProject.isPending || patchProject.isPending) && (isActioning || !stateReference.isReady)}
                        isPending={createProject.isPending || patchProject.isPending}
                        className="w-full sm:w-auto"
                      >
                        {(createProject.isPending || patchProject.isPending) && <Spinner size="sm" color="current" />}
                        {(createProject.isPending || patchProject.isPending)
                          ? t("form.buttons.saving")
                          : editProjectId ? t("form.buttons.saveChanges") : t("form.buttons.createProject")}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
      </form>
    </Form>

    {/* ── Duplicate detection modal ── */}
    {showDuplicateModal && duplicateResult?.existingProject && (() => {
      const existing = duplicateResult.existingProject!;
      const newStateNames = selectedStateIds.map(id => states.find(s => s.id === id)?.name ?? "").filter(Boolean);
      const handleMerge = async (kind: "states" | "sectors" | "both") => {
        const existingSectors = existing.sectors.length > 0 ? existing.sectors : (existing.sector ? [existing.sector] : []);
        const addedStateIds = selectedStateIds.filter(id => {
          const name = states.find(s => s.id === id)?.name ?? "";
          return !existing.stateNames.includes(name);
        });
        const addedSectors = sectors.filter(s => !existingSectors.includes(s));
        const addedLocalities = freeLocalities.filter(l => !existing.localities.includes(l));
        const mergePayload = {
          stateIds: kind === "sectors" ? [] : addedStateIds,
          sectors: kind === "states" ? [] : addedSectors,
          localities: addedLocalities,
        };
        try {
          await mergeProject.mutateAsync({ projectId: existing.id, data: mergePayload });
          toast({ title: t("form.toasts.projectUpdated"), description: t("form.toasts.projectUpdatedDesc", { code: existing.code }) });
          queryClient.invalidateQueries();
          setShowDuplicateModal(false);
          onClose();
        } catch {
          toast({ title: t("form.toasts.mergeFailed"), description: t("form.toasts.mergeFailedDesc"), variant: "destructive" });
        }
      };
      return (
        <DuplicateDetectionModal
          open={showDuplicateModal}
          onClose={() => setShowDuplicateModal(false)}
          existing={existing}
          newStateNames={newStateNames}
          newSectors={sectors}
          newLocalities={freeLocalities}
          canMerge={canMerge}
          canCreateAnyway={canCreateAnyway}
          isMerging={mergeProject.isPending}
          onMerge={handleMerge}
          onOpenExisting={() => { setShowDuplicateModal(false); onClose(); setLocation(`/projects/${existing.id}`); }}
          onCreateAnyway={() => { setForceCreate(true); setShowDuplicateModal(false); }}
        />
      );
    })()}
    </>
  );
}

// ── Edit Project Dialog ───────────────────────────────────────────────────────

/**
 * Wide HeroUI modal that hosts the registration form. The form owns its
 * scrolling body and sticky footer, so the dialog itself doesn't pad or scroll.
 */
export function ProjectFormModal({
  isOpen,
  onOpenChange,
  title,
  description,
  children,
}: {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Modal isOpen={isOpen} onOpenChange={onOpenChange}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog className="flex max-h-[90vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-4xl">
            <Modal.CloseTrigger />
            <Modal.Header className="shrink-0 border-b border-[var(--border)] px-6 pt-6 pb-4">
              <Modal.Heading>{title}</Modal.Heading>
              {description && <p className="text-sm text-[var(--muted)]">{description}</p>}
            </Modal.Header>
            <div className="flex min-h-0 flex-1 flex-col">
              {children}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

export function EditProjectDialog({
  projectId,
  open,
  onClose,
}: {
  projectId: number | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("projects");
  if (!projectId) return null;
  return (
    <ProjectFormModal
      isOpen={open}
      onOpenChange={(v) => !v && onClose()}
      title={t("form.editDialog.title")}
      description={t("form.editDialog.description")}
    >
      <ProjectRegistrationForm editProjectId={projectId} onClose={onClose} />
    </ProjectFormModal>
  );
}
