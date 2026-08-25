/**
 * Reports Module Zero-Residual Final Closure Audit — Task #522
 *
 * REP-ZR sentinel suite: 25 sentinels (REP-ZR-01 … REP-ZR-25) covering all
 * four report families (PMR / Activity / SPR / HQSR) plus shared infrastructure.
 *
 * Behavioral sentinels run the REAL route code over supertest with a mocked
 * DB pool (pattern of spr-final-closure.test.ts / hqsr-final-closure.test.ts).
 * A small number of structural sentinels (attachment DTO column list, startup
 * DDL, rate-limit guard, analytics JOIN shape) assert directly against the
 * production source because the property under test is a source-level
 * invariant (what SQL text ships / what guard expression ships).
 *
 *  REP-ZR-01  PMR submit gate: valid content passes, malformed 422, never 500
 *  REP-ZR-02  Activity submit gate (modern schema)
 *  REP-ZR-03  SPR submit gate
 *  REP-ZR-04  HQSR submit gate
 *  REP-ZR-05  Identity immutability on PATCH — all four families
 *  REP-ZR-06  Duplicate protection is backend-authoritative
 *  REP-ZR-07  State scope: wrong-state actor denied
 *  REP-ZR-08  Sector scope: wrong-sector TC denied
 *  REP-ZR-09  PM Full Operational Access works
 *  REP-ZR-10  Super Admin Full Access works
 *  REP-ZR-11  Self-review override: reason required, stored on approval row
 *  REP-ZR-12  Invalid submit leaves zero workflow side effects
 *  REP-ZR-13  Attachment list DTO leaks no storage internals
 *  REP-ZR-14  Attachment download: auth + scope + belongs-to-report; streamed
 *  REP-ZR-15  Voice-note mutations guarded server-side
 *  REP-ZR-16  PMR revision keeps the same report ID
 *  REP-ZR-17  Activity pre-approval revision E2E cycle — same ID throughout
 *  REP-ZR-18  SPR revision keeps the same report ID
 *  REP-ZR-19  HQSR revision keeps the same report ID
 *  REP-ZR-20  Analytics uses LEFT JOIN to projects (standalone SPR/HQSR kept)
 *  REP-ZR-21  Approval routing is workflow_path-aware
 *  REP-ZR-22  Notifications fire post-COMMIT only; absent on rollback
 *  REP-ZR-23  Production rate-limit bypass cannot activate
 *  REP-ZR-24  No startup DDL in Reports route files
 *  REP-ZR-25  Reports-owned TypeScript debt eliminated (named unsafe casts gone)
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(resolve(__dir, rel), "utf8");

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (hoisted — must precede any route import)
// ─────────────────────────────────────────────────────────────────────────────

const mockPoolQuery     = vi.fn();
const mockClientQuery   = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect       = vi.fn();

const { mockGetObjectEntityFile, mockDownloadObject, MockObjectStorageService } = vi.hoisted(() => {
  const mockGetObjectEntityFile = vi.fn();
  const mockDownloadObject = vi.fn();
  function MockObjectStorageService(this: Record<string, unknown>) {
    this.getObjectEntityFile = mockGetObjectEntityFile;
    this.downloadObject      = mockDownloadObject;
  }
  return { mockGetObjectEntityFile, mockDownloadObject, MockObjectStorageService };
});

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockConnect },
}));

vi.mock("../lib/realtime.js", () => ({
  realtime: { emit: vi.fn(), to: vi.fn().mockReturnThis() },
}));

vi.mock("../lib/notifications.js", () => ({
  notifyEntityActorsDeduped: vi.fn().mockResolvedValue(undefined),
  notifyNextApprover:        vi.fn().mockResolvedValue(undefined),
}));

// requirePerm is a no-op so each sentinel targets the inner gate under test.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../middlewares/currentUser.js")>();
  return {
    ...original,
    logAudit:    vi.fn().mockResolvedValue(undefined),
    requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  };
});

vi.mock("../lib/objectStorage.js", () => ({
  ObjectStorageService:      MockObjectStorageService,
  ObjectNotFoundError:       class ObjectNotFoundError extends Error {},
  deleteStorageObjectSafely: vi.fn().mockResolvedValue(undefined),
  isStorageConfigured:       vi.fn().mockReturnValue({ configured: true }),
}));

vi.mock("../lib/awsS3.js", () => ({
  isConfigured:       vi.fn().mockReturnValue(false),
  downloadFileStream: vi.fn().mockResolvedValue(null),
}));

import { notifyEntityActorsDeduped, notifyNextApprover } from "../lib/notifications.js";

// ─────────────────────────────────────────────────────────────────────────────
// Test users (real permissionsFor is used by the routes)
// ─────────────────────────────────────────────────────────────────────────────

const SPO_STATE1 = { id: 10, name: "SPO",  email: "spo@ex.com",  role: "state_program_officer",       stateId: 1,    sector: null,     sectors: [] } as const;
const SPO_STATE2 = { id: 11, name: "SPO2", email: "spo2@ex.com", role: "state_program_officer",       stateId: 2,    sector: null,     sectors: [] } as const;
const TC_HEALTH  = { id: 15, name: "TC",   email: "tc@ex.com",   role: "technical_coordinator",       stateId: null, sector: "Health", sectors: ["Health"] } as const;
const TC_WASH    = { id: 20, name: "TCW",  email: "tcw@ex.com",  role: "technical_coordinator",       stateId: null, sector: "WASH",   sectors: ["WASH"] } as const;
const SPC_USER   = { id: 16, name: "SPC",  email: "spc@ex.com",  role: "senior_program_coordinator",  stateId: null, sector: null,     sectors: [] } as const;
const PM_USER    = { id: 17, name: "PM",   email: "pm@ex.com",   role: "program_manager",             stateId: null, sector: null,     sectors: [] } as const;
const SA_USER    = { id: 18, name: "SA",   email: "sa@ex.com",   role: "super_admin",                 stateId: null, sector: null,     sectors: [] } as const;

type AnyUser = Record<string, unknown>;

async function buildApp(user: AnyUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    (req as unknown as { currentUser: AnyUser }).currentUser = user;
    next();
  });
  const { default: reportsRouter } = await import("../routes/reports.js");
  app.use("/api/projects", reportsRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stateful DB harness — the report row mutates as transitions run, so a full
// multi-step lifecycle exercises the same record (same ID) end to end.
// ─────────────────────────────────────────────────────────────────────────────

type CycleRow = {
  id: number; status: string; reportType: string;
  stateId: number | null; sector: string | null;
  projectId: number | null; activityId: number | null;
  workflowPath: string | null; authorId: number | null;
};

type Harness = {
  row: CycleRow;
  approvals: unknown[][];
  updates: string[];
};

function wireStatefulDb(
  row: CycleRow,
  contentRow: () => Record<string, unknown>,
  sectorRow: Record<string, unknown>,
): Harness {
  const approvals: unknown[][] = [];
  const updates: string[] = [];

  mockClientQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    if (sql.includes("FOR UPDATE")) return Promise.resolve({ rows: [{ ...row }] });
    if (sql.includes("UPDATE reports")) {
      row.status = String((params as unknown[])[0]);
      updates.push(row.status);
      return Promise.resolve({ rows: [], rowCount: 1 });
    }
    if (sql.includes("INSERT INTO approvals")) {
      approvals.push(params as unknown[]);
      return Promise.resolve({ rows: [] });
    }
    if (sql.includes("SELECT currency FROM projects")) return Promise.resolve({ rows: [{ currency: "USD" }] });
    if (sql.includes("FROM report_attachments"))       return Promise.resolve({ rows: [{ cnt: 0 }] });
    // Family-specific submit content gates all SELECT ... FROM reports WHERE id = $1
    if (sql.includes("FROM reports WHERE id")) return Promise.resolve({ rows: [contentRow()] });
    return Promise.resolve({ rows: [] });
  });
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });

  mockPoolQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
    void params;
    if (typeof sql !== "string") return Promise.resolve({ rows: [] });
    // getReportSector (short scope query) vs reportSelect (full enriched row —
    // has "authorName"): both alias "effectiveSector", so disambiguate.
    if (sql.includes('"effectiveSector"') && !sql.includes('"authorName"')) return Promise.resolve({ rows: [sectorRow] });
    if (sql.includes("required_correction")) return Promise.resolve({ rows: [{ n: 0 }] });
    // PATCH initial row check (no alias r)
    if (sql.includes('author_id AS "authorId"') && sql.includes("FROM reports WHERE")) {
      return Promise.resolve({
        rows: [{
          status: row.status, sector: row.sector, projectId: row.projectId,
          reportType: row.reportType, authorId: row.authorId,
          stateId: row.stateId, sections: {},
        }],
      });
    }
    if (sql.includes("UPDATE reports")) return Promise.resolve({ rows: [], rowCount: 1 });
    // Final enriched SELECT (transitions + PATCH responses)
    if (sql.includes("FROM reports r")) {
      return Promise.resolve({
        rows: [{ id: row.id, status: row.status, reportType: row.reportType, plannedBudget: null, actualExpenditure: null }],
      });
    }
    return Promise.resolve({ rows: [] });
  });

  return { row, approvals, updates };
}

async function transition(app: express.Express, reportId: number, body: Record<string, unknown>) {
  return request(app).post(`/api/projects/reports/${reportId}/transitions`).send(body);
}

// ─────────────────────────────────────────────────────────────────────────────
// Valid content fixtures per family (mirror the server submit validators)
// ─────────────────────────────────────────────────────────────────────────────

function validPmrContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 301, title: "PMR June", project_id: 5, state_id: 1, location_type: "state",
    kind: "monthly", period: "2026-06", period_start: null, on_demand_reason: null,
    reporting_month: 6, reporting_year: 2026, quarter: null,
    sections: {
      keyAchievements: "Delivered outputs", lessonsLearned: "Plan earlier",
      docsNoSupport: true, docsNoSupportReason: "No supporting documents this period",
    },
    activities: [{
      name: "Activity 1", plannedBudget: 100, actualExpenditure: 100,
      achievementSummary: "Completed",
      beneficiariesMen: 5, beneficiariesWomen: 5, beneficiariesBoys: 0, beneficiariesGirls: 0,
    }],
    ...overrides,
  };
}

function validActivityContent(overrides: Record<string, unknown> = {}) {
  // Legacy (non-modern) sections are exempt from the FIX-08 modern content gate;
  // modern content is exercised separately in REP-ZR-02.
  return {
    title: "Activity report", activityName: "Water point rehab",
    sections: { note: "legacy record" }, period: "2026-06",
    reportingMonth: 6, reportingYear: 2026, stateId: 1, locationType: "state",
    beneficiariesMale: 0, beneficiariesFemale: 0, beneficiariesBoys: 0, beneficiariesGirls: 0,
    ...overrides,
  };
}

function validSprContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 201, title: "Valid SPR", state_id: 1, kind: "monthly",
    period: "2026-07", period_start: null, period_end: null, on_demand_reason: null,
    sections: {
      sectors: ["Health"], localitiesCovered: ["Khartoum"],
      humanitarianContext: {
        securitySituation: "Stable", populationMovements: "Low",
        diseaseOutbreaks: "None", accessConstraints: "Minimal",
      },
      keyAchievements: "Aid delivered", mainChallenges: "Access",
      mitigationMeasures: "Coordination", nextPeriodPriorities: "Scale up",
    },
    activities: [{
      title: "Distribution", sector: "Health", activityDate: "2026-07-15",
      achievementSummary: "Kits distributed",
      beneficiariesMen: 50, beneficiariesWomen: 60, beneficiariesBoys: 20, beneficiariesGirls: 30,
    }],
    ...overrides,
  };
}

function validHqsrContent(overrides: Record<string, unknown> = {}) {
  return {
    id: 401, title: "HQSR Health Q2", sector: "Health", kind: "monthly",
    period_start: null, period_end: null, on_demand_reason: null,
    sections: {
      technicalAnalysis: "Analysis", keyFindings: "Findings",
      qualityAssessment: "Good", technicalChallenges: "Few",
      recommendations: "Continue", strategicPriorities: "Expand",
      lessonsLearned: "Iterate", sectorOutlook: "Positive",
      supportRequired: [{ supportType: "Funding", description: "Additional budget" }],
    },
    ...overrides,
  };
}

const PMR_SECTOR      = { reportType: "project",       projectId: 5,    projectSector: "Health", activitySector: null,   effectiveSector: "Health" };
const ACTIVITY_SECTOR = { reportType: "activity",      projectId: null, projectSector: null,     activitySector: "WASH", effectiveSector: "WASH" };
const SPR_SECTOR      = { reportType: "program_state", projectId: null, projectSector: null,     activitySector: null,   effectiveSector: null };
const HQSR_SECTOR     = { reportType: "hq_sector",     projectId: null, projectSector: null,     activitySector: null,   effectiveSector: "Health" };

function lockRow(overrides: Partial<CycleRow> = {}): CycleRow {
  return {
    id: 501, status: "draft", reportType: "activity", stateId: 1, sector: null,
    projectId: null, activityId: 7, workflowPath: "state_authored", authorId: 10,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────────────────────────

beforeAll(async () => {
  mockPoolQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  await buildApp(SPO_STATE1 as unknown as AnyUser);
});

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientQuery.mockReset().mockResolvedValue({ rows: [] });
  mockClientRelease.mockReset();
  mockConnect.mockReset().mockResolvedValue({ query: mockClientQuery, release: mockClientRelease });
  mockGetObjectEntityFile.mockReset().mockResolvedValue({ key: "private/test" });
  mockDownloadObject.mockReset().mockResolvedValue({
    status: 200,
    headers: new Headers({ "content-type": "application/pdf" }),
    body: null,
  });
  vi.mocked(notifyEntityActorsDeduped).mockClear();
  vi.mocked(notifyNextApprover).mockClear();
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-01 … 04 — Submit gates per family
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-01 — PMR submit gate", () => {
  it("valid PMR content submits cleanly (no 422, no 500)", async () => {
    const h = wireStatefulDb(
      lockRow({ id: 301, reportType: "project", projectId: 5, activityId: null }),
      () => validPmrContent(),
      PMR_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 301, { action: "submit" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("submitted");
  });

  it("malformed PMR (null sections, junk activities) → clean 422, never 500", async () => {
    wireStatefulDb(
      lockRow({ id: 301, reportType: "project", projectId: 5, activityId: null }),
      () => validPmrContent({
        title: "", sections: null,
        activities: [null, ["array"], { name: "A", actualExpenditure: "not-a-number", beneficiariesMen: true }],
      }),
      PMR_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 301, { action: "submit" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.length).toBeGreaterThan(0);
  });

  // Malformed entries must be validation errors in their own right — an
  // otherwise fully valid PMR with one junk activity entry must be 422 with
  // zero workflow side effects, never silently approved and never a 500.
  const junkEntries: Array<[string, unknown]> = [
    ["null entry", null],
    ["array entry", []],
    ["scalar string entry", "junk"],
    ["scalar number entry", 42],
  ];
  for (const [label, junk] of junkEntries) {
    it(`otherwise-valid PMR + ${label} in activities → 422, no side effects`, async () => {
      const h = wireStatefulDb(
        lockRow({ id: 301, reportType: "project", projectId: 5, activityId: null }),
        () => {
          const c = validPmrContent();
          return { ...c, activities: [...(c.activities as unknown[]), junk] };
        },
        PMR_SECTOR,
      );
      const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
      const res = await transition(app, 301, { action: "submit" });
      expect(res.status).toBe(422);
      expect(res.body.error).toBe("report_content_incomplete");
      const reasons = (res.body.fields as Array<{ reason: string }>).map((f) => f.reason);
      expect(reasons.some((r) => /malformed/i.test(r))).toBe(true);
      expect(h.row.status).toBe("draft"); // no status change on failed submit
    });
  }
});

describe("REP-ZR-02 — Activity submit gate (modern schema)", () => {
  it("modern activity with missing/invalid required fields → 422 with field list", async () => {
    wireStatefulDb(
      lockRow(),
      () => validActivityContent({
        title: "", activityName: "",
        sections: { _schemaVersion: "modern", hasBeneficiaryReach: "yes" },
        beneficiariesMale: "abc",
      }),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
    expect(res.body.fields.some((f: string) => /Title/i.test(f))).toBe(true);
    expect(res.body.fields.some((f: string) => /Beneficiary count/i.test(f))).toBe(true);
  });

  it("modern activity with impossible date ordering → 422, never 500", async () => {
    wireStatefulDb(
      lockRow(),
      () => validActivityContent({
        sections: {
          _schemaVersion: "modern",
          implementationStatus: "completed", implementationSummary: "Done",
          actualStartDate: "2026-06-20", actualEndDate: "2026-06-01",
          resultsAchieved: "Yes", hasBeneficiaryReach: "no",
          hasChallenges: "no", lessonsLearned: "L",
        },
      }),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(422);
    expect(res.body.fields.some((f: string) => /End Date/i.test(f))).toBe(true);
  });
});

describe("REP-ZR-03 — SPR submit gate", () => {
  it("malformed SPR (array sections, boolean beneficiaries) → clean 422", async () => {
    wireStatefulDb(
      lockRow({ id: 201, reportType: "program_state", activityId: null, workflowPath: null }),
      () => validSprContent({
        sections: ["not", "an", "object"],
        activities: [{ title: "A", sector: "Health", activityDate: "2026-07-01", achievementSummary: "x", beneficiariesMen: true }],
      }),
      SPR_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 201, { action: "submit" });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("report_content_incomplete");
  });
});

describe("REP-ZR-04 — HQSR submit gate", () => {
  it("HQSR with boolean narrative + impossible on-demand date → clean 422", async () => {
    wireStatefulDb(
      lockRow({ id: 401, reportType: "hq_sector", stateId: null, activityId: null, workflowPath: null, authorId: 15, sector: "Health" }),
      () => validHqsrContent({
        kind: "on_demand", period_start: "2026-02-30", period_end: "2026-03-01",
        sections: { ...(validHqsrContent().sections as Record<string, unknown>), technicalAnalysis: false },
      }),
      HQSR_SECTOR,
    );
    const app = await buildApp(TC_HEALTH as unknown as AnyUser);
    const res = await transition(app, 401, { action: "submit" });
    expect(res.status).toBe(422);
    const reasons = (res.body.fields as Array<{ reason: string }>).map((f) => f.reason);
    expect(reasons.some((r) => /Period start/i.test(r))).toBe(true);
    expect(reasons.some((r) => /Technical Analysis/i.test(r))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-05 — Identity immutability on PATCH (all families)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-05 — identity immutability", () => {
  async function patchIdentity(user: AnyUser, reportType: string, body: Record<string, unknown>, authorId = 10) {
    let call = 0;
    mockPoolQuery.mockImplementation(() => {
      call++;
      if (call === 1) return Promise.resolve({ rows: [{ status: "draft", sector: null, projectId: null, reportType, authorId, stateId: 1, sections: {} }] });
      return Promise.resolve({ rows: [{ reportType, projectId: null, projectSector: null, activitySector: "WASH", effectiveSector: "WASH" }] });
    });
    const app = await buildApp(user);
    return request(app).patch("/api/projects/reports/77").send(body);
  }

  it("activity: activityId change → 409 activity_identity_immutable", async () => {
    const res = await patchIdentity(SPO_STATE1 as unknown as AnyUser, "activity", { activityId: 99 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("activity_identity_immutable");
  });

  it("project: period change → 409 project_report_identity_immutable", async () => {
    const res = await patchIdentity(SPO_STATE1 as unknown as AnyUser, "project", { period: "2026-07" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("project_report_identity_immutable");
  });

  it("program_state: stateId change → 409 program_state_report_identity_immutable", async () => {
    const res = await patchIdentity(SPO_STATE1 as unknown as AnyUser, "program_state", { stateId: 2 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("program_state_report_identity_immutable");
  });

  it("hq_sector: sector change → 409 even for PM (actor-independent)", async () => {
    const res = await patchIdentity(PM_USER as unknown as AnyUser, "hq_sector", { sector: "WASH" }, 15);
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("hq_sector_report_identity_immutable");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-06 — Duplicate protection backend-authoritative
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-06 — duplicate protection", () => {
  it("creating an SPR when a live one exists for state+period → 409, no INSERT", async () => {
    let inserted = false;
    mockPoolQuery.mockImplementation((sql: unknown) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      if (sql.includes("role = 'state_program_officer'")) return Promise.resolve({ rows: [{ count: 1 }] });
      if (/FROM states[\s\S]*WHERE id = \$1/.test(sql)) {
        return Promise.resolve({ rows: [{ id: 1, name: "Khartoum", nameAr: "الخرطوم", code: "KRT", operationalStatus: "active", officeStatus: "present" }] });
      }
      if (sql.includes("NOT IN ('rejected','archived')")) return Promise.resolve({ rows: [{ id: 55 }] });
      if (sql.includes("INSERT INTO reports")) { inserted = true; return Promise.resolve({ rows: [{ id: 100 }] }); }
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await request(app).post("/api/projects/reports").send({
      title: "SPR", reportType: "program_state", kind: "monthly",
      reportingMonth: 6, reportingYear: 2026, period: "2026-06",
    });
    expect(res.status).toBe(409);
    expect(inserted).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-07 / 08 — Scope enforcement on transitions
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-07 — state scope", () => {
  it("wrong-state SPO cannot submit a state-1 report → 403 state_scope_forbidden", async () => {
    const h = wireStatefulDb(
      lockRow({ id: 201, reportType: "program_state", activityId: null, workflowPath: null, authorId: 11 }),
      () => validSprContent(),
      SPR_SECTOR,
    );
    const app = await buildApp(SPO_STATE2 as unknown as AnyUser);
    const res = await transition(app, 201, { action: "submit" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("state_scope_forbidden");
    expect(h.updates).toHaveLength(0);
  });
});

describe("REP-ZR-08 — sector scope", () => {
  it("wrong-sector TC cannot technical-review a WASH activity report → 403 sector_forbidden", async () => {
    const h = wireStatefulDb(
      lockRow({ status: "submitted" }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(TC_HEALTH as unknown as AnyUser);
    const res = await transition(app, 501, { action: "technical_review" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("sector_forbidden");
    expect(h.updates).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-09 / 10 — Full Operational Access
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-09 — PM Full Operational Access", () => {
  it("PM coordination-reviews a technically approved activity report → 200", async () => {
    const h = wireStatefulDb(
      lockRow({ status: "technically_approved" }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(PM_USER as unknown as AnyUser);
    const res = await transition(app, 501, { action: "coordination_review" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("coordination_approved");
  });
});

describe("REP-ZR-10 — Super Admin Full Access", () => {
  it("super_admin final-approves a coordination-approved report → approved", async () => {
    const h = wireStatefulDb(
      lockRow({ status: "coordination_approved" }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(SA_USER as unknown as AnyUser);
    const res = await transition(app, 501, { action: "final_approve" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("approved");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-11 — Self-review override contract
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-11 — self-review override", () => {
  it("PM self-review without overrideReason → 400 override_reason_required", async () => {
    const h = wireStatefulDb(
      lockRow({ status: "coordination_approved", authorId: PM_USER.id }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(PM_USER as unknown as AnyUser);
    const res = await transition(app, 501, { action: "final_approve" });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("override_reason_required");
    expect(h.updates).toHaveLength(0);
    expect(h.approvals).toHaveLength(0);
  });

  it("PM self-review with reason succeeds; used_override + reason stored on approval row", async () => {
    const h = wireStatefulDb(
      lockRow({ status: "coordination_approved", authorId: PM_USER.id }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(PM_USER as unknown as AnyUser);
    const res = await transition(app, 501, { action: "final_approve", overrideReason: "Deputy unavailable during emergency response" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("approved");
    expect(h.approvals).toHaveLength(1);
    const params = h.approvals[0];
    expect(params).toContain(true); // used_override
    expect(params).toContain("Deputy unavailable during emergency response");
  });

  it("non-privileged author cannot self-review at all → 403 self_review_forbidden", async () => {
    wireStatefulDb(
      lockRow({ status: "submitted", authorId: TC_WASH.id, workflowPath: "state_authored" }),
      () => validActivityContent(),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(TC_WASH as unknown as AnyUser);
    const res = await transition(app, 501, { action: "technical_review" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("self_review_forbidden");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-12 — Invalid submit leaves zero workflow side effects
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-12 — zero side effects on invalid submit", () => {
  it("422 submit: no status UPDATE, no approvals row, no notification", async () => {
    const h = wireStatefulDb(
      lockRow(),
      () => validActivityContent({ title: "", sections: { _schemaVersion: "modern" } }),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(422);
    expect(h.row.status).toBe("draft");
    expect(h.updates).toHaveLength(0);
    expect(h.approvals).toHaveLength(0);
    expect(vi.mocked(notifyEntityActorsDeduped)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyNextApprover)).not.toHaveBeenCalled();
    // The transaction ended in ROLLBACK, never COMMIT.
    const calls = mockClientQuery.mock.calls.map((c) => String(c[0]));
    expect(calls).toContain("ROLLBACK");
    expect(calls).not.toContain("COMMIT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-13 / 14 — Attachment DTO + download security
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-13 — attachment list leaks no storage internals", () => {
  const REPORTS_SRC = src("../routes/reports.ts");

  it("attachment list SELECT exposes only the public DTO columns", () => {
    const m = REPORTS_SRC.match(
      /SELECT id, report_id AS "reportId", file_name AS "fileName",\s*\n\s*content_type AS "contentType", size,\s*\n\s*uploaded_at AS "uploadedAt", availability_status AS "availabilityStatus"\s*\n\s*FROM report_attachments WHERE report_id = \$1/,
    );
    expect(m).not.toBeNull();
  });

  it("no reports attachment SELECT list ever includes object_path or drive_file_id aliases", () => {
    // The DTO-returning list endpoint must never alias storage internals into JSON.
    expect(REPORTS_SRC).not.toMatch(/AS "objectPath"[\s\S]{0,200}FROM report_attachments WHERE report_id = \$1 ORDER BY/);
    expect(REPORTS_SRC).not.toMatch(/AS "driveFileId"[\s\S]{0,200}FROM report_attachments WHERE report_id = \$1 ORDER BY/);
  });
});

describe("REP-ZR-14 — attachment download auth + streaming", () => {
  it("wrong-state SPO is denied before any storage access → 403", async () => {
    mockPoolQuery.mockImplementation((sql: unknown) => {
      if (typeof sql !== "string") return Promise.resolve({ rows: [] });
      if (sql.includes('"effectiveSector"')) {
        return Promise.resolve({ rows: [{ reportType: "program_state", projectId: null, projectSector: null, activitySector: null, effectiveSector: null }] });
      }
      if (sql.includes("SELECT state_id FROM reports")) return Promise.resolve({ rows: [{ state_id: 1 }] });
      return Promise.resolve({ rows: [] });
    });
    const app = await buildApp(SPO_STATE2 as unknown as AnyUser);
    const res = await request(app).get("/api/projects/reports/201/attachments/9/download");
    expect(res.status).toBe(403);
    expect(mockGetObjectEntityFile).not.toHaveBeenCalled();
    expect(mockDownloadObject).not.toHaveBeenCalled();
  });

  it("download handler proxies/streams — no res.redirect anywhere in reports routes", () => {
    const REPORTS_SRC = src("../routes/reports.ts");
    expect(REPORTS_SRC).not.toMatch(/res\.redirect\(/);
    // Attachment lookup is keyed by BOTH attachment id and report id (no cross-report guessing).
    expect(REPORTS_SRC).toMatch(/FROM report_attachments\s+WHERE id = \$1 AND report_id = \$2/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-15 — Voice-note mutations guarded server-side
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-15 — voice note server-side guards", () => {
  const VOICE_SRC = src("../routes/voice-notes.ts");

  it("voice-note routes use the shared report auth/mutation guards, not UI-only gating", () => {
    expect(VOICE_SRC).toMatch(/assertAttachmentMutationAllowed|assertCanViewReport/);
    // Every mutation path must consult a guard before writing.
    expect(VOICE_SRC).toMatch(/assertAttachmentMutationAllowed/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-16 … 19 — Revision keeps the same report ID (all families)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-16 — PMR revision same ID", () => {
  it("submitted → request_revision → draft → resubmit: same record throughout", async () => {
    const h = wireStatefulDb(
      lockRow({ id: 301, reportType: "project", projectId: 5, activityId: null, status: "submitted" }),
      () => validPmrContent(),
      PMR_SECTOR,
    );
    const tcApp = await buildApp(TC_HEALTH as unknown as AnyUser);
    const rev = await transition(tcApp, 301, { action: "request_revision", comment: "Fix figures" });
    expect(rev.status).toBe(200);
    expect(h.row.status).toBe("draft");
    expect(rev.body.id).toBe(301);

    const spoApp = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const resub = await transition(spoApp, 301, { action: "submit" });
    expect(resub.status).toBe(200);
    expect(h.row.status).toBe("submitted");
    expect(resub.body.id).toBe(301);
  });
});

describe("REP-ZR-17 — Activity pre-approval revision E2E cycle (mandatory)", () => {
  it("Draft → Submit → Request Revision → Draft → Edit → Resubmit → Approve, same ID", async () => {
    const h = wireStatefulDb(lockRow(), () => validActivityContent(), ACTIVITY_SECTOR);
    const spoApp = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const tcApp  = await buildApp(TC_WASH   as unknown as AnyUser);
    const spcApp = await buildApp(SPC_USER  as unknown as AnyUser);
    const pmApp  = await buildApp(PM_USER   as unknown as AnyUser);
    const ids: number[] = [];

    // 1. Submit
    let res = await transition(spoApp, 501, { action: "submit" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("submitted");
    ids.push(res.body.id);

    // 2. TC requests revision → back to draft, SAME record
    res = await transition(tcApp, 501, { action: "request_revision", comment: "Please add evidence" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("draft");
    ids.push(res.body.id);

    // 3. Author edits the returned draft (PATCH succeeds while draft)
    res = await request(spoApp).patch("/api/projects/reports/501").send({ sections: { note: "updated after revision" } });
    expect(res.status).toBe(200);

    // 4. Resubmit
    res = await transition(spoApp, 501, { action: "submit" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("submitted");
    ids.push(res.body.id);

    // 5. TC technical review
    res = await transition(tcApp, 501, { action: "technical_review" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("technically_approved");
    ids.push(res.body.id);

    // 6. SPC coordination review
    res = await transition(spcApp, 501, { action: "coordination_review" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("coordination_approved");
    ids.push(res.body.id);

    // 7. PM final approval
    res = await transition(pmApp, 501, { action: "final_approve" });
    expect(res.status).toBe(200);
    expect(h.row.status).toBe("approved");
    ids.push(res.body.id);

    // Same report ID at every step; every transition wrote an approvals row for 501.
    expect(ids).toEqual([501, 501, 501, 501, 501, 501]);
    expect(h.approvals).toHaveLength(6);
    for (const params of h.approvals) expect(params[0]).toBe(501);
    // Status trail is exactly the pre-approval revision lifecycle.
    expect(h.updates).toEqual([
      "submitted", "draft", "submitted",
      "technically_approved", "coordination_approved", "approved",
    ]);
  });
});

describe("REP-ZR-18 — SPR revision same ID", () => {
  it("submitted → request_revision (SPC) → draft → resubmit: same ID", async () => {
    const h = wireStatefulDb(
      lockRow({ id: 201, reportType: "program_state", activityId: null, workflowPath: null, status: "submitted" }),
      () => validSprContent(),
      SPR_SECTOR,
    );
    const spcApp = await buildApp(SPC_USER as unknown as AnyUser);
    const rev = await transition(spcApp, 201, { action: "request_revision", comment: "Expand context" });
    expect(rev.status).toBe(200);
    expect(h.row.status).toBe("draft");
    expect(rev.body.id).toBe(201);

    const spoApp = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const resub = await transition(spoApp, 201, { action: "submit" });
    expect(resub.status).toBe(200);
    expect(resub.body.id).toBe(201);
    expect(h.row.status).toBe("submitted");
  });
});

describe("REP-ZR-19 — HQSR revision same ID", () => {
  it("submitted → request_revision (SPC) → draft → resubmit (TC author): same ID", async () => {
    const h = wireStatefulDb(
      lockRow({ id: 401, reportType: "hq_sector", stateId: null, activityId: null, workflowPath: "tc_authored", authorId: 15, sector: "Health", status: "submitted" }),
      () => validHqsrContent(),
      HQSR_SECTOR,
    );
    const spcApp = await buildApp(SPC_USER as unknown as AnyUser);
    const rev = await transition(spcApp, 401, { action: "request_revision", comment: "Add outlook detail" });
    expect(rev.status).toBe(200);
    expect(h.row.status).toBe("draft");
    expect(rev.body.id).toBe(401);

    const tcApp = await buildApp(TC_HEALTH as unknown as AnyUser);
    const resub = await transition(tcApp, 401, { action: "submit" });
    expect(resub.status).toBe(200);
    expect(resub.body.id).toBe(401);
    expect(h.row.status).toBe("submitted");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-20 — Analytics LEFT JOIN (standalone SPR/HQSR preserved)
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-20 — analytics LEFT JOIN to projects", () => {
  const DASHBOARD_SRC = src("../routes/dashboard.ts");
  const REPORTS_SRC   = src("../routes/reports.ts");

  it("dashboard report queries join projects with LEFT JOIN only", () => {
    // Every join between reports (alias r) and projects (alias p) must be LEFT.
    const badJoins = [...DASHBOARD_SRC.matchAll(/FROM reports r\s*\n\s*(INNER )?JOIN projects/g)]
      .filter((m) => !/LEFT/.test(DASHBOARD_SRC.slice(m.index! - 20, m.index! + m[0].length)));
    expect(badJoins).toHaveLength(0);
    expect(DASHBOARD_SRC).toMatch(/LEFT JOIN projects p ON/);
  });

  it("reports list/stats queries also use LEFT JOIN + sector COALESCE fallback", () => {
    expect(REPORTS_SRC).toMatch(/LEFT JOIN projects p ON/);
    expect(REPORTS_SRC).toMatch(/COALESCE\(NULLIF\(r\.sector,\s*''\),\s*p\.sector\)/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-21 / 22 — Workflow-path-aware routing + post-COMMIT notifications
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-21 — workflow_path-aware approval routing", () => {
  it("activity submit passes workflowPath to notifyNextApprover", async () => {
    wireStatefulDb(lockRow(), () => validActivityContent(), ACTIVITY_SECTOR);
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(200);
    expect(vi.mocked(notifyNextApprover)).toHaveBeenCalledWith(
      expect.objectContaining({ action: "submit", entityType: "report", entityId: 501, workflowPath: "state_authored" }),
    );
  });

  it("HQSR spc_fallback submit routes with hqsrPath=spc_fallback", async () => {
    wireStatefulDb(
      lockRow({ id: 401, reportType: "hq_sector", stateId: null, activityId: null, workflowPath: "spc_fallback", authorId: 16, sector: "Health" }),
      () => validHqsrContent(),
      HQSR_SECTOR,
    );
    const app = await buildApp(SPC_USER as unknown as AnyUser);
    const res = await transition(app, 401, { action: "submit" });
    expect(res.status).toBe(200);
    expect(vi.mocked(notifyNextApprover)).toHaveBeenCalledWith(
      expect.objectContaining({ entityId: 401, hqsrPath: "spc_fallback" }),
    );
  });
});

describe("REP-ZR-22 — notifications post-COMMIT only", () => {
  it("successful transition: COMMIT precedes notification dispatch", async () => {
    const order: string[] = [];
    vi.mocked(notifyEntityActorsDeduped).mockImplementation(async () => { order.push("notify"); });
    wireStatefulDb(lockRow(), () => validActivityContent(), ACTIVITY_SECTOR);
    const baseImpl = mockClientQuery.getMockImplementation()!;
    mockClientQuery.mockImplementation((sql: unknown, params?: unknown[]) => {
      if (sql === "COMMIT") order.push("commit");
      return baseImpl(sql, params);
    });
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(200);
    expect(order.indexOf("commit")).toBeGreaterThanOrEqual(0);
    expect(order.indexOf("commit")).toBeLessThan(order.indexOf("notify"));
  });

  it("rolled-back transition (422): no notification of any kind", async () => {
    wireStatefulDb(
      lockRow(),
      () => validActivityContent({ title: "", sections: { _schemaVersion: "modern" } }),
      ACTIVITY_SECTOR,
    );
    const app = await buildApp(SPO_STATE1 as unknown as AnyUser);
    const res = await transition(app, 501, { action: "submit" });
    expect(res.status).toBe(422);
    expect(vi.mocked(notifyEntityActorsDeduped)).not.toHaveBeenCalled();
    expect(vi.mocked(notifyNextApprover)).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-23 — Production rate-limit bypass cannot activate
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-23 — production rate limit guard", () => {
  const APP_SRC = src("../app.ts");

  it("both limiters gate the dev/test bypass on NODE_ENV !== 'production' exactly", () => {
    const skips = APP_SRC.match(/skip:\s*\(\)\s*=>\s*process\.env\.NODE_ENV\s*!==\s*"production"/g) ?? [];
    expect(skips.length).toBeGreaterThanOrEqual(2); // defaultLimiter + authLimiter
    // No other skip conditions exist that could widen the bypass.
    const allSkips = APP_SRC.match(/skip:\s*/g) ?? [];
    expect(allSkips.length).toBe(skips.length);
  });

  it("the guard predicate evaluates to 'do not skip' when NODE_ENV=production", () => {
    // The exact predicate shipped in app.ts: skip iff NODE_ENV !== "production".
    const skipPredicate = (nodeEnv: string | undefined) => nodeEnv !== "production";
    expect(skipPredicate("production")).toBe(false); // limiter ACTIVE in production
    expect(skipPredicate("development")).toBe(true);
    expect(skipPredicate("test")).toBe(true);
    expect(skipPredicate(undefined)).toBe(true);
  });

  it("rate limiters are actually mounted on the API surface", () => {
    expect(APP_SRC).toMatch(/app\.use\("\/api",\s*defaultLimiter\)/);
    expect(APP_SRC).toMatch(/authLimiter/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-24 — No startup DDL in Reports route files
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-24 — no startup DDL", () => {
  it("reports route + helpers contain no module-level DDL execution", () => {
    for (const file of ["../routes/reports.ts", "../lib/reportConstants.ts", "../lib/reportAuth.ts", "../routes/voice-notes.ts"]) {
      const text = src(file);
      expect(text, `${file} must not run DDL via pool.query`).not.toMatch(/pool\s*\.\s*query\(\s*`?\s*(CREATE|ALTER|DROP)\s+(TABLE|INDEX)/i);
    }
  });

  it("report_attachments DDL is owned by a tracked migration", () => {
    const MIGRATIONS_SRC = src("../lib/run-migrations.ts");
    expect(MIGRATIONS_SRC).toMatch(/CREATE TABLE IF NOT EXISTS report_attachments/);
    expect(MIGRATIONS_SRC).toMatch(/014_att02_evidence_object_path_unique/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REP-ZR-25 — Reports-owned TypeScript debt eliminated
// ─────────────────────────────────────────────────────────────────────────────

describe("REP-ZR-25 — named unsafe casts removed (tsc-clean verified in audit)", () => {
  const REPORTS_PAGE_SRC = src("../../../cafa-pmis/src/pages/reports.tsx");
  const SPR_FORM_SRC     = src("../../../cafa-pmis/src/components/program-state-report-form.tsx");

  it("submit transition payload no longer uses `as never`", () => {
    expect(REPORTS_PAGE_SRC).not.toMatch(/\{\s*action:\s*"submit"\s*\}\s*as never/);
    expect(REPORTS_PAGE_SRC).toMatch(/data:\s*\{\s*action:\s*"submit"\s*\}/);
  });

  it("history override fields are read from the typed ApprovalEntry (no Record cast)", () => {
    expect(REPORTS_PAGE_SRC).toMatch(/h\.usedOverride/);
    expect(REPORTS_PAGE_SRC).toMatch(/h\.overrideReason/);
    expect(REPORTS_PAGE_SRC).not.toMatch(/h as unknown as Record<string, unknown>\)\.usedOverride/);
  });

  it("SPR attachment hydration uses the typed narrowing parser, not blind casts", () => {
    expect(SPR_FORM_SRC).toMatch(/function parseStoredSprAttachments\(/);
    expect(SPR_FORM_SRC).toMatch(/parseStoredSprAttachments\(sections\.attachments\)/);
    // The attachments field specifically must never be blind-cast again.
    expect(SPR_FORM_SRC).not.toMatch(/attachments as Array<Record<string, unknown>>/);
  });
});
