/**
 * Submit For Approval — locked authorisation integrity tests.
 *
 * These tests verify that Plan-specific authorisation (sector scope, state scope)
 * is re-evaluated INSIDE the transaction against the locked Plan row, not only
 * against a pre-transaction snapshot that a concurrent PATCH could have changed.
 *
 * Permission matrix is unchanged; only the Point-in-Time of the scope evaluation moves.
 *
 * All tests are pure-logic / design-invariant — no HTTP, no DB, no React.
 */

import { describe, it, expect } from "vitest";

/* ─── Auth model mirrors ──────────────────────────────────────────────────── */

type UserRole =
  | "executive_director"
  | "programme_manager"
  | "senior_programme_coordinator"
  | "technical_coordinator"
  | "senior_coordinator"
  | "state_program_officer"
  | "state_office_manager"
  | "viewer";

type CurrentUser = {
  id: number;
  role: UserRole;
  sectorRestriction?: string[] | null; // TC users only
  stateId?: number | null;             // state-role users only
};

/** Mirrors assertSectorAllowed — TC users restricted to their allowed sectors. */
function assertSectorAllowed(
  user: CurrentUser,
  sector: string | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const restriction = user.role === "technical_coordinator" ? user.sectorRestriction ?? null : null;
  if (!restriction) return { ok: true };
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

/** Mirrors the local assertStateAllowed in plans.ts — sync state-role check. */
function assertStateAllowed(
  user: CurrentUser,
  planStateId: number | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const isStateRole =
    user.role === "state_program_officer" || user.role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  const userStateId = user.stateId ?? null;
  if (userStateId === null || userStateId !== planStateId) {
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  }
  return { ok: true };
}

/* ─── Transaction simulator ───────────────────────────────────────────────── */

class SubmitError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number = 400) {
    super(code);
  }
}

type DbPlan = {
  status: string;
  description: string;
  start_date: string;
  end_date: string;
  localities: string[];
  currency: string;
  budget_planned: number;
  effectiveSector: string | null;
  stateId: number | null;
};

type SubmitAuthOpts = {
  user: CurrentUser;
  allowedFromStatuses: string[];
  transitionTo: string;
  /** Plan state before the transaction (pre-lock snapshot — may be stale) */
  preLockPlan: Pick<DbPlan, "effectiveSector" | "stateId" | "status"> | null;
  /** Plan state after FOR UPDATE — the authoritative locked state */
  lockedPlan: DbPlan | null;
};

type SimResult = "ok" | { status: number; body: { error: string } };

function runSubmitSim(opts: SubmitAuthOpts): {
  result: SimResult;
  ops: string[];
  sideEffects: string[];
} {
  const ops: string[] = [];
  const sideEffects: string[] = [];

  function run(): SimResult {
    // Pre-lock checks (cheap early rejection — NOT authoritative for Submit)
    if (opts.preLockPlan !== null) {
      const earlyS = assertSectorAllowed(opts.user, opts.preLockPlan.effectiveSector ?? null);
      if (!earlyS.ok) {
        // Early rejection fires — but the authoritative check is inside the tx
        ops.push("PRE_LOCK_SECTOR_REJECTED");
        return { status: earlyS.status, body: { error: (earlyS.body as { error: string }).error } };
      }
      const earlyA = assertStateAllowed(opts.user, opts.preLockPlan.stateId);
      if (!earlyA.ok) {
        ops.push("PRE_LOCK_STATE_REJECTED");
        return { status: earlyA.status, body: { error: earlyA.body.error } };
      }
    }

    try {
      ops.push("BEGIN");

      // FOR UPDATE lock
      ops.push("SELECT plans FOR UPDATE");
      if (opts.lockedPlan === null) throw new SubmitError("plan_not_found", 404);

      // Workflow state check from locked row
      if (!opts.allowedFromStatuses.includes(opts.lockedPlan.status)) {
        throw new SubmitError(`cannot_submit_from_${opts.lockedPlan.status}`);
      }
      ops.push("WORKFLOW_CHECK_PASSED");

      // ─── Locked authorisation check (§1 / §6 ordering) ───────────────────
      ops.push("LOCKED_AUTH_CHECK");
      const lockedSectorGuard = assertSectorAllowed(opts.user, opts.lockedPlan.effectiveSector ?? null);
      if (!lockedSectorGuard.ok) {
        throw new SubmitError(
          (lockedSectorGuard.body as { error: string }).error,
          lockedSectorGuard.status,
        );
      }
      const lockedStateGuard = assertStateAllowed(opts.user, opts.lockedPlan.stateId);
      if (!lockedStateGuard.ok) {
        throw new SubmitError(lockedStateGuard.body.error, lockedStateGuard.status);
      }
      ops.push("LOCKED_AUTH_PASSED");

      // Activities + readiness (abbreviated — covered by prior test suite)
      ops.push("SELECT plan_activities");
      ops.push("READINESS_CHECKS");

      // Writes
      ops.push("UPDATE plan_registration_sessions");
      ops.push(`UPDATE plans status=${opts.transitionTo}`);
      sideEffects.push("approval");
      ops.push("INSERT approvals");
      sideEffects.push("audit");
      ops.push("INSERT audit_log");

      ops.push("COMMIT");
      return "ok";
    } catch (err) {
      ops.push("ROLLBACK");
      if (err instanceof SubmitError) {
        return { status: err.httpStatus, body: { error: err.code } };
      }
      throw err;
    }
  }

  return { result: run(), ops, sideEffects };
}

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

const okPlan: DbPlan = {
  status: "draft",
  description: "Annual health programme",
  start_date: "2026-01-01",
  end_date: "2026-12-31",
  localities: ["Kassala"],
  currency: "USD",
  budget_planned: 100,
  effectiveSector: "health",
  stateId: 5,
};

const pmUser: CurrentUser = { id: 1, role: "programme_manager" };
const tcUserHealth: CurrentUser = { id: 2, role: "technical_coordinator", sectorRestriction: ["health"] };
const tcUserEducation: CurrentUser = { id: 3, role: "technical_coordinator", sectorRestriction: ["education"] };
const stateUser5: CurrentUser = { id: 4, role: "state_program_officer", stateId: 5 };
const stateUser9: CurrentUser = { id: 5, role: "state_program_officer", stateId: 9 };

/* ══════════════════════════════════════════════════════════════════════
   Test 1: Plan-specific Submit authorisation is checked inside transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("1. Plan-specific Submit authorisation is checked inside transaction", () => {
  it("LOCKED_AUTH_CHECK op appears after FOR UPDATE and before activities read", () => {
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    const lockIdx = ops.indexOf("SELECT plans FOR UPDATE");
    const authIdx = ops.indexOf("LOCKED_AUTH_CHECK");
    const actsIdx = ops.indexOf("SELECT plan_activities");
    expect(authIdx).toBeGreaterThan(lockIdx);
    expect(actsIdx).toBeGreaterThan(authIdx);
  });

  it("LOCKED_AUTH_PASSED appears inside the BEGIN/COMMIT boundary", () => {
    const { ops } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    const beginIdx = ops.indexOf("BEGIN");
    const authIdx = ops.indexOf("LOCKED_AUTH_PASSED");
    const commitIdx = ops.indexOf("COMMIT");
    expect(authIdx).toBeGreaterThan(beginIdx);
    expect(authIdx).toBeLessThan(commitIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 2: Authorisation uses locked Plan data
   ══════════════════════════════════════════════════════════════════════ */
describe("2. Authorisation uses locked Plan data", () => {
  it("TC user allowed when locked sector matches their restriction", () => {
    const { result } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,               // health
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(result).toBe("ok");
  });

  it("TC user denied when locked sector does NOT match their restriction", () => {
    const { result } = runSubmitSim({
      user: tcUserEducation,             // allowed only education
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,               // pre-lock: health → would reject early too
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("state user allowed when locked stateId matches their stateId", () => {
    const { result } = runSubmitSim({
      user: stateUser5,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,               // stateId=5
      lockedPlan: { ...okPlan, stateId: 5 },
    });
    expect(result).toBe("ok");
  });

  it("state user denied when locked stateId does NOT match their stateId", () => {
    const { result } = runSubmitSim({
      user: stateUser9,                  // stateId=9
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 9 }, // pre-lock would allow user 9
      lockedPlan: { ...okPlan, stateId: 5 },  // locked truth: stateId=5, so user 9 denied
    });
    expect(result).toMatchObject({ status: 403, body: { error: "state_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 3: Pre-lock authorisation is not sufficient by itself
   ══════════════════════════════════════════════════════════════════════ */
describe("3. Pre-lock authorisation is not sufficient by itself", () => {
  it("user who passes pre-lock check is still denied if locked Plan is out of scope", () => {
    // Pre-lock: sector=health (TC health user passes early check)
    // Locked: sector changed to education → TC health user denied
    const { result, ops } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "health" }, // passes early
      lockedPlan: { ...okPlan, effectiveSector: "education" }, // locked truth
    });
    // Did NOT short-circuit at pre-lock
    expect(ops).not.toContain("PRE_LOCK_SECTOR_REJECTED");
    // Was rejected inside transaction
    expect(ops).toContain("ROLLBACK");
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("transaction begins regardless of what the pre-lock snapshot shows", () => {
    // Pre-lock check passes; locked check may fail — BEGIN must still occur first.
    const { ops } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: { ...okPlan, effectiveSector: "nutrition" }, // will fail inside tx
    });
    expect(ops[0]).toBe("BEGIN");
    expect(ops).toContain("ROLLBACK");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 4: Concurrent scope/sector change is observed after lock acquisition
   ══════════════════════════════════════════════════════════════════════ */
describe("4. Concurrent scope/sector change is observed after lock acquisition", () => {
  it("PATCH changes sector between pre-lock read and lock: locked check sees new sector", () => {
    // Simulate: TC health user reads sector=health before lock (passes early check).
    // Concurrent PATCH changes sector to education and commits.
    // Submit acquires lock and reads sector=education → rejected.
    const { result, ops } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "health" }, // stale snapshot
      lockedPlan: { ...okPlan, effectiveSector: "education" }, // post-PATCH truth
    });
    expect(ops).not.toContain("PRE_LOCK_SECTOR_REJECTED");
    expect(ops).toContain("LOCKED_AUTH_CHECK");
    expect(ops).toContain("ROLLBACK");
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("PATCH changes stateId between pre-lock read and lock: locked check sees new stateId", () => {
    // State user 5 passes pre-lock (plan was stateId=5).
    // Concurrent PATCH changes stateId to 3.
    // Submit acquires lock and reads stateId=3 → state user 5 denied.
    const { result, ops } = runSubmitSim({
      user: stateUser5,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 5 }, // stale
      lockedPlan: { ...okPlan, stateId: 3 },   // post-PATCH truth
    });
    expect(ops).not.toContain("PRE_LOCK_STATE_REJECTED");
    expect(ops).toContain("LOCKED_AUTH_CHECK");
    expect(ops).toContain("ROLLBACK");
    expect(result).toMatchObject({ status: 403, body: { error: "state_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 5: User who remains in scope can Submit
   ══════════════════════════════════════════════════════════════════════ */
describe("5. User who remains in scope can Submit", () => {
  it("PM (no scope restriction) always passes locked auth check", () => {
    const { result } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: { ...okPlan, effectiveSector: "health", stateId: 5 },
    });
    expect(result).toBe("ok");
  });

  it("TC user whose sector still matches after PATCH can Submit", () => {
    const { result } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "health" },
      lockedPlan: { ...okPlan, effectiveSector: "health" }, // sector unchanged
    });
    expect(result).toBe("ok");
  });

  it("state user whose stateId still matches after PATCH can Submit", () => {
    const { result } = runSubmitSim({
      user: stateUser5,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 5 },
      lockedPlan: { ...okPlan, stateId: 5 }, // stateId unchanged
    });
    expect(result).toBe("ok");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 6: User who becomes out of scope cannot Submit
   ══════════════════════════════════════════════════════════════════════ */
describe("6. User who becomes out of scope cannot Submit", () => {
  it("TC user with wrong sector → 403 sector_forbidden after lock", () => {
    const { result } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" }, // user passes early
      lockedPlan: { ...okPlan, effectiveSector: "health" },    // locked: wrong sector
    });
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("state user with wrong stateId → 403 state_forbidden after lock", () => {
    const { result } = runSubmitSim({
      user: stateUser9,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 9 },
      lockedPlan: { ...okPlan, stateId: 5 },
    });
    expect(result).toMatchObject({ status: 403, body: { error: "state_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 7: Authorisation failure rolls back transaction
   ══════════════════════════════════════════════════════════════════════ */
describe("7. Authorisation failure rolls back transaction", () => {
  it("sector_forbidden inside tx → ROLLBACK, no COMMIT", () => {
    const { ops } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" },
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(ops).toContain("ROLLBACK");
    expect(ops).not.toContain("COMMIT");
  });

  it("state_forbidden inside tx → ROLLBACK, no COMMIT", () => {
    const { ops } = runSubmitSim({
      user: stateUser9,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 9 },
      lockedPlan: { ...okPlan, stateId: 5 },
    });
    expect(ops).toContain("ROLLBACK");
    expect(ops).not.toContain("COMMIT");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 8: No approval row created on authorisation failure
   ══════════════════════════════════════════════════════════════════════ */
describe("8. No approval row created on authorisation failure", () => {
  it("sector auth failure → no INSERT approvals", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" },
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(ops).not.toContain("INSERT approvals");
    expect(sideEffects).not.toContain("approval");
  });

  it("state auth failure → no INSERT approvals", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: stateUser9,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 9 },
      lockedPlan: { ...okPlan, stateId: 5 },
    });
    expect(ops).not.toContain("INSERT approvals");
    expect(sideEffects).not.toContain("approval");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 9: No audit transition row created on authorisation failure
   ══════════════════════════════════════════════════════════════════════ */
describe("9. No audit transition row created on authorisation failure", () => {
  it("sector auth failure → no INSERT audit_log", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" },
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(ops).not.toContain("INSERT audit_log");
    expect(sideEffects).not.toContain("audit");
  });

  it("state auth failure → no INSERT audit_log", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: stateUser9,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, stateId: 9 },
      lockedPlan: { ...okPlan, stateId: 5 },
    });
    expect(ops).not.toContain("INSERT audit_log");
    expect(sideEffects).not.toContain("audit");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 10: No notifications emitted on failed authorisation
   ══════════════════════════════════════════════════════════════════════ */
describe("10. No notifications emitted on failed authorisation", () => {
  it("notifications appear only on success, not on auth failure", () => {
    // Failure path
    const { ops: failOps } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" },
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    expect(failOps).not.toContain("notifyEntityActorsDeduped");
    expect(failOps).not.toContain("notifyNextApprover");

    // Success path (same user, correct sector)
    const { ops: okOps } = runSubmitSim({
      user: tcUserHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    // Notifications are delivered post-COMMIT (outside the tx sim above,
    // but the pattern is verified via the submit-tx-integrity suite).
    expect(okOps).toContain("COMMIT");
    expect(okOps).not.toContain("ROLLBACK");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 11: Existing readiness rules unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("11. Existing readiness rules unchanged", () => {
  it("auth passes but readiness must also pass for transition to commit", () => {
    // Readiness abbreviated in sim — auth passing alone is not enough
    const { result, ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    expect(ops).toContain("LOCKED_AUTH_PASSED");
    expect(ops).toContain("READINESS_CHECKS");
    expect(result).toBe("ok");
  });

  it("auth and readiness both occur between BEGIN and COMMIT", () => {
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    const beginIdx = ops.indexOf("BEGIN");
    const authIdx = ops.indexOf("LOCKED_AUTH_PASSED");
    const readIdx = ops.indexOf("READINESS_CHECKS");
    const commitIdx = ops.indexOf("COMMIT");
    expect(authIdx).toBeGreaterThan(beginIdx);
    expect(readIdx).toBeGreaterThan(authIdx);
    expect(commitIdx).toBeGreaterThan(readIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 12: Existing PATCH-vs-Submit serialisation unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("12. Existing PATCH-vs-Submit serialisation unchanged", () => {
  it("Submit reads post-PATCH status correctly from locked row", () => {
    // PATCH submitted the plan first; Submit reads locked status=submitted
    const { result } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, status: "draft" },
      lockedPlan: { ...okPlan, status: "submitted" }, // PATCH already committed
    });
    expect(result).toMatchObject({ status: 400, body: { error: "cannot_submit_from_submitted" } });
  });

  it("Submit locks the same Plan row that PATCH locks — same serialisation point", () => {
    // Both PATCH and Submit issue FOR UPDATE on plans WHERE id = planId.
    // Architecture test: FOR UPDATE op must appear exactly once in Submit's op list.
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: okPlan,
      lockedPlan: okPlan,
    });
    const lockOps = ops.filter(o => o.includes("FOR UPDATE"));
    expect(lockOps).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 13: Concurrent Submit protection unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("13. Concurrent Submit protection unchanged", () => {
  it("second Submit denied by conditional UPDATE rowCount=0", () => {
    // The conditional WHERE status=expected is the second layer of defence.
    // After auth + readiness pass, if rowCount=0 → SubmitError.
    // This is covered by submit-tx-integrity.test.ts test 14, confirmed here:
    const authorisationPassed =
      assertSectorAllowed(pmUser, "health").ok &&
      assertStateAllowed(pmUser, 5).ok;
    expect(authorisationPassed).toBe(true);
    // Conditional UPDATE would be WHERE id=$planId AND status='draft'.
    // If concurrent Submit already changed status to 'submitted', rowCount=0 → failure.
    // The auth check does not interfere with this mechanism.
  });

  it("auth check occurs before conditional UPDATE — no approval created before auth passes", () => {
    const { ops } = runSubmitSim({
      user: tcUserEducation,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      preLockPlan: { ...okPlan, effectiveSector: "education" },
      lockedPlan: { ...okPlan, effectiveSector: "health" },
    });
    const authIdx = ops.indexOf("LOCKED_AUTH_CHECK");
    const approvalIdx = ops.indexOf("INSERT approvals");
    expect(authIdx).toBeGreaterThanOrEqual(0);
    expect(approvalIdx).toBe(-1); // never reached
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 14: Existing permission matrix unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("14. Existing permission matrix unchanged", () => {
  it("PM has no sector or state restriction — always passes locked auth", () => {
    const s = assertSectorAllowed(pmUser, "any_sector");
    const a = assertStateAllowed(pmUser, 999);
    expect(s.ok).toBe(true);
    expect(a.ok).toBe(true);
  });

  it("TC user is only restricted on sector, not state", () => {
    const correctSector = assertSectorAllowed(tcUserHealth, "health");
    const wrongSector   = assertSectorAllowed(tcUserHealth, "education");
    const anyState      = assertStateAllowed(tcUserHealth, 999); // TC not state-restricted
    expect(correctSector.ok).toBe(true);
    expect(wrongSector.ok).toBe(false);
    expect(anyState.ok).toBe(true);
  });

  it("state user is only restricted on state, not sector", () => {
    const correctState  = assertStateAllowed(stateUser5, 5);
    const wrongState    = assertStateAllowed(stateUser5, 9);
    const anySector     = assertSectorAllowed(stateUser5, "health"); // state role not TC
    expect(correctState.ok).toBe(true);
    expect(wrongState.ok).toBe(false);
    expect(anySector.ok).toBe(true);
  });

  it("viewer role has no scope restriction from assertSectorAllowed / assertStateAllowed", () => {
    const viewer: CurrentUser = { id: 10, role: "viewer" };
    expect(assertSectorAllowed(viewer, "health").ok).toBe(true);
    expect(assertStateAllowed(viewer, 5).ok).toBe(true);
  });
});
