import { useState, useEffect, useRef, useMemo, useId, useCallback } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { StateLabel } from "@/components/state-label";
import {
  useCreateReport,
  useTransitionReport,
  useListStates,
  useListProjects,
  useGetMe,
  requestUploadUrl,
  type ListReportsQueryResult,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DialogFooter } from "@/components/ui/dialog";
import {
  Plus, Trash2, Send, Upload, FileText, Loader2, X, AlertTriangle,
  ChevronDown, ChevronRight, TrendingUp, Users, Activity, ShieldAlert, Clock,
  CheckCircle2, AlertCircle, Lock,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { SECTORS } from "@/lib/sectors";
import { severityBadgeVariant, hasPerm } from "@/lib/format";
import { FormVoiceRecorder, type PendingNote } from "@/components/form-voice-recorder";
import { CommentsPanel } from "@/components/comments-panel";
import { SPR_SECTION_KEYS, SPR_SECTION_LABELS } from "@/lib/spr-sections";
import {
  OfflineReportDraftStatus,
  reportDraftKey,
  useOfflineReportDraft,
} from "@/lib/offline/report-drafts";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";
import { useSyncContext } from "@/contexts/sync-context";
import { sanitizeReportAttachments, buildReportPeriodLabel } from "@/lib/report-form-payload-shared";

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVITY_STATUS = ["Not Started", "Ongoing", "Completed", "Delayed", "Cancelled"] as const;

const ATTACHMENT_TYPES = [
  "Photos", "Meeting Minutes", "Attendance Sheets",
  "Assessment Reports", "Verification Documents",
  "Government Letters", "Other Supporting Documents",
] as const;

const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.gif";

const ON_DEMAND_REASONS = [
  "Donor Request", "Management Request", "Emergency Update",
  "Monitoring Visit", "Verification Mission", "Special Situation", "Other",
] as const;

const HQ_SUPPORT_TYPES = [
  "Technical Support", "Programme Support", "Finance Support",
  "Procurement Support", "Logistics Support", "HR Support",
  "Security Support", "Coordination Support", "IT/System Support", "Other",
] as const;

const PRIORITIES = ["High", "Medium", "Low"] as const;

const RISK_CATEGORIES = [
  "security", "operational", "financial", "programmatic", "environmental",
] as const;

// ── Types ─────────────────────────────────────────────────────────────────────

type Frequency = "monthly" | "quarterly" | "annual" | "on_demand";

type SpoActivity = {
  title: string;
  sector: string;
  locality: string;
  relatedProjectId: number | "";
  activityDate: string;
  status: string;
  achievementSummary: string;
  beneficiariesMen: number | "";
  beneficiariesWomen: number | "";
  beneficiariesBoys: number | "";
  beneficiariesGirls: number | "";
};

type HqSupportRequest = {
  supportType: string;
  priority: string;
  description: string;
};

type RiskItem = {
  category: string;
  title: string;
  severity: string;
  description: string;
};

type Attachment = {
  tempId: string;
  /** Safe report_attachments identity; never an object-storage authority. */
  attachmentId?: number;
  fileName: string;
  contentType: string;
  size: number;
  objectPath: string;
  /** New binary data is intentionally not persisted to offline draft storage. */
  file?: File;
  attachmentType: string;
  uploading?: boolean;
};

/**
 * Canonical shape of an attachment entry persisted inside the SPR
 * sections.attachments JSONB array (see buildPayloadData → cleanAttachments).
 */
type StoredSprAttachment = {
  attachmentId?: number;
  fileName: string;
  contentType: string;
  size: number;
  objectPath: string;
  attachmentType: string;
};

/** True when the value is a plain object (safe key access without casts). */
function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse the free-form JSONB sections.attachments value into the canonical
 * StoredSprAttachment shape using type narrowing — no unsafe casts.
 * Junk entries (non-objects) are dropped; missing fields get safe defaults.
 */
function parseStoredSprAttachments(value: unknown): StoredSprAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: StoredSprAttachment[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const strField = (v: unknown) => (typeof v === "string" ? v : "");
    const numField = (v: unknown) => {
      const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
      return Number.isFinite(n) ? n : undefined;
    };
    out.push({
      attachmentId: numField(entry.attachmentId),
      fileName: strField(entry.fileName),
      contentType: strField(entry.contentType),
      size: numField(entry.size) ?? 0,
      objectPath: strField(entry.objectPath),
      attachmentType: strField(entry.attachmentType),
    });
  }
  return out;
}

type RegisterRisk = {
  id: number;
  title: string;
  category: string;
  status: string;
  likelihood: string;
  impact: string | null;
  severity: string;
  riskLevel: string;
  dueDate: string | null;
  mitigationPlan: string | null;
  assignedToName: string | null;
};

type RiskUpdateDraft = {
  status: string;
  note: string;
  saving: boolean;
};

type StateSnapshot = {
  activeProjects: number;
  activeSectors: number;
  beneficiariesReached: number;
  activitiesCompleted: number;
  delayedActivities: number;
  openRisks: number;
  pendingApprovals: number;
};

type BasicValues = {
  stateId: number | "";
  title: string;
  frequency: Frequency;
  reportingMonth: number;
  reportingYear: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  onDemandReason: string;
  officerName: string;
  // Humanitarian context
  securitySituation: string;
  populationMovements: string;
  diseaseOutbreaks: string;
  accessConstraints: string;
  naturalHazards: string;
  marketSituation: string;
  otherDevelopments: string;
  // Narrative
  keyAchievements: string;
  mainChallenges: string;
  mitigationMeasures: string;
  nextPeriodPriorities: string;
  lessonsLearned: string;
  coordinationUpdates: string;
  communityFeedback: string;
};

const emptySpoActivity = (): SpoActivity => ({
  title: "", sector: "", locality: "", relatedProjectId: "",
  activityDate: "", status: "Ongoing", achievementSummary: "",
  beneficiariesMen: "", beneficiariesWomen: "", beneficiariesBoys: "", beneficiariesGirls: "",
});

const emptyHqRequest = (): HqSupportRequest => ({
  supportType: "", priority: "Medium", description: "",
});

const emptyRisk = (): RiskItem => ({
  category: "Programmatic", title: "", severity: "medium", description: "",
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function uploadVoiceNoteForReport(note: PendingNote, reportId: number) {
  const ext = note.mimeType.includes("ogg") ? "ogg" : note.mimeType.includes("mp4") ? "m4a" : "webm";
  const fileName = `voice-note-report-${reportId}-${Date.now()}.${ext}`;
  const { uploadURL, uploadToken } = await requestUploadUrl({
    name: fileName, size: note.blob.size, contentType: note.mimeType,
    reportId, entityType: "voice_note",
  });
  await fetch(uploadURL, { method: "PUT", body: note.blob, headers: { "Content-Type": note.mimeType } });
  await fetch("/api/voice-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entityType: "report", entityId: reportId, fileName, uploadToken, durationSeconds: note.durationSeconds }),
  });
  URL.revokeObjectURL(note.blobUrl);
}

// ── Sub-components ────────────────────────────────────────────────────────────

/**
 * ChipSelect — accessible multi-select with full keyboard support.
 *
 * Keyboard model (ARIA listbox pattern):
 *  - Tab lands on the trigger <button>.
 *  - Enter / Space / ArrowDown opens the listbox and moves focus to the first option.
 *  - Inside the listbox: ArrowDown/Up navigate; Enter/Space toggle selection.
 *  - Home/End jump to first/last option.
 *  - Escape closes the listbox and restores focus to the trigger.
 *  - Tab while listbox is open closes it and moves focus forward.
 *
 * Label is a <span> with a stable id; trigger carries aria-labelledby pointing
 * to that id — correct AT association without the htmlFor-on-non-labelable pitfall.
 * Selected chip remove actions are real <button> elements at the same DOM level
 * as the trigger (not nested inside it), so the HTML is valid.
 */
/**
 * ChipSelect — accessible multi-select.
 *
 * Rewritten to avoid Radix Checkbox inside options (which conflicts with
 * Radix Dialog's FocusScope and can trigger a "Maximum update depth exceeded"
 * crash). The visual tick is a plain SVG. The auto-focus-on-open effect is
 * removed to prevent FocusScope interference; keyboard users can press Tab or
 * ArrowDown after opening to navigate options.
 *
 * Keyboard model (ARIA listbox pattern):
 *  - Tab lands on the trigger <button>.
 *  - Enter / Space / ArrowDown opens the listbox.
 *  - Inside the listbox: ArrowDown/Up navigate; Enter/Space toggle.
 *  - Home/End jump to first/last. Escape closes. Tab closes.
 */
export function ChipSelect({
  label, placeholder, options, selected, onChange, required,
}: {
  label: string; placeholder: string; options: readonly string[];
  selected: string[]; onChange: (v: string[]) => void; required?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Stable mutable ref for option elements — never stored in state/deps
  const optionEls = useRef<HTMLButtonElement[]>([]);
  const labelId = useId();
  const listboxId = useId();

  // Close on outside click / touch
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]);

  const closeAndRestoreFocus = () => {
    setOpen(false);
    // Defer to let React flush the state update before moving focus
    setTimeout(() => { triggerRef.current?.focus(); }, 0);
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Accessible label via id — labelledby on trigger avoids htmlFor pitfall */}
      <span id={labelId} className="mb-1 block text-sm font-medium leading-none">
        {label}
        {required && <span aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
      </span>

      {/* Chip display + trigger row */}
      <div
        className="min-h-9 flex flex-wrap gap-1 items-center px-3 py-1.5 border rounded-md bg-background hover:bg-muted/30 transition-colors cursor-pointer"
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest("button")) setOpen((o) => !o);
        }}
      >
        {selected.length === 0 && (
          <span className="text-sm text-muted-foreground" aria-hidden="true">{placeholder}</span>
        )}

        {selected.map((s) => (
          <Badge key={s} variant="secondary" className="gap-1 pe-1">
            {s}
            <button
              type="button"
              aria-label={`Remove ${s}`}
              onClick={(e) => { e.stopPropagation(); toggle(s); }}
              className="ms-0.5 rounded-full hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary/25"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}

        <button
          ref={triggerRef}
          type="button"
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-controls={open ? listboxId : undefined}
          aria-labelledby={labelId}
          tabIndex={0}
          className="ms-auto focus:outline-none focus:ring-2 focus:ring-primary/25 rounded-sm p-0.5"
          onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setOpen(true);
              // Focus first option after open state is committed
              setTimeout(() => { optionEls.current[0]?.focus(); }, 0);
            }
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
        >
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          <span className="sr-only">{open ? "Close options" : "Open options"}</span>
        </button>
      </div>

      {/* Options listbox — rendered as a plain <ul>; options are <button> elements
          so they appear in the tab order within the dialog's FocusScope without
          triggering the Radix Dialog re-render loop that a useEffect focus() call
          would cause when nested in a Radix Dialog. */}
      {open && (
        <ul
          id={listboxId}
          role="listbox"
          aria-multiselectable="true"
          aria-labelledby={labelId}
          className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md list-none m-0 p-1"
        >
          {options.map((opt, idx) => {
            return (
              <li key={opt} role="option" aria-selected={selected.includes(opt)}>
                <button
                  type="button"
                  ref={(el) => { if (el) optionEls.current[idx] = el; }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-muted/50 cursor-pointer focus:outline-none focus:bg-muted/70 focus:ring-2 focus:ring-primary/25 text-start"
                  onClick={() => toggle(opt)}
                  onKeyDown={(e) => {
                    switch (e.key) {
                      case " ":
                      case "Enter":
                        e.preventDefault();
                        toggle(opt);
                        break;
                      case "ArrowDown":
                        e.preventDefault();
                        optionEls.current[Math.min(idx + 1, options.length - 1)]?.focus();
                        break;
                      case "ArrowUp":
                        e.preventDefault();
                        if (idx === 0) closeAndRestoreFocus();
                        else optionEls.current[idx - 1]?.focus();
                        break;
                      case "Home":
                        e.preventDefault();
                        optionEls.current[0]?.focus();
                        break;
                      case "End":
                        e.preventDefault();
                        optionEls.current[options.length - 1]?.focus();
                        break;
                      case "Escape":
                        e.preventDefault();
                        closeAndRestoreFocus();
                        break;
                      case "Tab":
                        setOpen(false);
                        break;
                    }
                  }}
                >
                  {/* Plain SVG tick — no Radix Checkbox to avoid FocusScope conflicts */}
                  <span
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0 flex items-center justify-center rounded-sm border border-input bg-background"
                  >
                    {selected.includes(opt) && (
                      <svg viewBox="0 0 10 10" className="h-3 w-3 text-primary fill-current" aria-hidden="true">
                        <path d="M1.5 5l2.5 2.5 5-5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </span>
                  {opt}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TagInput({
  label, placeholder, addMorePlaceholder, hint, tags, onChange, required,
}: {
  label: string; placeholder: string; addMorePlaceholder: string; hint: string; tags: string[];
  onChange: (t: string[]) => void; required?: boolean;
}) {
  const [inputVal, setInputVal] = useState("");
  const inputId = useId();
  const hintId = useId();
  const add = (raw: string) => {
    const parts = raw.split(",").map((s) => s.trim()).filter(Boolean);
    onChange([...new Set([...tags, ...parts])]);
    setInputVal("");
  };
  return (
    <div>
      <Label htmlFor={inputId} className="mb-1 block">{label}{required && " *"}</Label>
      <div className="flex flex-wrap gap-1 min-h-9 items-center px-3 py-1.5 border rounded-md bg-background">
        {tags.map((t) => (
          <Badge key={t} variant="secondary" className="gap-1 pe-1">
            {t}
            <button
              type="button"
              aria-label={`Remove ${t}`}
              onClick={() => onChange(tags.filter((x) => x !== t))}
              className="ms-0.5 rounded-full hover:bg-muted"
            >
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </Badge>
        ))}
        <input
          id={inputId}
          aria-describedby={hintId}
          className="flex-1 min-w-24 outline-none bg-transparent text-sm placeholder:text-muted-foreground"
          placeholder={tags.length === 0 ? placeholder : addMorePlaceholder}
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === "Enter" || e.key === ",") && inputVal.trim()) { e.preventDefault(); add(inputVal); }
            if (e.key === "Backspace" && !inputVal && tags.length > 0) onChange(tags.slice(0, -1));
          }}
          onBlur={() => { if (inputVal.trim()) add(inputVal); }}
        />
      </div>
      <p id={hintId} className="text-xs text-muted-foreground mt-0.5">{hint}</p>
    </div>
  );
}

function UploadArea({ documents, onUpload, onTypeChange, onRemove, attachFileLabel, attachFileHint }: {
  documents: Attachment[];
  onUpload: (file: File) => void;
  onTypeChange: (tempId: string, type: string) => void;
  onRemove: (tempId: string) => void;
  attachFileLabel: string;
  attachFileHint: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="h-3 w-3" aria-hidden="true" /> {attachFileLabel}
        </Button>
        <span className="text-xs text-muted-foreground">{attachFileHint}</span>
        <input ref={inputRef} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} multiple
          onChange={(e) => { Array.from(e.target.files ?? []).forEach(onUpload); e.target.value = ""; }} />
      </div>
      {documents.length > 0 && (
        <ul className="space-y-1">
          {documents.map((d) => (
            <li key={d.tempId} className="flex items-center gap-2 border rounded p-2 text-xs bg-muted/20">
              <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <span className="truncate flex-1" title={d.fileName}>{d.fileName}</span>
              {d.uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-hidden="true" />
              ) : (
                <>
                  <Select value={d.attachmentType} onValueChange={(val) => onTypeChange(d.tempId, val)}>
                    <SelectTrigger className="h-6 w-40 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ATTACHMENT_TYPES.map((t) => <SelectItem key={t} value={t} className="text-xs">{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <button
                    type="button"
                    aria-label={`Remove attachment ${d.fileName}`}
                    onClick={() => onRemove(d.tempId)}
                    className="text-muted-foreground hover:text-destructive flex-shrink-0"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StateSnapshotCards({ stateId }: { stateId: number }) {
  const { t } = useTranslation("reports");
  const { data, isLoading } = useQuery<StateSnapshot>({
    queryKey: ["state-snapshot", stateId],
    queryFn: async () => {
      const res = await fetch(`/api/states/${stateId}/snapshot`);
      if (!res.ok) throw new Error("Failed to load state snapshot");
      return res.json() as Promise<StateSnapshot>;
    },
    enabled: stateId > 0,
    staleTime: 60_000,
  });
  if (isLoading) return <div className="grid grid-cols-4 gap-2"><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /><Skeleton className="h-16" /></div>;
  if (!data) return null;
  const cards = [
    { label: t("stateForm.snapshotActiveProjects"), value: data.activeProjects, icon: TrendingUp, color: "text-blue-600" },
    { label: t("stateForm.snapshotSectorsActive"), value: data.activeSectors, icon: Activity, color: "text-purple-600" },
    { label: t("stateForm.snapshotBeneficiaries"), value: data.beneficiariesReached.toLocaleString(), icon: Users, color: "text-green-600" },
    { label: t("stateForm.snapshotActivitiesDone"), value: data.activitiesCompleted, icon: CheckCircle2, color: "text-emerald-600" },
    { label: t("stateForm.snapshotDelayed"), value: data.delayedActivities, icon: AlertCircle, color: "text-amber-600" },
    { label: t("stateForm.snapshotOpenRisks"), value: data.openRisks, icon: ShieldAlert, color: "text-red-600" },
    { label: t("stateForm.snapshotPendingReviews"), value: data.pendingApprovals, icon: Clock, color: "text-orange-600" },
  ];
  return (
    <div className="grid grid-cols-4 sm:grid-cols-7 gap-2">
      {cards.map((c) => (
        <div key={c.label} className="rounded border p-2 bg-muted/10 text-center">
          <c.icon className={`h-4 w-4 mx-auto mb-0.5 ${c.color}`} />
          <p className="text-lg font-bold">{c.value}</p>
          <p className="text-xs text-muted-foreground leading-tight">{c.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Main form ─────────────────────────────────────────────────────────────────

/** Report row shape from the list endpoint — used as the edit-mode data source. */
export type ExistingSprReport = NonNullable<ListReportsQueryResult>["items"][number];

// SPR-003/004 (Option A UX): SOM sees the create action; if an active SPO
// covers their state the backend rejects with program_state_spo_available.
// SPR-008: duplicate_report_period (race-condition 409) mapped to a friendly
// message. Pure module-level function so it is directly unit-testable.
export function friendlyCreateError(e: unknown, t?: (key: string) => string): string {
  const msg = (e as Error)?.message ?? String(e);
  if (msg.includes("program_state_spo_available")) {
    return t ? t("stateForm.errorSpoAssigned") : "A State Programme Officer is assigned to your state. SPR authoring is reserved for the SPO.";
  }
  if (msg.includes("state_required_for_super_admin_spr")) {
    return t ? t("stateForm.errorStateRequired") : "Please select a State — administrators must choose an explicit State for this report.";
  }
  if (msg.includes("duplicate_report_period")) {
    return t ? t("stateForm.errorDuplicatePeriod") : "A State Programme Report already exists for this State and reporting period. Please open the existing report or choose a different period.";
  }
  if (msg.includes("report_content_incomplete")) {
    return t
      ? t("stateForm.errorContentIncomplete")
      : "The report cannot be submitted because one or more required sections are incomplete. Please review all sections — including Humanitarian Context, Activities, and Narrative — and ensure all required fields are filled in before resubmitting.";
  }
  return msg;
}

/** Shape returned by GET /reports/duplicate-check. */
type SprDupCheckResult = {
  matchType: string;
  existingReport?: { id: number; title: string; period: string; status: string };
};

interface Props {
  onClose: () => void;
  /** When set, the form runs in edit mode: hydrates from this report, PATCHes
      the same report id (content only — identity fields locked), never POSTs. */
  existingReport?: ExistingSprReport;
  /** Called when the user chooses to continue editing an existing draft found
      by the duplicate check. The parent opens that draft in edit mode. */
  onOpenExistingDraft?: (id: number) => void;
}

export function ProgramStateReportForm({ onClose, existingReport, onOpenExistingDraft }: Props) {
  const { t, i18n } = useTranslation("reports");
  const qc = useQueryClient();
  const isEditMode = existingReport !== undefined;
  const createMutation = useCreateReport();
  const transitionMutation = useTransitionReport();
  const [patchPending, setPatchPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const { data: me } = useGetMe();
  const { data: statesData } = useListStates();
  // Stable empty array — avoids a new [] reference on every render when data is undefined,
  // which would make the auto-title useEffect re-fire on every render and cause an infinite loop.
  const states = useMemo(() => statesData ?? [], [statesData]);
  const { data: projectsData } = useListProjects();
  const projects = useMemo(() => projectsData ?? [], [projectsData]);
  const { isOnline } = useSyncContext();

  const now = new Date();
  const currentYear = now.getFullYear();
  const yearOptions = Array.from({ length: 2035 - (currentYear - 2) + 1 }, (_, i) => currentYear - 2 + i);

  const form = useForm<BasicValues>({
    defaultValues: {
      stateId: "",
      title: "",
      frequency: "monthly",
      reportingMonth: now.getMonth() + 1,
      reportingYear: currentYear,
      quarter: Math.ceil((now.getMonth() + 1) / 3),
      periodStart: "",
      periodEnd: "",
      onDemandReason: "",
      officerName: "",
      securitySituation: "",
      populationMovements: "",
      diseaseOutbreaks: "",
      accessConstraints: "",
      naturalHazards: "",
      marketSituation: "",
      otherDevelopments: "",
      keyAchievements: "",
      mainChallenges: "",
      mitigationMeasures: "",
      nextPeriodPriorities: "",
      lessonsLearned: "",
      coordinationUpdates: "",
      communityFeedback: "",
    },
  });
  const v = form.watch();

  // ── Auto-fill from user profile ─────────────────────────────────────────────
  const [stateFieldLocked, setStateFieldLocked] = useState(false);
  const [allowedStateIds, setAllowedStateIds] = useState<number[]>([]);
  const autoTitleRef = useRef("");

  useEffect(() => {
    if (!me?.user) return;
    if (isEditMode) return; // edit mode: everything comes from the existing report
    if (me.user.name && !form.getValues("officerName")) form.setValue("officerName", me.user.name);
    const userStateId = me.user.stateId;
    if (userStateId && (me.user.role === "state_program_officer" || me.user.role === "state_office_manager")) {
      form.setValue("stateId", userStateId);
      setStateFieldLocked(true);
      setAllowedStateIds([userStateId]);
    }
  }, [me, form, isEditMode]);

  // ── Auto-generate title ──────────────────────────────────────────────────────
  const computedPeriod = useMemo(() => {
    if (v.frequency === "quarterly") return `Q${v.quarter} ${v.reportingYear}`;
    if (v.frequency === "annual") return String(v.reportingYear);
    if (v.frequency === "on_demand") return v.periodStart || String(v.reportingYear);
    const mn = new Date(2000, v.reportingMonth - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" });
    return `${mn} ${v.reportingYear}`;
  }, [v.frequency, v.reportingMonth, v.reportingYear, v.quarter, v.periodStart, i18n.language]);

  // Memoised state name — only recomputes when stateId or statesData change.
  // Keeping this out of the auto-title effect deps avoids putting the full
  // `states` array in deps, which (when statesData is still undefined) would
  // produce a new [] reference on every render and cause an infinite render loop.
  const selectedStateName = useMemo(() => {
    const state = states.find((s) => s.id === Number(v.stateId));
    return state ? (i18n.language === "ar" ? state.nameAr ?? state.name : state.name) : "";
  }, [states, v.stateId, i18n.language]);

  useEffect(() => {
    if (isEditMode) return; // never overwrite a hydrated title
    const freqLabel = t(`frequency.${v.frequency}`);
    const auto = selectedStateName
      ? t("stateForm.autoTitle", { state: selectedStateName, frequency: freqLabel, period: computedPeriod })
      : t("stateForm.autoTitleWithoutState", { frequency: freqLabel, period: computedPeriod });
    const current = form.getValues("title");
    if (current === "" || current === autoTitleRef.current) {
      form.setValue("title", auto);
      autoTitleRef.current = auto;
    }
  }, [selectedStateName, v.frequency, computedPeriod, form, t, isEditMode]);

  // ── Duplicate check (SPR-008, debounced) ────────────────────────────────────
  // Fires only in create mode, for scheduled frequencies, once the report
  // identity (state + frequency + period) is complete. On-demand SPRs are
  // exempt (multiple allowed per DB). The backend clamps state-scoped users
  // to their own state; the DB partial unique indexes remain authoritative.
  const [dupCheck, setDupCheck] = useState<SprDupCheckResult | null>(null);
  useEffect(() => {
    if (isEditMode) return; // SPR-007: edit mode PATCHes the same id — never a duplicate
    const freq = v.frequency;
    if (freq === "on_demand") { setDupCheck(null); return; } // always allowed

    const stateIdForCheck = Number(v.stateId) || me?.user.stateId || 0;
    if (!stateIdForCheck) { setDupCheck(null); return; }

    // Period string convention shared with the backend branch:
    // monthly "YYYY-MM", quarterly "YYYY-Q{n}", annual "YYYY".
    let periodStr: string | null = null;
    if (freq === "monthly" && v.reportingMonth && v.reportingYear) {
      periodStr = `${v.reportingYear}-${String(v.reportingMonth).padStart(2, "0")}`;
    } else if (freq === "quarterly" && v.reportingYear && v.quarter) {
      periodStr = `${v.reportingYear}-Q${v.quarter}`;
    } else if (freq === "annual" && v.reportingYear) {
      periodStr = String(v.reportingYear);
    }
    if (!periodStr) { setDupCheck(null); return; } // identity incomplete

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          reportType: "program_state",
          stateId: String(stateIdForCheck),
          frequency: freq,
          period: periodStr,
        });
        const res = await fetch(`/api/reports/duplicate-check?${params}`, {
          signal: controller.signal,
        });
        if (res.ok) setDupCheck(await res.json() as SprDupCheckResult);
      } catch { /* silent on abort/network error */ }
    }, 400);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [isEditMode, v.frequency, v.stateId, v.reportingMonth, v.reportingYear, v.quarter, me?.user.stateId]);

  // ── Form extra state ────────────────────────────────────────────────────────
  const [selectedSectors, setSelectedSectors] = useState<string[]>([]);
  const [selectedProjectIds, setSelectedProjectIds] = useState<number[]>([]);
  const [localitiesCovered, setLocalitiesCovered] = useState<string[]>([]);
  const [activities, setActivities] = useState<SpoActivity[]>([emptySpoActivity()]);
  const [hqRequests, setHqRequests] = useState<HqSupportRequest[]>([emptyHqRequest()]);
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [createdReportId, setCreatedReportId] = useState<number | null>(null);
  const [pendingVoiceNote, setPendingVoiceNote] = useState<PendingNote | null>(null);
  const [registerRiskUpdates, setRegisterRiskUpdates] = useState<Record<number, RiskUpdateDraft>>({});

  // ── Edit-mode hydration (SPR-007) ───────────────────────────────────────────
  // Populate all form + local state from the existing report exactly once.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!existingReport || hydratedRef.current) return;
    hydratedRef.current = true;
    const r = existingReport as unknown as Record<string, unknown>;
    const sections = (r.sections ?? {}) as Record<string, unknown>;
    const humanCtx = (sections.humanitarianContext ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const kind = str(r.kind) || str(sections.frequency) || "monthly";
    const frequency: Frequency = (["monthly", "quarterly", "annual", "on_demand"] as const)
      .includes(kind as Frequency) ? (kind as Frequency) : "monthly";
    // Quarter: prefer sections.quarter, else parse "YYYY-Qn" period
    const periodStr = str(r.period);
    const parsedQuarter = /-Q([1-4])$/.exec(periodStr)?.[1];
    const dateOnly = (v: unknown) => { const s = str(v); return s.length > 10 ? s.slice(0, 10) : s; };

    form.reset({
      stateId: (r.stateId as number | null) ?? "",
      title: str(r.title),
      frequency,
      reportingMonth: (r.reportingMonth as number | null) ?? (new Date().getMonth() + 1),
      reportingYear: (r.reportingYear as number | null) ?? new Date().getFullYear(),
      quarter: sections.quarter != null ? Number(sections.quarter) : parsedQuarter ? Number(parsedQuarter) : 1,
      periodStart: dateOnly(r.periodStart),
      periodEnd: dateOnly(r.periodEnd),
      onDemandReason: str(sections.onDemandReason),
      officerName: str(sections.officerName),
      securitySituation: str(humanCtx.securitySituation),
      populationMovements: str(humanCtx.populationMovements),
      diseaseOutbreaks: str(humanCtx.diseaseOutbreaks),
      accessConstraints: str(humanCtx.accessConstraints),
      naturalHazards: str(humanCtx.naturalHazards),
      marketSituation: str(humanCtx.marketSituation),
      otherDevelopments: str(humanCtx.otherDevelopments),
      keyAchievements: str(sections.keyAchievements),
      mainChallenges: str(sections.mainChallenges),
      mitigationMeasures: str(sections.mitigationMeasures),
      nextPeriodPriorities: str(sections.nextPeriodPriorities),
      lessonsLearned: str(sections.lessonsLearned),
      coordinationUpdates: str(sections.coordinationUpdates),
      communityFeedback: str(sections.communityFeedback),
    });

    setSelectedSectors(Array.isArray(sections.sectors) ? (sections.sectors as string[]) : []);
    setLocalitiesCovered(Array.isArray(sections.localitiesCovered) ? (sections.localitiesCovered as string[]) : []);
    setSelectedProjectIds(
      Array.isArray(sections.relatedProjectIds)
        ? (sections.relatedProjectIds as unknown[]).map(Number).filter(Number.isFinite)
        : [],
    );
    const storedActivities = Array.isArray(r.activities) ? (r.activities as Array<Record<string, unknown>>) : [];
    if (storedActivities.length > 0) {
      setActivities(storedActivities.map((a): SpoActivity => ({
        title: str(a.title),
        sector: str(a.sector),
        locality: str(a.locality),
        relatedProjectId: a.relatedProjectId != null && a.relatedProjectId !== "" ? Number(a.relatedProjectId) : "",
        activityDate: dateOnly(a.activityDate),
        status: str(a.status) || "Ongoing",
        achievementSummary: str(a.achievementSummary),
        beneficiariesMen: a.beneficiariesMen != null ? Number(a.beneficiariesMen) : "",
        beneficiariesWomen: a.beneficiariesWomen != null ? Number(a.beneficiariesWomen) : "",
        beneficiariesBoys: a.beneficiariesBoys != null ? Number(a.beneficiariesBoys) : "",
        beneficiariesGirls: a.beneficiariesGirls != null ? Number(a.beneficiariesGirls) : "",
      })));
    }
    const storedHq = Array.isArray(sections.hqSupportRequests) ? (sections.hqSupportRequests as Array<Record<string, unknown>>) : [];
    if (storedHq.length > 0) {
      setHqRequests(storedHq.map((q) => ({
        supportType: str(q.supportType), priority: str(q.priority) || "Medium", description: str(q.description),
      })));
    }
    const storedRisks = Array.isArray(sections.risks) ? (sections.risks as Array<Record<string, unknown>>) : [];
    if (storedRisks.length > 0) {
      setRisks(storedRisks.map((k) => ({
        category: str(k.category) || "Programmatic", title: str(k.title),
        severity: str(k.severity) || "medium", description: str(k.description),
      })));
    }
    // Existing attachments: shown as already-uploaded (no re-upload), kept in the payload.
    // Hydrated from free-form JSONB via the canonical StoredSprAttachment schema —
    // no unsafe Record<string, unknown> casts (Task #522 TypeScript closure).
    const storedAttachments = parseStoredSprAttachments(sections.attachments);
    if (storedAttachments.length > 0) {
      setAttachments(storedAttachments.map((d, i): Attachment => ({
        tempId: `existing-${i}`,
        fileName: d.fileName,
        contentType: d.contentType,
        size: d.size,
        objectPath: d.objectPath,
        attachmentId: d.attachmentId,
        attachmentType: d.attachmentType || "Other Supporting Documents",
      })));
    }
  }, [existingReport, form]);

  const localSnapshot = useMemo(() => ({
    values: v,
    selectedSectors,
    selectedProjectIds,
    localitiesCovered,
    activities,
    hqRequests,
    risks,
    // Persist only metadata for attachments already uploaded to the server.
    attachments: attachments.filter((attachment) => !attachment.uploading && !attachment.file),
    registerRiskUpdates,
  }), [
    activities, attachments, hqRequests, localitiesCovered, registerRiskUpdates,
    risks, selectedProjectIds, selectedSectors, v,
  ]);
  const restoreLocalSnapshot = useCallback((snapshot: typeof localSnapshot) => {
    const permittedStates = new Set(
      allowedStateIds.length > 0 ? allowedStateIds : states.map((state) => state.id),
    );
    const permittedProjects = new Set(projects.map((project) => project.id));
    const restoredStateId = snapshot.values.stateId;
    form.reset({
      ...snapshot.values,
      stateId: restoredStateId && permittedStates.has(Number(restoredStateId)) ? restoredStateId : "",
    });
    setSelectedSectors(snapshot.selectedSectors ?? []);
    setSelectedProjectIds((snapshot.selectedProjectIds ?? []).filter((id) => permittedProjects.has(id)));
    setLocalitiesCovered(snapshot.localitiesCovered ?? []);
    setActivities(snapshot.activities?.length
      ? snapshot.activities.map((activity) => ({
          ...activity,
          relatedProjectId: activity.relatedProjectId !== "" && !permittedProjects.has(Number(activity.relatedProjectId))
            ? ""
            : activity.relatedProjectId,
        }))
      : [emptySpoActivity()]);
    setHqRequests(snapshot.hqRequests?.length ? snapshot.hqRequests : [emptyHqRequest()]);
    setRisks(snapshot.risks ?? []);
    setAttachments(snapshot.attachments ?? []);
    setRegisterRiskUpdates(snapshot.registerRiskUpdates ?? {});
  }, [allowedStateIds, form, projects, states]);
  const existingRevisionValue = (existingReport as unknown as { updatedAt?: unknown } | undefined)?.updatedAt;
  const existingBaseRevision = existingRevisionValue instanceof Date
    ? existingRevisionValue.toISOString()
    : typeof existingRevisionValue === "string" ? existingRevisionValue : null;
  const localDraft = useOfflineReportDraft({
    draftKey: reportDraftKey("program_state", existingReport ? `server:${existingReport.id}` : "new"),
    reportType: "program_state",
    serverReportId: existingReport?.id ?? null,
    baseRevision: existingBaseRevision,
    title: v.title,
    snapshot: localSnapshot,
    onRestore: restoreLocalSnapshot,
    enabled: statesData !== undefined && projectsData !== undefined && Boolean(me?.user),
  });

  // Auto-load existing state risks from the central register
  const { data: registerRisksResponse, isLoading: registerRisksLoading, refetch: refetchRegisterRisks } = useQuery<RegisterRisk[] | { items?: RegisterRisk[] }>({
    queryKey: ["state-register-risks", v.stateId],
    queryFn: async () => {
      if (!v.stateId) return [];
      const res = await fetch(`/api/risks?stateId=${v.stateId}&status=open&status=under_mitigation`);
      if (!res.ok) return [];
      return res.json() as Promise<RegisterRisk[] | { items?: RegisterRisk[] }>;
    },
    enabled: !!v.stateId,
    staleTime: 30_000,
  });
  // The risk list endpoint has returned both a bare list and a paginated
  // envelope across deployments. Normalise at the boundary so the report
  // editor remains usable while offline-cached or upgraded API responses vary.
  const registerRisks = Array.isArray(registerRisksResponse)
    ? registerRisksResponse
    : registerRisksResponse?.items ?? [];

  async function saveRegisterRiskUpdate(riskId: number) {
    const update = registerRiskUpdates[riskId];
    if (!update) return;
    setRegisterRiskUpdates((prev) => ({ ...prev, [riskId]: { ...update, saving: true } }));
    try {
      const body: Record<string, string> = {};
      if (update.status) body.status = update.status;
      if (update.note.trim()) body.mitigationPlan = update.note.trim();
      const res = await fetch(`/api/risks/${riskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to update risk");
      toast.success(t("stateForm.riskUpdated"));
      setRegisterRiskUpdates((prev) => {
        const next = { ...prev };
        delete next[riskId];
        return next;
      });
      await refetchRegisterRisks();
    } catch (e) {
      toast.error(t("stateForm.riskUpdateFailed", { error: String(e) }));
      setRegisterRiskUpdates((prev) => ({ ...prev, [riskId]: { ...update, saving: false } }));
    }
  }

  function updateActivity(i: number, patch: Partial<SpoActivity>) {
    setActivities((cur) => cur.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }
  function updateHqRequest(i: number, patch: Partial<HqSupportRequest>) {
    setHqRequests((cur) => cur.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }
  function updateRisk(i: number, patch: Partial<RiskItem>) {
    setRisks((cur) => cur.map((row, idx) => idx === i ? { ...row, ...patch } : row));
  }

  // ── Files remain local until the report is created, then use report attachments. ──
  async function uploadFile(file: File) {
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const placeholder: Attachment = {
      tempId, fileName: file.name, contentType: file.type || "application/octet-stream",
      size: file.size, objectPath: "", attachmentType: "Other Supporting Documents", file,
    };
    setAttachments((d) => [...d, placeholder]);
  }

  async function registerPendingAttachments(reportId: number) {
    const pending = attachments.filter((attachment) => attachment.file);
    for (const attachment of pending) {
      const file = attachment.file!;
      const descriptor = await fetch("/api/storage/uploads/request-url", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream", reportId, entityType: "attachment" }),
      });
      if (!descriptor.ok) throw new Error(t("stateForm.uploadFailed", { error: "Could not prepare upload." }));
      const { uploadURL, uploadToken } = await descriptor.json() as { uploadURL: string; uploadToken: string };
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error(t("stateForm.uploadFailed", { error: "The file could not be uploaded." }));
      const registered = await fetch(`/api/reports/${reportId}/attachments`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, uploadToken, attachmentType: attachment.attachmentType }),
      });
      if (!registered.ok) throw new Error(t("stateForm.uploadFailed", { error: "The file could not be finalised." }));
      const saved = await registered.json() as { id: number; fileName: string; contentType: string; size: number };
      // Commit each successful registration immediately. If a later file fails,
      // retry only uploads that still retain their browser-local File.
      setAttachments((current) => current.map((item) => item.tempId === attachment.tempId ? {
        ...item,
        attachmentId: saved.id,
        fileName: saved.fileName,
        contentType: saved.contentType,
        size: saved.size,
        file: undefined,
      } : item));
    }
  }

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const totalBen = activities.reduce((s, a) =>
    s + Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0), 0);
  const totalBenByGender = {
    men: activities.reduce((s, a) => s + Number(a.beneficiariesMen || 0), 0),
    women: activities.reduce((s, a) => s + Number(a.beneficiariesWomen || 0), 0),
    boys: activities.reduce((s, a) => s + Number(a.beneficiariesBoys || 0), 0),
    girls: activities.reduce((s, a) => s + Number(a.beneficiariesGirls || 0), 0),
  };

  // ── Shared submit-readiness validation (SPR-007 client mirror) ──────────────
  // Used by BOTH the create-and-submit path (via buildPayload) and the resubmit
  // path (onSubmitReport's edit-mode branch, which otherwise only calls
  // buildPatchPayload — a deliberately validation-free content-only PATCH —
  // before invoking the submit transition). Previously only the create path
  // validated client-side; a resubmission could reach the server with blank
  // required fields, discovered only by the server's 422 instead of an
  // immediate, specific error.
  /** onError: optional callback invoked with the validation message so callers
   *  can surface an accessible error summary in addition to the toast. */
  function validateSubmitReadiness(values: BasicValues, onError?: (msg: string) => void): boolean {
    function fail(msg: string) { toast.error(msg); onError?.(msg); return false; }

    if (!values.stateId) return fail(t("stateForm.validationSelectState"));
    if (!values.title.trim()) return fail(t("stateForm.validationEnterTitle"));
    if (values.frequency === "on_demand") {
      if (!values.periodStart) return fail(t("stateForm.validationPeriodStart"));
      if (!values.periodEnd) return fail(t("stateForm.validationPeriodEnd"));
      if (!values.onDemandReason) return fail(t("stateForm.validationOnDemandReason"));
    }
    if (selectedSectors.length === 0) return fail(t("stateForm.validationSelectSector"));
    if (localitiesCovered.length === 0) return fail(t("stateForm.validationAddLocality"));

    // Humanitarian context — required fields
    if (!values.securitySituation.trim()) return fail(t("stateForm.validationSecuritySituation"));
    if (!values.populationMovements.trim()) return fail(t("stateForm.validationPopulationMovements"));
    if (!values.diseaseOutbreaks.trim()) return fail(t("stateForm.validationDiseaseOutbreaks"));
    if (!values.accessConstraints.trim()) return fail(t("stateForm.validationAccessConstraints"));

    // Activities
    const cleanActivities = activities.filter((a) => a.title.trim());
    if (cleanActivities.length === 0) return fail(t("stateForm.validationAddActivity"));
    for (let i = 0; i < cleanActivities.length; i++) {
      const a = cleanActivities[i];
      const lbl = t("stateForm.activityLabel", { number: i + 1 });
      if (!a.sector) return fail(t("stateForm.validationActivitySector", { label: lbl }));
      if (!a.activityDate) return fail(t("stateForm.validationActivityDate", { label: lbl }));
      if (!a.achievementSummary.trim()) return fail(t("stateForm.validationActivityAchievement", { label: lbl }));
      const ben = Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0);
      if (ben === 0) return fail(t("stateForm.validationActivityBeneficiaries", { label: lbl }));
    }

    // Narrative
    if (!values.keyAchievements.trim()) return fail(t("stateForm.validationKeyAchievements"));
    if (!values.mainChallenges.trim()) return fail(t("stateForm.validationMainChallenges"));
    if (!values.mitigationMeasures.trim()) return fail(t("stateForm.validationMitigationMeasures"));
    if (!values.nextPeriodPriorities.trim()) return fail(t("stateForm.validationNextPeriodPriorities"));

    return true;
  }

  // ── Payload builder ─────────────────────────────────────────────────────────
  /** onError: optional callback invoked with the validation message so callers
   *  can surface an accessible error summary in addition to the toast. */
  function buildPayload(values: BasicValues, onError?: (msg: string) => void) {
    if (!validateSubmitReadiness(values, onError)) return null;

    // Activities
    const cleanActivities = activities.filter((a) => a.title.trim());

    // HQ Support
    const cleanHqRequests = hqRequests.filter((r) => r.supportType && r.description.trim());

    // Risks
    const cleanRisks = risks.filter((r) => r.title.trim());

    const mappedActivities = cleanActivities.map((a) => ({
      ...a,
      beneficiariesMen: Number(a.beneficiariesMen || 0),
      beneficiariesWomen: Number(a.beneficiariesWomen || 0),
      beneficiariesBoys: Number(a.beneficiariesBoys || 0),
      beneficiariesGirls: Number(a.beneficiariesGirls || 0),
      beneficiariesTotal: Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0),
      relatedProjectId: a.relatedProjectId === "" ? null : Number(a.relatedProjectId),
    }));

    const cleanAttachments = sanitizeReportAttachments(attachments);

    // Compute period
    let reportingMonthVal: number | undefined;
    if (values.frequency !== "quarterly" && values.frequency !== "annual" && values.frequency !== "on_demand") {
      reportingMonthVal = Number(values.reportingMonth);
    }
    const period = buildReportPeriodLabel(
      {
        frequency: values.frequency,
        reportingYear: values.reportingYear,
        quarter: values.quarter,
        reportingMonth: values.reportingMonth,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
      },
      "start-only",
    );

    const sections = {
      frequency: values.frequency,
      quarter: values.frequency === "quarterly" ? values.quarter : undefined,
      onDemandReason: values.frequency === "on_demand" ? values.onDemandReason : undefined,
      sectors: selectedSectors,
      relatedProjectIds: selectedProjectIds,
      localitiesCovered,
      officerName: values.officerName.trim() || undefined,
      // Humanitarian context
      humanitarianContext: {
        securitySituation: values.securitySituation,
        populationMovements: values.populationMovements,
        diseaseOutbreaks: values.diseaseOutbreaks,
        accessConstraints: values.accessConstraints,
        naturalHazards: values.naturalHazards.trim() || undefined,
        marketSituation: values.marketSituation.trim() || undefined,
        otherDevelopments: values.otherDevelopments.trim() || undefined,
      },
      // Narrative
      keyAchievements: values.keyAchievements,
      mainChallenges: values.mainChallenges,
      mitigationMeasures: values.mitigationMeasures,
      nextPeriodPriorities: values.nextPeriodPriorities,
      lessonsLearned: values.lessonsLearned.trim() || undefined,
      coordinationUpdates: values.coordinationUpdates.trim() || undefined,
      communityFeedback: values.communityFeedback.trim() || undefined,
      // Structured sections
      hqSupportRequests: cleanHqRequests.length > 0 ? cleanHqRequests : undefined,
      risks: cleanRisks.length > 0 ? cleanRisks : undefined,
      attachments: cleanAttachments.length > 0 ? cleanAttachments : undefined,
    };

    return {
      title: values.title,
      kind: values.frequency,
      reportType: "program_state",
      reportingMonth: reportingMonthVal,
      reportingYear: Number(values.reportingYear),
      periodStart: values.frequency === "on_demand" ? values.periodStart : undefined,
      periodEnd: values.frequency === "on_demand" ? values.periodEnd : undefined,
      stateId: Number(values.stateId),
      sector: selectedSectors[0] ?? "",
      projectId: selectedProjectIds[0] ?? null,
      period,
      sections,
      activities: mappedActivities,
      beneficiariesMale: totalBenByGender.men,
      beneficiariesFemale: totalBenByGender.women,
      beneficiariesBoys: totalBenByGender.boys,
      beneficiariesGirls: totalBenByGender.girls,
    };
  }

  // ── Content-only PATCH payload (SPR-007) ────────────────────────────────────
  // Built directly from current form values and local state — NOT via buildPayload.
  // Reasons:
  //   1. Draft saves should not hard-validate like submits do; the server-side
  //      SPR-001 gate applies on the submit transition, not on every PATCH.
  //   2. Identity fields (kind/reportType/stateId/period/reportingMonth/Year/
  //      periodStart/periodEnd) are immutable server-side (SPR-002) and MUST be
  //      absent from the body — a present key is rejected with 409.
  function buildPatchPayload(values: BasicValues) {
    const mappedActivities = activities
      .filter((a) => a.title.trim())
      .map((a) => ({
        ...a,
        beneficiariesMen: Number(a.beneficiariesMen || 0),
        beneficiariesWomen: Number(a.beneficiariesWomen || 0),
        beneficiariesBoys: Number(a.beneficiariesBoys || 0),
        beneficiariesGirls: Number(a.beneficiariesGirls || 0),
        beneficiariesTotal:
          Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) +
          Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0),
        relatedProjectId: a.relatedProjectId === "" ? null : Number(a.relatedProjectId),
      }));
    const cleanAttachments = sanitizeReportAttachments(attachments);
    const cleanHqRequests = hqRequests.filter((r) => r.supportType && r.description.trim());
    const cleanRisks = risks.filter((r) => r.title.trim());

    const sections = {
      frequency: values.frequency,
      quarter: values.frequency === "quarterly" ? values.quarter : undefined,
      onDemandReason: values.frequency === "on_demand" ? values.onDemandReason : undefined,
      sectors: selectedSectors,
      relatedProjectIds: selectedProjectIds,
      localitiesCovered,
      officerName: values.officerName.trim() || undefined,
      humanitarianContext: {
        securitySituation: values.securitySituation,
        populationMovements: values.populationMovements,
        diseaseOutbreaks: values.diseaseOutbreaks,
        accessConstraints: values.accessConstraints,
        naturalHazards: values.naturalHazards.trim() || undefined,
        marketSituation: values.marketSituation.trim() || undefined,
        otherDevelopments: values.otherDevelopments.trim() || undefined,
      },
      keyAchievements: values.keyAchievements,
      mainChallenges: values.mainChallenges,
      mitigationMeasures: values.mitigationMeasures,
      nextPeriodPriorities: values.nextPeriodPriorities,
      lessonsLearned: values.lessonsLearned.trim() || undefined,
      coordinationUpdates: values.coordinationUpdates.trim() || undefined,
      communityFeedback: values.communityFeedback.trim() || undefined,
      hqSupportRequests: cleanHqRequests.length > 0 ? cleanHqRequests : undefined,
      risks: cleanRisks.length > 0 ? cleanRisks : undefined,
      attachments: cleanAttachments.length > 0 ? cleanAttachments : undefined,
    };

    return {
      title: values.title,
      sector: selectedSectors[0] ?? "",
      projectId: selectedProjectIds[0] ?? null,
      sections,
      activities: mappedActivities,
      beneficiariesMale: mappedActivities.reduce((s, a) => s + a.beneficiariesMen, 0),
      beneficiariesFemale: mappedActivities.reduce((s, a) => s + a.beneficiariesWomen, 0),
      beneficiariesBoys: mappedActivities.reduce((s, a) => s + a.beneficiariesBoys, 0),
      beneficiariesGirls: mappedActivities.reduce((s, a) => s + a.beneficiariesGirls, 0),
    };
  }

  async function patchExistingReport(values: BasicValues, syncOperationId?: string | null): Promise<boolean> {
    const patch = buildPatchPayload(values);
    const reportId = existingReport?.id ?? createdReportId;
    if (!patch || !reportId) return false;
    const res = await fetch(`/api/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(existingBaseRevision ? { "x-base-revision": existingBaseRevision } : {}),
      },
      credentials: "include",
      body: JSON.stringify({ ...patch, _draftKey: localDraft.storageKey, _syncOperationId: syncOperationId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? "Failed to save changes");
    }
    return true;
  }

  const isSaving = createMutation.isPending || transitionMutation.isPending || patchPending;
  const hasNoAttachments = attachments.filter(
    (attachment) => !attachment.uploading && (attachment.file || attachment.objectPath || attachment.attachmentId),
  ).length === 0;

  /** Surfaces a validation error in the accessible error summary region and
   *  moves focus to it so keyboard and screen-reader users are informed. */
  function raiseFormError(msg: string) {
    setFormError(msg);
    // Defer focus so the DOM update completes before we try to focus.
    setTimeout(() => errorSummaryRef.current?.focus(), 0);
  }

  const onSaveDraft = form.handleSubmit(async (values) => {
    if (!isOnline && attachments.some((attachment) => attachment.file)) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    if (localDraft.status === "pending" || localDraft.status === "syncing") {
      toast.info(t("sync.draftAlreadyPending", { ns: "common" }));
      return;
    }
    const offlineOperationId = !isOnline ? crypto.randomUUID() : null;
    // Persist before queueing so an immediate offline save never relies on the
    // debounced writer for its only recoverable snapshot.
    if (offlineOperationId) await localDraft.saveNow();
    try {
      let reportId: number;
      if ((isEditMode && existingReport) || createdReportId) {
        // SPR-007: PATCH the same report id — never POST a duplicate.
        setPatchPending(true);
        try {
          if (!(await patchExistingReport(values, offlineOperationId))) return;
        } finally { setPatchPending(false); }
        reportId = existingReport?.id ?? createdReportId!;
        setFormError(null);
        toast.success(t("updateSuccess"));
      } else {
        const payload = buildPayload(values, raiseFormError);
        if (!payload) { if (offlineOperationId) await localDraft.saveNow(); return; }
        const created = await createMutation.mutateAsync({ data: { ...payload, _draftKey: localDraft.storageKey, _syncOperationId: offlineOperationId } as never });
        reportId = created.id;
        setCreatedReportId(created.id);
        setFormError(null);
        toast.success(t("stateForm.savedAsDraft"));
      }
      await registerPendingAttachments(reportId);
      if (pendingVoiceNote) {
        try { await uploadVoiceNoteForReport(pendingVoiceNote, reportId); }
        catch { toast.warning(t("stateForm.voiceNoteDraftWarning")); }
      }
      qc.invalidateQueries();
      await localDraft.remove();
      onClose();
    } catch (e: unknown) {
      if (isOfflineQueuedError(e)) {
        toast.info(t("sync.draftQueuedOnDevice", { ns: "common" }));
        onClose();
        return;
      }
      if (offlineOperationId) await localDraft.saveNow();
      const msg = friendlyCreateError(e, t);
      toast.error(msg);
      raiseFormError(msg);
    }
  });

  const onSubmitReport = form.handleSubmit(async (values) => {
    if (!isOnline) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    if (hasNoAttachments) {
      if (!window.confirm(t("stateForm.noAttachmentsConfirm"))) return;
    }
    try {
      let reportId: number;
      if ((isEditMode && existingReport) || createdReportId) {
        // Resubmission — validate BEFORE patching. buildPatchPayload deliberately
        // performs no field validation (it also serves plain content-save PATCHes
        // that must not hard-validate like a submit does), so this is the only
        // client-side gate a resubmission gets before hitting the server's 422.
        if (!validateSubmitReadiness(values, raiseFormError)) return;
        // SPR-007: PATCH latest content first; if it fails, do NOT transition.
        setPatchPending(true);
        try {
          if (!(await patchExistingReport(values))) return;
        } finally { setPatchPending(false); }
        reportId = existingReport?.id ?? createdReportId!;
      } else {
        const payload = buildPayload(values, raiseFormError);
        if (!payload) return;
        const created = await createMutation.mutateAsync({ data: { ...payload, _draftKey: localDraft.storageKey } as never });
        reportId = created.id;
        setCreatedReportId(created.id);
      }
      await registerPendingAttachments(reportId);
      if (pendingVoiceNote) {
        try { await uploadVoiceNoteForReport(pendingVoiceNote, reportId); }
        catch { toast.warning(t("stateForm.voiceNoteSubmitWarning")); }
      }
      await transitionMutation.mutateAsync({
        reportId,
        data: { action: "submit", comment: isEditMode ? "Resubmission" : "Initial submission" },
      });
      setFormError(null);
      toast.success(t("stateForm.submittedForReview"));
      qc.invalidateQueries();
      await localDraft.remove();
      onClose();
    } catch (e: unknown) {
      const msg = friendlyCreateError(e, t);
      toast.error(msg);
      raiseFormError(msg);
    }
  });

  // ── Project chips helpers ───────────────────────────────────────────────────
  const toggleProject = (id: number) =>
    setSelectedProjectIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  const [projectDropdownOpen, setProjectDropdownOpen] = useState(false);
  const projectDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function h(e: MouseEvent) {
      if (projectDropdownRef.current && !projectDropdownRef.current.contains(e.target as Node)) setProjectDropdownOpen(false);
    }
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const selectedStateId = Number(v.stateId) || 0;

  // ── Render ─────────────────────────────────────────────────────────────────
  const isReturnedForRevision =
    isEditMode &&
    existingReport?.status === "draft" &&
    (existingReport.approvalHistory ?? []).some((h) => String(h.action ?? "").includes("revision"));

  return (
    <form className="space-y-6">
      <div className="border-b pb-3">
        <h3 className="text-lg font-semibold" id="spr-form-heading">
          {isEditMode
            ? (isReturnedForRevision ? t("stateForm.titleRevise") : t("stateForm.titleEdit"))
            : t("stateForm.heading")}
        </h3>
        <p className="text-sm text-muted-foreground">{t("stateForm.headingDesc")}</p>
        {localDraft.hasLocalDraft && (
          <OfflineReportDraftStatus
            status={localDraft.status}
            savedAt={localDraft.stored?.lastSavedAt}
            error={localDraft.stored?.lastError}
            onDiscard={() => { void localDraft.remove(); onClose(); }}
            className="mt-2"
            isStale={localDraft.isStale}
          />
        )}
        {!isOnline && (
          <p id="spr-offline-workflow-notice" role="alert" className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
            <span className="font-medium">{t("sync.internetRequired", { ns: "common" })}.</span>{" "}
            {t("sync.internetRequiredDescription", { ns: "common" })}
          </p>
        )}
      </div>

      {/* ── Accessible error summary region ─────────────────────────────── */}
      {/* Shown after a validation failure so keyboard/screen-reader users
          land on a clear, focused description of what went wrong.           */}
      {formError && (
        <div
          ref={errorSummaryRef}
          role="alert"
          aria-live="assertive"
          tabIndex={-1}
          className="rounded border border-destructive bg-destructive/10 p-3 text-sm text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
        >
          <p className="font-medium mb-1">{t("stateForm.correctErrorsBeforeContinuing")}</p>
          <p>{formError}</p>
        </div>
      )}

      {/* Returned-for-revision banner (SPR-007): a draft with prior approval
          history was sent back by a reviewer. */}
      {isReturnedForRevision && (
        <>
          <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-700">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p><strong>{t("stateForm.revisionBannerTitle")}</strong> {t("stateForm.revisionBannerBody")}</p>
          </div>
          {/* SPR-010: surface the reviewer's section-tagged feedback (same
              authoritative comment stream — same reportId survives revision). */}
          <CommentsPanel
            entityType="report"
            entityId={existingReport.id}
            sections={[...SPR_SECTION_KEYS]}
            sectionLabels={SPR_SECTION_LABELS}
            readOnly={!hasPerm(me?.permissions ?? [], "comments.create")}
            currentUserId={me?.user?.id ?? null}
            currentUserRole={me?.user?.role ?? null}
          />
        </>
      )}

      {/* ── SECTION 1: REPORT INFORMATION ────────────────────────────────── */}
      <section id="rp-section-basic" aria-labelledby="spr-section1-heading" className="space-y-3">
        <h4 id="spr-section1-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section1Title")}</h4>
        <div className="grid grid-cols-2 gap-3">

          {/* State */}
          <div>
            <Label className="flex items-center gap-1">
              {t("stateForm.stateLabel")}
              {(stateFieldLocked || isEditMode) && (
                <Lock className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
              )}
              {stateFieldLocked && <span className="text-xs font-normal text-muted-foreground">{t("stateForm.stateFromProfile")}</span>}
              {isEditMode && !stateFieldLocked && <span className="text-xs font-normal text-muted-foreground">{t("stateForm.locked")}</span>}
            </Label>
            {(stateFieldLocked || isEditMode) ? (
              <Input readOnly aria-readonly="true" value={states.find((s) => s.id === Number(v.stateId))?.name ?? ""} className="bg-muted cursor-not-allowed" />
            ) : (
              <Select value={String(v.stateId || "")} onValueChange={(val) => form.setValue("stateId", Number(val))}>
                <SelectTrigger><SelectValue placeholder={t("stateForm.statePlaceholder")} /></SelectTrigger>
                <SelectContent>
                  {(allowedStateIds.length > 0 ? states.filter((s) => allowedStateIds.includes(s.id)) : states)
                    .map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>

          {/* Officer */}
          <div>
            <Label>{t("stateForm.officerLabel")}</Label>
            <Input {...form.register("officerName")} placeholder={t("stateForm.officerPlaceholder")} />
          </div>

          {/* Frequency */}
          <div className="col-span-2">
            <Label>{t("stateForm.frequencyLabel")}{isEditMode && <span className="ms-1 text-xs font-normal text-muted-foreground">{t("stateForm.locked")}</span>}</Label>
            <Select value={v.frequency} disabled={isEditMode} onValueChange={(val) => form.setValue("frequency", val as Frequency)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">{t("frequency.monthly")}</SelectItem>
                <SelectItem value="quarterly">{t("frequency.quarterly")}</SelectItem>
                <SelectItem value="annual">{t("frequency.annual")}</SelectItem>
                <SelectItem value="on_demand">{t("stateForm.onDemand")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Dynamic period */}
          {v.frequency === "monthly" && (
            <>
              <div>
                <Label>{t("stateForm.monthLabel")}</Label>
                <Select value={String(v.reportingMonth)} disabled={isEditMode} onValueChange={(val) => form.setValue("reportingMonth", Number(val))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                      <SelectItem key={m} value={String(m)}>{new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("stateForm.yearLabel")}</Label>
                <Select value={String(v.reportingYear)} disabled={isEditMode} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          {v.frequency === "quarterly" && (
            <>
              <div>
                <Label>{t("stateForm.quarterLabel")}</Label>
                <Select value={String(v.quarter)} disabled={isEditMode} onValueChange={(val) => form.setValue("quarter", Number(val))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{[1,2,3,4].map((q) => <SelectItem key={q} value={String(q)}>Q{q}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>{t("stateForm.yearLabel")}</Label>
                <Select value={String(v.reportingYear)} disabled={isEditMode} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </>
          )}
          {v.frequency === "annual" && (
            <div className="col-span-2">
              <Label>{t("stateForm.yearLabel")}</Label>
              <Select value={String(v.reportingYear)} disabled={isEditMode} onValueChange={(val) => form.setValue("reportingYear", Number(val))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {v.frequency === "on_demand" && (
            <>
              <div>
                <Label>{t("stateForm.startDateLabel")}</Label>
                <Input type="date" readOnly={isEditMode} aria-readonly={isEditMode || undefined} className={isEditMode ? "bg-muted cursor-not-allowed" : undefined} {...form.register("periodStart")} />
              </div>
              <div>
                <Label>{t("stateForm.endDateLabel")}</Label>
                <Input type="date" readOnly={isEditMode} aria-readonly={isEditMode || undefined} className={isEditMode ? "bg-muted cursor-not-allowed" : undefined} {...form.register("periodEnd")} />
              </div>
              <div className="col-span-2">
                <Label>{t("stateForm.reasonLabel")}</Label>
                <Select value={v.onDemandReason} disabled={isEditMode} onValueChange={(val) => form.setValue("onDemandReason", val)}>
                  <SelectTrigger><SelectValue placeholder={t("stateForm.reasonPlaceholder")} /></SelectTrigger>
                  <SelectContent>
                    {ON_DEMAND_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Title */}
          <div className="col-span-2">
            <Label>{t("stateForm.reportTitleLabel")}</Label>
            <Input
              {...form.register("title")}
              placeholder={t("stateForm.reportTitlePlaceholder")}
              onFocus={() => { autoTitleRef.current = ""; }}
            />
          </div>
        </div>

        {/* ── Duplicate warning (SPR-008) ── */}
        {!isEditMode && dupCheck?.matchType === "exact" && dupCheck.existingReport && (
          <div
            role="alert"
            aria-live="polite"
            className="rounded-md border border-amber-400/60 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm space-y-2"
          >
            <p className="font-medium flex items-center gap-2 text-amber-800 dark:text-amber-300">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              {t("stateForm.duplicateDetected")}
            </p>
            <p>
              {t("stateForm.duplicateDescription", {
                period: dupCheck.existingReport.period,
                status: t(`status.${dupCheck.existingReport.status}`),
              })}
            </p>
            {dupCheck.existingReport.status === "draft" && onOpenExistingDraft && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => onOpenExistingDraft(dupCheck.existingReport!.id)}
              >
                {t("stateForm.continueEditingDraft")}
              </Button>
            )}
            <p className="text-xs text-muted-foreground">
              {t("stateForm.duplicateAvoidance")}
            </p>
          </div>
        )}
      </section>

      {/* ── SECTION 2: STATE PERFORMANCE SNAPSHOT ────────────────────────── */}
      {selectedStateId > 0 && (
        <section id="rp-section-progress" aria-labelledby="spr-section2-heading" className="space-y-3">
          <h4 id="spr-section2-heading" className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" aria-hidden="true" /> {t("stateForm.section2Title")}
            <span className="text-xs font-normal text-muted-foreground">{t("stateForm.section2Hint")}</span>
          </h4>
          <StateSnapshotCards stateId={selectedStateId} />
        </section>
      )}

      {/* ── SECTION 3: HUMANITARIAN CONTEXT UPDATE ───────────────────────── */}
      <section aria-labelledby="spr-section3-heading" className="space-y-3">
        <h4 id="spr-section3-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section3Title")}</h4>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label>{t("stateForm.securitySituationLabel")}</Label>
            <Textarea rows={2} {...form.register("securitySituation")} placeholder={t("stateForm.securitySituationPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.populationMovementsLabel")}</Label>
            <Textarea rows={2} {...form.register("populationMovements")} placeholder={t("stateForm.populationMovementsPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.diseaseOutbreaksLabel")}</Label>
            <Textarea rows={2} {...form.register("diseaseOutbreaks")} placeholder={t("stateForm.diseaseOutbreaksPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.accessConstraintsLabel")}</Label>
            <Textarea rows={2} {...form.register("accessConstraints")} placeholder={t("stateForm.accessConstraintsPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.naturalHazardsLabel")} <span className="font-normal text-muted-foreground">{t("stateForm.naturalHazardsOptional")}</span></Label>
            <Textarea rows={2} {...form.register("naturalHazards")} placeholder={t("stateForm.naturalHazardsPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.marketSituationLabel")} <span className="font-normal text-muted-foreground">{t("stateForm.marketSituationOptional")}</span></Label>
            <Textarea rows={2} {...form.register("marketSituation")} placeholder={t("stateForm.marketSituationPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.otherDevelopmentsLabel")} <span className="font-normal text-muted-foreground">{t("stateForm.otherDevelopmentsOptional")}</span></Label>
            <Textarea rows={2} {...form.register("otherDevelopments")} placeholder={t("stateForm.otherDevelopmentsPlaceholder")} />
          </div>
        </div>
      </section>

      {/* ── SECTION 4: SECTORS & COVERAGE ────────────────────────────────── */}
      <section aria-labelledby="spr-section4-heading" className="space-y-3">
        <h4 id="spr-section4-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section4Title")}</h4>
        <div className="grid grid-cols-1 gap-3">
          <ChipSelect
            label={t("stateForm.sectorsCoveredLabel")}
            placeholder={t("stateForm.sectorsCoveredPlaceholder")}
            options={SECTORS}
            selected={selectedSectors}
            onChange={setSelectedSectors}
            required
          />
          <TagInput
            label={t("stateForm.localitiesCoveredLabel")}
            placeholder={t("stateForm.localitiesCoveredPlaceholder")}
            addMorePlaceholder={t("stateForm.tagInputAddMore")}
            hint={t("stateForm.tagInputHint")}
            tags={localitiesCovered}
            onChange={setLocalitiesCovered}
            required
          />
          {/* Related projects multi-select */}
          <div>
            <Label className="mb-1 block">{t("stateForm.relatedProjectsLabel")} <span className="font-normal text-muted-foreground">{t("stateForm.relatedProjectsOptional")}</span></Label>
            <div ref={projectDropdownRef} className="relative">
              <div
                className="min-h-9 flex flex-wrap gap-1 items-center px-3 py-1.5 border rounded-md cursor-pointer bg-background hover:bg-muted/30"
                onClick={() => setProjectDropdownOpen((o) => !o)}
              >
                {selectedProjectIds.length === 0 && <span className="text-sm text-muted-foreground">{t("stateForm.relatedProjectsPlaceholder")}</span>}
                {selectedProjectIds.map((id) => {
                  const p = projects.find((x) => x.id === id);
                  return p ? (
                    <Badge key={id} variant="outline" className="gap-1 pe-1">
                      <bdi dir="ltr">{p.code}</bdi>
                      <button type="button" aria-label={`Remove ${p.code}`} onClick={(e) => { e.stopPropagation(); toggleProject(id); }}><X className="h-3 w-3" aria-hidden="true" /></button>
                    </Badge>
                  ) : null;
                })}
                <ChevronDown className="h-4 w-4 text-muted-foreground ms-auto shrink-0" aria-hidden="true" />
              </div>
              {projectDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full max-h-56 overflow-y-auto rounded-md border bg-popover shadow-md">
                  {projects.map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 cursor-pointer">
                      <Checkbox checked={selectedProjectIds.includes(p.id)} onCheckedChange={() => toggleProject(p.id)} />
                      <span className="font-mono text-xs"><bdi dir="ltr">{p.code}</bdi></span>
                      <span className="truncate text-muted-foreground">{p.title}</span>
                    </label>
                  ))}
                  {projects.length === 0 && <p className="px-3 py-2 text-sm text-muted-foreground">{t("stateForm.noProjectsFound")}</p>}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* ── SECTION 5: ACTIVITIES IMPLEMENTED ────────────────────────────── */}
      <section aria-labelledby="spr-section5-heading" className="space-y-3">
        <div className="flex items-center justify-between border-b pb-1">
          <h4 id="spr-section5-heading" className="text-sm font-semibold">{t("stateForm.section5Title")}</h4>
          <Button type="button" size="sm" variant="outline" onClick={() => setActivities((cur) => [...cur, emptySpoActivity()])}>
              <Plus className="h-3 w-3" aria-hidden="true" /> {t("stateForm.addActivity")}
          </Button>
        </div>
        {activities.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("stateForm.noActivities")}</p>
        )}
        {activities.map((a, i) => {
          const actBenTotal = Number(a.beneficiariesMen || 0) + Number(a.beneficiariesWomen || 0) + Number(a.beneficiariesBoys || 0) + Number(a.beneficiariesGirls || 0);
          return (
            <div key={i} className="rounded-lg border p-4 space-y-3 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("stateForm.activityNumber", { number: i + 1 })}</p>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove activity ${i + 1}`} onClick={() => setActivities((cur) => cur.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" aria-hidden="true" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">{t("stateForm.activityTitleLabel")}</Label>
                  <Input value={a.title} onChange={(e) => updateActivity(i, { title: e.target.value })} placeholder={t("stateForm.activityTitlePlaceholder")} />
                </div>
                <div>
                  <Label className="text-xs">{t("stateForm.activitySectorLabel")}</Label>
                  <Select value={a.sector} onValueChange={(val) => updateActivity(i, { sector: val })}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={t("stateForm.activitySectorPlaceholder")} /></SelectTrigger>
                    <SelectContent>{SECTORS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{t("stateForm.activityLocalityLabel")}</Label>
                  <Input value={a.locality} onChange={(e) => updateActivity(i, { locality: e.target.value })} placeholder={t("stateForm.activityLocalityPlaceholder")} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t("stateForm.activityDateLabel")}</Label>
                  <Input type="date" value={a.activityDate} onChange={(e) => updateActivity(i, { activityDate: e.target.value })} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t("stateForm.activityStatusLabel")}</Label>
                  <Select value={a.status} onValueChange={(val) => updateActivity(i, { status: val })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{ACTIVITY_STATUS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {selectedProjectIds.length > 0 && (
                  <div className="col-span-2">
                    <Label className="text-xs">{t("stateForm.relatedProjectLabel")} <span className="font-normal text-muted-foreground">{t("stateForm.relatedProjectOptional")}</span></Label>
                    <Select
                      value={a.relatedProjectId !== "" ? String(a.relatedProjectId) : "__none__"}
                      onValueChange={(val) => updateActivity(i, { relatedProjectId: val === "__none__" ? "" : Number(val) })}
                    >
                      <SelectTrigger className="h-8"><SelectValue placeholder={t("stateForm.notLinkedPlaceholder")} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">{t("stateForm.notLinkedOption")}</SelectItem>
                        {selectedProjectIds.map((id) => {
                          const p = projects.find((x) => x.id === id);
                          return p ? <SelectItem key={p.id} value={String(p.id)}>{p.code} — {p.title}</SelectItem> : null;
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="col-span-2">
                  <Label className="text-xs">{t("stateForm.achievementSummaryLabel")}</Label>
                  <Textarea rows={2} value={a.achievementSummary} onChange={(e) => updateActivity(i, { achievementSummary: e.target.value })} placeholder={t("stateForm.achievementSummaryPlaceholder")} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("stateForm.beneficiariesLabel")}</Label>
                  <div className="grid grid-cols-5 gap-2 mt-1">
                    <div><Label className="text-xs text-muted-foreground">{t("stateForm.beneficiariesMen")}</Label><Input type="number" min={0} value={a.beneficiariesMen ?? ""} onChange={(e) => updateActivity(i, { beneficiariesMen: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                    <div><Label className="text-xs text-muted-foreground">{t("stateForm.beneficiariesWomen")}</Label><Input type="number" min={0} value={a.beneficiariesWomen ?? ""} onChange={(e) => updateActivity(i, { beneficiariesWomen: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                    <div><Label className="text-xs text-muted-foreground">{t("stateForm.beneficiariesBoys")}</Label><Input type="number" min={0} value={a.beneficiariesBoys ?? ""} onChange={(e) => updateActivity(i, { beneficiariesBoys: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                    <div><Label className="text-xs text-muted-foreground">{t("stateForm.beneficiariesGirls")}</Label><Input type="number" min={0} value={a.beneficiariesGirls ?? ""} onChange={(e) => updateActivity(i, { beneficiariesGirls: e.target.value === "" ? "" : Number(e.target.value) })} className="h-8" /></div>
                    <div><Label className="text-xs text-muted-foreground">{t("stateForm.beneficiariesTotal")}</Label><Input value={actBenTotal.toLocaleString()} readOnly className="h-8 bg-muted font-semibold" /></div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        {totalBen > 0 && (
          <div className="rounded border p-3 bg-primary/5">
            <p className="text-xs font-medium mb-1">{t("stateForm.totalBeneficiariesHeading")}</p>
            <div className="grid grid-cols-5 gap-2 text-center text-xs">
              {[
                [t("stateForm.beneficiariesMen"), totalBenByGender.men],
                [t("stateForm.beneficiariesWomen"), totalBenByGender.women],
                [t("stateForm.beneficiariesBoys"), totalBenByGender.boys],
                [t("stateForm.beneficiariesGirls"), totalBenByGender.girls],
                [t("stateForm.beneficiariesTotal"), totalBen],
              ].map(([k, val]) => (
                <div key={k as string} className="rounded border bg-background p-1.5">
                  <p className="text-muted-foreground">{k}</p>
                  <p className="font-bold">{(val as number).toLocaleString()}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* ── SECTION 6: ACHIEVEMENTS & CHALLENGES ─────────────────────────── */}
      <section id="rp-section-challenges" aria-labelledby="spr-section6-heading" className="space-y-3">
        <h4 id="spr-section6-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section6Title")}</h4>
        <div>
          <Label>{t("stateForm.keyAchievementsLabel")}</Label>
          <Textarea rows={3} {...form.register("keyAchievements")} placeholder={t("stateForm.keyAchievementsPlaceholder")} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("stateForm.challengesLabel")}</Label>
            <Textarea rows={3} {...form.register("mainChallenges")} placeholder={t("stateForm.challengesPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.mitigationMeasuresLabel")}</Label>
            <Textarea rows={3} {...form.register("mitigationMeasures")} placeholder={t("stateForm.mitigationMeasuresPlaceholder")} />
          </div>
        </div>
      </section>

      {/* ── SECTION 7: RISKS & ISSUES ─────────────────────────────────────── */}
      <section aria-labelledby="spr-section7-heading" className="space-y-4">
        <div className="border-b pb-1">
          <h4 id="spr-section7-heading" className="text-sm font-semibold">{t("stateForm.section7Title")} <span className="font-normal text-muted-foreground">{t("stateForm.section7Hint")}</span></h4>
        </div>

        {/* 7A — Linked risks from Central Register */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">{t("stateForm.section7aTitle")}</p>
          {!v.stateId && <p className="text-xs text-muted-foreground">{t("stateForm.selectStateForRisks")}</p>}
          {v.stateId && registerRisksLoading && <p className="text-xs text-muted-foreground">{t("stateForm.loadingRisks")}</p>}
          {v.stateId && !registerRisksLoading && registerRisks.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("stateForm.noOpenRisks")}</p>
          )}
          {registerRisks.map((rr) => {
            const draft = registerRiskUpdates[rr.id];
            return (
              <div key={rr.id} className="rounded border p-3 space-y-2 bg-muted/10">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium">{rr.title}</p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant={severityBadgeVariant(rr.riskLevel ?? "")} className="text-xs">{rr.riskLevel}</Badge>
                      <span className="text-xs text-muted-foreground capitalize">{rr.category}</span>
                      {rr.dueDate && <span className="text-xs text-muted-foreground">Due: {rr.dueDate.slice(0, 10)}</span>}
                    </div>
                  </div>
                  <span className="text-xs border rounded px-1.5 py-0.5 capitalize shrink-0">{(rr.status ?? "open").replace(/_/g, " ")}</span>
                </div>
                {draft !== undefined ? (
                  <div className="space-y-2">
                    <div>
                      <Label className="text-xs">{t("stateForm.riskUpdateStatusLabel")}</Label>
                      <Select value={draft.status || rr.status} onValueChange={(val) => setRegisterRiskUpdates((p) => ({ ...p, [rr.id]: { ...p[rr.id]!, status: val } }))}>
                        <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="open">{t("stateForm.riskStatusOpen")}</SelectItem>
                          <SelectItem value="under_mitigation">{t("stateForm.riskStatusUnderMitigation")}</SelectItem>
                          <SelectItem value="closed">{t("stateForm.riskStatusClosed")}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">{t("stateForm.riskMitigationUpdateLabel")}</Label>
                      <Textarea
                        rows={2}
                        className="text-xs"
                        value={draft.note}
                        onChange={(e) => setRegisterRiskUpdates((p) => ({ ...p, [rr.id]: { ...p[rr.id]!, note: e.target.value } }))}
                        placeholder={t("stateForm.riskMitigationUpdatePlaceholder")}
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="h-7 text-xs" disabled={draft.saving} onClick={() => saveRegisterRiskUpdate(rr.id)}>
                        {draft.saving ? t("stateForm.saving") : t("stateForm.saveToRegister")}
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setRegisterRiskUpdates((p) => { const n = { ...p }; delete n[rr.id]; return n; })}>
                        {t("stateForm.cancel")}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" className="h-7 text-xs"
                    onClick={() => setRegisterRiskUpdates((p) => ({ ...p, [rr.id]: { status: rr.status, note: rr.mitigationPlan ?? "", saving: false } }))}>
                    {t("stateForm.updateRisk")}
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {/* 7B — New inline risks */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-muted-foreground">{t("stateForm.section7bTitle")}</p>
            <Button type="button" size="sm" variant="outline" onClick={() => setRisks((cur) => [...cur, emptyRisk()])}>
              <Plus className="h-3 w-3" aria-hidden="true" /> {t("stateForm.addRisk")}
            </Button>
          </div>
          {risks.length === 0 && (
            <p className="text-xs text-muted-foreground">{t("stateForm.noRisks")}</p>
          )}
          {risks.map((r, i) => (
            <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("stateForm.riskNumber", { number: i + 1 })}</p>
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove risk ${i + 1}`} onClick={() => setRisks((cur) => cur.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" aria-hidden="true" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("stateForm.riskCategoryLabel")}</Label>
                  <Select value={r.category} onValueChange={(val) => updateRisk(i, { category: val })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{t("stateForm.riskSeverityLabel")}</Label>
                  <Select value={r.severity} onValueChange={(val) => updateRisk(i, { severity: val })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">{t("stateForm.riskSeverityLow")}</SelectItem>
                      <SelectItem value="medium">{t("stateForm.riskSeverityMedium")}</SelectItem>
                      <SelectItem value="high">{t("stateForm.riskSeverityHigh")}</SelectItem>
                      <SelectItem value="critical">{t("stateForm.riskSeverityCritical")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("stateForm.riskTitleLabel")}</Label>
                  <Input value={r.title} onChange={(e) => updateRisk(i, { title: e.target.value })} placeholder={t("stateForm.riskTitlePlaceholder")} className="h-8" />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("stateForm.riskDescriptionLabel")}</Label>
                  <Textarea rows={2} value={r.description} onChange={(e) => updateRisk(i, { description: e.target.value })} placeholder={t("stateForm.riskDescriptionPlaceholder")} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── SECTION 8: HQ SUPPORT REQUIRED ───────────────────────────────── */}
      <section aria-labelledby="spr-section8-heading" className="space-y-3">
        <div className="flex items-center justify-between border-b pb-1">
          <h4 id="spr-section8-heading" className="text-sm font-semibold">{t("stateForm.section8Title")}</h4>
          <Button type="button" size="sm" variant="outline" onClick={() => setHqRequests((cur) => [...cur, emptyHqRequest()])}>
              <Plus className="h-3 w-3" aria-hidden="true" /> {t("stateForm.addRequest")}
          </Button>
        </div>
        {hqRequests.length === 0 && (
          <p className="text-xs text-muted-foreground">{t("stateForm.noHqSupportRequests")}</p>
        )}
        {hqRequests.map((r, i) => (
          <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">{t("stateForm.requestNumber", { number: i + 1 })}</p>
              {hqRequests.length > 1 && (
                <Button type="button" size="sm" variant="ghost" aria-label={`Remove HQ support request ${i + 1}`} onClick={() => setHqRequests((cur) => cur.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" aria-hidden="true" />
                </Button>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">{t("stateForm.supportTypeLabel")}</Label>
                <Select value={r.supportType} onValueChange={(val) => updateHqRequest(i, { supportType: val })}>
                  <SelectTrigger className="h-8"><SelectValue placeholder={t("stateForm.supportTypePlaceholder")} /></SelectTrigger>
                  <SelectContent>{HQ_SUPPORT_TYPES.map((t_) => <SelectItem key={t_} value={t_}>{t_}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("stateForm.priorityLabel")}</Label>
                <Select value={r.priority} onValueChange={(val) => updateHqRequest(i, { priority: val })}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="col-span-2">
                <Label className="text-xs">{t("stateForm.requestDescriptionLabel")}</Label>
                <Textarea rows={2} value={r.description} onChange={(e) => updateHqRequest(i, { description: e.target.value })} placeholder={t("stateForm.requestDescriptionPlaceholder")} />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* ── SECTION 9: NEXT PERIOD PRIORITIES ────────────────────────────── */}
      <section aria-labelledby="spr-section9-heading" className="space-y-3">
        <h4 id="spr-section9-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section9Title")}</h4>
        <div>
          <Label>{t("stateForm.nextPeriodPrioritiesLabel")}</Label>
          <Textarea rows={3} {...form.register("nextPeriodPriorities")} placeholder={t("stateForm.nextPeriodPrioritiesPlaceholder")} />
        </div>
      </section>

      {/* ── SECTION 10: OPTIONAL NARRATIVE ───────────────────────────────── */}
      <section id="rp-section-lessons" aria-labelledby="spr-section10-heading" className="space-y-3">
        <h4 id="spr-section10-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section10Title")} <span className="font-normal text-muted-foreground">{t("stateForm.section10Hint")}</span></h4>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>{t("stateForm.lessonsLearnedLabel")}</Label>
            <Textarea rows={2} {...form.register("lessonsLearned")} placeholder={t("stateForm.lessonsLearnedPlaceholder")} />
          </div>
          <div>
            <Label>{t("stateForm.coordinationUpdatesLabel")}</Label>
            <Textarea rows={2} {...form.register("coordinationUpdates")} placeholder={t("stateForm.coordinationUpdatesPlaceholder")} />
          </div>
          <div className="col-span-2">
            <Label>{t("stateForm.communityFeedbackLabel")}</Label>
            <Textarea rows={2} {...form.register("communityFeedback")} placeholder={t("stateForm.communityFeedbackPlaceholder")} />
          </div>
        </div>
      </section>

      {/* ── SECTION 11: SUPPORTING DOCUMENTS ────────────────────────────── */}
      <section id="rp-section-attachments" aria-labelledby="spr-section11-heading" className="space-y-3">
        <h4 id="spr-section11-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section11Title")}</h4>
        {hasNoAttachments && (
          <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" aria-hidden="true" />
            <p>{t("stateForm.noAttachmentsWarning")}</p>
          </div>
        )}
        <UploadArea
          documents={attachments}
          onUpload={uploadFile}
          onTypeChange={(tempId, type) => setAttachments((d) => d.map((x) => x.tempId === tempId ? { ...x, attachmentType: type } : x))}
          onRemove={(id) => setAttachments((d) => d.filter((x) => x.tempId !== id))}
          attachFileLabel={t("stateForm.attachFileButton")}
          attachFileHint={t("stateForm.attachFileHint")}
        />
      </section>

      {/* ── SECTION 12: VOICE NOTE ────────────────────────────────────────── */}
      <section aria-labelledby="spr-section12-heading" className="space-y-3">
        <h4 id="spr-section12-heading" className="text-sm font-semibold border-b pb-1">{t("stateForm.section12Title")} <span className="font-normal text-muted-foreground">{t("stateForm.section12Hint")}</span></h4>
        <FormVoiceRecorder value={pendingVoiceNote} onChange={setPendingVoiceNote} />
      </section>

      {/* ── FOOTER ────────────────────────────────────────────────────────── */}
      <DialogFooter className="gap-2 flex-wrap">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>{t("stateForm.cancel")}</Button>
        <Button type="button" variant="secondary" onClick={onSaveDraft} disabled={localDraft.status === "pending" || localDraft.status === "syncing" || isSaving}
          aria-busy={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("stateForm.saveDraft")}
        </Button>
        <Button type="button" onClick={onSubmitReport} disabled={!isOnline || isSaving}
          aria-busy={isSaving} aria-describedby={!isOnline ? "spr-offline-workflow-notice" : undefined}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
          {t("stateForm.submitReport")}
        </Button>
      </DialogFooter>
    </form>
  );
}

// ── Detail view (used in report sheet) ───────────────────────────────────────

function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asObj(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }

export function ProgramStateSectionsView({
  sections,
  activities,
  projects,
  periodStart,
  periodEnd,
  onAddComment,
}: {
  sections: Record<string, unknown>;
  /** Top-level persisted report activities (NOT sections.activities). */
  activities?: Array<Record<string, unknown>>;
  /** Project list for resolving relatedProjectIds → code/title. */
  projects?: Array<{ id: number; code?: string | null; title: string }>;
  /** On-demand period start (top-level report field). */
  periodStart?: string | null;
  /** On-demand period end (top-level report field). */
  periodEnd?: string | null;
  /** SPR-010: when provided, renders contextual "Add comment" buttons that
      pre-seed the shared CommentsPanel composer with the section key. */
  onAddComment?: (sectionKey: string) => void;
}) {
  const { t } = useTranslation("reports");

  // Compact contextual entry-point into the single authoritative comment
  // stream (the CommentsPanel below the detail view) — no inline comment box.
  const addCommentBtn = (sectionKey: string, sectionLabel: string) =>
    onAddComment ? (
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-xs text-muted-foreground"
        aria-label={t("stateForm.addCommentAriaLabel", { section: sectionLabel })}
        onClick={() => onAddComment(sectionKey)}
      >
                  <Plus className="h-3 w-3" aria-hidden /> {t("stateForm.addComment")}
      </Button>
    ) : null;

  const projectLabel = (id: number): string => {
    const p = projects?.find((pr) => pr.id === id);
    return p ? (p.code ? `${p.code} — ${p.title}` : p.title) : `Project #${id}`;
  };

  const sectors = asArr(sections.sectors) as string[];
  const localities = asArr(sections.localitiesCovered) as string[];
  const officerName = asStr(sections.officerName);
  const hqRequests = asArr(sections.hqSupportRequests) as Array<Record<string, unknown>>;
  const reportRisks = asArr(sections.risks) as Array<Record<string, unknown>>;
  const humanCtx = asObj(sections.humanitarianContext);
  const frequency = asStr(sections.frequency) || "monthly";
  const quarter = sections.quarter as number | undefined;

  const frequencyLabel =
    frequency === "monthly" ? t("stateForm.freqMonthly") :
    frequency === "quarterly" ? (quarter ? t("stateForm.freqQuarterlyQ", { quarter }) : t("stateForm.freqQuarterly")) :
    frequency === "annual" ? t("stateForm.freqAnnual") :
    t("stateForm.freqOnDemand");

  const humanitarianFields: [string, string][] = [
    [t("stateForm.detailHumanSecuritySituation"), asStr(humanCtx.securitySituation)],
    [t("stateForm.detailHumanPopulationMovements"), asStr(humanCtx.populationMovements)],
    [t("stateForm.detailHumanDiseaseOutbreaks"), asStr(humanCtx.diseaseOutbreaks)],
    [t("stateForm.detailHumanAccessConstraints"), asStr(humanCtx.accessConstraints)],
    [t("stateForm.detailHumanNaturalHazards"), asStr(humanCtx.naturalHazards)],
    [t("stateForm.detailHumanMarketSituation"), asStr(humanCtx.marketSituation)],
    [t("stateForm.detailHumanOtherDevelopments"), asStr(humanCtx.otherDevelopments)],
  ].filter(([, v]) => v.trim()) as [string, string][];

  const narrativeFields: [string, string, string][] = ([
    ["key_achievements", t("stateForm.detailNarrKeyAchievements"), asStr(sections.keyAchievements)],
    ["main_challenges", t("stateForm.detailNarrChallenges"), asStr(sections.mainChallenges)],
    ["mitigation_measures", t("stateForm.detailNarrMitigationMeasures"), asStr(sections.mitigationMeasures)],
    ["next_period_priorities", t("stateForm.detailNarrNextPeriodPriorities"), asStr(sections.nextPeriodPriorities)],
  ] as [string, string, string][]).filter(([, , v]) => v.trim());

  // Backward compat with old field names
  if (!asStr(sections.keyAchievements) && asStr(sections.narrativeSummary)) {
    narrativeFields.unshift(["key_achievements", t("stateForm.detailNarrNarrativeSummary"), asStr(sections.narrativeSummary)]);
  }
  if (!asStr(sections.nextPeriodPriorities) && asStr(sections.nextSteps)) {
    narrativeFields.push(["next_period_priorities", t("stateForm.detailNarrNextSteps"), asStr(sections.nextSteps)]);
  }

  const optionalNarrative: [string, string][] = [
    [t("stateForm.detailOptLessonsLearned"), asStr(sections.lessonsLearned)],
    [t("stateForm.detailOptCoordinationUpdates"), asStr(sections.coordinationUpdates)],
    [t("stateForm.detailOptCommunityFeedback"), asStr(sections.communityFeedback)],
    // Compat with old field names
    [t("stateForm.detailOptSecurityUpdates"), asStr(sections.securityUpdates)],
    [t("stateForm.detailOptAccessConstraintsLegacy"), asStr(sections.accessConstraints)],
  ].filter(([, v]) => v.trim()) as [string, string][];

  const onDemandReason = asStr(sections.onDemandReason);
  const relatedProjectIds = (asArr(sections.relatedProjectIds) as unknown[])
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));
  const viewActivities = (activities ?? []).filter((a) => a && typeof a === "object");

  return (
    <div className="space-y-5">
      {/* Meta row */}
      <div className="rounded border p-3 bg-muted/20 space-y-1.5">
        {officerName && <p className="text-sm"><strong className="text-xs font-medium text-muted-foreground">{t("stateForm.detailOfficer")}</strong> {officerName}</p>}
        <p className="text-sm"><strong className="text-xs font-medium text-muted-foreground">{t("stateForm.detailFrequency")}</strong> {frequencyLabel}</p>
        {frequency === "on_demand" && (periodStart || periodEnd) && (
          <p className="text-sm"><strong className="text-xs font-medium text-muted-foreground">{t("stateForm.detailPeriodDates")}</strong> {periodStart || "—"}{periodEnd ? ` → ${periodEnd}` : ""}</p>
        )}
        {frequency === "on_demand" && onDemandReason && (
          <p className="text-sm"><strong className="text-xs font-medium text-muted-foreground">{t("stateForm.detailOnDemandReason")}</strong> {onDemandReason}</p>
        )}
        {sectors.length > 0 && (
          <p className="flex flex-wrap gap-1 items-center text-sm">
            <strong className="text-xs font-medium text-muted-foreground me-1">{t("stateForm.detailSectors")}</strong>
            {sectors.map((s) => <span key={s} className="px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground text-xs">{s}</span>)}
          </p>
        )}
        {localities.length > 0 && (
          <p className="flex flex-wrap gap-1 items-center text-sm">
            <strong className="text-xs font-medium text-muted-foreground me-1">{t("stateForm.detailLocalities")}</strong>
            {localities.map((l) => <span key={l} className="px-1.5 py-0.5 rounded bg-muted text-xs">{l}</span>)}
          </p>
        )}
      </div>

      {/* Related Projects */}
      {relatedProjectIds.length > 0 && (
        <section aria-labelledby="spr-detail-related-projects">
          <h4 id="spr-detail-related-projects" className="text-sm font-medium text-foreground mb-2">{t("stateForm.detailRelatedProjects")}</h4>
          <ul className="space-y-1">
            {relatedProjectIds.map((id) => (
              <li key={id} className="rounded border p-2 text-xs bg-muted/10 break-words">{projectLabel(id)}</li>
            ))}
          </ul>
        </section>
      )}

      {/* Activities */}
      {viewActivities.length > 0 && (
        <section aria-labelledby="spr-detail-activities">
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 id="spr-detail-activities" className="text-sm font-medium text-foreground mb-2">{t("stateForm.detailActivities")}</h4>
            {addCommentBtn("activities", t("stateForm.detailActivities"))}
          </div>
          <div className="space-y-2">
            {viewActivities.map((a, i) => {
              const benTotal =
                a.beneficiariesTotal != null
                  ? Number(a.beneficiariesTotal)
                  : Number(a.beneficiariesMen ?? 0) + Number(a.beneficiariesWomen ?? 0) + Number(a.beneficiariesBoys ?? 0) + Number(a.beneficiariesGirls ?? 0);
              const relProj = a.relatedProjectId != null && a.relatedProjectId !== "" ? Number(a.relatedProjectId) : null;
              return (
                <details key={i} className="rounded border text-xs group" open={viewActivities.length === 1}>
                  <summary className="flex items-center justify-between gap-2 p-2 cursor-pointer list-none select-none">
                    <span className="flex items-center gap-2 min-w-0">
                      <ChevronRight className="h-3 w-3 flex-shrink-0 transition-transform group-open:rotate-90" aria-hidden />
                      <span className="font-medium truncate" title={asStr(a.title)}>{asStr(a.title) || "—"}</span>
                    </span>
                    <span className="flex items-center gap-1 flex-shrink-0">
                      {asStr(a.sector) && <Badge variant="outline" className="text-xs">{asStr(a.sector)}</Badge>}
                      {asStr(a.status) && <Badge variant="secondary" className="text-xs">{asStr(a.status)}</Badge>}
                    </span>
                  </summary>
                  <div className="px-3 pb-3 pt-1 space-y-2 border-t bg-muted/10">
                    <p className="text-muted-foreground">
                       {asStr(a.locality) && <>{t("stateForm.detailLocality")} {asStr(a.locality)} · </>}
                       {asStr(a.activityDate) && <>{t("stateForm.detailDate")} {asStr(a.activityDate)}</>}
                       {relProj != null && <> · {t("stateForm.detailProject")} {projectLabel(relProj)}</>}
                    </p>
                    {asStr(a.achievementSummary) && (
                      <div>
                        <p className="font-medium text-muted-foreground mb-0.5">{t("stateForm.detailAchievementSummary")}</p>
                        <p className="whitespace-pre-wrap">{asStr(a.achievementSummary)}</p>
                      </div>
                    )}
                    <div>
                      <p className="font-medium text-muted-foreground mb-1">{t("stateForm.detailBeneficiaryBreakdown")}</p>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                        {([
                          [t("detail.male"), a.beneficiariesMen],
                          [t("detail.female"), a.beneficiariesWomen],
                          [t("detail.boys"), a.beneficiariesBoys],
                          [t("detail.girls"), a.beneficiariesGirls],
                          [t("detail.total"), benTotal],
                        ] as [string, unknown][]).map(([label, val]) => (
                          <div key={label} className="rounded border p-1">
                            <p className="text-muted-foreground">{label}</p>
                            <p className="font-medium">{val != null && val !== "" ? Number(val).toLocaleString() : "—"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      )}

      {/* Humanitarian context */}
      {humanitarianFields.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-sm font-medium text-foreground mb-2">{t("stateForm.detailHumanitarianContext")}</h4>
            {addCommentBtn("humanitarian_context", t("stateForm.detailHumanitarianContext"))}
          </div>
          <div className="grid grid-cols-1 gap-2">
            {humanitarianFields.map(([label, val]) => (
              <div key={label} className="rounded border p-2 bg-muted/10">
                <p className="text-xs font-medium text-muted-foreground mb-0.5">{label}</p>
                <p className="text-sm whitespace-pre-wrap">{val}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Required narrative */}
      {narrativeFields.map(([key, label, val]) => (
        <div key={label}>
          <div className="flex items-center justify-between gap-2 mb-1">
            <h4 className="text-sm font-medium text-foreground mb-2">{label}</h4>
            {addCommentBtn(key, label)}
          </div>
          <p className="text-sm whitespace-pre-wrap">{val}</p>
        </div>
      ))}

      {/* HQ Support Requests */}
      {hqRequests.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("stateForm.detailHqSupportRequests")}</h4>
          <div className="space-y-2">
            {hqRequests.map((r, i) => (
              <div key={i} className="rounded border p-3 bg-muted/10 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{asStr(r.supportType) || t("stateForm.detailSupportRequestFallback")}</span>
                  <Badge variant={asStr(r.priority) === "High" ? "destructive" : "secondary"} className="text-xs">{asStr(r.priority)}</Badge>
                </div>
                <p className="text-muted-foreground text-xs whitespace-pre-wrap">{asStr(r.description)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {reportRisks.length > 0 && (
        <div>
          <div className="flex items-center justify-between gap-2 mb-2">
            <h4 className="text-sm font-medium text-foreground mb-2">{t("stateForm.detailRisksIssues")}</h4>
            {addCommentBtn("risks", t("stateForm.detailRisksIssues"))}
          </div>
          <div className="space-y-2">
            {reportRisks.map((r, i) => (
              <div key={i} className="rounded border p-3 bg-muted/10 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{asStr(r.title)}</span>
                  <Badge variant="outline" className="text-xs">{asStr(r.category)}</Badge>
                  <Badge variant={severityBadgeVariant(asStr(r.severity))} className="text-xs">{asStr(r.severity)}</Badge>
                </div>
                {asStr(r.description) && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{asStr(r.description)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Optional narrative */}
      {optionalNarrative.length > 0 && (
        <div className="space-y-3">
          {optionalNarrative.map(([label, val]) => (
            <div key={label}>
              <h4 className="text-sm font-medium text-foreground mb-2">{label}</h4>
              <p className="text-sm whitespace-pre-wrap">{val}</p>
            </div>
          ))}
        </div>
      )}

      {/* Attachments are rendered by the parent detail view via the secured
          /api/reports/:id/attachments endpoint — not duplicated here. */}
    </div>
  );
}
