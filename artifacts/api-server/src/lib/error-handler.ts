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

    const message = typeof anyErr?.message === "string" ? anyErr.message : "Request failed";
    const error = typeof anyErr?.errorCode === "string" ? anyErr.errorCode : "server_error";
    res.status(status).json({ error, detail: message });
  };
}