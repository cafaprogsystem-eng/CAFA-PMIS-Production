/**
 * REPORT-TRANSITIONS-SHARED — the Report workflow transition tables
 * (STATE_AUTHORED_TRANSITIONS, TECHNICAL_AUTHORED_TRANSITIONS,
 * SIMPLE_CHAIN_TRANSITIONS, getProjectActivityWorkflow, getRevisionPerm)
 * previously lived only in lib/reportConstants.ts, and reports.tsx
 * (frontend) hand-maintained its own parallel copy in transitionsFor() —
 * which had already drifted for the HQ Sector Report "spc_fallback" path:
 * the backend generalised coordination-review to always require
 * reports.approve.coordination (Task #373 — PM now holds it via Full
 * Operational Access), but the frontend kept requiring reports.approve.final
 * for that one path. Both now live in the framework-agnostic
 * @workspace/report-transitions package; reportConstants.ts imports and
 * re-exports them (so every existing backend consumer keeps working
 * unchanged), and reports.tsx derives transitionsFor() from them instead of
 * hardcoding its own from/perm values.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { REPORT_WORKFLOWS, getProjectActivityWorkflow, getRevisionPerm } from "@workspace/report-transitions";
import {
  REPORT_WORKFLOWS as reportConstantsWorkflows,
  getProjectActivityWorkflow as reportConstantsGetWorkflow,
  getRevisionPerm as reportConstantsGetRevisionPerm,
} from "../lib/reportConstants";

const reportConstantsSrc = readFileSync(resolve(__dirname, "../lib/reportConstants.ts"), "utf8");
const reportsTsxSrc = readFileSync(
  resolve(__dirname, "../../../cafa-pmis/src/pages/reports.tsx"),
  "utf8",
);

describe("REPORT-TRANSITIONS-SHARED: one source of truth for the Report transition tables", () => {
  it("lib/reportConstants.ts re-exports the shared package's tables (identity, not a copy)", () => {
    expect(reportConstantsWorkflows).toBe(REPORT_WORKFLOWS);
    expect(reportConstantsGetWorkflow).toBe(getProjectActivityWorkflow);
    expect(reportConstantsGetRevisionPerm).toBe(getRevisionPerm);
  });

  it("reportConstants.ts no longer defines its own transition table object literals", () => {
    expect(reportConstantsSrc).toContain('from "@workspace/report-transitions"');
    expect(reportConstantsSrc).not.toMatch(/const STATE_AUTHORED_TRANSITIONS: WorkflowActions = \{/);
    expect(reportConstantsSrc).not.toMatch(/const SIMPLE_CHAIN_TRANSITIONS: WorkflowActions = \{/);
  });

  it("reports.tsx derives transitionsFor() from the shared package instead of hardcoding per-path perm branching", () => {
    expect(reportsTsxSrc).toContain('from "@workspace/report-transitions"');
    expect(reportsTsxSrc).toContain("getProjectActivityWorkflow(workflowPath)");
    expect(reportsTsxSrc).toContain("getRevisionPerm(reportType ?? \"\", status, workflowPath)");
    // The drifted spc_fallback special-case must be gone entirely (only an
    // explanatory comment referencing the old variable name is allowed to remain).
    expect(reportsTsxSrc).not.toMatch(/const isHqsrSpcFallback =/);
    expect(reportsTsxSrc).not.toContain('"reports.approve.final"\n      : "reports.approve.coordination"');
  });

  it("sanity: HQSR coordination-review is unconditionally reports.approve.coordination regardless of workflow_path (the fixed drift)", () => {
    expect(REPORT_WORKFLOWS.hq_sector.coordination_review.perm).toBe("reports.approve.coordination");
    expect(getRevisionPerm("hq_sector", "submitted", "spc_fallback")).toBe("reports.approve.coordination");
    expect(getRevisionPerm("hq_sector", "submitted", null)).toBe("reports.approve.coordination");
  });

  it("sanity: the shared tables still match the known canonical Project/Activity workflow", () => {
    expect(getProjectActivityWorkflow("state_authored").technical_review.perm).toBe("reports.approve.technical");
    expect(getProjectActivityWorkflow("technical_authored").technical_review).toBeUndefined();
    expect(getRevisionPerm("project", "submitted", "state_authored")).toBe("reports.approve.technical");
    expect(getRevisionPerm("project", "technically_approved", "state_authored")).toBe("reports.approve.coordination");
  });
});
