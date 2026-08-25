/** Shared PMR per-location status presentation.
 *  Text + badge variant — never colour-only meaning. */
export function locationStatusBadge(status: string | null): {
  label: string;
  variant: "default" | "secondary" | "outline" | "destructive";
} {
  if (status === null) return { label: "Not Submitted", variant: "outline" };
  if (status === "draft") return { label: "Draft", variant: "secondary" };
  if (status === "rejected") return { label: "Returned – Revision Required", variant: "destructive" };
  if (status === "approved") return { label: "Approved", variant: "default" };
  if (status === "submitted") return { label: "Submitted", variant: "secondary" };
  return { label: "In Review", variant: "secondary" };
}
