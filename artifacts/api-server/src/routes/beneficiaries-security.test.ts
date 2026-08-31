import express, { type NextFunction, type Request, type Response } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPoolQuery, mockLogAudit } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
// Keep the real requirePerm/permissionsFor/hasPerm implementation — only the
// DB-writing logAudit side effect is replaced. The permission gate under test
// lives in this module, so it must not be stubbed away.
vi.mock("../middlewares/currentUser.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../middlewares/currentUser")>();
  return { ...actual, logAudit: mockLogAudit };
});

const beneficiariesRouter = (await import("./beneficiaries")).default;

function appFor(user: { id: number; role: string; stateId: number | null }) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = {
      id: user.id,
      name: "Test User",
      email: "test@example.test",
      role: user.role,
      roleLabel: user.role,
      scope: user.stateId ? "state" : "hq",
      stateId: user.stateId,
      stateName: null,
      sector: null,
      avatarUrl: null,
      sectors: null,
    } as NonNullable<Request["currentUser"]>;
    next();
  });
  app.use(beneficiariesRouter);
  return app;
}

const validBody = {
  name: "Test Beneficiary",
  gender: "female",
  ageGroup: "adult",
  category: "idp",
  stateId: 99,
};

describe("POST /beneficiaries authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a role without beneficiaries.create before touching the database", async () => {
    const app = appFor({ id: 1, role: "viewer", stateId: null });

    const response = await request(app).post("/beneficiaries").send(validBody);

    expect(response.status).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("clamps a state_program_officer's beneficiary to their own state, ignoring a mismatched body.stateId", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 1, code: "BEN-1", stateId: 5 }] });
    const app = appFor({ id: 2, role: "state_program_officer", stateId: 5 });

    const response = await request(app).post("/beneficiaries").send({ ...validBody, stateId: 99 });

    expect(response.status).toBe(201);
    const [, values] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    // state_id is the 7th bound parameter in the INSERT column list.
    expect(values[6]).toBe(5);
    expect(values[6]).not.toBe(99);
  });

  it("denies a state_program_officer with no configured state assignment", async () => {
    const app = appFor({ id: 3, role: "state_program_officer", stateId: null });

    const response = await request(app).post("/beneficiaries").send(validBody);

    expect(response.status).toBe(403);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("lets an HQ-scoped super_admin attribute a beneficiary to any state", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ id: 4, code: "BEN-2", stateId: 42 }] });
    const app = appFor({ id: 4, role: "super_admin", stateId: null });

    const response = await request(app).post("/beneficiaries").send({ ...validBody, stateId: 42 });

    expect(response.status).toBe(201);
    const [, values] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
    expect(values[6]).toBe(42);
  });
});
