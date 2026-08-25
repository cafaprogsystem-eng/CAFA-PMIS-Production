import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocationContext } from "@/contexts/location-context";
import {
  validateActivityForSubmission,
  validateActivityBasicInfo,
  validateActivityImplementation,
  validateActivityResults,
  validateActivityChallenges,
  validateActivityLessons,
  type ActivityValidationContext,
  type ActivityFormValues,
} from "@/lib/activityReportValidation";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
import { useForm } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  useListReports,
  useListReportAuthors,
  useListProjects,
  useListStates,
  useCreateReport,
  useTransitionReport,
  useGetMe,
  useGetReportAggregates,
  useGetReportsSummary,
  useGetReportsStats,
  type ListReportsQueryResult,
  type ListRisksQueryResult,
  type ExportReportsParams,
} from "@workspace/api-client-react";
import { TransitionReportBody } from "@workspace/api-zod";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  FileText, Plus, CheckCircle2, XCircle, ArrowRight, RotateCcw,
  Users, DollarSign, Target, AlertTriangle, Clock, Archive, Info, Trash2,
  Download, Building2, MapPin, FolderKanban, Send, TrendingUp, TrendingDown, Minus,
  AlertCircle, Paperclip, Filter, X, MoreHorizontal, Pencil, Copy, ChevronRight,
  Lock, Loader2, ChevronLeft, PlusCircle,
} from "lucide-react";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorState } from "@/components/ui/error-state";
import { Separator } from "@/components/ui/separator";
import { formatDate, formatDateTime, formatCurrency, hasPerm, statusBadgeVariant, formatStatusLabel, severityBadgeVariant, formatLocation } from "@/lib/format";
import { getLinkedStateLabel } from "@/components/state-label";
import { LocationSelector } from "@/components/location-selector";
import { getGeographicScope, canAuthorHqSectorReport, canAuthorProgramStateReport, hasFullOperationalAccess } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { FormVoiceRecorder, type PendingNote } from "@/components/form-voice-recorder";
import { VoiceNotePanel } from "@/components/voice-note-panel";
import { ProgramStateReportForm, ProgramStateSectionsView } from "@/components/program-state-report-form";
import { HqSectorReportForm, HqSectorSectionsView } from "@/components/hq-sector-report-form";
import { CommentsPanel, useUnresolvedRequiredCorrections } from "@/components/comments-panel";
import { SECTORS } from "@/lib/sectors";
import { SPR_SECTION_KEYS, SPR_SECTION_LABELS } from "@/lib/spr-sections";
import { useViewMode } from "@/lib/view-modes";
import { ViewModeSwitcher } from "@/components/view-modes/view-mode-switcher";
import { CardGrid } from "@/components/view-modes/card-grid";
import { ListView } from "@/components/view-modes/list-view";
import { CompactView } from "@/components/view-modes/compact-view";
import { KanbanBoard } from "@/components/view-modes/kanban-board";
import type { ViewRecord } from "@/lib/view-modes";
import type { KanbanColumn } from "@/components/view-modes/kanban-board";
import { ActivityReportViewer } from "@/components/activity-report-viewer";
import { RecordDetailModal } from "@/components/record-detail-modal";
import { ContinueEditingAction } from "@/components/continue-editing-action";
import {
  OfflineReportDraftStatus,
  reportDraftKey,
  useOfflineReportDraft,
  useOfflineReportDrafts,
} from "@/lib/offline/report-drafts";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";
import { useSyncContext } from "@/contexts/sync-context";

type Report = NonNullable<ListReportsQueryResult>["items"][number];
type ReportHistoryItem = NonNullable<Report["approvalHistory"]>[number];

/**
 * Mirrors the existing client-side draft entry rule. The API remains the final
 * authority; this only prevents offering an editor entry point to a user who
 * cannot plausibly resume that draft. State Programme fallback authors have a
 * deliberately narrow, own-draft exception.
 */
export function canResumeReportDraft(
  report: Report,
  permissions: string[] | undefined,
  currentUser: { id?: number; role?: string; stateId?: number | null } | undefined,
): boolean {
  if (report.status !== "draft") return false;

  const record = report as unknown as { authorId?: number | null; stateId?: number | null };
  const isOwnDraft = record.authorId !== null
    && record.authorId !== undefined
    && record.authorId === currentUser?.id;

  // The State Office Manager fallback has a deliberately narrow server-side
  // exception: only its own State Programme draft in its current state.
  if (currentUser?.role === "state_office_manager") {
    return report.reportType === "program_state"
      && isOwnDraft
      && record.stateId !== null
      && record.stateId !== undefined
      && record.stateId === currentUser.stateId
      && (hasPerm(permissions, "reports.update")
        || hasPerm(permissions, "reports.program_state.create"));
  }

  // All other authors need the ordinary draft-update capability. PM and
  // super-admin retain their server-defined Full Operational Access override;
  // everyone else may only resume their own draft.
  return hasPerm(permissions, "reports.update")
    && (hasFullOperationalAccess(currentUser) || isOwnDraft);
}

/** Kept in sync with REPORT_EXPORT_MAX_ROWS in api-server/src/routes/reports.ts */
const REPORT_EXPORT_MAX_ROWS = 5_000;

const ACTIVITY_STATUS = ["Planned", "In Progress", "Completed", "Delayed", "Cancelled"] as const;

// ── Workflow display types ───────────────────────────────────────────────────
// "chain"  — single approval path; abbrs are shown inline; roles exposed via <abbr title>.
// "dual"   — two author-based paths (Project / Activity reports only).
type WorkflowChain = { kind: "chain"; abbrs: string[]; roles: string[] };
type WorkflowDual  = { kind: "dual";  paths: Array<{ label: string; labelKey: string; abbrs: string[]; roles: string[] }> };
type WorkflowDisplay = WorkflowChain | WorkflowDual;

// Shared dual-path definition for Project and Activity reports (identical routing).
const DUAL_WORKFLOW: WorkflowDual = {
  kind: "dual",
  paths: [
    {
      label: "State-authored",
      labelKey: "approval.stateAuthored",
      abbrs: ["SPO", "TC", "SPC", "PM"],
      roles: ["State Programme Officer", "Technical Coordinator", "Senior Programme Coordinator", "Programme Manager"],
    },
    {
      label: "Technical-authored",
      labelKey: "approval.technicalAuthored",
      abbrs: ["TC", "SPC", "PM"],
      roles: ["Technical Coordinator", "Senior Programme Coordinator", "Programme Manager"],
    },
  ],
};

const TYPE_META: Record<string, {
  label: string;
  labelKey: string;
  short: string;
  shortKey: string;
  icon: typeof FileText;
  description: string;
  descriptionKey: string;
  workflow: WorkflowDisplay;
}> = {
  project: {
    label: "Project Reports",
    labelKey: "typesPlural.project",
    short: "Project",
    shortKey: "typeMeta.projectShort",
    icon: FolderKanban,
    description: "Per-project narrative reports covering implementation progress, results, challenges and key actions.",
    descriptionKey: "typeMeta.projectDescription",
    workflow: DUAL_WORKFLOW,
  },
  activity: {
    label: "Activity Reports",
    labelKey: "typesPlural.activity",
    short: "Activity",
    shortKey: "typeMeta.activityShort",
    icon: Target,
    description: "Activity-level reports covering implementation progress, results, beneficiary reach, expenditure and key actions.",
    descriptionKey: "typeMeta.activityDescription",
    workflow: DUAL_WORKFLOW,
  },
  program_state: {
    label: "State Programme Reports",
    labelKey: "typesPlural.program_state",
    short: "State Programme",
    shortKey: "typeMeta.programStateShort",
    icon: MapPin,
    description: "State-level implementation reports covering activities and projects within the assigned State.",
    descriptionKey: "typeMeta.programStateDescription",
    workflow: {
      kind: "chain",
      abbrs: ["SPO", "SPC", "PM"],
      roles: ["State Programme Officer", "Senior Programme Coordinator", "Programme Manager"],
    },
  },
  hq_sector: {
    label: "HQ Sector Reports",
    labelKey: "typesPlural.hq_sector",
    short: "HQ Sector",
    shortKey: "typeMeta.hqSectorShort",
    icon: Building2,
    description: "Sector-level reports prepared by Technical Coordinators across projects in an assigned Main Sector.",
    descriptionKey: "typeMeta.hqSectorDescription",
    workflow: {
      kind: "chain",
      abbrs: ["TC", "SPC", "PM"],
      roles: ["Technical Coordinator", "Senior Programme Coordinator", "Programme Manager"],
    },
  },
};

// ── WorkflowBlock helpers ─────────────────────────────────────────────────────
// WorkflowChainRow is defined at module scope (not inside a parent component) to
// satisfy the react/no-unstable-nested-components rule and avoid remounting on render.
function WorkflowChainRow({ abbrs, roles }: { abbrs: string[]; roles: string[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {abbrs.map((abbr, i) => (
        <span key={`${abbr}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 rtl:rotate-180" aria-hidden />}
          <abbr
            title={roles[i]}
            aria-label={roles[i]}
            className="text-xs font-medium text-foreground/80 no-underline cursor-help"
          >
            {abbr}
          </abbr>
        </span>
      ))}
    </div>
  );
}

// ── WorkflowBlock ─────────────────────────────────────────────────────────────
// Renders approval path(s) for a report-type card.
// Abbreviations (SPO, TC, SPC, PM) carry accessible full-role names via <abbr title>.
function WorkflowBlock({ workflow }: { workflow: WorkflowDisplay }) {
  const { t } = useTranslation("reports");
  if (workflow.kind === "dual") {
    return (
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
          {t("approval.approvalPaths")}
        </p>
        {workflow.paths.map((path) => (
          <div key={path.label}>
            <p className="text-[10px] text-muted-foreground/60 mb-0.5">{t(path.labelKey)}</p>
            <WorkflowChainRow abbrs={path.abbrs} roles={path.roles} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
        {t("approval.approvalPath")}
      </p>
      <WorkflowChainRow abbrs={workflow.abbrs} roles={workflow.roles} />
    </div>
  );
}

// Display status options (user-facing) → backend statuses they map to.
const STATUS_GROUPS: Record<string, string[]> = {
  draft: ["draft"],
  submitted: ["submitted"],
  state_reviewed: ["state_reviewed"],
  technically_approved: ["technically_approved"],
  coordination_approved: ["coordination_approved"],
  returned: ["returned"],
  approved: ["approved"],
  rejected: ["rejected"],
  archived: ["archived"],
};

function displayStatus(backend: string, translate?: (key: string) => string): string {
  const MAP: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    state_reviewed: "State Reviewed",
    technically_approved: "Technically Approved",
    coordination_approved: "Coordination Approved",
    returned: "Returned",
    approved: "Approved",
    rejected: "Rejected",
    archived: "Archived",
  };
  if (!translate) return MAP[backend] ?? backend;
  const key = `status.${backend}`;
  const localized = translate(key);
  return localized === key ? (MAP[backend] ?? backend) : localized;
}

function displayFrequency(kind: string | null | undefined, translate?: (key: string) => string): string {
  if (!kind) return "—";
  const MAP: Record<string, string> = {
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
    on_demand: "On-Demand",
  };
  if (!translate) return MAP[kind] ?? kind;
  const key = `frequency.${kind}`;
  const localized = translate(key);
  return localized === key ? (MAP[kind] ?? kind) : localized;
}

/**
 * Format a raw reporting period string into a human-readable label that includes
 * the frequency context.  This is display-only — the stored period value is never
 * mutated.
 *
 * Examples:
 *   monthly   "2026-06"   → "Monthly · Jun 2026"
 *   quarterly "2025-Q2"   → "Quarterly · Q2 2025"
 *   annual    "2024"      → "Annual · 2024"
 *   on_demand "2026-08-12"→ "On-Demand · 12 Aug 2026"
 */
function formatReportPeriod(
  kind: string | null | undefined,
  period: string | null | undefined,
  translate?: (key: string) => string,
  locale = "en",
): string {
  if (!period) return "—";
  const k = kind ?? "all";
  const frequency = (key: "monthly" | "quarterly" | "annual" | "on_demand", fallback: string) =>
    translate?.(`frequency.${key}`) ?? fallback;

  if (k === "monthly") {
    const parts = period.split("-");
    if (parts.length === 2) {
      const m = parseInt(parts[1], 10);
      if (!isNaN(m) && m >= 1 && m <= 12) {
        const name = new Date(2000, m - 1, 1).toLocaleString(locale === "ar" ? "ar" : "en", { month: "short" });
        return `${frequency("monthly", "Monthly")} · ${name} ${parts[0]}`;
      }
    }
    return `${frequency("monthly", "Monthly")} · ${period}`;
  }

  if (k === "quarterly") {
    const m = period.match(/(\d{4})[- ]Q?(\d)/i);
    if (m) return `${frequency("quarterly", "Quarterly")} · Q${m[2]} ${m[1]}`;
    return `${frequency("quarterly", "Quarterly")} · ${period}`;
  }

  if (k === "annual") {
    return `${frequency("annual", "Annual")} · ${period}`;
  }

  if (k === "on_demand") {
    // period may be "YYYY-MM-DD" or a full ISO string
    const raw = period.length === 10 ? `${period}T00:00:00` : period;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return `${frequency("on_demand", "On-Demand")} · ${d.toLocaleDateString(locale === "ar" ? "ar" : "en-GB", { day: "numeric", month: "short", year: "numeric" })}`;
    }
    return `${frequency("on_demand", "On-Demand")} · ${period}`;
  }

  // "all" or unknown — return the raw value without a frequency prefix
  return period;
}

/**
 * Format just the period date portion without the frequency prefix.
 * Used in the table Period column where Frequency already occupies its own column.
 *
 * Examples:
 *   monthly   "2026-06"   → "Jun 2026"
 *   quarterly "2025-Q2"   → "Q2 2025"
 *   annual    "2024"      → "2024"
 *   on_demand "2026-08-12"→ "12 Aug 2026"
 */
function formatPeriodOnly(kind: string | null | undefined, period: string | null | undefined, locale = "en"): string {
  if (!period) return "—";
  const k = kind ?? "";
  if (k === "monthly") {
    const parts = period.split("-");
    if (parts.length === 2) {
      const m = parseInt(parts[1], 10);
      if (!isNaN(m) && m >= 1 && m <= 12) {
        const name = new Date(2000, m - 1, 1).toLocaleString(locale === "ar" ? "ar" : "en", { month: "short" });
        return `${name} ${parts[0]}`;
      }
    }
    return period;
  }
  if (k === "quarterly") {
    const m = period.match(/(\d{4})[- ]Q?(\d)/i);
    if (m) return `Q${m[2]} ${m[1]}`;
    return period;
  }
  if (k === "annual") return period;
  if (k === "on_demand") {
    const raw = period.length === 10 ? `${period}T00:00:00` : period;
    const d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.toLocaleDateString(locale === "ar" ? "ar" : "en-GB", { day: "numeric", month: "short", year: "numeric" });
    }
    return period;
  }
  return period;
}

// Per-type narrative section fields (keys persist as report.sections jsonb).
type SectionField = {
  key: string;
  label: string;
  required?: boolean;
  rows?: number;
  /** "textarea" (default), "select", or "date" */
  type?: "textarea" | "select" | "date";
  /** For type="select" only */
  options?: { value: string; label: string }[];
  /** Helper text displayed below the label */
  helperText?: string;
  /** Textarea placeholder */
  placeholder?: string;
};

const IMPLEMENTATION_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "completed",          label: "Completed"           },
  { value: "ongoing",            label: "Ongoing"             },
  { value: "partially_completed",label: "Partially Completed" },
  { value: "delayed",            label: "Delayed"             },
  { value: "cancelled",          label: "Cancelled"           },
];
const SECTIONS: Record<string, { progress: SectionField[]; challenges: SectionField[]; narrative?: SectionField[] }> = {
  activity: {
    progress: [
      {
        key: "implementationStatus", label: "Implementation Status", required: true,
        type: "select", options: IMPLEMENTATION_STATUS_OPTIONS,
      },
      { key: "actualStartDate", label: "Actual Start Date", type: "date" },
      { key: "actualEndDate",   label: "Actual End Date",   type: "date" },
      {
        key: "implementationSummary", label: "Implementation Summary", required: true, rows: 4,
        type: "textarea",
        helperText: "Describe what was implemented, how it was carried out, and the main activities undertaken during the reporting period.",
        placeholder: "Describe the implementation process…",
      },
      {
        key: "progressAgainstPlan", label: "Progress Against Plan", rows: 3, type: "textarea",
        helperText: "Summarise whether implementation proceeded as planned and note any significant variance from the intended approach or schedule.",
        placeholder: "Note any variance from the intended approach or schedule…",
      },
      {
        key: "keyAchievements", label: "Implementation Highlights", rows: 3, type: "textarea",
        helperText: "Highlight the most significant implementation milestones or notable accomplishments.",
        placeholder: "Key milestones and accomplishments…",
      },
    ],
    challenges: [
      { key: "challenges",         label: "Challenges",                rows: 3 },
      { key: "mitigationMeasures", label: "Mitigation Measures",       rows: 3 },
      { key: "nextSteps",          label: "Next Steps / Action Points", rows: 3 },
    ],
    narrative: [
      { key: "lessonsLearned", label: "Lessons Learned", required: true, rows: 4 },
      // Note: `recommendations` is a top-level column managed via arRecommendations state —
      // it is NOT in this JSONB sections array.
      // Optional Supporting Insights — managed via show-state flags; kept in sections JSONB:
      { key: "successStory",        label: "Success Story / Case Example", rows: 4 },
      { key: "coordinationUpdates", label: "Coordination Updates",         rows: 4 },
      { key: "communityFeedback",   label: "Community Feedback",           rows: 4 },
    ],
  },
  project: {
    progress: [
      { key: "keyAchievements", label: "Key Achievements", required: true, rows: 4 },
    ],
    challenges: [
      { key: "challenges", label: "Challenges", rows: 3 },
      { key: "mitigationMeasures", label: "Mitigation Measures", rows: 3 },
      { key: "nextSteps", label: "Next Steps / Action Points", rows: 3 },
    ],
    narrative: [
      { key: "lessonsLearned", label: "Lessons Learned", required: true, rows: 4 },
      { key: "successStory", label: "Success Story", rows: 3 },
      { key: "coordinationUpdates", label: "Coordination Updates", rows: 3 },
      { key: "communityFeedback", label: "Community Feedback", rows: 3 },
    ],
  },
  hq_sector: {
    progress: [
      { key: "keySectorAchievements", label: "Key Sector Achievements *", required: true, rows: 4 },
      { key: "sectorIndicatorProgress", label: "Progress Toward Sector Indicators *", required: true, rows: 4 },
      { key: "technicalObservations", label: "Technical Observations", rows: 3 },
      { key: "qualityIssues", label: "Quality Issues", rows: 3 },
    ],
    challenges: [
      { key: "gaps", label: "Gaps Identified", rows: 3 },
      { key: "technicalChallenges", label: "Technical Challenges", rows: 3 },
      { key: "mitigationMeasures", label: "Mitigation Measures", rows: 3 },
      { key: "recommendations", label: "Recommendations", rows: 3 },
      { key: "supportRequired", label: "Support Needed from Management", rows: 3 },
      { key: "nextSteps", label: "Next Steps / Action Points", rows: 3 },
    ],
  },
  program_state: {
    progress: [
      { key: "keyStateAchievements", label: "Key Achievements *", required: true, rows: 4 },
      { key: "overallImplementation", label: "Overall Implementation Progress *", required: true, rows: 4 },
      { key: "localitiesCovered", label: "Localities Covered", rows: 2 },
      { key: "coordinationUpdates", label: "Coordination Updates", rows: 3 },
    ],
    challenges: [
      { key: "stateChallenges", label: "State Challenges *", required: true, rows: 3 },
      { key: "mitigationMeasures", label: "Mitigation Measures", rows: 3 },
      { key: "risksAndIssues", label: "Risks / Issues", rows: 3 },
      { key: "requiredSupport", label: "Support Needed from HQ", rows: 3 },
      { key: "nextSteps", label: "Next Steps *", required: true, rows: 3 },
    ],
  },
};

// Per-type activity field set.
type ActivityFieldKey =
  | "name" | "output" | "milestone" | "status" | "percent" | "budget" | "beneficiaries"
  | "relatedProjectId" | "stateId" | "sector";

const ACTIVITY_FIELDS: Record<string, ActivityFieldKey[]> = {
  project: ["name", "output", "milestone", "status", "percent", "budget", "beneficiaries"],
  hq_sector: ["name", "relatedProjectId", "stateId", "output", "milestone", "status", "percent", "beneficiaries"],
  program_state: ["name", "relatedProjectId", "sector", "output", "milestone", "status", "percent", "budget", "beneficiaries"],
};

type ActivityRow = {
  // Common fields (all report types)
  name: string;
  output: string;
  milestone: string;
  status: string;
  percent: number | "";
  budget?: number | "";
  beneficiaries?: number | "";
  relatedProjectId?: number | "";
  stateId?: number | "";
  sector?: string;
  // Project-type enhanced fields — read-only context loaded from project
  activityId?: number;
  indicator?: string;
  stateName?: string;
  stateNameAr?: string;
  plannedBudget?: number | null; // null = authoritative budget unavailable; 0 = factual zero
  target?: number;
  // Project-type reporting fields — entered by user
  actualExpenditure?: number | "";
  achievementSummary?: string;
  beneficiariesMen?: number | "";
  beneficiariesWomen?: number | "";
  beneficiariesBoys?: number | "";
  beneficiariesGirls?: number | "";
  challenges?: string;
  mitigationMeasures?: string;
  nextSteps?: string;
  varianceReason?: string;
  // Unplanned / custom activity fields
  isUnplanned?: boolean; // true = not in approved project activity list
  unplannedReason?: string; // required for unplanned activities
};

function emptyActivity(): ActivityRow {
  return { name: "", output: "", milestone: "", status: "Planned", percent: 0, budget: 0, beneficiaries: 0 };
}

function emptyProjectActivity(): ActivityRow {
  return {
    name: "", output: "", milestone: "", status: "Planned", percent: "",
    plannedBudget: null, // unplanned activity — no authoritative planned budget
    actualExpenditure: "",
    achievementSummary: "",
    beneficiariesMen: "", beneficiariesWomen: "", beneficiariesBoys: "", beneficiariesGirls: "",
    isUnplanned: true,
    unplannedReason: "",
  };
}

// ── Budget-status helpers ─────────────────────────────────────────────────────

type BudgetStatus = "on_budget" | "under_budget" | "over_budget";

function calcBudgetStatus(planned: number, actual: number): BudgetStatus {
  if (actual > planned) return "over_budget";
  if (actual < planned) return "under_budget";
  return "on_budget";
}

function varianceReasonRequired(planned: number | null | undefined, actual: number): boolean {
  if (planned == null || planned === 0) return false;
  return actual > planned || actual < planned * 0.7;
}

function BudgetStatusBadge({ planned, actual }: { planned: number | null | undefined; actual: number }) {
  const { t } = useTranslation("reports");
  if (planned == null) return null; // no authoritative planned budget
  const status = calcBudgetStatus(planned, actual);
  if (status === "over_budget")
    return <Badge variant="rejected" className="gap-1"><TrendingUp className="h-3 w-3" />{t("detail.overspend")}</Badge>;
  if (status === "under_budget")
    return <Badge variant="returned" className="gap-1"><TrendingDown className="h-3 w-3" />{t("detail.underspend")}</Badge>;
  return <Badge variant="approved" className="gap-1"><Minus className="h-3 w-3" />{t("detail.onBudget")}</Badge>;
}

// ── Project activities hook ───────────────────────────────────────────────────

type ProjectActivityFromApi = {
  id: number;
  code: string;
  title: string;
  description?: string;
  status?: string;
  outputTitle?: string;
  indicatorId?: number;
  stateId?: number;
  stateName?: string;
  localityName?: string;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  target: number;
  budgetPlanned: number;
  budgetSpent: number;
  progressPct: number;
};

function useProjectActivities(projectId: number | undefined) {
  return useQuery<ProjectActivityFromApi[]>({
    queryKey: ["project-activities-for-report", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/activities`);
      if (!res.ok) throw new Error("Failed to load project activities");
      return res.json() as Promise<ProjectActivityFromApi[]>;
    },
    enabled: !!projectId && projectId > 0,
    staleTime: 60_000,
  });
}

// ── Scoped activities hook — powers the Activity Report selector ─────────────
// Fetches activities the current user is authorised to see, with an optional
// project filter (projectFilterId = 0 means "All Projects").

type ScopedActivity = ProjectActivityFromApi & {
  projectId?: number | null;
  projectTitle?: string | null;
  projectCode?: string | null;
  sector?: string | null;
};

function useActivities(projectFilterId: number | undefined) {
  const url = projectFilterId
    ? `/api/activities?projectId=${projectFilterId}`
    : "/api/activities";
  return useQuery<ScopedActivity[]>({
    queryKey: ["scoped-activities-for-report", projectFilterId ?? 0],
    queryFn: async () => {
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load activities");
      return res.json() as Promise<ScopedActivity[]>;
    },
    staleTime: 60_000,
  });
}

type ProjectIndicatorFromApi = {
  id: number;
  code?: string;
  title?: string;
  name?: string;
  unit?: string | null;
  target: number;
  achieved: number;
};

type IndicatorProgressEntry = {
  indicatorId: number;
  name: string;
  unit?: string | null;
  target: number;
  cumAchieved: number;
  currentAchievement: number | "";
  remarks: string;
};

type SavedAttachment = {
  id: number;
  reportId: number;
  fileName: string;
  contentType: string | null;
  size: number | null;
};

/** Returns the authenticated download URL for a report attachment. */
function attachmentDownloadUrl(reportId: number, attachmentId: number): string {
  return `/api/reports/${reportId}/attachments/${attachmentId}/download`;
}
type DupCheckResult = {
  matchType: string;
  existingReport?: { id: number; title: string; period: string; status: string };
};

function useProjectIndicators(projectId: number | undefined) {
  return useQuery<ProjectIndicatorFromApi[]>({
    queryKey: ["project-indicators-for-report", projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/indicators`);
      if (!res.ok) throw new Error("Failed to load project indicators");
      return res.json() as Promise<ProjectIndicatorFromApi[]>;
    },
    enabled: !!projectId && projectId > 0,
    staleTime: 60_000,
  });
}

/**
 * Returns the list of workflow transition actions visible to the current user.
 *
 * For Project and Activity reports, the available transitions depend on BOTH
 * the current status AND the report's immutable workflow_path:
 *
 *   state_authored:   SPO created — Technical Review is mandatory.
 *     submitted        → TC sees "Technical Review"
 *                        SPC does NOT see "Coordination Review" yet
 *     technically_approved → SPC sees "Coordination Review"
 *
 *   technical_authored: TC created — Technical Review is NOT APPLICABLE.
 *     submitted        → SPC sees "Coordination Review" directly
 *                        No "Technical Review" button shown
 *
 * workflowPath defaults to "state_authored" when null/undefined (conservative).
 */
function transitionsFor(
  status: string,
  perms: string[] | undefined,
  reportType?: string,
  workflowPath?: string | null,
  // SPR-003/004: whether the current user authored this report. Needed for the
  // SOM narrow-permission submit path, which only applies to the SOM's own SPR.
  isOwnReport?: boolean,
) {
  const all: Array<{
    action: string;
    label: string;
    translationKey?: string;
    perm: string;
    icon: typeof ArrowRight;
    variant?: "default" | "destructive" | "outline" | "secondary";
  }> = [];

  const isProjectOrActivity = reportType === "project" || reportType === "activity";
  // Resolve authoring path — conservative default is state_authored (TC review mandatory)
  const isStateAuthored = isProjectOrActivity && workflowPath !== "technical_authored";
  const isTechAuthored  = isProjectOrActivity && workflowPath === "technical_authored";

  // ── Submit (all types) ───────────────────────────────────────────────────
  // SPR-003/004: a fallback SOM holds only the narrow reports.program_state.create
  // permission, so for a program_state draft THEY authored, that permission also
  // surfaces Submit. Other authors' drafts never show Submit via the narrow perm
  // (the backend enforces the same own-report + own-state bound).
  if (status === "draft") {
    const somOwnSprSubmit =
      reportType === "program_state" &&
      isOwnReport === true &&
      !hasPerm(perms, "reports.create") &&
      hasPerm(perms, "reports.program_state.create");
    const submitPerm = somOwnSprSubmit ? "reports.program_state.create" : "reports.create";
    all.push({ action: "submit", label: "Submit Report", translationKey: "submitReport", perm: submitPerm, icon: Send });
  }

  // ── State-authored Project/Activity: SPO → TC → SPC → PM ────────────────
  // Also handles historical records in "state_reviewed" (old 5-step workflow).
  // No new report enters state_reviewed — this is historical compatibility only.
  if (isStateAuthored) {
    // submitted / state_reviewed: TC performs Technical Review
    // state_reviewed is a historical status; TC progresses it to technically_approved.
    if (status === "submitted" || status === "state_reviewed") {
      all.push({ action: "technical_review", label: "Technical Review", translationKey: "approval.technicalReview", perm: "reports.approve.technical", icon: ArrowRight });
    }
    // technically_approved: SPC performs Coordination Review
    if (status === "technically_approved") {
      all.push({ action: "coordination_review", label: "Coordination Review", translationKey: "approval.coordinationReview", perm: "reports.approve.coordination", icon: ArrowRight });
    }
    // Reject / return for revision — perm depends on who the active reviewer is
    if (status === "submitted" || status === "state_reviewed") {
      all.push({ action: "request_revision", label: "Return for Revision", translationKey: "approval.returnForRevision", perm: "reports.approve.technical", icon: RotateCcw, variant: "outline" });
      all.push({ action: "reject", label: "Reject", translationKey: "approval.reject", perm: "reports.approve.technical", icon: XCircle, variant: "destructive" });
    } else if (["technically_approved", "coordination_approved"].includes(status)) {
      all.push({ action: "request_revision", label: "Return for Revision", translationKey: "approval.returnForRevision", perm: "reports.approve.coordination", icon: RotateCcw, variant: "outline" });
      all.push({ action: "reject", label: "Reject", translationKey: "approval.reject", perm: "reports.approve.coordination", icon: XCircle, variant: "destructive" });
    }
  }

  // ── Technical-authored Project/Activity: TC → SPC → PM ──────────────────
  if (isTechAuthored) {
    // submitted: SPC performs Coordination Review directly (no Technical Review step)
    if (status === "submitted") {
      all.push({ action: "coordination_review", label: "Coordination Review", translationKey: "approval.coordinationReview", perm: "reports.approve.coordination", icon: ArrowRight });
    }
    if (["submitted", "coordination_approved"].includes(status)) {
      all.push({ action: "request_revision", label: "Return for Revision", translationKey: "approval.returnForRevision", perm: "reports.approve.coordination", icon: RotateCcw, variant: "outline" });
      all.push({ action: "reject", label: "Reject", translationKey: "approval.reject", perm: "reports.approve.coordination", icon: XCircle, variant: "destructive" });
    }
  }

  // ── Simple chain: State Programme Report / HQ Sector Report ─────────────
  if (!isProjectOrActivity) {
    // HQSR coordination reviewer split (HQSR-BD-1/BD-6):
    //  - TC-authored hq_sector (workflow_path NULL) → SPC coordination-reviews
    //    via reports.approve.coordination (PM lacks that perm, so PM never
    //    sees the action — matching the server rule).
    //  - SPC-authored fallback hq_sector (immutable workflow_path =
    //    'spc_fallback') → PM is the coordination reviewer via a narrow
    //    server-side exception; gate on reports.approve.final so PM sees the
    //    actions and SPC (the author) does not.
    // super_admin (wildcard perms) always passes the hasPerm filter below.
    const isHqsrSpcFallback =
      reportType === "hq_sector" && workflowPath === "spc_fallback";
    const coordPerm = isHqsrSpcFallback
      ? "reports.approve.final"
      : "reports.approve.coordination";
    if (status === "submitted") {
      all.push({ action: "coordination_review", label: "Coordination Review", translationKey: "approval.coordinationReview", perm: coordPerm, icon: ArrowRight });
    }
    if (["submitted", "coordination_approved"].includes(status)) {
      all.push({ action: "request_revision", label: "Return for Revision", translationKey: "approval.returnForRevision", perm: coordPerm, icon: RotateCcw, variant: "outline" });
      all.push({ action: "reject", label: "Reject", translationKey: "approval.reject", perm: coordPerm, icon: XCircle, variant: "destructive" });
    }
  }

  // ── Final Approval: PM only — always from coordination_approved ──────────
  if (status === "coordination_approved") {
    all.push({ action: "final_approve", label: "Programme Manager Approve", translationKey: "approval.programmeManagerApprove", perm: "reports.approve.final", icon: CheckCircle2 });
  }

  // ── Archive ──────────────────────────────────────────────────────────────
  if (["approved", "rejected"].includes(status)) {
    all.push({ action: "archive", label: "Archive", translationKey: "approval.archive", perm: "reports.approve.final", icon: Archive, variant: "outline" });
  }

  return all.filter((a) => hasPerm(perms, a.perm));
}

// ---------------------------------------------------------------------------
// Landing page (/reports) — four type cards
// ---------------------------------------------------------------------------

/** Canonical type → URL slug */
function typeSlug(rt: string): string {
  if (rt === "hq_sector") return "hq-sector";
  if (rt === "program_state") return "program-state";
  if (rt === "activity") return "activity";
  return "project";
}

export function ReportsLanding() {
  const { t } = useTranslation("reports");
  const { data: stats, isLoading: statsLoading, isError: statsError } = useGetReportsStats();
  const { data: summary, isLoading: summaryLoading, isError: summaryError } = useGetReportsSummary();

  const kpiCards = [
    { label: t("kpi.total"),              value: summary?.total,                      icon: FileText,      iconBg: "bg-primary"     },
    { label: t("kpi.draft"),              value: summary?.draft,                      icon: Pencil,        iconBg: "bg-slate-400"   },
    { label: t("kpi.awaitingApproval"),   value: summary?.awaitingApproval,           icon: Clock,         iconBg: "bg-amber-400"   },
    { label: t("kpi.approved"),           value: summary?.approved,                   icon: CheckCircle2,  iconBg: "bg-emerald-500" },
    { label: t("kpi.awaitingOver14Days"), value: summary?.awaitingApprovalOver14Days, icon: AlertTriangle, iconBg: "bg-red-500"     },
  ];

  // Data quality metadata from the reports-summary endpoint (HQ users only).
  // Provides factual counts of migration duplicates and unverified historical records
  // excluded from all operational KPI aggregations.
  type DataQualityNotice = { migrationDuplicateCount: number; unverifiedCount: number };
  const dqn: DataQualityNotice | null = !summaryLoading
    ? ((summary as unknown as { dataQualityNotice?: DataQualityNotice | null })?.dataQualityNotice ?? null)
    : null;

  const unresolvedLegacyCount = !summaryLoading ? (summary?.unresolvedLegacyCount ?? 0) : 0;
  const showDataQualityPanel =
    unresolvedLegacyCount > 0 || (dqn?.migrationDuplicateCount ?? 0) > 0 || (dqn?.unverifiedCount ?? 0) > 0;

  return (
    <div className="space-y-4">
      {/* ── Page header ───────────────────────────────────────────────── */}
      <div>
        <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
          <FileText className="h-7 w-7 text-primary" aria-hidden /> {t("dashboard")}
        </h1>
        <p className="text-muted-foreground mt-2">{t("dashboardDesc")}</p>
      </div>

      {/* ── Historical Data Notice — one compact panel when relevant ──── */}
      {/* Records excluded from operational KPIs are surfaced here only.  */}
      {/* No destructive/warning semantics — purely informational.        */}
      {!summaryLoading && showDataQualityPanel && (
        <div
          className="flex gap-3 rounded-lg border border-blue-200 bg-blue-50/70 px-4 py-3 dark:border-blue-900/40 dark:bg-blue-900/15"
          role="note"
          aria-label={t("historicalDataNotice")}
        >
          <Info className="h-4 w-4 shrink-0 text-blue-500 dark:text-blue-400 mt-0.5" aria-hidden />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-blue-800 dark:text-blue-300 mb-1 uppercase tracking-wide">
              {t("historicalDataNotice")}
            </p>
            {dqn && dqn.migrationDuplicateCount > 0 && (
              <p className="text-xs text-blue-700 dark:text-blue-400 leading-snug">
                {t(
                  dqn.migrationDuplicateCount === 1
                    ? "dataQualityNotice_migrationDuplicate_one"
                    : "dataQualityNotice_migrationDuplicate_other",
                  { count: dqn.migrationDuplicateCount },
                )}
              </p>
            )}
            {dqn && dqn.unverifiedCount > 0 && (
              <p className="text-xs text-blue-700 dark:text-blue-400 leading-snug">
                {t(
                  dqn.unverifiedCount === 1
                    ? "dataQualityNotice_unverified_one"
                    : "dataQualityNotice_unverified_other",
                  { count: dqn.unverifiedCount },
                )}
              </p>
            )}
            {unresolvedLegacyCount > 0 && (
              <p className="text-xs text-blue-700 dark:text-blue-400 leading-snug">
                {t(
                  unresolvedLegacyCount === 1
                    ? "unresolvedLegacyNotice_one"
                    : "unresolvedLegacyNotice_other",
                  { count: unresolvedLegacyCount },
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* ── Overview KPI cards ────────────────────────────────────────── */}
      {summaryError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
          <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
          {t("loadError")}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          {kpiCards.map((c) =>
            summaryLoading ? (
              <Skeleton key={c.label} className="h-28" />
            ) : (
              <StatCard
                key={c.label}
                icon={c.icon}
                iconBg={c.iconBg}
                label={c.label}
                value={c.value ?? 0}
              />
            )
          )}
        </div>
      )}

      {/* Empty state */}
      {!summaryLoading && !summaryError && summary?.total === 0 && (
        <p className="text-sm text-muted-foreground">{t("noReportsScope")}</p>
      )}

      {/* ── Report Type navigation cards ──────────────────────────────── */}
      {/* Each card is a keyboard-accessible link to the Report Type list. */}
      <div>
        <h2 className="text-lg font-semibold mb-3">{t("reportTypes")}</h2>
        {statsError ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            {t("loadError")}
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {(["project", "activity", "program_state", "hq_sector"] as const).map((typeKey) => {
              const rawMeta = TYPE_META[typeKey];
              const meta = {
                ...rawMeta,
                label: t(rawMeta.labelKey),
                short: t(rawMeta.shortKey),
                description: t(rawMeta.descriptionKey),
              };
              const href = `/reports/${typeSlug(typeKey)}`;
              const s = stats?.[typeKey];
              const awaiting = s?.awaitingApproval ?? 0;
              const approved  = s?.approved ?? 0;
              return (
                <Link
                  key={typeKey}
                  href={href}
                  className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 h-full"
                  aria-label={meta.label}
                >
                  <Card className="group h-full flex flex-col cursor-pointer transition-all duration-150 hover:shadow-sm hover:ring-1 hover:ring-border/60 hover:border-primary/30">
                    {/* Icon + Title + Chevron */}
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="rounded-md bg-primary/10 p-1.5 shrink-0">
                            <meta.icon className="h-4 w-4 text-primary" aria-hidden />
                          </div>
                          <CardTitle className="text-base leading-tight">{meta.label}</CardTitle>
                        </div>
                        <ChevronRight
                          className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors rtl:rotate-180"
                          aria-hidden
                        />
                      </div>
                      {/* Description */}
                      <CardDescription className="mt-2 text-xs leading-relaxed">
                        {meta.description}
                      </CardDescription>
                    </CardHeader>

                    <CardContent className="flex flex-col flex-1 gap-3 pt-0">
                      {/* Status summary strip */}
                      {statsLoading ? (
                        <Skeleton className="h-14" />
                      ) : (
                        <div className="grid grid-cols-4 gap-1 text-center">
                          {[
                            {
                              label: t("kpi.totalShort"),
                              value: s?.total ?? 0,
                              cls: "text-foreground",
                            },
                            {
                              label: t("kpi.draftShort"),
                              value: s?.draft ?? 0,
                              cls: "text-muted-foreground",
                            },
                            {
                              label: t("kpi.awaitingShort"),
                              value: awaiting,
                              cls: awaiting > 0
                                ? "text-amber-600 dark:text-amber-400"
                                : "text-muted-foreground",
                            },
                            {
                              label: t("kpi.approvedShort"),
                              value: approved,
                              cls: approved > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-muted-foreground",
                            },
                          ].map((stat) => (
                            <div key={stat.label} className="rounded border bg-muted/40 px-1 py-1.5">
                              <p className="text-[10px] text-muted-foreground leading-none mb-0.5">
                                {stat.label}
                              </p>
                              <p className={cn("text-sm font-semibold tabular-nums", stat.cls)}>
                                {stat.value}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Workflow block — always at the bottom of each card */}
                      <div className="mt-auto pt-2 border-t border-border/40">
                        <WorkflowBlock workflow={meta.workflow} />
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// SummaryCards now uses per-type stats so that each sub-page (project, activity, etc.)
// shows KPIs scoped to ONLY its own report type, not the org-wide total.
function SummaryCards({ lockedType }: { lockedType: string }) {
  const { t } = useTranslation("reports");
  const { data: stats, isLoading, isError } = useGetReportsStats();
  const s = stats?.[lockedType];
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-[120px]" />)}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive flex items-center gap-2">
        <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
        {t("loadError")}
      </div>
    );
  }
  const cards = [
    { label: t("kpi.total"),              value: s?.total ?? 0,                      icon: FileText,      iconBg: "bg-primary"     },
    { label: t("kpi.draft"),              value: s?.draft ?? 0,                      icon: Pencil,        iconBg: "bg-slate-400"   },
    { label: t("kpi.awaitingApproval"),   value: s?.awaitingApproval ?? 0,           icon: Clock,         iconBg: "bg-amber-400"   },
    { label: t("kpi.approved"),           value: s?.approved ?? 0,                   icon: CheckCircle2,  iconBg: "bg-emerald-500" },
    { label: t("kpi.awaitingOver14Days"), value: s?.awaitingApprovalOver14Days ?? 0, icon: AlertTriangle, iconBg: "bg-red-500"     },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {cards.map((c) => (
        <StatCard
          key={c.label}
          icon={c.icon}
          iconBg={c.iconBg}
          label={c.label}
          value={c.value}
        />
      ))}
    </div>
  );
}

function ReportAggregatesView({ reportId }: { reportId: number }) {
  const { t } = useTranslation("reports");
  const { data, isLoading } = useGetReportAggregates(reportId);
  if (isLoading) return <Skeleton className="h-32" />;
  if (!data) return null;
  const b = data.beneficiaries;
  const bg = data.budget;
  return (
    <Card className="bg-muted/20 border-dashed">
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Info className="h-4 w-4" /> {t("aggregates.refDataTitle")}</CardTitle></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs font-medium mb-1 flex items-center gap-1"><Users className="h-3 w-3" /> {t("aggregates.beneficiaryRegister")}</p>
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {[["M", b.male], ["F", b.female], ["B", b.boys], ["G", b.girls], ["Σ", b.total]].map(([k, v]) => (
              <div key={k as string} className="rounded border bg-background p-1.5">
                <p className="text-muted-foreground">{k}</p>
                <p className="font-medium"><bdi dir="ltr">{(v as number).toLocaleString()}</bdi></p>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium mb-1 flex items-center gap-1"><DollarSign className="h-3 w-3" /> {t("aggregates.budgetTracker")}</p>
          <div className="grid grid-cols-4 gap-2 text-center text-xs">
            <div className="rounded border bg-background p-1.5"><p className="text-muted-foreground">{t("aggregates.planned")}</p><p className="font-medium"><bdi dir="ltr">{formatCurrency(bg.planned)}</bdi></p></div>
            <div className="rounded border bg-background p-1.5"><p className="text-muted-foreground">{t("aggregates.spent")}</p><p className="font-medium"><bdi dir="ltr">{formatCurrency(bg.actual)}</bdi></p></div>
            <div className="rounded border bg-background p-1.5"><p className="text-muted-foreground">{t("aggregates.remaining")}</p><p className="font-medium"><bdi dir="ltr">{formatCurrency(bg.remaining)}</bdi></p></div>
            <div className="rounded border bg-background p-1.5"><p className="text-muted-foreground">{t("aggregates.burn")}</p><p className="font-medium"><bdi dir="ltr">{bg.burnRatePct}%</bdi></p></div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function exportReportsCsv(rows: Report[], typeLabel: string, translate: (key: string) => string) {
  const isActivityType = rows.length > 0
    ? (rows[0] as unknown as Record<string, unknown>).reportType === "activity"
    : typeLabel.toLowerCase().includes("activity");

  const headers = [
    translate("export.id"), translate("list.title"), translate("export.reportType"), translate("list.frequency"),
    ...(isActivityType ? [translate("export.activityCode"), translate("list.activity")] : []),
    translate("list.sector"), translate("list.project"), translate("list.state"),
    translate("fields.period"), translate("export.reportingMonth"), translate("export.quarter"), translate("export.reportingYear"),
    translate("list.preparedBy"), translate("list.status"),
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const effectiveSector = r.effectiveSector ?? r.sector ?? "";
    const authorDisplay = r.authorName ?? r.submittedByName ?? "";
    const rr = r as unknown as Record<string, unknown>;
    const cells = [
      r.id,
      r.title,
      r.reportType ?? "",
      // Activity Reports: compatibility 'monthly' default is internal — not user-selected.
      // Show blank for monthly rows; preserve genuine historical values (quarterly, annual, on_demand).
      isActivityType ? (r.kind === "monthly" ? "" : (r.kind ?? "")) : (r.kind ?? ""),
      ...(isActivityType ? [rr.activityCode ?? "", rr.activityTitle ?? ""] : []),
      effectiveSector,
      r.projectTitle ?? "",
      r.stateName ?? "",
      r.period,
      r.reportingMonth ?? "",
      r.quarter ?? "",
      r.reportingYear ?? "",
      authorDisplay,
       displayStatus(r.status, translate),
    ].map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`);
    lines.push(cells.join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${typeLabel.toLowerCase().replace(/\s+/g, "-")}-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Section / tab navigation items — shared across all non-activity report form variants
// Each item maps directly to one true tab panel.
const REPORT_NAV_ITEMS = [
  { id: "rp-section-basic",       labelKey: "form.tabBasic"       },
  { id: "rp-section-progress",    labelKey: "form.tabProgress"    },
  { id: "rp-section-activities",  labelKey: "form.tabActivities"  },
  { id: "rp-section-challenges",  labelKey: "form.tabChallenges"  },
  { id: "rp-section-lessons",     labelKey: "form.tabLessons"     },
  { id: "rp-section-attachments", labelKey: "form.tabAttachments" },
] as const;

// Activity-report-specific navigation — 6 renamed steps; "Activities" step removed.
// Used only when lockedType === "activity".
const ACTIVITY_REPORT_NAV_ITEMS = [
  { id: "ar-section-basic",       labelKey: "form.tabBasic"                   },
  { id: "ar-section-progress",    labelKey: "form.tabImplementationProgress"  },
  { id: "ar-section-results",     labelKey: "form.tabResultsBeneficiaries"    },
  { id: "ar-section-challenges",  labelKey: "form.tabChallengesActions"       },
  { id: "ar-section-lessons",     labelKey: "form.tabLessonsRecommendations"  },
  { id: "ar-section-attachments", labelKey: "form.tabAttachments"             },
] as const;

type ReportSectionId =
  | typeof REPORT_NAV_ITEMS[number]["id"]
  | typeof ACTIVITY_REPORT_NAV_ITEMS[number]["id"];

// ---------------------------------------------------------------------------
// ActivityReportDetail — extracted to dedicated component (Task 198 UX redesign)
// ---------------------------------------------------------------------------
// See: artifacts/cafa-pmis/src/components/activity-report-detail.tsx

// ---------------------------------------------------------------------------
// Main page — used by each /reports/<sub> route with a fixed lockedType
// ---------------------------------------------------------------------------

type FormShape = {
  title: string;
  kind: string;
  reportingMonth: number;
  reportingYear: number;
  periodStart: string;
  periodEnd: string;
  sector: string;
  submittedTo: string;
  projectId: number;
  stateId: number;
  beneficiariesMale: number;
  beneficiariesFemale: number;
  beneficiariesBoys: number;
  beneficiariesGirls: number;
  plannedBudget: number;
  actualExpenditure: number;
  quarter: number;
  onDemandReason: string;
  /** Report Subject / Activity Name — primary human-readable identity for Activity Reports */
  activityName: string;
};

type LocalReportFormSnapshot = {
  values: FormShape;
  sectionValues: Record<string, string>;
  activities: ActivityRow[];
  activeSection: ReportSectionId;
  activityId: number | null;
  quarter: number;
  onDemandReason: string;
  arRecommendations: string;
  linkMode: "standalone" | "activity" | "project";
  reportLocationType: "state" | "hq";
  pmrLocationType: "state" | "hq";
  projectFilterId: number;
  indicatorProgressEntries: IndicatorProgressEntry[];
  riskStatusEdits: Record<number, string>;
  docsNoSupport: boolean;
  docsNoSupportReason: string;
  showSuccessStory: boolean;
  showCoordinationUpdates: boolean;
  showCommunityFeedback: boolean;
};
export default function ReportsPage({ lockedType }: { lockedType: string }) {
  const { t, i18n } = useTranslation("reports");
  const baseMeta = TYPE_META[lockedType] ?? TYPE_META.project;
  const meta = {
    ...baseMeta,
    label: t(baseMeta.labelKey),
    short: t(baseMeta.shortKey),
    description: t(baseMeta.descriptionKey),
  };
  const sectionsCfg = SECTIONS[lockedType] ?? SECTIONS.project;
  const activityFields = ACTIVITY_FIELDS[lockedType] ?? ACTIVITY_FIELDS.project;
  const configuredFieldLabel = useCallback(
    (field: SectionField) => t(`form.fieldLabels.${field.key}`, { defaultValue: field.label.replace(/\s*\*$/, "") }),
    [t],
  );

  const qc = useQueryClient();
  const { data: me } = useGetMe();
  const { isOnline } = useSyncContext();
  const perms = me?.permissions;
  // Derive role-based variables early so they're available to all effects and derived state below.
  const userRole = me?.user?.role ?? "";
  const isStateRole = userRole === "state_program_officer" || userRole === "state_office_manager";
  const userStateId = isStateRole
    ? (me?.user as unknown as Record<string, unknown>)?.stateId as number | undefined
    : undefined;
  // useListUsers is no longer used — author options are derived from reportsRaw.items
  // to prevent name disclosure across state/sector boundaries.

  const [displayStatusFilter, setDisplayStatusFilter] = useState<string>("all");
  const [projectId, setProjectId] = useState<string>("all");
  const [stateId, setStateId] = useState<string>("all");

  // Sync with global location context — updates the local filter when the header selector changes
  const { selectedStateId: ctxStateId } = useLocationContext();
  useEffect(() => {
    setStateId(ctxStateId != null ? String(ctxStateId) : "all");
  }, [ctxStateId]);

  const [sector, setSector] = useState<string>("all");
  const [kindFilter, setKindFilter] = useState<string>("all"); // frequency filter
  const [reportingMonth, setReportingMonth] = useState<string>("all");
  const [reportingYear, setReportingYear] = useState<string>("all");
  const [quarterFilter, setQuarterFilter] = useState<string>("all");
  const [authorId, setAuthorId] = useState<string>("all");
  const [activityFilter, setActivityFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 25;

  const [selected, setSelected] = useState<Report | null>(null);
  const [draftToResumeAfterViewerClose, setDraftToResumeAfterViewerClose] = useState<Report | null>(null);
  const loadDraftForEditRef = useRef<(report: Report) => void>(() => {});
  // Primary record viewers open from list/card controls rather than DialogTrigger.
  // Preserve a usable trigger so the shared modal can restore focus after close.
  const detailTriggerRef = useRef<HTMLElement | null>(null);
  const openReportDetail = useCallback((report: Report, trigger?: HTMLElement | null) => {
    detailTriggerRef.current = trigger ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    setSelected(report);
  }, []);
  const [createOpen, setCreateOpen] = useState(false);
  const [transitionOpen, setTransitionOpen] = useState<{ action: string; label: string } | null>(null);
  const [comment, setComment] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const [sectionValues, setSectionValues] = useState<Record<string, string>>({});
  const [activities, setActivities] = useState<ActivityRow[]>([emptyActivity()]);
  const [pendingVoiceNote, setPendingVoiceNote] = useState<PendingNote | null>(null);
  // Per-field validation errors for inline display and aria-invalid wiring
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<string, string>>>({});
  // Voice note retry state: preserves the pending note when upload fails so user can retry
  const [voiceNoteRetry, setVoiceNoteRetry] = useState<{ note: PendingNote; reportId: number } | null>(null);

  // Project auto-population state
  const [allowedStateIds, setAllowedStateIds] = useState<number[]>([]);
  const [allowedSectors, setAllowedSectors] = useState<string[]>([]);
  const [stateFieldLocked, setStateFieldLocked] = useState(false);
  const [sectorFieldLocked, setSectorFieldLocked] = useState(false);
  // Currency derived from selected project — authoritative for all financial display
  const [projectCurrency, setProjectCurrency] = useState<string | null>(null);

  // New period / frequency state
  const [quarter, setQuarter] = useState(1);
  const [onDemandReason, setOnDemandReason] = useState("");

  // Structured indicator progress
  const [indicatorProgressEntries, setIndicatorProgressEntries] = useState<IndicatorProgressEntry[]>([]);

  // Duplicate check
  const [dupCheck, setDupCheck] = useState<DupCheckResult | null>(null);
  const [, setDupCheckOpen] = useState(false);
  const dupCheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoTitleRef = useRef("");

  // Supporting documents
  const [supportingDocs, setSupportingDocs] = useState<Array<{ docType: string; file: File }>>([]);
  const [docsError, setDocsError] = useState("");
  // Supporting docs bypass — "No supporting documents" with a documented reason
  const [docsNoSupport, setDocsNoSupport] = useState(false);
  const [docsNoSupportReason, setDocsNoSupportReason] = useState("");
  // Saved attachments — already uploaded to storage for the report being edited
  const [savedAttachments, setSavedAttachments] = useState<SavedAttachment[]>([]);

  // Attachments shown in the submitted-detail Sheet (non-activity reports)
  const [detailAttachments, setDetailAttachments] = useState<SavedAttachment[]>([]);
  const [detailAttachmentsLoading, setDetailAttachmentsLoading] = useState(false);
  const [detailAttachmentsError, setDetailAttachmentsError] = useState(false);

  // Draft edit mode
  const [editingReport, setEditingReport] = useState<Report | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Report | null>(null);
  const editingReportRef = useRef<Report | null>(null);
  // Edit loading skeleton — brief true when switching into edit mode
  const [isLoadingEditForm, setIsLoadingEditForm] = useState(false);
  // Revision banner dismiss (session-local only)
  const [revisionBannerDismissed, setRevisionBannerDismissed] = useState(false);

  // Inline risk status edits (project report — Challenges tab)
  const [riskStatusEdits, setRiskStatusEdits] = useState<Record<number, string>>({});
  const [savingRiskId, setSavingRiskId] = useState<number | null>(null);

  // True tab navigation — no IntersectionObserver needed
  const [activeSection, setActiveSection] = useState<ReportSectionId>("rp-section-basic");
  // Tab-level validation error counts (populated on submit attempt)
  const [tabErrors, setTabErrors] = useState<Partial<Record<ReportSectionId, number>>>({});

  // ── Activity Report Step 5: top-level recommendations column ─────────────────
  // `recommendations` is a top-level DB column (not JSONB sections).
  // It is managed separately so it is never conflated with nextSteps or other fields.
  const [arRecommendations, setArRecommendations] = useState<string>("");
  // Optional Supporting Insights visibility — hidden by default, revealed on demand
  const [showSuccessStory,        setShowSuccessStory]        = useState(false);
  const [showCoordinationUpdates, setShowCoordinationUpdates] = useState(false);
  const [showCommunityFeedback,   setShowCommunityFeedback]   = useState(false);
  // Confirmation before removing a populated Supporting Insights section (prevents accidental data loss)
  const [removeInsightConfirm, setRemoveInsightConfirm] = useState<"successStory" | "coordinationUpdates" | "communityFeedback" | null>(null);

  // Dirty-form tracking — set true on any meaningful user change
  const [isFormDirty, setIsFormDirty] = useState(false);
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  // Double-submit guard — covers the PATCH + upload phases before transitionMutation becomes pending.
  // useRef is the synchronous lock (updated immediately within the closure, no re-render needed).
  // useState drives the button disabled/aria-busy prop so React re-renders the UI correctly.
  const isSubmittingRef = useRef(false);
  const [isSubmittingReport, setIsSubmittingReport] = useState(false);
  const deviceDrafts = useOfflineReportDrafts(
    ["project", "activity", "program_state", "hq_sector"].includes(lockedType)
      ? lockedType as "project" | "activity" | "program_state" | "hq_sector"
      : "project",
  );

  // Backend always filtered by lockedType; other filters are passed through.
  const query: Record<string, number | string> = { reportType: lockedType, pageSize: PAGE_SIZE, page };
  if (projectId !== "all") query.projectId = projectId === "standalone" ? "standalone" : Number(projectId);
  if (stateId !== "all") query.stateId = Number(stateId);
  if (sector !== "all") query.sector = sector;
  if (kindFilter !== "all") query.kind = kindFilter;
  // Frequency-aware period filters
  if (kindFilter === "monthly" || kindFilter === "all") {
    if (reportingMonth !== "all") query.reportingMonth = Number(reportingMonth);
  }
  if (kindFilter === "quarterly" && quarterFilter !== "all") {
    query.quarter = Number(quarterFilter);
  }
  if (reportingYear !== "all") query.reportingYear = Number(reportingYear);
  if (authorId !== "all") query.authorId = Number(authorId);
  if (activityFilter !== "all") query.activityId = Number(activityFilter);
  // Only pass single-status backend when display status maps to a single backend value.
  if (displayStatusFilter !== "all") {
    const bs = STATUS_GROUPS[displayStatusFilter];
    if (bs && bs.length === 1) query.status = bs[0];
  }

  const { data: reportsRaw, isLoading, isError, refetch } = useListReports(query);

  // ── Author facet — population-level, pagination-independent ─────────────────
  // Params: all active non-author, non-pagination filters so the option list
  // reflects the filtered population but NEVER collapses due to the selected
  // author itself (stable faceted-filter: authorId is intentionally excluded).
  // Page/pageSize are also excluded so navigating between pages never changes
  // which authors appear in the dropdown.
  const authorFacetParams = useMemo(() => {
    const p: Record<string, number | string> = { reportType: lockedType };
    if (projectId !== "all") p.projectId = projectId === "standalone" ? "standalone" : Number(projectId);
    if (stateId !== "all") p.stateId = Number(stateId);
    if (sector !== "all") p.sector = sector;
    if (kindFilter !== "all") p.kind = kindFilter;
    if (kindFilter === "monthly" || kindFilter === "all") {
      if (reportingMonth !== "all") p.reportingMonth = Number(reportingMonth);
    }
    if (kindFilter === "quarterly" && quarterFilter !== "all") {
      p.quarter = Number(quarterFilter);
    }
    if (reportingYear !== "all") p.reportingYear = Number(reportingYear);
    if (activityFilter !== "all") p.activityId = Number(activityFilter);
    if (displayStatusFilter !== "all") {
      const bs = STATUS_GROUPS[displayStatusFilter];
      if (bs && bs.length === 1) p.status = bs[0];
    }
    return p;
  }, [lockedType, projectId, stateId, sector, kindFilter, reportingMonth, reportingYear, quarterFilter, displayStatusFilter, activityFilter]);

  const { data: authorFacetData } = useListReportAuthors(authorFacetParams);
  const authorOptions = authorFacetData?.authors ?? [];

  // ── Activity facet — activities that have Activity Reports in accessible scope ──
  // Only fetched when viewing the Activity Reports sub-page.
  const activityFacetEnabled = lockedType === "activity";
  const activityFacetQS = useMemo(() => {
    if (!activityFacetEnabled) return null;
    const p: Record<string, string | number> = {};
    if (projectId !== "all") p.projectId = projectId === "standalone" ? "standalone" : Number(projectId);
    if (stateId !== "all") p.stateId = Number(stateId);
    if (sector !== "all") p.sector = sector;
    return p;
  }, [activityFacetEnabled, projectId, stateId, sector]);

  const { data: activityFacetData } = useQuery({
    queryKey: ["report-activity-facet", activityFacetQS],
    queryFn: async () => {
      if (!activityFacetQS) return { activities: [] as Array<{ id: number; title: string; code: string | null }> };
      const qs = new URLSearchParams(
        Object.entries(activityFacetQS).map(([k, v]) => [k, String(v)])
      ).toString();
      const res = await fetch(`/api/reports/activity-facet${qs ? `?${qs}` : ""}`, { credentials: "include" });
      if (!res.ok) return { activities: [] as Array<{ id: number; title: string; code: string | null }> };
      return res.json() as Promise<{ activities: Array<{ id: number; title: string; code: string | null }> }>;
    },
    enabled: activityFacetEnabled,
  });
  const activityFacetOptions = activityFacetData?.activities ?? [];

  // Client-side filter when display status maps to multiple backend values (e.g. Under Review).
  const reports = useMemo(() => {
    const items = reportsRaw?.items;
    if (!items) return items;
    if (displayStatusFilter === "all") return items;
    const bs = STATUS_GROUPS[displayStatusFilter] ?? [];
    return items.filter((r) => bs.includes(r.status));
  }, [reportsRaw, displayStatusFilter]);

  // Deep link: ?open=<reportId> opens the exact report once the list loads
  // (used by the PMR completeness panel and consolidated view "View" links).
  const openParamConsumed = useRef(false);
  useEffect(() => {
    if (openParamConsumed.current) return;
    const openId = Number(new URLSearchParams(window.location.search).get("open"));
    if (!Number.isInteger(openId) || openId <= 0) {
      openParamConsumed.current = true;
      return;
    }
    openParamConsumed.current = true;
    const stripParam = () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("open");
      window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    };
    // Resolve through the authorised single-report endpoint so the deep link
    // works regardless of the list's pagination or active filters. RBAC is
    // enforced server-side (403/404 → open nothing).
    let cancelled = false;
    fetch(`/api/reports/${openId}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((report: Report | null) => {
        if (cancelled || !report || typeof report.id !== "number") return;
        setSelected(report);
        stripParam();
      })
      .catch(() => {
        /* network failure — leave the list as-is */
      });
    return () => { cancelled = true; };
  }, []);

  // Reset page to 1 when any filter changes
  useEffect(() => { setPage(1); }, [
    displayStatusFilter, projectId, stateId, sector, kindFilter,
    reportingMonth, reportingYear, quarterFilter, authorId, activityFilter,
  ]);

  const { data: projects } = useListProjects();
  const { data: states } = useListStates();

  const createMutation = useCreateReport();
  const transitionMutation = useTransitionReport();

  const now = new Date();
  const form = useForm<FormShape>({
    defaultValues: {
      title: "", kind: "monthly",
      reportingMonth: now.getMonth() + 1, reportingYear: now.getFullYear(),
      periodStart: "", periodEnd: "",
      sector: "", submittedTo: "",
      projectId: 0, stateId: 0,
      beneficiariesMale: 0, beneficiariesFemale: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
      plannedBudget: 0, actualExpenditure: 0,
      quarter: 1, onDemandReason: "", activityName: "",
    },
  });

  const v = form.watch();

  // Mark dirty whenever a registered form field changes while the dialog is open
  useEffect(() => {
    if (!createOpen) return;
    const { unsubscribe } = form.watch(() => setIsFormDirty(true));
    return unsubscribe;
  }, [createOpen, form]);

  // Scroll the active tab into view when the section changes (handles narrow widths
  // where the nav bar overflows and the active tab is off-screen after Next/Back).
  // Uses direct container scrollTo so the tablist scroll position is adjusted, not
  // the dialog/page scroll — prevents the first tab being clipped at the left edge
  // when returning from a later step.
  useEffect(() => {
    const el = document.querySelector<HTMLElement>(`[role="tab"][id="tab-${activeSection}"]`);
    if (!el) return;
    const tablist = el.closest<HTMLElement>('[role="tablist"]');
    if (!tablist) return;
    const elLeft = el.offsetLeft;
    const elRight = elLeft + el.offsetWidth;
    const listLeft = tablist.scrollLeft;
    const listRight = listLeft + tablist.clientWidth;
    if (elLeft < listLeft) {
      tablist.scrollTo({ left: elLeft, behavior: "smooth" });
    } else if (elRight > listRight) {
      tablist.scrollTo({ left: elRight - tablist.clientWidth, behavior: "smooth" });
    }
  }, [activeSection]);

  const isHqSector = lockedType === "hq_sector";
  const isProject = lockedType === "project";
  const isProgramState = lockedType === "program_state";
  const isActivity = lockedType === "activity";

  // FIX-07: Detect historical Activity Reports that predate the modern field set.
  //
  // Detection rule (two conditions, both required):
  //   1. No "_schemaVersion": "modern" marker in stored sections.
  //      Any Activity Report saved after FIX-07 gets this marker written into sections
  //      during buildPayloadData. New drafts therefore gain the marker on their very first
  //      save (the POST), so reopening them correctly treats them as modern. True legacy
  //      records never had it written and will lack it permanently until they are updated
  //      with modern content.
  //   2. Neither implementationSummary nor implementationStatus is present in stored sections.
  //      These were the first mandatory modern fields. Their absence is a necessary (though
  //      not sufficient) indicator; condition 1 makes the combined check sufficient.
  //
  // Derived purely from the stored record — never from URL params, form values, or request body.
  const isLegacyRecord: boolean = isActivity && editingReport !== null && (() => {
    const sections = (((editingReport as unknown) as Record<string, unknown>).sections ?? {}) as Record<string, unknown>;
    return (
      sections["_schemaVersion"] !== "modern" &&       // no modern marker written post-FIX-07
      sections.implementationSummary === undefined &&   // missing modern required field
      sections.implementationStatus === undefined        // missing modern required field
    );
  })();

  // Compatibility profile derived from legacy detection — controls which modern required-field
  // checks are skipped for historical records. All flags are true for new/modern records.
  const compatProfile = useMemo(() => ({
    subjectRequired:               !isLegacyRecord,
    implementationSummaryRequired: !isLegacyRecord,
    resultsRequired:               !isLegacyRecord,
    lessonsRequired:               !isLegacyRecord,
    explicitBeneficiaryToggle:     !isLegacyRecord,
    explicitChallengeToggle:       !isLegacyRecord,
  }), [isLegacyRecord]);

  // Geographic scope — resolved to one of three explicit outcomes via the central
  // helper in lib/permissions.ts.  The discriminated union prevents the previous
  // ambiguity where [] could mean either "org-wide" or "no valid scope".
  //   single_state      → lock State field; show only that state
  //   organisation_wide → show all states (org-wide access explicitly confirmed)
  //   none              → show zero states; fail closed (missing/unknown scope)
  // FIX-08: isLegacyPeriod — true when the stored period string does not match YYYY-MM.
  // This is derived from the stored record's period column (not from form values).
  // Used in ActivityValidationContext to exempt legacy records from month/year fields.
  const isLegacyPeriod: boolean = isActivity && (() => {
    const sp = editingReport
      ? ((editingReport as unknown as Record<string, unknown>).period as string | undefined)
      : undefined;
    return sp != null && !/^\d{4}-\d{2}$/.test(sp);
  })();

  const geographicScope  = getGeographicScope(me?.user);
  const singleStateUser  = geographicScope.type === "single_state";
  const autoLockedStateId = singleStateUser ? geographicScope.stateIds[0] : undefined;
  const visibleStates = useMemo(() =>
    geographicScope.type === "organisation_wide"
      ? (states ?? [])
      : geographicScope.type === "single_state"
        ? (states ?? []).filter((s) => geographicScope.stateIds.includes(s.id))
        : [], // "none" — expose no states, do not fall back to global list
  [geographicScope, states]);

  // Wizard combobox open state — project and activity selectors for activity reports
  const [projectComboOpen, setProjectComboOpen] = useState(false);
  const [activityComboOpen, setActivityComboOpen] = useState(false);

  // Optional project filter for Activity Reports (0 = "All Projects").
  // Does NOT become a required report field — project context is derived from the selected activity.
  const [projectFilterId, setProjectFilterId] = useState<number>(0);

  // Active navigation items: activity reports use renamed 6-step wizard; others keep existing tabs.
  const activeNavItems = isActivity
    ? (ACTIVITY_REPORT_NAV_ITEMS as ReadonlyArray<{ id: ReportSectionId; labelKey: string }>)
    : (REPORT_NAV_ITEMS as ReadonlyArray<{ id: ReportSectionId; labelKey: string }>);

  // Activity Report: link mode — controls which linking UI is shown and what gets sent.
  //   "standalone"   → no linked activity or project record
  //   "activity"     → linked to an existing activity record (activityId set)
  //   "project"      → linked to a project but no specific activity record
  const [linkMode, setLinkMode] = useState<"standalone" | "activity" | "project">("standalone");

  // Activity Report: location type — "state" (default) or "hq" for HQ-based activity reports.
  // Relevant only for standalone activity reports (no linked activity/project).
  // When "hq", stateId is not required and not sent in the payload.
  const [reportLocationType, setReportLocationType] = useState<"state" | "hq">("state");

  // PMR: location type — "state" (default) or "hq" for HQ-based project monthly reports.
  // When "hq", stateId is null and locationType="hq" is sent in the POST payload.
  // Immutable after creation (parity with Activity Reports).
  const [pmrLocationType, setPmrLocationType] = useState<"state" | "hq">("state");

  // FIX-08: Unified validation context — assembled once per render from component state.
  // Consumed by validateActivityForSubmission, per-step validators, and the Readiness IIFE.
  const validationCtx = useMemo((): ActivityValidationContext => ({
    compatProfile,
    linkMode,
    locationType: reportLocationType,
    singleStateUser,
    isLegacyPeriod,
  }), [compatProfile, linkMode, reportLocationType, singleStateUser, isLegacyPeriod]);

  // Assembles form + sectionValues + activityId into the shape expected by the lib validators.
  // Called inside validateSubmit and the Readiness IIFE.
  function buildActivityFormValues(values: FormShape): ActivityFormValues {
    return {
      title:             values.title,
      activityName:      values.activityName,
      activityId:        activityId,
      projectId:         values.projectId || null,
      stateId:           values.stateId || null,
      reportingMonth:    values.reportingMonth,
      reportingYear:     values.reportingYear,
      periodStart:       values.periodStart,
      onDemandReason:    onDemandReason,
      kind:              values.kind,
      beneficiariesMale:   values.beneficiariesMale,
      beneficiariesFemale: values.beneficiariesFemale,
      beneficiariesBoys:   values.beneficiariesBoys,
      beneficiariesGirls:  values.beneficiariesGirls,
    };
  }

  // Activity Report: selected activity ID (separate state — like `quarter`)
  const [activityId, setActivityId] = useState<number | null>(null);
  // Ref used to skip one activityId-clear cycle during draft hydration.
  // Set to true in loadDraftForEdit (before form.reset changes selectedProjectId),
  // consumed and reset to false in the selectedProjectId useEffect.
  const skipNextActivityClearRef = useRef(false);

  // Auto-load project activities/indicators when a project is selected
  // (used for project report activity table; activity reports use useActivities below)
  const selectedProjectId = (isProject || isActivity) && v.projectId ? Number(v.projectId) : undefined;

  // Derived: HQ availability for the selected project's PMR location options.
  // Uses the explicit has_hq_operations flag (not management_level).
  // State-scoped users (SPO/SOM) never see HQ regardless of project type.
  const selectedProjectObj = isProject ? projects?.find((p) => p.id === selectedProjectId) : undefined;
  const isStateRoleForHq =
    me?.user?.role === "state_program_officer" || me?.user?.role === "state_office_manager";
  // HQ option: only when the project explicitly has HQ as an Operational Location.
  // This mirrors the backend's has_hq_operations gate (reports.ts).
  const pmrHqAvailable =
    isProject &&
    !!selectedProjectId &&
    (selectedProjectObj as unknown as Record<string, unknown>)?.hasHqOperations === true &&
    !isStateRoleForHq;

  // Permission check — used for "Can't Find Your Project?" registration guidance.
  // canCreateProject: check explicit perm OR super_admin wildcard ("*")
  const canCreateProject = !!(me?.permissions as string[] | undefined)?.some(
    (p) => p === "projects.create" || p === "*",
  );
  const { data: projectActivitiesData } = useProjectActivities(selectedProjectId);

  // Scoped activities for the Activity Report wizard — driven by the optional project filter,
  // not by the form's projectId (which is now auto-derived from the selected activity).
  const {
    data: activitiesData,
    isLoading: activitiesLoading,
    isError: activitiesError,
  } = useActivities(isActivity && linkMode === "activity" ? (projectFilterId || undefined) : undefined);
  // Recovery must be checked against the complete, server-scoped activity
  // reference list rather than the selector's current filter. This list is
  // also what prevents a restored project filter from widening access.
  const { data: authorisedActivities } = useActivities(undefined);
  const { data: projectIndicatorsData } = useProjectIndicators(selectedProjectId);

  // Fetch risks linked to the selected project (for Section 6 of project reports)
  type ProjectRisk = ListRisksQueryResult["items"][number] & { riskLevel?: string | null };
  const { data: projectLinkedRisksRaw } = useQuery<ProjectRisk[]>({
    queryKey: ["risks", "for-report", selectedProjectId],
    queryFn: async () => {
      if (!selectedProjectId) return [];
      const r = await fetch(`/api/risks?projectId=${selectedProjectId}&limit=200`, { credentials: "include" });
      if (!r.ok) return [];
      const body = (await r.json()) as { items?: ProjectRisk[] };
      return body.items ?? [];
    },
    enabled: !!selectedProjectId,
    staleTime: 30_000,
  });

  // ── Revision banner — fetch comments when editing a returned draft ───────────
  // Uses the same pattern as plan-detail.tsx (PLAN-012).
  const editingReportId = editingReport?.id ?? null;
  const isEditingDraft = editingReport?.status === "draft";
  const { data: editingReportComments } = useQuery({
    queryKey: ["comments", "report", editingReportId],
    queryFn: async () => {
      const res = await fetch(`/api/comments?entityType=report&entityId=${editingReportId}`, { credentials: "include" });
      if (!res.ok) return [] as Array<{ id: number; commentType: string; body: string; authorName: string; createdAt: string }>;
      return res.json() as Promise<Array<{ id: number; commentType: string; body: string; authorName: string; createdAt: string }>>;
    },
    enabled: !!editingReportId && isEditingDraft,
    staleTime: 30_000,
  });
  const lastRevisionRequest = useMemo(() => {
    if (!editingReportComments) return null;
    const requests = editingReportComments.filter((c) => c.commentType === "revision_request");
    if (requests.length === 0) return null;
    return requests.reduce((latest, c) =>
      new Date(c.createdAt) > new Date(latest.createdAt) ? c : latest,
    );
  }, [editingReportComments]);

  // Computed period string based on frequency.
  //
  // Activity Reports:
  //   • NEW records (no editingReportRef) → derive YYYY-MM from reportingYear + reportingMonth.
  //   • EXISTING monthly records (stored period matches /^\d{4}-\d{2}$/) → derive YYYY-MM normally.
  //   • EXISTING legacy records (stored period is quarterly "YYYY-Qn", annual "YYYY", or an
  //     on-demand date) → PRESERVE the stored period string verbatim to avoid overwriting
  //     historical period identities on the next PATCH.
  const computedPeriod = useMemo(() => {
    if (isActivity) {
      const storedPeriod = editingReportRef.current
        ? ((editingReportRef.current as unknown as Record<string, unknown>).period as string | undefined)
        : undefined;
      const isLegacy = storedPeriod != null && !/^\d{4}-\d{2}$/.test(storedPeriod);
      if (isLegacy) return storedPeriod!; // preserve historical period identity
      return `${v.reportingYear}-${String(v.reportingMonth).padStart(2, "0")}`;
    }
    if (v.kind === "quarterly") return `${v.reportingYear}-Q${quarter}`;
    if (v.kind === "annual") return String(v.reportingYear);
    if (v.kind === "on_demand") return v.periodStart || String(v.reportingYear);
    return `${v.reportingYear}-${String(v.reportingMonth).padStart(2, "0")}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivity, v.kind, v.reportingMonth, v.reportingYear, v.periodStart, quarter, editingReportRef.current]);

  // ── Auto-populate state/sector/currency from selected project ─────────────
  useEffect(() => {
    if (editingReportRef.current !== null) return; // skip when loading an existing draft
    if (!isProject) return;
    if (!selectedProjectId) {
      // Project cleared — reset restrictions
      setAllowedStateIds([]);
      setAllowedSectors([]);
      setStateFieldLocked(false);
      setSectorFieldLocked(false);
      setProjectCurrency(null);
      setPmrLocationType("state"); // reset location type when project is cleared
      return;
    }
    const proj = projects?.find((p) => p.id === selectedProjectId);
    if (!proj) return;

    // Currency — derived from project, authoritative for all financial display
    const projCurrency = (proj as unknown as Record<string, unknown>).currency as string | undefined;
    setProjectCurrency(projCurrency ?? null);

    // State auto-populate
    // For state-scoped users (SPO/SOM): restrict to the intersection of the project's linked
    // states and the user's own assigned state.  This prevents the UI from showing states the
    // user cannot report for, and ensures the displayed location matches what the server stamps.
    const projStateIds: number[] = proj.stateIds ?? [];
    const effectiveStateIds: number[] = isStateRole && userStateId
      ? projStateIds.filter((id) => id === userStateId)
      : projStateIds;

    if (effectiveStateIds.length === 1) {
      form.setValue("stateId", effectiveStateIds[0]);
      setStateFieldLocked(true);
      setAllowedStateIds(effectiveStateIds);
    } else if (effectiveStateIds.length > 1) {
      form.setValue("stateId", 0); // user must pick from restricted list
      setStateFieldLocked(false);
      setAllowedStateIds(effectiveStateIds);
    } else {
      // No effective states (project not linked to user's state, or project has no states).
      // Only HQ may be valid — do NOT fall back to showing all states.
      form.setValue("stateId", 0);
      setStateFieldLocked(false);
      setAllowedStateIds([]); // empty = project selected, no states allowed
      // HQ-only project: if the project explicitly has HQ as an Operational Location
      // and the user is not state-scoped, auto-select HQ as the sole valid location.
      const projHasHq = (proj as unknown as Record<string, unknown>).hasHqOperations === true;
      if (projHasHq && !isStateRole) {
        setPmrLocationType("hq");
      }
    }

    // Sector auto-populate — prefer `sectors` array, fall back to `sector`
    const projSectors: string[] = (proj.sectors && proj.sectors.length > 0)
      ? proj.sectors
      : (proj.sector ? [proj.sector] : []);
    if (projSectors.length === 1) {
      form.setValue("sector", projSectors[0]);
      setSectorFieldLocked(true);
      setAllowedSectors(projSectors);
    } else if (projSectors.length > 1) {
      form.setValue("sector", ""); // user must pick from restricted list
      setSectorFieldLocked(false);
      setAllowedSectors(projSectors);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, projects]);

  // ── Default PMR kind from the project's Scheduled Reporting Frequency (Task #325)
  // When a project is selected for a NEW PMR, default the kind selector to the
  // project's configured scheduled frequency. Historical projects with a null
  // frequency keep the existing "monthly" default. The user may still change
  // the kind manually afterwards — this only sets the initial value per project.
  useEffect(() => {
    if (editingReportRef.current !== null) return; // never touch kind when editing an existing report
    if (!isProject || !selectedProjectId) return;
    const proj = projects?.find((p) => p.id === selectedProjectId);
    if (!proj) return;
    const projFreq = (proj as unknown as Record<string, unknown>).reportingFrequency as
      | "monthly" | "quarterly" | "annual" | null | undefined;
    form.setValue("kind", projFreq ?? "monthly");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, projects]);

  // ── Auto-load project activities (filtered by selected state when multi-state)
  useEffect(() => {
    if (editingReportRef.current !== null) return; // skip when loading an existing draft
    if (!isProject || !selectedProjectId || !projectActivitiesData) return;
    const selectedStateId = Number(v.stateId) || 0;
    // When reporting for a specific state in a multi-state project, show only that state's activities
    const filtered = (selectedStateId > 0 && allowedStateIds.length > 1)
      ? projectActivitiesData.filter((a) => !a.stateId || a.stateId === selectedStateId)
      : projectActivitiesData;
    setActivities(
      filtered.map((a) => ({
        activityId: a.id,
        name: `${a.code} — ${a.title}`,
        output: a.outputTitle ?? "",
        indicator: a.indicatorId ? `Indicator #${a.indicatorId}` : "",
        stateName: a.stateName ?? "",
        milestone: "",
        status: "In Progress",
        percent: a.progressPct,
        // Preserve null: null means no authoritative budget; 0 means factual zero budget
        plannedBudget: a.budgetPlanned ?? null,
        target: a.target,
        actualExpenditure: "",
        achievementSummary: "",
        beneficiariesMen: "", beneficiariesWomen: "", beneficiariesBoys: "", beneficiariesGirls: "",
        challenges: "", mitigationMeasures: "", nextSteps: "", varianceReason: "",
        isUnplanned: false,
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, projectActivitiesData, v.stateId]);

  // ── Auto-load project indicators into structured progress entries ────────────
  useEffect(() => {
    if (editingReportRef.current !== null) return; // skip when loading an existing draft
    if (!isProject || !selectedProjectId || !projectIndicatorsData) return;
    setIndicatorProgressEntries(
      projectIndicatorsData.map((ind) => ({
        indicatorId: ind.id,
        name: ind.title ?? ind.name ?? `Indicator #${ind.id}`,
        unit: ind.unit,
        target: ind.target,
        cumAchieved: ind.achieved,
        currentAchievement: "",
        remarks: "",
      }))
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, projectIndicatorsData]);

  // ── Auto-generate report title ───────────────────────────────────────────────
  useEffect(() => {
    if (editingReportRef.current !== null) return; // skip when loading an existing draft
    if (!isProject) return;
    const proj = projects?.find((p) => p.id === selectedProjectId);
    const code = proj?.code ?? "";
    const kindLabel = t(`frequency.${v.kind}`);
    const periodStr = v.kind === "quarterly" ? `Q${quarter} ${v.reportingYear}`
      : v.kind === "annual" ? String(v.reportingYear)
      : v.kind === "on_demand" ? t("frequency.on_demand")
      : `${new Date(2000, v.reportingMonth - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })} ${v.reportingYear}`;
    const auto = code
      ? t("form.projectAutoTitle", { code, frequency: kindLabel, period: periodStr })
      : t("form.projectAutoTitleWithoutCode", { frequency: kindLabel, period: periodStr });
    const current = form.getValues("title");
    if (current === "" || current === autoTitleRef.current) {
      form.setValue("title", auto);
      autoTitleRef.current = auto;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, v.kind, v.reportingMonth, v.reportingYear, quarter, projects, i18n.language, t]);

  // ── Auto-generate report title for Activity Reports ─────────────────────────
  // Uses the Report Subject (activityName) as the primary identity — works in
  // all three link modes (standalone, activity-linked, project-linked).
  useEffect(() => {
    if (editingReportRef.current !== null) return;
    if (!isActivity) return;
    const subject = v.activityName?.trim();
    if (!subject) return; // no subject yet — don't overwrite a blank title with a partial auto-title
    const periodStr = `${new Date(2000, v.reportingMonth - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })} ${v.reportingYear}`;
    const auto = t("form.activityAutoTitle", { subject, period: periodStr });
    const current = form.getValues("title");
    if (current === "" || current === autoTitleRef.current) {
      form.setValue("title", auto);
      autoTitleRef.current = auto;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivity, v.activityName, v.reportingMonth, v.reportingYear, i18n.language, t]);

  // ── Auto-fill state for single-state users (scope-based, not role-based) ──────
  useEffect(() => {
    if (!isActivity || !singleStateUser || !autoLockedStateId) return;
    if (editingReportRef.current !== null) return;
    form.setValue("stateId", autoLockedStateId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActivity, singleStateUser, autoLockedStateId]);

  // ── Reset tab to Basic Information when dialog closes ──────────────────────
  useEffect(() => {
    if (!createOpen) setActiveSection(isActivity ? "ar-section-basic" : "rp-section-basic");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createOpen]);

  // ── Duplicate check (debounced) ──────────────────────────────────────────────
  useEffect(() => {
    if (!isProject || !selectedProjectId) { setDupCheck(null); return; }
    const isHqMode = pmrLocationType === "hq";
    // For state mode: require stateId; for HQ mode: trigger immediately
    if (!isHqMode && !v.stateId) { setDupCheck(null); return; }
    if (dupCheckTimerRef.current) clearTimeout(dupCheckTimerRef.current);
    dupCheckTimerRef.current = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          projectId: String(selectedProjectId),
          frequency: v.kind,
          period: computedPeriod,
        });
        if (isHqMode) {
          params.set("locationType", "hq");
        } else {
          params.set("stateId", String(v.stateId));
        }
        const res = await fetch(`/api/reports/duplicate-check?${params}`);
        if (res.ok) {
          const data = await res.json() as DupCheckResult;
          setDupCheck(data);
          if (data.matchType === "exact") setDupCheckOpen(true);
        }
      } catch { /* ignore network errors */ }
    }, 700);
    return () => { if (dupCheckTimerRef.current) clearTimeout(dupCheckTimerRef.current); };
  }, [isProject, selectedProjectId, v.stateId, v.kind, computedPeriod, pmrLocationType]);

  // For project reports: aggregate beneficiaries & budget from activity rows
  const projectBenTotal = isProject
    ? activities.reduce((s, a) => s + Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0), 0)
    : 0;

  // Linked-activity financials — only sum non-null authoritative planned budgets.
  // null plannedBudget means no authoritative figure; exclude from totals.
  // Unplanned activities (isUnplanned=true) are excluded from linked totals.
  const linkedActivities = isProject ? activities.filter((a) => !a.isUnplanned) : [];
  const unplannedActivities = isProject ? activities.filter((a) => !!a.isUnplanned) : [];

  // Sum only activities where plannedBudget is a real number (not null)
  const hasAnyLinkedPlanned = linkedActivities.some((a) => a.plannedBudget != null);
  const projectTotalPlanned = hasAnyLinkedPlanned
    ? linkedActivities.reduce((s, a) => s + (a.plannedBudget ?? 0), 0)
    : null; // null = no authoritative planned budget available
  const projectTotalActual = linkedActivities.reduce((s, a) => s + Number(a.actualExpenditure || 0), 0);
  const unplannedTotalActual = unplannedActivities.reduce((s, a) => s + Number(a.actualExpenditure || 0), 0);

  // Utilisation — only when denominator > 0; null means "unavailable / not meaningful"
  const projectUtilizationPct: number | null =
    projectTotalPlanned != null && projectTotalPlanned > 0
      ? Math.round((projectTotalActual / projectTotalPlanned) * 100)
      : null;
  const projectVariance: number | null =
    projectTotalPlanned != null ? projectTotalPlanned - projectTotalActual : null;

  // For non-project types: manual beneficiary entry totals
  const beneficiariesTotal = Number(v.beneficiariesMale || 0) + Number(v.beneficiariesFemale || 0) + Number(v.beneficiariesBoys || 0) + Number(v.beneficiariesGirls || 0);

  // Infer hasBeneficiaryReach for Activity Reports (display-only — does not write back to DB).
  // Explicit choice in sectionValues wins; historical records without the key infer from counts.
  const hasBeneficiaryReachValue: "yes" | "no" = isActivity
    ? (sectionValues["hasBeneficiaryReach"] === "yes" || sectionValues["hasBeneficiaryReach"] === "no"
        ? (sectionValues["hasBeneficiaryReach"] as "yes" | "no")
        : beneficiariesTotal > 0 ? "yes" : "no")
    : "yes";

  // Infer hasChallenges for Activity Reports (display-only — does not write back to DB on open).
  // Explicit choice in sectionValues wins ("yes" | "no").
  // Historical records: non-empty challenges text → infer "yes".
  // Historical blank challenges → undefined (unset; do NOT force "No").
  const hasChallengesValue: "yes" | "no" | undefined = isActivity
    ? (sectionValues["hasChallenges"] === "yes" || sectionValues["hasChallenges"] === "no"
        ? (sectionValues["hasChallenges"] as "yes" | "no")
        : (sectionValues["challenges"] || "").trim() ? "yes" : undefined)
    : undefined;

  // Clear selected activity when project changes (prevents cross-project activity selection).
  // During draft hydration, loadDraftForEdit sets skipNextActivityClearRef so the restore
  // ── Activity-Report: clear selected activity when the project filter changes ──
  // Previously this effect was on selectedProjectId; now the project filter (not form.projectId)
  // drives the activity list for Activity Reports. The skipNextActivityClearRef protects
  // draft hydration from clearing activityId during the initial filter restore.
  useEffect(() => {
    if (!isActivity) return;
    if (skipNextActivityClearRef.current) {
      skipNextActivityClearRef.current = false;
      return;
    }
    setActivityId(null);
    form.setValue("projectId", 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectFilterId]);

  // For Activity Reports: when state changes, clear project/activity selections that are no
  // longer valid under the new state filter (avoids server rejecting an out-of-scope combination).
  const selectedStateId = Number(v.stateId) || 0;
  useEffect(() => {
    if (!isActivity || editingReportRef.current !== null) return;
    if (!selectedStateId) return; // no state chosen yet — nothing to invalidate
    // Clear project if it doesn't include the new state
    if (v.projectId) {
      const proj = projects?.find((p) => p.id === Number(v.projectId));
      if (proj && !(proj.stateIds ?? []).includes(selectedStateId)) {
        form.setValue("projectId", 0);
        // activityId will auto-clear via the selectedProjectId effect
      }
    }
    // Clear activity if it has an explicit state that no longer matches
    if (activityId && activitiesData) {
      const act = activitiesData.find((a) => a.id === activityId);
      if (act && act.stateId && Number(act.stateId) !== selectedStateId) {
        setActivityId(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedStateId]);

  const resetForm = useCallback(() => {
    editingReportRef.current = null;
    setEditingReport(null);
    setSectionValues({});
    setActivities([emptyActivity()]);
    setPendingVoiceNote(null);
    setAllowedStateIds([]);
    setAllowedSectors([]);
    setStateFieldLocked(false);
    setSectorFieldLocked(false);
    setProjectCurrency(null);
    setQuarter(1);
    setOnDemandReason("");
    setActivityId(null);
    setLinkMode("standalone");
    setReportLocationType("state");
    setPmrLocationType("state"); // reset PMR location type to prevent leaking between forms
    setRiskStatusEdits({});
    setIndicatorProgressEntries([]);
    setDupCheck(null);
    setDupCheckOpen(false);
    setSupportingDocs([]);
    setSavedAttachments([]);
    setDocsError("");
    setDocsNoSupport(false);
    setDocsNoSupportReason("");
    setIsFormDirty(false);
    setShowDiscardConfirm(false);
    setTabErrors({});
    setFieldErrors({});
    setVoiceNoteRetry(null);
    setActiveSection(isActivity ? "ar-section-basic" : "rp-section-basic");
    setProjectComboOpen(false);
    setActivityComboOpen(false);
    setProjectFilterId(0);
    autoTitleRef.current = "";
    // Step 5 Activity Report state
    setArRecommendations("");
    setShowSuccessStory(false);
    setShowCoordinationUpdates(false);
    setShowCommunityFeedback(false);
    setRemoveInsightConfirm(null);
    form.reset();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const localFormSnapshot = useMemo<LocalReportFormSnapshot>(() => ({
    values: form.getValues(),
    sectionValues,
    activities,
    activeSection,
    activityId,
    quarter,
    onDemandReason,
    arRecommendations,
    linkMode,
    reportLocationType,
    pmrLocationType,
    projectFilterId,
    indicatorProgressEntries,
    riskStatusEdits,
    docsNoSupport,
    docsNoSupportReason,
    showSuccessStory,
    showCoordinationUpdates,
    showCommunityFeedback,
  }), [
    activeSection, activities, activityId, arRecommendations, docsNoSupport,
    docsNoSupportReason, form, indicatorProgressEntries, linkMode,
    onDemandReason, pmrLocationType, projectFilterId, quarter, reportLocationType,
    riskStatusEdits, sectionValues, showCommunityFeedback, showCoordinationUpdates, showSuccessStory,
  ]);

  const restoreLocalFormSnapshot = useCallback((snapshot: LocalReportFormSnapshot) => {
    const permittedProjectIds = new Set((projects ?? []).map((project) => project.id));
    const permittedStateIds = new Set(visibleStates.map((state) => state.id));
    const permittedActivityIds = new Set((authorisedActivities ?? []).map((activity) => activity.id));
    const projectId = Number(snapshot.values.projectId);
    const safeProjectId = projectId && permittedProjectIds.has(projectId) ? projectId : 0;
    const stateId = Number(snapshot.values.stateId);
    const safeStateId = stateId && permittedStateIds.has(stateId) ? stateId : 0;
    const requestedActivityId = snapshot.activityId ?? null;
    const safeActivityId = requestedActivityId && permittedActivityIds.has(requestedActivityId)
      ? requestedActivityId
      : null;
    const safeProjectFilterId = snapshot.projectFilterId && permittedProjectIds.has(snapshot.projectFilterId)
      ? snapshot.projectFilterId
      : 0;

    form.reset({ ...snapshot.values, projectId: safeProjectId, stateId: safeStateId });
    setSectionValues(snapshot.sectionValues ?? {});
    setActivities(snapshot.activities?.length
      ? snapshot.activities.map((activity) => ({
          ...activity,
          relatedProjectId: activity.relatedProjectId && !permittedProjectIds.has(Number(activity.relatedProjectId))
            ? ""
            : activity.relatedProjectId,
          stateId: activity.stateId && !permittedStateIds.has(Number(activity.stateId))
            ? ""
            : activity.stateId,
          activityId: activity.activityId && !permittedActivityIds.has(activity.activityId)
            ? undefined
            : activity.activityId,
        }))
      : [emptyActivity()]);
    setActiveSection(snapshot.activeSection ?? (isActivity ? "ar-section-basic" : "rp-section-basic"));
    setActivityId(safeActivityId);
    setQuarter(snapshot.quarter ?? 1);
    setOnDemandReason(snapshot.onDemandReason ?? "");
    setArRecommendations(snapshot.arRecommendations ?? "");
    setLinkMode(requestedActivityId && !safeActivityId ? "standalone" : (snapshot.linkMode ?? "standalone"));
    setReportLocationType(snapshot.reportLocationType ?? "state");
    setPmrLocationType(snapshot.pmrLocationType ?? "state");
    setProjectFilterId(safeProjectFilterId);
    // These references are scoped to the selected project and load only after
    // hydration. Do not retain stale IDs from an earlier authorisation scope.
    setIndicatorProgressEntries([]);
    setRiskStatusEdits({});
    setDocsNoSupport(Boolean(snapshot.docsNoSupport));
    setDocsNoSupportReason(snapshot.docsNoSupportReason ?? "");
    setShowSuccessStory(Boolean(snapshot.showSuccessStory));
    setShowCoordinationUpdates(Boolean(snapshot.showCoordinationUpdates));
    setShowCommunityFeedback(Boolean(snapshot.showCommunityFeedback));
    setIsFormDirty(false);
  }, [authorisedActivities, form, isActivity, projects, visibleStates]);

  const editingRevisionValue = (editingReport as unknown as { updatedAt?: unknown } | null)?.updatedAt;
  const editingBaseRevision = editingRevisionValue instanceof Date
    ? editingRevisionValue.toISOString()
    : typeof editingRevisionValue === "string" ? editingRevisionValue : null;

  const localDraft = useOfflineReportDraft({
    draftKey: reportDraftKey(
      (isActivity ? "activity" : "project"),
      editingReport ? `server:${editingReport.id}` : "new",
    ),
    reportType: isActivity ? "activity" : "project",
    serverReportId: editingReport?.id ?? null,
    baseRevision: editingBaseRevision,
    title: v.title,
    snapshot: localFormSnapshot,
    onRestore: restoreLocalFormSnapshot,
    enabled: createOpen
      && !isProgramState
      && !isHqSector
      && projects !== undefined
      && states !== undefined
      && authorisedActivities !== undefined,
  });

  // ── Fetch attachments for the submitted-detail Sheet (project/program_state/hq_sector) ────
  useEffect(() => {
    if (!selected || selected.reportType === "activity") {
      setDetailAttachments([]);
      setDetailAttachmentsLoading(false);
      setDetailAttachmentsError(false);
      return;
    }
    setDetailAttachments([]);
    setDetailAttachmentsLoading(true);
    setDetailAttachmentsError(false);
    fetch(`/api/reports/${selected.id}/attachments`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<SavedAttachment[]>) : []))
      .then((atts) => { setDetailAttachments(atts); setDetailAttachmentsLoading(false); })
      .catch(() => { setDetailAttachmentsLoading(false); setDetailAttachmentsError(true); });
  }, [selected]);

  // ── Link Mode switch — clears stale identity fields on mode change ────────────
  function handleLinkModeChange(mode: "standalone" | "activity" | "project") {
    if (mode === linkMode) return;
    if (mode === "standalone") {
      setActivityId(null);
      form.setValue("projectId", 0);
      setProjectFilterId(0);
    } else if (mode === "activity") {
      // Clear project and activity so user picks fresh in the new mode.
      form.setValue("projectId", 0);
      setActivityId(null);
      setProjectFilterId(0);
    } else if (mode === "project") {
      setActivityId(null);
      form.setValue("projectId", 0);
      setProjectFilterId(0);
    }
    setLinkMode(mode);
    setFieldErrors((cur) => ({ ...cur, activityId: undefined, projectId: undefined }));
  }

  // ── Draft Edit Mode ──────────────────────────────────────────────────────────

  function loadDraftForEdit(report: Report) {
    editingReportRef.current = report;
    setEditingReport(report);
    setRevisionBannerDismissed(false);
    // Brief skeleton to cover hydration lag when switching into edit mode
    setIsLoadingEditForm(true);
    setTimeout(() => setIsLoadingEditForm(false), 400);
    const r = report as Report & Record<string, unknown>;

    // Activity Reports: reset combobox state before form.reset so a clean slate is visible.
    if (isActivity) {
      setProjectComboOpen(false);
      setActivityComboOpen(false);
    }

    form.reset({
      title: report.title ?? "",
      // For Activity Reports: preserve the historically stored kind exactly.
      // New Activity Reports (no stored kind) fall back to the compatibility default "monthly".
      // For other report types: continue using stored kind with monthly fallback.
      kind: (r.kind as string) ?? "monthly",
      reportingMonth: (report.reportingMonth as number | undefined) ?? (new Date().getMonth() + 1),
      reportingYear: (report.reportingYear as number | undefined) ?? new Date().getFullYear(),
      periodStart: (() => {
        const raw = report.periodStart as string | undefined;
        if (!raw) return "";
        return raw.length > 10 ? raw.slice(0, 10) : raw;
      })(),
      periodEnd: (() => {
        const raw = report.periodEnd as string | undefined;
        if (!raw) return "";
        return raw.length > 10 ? raw.slice(0, 10) : raw;
      })(),
      sector: report.sector ?? "",
      submittedTo: (report.submittedTo as string | undefined) ?? "",
      projectId: (report.projectId as number | undefined) ?? 0,
      stateId: (report.stateId as number | undefined) ?? 0,
      beneficiariesMale: (report.beneficiariesMale as number | undefined) ?? 0,
      beneficiariesFemale: (report.beneficiariesFemale as number | undefined) ?? 0,
      beneficiariesBoys: (report.beneficiariesBoys as number | undefined) ?? 0,
      beneficiariesGirls: (report.beneficiariesGirls as number | undefined) ?? 0,
      plannedBudget: 0,
      actualExpenditure: 0,
      quarter: 1,
      onDemandReason: (r.onDemandReason as string | undefined) ?? "",
      activityName: (r.activityName as string | undefined) ?? "",
    });

    if (r.quarter) setQuarter(Number(r.quarter));
    if (r.onDemandReason) setOnDemandReason(String(r.onDemandReason));
    if (isActivity) {
      const rr = r as Record<string, unknown>;

      // FIX-07: For legacy records with no activityName, derive a display fallback
      // from the linked entity so the user sees a meaningful subject rather than a blank field.
      // Preference order: stored activityName → linked Activity title → report title → linked Project title.
      // The fallback is only pre-populated for legacy records; modern records leave activityName empty
      // so the user is prompted to fill it in.
      const _legacySections = (report.sections ?? {}) as Record<string, unknown>;
      const _isLegacyLoad = _legacySections.implementationSummary === undefined &&
                            _legacySections.implementationStatus === undefined;
      const derivedActivityName =
        (rr.activityName as string | undefined)?.trim() ||
        (_isLegacyLoad
          ? ((rr.activityTitle as string | undefined)?.trim() ||
             (r.title as string | undefined)?.trim() ||
             (rr.projectTitle as string | undefined)?.trim() ||
             "")
          : "");
      if (derivedActivityName) {
        form.setValue("activityName", derivedActivityName);
      }

      // Infer link mode from stored identifiers:
      //   activityId present                    → "activity"
      //   projectId present but no activityId   → "project"
      //   neither                               → "standalone"
      if (rr.activityId) {
        setLinkMode("activity");
        // Restore optional project filter so activities for that project load.
        // Set skipNextActivityClearRef BEFORE setProjectFilterId so the filter-change
        // effect does not clobber the activityId we are about to restore.
        if (rr.projectId) {
          skipNextActivityClearRef.current = true;
          setProjectFilterId(Number(rr.projectId));
        } else {
          setProjectFilterId(0);
        }
        setActivityId(Number(rr.activityId));
      } else if (rr.projectId) {
        setLinkMode("project");
        setProjectFilterId(0);
        // form.projectId already populated via form.reset above
      } else {
        setLinkMode("standalone");
        setProjectFilterId(0);
      }

      // Restore HQ location type for standalone activity reports
      setReportLocationType(r.locationType === "hq" ? "hq" : "state");

      // Restore Step 5 Activity Report fields
      // recommendations is a top-level column (not JSONB sections)
      if (typeof r.recommendations === "string" && (r.recommendations as string).trim()) {
        setArRecommendations((r.recommendations as string).trim());
      } else {
        setArRecommendations("");
      }
      // Auto-reveal optional Supporting Insights sections if content exists
      const sec = (report.sections ?? {}) as Record<string, string>;
      if (sec["successStory"]?.trim())        setShowSuccessStory(true);
      if (sec["coordinationUpdates"]?.trim()) setShowCoordinationUpdates(true);
      if (sec["communityFeedback"]?.trim())   setShowCommunityFeedback(true);
    }
    // Navigate to the correct first step for this report type (must match the active nav items)
    setActiveSection(isActivity ? "ar-section-basic" : "rp-section-basic");
    if (report.sections && typeof report.sections === "object") {
      setSectionValues(report.sections as Record<string, string>);
    }
    if (Array.isArray(report.activities) && report.activities.length > 0) {
      setActivities(report.activities as ActivityRow[]);
    } else {
      setActivities([emptyActivity()]);
    }
    if (Array.isArray(r.indicatorProgress) && r.indicatorProgress.length > 0) {
      setIndicatorProgressEntries(r.indicatorProgress as IndicatorProgressEntry[]);
    }
    // Restore bypass docs state if it was recorded in sections
    const existingBypassReason = (report.sections as Record<string, string> | null | undefined)?.docsNoSupportReason;
    if (existingBypassReason) {
      setDocsNoSupport(true);
      setDocsNoSupportReason(existingBypassReason);
    }
    // Restore project currency from the linked project (will be set by the project effect when projectId is set)
    const projId = report.projectId as number | undefined;
    if (projId && projects) {
      const proj = projects.find((p) => p.id === projId);
      if (proj) setProjectCurrency((proj as unknown as Record<string, unknown>).currency as string | null ?? null);
    }

    // ── PMR: restore location type and populate allowedStateIds ─────────────
    // The auto-population effect skips edits (editingReportRef.current !== null),
    // so we must restore these manually here to avoid broken/empty location selectors.
    if (isProject && projId) {
      // Restore pmrLocationType from the stored locationType field
      const storedLocType: "hq" | "state" = r.locationType === "hq" ? "hq" : "state";
      setPmrLocationType(storedLocType);

      // Populate allowedStateIds from the linked project's stateIds
      const proj = projects?.find((p) => p.id === projId);
      const projStateIds: number[] = (proj as unknown as Record<string, unknown>)?.stateIds as number[] ?? [];

      // For state-scoped users, intersect with their assigned state (same rule as create flow)
      const effectiveStateIds: number[] = isStateRole && userStateId
        ? projStateIds.filter((id) => id === userStateId)
        : projStateIds;

      setAllowedStateIds(effectiveStateIds);
      // Lock the field when there's exactly one effective state AND the user is not in HQ mode
      setStateFieldLocked(effectiveStateIds.length === 1 && storedLocType !== "hq");
    }
    setIsFormDirty(false);
    setCreateOpen(true);
    // Fetch already-saved attachments for this draft so they show in the UI.
    setSavedAttachments([]);
    if (report.id) {
      fetch(`/api/reports/${report.id}/attachments`, { credentials: "include" })
        .then((res) => (res.ok ? (res.json() as Promise<SavedAttachment[]>) : []))
        .then((atts) => setSavedAttachments(atts))
        .catch(() => { /* ignore — attachments section shows empty */ });
    }
  }

  // Alternate record views are memoised. Keep their action callback stable while
  // always invoking the latest hydration function and current form context.
  loadDraftForEditRef.current = loadDraftForEdit;
  const startDraftEditing = useCallback((report: Report) => {
    loadDraftForEditRef.current(report);
  }, []);

  function resumeDraftFromViewer(report: Report) {
    // The shared viewer reports its animation completion before the form opens,
    // so focus restoration and dialog overlays never compete.
    setDraftToResumeAfterViewerClose(report);
    setSelected(null);
  }

  function completeReportViewerClose() {
    if (!draftToResumeAfterViewerClose) return;
    const draft = draftToResumeAfterViewerClose;
    setDraftToResumeAfterViewerClose(null);
    startDraftEditing(draft);
  }

  /** Upload all pending supportingDocs to storage and record them against the report.
   *  Docs that upload successfully are moved to savedAttachments; failures stay pending. */
  async function uploadPendingSupportingDocs(reportId: number): Promise<void> {
    if (supportingDocs.length === 0) return;
    const successIndices = new Set<number>();
    const newSaved: SavedAttachment[] = [];
    for (let i = 0; i < supportingDocs.length; i++) {
      const doc = supportingDocs[i];
      try {
        const urlRes = await fetch("/api/storage/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ name: doc.file.name, size: doc.file.size, contentType: doc.file.type || "application/octet-stream", reportId, entityType: "attachment" }),
        });
        if (!urlRes.ok) continue;
        const { uploadURL, uploadToken } = await urlRes.json() as { uploadURL: string; uploadToken?: string };
        const putRes = await fetch(uploadURL, { method: "PUT", body: doc.file, headers: { "Content-Type": doc.file.type || "application/octet-stream" } });
        if (!putRes.ok) {
          toast.error(t("form.uploadFailed", { fileName: doc.file.name }));
          continue;
        }
        const recRes = await fetch(`/api/reports/${reportId}/attachments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ fileName: doc.file.name, uploadToken }),
        });
        if (recRes.ok) {
          newSaved.push(await recRes.json() as SavedAttachment);
          successIndices.add(i);
        }
      } catch { /* skip this file — leave it in pending so the user can retry */ }
    }
    if (newSaved.length > 0) {
      setSavedAttachments((cur) => [...cur, ...newSaved]);
      setSupportingDocs((cur) => cur.filter((_, idx) => !successIndices.has(idx)));
    }
  }

  async function handleDeleteReport(report: Report) {
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) {
        const e = await res.json() as { error?: string };
        throw new Error(e.error ?? "Failed to delete draft");
      }
      toast.success(t("form.draftDeleted"));
      qc.invalidateQueries();
      setDeleteTarget(null);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleDuplicateReport(report: Report) {
    try {
      const r = report as Report & Record<string, unknown>;
      // Activity Reports: always use "monthly" as kind for copies so every copy is a
      // coherent, self-consistent record (YYYY-MM period + monthly semantics).
      // Preserving the source's legacy kind (quarterly/annual/on_demand) would require
      // the full copy contract — correct period format, all metadata fields — which is
      // implemented in task #179. For now, copies start fresh as monthly records.
      // Non-Activity types: preserve the source kind as before.
      const dupKind = isActivity ? "monthly" : ((r.kind as string) ?? "monthly");
      // Activity Reports: derive the copy period from stored month/year (fallback to today).
      // Note: legacy quarterly/annual Activity Reports with null reportingMonth will receive
      // today's month as a fallback here, producing a YYYY-MM period in the copy. Correct
      // legacy copy behaviour (preserving the original YYYY-Qn / YYYY period) is deferred
      // to task #179 which handles the full copy-flow contract for historical records.
      const dupReportingMonth = isActivity
        ? ((report.reportingMonth as number | undefined) ?? (new Date().getMonth() + 1))
        : (report.reportingMonth as number | undefined);
      const dupReportingYear = isActivity
        ? ((report.reportingYear as number | undefined) ?? new Date().getFullYear())
        : (report.reportingYear as number | undefined);
      const dupPeriod = isActivity
        ? `${dupReportingYear}-${String(dupReportingMonth).padStart(2, "0")}`
        : report.period;
      const payload = {
        title: `Copy of ${report.title}`,
        kind: dupKind,
        reportType: lockedType,
        sector: report.sector,
        stateId: report.stateId as number | undefined,
        projectId: report.projectId as number | undefined,
        activityId: (r.activityId as number | undefined) ?? undefined,
        reportingMonth: dupReportingMonth,
        reportingYear: dupReportingYear,
        period: dupPeriod,
        periodStart: isActivity ? undefined : (report.periodStart as string | undefined),
        periodEnd: isActivity ? undefined : (report.periodEnd as string | undefined),
        sections: report.sections,
        activities: report.activities,
        beneficiariesMale: report.beneficiariesMale as number | undefined,
        beneficiariesFemale: report.beneficiariesFemale as number | undefined,
        beneficiariesBoys: report.beneficiariesBoys as number | undefined,
        beneficiariesGirls: report.beneficiariesGirls as number | undefined,
        plannedBudget: report.plannedBudget as number | undefined,
        actualExpenditure: report.actualExpenditure as number | undefined,
      };
      await createMutation.mutateAsync({ data: payload as never });
      toast.success(t("form.draftDuplicated"));
      qc.invalidateQueries();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function handleDirectSubmit(report: Report) {
    try {
      await transitionMutation.mutateAsync({ reportId: report.id, data: { action: "submit" } });
      toast.success(t("form.submittedForReview"));
      qc.invalidateQueries();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  }

  async function uploadVoiceNote(note: PendingNote, reportId: number) {
    const ext = note.mimeType.includes("ogg") ? "ogg" : note.mimeType.includes("mp4") ? "m4a" : "webm";
    const fileName = `voice-note-report-${reportId}-${Date.now()}.${ext}`;

    // 1. Request presigned upload URL — throw on non-2xx so caller can trigger retry state.
    const presignRes = await fetch("/api/storage/uploads/request-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ name: fileName, size: note.blob.size, contentType: note.mimeType, reportId, entityType: "voice_note" }),
    });
    if (!presignRes.ok) {
      const e = await presignRes.json().catch(() => ({})) as { message?: string };
      throw new Error(e.message ?? "Failed to request voice note upload URL.");
    }
    const { uploadURL, uploadToken } = await presignRes.json() as { uploadURL: string; objectPath: string; uploadToken?: string };

    // 2. Upload blob to storage — throw on non-2xx; blob is NOT revoked so retry can re-upload.
    const putRes = await fetch(uploadURL, { method: "PUT", body: note.blob, headers: { "Content-Type": note.mimeType } });
    if (!putRes.ok) {
      throw new Error("Voice note upload to storage failed. The recording is preserved — use Retry Upload.");
    }

    // 3. Record metadata — throw on non-2xx; blob still not revoked.
    const metaRes = await fetch("/api/voice-notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ entityType: "report", entityId: reportId, fileName, uploadToken, durationSeconds: note.durationSeconds }),
    });
    if (!metaRes.ok) {
      const e = await metaRes.json().catch(() => ({})) as { error?: string };
      throw new Error(e.error ?? "Failed to save voice note record.");
    }

    // 4. All steps succeeded — safe to release the local blob URL.
    URL.revokeObjectURL(note.blobUrl);
  }

  // ── Pure payload builder — no validation, no toasts ────────────────────────
  function buildPayloadData(values: FormShape) {
    const cleanActivities = activities.filter((a) => a.name && a.name.trim());

    const mappedActivities = cleanActivities.map((a) => ({
      ...a,
      percent: a.percent === "" ? null : Number(a.percent),
      budget: a.budget === "" ? undefined : Number(a.budget || 0),
      beneficiaries: a.beneficiaries === "" ? undefined : Number(a.beneficiaries || 0),
      // Preserve null for unset actual expenditure in drafts; 0 is factual zero
      actualExpenditure: a.actualExpenditure === "" ? null : Number(a.actualExpenditure ?? 0),
      beneficiariesMen: a.beneficiariesMen === "" ? null : Number(a.beneficiariesMen || 0),
      beneficiariesWomen: a.beneficiariesWomen === "" ? null : Number(a.beneficiariesWomen || 0),
      beneficiariesBoys: a.beneficiariesBoys === "" ? null : Number(a.beneficiariesBoys || 0),
      beneficiariesGirls: a.beneficiariesGirls === "" ? null : Number(a.beneficiariesGirls || 0),
    }));

    // FIX-07: Preserve only UNKNOWN legacy section keys from the stored record.
    // Known keys (all keys the current form manages) are rebuilt entirely from the current
    // form state. This preserves correct clear semantics: an empty/cleared known field is
    // absent from the payload, so the API replaces the sections JSONB without that key.
    // Unknown keys (not in knownSectionKeys) survive the round-trip unchanged.
    const existingSections: Record<string, unknown> =
      (((editingReportRef.current as unknown) as Record<string, unknown>)?.sections as Record<string, unknown>) ?? {};

    // All section keys the current form knows about — derived dynamically from sectionsCfg.
    const knownSectionKeys = new Set<string>([
      ...sectionsCfg.progress.map((f) => f.key),
      ...sectionsCfg.challenges.map((f) => f.key),
      ...(sectionsCfg.narrative ?? []).map((f) => f.key),
      "hasBeneficiaryReach", // Activity-specific toggle (managed below)
      "hasChallenges",       // Activity-specific toggle (managed below)
      "resultsAchieved",     // Activity-specific free-text (managed via sectionValues)
      "_schemaVersion",      // FIX-07: schema marker written for all modern records (see below)
    ]);

    const sectionsPayload: Record<string, unknown> = {};

    // Step 1: Copy unknown legacy keys from stored sections (legacy preservation only).
    // Known keys are NOT copied here — they are rebuilt from current form state in Step 2.
    for (const [k, v] of Object.entries(existingSections)) {
      if (!knownSectionKeys.has(k)) {
        sectionsPayload[k] = v;
      }
    }

    // Step 2: Write known keys from current form state.
    // Cleared known fields (empty/blank sectionValues entry) are intentionally omitted —
    // their absence in the payload causes the API to remove them from stored sections.
    for (const [k, val] of Object.entries(sectionValues)) {
      if (val && val.trim()) sectionsPayload[k] = val.trim();
    }

    if (isActivity) {
      if (compatProfile.explicitBeneficiaryToggle) {
        // Modern records: always write the canonical toggle value so future reads can distinguish
        // an explicit N/A choice from legacy missing data.
        sectionsPayload["hasBeneficiaryReach"] = hasBeneficiaryReachValue;
      } else {
        // FIX-07 Legacy records: only write hasBeneficiaryReach if the user explicitly chose.
        // An inferred value (from beneficiary counts) must NOT be persisted as an explicit toggle
        // — that would silently mutate the historical meaning of the record.
        const userExplicitlyChoseBenToggle =
          sectionValues["hasBeneficiaryReach"] === "yes" ||
          sectionValues["hasBeneficiaryReach"] === "no";
        if (userExplicitlyChoseBenToggle) {
          sectionsPayload["hasBeneficiaryReach"] = hasBeneficiaryReachValue;
        }
        // Otherwise: leave as-is from existingSections merge (preserves absent/undefined history).
      }
    }

    // Persist hasChallenges only when the user has made an explicit choice (or it was inferred
    // as "yes" from existing challenge text). Never write "undefined" back — that would mask the
    // distinction between "never answered" and "answered No".
    if (isActivity && hasChallengesValue !== undefined) {
      if (compatProfile.explicitChallengeToggle) {
        // Modern records: write both yes and no.
        sectionsPayload["hasChallenges"] = hasChallengesValue;
      } else {
        // FIX-07 Legacy records: only persist "yes" (inferred from real challenge text).
        // Never write "no" for legacy records — blank challenge history must remain absent.
        if (hasChallengesValue === "yes") {
          sectionsPayload["hasChallenges"] = hasChallengesValue;
        }
        // "no" / legacy-empty: leave as-is from existingSections merge.
      }
    }

    // FIX-07: Write a schema marker for all non-legacy Activity Reports (and for Activity
    // Reports whose sections are being updated for the first time post-FIX-07).
    // The marker makes the isLegacyRecord discriminator reliable: new drafts get it on their
    // very first save (POST), so reopening them treats them as modern regardless of whether
    // the user filled in implementationSummary yet. Legacy records never receive the marker
    // until the user explicitly types modern-required content, ensuring the compatibility
    // exemption persists across Save Draft cycles for true historical records.
    if (isActivity && !isLegacyRecord) {
      sectionsPayload["_schemaVersion"] = "modern";
    }

    // Supporting-document bypass flags — written into sections so both the Save Draft and
    // Submit paths persist and restore them correctly.  These are managed as separate React
    // state variables (not in sectionValues) so they must be explicitly merged here.
    // The server-side submit validator reads sections["docsNoSupport"] === true and
    // sections["docsNoSupportReason"] to decide whether the evidence requirement is met.
    if (docsNoSupport) {
      sectionsPayload["docsNoSupport"] = true;
      if (docsNoSupportReason.trim()) {
        sectionsPayload["docsNoSupportReason"] = docsNoSupportReason.trim();
      }
    } else {
      // Explicitly clear any previously stored bypass when the user unchecks the box
      // so stale bypass flags can't survive a Save Draft → edit cycle.
      delete sectionsPayload["docsNoSupport"];
      delete sectionsPayload["docsNoSupportReason"];
    }

    // ── Legacy Activity period detection ─────────────────────────────────────
    // Must be computed BEFORE the period string is derived so that both the
    // period value and the reportingMonth/Year fields can be overridden together.
    // Legacy Activity Reports: stored period is not YYYY-MM (e.g. "2025-Q2", "2025",
    // "2026-03-01").  Their DB rows have null reportingMonth/reportingYear; hydration
    // substituted today's date as a fallback.  We must NOT write the fabricated values
    // back — doing so would permanently corrupt the historical period identity.
    const editingStoredPeriod = editingReportRef.current
      ? ((editingReportRef.current as unknown as Record<string, unknown>).period as string | undefined)
      : undefined;
    const isLegacyActivityEdit = isActivity && editingStoredPeriod != null && !/^\d{4}-\d{2}$/.test(editingStoredPeriod);

    let period: string;
    if (isLegacyActivityEdit) {
      // Preserve the stored non-YYYY-MM period verbatim — same guard as computedPeriod.
      period = editingStoredPeriod!;
    } else if (isActivity) {
      // Activity Reports always use YYYY-MM period regardless of the stored `kind` value.
      // A historical quarterly/annual AR with a YYYY-MM stored period (e.g. "2026-08")
      // must NOT be rewritten to "2026-Q1"/"2026" by falling into the kind branches below.
      period = `${values.reportingYear}-${String(values.reportingMonth).padStart(2, "0")}`;
    } else if (values.kind === "quarterly") {
      period = `${values.reportingYear}-Q${quarter}`;
    } else if (values.kind === "annual") {
      period = String(values.reportingYear);
    } else if (values.kind === "on_demand") {
      // Never invent a date — only use explicitly provided period start
      period = values.periodStart || String(values.reportingYear);
    } else {
      period = `${values.reportingYear}-${String(values.reportingMonth).padStart(2, "0")}`;
    }

    const benMale   = isProject ? activities.reduce((s, a) => s + Number(a.beneficiariesMen || 0), 0)   : (isActivity && hasBeneficiaryReachValue === "no" ? null : Number(values.beneficiariesMale   || 0));
    const benFemale = isProject ? activities.reduce((s, a) => s + Number(a.beneficiariesWomen || 0), 0) : (isActivity && hasBeneficiaryReachValue === "no" ? null : Number(values.beneficiariesFemale || 0));
    const benBoys   = isProject ? activities.reduce((s, a) => s + Number(a.beneficiariesBoys || 0), 0)  : (isActivity && hasBeneficiaryReachValue === "no" ? null : Number(values.beneficiariesBoys   || 0));
    const benGirls  = isProject ? activities.reduce((s, a) => s + Number(a.beneficiariesGirls || 0), 0) : (isActivity && hasBeneficiaryReachValue === "no" ? null : Number(values.beneficiariesGirls  || 0));

    const indicatorProgressPayload = indicatorProgressEntries.length > 0
      ? indicatorProgressEntries.map((e) => ({
          indicatorId: e.indicatorId,
          name: e.name,
          target: e.target,
          cumAchieved: e.cumAchieved,
          currentAchievement: Number(e.currentAchievement || 0),
          remarks: e.remarks,
        }))
      : undefined;

    // FIX-07: Distinguish Activity Report PATCH (editing existing) from POST (create).
    // The backend PATCH route rejects activityId, projectId, and stateId as immutable
    // identity fields (409 activity_identity_immutable) when they appear in the body,
    // even if the value matches what is already stored. Omit them on edit.
    // Also omit `kind` on Activity Report edits so the historically stored value is
    // preserved in the DB rather than being overwritten by the hydrated form value.
    const isActivityEdit = isActivity && editingReportRef.current !== null;
    // PMR identity fields (projectId / stateId / locationType / period) are immutable after
    // creation — mirror the Activity Report pattern for parity with backend guard.
    const isPmrEdit = isProject && editingReportRef.current !== null;

    return {
      title: values.title,
      // Activity Report edits: omit kind — DB value is preserved as-is (no PATCH mutation).
      // New Activity Reports: send kind so it is stored on first CREATE.
      // All other report types: always send kind.
      kind: isActivityEdit ? undefined : values.kind,
      reportType: lockedType,
      // Legacy Activity Reports: omit reportingMonth/Year so PATCH preserves the stored null values.
      // Non-legacy Activity Reports: send the form month/year normally.
      // PMR edits: omit reportingMonth/Year (identity fields — immutable after creation).
      reportingMonth: isPmrEdit ? undefined : (isLegacyActivityEdit ? undefined : (isActivity ? values.reportingMonth : (values.kind === "monthly" ? values.reportingMonth : undefined))),
      reportingYear: isPmrEdit ? undefined : (isLegacyActivityEdit ? undefined : values.reportingYear),
      periodStart: values.kind === "on_demand" ? (values.periodStart || undefined) : (values.periodStart || undefined),
      periodEnd: values.periodEnd || undefined,
      sector: values.sector || undefined,
      submittedTo: values.submittedTo || undefined,
      // Activity Report edits: omit projectId/activityId/stateId (immutable identity fields).
      // PMR edits: omit projectId/stateId (immutable identity fields after creation).
      // New Activity Reports / New PMR: send them for initial storage.
      // Other report types: normal behaviour.
      projectId: isActivityEdit
        ? undefined
        : isPmrEdit
          ? undefined  // projectId is immutable on PMR PATCH — omit to avoid 409
          : (isActivity
              ? (linkMode === "activity" && values.projectId ? Number(values.projectId)
                : linkMode === "project" && values.projectId ? Number(values.projectId)
                : undefined)
              : (values.projectId ? Number(values.projectId) : undefined)),
      activityName: isActivity ? (values.activityName?.trim() || undefined) : undefined,
      activityId: (!isActivityEdit && isActivity && linkMode === "activity" && activityId) ? activityId : undefined,
      stateId: isActivityEdit
        ? undefined
        : isPmrEdit
          ? undefined  // stateId is immutable on PMR PATCH — omit to avoid 409
          : (isActivity && reportLocationType === "hq") ? undefined
          : (isProject && pmrLocationType === "hq") ? undefined
          : (Number(values.stateId) || undefined),
      // FIX-07: locationType is also an immutable identity field on the backend — omit on edits.
      // HQ standalone Activity Reports supply it on CREATE only.
      // HQ PMR: also supply locationType="hq" on CREATE only (immutable on PATCH).
      locationType: (isActivity && !isActivityEdit && reportLocationType === "hq") ? ("hq" as const)
        : (isProject && !isPmrEdit && pmrLocationType === "hq") ? ("hq" as const)
        : undefined,
      // PMR edits: omit period (identity field — immutable after creation; changing it would
      // bypass the uniqueness check). The stored period is set at CREATE time from the form values.
      period: isPmrEdit ? undefined : period,
      // Always include sections on Activity Report edits so that clearing all known fields
      // actually removes them from the stored JSONB (empty {} is a valid "clear" value to
      // the backend PATCH handler).  For creates and non-Activity types, the original
      // omit-when-empty behaviour is preserved to avoid sending a spurious empty object.
      sections: (isActivityEdit || Object.keys(sectionsPayload).length > 0) ? sectionsPayload : undefined,
      beneficiariesMale: benMale,
      beneficiariesFemale: benFemale,
      beneficiariesBoys: benBoys,
      beneficiariesGirls: benGirls,
      plannedBudget: isProject ? (projectTotalPlanned ?? undefined) : undefined,
      actualExpenditure: isProject ? projectTotalActual : undefined,
      activities: mappedActivities.length > 0 ? mappedActivities : undefined,
      // Activity Reports always use Month+Year semantics — quarter and onDemandReason are never
      // applicable even when the stored kind is "quarterly" or "on_demand" (historical records).
      // quarter is an immutable PMR identity field — omit on edits (mirrors projectId/stateId/period).
      // On creates (isPmrEdit=false) and non-PMR types, send normally.
      quarter: isActivity ? undefined : (isPmrEdit ? undefined : (values.kind === "quarterly" ? quarter : undefined)),
      onDemandReason: isActivity ? undefined : (values.kind === "on_demand" ? onDemandReason || undefined : undefined),
      indicatorProgress: indicatorProgressPayload,
      // For activity reports, always include recommendations so PATCH can clear the column when empty.
      // Send null (not undefined) when blank — maybeSet skips undefined but writes null to the DB.
      recommendations: isActivity ? (arRecommendations.trim() || null) : undefined,
    } as never;
  }

  // ── Step 4 inter-step validation — runs when Next is clicked on ar-section-challenges ──
  // FIX-08: Delegates to the unified lib validator so readiness and submit use the same rules.
  function validateChallengesStep(): boolean {
    if (!isActivity) return true;
    const errors = validateActivityChallenges(sectionValues, validationCtx);
    if (errors.length === 0) return true;
    const STEP4_MSG: Record<string, string> = {
      hasChallenges: t("activityForm.step4.errHasChallengesRequired"),
      challenges:    t("activityForm.step4.errChallengesRequired"),
    };
    const fieldErrs: Partial<Record<string, string>> = {};
    for (const e of errors) fieldErrs[e.field] = STEP4_MSG[e.field] ?? e.message;
    setFieldErrors((cur) => ({ ...cur, ...fieldErrs }));
    setTabErrors((prev) => ({ ...prev, "ar-section-challenges": errors.length }));
    toast.error(Object.values(fieldErrs)[0] ?? errors[0].message);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }, 50);
    return false;
  }

  // ── Step 5 inter-step validation — runs when Next is clicked on ar-section-lessons ──
  // FIX-08: Delegates to the unified lib validator so readiness and submit use the same rules.
  function validateLessonsStep(): boolean {
    if (!isActivity) return true;
    const errors = validateActivityLessons(sectionValues, validationCtx);
    if (errors.length === 0) return true;
    const fieldErrs: Partial<Record<string, string>> = {};
    for (const e of errors) fieldErrs[e.field] = e.message;
    setFieldErrors((cur) => ({ ...cur, ...fieldErrs }));
    setTabErrors((prev) => ({ ...prev, "ar-section-lessons": errors.length }));
    toast.error(errors[0].message);
    setTimeout(() => {
      const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
    }, 50);
    return false;
  }

  // ── Basic-Info inline validation — used by Next button on step 1 (activity wizard) ──
  // FIX-08: Delegates to the unified lib validator for Activity Reports so readiness
  // and submit use the same rules. Non-Activity types retain direct field checks.
  function validateBasicInfo(): boolean {
    const values = form.getValues();
    if (isActivity) {
      const errors = validateActivityBasicInfo(buildActivityFormValues(values), validationCtx);
      const fieldErrs: Partial<Record<string, string>> = {};
      for (const e of errors) fieldErrs[e.field] = e.message;
      setFieldErrors(fieldErrs);
      const hasError = errors.length > 0;
      if (hasError) {
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
          if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
        }, 50);
      }
      return !hasError;
    }
    // Non-activity reports: original logic retained
    const fieldErrs: Partial<Record<string, string>> = {};
    if (!values.title.trim()) fieldErrs["title"] = "Report Title is required";
    if (!values.stateId && !isHqSector) fieldErrs["stateId"] = "State is required";
    if (values.kind === "on_demand" && !values.periodStart?.trim()) fieldErrs["periodStart"] = "Period Start is required";
    if (values.kind === "on_demand" && !onDemandReason.trim()) fieldErrs["onDemandReason"] = "On-Demand reason is required";
    setFieldErrors(fieldErrs);
    const hasError = Object.keys(fieldErrs).length > 0;
    if (hasError) {
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
      }, 50);
    }
    return !hasError;
  }

  // ── Draft validation — only minimum fields required to save progress ─────────
  function validateDraft(values: FormShape): boolean {
    const basicId = isActivity ? "ar-section-basic" : "rp-section-basic";
    if (!values.title.trim()) {
      toast.error(t("form.titleRequiredForDraft"));
      setActiveSection(basicId);
      return false;
    }
    if (isProject && !values.projectId) {
      toast.error(t("form.projectRequiredForDraft"));
      setActiveSection(basicId);
      return false;
    }
    // State required for non-HQ-sector reports unless user is a state-role, HQ activity, or HQ PMR.
    if (!values.stateId && !(isActivity && isStateRole) && !isHqSector && !(isActivity && reportLocationType === "hq") && !(isProject && pmrLocationType === "hq")) {
      toast.error(t("form.locationRequiredForDraft"));
      setActiveSection(basicId);
      return false;
    }
    if (isHqSector && !values.sector) {
      toast.error(t("form.sectorRequiredForDraft"));
      setActiveSection(basicId);
      return false;
    }
    if (isActivity && compatProfile.subjectRequired && !values.activityName?.trim()) {
      toast.error(t("form.activityNameRequiredForDraft"));
      setActiveSection(basicId);
      return false;
    }
    if (isActivity && linkMode === "activity" && !activityId) {
      toast.error(t("form.activityLinkRequired"));
      setActiveSection(basicId);
      return false;
    }
    if (isActivity && linkMode === "project" && !values.projectId) {
      toast.error(t("form.projectLinkRequired"));
      setActiveSection(basicId);
      return false;
    }
    // On-demand: period start is required — unless this is a legacy Activity Report
    // whose stored period is already locked (fields hidden; no way for user to fill them).
    const _legacyARDraft = isActivity && (() => {
      const sp = editingReportRef.current ? ((editingReportRef.current as unknown as Record<string, unknown>).period as string | undefined) : undefined;
      return sp != null && !/^\d{4}-\d{2}$/.test(sp);
    })();
    if (values.kind === "on_demand" && !_legacyARDraft && !values.periodStart?.trim()) {
      toast.error(t("form.periodStartRequired"));
      setActiveSection(basicId);
      return false;
    }
    return true;
  }

  // ── Submit validation — full validation with first-error navigation ──────────
  // FIX-08: Activity Reports delegate entirely to the unified lib validator.
  // Non-Activity types retain the original field-by-field logic below.
  function validateSubmit(values: FormShape): boolean {
    // ── Activity Reports: unified validator ─────────────────────────────────
    if (isActivity) {
      const result = validateActivityForSubmission(
        buildActivityFormValues(values),
        sectionValues,
        validationCtx,
      );

      // Map step numbers to section IDs for navigation
      const STEP_TO_SECTION_ID: Record<number, ReportSectionId> = {
        1: "ar-section-basic",
        2: "ar-section-progress",
        3: "ar-section-results",
        4: "ar-section-challenges",
        5: "ar-section-lessons",
        6: "ar-section-attachments",
      };

      if (!result.valid) {
        // Build field-error map for aria-invalid / inline display
        const fieldErrs: Partial<Record<string, string>> = {};
        for (const e of result.errors) {
          if (!fieldErrs[e.field]) fieldErrs[e.field] = e.message;
        }
        // Build tab-error map (count per section)
        const tabErrs: Partial<Record<ReportSectionId, number>> = {};
        for (const [step, errs] of Object.entries(result.errorsByStep)) {
          const sid = STEP_TO_SECTION_ID[Number(step)];
          if (sid) tabErrs[sid] = errs.length;
        }
        setFieldErrors(fieldErrs);
        setTabErrors(tabErrs);
        // Navigate to first invalid step
        const targetSectionId = STEP_TO_SECTION_ID[result.firstInvalidStep ?? 1] ?? "ar-section-basic";
        setActiveSection(targetSectionId);
        setTimeout(() => {
          const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
          if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
        }, 80);
        const firstMsg = result.errors[0]?.message ?? "Please complete all required fields before submitting.";
        toast.error(firstMsg);
        return false;
      }
      setFieldErrors({});
      return true;
    }

    // ── Non-Activity Reports: original logic ─────────────────────────────────
    const errs: Partial<Record<ReportSectionId, number>> = {};
    const fieldErrs: Partial<Record<string, string>> = {};
    const addErr = (tab: ReportSectionId, fieldKey?: string, msg?: string) => {
      errs[tab] = (errs[tab] ?? 0) + 1;
      if (fieldKey && msg && !fieldErrs[fieldKey]) fieldErrs[fieldKey] = msg;
    };
    const msgs: string[] = [];

    const basicId: ReportSectionId    = "rp-section-basic";
    const progressId: ReportSectionId = "rp-section-progress";
    const lessonsId: ReportSectionId  = "rp-section-lessons";
    const attachId: ReportSectionId   = "rp-section-attachments";

    // Tab 1 — Basic Information
    if (!values.title.trim()) { addErr(basicId, "title", "Report Title is required"); msgs.push("Report Title is required"); }
    if (isProject && !values.projectId) { addErr(basicId, "projectId", "Project is required"); msgs.push("Project is required"); }
    if (!values.stateId && !isHqSector && !(isProject && pmrLocationType === "hq")) { addErr(basicId, "stateId", "State is required"); msgs.push("State is required"); }
    if (isHqSector && !values.sector) { addErr(basicId, "sector", "Sector is required"); msgs.push("Sector is required"); }
    if (values.kind === "on_demand" && !values.periodStart?.trim()) { addErr(basicId, "periodStart", "Period Start is required for On-Demand reports"); msgs.push("Period Start is required for On-Demand reports"); }
    if (values.kind === "on_demand" && !onDemandReason.trim()) { addErr(basicId, "onDemandReason", "Reason for On-Demand is required"); msgs.push("Reason for On-Demand is required"); }

    // Tab 1 — Project currency guard
    if (isProject && !projectCurrency) {
      const hasFinancials = activities.some((a) => {
        const v = a.actualExpenditure === "" ? null : Number(a.actualExpenditure ?? null);
        return v !== null && v > 0;
      });
      if (hasFinancials) {
        addErr(basicId, "projectCurrency", "Project currency is not configured. Financial reporting cannot be submitted until the Project currency is set.");
        msgs.push("Project currency is not configured. Financial reporting cannot be submitted until the Project currency is set.");
      }
    }

    // Tab 2 — Progress
    for (const f of sectionsCfg.progress) {
      if (f.required && !(sectionValues[f.key] || "").trim()) {
        const label = configuredFieldLabel(f);
        addErr(progressId, f.key, t("form.fieldRequired", { field: label }));
        msgs.push(t("form.fieldRequired", { field: label }));
      }
    }

    // Tab 3 — Activities (project type)
    if (isProject) {
      const cleanActs = activities.filter((a) => a.name?.trim());
      if (cleanActs.length === 0) { addErr("rp-section-activities", "act-0-name", "At least one Activity is required — enter an Activity Name"); msgs.push("At least one Activity is required"); }
      activities.forEach((a, actIdx) => {
        if (!a.name?.trim()) return;
        const actualVal = a.actualExpenditure === "" ? null : Number(a.actualExpenditure ?? null);
        if (actualVal !== null && actualVal < 0) { addErr("rp-section-activities", `act-${actIdx}-actualExpenditure`, "Actual Expenditure cannot be negative"); msgs.push(`${a.name}: Actual Expenditure cannot be negative`); }
        if (actualVal === null) { addErr("rp-section-activities", `act-${actIdx}-actualExpenditure`, "Actual Expenditure (This Period) is required"); msgs.push(`${a.name}: Actual Expenditure (This Period) is required`); }
        if (!(a.achievementSummary ?? "").trim()) { addErr("rp-section-activities", `act-${actIdx}-achievementSummary`, "Achievement Summary is required"); msgs.push(`${a.name}: Achievement Summary is required`); }
        // Parse each beneficiary field: blank/null → required error; negative → invalid; 0+ → valid.
        // Only accepts number or string types — booleans/arrays/objects are rejected.
        const parseBenFe = (v: unknown): number | null | "negative" => {
          if (v === null || v === undefined) return null;
          if (typeof v !== "number" && typeof v !== "string") return null;
          if (typeof v === "string" && !v.trim()) return null;
          const n = Number(v);
          if (!Number.isFinite(n)) return null;
          if (n < 0) return "negative";
          return Math.floor(n);
        };
        const benFieldValues: Array<[string, unknown]> = [["men", a.beneficiariesMen], ["women", a.beneficiariesWomen], ["boys", a.beneficiariesBoys], ["girls", a.beneficiariesGirls]];
        for (const [benKey, bv] of benFieldValues) {
          const parsed = parseBenFe(bv);
          if (parsed === null) { addErr("rp-section-activities", `act-${actIdx}-ben-${benKey}`, "Beneficiary field is required — enter 0 if no direct reach occurred this period"); msgs.push(`${a.name}: Beneficiary field is required — enter 0 if no direct reach occurred this period`); }
          else if (parsed === "negative") { addErr("rp-section-activities", `act-${actIdx}-ben-${benKey}`, "Beneficiary values cannot be negative"); msgs.push(`${a.name}: Beneficiary values cannot be negative`); }
        }
        if (a.isUnplanned && !(a.unplannedReason ?? "").trim()) { addErr("rp-section-activities", `act-${actIdx}-unplannedReason`, "Exception/Reason is required for Unplanned Activities"); msgs.push(`${a.name}: Exception/Reason is required for Unplanned Activities`); }
        const pBudget = a.plannedBudget;
        const aBudget = actualVal ?? 0;
        if (varianceReasonRequired(pBudget, aBudget) && !(a.varianceReason ?? "").trim()) {
          addErr("rp-section-activities", `act-${actIdx}-varianceReason`, "Reason for Variance is required");
          msgs.push(`${a.name}: Reason for Variance is required`);
        }
      });
    }

    // Tab 5 — Lessons
    for (const f of sectionsCfg.narrative ?? []) {
      if (f.required && !(sectionValues[f.key] || "").trim()) {
        const label = configuredFieldLabel(f);
        addErr(lessonsId, f.key, t("form.fieldRequired", { field: label }));
        msgs.push(t("form.fieldRequired", { field: label }));
      }
    }

    // Tab 6 — Attachments & Voice
    if (isProject) {
      const hasDocOrBypass = supportingDocs.length > 0 || (docsNoSupport && docsNoSupportReason.trim().length > 0);
      if (!hasDocOrBypass) {
        addErr(attachId);
        msgs.push("Attach at least one Supporting Document, or select 'No supporting documents' and provide a reason");
      }
    }

    setFieldErrors(fieldErrs);
    setTabErrors(errs);

    if (msgs.length > 0) {
      const firstErrTab = (activeNavItems.find((n) => errs[n.id] != null) ?? activeNavItems[0]).id;
      setActiveSection(firstErrTab);
      setTimeout(() => {
        const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
      }, 80);
      toast.error(msgs[0]);
      return false;
    }
    setFieldErrors({});
    return true;
  }

  const onSaveDraft = form.handleSubmit(async (values) => {
    if (localDraft.status === "pending" || localDraft.status === "syncing") {
      toast.info(t("sync.draftAlreadyPending", { ns: "common" }));
      return;
    }
    if (!validateDraft(values)) return;
    const payload = buildPayloadData(values);
    if (!payload) return;
    const offlineOperationId = !isOnline ? crypto.randomUUID() : null;
    // The replay transaction can only link an already-durable snapshot. Save
    // synchronously before the intercepted mutation exposes a queue row; a
    // crash before that row exists leaves a recoverable local draft instead.
    if (offlineOperationId) await localDraft.saveNow();
    const queuedPayload = {
      ...(payload as Record<string, unknown>),
      _draftKey: localDraft.storageKey,
      _syncOperationId: offlineOperationId,
    };
    try {
      let reportId: number;
      if (editingReport) {
        const res = await fetch(`/api/reports/${editingReport.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(editingBaseRevision ? { "x-base-revision": editingBaseRevision } : {}),
          },
          credentials: "include",
          body: JSON.stringify(queuedPayload),
        });
        if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Failed to save"); }
        reportId = editingReport.id;
        toast.success(t("form.draftUpdated"));
      } else {
        const created = await createMutation.mutateAsync({ data: queuedPayload as never });
        reportId = created.id;
        toast.success(t("form.savedAsDraft"));
      }
      // Upload pending supporting documents (activity reports — fire-and-forget; errors stay pending)
      await uploadPendingSupportingDocs(reportId);
      // Upload voice note — report is already saved; preserve pending note on failure so user can retry
      if (pendingVoiceNote) {
        let vnOk = false;
        try { await uploadVoiceNote(pendingVoiceNote, reportId); vnOk = true; }
        catch { setVoiceNoteRetry({ note: pendingVoiceNote, reportId }); }
        if (!vnOk) {
          // Keep dialog open so the retry banner is visible
          setIsFormDirty(false);
          qc.invalidateQueries();
          toast.error(t("form.voiceUploadFailed"));
          setActiveSection(isActivity ? "ar-section-attachments" : "rp-section-attachments");
          return;
        }
      }
      setIsFormDirty(false);
      qc.invalidateQueries();
      await localDraft.remove();
      setCreateOpen(false);
      resetForm();
    } catch (e: unknown) {
      if (isOfflineQueuedError(e)) {
        toast.info(t("sync.draftQueuedOnDevice", { ns: "common" }));
        setIsFormDirty(false);
        setCreateOpen(false);
        resetForm();
        return;
      }
      if (offlineOperationId) await localDraft.saveNow();
      toast.error((e as Error).message);
    }
  });

  const onSubmitReport = form.handleSubmit(async (values) => {
    if (!isOnline) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    // Synchronous ref check fires before any re-render — blocks rapid double-clicks
    // in the same event-loop tick where state hasn't yet propagated.
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    setIsSubmittingReport(true);
    setDocsError("");
    if (!validateSubmit(values)) {
      isSubmittingRef.current = false;
      setIsSubmittingReport(false);
      return;
    }
    const payload = buildPayloadData(values);
    try {
      let reportId: number;
      if (editingReport) {
        const res = await fetch(`/api/reports/${editingReport.id}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            ...(editingBaseRevision ? { "x-base-revision": editingBaseRevision } : {}),
          },
          credentials: "include",
          body: JSON.stringify(payload),
        });
        if (!res.ok) { const e = await res.json() as { error?: string }; throw new Error(e.error ?? "Failed to save"); }
        reportId = editingReport.id;
      } else {
        const created = await createMutation.mutateAsync({ data: payload as never });
        reportId = created.id;
      }
      // Upload pending supporting documents before transition
      await uploadPendingSupportingDocs(reportId);
      // Upload voice note before transition — report is already saved; preserve note on failure
      if (pendingVoiceNote) {
        let vnOk = false;
        try { await uploadVoiceNote(pendingVoiceNote, reportId); vnOk = true; }
        catch { setVoiceNoteRetry({ note: pendingVoiceNote, reportId }); }
        if (!vnOk) {
          toast.error(t("form.voiceUploadFailed"));
          setActiveSection(isActivity ? "ar-section-attachments" : "rp-section-attachments");
          setIsFormDirty(false);
          qc.invalidateQueries();
          return;
        }
      }
      await transitionMutation.mutateAsync({ reportId, data: { action: "submit" } });
      toast.success(t("form.submittedForReview"));
      setIsFormDirty(false);
      qc.invalidateQueries();
      await localDraft.remove();
      setCreateOpen(false);
      resetForm();
    } catch (e: unknown) {
      toast.error((e as Error).message);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmittingReport(false);
    }
  });

  // Actions that trigger the backend self-review guard — PM/super_admin must
  // supply overrideReason when they are also the report author.
  const SELF_REVIEW_ACTIONS = new Set(["coordination_review", "technical_review", "final_approve"]);

  // True when the current user is both the report author AND has Full Operational
  // Access (PM/super_admin), and the requested action is a review/approval step.
  const isSelfReviewOverride =
    !!transitionOpen &&
    SELF_REVIEW_ACTIONS.has(transitionOpen.action) &&
    hasFullOperationalAccess(me?.user) &&
    !!selected &&
    selected.authorId === me?.user?.id;

  const onTransition = async () => {
    if (!selected || !transitionOpen) return;
    if (!isOnline) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    try {
      const body = TransitionReportBody.parse({
        action: transitionOpen.action,
        comment: comment || undefined,
        overrideReason: isSelfReviewOverride ? overrideReason : undefined,
      });
      await transitionMutation.mutateAsync({ reportId: selected.id, data: body });
      toast.success(t("updateSuccess"));
      qc.invalidateQueries();
      setTransitionOpen(null);
      setComment("");
      setOverrideReason("");
      setSelected(null);
    } catch (e: unknown) {
      toast.error((e as Error).message);
    }
  };

  const transitions = (selected
    ? transitionsFor(
        selected.status,
        perms,
        selected.reportType ?? undefined,
        (selected as unknown as Record<string, unknown>).workflowPath as string | null ?? null,
        me?.user?.id != null &&
          ((selected as unknown as Record<string, unknown>).authorId as number | null | undefined) === me.user.id,
      )
    : []).map(({ translationKey, ...transition }) => ({
      ...transition,
      label: translationKey ? t(translationKey) : transition.label,
    }));
  const reportUnresolvedRC = useUnresolvedRequiredCorrections("report", selected?.id ?? null);
  // SPR-010: contextual "Add comment" buttons pre-seed the CommentsPanel composer.
  const [commentPreset, setCommentPreset] = useState<{ section: string; nonce: number } | null>(null);
  useEffect(() => { setCommentPreset(null); }, [selected?.id]);

  // Project Report and Activity Report authorship: SPO, TC, PM (full operational
  // access), and super_admin. SOM, ED, Viewer, and approval-only roles cannot author.
  // Backend enforces the same rule — frontend gate is for UX only.
  const VALID_PROJECT_REPORT_AUTHOR_ROLES = new Set(["state_program_officer", "technical_coordinator", "program_manager", "super_admin"]);
  // SPR-003/004: SOM holds only the narrow reports.program_state.create permission
  // (not reports.create), so the outer permission check accepts either.
  const canCreate = (hasPerm(perms, "reports.create") || hasPerm(perms, "reports.program_state.create")) && (
    lockedType === "project" || lockedType === "activity"
      ? VALID_PROJECT_REPORT_AUTHOR_ROLES.has(userRole)
      : lockedType === "hq_sector"
        // HQSR-001: TC (assigned sector), super_admin, and SPC (fallback when no
        // active TC covers the sector — server-verified vacancy check) may author
        // HQ Sector Reports. Backend is authoritative either way.
        ? canAuthorHqSectorReport(userRole, me?.user?.sector as string | null | undefined)
        : lockedType === "program_state"
          // SPR-003/004: SPO (primary), SOM (bounded fallback — backend verifies
          // SPO vacancy server-side), super_admin (emergency). TC/SPC/PM/ED hidden.
          ? canAuthorProgramStateReport(userRole, me?.user?.stateId as number | null | undefined)
          : true
  );

  // Server-side export: fetches all matching records regardless of current page.
  const handleExportCsv = async () => {
    const exportParams: ExportReportsParams = { reportType: lockedType };
    if (projectId !== "all") {
      if (projectId === "standalone") {
        (exportParams as Record<string, unknown>).projectId = "standalone";
      } else {
        exportParams.projectId = Number(projectId);
      }
    }
    if (stateId !== "all") exportParams.stateId = Number(stateId);
    if (sector !== "all") exportParams.sector = sector;
    if (kindFilter !== "all") exportParams.kind = kindFilter;
    if (kindFilter === "monthly" || kindFilter === "all") {
      if (reportingMonth !== "all") exportParams.reportingMonth = Number(reportingMonth);
    }
    if (kindFilter === "quarterly" && quarterFilter !== "all") {
      exportParams.quarter = Number(quarterFilter);
    }
    if (reportingYear !== "all") exportParams.reportingYear = Number(reportingYear);
    if (authorId !== "all") exportParams.authorId = Number(authorId);
    if (activityFilter !== "all") (exportParams as Record<string, unknown>).activityId = Number(activityFilter);
    if (displayStatusFilter !== "all") {
      const bs = STATUS_GROUPS[displayStatusFilter];
      if (bs && bs.length === 1) exportParams.status = bs[0];
    }
    const qs = new URLSearchParams(
      Object.fromEntries(
        Object.entries(exportParams)
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, String(v)]),
      ),
    ).toString();
    try {
      const res = await fetch(`/api/reports/export?${qs}`, { credentials: "include" });
      if (!res.ok) { toast.error(t("form.exportFailed")); return; }
      const data = await res.json() as Report[];
      exportReportsCsv(data, meta.label, t);
      if (res.headers.get("X-Report-Truncated") === "true") {
        toast.warning(`Export limited to the first ${REPORT_EXPORT_MAX_ROWS.toLocaleString()} matching reports.`);
      }
    } catch {
      toast.error(t("form.exportFailed"));
    }
  };

  const REPORT_VIEWS = ["table", "card", "list", "compact", "kanban"] as const;
  // Column header colors mirror the semantic badge variants defined in badge.tsx.
  const REPORT_KANBAN_COLS: KanbanColumn[] = [
    { key: "draft",                  label: "Draft",                   color: "border border-slate-200 bg-slate-50 text-slate-600"   },
    { key: "submitted",              label: "Submitted",               color: "bg-info/10 text-info border-info/20"                  },
    { key: "state_reviewed",         label: "State Reviewed",          color: "bg-sky-50 text-sky-700 border-sky-200"                },
    { key: "technically_approved",   label: "Technically Approved",    color: "bg-indigo-50 text-indigo-700 border-indigo-200"       },
    { key: "coordination_approved",  label: "Coordination Approved",   color: "border border-violet-200 bg-violet-50 text-violet-700"},
    { key: "approved",               label: "Approved",                color: "bg-success/10 text-success border-success/20"         },
    { key: "rejected",               label: "Rejected",                color: "bg-destructive/10 text-destructive border-destructive/20" },
    { key: "archived",               label: "Archived",                color: "border border-slate-200 bg-slate-100 text-slate-600"  },
  ];
  const moduleKey = `reports_${lockedType}`;
  const [viewMode, setViewMode] = useViewMode(moduleKey, [...REPORT_VIEWS], "table");

  const viewRecords: ViewRecord[] = useMemo(
    () =>
      (reports ?? []).map((r) => {
        const sb = statusBadgeVariant(r.status);
        // Use effectiveSector (COALESCE r.sector, p.sector) for all display purposes
        const displaySector = r.effectiveSector ?? r.sector ?? undefined;
        const preparedBy = r.authorName ?? r.submittedByName ?? "—";
        return {
          id: r.id,
          title: r.title,
          subtitle: r.projectTitle ?? undefined,
          status: r.status,
          statusBadge: <Badge variant={sb.variant} className={sb.className}>{displayStatus(r.status, t)}</Badge>,
          tag: displaySector,
          // §15: format period with frequency context ("Monthly · Jun 2026" etc.)
          // Activity Reports: compatibility 'monthly' is internal — not user-selected.
          // Show period only (no frequency label) for Activity monthly rows.
          // Historical Activity kinds (quarterly, annual, on_demand) retain their label.
          date: (lockedType === "activity" && (r as unknown as Record<string, unknown>).kind === "monthly")
            ? formatPeriodOnly("monthly", r.period, i18n.language)
            : formatReportPeriod((r as unknown as Record<string, unknown>).kind as string | undefined, r.period, t, i18n.language),
          // §11–12: Sector displayed via `tag` chip — removed from meta grid to avoid duplication.
          meta: [
            ...(lockedType === "activity" && (r as unknown as Record<string, unknown>).activityTitle
              ? [{ label: t("list.activity"), value: ((r as unknown as Record<string, unknown>).activityCode
                  ? `${(r as unknown as Record<string, unknown>).activityCode} — `
                  : "") + ((r as unknown as Record<string, unknown>).activityTitle as string) }]
              : []),
            { label: t("list.project"),    value: r.projectTitle ?? (lockedType === "activity" ? t("list.standalone") : "—") },
            { label: t("list.state"),      value: formatLocation({ locationType: r.locationType, stateName: r.stateName, stateNameAr: r.stateNameAr }, i18n.language) },
            { label: t("list.preparedBy"), value: preparedBy },
          ],
          stateNames: r.stateName ? [r.stateName] : [],
          stateNamesAr: r.stateNameAr ? [r.stateNameAr] : [],
          onClick: (trigger) => openReportDetail(r, trigger),
          actions: canResumeReportDraft(r, perms, me?.user) ? (
            <ContinueEditingAction
              recordTitle={r.title}
              onClick={() => startDraftEditing(r)}
            />
          ) : undefined,
        };
      }),
    [reports, lockedType, openReportDetail, perms, me?.user, startDraftEditing, t, i18n.language],
  );

  const yearOptions = useMemo(() => {
    const cur = new Date().getFullYear();
    const start = cur - 2;
    return Array.from({ length: 2035 - start + 1 }, (_, i) => start + i);
  }, []);

  const updateActivity = (i: number, patch: Partial<ActivityRow>) => {
    setActivities((cur) => cur.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
    setIsFormDirty(true);
  };

  // §23: True when the user has changed any filter from its default ("all") value.
  // Used to show/hide "Clear Filters" and to select the correct empty-state message.
  const hasActiveFilters =
    displayStatusFilter !== "all" || kindFilter !== "all" || stateId !== "all" ||
    sector !== "all" || projectId !== "all" || reportingMonth !== "all" ||
    reportingYear !== "all" || quarterFilter !== "all" || authorId !== "all" ||
    activityFilter !== "all";
  const recoverableDeviceDraft = deviceDrafts.find((draft) =>
    draft.status !== "synced" && draft.serverReportId === null,
  );

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <meta.icon className="h-7 w-7 text-primary" /> {meta.label}
          </h1>
          <p className="text-muted-foreground mt-2">{meta.description}</p>
          {/* §2: Compact structured approval paths — dual paths shown inline with separator */}
          <div className="mt-2 flex flex-wrap items-start gap-x-4 gap-y-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 mt-0.5 shrink-0">
              {t("approval.approvalPaths")}
            </span>
            {meta.workflow.kind === "dual" ? (
              meta.workflow.paths.map((path, idx) => (
                <span key={path.label} className="flex items-center gap-1.5 flex-wrap">
                  {idx > 0 && (
                    <span className="text-muted-foreground/40 hidden sm:inline" aria-hidden>·</span>
                  )}
                  <span className="text-[11px] font-medium text-muted-foreground/80">{t(path.labelKey)}:</span>
                  <WorkflowChainRow abbrs={path.abbrs} roles={path.roles} />
                </span>
              ))
            ) : (
              <WorkflowChainRow abbrs={meta.workflow.abbrs} roles={meta.workflow.roles} />
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <ViewModeSwitcher
            available={[...REPORT_VIEWS]}
            current={viewMode}
            onChange={setViewMode}
          />
          <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={isLoading}>
            <Download className="h-4 w-4" /> {t("exportCsv")}
          </Button>
          {canCreate && (
            <Dialog open={createOpen} onOpenChange={(o) => {
                if (!o) {
                  if (isFormDirty) { setShowDiscardConfirm(true); return; }
                  setCreateOpen(false);
                  resetForm();
                } else {
                  setCreateOpen(true);
                }
              }}>
              <DialogTrigger asChild>
                <Button><Plus className="h-4 w-4" /> {t("newReport")}</Button>
              </DialogTrigger>
              <DialogContent
                className="sm:max-w-[920px] max-h-[90vh] p-0 gap-0 flex flex-col overflow-y-hidden"
                onInteractOutside={(e) => {
                  e.preventDefault();
                  if (isFormDirty) setShowDiscardConfirm(true);
                }}
                onEscapeKeyDown={(e) => {
                  e.preventDefault();
                  if (isFormDirty) { setShowDiscardConfirm(true); } else { setCreateOpen(false); resetForm(); }
                }}
              >
                {/* ── Sticky dialog header ── */}
                <div className="px-6 pt-5 pb-4 border-b shrink-0">
                  <DialogHeader>
                    <DialogTitle>
                      {editingReport
                        ? t("form.continueEditing", { reportType: isProgramState ? t("typeMeta.programStateShort") : isHqSector ? t("typeMeta.hqSectorShort") : meta.short })
                        : t("form.newReportForType", { reportType: isProgramState ? t("typeMeta.programStateShort") : isHqSector ? t("typeMeta.hqSectorShort") : meta.short })}
                    </DialogTitle>
                    <DialogDescription>
                      {isProgramState
                        ? t("form.dialogDescriptionState")
                        : isHqSector
                        ? t("form.dialogDescriptionHq")
                        : isActivity
                        ? t("form.dialogDescriptionActivity")
                        : t("form.dialogDescriptionProject")}
                    </DialogDescription>
                    {!isProgramState && !isHqSector && localDraft.hasLocalDraft && (
                      <OfflineReportDraftStatus
                        status={localDraft.status}
                        savedAt={localDraft.stored?.lastSavedAt}
                        error={localDraft.stored?.lastError}
                        onDiscard={() => {
                          void localDraft.remove();
                          setCreateOpen(false);
                          resetForm();
                        }}
                        className="pt-2"
                      />
                    )}
                  </DialogHeader>
                  {!isOnline && (
                    <div id="offline-workflow-notice" className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200" role="alert">
                      <span className="font-medium">{t("sync.internetRequired", { ns: "common" })}.</span>{" "}
                      {t("sync.internetRequiredDescription", { ns: "common" })}
                    </div>
                  )}
                  {/* ── Compact Approval Workflow strip inside the header (Activity Reports only) ── */}
                  {isActivity && (() => {
                    const myPath =
                      userRole === "state_program_officer"
                        ? DUAL_WORKFLOW.paths[0]
                        : userRole === "technical_coordinator"
                        ? DUAL_WORKFLOW.paths[1]
                        : null;
                    return (
                      <div className="mt-2 flex flex-wrap items-start gap-x-3 gap-y-0.5 text-xs border-t border-border/40 pt-2">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70 shrink-0 mt-0.5">
                          {myPath ? t("approval.yourApprovalPath") : t("approval.approvalPaths")}
                        </span>
                        {myPath ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] text-muted-foreground/60">{t(myPath.labelKey)}:</span>
                            <WorkflowChainRow abbrs={myPath.abbrs} roles={myPath.roles} />
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                            {DUAL_WORKFLOW.paths.map((path) => (
                              <div key={path.label} className="flex items-center gap-1.5">
                                <span className="text-[10px] text-muted-foreground/60">{t(path.labelKey)}:</span>
                                <WorkflowChainRow abbrs={path.abbrs} roles={path.roles} />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>

                {/* ── True tab navigation (ARIA) ── */}
                <div className="border-b shrink-0 bg-background">
                  <div
                    role="tablist"
                    aria-label={t("form.tabsAriaLabel")}
                    className="flex gap-0.5 overflow-x-auto px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                    onKeyDown={(e) => {
                      const ids = activeNavItems.map((n) => n.id);
                      const cur = ids.indexOf(activeSection);
                      let next: number;
                      if (e.key === "ArrowRight") next = (cur + 1) % ids.length;
                      else if (e.key === "ArrowLeft") next = (cur - 1 + ids.length) % ids.length;
                      else if (e.key === "Home") next = 0;
                      else if (e.key === "End") next = ids.length - 1;
                      else return;
                      e.preventDefault();
                      setActiveSection(ids[next]);
                      (e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')[next])?.focus();
                    }}
                  >
                    {activeNavItems.map(({ id, labelKey }) => {
                      const errCount = tabErrors[id] ?? 0;
                      const isActive = activeSection === id;
                      return (
                        <button
                          key={id}
                          role="tab"
                          id={`tab-${id}`}
                          type="button"
                          tabIndex={isActive ? 0 : -1}
                          aria-selected={isActive}
                          aria-controls={id}
                          onClick={() => setActiveSection(id)}
                          className={cn(
                            "shrink-0 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring flex items-center gap-1",
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "text-muted-foreground hover:text-foreground hover:bg-muted",
                          )}
                        >
                          {t(labelKey)}
                          {errCount > 0 && (
                            <span
                              aria-label={t("form.validationErrors", { count: errCount })}
                              className={cn(
                                "inline-flex items-center justify-center rounded-full text-[10px] font-bold h-4 min-w-4 px-1",
                                isActive ? "bg-primary-foreground/20 text-primary-foreground" : "bg-destructive text-destructive-foreground",
                              )}
                            >
                              {errCount}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* ── Scrollable tab panel body ── */}
                <div className="overflow-y-auto flex-1 min-h-0 px-5 py-4" aria-busy={isLoadingEditForm ? "true" : undefined}>
                {/* ── Edit loading skeleton / form switch ── */}
                {isLoadingEditForm ? (
                  <div className="space-y-4" aria-hidden="true">
                    <span className="sr-only">{t("form.loadingReport")}</span>
                    {/* header placeholder */}
                    <div className="flex items-center gap-3 border-b pb-3">
                      <Skeleton className="h-5 w-48" />
                      <Skeleton className="h-4 w-24" />
                    </div>
                    {/* field row skeletons */}
                    <div className="space-y-3">
                      {[160, 220, 140, 200].map((w) => (
                        <div key={w} className="space-y-1.5">
                          <Skeleton className="h-3.5 w-24" />
                          <Skeleton className={`h-9 w-full max-w-[${w}px]`} />
                        </div>
                      ))}
                    </div>
                    {/* footer placeholder */}
                    <div className="flex justify-end gap-2 pt-2 border-t">
                      <Skeleton className="h-9 w-24" />
                      <Skeleton className="h-9 w-28" />
                    </div>
                  </div>
                ) : isProgramState ? (
                  <ProgramStateReportForm
                    onClose={() => { setCreateOpen(false); resetForm(); }}
                    existingReport={editingReport?.reportType === "program_state" ? editingReport : undefined}
                    onOpenExistingDraft={async (id) => {
                      // SPR-008: switch the dialog from create mode to editing the
                      // existing draft. Prefer the already-loaded list row; fall back
                      // to the hardened single-report endpoint (authorisation applies).
                      let target = reportsRaw?.items?.find((r) => r.id === id) ?? null;
                      if (!target) {
                        try {
                          const res = await fetch(`/api/reports/${id}`);
                          if (res.ok) target = await res.json() as Report;
                        } catch { /* ignore — handled below */ }
                      }
                      if (target && target.reportType === "program_state") {
                        loadDraftForEdit(target);
                      } else {
                          toast.error(t("form.unableOpenExisting"));
                      }
                    }}
                  />
                ) : isHqSector ? (
                  <HqSectorReportForm
                  existingReport={editingReport?.reportType === "hq_sector" ? editingReport : undefined}
                  onDirtyChange={setIsFormDirty}
                  onClose={() => { setCreateOpen(false); resetForm(); }} />
                ) : (
                <form className="space-y-6">
                  {/* ── Returned-for-revision feedback banner ── */}
                  {editingReport && editingReport.status === "draft" && lastRevisionRequest && !revisionBannerDismissed && (
                    <div
                      role="status"
                      aria-label={t("form.revisionRequested")}
                      className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/20 px-4 py-3 space-y-1.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
                          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300">{t("form.revisionRequested")}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => setRevisionBannerDismissed(true)}
                          className="text-xs text-amber-600/70 hover:text-amber-700 dark:text-amber-400/70 underline underline-offset-2"
                          aria-label={t("form.dismissRevision")}
                        >
                          {t("form.dismiss")}
                        </button>
                      </div>
                      <p className="text-sm text-amber-700 dark:text-amber-300 ps-6">
                        <span className="font-medium">{lastRevisionRequest.authorName}</span>
                        {" · "}
                        <span className="text-xs text-amber-600/80">{formatDate(String(lastRevisionRequest.createdAt).slice(0, 10))}</span>
                      </p>
                      {lastRevisionRequest.body && (
                        <p className="text-sm text-amber-700/90 dark:text-amber-300/90 ps-6 italic">
                          &ldquo;{lastRevisionRequest.body}&rdquo;
                        </p>
                      )}
                      <p className="text-xs text-amber-600/70 dark:text-amber-400/70 ps-6">
                        {t("form.revisionHelp")}
                      </p>
                    </div>
                  )}

                  {/* ── TAB 1 (non-activity): BASIC INFORMATION ── */}
                  <section
                    role="tabpanel"
                    id="rp-section-basic"
                    aria-labelledby="tab-rp-section-basic"
                    className={(!isActivity && activeSection === "rp-section-basic") ? "space-y-3" : "hidden"}
                  >
                    <h4 className="text-sm font-semibold border-b pb-1">{t("form.basicInformation")}</h4>
                    <div className="grid grid-cols-2 gap-3">
                      {/* ── PROJECT — first for PMR so location can be derived from it ── */}
                      <div className="col-span-2">
                        <Label htmlFor="pmr-project-trigger">{isProject ? <>{t("fields.project")} <span className="text-destructive">*</span></> : <>{t("form.linkedProject")} <span className="font-normal text-muted-foreground">({t("form.optional")})</span></>}</Label>
                        <Select
                          value={v.projectId ? String(v.projectId) : (isProject ? "" : "__none__")}
                          onValueChange={(val) => {
                            const newId = val === "__none__" ? 0 : Number(val);
                            form.setValue("projectId", newId);
                            // Reset reporting location when project changes for PMR
                            if (isProject) {
                              form.setValue("stateId", 0);
                              setPmrLocationType("state");
                            }
                          }}
                        >
                          <SelectTrigger
                            id="pmr-project-trigger"
                            aria-required={isProject ? "true" : undefined}
                            aria-invalid={!!fieldErrors["projectId"] || undefined}
                            aria-describedby={
                              [isProject ? "help-pmr-project" : null, fieldErrors["projectId"] ? "err-pmr-project" : null]
                                .filter(Boolean).join(" ") || undefined
                            }
                          ><SelectValue placeholder={isProject ? `${t("form.selectProject")} *` : `${t("form.selectProject")} (${t("form.optional")})`} /></SelectTrigger>
                          <SelectContent>
                            {!isProject && <SelectItem value="__none__">{t("form.noProjectLink")}</SelectItem>}
                            {projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.title}</SelectItem>)}
                          </SelectContent>
                        </Select>
                        {!isProject && <p className="text-xs text-muted-foreground mt-1">{t("form.projectLinkHelp")}</p>}
                        {fieldErrors["projectId"] && (
                          <p id="err-pmr-project" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["projectId"]}</p>
                        )}
                        {/* Can't Find Your Project? — always shown below the Project selector (PMR only) */}
                        {isProject && (
                          <div id="help-pmr-project" className="mt-2 rounded border border-muted bg-muted/30 p-3 text-xs">
                            <p className="font-medium text-foreground">{t("form.cantFindProject")}</p>
                            <p className="text-muted-foreground mt-0.5">
                              {t("form.projectRequiredHelp")}
                            </p>
                            {canCreateProject ? (
                              <Link to="/projects/new" className="mt-1.5 inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:no-underline">
                                {t("form.registerProject")}
                              </Link>
                            ) : (
                              <p className="text-muted-foreground mt-1">{t("form.contactProgrammeTeam")}</p>
                            )}
                          </div>
                        )}
                      </div>
                      {/* ── REPORTING LOCATION — after project for PMR; disabled until project selected ── */}
                      <div>
                        <Label htmlFor="pmr-location" className="flex items-center gap-1">
                          {isHqSector ? t("form.reportingState") : t("form.reportingLocation")} <span className="text-destructive">*</span>
                          {stateFieldLocked && pmrLocationType !== "hq" && <span className="text-xs font-normal text-muted-foreground">({t("form.fromProject")})</span>}
                          {!stateFieldLocked && allowedStateIds.length > 1 && pmrLocationType !== "hq" && <span className="text-xs font-normal text-warning">({t("form.chooseProjectState")})</span>}
                        </Label>
                        {isProject && pmrLocationType === "hq" && allowedStateIds.length === 0 ? (
                          // HQ-only project: no states linked — lock to HQ (sole valid location).
                          <Input
                            id="pmr-location"
                            readOnly
                            aria-readonly="true"
                            value={t("form.hqHeadquarters")}
                            className="bg-muted cursor-not-allowed"
                          />
                        ) : isProject && stateFieldLocked && pmrLocationType !== "hq" && !pmrHqAvailable ? (
                          // Single-state project with no HQ option: lock to the one state.
                          <Input
                            id="pmr-location"
                            readOnly
                            aria-readonly="true"
                            value={states?.find((s) => s.id === v.stateId)?.name ?? ""}
                            className="bg-muted cursor-not-allowed"
                          />
                        ) : (
                          <Select
                            value={
                              isProject
                                ? (pmrLocationType === "hq" ? "__hq__" : (v.stateId ? String(v.stateId) : ""))
                                : String(v.stateId || "")
                            }
                            disabled={isProject && !selectedProjectId}
                            onValueChange={(val) => {
                              if (isProject) {
                                if (val === "__hq__") {
                                  setPmrLocationType("hq");
                                  form.setValue("stateId", 0);
                                } else {
                                  setPmrLocationType("state");
                                  form.setValue("stateId", Number(val));
                                }
                              } else {
                                form.setValue("stateId", Number(val));
                              }
                            }}
                          >
                            <SelectTrigger
                              id="pmr-location"
                              aria-required="true"
                              aria-invalid={!!fieldErrors["stateId"] || undefined}
                              aria-describedby={fieldErrors["stateId"] ? "err-pmr-location" : undefined}
                            >
                              <SelectValue placeholder={isProject && !selectedProjectId ? t("form.selectProjectFirst") : t("form.selectLocation")} />
                            </SelectTrigger>
                            <SelectContent>
                              {/* HQ option — available when project is not explicitly state_managed and user is not state-scoped */}
                              {pmrHqAvailable && (
                                <SelectItem value="__hq__">{t("form.hqHeadquarters")}</SelectItem>
                              )}
                              {(isProject && selectedProjectId
                                // Project is selected: show only the project's linked states.
                                // When allowedStateIds is empty the project has no linked states —
                                // do NOT fall back to all states; show nothing (only HQ if valid).
                                ? states?.filter((s) => allowedStateIds.includes(s.id))
                                : states
                              )?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
                            </SelectContent>
                          </Select>
                        )}
                        {fieldErrors["stateId"] && !isActivity && (
                          <p id="err-pmr-location" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["stateId"]}</p>
                        )}
                      </div>
                      {/* ── SECTOR ── */}
                      {(isProject || isHqSector) && (
                        <div>
                          <Label className="flex items-center gap-1">
                            {t("fields.sector")} {isHqSector ? <span className="text-destructive">*</span> : ""}
                            {sectorFieldLocked && <span className="text-xs font-normal text-muted-foreground">({t("form.fromProject")})</span>}
                            {!sectorFieldLocked && allowedSectors.length > 1 && <span className="text-xs font-normal text-warning">({t("form.chooseProjectSector")})</span>}
                          </Label>
                          {isProject && sectorFieldLocked ? (
                            <Input
                              readOnly
                              value={v.sector ?? ""}
                              className="bg-muted cursor-not-allowed"
                            />
                          ) : (
                            <Select value={v.sector || "_none"} onValueChange={(val) => form.setValue("sector", val === "_none" ? "" : val)}>
                              <SelectTrigger><SelectValue placeholder={t("form.selectSector")} /></SelectTrigger>
                              <SelectContent>
                                {!isHqSector && <SelectItem value="_none">{t("form.notSet")}</SelectItem>}
                                {(isProject && allowedSectors.length > 0
                                  ? SECTORS.filter((s) => allowedSectors.includes(s))
                                  : SECTORS
                                ).map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      )}
                      {/* Frequency + Dynamic period block */}
                      <div className="col-span-2">
                        <Label htmlFor="pmr-frequency">{t("form.reportingFrequency")} <span className="text-destructive">*</span></Label>
                        <div className="max-w-xs">
                        <Select value={v.kind} onValueChange={(val) => form.setValue("kind", val)}>
                          <SelectTrigger id="pmr-frequency" aria-required="true"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">{t("frequency.monthly")}</SelectItem>
                            <SelectItem value="quarterly">{t("frequency.quarterly")}</SelectItem>
                            <SelectItem value="annual">{t("frequency.annual")}</SelectItem>
                            <SelectItem value="on_demand">{t("frequency.on_demand")}</SelectItem>
                          </SelectContent>
                        </Select>
                        </div>
                        {/* Soft mismatch warning (Task #325): informational only — never blocks
                            Save As Draft or Submit, and never changes the selected kind. */}
                        {(() => {
                          if (!isProject) return null;
                          const projFreq = (selectedProjectObj as unknown as Record<string, unknown> | undefined)
                            ?.reportingFrequency as "monthly" | "quarterly" | "annual" | null | undefined;
                          const cap = (s: string) => displayFrequency(s, t);
                          const showWarning =
                            projFreq != null &&
                            v.kind !== "on_demand" &&
                            ["monthly", "quarterly", "annual"].includes(v.kind) &&
                            v.kind !== projFreq;
                          if (!showWarning) return null;
                          return (
                            <p
                              role="alert"
                              aria-live="polite"
                              className="text-sm text-amber-700 dark:text-amber-400 mt-1"
                              data-testid="text-frequency-mismatch-warning"
                            >
                              {t("form.scheduledFrequencyMismatch", { scheduled: cap(projFreq), selected: cap(v.kind) })}
                            </p>
                          );
                        })()}
                      </div>
                      {v.kind === "monthly" && (
                        <>
                          <div>
                            <Label htmlFor="pmr-month">{t("form.reportingMonth")} <span className="text-destructive">*</span></Label>
                            <Select value={String(v.reportingMonth)} onValueChange={(val) => form.setValue("reportingMonth", Number(val))}>
                              <SelectTrigger id="pmr-month" aria-required="true" aria-invalid={!!fieldErrors["reportingMonth"] || undefined} aria-describedby={fieldErrors["reportingMonth"] ? "err-pmr-month" : undefined}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                  <SelectItem key={m} value={String(m)}>{new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {fieldErrors["reportingMonth"] && (
                              <p id="err-pmr-month" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["reportingMonth"]}</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="pmr-year">{t("form.reportingYear")} <span className="text-destructive">*</span></Label>
                            <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                              <SelectTrigger id="pmr-year" aria-required="true" aria-invalid={!!fieldErrors["reportingYear"] || undefined} aria-describedby={fieldErrors["reportingYear"] ? "err-pmr-year" : undefined}><SelectValue /></SelectTrigger>
                              <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                            {fieldErrors["reportingYear"] && (
                              <p id="err-pmr-year" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["reportingYear"]}</p>
                            )}
                          </div>
                        </>
                      )}
                      {v.kind === "quarterly" && (
                        <>
                          <div>
                            <Label htmlFor="pmr-quarter">{t("form.quarter")} <span className="text-destructive">*</span></Label>
                            <Select value={String(quarter)} onValueChange={(val) => setQuarter(Number(val))}>
                              <SelectTrigger id="pmr-quarter" aria-required="true" aria-invalid={!!fieldErrors["quarter"] || undefined} aria-describedby={fieldErrors["quarter"] ? "err-pmr-quarter" : undefined}><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {[1, 2, 3, 4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            {fieldErrors["quarter"] && (
                              <p id="err-pmr-quarter" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["quarter"]}</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="pmr-year">{t("form.year")} <span className="text-destructive">*</span></Label>
                            <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                              <SelectTrigger id="pmr-year" aria-required="true"><SelectValue /></SelectTrigger>
                              <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </>
                      )}
                      {v.kind === "annual" && (
                        <div className="col-span-2">
                          <Label htmlFor="pmr-year">{t("form.reportingYear")} <span className="text-destructive">*</span></Label>
                          <div className="max-w-[10rem]">
                            <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                              <SelectTrigger id="pmr-year" aria-required="true"><SelectValue /></SelectTrigger>
                              <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                            </Select>
                          </div>
                        </div>
                      )}
                      {v.kind === "on_demand" && (
                        <>
                          <div>
                            <Label htmlFor="pmr-period-start">{t("form.periodStart")} <span className="text-destructive">*</span></Label>
                            <Input id="pmr-period-start" type="date" aria-required="true" aria-invalid={!!fieldErrors["periodStart"] || undefined} aria-describedby={fieldErrors["periodStart"] ? "err-pmr-period-start" : undefined} {...form.register("periodStart")} />
                            {fieldErrors["periodStart"] && (
                              <p id="err-pmr-period-start" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["periodStart"]}</p>
                            )}
                          </div>
                          <div>
                            <Label htmlFor="pmr-period-end">{t("form.periodEnd")}</Label>
                            <Input id="pmr-period-end" type="date" {...form.register("periodEnd")} />
                          </div>
                          <div className="col-span-2">
                            <Label htmlFor="pmr-ondemand-reason">{t("form.onDemandReason")} <span className="text-destructive">*</span></Label>
                            <div className="max-w-xs">
                              <Select value={onDemandReason} onValueChange={setOnDemandReason}>
                                <SelectTrigger id="pmr-ondemand-reason" aria-required="true" aria-invalid={!!fieldErrors["onDemandReason"] || undefined} aria-describedby={fieldErrors["onDemandReason"] ? "err-pmr-ondemand-reason" : undefined}><SelectValue placeholder={t("form.selectReason")} /></SelectTrigger>
                                <SelectContent>
                                  {([
                                    ["Donor Request", "donorRequest"],
                                    ["Management Request", "managementRequest"],
                                    ["Emergency Response", "emergencyResponse"],
                                    ["Audit Requirement", "auditRequirement"],
                                    ["Other", "other"],
                                  ] as const).map(([value, key]) => (
                                    <SelectItem key={value} value={value}>{t(`form.${key}`)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            {fieldErrors["onDemandReason"] && (
                              <p id="err-pmr-ondemand-reason" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["onDemandReason"]}</p>
                            )}
                          </div>
                        </>
                      )}
                      {/* Duplicate detection alert */}
                      {isProject && dupCheck?.matchType === "exact" && dupCheck.existingReport && (
                        <div className="col-span-2 rounded border border-warning/30 bg-warning/10 p-3 flex items-start gap-2">
                          <AlertCircle className="h-4 w-4 text-warning mt-0.5 flex-shrink-0" />
                          <div className="text-xs">
                            <p className="font-semibold text-warning">{t("form.duplicatePeriodTitle")}</p>
                            <p className="text-warning/80 mt-0.5">
                              <strong>{dupCheck.existingReport.title}</strong> — {t("list.status")}: {displayStatus(dupCheck.existingReport.status, t)}
                            </p>
                            <p className="text-warning mt-1">{t("form.duplicatePeriodHelp")}</p>
                          </div>
                        </div>
                      )}
                      <div className="col-span-2">
                        <Label htmlFor="field-title">{t("fields.reportTitle")} <span className="text-destructive">*</span></Label>
                        <Input
                          {...form.register("title")}
                          id="field-title"
                          placeholder={`e.g. ${meta.short} report — ${computedPeriod}`}
                          onFocus={() => { autoTitleRef.current = ""; }}
                          aria-invalid={!!fieldErrors["title"] || undefined}
                          aria-describedby={fieldErrors["title"] ? "err-title" : undefined}
                        />
                        {fieldErrors["title"] && (
                          <p id="err-title" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["title"]}</p>
                        )}
                        {fieldErrors["projectCurrency"] && (
                          <p id="err-project-currency" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["projectCurrency"]}</p>
                        )}
                      </div>
                      {(isHqSector || isProgramState) && (
                        <div className="col-span-2">
                          <Label>{t("form.preparedBy")}</Label>
                          <Input value={`${me?.user?.name ?? "—"} (${me?.user?.roleLabel ?? "—"})`} readOnly className="bg-muted" />
                        </div>
                      )}
                    </div>
                  </section>

                  {/* ── ACTIVITY REPORT TAB 1: BASIC INFORMATION (ar-section-basic) ── */}
                  {isActivity && (
                    <section
                      role="tabpanel"
                      id="ar-section-basic"
                      aria-labelledby="tab-ar-section-basic"
                      className={activeSection === "ar-section-basic" ? "space-y-4" : "hidden"}
                    >
                      {/* ─── A: Report Context ─── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold text-muted-foreground">{t("form.reportContext")}</p>

                        {/* State / Location — locked for single-state users (scope-based, not role-based) */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <Label>{t("form.stateLocation")} <span className="text-destructive">*</span></Label>
                            {singleStateUser ? (
                              <div>
                                <div className="relative">
                                  <Lock className="absolute start-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
                                  <Input
                                    readOnly
                                    value={visibleStates.find((s) => s.id === v.stateId)?.name ?? t("form.assignedState")}
                                    className="bg-muted cursor-not-allowed ps-8"
                                  />
                                </div>
                                <p className="text-xs text-muted-foreground mt-1">{t("form.assignedStateHelp")}</p>
                              </div>
                            ) : (
                              <LocationSelector
                                value={{ locationType: reportLocationType, stateId: v.stateId || null }}
                                onChange={({ locationType, stateId: sid }) => {
                                  setReportLocationType(locationType ?? "state");
                                  form.setValue("stateId", sid ?? 0);
                                  setFieldErrors((cur) => ({ ...cur, stateId: undefined }));
                                }}
                                states={visibleStates}
                                placeholder={t("form.selectLocation")}
                                invalid={!!fieldErrors["stateId"]}
                                aria-invalid={!!fieldErrors["stateId"] || undefined}
                              />
                            )}
                            {fieldErrors["stateId"] && <p role="alert" className="text-sm text-destructive mt-1">{fieldErrors["stateId"]}</p>}
                          </div>
                        </div>

                        {/* Report Subject / Activity Name — required; primary human-readable identity */}
                        <div>
                          <Label>{t("form.activitySubject")} <span className="text-destructive">*</span></Label>
                          <Input
                            {...form.register("activityName")}
                            placeholder={t("form.activitySubjectPlaceholder")}
                            aria-invalid={!!fieldErrors["activityName"] || undefined}
                            className={cn(fieldErrors["activityName"] && "border-destructive")}
                          />
                          <p className="text-xs text-muted-foreground mt-1">{t("form.activitySubjectHelp")}</p>
                          {fieldErrors["activityName"] && <p role="alert" className="text-sm text-destructive mt-1">{fieldErrors["activityName"]}</p>}
                        </div>

                        {/* Link To Existing Record — optional 3-mode selector */}
                        <div>
                          <p className="text-[11px] font-semibold text-muted-foreground mb-1.5">
                            {t("form.linkExistingRecord")} <span className="font-normal normal-case tracking-normal text-muted-foreground/70">({t("form.optional")})</span>
                          </p>
                          <div className="flex rounded-md border border-border overflow-hidden">
                            {(["standalone", "activity", "project"] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={() => handleLinkModeChange(m)}
                                className={cn(
                                  "flex-1 px-2 py-1.5 text-xs font-medium transition-colors text-center border-r last:border-r-0 border-border",
                                  linkMode === m
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-background text-muted-foreground hover:text-foreground hover:bg-muted/50"
                                )}
                              >
                                {m === "standalone" ? t("form.standalone") : m === "activity" ? t("form.existingActivity") : t("fields.project")}
                              </button>
                            ))}
                          </div>
                          {linkMode === "standalone" && (
                            <p className="text-xs text-muted-foreground mt-1">{t("form.standaloneLinkHelp")}</p>
                          )}
                        </div>

                        {/* ── Existing Activity mode ── */}
                        {linkMode === "activity" && (
                          <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {/* Activity combobox */}
                              <div className="sm:col-span-2">
                                <Label>{t("fields.activity")}</Label>
                                <Popover open={activityComboOpen} onOpenChange={(open) => { if (!activitiesLoading) setActivityComboOpen(open); }}>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      role="combobox"
                                      aria-expanded={activityComboOpen}
                                      aria-invalid={!!fieldErrors["activityId"] || undefined}
                                      className={cn(
                                        "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                        fieldErrors["activityId"] && "border-destructive",
                                      )}
                                    >
                                      <span className={!activityId ? "text-muted-foreground" : "text-foreground"}>
                                        {activitiesLoading
                                          ? t("form.loadingActivities")
                                          : activityId
                                          ? activitiesData?.find((a) => a.id === activityId)?.title ?? t("form.selectedActivity")
                                          : t("form.searchActivities")}
                                      </span>
                                      {activitiesLoading
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                                        : <ChevronRight className="ms-2 h-4 w-4 shrink-0 text-muted-foreground opacity-50 rtl:rotate-180" />}
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[min(520px,90vw)] p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder={t("form.searchByNameCode")} />
                                      <CommandList>
                                        {activitiesError ? (
                                          <div className="px-3 py-4 text-center">
                                            <p className="text-sm font-medium text-destructive">{t("form.activitiesLoadError")}</p>
                                            <p className="text-xs text-muted-foreground mt-1">{t("form.activitiesLoadErrorHelp")}</p>
                                          </div>
                                        ) : activitiesLoading ? (
                                          <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground">
                                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                            <span>{t("form.loadingActivities")}</span>
                                          </div>
                                        ) : (
                                          <>
                                            {(!activitiesData || activitiesData.length === 0) ? (
                                              <div className="px-3 py-4 text-center">
                                                <p className="text-sm font-medium">{t("form.noActivities")}</p>
                                                <p className="text-xs text-muted-foreground mt-1">{t("form.noActivitiesScope")}</p>
                                              </div>
                                            ) : (
                                              <CommandGroup>
                                                {activitiesData
                                                  .filter((a) => !v.stateId || !a.stateId || Number(a.stateId) === Number(v.stateId))
                                                  .map((a) => {
                                                  const sa = a as ScopedActivity;
                                                  return (
                                                    <CommandItem
                                                      key={a.id}
                                                      value={`${a.code ?? ""} ${a.title}`}
                                                      onSelect={() => {
                                                        setActivityId(a.id);
                                                        form.setValue("projectId", sa.projectId ?? 0);
                                                        // Pre-populate activityName from activity title if not yet edited.
                                                        if (!form.getValues("activityName").trim()) {
                                                          form.setValue("activityName", a.title);
                                                        }
                                                        setFieldErrors((cur) => ({ ...cur, activityId: undefined, activityName: undefined }));
                                                        setActivityComboOpen(false);
                                                      }}
                                                    >
                                                      <div className="flex flex-col w-full">
                                                        <span className="font-medium text-sm">{a.title}</span>
                                                        <span className="text-[11px] text-muted-foreground">
                                                          {[
                                                            a.code,
                                                            sa.sector,
                                                            a.stateName,
                                                            a.plannedStart ? String(a.plannedStart).slice(0, 10) : null,
                                                            a.plannedEnd ? `– ${String(a.plannedEnd).slice(0, 10)}` : null,
                                                          ].filter(Boolean).join(" · ")}
                                                        </span>
                                                        {sa.projectTitle && (
                                                          <span className="text-[11px] text-muted-foreground/70 mt-0.5">{sa.projectTitle}</span>
                                                        )}
                                                      </div>
                                                    </CommandItem>
                                                  );
                                                })}
                                              </CommandGroup>
                                            )}
                                          </>
                                        )}
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                                {fieldErrors["activityId"] && <p role="alert" className="text-sm text-destructive mt-1">{fieldErrors["activityId"]}</p>}

                                {/* Compact Activity summary strip */}
                                {activityId && (() => {
                                  const act = activitiesData?.find((a) => a.id === activityId);
                                  if (!act) return null;
                                  const sa = act as ScopedActivity;
                                  return (
                                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                                      {act.code && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("form.code")}</dt><dd className="font-medium">{act.code}</dd></div>}
                                      {sa.sector && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("fields.sector")}</dt><dd className="font-medium">{sa.sector}</dd></div>}
                                      {act.stateName && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("fields.state")}</dt><dd className="font-medium">{getLinkedStateLabel(act, i18n.language)}</dd></div>}
                                      {act.localityName && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("form.location")}</dt><dd className="font-medium">{act.localityName}</dd></div>}
                                      {act.plannedStart && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("form.plannedStart")}</dt><dd className="font-medium">{String(act.plannedStart).slice(0, 10)}</dd></div>}
                                      {act.plannedEnd && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("form.plannedEnd")}</dt><dd className="font-medium">{String(act.plannedEnd).slice(0, 10)}</dd></div>}
                                      {act.status && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("list.status")}</dt><dd className="font-medium capitalize">{displayStatus(String(act.status), t)}</dd></div>}
                                      {sa.projectId ? (
                                        <div className="flex items-center gap-1 w-full mt-0.5 pt-1 border-t border-border/40">
                                          <dt className="text-muted-foreground">{t("form.linkedProjectDisplay")}</dt>
                                          <dd className="font-medium">{sa.projectTitle ?? t("fields.project")}{sa.projectCode ? ` · ${sa.projectCode}` : ""}</dd>
                                        </div>
                                      ) : (
                                        <div className="flex items-center gap-1 w-full mt-0.5 pt-1 border-t border-border/40">
                                          <dd className="text-muted-foreground">{t("form.noLinkedProject")}</dd>
                                        </div>
                                      )}
                                    </dl>
                                  );
                                })()}
                              </div>

                              {/* Project filter — optional; narrows the activity list */}
                              <div className="sm:col-span-2">
                                 <Label className="text-muted-foreground">{t("form.projectFilter")} <span className="font-normal text-muted-foreground/70">({t("form.optional")})</span></Label>
                                <Popover open={projectComboOpen} onOpenChange={setProjectComboOpen}>
                                  <PopoverTrigger asChild>
                                    <button
                                      type="button"
                                      role="combobox"
                                      aria-expanded={projectComboOpen}
                                      className="flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                                    >
                                      <span className={projectFilterId ? "text-foreground" : "text-muted-foreground"}>
                                        {projectFilterId
                                          ? projects?.find((p) => p.id === projectFilterId)?.title ?? t("form.selectedProject")
                                          : t("filters.allProjects")}
                                      </span>
                                      <ChevronRight className="ms-2 h-4 w-4 shrink-0 text-muted-foreground opacity-50 rtl:rotate-180" />
                                    </button>
                                  </PopoverTrigger>
                                  <PopoverContent className="w-[min(480px,90vw)] p-0" align="start">
                                    <Command>
                                      <CommandInput placeholder={t("form.searchByNameCode")} />
                                      <CommandList>
                                        <CommandEmpty>{t("form.noProjectsFound")}</CommandEmpty>
                                        <CommandGroup>
                                          <CommandItem value="all-projects" onSelect={() => { setProjectFilterId(0); setProjectComboOpen(false); }}>
                                            <div className="flex flex-col w-full">
                                              <span className="font-medium text-sm text-muted-foreground">{t("filters.allProjects")}</span>
                                            </div>
                                          </CommandItem>
                                          {projects
                                            ?.filter((p) => !v.stateId || (p.stateIds ?? []).includes(Number(v.stateId)))
                                            .map((p) => {
                                            const pR = p as unknown as Record<string, unknown>;
                                            const donor = (pR["donorName"] ?? pR["donor"] ?? "—") as string;
                                            return (
                                              <CommandItem
                                                key={p.id}
                                                value={`${p.code} ${p.title}`}
                                                onSelect={() => { setProjectFilterId(p.id); setProjectComboOpen(false); }}
                                              >
                                                <div className="flex flex-col w-full">
                                                  <span className="font-medium text-sm">{p.title}</span>
                                                  <span className="text-[11px] text-muted-foreground">{p.code} · {donor} · {formatStatusLabel(p.status)}</span>
                                                </div>
                                              </CommandItem>
                                            );
                                          })}
                                        </CommandGroup>
                                      </CommandList>
                                    </Command>
                                  </PopoverContent>
                                </Popover>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── Project mode ── */}
                        {linkMode === "project" && (
                          <div className="space-y-2">
                            <div>
                              <Label>{t("fields.project")} <span className="text-destructive">*</span></Label>
                              <Popover open={projectComboOpen} onOpenChange={setProjectComboOpen}>
                                <PopoverTrigger asChild>
                                  <button
                                    type="button"
                                    role="combobox"
                                    aria-expanded={projectComboOpen}
                                    aria-invalid={!!fieldErrors["projectId"] || undefined}
                                    aria-describedby={fieldErrors["projectId"] ? "err-ar-project" : undefined}
                                    className={cn(
                                      "flex w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
                                      fieldErrors["projectId"] && "border-destructive",
                                    )}
                                  >
                                    <span className={!v.projectId ? "text-muted-foreground" : "text-foreground"}>
                                      {v.projectId
                                        ? projects?.find((p) => p.id === Number(v.projectId))?.title ?? t("form.selectedProject")
                                        : t("form.searchProjects")}
                                    </span>
                                    <ChevronRight className="ms-2 h-4 w-4 shrink-0 text-muted-foreground opacity-50 rtl:rotate-180" />
                                  </button>
                                </PopoverTrigger>
                                <PopoverContent className="w-[min(520px,90vw)] p-0" align="start">
                                  <Command>
                                    <CommandInput placeholder={t("form.searchByNameCode")} />
                                    <CommandList>
                                      <CommandEmpty>{t("form.noProjectsFound")}</CommandEmpty>
                                      <CommandGroup>
                                        {projects
                                          ?.filter((p) => !v.stateId || (p.stateIds ?? []).includes(Number(v.stateId)))
                                          .map((p) => {
                                          const pR = p as unknown as Record<string, unknown>;
                                          const donor = (pR["donorName"] ?? pR["donor"] ?? "—") as string;
                                          return (
                                            <CommandItem
                                              key={p.id}
                                              value={`${p.code} ${p.title}`}
                                              onSelect={() => {
                                                form.setValue("projectId", p.id);
                                                setFieldErrors((cur) => ({ ...cur, projectId: undefined }));
                                                setProjectComboOpen(false);
                                              }}
                                            >
                                              <div className="flex flex-col w-full">
                                                <span className="font-medium text-sm">{p.title}</span>
                                                <span className="text-[11px] text-muted-foreground">{p.code} · {donor} · {formatStatusLabel(p.status)}</span>
                                              </div>
                                            </CommandItem>
                                          );
                                        })}
                                      </CommandGroup>
                                    </CommandList>
                                  </Command>
                                </PopoverContent>
                              </Popover>
                              {fieldErrors["projectId"] && <p id="err-ar-project" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["projectId"]}</p>}

                              {/* Project summary strip */}
                              {v.projectId > 0 && (() => {
                                const proj = projects?.find((p) => p.id === Number(v.projectId));
                                if (!proj) return null;
                                const pR = proj as unknown as Record<string, unknown>;
                                const donor = (pR["donorName"] ?? pR["donor"] ?? "—") as string;
                                return (
                                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 rounded-md border bg-muted/30 px-3 py-2 text-xs">
                                    {proj.code && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("form.code")}</dt><dd className="font-medium">{proj.code}</dd></div>}
                                    {donor !== "—" && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("detail.donor")}</dt><dd className="font-medium">{donor}</dd></div>}
                                    {proj.status && <div className="flex items-center gap-1"><dt className="text-muted-foreground">{t("list.status")}</dt><dd className="font-medium capitalize">{displayStatus(String(proj.status), t)}</dd></div>}
                                  </dl>
                                );
                              })()}
                            </div>
                          </div>
                        )}
                      </div>
                                            <hr className="border-border/60" />
                      {/* ─── B: Reporting Period — Month + Year only (Activity Reports are always monthly) ─── */}
                       <div className="space-y-3">
                         <p className="text-[11px] font-semibold text-muted-foreground">{t("fields.period")}</p>
                         <div className="grid grid-cols-2 gap-3">
                           <div>
                             <Label>{t("fields.periodMonth")} *</Label>
                             <Select value={String(v.reportingMonth)} onValueChange={(val) => form.setValue("reportingMonth", Number(val))}>
                               <SelectTrigger><SelectValue /></SelectTrigger>
                               <SelectContent>
                                 {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                                  <SelectItem key={m} value={String(m)}>{new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })}</SelectItem>
                                 ))}
                               </SelectContent>
                             </Select>
                           </div>
                           <div>
                             <Label>{t("fields.periodYear")} *</Label>
                             <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                               <SelectTrigger><SelectValue /></SelectTrigger>
                               <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                             </Select>
                           </div>
                         </div>
                       </div>
                      <hr className="border-border/60" />
                      {/* ─── C: Report Identification ─── */}
                      <div className="space-y-3">
                        <p className="text-[11px] font-semibold text-muted-foreground">{t("formExtra.reportIdentification")}</p>
                        <div>
                          <Label htmlFor="ar-field-title">Report Title *</Label>
                          <Input
                            {...form.register("title")}
                            id="ar-field-title"
                            placeholder={t("formExtra.autoGeneratedTitle")}
                            onFocus={() => { autoTitleRef.current = ""; }}
                            aria-invalid={!!fieldErrors["title"] || undefined}
                            aria-describedby={fieldErrors["title"] ? "ar-err-title" : undefined}
                          />
                          {fieldErrors["title"] && (
                            <p id="ar-err-title" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["title"]}</p>
                          )}
                        </div>
                      </div>
                    </section>
                  )}

                  {/* ── TAB 2: PROGRESS ── */}
                  <section
                    role="tabpanel"
                    id={isActivity ? "ar-section-progress" : "rp-section-progress"}
                    aria-labelledby={`tab-${isActivity ? "ar-section-progress" : "rp-section-progress"}`}
                    className={(isActivity ? activeSection === "ar-section-progress" : activeSection === "rp-section-progress") ? "space-y-3" : "hidden"}
                  >
                    <h4 className="text-sm font-semibold border-b pb-1">
                      {isActivity ? t("wizard.step2.sectionHeader") : isHqSector ? "Sector Progress & Achievements" : isProgramState ? "State Progress & Achievements" : "Progress & Achievements"}
                    </h4>

                    {isActivity ? (
                      /* ── Activity Report Step 2: three-section layout ── */
                      <div className="space-y-5">
                        {/* Section A — Implementation Status */}
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("wizard.step2.sectionAHeader")}</p>
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                            {/* Implementation Status select */}
                            <div>
                              <Label htmlFor="field-implementationStatus">
                                {t("wizard.step2.implementationStatus")} *
                              </Label>
                              <Select
                                value={sectionValues["implementationStatus"] ?? ""}
                                onValueChange={(val) => {
                                  setSectionValues((cur) => ({ ...cur, implementationStatus: val }));
                                  setIsFormDirty(true);
                                  setFieldErrors((cur) => ({ ...cur, implementationStatus: undefined }));
                                }}
                              >
                                <SelectTrigger
                                  id="field-implementationStatus"
                                  aria-invalid={!!fieldErrors["implementationStatus"] || undefined}
                                  aria-describedby={fieldErrors["implementationStatus"] ? "err-implementationStatus" : undefined}
                                >
                                  <SelectValue placeholder={t("wizard.step2.statusPlaceholder")} />
                                </SelectTrigger>
                                <SelectContent>
                                  {IMPLEMENTATION_STATUS_OPTIONS.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>{t(`implementationStatus.${opt.value}`)}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {fieldErrors["implementationStatus"] && (
                                <p id="err-implementationStatus" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["implementationStatus"]}</p>
                              )}
                            </div>
                            {/* Actual Start Date */}
                            <div>
                              <Label htmlFor="field-actualStartDate">{t("wizard.step2.actualStartDate")}</Label>
                              <Input
                                id="field-actualStartDate"
                                type="date"
                                value={sectionValues["actualStartDate"] ?? ""}
                                onChange={(e) => {
                                  setSectionValues((cur) => ({ ...cur, actualStartDate: e.target.value }));
                                  setIsFormDirty(true);
                                  setFieldErrors((cur) => ({ ...cur, actualStartDate: undefined, actualEndDate: undefined }));
                                }}
                              />
                            </div>
                            {/* Actual End Date */}
                            <div>
                              <Label htmlFor="field-actualEndDate">{t("wizard.step2.actualEndDate")}</Label>
                              <Input
                                id="field-actualEndDate"
                                type="date"
                                value={sectionValues["actualEndDate"] ?? ""}
                                onChange={(e) => {
                                  setSectionValues((cur) => ({ ...cur, actualEndDate: e.target.value }));
                                  setIsFormDirty(true);
                                  setFieldErrors((cur) => ({ ...cur, actualEndDate: undefined }));
                                }}
                                aria-invalid={!!fieldErrors["actualEndDate"] || undefined}
                                aria-describedby={fieldErrors["actualEndDate"] ? "err-actualEndDate" : undefined}
                              />
                              {fieldErrors["actualEndDate"] && (
                                <p id="err-actualEndDate" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["actualEndDate"]}</p>
                              )}
                            </div>
                          </div>
                        </div>

                        <hr className="border-border/60" />

                        {/* Section B — Implementation Summary */}
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("wizard.step2.sectionBHeader")}</p>
                          <div>
                            <Label htmlFor="field-implementationSummary">{t("wizard.step2.implementationSummary")} *</Label>
                            <p className="text-xs text-muted-foreground mb-1">
                              {t("wizard.step2.implementationSummaryHelper")}
                            </p>
                            <div className="max-w-2xl">
                            <Textarea
                              id="field-implementationSummary"
                              rows={4}
                              className="resize-y"
                              value={sectionValues["implementationSummary"] ?? ""}
                              onChange={(e) => {
                                setSectionValues((cur) => ({ ...cur, implementationSummary: e.target.value }));
                                setIsFormDirty(true);
                                setFieldErrors((cur) => ({ ...cur, implementationSummary: undefined }));
                              }}
                              placeholder={t("wizard.step2.implementationSummaryPlaceholder")}
                              aria-invalid={!!fieldErrors["implementationSummary"] || undefined}
                              aria-describedby={fieldErrors["implementationSummary"] ? "err-implementationSummary" : undefined}
                            />
                            </div>
                            {fieldErrors["implementationSummary"] && (
                              <p id="err-implementationSummary" role="alert" className="text-sm text-destructive mt-1">{fieldErrors["implementationSummary"]}</p>
                            )}
                          </div>
                        </div>

                        <hr className="border-border/60" />

                        {/* Section C — Progress Against Plan */}
                        <div className="space-y-3">
                          <p className="text-[11px] font-semibold text-muted-foreground">{t("wizard.step2.sectionCHeader")}</p>
                          <div>
                            <Label htmlFor="field-progressAgainstPlan">{t("wizard.step2.progressAgainstPlan")}</Label>
                            <p className="text-xs text-muted-foreground mb-1">
                              {t("wizard.step2.progressAgainstPlanHelper")}
                            </p>
                            <div className="max-w-2xl">
                            <Textarea
                              id="field-progressAgainstPlan"
                              rows={3}
                              className="resize-y"
                              value={sectionValues["progressAgainstPlan"] ?? ""}
                              onChange={(e) => {
                                setSectionValues((cur) => ({ ...cur, progressAgainstPlan: e.target.value }));
                                setIsFormDirty(true);
                              }}
                              placeholder={t("wizard.step2.progressAgainstPlanPlaceholder")}
                            />
                            </div>
                          </div>
                          <div>
                            <Label htmlFor="field-keyAchievements">{t("wizard.step2.implementationHighlights")}</Label>
                            <p className="text-xs text-muted-foreground mb-1">
                              {t("wizard.step2.implementationHighlightsHelper")}
                            </p>
                            <div className="max-w-2xl">
                            <Textarea
                              id="field-keyAchievements"
                              rows={3}
                              className="resize-y"
                              value={sectionValues["keyAchievements"] ?? ""}
                              onChange={(e) => {
                                setSectionValues((cur) => ({ ...cur, keyAchievements: e.target.value }));
                                setIsFormDirty(true);
                              }}
                              placeholder={t("wizard.step2.implementationHighlightsPlaceholder")}
                            />
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      /* ── Non-activity reports: generic field list ── */
                      sectionsCfg.progress.map((f) => (
                        <div key={f.key}>
                          <Label htmlFor={`field-${f.key}`}>{configuredFieldLabel(f)}{f.required ? " *" : ""}</Label>
                          <div className="max-w-2xl">
                            <Textarea
                              id={`field-${f.key}`}
                              rows={f.rows ?? 3}
                              className="resize-y"
                              value={sectionValues[f.key] ?? ""}
                              onChange={(e) => { setSectionValues((cur) => ({ ...cur, [f.key]: e.target.value })); setIsFormDirty(true); setFieldErrors((cur) => ({ ...cur, [f.key]: undefined })); }}
                              placeholder={t("form.writeNarrative")}
                              aria-invalid={!!fieldErrors[f.key] || undefined}
                              aria-describedby={fieldErrors[f.key] ? `err-${f.key}` : undefined}
                            />
                          </div>
                          {fieldErrors[f.key] && (
                            <p id={`err-${f.key}`} role="alert" className="text-sm text-destructive mt-1">{fieldErrors[f.key]}</p>
                          )}
                        </div>
                      ))
                    )}
                  </section>

                  {/* ── ACTIVITY REPORT TAB 3: RESULTS & BENEFICIARIES (ar-section-results) ── */}
                  {isActivity && (
                    <section
                      role="tabpanel"
                      id="ar-section-results"
                      aria-labelledby="tab-ar-section-results"
                      className={activeSection === "ar-section-results" ? "space-y-6" : "hidden"}
                    >
                      <h4 className="text-sm font-semibold border-b pb-1">Results & Beneficiaries</h4>

                      {/* ── Sub-section 1: Results Achieved ── */}
                      <div className="space-y-2">
                        <div>
                          <Label htmlFor="field-resultsAchieved" className="text-sm font-medium">
                            Results Achieved <span className="text-destructive">*</span>
                          </Label>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Describe the main results or outputs achieved through this activity during the reporting period.
                          </p>
                        </div>
                        <div className="max-w-2xl">
                        <Textarea
                          id="field-resultsAchieved"
                          rows={4}
                          className="resize-y"
                          value={sectionValues["resultsAchieved"] ?? ""}
                          onChange={(e) => {
                            setSectionValues((cur) => ({ ...cur, resultsAchieved: e.target.value }));
                            setIsFormDirty(true);
                            setFieldErrors((cur) => ({ ...cur, resultsAchieved: undefined }));
                          }}
                          placeholder={t("form.writeNarrative")}
                          aria-invalid={!!fieldErrors["resultsAchieved"] || undefined}
                          aria-describedby={fieldErrors["resultsAchieved"] ? "err-resultsAchieved" : undefined}
                        />
                        </div>
                        {fieldErrors["resultsAchieved"] && (
                          <p id="err-resultsAchieved" role="alert" className="text-sm text-destructive">
                            {fieldErrors["resultsAchieved"]}
                          </p>
                        )}
                      </div>

                      <Separator />

                      {/* ── Sub-section 2: Beneficiary Reach toggle ── */}
                      <div className="space-y-4">
                        <div>
                          <Label className="text-sm font-medium">{t("formExtra.beneficiaryReach")}</Label>
                          <p className="text-xs text-muted-foreground mt-0.5 mb-3">
                            Does this activity have direct beneficiary / participant reach?
                          </p>
                          <div className="flex gap-3">
                            {(["yes", "no"] as const).map((opt) => (
                              <button
                                key={opt}
                                type="button"
                                onClick={() => {
                                  setSectionValues((cur) => ({ ...cur, hasBeneficiaryReach: opt }));
                                  if (opt === "no") {
                                    form.setValue("beneficiariesMale", 0);
                                    form.setValue("beneficiariesFemale", 0);
                                    form.setValue("beneficiariesBoys", 0);
                                    form.setValue("beneficiariesGirls", 0);
                                  }
                                  setIsFormDirty(true);
                                }}
                                className={cn(
                                  "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                                  hasBeneficiaryReachValue === opt
                                    ? "border-primary bg-primary/10 text-primary"
                                    : "border-border bg-card text-foreground hover:bg-muted"
                                )}
                                aria-pressed={hasBeneficiaryReachValue === opt}
                              >
                                {opt === "yes" ? "Yes" : "No / Not Applicable"}
                              </button>
                            ))}
                          </div>
                        </div>

                        {/* Four numeric inputs — visible only when reach = Yes */}
                        {hasBeneficiaryReachValue === "yes" && (
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                              <Label className="text-xs">{t("formExtra.men")}</Label>
                              <Input type="number" min={0} {...form.register("beneficiariesMale", { valueAsNumber: true })} onChange={(e) => { form.setValue("beneficiariesMale", Number(e.target.value)); setIsFormDirty(true); }} />
                            </div>
                            <div>
                              <Label className="text-xs">{t("formExtra.women")}</Label>
                              <Input type="number" min={0} {...form.register("beneficiariesFemale", { valueAsNumber: true })} onChange={(e) => { form.setValue("beneficiariesFemale", Number(e.target.value)); setIsFormDirty(true); }} />
                            </div>
                            <div>
                              <Label className="text-xs">{t("formExtra.boys")}</Label>
                              <Input type="number" min={0} {...form.register("beneficiariesBoys", { valueAsNumber: true })} onChange={(e) => { form.setValue("beneficiariesBoys", Number(e.target.value)); setIsFormDirty(true); }} />
                            </div>
                            <div>
                              <Label className="text-xs">{t("formExtra.girls")}</Label>
                              <Input type="number" min={0} {...form.register("beneficiariesGirls", { valueAsNumber: true })} onChange={(e) => { form.setValue("beneficiariesGirls", Number(e.target.value)); setIsFormDirty(true); }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* ── Sub-section 3: Reach Summary (when Yes and totals > 0) ── */}
                      {hasBeneficiaryReachValue === "yes" && beneficiariesTotal > 0 && (
                        <>
                          <Separator />
                          <div>
                            <Label className="text-sm font-medium">{t("formExtra.reachSummary")}</Label>
                            <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                              <span className="text-muted-foreground">
                                Total Direct Reach:{" "}
                                <strong className="text-foreground">{beneficiariesTotal.toLocaleString()}</strong>
                              </span>
                              {(Number(v.beneficiariesMale || 0) + Number(v.beneficiariesFemale || 0)) > 0 && (
                                <span className="text-muted-foreground">
                                  Adults:{" "}
                                  <strong className="text-foreground">
                                    {(Number(v.beneficiariesMale || 0) + Number(v.beneficiariesFemale || 0)).toLocaleString()}
                                  </strong>
                                </span>
                              )}
                              {(Number(v.beneficiariesBoys || 0) + Number(v.beneficiariesGirls || 0)) > 0 && (
                                <span className="text-muted-foreground">
                                  Children:{" "}
                                  <strong className="text-foreground">
                                    {(Number(v.beneficiariesBoys || 0) + Number(v.beneficiariesGirls || 0)).toLocaleString()}
                                  </strong>
                                </span>
                              )}
                            </div>
                          </div>
                        </>
                      )}
                    </section>
                  )}

                  {/* ── TAB 3: ACTIVITIES (includes indicator progress, beneficiary reach, financial summary) — non-activity types only ── */}
                  <section
                    role="tabpanel"
                    id="rp-section-activities"
                    aria-labelledby="tab-rp-section-activities"
                    className={(!isActivity && activeSection === "rp-section-activities") ? "space-y-3" : "hidden"}
                  >
                    <div className="flex items-center justify-between border-b pb-1">
                      <h4 className="text-sm font-semibold">
                        Section 3 — {isHqSector ? "Sector Activities Implemented" : isProgramState ? "Activities Implemented in the State" : "Activities Implemented"}
                      </h4>
                      {isProject ? (
                        <div className="flex items-center gap-2">
                          {selectedProjectId && !projectActivitiesData && <span className="text-xs text-muted-foreground">Loading project activities…</span>}
                          <Button type="button" size="sm" variant="outline" onClick={() => { setActivities((cur) => [...cur, emptyProjectActivity()]); setIsFormDirty(true); }}>
                            <Plus className="h-3 w-3" /> Add Unplanned Activity (Report Only)
                          </Button>
                        </div>
                      ) : (
                        <Button type="button" size="sm" variant="outline" onClick={() => setActivities((cur) => [...cur, emptyActivity()])}>
                          <Plus className="h-3 w-3" /> Add Activity
                        </Button>
                      )}
                    </div>

                    {/* PROJECT-TYPE: rich activity cards with budget tracking */}
                    {isProject ? (
                      <>
                        {activities.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            {selectedProjectId ? "Select a project above to auto-load its activities." : "No activities yet."}
                          </p>
                        )}
                        {activities.map((a, i) => {
                          // plannedBudget null = no authoritative figure (null ≠ zero)
                          const planned = a.plannedBudget; // number | null
                          const actualNum = a.actualExpenditure === "" ? 0 : Number(a.actualExpenditure ?? 0);
                          const variance = planned != null ? planned - actualNum : null;
                          const needsReason = varianceReasonRequired(planned, actualNum);
                          const cur = projectCurrency ?? undefined;
                          const rowLabel = a.name || (a.isUnplanned ? `Unplanned Activity ${i + 1}` : `Activity ${i + 1}`);

                          return (
                            <div key={i} className="rounded-md border p-3 space-y-3 bg-muted/10">
                              {/* Header row */}
                              <div className="flex items-start justify-between gap-2 flex-wrap">
                                <div className="space-y-0.5">
                                  {a.isUnplanned && (
                                    <Badge variant="outline" className="text-xs mb-0.5">Unplanned Activity (Report Only)</Badge>
                                  )}
                                  <p className="text-sm font-medium">
                                    {a.name || (a.isUnplanned ? `Unplanned Activity #${i + 1}` : `Activity #${i + 1}`)}
                                  </p>
                                  {a.indicator && <p className="text-xs text-muted-foreground">Indicator: {a.indicator}</p>}
                                  {(a.stateName || a.output) && (
                                    <p className="text-xs text-muted-foreground">
                                      {[a.stateName ? getLinkedStateLabel(a, i18n.language) : null, a.output].filter(Boolean).join(" · ")}
                                    </p>
                                  )}
                                  {(a.target !== undefined && a.target > 0) && (
                                    <p className="text-xs text-info flex items-center gap-1">
                                      <Target className="h-3 w-3" /> Target: {a.target.toLocaleString()}
                                    </p>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  {planned != null && <BudgetStatusBadge planned={planned} actual={actualNum} />}
                                  <Button type="button" size="sm" variant="ghost" aria-label={`Remove ${rowLabel}`} onClick={() => { setActivities((cur) => cur.filter((_, idx) => idx !== i)); setIsFormDirty(true); }}>
                                    <Trash2 className="h-3 w-3 text-destructive" />
                                  </Button>
                                </div>
                              </div>

                              {/* Name field (unplanned / custom activities only) */}
                              {!a.activityId && (
                                <div>
                                  <Label className="text-xs">Activity Name *</Label>
                                  <Input aria-label={`Activity Name — ${rowLabel}`} aria-required="true" aria-invalid={!!fieldErrors[`act-${i}-name`] || undefined} aria-describedby={fieldErrors[`act-${i}-name`] ? `err-act-${i}-name` : undefined} value={a.name} onChange={(e) => { updateActivity(i, { name: e.target.value }); setIsFormDirty(true); }} />
                                  {fieldErrors[`act-${i}-name`] && (
                                    <p id={`err-act-${i}-name`} role="alert" className="text-xs text-destructive mt-1">{fieldErrors[`act-${i}-name`]}</p>
                                  )}
                                </div>
                              )}

                              {/* Exception / Reason (mandatory for Unplanned Activities) */}
                              {a.isUnplanned && (
                                <div>
                                  <Label className="text-xs">
                                    Exception / Reason for Unplanned Activity <span className="text-destructive">*</span>
                                  </Label>
                                  <Input
                                    aria-label={`Exception / Reason for Unplanned Activity — ${rowLabel}`}
                                    aria-required="true"
                                    aria-invalid={!!fieldErrors[`act-${i}-unplannedReason`] || undefined}
                                    aria-describedby={fieldErrors[`act-${i}-unplannedReason`] ? `err-act-${i}-unplannedReason` : undefined}
                                    value={a.unplannedReason ?? ""}
                                    onChange={(e) => { updateActivity(i, { unplannedReason: e.target.value }); setIsFormDirty(true); }}
                                    placeholder={t("formExtra.unplannedReasonPlaceholder")}
                                  />
                                  {fieldErrors[`act-${i}-unplannedReason`] && (
                                    <p id={`err-act-${i}-unplannedReason`} role="alert" className="text-xs text-destructive mt-1">{fieldErrors[`act-${i}-unplannedReason`]}</p>
                                  )}
                                </div>
                              )}

                              {/* Budget row */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-muted/30 rounded p-2">
                                <div>
                                  <Label className="text-xs text-muted-foreground">{t("formExtra.plannedBudget")}</Label>
                                  <div className="font-medium text-sm">
                                    {planned != null ? formatCurrency(planned, cur) : "—"}
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs">Actual Expenditure (This Period) *</Label>
                                  <Input
                                    type="number" min={0} step="0.01" inputMode="decimal"
                                    aria-label={`Actual Expenditure (This Period) — ${rowLabel}`}
                                    aria-required="true"
                                    aria-invalid={!!fieldErrors[`act-${i}-actualExpenditure`] || undefined}
                                    aria-describedby={fieldErrors[`act-${i}-actualExpenditure`] ? `err-act-${i}-actualExpenditure` : undefined}
                                    value={a.actualExpenditure ?? ""}
                                    onChange={(e) => { updateActivity(i, { actualExpenditure: e.target.value === "" ? "" : Number(e.target.value) }); setIsFormDirty(true); }}
                                    className="h-8"
                                  />
                                  {fieldErrors[`act-${i}-actualExpenditure`] && (
                                    <p id={`err-act-${i}-actualExpenditure`} role="alert" className="text-xs text-destructive mt-1">{fieldErrors[`act-${i}-actualExpenditure`]}</p>
                                  )}
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">{t("formExtra.variance")}</Label>
                                  <div className="font-medium text-sm text-foreground">
                                    {variance != null
                                      ? `${variance > 0 ? "Underspend" : variance < 0 ? "Overspend" : "On Budget"}: ${formatCurrency(Math.abs(variance), cur)}`
                                      : "—"}
                                  </div>
                                </div>
                                <div>
                                  <Label className="text-xs text-muted-foreground">{t("formExtra.utilisation")}</Label>
                                  <div className="font-medium text-sm">
                                    {planned != null && planned > 0 ? `${Math.round((actualNum / planned) * 100)}%` : "—"}
                                  </div>
                                </div>
                              </div>

                              {/* Variance reason (conditional — required when over budget or < 70%) */}
                              {needsReason && (
                                <div className="bg-warning/10 border border-warning/20 rounded p-2 space-y-1">
                                  <Label className="text-xs font-medium text-warning">
                                    <AlertTriangle className="h-3 w-3 inline me-1" />
                                    Reason for Variance *
                                    {planned != null && actualNum > planned ? " (over budget)" : " (under 70% utilisation)"}
                                  </Label>
                                  <Select
                                    value={a.varianceReason ?? ""}
                                    onValueChange={(val) => { updateActivity(i, { varianceReason: val }); setIsFormDirty(true); }}
                                  >
                                    <SelectTrigger className="h-8" aria-label={`Reason for Variance — ${rowLabel}`} aria-required="true" aria-invalid={!!fieldErrors[`act-${i}-varianceReason`] || undefined} aria-describedby={fieldErrors[`act-${i}-varianceReason`] ? `err-act-${i}-varianceReason` : undefined}><SelectValue placeholder={t("form.selectReason")} /></SelectTrigger>
                                    <SelectContent>
                                      {["Procurement Delay","Activity Rescheduled","Market Price Increase","Additional Beneficiaries Reached","Cost Saving","Security Constraints","Access Constraints","Other"].map((r) => (
                                        <SelectItem key={r} value={r}>{r}</SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                  {fieldErrors[`act-${i}-varianceReason`] && (
                                    <p id={`err-act-${i}-varianceReason`} role="alert" className="text-xs text-destructive mt-1">{fieldErrors[`act-${i}-varianceReason`]}</p>
                                  )}
                                </div>
                              )}

                              {/* Achievement summary */}
                              <div>
                                <Label className="text-xs">Achievement Summary *</Label>
                                <Textarea
                                  rows={3}
                                  className="resize-y"
                                  aria-label={`Achievement Summary — ${rowLabel}`}
                                  aria-required="true"
                                  aria-invalid={!!fieldErrors[`act-${i}-achievementSummary`] || undefined}
                                  aria-describedby={fieldErrors[`act-${i}-achievementSummary`] ? `err-act-${i}-achievementSummary` : undefined}
                                  value={a.achievementSummary ?? ""}
                                  onChange={(e) => updateActivity(i, { achievementSummary: e.target.value })}
                                  placeholder={t("formExtra.achievementSummaryPlaceholder")}
                                />
                                {fieldErrors[`act-${i}-achievementSummary`] && (
                                  <p id={`err-act-${i}-achievementSummary`} role="alert" className="text-xs text-destructive mt-1">{fieldErrors[`act-${i}-achievementSummary`]}</p>
                                )}
                              </div>

                              {/* Beneficiaries per activity */}
                              <div>
                                <Label className="text-xs">Beneficiary Reach This Period *</Label>
                                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mt-1">
                                  <div><Label className="text-xs text-muted-foreground">{t("formExtra.men")}</Label><Input type="number" min={0} inputMode="numeric" aria-label={`Men beneficiaries — ${rowLabel}`} aria-invalid={!!fieldErrors[`act-${i}-ben-men`] || undefined} aria-describedby={fieldErrors[`act-${i}-ben-men`] ? `err-act-${i}-ben-men` : undefined} value={a.beneficiariesMen ?? ""} onChange={(e) => updateActivity(i, { beneficiariesMen: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                                  <div><Label className="text-xs text-muted-foreground">{t("formExtra.women")}</Label><Input type="number" min={0} inputMode="numeric" aria-label={`Women beneficiaries — ${rowLabel}`} aria-invalid={!!fieldErrors[`act-${i}-ben-women`] || undefined} aria-describedby={fieldErrors[`act-${i}-ben-women`] ? `err-act-${i}-ben-women` : undefined} value={a.beneficiariesWomen ?? ""} onChange={(e) => updateActivity(i, { beneficiariesWomen: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                                  <div><Label className="text-xs text-muted-foreground">{t("formExtra.boys")}</Label><Input type="number" min={0} inputMode="numeric" aria-label={`Boys beneficiaries — ${rowLabel}`} aria-invalid={!!fieldErrors[`act-${i}-ben-boys`] || undefined} aria-describedby={fieldErrors[`act-${i}-ben-boys`] ? `err-act-${i}-ben-boys` : undefined} value={a.beneficiariesBoys ?? ""} onChange={(e) => updateActivity(i, { beneficiariesBoys: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                                  <div><Label className="text-xs text-muted-foreground">{t("formExtra.girls")}</Label><Input type="number" min={0} inputMode="numeric" aria-label={`Girls beneficiaries — ${rowLabel}`} aria-invalid={!!fieldErrors[`act-${i}-ben-girls`] || undefined} aria-describedby={fieldErrors[`act-${i}-ben-girls`] ? `err-act-${i}-ben-girls` : undefined} value={a.beneficiariesGirls ?? ""} onChange={(e) => updateActivity(i, { beneficiariesGirls: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                                  <div><Label className="text-xs text-muted-foreground">{t("formExtra.totalThisPeriod")}</Label><Input aria-label={`Total beneficiaries this period — ${rowLabel}`} value={(Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0)).toLocaleString()} readOnly className="h-8 bg-muted font-medium" /></div>
                                </div>
                                {(["men", "women", "boys", "girls"] as const).map((benKey) =>
                                  fieldErrors[`act-${i}-ben-${benKey}`] ? (
                                    <p key={benKey} id={`err-act-${i}-ben-${benKey}`} role="alert" className="text-xs text-destructive mt-1">
                                      {`${benKey.charAt(0).toUpperCase()}${benKey.slice(1)}: ${fieldErrors[`act-${i}-ben-${benKey}`]}`}
                                    </p>
                                  ) : null,
                                )}
                              </div>

                              {/* Status + Progress */}
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <Label className="text-xs">{t("formExtra.activityStatus")}</Label>
                                  <Select value={a.status} onValueChange={(val) => updateActivity(i, { status: val })}>
                                    <SelectTrigger className="h-8" aria-label={`Activity Status — ${rowLabel}`}><SelectValue /></SelectTrigger>
                                    <SelectContent>{ACTIVITY_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                                <div>
                                  <Label className="text-xs">% of Implementation</Label>
                                  <Input type="number" min={0} max={100} inputMode="numeric" aria-label={`% of Implementation — ${rowLabel}`} value={a.percent} onChange={(e) => updateActivity(i, { percent: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" />
                                </div>
                              </div>

                              {/* Optional narrative */}
                              <div className="grid grid-cols-1 gap-2">
                                <div>
                                  <Label className="text-xs text-muted-foreground">{t("formExtra.challenges")} <span className="font-normal">({t("form.optional")})</span></Label>
                                  <Textarea rows={1} aria-label={`Challenges — ${rowLabel}`} value={a.challenges ?? ""} onChange={(e) => updateActivity(i, { challenges: e.target.value })} placeholder={t("formExtra.challengesPlaceholder")} />
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <Label className="text-xs text-muted-foreground">{t("formExtra.mitigationMeasures")}</Label>
                                    <Textarea rows={1} aria-label={`Mitigation Measures — ${rowLabel}`} value={a.mitigationMeasures ?? ""} onChange={(e) => updateActivity(i, { mitigationMeasures: e.target.value })} placeholder={t("formExtra.mitigationPlaceholder")} />
                                  </div>
                                  <div>
                                    <Label className="text-xs text-muted-foreground">{t("formExtra.nextSteps")}</Label>
                                    <Textarea rows={1} aria-label={`Next Steps — ${rowLabel}`} value={a.nextSteps ?? ""} onChange={(e) => updateActivity(i, { nextSteps: e.target.value })} placeholder={t("formExtra.nextStepsPlaceholder")} />
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    ) : (
                      /* NON-PROJECT TYPES: simple activity grid */
                      <>
                        {activities.length === 0 && <p className="text-xs text-muted-foreground">{t("formExtra.noActivitiesHintPrefix")} <strong>{t("stateForm.addActivity")}</strong>{t("formExtra.noActivitiesHintSuffix")}</p>}
                        {activities.map((a, i) => (
                          <div key={i} className="rounded border p-3 space-y-2 bg-muted/20">
                            <div className="flex items-center justify-between">
                              <p className="text-xs font-medium">Activity #{i + 1}</p>
                              <Button type="button" size="sm" variant="ghost" aria-label={a.name ? `Remove "${a.name}"` : `Remove activity ${i + 1}`} onClick={() => setActivities((cur) => cur.filter((_, idx) => idx !== i))}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="col-span-2"><Label className="text-xs">{t("formExtra.activityName")}</Label><Input aria-label={`Activity Name — Activity ${i + 1}`} value={a.name} onChange={(e) => updateActivity(i, { name: e.target.value })} /></div>
                              {activityFields.includes("relatedProjectId") && (
                                <div>
                                  <Label className="text-xs">{t("formExtra.relatedProject")}</Label>
                                  <Select value={String(a.relatedProjectId || "")} onValueChange={(val) => updateActivity(i, { relatedProjectId: Number(val) })}>
                                    <SelectTrigger><SelectValue placeholder={t("formExtra.select")} /></SelectTrigger>
                                    <SelectContent>{projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              )}
                              {activityFields.includes("stateId") && (
                                <div>
                                  <Label className="text-xs">{t("formExtra.state")}</Label>
                                  <Select value={String(a.stateId || "")} onValueChange={(val) => updateActivity(i, { stateId: Number(val) })}>
                                    <SelectTrigger><SelectValue placeholder={t("formExtra.select")} /></SelectTrigger>
                                    <SelectContent>{states?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              )}
                              {activityFields.includes("sector") && (
                                <div>
                                  <Label className="text-xs">{t("formExtra.sector")}</Label>
                                  <Select value={a.sector || ""} onValueChange={(val) => updateActivity(i, { sector: val })}>
                                    <SelectTrigger><SelectValue placeholder={t("formExtra.select")} /></SelectTrigger>
                                    <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                  </Select>
                                </div>
                              )}
                              <div><Label className="text-xs">{t("formExtra.output")}</Label><Input aria-label={`Output — Activity ${i + 1}`} value={a.output} onChange={(e) => updateActivity(i, { output: e.target.value })} /></div>
                              <div><Label className="text-xs">{t("formExtra.milestone")}</Label><Input aria-label={`Milestone — Activity ${i + 1}`} value={a.milestone} onChange={(e) => updateActivity(i, { milestone: e.target.value })} /></div>
                              <div>
                                <Label className="text-xs">{t("formExtra.status")}</Label>
                                <Select value={a.status} onValueChange={(val) => updateActivity(i, { status: val })}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>{ACTIVITY_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                </Select>
                              </div>
                              <div>
                                <Label className="text-xs">% of Implementation</Label>
                                <Input type="number" min={0} max={100} inputMode="numeric" aria-label={`% of Implementation — Activity ${i + 1}`} value={a.percent} onChange={(e) => updateActivity(i, { percent: e.target.value === "" ? "" : Number(e.target.value) })} />
                              </div>
                              {activityFields.includes("budget") && (
                                <div>
                                  <Label className="text-xs">{t("formExtra.budget")}</Label>
                                  <Input type="number" min={0} step="0.01" value={a.budget ?? ""} onChange={(e) => updateActivity(i, { budget: e.target.value === "" ? "" : Number(e.target.value) })} />
                                </div>
                              )}
                              {activityFields.includes("beneficiaries") && (
                                <div>
                                  <Label className="text-xs">{t("formExtra.beneficiaries")}</Label>
                                  <Input type="number" min={0} value={a.beneficiaries ?? ""} onChange={(e) => updateActivity(i, { beneficiaries: e.target.value === "" ? "" : Number(e.target.value) })} />
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </>
                    )}
                  </section>

                  {/* ── Indicator Progress (Activities tab) ── */}
                  {isProject && indicatorProgressEntries.length > 0 && (
                    <section className={activeSection === "rp-section-activities" ? "space-y-3" : "hidden"}>
                      <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                        <Target className="h-4 w-4" /> Indicator Progress
                        <span className="text-xs font-normal text-muted-foreground">(this reporting period)</span>
                      </h4>
                      {indicatorProgressEntries.map((entry, idx) => {
                        const progressPct = entry.target > 0 ? Math.round(((entry.cumAchieved + Number(entry.currentAchievement || 0)) / entry.target) * 100) : 0;
                        return (
                          <div key={entry.indicatorId} className="rounded border p-3 space-y-2 bg-muted/10">
                            <p className="text-sm font-medium">{entry.name}{entry.unit ? ` (${entry.unit})` : ""}</p>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                              <div className="rounded border bg-background p-1.5">
                                <p className="text-muted-foreground">{t("formExtra.target")}</p>
                                <p className="font-medium">{entry.target.toLocaleString()}</p>
                              </div>
                              <div className="rounded border bg-background p-1.5">
                                <p className="text-muted-foreground">{t("formExtra.cumulativeToDate")}</p>
                                <p className="font-medium">{entry.cumAchieved.toLocaleString()}</p>
                              </div>
                              <div className="rounded border bg-background p-1.5">
                                <p className="text-muted-foreground">{t("formExtra.thisPeriod")}</p>
                                <input
                                  type="number"
                                  min={0}
                                  inputMode="numeric"
                                  aria-label={`This period achievement — ${entry.name}`}
                                  className="w-full text-center font-medium bg-transparent border-none focus:outline-none focus:ring-1 focus:ring-primary rounded"
                                  value={entry.currentAchievement}
                                  onChange={(e) => setIndicatorProgressEntries((cur) => cur.map((x, i) => i === idx ? { ...x, currentAchievement: e.target.value === "" ? "" : Number(e.target.value) } : x))}
                                  placeholder="0"
                                />
                              </div>
                              <div className={`rounded border p-1.5 ${progressPct >= 100 ? "bg-success/10 border-success/20" : progressPct >= 60 ? "bg-warning/10 border-warning/20" : "bg-destructive/10 border-destructive/20"}`}>
                                <p className="text-muted-foreground">{t("formExtra.progress")}</p>
                                <p className={`font-semibold ${progressPct >= 100 ? "text-success" : progressPct >= 60 ? "text-warning" : "text-destructive"}`}>{progressPct}%</p>
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Remarks (optional)</Label>
                              <Input
                                className="h-8 text-xs"
                                aria-label={`Remarks — ${entry.name}`}
                                value={entry.remarks}
                                onChange={(e) => setIndicatorProgressEntries((cur) => cur.map((x, i) => i === idx ? { ...x, remarks: e.target.value } : x))}
                                placeholder={t("formExtra.remarksPlaceholder")}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  )}

                  {/* ── Beneficiary Reach (Activities tab) ── */}
                  {isProject ? (
                    /* Project type: auto-calculated from activity rows */
                    <section className={activeSection === "rp-section-activities" ? "space-y-3" : "hidden"}>
                      <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                        <Users className="h-4 w-4" /> Beneficiaries Reported This Period
                        <span className="text-xs font-normal text-muted-foreground">(calculated from activities)</span>
                      </h4>
                      <p className="text-xs text-muted-foreground">
                        Figures may include participants reported under more than one activity.
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                        <div><Label htmlFor="pmr-benef-men" className="text-xs">{t("formExtra.men")}</Label><Input id="pmr-benef-men" value={activities.reduce((s, a) => s + Number(a.beneficiariesMen || 0), 0).toLocaleString()} readOnly className="bg-muted font-medium" /></div>
                        <div><Label htmlFor="pmr-benef-women" className="text-xs">{t("formExtra.women")}</Label><Input id="pmr-benef-women" value={activities.reduce((s, a) => s + Number(a.beneficiariesWomen || 0), 0).toLocaleString()} readOnly className="bg-muted font-medium" /></div>
                        <div><Label htmlFor="pmr-benef-boys" className="text-xs">{t("formExtra.boys")}</Label><Input id="pmr-benef-boys" value={activities.reduce((s, a) => s + Number(a.beneficiariesBoys || 0), 0).toLocaleString()} readOnly className="bg-muted font-medium" /></div>
                        <div><Label htmlFor="pmr-benef-girls" className="text-xs">{t("formExtra.girls")}</Label><Input id="pmr-benef-girls" value={activities.reduce((s, a) => s + Number(a.beneficiariesGirls || 0), 0).toLocaleString()} readOnly className="bg-muted font-medium" /></div>
                        <div><Label htmlFor="pmr-benef-total" className="text-xs">{t("formExtra.totalThisPeriod")}</Label><Input id="pmr-benef-total" value={projectBenTotal.toLocaleString()} readOnly className="bg-muted font-semibold text-primary" /></div>
                      </div>
                    </section>
                  ) : (
                    /* Non-project types: manual entry */
                    <section className={activeSection === "rp-section-activities" ? "space-y-3" : "hidden"}>
                      <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                        <Users className="h-4 w-4" /> Beneficiary Reach
                        <span className="text-xs font-normal text-muted-foreground">(manual entry — auto total)</span>
                      </h4>
                      <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                        <div><Label htmlFor="rp-benef-male">{t("formExtra.male")}</Label><Input id="rp-benef-male" type="number" min={0} inputMode="numeric" {...form.register("beneficiariesMale", { valueAsNumber: true })} /></div>
                        <div><Label htmlFor="rp-benef-female">{t("formExtra.female")}</Label><Input id="rp-benef-female" type="number" min={0} inputMode="numeric" {...form.register("beneficiariesFemale", { valueAsNumber: true })} /></div>
                        <div><Label htmlFor="rp-benef-boys">{t("formExtra.boys")}</Label><Input id="rp-benef-boys" type="number" min={0} inputMode="numeric" {...form.register("beneficiariesBoys", { valueAsNumber: true })} /></div>
                        <div><Label htmlFor="rp-benef-girls">{t("formExtra.girls")}</Label><Input id="rp-benef-girls" type="number" min={0} inputMode="numeric" {...form.register("beneficiariesGirls", { valueAsNumber: true })} /></div>
                        <div><Label htmlFor="rp-benef-total">{t("formExtra.total")}</Label><Input id="rp-benef-total" value={beneficiariesTotal.toLocaleString()} readOnly className="bg-muted font-medium" /></div>
                      </div>
                    </section>
                  )}

                  {/* ── Financial Summary (Activities tab) ── */}
                  {isProject && (
                    <section className={activeSection === "rp-section-activities" ? "space-y-3" : "hidden"}>
                      <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                        <DollarSign className="h-4 w-4" /> Financial Summary
                        <span className="text-xs font-normal text-muted-foreground">(auto-calculated from activities)</span>
                      </h4>
                      {/* Linked-activity totals */}
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <div>
                          <Label className="text-xs text-muted-foreground">Total Planned (Linked)</Label>
                          <div className="text-lg font-bold">
                            {projectTotalPlanned != null ? formatCurrency(projectTotalPlanned, projectCurrency ?? undefined) : "—"}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Actual Expenditure (This Period)</Label>
                          <div className="text-lg font-bold">{formatCurrency(projectTotalActual, projectCurrency ?? undefined)}</div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">{t("formExtra.variance")}</Label>
                          <div className="text-lg font-bold text-foreground">
                            {projectVariance != null
                              ? `${projectVariance > 0 ? "Underspend" : projectVariance < 0 ? "Overspend" : "On Budget"}: ${formatCurrency(Math.abs(projectVariance), projectCurrency ?? undefined)}`
                              : "—"}
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">{t("formExtra.budgetUtilisation")}</Label>
                          <div className="text-lg font-bold text-foreground">
                            {projectUtilizationPct != null ? `${projectUtilizationPct}%` : "—"}
                          </div>
                        </div>
                      </div>
                      {/* Unplanned expenditure (if any) */}
                      {unplannedTotalActual > 0 && (
                        <div className="mt-1 p-3 bg-muted/40 rounded-md">
                          <Label className="text-xs text-muted-foreground">Unplanned Activity Expenditure (This Period)</Label>
                          <div className="text-base font-bold">{formatCurrency(unplannedTotalActual, projectCurrency ?? undefined)}</div>
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── TAB 4: CHALLENGES / CHALLENGES & ACTIONS ── */}
                  <section
                    role="tabpanel"
                    id={isActivity ? "ar-section-challenges" : "rp-section-challenges"}
                    aria-labelledby={`tab-${isActivity ? "ar-section-challenges" : "rp-section-challenges"}`}
                    className={(isActivity ? activeSection === "ar-section-challenges" : activeSection === "rp-section-challenges") ? "space-y-4" : "hidden"}
                  >
                    {isActivity ? (
                      /* ── Activity Report Step 4: three-section layout ── */
                      <>
                        {/* Section A — Challenges Encountered (with applicability toggle) */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold border-b pb-1">{t("activityForm.step4.sectionChallengesEncountered")}</h4>
                          <div>
                            <Label className="text-sm font-medium">{t("activityForm.step4.hasChallengesLabel")}</Label>
                            <div className="flex gap-3 mt-2">
                              {(["yes", "no"] as const).map((opt) => (
                                <button
                                  key={opt}
                                  type="button"
                                  onClick={() => {
                                    setSectionValues((cur) => ({ ...cur, hasChallenges: opt }));
                                    setIsFormDirty(true);
                                  }}
                                  className={cn(
                                    "flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-colors",
                                    hasChallengesValue === opt
                                      ? "border-primary bg-primary/10 text-primary"
                                      : "border-border bg-card text-foreground hover:bg-muted",
                                  )}
                                  aria-pressed={hasChallengesValue === opt}
                                >
                                  {opt === "yes" ? t("activityForm.step4.hasChallengesYes") : t("activityForm.step4.hasChallengesNo")}
                                </button>
                              ))}
                            </div>
                          </div>

                          {/* Challenges textarea — visible when Yes */}
                          {hasChallengesValue === "yes" && (
                            <div>
                              <Label htmlFor="ar-challenges-text">{t("activityForm.step4.challengesTextLabel")}</Label>
                              <div className="max-w-2xl">
                                <Textarea
                                  id="ar-challenges-text"
                                  rows={4}
                                  className="resize-y"
                                  value={sectionValues["challenges"] ?? ""}
                                  onChange={(e) => { setSectionValues((cur) => ({ ...cur, challenges: e.target.value })); setIsFormDirty(true); }}
                                  placeholder={t("activityForm.step4.challengesTextPlaceholder")}
                                  aria-required="true"
                                  aria-invalid={!!fieldErrors["challenges"]}
                                  aria-describedby={fieldErrors["challenges"] ? "err-pmr-challenges" : undefined}
                                />
                              </div>
                              {fieldErrors["challenges"] && (
                                <p id="err-pmr-challenges" className="text-xs text-destructive mt-1" role="alert">{fieldErrors["challenges"]}</p>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Section B — Actions Taken / Mitigation (visible when Yes) */}
                        {hasChallengesValue === "yes" && (
                          <>
                            <Separator />
                            <div className="space-y-2">
                              <h4 className="text-sm font-semibold border-b pb-1">{t("activityForm.step4.sectionActionsTaken")}</h4>
                              <p className="text-xs text-muted-foreground">
                                {t("activityForm.step4.actionsTakenHelper")}
                              </p>
                              <div>
                                <Label htmlFor="ar-mitigation-text">{t("activityForm.step4.actionsTakenLabel")}</Label>
                                <div className="max-w-2xl">
                                  <Textarea
                                    id="ar-mitigation-text"
                                    rows={4}
                                    className="resize-y"
                                    value={sectionValues["mitigationMeasures"] ?? ""}
                                    onChange={(e) => { setSectionValues((cur) => ({ ...cur, mitigationMeasures: e.target.value })); setIsFormDirty(true); }}
                                    placeholder={t("activityForm.step4.actionsTakenPlaceholder")}
                                  />
                                </div>
                              </div>
                            </div>
                          </>
                        )}

                        {/* Section C — Follow-Up Actions / Next Steps (always visible, always optional) */}
                        <Separator />
                        <div className="space-y-2">
                          <h4 className="text-sm font-semibold border-b pb-1">{t("activityForm.step4.sectionFollowUp")}</h4>
                          <p className="text-xs text-muted-foreground">
                            {t("activityForm.step4.followUpHelper")}
                          </p>
                          <div>
                            <Label htmlFor="ar-nextsteps-text">{t("activityForm.step4.followUpLabel")}</Label>
                            <div className="max-w-2xl">
                              <Textarea
                                id="ar-nextsteps-text"
                                rows={4}
                                className="resize-y"
                                value={sectionValues["nextSteps"] ?? ""}
                                onChange={(e) => { setSectionValues((cur) => ({ ...cur, nextSteps: e.target.value })); setIsFormDirty(true); }}
                                placeholder={t("activityForm.step4.followUpPlaceholder")}
                              />
                            </div>
                          </div>
                        </div>
                      </>
                    ) : (
                      /* ── Non-activity report: original simple textarea loop ── */
                      <>
                        <h4 className="text-sm font-semibold border-b pb-1">
                          {isHqSector ? "Challenges & Recommendations" : "Challenges & Next Steps"}
                        </h4>
                        {sectionsCfg.challenges.map((f) => (
                          <div key={f.key}>
                            <Label htmlFor={`field-${f.key}`}>{configuredFieldLabel(f)}</Label>
                            <div className="max-w-2xl">
                              <Textarea
                                id={`field-${f.key}`}
                                rows={f.rows ?? 3}
                                className="resize-y"
                                value={sectionValues[f.key] ?? ""}
                                onChange={(e) => { setSectionValues((cur) => ({ ...cur, [f.key]: e.target.value })); setIsFormDirty(true); }}
                                placeholder={t("form.writeNarrative")}
                                aria-invalid={!!fieldErrors[f.key] || undefined}
                                aria-describedby={fieldErrors[f.key] ? `err-${f.key}` : undefined}
                              />
                            </div>
                            {fieldErrors[f.key] && (
                              <p id={`err-${f.key}`} role="alert" className="text-sm text-destructive mt-1">{fieldErrors[f.key]}</p>
                            )}
                          </div>
                        ))}
                      </>
                    )}
                  </section>

                  {/* ── Project Risks (Challenges tab) ── */}
                  {isProject && selectedProjectId && (
                    <section className={activeSection === "rp-section-challenges" ? "space-y-3" : "hidden"}>
                      <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                        <AlertTriangle className="h-4 w-4 text-warning" />
                        Project Risks
                        <span className="text-xs font-normal text-muted-foreground">(from Risk Register — status updates sync back)</span>
                      </h4>
                      {!projectLinkedRisksRaw ? (
                        <p className="text-xs text-muted-foreground">Loading risks…</p>
                      ) : projectLinkedRisksRaw.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-2">No risks are linked to this project yet. Add them from the Risk Register.</p>
                      ) : (
                        <div className="space-y-2">
                          {(projectLinkedRisksRaw as ProjectRisk[]).map((risk) => {
                            const rl = risk.riskLevel ?? "";
                            const currentStatus = riskStatusEdits[risk.id] ?? risk.status ?? "open";
                            const riskStatusVariant =
                              currentStatus === "closed" ? "closed" as const :
                              currentStatus === "under_mitigation" ? "submitted" as const :
                              "returned" as const;
                            return (
                              <div key={risk.id} className="flex items-start gap-3 rounded border bg-muted/20 px-3 py-2 text-sm">
                                <div className="flex-1 min-w-0">
                                  <p className="font-medium truncate">{risk.title}</p>
                                  <div className="flex gap-1.5 mt-1 flex-wrap">
                                    <Badge variant="outline" className="text-xs capitalize">{risk.category}</Badge>
                                    {rl && <Badge variant={severityBadgeVariant(rl)} className="text-xs">{rl}</Badge>}
                                    <Badge variant={riskStatusVariant} className="text-xs">
                                      {currentStatus === "under_mitigation" ? t("formExtra.riskStatusUnderMitigation") : currentStatus === "closed" ? t("formExtra.riskStatusClosed") : t("formExtra.riskStatusOpen")}
                                    </Badge>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <Select
                                    value={currentStatus}
                                    onValueChange={(val) => setRiskStatusEdits((prev) => ({ ...prev, [risk.id]: val }))}
                                  >
                                    <SelectTrigger className="h-7 w-40 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="open">{t("formExtra.riskStatusOpen")}</SelectItem>
                                      <SelectItem value="under_mitigation">{t("formExtra.riskStatusUnderMitigation")}</SelectItem>
                                      <SelectItem value="closed">{t("formExtra.riskStatusClosed")}</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {riskStatusEdits[risk.id] && riskStatusEdits[risk.id] !== (risk.status ?? "open") && (
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      className="h-7 text-xs px-2"
                                      disabled={savingRiskId === risk.id}
                                      onClick={async () => {
                                        setSavingRiskId(risk.id);
                                        try {
                                          await fetch(`/api/risks/${risk.id}`, {
                                            method: "PATCH",
                                            headers: { "Content-Type": "application/json" },
                                            credentials: "include",
                                            body: JSON.stringify({ status: riskStatusEdits[risk.id] }),
                                          });
                                          qc.invalidateQueries({ queryKey: ["risks", "for-report"] });
                                          setRiskStatusEdits((prev) => { const n = { ...prev }; delete n[risk.id]; return n; });
                                          toast.success(t("formExtra.riskStatusUpdated"));
                                        } finally {
                                          setSavingRiskId(null);
                                        }
                                      }}
                                    >
                                      {savingRiskId === risk.id ? "Saving…" : "Save"}
                                    </Button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  )}

                  {/* ── TAB 5: LESSONS LEARNED (project and activity types) ── */}
                  {(isProject || isActivity) && sectionsCfg.narrative && sectionsCfg.narrative.length > 0 && (
                    <section
                      role="tabpanel"
                      id={isActivity ? "ar-section-lessons" : "rp-section-lessons"}
                      aria-labelledby={`tab-${isActivity ? "ar-section-lessons" : "rp-section-lessons"}`}
                      className={(isActivity ? activeSection === "ar-section-lessons" : activeSection === "rp-section-lessons") ? "space-y-6" : "hidden"}
                    >
                      {isActivity ? (
                        /* ── ACTIVITY REPORT STEP 5: Lessons & Recommendations ── */
                        <>
                          {/* ── Section A: Learning & Recommendations ── */}
                          <div className="space-y-4">
                            <h4 className="text-sm font-semibold border-b pb-1">{t("formExtra.learningRecommendations")}</h4>

                            {/* Lessons Learned (required) */}
                            <div className="space-y-1">
                              <Label htmlFor="ar-lessonsLearned">{t("formExtra.lessonsLearned")} <span className="text-destructive">*</span></Label>
                              <p className="text-xs text-muted-foreground">
                                Summarise the key lessons from implementing this activity, including what
                                worked well and what could be improved.
                              </p>
                              <div className="max-w-2xl">
                              <Textarea
                                id="ar-lessonsLearned"
                                rows={4}
                                className="resize-y"
                                value={sectionValues["lessonsLearned"] ?? ""}
                                onChange={(e) => {
                                  setSectionValues((cur) => ({ ...cur, lessonsLearned: e.target.value }));
                                  setIsFormDirty(true);
                                  if (fieldErrors["lessonsLearned"]) setFieldErrors((cur) => ({ ...cur, lessonsLearned: undefined }));
                                }}
                                placeholder={t("formExtra.lessonsLearnedPlaceholder")}
                                aria-invalid={!!fieldErrors["lessonsLearned"] || undefined}
                                aria-describedby={fieldErrors["lessonsLearned"] ? "err-pmr-lessons" : undefined}
                              />
                              </div>
                              {fieldErrors["lessonsLearned"] && (
                                <p id="err-pmr-lessons" className="text-xs text-destructive" role="alert">{fieldErrors["lessonsLearned"]}</p>
                              )}
                            </div>

                            {/* Recommendations (optional, top-level DB column) */}
                            <div className="space-y-1">
                              <Label htmlFor="ar-recommendations">{t("formExtra.recommendations")}</Label>
                              <p className="text-xs text-muted-foreground">
                                Provide practical recommendations for improving future activities,
                                implementation approaches or programme decisions.
                              </p>
                              <div className="max-w-2xl">
                              <Textarea
                                id="ar-recommendations"
                                rows={4}
                                className="resize-y"
                                value={arRecommendations}
                                onChange={(e) => { setArRecommendations(e.target.value); setIsFormDirty(true); }}
                                placeholder={t("formExtra.recommendationsPlaceholder")}
                              />
                              </div>
                            </div>
                          </div>

                          {/* ── Section B: Supporting Insights — Optional ── */}
                          <div className="space-y-4">
                            <h4 className="text-sm font-semibold border-b pb-1">{t("formExtra.supportingInsightsOptional")}</h4>

                            {/* Success Story */}
                            {showSuccessStory ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label htmlFor="ar-successStory">Success Story / Case Example</Label>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="text-xs text-muted-foreground h-auto py-0"
                                    onClick={() => {
                                      if ((sectionValues["successStory"] ?? "").trim()) {
                                        // Content exists — ask for confirmation before discarding
                                        setRemoveInsightConfirm("successStory");
                                      } else {
                                        // Empty section — hide without confirmation
                                        setShowSuccessStory(false);
                                      }
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Describe a concise example that demonstrates a meaningful positive result
                                  or change linked to this activity.
                                </p>
                                <div className="max-w-2xl">
                                <Textarea
                                  id="ar-successStory"
                                  rows={4}
                                  className="resize-y"
                                  value={sectionValues["successStory"] ?? ""}
                                  onChange={(e) => {
                                    setSectionValues((cur) => ({ ...cur, successStory: e.target.value }));
                                    setIsFormDirty(true);
                                  }}
                                  placeholder={t("formExtra.successStoryPlaceholder")}
                                />
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-muted-foreground text-sm h-auto py-1"
                                onClick={() => setShowSuccessStory(true)}
                              >
                                <PlusCircle className="h-3.5 w-3.5" /> Add Success Story / Case Example
                              </Button>
                            )}

                            {/* Coordination Updates */}
                            {showCoordinationUpdates ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label htmlFor="ar-coordinationUpdates">{t("formExtra.coordinationUpdates")}</Label>
                                  <Button
                                    type="button" variant="ghost" size="sm"
                                    className="text-xs text-muted-foreground h-auto py-0"
                                    onClick={() => {
                                      if ((sectionValues["coordinationUpdates"] ?? "").trim()) {
                                        setRemoveInsightConfirm("coordinationUpdates");
                                      } else {
                                        setShowCoordinationUpdates(false);
                                      }
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Record any significant coordination developments relevant to this activity.
                                </p>
                                <div className="max-w-2xl">
                                <Textarea
                                  id="ar-coordinationUpdates"
                                  rows={4}
                                  className="resize-y"
                                  value={sectionValues["coordinationUpdates"] ?? ""}
                                  onChange={(e) => {
                                    setSectionValues((cur) => ({ ...cur, coordinationUpdates: e.target.value }));
                                    setIsFormDirty(true);
                                  }}
                                  placeholder={t("formExtra.coordinationUpdatesPlaceholder")}
                                />
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="text-muted-foreground text-sm h-auto py-1"
                                onClick={() => setShowCoordinationUpdates(true)}
                              >
                                <PlusCircle className="h-3.5 w-3.5" /> Add Coordination Update
                              </Button>
                            )}

                            {/* Community Feedback */}
                            {showCommunityFeedback ? (
                              <div className="space-y-1">
                                <div className="flex items-center justify-between">
                                  <Label htmlFor="ar-communityFeedback">{t("formExtra.communityFeedback")}</Label>
                                  <Button
                                    type="button" variant="ghost" size="sm"
                                    className="text-xs text-muted-foreground h-auto py-0"
                                    onClick={() => {
                                      if ((sectionValues["communityFeedback"] ?? "").trim()) {
                                        setRemoveInsightConfirm("communityFeedback");
                                      } else {
                                        setShowCommunityFeedback(false);
                                      }
                                    }}
                                  >
                                    Remove
                                  </Button>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                  Summarise relevant feedback received from participants, communities or
                                  other affected people.
                                </p>
                                <div className="max-w-2xl">
                                <Textarea
                                  id="ar-communityFeedback"
                                  rows={4}
                                  className="resize-y"
                                  value={sectionValues["communityFeedback"] ?? ""}
                                  onChange={(e) => {
                                    setSectionValues((cur) => ({ ...cur, communityFeedback: e.target.value }));
                                    setIsFormDirty(true);
                                  }}
                                  placeholder={t("formExtra.communityFeedbackPlaceholder")}
                                />
                                </div>
                              </div>
                            ) : (
                              <Button
                                type="button" variant="ghost" size="sm"
                                className="text-muted-foreground text-sm h-auto py-1"
                                onClick={() => setShowCommunityFeedback(true)}
                              >
                                <PlusCircle className="h-3.5 w-3.5" /> Add Community Feedback
                              </Button>
                            )}
                          </div>
                        </>
                      ) : (
                        /* ── PROJECT / STATE / HQ REPORT: existing generic loop (unchanged) ── */
                        <>
                          <h4 className="text-sm font-semibold border-b pb-1">Lessons Learned & Narrative</h4>
                          {sectionsCfg.narrative.map((f) => (
                            <div key={f.key}>
                              <Label htmlFor={`field-${f.key}`}>{configuredFieldLabel(f)}</Label>
                              <div className="max-w-2xl">
                                <Textarea
                                  id={`field-${f.key}`}
                                  rows={f.rows ?? 3}
                                  className="resize-y"
                                  value={sectionValues[f.key] ?? ""}
                                  onChange={(e) => { setSectionValues((cur) => ({ ...cur, [f.key]: e.target.value })); setIsFormDirty(true); }}
                                  placeholder={t("form.writeNarrative")}
                                  aria-invalid={!!fieldErrors[f.key] || undefined}
                                  aria-describedby={fieldErrors[f.key] ? `err-${f.key}` : undefined}
                                />
                              </div>
                              {fieldErrors[f.key] && (
                                <p id={`err-${f.key}`} className="text-xs text-destructive" role="alert">{fieldErrors[f.key]}</p>
                              )}
                            </div>
                          ))}
                        </>
                      )}
                    </section>
                  )}

                  {/* ── TAB 6: ATTACHMENTS & VOICE ── */}
                  <section
                    role="tabpanel"
                    id={isActivity ? "ar-section-attachments" : "rp-section-attachments"}
                    aria-labelledby={`tab-${isActivity ? "ar-section-attachments" : "rp-section-attachments"}`}
                    className={(isActivity ? activeSection === "ar-section-attachments" : activeSection === "rp-section-attachments") ? "space-y-6" : "hidden"}
                  >
                    {isActivity ? (
                      /* ── Activity Report Step 6: three structured sections ── */
                      <>
                        {/* ── Section 1: Supporting Attachments ── */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold border-b pb-1">{t("formExtra.supportingAttachments")}</h4>
                          <p className="text-sm text-muted-foreground">Upload relevant documents, photos or other supporting evidence.</p>
                          {docsError && <p className="text-xs text-destructive">{docsError}</p>}

                          {/* Already-uploaded attachments (restored from saved draft) */}
                          {savedAttachments.length > 0 && (
                            <div className="space-y-1">
                              <p className="text-xs font-medium text-muted-foreground">{t("formExtra.saved")}</p>
                              {savedAttachments.map((att) => {
                                const sizeMb = att.size != null && att.size >= 1024 * 1024;
                                const sizeStr = att.size != null
                                  ? (sizeMb ? `${(att.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(att.size / 1024)} KB`)
                                  : "";
                                const ext = att.fileName.includes(".") ? att.fileName.split(".").pop()?.toUpperCase() ?? "" : "";
                                return (
                                  <div key={att.id} className="flex items-center gap-2 rounded border p-2 bg-muted/10">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-xs font-medium truncate" title={att.fileName}>{att.fileName}</p>
                                      <p className="text-xs text-muted-foreground">{[ext, sizeStr].filter(Boolean).join(" · ")}</p>
                                    </div>
                                    <a
                                      href={attachmentDownloadUrl(att.reportId, att.id)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Download ${att.fileName}`}
                                      aria-label={`Download ${att.fileName}`}
                                      className="inline-flex items-center justify-center h-7 w-7 rounded-md hover:bg-accent shrink-0"
                                    >
                                      <Download className="h-3 w-3 text-muted-foreground" />
                                    </a>
                                  <Button
                                      type="button" size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0"
                                      title={`Remove ${att.fileName}`}
                                      aria-label={`Remove ${att.fileName}`}
                                      onClick={async () => {
                                        if (!editingReport) return;
                                        try {
                                          const delRes = await fetch(`/api/reports/${editingReport.id}/attachments/${att.id}`, { method: "DELETE", credentials: "include" });
                                          if (!delRes.ok) {
                                            const e = await delRes.json().catch(() => ({})) as { message?: string };
                                            toast.error(e.message ?? "Failed to remove attachment.");
                                            return;
                                          }
                                          setSavedAttachments((cur) => cur.filter((a) => a.id !== att.id));
                                        } catch { toast.error(t("form.attachmentRemoveFailed")); }
                                      }}
                                    >
                                      <Trash2 className="h-3 w-3 text-destructive" />
                                    </Button>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* Pending files (selected but not yet uploaded) */}
                          {supportingDocs.map((doc, idx) => {
                            const sizeMb = doc.file.size >= 1024 * 1024;
                            const sizeStr = sizeMb ? `${(doc.file.size / (1024 * 1024)).toFixed(1)} MB` : `${Math.ceil(doc.file.size / 1024)} KB`;
                            const ext = doc.file.name.includes(".") ? doc.file.name.split(".").pop()?.toUpperCase() ?? "FILE" : "FILE";
                            return (
                              <div key={idx} className="flex items-center gap-2 rounded border p-2 bg-muted/10">
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-medium truncate" title={doc.file.name}>{doc.file.name}</p>
                                  <p className="text-xs text-muted-foreground">{ext} · {sizeStr}</p>
                                </div>
                                <Button
                                  type="button" size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0"
                                  onClick={() => setSupportingDocs((cur) => cur.filter((_, i) => i !== idx))}
                                  aria-label={`Remove ${doc.file.name}`}
                                  title={`Remove ${doc.file.name}`}
                                >
                                  <Trash2 className="h-3 w-3 text-destructive" />
                                </Button>
                              </div>
                            );
                          })}

                          <label className="flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline w-fit">
                            <Plus className="h-4 w-4" />
                            + Add Files
                            <input
                              id="pmr-file-input"
                              type="file"
                              className="hidden"
                              aria-describedby="pmr-file-formats"
                              accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
                              multiple
                              onChange={(e) => {
                                const files = Array.from(e.target.files ?? []);
                                setSupportingDocs((cur) => [...cur, ...files.map((f) => ({ file: f, docType: "Other" }))]);
                                e.target.value = "";
                                setIsFormDirty(true);
                              }}
                            />
                          </label>
                          <p id="pmr-file-formats" className="text-xs text-muted-foreground">Accepted formats: PDF, Word, Excel, images (JPG, PNG). Maximum 20 MB per file.</p>
                          {supportingDocs.length > 0 ? (
                            <p className="text-xs text-muted-foreground">Files will be uploaded when you save or submit the report. Max 20 MB per file.</p>
                          ) : (
                            savedAttachments.length === 0 && (
                              <p className="text-xs text-muted-foreground">Max 20 MB per file. Attachments are optional.</p>
                            )
                          )}
                        </div>

                        {/* ── Section 2: Voice Notes ── */}
                        <div className="space-y-3">
                          <h4 className="text-sm font-semibold border-b pb-1">{t("formExtra.voiceNotes")}</h4>
                          <p className="text-sm text-muted-foreground">Add an optional voice note to provide additional context.</p>

                          {voiceNoteRetry && (
                            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                              <p className="text-sm font-medium text-destructive">{t("formExtra.voiceNoteUploadFailed")}</p>
                              <p className="text-xs text-muted-foreground">Your report has been saved. The recording is preserved — click Retry Upload to re-send it.</p>
                              <Button
                                type="button"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    await uploadVoiceNote(voiceNoteRetry.note, voiceNoteRetry.reportId);
                                    setVoiceNoteRetry(null);
                                    setPendingVoiceNote(null);
                                    toast.success(t("form.voiceUploaded"));
                                  } catch {
                                    toast.error(t("form.retryFailed"));
                                  }
                                }}
                              >
                                Retry Upload
                              </Button>
                            </div>
                          )}

                          {editingReport && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">Previously saved recording:</p>
                              <VoiceNotePanel entityType="report" entityId={editingReport.id} />
                            </div>
                          )}

                          {!voiceNoteRetry && (
                            <FormVoiceRecorder
                              value={pendingVoiceNote}
                              onChange={(val) => { setPendingVoiceNote(val); if (val) setIsFormDirty(true); }}
                            />
                          )}
                        </div>

                        {/* ── Section 3: Submission Readiness ── */}
                        {(() => {
                          // FIX-08: Replaced hardcoded per-step inline checks with the unified
                          // lib validator so Steps 4 & 5 show real issues, legacy exemptions
                          // apply, and readiness agrees with validateSubmit.
                          const readinessResult = validateActivityForSubmission(
                            buildActivityFormValues(v),
                            sectionValues,
                            validationCtx,
                          );
                          type StepStatus = { label: string; sectionId: string; issues: string[] };
                          const steps: StepStatus[] = [
                            { label: t("form.tabBasic"),                   sectionId: "ar-section-basic",       issues: (readinessResult.errorsByStep[1] ?? []).map((e) => e.message) },
                            { label: t("form.tabImplementationProgress"),  sectionId: "ar-section-progress",    issues: (readinessResult.errorsByStep[2] ?? []).map((e) => e.message) },
                            { label: t("form.tabResultsBeneficiaries"),    sectionId: "ar-section-results",     issues: (readinessResult.errorsByStep[3] ?? []).map((e) => e.message) },
                            { label: t("form.tabChallengesActions"),       sectionId: "ar-section-challenges",  issues: (readinessResult.errorsByStep[4] ?? []).map((e) => e.message) },
                            { label: t("form.tabLessonsRecommendations"),  sectionId: "ar-section-lessons",     issues: (readinessResult.errorsByStep[5] ?? []).map((e) => e.message) },
                          ];
                          const allValid = readinessResult.valid;
                          const firstWithIssues = steps.find((s) => s.issues.length > 0);
                          return (
                            <div className="space-y-3">
                              <h4 className="text-sm font-semibold border-b pb-1">{t("form.submissionReadiness")}</h4>
                              <div className="space-y-1.5">
                                {steps.map((step) => (
                                  <div key={step.sectionId} className="flex items-center gap-2 text-sm">
                                    {step.issues.length === 0
                                      ? <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                                      : <AlertCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                                    <span className={step.issues.length === 0 ? "text-muted-foreground" : "text-foreground"}>
                                      {step.label}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              {allValid ? (
                                <p className="text-sm font-medium text-green-600 dark:text-green-400">{t("formExtra.readyToSubmit")}</p>
                              ) : (
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-destructive">{t("formExtra.actionRequired")}</p>
                                  {(firstWithIssues?.issues ?? []).map((msg) => (
                                    <p key={msg} className="text-xs text-muted-foreground">• {msg}</p>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                      </>
                    ) : (
                      /* ── Project / State / HQ reports: existing layout unchanged ── */
                      <>
                        <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
                          <Paperclip className="h-4 w-4" aria-hidden="true" /> Evidence &amp; Supporting Documents
                        </h4>

                        {/* File attachment sub-section */}
                        <section aria-labelledby="rp-docs-heading" className="space-y-2">
                          <p id="rp-docs-heading" className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                            Attachments {isProject && !docsNoSupport && <span className="text-destructive">*</span>}
                          </p>
                          {docsError && <p className="text-xs text-destructive">{docsError}</p>}
                          {supportingDocs.map((doc, idx) => (
                            <div key={idx} className="flex items-center gap-2 rounded border p-2 bg-muted/10">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium truncate" title={doc.file.name}>{doc.file.name}</p>
                                <p className="text-xs text-muted-foreground">{(doc.file.size / 1024).toFixed(1)} KB</p>
                              </div>
                              <Select value={doc.docType} onValueChange={(val) => setSupportingDocs((cur) => cur.map((d, i) => i === idx ? { ...d, docType: val } : d))}>
                                <SelectTrigger className="w-44 h-7 text-xs" aria-label={`Document type for ${doc.file.name}`}><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {["Progress Photos", "Field Visit Report", "Beneficiary Data", "Financial Record", "Meeting Minutes", "Monitoring Form", "Other"].map((t) => (
                                    <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <Button type="button" size="icon" variant="ghost" className="h-7 w-7 flex-shrink-0" aria-label={`Remove ${doc.file.name}`} title={`Remove ${doc.file.name}`} onClick={() => setSupportingDocs((cur) => cur.filter((_, i) => i !== idx))}>
                                <Trash2 className="h-3 w-3 text-destructive" />
                              </Button>
                            </div>
                          ))}
                          <div className={cn(docsNoSupport ? "opacity-50 pointer-events-none" : "")}>
                            <label className="flex items-center gap-2 cursor-pointer text-sm text-primary hover:underline w-fit">
                              <Paperclip className="h-4 w-4" aria-hidden="true" />
                              Attach document
                              <span id="rp-file-formats" className="sr-only">Accepted formats: PDF, Word, Excel, CSV, images (JPG, PNG).</span>
                              <input
                                id="rp-file-input"
                                type="file"
                                className="hidden"
                                aria-describedby="rp-file-formats"
                                accept=".pdf,.doc,.docx,.xlsx,.xls,.csv,.jpg,.jpeg,.png"
                                multiple
                                onChange={(e) => {
                                  const files = Array.from(e.target.files ?? []);
                                  setSupportingDocs((cur) => [...cur, ...files.map((f) => ({ file: f, docType: "Other" }))]);
                                  if (files.length > 0) { setDocsError(""); setDocsNoSupport(false); }
                                  e.target.value = "";
                                  setIsFormDirty(true);
                                }}
                              />
                            </label>
                          </div>
                          {supportingDocs.length > 0 && (
                            <p className="text-xs text-muted-foreground">Documents will be uploaded when you save or submit the report.</p>
                          )}
                          {/* No-documents bypass — must provide a documented reason */}
                          {isProject && supportingDocs.length === 0 && (
                            <div className="mt-2 space-y-2 rounded-md border border-dashed p-3">
                              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                                <input
                                  type="checkbox"
                                  checked={docsNoSupport}
                                  onChange={(e) => { setDocsNoSupport(e.target.checked); if (!e.target.checked) setDocsNoSupportReason(""); setIsFormDirty(true); }}
                                  className="h-4 w-4 rounded border-border"
                                />
                                <span>{t("formExtra.noSupportingDocuments")}</span>
                              </label>
                              {docsNoSupport && (
                                <div className="mt-2 ms-6">
                                  <Label htmlFor="rp-docs-no-support-reason" className="text-xs">{t("formExtra.reason")} <span className="text-destructive">*</span></Label>
                                  <Textarea
                                    id="rp-docs-no-support-reason"
                                    rows={2}
                                    aria-required="true"
                                    value={docsNoSupportReason}
                                    onChange={(e) => { setDocsNoSupportReason(e.target.value); setIsFormDirty(true); }}
                                    placeholder={t("formExtra.noSupportReasonPlaceholder")}
                                  />
                                </div>
                              )}
                            </div>
                          )}
                        </section>

                        {/* Voice Note (inside Attachments & Voice tab) */}
                        <div className="pt-2 space-y-2">
                          <h5 className="text-sm font-medium border-b pb-1 text-muted-foreground">Voice Note (Optional)</h5>
                          {voiceNoteRetry && (
                            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                              <p className="text-sm font-medium text-destructive">{t("formExtra.voiceNoteUploadFailed")}</p>
                              <p className="text-xs text-muted-foreground">Your report has been saved. The recording is preserved — click Retry Upload to re-send it.</p>
                              <Button
                                type="button"
                                size="sm"
                                onClick={async () => {
                                  try {
                                    await uploadVoiceNote(voiceNoteRetry.note, voiceNoteRetry.reportId);
                                    setVoiceNoteRetry(null);
                                    setPendingVoiceNote(null);
                                    toast.success(t("form.voiceUploaded"));
                                  } catch {
                                    toast.error(t("form.retryFailed"));
                                  }
                                }}
                              >
                                Retry Upload
                              </Button>
                            </div>
                          )}
                          {editingReport && (
                            <div>
                              <p className="text-xs text-muted-foreground mb-2">Previously saved recording:</p>
                              <VoiceNotePanel entityType="report" entityId={editingReport.id} />
                            </div>
                          )}
                          {!voiceNoteRetry && (
                            <FormVoiceRecorder
                              value={pendingVoiceNote}
                              onChange={(val) => { setPendingVoiceNote(val); if (val) setIsFormDirty(true); }}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </section>

                </form>
                )}
                </div>{/* end scrollable tab panel body */}

                {/* ── Sticky footer — only for PMR/Activity; SPR and HQSR own their footer ── */}
                {!isProgramState && !isHqSector && (isActivity ? (() => {
                  // Wizard-style footer for Activity Reports
                  // Step 1: Cancel | Save as Draft | Next →
                  // Middle steps: ← Back | Save as Draft | Next →
                  // Final step: ← Back | Save as Draft | Submit Report
                  const stepIndex = activeNavItems.findIndex((n) => n.id === activeSection);
                  const isFirstStep = stepIndex <= 0;
                  const isLastStep = stepIndex >= activeNavItems.length - 1;
                  const prevStep = () => { if (stepIndex > 0) setActiveSection(activeNavItems[stepIndex - 1].id); };
                  const nextStep = () => {
                    if (isFirstStep && !validateBasicInfo()) return;
                    if (activeSection === "ar-section-challenges" && !validateChallengesStep()) return;
                    if (activeSection === "ar-section-lessons" && !validateLessonsStep()) return;
                    // Step 2 (Implementation Progress) — FIX-08: delegate to unified lib validator
                    if (activeSection === "ar-section-progress") {
                      const step2Errors = validateActivityImplementation(sectionValues, validationCtx);
                      if (step2Errors.length > 0) {
                        const step2Errs: Partial<Record<string, string>> = {};
                        for (const e of step2Errors) step2Errs[e.field] = e.message;
                        setFieldErrors((cur) => ({ ...cur, ...step2Errs }));
                        setTimeout(() => {
                          const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
                          if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
                        }, 50);
                        toast.error(step2Errors[0].message);
                        return;
                      }
                    }
                    // Step 3 (Results & Beneficiaries) — FIX-08: delegate to unified lib validator
                    if (activeSection === "ar-section-results") {
                      const step3Errors = validateActivityResults(sectionValues, v, validationCtx);
                      if (step3Errors.length > 0) {
                        const step3Errs: Partial<Record<string, string>> = {};
                        for (const e of step3Errors) step3Errs[e.field] = e.message;
                        setFieldErrors((cur) => ({ ...cur, ...step3Errs }));
                        setTabErrors((prev) => ({ ...prev, "ar-section-results": step3Errors.length }));
                        setTimeout(() => {
                          const el = document.querySelector<HTMLElement>('[aria-invalid="true"]');
                          if (el) { el.focus(); el.scrollIntoView({ block: "center", behavior: "smooth" }); }
                        }, 50);
                        toast.error(step3Errors[0].message);
                        return;
                      }
                    }
                    if (stepIndex < activeNavItems.length - 1) setActiveSection(activeNavItems[stepIndex + 1].id);
                  };
                  return (
                    <div className="border-t shrink-0 px-6 py-4 flex items-center justify-between gap-2 bg-background">
                      {/* Left side: Cancel (step 1) or Back (other steps) */}
                      {/* Sticky footer — only for PMR/Activity; SPR and HQSR own their footer */}
                      <div>
                        {isFirstStep ? (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
                            aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
                            onClick={() => {
                              if (isFormDirty) { setShowDiscardConfirm(true); return; }
                              setCreateOpen(false);
                              resetForm();
                            }}
                          >
                            {t("stateForm.cancel")}
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            variant="outline"
                            disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
                            aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
                            onClick={prevStep}
                          >
                    <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden="true" /> {t("stateForm.back")}
                          </Button>
                        )}
                      </div>
                      {/* Right side: Save as Draft + Next / Submit */}
                      <div className="flex gap-2">
                        <Button type="button" variant="secondary" onClick={onSaveDraft} disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} className="whitespace-nowrap">
                          {t("stateForm.saveDraft")}
                        </Button>
                        {isLastStep ? (
                          <Button type="button" onClick={onSubmitReport} disabled={!isOnline || isSubmittingReport || createMutation.isPending || transitionMutation.isPending} aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} className="whitespace-nowrap" aria-describedby={!isOnline ? "offline-workflow-notice" : undefined}>
                    <Send className="h-4 w-4" aria-hidden="true" /> {t("stateForm.submitReport")}
                          </Button>
                        ) : (
                          <Button type="button" onClick={nextStep} disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} className="whitespace-nowrap">
                            {t("stateForm.next")}
                            <ChevronRight className="ms-1 h-4 w-4 rtl:rotate-180" aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })() : (
                  <div className="border-t shrink-0 px-6 py-4 flex justify-end gap-2 bg-background">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending}
                      onClick={() => {
                        if (isFormDirty) { setShowDiscardConfirm(true); return; }
                        setCreateOpen(false);
                        resetForm();
                      }}
                    >
                      {t("stateForm.cancel")}
                    </Button>
                    <Button type="button" variant="secondary" onClick={onSaveDraft} disabled={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} className="whitespace-nowrap">
                      {t("stateForm.saveDraft")}
                    </Button>
                    <Button type="button" onClick={onSubmitReport} disabled={!isOnline || isSubmittingReport || createMutation.isPending || transitionMutation.isPending} aria-busy={isSubmittingReport || createMutation.isPending || transitionMutation.isPending} className="whitespace-nowrap" aria-describedby={!isOnline ? "offline-workflow-notice" : undefined}>
                    <Send className="h-4 w-4" aria-hidden="true" /> {t("stateForm.submitReport")}
                    </Button>
                  </div>
                ))}
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {recoverableDeviceDraft && canCreate && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 px-4 py-3" role="status">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("sync.status.local-draft", { ns: "common" })}: {recoverableDeviceDraft.title || t("sync.untitledDraft", { ns: "common" })}</p>
            <p className="text-xs text-muted-foreground">{t("sync.draftRecovery", { ns: "common" })}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
            {t("continueEditing")}
          </Button>
        </div>
      )}

      <SummaryCards lockedType={lockedType} />

      {/* §5–6: Filter toolbar — enterprise order: Status · Frequency · State · Sector · Project · Period · Author */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-2">
        <Filter className="h-4 w-4 text-muted-foreground shrink-0" />
        <Separator orientation="vertical" className="h-5" />

        {/* Status */}
        <Select value={displayStatusFilter} onValueChange={setDisplayStatusFilter}>
          <SelectTrigger aria-label={t("filters.filterByStatus")} className="h-8 min-w-[7rem] w-auto max-w-[10rem] text-sm"><SelectValue placeholder={t("filters.allStatuses")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allStatuses")}</SelectItem>
            {Object.keys(STATUS_GROUPS).map((s) => <SelectItem key={s} value={s}>{t(`status.${s}`)}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Frequency — hidden for Activity Reports (no user-selected frequency; internal default only) */}
        {!isActivity && (
          <Select value={kindFilter} onValueChange={setKindFilter}>
            <SelectTrigger aria-label={t("filters.filterByFrequency")} className="h-8 min-w-[7rem] w-auto max-w-[10rem] text-sm"><SelectValue placeholder={t("filters.allFrequencies")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allFrequencies")}</SelectItem>
              <SelectItem value="monthly">{t("frequency.monthly")}</SelectItem>
              <SelectItem value="quarterly">{t("frequency.quarterly")}</SelectItem>
              <SelectItem value="annual">{t("frequency.annual")}</SelectItem>
              <SelectItem value="on_demand">{t("frequency.on_demand")}</SelectItem>
            </SelectContent>
          </Select>
        )}

        {/* State — hidden for HQ Sector reports (no state scope) */}
        {!isHqSector && (
          <Select value={stateId} onValueChange={setStateId}>
            <SelectTrigger aria-label={t("filters.filterByState")} className="h-8 min-w-[7rem] w-auto max-w-[10rem] text-sm"><SelectValue placeholder={t("filters.allStates")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allStates")}</SelectItem>
              {states?.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Sector */}
        <Select value={sector} onValueChange={setSector}>
          <SelectTrigger aria-label={t("filters.filterBySector")} className="h-8 min-w-[7rem] w-auto max-w-[10rem] text-sm"><SelectValue placeholder={t("filters.allSectors")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allSectors")}</SelectItem>
            {SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Project */}
        <Select value={projectId} onValueChange={setProjectId}>
          <SelectTrigger aria-label={t("filters.filterByProject")} className="h-8 min-w-[7rem] w-auto max-w-[11rem] text-sm"><SelectValue placeholder={t("filters.allProjects")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allProjects")}</SelectItem>
            {/* Standalone Activities sentinel — activity reports tab only */}
            {isActivity && (
              <SelectItem value="standalone">{t("filters.standaloneActivities")}</SelectItem>
            )}
            {projects?.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.code}</SelectItem>)}
          </SelectContent>
        </Select>

        {/* Activity — only shown for Activity Reports (scoped to accessible population) */}
        {isActivity && (
          <Select value={activityFilter} onValueChange={setActivityFilter}>
            <SelectTrigger aria-label={t("filters.filterByActivity")} className="h-8 min-w-[8rem] w-auto max-w-[12rem] text-sm"><SelectValue placeholder={t("filters.allActivities")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allActivities")}</SelectItem>
              {activityFacetOptions.map((a) => (
                <SelectItem key={a.id} value={String(a.id)}>
                  {a.code ? `${a.code} — ${a.title}` : a.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {/* §4: Frequency-aware period controls ─────────────────────────────────
            All Frequencies → Year only (no Month / Quarter)
            Monthly         → Month + Year
            Quarterly       → Quarter + Year
            Annual          → Year only
            On-Demand       → no period controls (date embedded in period string) */}
        {kindFilter === "quarterly" && (
          <Select value={quarterFilter} onValueChange={setQuarterFilter}>
            <SelectTrigger aria-label={t("filters.filterByQuarter")} className="h-8 min-w-[6rem] w-auto max-w-[8rem] text-sm"><SelectValue placeholder={t("filters.allQuarters")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allQuarters")}</SelectItem>
              <SelectItem value="1">Q1</SelectItem>
              <SelectItem value="2">Q2</SelectItem>
              <SelectItem value="3">Q3</SelectItem>
              <SelectItem value="4">Q4</SelectItem>
            </SelectContent>
          </Select>
        )}
        {/* Month control: Activity Reports always use YYYY-MM periods so always show Month.
            For other report types, show only when Frequency = Monthly. */}
        {(lockedType === "activity" || kindFilter === "monthly") && (
          <Select value={reportingMonth} onValueChange={setReportingMonth}>
            <SelectTrigger aria-label={t("filters.filterByMonth")} className="h-8 min-w-[6rem] w-auto max-w-[8rem] text-sm"><SelectValue placeholder={t("filters.allMonths")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allMonths")}</SelectItem>
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "short" })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {/* Year control: all frequencies except On-Demand */}
        {kindFilter !== "on_demand" && (
          <Select value={reportingYear} onValueChange={setReportingYear}>
            <SelectTrigger aria-label={t("filters.filterByYear")} className="h-8 min-w-[5rem] w-auto max-w-[7rem] text-sm"><SelectValue placeholder={t("filters.allYears")} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("filters.allYears")}</SelectItem>
              {yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
        )}

        {/* Author — sourced from /reports/authors (population-scoped, not page-scoped) */}
        <Select value={authorId} onValueChange={setAuthorId}>
          <SelectTrigger aria-label={t("filters.filterByAuthor")} className="h-8 min-w-[7rem] w-auto max-w-[11rem] text-sm"><SelectValue placeholder={t("filters.allAuthors")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("filters.allAuthors")}</SelectItem>
            {authorOptions.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>{a.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* §23: Clear Filters — only visible when at least one filter is non-default */}
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2 text-muted-foreground hover:text-foreground"
            onClick={() => {
              setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all");
              setProjectId("all"); setReportingMonth("all"); setReportingYear("all");
              setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all");
            }}
          >
            <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
          </Button>
        )}
      </div>

      {viewMode === "table" ? (
        <Card>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="divide-y">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="flex items-center gap-4 px-6 py-3">
                    <Skeleton className="h-4 flex-[3]" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-20" />
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-5 w-24 rounded-full" />
                  </div>
                ))}
              </div>
            ) : isError ? (
              <ErrorState
                variant="server"
                title={t("loadError")}
                description={t("loadErrorDesc")}
                onRetry={() => refetch()}
              />
            ) : (
              <div className="overflow-x-auto" role="region" aria-label={t("list.tableAriaLabel")}>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_hsl(var(--border))]">
                    {/* §26: Table columns — Report (title+period) · Status · [Activity] · Project · State · Sector · Frequency · Prepared By · Actions */}
                    <TableRow>
                      <TableHead className="min-w-[220px]">{t("list.title")}</TableHead>
                      <TableHead className="w-[138px]">{t("list.status")}</TableHead>
                      {isActivity && <TableHead className="min-w-[180px] max-w-[220px]">{t("list.activity")}</TableHead>}
                      <TableHead className="min-w-[130px] max-w-[180px]">{t("list.project")}</TableHead>
                      <TableHead className="w-[110px]">{t("list.state")}</TableHead>
                      <TableHead className="w-[120px]">{t("list.sector")}</TableHead>
                      <TableHead className="w-[90px]">{t("list.frequency")}</TableHead>
                      <TableHead className="min-w-[110px] max-w-[150px]">{t("list.preparedBy")}</TableHead>
                      <TableHead className="w-[130px]">{t("list.actions")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {/* §24: Empty state — distinguish scope-empty from filter-empty */}
                    {reports?.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={isActivity ? 9 : 8} className="text-center py-10">
                          <div className="flex flex-col items-center gap-3 text-muted-foreground">
                            <meta.icon className="h-8 w-8 opacity-30" aria-hidden />
                            {!hasActiveFilters ? (
                              <>
                                <p className="text-sm font-medium">{t("list.noScopeEmpty", { type: meta.label })}</p>
                                {canCreate && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="gap-1.5"
                                    onClick={() => setCreateOpen(true)}
                                  >
                                    <Plus className="h-3.5 w-3.5" /> {t("newReport")}
                                  </Button>
                                )}
                              </>
                            ) : (
                              <>
                                <p className="text-sm font-medium">{t("list.noFilterMatch", { type: meta.label })}</p>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1 text-muted-foreground hover:text-foreground"
                                  onClick={() => {
                                    setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all");
                                    setProjectId("all"); setReportingMonth("all"); setReportingYear("all");
                                    setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all");
                                  }}
                                >
                                  <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )}
                    {reports?.map((r) => {
                      const sb = statusBadgeVariant(r.status);
                      const displaySector = r.effectiveSector ?? r.sector;
                      const rKind = (r as unknown as Record<string, unknown>).kind as string | undefined;
                      return (
                        <TableRow
                          key={r.id}
                          onClick={(event) => openReportDetail(r, event.currentTarget)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter" || event.key === " ") {
                              event.preventDefault();
                              openReportDetail(r, event.currentTarget);
                            }
                          }}
                          tabIndex={0}
                          role="button"
                          aria-label={`Open report: ${r.title}`}
                          className="cursor-pointer hover:bg-muted/50 transition-colors"
                        >
                          {/* §26 column order: Report (title+period) · Status · [Activity] · Project · State · Sector · Frequency · Prepared By */}
                          <TableCell className="font-medium max-w-xs">
                            <span className="line-clamp-1 leading-snug" title={r.title}>{r.title}</span>
                            <span className="block text-[11px] text-muted-foreground tabular-nums mt-0.5">
                              {formatPeriodOnly(rKind, r.period, i18n.language)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant={sb.variant} className={sb.className}>{displayStatus(r.status, t)}</Badge>
                          </TableCell>
                          {isActivity && (
                            <TableCell className="max-w-[200px]">
                              {(() => {
                                const aTitle = (r as unknown as Record<string, unknown>).activityTitle as string | undefined;
                                const aCode  = (r as unknown as Record<string, unknown>).activityCode  as string | undefined;
                                return aTitle ? (
                                  <div>
                                    <p className="text-sm font-medium leading-snug truncate" title={aTitle}>{aTitle}</p>
                                    {aCode && <p className="text-[11px] text-muted-foreground mt-0.5">{aCode}</p>}
                                  </div>
                                ) : <span className="text-sm text-muted-foreground">—</span>;
                              })()}
                            </TableCell>
                          )}
                          <TableCell
                            className="text-sm text-muted-foreground max-w-[160px] truncate"
                            title={r.projectTitle ?? (isActivity ? t("list.standalone") : undefined)}
                          >
                            {r.projectTitle ?? (isActivity ? (
                              <span className="italic text-muted-foreground/60">{t("list.standalone")}</span>
                            ) : "—")}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[120px] truncate" title={formatLocation({ locationType: r.locationType, stateName: r.stateName, stateNameAr: r.stateNameAr }, i18n.language) || undefined}>{formatLocation({ locationType: r.locationType, stateName: r.stateName, stateNameAr: r.stateNameAr }, i18n.language)}</TableCell>
                          <TableCell className="text-sm text-muted-foreground max-w-[130px] truncate" title={displaySector || undefined}>{displaySector || "—"}</TableCell>
                          <TableCell className="text-sm text-muted-foreground capitalize whitespace-nowrap">
                            {/* For Activity Reports: "monthly" is a compatibility default (not user-selected);
                                show "—" to avoid implying the user chose a frequency.
                                Historical quarterly/annual/on_demand rows retain their displayed value. */}
                            {(isActivity && rKind === "monthly")
                              ? "—"
                              : rKind === "on_demand"
                                ? displayFrequency(rKind, t)
                                : rKind
                                  ? displayFrequency(rKind, t)
                                  : "—"}
                          </TableCell>

                          <TableCell
                            className="text-sm text-muted-foreground max-w-[140px] truncate"
                            title={r.authorName ?? r.submittedByName ?? undefined}
                          >{r.authorName ?? r.submittedByName}</TableCell>
                          <TableCell onClick={(e) => e.stopPropagation()} className="py-2">
                            {canResumeReportDraft(r, perms, me?.user) && (
                              <div className="flex items-center gap-1">
                                <ContinueEditingAction
                                  recordTitle={r.title}
                                  onClick={() => startDraftEditing(r)}
                                />
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" aria-label={t("formExtra.moreActions")}>
                                      <MoreHorizontal className="h-3.5 w-3.5" aria-hidden />
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end" className="w-40">
                                    <DropdownMenuItem onClick={() => handleDirectSubmit(r)} className="gap-2">
                                      <Send className="h-3.5 w-3.5" /> {t("list.submit")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDuplicateReport(r)} className="gap-2">
                                      <Copy className="h-3.5 w-3.5" /> {t("list.duplicate")}
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      onClick={() => setDeleteTarget(r)}
                                      className="gap-2 text-destructive focus:text-destructive"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" /> {t("list.deleteDraft")}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            )}
                            {r.status === "rejected" && (
                              /* Rejected is terminal. No PATCH allowed. Use "Duplicate as Draft" for a replacement. */
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2 text-xs gap-1"
                                onClick={() => handleDuplicateReport(r)}
                              >
                                <Copy className="h-3 w-3" /> {t("list.duplicateAsDraft")}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
          {/* §21–22: Result count — always visible; pagination controls appear only when > 1 page */}
          {reportsRaw && reportsRaw.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t text-sm text-muted-foreground">
              <span className="tabular-nums">
                {reportsRaw.totalPages > 1
                  ? t("pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, reportsRaw.total), total: reportsRaw.total, type: meta.label })
                  : t("pagination.totalCount", { total: reportsRaw.total, type: meta.label })}
              </span>
              {reportsRaw.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    {t("pagination.previous")}
                  </Button>
                  <span className="text-xs">{t("pagination.pageOf", { page, total: reportsRaw.totalPages })}</span>
                  <Button variant="outline" size="sm" disabled={page >= reportsRaw.totalPages} onClick={() => setPage((p) => p + 1)}>
                    {t("pagination.next")}
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>
      ) : isLoading ? (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="flex items-center gap-4 px-6 py-3">
                  <Skeleton className="h-4 flex-[3]" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-20" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : viewMode === "card" ? (
        <>
          <CardGrid
            items={viewRecords}
            empty={
              <div className="flex flex-col items-center gap-3 text-muted-foreground py-10">
                <meta.icon className="h-8 w-8 opacity-30" aria-hidden />
                <p className="text-sm font-medium">
                  {!hasActiveFilters
                    ? t("list.noScopeEmpty", { type: meta.label })
                    : t("list.noFilterMatch", { type: meta.label })}
                </p>
                {canCreate && !hasActiveFilters ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> {t("newReport")}
                  </Button>
                ) : hasActiveFilters ? (
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => { setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all"); setProjectId("all"); setReportingMonth("all"); setReportingYear("all"); setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all"); }}>
                    <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
                  </Button>
                ) : null}
              </div>
            }
          />
          {/* §21–22: Result count + pagination for card view */}
          {reportsRaw && reportsRaw.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground pt-1">
              <span className="tabular-nums">
                {reportsRaw.totalPages > 1
                  ? t("pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, reportsRaw.total), total: reportsRaw.total, type: meta.label })
                  : t("pagination.totalCount", { total: reportsRaw.total, type: meta.label })}
              </span>
              {reportsRaw.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("pagination.previous")}</Button>
                  <span className="text-xs">{t("pagination.pageOf", { page, total: reportsRaw.totalPages })}</span>
                  <Button variant="outline" size="sm" disabled={page >= reportsRaw.totalPages} onClick={() => setPage((p) => p + 1)}>{t("pagination.next")}</Button>
                </div>
              )}
            </div>
          )}
        </>
      ) : viewMode === "list" ? (
        <>
          <Card>
            <CardContent className="p-0">
              <ListView
                items={viewRecords}
                empty={
                  <div className="flex flex-col items-center gap-3 text-muted-foreground py-10">
                    <meta.icon className="h-8 w-8 opacity-30" aria-hidden />
                    <p className="text-sm font-medium">
                      {!hasActiveFilters
                        ? t("list.noScopeEmpty", { type: meta.label })
                        : t("list.noFilterMatch", { type: meta.label })}
                    </p>
                    {canCreate && !hasActiveFilters ? (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5" /> {t("newReport")}
                      </Button>
                    ) : hasActiveFilters ? (
                      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => { setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all"); setProjectId("all"); setReportingMonth("all"); setReportingYear("all"); setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all"); }}>
                        <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            </CardContent>
          </Card>
          {reportsRaw && reportsRaw.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {reportsRaw.totalPages > 1
                  ? t("pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, reportsRaw.total), total: reportsRaw.total, type: meta.label })
                  : t("pagination.totalCount", { total: reportsRaw.total, type: meta.label })}
              </span>
              {reportsRaw.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("pagination.previous")}</Button>
                  <span className="text-xs">{t("pagination.pageOf", { page, total: reportsRaw.totalPages })}</span>
                  <Button variant="outline" size="sm" disabled={page >= reportsRaw.totalPages} onClick={() => setPage((p) => p + 1)}>{t("pagination.next")}</Button>
                </div>
              )}
            </div>
          )}
        </>
      ) : viewMode === "compact" ? (
        <>
          <Card>
            <CardContent className="p-0">
              <CompactView
                items={viewRecords}
                empty={
                  <div className="flex flex-col items-center gap-3 text-muted-foreground py-10">
                    <meta.icon className="h-8 w-8 opacity-30" aria-hidden />
                    <p className="text-sm font-medium">
                      {!hasActiveFilters
                        ? t("list.noScopeEmpty", { type: meta.label })
                        : t("list.noFilterMatch", { type: meta.label })}
                    </p>
                    {canCreate && !hasActiveFilters ? (
                      <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                        <Plus className="h-3.5 w-3.5" /> {t("newReport")}
                      </Button>
                    ) : hasActiveFilters ? (
                      <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => { setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all"); setProjectId("all"); setReportingMonth("all"); setReportingYear("all"); setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all"); }}>
                        <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
                      </Button>
                    ) : null}
                  </div>
                }
              />
            </CardContent>
          </Card>
          {reportsRaw && reportsRaw.total > 0 && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span className="tabular-nums">
                {reportsRaw.totalPages > 1
                  ? t("pagination.showing", { from: (page - 1) * PAGE_SIZE + 1, to: Math.min(page * PAGE_SIZE, reportsRaw.total), total: reportsRaw.total, type: meta.label })
                  : t("pagination.totalCount", { total: reportsRaw.total, type: meta.label })}
              </span>
              {reportsRaw.totalPages > 1 && (
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("pagination.previous")}</Button>
                  <span className="text-xs">{t("pagination.pageOf", { page, total: reportsRaw.totalPages })}</span>
                  <Button variant="outline" size="sm" disabled={page >= reportsRaw.totalPages} onClick={() => setPage((p) => p + 1)}>{t("pagination.next")}</Button>
                </div>
              )}
            </div>
          )}
        </>
      ) : viewMode === "kanban" ? (
        <div className="p-1">
          <KanbanBoard
            items={viewRecords}
            columns={REPORT_KANBAN_COLS}
            empty={
              <div className="flex flex-col items-center gap-3 text-muted-foreground py-10">
                <meta.icon className="h-8 w-8 opacity-30" aria-hidden />
                <p className="text-sm font-medium">
                  {!hasActiveFilters
                    ? t("list.noScopeEmpty", { type: meta.label })
                    : t("list.noFilterMatch", { type: meta.label })}
                </p>
                {canCreate && !hasActiveFilters ? (
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setCreateOpen(true)}>
                    <Plus className="h-3.5 w-3.5" /> {t("newReport")}
                  </Button>
                ) : hasActiveFilters ? (
                  <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground hover:text-foreground"
                    onClick={() => { setDisplayStatusFilter("all"); setKindFilter("all"); setStateId("all"); setSector("all"); setProjectId("all"); setReportingMonth("all"); setReportingYear("all"); setQuarterFilter("all"); setAuthorId("all"); setActivityFilter("all"); }}>
                    <X className="h-3.5 w-3.5" /> {t("filters.clearFilters")}
                  </Button>
                ) : null}
              </div>
            }
          />
        </div>
      ) : null}

      {/* Activity Reports: centred large Dialog viewer */}
      <ActivityReportViewer
        open={!!selected && selected.reportType === "activity"}
        onClose={() => setSelected(null)}
        onCloseComplete={completeReportViewerClose}
        restoreFocusRef={detailTriggerRef}
        report={selected!}
        transitions={transitions}
        onTransitionOpen={(t) => setTransitionOpen(t)}
        reportUnresolvedRC={reportUnresolvedRC}
        currentUserId={me?.user?.id ?? null}
        currentUserRole={me?.user?.role ?? null}
        headerActions={selected && canResumeReportDraft(selected, perms, me?.user) ? (
          <ContinueEditingAction
            recordTitle={selected.title}
            onClick={() => resumeDraftFromViewer(selected)}
          />
        ) : undefined}
      />

      {/* Project, State Programme and HQ Sector reports use the shared centred record viewer.
          HQ Sector Reports never render State/Project metadata: canonical HQ-sector
          records intentionally have no project or state linkage. */}
      <RecordDetailModal
        open={!!selected && selected.reportType !== "activity"}
        onClose={() => setSelected(null)}
        onCloseComplete={completeReportViewerClose}
        restoreFocusRef={detailTriggerRef}
        title={selected?.title ?? "Report detail"}
        description={selected
          ? `${meta.label}${selected.reportType !== "hq_sector" && selected.projectTitle ? ` · ${selected.projectTitle}` : ""}${selected.reportType !== "hq_sector" && (selected.locationType || selected.stateName) ? ` · ${formatLocation({ locationType: selected.locationType, stateName: selected.stateName, stateNameAr: selected.stateNameAr }, i18n.language)}` : ""}`
          : "Report detail"}
        metadata={selected ? (
          <>
            <Badge variant={statusBadgeVariant(selected.status).variant} className={statusBadgeVariant(selected.status).className}>{displayStatus(selected.status, t)}</Badge>
            {(selected.effectiveSector ?? selected.sector) && (
              <Badge variant="outline" className="text-xs">{selected.effectiveSector ?? selected.sector}</Badge>
            )}
          </>
        ) : undefined}
        headerActions={selected && canResumeReportDraft(selected, perms, me?.user) ? (
          <ContinueEditingAction
            recordTitle={selected.title}
            onClick={() => resumeDraftFromViewer(selected)}
          />
        ) : undefined}
        footer={selected && transitions.length > 0 ? transitions.map((tr) => {
          const blocked = tr.action === "final_approve" && reportUnresolvedRC > 0;
          return (
            <Button
              key={tr.action}
              size="sm"
              variant={tr.variant || "default"}
              disabled={blocked}
              title={blocked ? t("detail.unresolvedRC_other", { count: reportUnresolvedRC }) : undefined}
              onClick={() => setTransitionOpen({ action: tr.action, label: tr.label })}
            >
              <tr.icon className="h-4 w-4" />{tr.label}
            </Button>
          );
        }) : undefined}
      >
          {selected && (
            <>
              <div className="min-w-0 space-y-5">
                {/* ── Non-activity reports: generic section renderer ──────── */}
                <>
                    {/* Metadata grid */}
                    <div className="grid grid-cols-1 gap-3 text-sm rounded-lg border bg-muted/20 p-4 sm:grid-cols-2 xl:grid-cols-4">
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">{t("detail.period")}</p>
                        <p className="font-medium">{selected.period}</p>
                      </div>
                      {selected.periodStart && (
                        <div>
                          <p className="text-xs text-muted-foreground mb-0.5">{t("detail.dateRange")}</p>
                          <p className="font-medium">{formatDate(selected.periodStart)}{selected.periodEnd ? ` → ${formatDate(selected.periodEnd)}` : ""}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">{t("detail.preparedBy")}</p>
                        <p className="font-medium">{selected.authorName ?? selected.submittedByName}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-0.5">{t("detail.submitted")}</p>
                        <p className="font-medium">{formatDateTime(selected.submittedAt)}</p>
                      </div>
                       {selected.submittedTo && (
                         <div className="col-span-full">
                          <p className="text-xs text-muted-foreground mb-0.5">{t("detail.submittedTo")}</p>
                          <p className="font-medium">{selected.submittedTo}</p>
                        </div>
                      )}
                      {(() => {
                        const wp = (selected as unknown as Record<string, unknown>).workflowPath as string | null | undefined;
                        if (!wp) return null;
                        const label = wp === "technical_authored" ? "Technical Authored Workflow"
                          : wp === "state_authored" ? "State Authored Workflow"
                          : wp === "spc_fallback" ? "SPC Fallback Workflow"
                          : wp.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
                        return (
                           <div className="col-span-full">
                            <p className="text-xs text-muted-foreground mb-0.5">{t("form.approvalWorkflow")}</p>
                            <p className="font-medium">{label}</p>
                          </div>
                        );
                      })()}
                    </div>

                    {/* §2: Structured approval paths in detail sheet */}
                    <div className="rounded-lg border bg-muted/10 px-4 py-3">
                      <WorkflowBlock workflow={meta.workflow} />
                    </div>

                    {/* Key Achievements / Progress */}
                    {selected.sections && selected.reportType !== "program_state" && selected.reportType !== "hq_sector" && sectionsCfg.progress.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold mb-2">{t("detail.narrative")}</h4>
                        {sectionsCfg.progress.map((s) => {
                          const val = (selected.sections as Record<string, string> | null | undefined)?.[s.key];
                          if (!val) return null;
                          return (
                            <div key={s.key}>
                              <p className="text-xs font-medium text-muted-foreground mb-1">{s.label.replace(" *", "")}</p>
                              <p className="text-sm whitespace-pre-wrap">{val}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Activities — expandable cards */}
                    {Array.isArray(selected.activities) && selected.activities.length > 0 && selected.reportType !== "hq_sector" && selected.reportType !== "program_state" && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">{t("detail.activitiesImplemented")}</h4>
                        <div className="space-y-2">
                          {(selected.activities as Array<Record<string, unknown>>).map((a, i) => (
                            <details key={i} className="rounded border text-xs group">
                              <summary className="flex items-center justify-between p-2 cursor-pointer list-none select-none">
                                <div className="flex items-center gap-2 min-w-0">
                                  <ChevronRight className="h-3 w-3 flex-shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                                  <p className="font-medium truncate">{String(a.name ?? "—")}</p>
                                  {!!a.isUnplanned && (
                                    <Badge variant="secondary" className="text-xs flex-shrink-0">{t("form.unplanned")}</Badge>
                                  )}
                                </div>
                                <Badge variant="outline" className="text-xs flex-shrink-0 ms-2">{String(a.status ?? "—")} · {String(a.percent ?? 0)}%</Badge>
                              </summary>
                              <div className="px-3 pb-3 pt-1 space-y-2 border-t bg-muted/10">
                                <p className="text-muted-foreground">
                                  {t("detail.output")} {String(a.output ?? "—")} · {t("detail.milestone")} {String(a.milestone ?? "—")}
                                  {a.budget != null && <> · {t("detail.budget")} {formatCurrency(Number(a.budget))}</>}
                                  {a.beneficiaries != null && <> · {t("detail.beneficiaries")} {Number(a.beneficiaries).toLocaleString()}</>}
                                </p>
                                {/* Per-activity financials (project reports) */}
                                {(a.plannedBudget != null || (a.actualExpenditure != null && a.actualExpenditure !== "")) && (
                                  <div className="grid grid-cols-2 gap-2 text-center text-xs">
                                    <div className="rounded border p-1">
                                       <p className="text-muted-foreground">{t("detail.planned")}</p>
                                      <p className="font-medium">{a.plannedBudget != null ? formatCurrency(Number(a.plannedBudget)) : "—"}</p>
                                    </div>
                                    <div className="rounded border p-1">
                                       <p className="text-muted-foreground">{t("detail.actualExpenditure")}</p>
                                      <p className="font-medium">{a.actualExpenditure != null && a.actualExpenditure !== "" ? formatCurrency(Number(a.actualExpenditure)) : "—"}</p>
                                    </div>
                                  </div>
                                )}
                                {/* Unplanned reason */}
                                {!!a.isUnplanned && !!a.unplannedReason && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("form.exceptionReason")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.unplannedReason)}</p>
                                  </div>
                                )}
                                {!!a.achievementSummary && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("form.achievementSummary")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.achievementSummary)}</p>
                                  </div>
                                )}
                                {(a.beneficiariesMen != null || a.beneficiariesWomen != null || a.beneficiariesBoys != null || a.beneficiariesGirls != null) && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-1">
                                       {selected.reportType === "project" ? t("form.beneficiaryReachPeriod") : t("form.beneficiaryBreakdown")}
                                    </p>
                                    <div className="grid grid-cols-4 gap-2 text-center">
                                       {([[t("detail.male"), a.beneficiariesMen], [t("detail.female"), a.beneficiariesWomen], [t("detail.boys"), a.beneficiariesBoys], [t("detail.girls"), a.beneficiariesGirls]] as [string, unknown][]).map(([label, val]) => (
                                        <div key={label} className="rounded border p-1">
                                          <p className="text-muted-foreground">{label}</p>
                                          <p className="font-medium">{val != null ? Number(val).toLocaleString() : "—"}</p>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                                {!!a.challenges && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("fields.challenges")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.challenges)}</p>
                                  </div>
                                )}
                                {!!a.mitigationMeasures && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("form.fieldLabels.mitigationMeasures")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.mitigationMeasures)}</p>
                                  </div>
                                )}
                                {!!a.nextSteps && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("fields.nextSteps")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.nextSteps)}</p>
                                  </div>
                                )}
                                {!!a.varianceReason && (
                                  <div>
                                    <p className="font-medium text-muted-foreground mb-0.5">{t("form.varianceReason")}</p>
                                    <p className="whitespace-pre-wrap">{String(a.varianceReason)}</p>
                                  </div>
                                )}
                              </div>
                            </details>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Indicator Progress */}
                    {Array.isArray((selected as unknown as Record<string, unknown>).indicatorProgress) &&
                      ((selected as unknown as Record<string, unknown>).indicatorProgress as unknown[]).length > 0 ? (
                      <div>
                        <h4 className="text-sm font-semibold mb-2">{t("fields.indicators")}</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs border-collapse">
                            <thead>
                              <tr className="border-b text-muted-foreground">
                                <th className="text-start py-1 pe-3 font-medium">{t("form.indicator")}</th>
                                <th className="text-end py-1 pe-3 font-medium">{t("form.target")}</th>
                                <th className="text-end py-1 pe-3 font-medium">{t("form.cumulative")}</th>
                                <th className="text-end py-1 pe-3 font-medium">{t("form.thisPeriod")}</th>
                                <th className="text-start py-1 font-medium">{t("form.remarks")}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {((selected as unknown as Record<string, unknown>).indicatorProgress as Array<Record<string, unknown>>).map((ind, i) => (
                                <tr key={i} className="border-b last:border-0">
                                  <td className="py-1 pe-3">{String(ind.name ?? "—")}</td>
                                  <td className="text-end py-1 pe-3">{ind.target != null ? String(ind.target) : "—"}</td>
                                  <td className="text-end py-1 pe-3">{ind.cumAchieved != null ? String(ind.cumAchieved) : "—"}</td>
                                  <td className="text-end py-1 pe-3">{ind.currentAchievement != null ? String(ind.currentAchievement) : "—"}</td>
                                  <td className="py-1 text-muted-foreground">{ind.remarks ? String(ind.remarks) : ""}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ) : (selected as unknown as Record<string, unknown>).indicatorProgress !== undefined &&
                        Array.isArray((selected as unknown as Record<string, unknown>).indicatorProgress) &&
                        ((selected as unknown as Record<string, unknown>).indicatorProgress as unknown[]).length === 0 ? (
                      <p className="text-xs text-muted-foreground">{t("form.noIndicatorProgress")}</p>
                    ) : null}

                    {/* Beneficiaries */}
                    <div>
                      <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Users className="h-4 w-4" />{" "}
                        {selected.reportType === "project"
                          ? t("detail.projectBeneficiarySummary")
                          : t("detail.beneficiarySummary")}
                      </h4>
                      <div className="grid grid-cols-5 gap-2 text-center text-xs">
                        {[
                          [t("detail.male"), selected.beneficiariesMale ?? 0],
                          [t("detail.female"), selected.beneficiariesFemale ?? 0],
                          [t("detail.boys"), selected.beneficiariesBoys ?? 0],
                          [t("detail.girls"), selected.beneficiariesGirls ?? 0],
                          [t("detail.total"), (selected.beneficiariesMale ?? 0) + (selected.beneficiariesFemale ?? 0) + (selected.beneficiariesBoys ?? 0) + (selected.beneficiariesGirls ?? 0)],
                        ].map(([k, val]) => (
                          <div key={k as string} className="rounded border p-2">
                            <p className="text-muted-foreground">{k}</p>
                            <p className="text-base font-medium">{(val as number).toLocaleString()}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Financial Summary */}
                    {selected.reportType === "project" && (selected.plannedBudget != null || selected.actualExpenditure != null) && (
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><DollarSign className="h-4 w-4" /> {t("detail.financialSummary")}</h4>
                        {(() => {
                          const selCur = (selected as unknown as Record<string, unknown>).currency as string | undefined;
                          const selPlanned = selected.plannedBudget != null ? Number(selected.plannedBudget) : null;
                          const selActual = Number(selected.actualExpenditure ?? 0);
                          const selVariance = selPlanned != null ? selPlanned - selActual : null;
                          const selUtil = selPlanned != null && selPlanned > 0 ? Math.round((selActual / selPlanned) * 100) : null;
                          return (
                            <div className="grid grid-cols-4 gap-2 text-center text-xs">
                              <div className="rounded border p-2"><p className="text-muted-foreground">{t("detail.planned")}</p><p className="text-sm font-medium">{selPlanned != null ? formatCurrency(selPlanned, selCur) : "—"}</p></div>
                              <div className="rounded border p-2"><p className="text-muted-foreground">{t("detail.actualExpenditure")}</p><p className="text-sm font-medium">{formatCurrency(selActual, selCur)}</p></div>
                              <div className="rounded border p-2"><p className="text-muted-foreground">{t("detail.variance")}</p><p className="text-sm font-medium text-foreground">{selVariance != null ? (selVariance === 0 ? t("detail.onBudget") : `${selVariance > 0 ? t("detail.underspend") : t("detail.overspend")}: ${formatCurrency(Math.abs(selVariance), selCur)}`) : "—"}</p></div>
                              <div className="rounded border p-2"><p className="text-muted-foreground">{t("detail.utilisation")}</p><p className="text-sm font-medium">{selUtil != null ? `${selUtil}%` : "—"}</p></div>
                            </div>
                          );
                        })()}
                      </div>
                    )}

                    {/* Challenges & Mitigation */}
                    {selected.sections && selected.reportType !== "program_state" && selected.reportType !== "hq_sector" && sectionsCfg.challenges.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold mb-2">{t("form.tabChallengesActions")}</h4>
                        {sectionsCfg.challenges.map((s) => {
                          const val = (selected.sections as Record<string, string> | null | undefined)?.[s.key];
                          if (!val) return null;
                          return (
                            <div key={s.key}>
                              <p className="text-xs font-medium text-muted-foreground mb-1">{configuredFieldLabel(s)}</p>
                              <p className="text-sm whitespace-pre-wrap">{val}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Lessons & Recommendations (narrative section) */}
                    {selected.sections && selected.reportType !== "program_state" && selected.reportType !== "hq_sector" && sectionsCfg.narrative && sectionsCfg.narrative.length > 0 && (
                      <div className="space-y-3">
                        <h4 className="text-sm font-semibold mb-2">{t("form.tabLessonsRecommendations")}</h4>
                        {sectionsCfg.narrative.map((s) => {
                          const val = (selected.sections as Record<string, string> | null | undefined)?.[s.key];
                          if (!val) return null;
                          return (
                            <div key={s.key}>
                              <p className="text-xs font-medium text-muted-foreground mb-1">{configuredFieldLabel(s)}</p>
                              <p className="text-sm whitespace-pre-wrap">{val}</p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Supporting Attachments */}
                    {(
                      <div>
                        <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><Paperclip className="h-4 w-4" /> {t("form.supportingAttachments")}</h4>
                        {detailAttachmentsLoading ? (
                          <p className="text-xs text-muted-foreground">{t("form.loading")}</p>
                        ) : detailAttachmentsError ? (
                          <p className="text-xs text-destructive">{t("form.attachmentLoadFailed")}</p>
                        ) : detailAttachments.length === 0 ? (
                          <p className="text-xs text-muted-foreground">{t("form.noAttachments")}</p>
                        ) : (
                          <div className="space-y-0.5">
                            {detailAttachments.map((att) => (
                              <div key={att.id} className="flex items-center justify-between py-1.5 border-b last:border-0 text-xs gap-3">
                                <span className="truncate" title={att.fileName}>{att.fileName}</span>
                                <a
                                  href={attachmentDownloadUrl(selected.id, att.id)}
                                  className="text-primary underline flex-shrink-0"
                                  aria-label={t("form.downloadFile", { fileName: att.fileName })}
                                >{t("form.download")}</a>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Voice Notes */}
                    {(
                      <div>
                        <h4 className="text-sm font-semibold mb-2">{t("form.voiceNotes")}</h4>
                        <VoiceNotePanel entityType="report" entityId={selected.id} readOnly />
                      </div>
                    )}

                    {selected.reportType === "program_state" && selected.sections && (
                      <ProgramStateSectionsView
                        sections={selected.sections as Record<string, unknown>}
                        activities={Array.isArray(selected.activities) ? (selected.activities as Array<Record<string, unknown>>) : undefined}
                        projects={projects?.map((p) => ({ id: p.id, code: p.code, title: p.title }))}
                        periodStart={selected.periodStart ?? null}
                        periodEnd={selected.periodEnd ?? null}
                        onAddComment={hasPerm(perms, "comments.create")
                          ? (section) => setCommentPreset((p) => ({ section, nonce: (p?.nonce ?? 0) + 1 }))
                          : undefined}
                      />
                    )}

                    {selected.reportType === "hq_sector" && selected.sections && (
                      <HqSectorSectionsView sections={selected.sections as Record<string, unknown>} />
                    )}

                    {/* Divider + Live Reference Data */}
                    {selected.reportType !== "program_state" && selected.reportType !== "hq_sector" && (
                      <>
                        <div className="border-t pt-2">
                          <p className="text-xs text-muted-foreground font-medium">{t("form.currentProjectReference")}</p>
                        </div>
                        <ReportAggregatesView reportId={selected.id} />
                      </>
                    )}
                  </>

                {hasPerm(perms, "comments.create") && (
                  <div>
                    <h4 className="text-sm font-semibold mb-2">{t("detail.commentsRevisions")}</h4>
                    <CommentsPanel
                      entityType="report"
                      entityId={selected.id}
                      sections={selected.reportType === "program_state"
                        ? [...SPR_SECTION_KEYS]
                        : ["narrative", "activities", "beneficiaries", "budget", "challenges", "lessons"]}
                      sectionLabels={selected.reportType === "program_state"
                        ? SPR_SECTION_LABELS
                        : {
                            narrative: t("detail.narrative"),
                            activities: t("detail.activitiesImplemented"),
                            beneficiaries: t("detail.beneficiarySummary"),
                            budget: t("detail.budget"),
                            challenges: t("fields.challenges"),
                            lessons: t("form.tabLessons"),
                          }}
                      presetSection={selected.reportType === "program_state" ? commentPreset : null}
                      currentUserId={me?.user?.id ?? null}
                      currentUserRole={me?.user?.role ?? null}
                    />
                  </div>
                )}

                {selected.approvalHistory && selected.approvalHistory.length > 0 && (
                  <div>
                    <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                      <Clock className="h-4 w-4 text-muted-foreground" /> {t("detail.approvalHistory")}
                    </h4>
                    <div className="space-y-0">
                      {selected.approvalHistory.map((h: ReportHistoryItem, idx: number) => {
                        const isApprove = h.action.includes("approve") || h.action.includes("final");
                        const isReject = h.action.includes("reject");
                        const isRevision = h.action.includes("revision");
                        const dotColor = isApprove ? "bg-success" : isReject ? "bg-destructive" : isRevision ? "bg-warning" : "bg-primary";
                        return (
                          <div key={h.id} className="flex gap-3 text-sm">
                            <div className="flex flex-col items-center">
                              <div className={`w-2.5 h-2.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                              {idx < selected.approvalHistory!.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                            </div>
                            <div className="flex-1 pb-4">
                              <p className="font-medium capitalize">{h.action.replace(/_/g, " ")}</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {displayStatus(h.fromStatus, t)} <ArrowRight className="inline h-3 w-3 mx-0.5 rtl:rotate-180" /> {displayStatus(h.toStatus, t)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {h.actorName} · {h.actorRole?.replace(/_/g, " ")} · {formatDateTime(h.timestamp)}
                              </p>
                              {!!h.usedOverride && (
                                <p className="text-xs bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded p-2 mt-1 flex items-start gap-1.5">
                                  <span className="font-semibold text-amber-700 dark:text-amber-400 shrink-0">{t("form.override")}</span>
                                  <span className="text-amber-700 dark:text-amber-400 italic">{h.overrideReason ?? ""}</span>
                                </p>
                              )}
                              {h.comment && (
                                <p className="text-xs bg-muted/40 rounded p-2 mt-1 italic border-l-2 border-primary/30">"{h.comment}"</p>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
      </RecordDetailModal>

      <Dialog open={!!transitionOpen} onOpenChange={(o) => { if (!o) { setTransitionOpen(null); setComment(""); setOverrideReason(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{transitionOpen?.label}</DialogTitle>
            <DialogDescription>
              {isSelfReviewOverride
                ? t("form.overrideDescription")
                : transitionOpen?.action === "request_revision" || transitionOpen?.action === "reject"
                  ? t("detail.transitionExplainReason")
                  : t("detail.transitionOptionalComment")}
            </DialogDescription>
          </DialogHeader>
          {!isOnline && (
            <p id="report-transition-offline-notice" role="alert" className="rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <span className="font-medium">{t("sync.internetRequired", { ns: "common" })}.</span>{" "}
              {t("sync.internetRequiredDescription", { ns: "common" })}
            </p>
          )}
          {isSelfReviewOverride && (
            <div className="space-y-1">
              <label className="text-sm font-medium">{t("form.overrideReason")} <span className="text-destructive">*</span></label>
              <Textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder={t("form.overridePlaceholder")}
              />
            </div>
          )}
          <Textarea
            rows={4}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={transitionOpen?.action === "request_revision" || transitionOpen?.action === "reject" ? t("detail.reasonRequired") : t("detail.commentOptional")}
          />
          <DialogFooter>
            <Button
              onClick={onTransition}
              disabled={
                !isOnline ||
                transitionMutation.isPending ||
                ((transitionOpen?.action === "request_revision" || transitionOpen?.action === "reject") && !comment.trim()) ||
                (isSelfReviewOverride && !overrideReason.trim())
              }
              aria-describedby={!isOnline ? "report-transition-offline-notice" : undefined}
            >
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Discard Unsaved Changes Confirmation ── */}
      <AlertDialog open={showDiscardConfirm} onOpenChange={setShowDiscardConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Discard and close?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowDiscardConfirm(false)}>
              Keep Editing
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDiscardConfirm(false);
                setIsFormDirty(false);
                setCreateOpen(false);
                resetForm();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Supporting Insights Remove Confirmation ── */}
      {/* Shown when a user clicks Remove on a populated section (prevents accidental data loss). */}
      <AlertDialog open={removeInsightConfirm !== null} onOpenChange={(o) => !o && setRemoveInsightConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this section?</AlertDialogTitle>
            <AlertDialogDescription>
              The text you have entered will be discarded. This cannot be undone unless you close
              without saving.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setRemoveInsightConfirm(null)}>{t("formExtra.keep")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (removeInsightConfirm === "successStory") {
                  setSectionValues((cur) => ({ ...cur, successStory: "" }));
                  setShowSuccessStory(false);
                } else if (removeInsightConfirm === "coordinationUpdates") {
                  setSectionValues((cur) => ({ ...cur, coordinationUpdates: "" }));
                  setShowCoordinationUpdates(false);
                } else if (removeInsightConfirm === "communityFeedback") {
                  setSectionValues((cur) => ({ ...cur, communityFeedback: "" }));
                  setShowCommunityFeedback(false);
                }
                setIsFormDirty(true);
                setRemoveInsightConfirm(null);
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Delete Draft Confirmation ── */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" /> {t("detail.deleteDraft")}
            </DialogTitle>
            <DialogDescription>
              This will permanently delete the draft report{" "}
              <span className="font-medium text-foreground">"{deleteTarget?.title}"</span>.
              This action cannot be undone and does not affect any approved records.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>{t("detail.cancel")}</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && handleDeleteReport(deleteTarget)}
            >
              {t("detail.deleteDraft")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
