import pino from "pino";
import { isProductionEnv } from "./env";

// This is the first module index.ts imports, so validating NODE_ENV here
// doubles as the boot-time assertion: an unrecognized value throws before any
// other module (session cookies, CORS, rate limiting) can read it and quietly
// fall back to a less secure default.
const isProduction = isProductionEnv();

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
    // Registration session bearer token — must never appear in structured log payloads.
    // Treated identically to passwords and session credentials.
    "req.body.registrationToken",
    "body.registrationToken",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});
