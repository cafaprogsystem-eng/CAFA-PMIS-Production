/**
 * USERS-PATCH-AUTHORIZATION-CHANGED — PATCH /users/:id marked *every* edit as
 * an authorization change, even a plain name/phone update, because the
 * role→sector/state_id reconciliation block runs unconditionally (next_.sector
 * is always set to either the recomputed TC sector or an explicit null; a
 * non-state role always forces next_.state_id to null), so
 * `["role","scope","state_id","sector","status"].some(key => key in next_)`
 * was true for effectively every request. A super_admin editing just a
 * colleague's phone number triggered the same publishAuthorizationChanged
 * realtime broadcast (forces the target's client to treat it as a real
 * permission change) as an actual role change would.
 *
 * authorizationChanged now compares the final derived value against what
 * actually existed before, for each of the five fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const mockPoolQuery = vi.fn();
const mockPublishSupportingEvent = vi.fn().mockResolvedValue(undefined);
const mockPublishAuthorizationChanged = vi.fn().mockResolvedValue(undefined);

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/realtime", () => ({
  realtime: {
    publishSupportingEvent: mockPublishSupportingEvent,
    publishAuthorizationChanged: mockPublishAuthorizationChanged,
    disconnectUser: vi.fn(),
    isUserOnline: vi.fn().mockReturnValue(false),
  },
}));
vi.mock("../../lib/mailer", () => ({
  sendEmail: vi.fn().mockResolvedValue({ delivered: true, status: "sent" }),
  renderInviteEmail: vi.fn(),
  renderAccountActivatedEmail: vi.fn(),
  renderAccountSuspendedEmail: vi.fn(),
  renderAccountDeactivatedEmail: vi.fn(),
}));
vi.mock("../../lib/state-master", () => ({
  assertActiveState: vi.fn().mockResolvedValue({ ok: true, state: { id: 1, name: "Khartoum" } }),
}));
vi.mock("../../lib/session", () => ({ revokeAllSessionsForUser: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../../middlewares/currentUser", () => ({
  requirePerm: () => (_req: Request, _res: Response, next: NextFunction) => next(),
  logAudit: vi.fn().mockResolvedValue(undefined),
}));

const { default: usersRouter } = await import("../users");

const ACTOR = { id: 1, name: "Admin", role: "super_admin" };
const EXISTING_USER = {
  id: 42, name: "Colleague", email: "colleague@example.com", username: "colleague",
  phone: "0000", role: "program_manager", scope: "hq", state_id: null, sector: null,
  status: "active", role_label: "Program Manager",
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.currentUser = ACTOR as Request["currentUser"]; next(); });
  app.use(usersRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPublishSupportingEvent.mockClear();
  mockPublishAuthorizationChanged.mockClear();
  mockPoolQuery.mockImplementation((sql: string) => {
    if (sql.includes("SELECT * FROM users WHERE id")) return { rows: [{ ...EXISTING_USER }] };
    if (sql.includes("UPDATE users SET")) return { rows: [], rowCount: 1 };
    if (sql.includes("SELECT id FROM users WHERE LOWER")) return { rows: [] };
    if (sql.includes("FROM users u LEFT JOIN states s")) return { rows: [{ id: 42, name: "Colleague" }] };
    return { rows: [] };
  });
});

describe("USERS-PATCH-AUTHORIZATION-CHANGED: a plain profile edit is not treated as a permission change", () => {
  it("editing only the phone number does not call publishAuthorizationChanged", async () => {
    const res = await supertest(makeApp()).patch("/users/42").send({ phone: "1234567890" });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).not.toHaveBeenCalled();
    expect(mockPublishSupportingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: "user", entityId: 42, action: "updated" }),
    );
  });

  it("editing only the name does not call publishAuthorizationChanged", async () => {
    const res = await supertest(makeApp()).patch("/users/42").send({ name: "New Name" });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).not.toHaveBeenCalled();
  });
});

describe("USERS-PATCH-AUTHORIZATION-CHANGED: a real permission change still triggers the broadcast", () => {
  it("changing role calls publishAuthorizationChanged", async () => {
    const res = await supertest(makeApp()).patch("/users/42").send({ role: "senior_program_coordinator" });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).toHaveBeenCalledWith(42);
  });

  it("changing status calls publishAuthorizationChanged", async () => {
    const res = await supertest(makeApp()).patch("/users/42").send({ status: "suspended" });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).toHaveBeenCalledWith(42);
  });

  it("changing stateId calls publishAuthorizationChanged", async () => {
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("SELECT * FROM users WHERE id")) {
        return { rows: [{ ...EXISTING_USER, role: "state_program_officer", scope: "state", state_id: 1 }] };
      }
      if (sql.includes("UPDATE users SET")) return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT name FROM states")) return { rows: [{ name: "Kassala" }] };
      if (sql.includes("FROM users u LEFT JOIN states s")) return { rows: [{ id: 42, name: "Colleague" }] };
      return { rows: [] };
    });
    const res = await supertest(makeApp()).patch("/users/42").send({ stateId: 2 });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).toHaveBeenCalledWith(42);
  });

  it("changing role to technical_coordinator (which also sets sector) calls publishAuthorizationChanged", async () => {
    const res = await supertest(makeApp())
      .patch("/users/42")
      .send({ role: "technical_coordinator", sector: "Health" });
    expect(res.status).toBe(200);
    expect(mockPublishAuthorizationChanged).toHaveBeenCalledWith(42);
  });
});
