import { createServer } from "http";
import { logger } from "./lib/logger";
import { validateEmailConfig } from "./lib/mailer";
import { runMigrations, verifyRequiredSchema } from "./lib/run-migrations";
import { validateStorageConfiguration } from "./lib/objectStorage";
import { markRuntimeNotReady, markRuntimeReady } from "./lib/runtime-readiness";
import { startSchedulers, stopSchedulers } from "./lib/scheduler";
import { runProjectDataIntegrityScan } from "./lib/projectDataIntegrity";
import { pool } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error("PORT environment variable is required but was not provided.");
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const sessionSecret =
  process.env.SESSION_SECRET ?? "dev-only-insecure-do-not-use-in-prod";

// Validate email provider configuration at boot — throws and refuses to start
// if EMAIL_ENABLED=true but required credentials are missing.
validateEmailConfig();
// Validate the selected storage provider before migrations or HTTP listen.
// Production must never accept traffic with an incomplete provider contract.
validateStorageConfiguration();

function migrationsMayRunAtStartup(): boolean {
  const configured = process.env.RUN_MIGRATIONS_ON_STARTUP;
  if (configured == null || configured === "") return process.env.NODE_ENV !== "production";
  if (configured === "true") return true;
  if (configured === "false") return false;
  throw new Error("RUN_MIGRATIONS_ON_STARTUP must be exactly true or false.");
}

async function closeHttpServer(server: ReturnType<typeof createServer>): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function start(): Promise<void> {
  // Production uses a dedicated, one-shot migration release job. Development
  // retains an explicit convenience fallback; both paths verify the same head.
  if (migrationsMayRunAtStartup()) await runMigrations();
  await verifyRequiredSchema();
  await runProjectDataIntegrityScan();

  // Loading routes only after schema verification prevents import-time database
  // work from racing the release job.
  const [{ default: app, allowedOrigins }, { realtime }] = await Promise.all([
    import("./app"),
    import("./lib/realtime"),
  ]);
  const httpServer = createServer(app);
  realtime.init(httpServer, sessionSecret, allowedOrigins);
  startSchedulers();

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    markRuntimeNotReady();
    logger.info({ signal }, "Graceful shutdown started");
    await closeHttpServer(httpServer);
    realtime.close();
    await stopSchedulers();
    await pool.end();
    logger.info({ signal }, "Graceful shutdown complete");
  };

  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
  httpServer.on("error", (err: Error) => {
    logger.error({ err }, "Error listening on port");
    void shutdown("listen_error").finally(() => {
      process.exitCode = 1;
    });
  });
  httpServer.listen(port, () => {
    markRuntimeReady();
    logger.info({ port }, "Server listening");
  });
}

void start().catch((err: Error) => {
  markRuntimeNotReady();
  logger.error({ err }, "Schema readiness failed — refusing to start");
  void pool.end().finally(() => {
    process.exit(1);
  });
});
