/**
 * STATE-SEC / STATE-FUNC sentinels for State Administration.
 *
 * The State route is intentionally self-contained: it never mutates users,
 * never changes State IDs, and exposes no delete/archive lifecycle.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, beforeEach, vi } from "vitest";
import express from "express";
import request from "supertest";

const { mockQuery, mockLogAudit } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
  mockLogAudit: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));
vi.mock("../middlewares/currentUser", () => ({ logAudit: mockLogAudit }));

import statesRouter from "./states";
import { SUDAN_STATES } from "../lib/state-master";

function appFor(role: string, stateId: number | null = null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.currentUser = {
      id: 17,
      name: "Test user",
      email: "test@example.test",
      role,
      roleLabel: role,
      scope: "hq",
      stateId,
      stateName: null,
      sector: null,
      avatarUrl: null,
      sectors: null,
    };
    next();
  });
  app.use(statesRouter);
  return app;
}

describe("States Administration closure", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockLogAudit.mockReset();
    mockLogAudit.mockResolvedValue(undefined);
  });

  it("STATE-SEC-01 rejects guessed-ID and create mutations for authenticated non-administrators", async () => {
    const app = appFor("state_program_officer");
    const create = await request(app).post("/states").send({ name: "North", code: "NO" });
    const update = await request(app).patch("/states/999").send({ name: "North", code: "NO" });

    expect(create.status).toBe(403);
    expect(create.body.error).toBe("state_registry_forbidden");
    expect(update.status).toBe(403);
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("STATE-SEC-02 deterministically rejects malformed direct IDs before querying or auditing", async () => {
    const response = await request(appFor("program_manager"))
      .patch("/states/not-a-number")
      .send({ name: "North", code: "NO" });

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: "invalid_state_id" });
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("STATE-FUNC-01 normalises State input, preserves the generated numeric ID, and audits only after success", async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 41, name: "Northern State", nameAr: "الولاية الشمالية", code: "NOR", officeAddress: "Main Office" }],
    });

    const response = await request(appFor("executive_director"))
      .post("/states")
      .send({ name: "  Northern State  ", nameAr: " الولاية الشمالية ", code: " NOR ", officeAddress: " Main\nOffice " });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ id: 41, name: "Northern State", code: "NOR", officeAddress: "Main Office" });
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO states"), ["Northern State", "الولاية الشمالية", "NOR", "Main Office"]);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "create",
      module: "states",
      entityId: 41,
    }));
  });

  it("STATE-FUNC-02 maps concurrent normalised duplicate conflicts safely and never audits a rejected write", async () => {
    mockQuery.mockRejectedValueOnce({ code: "23505" });

    const response = await request(appFor("program_manager"))
      .post("/states")
      .send({ name: " Northern State ", nameAr: " الولاية الشمالية ", code: "NOR" });

    expect(response.status).toBe(409);
    expect(response.body).toEqual({ error: "state_identity_conflict" });
    expect(mockLogAudit).not.toHaveBeenCalled();
  });

  it("STATE-FUNC-03 rejects invalid input before the database and does not offer a State delete lifecycle", async () => {
    const response = await request(appFor("super_admin"))
      .post("/states")
      .send({ name: " ", code: "" });
    const deleted = await request(appFor("super_admin")).delete("/states/1");
    const routeSource = readFileSync(new URL("./states.ts", import.meta.url), "utf8");

    expect(response.status).toBe(422);
    expect(response.body.error).toBe("validation_failed");
    expect(mockQuery).not.toHaveBeenCalled();
    expect(mockLogAudit).not.toHaveBeenCalled();
    expect(deleted.status).toBe(404);
    expect(routeSource).not.toContain('router.delete("/states');
  });

  it("STATE-SEC-03 rejects malformed and non-existent snapshot State IDs instead of returning fabricated empty data", async () => {
    const malformed = await request(appFor("program_manager")).get("/states/not-an-id/snapshot");
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const missing = await request(appFor("program_manager")).get("/states/987654/snapshot");

    expect(malformed.status).toBe(422);
    expect(malformed.body).toEqual({ error: "invalid_state_id" });
    expect(missing.status).toBe(404);
    expect(missing.body).toEqual({ error: "state not found" });
    expect(mockQuery).toHaveBeenCalledWith("SELECT 1 FROM states WHERE id = $1", [987654]);
  });

  it("STATE-SEC-04 denies cross-state detail, snapshot, and locality requests before querying", async () => {
    const app = appFor("state_program_officer", 7);

    for (const path of ["/states/9", "/states/9/snapshot", "/localities?stateId=9"]) {
      const response = await request(app).get(path);
      expect(response.status).toBe(403);
      expect(response.body).toEqual({ error: "state_forbidden" });
    }
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("STATE-SEC-05 clamps an unqualified locality request to the assigned state", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 3, name: "Town", stateId: 7, stateName: "Assigned State" }] });

    const response = await request(appFor("state_office_manager", 7)).get("/localities");

    expect(response.status).toBe(200);
    expect(response.body).toEqual([{ id: 3, name: "Town", stateId: 7, stateName: "Assigned State" }]);
    expect(mockQuery).toHaveBeenCalledWith(expect.stringContaining("WHERE l.state_id = $1"), [7]);
  });

  it("STATE-SEC-06 rejects malformed locality state IDs before querying", async () => {
    const response = await request(appFor("program_manager")).get("/localities?stateId=not-a-number");

    expect(response.status).toBe(422);
    expect(response.body).toEqual({ error: "invalid_state_id" });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("STATE-FUNC-04 keeps an existing State ID stable while editing name, code, and office address", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ name: "Northern State", nameAr: "الولاية الشمالية", code: "NOR", officeAddress: null }] })
      .mockResolvedValueOnce({ rows: [{ id: 19, name: "Northern State", nameAr: "الولاية الشمالية", code: "NOR", officeAddress: "Address" }] });

    const response = await request(appFor("program_manager"))
      .patch("/states/19")
      .send({ name: "Northern State", nameAr: "الولاية الشمالية", code: "NOR", officeAddress: "Address" });

    expect(response.status).toBe(200);
    expect(response.body.id).toBe(19);
    expect(mockQuery).toHaveBeenLastCalledWith(expect.stringContaining("UPDATE states"), ["Northern State", "الولاية الشمالية", "NOR", "Address", 19]);
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "update",
      module: "states",
      entityId: 19,
    }));
  });

  it("STATE-FUNC-05 ships the normalised identity guard and State-only generated API surface", () => {
    const migrations = readFileSync(new URL("../lib/run-migrations.ts", import.meta.url), "utf8");
    const generatedClient = readFileSync(new URL("../../../../lib/api-client-react/src/generated/api.ts", import.meta.url), "utf8");

    expect(migrations).toContain('name: "034_state_registry_identity"');
    expect(migrations).toContain("pg_advisory_xact_lock");
    expect(migrations).toContain("idx_states_normalised_name");
    expect(generatedClient).toContain("useCreateState");
    expect(generatedClient).toContain("useUpdateState");
  });

  it("STATE-MASTER-01 retains exactly the canonical 18-State code, English, and Arabic registry", () => {
    expect(SUDAN_STATES).toHaveLength(18);
    expect(new Set(SUDAN_STATES.map(([code]) => code)).size).toBe(18);
    expect(new Set(SUDAN_STATES.map(([, name]) => name)).size).toBe(18);
    expect(SUDAN_STATES.map(([, name]) => name)).toEqual([
      "Khartoum State", "Gezira State", "White Nile State", "Blue Nile State", "Sennar State", "Gedaref State",
      "Kassala State", "Red Sea State", "River Nile State", "Northern State", "North Kordofan State",
      "South Kordofan State", "West Kordofan State", "North Darfur State", "South Darfur State",
      "East Darfur State", "Central Darfur State", "West Darfur State",
    ]);
    expect(SUDAN_STATES.every(([, , nameAr]) => nameAr.length > 0)).toBe(true);
    expect(SUDAN_STATES.find(([code]) => code === "NOR")).toEqual([
      "NOR", "Northern State", "الولاية الشمالية",
    ]);
  });

  it("STATE-LIFECYCLE-01 requires confirmation and audits only a successful status mutation", async () => {
    const app = appFor("program_manager");
    const unconfirmed = await request(app).patch("/states/4/lifecycle").send({ operationalStatus: "inactive" });
    expect(unconfirmed.status).toBe(422);
    expect(mockQuery).not.toHaveBeenCalled();

    mockQuery
      .mockResolvedValueOnce({ rows: [{ operationalStatus: "active", officeStatus: "unknown" }] })
      .mockResolvedValueOnce({ rows: [{ id: 4, name: "Gezira State", nameAr: "ولاية الجزيرة", code: "GZR", operationalStatus: "inactive", officeStatus: "unknown", officeAddress: null }] });
    const response = await request(app).patch("/states/4/lifecycle").send({ confirmed: true, operationalStatus: "inactive" });

    expect(response.status).toBe(200);
    expect(response.body.operationalStatus).toBe("inactive");
    expect(mockLogAudit).toHaveBeenCalledWith(expect.objectContaining({
      action: "state_lifecycle_changed",
      module: "states",
      entityId: 4,
    }));
  });
});