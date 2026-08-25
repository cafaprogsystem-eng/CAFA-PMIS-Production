import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cors from "cors";
import supertest from "supertest";
import {
  clearSessionCookie,
  setSessionCookie,
} from "./session";
import { createApiErrorHandler } from "./error-handler";
import {
  createCredentialedCorsOriginHandler,
  isAllowedPublicOrigin,
  parsePublicAppOrigins,
} from "./security-config";

describe("production session cookie hardening", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("sets a signed, HttpOnly, SameSite-Lax, Secure cookie in production", () => {
    process.env.NODE_ENV = "production";
    const res = { cookie: vi.fn() };

    setSessionCookie(res as never, "opaque-session-token");

    expect(res.cookie).toHaveBeenCalledWith("cafa_sid", "opaque-session-token", expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      signed: true,
      secure: true,
    }));
  });

  it("clears the production cookie with matching security attributes", () => {
    process.env.NODE_ENV = "production";
    const res = { clearCookie: vi.fn() };

    clearSessionCookie(res as never);

    expect(res.clearCookie).toHaveBeenCalledWith("cafa_sid", expect.objectContaining({
      httpOnly: true,
      sameSite: "lax",
      signed: true,
      secure: true,
    }));
  });

  it("keeps local development usable without Secure cookies", () => {
    process.env.NODE_ENV = "development";
    const res = { cookie: vi.fn(), clearCookie: vi.fn() };

    setSessionCookie(res as never, "opaque-session-token");
    clearSessionCookie(res as never);

    expect(res.cookie).toHaveBeenCalledWith("cafa_sid", "opaque-session-token", expect.objectContaining({ secure: false }));
    expect(res.clearCookie).toHaveBeenCalledWith("cafa_sid", expect.objectContaining({ secure: false }));
  });
});

describe("credentialed CORS origin configuration", () => {
  it("requires a public origin in production", () => {
    expect(() => parsePublicAppOrigins(undefined, { required: true }))
      .toThrow("PUBLIC_APP_URL is required in production");
  });

  it("rejects malformed public origins instead of accepting them", () => {
    for (const value of [
      "not-a-url",
      "https://app.example.com/path",
      "https://app.example.com,",
      "*",
    ]) {
      expect(() => parsePublicAppOrigins(value, { required: true })).toThrow(
        "PUBLIC_APP_URL must contain only valid http(s) origins",
      );
    }
  });

  it("normalises valid origin lists and rejects foreign credentialed origins", () => {
    const allowed = parsePublicAppOrigins("https://app.example.com/, https://admin.example.com", {
      required: true,
    });

    expect(allowed).toEqual(["https://app.example.com", "https://admin.example.com"]);
    expect(isAllowedPublicOrigin("https://app.example.com", allowed)).toBe(true);
    expect(isAllowedPublicOrigin("https://foreign.example.com", allowed)).toBe(false);
    expect(isAllowedPublicOrigin(undefined, allowed)).toBe(true);
  });

  it("allows configured origins but rejects foreign credentialed preflights", async () => {
    const app = express();
    app.use(cors({
      origin: createCredentialedCorsOriginHandler(["https://app.example.com"]),
      credentials: true,
    }));
    app.options("/probe", (_req, res) => res.sendStatus(204));
    app.use((_err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      res.sendStatus(403);
    });

    const allowed = await supertest(app)
      .options("/probe")
      .set("Origin", "https://app.example.com")
      .set("Access-Control-Request-Method", "GET");
    const rejected = await supertest(app)
      .options("/probe")
      .set("Origin", "https://foreign.example.com")
      .set("Access-Control-Request-Method", "GET");

    expect(allowed.status).toBe(204);
    expect(allowed.headers["access-control-allow-origin"]).toBe("https://app.example.com");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    expect(rejected.status).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("keeps development usable without an explicitly configured public origin", async () => {
    const app = express();
    app.use(cors({
      origin: createCredentialedCorsOriginHandler([], true),
      credentials: true,
    }));
    app.options("/probe", (_req, res) => res.sendStatus(204));

    const response = await supertest(app)
      .options("/probe")
      .set("Origin", "http://localhost:5173")
      .set("Access-Control-Request-Method", "GET");

    expect(response.status).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("API error redaction", () => {
  it("logs the complete unexpected error but returns a generic 5xx response", async () => {
    const logger = { error: vi.fn() };
    const app = express();
    app.get("/failure", () => {
      throw new Error("database password and SQL details");
    });
    app.use(createApiErrorHandler(logger));

    const response = await supertest(app).get("/failure");

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: "server_error",
      detail: "Internal Server Error",
    });
    expect(JSON.stringify(response.body)).not.toContain("database password");
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      "Unhandled error",
    );
  });
});