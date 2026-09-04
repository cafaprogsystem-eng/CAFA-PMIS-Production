import express, { type Express } from "express";
import cors from "cors";
import helmet from "helmet";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import path from "path";
import { existsSync } from "fs";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  createCredentialedCorsOriginHandler,
  getConfiguredPublicAppOrigins,
} from "./lib/security-config";
import { createApiErrorHandler } from "./lib/error-handler";
import { isProductionEnv } from "./lib/env";
import { PgRateLimitStore } from "./lib/rate-limit-store";

const app: Express = express();

// Replit (and most cloud platforms) front the app with a reverse proxy.
// Trust the first hop so express-rate-limit and secure cookies work correctly.
app.set("trust proxy", 1);

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProductionEnv()) {
    throw new Error("SESSION_SECRET is required in production");
  }
  logger.warn("SESSION_SECRET is not set — using an insecure development fallback. Configure it before deploying.");
}

// ─── Security Headers ────────────────────────────────────────────────────────
const s3ConnectOrigin =
  process.env.STORAGE_PROVIDER === "s3" &&
  process.env.S3_BUCKET &&
  process.env.S3_REGION
    ? `https://${process.env.S3_BUCKET}.s3.${process.env.S3_REGION}.amazonaws.com`
    : null;

app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'", ...(s3ConnectOrigin ? [s3ConnectOrigin] : [])],
        fontSrc: ["'self'", "data:", "https://fonts.gstatic.com"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: null,
      },
    },
    crossOriginEmbedderPolicy: false,
  }),
);

// ─── CORS ─────────────────────────────────────────────────────────────────────
export const allowedOrigins = getConfiguredPublicAppOrigins();
app.use(
  cors({
    origin: createCredentialedCorsOriginHandler(
      allowedOrigins,
      !isProductionEnv(),
    ),
    credentials: true,
  }),
);

// ─── Rate Limiting ────────────────────────────────────────────────────────────
// Backed by a shared Postgres table (lib/rate-limit-store.ts), not the
// library's default in-memory store — with more than one ECS task behind
// the load balancer, an in-memory counter is only ever counting that one
// task's share of traffic, silently allowing close to the limit per task.
const defaultLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
  store: new PgRateLimitStore("api_default"),
  // Skip rate limiting in non-production environments so E2E tests and local dev
  // are not blocked by the shared counters. Production still enforces the limit.
  skip: () => !isProductionEnv(),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "too_many_requests" },
  store: new PgRateLimitStore("api_auth"),
  skip: () => !isProductionEnv(),
});

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/accept-invite", authLimiter);
app.use("/api", defaultLimiter);

// ─── Logging ──────────────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ─── Body Parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));
app.use(cookieParser(sessionSecret ?? "dev-only-insecure-do-not-use-in-prod"));

app.use("/api", router);

// ─── Global Error Handler ─────────────────────────────────────────────────────
// Must be defined AFTER all routes. Converts ZodError → 400 and redacts 5xx errors.
app.use(createApiErrorHandler(logger));

// ─── Production static file serving ──────────────────────────────────────────
// When STATIC_FILES_PATH is set (Docker production), Express serves the compiled
// Vite frontend.  This must come AFTER the API router so /api/* takes priority.
const staticFilesPath = process.env.STATIC_FILES_PATH;
if (staticFilesPath && existsSync(staticFilesPath)) {
  logger.info({ staticFilesPath }, "Serving frontend static files");

  // Serve assets with 1-day cache (Vite hashes filenames, so this is safe)
  app.use(express.static(staticFilesPath, { maxAge: "1d", index: false }));

  // SPA fallback — any non-API GET request that didn't match a static file
  // gets index.html so client-side routing (wouter) works correctly.
  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticFilesPath, "index.html"));
  });
}

export default app;
