/**
 * TRAINING-CERT-VERIFY-PUBLIC — GET /training-certificates/verify/:certId was
 * meant to be a public registry lookup (an employer verifying a trainee's
 * certificate with no CAFA PMIS account), but the shared `requireAuth` gate
 * rejected any anonymous request with 401 before the route ever ran, and the
 * path was absent from currentUser.ts's public allow-list. Fixed by adding it
 * to PUBLIC_PREFIXES.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import supertest from "supertest";

const { mockPoolQuery, mockGetActiveSession } = vi.hoisted(() => ({
  mockPoolQuery: vi.fn(),
  mockGetActiveSession: vi.fn(),
}));

vi.mock("@workspace/db", () => ({ pool: { query: mockPoolQuery } }));
vi.mock("../../lib/session", () => ({ getActiveSession: mockGetActiveSession }));

import { attachCurrentUser, requireAuth } from "../../middlewares/currentUser";
import trainingVideosRouter from "../training-videos";

function anonymousApp() {
  const app = express();
  app.use(attachCurrentUser);
  app.use(requireAuth);
  app.use(trainingVideosRouter);
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err instanceof Error ? err.message : "internal" });
  });
  return supertest(app);
}

beforeEach(() => {
  mockPoolQuery.mockReset().mockResolvedValue({ rows: [] });
  mockGetActiveSession.mockReset().mockResolvedValue(null); // no session cookie
});

describe("TRAINING-CERT-VERIFY-PUBLIC", () => {
  it("is reachable with no session — the shared auth gate lets it through instead of returning 401", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [{ certificateId: "CAFA-PMIS-2026-ABCDEF012345" }] });

    const res = await anonymousApp().get("/training-certificates/verify/CAFA-PMIS-2026-ABCDEF012345");

    expect(res.status).not.toBe(401);
    expect(res.status).toBe(200);
    expect(res.body.certificate.certificateId).toBe("CAFA-PMIS-2026-ABCDEF012345");
  });

  it("still returns 404 (not a leak) for a certificate ID that does not exist, with no session", async () => {
    mockPoolQuery.mockResolvedValueOnce({ rows: [] });

    const res = await anonymousApp().get("/training-certificates/verify/does-not-exist");

    expect(res.status).toBe(404);
  });

  it("a genuinely protected training-videos route is still gated for an anonymous request (no over-broad public exemption)", async () => {
    const res = await anonymousApp().get("/training-videos");

    expect(res.status).toBe(401);
  });
});
