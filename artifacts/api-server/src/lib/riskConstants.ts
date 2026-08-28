/** Terminal statuses excluded by every active Risk population. */
export const TERMINAL_RISK_STATUSES = [
  "closed",
  "mitigated",
  "resolved",
  "cancelled",
] as const;

/** SQL predicate suffix for a qualified Risk status expression. */
export const ACTIVE_RISK_STATUS_SQL =
  `NOT IN ('closed','mitigated','resolved','cancelled')`;