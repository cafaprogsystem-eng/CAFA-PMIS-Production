/**
 * Shared buildPayload/buildPatchPayload helpers for HQ Sector Report and
 * State/Program Report forms. Both forms independently hand-rolled the same
 * two computations (attachment sanitisation, reporting-period label) across
 * four call sites total (HQSR's buildPayload + buildPatchPayload, SPR's
 * buildPayload); this module is the single source of truth for both so a
 * future fix to either only needs to happen once.
 */

export interface ReportFormAttachment {
  tempId: string;
  attachmentId?: number;
  fileName: string;
  contentType: string;
  size: number;
  objectPath: string;
  file?: File;
  attachmentType: string;
  uploading?: boolean;
}

/**
 * Drops attachments that never reached a stored identity (no attachmentId
 * from a completed upload, no objectPath) and strips the browser-local-only
 * fields (tempId/uploading/file) before the record is sent to the server.
 */
export function sanitizeReportAttachments<T extends ReportFormAttachment>(
  attachments: T[],
): Array<Omit<T, "tempId" | "uploading" | "file">> {
  return attachments
    .filter((d) => d.attachmentId || d.objectPath)
    .map(({ tempId: _tempId, uploading: _uploading, file: _file, ...rest }) => rest);
}

export interface ReportPeriodInput {
  frequency: "monthly" | "quarterly" | "annual" | "on_demand" | string;
  reportingYear: number | string;
  quarter?: number | string;
  reportingMonth?: number | string;
  periodStart?: string;
  periodEnd?: string;
}

/**
 * Builds the human-readable `period` label stored on a report.
 *
 * `onDemandFormat` captures the one genuine difference between the two
 * forms' otherwise-identical formula: HQSR has no separate top-level
 * periodStart/periodEnd fields (HQSR-004 forbids any top-level location/
 * period fields beyond `sections`), so its on-demand period must encode the
 * full range as text ("range"); SPR sends periodStart/periodEnd as their own
 * top-level fields alongside `period`, so its on-demand period is just the
 * start date ("start-only"). Every other frequency branch is identical
 * between the two forms.
 */
export function buildReportPeriodLabel(
  input: ReportPeriodInput,
  onDemandFormat: "range" | "start-only",
): string {
  const { frequency, reportingYear, quarter, reportingMonth, periodStart, periodEnd } = input;
  if (frequency === "quarterly") return `${reportingYear}-Q${quarter}`;
  if (frequency === "annual") return String(reportingYear);
  if (frequency === "on_demand") {
    return onDemandFormat === "range" ? `${periodStart} to ${periodEnd}` : String(periodStart ?? "");
  }
  return `${reportingYear}-${String(reportingMonth).padStart(2, "0")}`;
}
