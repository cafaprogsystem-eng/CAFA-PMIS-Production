/**
 * ActivityReportDetail — professional submitted-report view for Activity Reports.
 *
 * Extracted from reports.tsx (was inline) as part of the UX/UI redesign (Task 198).
 * This file owns the complete read-only presentation of a submitted Activity Report.
 *
 * Architecture:
 *   - All hooks declared before any early return (hook-order safety).
 *   - Business logic (transitions, perms, mutations) stays in reports.tsx;
 *     only display-time handlers are passed as props.
 *   - WorkflowChainRow & ARNarrativeField defined at module scope per
 *     react/no-unstable-nested-components rule.
 *
 * Visual Polish Round 2 (Task 211):
 *   - Duplicate h1/status removed (sticky viewer header is sole location).
 *   - Section headings → Title Case, text-base font-semibold.
 *   - Metadata strip → responsive grid layout.
 *   - Implementation Progress → labelled 3-column card.
 *   - Beneficiary grid → max-w-[600px] with Total emphasis.
 *   - Approval Path → labelled bordered container.
 *   - Review & Approval → always shown for non-draft; CommentsPanel integrated.
 */

import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  FileText, Target, Users, AlertTriangle, Info, Paperclip,
  ChevronRight, MapPin, BookOpen, Calendar, User, Send,
  ClipboardCheck,
} from "lucide-react";
import { formatDate, formatDateTime, formatLocation } from "@/lib/format";
import { VoiceNotePanel } from "@/components/voice-note-panel";
import { CommentsPanel } from "@/components/comments-panel";
import type { ListReportsQueryResult } from "@workspace/api-client-react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Report = NonNullable<ListReportsQueryResult>["items"][number];

type SavedAttachment = {
  id: number;
  reportId: number;
  fileName: string;
  contentType: string | null;
  size: number | null;
  availabilityStatus?: "available" | "unavailable";
};

export type ARTransitionItem = {
  action: string;
  label: string;
  variant?: "default" | "destructive" | "outline" | "secondary";
  icon: React.ComponentType<{ className?: string }>;
};

export type ActivityReportDetailProps = {
  report: Report;
  transitions: ARTransitionItem[];
  onTransitionOpen: (t: { action: string; label: string }) => void;
  reportUnresolvedRC: number;
  /** Current authenticated user's id — for CommentsPanel */
  currentUserId?: number | null;
  /** Current authenticated user's role — for CommentsPanel */
  currentUserRole?: string | null;
};

// ── Pure helpers ───────────────────────────────────────────────────────────────

/** Formats reporting month + year into a human-readable label (e.g. "August 2026"). */
export function formatMonthYear(
  month: number | null | undefined,
  year: number | null | undefined,
  locale = "en",
): string | null {
  if (!month || !year) return null;
  if (month < 1 || month > 12) return null;
  const monthName = new Date(2000, month - 1, 1).toLocaleString(locale === "ar" ? "ar" : "en", { month: "long" });
  return `${monthName} ${year}`;
}

/** Returns the secured download URL for a report attachment (never exposes objectPath). */
export function arAttachmentDownloadUrl(reportId: number, attachmentId: number): string {
  return `/api/reports/${reportId}/attachments/${attachmentId}/download`;
}

/** Derives a human-readable current-stage label from status + workflow path. */
export function deriveStageLabel(status: string, workflowPath: string | null | undefined): string | null {
  const isTech = workflowPath === "technical_authored";
  switch (status) {
    case "submitted":
      return isTech ? "Senior Programme Coordinator Review" : "Technical Coordinator Review";
    case "state_reviewed":
      return "Technical Coordinator Review";
    case "technically_approved":
      return "Coordination Review";
    case "coordination_approved":
      return "Programme Manager Approval";
    case "approved":
      return "Approved";
    case "rejected":
      return "Rejected";
    case "returned":
      return "Returned for Revision";
    default:
      return null;
  }
}

// ── Module-scope sub-components (react/no-unstable-nested-components) ──────────

/**
 * Renders an approval chain as abbreviations with full-role tooltips.
 * Defined at module scope to satisfy react/no-unstable-nested-components.
 */
function WorkflowChainRow({ abbrs, roles }: { abbrs: string[]; roles: string[] }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {abbrs.map((abbr, i) => (
        <span key={`${abbr}-${i}`} className="flex items-center gap-1">
          {i > 0 && (
            <ChevronRight
              className="h-2.5 w-2.5 text-muted-foreground/50 shrink-0 rtl:rotate-180"
              aria-hidden="true"
            />
          )}
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

/**
 * Renders a single narrative field only when it has content.
 * Uses a semantic heading (h3 by default) + reading-optimised prose.
 */
function ARNarrativeField({
  label,
  value,
  headingLevel = "h3",
}: {
  label: string;
  value?: string | null;
  headingLevel?: "h2" | "h3";
}) {
  if (!value?.trim()) return null;
  return (
    <div className="space-y-1 max-w-3xl">
      {headingLevel === "h2" ? (
        <h2 className="text-sm font-medium text-foreground">{label}</h2>
      ) : (
        <h3 className="text-sm font-medium text-foreground">{label}</h3>
      )}
      <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">
        {value.trim()}
      </p>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

/**
 * Complete professional read-only view for a submitted Activity Report.
 *
 * Renders sections in order:
 *   Header (link context + metadata strip — title/status are in the viewer sticky header)
 *   Approval Path
 *   Implementation Progress
 *   Results & Beneficiaries
 *   Challenges & Actions
 *   Lessons & Recommendations (conditional)
 *   Attachments & Voice
 *   Review & Approval (for non-draft reports; includes CommentsPanel)
 *
 * Historical records with missing newer fields render without crashes (FIX-07).
 * The secured attachment download endpoint is always used (never exposes objectPath).
 */
export function ActivityReportDetail({
  report,
  transitions,
  onTransitionOpen,
  reportUnresolvedRC,
  currentUserId,
  currentUserRole,
}: ActivityReportDetailProps) {
  // ── Hooks first (hook-order safety) ─────────────────────────────────────────
  const [detailAttachments, setDetailAttachments] = useState<SavedAttachment[]>([]);
  const { t, i18n } = useTranslation("reports");

  useEffect(() => {
    setDetailAttachments([]);
    fetch(`/api/reports/${report.id}/attachments`, { credentials: "include" })
      .then((res) => (res.ok ? (res.json() as Promise<SavedAttachment[]>) : []))
      .then((atts) => setDetailAttachments(atts))
      .catch(() => {});
  }, [report.id]);

  // ── Derive all display values ────────────────────────────────────────────────
  const r = report as Report & Record<string, unknown>;
  const sec = (report.sections ?? {}) as Record<string, string | undefined>;

  const workflowPath    = r.workflowPath    as string | null | undefined;
  const recommendations = r.recommendations as string | null | undefined;
  const activityName    = r.activityName    as string | null | undefined;
  const activityTitle   = r.activityTitle   as string | null | undefined;
  const activityCode    = r.activityCode    as string | null | undefined;
  const activityId      = r.activityId      as number | null | undefined;
  const projectTitle    = r.projectTitle    as string | null | undefined;
  const projectId       = r.projectId       as number | null | undefined;

  const reportingMonthNum = r.reportingMonth as number | null | undefined;
  const reportingYearNum  = r.reportingYear  as number | null | undefined;

  const hasBeneficiaryReach = sec["hasBeneficiaryReach"] as "yes" | "no" | undefined;
  const hasChallenges       = sec["hasChallenges"]       as "yes" | "no" | undefined;

  const implStatusVal = sec["implementationStatus"];
  const implStatusKey = implStatusVal ? `implementationStatus.${implStatusVal}` : null;
  const translatedImplStatus = implStatusKey ? t(implStatusKey) : null;
  const implStatusLabel = implStatusVal
    ? (translatedImplStatus === implStatusKey ? implStatusVal : translatedImplStatus)
    : null;

  // Link mode inferred from stored identifiers (mirrors form logic)
  const linkMode: "standalone" | "activity" | "project" =
    activityId ? "activity" : projectId ? "project" : "standalone";

  // Workflow path display (conservative default = state_authored)
  const isTechAuthored = workflowPath === "technical_authored";
  const workflowAbbrs  = isTechAuthored ? ["TC", "SPC", "PM"] : ["SPO", "TC", "SPC", "PM"];
  const workflowRoles  = isTechAuthored
    ? ["Technical Coordinator", "Senior Programme Coordinator", "Programme Manager"]
    : ["State Programme Officer", "Technical Coordinator", "Senior Programme Coordinator", "Programme Manager"];
  const workflowLabel  = isTechAuthored ? t("approval.technicalAuthored") : t("approval.stateAuthored");

  // Beneficiary reach (FIX-07: null/historical → show counts)
  const showNoBeneficiaries   = hasBeneficiaryReach === "no";
  const showBeneficiaryCounts = !showNoBeneficiaries;

  const men   = report.beneficiariesMale;
  const women = report.beneficiariesFemale;
  const boys  = report.beneficiariesBoys;
  const girls = report.beneficiariesGirls;
  const total = (men ?? 0) + (women ?? 0) + (boys ?? 0) + (girls ?? 0);

  // Lessons section visibility
  const hasLessonsContent = !!(
    sec["lessonsLearned"] || recommendations || sec["successStory"] ||
    sec["coordinationUpdates"] || sec["communityFeedback"]
  );
  const hasInsightsContent = !!(
    sec["successStory"] || sec["coordinationUpdates"] || sec["communityFeedback"]
  );

  // Metadata strip values
  const locationLabel = formatLocation({
    locationType: r.locationType as string | null | undefined,
    stateName:    report.stateName,
    stateNameAr:  report.stateNameAr,
    stateId:      r.stateId as number | null | undefined,
  }, i18n?.language);
  const sectorLabel = report.effectiveSector ?? report.sector;
  const periodLabel = formatMonthYear(reportingMonthNum, reportingYearNum, i18n.language);
  const preparedBy  = report.authorName ?? report.submittedByName ?? "—";
  const submittedAt = report.submittedAt;

  // Implementation dates
  const actualStartDate = sec["actualStartDate"];
  const actualEndDate   = sec["actualEndDate"];

  // Review & Approval
  const stageLabel = deriveStageLabel(report.status, workflowPath);
  const stageTranslationKeys: Record<string, string> = {
    "Technical Coordinator Review": "activityDetail.technicalCoordinatorReview",
    "Senior Programme Coordinator Review": "activityDetail.seniorProgrammeCoordinatorReview",
    "Coordination Review": "approval.coordinationReview",
    "Programme Manager Approval": "activityDetail.programmeManagerApproval",
    "Approved": "status.approved",
    "Rejected": "status.rejected",
    "Returned for Revision": "approval.returnForRevision",
  };
  const localizedStageLabel = stageLabel ? t(stageTranslationKeys[stageLabel] ?? "status.draft") : null;
  const showReviewSection = report.status !== "draft";

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div>

      {/* ── Header ───────────────────────────────────────────────────────────── */}
      {/* Title and status badge live in the viewer sticky header — not duplicated here. */}
      <div className="pb-4">
        {/* Activity name (when distinct from title — provides subject context) */}
        {activityName && activityName !== report.title && (
          <p className="text-sm text-muted-foreground mb-1">{activityName}</p>
        )}

        {/* Link context line */}
        <div className="text-xs text-muted-foreground mb-1">
          {linkMode === "standalone" && (
            <span>{t("activityDetail.standalone")}</span>
          )}
          {linkMode === "activity" && (
            <span>
              {t("activityDetail.activity")}: {activityCode ? `${activityCode} — ` : ""}
              {activityTitle ?? activityName ?? "—"}
              {projectTitle && <span> · {t("activityDetail.project")}: {projectTitle}</span>}
            </span>
          )}
          {linkMode === "project" && (
            <span>{t("activityDetail.project")}: {projectTitle ?? "—"}</span>
          )}
        </div>

        {/* Metadata strip — responsive grid */}
        <div className="grid grid-cols-1 min-[420px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-4 gap-y-3 mt-3 border-t pt-3">
          {locationLabel && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("activityDetail.location")}
              </p>
              <p className="text-sm font-medium text-foreground">{locationLabel}</p>
            </div>
          )}
          {sectorLabel && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                <BookOpen className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("activityDetail.sector")}
              </p>
              <p className="text-sm font-medium text-foreground">{sectorLabel}</p>
            </div>
          )}
          {periodLabel && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("fields.period")}
              </p>
              <p className="text-sm font-medium text-foreground">{periodLabel}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
              <User className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("detail.preparedBy")}
            </p>
            <p className="text-sm font-medium text-foreground">{preparedBy}</p>
          </div>
          {submittedAt && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5 flex items-center gap-1">
                <Send className="h-3 w-3 shrink-0" aria-hidden="true" />
                {t("detail.submitted")}
              </p>
              <p className="text-sm font-medium text-foreground">{formatDateTime(submittedAt)}</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Approval Path ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="section-ar-workflow" className="pt-5 border-t">
        <h2
          id="section-ar-workflow"
          className="text-base font-semibold text-foreground mb-3"
        >
          {t("activityDetail.approvalPath")}
        </h2>
        <div className="rounded-lg border border-border/60 bg-muted/20 px-4 py-2">
          <p className="text-xs font-medium text-muted-foreground mb-1">
            {workflowLabel} {t("activityDetail.workflow")}
          </p>
          <WorkflowChainRow abbrs={workflowAbbrs} roles={workflowRoles} />
        </div>
      </section>

      {/* ── Implementation Progress ───────────────────────────────────────────── */}
      <section aria-labelledby="section-ar-implementation" className="pt-5 border-t space-y-4">
        <h2
          id="section-ar-implementation"
          className="text-base font-semibold text-foreground flex items-center gap-2"
        >
          <Target className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          {t("activityDetail.implementationProgress")}
        </h2>

        {(implStatusLabel || actualStartDate || actualEndDate) && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 rounded-lg bg-muted/30 p-2">
            {implStatusLabel && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("activityDetail.status")}</p>
                <Badge variant="outline" className="text-xs">{implStatusLabel}</Badge>
              </div>
            )}
            {actualStartDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("activityDetail.actualStart")}</p>
                <p className="text-sm font-medium text-foreground">{formatDate(actualStartDate)}</p>
              </div>
            )}
            {actualEndDate && (
              <div>
                <p className="text-xs text-muted-foreground mb-1">{t("activityDetail.actualEnd")}</p>
                <p className="text-sm font-medium text-foreground">{formatDate(actualEndDate)}</p>
              </div>
            )}
          </div>
        )}

        <ARNarrativeField label={t("wizard.step2.implementationSummary")} value={sec["implementationSummary"]} />
        <ARNarrativeField label={t("wizard.step2.progressAgainstPlan")} value={sec["progressAgainstPlan"]} />
        <ARNarrativeField label={t("wizard.step2.implementationHighlights")} value={sec["keyAchievements"]} />
      </section>

      {/* ── Results & Beneficiaries ───────────────────────────────────────────── */}
      <section aria-labelledby="section-ar-results" className="pt-5 border-t space-y-4">
        <h2
          id="section-ar-results"
          className="text-base font-semibold text-foreground flex items-center gap-2"
        >
          <Users className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          {t("activityDetail.resultsBeneficiaries")}
        </h2>

        <ARNarrativeField label={t("activityDetail.resultsAchieved")} value={sec["resultsAchieved"]} />

        {showNoBeneficiaries ? (
          <p className="text-sm text-muted-foreground italic">
            {t("activityDetail.noBeneficiaryReach")}
          </p>
        ) : (
          showBeneficiaryCounts && (
            <div>
              <h3 className="text-sm font-medium text-foreground mb-2">{t("activityDetail.directBeneficiaryReach")}</h3>
              <div className="grid w-full grid-cols-2 sm:grid-cols-5 gap-x-6 gap-y-2 text-center">
                {(
                  [
                    { label: t("detail.male"),   value: men   },
                    { label: t("detail.female"), value: women },
                    { label: t("detail.boys"),   value: boys  },
                    { label: t("detail.girls"),  value: girls },
                  ] as Array<{ label: string; value: number | null | undefined }>
                ).map(({ label, value }) => (
                  <div key={label} className="flex flex-col items-center">
                    <span className="text-sm text-muted-foreground mb-1">{label}</span>
                    <span className="text-base font-medium text-foreground/80">
                       {value != null ? value.toLocaleString(i18n.language === "ar" ? "ar" : "en-GB") : "—"}
                    </span>
                  </div>
                ))}
                {/* Total — stronger visual weight with separator */}
                <div className="flex flex-col items-center border-s border-border/40 ps-4">
                  <span className="text-sm text-muted-foreground mb-1">{t("detail.total")}</span>
                  <span className="text-lg font-semibold text-foreground">
                    {total.toLocaleString(i18n.language === "ar" ? "ar" : "en-GB")}
                  </span>
                </div>
              </div>
            </div>
          )
        )}
      </section>

      {/* ── Challenges & Actions ──────────────────────────────────────────────── */}
      <section aria-labelledby="section-ar-challenges" className="pt-5 border-t space-y-4">
        <h2
          id="section-ar-challenges"
          className="text-base font-semibold text-foreground flex items-center gap-2"
        >
          <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          {t("activityDetail.challengesActions")}
        </h2>

        {hasChallenges === "no" ? (
          <p className="text-sm text-muted-foreground italic">{t("activityDetail.noChallenges")}</p>
        ) : (
          <>
            <ARNarrativeField label={t("activityForm.step4.challengesTextLabel")} value={sec["challenges"]} />
            <ARNarrativeField label={t("activityForm.step4.actionsTakenLabel")} value={sec["mitigationMeasures"]} />
          </>
        )}
        {/* Follow-Up Actions are independent of hasChallenges toggle */}
        <ARNarrativeField label={t("activityForm.step4.sectionFollowUp")} value={sec["nextSteps"]} />
      </section>

      {/* ── Lessons & Recommendations ─────────────────────────────────────────── */}
      {hasLessonsContent && (
        <section aria-labelledby="section-ar-lessons" className="pt-5 border-t space-y-4">
          <h2
            id="section-ar-lessons"
            className="text-base font-semibold text-foreground flex items-center gap-2"
          >
            <Info className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {t("activityDetail.lessonsRecommendations")}
          </h2>

          {/* Core fields — prominent */}
          <ARNarrativeField label={t("stateForm.lessonsLearnedLabel")} value={sec["lessonsLearned"]} />
          {/* recommendations is a top-level DB column, not in sections JSONB */}
          <ARNarrativeField label={t("fields.recommendations")} value={recommendations} />

          {/* Supporting Insights — lower visual weight, only if populated */}
          {hasInsightsContent && (
            <div className="pt-3 border-t space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground">
                {t("activityDetail.supportingInsights")}
              </h3>
              <ARNarrativeField label={t("activityDetail.successStory")} value={sec["successStory"]} />
              <ARNarrativeField label={t("stateForm.coordinationUpdatesLabel")} value={sec["coordinationUpdates"]} />
              <ARNarrativeField label={t("stateForm.communityFeedbackLabel")} value={sec["communityFeedback"]} />
            </div>
          )}
        </section>
      )}

      {/* ── Attachments & Voice ───────────────────────────────────────────────── */}
      <section aria-labelledby="section-ar-evidence" className="pt-5 border-t">
        <h2
          id="section-ar-evidence"
          className="text-base font-semibold text-foreground flex items-center gap-2 mb-3"
        >
          <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
          {t("activityDetail.attachmentsVoice")}
        </h2>

        {detailAttachments.length > 0 && (
          <div className="mb-4 w-full">
            <h3 className="text-xs font-medium text-muted-foreground mb-1.5">{t("activityDetail.supportingAttachments")}</h3>
            {detailAttachments.map((att) => (
              <div
                key={att.id}
                className="flex items-center justify-between gap-3 py-1.5 border-b last:border-0"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
                  <span className="text-sm truncate" title={att.fileName}>
                    {att.fileName}
                  </span>
                  {att.contentType && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {att.contentType.split("/")[1]?.toUpperCase() ?? att.contentType}
                      {att.size != null && ` · ${Math.round(att.size / 1024)} KB`}
                    </span>
                  )}
                </div>
                {att.availabilityStatus === "unavailable" ? (
                  <span role="status" className="text-xs text-muted-foreground shrink-0">File Unavailable</span>
                ) : (
                  /* Secured endpoint — objectPath is never exposed */
                  <a
                    href={arAttachmentDownloadUrl(report.id, att.id)}
                    download={att.fileName}
                    className="text-xs font-medium text-primary hover:underline shrink-0"
                    aria-label={t("activityDetail.downloadAttachment", { fileName: att.fileName })}
                  >
                    {t("activityDetail.downloadAttachment", { fileName: "" }).trim()}
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        <VoiceNotePanel entityType="report" entityId={report.id} readOnly />

        {detailAttachments.length === 0 && (
          /* VoiceNotePanel renders its own empty state; only add a message
             when there are also no attachments. */
          <p className="text-sm text-muted-foreground italic mt-2">
            {t("activityDetail.noSupportingEvidence")}
          </p>
        )}
      </section>

      {/* ── Review & Approval ─────────────────────────────────────────────────── */}
      {showReviewSection && (
        <section aria-labelledby="section-ar-review" className="pt-5 border-t">
          <h2
            id="section-ar-review"
            className="text-base font-semibold text-foreground flex items-center gap-2 mb-3"
          >
            <ClipboardCheck className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden="true" />
            {t("activityDetail.reviewApproval")}
          </h2>

          {/* Current Stage */}
          {stageLabel && (
            <div className="mb-4">
              <p className="text-xs text-muted-foreground mb-1">{t("activityDetail.currentStage")}</p>
              <p className="text-sm font-medium text-foreground">{localizedStageLabel}</p>
            </div>
          )}

          {/* Available Actions */}
          {transitions.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-5">
              {transitions.map((tr) => {
                const blocked = tr.action === "final_approve" && reportUnresolvedRC > 0;
                return (
                  <Button
                    key={tr.action}
                    size="sm"
                    variant={tr.variant ?? "default"}
                    disabled={blocked}
                    title={
                      blocked
                        ? t("activityDetail.unresolvedCorrections", { count: reportUnresolvedRC })
                        : undefined
                    }
                    onClick={() => onTransitionOpen({ action: tr.action, label: tr.label })}
                  >
                <tr.icon className="h-4 w-4" aria-hidden="true" />
                    {tr.label}
                  </Button>
                );
              })}
            </div>
          )}

          {/* Comments & Revisions — CommentsPanel's own CardTitle is the heading */}
          <div className="mt-5">
            <CommentsPanel
              entityType="report"
              entityId={report.id}
              sections={["narrative", "activities", "beneficiaries", "challenges"]}
              sectionLabels={{
                narrative: t("detail.narrative"),
                activities: t("detail.activitiesImplemented"),
                beneficiaries: t("detail.beneficiarySummary"),
                challenges: t("fields.challenges"),
              }}
              currentUserId={currentUserId ?? null}
              currentUserRole={currentUserRole ?? null}
            />
          </div>
        </section>
      )}
    </div>
  );
}
