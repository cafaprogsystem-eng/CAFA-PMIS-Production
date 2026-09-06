import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";

type ErrorLogger = {
  error: (object: unknown, message: string) => void;
};

/**
 * Return useful validation details, but never return unexpected exception
 * details to an API caller. The full error object is retained in server logs.
 */
export function createApiErrorHandler(logger: ErrorLogger) {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  return (err: unknown, _req: Request, res: Response, _next: NextFunction): void => {
    if (err instanceof ZodError) {
      const first = err.errors[0];
      const fieldPath = first?.path.length ? first.path.join(".") : "input";
      const message = first?.message ?? "Validation failed";
      res.status(400).json({
        error: "validation_error",
        detail: `${fieldPath}: ${message}`,
        fields: err.errors.map((e: { path: (string | number)[]; message: string }) => ({
          path: e.path.join("."),
          message: e.message,
        })),
      });
      return;
    }

    const anyErr = err as Record<string, unknown>;
    const requestedStatus = typeof anyErr?.status === "number"
      ? anyErr.status
      : typeof anyErr?.statusCode === "number" ? anyErr.statusCode : 500;
    const status = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus <= 599
      ? requestedStatus
      : 500;

    logger.error({ err }, "Unhandled error");

    if (status >= 500) {
      res.status(status).json({
        error: "server_error",
        detail: "Internal Server Error",
      });
      return;
    }

    // A 4xx .status alone is not an opt-in to expose .message — plenty of
    // third-party exceptions carry a real HTTP status without ever meaning
    // for their message to reach an API caller. GaxiosError (the HTTP layer
    // under @google-cloud/storage, i.e. STORAGE_PROVIDER=gcs/replit) sets
    // .status from the raw response on every request failure, so an
    // uncaught storage error used to leak Google's error text verbatim here.
    // errorCode is the deliberate marker this codebase already uses when an
    // error IS meant to surface its message (see routes/dashboard.ts's
    // forbiddenDashboardScope) — require it before trusting .message.
    const errorCode = typeof anyErr?.errorCode === "string" ? anyErr.errorCode : null;
    if (!errorCode) {
      res.status(status).json({ error: "request_failed", detail: "Request failed" });
      return;
    }

    const message = typeof anyErr?.message === "string" ? anyErr.message : "Request failed";
    res.status(status).json({ error: errorCode, detail: message });
  };
}