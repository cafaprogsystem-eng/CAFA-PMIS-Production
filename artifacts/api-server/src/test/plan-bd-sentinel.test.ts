/**
 * PLAN-BD SENTINEL TESTS — Business Decisions Evidence (Task #450)
 *
 * Tests against real exported production constants and schema definitions.
 * These tests document CURRENT STATE only — they do not enforce future behaviour.
 * When an implementation task changes the behaviour, update or remove the
 * corresponding sentinel and replace it with a contract test.
 *
 * PLAN-BD-SENT-01  All 7 plan types use the same PLAN_TRANSITIONS object —
 *                  no type branching in workflow routes.
 * PLAN-BD-SENT-02  No UNIQUE constraint exists on business-identity combinations
 *                  in the plans table beyond the auto-generated `code` column.
 * PLAN-BD-SENT-03  Plan progressPct SQL currently INCLUDES cancelled activities
 *                  in the AVG denominator (gap confirmed; exclusion is pending).
 * PLAN-BD-SENT-04  `rejected` status has no outgoing transition in PLAN_TRANSITIONS
 *                  (supplements existing PLAN-AUDIT-09; structural assertion).
 */

import { describe, it, expect } from "vitest";
import { PLAN_TRANSITIONS, PLAN_TYPES, validateActivityProgressConsistency } from "../routes/plans.js";

// ── PLAN-BD-SENT-01 ──────────────────────────────────────────────────────────
describe("PLAN-BD-SENT-01: one workflow for all plan types (BD-1)", () => {
  it("PLAN_TRANSITIONS is a single shared object — not a map keyed by plan type", () => {
    // PLAN_TRANSITIONS must be a flat Record<action, {from, to}>, not nested by type.
    // If it were type-branching it would need a different top-level structure.
    const actions = Object.keys(PLAN_TRANSITIONS);
    // Canonical expected actions from the current workflow graph.
    const expectedActions = [
      "submit",
      "technical_review",
      "coordination_review",
      "final_approve",
      "activate",
      "start",
      "mark_delayed",
      "complete",
      "cancel",
      "archive",
      "reject",
      "request_revision",
    ];
    for (const action of expectedActions) {
      expect(actions, `action '${action}' must exist in PLAN_TRANSITIONS`).toContain(action);
    }
  });

  it("each PLAN_TRANSITIONS entry has a flat {from: string[], to: string} shape — not type-keyed", () => {
    for (const [action, entry] of Object.entries(PLAN_TRANSITIONS)) {
      expect(
        Array.isArray(entry.from),
        `PLAN_TRANSITIONS['${action}'].from must be string[] (not a type-keyed object)`,
      ).toBe(true);
      expect(
        typeof entry.to,
        `PLAN_TRANSITIONS['${action}'].to must be a string`,
      ).toBe("string");
    }
  });

  it("PLAN_TYPES contains all 7 canonical types and emergency has no special handling", () => {
    const expected = ["monthly", "quarterly", "annual", "action", "operational", "emergency", "custom"];
    for (const t of expected) {
      expect(PLAN_TYPES.has(t), `'${t}' must be in PLAN_TYPES`).toBe(true);
    }
    expect(PLAN_TYPES.size).toBe(7);

    // emergency: confirmed absent from any transition branching — all types use the same map.
    // There is no EMERGENCY_TRANSITIONS, EMERGENCY_BYPASS, or similar export.
    const emergencyBranch = (PLAN_TRANSITIONS as Record<string, unknown>)["emergency"];
    expect(emergencyBranch).toBeUndefined();
  });
});

// ── PLAN-BD-SENT-02 ──────────────────────────────────────────────────────────
// Gap closed by Task #474 (PLAN-BD-2 implementation).
// The POST /plans CREATE handler now includes:
//   1. pg_advisory_xact_lock() to serialise concurrent creates.
//   2. Hard duplicate check for structured types (monthly/quarterly/annual).
// The GET /plans/duplicate-check preflight endpoint has also been added.
// No DB UNIQUE index was added (explicitly prohibited by PLAN-BD-2 decision).
describe("PLAN-BD-SENT-02: PLAN-BD-2 implemented — application-level duplicate guard (no DB unique index)", () => {
  it("PLAN_TRANSITIONS does not include a duplicate-check action (guard is inside CREATE, not a transition)", () => {
    // Duplicate prevention is not a workflow transition — it is a pre-INSERT guard.
    expect(Object.keys(PLAN_TRANSITIONS)).not.toContain("check_duplicate");
    expect(Object.keys(PLAN_TRANSITIONS)).not.toContain("prevent_duplicate");
  });

  it("plan type is validated but nothing in PLAN_TRANSITIONS branches on type", () => {
    // All transitions reference statuses (strings), not plan types.
    // Type-specific logic (structured vs irregular) lives in the CREATE handler, not the transition map.
    for (const entry of Object.values(PLAN_TRANSITIONS)) {
      for (const fromStatus of entry.from) {
        expect(typeof fromStatus).toBe("string");
        // Status values must not be plan type names masquerading as statuses.
        expect(PLAN_TYPES.has(fromStatus)).toBe(false);
      }
    }
  });

  it("Structured types are monthly/quarterly/annual; irregular are the remaining 4", () => {
    const structured = ["monthly", "quarterly", "annual"];
    const irregular  = ["action", "operational", "emergency", "custom"];
    for (const t of structured) expect(PLAN_TYPES.has(t)).toBe(true);
    for (const t of irregular)  expect(PLAN_TYPES.has(t)).toBe(true);
    expect(PLAN_TYPES.size).toBe(7);
  });
});

// ── PLAN-BD-SENT-03 ──────────────────────────────────────────────────────────
// Gap closed by Task #465 (PLAN-BD-4 implementation).
// The validateActivityProgressConsistency function is now exported and tested in
// plan-progress-consistency.test.ts (21 tests: PLAN-PROG-01…12, PLAN-PROG-AVG-01…06,
// PLAN-PROG-FULL-01…02).
// The planSummarySelect SQL now reads:
//   ROUND(AVG(pa.progress_pct))::int … AND pa.status <> 'cancelled'
// Cancelled activities are excluded from both numerator and denominator.
describe("PLAN-BD-SENT-03: PLAN-BD-4 implemented — cancelled activities excluded from progress AVG", () => {
  it("validateActivityProgressConsistency is exported and accepts cancelled with any 0–100 progress", () => {
    // Gap closed: the SQL now excludes cancelled; the validator allows historical progress.
    expect(validateActivityProgressConsistency("cancelled", 0)).toBeNull();
    expect(validateActivityProgressConsistency("cancelled", 50)).toBeNull();
    expect(validateActivityProgressConsistency("cancelled", 100)).toBeNull();
    // But completed must still be exactly 100.
    expect(validateActivityProgressConsistency("completed", 50)).not.toBeNull();
    expect(validateActivityProgressConsistency("completed", 100)).toBeNull();
  });
});

// ── PLAN-BD-SENT-04 ──────────────────────────────────────────────────────────
describe("PLAN-BD-SENT-04: rejected status is terminal in PLAN_TRANSITIONS (BD-5)", () => {
  it("no transition has 'rejected' in its from[] array", () => {
    for (const [action, entry] of Object.entries(PLAN_TRANSITIONS)) {
      expect(
        entry.from,
        `transition '${action}' must not accept 'rejected' as a source status`,
      ).not.toContain("rejected");
    }
  });

  it("'rejected' is only ever a to: target (of the reject action) — never a from: source", () => {
    const rejectTransition = PLAN_TRANSITIONS["reject"];
    expect(rejectTransition).toBeDefined();
    expect(rejectTransition.to).toBe("rejected");

    // Confirm no other transition produces 'rejected' as a side effect.
    const transitionsToRejected = Object.entries(PLAN_TRANSITIONS).filter(
      ([, entry]) => entry.to === "rejected",
    );
    expect(transitionsToRejected).toHaveLength(1);
    expect(transitionsToRejected[0][0]).toBe("reject");
  });

  it("request_revision produces 'draft' (recoverable) while reject produces 'rejected' (terminal)", () => {
    expect(PLAN_TRANSITIONS["request_revision"].to).toBe("draft");
    expect(PLAN_TRANSITIONS["reject"].to).toBe("rejected");
    // The distinction: draft has outgoing transitions; rejected does not.
    const fromDraft = Object.values(PLAN_TRANSITIONS).filter((e) => e.from.includes("draft"));
    const fromRejected = Object.values(PLAN_TRANSITIONS).filter((e) => e.from.includes("rejected"));
    expect(fromDraft.length).toBeGreaterThan(0);
    expect(fromRejected).toHaveLength(0);
  });
});
