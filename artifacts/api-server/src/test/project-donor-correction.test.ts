import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";

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
const PROGRAM_MANAGER = {
  ...SUPER_ADMIN, id: 2, name: "Programme Manager", email: "pm@cafa.org",
  role: "program_manager", roleLabel: "Programme Manager",
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

function correctionProject(overrides: Record<string, unknown> = {}) {
  return {
    id: 19,
    code: "CAFA-MPLQLM3M",
    status: "submitted",
    donor: "Test",
    donor_id: null,
    donor_registry_name: null,
    ...overrides,
  };
}

function primeCorrection(opts: {
  project?: Record<string, unknown>;
  replacement?: { id: number; name: string } | null;
}) {
  const project = correctionProject(opts.project);
  mockClientQuery.mockImplementation((sql: string) => {
    if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return Promise.resolve({ rows: [] });
    if (sql.includes("FOR UPDATE OF p")) return Promise.resolve({ rows: [project] });
    if (sql.includes("SELECT id, name FROM donors")) return Promise.resolve({ rows: opts.replacement ? [opts.replacement] : [] });
    if (sql.includes("UPDATE projects")) {
      return Promise.resolve({
        rows: [{ id: project.id, code: project.code, status: project.status, donor: opts.replacement?.name ?? "Unknown", donor_id: opts.replacement?.id ?? null }],
      });
    }
    if (sql.includes("INSERT INTO audit_log")) return Promise.resolve({ rows: [], rowCount: 1 });
    return Promise.resolve({ rows: [] });
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockResolvedValue({ rows: [] });
  mockConnect.mockResolvedValue(mockClient);
  mockClientQuery.mockResolvedValue({ rows: [] });
});

describe("project donor correction", () => {
  it("allows only a super administrator to access the correction path", async () => {
    const app = await buildApp(PROGRAM_MANAGER);
    const res = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: 5, reason: "Confirmed placeholder in the submitted record." });

    expect(res.status).toBe(403);
    expect(res.body.requiredPermission).toBe("projects.donor.correct");
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("changes only donor fields, preserves submitted status, and writes a complete in-transaction audit entry", async () => {
    primeCorrection({ replacement: { id: 5, name: "UNICEF" } });
    const app = await buildApp(SUPER_ADMIN);

    const res = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: 5, reason: "Registry review confirmed UNICEF as the donor." });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      projectId: 19, projectCode: "CAFA-MPLQLM3M", status: "submitted", donor: "UNICEF", donorId: 5,
    });
    const updateCall = mockClientQuery.mock.calls.find((call) => String(call[0]).includes("UPDATE projects"));
    expect(updateCall?.[0]).toContain("SET donor = $1, donor_id = $2, updated_at = NOW()");
    expect(updateCall?.[0]).not.toContain("SET status");
    expect(updateCall?.[1]).toEqual(["UNICEF", 5, 19]);
    const auditCall = mockClientQuery.mock.calls.find((call) => String(call[0]).includes("INSERT INTO audit_log"));
    expect(auditCall?.[1]?.[0]).toBe(SUPER_ADMIN.id);
    expect(auditCall?.[1]?.[1]).toBe(19);
    expect(JSON.parse(String(auditCall?.[1]?.[2]))).toEqual({
      donor: "Test", donorId: null, provenance: "unlinked_free_text",
    });
    expect(JSON.parse(String(auditCall?.[1]?.[3]))).toMatchObject({
      donor: "UNICEF", donorId: 5, reason: "Registry review confirmed UNICEF as the donor.",
    });
    const operations = mockClientQuery.mock.calls.map((call) => String(call[0]));
    expect(operations.indexOf("BEGIN")).toBeLessThan(operations.findIndex((sql) => sql.includes("UPDATE projects")));
    expect(operations.findIndex((sql) => sql.includes("INSERT INTO audit_log"))).toBeLessThan(operations.indexOf("COMMIT"));
  });

  it("allows the explicit Unknown state but never guesses a replacement", async () => {
    primeCorrection({ replacement: null });
    const app = await buildApp(SUPER_ADMIN);

    const res = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: null, reason: "No verified registered donor is available." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: "submitted", donor: "Unknown", donorId: null });
    const updateCall = mockClientQuery.mock.calls.find((call) => String(call[0]).includes("UPDATE projects"));
    expect(updateCall?.[1]).toEqual(["Unknown", null, 19]);
  });

  it("requires a reason and rejects unknown or placeholder replacement donors", async () => {
    const app = await buildApp(SUPER_ADMIN);
    const missingReason = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: 5, reason: "   " });
    expect(missingReason.status).toBe(400);
    expect(mockClientQuery).not.toHaveBeenCalledWith("BEGIN");

    primeCorrection({ replacement: null });
    const missingDonor = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: 99, reason: "Registry review." });
    expect(missingDonor.status).toBe(422);
    expect(missingDonor.body.error).toBe("invalid_donor_id");

    primeCorrection({ replacement: { id: 8, name: "TBD" } });
    const placeholderDonor = await request(app)
      .post("/api/projects/19/donor-correction")
      .send({ donorId: 8, reason: "Registry review." });
    expect(placeholderDonor.status).toBe(422);
    expect(placeholderDonor.body).toMatchObject({ error: "placeholder_donor", field: "donorId" });
    expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("UPDATE projects"))).toBe(false);
  });

  it("rejects non-placeholder, linked, and invalid-lifecycle targets without changing data", async () => {
    const cases = [
      correctionProject({ donor: "UNICEF" }),
      correctionProject({ donor_id: 5, donor_registry_name: "UNICEF" }),
      correctionProject({ donor: "Unknown" }),
      correctionProject({ status: "draft" }),
    ];
    for (const project of cases) {
      primeCorrection({ project, replacement: { id: 5, name: "UNICEF" } });
      const app = await buildApp(SUPER_ADMIN);
      const res = await request(app)
        .post("/api/projects/19/donor-correction")
        .send({ donorId: 5, reason: "Registry review." });
      expect(res.status).toBe(409);
      expect(mockClientQuery.mock.calls.some((call) => String(call[0]).includes("UPDATE projects"))).toBe(false);
      mockClientQuery.mockClear();
    }
  });

  it("returns only confirmed placeholders from the focused scan and keeps explicit Unknown separate", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        { id: 19, code: "CAFA-MPLQLM3M", title: "Legacy", status: "submitted", donor: "Test", donor_id: null, donor_registry_name: null, budget_total: "0", currency: "USD" },
        { id: 20, code: "CAFA-20", title: "Unknown", status: "approved", donor: "Unknown", donor_id: null, donor_registry_name: null, budget_total: "0", currency: "USD" },
        { id: 21, code: "CAFA-21", title: "WFP", status: "active", donor: "WFP", donor_id: null, donor_registry_name: null, budget_total: "0", currency: "USD" },
      ],
    });
    const app = await buildApp(SUPER_ADMIN);
    const res = await request(app).get("/api/projects/donor-integrity-scan");

    expect(res.status).toBe(200);
    expect(res.body.confirmedPlaceholders).toEqual([
      expect.objectContaining({ id: 19, donor: "Test", classification: "confirmed_placeholder" }),
    ]);
    expect(res.body.explicitMissingDonors).toEqual([
      expect.objectContaining({ id: 20, donor: "Unknown", classification: "explicit_missing_donor" }),
    ]);
  });
});