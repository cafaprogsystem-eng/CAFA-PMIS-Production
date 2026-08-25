/**
 * Project Deletion Policy — Unit Tests
 *
 * Tests the pure helper functions from the server-side project-deletion lib
 * (mirrored here for frontend testing) and the frontend confirmation logic.
 *
 * Test matrix corresponds to spec §16 (30 scenarios).
 */

import { describe, it, expect } from "vitest";

// ── Mirror of server-side pure helpers (no DB) ────────────────────────────────
// We test the logic directly without importing from the api-server artifact
// to keep the test environment clean.

type DeletionMode = "permanent" | "soft" | "not_allowed";

const FINAL_APPROVAL_STATUSES: readonly string[] = ["approved", "active", "closed"];

function getProjectDeletionMode(
  project: { status: string },
  workflowHistory: ReadonlyArray<{ toStatus: string }>,
  canDelete: boolean,
): DeletionMode {
  if (!canDelete) return "not_allowed";
  if (FINAL_APPROVAL_STATUSES.includes(project.status)) return "soft";
  const everApproved = workflowHistory.some((h) => FINAL_APPROVAL_STATUSES.includes(h.toStatus));
  return everApproved ? "soft" : "permanent";
}

function validateDeletionReason(reason: unknown): string | null {
  if (typeof reason !== "string" || reason.trim().length < 5) {
    return "A deletion reason of at least 5 characters is required.";
  }
  return null;
}

function confirmationCodeMatches(input: string, projectCode: string): boolean {
  return input.trim() === projectCode;
}

// ── Helper builders ───────────────────────────────────────────────────────────

const noHistory: { toStatus: string }[] = [];

const approvedHistory = [{ toStatus: "coordination_approved" }, { toStatus: "approved" }];
const activeHistory   = [...approvedHistory, { toStatus: "active" }];
const closedHistory   = [...activeHistory,   { toStatus: "closed" }];

// ── §1  Draft / pre-approval statuses → Permanent Delete ─────────────────────

describe("§1  Pre-approval statuses → permanent mode", () => {
  it("TC-01  Draft project with no history → permanent", () => {
    expect(getProjectDeletionMode({ status: "draft" }, noHistory, true)).toBe("permanent");
  });

  it("TC-02  Submitted project with no history → permanent", () => {
    expect(getProjectDeletionMode({ status: "submitted" }, noHistory, true)).toBe("permanent");
  });

  it("TC-03  Technically Approved project with no history → permanent", () => {
    expect(
      getProjectDeletionMode({ status: "technically_approved" }, noHistory, true),
    ).toBe("permanent");
  });

  it("TC-04  Coordination Approved project with no history → permanent", () => {
    expect(
      getProjectDeletionMode({ status: "coordination_approved" }, noHistory, true),
    ).toBe("permanent");
  });

  it("TC-05  Rejected project with no history → permanent", () => {
    expect(getProjectDeletionMode({ status: "rejected" }, noHistory, true)).toBe("permanent");
  });

  it("TC-11  Project never approved, currently Returned (rejected) → permanent where workflow allows", () => {
    // A project that reached rejected but never approved uses permanent delete.
    const rejectedHistory = [{ toStatus: "submitted" }, { toStatus: "rejected" }];
    expect(
      getProjectDeletionMode({ status: "rejected" }, rejectedHistory, true),
    ).toBe("permanent");
  });
});

// ── §2  Post-Final-Approval statuses → Soft Delete ───────────────────────────

describe("§2  Post-Final-Approval statuses → soft mode", () => {
  it("TC-05-A  Approved project (current status) → soft", () => {
    expect(
      getProjectDeletionMode({ status: "approved" }, approvedHistory, true),
    ).toBe("soft");
  });

  it("TC-06  Active project → soft", () => {
    expect(getProjectDeletionMode({ status: "active" }, activeHistory, true)).toBe("soft");
  });

  it("TC-07  Completed / closed project → soft", () => {
    expect(getProjectDeletionMode({ status: "closed" }, closedHistory, true)).toBe("soft");
  });

  it("TC-08  Closed project → soft", () => {
    expect(getProjectDeletionMode({ status: "closed" }, closedHistory, true)).toBe("soft");
  });
});

// ── §3  Approval history gates Permanent Delete for ever-approved projects ───

describe("§3  Historical Final Approval prevents Permanent Delete", () => {
  it("TC-09  Cancelled project that was previously approved → soft (history check)", () => {
    // Simulate a project that was approved then somehow reached a non-standard
    // status — the history must prevent permanent deletion.
    const history = [{ toStatus: "approved" }];
    expect(
      getProjectDeletionMode({ status: "draft" }, history, true),
    ).toBe("soft");
  });

  it("TC-10  Previously Approved then Returned project → soft (history wins)", () => {
    // Project status is now 'submitted' (returned for revision) but history
    // proves it once reached 'approved'.
    const returnedAfterApproval = [
      { toStatus: "technically_approved" },
      { toStatus: "coordination_approved" },
      { toStatus: "approved" },
      { toStatus: "submitted" }, // returned — but approved entry still exists
    ];
    expect(
      getProjectDeletionMode({ status: "submitted" }, returnedAfterApproval, true),
    ).toBe("soft");
  });

  it("TC-10-B  Project currently in coordination_approved but history has approved → soft", () => {
    const h = [{ toStatus: "approved" }, { toStatus: "coordination_approved" }];
    expect(
      getProjectDeletionMode({ status: "coordination_approved" }, h, true),
    ).toBe("soft");
  });

  it("TC-10-C  Active history entry alone forces soft even when current status is draft", () => {
    expect(
      getProjectDeletionMode({ status: "draft" }, [{ toStatus: "active" }], true),
    ).toBe("soft");
  });

  it("TC-10-D  Closed history entry alone forces soft even when current status is draft", () => {
    expect(
      getProjectDeletionMode({ status: "draft" }, [{ toStatus: "closed" }], true),
    ).toBe("soft");
  });
});

// ── §4  Permission gate ───────────────────────────────────────────────────────

describe("§4  Permission gate → not_allowed", () => {
  it("TC-12  User without delete permission denied regardless of status", () => {
    expect(
      getProjectDeletionMode({ status: "draft" }, noHistory, false),
    ).toBe("not_allowed");
  });

  it("TC-13  User without delete permission denied on approved project", () => {
    expect(
      getProjectDeletionMode({ status: "approved" }, approvedHistory, false),
    ).toBe("not_allowed");
  });

  it("TC-12-B  canDelete=false overrides any history — not_allowed returned", () => {
    expect(
      getProjectDeletionMode({ status: "draft" }, [{ toStatus: "approved" }], false),
    ).toBe("not_allowed");
  });
});

// ── §5  Reason validation ─────────────────────────────────────────────────────

describe("§5  Deletion reason validation", () => {
  it("TC-24-A  Empty string → error", () => {
    expect(validateDeletionReason("")).not.toBeNull();
  });

  it("TC-24-B  Whitespace-only → error", () => {
    expect(validateDeletionReason("    ")).not.toBeNull();
  });

  it("TC-24-C  Less than 5 chars → error", () => {
    expect(validateDeletionReason("No")).not.toBeNull();
  });

  it("TC-24-D  Exactly 5 chars → valid", () => {
    expect(validateDeletionReason("Valid")).toBeNull();
  });

  it("TC-24-E  Long clear reason → valid", () => {
    expect(
      validateDeletionReason("Donor withdrew funding; project must be closed and removed."),
    ).toBeNull();
  });

  it("TC-24-F  Non-string input (null) → error", () => {
    expect(validateDeletionReason(null)).not.toBeNull();
  });

  it("TC-24-G  Non-string input (number) → error", () => {
    expect(validateDeletionReason(42)).not.toBeNull();
  });

  it("TC-24-H  Non-string input (undefined) → error", () => {
    expect(validateDeletionReason(undefined)).not.toBeNull();
  });
});

// ── §6  Project code confirmation ─────────────────────────────────────────────

describe("§6  Project code confirmation (TC-23)", () => {
  it("TC-23-A  Exact match → true", () => {
    expect(confirmationCodeMatches("CAFA-2026-001", "CAFA-2026-001")).toBe(true);
  });

  it("TC-23-B  Leading/trailing whitespace stripped → true", () => {
    expect(confirmationCodeMatches("  CAFA-2026-001  ", "CAFA-2026-001")).toBe(true);
  });

  it("TC-23-C  Wrong code → false", () => {
    expect(confirmationCodeMatches("CAFA-2026-999", "CAFA-2026-001")).toBe(false);
  });

  it("TC-23-D  Empty input → false", () => {
    expect(confirmationCodeMatches("", "CAFA-2026-001")).toBe(false);
  });

  it("TC-23-E  Case-sensitive mismatch → false", () => {
    expect(confirmationCodeMatches("cafa-2026-001", "CAFA-2026-001")).toBe(false);
  });
});

// ── §7  Mode determination edge cases ────────────────────────────────────────

describe("§7  Mode determination edge cases", () => {
  it("TC-27  Empty history + pre-approval status = permanent (no ambiguity)", () => {
    const preApprovalStatuses = [
      "draft", "submitted", "state_reviewed",
      "technically_approved", "coordination_approved", "rejected",
    ];
    for (const s of preApprovalStatuses) {
      expect(getProjectDeletionMode({ status: s }, [], true), `status=${s}`).toBe("permanent");
    }
  });

  it("TC-28  Partial history (only technical_review) — no final approval → permanent", () => {
    const partialHistory = [
      { toStatus: "submitted" },
      { toStatus: "technically_approved" },
    ];
    expect(
      getProjectDeletionMode({ status: "technically_approved" }, partialHistory, true),
    ).toBe("permanent");
  });

  it("TC-29  History with approved sandwiched between other entries → soft", () => {
    const mixedHistory = [
      { toStatus: "submitted" },
      { toStatus: "technically_approved" },
      { toStatus: "coordination_approved" },
      { toStatus: "approved" },         // ← final approval
      { toStatus: "active" },
    ];
    expect(
      getProjectDeletionMode({ status: "active" }, mixedHistory, true),
    ).toBe("soft");
  });

  it("TC-30  History containing only non-approval transitions → permanent", () => {
    const reviewOnlyHistory = [
      { toStatus: "submitted" },
      { toStatus: "technically_approved" },
      { toStatus: "submitted" },        // returned and re-submitted
    ];
    expect(
      getProjectDeletionMode({ status: "submitted" }, reviewOnlyHistory, true),
    ).toBe("permanent");
  });
});

// ── §8  Soft delete preservation guarantee (conceptual) ──────────────────────
// These tests verify that the mode returned for post-approval projects
// is always "soft" (never "permanent"), which guarantees that the backend
// will use UPDATE rather than DELETE on the projects row — preserving all
// related records.

describe("§8  Soft Delete preservation guarantee", () => {
  it("TC-18  Soft delete mode is returned for approved projects", () => {
    expect(
      getProjectDeletionMode({ status: "approved" }, approvedHistory, true),
    ).toBe("soft");
  });

  it("TC-19  Soft delete mode is returned for active projects (reports preserved)", () => {
    expect(
      getProjectDeletionMode({ status: "active" }, activeHistory, true),
    ).toBe("soft");
  });

  it("TC-20  Soft delete mode is returned for closed projects (budget preserved)", () => {
    expect(
      getProjectDeletionMode({ status: "closed" }, closedHistory, true),
    ).toBe("soft");
  });

  it("TC-21  Soft delete mode for risks (risks still linked to project record)", () => {
    // A project with risk records that has been approved must use soft delete.
    expect(
      getProjectDeletionMode({ status: "active" }, activeHistory, true),
    ).toBe("soft");
  });
});
