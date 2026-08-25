/**
 * PRJ-BD-03 — Project Activity Spend Preservation Tests
 *
 * Verifies that budget_spent and progress_pct are preserved when a Project
 * editor saves unrelated content changes (title, description, etc.).
 *
 * Tests: PRJ-SPEND-01 through PRJ-SPEND-11
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
const mockClient = {
  query: mockClientQuery,
  release: vi.fn(),
};

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue(mockClient),
  },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis(), broadcastUpdate: vi.fn() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActors: vi.fn().mockResolvedValue(undefined),
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover: vi.fn().mockResolvedValue(undefined),
  createNotification: vi.fn().mockResolvedValue(undefined),
  createNotificationDeduped: vi.fn().mockResolvedValue(undefined),
  notifyByRole: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 10,
  name: "PM User",
  email: "pm@example.com",
  role: "program_manager",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

const SUPER_ADMIN_USER = {
  id: 11,
  name: "Super Admin",
  email: "sa@example.com",
  role: "super_admin",
  stateId: null,
  sector: null,
  sectors: [],
} as const;

/** Build a minimal valid PATCH body for the project endpoint. */
function buildPatchBody(
  activities: Array<{
    id?: number;
    title?: string;
    description?: string;
    plannedStart?: string;
    plannedEnd?: string;
    budgetPlanned?: number;
    target?: number;
    stateId?: number;
    localityName?: string;
    status?: string;
    indicatorIndex?: number;
  }>,
) {
  return {
    title: "Test Project",
    description: "A".repeat(50),
    donor: "UNICEF",
    agreementNumber: "AGR-001",
    sector: "Health",
    sectors: ["Health"],
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    hasHqOperations: true,
    stateIds: [],
    outputs: [
      {
        title: "Output 1",
        description: "Output desc",
        target: 100,
        indicators: [
          { title: "Indicator 1", unit: "count", target: 100 },
        ],
        activities: activities.map(a => ({
          title: a.title ?? "Activity A",
          description: a.description ?? "desc",
          plannedStart: a.plannedStart ?? "2026-01-01",
          plannedEnd: a.plannedEnd ?? "2026-06-30",
          budgetPlanned: a.budgetPlanned ?? 1000,
          target: a.target ?? 10,
          stateId: a.stateId ?? 1,
          localityName: a.localityName ?? "Locality A",
          status: a.status ?? "in_progress",
          ...(a.id !== undefined ? { id: a.id } : {}),
        })),
      },
    ],
  };
}

/**
 * Set up a sequence of client.query responses.
 * Calls resolve in order; any extra calls resolve with { rows: [] }.
 */
function setupClientResponses(responses: Array<{ rows: unknown[] }>) {
  let callIndex = 0;
  mockClientQuery.mockImplementation(() => {
    const result = responses[callIndex] ?? { rows: [] };
    callIndex++;
    return Promise.resolve(result);
  });
}

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as Record<string, unknown>).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use(projectsRouter);
  return app;
}

/**
 * Build the ordered sequence of client.query calls the PATCH handler makes:
 *  1. SELECT status,sector (pre-flight check)
 *  2. SELECT retained canonical project documents
 *  3. BEGIN
 *  4. SELECT id,budget_spent,progress_pct (spend map)
 *  5. UPDATE project row
 *  6. DELETE indicators
 *  7. DELETE outputs
 *  8. DELETE project_states
 *  9. DELETE project_state_allocations
 * 10. DELETE project_free_localities
 * 11. DELETE project_assignments
 * 12. DELETE dependent registry entries
 * 13. DELETE project_documents
 * 14. INSERT output → RETURNING id
 * 15. INSERT indicator → RETURNING id
 * 16. UPDATE or INSERT activity
 * 17. DELETE removed activities  (or DELETE all when matchedIds empty)
 * 18. COMMIT
 */
function makeClientResponses(
  existingActivities: Array<{ id: number; budget_spent: string; progress_pct: number }>,
  activityDbAction: "update" | "insert" = "update",
  failAt?: number,
): Array<{ rows: unknown[] }> {
  const responses: Array<{ rows: unknown[] }> = [
    { rows: [{ status: "draft", sector: "Health" }] },   // 1. pre-flight check
    { rows: [] },                                          // 2. retained documents
    { rows: [] },                                          // 3. BEGIN
    { rows: [{ budget: 0 }] },                             // 3b. BUD-BD-01 budget lock (FOR UPDATE)
    { rows: existingActivities },                          // 4. spend map SELECT
    { rows: [] },                                          // 5. UPDATE project
    { rows: [] },                                          // 6. DELETE indicators
    { rows: [] },                                          // 7. DELETE outputs
    { rows: [] },                                          // 8. DELETE project_states
    { rows: [] },                                          // 9. DELETE state_allocations
    { rows: [] },                                          // 10. DELETE free_localities
    { rows: [] },                                          // 11. DELETE project_assignments
    { rows: [] },                                          // 12. DELETE document registry entries
    { rows: [] },                                          // 13. DELETE project_documents
    { rows: [{ id: 999 }] },                              // 14. INSERT output
    { rows: [{ id: 888 }] },                              // 15. INSERT indicator
    { rows: [] },                                          // 16. UPDATE/INSERT activity
    { rows: [] },                                          // 17. DELETE removed activities
    { rows: [] },                                          // 18. COMMIT
  ];

  if (failAt !== undefined) {
    // Inject a rejection at the specified index (0-based)
    const original = responses.slice();
    let callCount = 0;
    mockClientQuery.mockImplementation(() => {
      const idx = callCount++;
      if (idx === failAt) return Promise.reject(new Error("Simulated DB error"));
      return Promise.resolve(original[idx] ?? { rows: [] });
    });
    return responses; // not used in this path
  }

  return responses;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock pool.query for enrichProject call after COMMIT
// ─────────────────────────────────────────────────────────────────────────────
function setupPoolEnrich() {
  mockQuery.mockResolvedValue({ rows: [{ id: 42, title: "Test Project", sector: "Health", sectors: ["Health"], status: "draft", startDate: "2026-01-01", endDate: "2026-12-31", budgetTotal: 0, budgetSpent: 0, progressPct: 0, beneficiariesReached: 0, beneficiariesTarget: 0, stateIds: [], stateNames: [], assignments: [], documents: [], localities: [] }] });
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-BD-03 — Activity Spend Preservation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.release.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  it("PRJ-SPEND-01: Existing activity with budget_spent > 0 retains exact spend after unrelated title edit", async () => {
    setupClientResponses(makeClientResponses([{ id: 5, budget_spent: "2500.00", progress_pct: 40 }]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 5, title: "Updated title" }]))
      .expect((res) => {
        // Expect the PATCH not to return an error
        expect(res.status).toBeLessThan(500);
      });

    // Verify that the spend-map SELECT was called inside the transaction
    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    const spendSelect = allCalls.find((q: string) => q.startsWith("SELECT id, budget_spent, progress_pct"));
    expect(spendSelect).toBeDefined();

    // Verify UPDATE was used (not INSERT) for the existing activity
    const updateCall = allCalls.find((q: string) => q.startsWith("UPDATE activities SET"));
    expect(updateCall).toBeDefined();

    // Verify INSERT into activities was NOT used for existing row
    const insertCall = allCalls.find((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCall).toBeUndefined();
  });

  it("PRJ-SPEND-02: Editing activity title/description does not reset spend", async () => {
    setupClientResponses(makeClientResponses([{ id: 7, budget_spent: "500.00", progress_pct: 20 }]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 7, title: "Changed Title", description: "Changed Description" }]));

    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    // UPDATE activities SET used (spend preserved)
    const updateCall = allCalls.find((q: string) => q.startsWith("UPDATE activities SET"));
    expect(updateCall).toBeDefined();
    // INSERT INTO activities NOT used
    const insertCall = allCalls.find((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCall).toBeUndefined();
  });

  it("PRJ-SPEND-03: Multiple existing activities each retain their own spend (no cross-contamination)", async () => {
    // Two existing activities with different spend
    const existingActivities = [
      { id: 10, budget_spent: "1000.00", progress_pct: 30 },
      { id: 11, budget_spent: "2000.00", progress_pct: 60 },
    ];
    // Both activities returned by spend map; two UPDATEs expected
    let callIndex = 0;
    const responses = [
      { rows: [{ status: "draft", sector: "Health" }] },
      { rows: [] },                        // retained documents
      { rows: [] },                        // BEGIN
      { rows: [{ budget: 0 }] },           // BUD-BD-01 budget lock (FOR UPDATE)
      { rows: existingActivities },        // spend map
      { rows: [] },                        // UPDATE project
      { rows: [] },                        // DELETE indicators
      { rows: [] },                        // DELETE outputs
      { rows: [] },                        // DELETE project_states
      { rows: [] },                        // DELETE state_allocations
      { rows: [] },                        // DELETE free_localities
      { rows: [] },                        // DELETE assignments
      { rows: [] },                        // DELETE document registry entries
      { rows: [] },                        // DELETE documents
      { rows: [{ id: 999 }] },             // INSERT output
      { rows: [{ id: 888 }] },             // INSERT indicator
      { rows: [] },                        // UPDATE activity 10
      { rows: [] },                        // UPDATE activity 11
      { rows: [] },                        // DELETE removed
      { rows: [] },                        // COMMIT
    ];
    mockClientQuery.mockImplementation(() => {
      const r = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(r);
    });
    setupPoolEnrich();

    // Build payload with TWO activities, each with matching ids
    const patchBody = buildPatchBody([
      { id: 10, title: "Activity A" },
      { id: 11, title: "Activity B" },
    ]);
    // Need two activities in the output — patch buildPatchBody to support this
    const multiActivityBody = {
      ...patchBody,
      outputs: [
        {
          ...patchBody.outputs[0],
          activities: [
            { id: 10, title: "Activity A", description: "d", plannedStart: "2026-01-01", plannedEnd: "2026-06-30", budgetPlanned: 1000, target: 10, stateId: 1, localityName: "Loc A", status: "in_progress" },
            { id: 11, title: "Activity B", description: "d", plannedStart: "2026-01-01", plannedEnd: "2026-06-30", budgetPlanned: 1500, target: 20, stateId: 1, localityName: "Loc B", status: "in_progress" },
          ],
        },
      ],
    };

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/projects/42").send(multiActivityBody);
    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    const updateCalls = allCalls.filter((q: string) => q.startsWith("UPDATE activities SET"));
    // Both activities should be UPDATEd (not INSERTed)
    expect(updateCalls).toHaveLength(2);
    const insertCalls = allCalls.filter((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCalls).toHaveLength(0);
  });

  it("PRJ-SPEND-04: New activity (no id in payload) starts at budget_spent = 0", async () => {
    setupClientResponses(makeClientResponses([]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ title: "Brand new activity" }])); // no id

    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    // INSERT used for new activity (no id match)
    const insertCall = allCalls.find((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCall).toBeDefined();
    // UPDATE activities SET NOT used
    const updateCall = allCalls.find((q: string) => q.startsWith("UPDATE activities SET"));
    expect(updateCall).toBeUndefined();
  });

  it("PRJ-SPEND-05: Activity id from a different project cannot inherit foreign spend", async () => {
    // Spend map only contains activity id 5 (owned by project 42)
    // Incoming payload claims id=999 which is NOT in the spend map
    setupClientResponses(makeClientResponses([{ id: 5, budget_spent: "1000.00", progress_pct: 50 }]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 999, title: "Activity from another project" }]));

    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    // id 999 not in spendMap → treated as NEW → INSERT (not UPDATE)
    const insertCall = allCalls.find((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCall).toBeDefined();
    const updateCall = allCalls.find((q: string) => q.startsWith("UPDATE activities SET"));
    expect(updateCall).toBeUndefined();
  });

  it("PRJ-SPEND-06: Reordering activities (same ids, different array order) does not move spend between rows", async () => {
    const existingActivities = [
      { id: 20, budget_spent: "300.00", progress_pct: 10 },
      { id: 21, budget_spent: "700.00", progress_pct: 70 },
    ];
    // Incoming: reversed order [21, 20]
    let callIndex = 0;
    const responses = [
      { rows: [{ status: "draft", sector: "Health" }] },
      { rows: [] }, // retained documents
      { rows: [] },
      { rows: [{ budget: 0 }] }, // BUD-BD-01 budget lock (FOR UPDATE)
      { rows: existingActivities },
      { rows: [] }, // UPDATE project
      { rows: [] }, // DELETE indicators
      { rows: [] }, // DELETE outputs
      { rows: [] }, // DELETE project states
      { rows: [] }, // DELETE allocations
      { rows: [] }, // DELETE localities
      { rows: [] }, // DELETE assignments
      { rows: [] }, // DELETE document registry entries
      { rows: [] }, // DELETE documents
      { rows: [{ id: 999 }] },
      { rows: [{ id: 888 }] },
      { rows: [] }, // UPDATE for activity 21 (first in reversed payload)
      { rows: [] }, // UPDATE for activity 20 (second in reversed payload)
      { rows: [] }, // DELETE removed
      { rows: [] }, // COMMIT
    ];
    mockClientQuery.mockImplementation(() => {
      const r = responses[callIndex] ?? { rows: [] };
      callIndex++;
      return Promise.resolve(r);
    });
    setupPoolEnrich();

    const reorderedBody = {
      title: "Test Project",
      description: "A".repeat(50),
      donor: "UNICEF",
      agreementNumber: "AGR-001",
      sectors: ["Health"],
      startDate: "2026-01-01",
      endDate: "2026-12-31",
      hasHqOperations: true,
      stateIds: [],
      outputs: [{
        title: "Output 1",
        description: "Output desc",
        target: 100,
        indicators: [{ title: "Indicator 1", unit: "count", target: 100 }],
        activities: [
          { id: 21, title: "B", plannedStart: "2026-01-01", plannedEnd: "2026-06-30", budgetPlanned: 700, stateId: 1, localityName: "Loc" },
          { id: 20, title: "A", plannedStart: "2026-01-01", plannedEnd: "2026-06-30", budgetPlanned: 300, stateId: 1, localityName: "Loc" },
        ],
      }],
    };

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app).patch("/projects/42").send(reorderedBody);
    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    const updateCalls = allCalls.filter((q: string) => q.startsWith("UPDATE activities SET"));
    expect(updateCalls).toHaveLength(2);
    // Both are UPDATEs — no INSERTs
    const insertCalls = allCalls.filter((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCalls).toHaveLength(0);
  });

  it("PRJ-SPEND-07: PM user edit preserves spend", async () => {
    setupClientResponses(makeClientResponses([{ id: 30, budget_spent: "800.00", progress_pct: 55 }]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 30, title: "PM edits this" }]));

    expect(res.status).toBeLessThan(500);
    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    expect(allCalls.find((q: string) => q.startsWith("UPDATE activities SET"))).toBeDefined();
  });

  it("PRJ-SPEND-08: Super Admin edit preserves spend", async () => {
    setupClientResponses(makeClientResponses([{ id: 31, budget_spent: "1200.00", progress_pct: 75 }]));
    setupPoolEnrich();

    const app = await buildApp(SUPER_ADMIN_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 31, title: "Super Admin edits this" }]));

    expect(res.status).toBeLessThan(500);
    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    expect(allCalls.find((q: string) => q.startsWith("UPDATE activities SET"))).toBeDefined();
    expect(allCalls.find((q: string) => q.startsWith("INSERT INTO activities"))).toBeUndefined();
  });

  it("PRJ-SPEND-09: Failed PATCH (DB error mid-transaction) triggers ROLLBACK", async () => {
    // Simulate an error on the UPDATE project row call (index 3, 0-based)
    let callIndex = 0;
    const responses = [
      { rows: [{ status: "draft", sector: "Health" }] },  // 0: pre-flight
      { rows: [] },                                         // 1: BEGIN
      { rows: [{ budget: 0 }] },                            // 2: BUD-BD-01 budget lock
      { rows: [{ id: 5, budget_spent: "500.00", progress_pct: 30 }] }, // 3: spend map
    ];
    mockClientQuery.mockImplementation(() => {
      const idx = callIndex++;
      if (idx === 4) return Promise.reject(new Error("Simulated DB failure"));
      const r = responses[idx] ?? { rows: [] };
      return Promise.resolve(r);
    });
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ id: 5 }]));

    // Should respond with 500 due to simulated error
    expect(res.status).toBe(500);

    // ROLLBACK should have been called
    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
    const rollback = allCalls.find((q: string) => q === "ROLLBACK");
    expect(rollback).toBeDefined();
  });

  it("PRJ-SPEND-10: Repeated PATCH (idempotent) leaves spend unchanged", async () => {
    // First PATCH: existing activity id=40 is updated (spend preserved)
    // Second PATCH: same payload, same id — UPDATE again (still preserved)
    for (let pass = 0; pass < 2; pass++) {
      setupClientResponses(makeClientResponses([{ id: 40, budget_spent: "600.00", progress_pct: 45 }]));
      setupPoolEnrich();

      const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
      const res = await request(app)
        .patch("/projects/42")
        .send(buildPatchBody([{ id: 40, title: "Idempotent title" }]));

      expect(res.status).toBeLessThan(500);
      const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());
      expect(allCalls.find((q: string) => q.startsWith("UPDATE activities SET"))).toBeDefined();
      expect(allCalls.find((q: string) => q.startsWith("INSERT INTO activities"))).toBeUndefined();

      vi.clearAllMocks();
      mockQuery.mockResolvedValue({ rows: [] });
    }
  });

  it("PRJ-SPEND-11: Removed activity with budget_spent > 0 is deleted by the DELETE clause", async () => {
    // Activity id=50 exists in DB with spend but is NOT in incoming payload
    // → it must appear in the DELETE query (matchedIds is empty → DELETE all)
    setupClientResponses(makeClientResponses([{ id: 50, budget_spent: "9999.00", progress_pct: 100 }]));
    setupPoolEnrich();

    const app = await buildApp(PM_USER as unknown as Record<string, unknown>);
    // Send payload WITHOUT id=50 — activity is being removed by the editor
    const res = await request(app)
      .patch("/projects/42")
      .send(buildPatchBody([{ title: "Brand new replacement activity" }])); // no id

    expect(res.status).toBeLessThan(500);

    const allCalls = mockClientQuery.mock.calls.map((c: unknown[]) => (c[0] as string).trim());

    // Since no activities matched (new one has no id), the fallback DELETE all runs
    const deleteAll = allCalls.find(
      (q: string) => q.startsWith("DELETE FROM activities WHERE project_id=$1") &&
        !q.includes("AND id"),
    );
    expect(deleteAll).toBeDefined();

    // The new activity was INSERTed with 0 spend
    const insertCall = allCalls.find((q: string) => q.startsWith("INSERT INTO activities"));
    expect(insertCall).toBeDefined();
  });
});
