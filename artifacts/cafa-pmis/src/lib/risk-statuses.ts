/**
 * Canonical Risk status choices accepted by the Risk PATCH contract.
 *
 * Keep filter-specific status lists separate: the Risk Register filter has
 * intentionally narrower query semantics than the editor.
 */
export const RISK_STATUS_OPTIONS = [
  { value: "open", labelKey: "status.open", fallback: "Open" },
  { value: "under_mitigation", labelKey: "status.under_mitigation", fallback: "Under Mitigation" },
  { value: "closed", labelKey: "status.closed", fallback: "Closed" },
  { value: "identified", labelKey: "status.identified", fallback: "Identified" },
  { value: "assigned", labelKey: "status.assigned", fallback: "Assigned" },
  { value: "mitigation_plan", labelKey: "status.mitigation_plan", fallback: "Mitigation Plan" },
  { value: "follow_up", labelKey: "status.follow_up", fallback: "Follow Up" },
  { value: "escalation", labelKey: "status.escalation", fallback: "Escalation" },
  { value: "mitigated", labelKey: "status.mitigated", fallback: "Mitigated" },
] as const;

export const RISK_STATUS_VALUES = RISK_STATUS_OPTIONS.map((option) => option.value);

export function formatRiskStatus(status: string | null | undefined): string {
  if (!status) return RISK_STATUS_OPTIONS[0].fallback;
  return RISK_STATUS_OPTIONS.find((option) => option.value === status)?.fallback
    ?? status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
}