import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import {
  DEVELOPMENT_TEST_RETIREMENT_TARGET,
  isExactDevelopmentTestRetirementTarget,
} from "../lib/developmentTestRetirement";

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockConnect = vi.fn();
const mockClient = { query: mockClientQuery, release: vi.fn() };

vi.mock("@workspace/db", () => ({
  pool: { query: mockQuery, connect: mockConnect },
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

const SUPER_ADMIN = {
  id: 1, name: "Super Admin", email: "admin@cafa.org", role: "super_admin",
  roleLabel: "Super Admin", scope: "hq", stateId: null, stateName: null,
  sector: null, sectors: null, avatarUrl: null,
};
const TECHNICAL_COORDINATOR = {
  ...SUPER_ADMIN, id: 2, name: "Technical Coordinator", email: "tc@cafa.org",
  role: "technical_coordinator", roleLabel: "Technical Coordinator",
};

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
    res.status(500).json({ error: "internal", message: err.message });
  });
  return app;
}

function reviewedFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 19,
    code: "CAFA-MPLQLM3M",
    title: "TX Test",
    status: "submitted",
    donor: "Test",
    donor_id: null,
    deleted_at: null,
    ...overrides,
  };
}

function primeRetirement(project = reviewedFixture()) {
  mockClientQuery.mockImplementation((sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return Promise.resolve({ rows: [] });
    if (sql.includes("FROM projects") && sql.includes("FOR UPDATE")) return Promise.resolve({ rows: [project] });
    if (sql.includes("INSERT INTO audit_log")) return Promise.resolve({ rows: [], rowCount: 1 });
    if (sql.includes("UPDATE projects")) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  mockQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue(mockClient);
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe("development test project retirement", () => {
  it("uses an exact, non-classifier provenance allowlist", () => {
    expect(isExactDevelopmentTestRetirementTarget(DEVELOPMENT_TEST_RETIREMENT_TARGET)).toBe(true);
    expect(isExactDevelopmentTestRetirementTarget({ ...DEVELOPMENT_TEST_RETIREMENT_TARGET, title: "Test" })).toBe(false);
    expect(isExactDevelopmentTestRetirementTarget({ ...DEVELOPMENT_TEST_RETIREMENT_TARGET, id: 68 })).toBe(false);
  });

  it("fails closed outside development before opening a transaction", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const app = await buildApp(SUPER_ADMIN);
    const res = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "Retire verified historical development test data.", confirmationCode: "CAFA-MPLQLM3M" });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("development_only");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("requires the existing project-delete permission", async () => {
    const app = await buildApp(TECHNICAL_COORDINATOR);
    const res = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "Retire verified historical development test data.", confirmationCode: "CAFA-MPLQLM3M" });

    expect(res.status).toBe(403);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("soft-retires only the exact submitted fixture, preserves child records, and writes the cleanup audit", async () => {
    primeRetirement();
    const app = await buildApp(SUPER_ADMIN);
    const reason = "Verified historical development test data; retire safely.";
    const res = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason, confirmationCode: "CAFA-MPLQLM3M" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projectId: 19,
      projectCode: "CAFA-MPLQLM3M",
      retirement: "development test-data cleanup",
      deletionMode: "soft",
    });
    const updateCall = mockClientQuery.mock.calls.find((call) => String(call[0]).includes("UPDATE projects"));
    expect(updateCall?.[0]).toContain("SET deleted_at = $1, deleted_by = $2, deletion_reason = $3, deletion_mode = 'soft'");
    expect(updateCall?.[0]).not.toContain("status =");
    expect(updateCall?.[0]).not.toContain("donor =");
    expect(mockClientQuery.mock.calls.some((call) => /^DELETE\s/i.test(String(call[0]).trim()))).toBe(false);

    const auditCall = mockClientQuery.mock.calls.find((call) => String(call[0]).includes("INSERT INTO audit_log"));
    expect(auditCall?.[1]?.[0]).toBe(SUPER_ADMIN.id);
    expect(auditCall?.[1]?.[1]).toBe(19);
    expect(JSON.parse(String(auditCall?.[1]?.[2]))).toMatchObject({
      id: 19, code: "CAFA-MPLQLM3M", title: "TX Test", status: "submitted", donor: "Test", donorId: null,
    });
    expect(JSON.parse(String(auditCall?.[1]?.[3]))).toMatchObject({
      retirement: "development test-data cleanup",
      deletionMode: "soft",
      deletedBy: SUPER_ADMIN.id,
      reason,
    });
    const operations = mockClientQuery.mock.calls.map((call) => String(call[0]));
    expect(operations.indexOf("BEGIN")).toBeLessThan(operations.findIndex((sql) => sql.includes("UPDATE projects")));
    expect(operations.findIndex((sql) => sql.includes("INSERT INTO audit_log"))).toBeLessThan(operations.indexOf("COMMIT"));
  });

  it("rejects missing reasons, identity mismatches, and lifecycle changes without retiring anything", async () => {
    const app = await buildApp(SUPER_ADMIN);
    const noReason = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "  ", confirmationCode: "CAFA-MPLQLM3M" });
    expect(noReason.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();

    const noConfirmation = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "Retire verified historical development test data.", confirmationCode: "wrong-code" });
    expect(noConfirmation.status).toBe(400);
    expect(noConfirmation.body.error).toBe("retirement_confirmation_required");
    expect(mockConnect).not.toHaveBeenCalled();

    primeRetirement(reviewedFixture({ title: "Different project" }));
    const identityMismatch = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "Retire verified historical development test data.", confirmationCode: "CAFA-MPLQLM3M" });
    expect(identityMismatch.status).toBe(409);
    expect(identityMismatch.body.error).toBe("development_fixture_identity_mismatch");
    expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("UPDATE projects"))).toBe(false);

    mockClientQuery.mockClear();
    primeRetirement(reviewedFixture({ status: "approved" }));
    const lifecycleMismatch = await request(app)
      .post("/api/projects/19/development-test-retirement")
      .send({ reason: "Retire verified historical development test data.", confirmationCode: "CAFA-MPLQLM3M" });
    expect(lifecycleMismatch.status).toBe(409);
    expect(lifecycleMismatch.body.error).toBe("development_fixture_lifecycle_mismatch");
    expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("UPDATE projects"))).toBe(false);
  });

  it("blocks the ordinary delete endpoint and deletion-info response for the exact fixture", async () => {
    primeRetirement();
    const app = await buildApp(SUPER_ADMIN);
    const deletion = await request(app)
      .delete("/api/projects/19")
      .send({ reason: "Retire verified historical development test data." });

    expect(deletion.status).toBe(409);
    expect(deletion.body.error).toBe("development_fixture_retirement_required");
    expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("INSERT INTO audit_log"))).toBe(false);
    expect(mockClientQuery.mock.calls.some((call) => /^DELETE\s/i.test(String(call[0]).trim()))).toBe(false);
    expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("UPDATE projects"))).toBe(false);

    mockQuery.mockResolvedValueOnce({
      rows: [{
        ...reviewedFixture(),
        sector: "WASH",
        sectors: [],
      }],
    });
    const deletionInfo = await request(app).get("/api/projects/19/deletion-info");
    expect(deletionInfo.status).toBe(200);
    expect(deletionInfo.body).toEqual({
      canDelete: false,
      mode: null,
      reason: "development_fixture_retirement_required",
    });
  });
});