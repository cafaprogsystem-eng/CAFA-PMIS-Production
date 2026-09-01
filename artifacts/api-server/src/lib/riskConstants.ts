// "resolved" and "cancelled" were removed from this list during the
// Reports/Risk Register consistency pass — routes/risks.ts's VALID_STATUSES
// (the actual enforced set of risk statuses) never included either value,
// so they were dead entries that could never match a real row.
/** Terminal statuses excluded by every active Risk population. */
export const TERMINAL_RISK_STATUSES = [
  "closed",
  "mitigated",
] as const;

/** SQL predicate suffix for a qualified Risk status expression. */
export const ACTIVE_RISK_STATUS_SQL =
  `NOT IN ('closed','mitigated')`;