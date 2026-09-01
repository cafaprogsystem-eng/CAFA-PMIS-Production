/**
 * REPORTS-STANDALONE-STATE-TRANSITION-NOTIFY — a standalone (no project_id)
 * program_state report transitioning through review (submit/technical
 * review/coordination review/approve/reject/request revision/archive) only
 * ever notified its own author/submitter (actorsForEntity("report", …)
 * resolves via submitted_by_id/author_id/project_assignments — the last of
 * which is empty for a standalone report), never any OTHER State Program
 * Officer or State Office Manager in the report's own state. Contrast with
 * routes/risks.ts, which already directly notifies every other active
 * SPO/SOM in a standalone risk's state on both creation and status change.
 *
 * The transition handler now does the same: for reportType==="program_state"
 * with no project_id and a real state_id, it additionally reaches every
 * other active SPO/SOM in that state, post-commit, using the same
 * transitionDedupeKey as the entity-actors notification (so it collapses
 * with, rather than duplicates, other delivery paths for the same
 * transition).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(resolve(__dirname, "../routes/reports.ts"), "utf8");

describe("REPORTS-STANDALONE-STATE-TRANSITION-NOTIFY", () => {
  const block = src.slice(
    src.indexOf('notifyEntityActorsDeduped({\n        entityType: "report"'),
    src.indexOf("// ── HQSR routing path"),
  );

  it("is gated to standalone (no project) program_state reports with a real state_id", () => {
    expect(block).toContain('reportType === "program_state" && !reportProjectId && reportStateId');
  });

  it("queries every other active state_program_officer/state_office_manager in that same state", () => {
    expect(block).toContain(
      "SELECT id FROM users WHERE role IN ('state_program_officer', 'state_office_manager') AND state_id = $1 AND status = 'active'",
    );
    expect(block).toContain("[reportStateId]");
  });

  it("excludes the actor performing the transition from being notified about their own action", () => {
    expect(block).toContain("if (u.id !== req.currentUser.id) {");
  });

  it("reuses the same kindMap and transitionDedupeKey as the entity-actors notification (single coherent event, not a duplicate)", () => {
    expect(block).toContain("kind: kindMap[body.action] ?? \"system\",");
    expect(block).toContain("dedupeKey: transitionDedupeKey,");
  });

  it("runs post-commit (non-blocking, .catch-guarded) — never inside the row-locking transaction", () => {
    expect(block).toContain("createNotificationDeduped({");
    expect(block).toContain(".catch(() => {});");
  });

  it("reportProjectId is actually extracted from the locked report row (not left undefined)", () => {
    expect(src).toContain("projectId: reportProjectId,");
  });
});
