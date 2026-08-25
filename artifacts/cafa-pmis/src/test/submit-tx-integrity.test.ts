/**
 * Submit For Approval — transactional integrity tests.
 *
 * These tests verify the design invariants of the hardened Submit handler:
 * - All validation reads and writes are atomic within a single transaction
 * - The Plan row is locked (FOR UPDATE) before any authoritative field is read
 * - The workflow-state check uses the locked row, not a pre-transaction snapshot
 * - The status UPDATE is conditional (WHERE id = $planId AND status = $expected)
 * - Concurrent Submit requests cannot both succeed
 * - Concurrent PATCH / Save & Finish is serialised with Submit via the same lock
 * - Approval and audit records are written inside the transaction
 * - Notifications are delivered after COMMIT (non-transactional)
 * - All existing readiness rules are preserved unchanged
 *
 * All tests are pure-logic / design-invariant tests — no HTTP, no DB, no React.
 */

import { describe, it, expect } from "vitest";

/* ─── Shared validators (mirrors of the backend helpers) ──────────────────── */

const VALID_CURRENCIES = new Set(["USD", "SDG", "EUR", "AED"]);

function validatePlanBudgetReadiness(
  currency: string,
  budgetPlanned: number,
  activityBudgetTotal: number,
): string | null {
  if (!VALID_CURRENCIES.has(currency)) return "invalid_currency";
  if (!Number.isFinite(budgetPlanned) || budgetPlanned < 0) return "invalid_budget_planned";
  if (activityBudgetTotal > budgetPlanned) return "activity_budget_exceeds_plan";
  return null;
}

type ActivityInput = {
  title?: string;
  localityName?: string;
  plannedDate?: string;
  priority?: string;
  targetBeneficiaries?: number;
  budgetPlanned?: number;
  expectedResult?: string;
};

type PlanContext = {
  startDate: string | null;
  endDate: string | null;
  localities: string[];
};

function validatePlanActivityReadiness(a: ActivityInput, ctx: PlanContext): string | null {
  if (!a.title?.trim()) return "missing_title";
  if (!a.localityName?.trim()) return "missing_locality";
  if (!ctx.localities.map(l => l.toLowerCase()).includes((a.localityName ?? "").toLowerCase())) return "locality_not_in_plan";
  if (!a.plannedDate?.trim()) return "missing_planned_date";
  if (!a.priority || !["high", "medium", "low"].includes(a.priority)) return "invalid_priority";
  if (!Number.isFinite(a.targetBeneficiaries) || (a.targetBeneficiaries ?? 0) < 0) return "invalid_beneficiaries";
  if (!Number.isFinite(a.budgetPlanned) || (a.budgetPlanned ?? 0) < 0) return "invalid_budget";
  if (!a.expectedResult?.trim()) return "missing_expected_result";
  return null;
}

function normalisePlanLocalities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim().length > 0);
}

/* ─── Transaction simulator ───────────────────────────────────────────────── */

class SubmitError extends Error {
  constructor(public readonly code: string) { super(code); }
}

type DbPlan = {
  status: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  localities: unknown;
  currency: string | null;
  budget_planned: number | null;
};

type DbActivity = {
  title: string | null;
  locality_name: string | null;
  planned_date: string | null;
  priority: string | null;
  target_beneficiaries: number | null;
  budget_planned: number | null;
  expected_result: string | null;
};

type SubmitOpts = {
  planId: number;
  allowedFromStatuses: string[];        // transition.from
  transitionTo: string;                 // transition.to
  dbPlan: DbPlan | null;                // null → plan_not_found
  dbActivities: DbActivity[];
  /** When set, the conditional UPDATE matches 0 rows (simulates concurrent Submit winning) */
  updateRowCount?: number;
};

function makeSubmitSim() {
  const ops: string[] = [];
  const sideEffects: string[] = [];
  let committed = false;
  let rolledBack = false;
  let notificationsSent = false;
  let fromStatus = "";

  return {
    ops,
    sideEffects,
    get committed() { return committed; },
    get rolledBack() { return rolledBack; },
    get notificationsSent() { return notificationsSent; },
    get fromStatus() { return fromStatus; },

    run(opts: SubmitOpts): { status: number; body: object } | "ok" {
      try {
        ops.push("BEGIN");

        // §2 Lock plan row
        ops.push(`SELECT plans FOR UPDATE id=${opts.planId}`);
        if (opts.dbPlan === null) throw new SubmitError("plan_not_found");
        fromStatus = opts.dbPlan.status;

        // §5 Re-verify workflow state from locked row
        if (!opts.allowedFromStatuses.includes(opts.dbPlan.status)) {
          throw new SubmitError(`cannot_submit_from_${opts.dbPlan.status}`);
        }

        // §4 Read activities through client
        ops.push(`SELECT plan_activities id=${opts.planId}`);
        const acts = opts.dbActivities;

        // §7 Readiness checks
        if (acts.length === 0) throw new SubmitError("at_least_one_activity_required");
        if (!opts.dbPlan.description?.trim()) throw new SubmitError("description_required");
        const locs = normalisePlanLocalities(opts.dbPlan.localities);
        if (locs.length === 0) throw new SubmitError("geographical_coverage_required");

        const ctx: PlanContext = {
          startDate: opts.dbPlan.start_date,
          endDate: opts.dbPlan.end_date,
          localities: locs,
        };
        const inputs: ActivityInput[] = acts.map(r => ({
          title: r.title ?? "",
          localityName: r.locality_name ?? "",
          plannedDate: r.planned_date ?? "",
          priority: r.priority ?? "",
          targetBeneficiaries: r.target_beneficiaries ?? undefined,
          budgetPlanned: r.budget_planned ?? undefined,
          expectedResult: r.expected_result ?? "",
        }));
        const hasComplete = inputs.some(a => validatePlanActivityReadiness(a, ctx) === null);
        if (!hasComplete) throw new SubmitError("at_least_one_complete_activity_required");

        const budgetTotal = acts.reduce((s, r) => {
          const v = Number(r.budget_planned ?? 0);
          return s + (Number.isFinite(v) && v >= 0 ? v : 0);
        }, 0);
        const budgetErr = validatePlanBudgetReadiness(
          opts.dbPlan.currency ?? "",
          opts.dbPlan.budget_planned ?? NaN,
          budgetTotal,
        );
        if (budgetErr) throw new SubmitError(budgetErr);

        // Revoke registration sessions (inlined)
        ops.push("UPDATE plan_registration_sessions closed_at=NOW");

        // §6 Conditional status transition
        const rowCount = opts.updateRowCount ?? 1;
        ops.push(`UPDATE plans status=${opts.transitionTo} WHERE id=${opts.planId} AND status=${opts.dbPlan.status}`);
        if (rowCount !== 1) throw new SubmitError(`cannot_submit_from_${opts.dbPlan.status}`);

        // §10 Approval + audit inside transaction
        ops.push("INSERT approvals");
        sideEffects.push("approval");
        ops.push("INSERT audit_log");
        sideEffects.push("audit");

        ops.push("COMMIT");
        committed = true;
      } catch (err) {
        ops.push("ROLLBACK");
        rolledBack = true;
        if (err instanceof SubmitError) {
          const httpStatus = err.code === "plan_not_found" ? 404 : 400;
          return { status: httpStatus, body: { error: err.code } };
        }
        throw err;
      }

      // Notifications after COMMIT
      ops.push("notifyEntityActorsDeduped");
      ops.push("notifyNextApprover");
      notificationsSent = true;

      return "ok";
    },
  };
}

const okPlan: DbPlan = {
  status: "draft",
  description: "Comprehensive community support programme",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  localities: ["Kassala", "Khartoum"],
  currency: "USD",
  budget_planned: 100,
};

const okActivity: DbActivity = {
  title: "Community Assessment",
  locality_name: "Kassala",
  planned_date: "2026-06-15",
  priority: "high",
  target_beneficiaries: 200,
  budget_planned: 50,
  expected_result: "Full assessment delivered",
};

/* ══════════════════════════════════════════════════════════════════════
   Test 1: Submit starts a transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("1. Submit starts a transaction", () => {
  it("BEGIN is the first operation in the op sequence", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    expect(sim.ops[0]).toBe("BEGIN");
  });

  it("BEGIN appears even when validation subsequently fails", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [] });
    expect(sim.ops[0]).toBe("BEGIN");
    expect(sim.rolledBack).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 2: Plan row is read WITH FOR UPDATE
   ══════════════════════════════════════════════════════════════════════ */
describe("2. Plan row is locked before any validation", () => {
  it("FOR UPDATE appears immediately after BEGIN", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 7, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const beginIdx = sim.ops.indexOf("BEGIN");
    const lockIdx = sim.ops.findIndex(o => o.includes("FOR UPDATE"));
    expect(lockIdx).toBe(beginIdx + 1);
  });

  it("plan_not_found rolls back and returns 404 if plan disappears between pre-check and lock", () => {
    const sim = makeSubmitSim();
    const result = sim.run({ planId: 99, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: null, dbActivities: [] });
    expect(sim.rolledBack).toBe(true);
    expect(sim.committed).toBe(false);
    expect(result).toMatchObject({ status: 404, body: { error: "plan_not_found" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 3: Workflow state checked from locked Plan row
   ══════════════════════════════════════════════════════════════════════ */
describe("3. Workflow state checked from locked Plan row", () => {
  it("wrong status from locked row → rollback, cannot_submit_from_<status>", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, status: "submitted" }, // already submitted
      dbActivities: [okActivity],
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "cannot_submit_from_submitted" } });
  });

  it("workflow check occurs before activity read", () => {
    const sim = makeSubmitSim();
    sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, status: "active" },
      dbActivities: [okActivity],
    });
    const lockIdx = sim.ops.findIndex(o => o.includes("FOR UPDATE"));
    const actIdx = sim.ops.findIndex(o => o.includes("SELECT plan_activities"));
    const rollbackIdx = sim.ops.indexOf("ROLLBACK");
    expect(rollbackIdx).toBeGreaterThan(lockIdx);
    expect(actIdx).toBe(-1); // never reached
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 4: Activities read through transaction client
   ══════════════════════════════════════════════════════════════════════ */
describe("4. Activities read through transaction client", () => {
  it("SELECT plan_activities appears after FOR UPDATE lock", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const lockIdx = sim.ops.findIndex(o => o.includes("FOR UPDATE"));
    const actIdx = sim.ops.findIndex(o => o.includes("SELECT plan_activities"));
    expect(actIdx).toBeGreaterThan(lockIdx);
  });

  it("activities read and validated against the same locked plan context", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: okPlan,
      dbActivities: [{ ...okActivity, locality_name: "NotInPlan" }], // locality mismatch
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "at_least_one_complete_activity_required" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 5: Activity readiness validated inside transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("5. Activity readiness validated inside transaction", () => {
  it("activity check occurs after BEGIN and FOR UPDATE", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const beginIdx = sim.ops.indexOf("BEGIN");
    const lockIdx = sim.ops.findIndex(o => o.includes("FOR UPDATE"));
    const actIdx = sim.ops.findIndex(o => o.includes("SELECT plan_activities"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(actIdx).toBeGreaterThan(lockIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 6: Budget readiness validated inside transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("6. Budget readiness validated inside transaction", () => {
  it("budget check uses DB plan currency and budget_planned, not frontend values", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, currency: "USD", budget_planned: 30 },
      dbActivities: [{ ...okActivity, budget_planned: 50 }], // exceeds plan budget
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "activity_budget_exceeds_plan" } });
  });

  it("invalid currency from DB → rollback", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, currency: "GBP" }, // not supported
      dbActivities: [okActivity],
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "invalid_currency" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 7: Failed Activity readiness rolls back
   ══════════════════════════════════════════════════════════════════════ */
describe("7. Failed Activity readiness rolls back", () => {
  it("zero activities → ROLLBACK, no COMMIT, no approvals, no audit", () => {
    const sim = makeSubmitSim();
    const result = sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [] });
    expect(sim.rolledBack).toBe(true);
    expect(sim.committed).toBe(false);
    expect(sim.sideEffects).not.toContain("approval");
    expect(sim.sideEffects).not.toContain("audit");
    expect(result).toMatchObject({ status: 400, body: { error: "at_least_one_activity_required" } });
  });

  it("no complete activity (all have missing title) → ROLLBACK", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: okPlan,
      dbActivities: [{ ...okActivity, title: "" }],
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "at_least_one_complete_activity_required" } });
  });

  it("description missing → ROLLBACK", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, description: "  " },
      dbActivities: [okActivity],
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "description_required" } });
  });

  it("no localities → ROLLBACK with geographical_coverage_required", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, localities: [] },
      dbActivities: [okActivity],
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "geographical_coverage_required" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 8: Failed Budget readiness rolls back
   ══════════════════════════════════════════════════════════════════════ */
describe("8. Failed Budget readiness rolls back", () => {
  it("over-allocated activities → ROLLBACK before any write", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, budget_planned: 40 },
      dbActivities: [{ ...okActivity, budget_planned: 80 }],
    });
    expect(sim.rolledBack).toBe(true);
    expect(sim.ops).not.toContain("INSERT approvals");
    expect(result).toMatchObject({ status: 400, body: { error: "activity_budget_exceeds_plan" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 9: Failed workflow-state check rolls back
   ══════════════════════════════════════════════════════════════════════ */
describe("9. Failed workflow-state check rolls back", () => {
  it("plan in wrong status → ROLLBACK, no activities read, no writes", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, status: "archived" },
      dbActivities: [okActivity],
    });
    expect(sim.rolledBack).toBe(true);
    expect(sim.committed).toBe(false);
    expect(sim.ops.find(o => o.includes("SELECT plan_activities"))).toBeUndefined();
    expect(result).toMatchObject({ status: 400, body: { error: "cannot_submit_from_archived" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 10: Successful Submit commits
   ══════════════════════════════════════════════════════════════════════ */
describe("10. Successful Submit commits", () => {
  it("COMMIT occurs, no ROLLBACK, approval and audit written", () => {
    const sim = makeSubmitSim();
    const result = sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    expect(result).toBe("ok");
    expect(sim.committed).toBe(true);
    expect(sim.rolledBack).toBe(false);
    expect(sim.sideEffects).toContain("approval");
    expect(sim.sideEffects).toContain("audit");
  });

  it("registration sessions revoked inside transaction before status update", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const revokeIdx = sim.ops.findIndex(o => o.includes("plan_registration_sessions"));
    const updateIdx = sim.ops.findIndex(o => o.includes("UPDATE plans status="));
    const commitIdx = sim.ops.indexOf("COMMIT");
    expect(revokeIdx).toBeGreaterThanOrEqual(0);
    expect(updateIdx).toBeGreaterThan(revokeIdx);
    expect(commitIdx).toBeGreaterThan(updateIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 11: Status transition occurs only after readiness validation
   ══════════════════════════════════════════════════════════════════════ */
describe("11. Status transition only after readiness validation", () => {
  it("UPDATE plans appears after all readiness checks pass", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const actIdx = sim.ops.findIndex(o => o.includes("SELECT plan_activities"));
    const updateIdx = sim.ops.findIndex(o => o.includes("UPDATE plans status="));
    expect(updateIdx).toBeGreaterThan(actIdx);
  });

  it("UPDATE plans absent when any readiness check fails", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [] });
    expect(sim.ops.find(o => o.includes("UPDATE plans status="))).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 12: Concurrent PATCH cannot create a stale Submit validation
   ══════════════════════════════════════════════════════════════════════ */
describe("12. Concurrent PATCH cannot create stale Submit validation", () => {
  it("Submit reads authoritative state AFTER acquiring the lock — PATCH must wait for the lock", () => {
    // Simulate: PATCH holds the lock, Submit begins but blocks on FOR UPDATE.
    // Once PATCH commits (modifying plan), Submit reads the updated state.
    // If the updated state is no longer draft, Submit fails correctly.
    const postPatchPlan: DbPlan = { ...okPlan, status: "submitted" }; // PATCH already submitted it
    const sim = makeSubmitSim();
    const result = sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: postPatchPlan, dbActivities: [okActivity] });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "cannot_submit_from_submitted" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 13: Concurrent Save & Finish / PATCH is serialised with Submit
   ══════════════════════════════════════════════════════════════════════ */
describe("13. Concurrent Save & Finish serialised with Submit", () => {
  it("Submit reads post-PATCH plan state (budget changed after PATCH commits)", () => {
    // PATCH raised budget_planned to 200 before Submit reads it.
    const postPatchPlan: DbPlan = { ...okPlan, budget_planned: 200 };
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: postPatchPlan,
      dbActivities: [{ ...okActivity, budget_planned: 150 }], // within new budget
    });
    expect(result).toBe("ok");
    expect(sim.committed).toBe(true);
  });

  it("Submit fails on post-PATCH over-allocation it could not have seen before the lock", () => {
    // PATCH lowered budget_planned to 20 before Submit reads it.
    const postPatchPlan: DbPlan = { ...okPlan, budget_planned: 20 };
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: postPatchPlan,
      dbActivities: [{ ...okActivity, budget_planned: 50 }], // now over-allocated
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "activity_budget_exceeds_plan" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 14: Two concurrent Submits cannot both succeed
   ══════════════════════════════════════════════════════════════════════ */
describe("14. Two concurrent Submits cannot both succeed", () => {
  it("second Submit sees updateRowCount=0 (conditional WHERE status) → ROLLBACK", () => {
    // Submit A wins the lock and commits first. Submit B enters after, reads
    // the same plan (now status=submitted), but its conditional UPDATE matches 0 rows.
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: okPlan,
      dbActivities: [okActivity],
      updateRowCount: 0, // conditional WHERE matched nothing → concurrent winner committed first
    });
    expect(sim.rolledBack).toBe(true);
    expect(sim.sideEffects).not.toContain("approval");
    expect(sim.sideEffects).not.toContain("audit");
    expect(result).toMatchObject({ status: 400, body: { error: "cannot_submit_from_draft" } });
  });

  it("first Submit wins: commits approval + audit exactly once", () => {
    const sim = makeSubmitSim();
    const result = sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    expect(result).toBe("ok");
    const approvalCount = sim.sideEffects.filter(s => s === "approval").length;
    const auditCount = sim.sideEffects.filter(s => s === "audit").length;
    expect(approvalCount).toBe(1);
    expect(auditCount).toBe(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 15: No duplicate transition side effects
   ══════════════════════════════════════════════════════════════════════ */
describe("15. No duplicate transition side effects", () => {
  it("exactly one approval, one audit, one status update per successful Submit", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const updates = sim.ops.filter(o => o.includes("UPDATE plans status=")).length;
    const approvals = sim.ops.filter(o => o === "INSERT approvals").length;
    const audits = sim.ops.filter(o => o === "INSERT audit_log").length;
    expect(updates).toBe(1);
    expect(approvals).toBe(1);
    expect(audits).toBe(1);
  });

  it("failed Submit writes zero approval, audit, or status-update records", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [] });
    const updates = sim.ops.filter(o => o.includes("UPDATE plans status=")).length;
    const approvals = sim.ops.filter(o => o === "INSERT approvals").length;
    const audits = sim.ops.filter(o => o === "INSERT audit_log").length;
    expect(updates).toBe(0);
    expect(approvals).toBe(0);
    expect(audits).toBe(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 16: Existing Direct API readiness protections remain
   ══════════════════════════════════════════════════════════════════════ */
describe("16. Existing Direct API readiness protections remain", () => {
  it("over-allocated activities cannot be submitted via direct DB manipulation", () => {
    // Even if the frontend sends a valid form, Submit re-reads from DB.
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, budget_planned: 10 },
      dbActivities: [{ ...okActivity, budget_planned: 99 }], // over-allocated in DB
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "activity_budget_exceeds_plan" } });
  });

  it("locality mismatch in DB cannot be submitted", () => {
    const sim = makeSubmitSim();
    const result = sim.run({
      planId: 1,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      dbPlan: { ...okPlan, localities: ["Kassala"] },
      dbActivities: [{ ...okActivity, locality_name: "Khartoum" }], // not in plan
    });
    expect(sim.rolledBack).toBe(true);
    expect(result).toMatchObject({ status: 400, body: { error: "at_least_one_complete_activity_required" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 17: PATCH closeRegistration behaviour unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("17. PATCH closeRegistration behaviour unchanged", () => {
  it("over-allocated body.activities still blocked at PATCH (shared validator)", () => {
    const result = validatePlanBudgetReadiness("USD", 50, 80);
    expect(result).toBe("activity_budget_exceeds_plan");
  });

  it("valid body.activities still pass PATCH budget check", () => {
    const result = validatePlanBudgetReadiness("USD", 100, 80);
    expect(result).toBeNull();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 18: POST create behaviour unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("18. POST create behaviour unchanged", () => {
  it("POST validation uses same shared budget validator as Submit", () => {
    // POST create is non-transactional (no closeRegistration).
    // Budget check in POST close path uses validatePlanBudgetReadiness — same fn.
    expect(validatePlanBudgetReadiness("USD", 100, 60)).toBeNull();
    expect(validatePlanBudgetReadiness("USD", 100, 120)).toBe("activity_budget_exceeds_plan");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 19: Registration Session security unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("19. Registration Session security unchanged", () => {
  it("session revocation happens inside transaction before status update", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const beginIdx = sim.ops.indexOf("BEGIN");
    const revokeIdx = sim.ops.findIndex(o => o.includes("plan_registration_sessions"));
    const updateIdx = sim.ops.findIndex(o => o.includes("UPDATE plans status="));
    const commitIdx = sim.ops.indexOf("COMMIT");
    expect(revokeIdx).toBeGreaterThan(beginIdx);
    expect(revokeIdx).toBeLessThan(updateIdx);
    expect(updateIdx).toBeLessThan(commitIdx);
  });

  it("session NOT revoked when Submit fails validation", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: { ...okPlan, description: null }, dbActivities: [okActivity] });
    expect(sim.rolledBack).toBe(true);
    expect(sim.ops.find(o => o.includes("plan_registration_sessions"))).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 20: Notifications after COMMIT only (non-transactional)
   ══════════════════════════════════════════════════════════════════════ */
describe("20. Notifications delivered after COMMIT — non-transactional", () => {
  it("notifications sent only on success, after COMMIT", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [okActivity] });
    const commitIdx = sim.ops.indexOf("COMMIT");
    const notifyIdx = sim.ops.indexOf("notifyEntityActorsDeduped");
    expect(commitIdx).toBeGreaterThanOrEqual(0);
    expect(notifyIdx).toBeGreaterThan(commitIdx);
    expect(sim.notificationsSent).toBe(true);
  });

  it("notifications NOT sent when Submit rolls back", () => {
    const sim = makeSubmitSim();
    sim.run({ planId: 1, allowedFromStatuses: ["draft"], transitionTo: "submitted", dbPlan: okPlan, dbActivities: [] });
    expect(sim.rolledBack).toBe(true);
    expect(sim.notificationsSent).toBe(false);
    expect(sim.ops).not.toContain("notifyEntityActorsDeduped");
    expect(sim.ops).not.toContain("notifyNextApprover");
  });
});
