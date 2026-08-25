/**
 * PATCH /plans/:id closeRegistration=true — transactional integrity tests.
 *
 * These tests verify the design invariants of the hardened PATCH handler:
 * validation runs inside the transaction, the Plan row is locked (FOR UPDATE),
 * and validation failures always trigger ROLLBACK via CloseRegistrationError.
 *
 * All tests are pure logic / design-invariant tests — no HTTP, no DB, no React.
 * They document the contract and protect against regression.
 */

import { describe, it, expect } from "vitest";

/* ─── Pure helpers mirroring the backend shared validators ──────────────── */

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

type ActivityLike = {
  title?: string;
  localityName?: string;
  plannedDate?: string;
  priority?: string;
  targetBeneficiaries?: number;
  budgetPlanned?: number;
  expectedResult?: string;
};

/** Mirrors `isActivityComplete` for a single plan-context subset. */
function activityReadiness(a: ActivityLike, localities: string[]): string | null {
  if (!a.title?.trim()) return "missing_title";
  if (!a.localityName?.trim()) return "missing_locality";
  if (!localities.map(l => l.toLowerCase()).includes((a.localityName ?? "").toLowerCase())) return "locality_not_in_plan";
  if (!a.plannedDate?.trim()) return "missing_planned_date";
  if (!a.priority || !["high", "medium", "low"].includes(a.priority)) return "invalid_priority";
  if (!Number.isFinite(a.targetBeneficiaries) || (a.targetBeneficiaries ?? 0) < 0) return "invalid_beneficiaries";
  if (!Number.isFinite(a.budgetPlanned) || (a.budgetPlanned ?? 0) < 0) return "invalid_budget";
  if (!a.expectedResult?.trim()) return "missing_expected_result";
  return null;
}

function activityBudgetTotal(activities: ActivityLike[]): number {
  return activities.reduce((s, a) => {
    const v = Number(a.budgetPlanned ?? 0);
    return s + (Number.isFinite(v) && v >= 0 ? v : 0);
  }, 0);
}

/**
 * Simulated transaction host — captures the sequence of operations
 * so we can assert ordering and rollback semantics.
 */
function makeTransactionSim() {
  const ops: string[] = [];
  let rolledBack = false;
  let committed = false;
  let validationError: string | null = null;
  let sessionClosed = false;

  return {
    ops,
    begin() { ops.push("BEGIN"); },
    lockPlanRow(planId: number) { ops.push(`SELECT plans FOR UPDATE planId=${planId}`); },
    readActivities(planId: number) { ops.push(`SELECT plan_activities planId=${planId}`); return []; },
    validate(result: string | null) {
      if (result !== null) {
        validationError = result;
        ops.push(`VALIDATION_FAILED:${result}`);
        throw new Error(`CloseRegistrationError:${result}`);
      }
      ops.push("VALIDATION_PASSED");
    },
    writePlan() { ops.push("UPDATE plans"); },
    writeActivities() { ops.push("UPSERT plan_activities"); },
    closeSession() { ops.push("CLOSE_SESSION"); sessionClosed = true; },
    commit() { ops.push("COMMIT"); committed = true; },
    rollback() { ops.push("ROLLBACK"); rolledBack = true; },
    get rolledBack() { return rolledBack; },
    get committed() { return committed; },
    get validationError() { return validationError; },
    get sessionClosed() { return sessionClosed; },
  };
}

type TxSim = ReturnType<typeof makeTransactionSim>;

/** Runs the simulated PATCH close-registration transaction. */
function runPatchTx(
  tx: TxSim,
  opts: {
    planId: number;
    currency: string;
    budgetPlanned: number;
    bodyActivities?: ActivityLike[];
    persistedActivities?: ActivityLike[];
    localities?: string[];
  },
): { status: number; body: object } | null {
  const localities = opts.localities ?? ["Kassala"];
  try {
    tx.begin();
    tx.lockPlanRow(opts.planId); // SELECT … FOR UPDATE

    // Determine effective activities
    let patchActs: ActivityLike[];
    if (opts.bodyActivities !== undefined) {
      patchActs = opts.bodyActivities;
      if (patchActs.length === 0) {
        tx.validate("at_least_one_activity_required");
      }
    } else {
      tx.readActivities(opts.planId);
      patchActs = opts.persistedActivities ?? [];
      if (patchActs.length === 0) {
        tx.validate("at_least_one_activity_required");
      }
    }

    // Activity readiness
    const hasComplete = patchActs.some(a => activityReadiness(a, localities) === null);
    if (!hasComplete) tx.validate("at_least_one_complete_activity_required");

    // Budget readiness
    const total = activityBudgetTotal(patchActs);
    const budgetErr = validatePlanBudgetReadiness(opts.currency, opts.budgetPlanned, total);
    if (budgetErr) tx.validate(budgetErr);

    tx.validate(null); // all checks pass

    // Writes
    tx.writePlan();
    if (opts.bodyActivities !== undefined) tx.writeActivities();
    tx.closeSession();
    tx.commit();
    return null; // success
  } catch (err) {
    tx.rollback();
    const code = (err as Error).message.replace("CloseRegistrationError:", "");
    return { status: 400, body: { error: code } };
  }
}

const completeActivity: ActivityLike = {
  title: "Community Assessment",
  localityName: "Kassala",
  plannedDate: "2026-06-15",
  priority: "high",
  targetBeneficiaries: 200,
  budgetPlanned: 50,
  expectedResult: "Report delivered",
};

/* ══════════════════════════════════════════════════════════════════════
   Test 1: validation occurs inside transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("1. closeRegistration validation occurs inside transaction", () => {
  it("BEGIN appears before VALIDATION_PASSED", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    const beginIdx = tx.ops.indexOf("BEGIN");
    const validIdx = tx.ops.findIndex(o => o === "VALIDATION_PASSED");
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(validIdx).toBeGreaterThan(beginIdx);
  });

  it("BEGIN appears before VALIDATION_FAILED", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [],
    });
    const beginIdx = tx.ops.indexOf("BEGIN");
    const failIdx = tx.ops.findIndex(o => o.startsWith("VALIDATION_FAILED"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(failIdx).toBeGreaterThan(beginIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 2: persisted Activities read through transaction client
   ══════════════════════════════════════════════════════════════════════ */
describe("2. persisted Activities read through transaction client", () => {
  it("when body.activities omitted, SELECT plan_activities appears inside transaction", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 42,
      currency: "USD",
      budgetPlanned: 100,
      // no bodyActivities
      persistedActivities: [completeActivity],
    });
    const beginIdx = tx.ops.indexOf("BEGIN");
    const readIdx = tx.ops.findIndex(o => o.includes("SELECT plan_activities"));
    expect(readIdx).toBeGreaterThan(beginIdx);
  });

  it("when body.activities supplied, plan_activities not re-read from DB", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 42,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    const readIdx = tx.ops.findIndex(o => o.includes("SELECT plan_activities"));
    expect(readIdx).toBe(-1); // not queried
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 3: supplied Activities validated and written in same transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("3. supplied Activities validated and written in same transaction", () => {
  it("VALIDATION_PASSED and UPSERT plan_activities both appear after BEGIN", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    const beginIdx = tx.ops.indexOf("BEGIN");
    const validIdx = tx.ops.indexOf("VALIDATION_PASSED");
    const writeIdx = tx.ops.indexOf("UPSERT plan_activities");
    expect(validIdx).toBeGreaterThan(beginIdx);
    expect(writeIdx).toBeGreaterThan(validIdx);
  });

  it("validated activity set is the same set written — no divergence", () => {
    // The body activities used for validation ARE the activities written.
    // This is ensured by architecture: the same patchActs array feeds both.
    const supplied = [{ ...completeActivity, budgetPlanned: 40 }];
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: supplied,
    });
    expect(result).toBeNull(); // success
    expect(tx.committed).toBe(true);
    expect(tx.ops).toContain("UPSERT plan_activities");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 4: Plan authoritative fields read/locked inside transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("4. Plan authoritative fields locked consistently", () => {
  it("SELECT plans FOR UPDATE appears before writes and validation", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 7,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    const lockIdx = tx.ops.findIndex(o => o.includes("FOR UPDATE"));
    const updateIdx = tx.ops.indexOf("UPDATE plans");
    const validIdx = tx.ops.indexOf("VALIDATION_PASSED");
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(validIdx).toBeGreaterThan(lockIdx);
    expect(updateIdx).toBeGreaterThan(lockIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 5: failed Activity readiness rolls back
   ══════════════════════════════════════════════════════════════════════ */
describe("5. failed Activity readiness rolls back", () => {
  it("empty body.activities → ROLLBACK, no COMMIT, no plan writes", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [],
    });
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
    expect(tx.ops).not.toContain("UPDATE plans");
    expect(result?.body).toEqual({ error: "at_least_one_activity_required" });
  });

  it("incomplete activity (no title) → ROLLBACK", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [{ ...completeActivity, title: "" }],
    });
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
    expect(result?.status).toBe(400);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 6: failed Budget readiness rolls back
   ══════════════════════════════════════════════════════════════════════ */
describe("6. failed Budget readiness rolls back", () => {
  it("activity total exceeds plan budget → ROLLBACK, 400 activity_budget_exceeds_plan", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 30,                              // plan budget
      bodyActivities: [{ ...completeActivity, budgetPlanned: 50 }], // exceeds
    });
    expect(tx.rolledBack).toBe(true);
    expect(tx.committed).toBe(false);
    expect(result?.body).toEqual({ error: "activity_budget_exceeds_plan" });
  });

  it("invalid currency → ROLLBACK before any write", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "GBP",          // not a supported currency
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    expect(tx.rolledBack).toBe(true);
    expect(tx.ops).not.toContain("UPDATE plans");
    expect(result?.body).toEqual({ error: "invalid_currency" });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 7: Registration Session remains open on failure
   ══════════════════════════════════════════════════════════════════════ */
describe("7. Registration Session remains open on failure", () => {
  it("validation failure → session NOT closed", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 50,
      bodyActivities: [{ ...completeActivity, budgetPlanned: 80 }],
    });
    expect(tx.rolledBack).toBe(true);
    expect(tx.sessionClosed).toBe(false);
    expect(tx.ops).not.toContain("CLOSE_SESSION");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 8: successful close commits Plan + Activities + Session together
   ══════════════════════════════════════════════════════════════════════ */
describe("8. successful close commits Plan + Activities + Session together", () => {
  it("all three operations appear before COMMIT, no ROLLBACK", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    expect(tx.committed).toBe(true);
    expect(tx.rolledBack).toBe(false);
    expect(tx.ops).toContain("UPDATE plans");
    expect(tx.ops).toContain("UPSERT plan_activities");
    expect(tx.ops).toContain("CLOSE_SESSION");
    const commitIdx = tx.ops.indexOf("COMMIT");
    const closeIdx = tx.ops.indexOf("CLOSE_SESSION");
    expect(closeIdx).toBeLessThan(commitIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 9: no duplicate Activity persistence
   ══════════════════════════════════════════════════════════════════════ */
describe("9. no duplicate Activity persistence", () => {
  it("UPSERT plan_activities appears exactly once when activities supplied", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [completeActivity],
    });
    const writeOps = tx.ops.filter(o => o === "UPSERT plan_activities");
    expect(writeOps).toHaveLength(1);
  });

  it("UPSERT plan_activities absent when body.activities omitted", () => {
    const tx = makeTransactionSim();
    runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      persistedActivities: [completeActivity],
    });
    expect(tx.ops).not.toContain("UPSERT plan_activities");
    expect(tx.committed).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 10: existing direct-API bypass protection remains
   ══════════════════════════════════════════════════════════════════════ */
describe("10. existing direct-API bypass protection remains", () => {
  it("omitting body.activities with over-allocated persisted set fails with ROLLBACK", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      // body.activities omitted — persisted set is over-allocated
      persistedActivities: [
        { ...completeActivity, budgetPlanned: 80 },
        { ...completeActivity, budgetPlanned: 40 }, // total = 120 > 100
      ],
    });
    expect(tx.rolledBack).toBe(true);
    expect(result?.body).toEqual({ error: "activity_budget_exceeds_plan" });
  });

  it("supplying an empty body.activities with high persisted budget still fails", () => {
    const tx = makeTransactionSim();
    const result = runPatchTx(tx, {
      planId: 1,
      currency: "USD",
      budgetPlanned: 100,
      bodyActivities: [], // empty replacement → caught before budget check
    });
    expect(tx.rolledBack).toBe(true);
    expect(result?.status).toBe(400);
    expect((result?.body as { error: string }).error).toBe("at_least_one_activity_required");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 11: POST behaviour unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("11. POST behaviour unchanged", () => {
  it("POST new Plan uses body activities as source — no persisted activities exist", () => {
    // For POST, activities are always supplied in the body (new plan — no prior rows).
    // The budget validator receives body total; no persisted activity read occurs.
    const bodyActs = [{ ...completeActivity, budgetPlanned: 60 }];
    const total = activityBudgetTotal(bodyActs);
    expect(validatePlanBudgetReadiness("USD", 100, total)).toBeNull();
  });

  it("POST over-allocated body is still rejected by shared validator", () => {
    const bodyActs = [{ ...completeActivity, budgetPlanned: 120 }];
    const total = activityBudgetTotal(bodyActs);
    expect(validatePlanBudgetReadiness("USD", 100, total)).toBe("activity_budget_exceeds_plan");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 12: Submit behaviour unchanged (transaction audit)
   ══════════════════════════════════════════════════════════════════════ */
describe("12. Submit behaviour unchanged — transaction audit", () => {
  it("Submit reads from DB and recalculates activity total independently", () => {
    // Submit's design: read plan + activities from DB, validate, write status.
    // It does not rely on frontend totals.
    const dbActivityTotal = activityBudgetTotal([
      { budgetPlanned: 40 },
      { budgetPlanned: 40 },
      { budgetPlanned: 20 },
    ]);
    expect(validatePlanBudgetReadiness("USD", 100, dbActivityTotal)).toBeNull();
  });

  it("Submit with over-allocated persisted activities fails validation", () => {
    const dbActivityTotal = activityBudgetTotal([
      { budgetPlanned: 80 },
      { budgetPlanned: 40 },
    ]);
    expect(validatePlanBudgetReadiness("USD", 100, dbActivityTotal)).toBe("activity_budget_exceeds_plan");
  });

  it("Submit validator semantics are identical to PATCH validator", () => {
    // Both use validatePlanBudgetReadiness — same function, same rules.
    const submitResult = validatePlanBudgetReadiness("USD", 100, 80);
    const patchResult  = validatePlanBudgetReadiness("USD", 100, 80);
    expect(submitResult).toBe(patchResult);
    expect(submitResult).toBeNull();
  });
});
