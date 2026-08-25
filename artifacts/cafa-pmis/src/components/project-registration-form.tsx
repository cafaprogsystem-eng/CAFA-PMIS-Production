import { useState, useEffect, useRef } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2, Upload, X, FileText, Plus, Trash2, ChevronDown, ChevronRight, AlertTriangle, GitMerge, AlertCircle, Lock, TriangleAlert,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SECTORS, SUB_SECTORS, ASSISTANCE_MODALITIES } from "@/lib/sectors";
import { cn } from "@/lib/utils";
import { OfflineDraftNotice } from "@/components/offline-draft-notice";
import { useDurableFormDraft } from "@/hooks/use-durable-form-draft";
import { useSyncContext } from "@/contexts/sync-context";

// ── Local helpers ──────────────────────────────────────────────────────────────

/** Consistent section heading used across all 7 tab panels. Visual-only; not exported. */
function SectionHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

// ── Constants ──────────────────────────────────────────────────────────────────

const CURRENCIES = ["USD", "SDG", "EUR", "AED"];

const CLASSIFICATIONS = [
  { value: "emergency", label: "Emergency Response" },
  { value: "recovery", label: "Recovery" },
  { value: "development", label: "Development" },
  { value: "nexus", label: "Humanitarian-Development Nexus" },
];

const ACTIVITY_STATUSES = [
  { value: "planned", label: "Planned" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "on_hold", label: "On Hold" },
];

const PERSONNEL_ROLES = [
  { value: "project_manager", label: "Project Manager" },
  { value: "technical_coordinator", label: "Technical Coordinator" },
  { value: "finance_focal_point", label: "Finance Focal Point" },
  { value: "meal_focal_point", label: "MEAL Focal Point" },
  { value: "state_focal_point", label: "State Focal Point" },
];

const INDICATOR_UNITS = [
  "People Reached",
  "Households Assisted",
  "Facilities Supported",
  "Communities Served",
  "Trainings Conducted",
  "Volunteers Trained",
  "count",
  "%",
];

const DOC_AGREEMENT_KINDS = [
  { value: "pca", label: "Programme Cooperation Agreement (PCA)" },
  { value: "ip_agreement", label: "Implementing Partner Agreement" },
  { value: "grant_agreement", label: "Grant Agreement" },
  { value: "mou", label: "Memorandum of Understanding (MoU)" },
  { value: "contract", label: "Contract" },
  { value: "partnership_agreement", label: "Partnership Agreement" },
];

const DOC_BUDGET_KINDS = [
  { value: "detailed_budget", label: "Detailed Budget" },
  { value: "approved_budget", label: "Approved Budget" },
  { value: "financial_annex", label: "Financial Annex" },
];

const DOC_OPTIONAL_KINDS = [
  { value: "proposal", label: "Project Proposal" },
  { value: "logframe", label: "Logical Framework" },
  { value: "workplan", label: "Work Plan" },
  { value: "donor_communications", label: "Donor Communications" },
  { value: "amendments", label: "Amendments" },
  { value: "technical_annexes", label: "Technical Annexes" },
  { value: "other", label: "Other" },
];

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
  timeline:  ["startDate", "endDate", "budgetTotal", "outputs"],
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
    label: ind.title || `Indicator ${i + 1}`,
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
          className="flex items-start gap-3 text-start flex-1 min-w-0 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0 ms-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={onRemove}
                aria-label={t("form.output.removeOutput")}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t("form.output.removeOutput")}</TooltipContent>
          </Tooltip>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-4 border-t pt-4">
          {/* ── Output fields ── */}
          <div className="grid grid-cols-1 gap-4">
            <FormField control={form.control} name={`outputs.${outputIndex}.title`} render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.output.outputTitle")} <span className="text-destructive">*</span></FormLabel>
                <FormControl><Input {...field} placeholder={t("form.output.outputTitlePlaceholder")} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name={`outputs.${outputIndex}.description`} render={({ field }) => (
              <FormItem>
                <FormLabel>{t("form.output.description")}</FormLabel>
                <FormControl><Textarea {...field} rows={2} placeholder={t("form.output.outputDescPlaceholder")} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="md:w-1/3">
              <FormField control={form.control} name={`outputs.${outputIndex}.target`} render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.output.outputTarget")}</FormLabel>
                  <FormControl><Input type="number" min="0" {...field} value={field.value ?? ""} placeholder={t("form.output.outputTargetPlaceholder")} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
          </div>

          {/* ── Indicators ── */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-semibold">{t("form.output.indicators")}</h4>
                {indicatorCount > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{indicatorCount}</span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => indicators.append({ title: "", unit: "People Reached", target: 0 })}
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
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                        onClick={() => indicators.remove(ii)}
                        aria-label={t("form.output.removeIndicator")}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{t("form.output.removeIndicator")}</TooltipContent>
                  </Tooltip>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.title`} render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("form.output.indicatorName")} <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input {...field} placeholder={t("form.output.indicatorNamePlaceholder")} className="text-sm" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.target`} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.output.target")} <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input type="number" min="0" {...field} className="text-sm" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.unit`} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.output.unit")} <span className="text-destructive">*</span></FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger className="text-sm"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {INDICATOR_UNITS.map(u => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name={`outputs.${outputIndex}.indicators.${ii}.description`} render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>{t("form.output.description")}</FormLabel>
                      <FormControl>
                        <Input {...field} value={field.value ?? ""} placeholder={t("form.output.indicatorDescPlaceholder")} className="text-sm" />
                      </FormControl>
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
                {activityCount > 0 && (
                  <span className="text-xs text-muted-foreground bg-muted rounded-full px-2 py-0.5">{activityCount}</span>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => activities.append({
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
              const actStatusLabel = ACTIVITY_STATUSES.find(s => s.value === watchedAct?.status)?.label ?? "Planned";
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
                      className="flex items-start gap-3 text-start flex-1 min-w-0 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
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
                        <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                          {actStatusLabel}
                        </span>
                      )}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            onClick={() => requestRemoveActivity(ai, { id: act.id, budgetSpent: watchedAct?.budgetSpent, title: watchedAct?.title })}
                            aria-label={t("form.output.removeActivity")}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{t("form.output.removeActivity")}</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>

                  {!isCollapsed && (
                    <div className="px-4 pb-4 space-y-4 border-t pt-4">
                      {/* #487: Read-only recorded expenditure — shown in edit mode for existing activities with spend */}
                      {editMode && watchedAct?.id && (watchedAct.budgetSpent ?? 0) > 0 && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200" aria-live="polite">
                          <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>
                            <span className="font-medium">Recorded Expenditure:</span>{" "}
                            {new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(watchedAct.budgetSpent ?? 0)} {currency}
                            {" "}<span className="text-amber-700 dark:text-amber-300">(read-only — cannot be edited here)</span>
                          </span>
                        </div>
                      )}

                      {/* Group A — Activity identity */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.title`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityName")} <span className="text-destructive">*</span></FormLabel>
                            <FormControl><Input {...field} placeholder={t("form.output.activityNamePlaceholder")} className="text-sm" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.indicatorIndex`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.linkedIndicator")}</FormLabel>
                            <Select
                              value={field.value !== undefined ? String(field.value) : "__none__"}
                              onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v))}
                              disabled={indicatorOptions.length === 0}
                            >
                              <FormControl>
                                <SelectTrigger className="text-sm">
                                  <SelectValue placeholder={indicatorOptions.length === 0 ? t("form.output.noIndicatorsAvailable") : t("form.output.selectIndicator")} />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="__none__">{t("form.output.noIndicatorOption")}</SelectItem>
                                {indicatorOptions.map(opt => (
                                  <SelectItem key={opt.index} value={String(opt.index)}>
                                    <span className="truncate">{opt.label}</span>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {indicatorOptions.length === 0 && (
                              <p className="text-xs text-muted-foreground mt-1">{t("form.output.addIndicatorHint")}</p>
                            )}
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.description`} render={({ field }) => (
                          <FormItem className="md:col-span-2">
                            <FormLabel>{t("form.output.activityDesc")}</FormLabel>
                            <FormControl>
                              <Textarea {...field} value={field.value ?? ""} rows={2} placeholder={t("form.output.activityDescPlaceholder")} className="text-sm" />
                            </FormControl>
                          </FormItem>
                        )} />
                      </div>

                      {/* Group B — Schedule and resources */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.plannedStart`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityStart")} <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input type="date" min={projectStart || undefined} max={projectEnd || undefined} {...field} className="text-sm" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.plannedEnd`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityEnd")} <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input type="date" min={projectStart || undefined} max={projectEnd || undefined} {...field} className="text-sm" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.budgetPlanned`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityBudget")} <span className="text-destructive">*</span></FormLabel>
                            <FormControl><Input type="number" min="0" step="0.01" {...field} className="text-sm" /></FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.target`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityTarget")}</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" {...field} value={field.value ?? ""} placeholder="0" className="text-sm" />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )} />
                      </div>

                      {/* Group C — Implementation assignment */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.status`} render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t("form.output.activityStatus")}</FormLabel>
                            <Select value={field.value} onValueChange={field.onChange}>
                              <FormControl><SelectTrigger className="text-sm"><SelectValue /></SelectTrigger></FormControl>
                              <SelectContent>
                                {ACTIVITY_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </FormItem>
                        )} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.stateId`} render={({ field }) => {
                          const current = field.value ? String(field.value) : "__none__";
                          const opts = stateIds.length > 0
                            ? states.filter((s) => stateIds.includes(s.id))
                            : states;
                          return (
                            <FormItem>
                              <FormLabel>{t("form.output.state")} <span className="text-destructive">*</span></FormLabel>
                              <Select value={current} onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v))}>
                                <FormControl>
                                  <SelectTrigger className="text-sm"><SelectValue placeholder={t("form.output.selectState")} /></SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">{t("form.output.selectStateNone")}</SelectItem>
                                  {opts.map(s => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          );
                        }} />
                        <FormField control={form.control} name={`outputs.${outputIndex}.activities.${ai}.localityName`} render={({ field }) => {
                          const selectedStateId = form.watch(`outputs.${outputIndex}.activities.${ai}.stateId`);
                          const hasState = selectedStateId && Number(selectedStateId) > 0;
                          return (
                            <FormItem>
                              <FormLabel>{t("form.output.locality")} <span className="text-destructive">*</span></FormLabel>
                              <Select
                                value={field.value ?? "__none__"}
                                onValueChange={(v) => field.onChange(v === "__none__" ? undefined : v)}
                                disabled={!hasState}
                              >
                                <FormControl>
                                  <SelectTrigger className="text-sm">
                                    <SelectValue placeholder={!hasState ? t("form.output.selectStateFirst") : freeLocalities.length ? t("form.output.selectLocality") : t("form.output.addLocalitiesFirst")} />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  <SelectItem value="__none__">{t("form.output.selectLocalityNone")}</SelectItem>
                                  {freeLocalities.map((loc) => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <FormMessage />
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
      <AlertDialog
        open={!!pendingRemoveActivity}
        onOpenChange={(open) => { if (!open) setPendingRemoveActivity(null); }}
      >
        <AlertDialogContent
          aria-labelledby="remove-activity-dialog-title"
          aria-describedby="remove-activity-dialog-desc"
        >
          <AlertDialogHeader>
            <AlertDialogTitle id="remove-activity-dialog-title" className="flex items-center gap-2">
              <TriangleAlert className="h-5 w-5 text-destructive shrink-0" aria-hidden="true" />
              Remove Activity With Recorded Expenditure?
            </AlertDialogTitle>
            <AlertDialogDescription id="remove-activity-dialog-desc">
              This activity has recorded expenditure. Removing it from the Project will also remove its stored activity record. Review the expenditure before continuing.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel autoFocus onClick={() => setPendingRemoveActivity(null)}>
              Keep Activity
            </AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (pendingRemoveActivity) {
                  doRemoveActivity(pendingRemoveActivity.ai, pendingRemoveActivity.id);
                  setPendingRemoveActivity(null);
                }
              }}
            >
              Remove Activity
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── Document Upload Slot ───────────────────────────────────────────────────────

interface DocUploadSlotProps {
  category: "agreement" | "budget" | "optional";
  kinds: Array<{ value: string; label: string }>;
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
  const [selectedKind, setSelectedKind] = useState(kinds[0]?.value ?? "other");
  // Override delete dialog state (operational projects, PM/SA only)
  const [overrideDeleteDialog, setOverrideDeleteDialog] = useState<{ docId: number; fileName: string } | null>(null);
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

  const removeDoc = (fileName: string) => {
    const current = form.getValues("documents");
    form.setValue("documents", current.filter(d => d.fileName !== fileName));
  };

  const openOverrideDialog = (docId: number, fileName: string) => {
    setOverrideDeleteDialog({ docId, fileName });
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
      setOverrideReasonError("An override reason is required.");
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
        setOverrideReasonError(data.message ?? "Delete failed. Please try again.");
        return;
      }
      removeDoc(overrideDeleteDialog.fileName);
      toast({ title: "Document deleted", description: `"${overrideDeleteDialog.fileName}" has been removed from the project.` });
      closeOverrideDialog();
    } catch {
      setOverrideReasonError("An unexpected error occurred. Please try again.");
    } finally {
      setIsOverrideDeleting(false);
    }
  };

  return (
    <div className="space-y-2">
      {categoryDocs.length > 0 && (
        <div className="space-y-1">
          {categoryDocs.map((doc) => (
            <div key={doc.id ?? doc.fileName} className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">{doc.fileName}</span>
              <span className="text-xs text-muted-foreground">
                {kinds.find(k => k.value === doc.kind)?.label ?? doc.kind}
              </span>
              {/* Delete button — gated by lifecycle status */}
              {docGate === "mutable" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => removeDoc(doc.fileName)}
                  aria-label={`Remove ${doc.fileName}`}
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </Button>
              )}
              {docGate === "operational" && isOverrideActor && doc.id !== undefined && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0 text-amber-600 hover:text-amber-700"
                      onClick={() => openOverrideDialog(doc.id!, doc.fileName)}
                    >
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete document (override required — will be audited)</TooltipContent>
                </Tooltip>
              )}
              {docGate === "operational" && !isOverrideActor && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="flex h-6 w-6 items-center justify-center text-muted-foreground cursor-default">
                      <Lock className="h-3 w-3" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>Documents cannot be deleted after project approval.</TooltipContent>
                </Tooltip>
              )}
              {/* docGate === "frozen": no delete or lock icon — fully read-only */}
            </div>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Select value={selectedKind} onValueChange={setSelectedKind}>
          <SelectTrigger className="text-sm h-8 flex-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {kinds.map(k => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
          </SelectContent>
        </Select>
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
              type="button"
              variant="outline"
              size="sm"
              isLoading={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              {!uploading && <Upload className="h-3.5 w-3.5" />}
              {uploading ? t("form.buttons.uploading") : t("form.buttons.upload")}
            </Button>
          </>
        ) : (
          <Tooltip>
            <TooltipTrigger asChild>
              <span>
                <Button type="button" variant="outline" size="sm" disabled>
                  <Lock className="h-3.5 w-3.5" />
                  Locked
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>Document uploads are not permitted for closed projects.</TooltipContent>
          </Tooltip>
        )}
      </div>
      {uploadError && (
        <p className="text-xs text-destructive mt-1">{uploadError}</p>
      )}

      {/* Override delete dialog — operational projects, PM/SA only */}
      {overrideDeleteDialog && (
        <Dialog open={!!overrideDeleteDialog} onOpenChange={(open) => { if (!open) closeOverrideDialog(); }}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete Approved Project Document?</DialogTitle>
              <DialogDescription>
                This project has already been approved. Deleting an existing document requires an exceptional override and will be recorded in the audit history.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 py-1">
              <p className="text-sm font-medium">
                Override Reason <span className="text-destructive">*</span>
              </p>
              <Textarea
                value={overrideReason}
                onChange={(e) => {
                  setOverrideReason(e.target.value);
                  if (overrideReasonError) setOverrideReasonError("");
                }}
                placeholder={t("form.documents.overrideReasonPlaceholder")}
                rows={3}
                className="text-sm"
              />
              {overrideReasonError && (
                <p className="text-xs text-destructive">{overrideReasonError}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeOverrideDialog} disabled={isOverrideDeleting}>
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={handleOverrideDelete}
                disabled={isOverrideDeleting}
              >
                {isOverrideDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                Delete Document
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
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

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500 shrink-0" />
            {t("form.duplicate.title")}
          </DialogTitle>
          <DialogDescription>
            {t("form.duplicate.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border bg-muted/30 p-3 space-y-2">
            <p className="font-semibold text-xs text-muted-foreground">{t("form.duplicate.existingProject")}</p>
            <div><span className="text-muted-foreground">{t("form.duplicate.code")} </span><code className="font-mono text-xs"><bdi dir="ltr">{existing.code}</bdi></code></div>
            <div><span className="text-muted-foreground">{t("form.duplicate.title_field")} </span><span className="font-medium">{existing.title}</span></div>
            <div><span className="text-muted-foreground">{t("form.duplicate.agreement")} </span>{existing.agreementNumber ?? "—"}</div>
            <div><span className="text-muted-foreground">{t("form.duplicate.donor")} </span>{existing.donor}</div>
            <div>
              <p className="text-muted-foreground mb-1">{t("form.duplicate.states")}</p>
              <div className="flex flex-wrap gap-1">
                {existing.stateNames.length > 0
                  ? existing.stateNames.map(n => <Badge key={n} variant="outline" className="text-xs">{n}</Badge>)
                  : <span className="italic text-muted-foreground">{t("form.duplicate.none")}</span>}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">{t("form.duplicate.sectors")}</p>
              <div className="flex flex-wrap gap-1">
                {existingSectors.length > 0
                  ? existingSectors.map(s => <Badge key={s} variant="secondary" className="text-xs">{s}</Badge>)
                  : <span className="italic text-muted-foreground">{t("form.duplicate.none")}</span>}
              </div>
            </div>
            {existing.localities.length > 0 && (
              <div><span className="text-muted-foreground">{t("form.duplicate.localities")} </span><span className="text-xs">{existing.localities.slice(0, 5).join(", ")}{existing.localities.length > 5 ? ` ${t("form.duplicate.moreLocalities", { count: existing.localities.length - 5 })}` : ""}</span></div>
            )}
          </div>

          <div className="rounded-md border border-primary/20 bg-primary/5 p-3 space-y-2">
            <p className="font-semibold text-xs text-muted-foreground">{t("form.duplicate.newEntry")}</p>
            <div>
              <p className="text-muted-foreground mb-1">{t("form.duplicate.states")}</p>
              <div className="flex flex-wrap gap-1">
                {newStateNames.length > 0
                  ? newStateNames.map(n => (
                    <Badge key={n} className={`text-xs border ${addedStates.includes(n) ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-100" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                      {n}{addedStates.includes(n) ? t("form.duplicate.newBadge") : t("form.duplicate.existsBadge")}
                    </Badge>
                  ))
                  : <span className="italic text-muted-foreground">{t("form.duplicate.noneSelected")}</span>}
              </div>
            </div>
            <div>
              <p className="text-muted-foreground mb-1">{t("form.duplicate.sectors")}</p>
              <div className="flex flex-wrap gap-1">
                {newSectors.length > 0
                  ? newSectors.map(s => (
                    <Badge key={s} className={`text-xs border ${addedSectors.includes(s) ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-100" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                      {s}{addedSectors.includes(s) ? t("form.duplicate.newBadge") : t("form.duplicate.existsBadge")}
                    </Badge>
                  ))
                  : <span className="italic text-muted-foreground">{t("form.duplicate.noneSelected")}</span>}
              </div>
            </div>
            {newLocalities.length > 0 && (
              <div>
                <p className="text-muted-foreground mb-1">{t("form.duplicate.localities")}</p>
                <div className="flex flex-wrap gap-1">
                  {newLocalities.map(l => (
                    <Badge key={l} className={`text-xs border ${addedLocalities.includes(l) ? "bg-green-100 text-green-800 border-green-300 hover:bg-green-100" : "bg-muted text-muted-foreground hover:bg-muted"}`}>
                      {l}{addedLocalities.includes(l) ? t("form.duplicate.newBadge") : t("form.duplicate.existsBadge")}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-2 pt-1">
          {canMerge ? (
            <>
              {addedStates.length === 0 && addedSectors.length === 0 && addedLocalities.length === 0 && (
                <p className="text-sm text-center text-muted-foreground py-2">{t("form.duplicate.nothingToMerge")}</p>
              )}
              {addedStates.length > 0 && (
                <Button className="w-full" disabled={isMerging} onClick={() => onMerge("states")}>
                  {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                  {t("form.buttons.addStates", { states: addedStates.join(", ") })}
                </Button>
              )}
              {addedSectors.length > 0 && (
                <Button className="w-full" disabled={isMerging} onClick={() => onMerge("sectors")}>
                  {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                  {t("form.buttons.addSectors", { sectors: addedSectors.join(", ") })}
                </Button>
              )}
              {addedStates.length > 0 && addedSectors.length > 0 && (
                <Button className="w-full" variant="secondary" disabled={isMerging} onClick={() => onMerge("both")}>
                  {isMerging ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitMerge className="h-4 w-4" />}
                  {t("form.buttons.addBoth")}
                </Button>
              )}
            </>
          ) : (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              {t("form.duplicate.noMergePermission")}
            </div>
          )}
          <Button className="w-full" variant="outline" onClick={onOpenExisting}>
            {t("form.buttons.openExisting")}
          </Button>
          {canCreateAnyway ? (
            <Button className="w-full" variant="destructive" onClick={onCreateAnyway}>
              {t("form.buttons.createAnyway")}
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground text-center pt-1">
              {t("form.duplicate.noDuplicatePermission")}
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── ProjectRegistrationForm ───────────────────────────────────────────────────

interface Props {
  open?: boolean;
  onClose: () => void;
  editProjectId?: number;
}

export function ProjectRegistrationForm({ open = true, onClose, editProjectId }: Props) {
  const { t } = useTranslation("projects");
  const { t: commonT } = useTranslation("common");
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

  const { data: statesData, isSuccess: statesLoaded } = useListStates();
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
  const { data: editData, isLoading: isEditLoading } = useGetProject(
    editProjectId ?? 0,
    { query: { enabled: !!editProjectId, staleTime: 60_000 } } as Parameters<typeof useGetProject>[1],
  );
  const { data: editStateAllocations } = useListProjectStateAllocations(
    editProjectId ?? 0,
    { query: { enabled: !!editProjectId, staleTime: 60_000 } } as Parameters<typeof useListProjectStateAllocations>[1],
  );
  const editLoadedRef = useRef(false);
  // Guards the duplicate-check debounce while form.reset() is populating edit data.
  const isInitialisingRef = useRef(false);
  const patchProject = usePatchProject();

  const states = statesData ?? [];
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
  const selectedStateIds = watch("stateIds");
  const hasHqOpsValue = watch("hasHqOperations");
  const freeLocalities = watch("localities");
  const sectors = watch("sectors");
  const donorId = watch("donorId");

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

  // ── Reset form with loaded edit data ───────────────────────────────────────
  useEffect(() => {
    if (!editProjectId || editLoadedRef.current) return;
    if (!editData) return;
    const allocs = ((editStateAllocations ?? []) as Array<Record<string, unknown>>);
    const mapped = mapProjectToFormValues(
      editData as Parameters<typeof mapProjectToFormValues>[0],
      allocs,
    );
    // Block duplicate detection while form.reset() fires watchers (700ms debounce
    // + 300ms buffer = 1000ms). Cleared after that window so user changes still work.
    isInitialisingRef.current = true;
    form.reset(mapped);
    editLoadedRef.current = true;
    const t = setTimeout(() => { isInitialisingRef.current = false; }, 1000);
    return () => clearTimeout(t);
  }, [editProjectId, editData, editStateAllocations, form]);

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
  const activeTabIndex = TABS.findIndex(t => t.id === activeTab);
  const goToNextTab = () => setActiveTab(TABS[Math.min(activeTabIndex + 1, TABS.length - 1)].id);
  const goToPrevTab = () => setActiveTab(TABS[Math.max(activeTabIndex - 1, 0)].id);

  if (!open) return null;

  // Show loading skeleton while fetching project for edit
  if (editProjectId && isEditLoading) {
    return (
      <div aria-busy="true" aria-label={t("form.loadingAriaLabel")}>
        <span className="sr-only">{t("form.loadingAriaLabel")}</span>
        {/* Tab nav skeleton */}
        <div className="border-b bg-muted/30 -mx-1 mb-6">
          <div className="flex gap-1 overflow-x-auto py-2">
            {Array.from({ length: 7 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-16 shrink-0 rounded-md" />
            ))}
          </div>
        </div>
        {/* Panel body skeleton */}
        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-32 rounded" />
            <Skeleton className="h-16 w-full rounded-md" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Skeleton className="h-4 w-20 rounded" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-9 w-full rounded-md" />
            </div>
          </div>
        </div>
        {/* Footer skeleton */}
        <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 border-t bg-background z-10">
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-9 w-20 rounded-md" />
              <div className="flex gap-2">
                <Skeleton className="h-9 w-28 rounded-md" />
                <Skeleton className="h-9 w-28 rounded-md" />
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
    const current = form.getValues("stateIds");
    if (current.includes(id)) {
      form.setValue("stateIds", current.filter(s => s !== id), { shouldValidate: true });
    } else {
      form.setValue("stateIds", [...current, id], { shouldValidate: true });
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

      await queryClient.invalidateQueries({ queryKey: ["listProjects"] });
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
      <form onSubmit={handleFormSubmit} noValidate>
            <OfflineDraftNotice status={projectDraft.status} error={projectDraft.error} />

            {/* ── Tab navigation bar ── */}
            <nav
              role="tablist"
              aria-label={t("form.navAriaLabel")}
              className="border-b bg-muted/30 -mx-1 mb-6"
            >
              <div className="flex gap-1 overflow-x-auto py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
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
                      onClick={() => setActiveTab(tab.id)}
                      onKeyDown={(e) => {
                        if (e.key === "ArrowRight") { e.preventDefault(); setActiveTab(TABS[Math.min(idx + 1, TABS.length - 1)].id); }
                        if (e.key === "ArrowLeft")  { e.preventDefault(); setActiveTab(TABS[Math.max(idx - 1, 0)].id); }
                        if (e.key === "Home")       { e.preventDefault(); setActiveTab(TABS[0].id); }
                        if (e.key === "End")        { e.preventDefault(); setActiveTab(TABS[TABS.length - 1].id); }
                      }}
                      className={cn(
                        "relative shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isActive ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted",
                      )}
                    >
                      {t(tab.labelKey)}
                      {hasError && (
                        <span
                          className="absolute -top-0.5 -end-0.5 h-2 w-2 rounded-full bg-destructive border border-background"
                          aria-label={t("form.tabErrorAriaLabel")}
                        />
                      )}
                    </button>
                  );
                })}
              </div>
            </nav>

            {/* ── Panel 1: Basic Information ── */}
            <section id="prj-panel-basic" role="tabpanel" aria-labelledby="prj-tab-basic" hidden={activeTab !== "basic"} className="space-y-4">
              <SectionHeading title={t("form.basic.projectDetailsSection")} />
              <FormField control={control} name="title" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.basic.title")} <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input {...field} placeholder={t("form.basic.titlePlaceholder")} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={control} name="description" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.basic.description")} <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Textarea {...field} rows={3} className="resize-y" placeholder={t("form.basic.descriptionPlaceholder")} /></FormControl>
                  <FormDescription>{t("form.basic.descriptionHint")}</FormDescription>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={control} name="classification" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.basic.classification")}</FormLabel>
                  <Select value={field.value || "__none__"} onValueChange={(v) => field.onChange(v === "__none__" ? "" : v)}>
                    <FormControl><SelectTrigger><SelectValue placeholder={t("form.basic.classificationPlaceholder")} /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="__none__">{t("form.basic.classificationNone")}</SelectItem>
                      {CLASSIFICATIONS.map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </FormItem>
              )} />

              {/* Scheduled Reporting Frequency (Task #325) */}
              <FormField control={control} name="reportingFrequency" render={({ field }) => (
                <FormItem className="max-w-xs">
                  <FormLabel>Scheduled reporting frequency {!editProjectId && <span className="text-destructive" aria-hidden>*</span>}</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ""}>
                    <FormControl>
                      <SelectTrigger aria-required={editProjectId ? undefined : "true"} data-testid="select-reporting-frequency">
                        <SelectValue placeholder={editProjectId ? "Not configured" : "Select frequency"} />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="monthly">{t("form.reportingFrequency.monthly")}</SelectItem>
                      <SelectItem value="quarterly">{t("form.reportingFrequency.quarterly")}</SelectItem>
                      <SelectItem value="annual">{t("form.reportingFrequency.annual")}</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Select the normal reporting schedule for this project.
                    On-Demand reports may still be created separately when required.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )} />

              <SectionHeading title={t("form.basic.sectorCoverageSection")} />
              {/* Sectors multi-select */}
              <FormField control={control} name="sectors" render={() => (
                <FormItem>
                  <FormLabel>{t("form.basic.sectors")} <span className="text-destructive">*</span></FormLabel>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border rounded-md">
                    {SECTORS.map(sector => (
                      <label key={sector} className="flex items-center gap-2 cursor-pointer text-sm hover:text-primary">
                        <Checkbox
                          checked={sectors.includes(sector)}
                          onCheckedChange={() => toggleSector(sector)}
                        />
                        {sector}
                      </label>
                    ))}
                  </div>
                  {sectors.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {sectors.map(s => (
                        <Badge key={s} variant="secondary" className="text-xs gap-1">
                          {s}
                          <button type="button" onClick={() => toggleSector(s)} className="hover:text-destructive">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <FormMessage />
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
                                <label key={sub} className="flex items-center gap-2 cursor-pointer text-sm hover:text-primary">
                                  <Checkbox
                                    checked={current.includes(sub)}
                                    onCheckedChange={() => {
                                      const next = current.includes(sub)
                                        ? current.filter(s => s !== sub)
                                        : [...current, sub];
                                      field.onChange(next);
                                    }}
                                  />
                                  {sub}
                                </label>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                      {current.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {current.map(s => (
                            <Badge key={s} variant="outline" className="text-xs gap-1 border-dashed">
                              {s}
                              <button type="button" onClick={() => field.onChange(current.filter(x => x !== s))} className="hover:text-destructive">
                                <X className="h-2.5 w-2.5" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                      )}
                    </FormItem>
                  );
                }} />
              )}

              {/* Assistance Modality — independent of sector */}
              <FormField control={control} name="assistanceModality" render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-sm">{t("form.basic.assistanceModality")} <span className="text-muted-foreground font-normal">{t("form.basic.assistanceModalityOptional")}</span></FormLabel>
                  <Select value={field.value ?? "__none__"} onValueChange={v => field.onChange(v === "__none__" ? undefined : v)}>
                    <SelectTrigger><SelectValue placeholder={t("form.basic.assistanceModalityPlaceholder")} /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">{t("form.basic.notSpecified")}</SelectItem>
                      {ASSISTANCE_MODALITIES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
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
                    {selectedStateIds.length === 1 && <Badge className="text-xs bg-blue-100 text-blue-800 border-blue-300 hover:bg-blue-100 cursor-default">{t("form.location.singleState")}</Badge>}
                    {selectedStateIds.length > 1 && <Badge className="text-xs bg-violet-100 text-violet-800 border-violet-300 hover:bg-violet-100 cursor-default">{t("form.location.multiState", { count: selectedStateIds.length })}</Badge>}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">Select all locations where this project has operational implementation or reporting responsibility.</p>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2 p-3 border rounded-md max-h-60 overflow-y-auto">
                    {/* HQ checkbox at the top */}
                    <FormField control={control} name="hasHqOperations" render={({ field }) => (
                      <label className="flex items-center gap-2 cursor-pointer text-sm hover:text-primary font-medium col-span-full border-b pb-2 mb-1">
                        <Checkbox checked={!!field.value} onCheckedChange={field.onChange} />
                        HQ
                      </label>
                    )} />
                    {states.map(state => (
                      <label key={state.id} className="flex items-center gap-2 cursor-pointer text-sm hover:text-primary">
                        <Checkbox checked={selectedStateIds.includes(state.id)} onCheckedChange={() => toggleState(state.id)} />
                        <StateLabel state={state} />
                      </label>
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="space-y-2">
                <label className="text-sm font-medium leading-none">{t("form.location.localitiesLabel")}</label>
                <div className="flex gap-2">
                  <Input value={localityInput} onChange={e => setLocalityInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addLocality(); } }} placeholder={t("form.location.localitiesPlaceholder")} />
                  <Button type="button" variant="outline" onClick={addLocality}>{t("form.buttons.add")}</Button>
                </div>
                {freeLocalities.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-2">
                    {freeLocalities.map(loc => (
                      <Badge key={loc} variant="secondary" className="text-xs gap-1">
                        {loc}
                        <button type="button" onClick={() => removeLocality(loc)} className="hover:text-destructive"><X className="h-2.5 w-2.5" /></button>
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <SectionHeading title={t("form.location.targetBeneficiaries")} />
                <div className="space-y-3">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <FormField control={control} name="beneficiariesMale" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.adultMen")}</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesFemale" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.adultWomen")}</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesBoys" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.boysUnder18")}</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl></FormItem>
                    )} />
                    <FormField control={control} name="beneficiariesGirls" render={({ field }) => (
                      <FormItem><FormLabel>{t("form.location.girlsUnder18")}</FormLabel><FormControl><Input type="number" min="0" {...field} /></FormControl></FormItem>
                    )} />
                  </div>
                  <FormField control={control} name="beneficiariesTarget" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.location.totalBeneficiaries")}</FormLabel>
                      <FormControl><Input type="number" min="0" {...field} className="font-semibold" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </div>
              </div>
            </section>

            {/* ── Panel 3: Donor & Agreement ── */}
            <section id="prj-panel-donor" role="tabpanel" aria-labelledby="prj-tab-donor" hidden={activeTab !== "donor"} className="space-y-4">
              <SectionHeading title={t("form.donor.donorInfoSection")} />
              {!showNewDonor ? (
                <div className="space-y-2">
                  <FormField control={control} name="donorId" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.donor.donorOrg")}</FormLabel>
                      <div className="flex gap-2">
                        <Select
                          value={field.value ? String(field.value) : "__none__"}
                          onValueChange={(v) => {
                            if (v === "__none__") {
                              field.onChange(undefined);
                              form.setValue("donor", "");
                            } else {
                              field.onChange(Number(v));
                              const found = donors.find(d => d.id === Number(v));
                              form.setValue("donor", found?.name ?? "");
                            }
                          }}
                        >
                          <FormControl><SelectTrigger><SelectValue placeholder={t("form.donor.selectDonorPlaceholder")} /></SelectTrigger></FormControl>
                          <SelectContent>
                            <SelectItem value="__none__">{t("form.donor.selectDonorNone")}</SelectItem>
                            {donors.map(d => (
                              <SelectItem key={d.id} value={String(d.id)}>
                                {d.name}{d.abbreviation ? ` (${d.abbreviation})` : ""}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => { setShowNewDonor(true); field.onChange(undefined); }}
                        >
                          <Plus className="h-3.5 w-3.5" /> {t("form.buttons.new")}
                        </Button>
                      </div>
                    </FormItem>
                  )} />
                  {!donorId && (
                    <FormField control={control} name="donor" render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t("form.donor.orEnterDonorName")}</FormLabel>
                        <FormControl><Input {...field} placeholder={t("form.donor.donorNamePlaceholder")} /></FormControl>
                      </FormItem>
                    )} />
                  )}
                </div>
              ) : (
                <div className="border border-dashed rounded-md p-3 bg-muted/30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">{t("form.donor.newDonor")}</span>
                    <Button type="button" variant="ghost" size="sm" onClick={() => setShowNewDonor(false)}>
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <FormField control={control} name="newDonorName" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.donor.newDonorNameLabel")} <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input {...field} value={field.value ?? ""} placeholder={t("form.donor.newDonorNamePlaceholder")} /></FormControl>
                    </FormItem>
                  )} />
                </div>
              )}

              <SectionHeading title={t("form.donor.agreementDetailsSection")} />
              <FormField control={control} name="agreementNumber" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.donor.agreementNumber")} <span className="text-destructive">*</span></FormLabel>
                  <FormControl><Input {...field} placeholder={t("form.donor.agreementNumberPlaceholder")} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              {/* Agreement warning: same number but different project title */}
              {!forceCreate && duplicateResult?.matchType === "agreement_warning" && duplicateResult.existingProject && !agreementWarningAck && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 flex items-start justify-between gap-2">
                  <div className="flex items-start gap-2 text-sm text-amber-800">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>
                      Agreement Number already exists under another project (<code className="font-mono">{duplicateResult.existingProject.code}</code>
                      {" "}— <em>{duplicateResult.existingProject.title}</em>). Confirm this is a separate project before continuing.
                    </span>
                  </div>
                  <Button type="button" variant="ghost" size="sm" className="text-amber-800 hover:bg-amber-100 shrink-0" onClick={() => setAgreementWarningAck(true)}>
                    {t("form.buttons.confirm")}
                  </Button>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField control={control} name="agreementStart" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.donor.agreementStart")}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={control} name="agreementEnd" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.donor.agreementEnd")}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={control} name="signedDate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.donor.signedDate")}</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={control} name="internalNotes" render={({ field }) => (
                <FormItem>
                  <FormLabel>{t("form.donor.internalNotes")}</FormLabel>
                  <FormControl><Textarea {...field} rows={2} placeholder={t("form.donor.internalNotesPlaceholder")} /></FormControl>
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
                      <FormLabel>{t("form.timeline.startDate")} <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input type="date" {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={control} name="endDate" render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.timeline.endDate")} <span className="text-destructive">*</span></FormLabel>
                      <FormControl><Input type="date" min={projectStart || undefined} {...field} /></FormControl>
                      <FormMessage />
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
                    <FormControl><Input type="number" min="0" step="0.01" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={control} name="currency" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.currency")}</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={control} name="directCost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.directCosts")}</FormLabel>
                    <FormControl><Input type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={control} name="indirectCost" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.indirectCosts")}</FormLabel>
                    <FormControl><Input type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={control} name="cafaContribution" render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t("form.timeline.cafaContribution")}</FormLabel>
                    <FormControl><Input type="number" min="0" step="0.01" {...field} value={field.value ?? ""} placeholder="0" /></FormControl>
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
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => outputs.append({ title: "", description: "", target: undefined, indicators: [], activities: [] })}
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
                      <FormLabel>{t("form.team.role")} <span className="text-destructive">*</span></FormLabel>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <FormControl><SelectTrigger className="text-sm"><SelectValue placeholder={t("form.team.selectRolePlaceholder")} /></SelectTrigger></FormControl>
                        <SelectContent>
                          {PERSONNEL_ROLES.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={control} name={`assignments.${idx}.userId`} render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t("form.team.systemUser")}</FormLabel>
                      <Select
                        value={field.value ? String(field.value) : "__none__"}
                        onValueChange={(v) => field.onChange(v === "__none__" ? undefined : Number(v))}
                      >
                        <FormControl><SelectTrigger className="text-sm"><SelectValue placeholder={t("form.team.selectUserPlaceholder")} /></SelectTrigger></FormControl>
                        <SelectContent>
                          <SelectItem value="__none__">{t("form.team.externalPerson")}</SelectItem>
                          {users.map((u) => (
                            <SelectItem key={u.id} value={String(u.id)}>{u.name} ({u.role})</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )} />
                  <div className="flex gap-2">
                    <FormField control={control} name={`assignments.${idx}.name`} render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>{t("form.team.externalName")}</FormLabel>
                        <FormControl><Input {...field} value={field.value ?? ""} placeholder={t("form.team.externalNamePlaceholder")} className="text-sm" /></FormControl>
                      </FormItem>
                    )} />
                    {assignments.fields.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="self-end"
                        aria-label={`Remove ${PERSONNEL_ROLES.find(r => r.value === watch(`assignments.${idx}.role`))?.label ?? "team"} assignment`}
                        onClick={() => assignments.remove(idx)}
                      >
                        <Trash2 className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => assignments.append({ role: "state_focal_point", name: "", userId: undefined })}>
                <Plus className="h-3.5 w-3.5" /> {t("form.buttons.addPersonnel")}
              </Button>
            </section>

            {/* ── Panel 6: Documents ── */}
            <section id="prj-panel-documents" role="tabpanel" aria-labelledby="prj-tab-documents" hidden={activeTab !== "documents"} className="space-y-4">
              {/* Document gate status messages — shown when not in mutable (draft) mode */}
              {docGate === "operational" && (
                <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm text-amber-800 dark:text-amber-200" role="note">
                  <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Documents are locked — you may upload supporting files but cannot delete existing documents without an override.</span>
                </div>
              )}
              {docGate === "frozen" && (
                <div className="flex items-start gap-2 rounded-md border border-muted-foreground/30 bg-muted px-4 py-3 text-sm text-muted-foreground" role="note">
                  <Lock className="h-4 w-4 mt-0.5 shrink-0" aria-hidden="true" />
                  <span>Documents are locked because this Project is completed.</span>
                </div>
              )}
              <SectionHeading title={t("form.documents.projectDocumentsSection")} />
              <p className="text-sm text-muted-foreground">{t("form.documents.requiredNote")}</p>
              <Card className="border-orange-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-orange-400" />
                    {t("form.documents.agreementTitle")}
                    <span className="text-xs font-normal text-muted-foreground">{t("form.documents.agreementRequired")}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><DocUploadSlot category="agreement" kinds={DOC_AGREEMENT_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></CardContent>
              </Card>
              <Card className="border-blue-200">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-blue-400" />
                    {t("form.documents.budgetTitle")}
                    <span className="text-xs font-normal text-muted-foreground">{t("form.documents.budgetRequired")}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><DocUploadSlot category="budget" kinds={DOC_BUDGET_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-muted-foreground" />
                    {t("form.documents.supportingTitle")}
                    <span className="text-xs font-normal text-muted-foreground">{t("form.documents.supportingOptional")}</span>
                  </CardTitle>
                </CardHeader>
                <CardContent><DocUploadSlot category="optional" kinds={DOC_OPTIONAL_KINDS} form={form} docGate={docGate} userRole={userRole} projectId={editProjectId} /></CardContent>
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
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.classification")}</dt><dd>{CLASSIFICATIONS.find(c => c.value === watch("classification"))?.label || "—"}</dd></div>
                    <div className="md:col-span-2"><dt className="text-xs text-muted-foreground">{t("form.review.sectors")}</dt><dd>{watch("sectors")?.join(", ") || "—"}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.locationCoverage")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.targetStates")}</dt><dd>{selectedStateIds.map(id => states.find(s => s.id === id)?.name).filter(Boolean).join(", ") || "—"}</dd></div>
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
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.totalBudget")}</dt><dd className="font-medium">{watch("budgetTotal") ? new Intl.NumberFormat("en-US", { style: "currency", currency: watch("currency") || "USD", maximumFractionDigits: 0 }).format(Number(watch("budgetTotal"))) : "—"}</dd></div>
                    <div><dt className="text-xs text-muted-foreground">{t("form.review.outputsDefined")}</dt><dd>{outputs.fields.length}</dd></div>
                  </dl>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 pb-1.5 border-b">{t("form.review.projectTeam")}</p>
                  <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
                    {assignments.fields.length > 0 ? assignments.fields.map((_, idx) => {
                      const a = watch(`assignments.${idx}`);
                      const roleLabel = PERSONNEL_ROLES.find(r => r.value === a?.role)?.label ?? a?.role ?? "—";
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
                <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{(form.formState.errors as Record<string, { message?: string }>).root!.message}</span>
                </div>
              )}
            </section>

            {/* ── Persistent footer ── */}
            <div className="sticky bottom-0 -mx-6 -mb-6 mt-6 border-t border-border bg-background z-10">
              <div className="px-6 py-3">
                {/* Mobile: stacked (col-reverse keeps primary action at top); Desktop: single row */}
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">

                  {/* Left: Cancel */}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={onClose}
                    disabled={isActioning}
                    className="w-full sm:w-auto"
                  >
                    {t("form.buttons.cancel")}
                  </Button>

                  {/* Right: Save As Draft | Previous | Continue / Create Project */}
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">

                    {/* Save As Draft — always visible, secondary outlined */}
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isActioning}
                      aria-busy={isSavingDraft}
                      onClick={handleSaveAsDraft}
                      className="w-full sm:w-auto"
                    >
                      {isSavingDraft ? (
                        <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><span className="sr-only">Saving…</span>{t("form.buttons.saving")}</>
                      ) : (
                        t("form.buttons.saveAsDraft")
                      )}
                    </Button>

                    {/* Previous — only when not on first tab */}
                    {activeTabIndex > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={goToPrevTab}
                        disabled={isActioning}
                        className="w-full sm:w-auto"
                      >
                        {t("form.buttons.previous")}
                      </Button>
                    )}

                    {/* Continue (all tabs except last) or Create Project / Save changes (last tab) */}
                    {activeTabIndex < TABS.length - 1 ? (
                      <Button
                        type="button"
                        onClick={goToNextTab}
                        disabled={isSavingDraft}
                        className="w-full sm:w-auto"
                      >
                        {t("form.buttons.continue")}
                      </Button>
                    ) : (
                      <Button
                        type="submit"
                        disabled={isActioning}
                        aria-busy={createProject.isPending || patchProject.isPending}
                        className="w-full sm:w-auto"
                      >
                        {(createProject.isPending || patchProject.isPending) ? (
                          <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /><span className="sr-only">Saving…</span>{t("form.buttons.saving")}</>
                        ) : editProjectId ? (
                          t("form.buttons.saveChanges")
                        ) : (
                          t("form.buttons.createProject")
                        )}
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
      const newStateNames = selectedStateIds.map(id => statesData?.find(s => s.id === id)?.name ?? "").filter(Boolean);
      const handleMerge = async (kind: "states" | "sectors" | "both") => {
        const existingSectors = existing.sectors.length > 0 ? existing.sectors : (existing.sector ? [existing.sector] : []);
        const addedStateIds = selectedStateIds.filter(id => {
          const name = statesData?.find(s => s.id === id)?.name ?? "";
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
          queryClient.invalidateQueries({ queryKey: ["listProjects"] });
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
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] p-0 gap-0 flex flex-col overflow-hidden">
        <div className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogHeader>
            <DialogTitle>{t("form.editDialog.title")}</DialogTitle>
            <DialogDescription>
              {t("form.editDialog.description")}
            </DialogDescription>
          </DialogHeader>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-6">
          <ProjectRegistrationForm editProjectId={projectId} onClose={onClose} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
