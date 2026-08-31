/**
 * DRIVE-TC-SECTOR — Technical Coordinator sector scope must fail closed.
 *
 * A Technical Coordinator whose `sectors` parsed empty (no assignment,
 * legacy blank data) must be denied every non-risk Drive file, never
 * granted unrestricted access. Covers both the list filter (GET
 * /drive/files) and the single-record download guard (GET
 * /drive/files/:id/download) — see tcDriveSectors() in routes/drive.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import supertest from "supertest";

const { mockPoolQuery } = vi.hoisted(() => ({ mockPoolQuery: vi.fn() }));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: async () => ({ query: mockPoolQuery, release: () => {} }) },
}));
vi.mock("../lib/awsS3", () => ({
  uploadFile: vi.fn(),
  downloadFileStream: vi.fn(async () => new Response(new Uint8Array([1])).body),
  archiveFile: vi.fn(),
  deleteFile: vi.fn(),
  testConnection: vi.fn(),
  isConfigured: () => true,
  getConfigStatus: () => ({ configured: true }),
  batchPresignedUrls: vi.fn(async () => new Map()),
  buildObjectKey: (m: string, n: string) => `${m}/${n}`,
  MAX_ATTACHMENT_BYTES: 10 * 1024 * 1024,
}));

import driveRouter from "./drive";
import type { CurrentUser } from "../middlewares/currentUser";

function tc(sectors: string[] | null): CurrentUser {
  return {
    id: 1, name: "TC", email: "tc@test.test", role: "technical_coordinator", roleLabel: "TC",
    scope: "sector", stateId: null, stateName: null, sector: null, avatarUrl: null, sectors,
  } as CurrentUser;
}

function appAs(user: CurrentUser) {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    req.currentUser = user;
    next();
  });
  app.use(driveRouter);
  return supertest(app);
}

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [], rowCount: 0 });
});

describe("DRIVE-TC-SECTOR — GET /drive/files list filter", () => {
  it("a TC with an empty sectors array is bound an empty ANY() filter, not left unfiltered", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)::int AS total")) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await appAs(tc([])).get("/drive/files");

    const listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY df.created_at"));
    const [sql, params] = listCall as [string, unknown[]];
    expect(sql).toContain("df.sector = ANY(");
    // The bound sector-restriction array must be empty — "match nothing" —
    // never absent (which would mean "no restriction, see every sector").
    const sectorParamIndex = sql.match(/df\.sector = ANY\(\$(\d+)/)![1];
    expect(params[Number(sectorParamIndex) - 1]).toEqual([]);
  });

  it("a TC with assigned sectors gets a non-empty ANY() filter for those sectors", async () => {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("COUNT(*)::int AS total")) return { rows: [{ total: 0 }], rowCount: 1 };
      return { rows: [], rowCount: 0 };
    });

    await appAs(tc(["WASH"])).get("/drive/files");

    const listCall = mockPoolQuery.mock.calls.find(([sql]) => String(sql).includes("ORDER BY df.created_at"));
    const [sql, params] = listCall as [string, unknown[]];
    const sectorParamIndex = sql.match(/df\.sector = ANY\(\$(\d+)/)![1];
    expect(params[Number(sectorParamIndex) - 1]).toEqual(["WASH"]);
  });
});

describe("DRIVE-TC-SECTOR — GET /drive/files/:id/download guard", () => {
  function stubFile(sector: string | null) {
    mockPoolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM drive_files WHERE id = $1 AND status = 'active'")) {
        return {
          rows: [{ fileKey: "plans/x.pdf", name: "x.pdf", mimeType: "application/pdf", stateId: null, sector, module: "plans", recordId: 10, availabilityStatus: "available" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });
  }

  it("a TC with no sectors is denied a file that has no sector metadata either (fails closed, not open)", async () => {
    stubFile(null);
    const res = await appAs(tc([])).get("/drive/files/1/download");
    expect(res.status).toBe(403);
  });

  it("a TC with no sectors is denied a file that DOES have sector metadata", async () => {
    stubFile("Health");
    const res = await appAs(tc([])).get("/drive/files/1/download");
    expect(res.status).toBe(403);
  });

  it("a TC with assigned sectors is denied a file outside those sectors", async () => {
    stubFile("Health");
    const res = await appAs(tc(["WASH"])).get("/drive/files/1/download");
    expect(res.status).toBe(403);
  });

  it("a TC with assigned sectors can download a file inside those sectors", async () => {
    stubFile("WASH");
    const res = await appAs(tc(["WASH"])).get("/drive/files/1/download");
    expect(res.status).toBe(200);
  });
});
