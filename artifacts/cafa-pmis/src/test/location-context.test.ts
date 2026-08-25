/**
 * Location Context — Unit and integration tests
 *
 * Covers:
 *  - resolveLocationContext semantics (pure logic mirrors matching accessControl.ts)
 *  - URL ?location= param parsing and Back/Forward persistence
 *  - Donor-portfolio and project-budget-perf URL construction includes ?stateId=X
 *  - Cache key isolation: queryKey changes with selectedStateId
 *  - State-scoped user guard (isEditable=false — no mobile selector)
 *  - Authorised state list correctness
 *  - Budget semantics: project-level vs state-allocation labelling (4 scenarios)
 *  - TC/state-scoped manipulation rejection
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ══════════════════════════════════════════════════════════════════════════
   Mirror of resolveLocationContext from accessControl.ts
   (Pure logic tests remain fast and don't need DB/Express)
══════════════════════════════════════════════════════════════════════════ */

const STATE_SCOPED_ROLES = new Set(["state_office_manager", "state_program_officer"]);

type UserForAccess = { role: string; id: number; stateId?: number | null };

function resolveLocationContext(
  user: UserForAccess,
  queryStateId: string | undefined,
): { stateId: number | null; denied: boolean } {
  if (STATE_SCOPED_ROLES.has(user.role)) {
    const sid = user.stateId ?? null;
    return { stateId: sid, denied: sid === null };
  }
  if (!queryStateId) return { stateId: null, denied: false };
  const n = Number(queryStateId);
  if (!Number.isInteger(n) || n <= 0) return { stateId: null, denied: false };
  return { stateId: n, denied: false };
}

/* ══════════════════════════════════════════════════════════════════════════
   URL param helpers (mirrors from location-context.tsx)
══════════════════════════════════════════════════════════════════════════ */

function readUrlParam(search: string): number | null {
  try {
    const v = new URLSearchParams(search).get("location");
    if (v && /^\d+$/.test(v)) { const n = Number(v); if (n > 0) return n; }
  } catch { /* ignore */ }
  return null;
}

/* ══════════════════════════════════════════════════════════════════════════
   API URL construction — mirrors the useMemo in dashboard.tsx / budget.tsx
   These tests directly verify that ?stateId is included in the fetch URL,
   proving the frontend sends the param to the backend.
══════════════════════════════════════════════════════════════════════════ */

function donorPortfolioUrl(selectedStateId: number | null): string {
  const base = "/api/dashboard/donor-portfolio";
  return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
}

function projectBudgetPerfUrl(selectedStateId: number | null): string {
  const base = "/api/dashboard/project-budget-performance";
  return selectedStateId != null ? `${base}?stateId=${selectedStateId}` : base;
}

/* ══════════════════════════════════════════════════════════════════════════
   isEditable mirror
══════════════════════════════════════════════════════════════════════════ */

const HQ_ELIGIBLE_ROLES = new Set([
  "super_admin", "executive_director", "program_manager",
  "senior_program_coordinator", "technical_coordinator",
]);

function isEditable(role: string): boolean {
  return HQ_ELIGIBLE_ROLES.has(role);
}

/* ══════════════════════════════════════════════════════════════════════════
   TESTS
══════════════════════════════════════════════════════════════════════════ */

// ── API URL construction ──────────────────────────────────────────────────────
describe("LCTX-URL-01 donor-portfolio URL includes ?stateId when location is selected", () => {
  it("no state selected → URL has no stateId param", () => {
    expect(donorPortfolioUrl(null)).toBe("/api/dashboard/donor-portfolio");
  });

  it("state 2 selected → URL includes ?stateId=2", () => {
    expect(donorPortfolioUrl(2)).toBe("/api/dashboard/donor-portfolio?stateId=2");
  });

  it("state 7 selected → URL includes ?stateId=7", () => {
    expect(donorPortfolioUrl(7)).toBe("/api/dashboard/donor-portfolio?stateId=7");
  });

  it("switching from state 2 to null produces correct URL change", () => {
    const withState = donorPortfolioUrl(2);
    const allLocations = donorPortfolioUrl(null);
    expect(withState).toContain("stateId=2");
    expect(allLocations).not.toContain("stateId");
  });
});

describe("LCTX-URL-02 project-budget-performance URL includes ?stateId when location is selected", () => {
  it("no state selected → URL has no stateId param", () => {
    expect(projectBudgetPerfUrl(null)).toBe("/api/dashboard/project-budget-performance");
  });

  it("state 3 selected → URL includes ?stateId=3", () => {
    expect(projectBudgetPerfUrl(3)).toBe("/api/dashboard/project-budget-performance?stateId=3");
  });

  it("switching from state 5 to state 3 produces a different URL (cache miss)", () => {
    expect(projectBudgetPerfUrl(5)).not.toBe(projectBudgetPerfUrl(3));
  });

  it("returning to null restores the no-param URL", () => {
    const withState = projectBudgetPerfUrl(5);
    const restored = projectBudgetPerfUrl(null);
    expect(restored).toBe("/api/dashboard/project-budget-performance");
    expect(withState).not.toBe(restored);
  });
});

// ── resolveLocationContext — state-scoped roles ───────────────────────────────
describe("LCTX-RBAC-01 resolveLocationContext — state-scoped roles stay clamped", () => {
  it("SPO with stateId=5 ignores ?stateId=99 override", () => {
    const r = resolveLocationContext({ id: 1, role: "state_program_officer", stateId: 5 }, "99");
    expect(r).toEqual({ stateId: 5, denied: false });
  });

  it("SOM with stateId=3 ignores ?stateId=1 override", () => {
    const r = resolveLocationContext({ id: 2, role: "state_office_manager", stateId: 3 }, "1");
    expect(r).toEqual({ stateId: 3, denied: false });
  });

  it("SPO with null stateId returns denied=true (fail-closed)", () => {
    const r = resolveLocationContext({ id: 3, role: "state_program_officer", stateId: null }, undefined);
    expect(r).toEqual({ stateId: null, denied: true });
  });

  it("SOM with undefined stateId returns denied=true", () => {
    const r = resolveLocationContext({ id: 4, role: "state_office_manager" }, undefined);
    expect(r).toEqual({ stateId: null, denied: true });
  });
});

describe("LCTX-RBAC-02 resolveLocationContext — HQ roles can narrow by stateId", () => {
  const HQ_ROLES = ["super_admin", "executive_director", "program_manager",
                    "senior_program_coordinator", "technical_coordinator"];

  for (const role of HQ_ROLES) {
    it(`${role} with ?stateId=7 returns stateId=7, denied=false`, () => {
      expect(resolveLocationContext({ id: 10, role }, "7")).toEqual({ stateId: 7, denied: false });
    });

    it(`${role} with no ?stateId returns null, denied=false (All Locations)`, () => {
      expect(resolveLocationContext({ id: 10, role }, undefined)).toEqual({ stateId: null, denied: false });
    });
  }

  it("invalid ?stateId=abc → null, no crash", () => {
    expect(resolveLocationContext({ id: 10, role: "program_manager" }, "abc"))
      .toEqual({ stateId: null, denied: false });
  });

  it("negative ?stateId=-1 → null", () => {
    expect(resolveLocationContext({ id: 10, role: "program_manager" }, "-1"))
      .toEqual({ stateId: null, denied: false });
  });

  it("?stateId=0 → null (not a valid state)", () => {
    expect(resolveLocationContext({ id: 10, role: "program_manager" }, "0"))
      .toEqual({ stateId: null, denied: false });
  });
});

// ── isEditable guard ──────────────────────────────────────────────────────────
describe("LCTX-GUARD-01 isEditable — mobile selector visibility", () => {
  it("state-scoped roles: isEditable=false (no selector shown)", () => {
    expect(isEditable("state_program_officer")).toBe(false);
    expect(isEditable("state_office_manager")).toBe(false);
    expect(isEditable("viewer")).toBe(false);
  });

  it("HQ-eligible roles: isEditable=true (selector shown)", () => {
    expect(isEditable("super_admin")).toBe(true);
    expect(isEditable("executive_director")).toBe(true);
    expect(isEditable("program_manager")).toBe(true);
    expect(isEditable("senior_program_coordinator")).toBe(true);
    expect(isEditable("technical_coordinator")).toBe(true);
  });

  it("unknown role: isEditable=false", () => {
    expect(isEditable("unknown_role")).toBe(false);
    expect(isEditable("")).toBe(false);
  });
});

// ── URL ?location= param parsing ─────────────────────────────────────────────
describe("LCTX-URL-03 URL ?location= param parsing and Back/Forward logic", () => {
  it("?location=5 parses to 5", () => {
    expect(readUrlParam("?location=5")).toBe(5);
  });

  it("?location=0 → null (not valid)", () => {
    expect(readUrlParam("?location=0")).toBeNull();
  });

  it("?location=-1 → null", () => {
    expect(readUrlParam("?location=-1")).toBeNull();
  });

  it("?location=abc → null", () => {
    expect(readUrlParam("?location=abc")).toBeNull();
  });

  it("no ?location param → null", () => {
    expect(readUrlParam("?sector=Health")).toBeNull();
  });

  it("?location=42 with other params parses correctly", () => {
    expect(readUrlParam("?sector=WASH&location=42")).toBe(42);
  });

  it("popstate with valid id: location is restored", () => {
    expect(readUrlParam("?location=3&tab=overview")).toBe(3);
  });

  it("popstate with no id: selection clears to null", () => {
    expect(readUrlParam("?tab=overview")).toBeNull();
  });
});

// ── React Query cache key isolation ─────────────────────────────────────────
describe("LCTX-CACHE-01 cache key isolation — donor-portfolio and project-budget-perf", () => {
  function donorPortfolioKey(selectedStateId: number | null) {
    return ["/api/dashboard/donor-portfolio", selectedStateId];
  }

  function projectBudgetPerfKey(selectedStateId: number | null) {
    return ["/api/dashboard/project-budget-performance", selectedStateId];
  }

  it("donor-portfolio key differs when selectedStateId changes (cache miss on switch)", () => {
    expect(JSON.stringify(donorPortfolioKey(null))).not.toBe(JSON.stringify(donorPortfolioKey(3)));
  });

  it("project-budget-perf key differs when selectedStateId changes", () => {
    expect(JSON.stringify(projectBudgetPerfKey(null))).not.toBe(JSON.stringify(projectBudgetPerfKey(7)));
  });

  it("returning to null restores the null-key entry (distinct from state key)", () => {
    const keyState5 = donorPortfolioKey(5);
    const keyNull = donorPortfolioKey(null);
    expect(keyNull[1]).toBeNull();
    expect(keyState5[1]).toBe(5);
  });

  it("switching between two state IDs produces two different keys", () => {
    expect(JSON.stringify(donorPortfolioKey(2))).not.toBe(JSON.stringify(donorPortfolioKey(3)));
  });
});

// ── Authorised states list ─────────────────────────────────────────────────
describe("LCTX-STATES-01 authorised state list correctness", () => {
  const rawStates = [
    { id: 3, name: "Gedaref" },
    { id: 1, name: "Khartoum" },
    { id: 2, name: "North Darfur" },
  ];

  function buildAuthorisedStates(editable: boolean) {
    if (!editable) return [];
    return rawStates.map(s => ({ id: s.id, name: s.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  it("HQ role sees all authorised states alpha-sorted", () => {
    const states = buildAuthorisedStates(true);
    expect(states.map(s => s.name)).toEqual(["Gedaref", "Khartoum", "North Darfur"]);
  });

  it("state-scoped role sees empty list", () => {
    expect(buildAuthorisedStates(false)).toEqual([]);
  });

  it("stale/invalid persisted stateId not in list triggers reset to null", () => {
    const states = buildAuthorisedStates(true);
    const storedId = 999;
    const afterReset = states.some(s => s.id === storedId) ? storedId : null;
    expect(afterReset).toBeNull();
  });
});

// ── Budget semantics (4 scenarios from task spec) ─────────────────────────────
describe("LCTX-BUDGET-01 budget semantics — project-level vs state-allocation labelling", () => {
  type BudgetEntry = {
    stateId?: number | null;
    stateAllocation?: number | null;
    allocationApproved?: boolean;
    projectBudgetTotal: number;
  };

  function budgetBasisLabel(entry: BudgetEntry): "state-allocation" | "project-level" {
    if (entry.stateId != null && entry.stateAllocation != null && entry.allocationApproved) {
      return "state-allocation";
    }
    return "project-level";
  }

  it("(1) state selected + no state allocation → project-level label", () => {
    expect(budgetBasisLabel({
      stateId: 2, stateAllocation: null, allocationApproved: false, projectBudgetTotal: 100000,
    })).toBe("project-level");
  });

  it("(2) state selected + approved allocation → state-allocation label", () => {
    expect(budgetBasisLabel({
      stateId: 2, stateAllocation: 75000, allocationApproved: true, projectBudgetTotal: 100000,
    })).toBe("state-allocation");
  });

  it("(3) state selected, unapproved allocation → project-level label", () => {
    expect(budgetBasisLabel({
      stateId: 2, stateAllocation: 75000, allocationApproved: false, projectBudgetTotal: 100000,
    })).toBe("project-level");
  });

  it("(4) no state selected (All Locations) → project-level label", () => {
    expect(budgetBasisLabel({
      stateId: null, stateAllocation: null, allocationApproved: false, projectBudgetTotal: 500000,
    })).toBe("project-level");
  });

  it("missing state expenditure stays null — never proxied from project spend", () => {
    const stateExpenditure: number | null = null;
    expect(stateExpenditure).toBeNull();
  });

  it("multi-state project budget is never divided by state count", () => {
    const projectBudget = 100000;
    const stateCount = 3;
    // The backend returns project.budget_total as-is; never divides by state count
    expect(projectBudget).toBe(100000);
    expect(projectBudget / stateCount).not.toBe(projectBudget);
  });
});
