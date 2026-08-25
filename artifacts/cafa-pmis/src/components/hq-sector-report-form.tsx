import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useForm } from "react-hook-form";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import {
  useCreateReport,
  useTransitionReport,
  useListStates,
  useGetMe,
  requestUploadUrl,
  type ListReportsQueryResult,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { getLinkedStateLabel } from "@/components/state-label";
import { StateLabel } from "@/components/state-label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { DialogFooter, Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Plus, Trash2, Send, Upload, FileText, Loader2, X,
  TrendingUp, Users, Activity, ShieldAlert, Clock,
  MapPin, BarChart3, AlertTriangle, Link2, AlertCircle,
} from "lucide-react";
import { CommentsPanel } from "@/components/comments-panel";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { SECTORS } from "@/lib/sectors";
import { severityBadgeVariant, hasPerm } from "@/lib/format";
import { FormVoiceRecorder, type PendingNote } from "@/components/form-voice-recorder";
import {
  OfflineReportDraftStatus,
  reportDraftKey,
  useOfflineReportDraft,
} from "@/lib/offline/report-drafts";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";
import { useSyncContext } from "@/contexts/sync-context";

// ── Constants ─────────────────────────────────────────────────────────────────

type Frequency = "monthly" | "quarterly" | "annual" | "on_demand";

const ON_DEMAND_REASONS = [
  "Donor Request", "Management Request", "Emergency Response",
  "Special Review", "Monitoring Mission", "Evaluation", "Other",
] as const;

const SUPPORT_TYPES = [
  "Technical Support", "Programme Support", "Finance Support",
  "Procurement Support", "Logistics Support", "HR Support",
  "Security Support", "Coordination Support", "IT/System Support", "Other",
] as const;

const PRIORITIES = ["High", "Medium", "Low"] as const;

const RISK_CATEGORIES = [
  "Technical", "Programmatic", "Operational", "Financial", "Compliance", "Security", "Access",
] as const;

const RISK_LIKELIHOODS = ["low", "medium", "high"] as const;

const TECHNICAL_RATINGS = ["Excellent", "Good", "Fair", "Needs Improvement", "Critical"] as const;

const ATTACHMENT_TYPES = [
  "Technical Assessments", "Monitoring Reports", "Evaluation Reports",
  "Guidelines", "Standards", "Meeting Minutes", "Photos",
  "Verification Documents", "Other",
] as const;

const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png";

// ── Types ─────────────────────────────────────────────────────────────────────

type SupportRequest = {
  supportType: string;
  priority: string;
  description: string;
};

type StateObservation = {
  stateId: number | "";
  technicalObservation: string;
  qualityConcern: string;
  goodPractice: string;
  actionRequired: string;
};

type TechnicalRating = {
  entityType: "state" | "project";
  entityLabel: string;
  rating: string;
  reason: string;
};

type IndicatorComment = {
  indicatorName: string;
  commentary: string;
};

type Attachment = {
  tempId: string;
  /** Safe report_attachments identity; never an object-storage authority. */
  attachmentId?: number;
  fileName: string;
  contentType: string;
  size: number;
  objectPath: string;
  /** New files remain browser-local until their report has a server identity. */
  file?: File;
  attachmentType: string;
  uploading?: boolean;
};

type ExistingRisk = {
  id: number;
  title: string;
  category: string;
  severity: string;
  status: string;
  stateName: string;
  projectTitle: string | null;
  assignedToName: string | null;
  mitigationPlan: string | null;
};

type NewRiskDraft = {
  title: string;
  category: string;
  severity: string;
  likelihood: string;
  stateId: number | "";
  description: string;
  mitigationPlan: string;
};

type SectorSnapshot = {
  activeProjects: number;
  activeStates: number;
  activeLocalities: number;
  activitiesImplemented: number;
  beneficiariesReached: number;
  indicatorProgressPct: number;
  delayedActivities: number;
  openRisks: number;
  pendingApprovals: number;
};

type StateSummaryRow = {
  stateId: number;
  stateName: string;
  stateNameAr?: string | null;
  projects: number;
  activities: number;
  beneficiaries: number;
  progressPct: number;
  openRisks: number;
};

type ProjectSummaryRow = {
  id: number;
  code: string;
  title: string;
  donor: string;
  progressPct: number;
  beneficiaries: number;
  budgetUtilizationPct: number;
  riskLevel: string;
};

type BenRow = { men: number; women: number; boys: number; girls: number; total: number };
type BenByState = BenRow & { stateId: number; stateName: string; stateNameAr?: string | null };
type BenByProject = BenRow & { code: string; title: string };
type BenByDonor = BenRow & { donor: string };

type IndicatorRow = {
  name: string;
  target: number;
  achieved: number;
  progressPct: number;
  status: string;
};

type BenBreakdown = { men: number; women: number; boys: number; girls: number };

type SectorData = {
  snapshot: SectorSnapshot;
  stateSummaries: StateSummaryRow[];
  projectSummaries: ProjectSummaryRow[];
  beneficiaryBreakdown: BenBreakdown;
  beneficiaryByState: BenByState[];
  beneficiaryByProject: BenByProject[];
  beneficiaryByDonor: BenByDonor[];
  indicators: IndicatorRow[];
};

type BasicValues = {
  sector: string;
  frequency: Frequency;
  reportingMonth: number;
  reportingYear: number;
  quarter: number;
  periodStart: string;
  periodEnd: string;
  onDemandReason: string;
  officerName: string;
  title: string;
  technicalAnalysis: string;
  keyFindings: string;
  qualityAssessment: string;
  technicalChallenges: string;
  recommendations: string;
  strategicPriorities: string;
  lessonsLearned: string;
  sectorOutlook: string;
};

const emptySupport = (): SupportRequest => ({ supportType: "", priority: "Medium", description: "" });
const emptyObservation = (): StateObservation => ({ stateId: "", technicalObservation: "", qualityConcern: "", goodPractice: "", actionRequired: "" });
const emptyRating = (): TechnicalRating => ({ entityType: "state", entityLabel: "", rating: "Good", reason: "" });
const emptyIndComment = (): IndicatorComment => ({ indicatorName: "", commentary: "" });
const emptyNewRisk = (): NewRiskDraft => ({
  title: "", category: "Programmatic", severity: "medium", likelihood: "medium",
  stateId: "", description: "", mitigationPlan: "",
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

// ── Beneficiary breakdown sub-table ──────────────────────────────────────────

function BenTable<T extends BenRow>({
  label,
  rows,
  nameCol,
  nameKey,
}: {
  label: string;
  rows: T[];
  nameCol: string;
  nameKey: keyof T;
}) {
  const { t, i18n } = useTranslation("reports");
  if (rows.length === 0) return null;
  const total = rows.reduce((a, r) => ({ men: a.men + r.men, women: a.women + r.women, boys: a.boys + r.boys, girls: a.girls + r.girls, total: a.total + r.total }), { men: 0, women: 0, boys: 0, girls: 0, total: 0 });
  const colHeaders = [nameCol, t("hqForm.colMen"), t("hqForm.colWomen"), t("hqForm.colBoys"), t("hqForm.colGirls"), t("hqForm.colTotal")];
  return (
    <div>
      <p className="text-xs font-semibold mb-1 text-muted-foreground">{label}</p>
      <div className="rounded border overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              {colHeaders.map((h) => (
                <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-muted/20">
                <td className="px-2 py-1.5 font-medium">{nameKey === "stateName" ? getLinkedStateLabel(row as { stateName?: string | null; stateNameAr?: string | null }, i18n?.language) : String(row[nameKey])}</td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.men.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.women.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.boys.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.girls.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5 font-semibold"><bdi dir="ltr">{row.total.toLocaleString()}</bdi></td>
              </tr>
            ))}
            <tr className="bg-muted/30 font-semibold">
              <td className="px-2 py-1.5">{t("hqForm.totalRow")}</td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.men.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.women.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.boys.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.girls.toLocaleString()}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.total.toLocaleString()}</bdi></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Auto-gen snapshot section ─────────────────────────────────────────────────

function SectorSnapshotSection({ sector }: { sector: string }) {
  const { t, i18n } = useTranslation("reports");
  const { data, isLoading } = useQuery<SectorData>({
    queryKey: ["sector-snapshot", sector],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/sector-snapshot?sector=${encodeURIComponent(sector)}`);
      if (!res.ok) throw new Error("Failed to load sector data");
      return res.json() as Promise<SectorData>;
    },
    enabled: !!sector,
    staleTime: 60_000,
  });

  if (isLoading) return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">{[1,2,3,4,5,6].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      <Skeleton className="h-24" />
    </div>
  );
  if (!data) return null;

  const snap = data.snapshot;
  const snapCards = [
    { label: t("hqForm.snapshotActiveProjects"), value: snap.activeProjects, icon: TrendingUp, color: "text-blue-600" },
    { label: t("hqForm.snapshotActiveStates"), value: snap.activeStates, icon: MapPin, color: "text-purple-600" },
    { label: t("hqForm.snapshotActiveLocalities"), value: snap.activeLocalities, icon: MapPin, color: "text-indigo-600" },
    { label: t("hqForm.snapshotActivitiesDone"), value: snap.activitiesImplemented, icon: Activity, color: "text-green-600" },
    { label: t("hqForm.snapshotBeneficiaries"), value: snap.beneficiariesReached.toLocaleString(), icon: Users, color: "text-teal-600" },
    { label: t("hqForm.snapshotIndicatorProgress"), value: `${snap.indicatorProgressPct}%`, icon: BarChart3, color: "text-cyan-600" },
    { label: t("hqForm.snapshotDelayedActivities"), value: snap.delayedActivities, icon: AlertTriangle, color: "text-amber-600" },
    { label: t("hqForm.snapshotOpenRisks"), value: snap.openRisks, icon: ShieldAlert, color: "text-red-600" },
    { label: t("hqForm.snapshotPendingReviews"), value: snap.pendingApprovals, icon: Clock, color: "text-orange-600" },
  ];

  const benTotal = data.beneficiaryBreakdown.men + data.beneficiaryBreakdown.women +
    data.beneficiaryBreakdown.boys + data.beneficiaryBreakdown.girls;

  return (
    <div className="space-y-4">
      {/* Snapshot cards */}
      <div className="grid grid-cols-3 sm:grid-cols-9 gap-2">
        {snapCards.map((c) => (
          <div key={c.label} className="rounded border p-2 bg-muted/10 text-center">
            <c.icon className={`h-4 w-4 mx-auto mb-0.5 ${c.color}`} />
            <p className="text-base font-bold"><bdi dir="ltr">{c.value}</bdi></p>
            <p className="text-xs text-muted-foreground leading-tight">{c.label}</p>
          </div>
        ))}
      </div>

      {/* State performance summary */}
      {data.stateSummaries.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1 text-muted-foreground">{t("hqForm.statePerformanceSummary")}</p>
          <div className="rounded border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>{[t("hqForm.colState"), t("hqForm.colProjects"), t("hqForm.colActivities"), t("hqForm.colBeneficiaries"), t("hqForm.colProgress"), t("hqForm.colOpenRisks")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.stateSummaries.map((s) => (
                  <tr key={s.stateId} className="hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium">{getLinkedStateLabel(s, i18n?.language)}</td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.projects}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.activities}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.beneficiaries.toLocaleString()}</bdi></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-16 rounded bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${s.progressPct}%` }} />
                        </div>
                        <span><bdi dir="ltr">{s.progressPct}%</bdi></span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={s.openRisks > 0 ? "text-red-600 font-medium" : "text-muted-foreground"}><bdi dir="ltr">{s.openRisks}</bdi></span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Project performance summary */}
      {data.projectSummaries.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1 text-muted-foreground">{t("hqForm.projectPerformanceSummary")}</p>
          <div className="rounded border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>{[t("hqForm.colProject"), t("hqForm.colDonor"), t("hqForm.colProgress"), t("hqForm.colBeneficiaries"), t("hqForm.colBudgetUtil"), t("hqForm.colRisk")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.projectSummaries.map((p) => (
                  <tr key={p.id} className="hover:bg-muted/20">
                    <td className="px-2 py-1.5"><span className="font-mono"><bdi dir="ltr">{p.code}</bdi></span> <span className="text-muted-foreground truncate">{p.title.slice(0,30)}{p.title.length > 30 ? "…" : ""}</span></td>
                    <td className="px-2 py-1.5 text-muted-foreground">{p.donor || "—"}</td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.progressPct}%</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.beneficiaries.toLocaleString()}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.budgetUtilizationPct}%</bdi></td>
                    <td className="px-2 py-1.5">
                      <Badge variant={p.riskLevel === "high" ? "destructive" : "secondary"} className="text-xs">{p.riskLevel}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Beneficiary analysis — sector totals + breakdowns */}
      {benTotal > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold mb-1 text-muted-foreground">{t("hqForm.beneficiaryAnalysis")}</p>

          {/* Sector totals */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {(["men","women","boys","girls"] as const).map((k) => {
              const val = data.beneficiaryBreakdown[k];
              const label = t(`hqForm.col${k.charAt(0).toUpperCase() + k.slice(1)}`);
              return (
                <div key={k} className="rounded border p-2 bg-muted/10">
                  <p className="text-muted-foreground">{label}</p>
                  <p className="font-bold text-base"><bdi dir="ltr">{val.toLocaleString()}</bdi></p>
                </div>
              );
            })}
            <div className="rounded border p-2 bg-primary/5">
              <p className="text-muted-foreground">{t("hqForm.colTotal")}</p>
              <p className="font-bold text-base"><bdi dir="ltr">{benTotal.toLocaleString()}</bdi></p>
            </div>
          </div>

          {/* By state */}
          <BenTable label={t("hqForm.benByState")} rows={data.beneficiaryByState} nameCol={t("hqForm.colState")} nameKey="stateName" />

          {/* By project */}
          <BenTable label={t("hqForm.benByProject")} rows={data.beneficiaryByProject.map(r => ({ ...r, displayName: `${r.code} — ${r.title.slice(0,30)}${r.title.length > 30 ? "…" : ""}` }))} nameCol={t("hqForm.colProject")} nameKey="displayName" />

          {/* By donor */}
          <BenTable label={t("hqForm.benByDonor")} rows={data.beneficiaryByDonor} nameCol={t("hqForm.colDonor")} nameKey="donor" />
        </div>
      )}

      {/* Indicator analysis */}
      {data.indicators.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1 text-muted-foreground">{t("hqForm.indicatorAnalysis")}</p>
          <div className="rounded border overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>{[t("hqForm.colIndicator"), t("hqForm.colTarget"), t("hqForm.colAchieved"), t("hqForm.colProgress"), t("hqForm.colStatus")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.indicators.map((ind, i) => (
                  <tr key={i} className="hover:bg-muted/20">
                    <td className="px-2 py-1.5 font-medium max-w-xs truncate">{ind.name}</td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{ind.target?.toLocaleString() ?? "—"}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{ind.achieved?.toLocaleString() ?? "—"}</bdi></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-14 rounded bg-muted overflow-hidden">
                          <div className={`h-full ${ind.progressPct >= 100 ? "bg-green-500" : ind.progressPct >= 75 ? "bg-blue-500" : ind.progressPct >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${Math.min(ind.progressPct, 100)}%` }} />
                        </div>
                        <span><bdi dir="ltr">{ind.progressPct}%</bdi></span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Badge className={`text-xs ${ind.status === "Achieved" ? "bg-green-100 text-green-800" : ind.status === "On Track" ? "bg-blue-100 text-blue-800" : ind.status === "At Risk" ? "bg-amber-100 text-amber-800" : "bg-red-100 text-red-800"}`}>
                        {ind.status}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Severity badge colour helper ──────────────────────────────────────────────

function severityClass(sev: string) {
  if (sev === "critical") return "bg-red-100 text-red-800 border-red-200";
  if (sev === "high") return "bg-orange-100 text-orange-800 border-orange-200";
  if (sev === "medium") return "bg-amber-100 text-amber-800 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

// ── Main form ─────────────────────────────────────────────────────────────────

/** Runtime shape of a persisted HQ Sector Report row as returned by the
    reports list/detail endpoints (same source of truth as SPR-007). */
export type ExistingHqsrReport = NonNullable<ListReportsQueryResult>["items"][number];

interface Props {
  onClose: () => void;
  /** When set, the form runs in edit mode (HQSR-005): hydrates from this report,
      PATCHes the same report id (content only — identity fields locked), never
      POSTs a duplicate. */
  existingReport?: ExistingHqsrReport;
  /** Page-level dirty-form tracking (reuses the reports.tsx AlertDialog
      discard-confirm pattern). Called with true when any field changes and
      false after a successful save/submit. */
  onDirtyChange?: (dirty: boolean) => void;
}

export function HqSectorReportForm({ onClose, existingReport, onDirtyChange }: Props) {
  const { t, i18n } = useTranslation("reports");
  const qc = useQueryClient();
  const isEditMode = existingReport !== undefined;
  const createMutation = useCreateReport();
  const transitionMutation = useTransitionReport();
  const { data: me } = useGetMe();
  const { data: statesData } = useListStates();
  const states = useMemo(() => statesData ?? [], [statesData]);
  const { isOnline } = useSyncContext();

  const now = new Date();
  const currentYear = now.getFullYear();
  const yearOptions = Array.from({ length: 2035 - (currentYear - 2) + 1 }, (_, i) => currentYear - 2 + i);

  const userSectors = useMemo(() => {
    if (!me?.user) return SECTORS as unknown as string[];
    const { role, sector } = me.user;
    if (role === "technical_coordinator") {
      // HQSR-001: fail closed — a TC with no assigned sectors gets no sector
      // options (never fall back to the full canonical list).
      return (sector ?? "").split(",").map((s: string) => s.trim()).filter((s: string) => s);
    }
    return SECTORS as unknown as string[];
  }, [me]);

  const form = useForm<BasicValues>({
    defaultValues: {
      sector: "",
      frequency: "monthly",
      reportingMonth: now.getMonth() + 1,
      reportingYear: currentYear,
      quarter: Math.ceil((now.getMonth() + 1) / 3),
      periodStart: "",
      periodEnd: "",
      onDemandReason: "",
      officerName: "",
      title: "",
      technicalAnalysis: "",
      keyFindings: "",
      qualityAssessment: "",
      technicalChallenges: "",
      recommendations: "",
      strategicPriorities: "",
      lessonsLearned: "",
      sectorOutlook: "",
    },
  });
  const v = form.watch();

  useEffect(() => {
    if (!me?.user) return;
    if (isEditMode) return; // edit mode: everything comes from the existing report
    if (me.user.name && !form.getValues("officerName")) form.setValue("officerName", me.user.name);
    if (me.user.role === "technical_coordinator" && me.user.sector) {
      const sectors = me.user.sector.split(",").map((s: string) => s.trim()).filter(Boolean);
      if (sectors.length === 1 && !form.getValues("sector")) {
        form.setValue("sector", sectors[0]);
      }
    }
  }, [me, form, isEditMode]);

  const autoTitleRef = useRef("");
  const computedPeriod = useMemo(() => {
    if (v.frequency === "quarterly") return `Q${v.quarter} ${v.reportingYear}`;
    if (v.frequency === "annual") return String(v.reportingYear);
    if (v.frequency === "on_demand") return v.periodStart || String(v.reportingYear);
    const mn = new Date(2000, v.reportingMonth - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" });
    return `${mn} ${v.reportingYear}`;
  }, [v.frequency, v.reportingMonth, v.reportingYear, v.quarter, v.periodStart, i18n.language]);

  useEffect(() => {
    if (isEditMode) return; // never overwrite a hydrated title
    const freqLabel = t(`frequency.${v.frequency}`);
    const auto = v.sector ? `${v.sector} ${t("hqForm.autoTitleSector", { frequency: freqLabel, period: computedPeriod })}` : t("hqForm.autoTitleNoSector", { frequency: freqLabel, period: computedPeriod });
    const current = form.getValues("title");
    if (current === "" || current === autoTitleRef.current) {
      form.setValue("title", auto);
      autoTitleRef.current = auto;
    }
  }, [v.sector, v.frequency, computedPeriod, form, t, isEditMode]);

  // ── Structured sections state ───────────────────────────────────────────────
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([emptySupport()]);
  const [stateObservations, setStateObservations] = useState<StateObservation[]>([]);
  const [technicalRatings, setTechnicalRatings] = useState<TechnicalRating[]>([]);
  const [indicatorComments, setIndicatorComments] = useState<IndicatorComment[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [createdReportId, setCreatedReportId] = useState<number | null>(null);
  const [pendingVoiceNote, setPendingVoiceNote] = useState<PendingNote | null>(null);

  // ── Risks state ─────────────────────────────────────────────────────────────
  const [linkedRiskIds, setLinkedRiskIds] = useState<number[]>([]);
  const [createRiskOpen, setCreateRiskOpen] = useState(false);
  const [newRiskDraft, setNewRiskDraft] = useState<NewRiskDraft>(emptyNewRisk());
  const [creatingRisk, setCreatingRisk] = useState(false);

  // ── Edit-mode hydration (HQSR-005) ─────────────────────────────────────────
  // Populate all form + local state from the existing report exactly once.
  // Identity fields (sector/frequency/period) are hydrated for DISPLAY only —
  // their controls are locked in edit mode and never sent in the PATCH body.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (!existingReport || hydratedRef.current) return;
    hydratedRef.current = true;
    
    const r = existingReport as unknown as Record<string, unknown>;
    const sections = (r.sections ?? {}) as Record<string, unknown>;
    const str = (val: unknown) => (typeof val === "string" ? val : "");
    const arr = (val: unknown) => (Array.isArray(val) ? val : []);
    const kind = str(r.kind) || str(sections.frequency) || "monthly";
    const frequency: Frequency = (["monthly", "quarterly", "annual", "on_demand"] as const)
      .includes(kind as Frequency) ? (kind as Frequency) : "monthly";
    // Quarter: prefer sections.quarter, else parse "YYYY-Qn" period
    const periodStr = str(r.period);
    const parsedQuarter = /-Q([1-4])/.exec(periodStr)?.[1];
    const dateOnly = (val: unknown) => { const s = str(val); return s.length > 10 ? s.slice(0, 10) : s; };
    // On-demand period bounds live in sections (periodStart/End) with a
    // top-level fallback for older rows.
    const periodStart = dateOnly(sections.periodStart) || dateOnly(r.periodStart);
    const periodEnd = dateOnly(sections.periodEnd) || dateOnly(r.periodEnd);

    form.reset({
      sector: str(r.sector),
      frequency,
      reportingMonth: (r.reportingMonth as number | null) ?? (new Date().getMonth() + 1),
      reportingYear: (r.reportingYear as number | null) ?? new Date().getFullYear(),
      quarter: sections.quarter != null ? Number(sections.quarter) : parsedQuarter ? Number(parsedQuarter) : 1,
      periodStart,
      periodEnd,
      onDemandReason: str(sections.onDemandReason),
      officerName: str(sections.officerName),
      title: str(r.title),
      technicalAnalysis: str(sections.technicalAnalysis),
      keyFindings: str(sections.keyFindings),
      qualityAssessment: str(sections.qualityAssessment),
      technicalChallenges: str(sections.technicalChallenges),
      recommendations: str(sections.recommendations),
      strategicPriorities: str(sections.strategicPriorities),
      lessonsLearned: str(sections.lessonsLearned),
      sectorOutlook: str(sections.sectorOutlook),
    });

    // Structured sections — safe defaults for absent/malformed content.
    const storedSupport = arr(sections.supportRequired) as Array<Record<string, unknown>>;
    if (storedSupport.length > 0 && typeof storedSupport[0] === "object") {
      setSupportRequests(storedSupport.map((s) => ({
        supportType: str(s.supportType), priority: str(s.priority) || "Medium", description: str(s.description),
      })));
    }
    const storedObs = arr(sections.stateObservations) as Array<Record<string, unknown>>;
    if (storedObs.length > 0) {
      setStateObservations(storedObs.map((o) => ({
        stateId: o.stateId != null && o.stateId !== "" && Number.isFinite(Number(o.stateId)) ? Number(o.stateId) : "",
        technicalObservation: str(o.technicalObservation),
        qualityConcern: str(o.qualityConcern),
        goodPractice: str(o.goodPractice),
        actionRequired: str(o.actionRequired),
      })));
    }
    const storedRatings = arr(sections.technicalRatings) as Array<Record<string, unknown>>;
    if (storedRatings.length > 0) {
      setTechnicalRatings(storedRatings.map((rt) => ({
        entityType: str(rt.entityType) === "project" ? "project" : "state",
        entityLabel: str(rt.entityLabel),
        rating: str(rt.rating) || "Good",
        reason: str(rt.reason),
      })));
    }
    const storedIndComments = arr(sections.indicatorCommentary) as Array<Record<string, unknown>>;
    if (storedIndComments.length > 0) {
      setIndicatorComments(storedIndComments.map((c) => ({
        indicatorName: str(c.indicatorName), commentary: str(c.commentary),
      })));
    }
    // Linked register risks: restore the checked ids from the stored risk items.
    const storedRisks = arr(sections.risks) as Array<Record<string, unknown>>;
    if (storedRisks.length > 0) {
      setLinkedRiskIds(storedRisks.map((k) => Number(k.id)).filter(Number.isFinite));
    }
    // Existing attachments: shown as already-uploaded (no re-upload), kept in the payload.
    const storedAttachments = arr(sections.attachments) as Array<Record<string, unknown>>;
    if (storedAttachments.length > 0) {
      setAttachments(storedAttachments.map((d, i): Attachment => ({
        tempId: `existing-${i}`,
        fileName: str(d.fileName),
        contentType: str(d.contentType),
        size: Number(d.size ?? 0),
        objectPath: str(d.objectPath),
        attachmentId: d.attachmentId != null ? Number(d.attachmentId) : undefined,
        attachmentType: str(d.attachmentType) || "Other",
      })));
    }
  }, [existingReport, form]);

  const localSnapshot = useMemo(() => ({
    values: v,
    supportRequests,
    stateObservations,
    technicalRatings,
    indicatorComments,
    linkedRiskIds,
    // Only already-uploaded metadata is durable. Local files and voice notes
    // stay online-only by design.
    attachments: attachments.filter((attachment) => !attachment.uploading && !attachment.file),
  }), [
    attachments, indicatorComments, linkedRiskIds, stateObservations,
    supportRequests, technicalRatings, v,
  ]);
  const restoreLocalSnapshot = useCallback((snapshot: typeof localSnapshot) => {
    const permittedStates = new Set(states.map((state) => state.id));
    form.reset({
      ...snapshot.values,
      sector: userSectors.includes(snapshot.values.sector) ? snapshot.values.sector : "",
    });
    setSupportRequests(snapshot.supportRequests?.length ? snapshot.supportRequests : [emptySupport()]);
    setStateObservations((snapshot.stateObservations ?? []).filter((row) =>
      !row.stateId || permittedStates.has(Number(row.stateId)),
    ));
    setTechnicalRatings(snapshot.technicalRatings ?? []);
    setIndicatorComments(snapshot.indicatorComments ?? []);
    setLinkedRiskIds(snapshot.linkedRiskIds ?? []);
    setAttachments(snapshot.attachments ?? []);
  }, [form, states, userSectors]);
  const existingRevisionValue = (existingReport as unknown as { updatedAt?: unknown } | undefined)?.updatedAt;
  const existingBaseRevision = existingRevisionValue instanceof Date
    ? existingRevisionValue.toISOString()
    : typeof existingRevisionValue === "string" ? existingRevisionValue : null;
  const localDraft = useOfflineReportDraft({
    draftKey: reportDraftKey("hq_sector", existingReport ? `server:${existingReport.id}` : "new"),
    reportType: "hq_sector",
    serverReportId: existingReport?.id ?? null,
    baseRevision: existingBaseRevision,
    title: v.title,
    snapshot: localSnapshot,
    onRestore: restoreLocalSnapshot,
    enabled: statesData !== undefined && Boolean(me?.user),
  });

  // ── Dirty-form tracking (page-level pattern from reports.tsx) ──────────────
  // Enabled one tick after mount so hydration/auto-fill never counts as dirty.
  const dirtyReadyRef = useRef(false);
  useEffect(() => {
    const timer = setTimeout(() => { dirtyReadyRef.current = true; }, 0);
    return () => clearTimeout(timer);
  }, []);
  const markDirty = () => { if (dirtyReadyRef.current) onDirtyChange?.(true); };
  // Field-level dirtiness: RHF tracks it natively; reset() (hydration) clears it,
  // so hydration itself never marks the form dirty.
  const { isDirty: rhfDirty } = form.formState;
  useEffect(() => {
    if (rhfDirty) markDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rhfDirty]);
  const firstStructuredRunRef = useRef(true);
  useEffect(() => {
    if (firstStructuredRunRef.current) { firstStructuredRunRef.current = false; return; }
    markDirty();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supportRequests, stateObservations, technicalRatings, indicatorComments, attachments, linkedRiskIds]);

  // Returned-for-revision (HQSR-005): a draft whose approval history contains a
  // revision action was sent back by a reviewer.
  const isReturnedForRevision = isEditMode &&
    existingReport?.status === "draft" &&
    (existingReport.approvalHistory ?? []).some((h) => String(h.action ?? "").includes("revision"));

  // Auto-load existing sector risks
  const { data: sectorRisks = [], isLoading: sectorRisksLoading, refetch: refetchRisks } = useQuery<ExistingRisk[]>({
    queryKey: ["sector-risks", v.sector],
    queryFn: async () => {
      if (!v.sector) return [];
      const res = await fetch(`/api/risks?sector=${encodeURIComponent(v.sector)}`);
      if (!res.ok) return [];
      return res.json() as Promise<ExistingRisk[]>;
    },
    enabled: !!v.sector,
    staleTime: 30_000,
  });

  // The sector is restored before its scoped risk query can run. Once that
  // authorised reference list has loaded, remove links no longer visible to
  // this user instead of retaining stale IDs from the browser snapshot.
  useEffect(() => {
    if (!v.sector || sectorRisksLoading) return;
    const permittedRiskIds = new Set(sectorRisks.map((risk) => risk.id));
    setLinkedRiskIds((current) => current.filter((id) => permittedRiskIds.has(id)));
  }, [sectorRisks, sectorRisksLoading, v.sector]);

  function toggleRiskLink(id: number) {
    setLinkedRiskIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleCreateRisk() {
    if (!newRiskDraft.title.trim()) { toast.error(t("hqForm.errRiskTitleRequired")); return; }
    if (!newRiskDraft.stateId) { toast.error(t("hqForm.errRiskStateRequired")); return; }
    setCreatingRisk(true);
    try {
      const res = await fetch("/api/risks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newRiskDraft.title.trim(),
          category: newRiskDraft.category,
          severity: newRiskDraft.severity,
          likelihood: newRiskDraft.likelihood,
          stateId: Number(newRiskDraft.stateId),
          description: newRiskDraft.description.trim() || undefined,
          mitigationPlan: newRiskDraft.mitigationPlan.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string }).error ?? "Failed to create risk");
      }
      const created = await res.json() as { id: number };
      toast.success(t("hqForm.riskCreated", { title: newRiskDraft.title }));
      setCreateRiskOpen(false);
      setNewRiskDraft(emptyNewRisk());
      await refetchRisks();
      qc.invalidateQueries({ queryKey: ["risks"] });
      setLinkedRiskIds((prev) => [...prev, created.id]);
    } catch (e) {
      toast.error(String(e instanceof Error ? e.message : e));
    } finally {
      setCreatingRisk(false);
    }
  }

  function updateSupport(i: number, patch: Partial<SupportRequest>) {
    setSupportRequests((c) => c.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function updateObs(i: number, patch: Partial<StateObservation>) {
    setStateObservations((c) => c.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function updateRating(i: number, patch: Partial<TechnicalRating>) {
    setTechnicalRatings((c) => c.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function updateIndComment(i: number, patch: Partial<IndicatorComment>) {
    setIndicatorComments((c) => c.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }

  // Files are kept in memory until the report exists. They are then registered
  // through the report-owned storage contract, never the legacy Drive façade.
  async function uploadFile(file: File) {
    const tempId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setAttachments((d) => [...d, {
      tempId, fileName: file.name, contentType: file.type || "application/octet-stream",
      size: file.size, objectPath: "", attachmentType: "Other", file,
    }]);
  }

  async function registerPendingAttachments(reportId: number) {
    const pending = attachments.filter((attachment) => attachment.file);
    for (const attachment of pending) {
      const file = attachment.file!;
      const descriptor = await fetch("/api/storage/uploads/request-url", {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: file.name, size: file.size, contentType: file.type || "application/octet-stream", reportId, entityType: "attachment" }),
      });
      if (!descriptor.ok) throw new Error(t("hqForm.uploadFailed", { error: "Could not prepare upload." }));
      const { uploadURL, uploadToken } = await descriptor.json() as { uploadURL: string; uploadToken: string };
      const put = await fetch(uploadURL, { method: "PUT", body: file, headers: { "Content-Type": file.type || "application/octet-stream" } });
      if (!put.ok) throw new Error(t("hqForm.uploadFailed", { error: "The file could not be uploaded." }));
      const registered = await fetch(`/api/reports/${reportId}/attachments`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: file.name, uploadToken, attachmentType: attachment.attachmentType }),
      });
      if (!registered.ok) throw new Error(t("hqForm.uploadFailed", { error: "The file could not be finalised." }));
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

  // Payload builder — submitMode=true enforces support validation
  function buildPayload(values: BasicValues, submitMode: boolean) {
    if (!values.sector) { toast.error(t("hqForm.errSelectSector")); return null; }
    if (values.frequency === "on_demand") {
      if (!values.periodStart) { toast.error(t("hqForm.errPeriodStartRequired")); return null; }
      if (!values.periodEnd) { toast.error(t("hqForm.errPeriodEndRequired")); return null; }
      if (!values.onDemandReason) { toast.error(t("hqForm.errReasonRequired")); return null; }
    }
    if (!values.title.trim()) { toast.error(t("hqForm.errTitleRequired")); return null; }
    if (!values.technicalAnalysis.trim()) { toast.error(t("hqForm.errTechnicalAnalysisRequired")); return null; }
    if (!values.keyFindings.trim()) { toast.error(t("hqForm.errKeyFindingsRequired")); return null; }
    if (!values.qualityAssessment.trim()) { toast.error(t("hqForm.errQualityAssessmentRequired")); return null; }
    if (!values.technicalChallenges.trim()) { toast.error(t("hqForm.errTechChallengesRequired")); return null; }
    if (!values.recommendations.trim()) { toast.error(t("hqForm.errRecommendationsRequired")); return null; }
    if (!values.strategicPriorities.trim()) { toast.error(t("hqForm.errStrategicPrioritiesRequired")); return null; }
    if (!values.lessonsLearned.trim()) { toast.error(t("hqForm.errLessonsLearnedRequired")); return null; }
    if (!values.sectorOutlook.trim()) { toast.error(t("hqForm.errSectorOutlookRequired")); return null; }

    const cleanSupport = supportRequests.filter((r) => r.supportType && r.description.trim());
    if (submitMode && cleanSupport.length === 0) {
      toast.error(t("hqForm.errSupportRequired"));
      return null;
    }

    const cleanObs = stateObservations.filter((o) => o.stateId !== "" && o.technicalObservation.trim());
    const cleanRatings = technicalRatings.filter((r) => r.entityLabel.trim() && r.reason.trim());
    const cleanIndComments = indicatorComments.filter((c) => c.indicatorName.trim());
    const cleanAttachments = attachments.filter((d) => d.attachmentId || d.objectPath).map(({ tempId: _t, uploading: _u, file: _file, ...rest }) => rest);

    // Build risks from linked existing risks
    const linkedRiskItems = sectorRisks
      .filter((r) => linkedRiskIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        severity: r.severity,
        description: r.mitigationPlan || "",
        riskStatus: r.status,
      }));

    let period: string;
    let reportingMonthVal: number | undefined;
    if (values.frequency === "quarterly") {
      period = `${values.reportingYear}-Q${values.quarter}`;
    } else if (values.frequency === "annual") {
      period = String(values.reportingYear);
    } else if (values.frequency === "on_demand") {
      period = `${values.periodStart} to ${values.periodEnd}`;
    } else {
      reportingMonthVal = values.reportingMonth;
      period = `${values.reportingYear}-${String(values.reportingMonth).padStart(2, "0")}`;
    }

    // HQSR-004: The create payload must NEVER include top-level stateId or
    // projectId — HQ Sector Reports carry no State/Project linkage (the server
    // rejects non-null values with 422 hq_sector_location_invalid). State IDs
    // below appear only inside content fields (state observations, risk state).
    return {
      reportType: "hq_sector" as const,
      title: values.title.trim(),
      sector: values.sector,
      reportingMonth: reportingMonthVal,
      reportingYear: values.reportingYear,
      sections: {
        frequency: values.frequency,
        quarter: values.frequency === "quarterly" ? values.quarter : undefined,
        periodStart: values.frequency === "on_demand" ? values.periodStart : undefined,
        periodEnd: values.frequency === "on_demand" ? values.periodEnd : undefined,
        onDemandReason: values.frequency === "on_demand" ? values.onDemandReason : undefined,
        period,
        officerName: values.officerName.trim(),
        technicalAnalysis: values.technicalAnalysis.trim(),
        keyFindings: values.keyFindings.trim(),
        qualityAssessment: values.qualityAssessment.trim(),
        technicalChallenges: values.technicalChallenges.trim(),
        recommendations: values.recommendations.trim(),
        strategicPriorities: values.strategicPriorities.trim(),
        lessonsLearned: values.lessonsLearned.trim(),
        sectorOutlook: values.sectorOutlook.trim(),
        supportRequired: cleanSupport,
        stateObservations: cleanObs,
        technicalRatings: cleanRatings,
        risks: linkedRiskItems,
        indicatorCommentary: cleanIndComments,
        attachments: cleanAttachments,
      },
    };
  }

  // ── Content-only PATCH payload (HQSR-005) ───────────────────────────────────
  // Built directly from current form values and local state — NOT via buildPayload.
  // Reasons:
  //   1. Draft saves must not hard-validate like submits do; the HQSR-003
  //      submit validator applies on the submit transition, not on every PATCH.
  //   2. Identity fields (reportType/sector/kind/period/reportingMonth/Year/
  //      quarter/periodStart/periodEnd) are immutable server-side (HQSR-002)
  //      and MUST be absent from the body — a present key is rejected with 409.
  //   3. HQSR-004: stateId/projectId are never sent — HQ Sector Reports carry
  //      no State/Project linkage.
  // Note: sections.* keys (frequency/quarter/period/...) mirror the create
  // payload from the LOCKED form values so the JSONB shape survives the PATCH
  // unchanged — the whole sections object is replaced server-side.
  function buildPatchPayload(values: BasicValues) {
    const cleanSupport = supportRequests.filter((r) => r.supportType && r.description.trim());
    const cleanObs = stateObservations.filter((o) => o.stateId !== "" && o.technicalObservation.trim());
    const cleanRatings = technicalRatings.filter((r) => r.entityLabel.trim() && r.reason.trim());
    const cleanIndComments = indicatorComments.filter((c) => c.indicatorName.trim());
    const cleanAttachments = attachments.filter((d) => d.attachmentId || d.objectPath).map(({ tempId: _t, uploading: _u, file: _file, ...rest }) => rest);
    const linkedRiskItems = sectorRisks
      .filter((r) => linkedRiskIds.includes(r.id))
      .map((r) => ({
        id: r.id,
        category: r.category,
        title: r.title,
        severity: r.severity,
        description: r.mitigationPlan || "",
        riskStatus: r.status,
      }));
    // Fallback (edit mode): preserve previously stored risk items whose ids are
    // still selected but not present in the (possibly not-yet-loaded) register
    // query — a quick Save Draft must not silently drop stored risks.
    const storedSections = ((existingReport as unknown as Record<string, unknown> | undefined)?.sections ?? {}) as Record<string, unknown>;
    const storedRiskItems = (Array.isArray(storedSections.risks) ? storedSections.risks : []) as Array<{ id?: number } & Record<string, unknown>>;
    const presentIds = new Set(linkedRiskItems.map((r) => r.id));
    const preservedRisks = storedRiskItems.filter((r) =>
      typeof r.id === "number" && linkedRiskIds.includes(r.id) && !presentIds.has(r.id));
    const allRiskItems = [...linkedRiskItems, ...preservedRisks];

    let period: string;
    if (values.frequency === "quarterly") period = `${values.reportingYear}-Q${values.quarter}`;
    else if (values.frequency === "annual") period = String(values.reportingYear);
    else if (values.frequency === "on_demand") period = `${values.periodStart} to ${values.periodEnd}`;
    else period = `${values.reportingYear}-${String(values.reportingMonth).padStart(2, "0")}`;

    return {
      title: values.title.trim(),
      sections: {
        frequency: values.frequency,
        quarter: values.frequency === "quarterly" ? values.quarter : undefined,
        periodStart: values.frequency === "on_demand" ? values.periodStart : undefined,
        periodEnd: values.frequency === "on_demand" ? values.periodEnd : undefined,
        onDemandReason: values.frequency === "on_demand" ? values.onDemandReason : undefined,
        period,
        officerName: values.officerName.trim(),
        technicalAnalysis: values.technicalAnalysis.trim(),
        keyFindings: values.keyFindings.trim(),
        qualityAssessment: values.qualityAssessment.trim(),
        technicalChallenges: values.technicalChallenges.trim(),
        recommendations: values.recommendations.trim(),
        strategicPriorities: values.strategicPriorities.trim(),
        lessonsLearned: values.lessonsLearned.trim(),
        sectorOutlook: values.sectorOutlook.trim(),
        supportRequired: cleanSupport,
        stateObservations: cleanObs,
        technicalRatings: cleanRatings,
        risks: allRiskItems,
        indicatorCommentary: cleanIndComments,
        attachments: cleanAttachments,
      },
      // Do NOT include: reportType, sector, kind, period, reportingMonth,
      // reportingYear, quarter, periodStart, periodEnd, stateId, projectId,
      // workflow_path — identity is immutable (HQSR-002) and location linkage
      // is forbidden (HQSR-004).
    };
  }

  async function patchExistingReport(values: BasicValues, syncOperationId?: string | null): Promise<boolean> {
    const reportId = existingReport?.id ?? createdReportId;
    if (!reportId) return false;
    const patch = {
      ...buildPatchPayload(values),
      _draftKey: localDraft.storageKey,
      _syncOperationId: syncOperationId,
    };
    const res = await fetch(`/api/reports/${reportId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(existingBaseRevision ? { "x-base-revision": existingBaseRevision } : {}),
      },
      credentials: "include",
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: string; message?: string };
      throw new Error(err.message ?? err.error ?? "Failed to save changes");
    }
    return true;
  }

  const [isSaving, setIsSaving] = useState(false);

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
    setIsSaving(true);
    try {
      if ((isEditMode && existingReport) || createdReportId) {
        // HQSR-005: PATCH the same report id — never POST a duplicate.
        if (!(await patchExistingReport(values, offlineOperationId))) return;
        await registerPendingAttachments(existingReport?.id ?? createdReportId!);
        toast.success(t("hqForm.draftUpdated"));
        qc.invalidateQueries();
        onDirtyChange?.(false);
        await localDraft.remove();
        return; // stay in edit mode — same identity, same reportId
      }
      const builtPayload = buildPayload(values, false);
      if (!builtPayload) { if (offlineOperationId) await localDraft.saveNow(); return; }
      const payload = { ...builtPayload, _draftKey: localDraft.storageKey, _syncOperationId: offlineOperationId };
      const created = await createMutation.mutateAsync({ data: payload as never });
      setCreatedReportId(created.id);
      await registerPendingAttachments(created.id);
      toast.success(t("hqForm.draftSaved"));
      qc.invalidateQueries();
      await localDraft.remove();
      onClose();
    } catch (e: unknown) {
      if (isOfflineQueuedError(e)) {
        toast.info(t("sync.draftQueuedOnDevice", { ns: "common" }));
        onDirtyChange?.(false);
        onClose();
        return;
      }
      if (offlineOperationId) await localDraft.saveNow();
      toast.error((e as Error).message);
    }
    finally { setIsSaving(false); }
  });

  const onSubmitReport = form.handleSubmit(async (values) => {
    if (!isOnline) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    setIsSaving(true);
    try {
      let reportId: number;
      if ((isEditMode && existingReport) || createdReportId) {
        // HQSR-005: PATCH latest content first; if it fails, do NOT transition.
        try {
          if (!(await patchExistingReport(values))) return;
        } catch (patchErr: unknown) {
          toast.error(t("hqForm.errSaveBeforeSubmit", { message: (patchErr as Error).message }));
          return; // abort — the report stays a Draft with its previous content
        }
        reportId = existingReport?.id ?? createdReportId!;
      } else {
        const builtPayload = buildPayload(values, true);
        if (!builtPayload) return;
        const payload = { ...builtPayload, _draftKey: localDraft.storageKey };
        const created = await createMutation.mutateAsync({ data: payload as never });
        reportId = created.id;
        setCreatedReportId(created.id);
      }
      await registerPendingAttachments(reportId);
      if (pendingVoiceNote) {
        try { await uploadVoiceNoteForReport(pendingVoiceNote, reportId); }
        catch { toast.warning(t("hqForm.voiceNoteUploadFailed")); }
      }
      // HQSR-003 submit validator remains authoritative server-side: a 422
      // leaves the report in Draft with the content already saved above.
      await transitionMutation.mutateAsync({ reportId, data: { action: "submit", comment: isEditMode ? "Resubmission" : "Initial submission" } });
      toast.success(t("hqForm.reportSubmitted"));
      qc.invalidateQueries();
      onDirtyChange?.(false);
      await localDraft.remove();
      onClose();
    } catch (e: unknown) { toast.error((e as Error).message); }
    finally { setIsSaving(false); }
  });

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <form className="space-y-6">
        <div className="border-b pb-3">
          <h3 className="text-lg font-semibold">
            {isReturnedForRevision
              ? t("hqForm.titleRevise")
              : isEditMode
                ? t("hqForm.titleEdit")
                : t("hqForm.formTitle")}
          </h3>
          <p className="text-sm text-muted-foreground">
            {isEditMode
              ? t("hqForm.formDescEdit")
              : t("hqForm.formDesc")}
          </p>
          {localDraft.hasLocalDraft && (
            <OfflineReportDraftStatus
              status={localDraft.status}
              savedAt={localDraft.stored?.lastSavedAt}
              error={localDraft.stored?.lastError}
              onDiscard={() => { void localDraft.remove(); onClose(); }}
              className="mt-2"
            />
          )}
          {!isOnline && (
            <p id="hq-offline-workflow-notice" role="alert" className="mt-3 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/20 dark:text-amber-200">
              <span className="font-medium">{t("sync.internetRequired", { ns: "common" })}.</span>{" "}
              {t("sync.internetRequiredDescription", { ns: "common" })}
            </p>
          )}
        </div>

        {/* ── Returned-for-revision banner (HQSR-005) ─────────────────────────── */}
        {isReturnedForRevision && existingReport && (
          <div role="alert" className="rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/40 p-3 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{t("hqForm.returnedForRevision")}</p>
                <p className="text-xs text-amber-700 dark:text-amber-400">{t("hqForm.revisionFeedbackHint")}</p>
              </div>
            </div>
            {/* Generic comments panel — no SPR section taxonomy (SPR-010 is SPR-specific). */}
            <CommentsPanel
              entityType="report"
              entityId={existingReport.id}
              readOnly={!hasPerm(me?.permissions ?? [], "comments.create")}
              currentUserId={me?.user?.id ?? null}
              currentUserRole={me?.user?.role ?? null}
            />
          </div>
        )}

        {/* ── SECTION 1: REPORT INFORMATION ───────────────────────────────────── */}
        <section id="rp-section-basic" className="space-y-3">
          <h4 className="text-sm font-semibold border-b pb-1">{t("hqForm.section1Title")}</h4>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>{t("hqForm.sectorLabel")}
                {me?.user?.role === "technical_coordinator" && (
                  <span className="text-xs font-normal text-muted-foreground ms-1">{t("hqForm.sectorFromAssigned")}</span>
                )}
              </Label>
              {isEditMode ? (
                // Identity is immutable in edit mode (HQSR-002) — display only.
                <Input value={v.sector} readOnly aria-readonly="true" className="bg-muted cursor-not-allowed" />
              ) : (
                <Select value={v.sector} onValueChange={(val) => form.setValue("sector", val)}>
                  <SelectTrigger><SelectValue placeholder={t("hqForm.sectorPlaceholder")} /></SelectTrigger>
                  <SelectContent>{userSectors.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              )}
            </div>

            <div>
              <Label>{t("hqForm.techCoordinatorLabel")}</Label>
              <Input {...form.register("officerName")} placeholder={t("hqForm.techCoordinatorPlaceholder")} />
            </div>

            <div className="col-span-2">
              <Label>{t("hqForm.frequencyLabel")} <span className="text-destructive">*</span>
                {isEditMode && <span className="text-xs font-normal text-muted-foreground ms-1">{t("hqForm.locked")}</span>}
              </Label>
              <Select value={v.frequency} onValueChange={(val) => { if (val) form.setValue("frequency", val as Frequency); }} disabled={isEditMode}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="monthly">{t("frequency.monthly")}</SelectItem>
                  <SelectItem value="quarterly">{t("frequency.quarterly")}</SelectItem>
                  <SelectItem value="annual">{t("frequency.annual")}</SelectItem>
                  <SelectItem value="on_demand">{t("frequency.on_demand")}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {v.frequency === "monthly" && (
              <>
                <div>
                  <Label>{t("hqForm.monthLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={String(v.reportingMonth)} onValueChange={(val) => form.setValue("reportingMonth", Number(val))} disabled={isEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                        <SelectItem key={m} value={String(m)}>{new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: "long" })}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("hqForm.yearLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))} disabled={isEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
            {v.frequency === "quarterly" && (
              <>
                <div>
                  <Label>{t("hqForm.quarterLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={String(v.quarter)} onValueChange={(val) => form.setValue("quarter", Number(val))} disabled={isEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{[1,2,3,4].map((q) => <SelectItem key={q} value={String(q)}>Q{q} ({["Jan–Mar","Apr–Jun","Jul–Sep","Oct–Dec"][q-1]})</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>{t("hqForm.yearLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))} disabled={isEditMode}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}
            {v.frequency === "annual" && (
              <div className="col-span-2">
                <Label>{t("hqForm.yearLabel")} <span className="text-destructive">*</span></Label>
                <Select value={String(v.reportingYear)} onValueChange={(val) => form.setValue("reportingYear", Number(val))} disabled={isEditMode}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{yearOptions.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            )}
            {v.frequency === "on_demand" && (
              <>
                <div>
                  <Label>{t("hqForm.startDateLabel")} <span className="text-destructive">*</span></Label>
                  <Input type="date" {...form.register("periodStart")} readOnly={isEditMode} aria-readonly={isEditMode || undefined} className={isEditMode ? "bg-muted cursor-not-allowed" : undefined} />
                </div>
                <div>
                  <Label>{t("hqForm.endDateLabel")} <span className="text-destructive">*</span></Label>
                  <Input type="date" {...form.register("periodEnd")} readOnly={isEditMode} aria-readonly={isEditMode || undefined} className={isEditMode ? "bg-muted cursor-not-allowed" : undefined} />
                </div>
                <div className="col-span-2">
                  <Label>{t("hqForm.reasonLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={v.onDemandReason} onValueChange={(val) => form.setValue("onDemandReason", val)}>
                    <SelectTrigger><SelectValue placeholder={t("hqForm.reasonPlaceholder")} /></SelectTrigger>
                    <SelectContent>{ON_DEMAND_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div className="col-span-2">
              <Label>{t("hqForm.reportTitleLabel")} <span className="text-destructive">*</span></Label>
              <Input
                {...form.register("title")}
                placeholder={t("hqForm.reportTitlePlaceholder")}
                onFocus={() => { autoTitleRef.current = ""; }}
              />
            </div>
          </div>
        </section>

        {/* ── SECTION 2: SECTOR PERFORMANCE SNAPSHOT (auto-generated) ────────── */}
        {v.sector && (
          <section id="rp-section-progress" className="space-y-3">
            <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("hqForm.section2Title")}
              <span className="text-xs font-normal text-muted-foreground">{t("hqForm.section2AutoGenerated")}</span>
            </h4>
            <SectorSnapshotSection sector={v.sector} />
          </section>
        )}

        {/* ── SECTION 3: TECHNICAL ANALYSIS ──────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec3-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section3Title")}</h4>
          <Textarea rows={5} {...form.register("technicalAnalysis")} aria-labelledby="hqsr-sec3-heading"
            placeholder={t("hqForm.techAnalysisPlaceholder")} />
        </section>

        {/* ── SECTION 4: KEY FINDINGS ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec4-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section4Title")}</h4>
          <Textarea rows={4} {...form.register("keyFindings")} aria-labelledby="hqsr-sec4-heading"
            placeholder={t("hqForm.keyFindingsPlaceholder")} />
        </section>

        {/* ── SECTION 5: QUALITY ASSESSMENT ──────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec5-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section5Title")}</h4>
          <Textarea rows={4} {...form.register("qualityAssessment")} aria-labelledby="hqsr-sec5-heading"
            placeholder={t("hqForm.qualityAssessmentPlaceholder")} />
        </section>

        {/* ── SECTION 6: TECHNICAL CHALLENGES ────────────────────────────────── */}
        <section id="rp-section-challenges" className="space-y-3">
          <h4 id="hqsr-sec6-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section6Title")}</h4>
          <Textarea rows={4} {...form.register("technicalChallenges")} aria-labelledby="hqsr-sec6-heading"
            placeholder={t("hqForm.techChallengesPlaceholder")} />
        </section>

        {/* ── SECTION 7: RECOMMENDATIONS ──────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec7-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section7Title")}</h4>
          <Textarea rows={4} {...form.register("recommendations")} aria-labelledby="hqsr-sec7-heading"
            placeholder={t("hqForm.recommendationsPlaceholder")} />
        </section>

        {/* ── SECTION 8: STATE TECHNICAL OBSERVATIONS ──────────────────────────── */}
        <section id="rp-section-activities" className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section8Title")}</h4>
            <Button type="button" size="sm" variant="outline" onClick={() => setStateObservations((c) => [...c, emptyObservation()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addState")}
            </Button>
          </div>
          {stateObservations.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("hqForm.noStateObservations")}
            </p>
          )}
          {stateObservations.map((o, i) => (
            <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.stateObservationHash", { num: i + 1 })}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setStateObservations((c) => c.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" />
                </Button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="col-span-2">
                  <Label className="text-xs">{t("hqForm.stateLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={String(o.stateId || "")} onValueChange={(val) => updateObs(i, { stateId: Number(val) })}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={t("hqForm.statePlaceholder")} /></SelectTrigger>
                    <SelectContent>{states.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("hqForm.techObservationLabel")} <span className="text-destructive">*</span></Label>
                  <Textarea rows={2} value={o.technicalObservation} onChange={(e) => updateObs(i, { technicalObservation: e.target.value })} placeholder={t("hqForm.techObservationPlaceholder")} />
                </div>
                <div>
                  <Label className="text-xs">{t("hqForm.qualityConcernLabel")}</Label>
                  <Textarea rows={2} value={o.qualityConcern} onChange={(e) => updateObs(i, { qualityConcern: e.target.value })} placeholder={t("hqForm.qualityConcernPlaceholder")} />
                </div>
                <div>
                  <Label className="text-xs">{t("hqForm.goodPracticeLabel")}</Label>
                  <Textarea rows={2} value={o.goodPractice} onChange={(e) => updateObs(i, { goodPractice: e.target.value })} placeholder={t("hqForm.goodPracticePlaceholder")} />
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("hqForm.actionRequiredLabel")}</Label>
                  <Input value={o.actionRequired} onChange={(e) => updateObs(i, { actionRequired: e.target.value })} placeholder={t("hqForm.actionRequiredPlaceholder")} className="h-8" />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 9: TECHNICAL RATINGS ───────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section9Title")}</h4>
            <Button type="button" size="sm" variant="outline" onClick={() => setTechnicalRatings((c) => [...c, emptyRating()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addRating")}
            </Button>
          </div>
          {technicalRatings.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("hqForm.noRatings")}
            </p>
          )}
          {technicalRatings.map((r, i) => (
            <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.ratingHash", { num: i + 1 })}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setTechnicalRatings((c) => c.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" />
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <Label className="text-xs">{t("hqForm.typeLabel")}</Label>
                  <Select value={r.entityType} onValueChange={(val) => updateRating(i, { entityType: val as "state" | "project" })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="state">{t("hqForm.colState")}</SelectItem>
                      <SelectItem value="project">{t("hqForm.colProject")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{r.entityType === "state" ? t("hqForm.stateNameLabel") : t("hqForm.projectCodeLabel")}</Label>
                  <Input value={r.entityLabel} onChange={(e) => updateRating(i, { entityLabel: e.target.value })} placeholder={r.entityType === "state" ? t("hqForm.stateNamePlaceholder") : t("hqForm.projectCodePlaceholder")} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t("hqForm.ratingLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={r.rating} onValueChange={(val) => updateRating(i, { rating: val })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{TECHNICAL_RATINGS.map((t_) => <SelectItem key={t_} value={t_}>{t_}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-3">
                  <Label className="text-xs">{t("hqForm.reasonForRatingLabel")} <span className="text-destructive">*</span></Label>
                  <Textarea rows={3} className="resize-y" value={r.reason} onChange={(e) => updateRating(i, { reason: e.target.value })} placeholder={t("hqForm.reasonForRatingPlaceholder")} />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 10: RISKS & ISSUES ──────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section10Title")}</h4>
            <Button type="button" size="sm" variant="outline" onClick={() => setCreateRiskOpen(true)}>
                <Plus className="h-3 w-3" /> {t("hqForm.createNewRisk")}
            </Button>
          </div>

          {/* Auto-loaded sector risks */}
          {!v.sector && (
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {t("hqForm.selectSectorForRisks")}
            </p>
          )}
          {v.sector && sectorRisksLoading && (
            <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
          )}
          {v.sector && !sectorRisksLoading && sectorRisks.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {t("hqForm.noRisksFound", { sector: v.sector })}
            </p>
          )}
          {v.sector && !sectorRisksLoading && sectorRisks.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                {t("hqForm.risksFound_other", { count: sectorRisks.length, sector: v.sector })}
              </p>
              <div className="rounded border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="px-2 py-1.5 w-8"></th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("hqForm.riskColRisk")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("hqForm.riskColCategory")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("hqForm.riskColSeverity")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("hqForm.riskColStatus")}</th>
                      <th className="px-2 py-1.5 text-start font-medium">{t("hqForm.riskColStateProject")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {sectorRisks.map((r) => (
                      <tr key={r.id} className={`hover:bg-muted/20 ${linkedRiskIds.includes(r.id) ? "bg-blue-50/60" : ""}`}>
                        <td className="px-2 py-2 text-center">
                          <Checkbox
                            checked={linkedRiskIds.includes(r.id)}
                            onCheckedChange={() => toggleRiskLink(r.id)}
                          />
                        </td>
                        <td className="px-2 py-2 font-medium max-w-xs">
                          <div className="flex items-center gap-1">
                            {linkedRiskIds.includes(r.id) && <Link2 className="h-3 w-3 text-blue-500 shrink-0" />}
                            <span className="truncate">{r.title}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground">{r.category}</td>
                        <td className="px-2 py-2">
                          <Badge className={`text-xs capitalize border ${severityClass(r.severity)}`}>{r.severity}</Badge>
                        </td>
                        <td className="px-2 py-2">
                          <Badge variant="outline" className="text-xs capitalize">{r.status}</Badge>
                        </td>
                        <td className="px-2 py-2 text-muted-foreground text-xs">
                          {r.stateName}{r.projectTitle ? ` / ${r.projectTitle.slice(0,20)}…` : ""}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {linkedRiskIds.length > 0 && (
                <p className="text-xs text-blue-600 mt-1.5 flex items-center gap-1">
                  <Link2 className="h-3.5 w-3.5" /> {t("hqForm.linkedRisks_other", { count: linkedRiskIds.length })}
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── SECTION 11: INDICATOR COMMENTARY ────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section11Title")} <span className="font-normal text-muted-foreground">{t("hqForm.section11Optional")}</span></h4>
            <Button type="button" size="sm" variant="outline" onClick={() => setIndicatorComments((c) => [...c, emptyIndComment()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addCommentary")}
            </Button>
          </div>
          {indicatorComments.length === 0 && <p className="text-xs text-muted-foreground">{t("hqForm.noCommentary")}</p>}
          {indicatorComments.map((c, i) => (
            <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.commentaryHash", { num: i + 1 })}</p>
                <Button type="button" size="sm" variant="ghost" onClick={() => setIndicatorComments((cur) => cur.filter((_, idx) => idx !== i))}>
                  <Trash2 className="h-3 w-3 text-red-600" />
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <div>
                  <Label className="text-xs">{t("hqForm.indicatorNameLabel")}</Label>
                  <Input value={c.indicatorName} onChange={(e) => updateIndComment(i, { indicatorName: e.target.value })} placeholder={t("hqForm.indicatorNamePlaceholder")} className="h-8" />
                </div>
                <div>
                  <Label className="text-xs">{t("hqForm.techCommentaryLabel")}</Label>
                  <Textarea rows={2} value={c.commentary} onChange={(e) => updateIndComment(i, { commentary: e.target.value })} placeholder={t("hqForm.techCommentaryPlaceholder")} />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 12: SUPPORT REQUIRED ────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section12Title")}</h4>
            <Button type="button" size="sm" variant="outline" onClick={() => setSupportRequests((c) => [...c, emptySupport()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addRequest")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">{t("hqForm.supportRequired")}</p>
          {supportRequests.map((r, i) => (
            <div key={i} className="rounded border p-3 space-y-2 bg-muted/10">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.requestHash", { num: i + 1 })}</p>
                {supportRequests.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setSupportRequests((c) => c.filter((_, idx) => idx !== i))}>
                    <Trash2 className="h-3 w-3 text-red-600" />
                  </Button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">{t("hqForm.supportTypeLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={r.supportType} onValueChange={(val) => updateSupport(i, { supportType: val })}>
                    <SelectTrigger className="h-8"><SelectValue placeholder={t("hqForm.supportTypePlaceholder")} /></SelectTrigger>
                    <SelectContent>{SUPPORT_TYPES.map((t_) => <SelectItem key={t_} value={t_}>{t_}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs">{t("hqForm.priorityLabel")} <span className="text-destructive">*</span></Label>
                  <Select value={r.priority} onValueChange={(val) => updateSupport(i, { priority: val })}>
                    <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label className="text-xs">{t("hqForm.descriptionLabel")} <span className="text-destructive">*</span></Label>
                  <Textarea rows={2} value={r.description} onChange={(e) => updateSupport(i, { description: e.target.value })} placeholder={t("hqForm.descriptionPlaceholder")} />
                </div>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 13: STRATEGIC PRIORITIES ────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec13-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section13Title")}</h4>
          <Textarea rows={4} {...form.register("strategicPriorities")} aria-labelledby="hqsr-sec13-heading"
            placeholder={t("hqForm.strategicPrioritiesPlaceholder")} />
        </section>

        {/* ── SECTION 14: LESSONS LEARNED ──────────────────────────────────────── */}
        <section id="rp-section-lessons" className="space-y-3">
          <h4 id="hqsr-sec14-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section14Title")}</h4>
          <Textarea rows={4} {...form.register("lessonsLearned")} aria-labelledby="hqsr-sec14-heading"
            placeholder={t("hqForm.lessonsLearnedPlaceholder")} />
        </section>

        {/* ── SECTION 15: SECTOR OUTLOOK ──────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec15-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section15Title")}</h4>
          <Textarea rows={4} {...form.register("sectorOutlook")} aria-labelledby="hqsr-sec15-heading"
            placeholder={t("hqForm.sectorOutlookPlaceholder")} />
        </section>

        {/* ── SECTION 16: SUPPORTING DOCUMENTS ───────────────────────────────── */}
        <section id="rp-section-attachments" className="space-y-3">
          <h4 className="text-sm font-semibold border-b pb-1">{t("hqForm.section16Title")}</h4>
          <div className="flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" /> {t("hqForm.attachFile")}
            </Button>
            <span className="text-xs text-muted-foreground">{t("hqForm.attachmentHint")}</span>
            <input ref={fileInputRef} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} multiple
              onChange={(e) => { Array.from(e.target.files ?? []).forEach(uploadFile); e.target.value = ""; }} />
          </div>
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((d) => (
                <li key={d.tempId} className="flex items-center gap-2 border rounded p-2 text-xs bg-muted/20">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="truncate flex-1" title={d.fileName}>{d.fileName}</span>
                  {d.uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : (
                    <>
                      <Select value={d.attachmentType} onValueChange={(val) => setAttachments((a) => a.map((x) => x.tempId === d.tempId ? { ...x, attachmentType: val } : x))}>
                        <SelectTrigger className="h-6 w-40 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>{ATTACHMENT_TYPES.map((t_) => <SelectItem key={t_} value={t_} className="text-xs">{t_}</SelectItem>)}</SelectContent>
                      </Select>
                      <button type="button" onClick={() => setAttachments((a) => a.filter((x) => x.tempId !== d.tempId))} className="text-muted-foreground hover:text-destructive flex-shrink-0">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── SECTION 17: VOICE NOTE ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold border-b pb-1">{t("hqForm.section17Title")} <span className="font-normal text-muted-foreground">{t("hqForm.section17Optional")}</span></h4>
          <FormVoiceRecorder value={pendingVoiceNote} onChange={setPendingVoiceNote} />
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
        <DialogFooter className="gap-2 flex-wrap">
          <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>{t("hqForm.cancel")}</Button>
          <Button type="button" variant="secondary" onClick={onSaveDraft} disabled={localDraft.status === "pending" || localDraft.status === "syncing" || isSaving} aria-busy={isSaving}>
                {isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} {t("hqForm.saveDraft")}
          </Button>
          <Button type="button" onClick={onSubmitReport} disabled={!isOnline || isSaving} aria-busy={isSaving} aria-describedby={!isOnline ? "hq-offline-workflow-notice" : undefined}>
                {isSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
            {t("hqForm.submitReport")}
          </Button>
        </DialogFooter>
      </form>

      {/* ── Create New Risk Dialog ──────────────────────────────────────────── */}
      <Dialog open={createRiskOpen} onOpenChange={setCreateRiskOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("hqForm.createRiskDialogTitle")}</DialogTitle>
          </DialogHeader>
          <p className="text-xs text-muted-foreground -mt-2">
            {t("hqForm.createRiskDialogDesc")}
          </p>
          <div className="space-y-3 pt-1">
            <div>
              <Label className="text-xs">{t("hqForm.riskTitleLabel")} <span className="text-destructive">*</span></Label>
              <Input value={newRiskDraft.title} onChange={(e) => setNewRiskDraft((d) => ({ ...d, title: e.target.value }))} placeholder={t("hqForm.riskTitlePlaceholder")} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">{t("hqForm.categoryLabel")}</Label>
                <Select value={newRiskDraft.category} onValueChange={(val) => setNewRiskDraft((d) => ({ ...d, category: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISK_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("hqForm.severityLabel")}</Label>
                <Select value={newRiskDraft.severity} onValueChange={(val) => setNewRiskDraft((d) => ({ ...d, severity: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="low">{t("hqForm.severityLow")}</SelectItem>
                    <SelectItem value="medium">{t("hqForm.severityMedium")}</SelectItem>
                    <SelectItem value="high">{t("hqForm.severityHigh")}</SelectItem>
                    <SelectItem value="critical">{t("hqForm.severityCritical")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("hqForm.likelihoodLabel")}</Label>
                <Select value={newRiskDraft.likelihood} onValueChange={(val) => setNewRiskDraft((d) => ({ ...d, likelihood: val }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{RISK_LIKELIHOODS.map((l) => <SelectItem key={l} value={l} className="capitalize">{l}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">{t("hqForm.stateLabel")} <span className="text-destructive">*</span></Label>
                <Select value={String(newRiskDraft.stateId || "")} onValueChange={(val) => setNewRiskDraft((d) => ({ ...d, stateId: Number(val) }))}>
                  <SelectTrigger><SelectValue placeholder={t("hqForm.statePlaceholder")} /></SelectTrigger>
                  <SelectContent>{states.map((s) => <SelectItem key={s.id} value={String(s.id)}><StateLabel state={s} /></SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">{t("hqForm.riskDescriptionLabel")}</Label>
              <Textarea rows={2} value={newRiskDraft.description} onChange={(e) => setNewRiskDraft((d) => ({ ...d, description: e.target.value }))} placeholder={t("hqForm.riskDescriptionPlaceholder")} />
            </div>
            <div>
              <Label className="text-xs">{t("hqForm.mitigationPlanLabel")}</Label>
              <Textarea rows={2} value={newRiskDraft.mitigationPlan} onChange={(e) => setNewRiskDraft((d) => ({ ...d, mitigationPlan: e.target.value }))} placeholder={t("hqForm.mitigationPlanPlaceholder")} />
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setCreateRiskOpen(false); setNewRiskDraft(emptyNewRisk()); }} disabled={creatingRisk}>{t("hqForm.cancel")}</Button>
            <Button onClick={handleCreateRisk} disabled={creatingRisk}>
                {creatingRisk ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              {t("hqForm.createAndLinkRisk")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Detail view (used in report sheet) ───────────────────────────────────────

function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asObj(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }

export function HqSectorSectionsView({ sections }: { sections: Record<string, unknown> }) {
  const { t } = useTranslation("reports");
  const frequency = asStr(sections.frequency) || "monthly";
  const quarter = sections.quarter as number | undefined;
  const officerName = asStr(sections.officerName);
  const freqLabel = frequency === "monthly"
    ? t("hqForm.freqMonthly")
    : frequency === "quarterly"
      ? quarter ? t("hqForm.freqQuarterlyQ", { quarter }) : t("hqForm.freqQuarterly")
      : frequency === "annual"
        ? t("hqForm.freqAnnual")
        : t("hqForm.freqOnDemand");

  const analysisFields: [string, string][] = [
    [t("hqForm.section3Title").replace(" *", ""), asStr(sections.technicalAnalysis)],
    [t("hqForm.section4Title").replace(" *", ""), asStr(sections.keyFindings)],
    [t("hqForm.section5Title").replace(" *", ""), asStr(sections.qualityAssessment)],
    [t("hqForm.section6Title").replace(" *", ""), asStr(sections.technicalChallenges)],
    [t("hqForm.section7Title").replace(" *", ""), asStr(sections.recommendations)],
    [t("hqForm.section13Title").replace(" *", ""), asStr(sections.strategicPriorities)],
    [t("hqForm.section14Title").replace(" *", ""), asStr(sections.lessonsLearned)],
    [t("hqForm.section15Title").replace(" *", ""), asStr(sections.sectorOutlook)],
    // backward-compat with old field names
    ["Achievements Summary", asStr(sections.achievementsSummary)],
    ["Sector Challenges", asStr(sections.sectorChallenges)],
    ["Mitigation Actions", asStr(sections.mitigationActions)],
    ["Support Required (legacy)", asStr(sections.supportRequired as string)],
  ].filter(([, val]) => typeof val === "string" && val.trim() && !Array.isArray(sections[val])) as [string, string][];

  const stateObs = asArr(sections.stateObservations) as Array<Record<string, unknown>>;
  const ratings = asArr(sections.technicalRatings) as Array<Record<string, unknown>>;
  const supportReqs = asArr(sections.supportRequired) as Array<Record<string, unknown>>;
  const reportRisks = asArr(sections.risks) as Array<Record<string, unknown>>;
  const indComments = asArr(sections.indicatorCommentary) as Array<Record<string, unknown>>;
  // sections.attachments is rendered via the secure Supporting Attachments block in reports.tsx; not rendered here.

  return (
    <div className="space-y-5">
      {/* Meta row */}
      <div className="rounded border p-3 bg-muted/20 text-xs space-y-1">
        {officerName && <p><strong className="text-foreground">{t("hqForm.viewTechCoordinator")}</strong> {officerName}</p>}
        <p><strong className="text-foreground">{t("hqForm.viewFrequency")}</strong> {freqLabel}</p>
        {asStr(sections.onDemandReason) && <p><strong className="text-foreground">{t("hqForm.viewReason")}</strong> {asStr(sections.onDemandReason)}</p>}
      </div>

      {/* Analysis narrative fields */}
      {analysisFields.map(([label, val]) => (
        <div key={label}>
          <h4 className="text-sm font-medium text-foreground mb-2">{label}</h4>
          <p className="text-sm whitespace-pre-wrap">{val}</p>
        </div>
      ))}

      {/* State observations */}
      {stateObs.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("hqForm.viewStateObservations")}</h4>
          <div className="space-y-2">
            {stateObs.map((o, i) => (
              <div key={i} className="rounded border p-3 bg-muted/10 text-sm space-y-1">
                <p className="font-medium">{asStr(o.stateName) || `State Observation ${i + 1}`}</p>
                {asStr(o.technicalObservation) && <p className="text-xs text-muted-foreground whitespace-pre-wrap">{asStr(o.technicalObservation)}</p>}
                {asStr(o.qualityConcern) && <p className="text-xs"><span className="font-medium text-amber-700">{t("hqForm.viewQualityConcern")}</span> {asStr(o.qualityConcern)}</p>}
                {asStr(o.goodPractice) && <p className="text-xs"><span className="font-medium text-green-700">{t("hqForm.viewGoodPractice")}</span> {asStr(o.goodPractice)}</p>}
                {asStr(o.actionRequired) && <p className="text-xs"><span className="font-medium text-red-700">{t("hqForm.viewActionRequired")}</span> {asStr(o.actionRequired)}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Technical ratings */}
      {ratings.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("hqForm.viewTechnicalRatings")}</h4>
          <div className="space-y-1">
            {ratings.map((r, i) => (
              <div key={i} className="flex items-center gap-2 border rounded p-2 text-xs">
                <Badge variant="outline" className="text-xs capitalize">{asStr(r.entityType)}</Badge>
                <span className="font-medium flex-1">{asStr(r.entityLabel)}</span>
                <Badge
                  variant={
                    asStr(r.rating) === "Excellent" ? "excellent" :
                    asStr(r.rating) === "Good" ? "good" :
                    asStr(r.rating) === "Fair" ? "needs-follow-up" :
                    asStr(r.rating) === "Needs Improvement" ? "insufficient" :
                    "rejected"
                  }
                  className="text-xs"
                >
                  {asStr(r.rating)}
                </Badge>
                {asStr(r.reason) && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="text-muted-foreground line-clamp-2 min-w-0 flex-1 text-start">{asStr(r.reason)}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{asStr(r.reason)}</TooltipContent>
                  </Tooltip>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Support requests */}
      {supportReqs.length > 0 && asObj(supportReqs[0]).supportType !== undefined && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("hqForm.viewSupportRequired")}</h4>
          <div className="space-y-2">
            {supportReqs.map((r, i) => (
              <div key={i} className="rounded border p-3 bg-muted/10 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{asStr(r.supportType)}</span>
                  <Badge variant={asStr(r.priority) === "High" ? "destructive" : "secondary"} className="text-xs">{asStr(r.priority)}</Badge>
                </div>
                <p className="text-xs text-muted-foreground whitespace-pre-wrap">{asStr(r.description)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Risks */}
      {reportRisks.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("hqForm.viewRisksAndIssues")}</h4>
          <div className="space-y-1">
            {reportRisks.map((r, i) => (
              <div key={i} className="flex items-center gap-2 border rounded p-2 text-xs">
                {typeof r.id === "number" && <Link2 className="h-3 w-3 text-blue-500 shrink-0" />}
                <span className="font-medium flex-1">{asStr(r.title)}</span>
                <Badge variant="outline" className="text-xs">{asStr(r.category)}</Badge>
                <Badge variant={severityBadgeVariant(asStr(r.severity))} className="text-xs">{asStr(r.severity)}</Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Indicator commentary */}
      {indComments.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-foreground mb-2">{t("hqForm.viewIndicatorCommentary")}</h4>
          <div className="space-y-2">
            {indComments.map((c, i) => (
              <div key={i} className="rounded border p-2 bg-muted/10 text-xs">
                <p className="font-medium mb-0.5">{asStr(c.indicatorName)}</p>
                <p className="text-muted-foreground whitespace-pre-wrap">{asStr(c.commentary)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Attachments are rendered via the secure Supporting Attachments block in reports.tsx.
          Do not duplicate attachment listing here — it would expose section-embedded metadata
          without authenticated download links. */}
    </div>
  );
}
