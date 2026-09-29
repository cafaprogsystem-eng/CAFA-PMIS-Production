/**
 * ActivityReportViewer
 *
 * Centred large dialog viewer for submitted Activity Report detail. The shared
 * RecordDetailModal owns the viewport, scroll, accessibility, and focus contract;
 * ActivityReportDetail owns only report presentation.
 */
import { useTranslation } from "react-i18next";
import { ActivityReportDetail, ActivityReportDetailProps } from "./activity-report-detail";
import { ReportStatusChip } from "@/components/report-status-chip";
import { RecordDetailModal } from "@/components/record-detail-modal";

// Re-export ARTransitionItem so callers can import from one place
export type { ARTransitionItem } from "./activity-report-detail";

/** Map backend status strings to human-readable labels. */
function displayStatus(backend: string, translate?: (key: string) => string): string {
  const MAP: Record<string, string> = {
    draft: "Draft",
    submitted: "Submitted",
    state_reviewed: "State Reviewed",
    technically_approved: "Technically Approved",
    coordination_approved: "Coordination Approved",
    approved: "Approved",
    rejected: "Rejected",
    archived: "Archived",
    returned: "Returned",
  };
  if (!translate) return MAP[backend] ?? backend;
  const key = `status.${backend}`;
  const localized = translate(key);
  return localized === key ? (MAP[backend] ?? backend) : localized;
}

interface ActivityReportViewerProps extends ActivityReportDetailProps {
  open: boolean;
  onClose: () => void;
  onCloseComplete?: () => void;
  restoreFocusRef?: React.RefObject<HTMLElement | null>;
  headerActions?: React.ReactNode;
}

export function ActivityReportViewer({
  open,
  onClose,
  onCloseComplete,
  report,
  transitions,
  onTransitionOpen,
  reportUnresolvedRC,
  currentUserId,
  currentUserRole,
  restoreFocusRef,
  headerActions,
}: ActivityReportViewerProps) {
  const { t } = useTranslation("reports");
  return (
    <RecordDetailModal
      open={open}
      onClose={onClose}
      onCloseComplete={onCloseComplete}
      title={report?.title ?? t("detail.activityReport")}
      description={t("detail.activityReportViewerDescription")}
      restoreFocusRef={restoreFocusRef}
      headerActions={headerActions}
      metadata={report?.status ? <ReportStatusChip status={report.status} label={displayStatus(report.status, t)} /> : undefined}
    >
      {report && (
        <ActivityReportDetail
          report={report}
          transitions={transitions}
          onTransitionOpen={onTransitionOpen}
          reportUnresolvedRC={reportUnresolvedRC}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
        />
      )}
    </RecordDetailModal>
  );
}
