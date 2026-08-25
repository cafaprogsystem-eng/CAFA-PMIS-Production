import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import type { CurrentUser } from "../middlewares/currentUser";

const { mockPoolQuery, mockPoolConnect, mockClientQuery } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockPoolConnect: vi.fn(),
  mockClientQuery: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  pool: { query: mockPoolQuery, connect: mockPoolConnect },
}));

const { default: reconciliationRouter } = await import("./attachment-reconciliation");

const ADMIN = { id: 1, role: "super_admin" } as CurrentUser;

function makeApp(user: CurrentUser | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) req.currentUser = user;
    next();
  });
  app.use(reconciliationRouter);
  return app;
}

describe("attachment reconciliation inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolConnect.mockResolvedValue({ query: mockClientQuery, release: vi.fn() });
    mockPoolQuery.mockImplementation((sql: string) => {
      if (sql.includes("MAX(classified_at)")) {
        return Promise.resolve({ rows: [{ generatedAt: "2026-08-22T00:00:00.000Z" }] });
      }
      return Promise.resolve({
        rows: [
          {
            classification: "OBJECT_RECOVERABLE",
            sourceKind: "project_document",
            providerReference: "historical:record-linked",
          },
          {
            classification: "OBJECT_CONFIRMED_MISSING",
            sourceKind: "report_attachment",
            providerReference: "historical:record-linked",
          },
        ],
      });
    });
  });

  it("requires storage.admin authentication", async () => {
    const response = await supertest(makeApp(null)).get("/attachment-reconciliation/inventory");
    expect(response.status).toBe(401);
    expect(mockPoolQuery).not.toHaveBeenCalled();
  });

  it("returns a redacted, aggregate migration baseline for an administrator", async () => {
    const response = await supertest(makeApp(ADMIN)).get("/attachment-reconciliation/inventory");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      genuineGoogleDriveApiDependency: false,
      refreshed: false,
      redaction: {
        rawObjectKeys: false,
        externalProviderIds: false,
        credentials: false,
      },
      recordInventory: {
        total: 2,
        migrationClassifications: { migratable: 1, missing: 1 },
        byProvider: { historical_storage: 2 },
      },
    });
    expect(response.body.attachmentSurfaces).toEqual(expect.arrayContaining([
      expect.objectContaining({ surface: "Historical storage import" }),
    ]));
    expect(JSON.stringify(response.body)).not.toMatch(/s3:\/\//i);
    expect(JSON.stringify(response.body.recordInventory)).not.toMatch(
      /\/objects\/|drive_file_id|driveFileId|historical:record-linked/i,
    );
    expect(JSON.stringify(response.body)).not.toMatch(/AWS_ACCESS_KEY|GCS_PRIVATE_KEY/);
  });

  it("records an unavailable profile-avatar decision without mutating the user record", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM attachment_reconciliation_entries WHERE id")) {
        return Promise.resolve({
          rows: [{
            id: 41,
            sourceKind: "profile_avatar",
            sourceId: 9,
            metadataId: "9",
            parentType: "profile",
            parentId: 9,
            classification: "OWNER_DECISION_REQUIRED",
            disposition: null,
            beforeMetadata: {},
          }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const response = await supertest(makeApp(ADMIN))
      .post("/attachment-reconciliation/41/disposition")
      .send({ action: "KEEP_UNAVAILABLE", rationale: "Provider metadata is currently unavailable for this managed avatar." });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true, disposition: "KEEP_UNAVAILABLE" });
    expect(mockClientQuery.mock.calls.map(([sql]) => String(sql))).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/UPDATE users/i)]),
    );
    expect(mockClientQuery.mock.calls.map(([sql]) => String(sql))).toEqual(
      expect.arrayContaining([expect.stringMatching(/UPDATE attachment_reconciliation_entries/i)]),
    );
  });
});