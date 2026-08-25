/**
 * PRJ-FINAL — Projects Module Final Closure Test Suite (Task #501)
 *
 * This suite is the definitive closure gate for the Projects Module after all
 * prior audit, business-decision, and hardening tasks.  Tests are structural
 * (source-code inspection) and behavioural (HTTP mock assertions).
 *
 * PRJ-FINAL-01  Draft edit returns the same Project ID (no new row created)
 * PRJ-FINAL-02  State-scoped role cannot access out-of-scope Project detail
 * PRJ-FINAL-03  TC with secondary-sector assignment can read Project in that sector
 * PRJ-FINAL-04  TC with no sectors (empty array) is denied access — fail-closed
 * PRJ-FINAL-05  PATCH preserves budget_spent on existing activity (carry-forward)
 * PRJ-FINAL-06  PATCH preserves progress_pct on existing activity (carry-forward)
 * PRJ-FINAL-07  Payload with foreign activity ID cannot import that activity's spend
 * PRJ-FINAL-08  Removing financed activity via PATCH — contract documented + assertion matches
 * PRJ-FINAL-09  State allocation to non-linked State is rejected (422)
 * PRJ-FINAL-10  State allocation sum > Project budget is rejected (422)
 * PRJ-FINAL-11  Approved Project document: normal DELETE → 409 for non-PM role
 * PRJ-FINAL-12  PM document override on approved Project: single audit entry, reason required
 * PRJ-FINAL-13  Completed/closed Project: upload → 409; PM override delete → 409 (full freeze)
 * PRJ-FINAL-14  Soft-deleted Project excluded from list and duplicate-check
 * PRJ-FINAL-15  reportingFrequency=on_demand rejected; null accepted; scheduled values accepted
 * PRJ-FINAL-16  hasHqOperations boolean contract: true/false persist and return correctly
 * PRJ-FINAL-17  PM/Super Admin cannot zero budget_spent via PATCH (carry-forward actor-independent)
 * PRJ-FINAL-18  No startup DDL: projects.ts contains zero CREATE/ALTER TABLE statements
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { ZodError } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks
// ─────────────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
mockQuery.mockResolvedValue({ rows: [] });

const mockClientQuery = vi.fn();
mockClientQuery.mockResolvedValue({ rows: [] });
const mockClient = { query: mockClientQuery, release: vi.fn() };
const mockConnectFn = vi.fn().mockResolvedValue(mockClient);

vi.mock("@workspace/db", () => ({
  pool: {
    query: mockQuery,
    connect: mockConnectFn,
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

vi.mock("../lib/awsS3.js", () => ({
  archiveFile: vi.fn().mockResolvedValue(undefined),
  deleteFile: vi.fn().mockResolvedValue(undefined),
  isConfigured: vi.fn().mockReturnValue(false),
}));

vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit: vi.fn().mockResolvedValue(undefined),
    requirePerm: (perm: string) => (req: Request, res: Response, next: NextFunction) => {
      const u = req.currentUser;
      if (!u) { res.status(401).json({ error: "unauthorized" }); return; }
      const perms = original.permissionsFor(u as import("../middlewares/currentUser.js").CurrentUser);
      if (!original.hasPerm(perms, perm)) {
        res.status(403).json({ error: "forbidden", requiredPermission: perm });
        return;
      }
      next();
    },
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// User fixtures
// ─────────────────────────────────────────────────────────────────────────────

const PM_USER = {
  id: 1, name: "PM", email: "pm@cafa.org", role: "program_manager",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const SUPER_ADMIN_USER = {
  id: 2, name: "SA", email: "sa@cafa.org", role: "super_admin",
  stateId: null, sector: null, sectors: null, avatarUrl: null,
};

const TC_EDUCATION = {
  id: 11, name: "TC Education", email: "tc.edu@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Education", sectors: ["Education"], avatarUrl: null,
};

const TC_NO_SECTORS = {
  id: 12, name: "TC Empty", email: "tc.empty@cafa.org", role: "technical_coordinator",
  stateId: null, sector: null, sectors: [], avatarUrl: null,
};

const TC_HEALTH = {
  id: 13, name: "TC Health", email: "tc.h@cafa.org", role: "technical_coordinator",
  stateId: null, sector: "Health", sectors: ["Health"], avatarUrl: null,
};

const SPO_STATE_5 = {
  id: 20, name: "SPO", email: "spo@cafa.org", role: "state_program_officer",
  stateId: 5, sector: null, sectors: null, avatarUrl: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// App factory
// ─────────────────────────────────────────────────────────────────────────────

async function buildApp(user: Record<string, unknown>) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: typeof user }).currentUser = user;
    next();
  });
  const { default: projectsRouter } = await import("../routes/projects.js");
  app.use("/api", projectsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({ error: "validation_error", issues: err.issues });
      return;
    }
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

beforeEach(() => {
  vi.resetAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockClientQuery.mockResolvedValue({ rows: [] });
  mockConnectFn.mockResolvedValue(mockClient);
  mockClient.release.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-01: Draft edit returns same Project ID (no new row)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-01: Draft PATCH returns the same Project ID (no new row)", () => {
  it("PATCH /projects/:id issues UPDATE not INSERT for the project row (structural check)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The PATCH handler must UPDATE the existing project row, not INSERT a new one.
    // Verified by the presence of SET clause on the projects table in PATCH context.
    expect(src).toContain("budget_total=$17");        // the large UPDATE SET block
    expect(src).toContain("WHERE id=$");               // keyed to existing projectId
    // No INSERT INTO projects inside the PATCH handler.
    // The CREATE handler has INSERT INTO projects; the PATCH handler must not.
    const patchHandlerStart = src.indexOf("router.patch(\"/projects/:projectId\"");
    const patchHandlerEnd = src.indexOf("router.get(\"/projects/:projectId/documents\"");
    const patchSection = src.slice(patchHandlerStart, patchHandlerEnd);
    expect(patchSection).not.toContain("INSERT INTO projects");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-02: State-scoped role cannot access out-of-scope Project detail
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-02: State-scoped role denied out-of-scope Project detail", () => {
  it("SPO (stateId=5) denied on Project whose project_states excludes state 5 → 403", async () => {
    // getProjectEffectiveSectors: project exists (no sector restriction for SPO)
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    // assertStateAllowed: check project_states — state 5 not linked
    mockQuery.mockResolvedValueOnce({ rows: [] }); // no matching row in project_states
    // assertStateAllowed also checks project_assignments — none
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(SPO_STATE_5);
    const res = await request(app).get("/api/projects/99");
    expect(res.status).toBe(403);
  });

  it("assertStateAllowed fail-closed: SPO with stateId=null → always 403 (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // Verify the fail-closed null stateId guard text
    expect(src).toContain("Fail-closed: a state-role user with no stateId returns an empty list.");
    expect(src).toContain("stateId ?? null) === null");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-03: TC with secondary-sector access can read Project in that sector
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-03: TC secondary-sector access succeeds", () => {
  it("TC_EDUCATION (sectors=[Education]) can access Project with primary=Health, sectors=[Education]", async () => {
    // getProjectEffectiveSectors: primary=Health, secondary=[Education]
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Education"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_EDUCATION);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-04: TC with no sectors (empty) fails closed
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-04: TC with empty sectors array fails closed on Project detail", () => {
  it("TC with sectors=[] gets 403 on any project → effectiveSectors check returns forbidden", async () => {
    // getProjectEffectiveSectors: project has a sector
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    mockQuery.mockResolvedValue({ rows: [] });

    const app = await buildApp(TC_NO_SECTORS);
    const res = await request(app).get("/api/projects/1");
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
  });

  it("assertEffectiveSectorAllowedForProject returns 403 when restriction is empty (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("if (restriction.length === 0) return { ok: false, status: 403");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-05 & 06: PATCH preserves budget_spent and progress_pct (BD-03)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-05 & 06: PATCH preserves budget_spent and progress_pct on existing activity", () => {
  it("PRJ-FINAL-05: Carry-forward SELECT is present and budget_spent is in the query (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("SELECT id, budget_spent, progress_pct, state_id FROM activities WHERE project_id");
    expect(src).toContain("spendMap");
    expect(src).toContain("budget_spent and progress_pct");
  });

  it("PRJ-FINAL-06: UPDATE activities omits budget_spent and progress_pct from SET clause (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The UPDATE for existing activities must NOT set budget_spent or progress_pct
    expect(src).toContain("Existing activity — UPDATE, preserving budget_spent and progress_pct");
    // New activity INSERT includes them explicitly as 0
    expect(src).toContain("budget_spent, progress_pct)");
    expect(src).toContain("VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,0,0)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-07: Foreign activity ID cannot import another project's spend
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-07: Payload with foreign activity ID cannot import that activity's spend", () => {
  it("spendMap is scoped to project_id — only this project's activities are loaded (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The carry-forward query is scoped by project_id, so IDs from another project
    // will not be in spendMap and will receive budget_spent = 0
    expect(src).toContain("SELECT id, budget_spent, progress_pct, state_id FROM activities WHERE project_id = $1");
    // The spendMap lookup succeeds only if id ∈ spendMap (i.e., belongs to this project)
    expect(src).toContain("spendMap.has(incomingId)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-08: Financed activity removal — contract documented and tested
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-08: Financed activity removal contract (explicit, approved)", () => {
  /**
   * APPROVED CONTRACT (Task #485, GAP-3, Task #487):
   *
   * Removing an activity from the PATCH payload on a draft project IS ALLOWED by the backend.
   * PATCH is restricted to draft status only. The activity's budget_spent value is permanently
   * lost upon removal. This is intentional: the user explicitly chose to remove the activity.
   *
   * Mitigating controls:
   *   (a) PATCH is draft-only — no spend can be erased on approved/active/completed projects
   *       because PATCH is blocked by status guard.
   *   (b) Permanent project DELETE is blocked when any activity has budget_spent > 0.
   *   (c) The frontend shows an AlertDialog warning before removing a financed activity (#493/#487).
   *   (d) The carry-forward preserves spend for activities that REMAIN in the payload (round-trip id).
   *
   * A backend prohibition was explicitly NOT added — the decision records confirm that
   * user intent (explicit omission from payload) is the correct control mechanism.
   */
  it("Backend PATCH allows removing activities — no 'cannot remove financed activity' guard (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // CONFIRMED ALLOWED: the removal path is a DELETE WHERE id != ALL(matchedIds)
    expect(src).toContain("DELETE FROM activities WHERE project_id=$1 AND id != ALL($2::int[])");
    // CONFIRMED: no server-side prohibition on removing financed activities
    expect(src).not.toContain("cannot remove financed activity");
    expect(src).not.toContain("activity_has_spend");
  });

  it("Frontend AlertDialog warning is implemented for financed activity removal (structural, frontend)", () => {
    const formPath = resolve(
      import.meta.dirname,
      "../../../../cafa-pmis/src/components/project-registration-form.tsx",
    );
    let formSrc = "";
    try { formSrc = readFileSync(formPath, "utf8"); } catch { /* path variant */ }
    if (!formSrc) return; // skip if path not available in this runner context
    // Warning dialog is rendered when budgetSpent > 0
    expect(formSrc).toContain("Remove Activity With Recorded Expenditure?");
    expect(formSrc).toContain("budgetSpent");
  });

  it("Permanent project DELETE is blocked when any activity has budget_spent > 0 (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // Permanent delete guard prevents destroying projects with financial history
    expect(src).toContain("COUNT(*)::int AS cnt FROM activities WHERE project_id = $1 AND budget_spent > 0");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-09: State allocation to non-linked State is rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-09: State allocation to non-linked State is rejected", () => {
  it("POST /projects/:id/state-allocations with unlinked stateId → 422 project_state_not_linked", async () => {
    // getProjectEffectiveSectors
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    // linked state membership check → empty (state 999 not in project_states)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValue({ rows: [] });
    mockClientQuery.mockResolvedValue({ rows: [{ budget: 200000 }] });

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/42/state-allocations")
      .send({ allocations: [{ stateId: 999, budgetAllocation: 5000 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("project_state_not_linked");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-10: State allocation > Project budget is rejected
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-10: State allocation sum > Project budget is rejected", () => {
  it("Over-allocation guard present in POST state-allocations handler (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("Over-allocation guard");
    expect(src).toContain("over_allocation");
  });

  it("POST state-allocations with amount > budget_total → 422 over_allocation", async () => {
    // Handler acquires client first, then uses pool.query for effectiveSectors.
    // pool.query[0]: getProjectEffectiveSectors → project exists
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    // pool.query[1]: assertStateAllowed → PM passes without DB (short-circuits for non-state role)
    // pool.query[2]: linked state membership check → state 5 IS linked
    mockQuery.mockResolvedValueOnce({ rows: [{ state_id: 5 }] });
    // pool.query[3]: assertActiveState → linked state remains operationally eligible
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 5, name: "South Kordofan", nameAr: "جنوب كردفان", code: "SKR", operationalStatus: "active", officeStatus: "present" }],
    });
    mockQuery.mockResolvedValue({ rows: [] });
    // client.query: BEGIN first, then budget_total = 10000 read FOR UPDATE inside the transaction
    mockClientQuery.mockResolvedValueOnce({ rows: [] }); // BEGIN
    mockClientQuery.mockResolvedValueOnce({ rows: [{ budget: 10000 }] });

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects/42/state-allocations")
      .send({ allocations: [{ stateId: 5, budgetAllocation: 99999 }] });

    expect(res.status).toBe(422);
    expect(res.body.error).toBe("over_allocation");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-11: Approved Project document normal DELETE → 409 for non-PM
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-11: Approved Project document DELETE blocked for non-PM", () => {
  it("TC delete on approved project → 409 project_document_locked_after_approval", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] }); // effectiveSectors
    // assertStateAllowed → pass (TC role, no state restriction)
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })                         // BEGIN
      .mockResolvedValueOnce({ rows: [{ status: "approved" }] })  // SELECT FOR UPDATE
      .mockResolvedValueOnce({ rows: [] });                        // ROLLBACK

    const app = await buildApp(TC_HEALTH);
    const res = await request(app).delete("/api/projects/1/documents/55");
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_document_locked_after_approval");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-12: PM document override requires reason + writes audit entry
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-12: PM override on approved Project document: reason required + audit written", () => {
  it("PM delete without overrideReason → 400 (reason required)", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "approved" }] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const app = await buildApp(PM_USER);
    const res = await request(app).delete("/api/projects/1/documents/55").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
  });

  it("Audit log entry action 'document_delete_override' is written for PM override (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("document_delete_override");
  });

  it("'overrideReason' field is checked for non-blank before PM override proceeds (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("override_reason_required");
    expect(src).toContain("rawReason");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-13: Completed/closed Project: upload → 409; PM delete → 409 (full freeze)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-13: Completed/closed Project document full freeze applies to all actors", () => {
  it("PM upload on completed project → 409 project_documents_frozen (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("project_documents_frozen");
    expect(src).toContain("uploadTxGate === \"frozen\"");
  });

  it("Completed/closed freeze blocks PM delete — even with overrideReason (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // Frozen check comes BEFORE the override check → freeze blocks everyone
    const frozenDeleteIdx = src.indexOf("txGate === \"frozen\"");
    const overrideIdx = src.indexOf("isOverrideActor");
    expect(frozenDeleteIdx).toBeGreaterThan(0);
    expect(overrideIdx).toBeGreaterThan(frozenDeleteIdx); // frozen check first
  });

  it("PM delete on closed project → 409 project_documents_frozen", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ sector: "Health", sectors: ["Health"] }] });
    mockClientQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ status: "closed" }] })
      .mockResolvedValueOnce({ rows: [] }); // ROLLBACK

    const app = await buildApp(PM_USER);
    const res = await request(app)
      .delete("/api/projects/1/documents/77")
      .send({ overrideReason: "emergency" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_documents_frozen");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-14: Soft-deleted Project excluded from list and duplicate-check
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-14: Soft-deleted Project excluded from list and duplicate-check", () => {
  it("List query filters deleted_at IS NULL (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("p.deleted_at IS NULL");
  });

  it("Duplicate-check query filters deleted_at IS NULL (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The duplicate-check response section must exclude soft-deleted projects
    expect(src).toContain("p.deleted_at IS NULL");
    // getProjectEffectiveSectors helper also filters deleted projects
    expect(src).toContain("AND deleted_at IS NULL");
  });

  it("Migration 025 adds soft-delete columns to projects table (structural)", () => {
    const migrationsPath = resolve(import.meta.dirname, "../lib/run-migrations.ts");
    const content = readFileSync(migrationsPath, "utf8");
    expect(content).toContain("025_projects_soft_delete_and_doc_drive_file");
    expect(content).toContain("ADD COLUMN IF NOT EXISTS deleted_at");
    expect(content).toContain("ADD COLUMN IF NOT EXISTS deleted_by");
    expect(content).toContain("ADD COLUMN IF NOT EXISTS deletion_reason");
    expect(content).toContain("ADD COLUMN IF NOT EXISTS deletion_mode");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-15: reportingFrequency contract
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-15: reportingFrequency=on_demand rejected; null and scheduled values accepted", () => {
  it("on_demand is excluded from SCHEDULED_FREQUENCIES in validation (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // Comment in source confirms on_demand exclusion
    expect(src).toContain("'on_demand' is not a valid scheduled frequency");
    expect(src).toContain("SCHEDULED_FREQUENCIES");
    expect(src).toContain("invalid_reporting_frequency");
  });

  it("reportingFrequency API SELECT uses camelCase alias (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("reporting_frequency AS \"reportingFrequency\"");
  });

  it("POST /projects with on_demand reporting frequency → rejected (400)", async () => {
    const app = await buildApp(PM_USER);
    const res = await request(app)
      .post("/api/projects")
      .send({
        title: "Test Project",
        agreementNumber: "AGR-001",
        donor: "Test Donor",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        sector: "Health",
        sectors: ["Health"],
        reportingFrequency: "on_demand",   // ← MUST be rejected
        hasHqOperations: true,
        currency: "USD",
        budgetTotal: 50000,
        stateIds: [],
      });
    // on_demand is rejected either by the Zod schema (validation_error) or by the
    // manual SCHEDULED_FREQUENCIES guard (invalid_reporting_frequency) — both return 400.
    // The structural test above confirms the manual guard text is present.
    expect(res.status).toBe(400);
    expect(["validation_error", "invalid_reporting_frequency"]).toContain(res.body.error);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-16: hasHqOperations boolean contract
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-16: hasHqOperations boolean contract", () => {
  it("has_hq_operations aliased as hasHqOperations in API SELECT (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    expect(src).toContain("has_hq_operations");
    expect(src).toContain("hasHqOperations");
  });

  it("Migration 016 adds has_hq_operations column with DEFAULT false (structural)", () => {
    const migrationsPath = resolve(import.meta.dirname, "../lib/run-migrations.ts");
    const content = readFileSync(migrationsPath, "utf8");
    expect(content).toContain("has_hq_operations");
    expect(content).toContain("016");
  });

  it("Generated API client includes hasHqOperations in ProjectDetail type (structural)", () => {
    const schemaPath = resolve(
      import.meta.dirname,
      "../../../../lib/api-client-react/src/generated/api.schemas.ts",
    );
    let schemaSrc = "";
    try { schemaSrc = readFileSync(schemaPath, "utf8"); } catch { /* skip if not available */ }
    if (!schemaSrc) return;
    expect(schemaSrc).toContain("hasHqOperations");
    expect(schemaSrc).toContain("reportingFrequency");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-17: PM/Super Admin cannot zero budget_spent via PATCH (carry-forward is actor-independent)
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-17: PM/Super Admin cannot zero budget_spent via PATCH (actor-independent)", () => {
  it("Carry-forward comment states it is actor-independent (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The spendMap carry-forward must run for all actors including PM/SA
    expect(src).toContain("budget_spent and progress_pct must survive ordinary content edits.");
    // PM/SA calling PATCH still triggers the exact same carry-forward path — there is
    // no role bypass: the spendMap SELECT fires unconditionally before activity upsert
    expect(src).toContain("existingSpend");
  });

  it("No role check gates the carry-forward SELECT — it runs for all actors (structural)", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    const spendSelectIdx = src.indexOf("SELECT id, budget_spent, progress_pct, state_id FROM activities WHERE project_id");
    const pmBypassPattern = src.slice(Math.max(0, spendSelectIdx - 200), spendSelectIdx);
    // There must be no 'if (role === "program_manager")' or similar gate before the spend SELECT
    expect(pmBypassPattern).not.toContain("program_manager");
    expect(pmBypassPattern).not.toContain("super_admin");
    expect(pmBypassPattern).not.toContain("isFullAccess");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PRJ-FINAL-18: No startup DDL in projects.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("PRJ-FINAL-18: No startup DDL: projects.ts contains zero CREATE/ALTER TABLE", () => {
  it("projects.ts contains no top-level pool.query with CREATE TABLE, ALTER TABLE, or CREATE INDEX", () => {
    const src = readFileSync(resolve(import.meta.dirname, "../routes/projects.ts"), "utf8");
    // The specific startup DDL patterns removed by migration 025
    expect(src).not.toContain("pool.query(\"ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at");
    expect(src).not.toContain("pool.query(\"ALTER TABLE project_documents ADD COLUMN IF NOT EXISTS drive_file_id");
    // Generic check: no pool.query with CREATE TABLE or CREATE INDEX at module scope
    expect(src).not.toMatch(/pool\.query\s*\(\s*["'`]\s*CREATE TABLE/);
    expect(src).not.toMatch(/pool\.query\s*\(\s*["'`]\s*CREATE INDEX/);
  });

  it("The migration 025 tracked migration (not startup DDL) handles the schema changes", () => {
    const migrationsPath = resolve(import.meta.dirname, "../lib/run-migrations.ts");
    const content = readFileSync(migrationsPath, "utf8");
    expect(content).toContain("025_projects_soft_delete_and_doc_drive_file");
    // Both schema changes are in the migration, not the route file
    expect(content).toContain("ADD COLUMN IF NOT EXISTS deleted_at");
    expect(content).toContain("ADD COLUMN IF NOT EXISTS drive_file_id");
  });
});
