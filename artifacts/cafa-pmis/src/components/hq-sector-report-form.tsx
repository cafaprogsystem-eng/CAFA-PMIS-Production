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
import {
  Alert, Button as HButton, Checkbox, Chip, Input as HInput, Modal,
  Skeleton as HSkeleton, TextArea as HTextArea,
} from "@heroui/react";
import { SelectField } from "@/components/select-field";
import { DateInput, Field } from "@/components/form-controls";
import { optionLabel, riskStatusText, severityColor, severityText } from "@/lib/report-form-options";
import {
  Plus, Trash2, Send, Upload, FileText, Loader2, X,
  TrendingUp, Users, Activity, ShieldAlert, Clock,
  MapPin, BarChart3, AlertTriangle, Link2, AlertCircle,
} from "@/components/icons";
import { CommentsPanel } from "@/components/comments-panel";
import { toast } from "sonner";
import { useConfirm } from "@/components/use-confirm";
import { SECTORS } from "@/lib/sectors";
import { hasPerm } from "@/lib/format";
import { FormVoiceRecorder, type PendingNote } from "@/components/form-voice-recorder";
import {
  OfflineReportDraftStatus,
  reportDraftKey,
  useOfflineReportDraft,
} from "@/lib/offline/report-drafts";
import { isOfflineQueuedError } from "@/lib/offline/fetch-interceptor";
import { useSyncContext } from "@/contexts/sync-context";
import { sanitizeReportAttachments, buildReportPeriodLabel } from "@/lib/report-form-payload-shared";
import {
  authorizationFingerprint,
  canViewHqSectorSnapshot,
  type AuthorizationContext,
} from "@/lib/authorization-context";

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
  indicatorProgressPct: number | null;
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
  budgetUtilizationPct: number | null;
  riskLevel: string;
};

type BenRow = { men: number; women: number; boys: number; girls: number; total: number };
type BenByState = BenRow & { stateId: number; stateName: string; stateNameAr?: string | null };
type BenByProject = BenRow & { code: string; title: string };
type BenByDonor = BenRow & { donor: string };

type IndicatorRow = {
  name: string;
  target: number | null;
  achieved: number | null;
  progressPct: number | null;
  status: string | null;
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
      <p className="text-xs font-semibold mb-1 text-[var(--muted)]">{label}</p>
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-xs">
          <thead className="bg-[var(--default)]">
            <tr>
              {colHeaders.map((h) => (
                <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-[var(--default)]">
                <td className="px-2 py-1.5 font-medium">{nameKey === "stateName" ? getLinkedStateLabel(row as { stateName?: string | null; stateNameAr?: string | null }, i18n?.language) : String(row[nameKey])}</td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.men.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.women.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.boys.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{row.girls.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5 font-semibold"><bdi dir="ltr">{row.total.toLocaleString("en-GB")}</bdi></td>
              </tr>
            ))}
            <tr className="bg-[var(--default)] font-semibold">
              <td className="px-2 py-1.5">{t("hqForm.totalRow")}</td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.men.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.women.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.boys.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.girls.toLocaleString("en-GB")}</bdi></td>
                <td className="px-2 py-1.5"><bdi dir="ltr">{total.total.toLocaleString("en-GB")}</bdi></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Auto-gen snapshot section ─────────────────────────────────────────────────

function SectorSnapshotSection({ sector, auth }: { sector: string; auth: AuthorizationContext | undefined }) {
  const { t, i18n } = useTranslation("reports");
  const authContext = authorizationFingerprint(auth);
  const isAuthorised = canViewHqSectorSnapshot(auth, sector);
  const { data, isLoading } = useQuery<SectorData>({
    queryKey: ["sector-snapshot", authContext, sector],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/sector-snapshot?sector=${encodeURIComponent(sector)}`);
      if (!res.ok) throw new Error("Failed to load sector data");
      return res.json() as Promise<SectorData>;
    },
    enabled: !!sector && isAuthorised,
    staleTime: 60_000,
  });

  if (!isAuthorised) return null;
  if (isLoading) return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">{[1,2,3,4,5,6].map((i) => <HSkeleton key={i} className="h-16" />)}</div>
      <HSkeleton className="h-24" />
    </div>
  );
  if (!data) return null;

  const snap = data.snapshot;
  const snapCards = [
    { label: t("hqForm.snapshotActiveProjects"), value: snap.activeProjects, icon: TrendingUp, tone: "var(--accent)" },
    { label: t("hqForm.snapshotActiveStates"), value: snap.activeStates, icon: MapPin, tone: "var(--accent)" },
    { label: t("hqForm.snapshotActiveLocalities"), value: snap.activeLocalities, icon: MapPin, tone: "var(--accent)" },
    { label: t("hqForm.snapshotActivitiesDone"), value: snap.activitiesImplemented, icon: Activity, tone: "var(--success)" },
    { label: t("hqForm.snapshotBeneficiaries"), value: snap.beneficiariesReached.toLocaleString("en-GB"), icon: Users, tone: "var(--success)" },
    { label: t("hqForm.snapshotIndicatorProgress"), value: snap.indicatorProgressPct == null ? t("hqForm.unavailable") : `${snap.indicatorProgressPct}%`, icon: BarChart3, tone: "var(--accent)" },
    { label: t("hqForm.snapshotDelayedActivities"), value: snap.delayedActivities, icon: AlertTriangle, tone: "var(--warning)" },
    { label: t("hqForm.snapshotOpenRisks"), value: snap.openRisks, icon: ShieldAlert, tone: "var(--danger)" },
    { label: t("hqForm.snapshotPendingReviews"), value: snap.pendingApprovals, icon: Clock, tone: "var(--warning)" },
  ];

  const benTotal = data.beneficiaryBreakdown.men + data.beneficiaryBreakdown.women +
    data.beneficiaryBreakdown.boys + data.beneficiaryBreakdown.girls;

  return (
    <div className="space-y-4">
      {/* Snapshot cards */}
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
        {snapCards.map((c) => (
          <div key={c.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 text-center">
            <c.icon className="mx-auto mb-0.5 size-4" style={{ color: c.tone }} aria-hidden="true" />
            <p className="text-base font-bold"><bdi dir="ltr">{c.value}</bdi></p>
            <p className="text-xs text-[var(--muted)] leading-tight">{c.label}</p>
          </div>
        ))}
      </div>

      {/* State performance summary */}
      {data.stateSummaries.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-1 text-[var(--muted)]">{t("hqForm.statePerformanceSummary")}</p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--default)]">
                <tr>{[t("hqForm.colState"), t("hqForm.colProjects"), t("hqForm.colActivities"), t("hqForm.colBeneficiaries"), t("hqForm.colProgress"), t("hqForm.colOpenRisks")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.stateSummaries.map((s) => (
                  <tr key={s.stateId} className="hover:bg-[var(--default)]">
                    <td className="px-2 py-1.5 font-medium">{getLinkedStateLabel(s, i18n?.language)}</td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.projects}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.activities}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{s.beneficiaries.toLocaleString("en-GB")}</bdi></td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        <div className="h-1.5 w-16 overflow-hidden rounded bg-[var(--default)]">
                          <div className="h-full bg-primary" style={{ width: `${s.progressPct}%` }} />
                        </div>
                        <span><bdi dir="ltr">{s.progressPct}%</bdi></span>
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={s.openRisks > 0 ? "text-[var(--danger)] font-medium" : "text-[var(--muted)]"}><bdi dir="ltr">{s.openRisks}</bdi></span>
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
          <p className="text-xs font-semibold mb-1 text-[var(--muted)]">{t("hqForm.projectPerformanceSummary")}</p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--default)]">
                <tr>{[t("hqForm.colProject"), t("hqForm.colDonor"), t("hqForm.colProgress"), t("hqForm.colBeneficiaries"), t("hqForm.colBudgetUtil"), t("hqForm.colRisk")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.projectSummaries.map((p) => (
                  <tr key={p.id} className="hover:bg-[var(--default)]">
                    <td className="max-w-[16rem] px-2 py-1.5"><span className="font-mono"><bdi dir="ltr">{p.code}</bdi></span> <span className="line-clamp-2 text-[var(--muted)]" dir="auto" title={p.title}>{p.title}</span></td>
                    <td className="px-2 py-1.5 text-[var(--muted)]">{p.donor || "—"}</td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.progressPct}%</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.beneficiaries.toLocaleString("en-GB")}</bdi></td>
                    <td className="px-2 py-1.5"><bdi dir="ltr">{p.budgetUtilizationPct == null ? t("hqForm.unavailable") : `${p.budgetUtilizationPct}%`}</bdi></td>
                    <td className="px-2 py-1.5">
                      {p.riskLevel ? <Chip size="sm" variant="soft" color={severityColor(p.riskLevel)}>{severityText(t, p.riskLevel)}</Chip> : "—"}
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
          <p className="text-xs font-semibold mb-1 text-[var(--muted)]">{t("hqForm.beneficiaryAnalysis")}</p>

          {/* Sector totals */}
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            {(["men","women","boys","girls"] as const).map((k) => {
              const val = data.beneficiaryBreakdown[k];
              const label = t(`hqForm.col${k.charAt(0).toUpperCase() + k.slice(1)}`);
              return (
                <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2">
                  <p className="text-[var(--muted)]">{label}</p>
                  <p className="font-bold text-base"><bdi dir="ltr">{val.toLocaleString("en-GB")}</bdi></p>
                </div>
              );
            })}
            <div className="rounded border p-2 bg-primary/5">
              <p className="text-[var(--muted)]">{t("hqForm.colTotal")}</p>
              <p className="font-bold text-base"><bdi dir="ltr">{benTotal.toLocaleString("en-GB")}</bdi></p>
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
          <p className="text-xs font-semibold mb-1 text-[var(--muted)]">{t("hqForm.indicatorAnalysis")}</p>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-xs">
              <thead className="bg-[var(--default)]">
                <tr>{[t("hqForm.colIndicator"), t("hqForm.colTarget"), t("hqForm.colAchieved"), t("hqForm.colProgress"), t("hqForm.colStatus")].map((h) => (
                  <th key={h} className="px-2 py-1.5 text-start font-medium">{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y">
                {data.indicators.map((ind, i) => (
                  <tr key={i} className="hover:bg-[var(--default)]">
                    <td className="px-2 py-1.5 font-medium max-w-xs truncate">{ind.name}</td>
                    <td className="px-2 py-1.5">{ind.target == null ? t("hqForm.unavailable") : <bdi dir="ltr">{ind.target.toLocaleString("en-GB")}</bdi>}</td>
                    <td className="px-2 py-1.5">{ind.achieved == null ? t("hqForm.unavailable") : <bdi dir="ltr">{ind.achieved.toLocaleString("en-GB")}</bdi>}</td>
                    <td className="px-2 py-1.5">
                      <div className="flex items-center gap-1">
                        {ind.progressPct == null ? (
                          <span>{t("hqForm.unavailable")}</span>
                        ) : (
                          <>
                            <div className="h-1.5 w-14 overflow-hidden rounded bg-[var(--default)]">
                              <div className="h-full" style={{ width: `${Math.min(ind.progressPct, 100)}%`, background: ind.progressPct >= 100 ? "var(--success)" : ind.progressPct >= 75 ? "var(--accent)" : ind.progressPct >= 50 ? "var(--warning)" : "var(--danger)" }} />
                            </div>
                            <span><bdi dir="ltr">{ind.progressPct}%</bdi></span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="px-2 py-1.5">
                      <Chip size="sm" variant="soft" color={ind.status == null ? "default" : ind.status === "Achieved" ? "success" : ind.status === "On Track" ? "accent" : ind.status === "At Risk" ? "warning" : "danger"}>
                        {ind.status ? optionLabel(t, "indicatorStatus", ind.status) : t("hqForm.unavailable")}
                      </Chip>
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
  const monthName = (m: number, style: "long" | "short") =>
    new Date(2000, m - 1, 1).toLocaleString(i18n.language === "ar" ? "ar" : "en", { month: style });
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
  // Accessible error summary — same mechanism as program-state-report-form.tsx,
  // unified here instead of relying on toast alone (a transient toast is not
  // reliably announced/focus-managed for screen-reader users).
  const [formError, setFormError] = useState<string | null>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
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
      const res = await fetch(`/api/risks?sector=${encodeURIComponent(v.sector)}&limit=200`);
      if (!res.ok) return [];
      // The list endpoint answers with a paginated envelope ({ items, … });
      // accept a bare array too, as the State Programme form does. Treating
      // the envelope as an array crashed the whole Reports page.
      const body = (await res.json()) as ExistingRisk[] | { items?: ExistingRisk[] };
      return Array.isArray(body) ? body : body.items ?? [];
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

  /** Surfaces a validation error in the accessible error summary region and
   *  moves focus to it so keyboard and screen-reader users are informed —
   *  same mechanism as program-state-report-form.tsx's raiseFormError. */
  function raiseFormError(msg: string) {
    setFormError(msg);
    // Defer focus so the DOM update completes before we try to focus.
    setTimeout(() => errorSummaryRef.current?.focus(), 0);
  }

  // ── Shared submit-readiness validation (HQSR-003 client mirror) ─────────────
  // Used by BOTH the create-and-submit path (via buildPayload) and the resubmit
  // path (onSubmitReport's edit-mode branch, which otherwise only calls
  // buildPatchPayload — a deliberately validation-free content-only PATCH —
  // before invoking the submit transition). Previously only the create path
  // validated client-side; a resubmission could reach the server with blank
  // required fields or zero support requests, discovered only by the server's
  // 422 instead of an immediate, specific error.
  //
  // onError: optional callback invoked with the validation message so callers
  // can surface an accessible error summary in addition to the toast — unified
  // with program-state-report-form.tsx's buildPayload, which took this same
  // fail(msg) shape while this function only toasted.
  function validateSubmitReadiness(values: BasicValues, requireSupport: boolean, onError?: (msg: string) => void): boolean {
    function fail(msg: string) { toast.error(msg); onError?.(msg); return false; }
    if (!values.sector) return fail(t("hqForm.errSelectSector"));
    if (values.frequency === "on_demand") {
      if (!values.periodStart) return fail(t("hqForm.errPeriodStartRequired"));
      if (!values.periodEnd) return fail(t("hqForm.errPeriodEndRequired"));
      if (!values.onDemandReason) return fail(t("hqForm.errReasonRequired"));
    }
    if (!values.title.trim()) return fail(t("hqForm.errTitleRequired"));
    if (!values.technicalAnalysis.trim()) return fail(t("hqForm.errTechnicalAnalysisRequired"));
    if (!values.keyFindings.trim()) return fail(t("hqForm.errKeyFindingsRequired"));
    if (!values.qualityAssessment.trim()) return fail(t("hqForm.errQualityAssessmentRequired"));
    if (!values.technicalChallenges.trim()) return fail(t("hqForm.errTechChallengesRequired"));
    if (!values.recommendations.trim()) return fail(t("hqForm.errRecommendationsRequired"));
    if (!values.strategicPriorities.trim()) return fail(t("hqForm.errStrategicPrioritiesRequired"));
    if (!values.lessonsLearned.trim()) return fail(t("hqForm.errLessonsLearnedRequired"));
    if (!values.sectorOutlook.trim()) return fail(t("hqForm.errSectorOutlookRequired"));
    const cleanSupport = supportRequests.filter((r) => r.supportType && r.description.trim());
    if (requireSupport && cleanSupport.length === 0) return fail(t("hqForm.errSupportRequired"));
    return true;
  }

  // Payload builder — submitMode=true enforces support validation
  function buildPayload(values: BasicValues, submitMode: boolean, onError?: (msg: string) => void) {
    if (!validateSubmitReadiness(values, submitMode, onError)) return null;

    const cleanSupport = supportRequests.filter((r) => r.supportType && r.description.trim());
    const cleanObs = stateObservations.filter((o) => o.stateId !== "" && o.technicalObservation.trim());
    const cleanRatings = technicalRatings.filter((r) => r.entityLabel.trim() && r.reason.trim());
    const cleanIndComments = indicatorComments.filter((c) => c.indicatorName.trim());
    const cleanAttachments = sanitizeReportAttachments(attachments);

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

    let reportingMonthVal: number | undefined;
    if (values.frequency !== "quarterly" && values.frequency !== "annual" && values.frequency !== "on_demand") {
      reportingMonthVal = values.reportingMonth;
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
      "range",
    );

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
    const cleanAttachments = sanitizeReportAttachments(attachments);
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

    const period = buildReportPeriodLabel(
      {
        frequency: values.frequency,
        reportingYear: values.reportingYear,
        quarter: values.quarter,
        reportingMonth: values.reportingMonth,
        periodStart: values.periodStart,
        periodEnd: values.periodEnd,
      },
      "range",
    );

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
  // Unified with program-state-report-form.tsx's hasNoAttachments.
  const hasNoAttachments = attachments.filter(
    (attachment) => !attachment.uploading && (attachment.file || attachment.objectPath || attachment.attachmentId),
  ).length === 0;

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
      const builtPayload = buildPayload(values, false, raiseFormError);
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

  const [confirm, confirmDialog] = useConfirm();
  const onSubmitReport = form.handleSubmit(async (values) => {
    if (!isOnline) {
      toast.error(t("sync.internetRequired", { ns: "common" }));
      return;
    }
    // Unified with program-state-report-form.tsx: warn (not block) before
    // submitting with zero supporting documents.
    if (hasNoAttachments) {
      const proceed = await confirm({
        title: t("formUi.noAttachmentsTitle"),
        message: t("formUi.noAttachmentsMessage"),
        confirmLabel: t("formUi.submitAnyway"),
        cancelLabel: t("formUi.addDocumentsFirst"),
      });
      if (!proceed) return;
    }
    setIsSaving(true);
    try {
      let reportId: number;
      if ((isEditMode && existingReport) || createdReportId) {
        // Resubmission — validate BEFORE patching. buildPatchPayload deliberately
        // performs no field validation (it also serves plain content-save PATCHes
        // that must not hard-validate like a submit does), so this is the only
        // client-side gate a resubmission gets before hitting the server's 422.
        if (!validateSubmitReadiness(values, true, raiseFormError)) return;
        // HQSR-005: PATCH latest content first; if it fails, do NOT transition.
        try {
          if (!(await patchExistingReport(values))) return;
        } catch (patchErr: unknown) {
          toast.error(t("hqForm.errSaveBeforeSubmit", { message: (patchErr as Error).message }));
          return; // abort — the report stays a Draft with its previous content
        }
        reportId = existingReport?.id ?? createdReportId!;
      } else {
        const builtPayload = buildPayload(values, true, raiseFormError);
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
          <p className="text-sm text-[var(--muted)]">
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
              isStale={localDraft.isStale}
            />
          )}
          {!isOnline && (
            <Alert id="hq-offline-workflow-notice" status="warning" role="alert" className="mt-3">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t("sync.internetRequired", { ns: "common" })}</Alert.Title>
                <Alert.Description>{t("sync.internetRequiredDescription", { ns: "common" })}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
        </div>

        {/* ── Accessible error summary region ─────────────────────────────── */}
        {/* Shown after a validation failure so keyboard/screen-reader users
            land on a clear, focused description of what went wrong. Unified
            with program-state-report-form.tsx's identical region. */}
        {formError && (
          <div ref={errorSummaryRef} tabIndex={-1} className="rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]">
            <Alert status="danger" role="alert" aria-live="assertive">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t("hqForm.correctErrorsBeforeContinuing")}</Alert.Title>
                <Alert.Description>{formError}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        )}

        {/* ── Returned-for-revision banner (HQSR-005) ─────────────────────────── */}
        {isReturnedForRevision && existingReport && (
          <div className="space-y-3">
            <Alert status="warning" role="alert">
              <Alert.Indicator />
              <Alert.Content>
                <Alert.Title>{t("hqForm.returnedForRevision")}</Alert.Title>
                <Alert.Description>{t("hqForm.revisionFeedbackHint")}</Alert.Description>
              </Alert.Content>
            </Alert>
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
            {(() => {
              const sectorLabel = (
                <>
                  {t("hqForm.sectorLabel")}
                  {me?.user?.role === "technical_coordinator" && (
                    <span className="ms-1 text-xs font-normal text-[var(--muted)]">{t("hqForm.sectorFromAssigned")}</span>
                  )}
                </>
              );
              // Identity is immutable in edit mode (HQSR-002) — display only.
              return isEditMode ? (
                <Field label={sectorLabel} isRequired>
                  {(id) => <HInput id={id} fullWidth value={v.sector} readOnly aria-readonly="true" className="cursor-not-allowed bg-[var(--default)]" />}
                </Field>
              ) : (
                <SelectField
                  label={sectorLabel}
                  isRequired
                  placeholder={t("hqForm.sectorPlaceholder")}
                  value={v.sector}
                  onChange={(val) => form.setValue("sector", val)}
                  options={userSectors.map((s) => ({ value: s, label: s }))}
                />
              );
            })()}

            <Field label={t("hqForm.techCoordinatorLabel")}>
              {(id) => <HInput className="text-page-start" dir="auto" id={id} fullWidth {...form.register("officerName")} placeholder={t("hqForm.techCoordinatorPlaceholder")} />}
            </Field>

            <div className="col-span-2">
              <SelectField
                label={<>{t("hqForm.frequencyLabel")}
                {isEditMode && <span className="text-xs font-normal text-[var(--muted)] ms-1">{t("hqForm.locked")}</span>}</>}
                isRequired
                isDisabled={isEditMode}
                value={v.frequency}
                onChange={(val) => { if (val) form.setValue("frequency", val as Frequency); }}
                options={[{ value: "monthly", label: t("frequency.monthly") }, { value: "quarterly", label: t("frequency.quarterly") }, { value: "annual", label: t("frequency.annual") }, { value: "on_demand", label: t("frequency.on_demand") }]}
              />
            </div>

            {v.frequency === "monthly" && (
              <>
                <SelectField
                  label={t("hqForm.monthLabel")}
                  isRequired
                  isDisabled={isEditMode}
                  value={String(v.reportingMonth)}
                  onChange={(val) => form.setValue("reportingMonth", Number(val))}
                  options={Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: monthName(i + 1, "long") }))}
                />
                <div>
                  <SelectField
                    label={t("hqForm.yearLabel")}
                    isRequired
                    isDisabled={isEditMode}
                    value={String(v.reportingYear)}
                    onChange={(val) => form.setValue("reportingYear", Number(val))}
                    options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
                  />
                </div>
              </>
            )}
            {v.frequency === "quarterly" && (
              <>
                <SelectField
                  label={t("hqForm.quarterLabel")}
                  isRequired
                  isDisabled={isEditMode}
                  value={String(v.quarter)}
                  onChange={(val) => form.setValue("quarter", Number(val))}
                  options={[1, 2, 3, 4].map((q) => ({
                    value: String(q),
                    label: `${t("formUi.quarterN", { number: q })} (${monthName(q * 3 - 2, "short")}–${monthName(q * 3, "short")})`,
                  }))}
                />
                <div>
                  <SelectField
                    label={t("hqForm.yearLabel")}
                    isRequired
                    isDisabled={isEditMode}
                    value={String(v.reportingYear)}
                    onChange={(val) => form.setValue("reportingYear", Number(val))}
                    options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
                  />
                </div>
              </>
            )}
            {v.frequency === "annual" && (
              <div className="col-span-2">
                <SelectField
                  label={t("hqForm.yearLabel")}
                  isRequired
                  isDisabled={isEditMode}
                  value={String(v.reportingYear)}
                  onChange={(val) => form.setValue("reportingYear", Number(val))}
                  options={yearOptions.map((y) => ({ value: String(y), label: String(y) }))}
                />
              </div>
            )}
            {v.frequency === "on_demand" && (
              <>
                <DateInput
                  label={t("hqForm.startDateLabel")}
                  isRequired
                  isDisabled={isEditMode}
                  value={v.periodStart}
                  onChange={(d) => form.setValue("periodStart", d)}
                />
                <DateInput
                  label={t("hqForm.endDateLabel")}
                  isRequired
                  isDisabled={isEditMode}
                  value={v.periodEnd} min={v.periodStart || undefined}
                  onChange={(d) => form.setValue("periodEnd", d)}
                />
                <div className="col-span-2">
                  <SelectField
                    label={t("hqForm.reasonLabel")}
                    isRequired
                    placeholder={t("hqForm.reasonPlaceholder")}
                    value={v.onDemandReason}
                    onChange={(val) => form.setValue("onDemandReason", val)}
                    options={ON_DEMAND_REASONS.map((r) => ({ value: r, label: optionLabel(t, "onDemandReasons", r) }))}
                  />
                </div>
              </>
            )}

            <Field className="col-span-2" label={t("hqForm.reportTitleLabel")} isRequired>
              {(id) => <HInput className="text-page-start" dir="auto" id={id} fullWidth
                  {...form.register("title")}
                  placeholder={t("hqForm.reportTitlePlaceholder")}
                  onFocus={() => { autoTitleRef.current = ""; }}
                />}
            </Field>
          </div>
        </section>

        {/* ── SECTION 2: SECTOR PERFORMANCE SNAPSHOT (auto-generated) ────────── */}
        {v.sector && (
          <section id="rp-section-progress" className="space-y-3">
            <h4 className="text-sm font-semibold border-b pb-1 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" /> {t("hqForm.section2Title")}
              <span className="text-xs font-normal text-[var(--muted)]">{t("hqForm.section2AutoGenerated")}</span>
            </h4>
            <SectorSnapshotSection sector={v.sector} auth={me} />
          </section>
        )}

        {/* ── SECTION 3: TECHNICAL ANALYSIS ──────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec3-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section3Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={5} {...form.register("technicalAnalysis")} aria-labelledby="hqsr-sec3-heading"
            placeholder={t("hqForm.techAnalysisPlaceholder")} />
        </section>

        {/* ── SECTION 4: KEY FINDINGS ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec4-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section4Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("keyFindings")} aria-labelledby="hqsr-sec4-heading"
            placeholder={t("hqForm.keyFindingsPlaceholder")} />
        </section>

        {/* ── SECTION 5: QUALITY ASSESSMENT ──────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec5-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section5Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("qualityAssessment")} aria-labelledby="hqsr-sec5-heading"
            placeholder={t("hqForm.qualityAssessmentPlaceholder")} />
        </section>

        {/* ── SECTION 6: TECHNICAL CHALLENGES ────────────────────────────────── */}
        <section id="rp-section-challenges" className="space-y-3">
          <h4 id="hqsr-sec6-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section6Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("technicalChallenges")} aria-labelledby="hqsr-sec6-heading"
            placeholder={t("hqForm.techChallengesPlaceholder")} />
        </section>

        {/* ── SECTION 7: RECOMMENDATIONS ──────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec7-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section7Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("recommendations")} aria-labelledby="hqsr-sec7-heading"
            placeholder={t("hqForm.recommendationsPlaceholder")} />
        </section>

        {/* ── SECTION 8: STATE TECHNICAL OBSERVATIONS ──────────────────────────── */}
        <section id="rp-section-activities" className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section8Title")}</h4>
            <HButton type="button" size="sm" variant="tertiary" onPress={() => setStateObservations((c) => [...c, emptyObservation()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addState")}
            </HButton>
          </div>
          {stateObservations.length === 0 && (
            <p className="text-xs text-[var(--muted)]">
              {t("hqForm.noStateObservations")}
            </p>
          )}
          {stateObservations.map((o, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.stateObservationHash", { num: i + 1 })}</p>
                <HButton type="button" size="sm" variant="ghost" isIconOnly aria-label={t("hqForm.removeItemAria", { label: t("hqForm.stateObservationHash", { num: i + 1 }) })} onPress={() => setStateObservations((c) => c.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-3.5 text-[var(--danger)]" aria-hidden="true" />
                </HButton>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <SelectField
                  className="col-span-2"
                  label={t("hqForm.stateLabel")}
                  isRequired
                  placeholder={t("hqForm.statePlaceholder")}
                  value={String(o.stateId || "")}
                  onChange={(val) => updateObs(i, { stateId: Number(val) })}
                  options={states.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))}
                />
                <Field className="col-span-2" labelClassName="text-xs" label={t("hqForm.techObservationLabel")} isRequired>
                  {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={o.technicalObservation} onChange={(e) => updateObs(i, { technicalObservation: e.target.value })} placeholder={t("hqForm.techObservationPlaceholder")} />}
                </Field>
                <Field labelClassName="text-xs" label={t("hqForm.qualityConcernLabel")}>
                  {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={o.qualityConcern} onChange={(e) => updateObs(i, { qualityConcern: e.target.value })} placeholder={t("hqForm.qualityConcernPlaceholder")} />}
                </Field>
                <Field labelClassName="text-xs" label={t("hqForm.goodPracticeLabel")}>
                  {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={o.goodPractice} onChange={(e) => updateObs(i, { goodPractice: e.target.value })} placeholder={t("hqForm.goodPracticePlaceholder")} />}
                </Field>
                <Field className="col-span-2" labelClassName="text-xs" label={t("hqForm.actionRequiredLabel")}>
                  {(id) => <HInput dir="auto" id={id} fullWidth value={o.actionRequired} onChange={(e) => updateObs(i, { actionRequired: e.target.value })} placeholder={t("hqForm.actionRequiredPlaceholder")} className="h-8 text-page-start" />}
                </Field>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 9: TECHNICAL RATINGS ───────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section9Title")}</h4>
            <HButton type="button" size="sm" variant="tertiary" onPress={() => setTechnicalRatings((c) => [...c, emptyRating()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addRating")}
            </HButton>
          </div>
          {technicalRatings.length === 0 && (
            <p className="text-xs text-[var(--muted)]">
              {t("hqForm.noRatings")}
            </p>
          )}
          {technicalRatings.map((r, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.ratingHash", { num: i + 1 })}</p>
                <HButton type="button" size="sm" variant="ghost" isIconOnly aria-label={t("hqForm.removeItemAria", { label: t("hqForm.ratingHash", { num: i + 1 }) })} onPress={() => setTechnicalRatings((c) => c.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-3.5 text-[var(--danger)]" aria-hidden="true" />
                </HButton>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <SelectField
                    label={t("hqForm.typeLabel")}
                    value={r.entityType}
                    onChange={(val) => updateRating(i, { entityType: val as "state" | "project" })}
                    options={[{ value: "state", label: t("hqForm.colState") }, { value: "project", label: t("hqForm.colProject") }]}
                  />
                </div>
                <Field labelClassName="text-xs" label={r.entityType === "state" ? t("hqForm.stateNameLabel") : t("hqForm.projectCodeLabel")}>
                  {(id) => <HInput dir="auto" id={id} fullWidth value={r.entityLabel} onChange={(e) => updateRating(i, { entityLabel: e.target.value })} placeholder={r.entityType === "state" ? t("hqForm.stateNamePlaceholder") : t("hqForm.projectCodePlaceholder")} className="h-8 text-page-start" />}
                </Field>
                <div>
                  <SelectField
                    label={t("hqForm.ratingLabel")}
                    isRequired
                    value={r.rating}
                    onChange={(val) => updateRating(i, { rating: val })}
                    options={TECHNICAL_RATINGS.map((t_) => ({ value: t_, label: optionLabel(t, "technicalRatings", t_) }))}
                  />
                </div>
                <Field className="col-span-3" labelClassName="text-xs" label={t("hqForm.reasonForRatingLabel")} isRequired>
                  {(id) => <HTextArea dir="auto" id={id} fullWidth rows={3} className="resize-y text-page-start" value={r.reason} onChange={(e) => updateRating(i, { reason: e.target.value })} placeholder={t("hqForm.reasonForRatingPlaceholder")} />}
                </Field>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 10: RISKS & ISSUES ──────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section10Title")}</h4>
            <HButton type="button" size="sm" variant="tertiary" onPress={() => setCreateRiskOpen(true)}>
                <Plus className="h-3 w-3" /> {t("hqForm.createNewRisk")}
            </HButton>
          </div>

          {/* Auto-loaded sector risks */}
          {!v.sector && (
            <p className="text-xs text-[var(--muted)] flex items-center gap-1">
              <AlertCircle className="h-3.5 w-3.5" /> {t("hqForm.selectSectorForRisks")}
            </p>
          )}
          {v.sector && sectorRisksLoading && (
            <div className="space-y-2">{[1,2,3].map((i) => <HSkeleton key={i} className="h-10" />)}</div>
          )}
          {v.sector && !sectorRisksLoading && sectorRisks.length === 0 && (
            <p className="text-xs text-[var(--muted)]">
              {t("hqForm.noRisksFound", { sector: v.sector })}
            </p>
          )}
          {v.sector && !sectorRisksLoading && sectorRisks.length > 0 && (
            <div>
              <p className="text-xs text-[var(--muted)] mb-2">
                {t("hqForm.risksFound", { count: sectorRisks.length, sector: v.sector })}
              </p>
              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-xs">
                  <thead className="bg-[var(--default)]">
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
                      <tr key={r.id} className={linkedRiskIds.includes(r.id) ? "bg-[color-mix(in_oklab,var(--accent)_8%,transparent)]" : "hover:bg-[var(--default)]"}>
                        <td className="px-2 py-2 text-center">
                          <Checkbox
                            aria-label={t("hqForm.linkRiskAria", { title: r.title })}
                            isSelected={linkedRiskIds.includes(r.id)}
                            onChange={() => toggleRiskLink(r.id)}
                          >
                            <Checkbox.Control><Checkbox.Indicator /></Checkbox.Control>
                          </Checkbox>
                        </td>
                        <td className="max-w-xs px-2 py-2 font-medium">
                          <div className="flex items-center gap-1">
                            {linkedRiskIds.includes(r.id) && <Link2 className="size-3 shrink-0 text-[var(--accent)]" aria-hidden="true" />}
                            <span className="line-clamp-2" dir="auto" title={r.title}>{r.title}</span>
                          </div>
                        </td>
                        <td className="px-2 py-2 text-[var(--muted)]">{r.category ? optionLabel(t, "riskCategories", r.category) : "—"}</td>
                        <td className="px-2 py-2">
                          {r.severity && <Chip size="sm" variant="soft" color={severityColor(r.severity)}>{severityText(t, r.severity)}</Chip>}
                        </td>
                        <td className="px-2 py-2">
                          {r.status && <Chip size="sm" variant="tertiary">{riskStatusText(t, r.status)}</Chip>}
                        </td>
                        <td className="px-2 py-2 text-xs text-[var(--muted)]">
                          {r.stateName ? getLinkedStateLabel(r, i18n.language) : ""}
                          {r.projectTitle && <span className="block truncate" dir="auto" title={r.projectTitle}>{r.projectTitle}</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {linkedRiskIds.length > 0 && (
                <p className="mt-1.5 flex items-center gap-1 text-xs text-[var(--accent)]">
                  <Link2 className="size-3.5" aria-hidden="true" /> {t("hqForm.linkedRisks", { count: linkedRiskIds.length })}
                </p>
              )}
            </div>
          )}
        </section>

        {/* ── SECTION 11: INDICATOR COMMENTARY ────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section11Title")} <span className="font-normal text-[var(--muted)]">{t("hqForm.section11Optional")}</span></h4>
            <HButton type="button" size="sm" variant="tertiary" onPress={() => setIndicatorComments((c) => [...c, emptyIndComment()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addCommentary")}
            </HButton>
          </div>
          {indicatorComments.length === 0 && <p className="text-xs text-[var(--muted)]">{t("hqForm.noCommentary")}</p>}
          {indicatorComments.map((c, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.commentaryHash", { num: i + 1 })}</p>
                <HButton type="button" size="sm" variant="ghost" isIconOnly aria-label={t("hqForm.removeItemAria", { label: t("hqForm.commentaryHash", { num: i + 1 }) })} onPress={() => setIndicatorComments((cur) => cur.filter((_, idx) => idx !== i))}>
                  <Trash2 className="size-3.5 text-[var(--danger)]" aria-hidden="true" />
                </HButton>
              </div>
              <div className="grid grid-cols-1 gap-2">
                <Field labelClassName="text-xs" label={t("hqForm.indicatorNameLabel")}>
                  {(id) => <HInput dir="auto" id={id} fullWidth value={c.indicatorName} onChange={(e) => updateIndComment(i, { indicatorName: e.target.value })} placeholder={t("hqForm.indicatorNamePlaceholder")} className="h-8 text-page-start" />}
                </Field>
                <Field labelClassName="text-xs" label={t("hqForm.techCommentaryLabel")}>
                  {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={c.commentary} onChange={(e) => updateIndComment(i, { commentary: e.target.value })} placeholder={t("hqForm.techCommentaryPlaceholder")} />}
                </Field>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 12: SUPPORT REQUIRED ────────────────────────────────────── */}
        <section className="space-y-3">
          <div className="flex items-center justify-between border-b pb-1">
            <h4 className="text-sm font-semibold">{t("hqForm.section12Title")}</h4>
            <HButton type="button" size="sm" variant="tertiary" onPress={() => setSupportRequests((c) => [...c, emptySupport()])}>
                <Plus className="h-3 w-3" /> {t("hqForm.addRequest")}
            </HButton>
          </div>
          <p className="text-xs text-[var(--muted)]">{t("hqForm.supportRequired")}</p>
          {supportRequests.map((r, i) => (
            <div key={i} className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold">{t("hqForm.requestHash", { num: i + 1 })}</p>
                {supportRequests.length > 1 && (
                  <HButton type="button" size="sm" variant="ghost" isIconOnly aria-label={t("hqForm.removeItemAria", { label: t("hqForm.requestHash", { num: i + 1 }) })} onPress={() => setSupportRequests((c) => c.filter((_, idx) => idx !== i))}>
                    <Trash2 className="size-3.5 text-[var(--danger)]" aria-hidden="true" />
                  </HButton>
                )}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <SelectField
                    label={t("hqForm.supportTypeLabel")}
                    isRequired
                    placeholder={t("hqForm.supportTypePlaceholder")}
                    value={r.supportType}
                    onChange={(val) => updateSupport(i, { supportType: val })}
                    options={SUPPORT_TYPES.map((t_) => ({ value: t_, label: optionLabel(t, "supportTypes", t_) }))}
                  />
                </div>
                <div>
                  <SelectField
                    label={t("hqForm.priorityLabel")}
                    isRequired
                    value={r.priority}
                    onChange={(val) => updateSupport(i, { priority: val })}
                    options={PRIORITIES.map((p) => ({ value: p, label: optionLabel(t, "priorities", p) }))}
                  />
                </div>
                <Field className="col-span-2" labelClassName="text-xs" label={t("hqForm.descriptionLabel")} isRequired>
                  {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={r.description} onChange={(e) => updateSupport(i, { description: e.target.value })} placeholder={t("hqForm.descriptionPlaceholder")} />}
                </Field>
              </div>
            </div>
          ))}
        </section>

        {/* ── SECTION 13: STRATEGIC PRIORITIES ────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec13-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section13Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("strategicPriorities")} aria-labelledby="hqsr-sec13-heading"
            placeholder={t("hqForm.strategicPrioritiesPlaceholder")} />
        </section>

        {/* ── SECTION 14: LESSONS LEARNED ──────────────────────────────────────── */}
        <section id="rp-section-lessons" className="space-y-3">
          <h4 id="hqsr-sec14-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section14Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("lessonsLearned")} aria-labelledby="hqsr-sec14-heading"
            placeholder={t("hqForm.lessonsLearnedPlaceholder")} />
        </section>

        {/* ── SECTION 15: SECTOR OUTLOOK ──────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 id="hqsr-sec15-heading" className="text-sm font-semibold border-b pb-1">{t("hqForm.section15Title")}</h4>
          <HTextArea className="text-page-start" dir="auto" fullWidth rows={4} {...form.register("sectorOutlook")} aria-labelledby="hqsr-sec15-heading"
            placeholder={t("hqForm.sectorOutlookPlaceholder")} />
        </section>

        {/* ── SECTION 16: SUPPORTING DOCUMENTS ───────────────────────────────── */}
        <section id="rp-section-attachments" className="space-y-3">
          <h4 className="text-sm font-semibold border-b pb-1">{t("hqForm.section16Title")}</h4>
          <div className="flex items-center gap-2">
            <HButton type="button" size="sm" variant="tertiary" onPress={() => fileInputRef.current?.click()}>
                <Upload className="h-3 w-3" /> {t("hqForm.attachFile")}
            </HButton>
            <span className="text-xs text-[var(--muted)]">{t("hqForm.attachmentHint")}</span>
            <input ref={fileInputRef} type="file" className="hidden" accept={ATTACHMENT_ACCEPT} multiple
              onChange={(e) => { Array.from(e.target.files ?? []).forEach(uploadFile); e.target.value = ""; }} />
          </div>
          {attachments.length > 0 && (
            <ul className="space-y-1">
              {attachments.map((d) => (
                <li key={d.tempId} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2 text-xs">
                  <FileText className="size-3.5 shrink-0 text-[var(--muted)]" aria-hidden="true" />
                  <span className="flex-1 truncate" dir="auto" title={d.fileName}>{d.fileName}</span>
                  {d.uploading ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : (
                    <>
                      <SelectField
                        aria-label={t("stateForm.attachmentTypeAria", { fileName: d.fileName })}
                        triggerClassName="w-44"
                        value={d.attachmentType}
                        onChange={(val) => setAttachments((a) => a.map((x) => x.tempId === d.tempId ? { ...x, attachmentType: val } : x))}
                        options={ATTACHMENT_TYPES.map((t_) => ({ value: t_, label: optionLabel(t, "attachmentTypes", t_) }))}
                      />
                      <HButton size="sm" variant="ghost" isIconOnly aria-label={t("stateForm.removeAttachmentAria", { fileName: d.fileName })} onPress={() => setAttachments((a) => a.filter((x) => x.tempId !== d.tempId))}>
                        <X className="size-3.5" aria-hidden="true" />
                      </HButton>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── SECTION 17: VOICE NOTE ───────────────────────────────────────────── */}
        <section className="space-y-3">
          <h4 className="text-sm font-semibold border-b pb-1">{t("hqForm.section17Title")} <span className="font-normal text-[var(--muted)]">{t("hqForm.section17Optional")}</span></h4>
          <FormVoiceRecorder value={pendingVoiceNote} onChange={setPendingVoiceNote} />
        </section>

        {/* ── FOOTER ──────────────────────────────────────────────────────────── */}
        <div className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-wrap justify-end gap-2 border-t border-[var(--border)] bg-[var(--overlay)] px-5 py-4" data-report-form-footer aria-busy={isSaving}>
          <HButton type="button" variant="tertiary" onPress={onClose} isDisabled={isSaving}>{t("hqForm.cancel")}</HButton>
          <HButton type="button" variant="secondary" onPress={() => { void onSaveDraft(); }} isDisabled={localDraft.status === "pending" || localDraft.status === "syncing" || isSaving}>
            {isSaving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />} {t("hqForm.saveDraft")}
          </HButton>
          <HButton type="button" onPress={() => { void onSubmitReport(); }} isDisabled={!isOnline || isSaving} aria-describedby={!isOnline ? "hq-offline-workflow-notice" : undefined}>
            {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Send className="size-4" aria-hidden="true" />}
            {t("hqForm.submitReport")}
          </HButton>
        </div>
      </form>

      {/* ── Create New Risk Dialog ──────────────────────────────────────────── */}
      <Modal isOpen={createRiskOpen} onOpenChange={(o) => { if (!creatingRisk) setCreateRiskOpen(o); }}>
        <Modal.Backdrop isDismissable={!creatingRisk}>
        <Modal.Container size="md" scroll="inside">
        <Modal.Dialog className="max-h-[calc(100dvh-2rem)] sm:max-w-lg">
          <Modal.CloseTrigger />
          <Modal.Header>
            <Modal.Heading>{t("hqForm.createRiskDialogTitle")}</Modal.Heading>
            <p className="text-sm text-[var(--muted)]">{t("hqForm.createRiskDialogDesc")}</p>
          </Modal.Header>
          <Modal.Body className="space-y-3">
            <Field labelClassName="text-xs" label={t("hqForm.riskTitleLabel")} isRequired>
              {(id) => <HInput className="text-page-start" dir="auto" id={id} fullWidth value={newRiskDraft.title} onChange={(e) => setNewRiskDraft((d) => ({ ...d, title: e.target.value }))} placeholder={t("hqForm.riskTitlePlaceholder")} />}
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <SelectField
                  label={t("hqForm.categoryLabel")}
                  value={newRiskDraft.category}
                  onChange={(val) => setNewRiskDraft((d) => ({ ...d, category: val }))}
                  options={RISK_CATEGORIES.map((c) => ({ value: c, label: optionLabel(t, "riskCategories", c) }))}
                />
              </div>
              <div>
                <SelectField
                  label={t("hqForm.severityLabel")}
                  value={newRiskDraft.severity}
                  onChange={(val) => setNewRiskDraft((d) => ({ ...d, severity: val }))}
                  options={[{ value: "low", label: t("hqForm.severityLow") }, { value: "medium", label: t("hqForm.severityMedium") }, { value: "high", label: t("hqForm.severityHigh") }, { value: "critical", label: t("hqForm.severityCritical") }]}
                />
              </div>
              <div>
                <SelectField
                  label={t("hqForm.likelihoodLabel")}
                  value={newRiskDraft.likelihood}
                  onChange={(val) => setNewRiskDraft((d) => ({ ...d, likelihood: val }))}
                  options={RISK_LIKELIHOODS.map((l) => ({ value: l, label: optionLabel(t, "likelihoods", l) }))}
                />
              </div>
              <SelectField
                label={t("hqForm.stateLabel")}
                isRequired
                placeholder={t("hqForm.statePlaceholder")}
                value={String(newRiskDraft.stateId || "")}
                onChange={(val) => setNewRiskDraft((d) => ({ ...d, stateId: Number(val) }))}
                options={states.map((s) => ({ value: String(s.id), label: <StateLabel state={s} />, textValue: s.name }))}
              />
            </div>
            <Field labelClassName="text-xs" label={t("hqForm.riskDescriptionLabel")}>
              {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={newRiskDraft.description} onChange={(e) => setNewRiskDraft((d) => ({ ...d, description: e.target.value }))} placeholder={t("hqForm.riskDescriptionPlaceholder")} />}
            </Field>
            <Field labelClassName="text-xs" label={t("hqForm.mitigationPlanLabel")}>
              {(id) => <HTextArea className="text-page-start" dir="auto" id={id} fullWidth rows={2} value={newRiskDraft.mitigationPlan} onChange={(e) => setNewRiskDraft((d) => ({ ...d, mitigationPlan: e.target.value }))} placeholder={t("hqForm.mitigationPlanPlaceholder")} />}
            </Field>
          </Modal.Body>
          <Modal.Footer>
            <HButton variant="tertiary" onPress={() => { setCreateRiskOpen(false); setNewRiskDraft(emptyNewRisk()); }} isDisabled={creatingRisk}>{t("hqForm.cancel")}</HButton>
            <HButton onPress={() => { void handleCreateRisk(); }} isPending={creatingRisk}>
              {!creatingRisk && <Plus className="size-4" aria-hidden="true" />}
              {t("hqForm.createAndLinkRisk")}
            </HButton>
          </Modal.Footer>
        </Modal.Dialog>
        </Modal.Container>
        </Modal.Backdrop>
      </Modal>
      {confirmDialog}
    </>
  );
}

// ── Detail view (used in report sheet) ───────────────────────────────────────

function asStr(v: unknown): string { return typeof v === "string" ? v : ""; }
function asArr(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asObj(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }

export function HqSectorSectionsView({ sections }: { sections: Record<string, unknown> }) {
  const { t, i18n } = useTranslation("reports");
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
    [t("hqForm.legacyAchievementsSummary"), asStr(sections.achievementsSummary)],
    [t("hqForm.legacySectorChallenges"), asStr(sections.sectorChallenges)],
    [t("hqForm.legacyMitigationActions"), asStr(sections.mitigationActions)],
    [t("hqForm.legacySupportRequired"), asStr(sections.supportRequired as string)],
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
      <div className="space-y-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-xs">
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
              <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm space-y-1">
                <p className="font-medium">{asStr(o.stateName) ? getLinkedStateLabel(o as { stateName?: string | null; stateNameAr?: string | null }, i18n.language) : t("hqForm.stateObservationHash", { num: i + 1 })}</p>
                {asStr(o.technicalObservation) && <p className="text-xs text-[var(--muted)] whitespace-pre-wrap">{asStr(o.technicalObservation)}</p>}
                {asStr(o.qualityConcern) && <p className="text-xs"><span className="font-medium text-[var(--warning)]">{t("hqForm.viewQualityConcern")}</span> {asStr(o.qualityConcern)}</p>}
                {asStr(o.goodPractice) && <p className="text-xs"><span className="font-medium text-[var(--success)]">{t("hqForm.viewGoodPractice")}</span> {asStr(o.goodPractice)}</p>}
                {asStr(o.actionRequired) && <p className="text-xs"><span className="font-medium text-[var(--danger)]">{t("hqForm.viewActionRequired")}</span> {asStr(o.actionRequired)}</p>}
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
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2 text-xs">
                <Chip size="sm" variant="tertiary">{asStr(r.entityType) === "project" ? t("hqForm.entityProject") : t("hqForm.entityState")}</Chip>
                <span className="flex-1 font-medium" dir="auto">{asStr(r.entityLabel)}</span>
                <Chip
                  size="sm"
                  variant="soft"
                  color={asStr(r.rating) === "Excellent" || asStr(r.rating) === "Good" ? "success" : asStr(r.rating) === "Fair" ? "warning" : "danger"}
                >
                  {optionLabel(t, "technicalRatings", asStr(r.rating))}
                </Chip>
                {asStr(r.reason) && (
                  <span className="min-w-0 flex-1 whitespace-pre-wrap text-page-start text-[var(--muted)]" dir="auto">{asStr(r.reason)}</span>
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
              <div key={i} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-sm">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium">{optionLabel(t, "supportTypes", asStr(r.supportType))}</span>
                  {asStr(r.priority) && <Chip size="sm" variant="soft" color={asStr(r.priority) === "High" ? "danger" : "default"}>{optionLabel(t, "priorities", asStr(r.priority))}</Chip>}
                </div>
                <p className="text-xs text-[var(--muted)] whitespace-pre-wrap">{asStr(r.description)}</p>
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
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-[var(--border)] p-2 text-xs">
                {typeof r.id === "number" && <Link2 className="size-3 shrink-0 text-[var(--accent)]" aria-hidden="true" />}
                <span className="flex-1 font-medium" dir="auto">{asStr(r.title)}</span>
                {asStr(r.category) && <Chip size="sm" variant="tertiary">{optionLabel(t, "riskCategories", asStr(r.category))}</Chip>}
                {asStr(r.severity) && <Chip size="sm" variant="soft" color={severityColor(asStr(r.severity))}>{severityText(t, asStr(r.severity))}</Chip>}
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
                <p className="text-[var(--muted)] whitespace-pre-wrap">{asStr(c.commentary)}</p>
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
