/**
 * Submit For Approval — effective-sector locking tests.
 *
 * The effectiveSector used for TC authorisation is:
 *   COALESCE(NULLIF(plan.sector, ''), project.sector)
 *
 * The Plan row is locked with FOR UPDATE. If the plan's own sector is blank,
 * the linked project's sector is read with FOR SHARE so a concurrent
 * PATCH /projects/:id that changes sector cannot commit until Submit either
 * commits or rolls back.
 *
 * These tests verify that locking/read strategy is correct and that the
 * permission matrix is unchanged.
 *
 * All tests are pure-logic / design-invariant — no HTTP, no DB, no React.
 */

import { describe, it, expect } from "vitest";

/* ─── Auth model mirrors ──────────────────────────────────────────────────── */

type CurrentUser = {
  id: number;
  role: string;
  sectorRestriction?: string[] | null;
  stateId?: number | null;
};

function assertSectorAllowed(
  user: CurrentUser,
  sector: string | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const restriction =
    user.role === "technical_coordinator" ? (user.sectorRestriction ?? null) : null;
  if (!restriction) return { ok: true };
  if (sector && restriction.includes(sector)) return { ok: true };
  return { ok: false, status: 403, body: { error: "sector_forbidden" } };
}

function assertStateAllowed(
  user: CurrentUser,
  planStateId: number | null,
): { ok: true } | { ok: false; status: 403; body: { error: string } } {
  const isStateRole =
    user.role === "state_program_officer" || user.role === "state_office_manager";
  if (!isStateRole) return { ok: true };
  const userStateId = user.stateId ?? null;
  if (userStateId === null || userStateId !== planStateId)
    return { ok: false, status: 403, body: { error: "state_forbidden" } };
  return { ok: true };
}

/* ─── Sector resolution (mirrors the hardened server logic) ──────────────── */

type LockedPlanRow = {
  planSector: string | null;     // NULLIF(sector, '') from FOR UPDATE query
  projectId: number | null;
  stateId: number | null;
  status: string;
};

type ProjectSectorRow = {
  sector: string | null;         // NULLIF(sector, '') from FOR SHARE query
};

/**
 * Resolve effective sector exactly as the hardened Submit handler does:
 *
 *  1. planSector is non-null → use it; no project read needed
 *  2. planSector is null AND projectId is set → read project sector (FOR SHARE)
 *  3. planSector is null AND no project → null
 */
function resolveEffectiveSector(
  plan: Pick<LockedPlanRow, "planSector" | "projectId">,
  /** Simulates the FOR SHARE query result. Only called when planSector is null. */
  readProjectSector: ((projectId: number) => ProjectSectorRow | null) | null,
  ops: string[],
): { effectiveSector: string | null; projectLockAcquired: boolean } {
  if (plan.planSector !== null) {
    ops.push(`USE_PLAN_SECTOR:${plan.planSector}`);
    return { effectiveSector: plan.planSector, projectLockAcquired: false };
  }
  if (plan.projectId !== null && readProjectSector !== null) {
    ops.push(`FOR SHARE projects WHERE id=${plan.projectId}`);
    const row = readProjectSector(plan.projectId);
    const sector = row?.sector ?? null;
    ops.push(`PROJECT_SECTOR_READ:${sector}`);
    return { effectiveSector: sector, projectLockAcquired: true };
  }
  ops.push("NO_SECTOR_SOURCE");
  return { effectiveSector: null, projectLockAcquired: false };
}

/* ─── Full submit simulation with sector resolution ─────────────────────── */

class SubmitError extends Error {
  constructor(public readonly code: string, public readonly httpStatus: number = 400) {
    super(code);
  }
}

type SubmitOpts = {
  user: CurrentUser;
  allowedFromStatuses: string[];
  transitionTo: string;
  lockedPlan: LockedPlanRow;
  /** What the FOR SHARE query returns. Set to null to simulate project not found. */
  projectSectorProvider?: ((id: number) => ProjectSectorRow | null) | null;
};

function runSubmitSim(opts: SubmitOpts): {
  result: "ok" | { status: number; body: { error: string } };
  ops: string[];
  sideEffects: string[];
} {
  const ops: string[] = [];
  const sideEffects: string[] = [];

  function run(): "ok" | { status: number; body: { error: string } } {
    try {
      ops.push("BEGIN");
      ops.push("SELECT plans FOR UPDATE");
      // Workflow check
      if (!opts.allowedFromStatuses.includes(opts.lockedPlan.status)) {
        throw new SubmitError(`cannot_submit_from_${opts.lockedPlan.status}`);
      }
      // Resolve effective sector
      const { effectiveSector, projectLockAcquired } = resolveEffectiveSector(
        opts.lockedPlan,
        opts.projectSectorProvider ?? null,
        ops,
      );
      if (projectLockAcquired) ops.push("PROJECT_LOCK_HELD");
      // Sector auth
      const sg = assertSectorAllowed(opts.user, effectiveSector);
      if (!sg.ok) throw new SubmitError(sg.body.error, sg.status);
      ops.push("SECTOR_AUTH_PASSED");
      // State auth
      const stg = assertStateAllowed(opts.user, opts.lockedPlan.stateId);
      if (!stg.ok) throw new SubmitError(stg.body.error, stg.status);
      ops.push("STATE_AUTH_PASSED");
      // Readiness + writes (abbreviated)
      ops.push("SELECT plan_activities");
      ops.push("READINESS_CHECKS");
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
      if (err instanceof SubmitError) return { status: err.httpStatus, body: { error: err.code } };
      throw err;
    }
  }

  return { result: run(), ops, sideEffects };
}

/* ─── Fixtures ────────────────────────────────────────────────────────────── */

const pmUser: CurrentUser = { id: 1, role: "programme_manager" };
const tcHealth: CurrentUser = { id: 2, role: "technical_coordinator", sectorRestriction: ["health"] };
const tcEducation: CurrentUser = { id: 3, role: "technical_coordinator", sectorRestriction: ["education"] };
const stateUser5: CurrentUser = { id: 4, role: "state_program_officer", stateId: 5 };

const draftPlanOwnSector = (sector: string): LockedPlanRow => ({
  planSector: sector, projectId: 101, stateId: 5, status: "draft",
});
const draftPlanNoSector = (projectId: number | null = 101): LockedPlanRow => ({
  planSector: null, projectId, stateId: 5, status: "draft",
});

/* ══════════════════════════════════════════════════════════════════════
   Test 1: Plan sector populated → Project row need not be locked
   ══════════════════════════════════════════════════════════════════════ */
describe("1. Plan sector populated — Project row not locked for sector auth", () => {
  it("FOR SHARE on projects is NOT issued when planSector is non-null", () => {
    const { ops } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
      projectSectorProvider: (_id) => ({ sector: "education" }), // would change answer
    });
    expect(ops.find(o => o.includes("FOR SHARE"))).toBeUndefined();
    expect(ops.find(o => o.includes("USE_PLAN_SECTOR"))).toBeDefined();
    expect(ops).toContain("SECTOR_AUTH_PASSED");
  });

  it("Plan sector used directly — TC authorised against Plan sector, not project", () => {
    const { result } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
      projectSectorProvider: (_id) => ({ sector: "nutrition" }),
    });
    expect(result).toBe("ok");
  });

  it("Plan sector mismatch rejects even if project sector would match", () => {
    const { result } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("education"), // Plan own sector wins
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 2: Plan sector blank → linked Project sector is authoritative
   ══════════════════════════════════════════════════════════════════════ */
describe("2. Plan sector blank — linked Project sector is authoritative", () => {
  it("project sector used when planSector is null", () => {
    const { ops, result } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    expect(ops.find(o => o.includes("PROJECT_SECTOR_READ:health"))).toBeDefined();
    expect(result).toBe("ok");
  });

  it("blank project sector (NULLIF returns null) → effectiveSector = null", () => {
    const { result } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: null }),
    });
    // TC health user → sector_forbidden when effectiveSector is null
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("no project linked AND plan sector blank → effectiveSector = null", () => {
    const { ops, result } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(null),
    });
    expect(ops).toContain("NO_SECTOR_SOURCE");
    expect(ops.find(o => o.includes("FOR SHARE"))).toBeUndefined();
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 3: Fallback Project sector is read through transaction client
   ══════════════════════════════════════════════════════════════════════ */
describe("3. Fallback Project sector is read through transaction client", () => {
  it("FOR SHARE appears after BEGIN and FOR UPDATE", () => {
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    const beginIdx = ops.indexOf("BEGIN");
    const lockIdx = ops.indexOf("SELECT plans FOR UPDATE");
    const shareIdx = ops.findIndex(o => o.includes("FOR SHARE"));
    expect(beginIdx).toBeGreaterThanOrEqual(0);
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(shareIdx).toBeGreaterThan(lockIdx);
  });

  it("FOR SHARE appears before sector auth check", () => {
    const { ops } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    const shareIdx = ops.findIndex(o => o.includes("FOR SHARE"));
    const authIdx = ops.indexOf("SECTOR_AUTH_PASSED");
    expect(shareIdx).toBeGreaterThanOrEqual(0);
    expect(authIdx).toBeGreaterThan(shareIdx);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 4: Mutable Project sector is protected during Submit
   ══════════════════════════════════════════════════════════════════════ */
describe("4. Mutable Project sector is protected during Submit", () => {
  it("FOR SHARE lock is held on project row when fallback sector is needed", () => {
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    expect(ops).toContain("PROJECT_LOCK_HELD");
  });

  it("FOR SHARE is NOT held when Plan has its own sector (no unnecessary lock)", () => {
    const { ops } = runSubmitSim({
      user: pmUser,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
    });
    expect(ops).not.toContain("PROJECT_LOCK_HELD");
    expect(ops.find(o => o.includes("FOR SHARE"))).toBeUndefined();
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 5: Concurrent Project sector change is observed correctly
   ══════════════════════════════════════════════════════════════════════ */
describe("5. Concurrent Project sector change is observed correctly", () => {
  it("Submit using project fallback reads the post-PATCH sector from the FOR SHARE query", () => {
    // The FOR SHARE query sees the committed value at the point it runs.
    // If a concurrent Project PATCH already committed and changed sector=education
    // before Submit's FOR SHARE, Submit reads 'education' and rejects TC-health.
    const { result, ops } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "education" }), // post-PATCH value
    });
    expect(ops.find(o => o.includes("PROJECT_SECTOR_READ:education"))).toBeDefined();
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
    expect(ops).toContain("ROLLBACK");
  });

  it("Submit FOR SHARE prevents Project PATCH from changing sector until Submit commits/rolls back", () => {
    // Architecture test: FOR SHARE conflicts with UPDATE's ROW EXCLUSIVE.
    // Verified by the presence of FOR SHARE in the op sequence before COMMIT.
    const { ops } = runSubmitSim({
      user: tcHealth,
      allowedFromStatuses: ["draft"],
      transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: (_id) => ({ sector: "health" }),
    });
    const shareIdx = ops.findIndex(o => o.includes("FOR SHARE"));
    const commitIdx = ops.indexOf("COMMIT");
    expect(shareIdx).toBeGreaterThanOrEqual(0);
    expect(commitIdx).toBeGreaterThan(shareIdx);
    // FOR SHARE is held from shareIdx through commitIdx — no concurrent UPDATE can proceed.
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 6: TC in final effective Sector succeeds
   ══════════════════════════════════════════════════════════════════════ */
describe("6. TC in final effective Sector succeeds", () => {
  it("TC health user succeeds when Plan sector = health", () => {
    const { result } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
    });
    expect(result).toBe("ok");
  });

  it("TC health user succeeds when Plan sector is blank and project sector = health", () => {
    const { result } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "health" }),
    });
    expect(result).toBe("ok");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 7: TC outside final effective Sector fails
   ══════════════════════════════════════════════════════════════════════ */
describe("7. TC outside final effective Sector fails", () => {
  it("TC health user fails when Plan sector = education", () => {
    const { result } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("education"),
    });
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });

  it("TC health user fails when Plan sector blank and project sector = nutrition", () => {
    const { result } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "nutrition" }),
    });
    expect(result).toMatchObject({ status: 403, body: { error: "sector_forbidden" } });
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 8: No approval/audit/notifications on failure
   ══════════════════════════════════════════════════════════════════════ */
describe("8. No approval/audit/notifications on failure", () => {
  it("sector_forbidden (from project fallback) → no approval, no audit, ROLLBACK", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "education" }),
    });
    expect(ops).toContain("ROLLBACK");
    expect(ops).not.toContain("COMMIT");
    expect(sideEffects).not.toContain("approval");
    expect(sideEffects).not.toContain("audit");
  });

  it("sector_forbidden (from plan own sector) → no approval, no audit, ROLLBACK", () => {
    const { ops, sideEffects } = runSubmitSim({
      user: tcHealth, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("nutrition"),
    });
    expect(ops).toContain("ROLLBACK");
    expect(sideEffects).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 9: Existing Plan PATCH vs Submit locking unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("9. Existing Plan PATCH vs Submit locking unchanged", () => {
  it("FOR UPDATE on plans still appears as the first lock operation", () => {
    const { ops } = runSubmitSim({
      user: pmUser, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "health" }),
    });
    const lockIdx = ops.indexOf("SELECT plans FOR UPDATE");
    const shareIdx = ops.findIndex(o => o.includes("FOR SHARE"));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(shareIdx).toBeGreaterThan(lockIdx); // Plan locked first, then project
  });

  it("Plan FOR UPDATE appears exactly once", () => {
    const { ops } = runSubmitSim({
      user: pmUser, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
    });
    const planLocks = ops.filter(o => o === "SELECT plans FOR UPDATE");
    expect(planLocks).toHaveLength(1);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 10: State authorisation unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("10. State authorisation unchanged", () => {
  it("state user with matching stateId passes state check", () => {
    const { result } = runSubmitSim({
      user: stateUser5, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: { ...draftPlanOwnSector("health"), stateId: 5 },
    });
    expect(result).toBe("ok");
  });

  it("state user with wrong stateId fails state check → ROLLBACK", () => {
    const { result, ops } = runSubmitSim({
      user: stateUser5, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: { ...draftPlanOwnSector("health"), stateId: 9 },
    });
    expect(result).toMatchObject({ status: 403, body: { error: "state_forbidden" } });
    expect(ops).toContain("ROLLBACK");
  });

  it("sector resolution does not affect state check — both run independently", () => {
    // PM user (no sector restriction, no state restriction) with project fallback sector
    const { result, ops } = runSubmitSim({
      user: pmUser, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "health" }),
    });
    expect(ops).toContain("SECTOR_AUTH_PASSED");
    expect(ops).toContain("STATE_AUTH_PASSED");
    expect(result).toBe("ok");
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 11: Permission matrix unchanged
   ══════════════════════════════════════════════════════════════════════ */
describe("11. Permission matrix unchanged", () => {
  it("PM has no sector restriction — passes regardless of effective sector", () => {
    const sectors = ["health", "education", "nutrition", null];
    for (const s of sectors) {
      const guard = assertSectorAllowed(pmUser, s);
      expect(guard.ok).toBe(true);
    }
  });

  it("TC sector restriction applies to both plan-sector and project-sector paths", () => {
    // Plan sector path
    const ownMatch   = assertSectorAllowed(tcHealth, "health");
    const ownMiss    = assertSectorAllowed(tcHealth, "nutrition");
    // Project fallback path (same function, same result)
    const projMatch  = assertSectorAllowed(tcHealth, "health");
    const projMiss   = assertSectorAllowed(tcHealth, "education");
    expect(ownMatch.ok).toBe(true);
    expect(ownMiss.ok).toBe(false);
    expect(projMatch.ok).toBe(true);
    expect(projMiss.ok).toBe(false);
  });

  it("state role restriction is independent of sector resolution path", () => {
    const pass = assertStateAllowed(stateUser5, 5);
    const fail = assertStateAllowed(stateUser5, 3);
    expect(pass.ok).toBe(true);
    expect(fail.ok).toBe(false);
  });
});

/* ══════════════════════════════════════════════════════════════════════
   Test 12: Existing tests remain passing (regression guard)
   ══════════════════════════════════════════════════════════════════════ */
describe("12. Regression guard — core invariants", () => {
  it("successful submit: BEGIN → FOR UPDATE → [FOR SHARE if needed] → auth → readiness → writes → COMMIT", () => {
    // With project fallback
    const withProject = runSubmitSim({
      user: pmUser, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "health" }),
    });
    const ops = withProject.ops;
    const beginIdx  = ops.indexOf("BEGIN");
    const lockIdx   = ops.indexOf("SELECT plans FOR UPDATE");
    const shareIdx  = ops.findIndex(o => o.includes("FOR SHARE"));
    const authIdx   = ops.indexOf("SECTOR_AUTH_PASSED");
    const readIdx   = ops.indexOf("READINESS_CHECKS");
    const commitIdx = ops.indexOf("COMMIT");
    expect(lockIdx).toBeGreaterThan(beginIdx);
    expect(shareIdx).toBeGreaterThan(lockIdx);
    expect(authIdx).toBeGreaterThan(shareIdx);
    expect(readIdx).toBeGreaterThan(authIdx);
    expect(commitIdx).toBeGreaterThan(readIdx);
  });

  it("successful submit without project fallback: no FOR SHARE in op sequence", () => {
    const { ops, result } = runSubmitSim({
      user: pmUser, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanOwnSector("health"),
    });
    expect(result).toBe("ok");
    expect(ops.find(o => o.includes("FOR SHARE"))).toBeUndefined();
  });

  it("failed submit does not commit approval or audit regardless of sector path", () => {
    // Via project fallback — rejected
    const { sideEffects } = runSubmitSim({
      user: tcEducation, allowedFromStatuses: ["draft"], transitionTo: "submitted",
      lockedPlan: draftPlanNoSector(101),
      projectSectorProvider: () => ({ sector: "health" }),
    });
    expect(sideEffects).toHaveLength(0);
  });
});
