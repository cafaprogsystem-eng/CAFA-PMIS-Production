/**
 * TERMINAL-RISK-STATUSES-IMPOSSIBLE-VALUES — TERMINAL_RISK_STATUSES and
 * ACTIVE_RISK_STATUS_SQL (riskConstants.ts) included "resolved" and
 * "cancelled", but routes/risks.ts's VALID_STATUSES (the actual enforced set
 * a risk's status column can ever hold) never included either value — they
 * were dead entries that could never match a real row. Removed so the list
 * only names statuses a risk can actually reach.
 */
import { describe, it, expect } from "vitest";
import { TERMINAL_RISK_STATUSES, ACTIVE_RISK_STATUS_SQL } from "../lib/riskConstants";

describe("TERMINAL-RISK-STATUSES-IMPOSSIBLE-VALUES", () => {
  it("TERMINAL_RISK_STATUSES no longer lists 'resolved' or 'cancelled'", () => {
    expect(TERMINAL_RISK_STATUSES).toEqual(["closed", "mitigated"]);
  });

  it("ACTIVE_RISK_STATUS_SQL matches the same trimmed set", () => {
    expect(ACTIVE_RISK_STATUS_SQL).toBe(`NOT IN ('closed','mitigated')`);
  });

  it("every remaining status is a real, reachable risk status per routes/risks.ts's VALID_STATUSES", () => {
    const validStatuses = new Set([
      "open", "under_mitigation", "closed", "identified", "assigned",
      "mitigation_plan", "follow_up", "escalation", "mitigated",
    ]);
    for (const status of TERMINAL_RISK_STATUSES) {
      expect(validStatuses.has(status)).toBe(true);
    }
  });
});
