import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockQuery } = vi.hoisted(() => ({ mockQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({ pool: { query: mockQuery } }));

import auditRouter from "./audit";
import type { CurrentUser } from "../middlewares/currentUser";
import { AuditLogQueryParams } from "@workspace/api-zod";

function user(overrides: Partial<CurrentUser> = {}): CurrentUser {
  return {
    id: 1, name: "Auditor", email: "auditor@example.test", role: "program_manager",
    roleLabel: "Programme Manager", scope: "org", stateId: null, stateName: null,
    sector: null, avatarUrl: null, sectors: null, ...overrides,
  };
}

function appAs(currentUser: CurrentUser | null) {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (currentUser) req.currentUser = currentUser;
    next();
  });
  app.use(auditRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockImplementation((sql: string) => {
    if (sql.includes("AS total")) {
      return Promise.resolve({ rows: [{ total: "43", created: "4", updated: "12", deleted: "2", approved: "3" }] });
    }
    return Promise.resolve({
      rows: [{
        id: 42, userName: "Amina Hassan", userEmail: "amina@example.test", userRole: "Programme Manager",
        action: "project_updated", module: "projects", entityId: 99, entityReference: "CAFA-01-005 — Health response",
        timestamp: "2026-08-21T09:00:00.000Z", usedOverride: false,
        oldValue: JSON.stringify({ budget: 10, password: "do-not-return", projectId: 99, apiKey: "opaque-api-key" }),
        newValue: JSON.stringify({ budget: 20, password: "do-not-return", projectId: 100, apiKey: "opaque-api-key" }),
      }],
    });
  });
});

describe("audit workspace API", () => {
  it("returns a bounded page, full-result summary, and deterministic ordering", async () => {
    const response = await appAs(user()).get("/audit-log?search=health&action=update&entityType=projects&page=2&pageSize=25");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      total: 43, page: 2, pageSize: 25, totalPages: 2,
      summary: { created: 4, updated: 12, deleted: 2, approved: 3 },
    });
    expect(response.body.items[0]).toMatchObject({
      entityReference: "CAFA-01-005 — Health response",
      actionCategory: "updated",
      changeSummary: "1 field changed",
    });
    expect(response.body.items[0].changes).toEqual([{ field: "budget", before: "10", after: "20" }]);
    expect(JSON.stringify(response.body)).not.toContain("do-not-return");
    expect(JSON.stringify(response.body)).not.toContain("opaque-api-key");

    const dataQuery = String(mockQuery.mock.calls[1][0]);
    expect(dataQuery).toContain("ORDER BY a.timestamp DESC, a.id DESC");
    const countQuery = String(mockQuery.mock.calls[0][0]);
    expect(countQuery).toContain("(SELECT COUNT(*)::text FROM audit_entries a");
    expect(countQuery).toContain("COUNT(*) FILTER");
    expect(countQuery).toContain("WHEN a.action ~*");
    expect(mockQuery.mock.calls[0][1]).toEqual(["projects", "%health%", "updated"]);
    expect(mockQuery.mock.calls[1][1]).toEqual(["projects", "%health%", "updated", 25, 25]);
  });

  it("maps legacy action URLs to canonical categories without narrowing KPI summaries", async () => {
    const response = await appAs(user()).get("/audit-log?action=update&pageSize=10");

    expect(response.status).toBe(200);
    expect(response.body.summary).toEqual({ created: 4, updated: 12, deleted: 2, approved: 3 });
    expect(mockQuery.mock.calls[0][1]).toEqual(["updated"]);
    expect(String(mockQuery.mock.calls[0][0])).toContain("FROM audit_entries a");
    expect(String(mockQuery.mock.calls[0][0])).toContain("= $1");
  });

  it("keeps state scope authoritative before applying client filters", async () => {
    const response = await appAs(user({ role: "state_program_officer", stateId: 7 }))
      .get("/audit-log?entityType=projects&pageSize=10");

    expect(response.status).toBe(200);
    expect(String(mockQuery.mock.calls[0][0])).toContain("project_states WHERE state_id = $1");
    expect(String(mockQuery.mock.calls[0][0])).toContain('a."entityId"');
    expect(String(mockQuery.mock.calls[0][0])).not.toContain("AND a.entity_id");
    expect(mockQuery.mock.calls[0][1]).toEqual([7, "projects"]);
  });

  it("fails closed for restricted staff without an assigned scope", async () => {
    const response = await appAs(user({ role: "technical_coordinator", sectors: [] })).get("/audit-log");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ items: [], total: 0, summary: { created: 0, updated: 0, deleted: 0, approved: 0 } });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("does not disclose opaque raw values from sensitive modules or unstructured user history", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)::text AS total")) return Promise.resolve({ rows: [{ total: "1", created: "0", updated: "1", deleted: "0", approved: "0" }] });
      return Promise.resolve({ rows: [{
        id: 8, userName: null, userEmail: null, userRole: null, action: "password_reset",
        module: "auth", entityId: 2, entityReference: null, timestamp: "2026-08-21T09:00:00.000Z",
        usedOverride: false, oldValue: null, newValue: '{"token":"never-expose-this"}',
      }] });
    });

    const response = await appAs(user()).get("/audit-log");
    expect(response.status).toBe(200);
    expect(response.body.items[0]).toMatchObject({ userName: null, changes: [], changeSummary: "Event recorded" });
    expect(JSON.stringify(response.body)).not.toContain("never-expose-this");

    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)::text AS total")) return Promise.resolve({ rows: [{ total: "1", created: "0", updated: "1", deleted: "0", approved: "0" }] });
      return Promise.resolve({ rows: [{
        id: 9, userName: "Admin", userEmail: "admin@example.test", userRole: "Administrator",
        action: "password_changed", module: "users", entityId: 2, entityReference: "User",
        timestamp: "2026-08-21T09:00:00.000Z", usedOverride: false,
        oldValue: JSON.stringify({ accessKey: "a1b2c3d4e5", budget: 10 }),
        newValue: JSON.stringify({ accessKey: "opaque-value-that-must-never-be-returned", budget: 20 }),
      }] });
    });
    const userHistory = await appAs(user()).get("/audit-log?entityType=users");
    expect(userHistory.status).toBe(200);
    expect(userHistory.body.items[0].changes).toEqual([{ field: "budget", before: "10", after: "20" }]);
    expect(JSON.stringify(userHistory.body)).not.toContain("opaque-value-that-must-never-be-returned");
  });

  it("surfaces State/username/scope changes for users while still hiding raw numeric IDs", async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes("COUNT(*)::text AS total")) return Promise.resolve({ rows: [{ total: "1", created: "0", updated: "1", deleted: "0", approved: "0" }] });
      return Promise.resolve({ rows: [{
        id: 10, userName: "Admin", userEmail: "admin@example.test", userRole: "Administrator",
        action: "update", module: "users", entityId: 2, entityReference: "Colleague",
        timestamp: "2026-08-21T09:00:00.000Z", usedOverride: false,
        oldValue: JSON.stringify({ username: "old.user", scope: "state", state: "Khartoum", stateId: 7 }),
        newValue: JSON.stringify({ username: "new.user", scope: "org", state: "Kassala", stateId: 12 }),
      }] });
    });
    const response = await appAs(user()).get("/audit-log?entityType=users");
    expect(response.status).toBe(200);
    expect(response.body.items[0].changes).toEqual(expect.arrayContaining([
      { field: "username", before: "old.user", after: "new.user" },
      { field: "scope", before: "state", after: "org" },
      { field: "state", before: "Khartoum", after: "Kassala" },
    ]));
    expect(response.body.items[0].changes.some((c: { field: string }) => c.field === "stateId")).toBe(false);
  });

  it("resolves entity references for auth, comments, notifications, files, and manual modules", async () => {
    await appAs(user()).get("/audit-log");
    const dataQuery = String(mockQuery.mock.calls.find(([sql]) => String(sql).includes("entity_reference"))?.[0]);
    for (const module of ["auth", "comments", "notifications", "files", "manual", "manual_chapter", "manual_section", "manual_sop"]) {
      expect(dataQuery).toContain(`WHEN a.module = '${module}'`);
    }
    expect(dataQuery).toContain("program_resources pr");
    expect(dataQuery).toContain("plan_attachments pa");
    expect(dataQuery).toContain("training_videos tv");
    expect(dataQuery).toContain("training_certificates tc");
  });

  it("rejects malformed and contradictory filters before querying records", async () => {
    const malformed = await appAs(user()).get("/audit-log?dateFrom=2026-02-30");
    expect(malformed.status).toBe(400);
    const contradictory = await appAs(user()).get("/audit-log?module=projects&entityType=reports");
    expect(contradictory.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("shares strict calendar, integer, and alias validation with the published API schema", () => {
    expect(AuditLogQueryParams.safeParse({ dateFrom: "2026-02-30" }).success).toBe(false);
    expect(AuditLogQueryParams.safeParse({ page: "1.5" }).success).toBe(false);
    expect(AuditLogQueryParams.safeParse({ module: "projects", entityType: "reports" }).success).toBe(false);
    expect(AuditLogQueryParams.safeParse({ action: "update" }).success).toBe(true);
    expect(AuditLogQueryParams.safeParse({ action: "updated" }).success).toBe(true);
    expect(AuditLogQueryParams.safeParse({ action: "project_updated" }).success).toBe(false);
    expect(AuditLogQueryParams.safeParse({ dateFrom: "2026-02-28", page: "2" }).success).toBe(true);
  });
});