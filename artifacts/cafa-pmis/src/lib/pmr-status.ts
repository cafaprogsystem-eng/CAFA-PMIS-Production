/** Shared PMR per-location status presentation.
 *  Text + chip colour — never colour-only meaning. The key is under
 *  reports:completeness.*; the English fallback matches the en locale. */
export function locationStatusBadge(status: string | null): {
  key: string;
  fallback: string;
  color: "default" | "accent" | "success" | "danger";
} {
  if (status === null) return { key: "completeness.notSubmitted", fallback: "Not Submitted", color: "default" };
  if (status === "draft") return { key: "completeness.draft", fallback: "Draft", color: "default" };
  if (status === "rejected") return { key: "completeness.returned", fallback: "Returned – Revision Required", color: "danger" };
  if (status === "approved") return { key: "completeness.approved", fallback: "Approved", color: "success" };
  if (status === "submitted") return { key: "completeness.submittedStatus", fallback: "Submitted", color: "accent" };
  return { key: "completeness.inReview", fallback: "In Review", color: "accent" };
}
