import type { ErrorRequestHandler, RequestHandler, Response } from "express";
import { AppError, type ErrorCode, type ErrorDetail } from "../errors.js";

function sendError(
  res: Response,
  status: number,
  code: ErrorCode,
  message: string,
  details?: ErrorDetail[],
) {
  res.status(status).json({ error: { code, message, ...(details && { details }) } });
}

/** Errors raised by express.json(), e.g. broken JSON or a body that is too large. */
function isClientHttpError(err: unknown): err is { status: number; type?: string; message: string } {
  if (typeof err !== "object" || err === null || !("status" in err)) return false;
  const { status } = err as { status: unknown };
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Any route that doesn't exist gets the same JSON error shape as everything else. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`);
};

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (isClientHttpError(err)) {
    if (err.type === "entity.parse.failed") {
      sendError(res, 400, "VALIDATION_ERROR", "Request body is not valid JSON");
    } else {
      sendError(res, err.status, "BAD_REQUEST", err.message);
    }
    return;
  }

  // Unexpected: log the real cause for us, send nothing internal to the client.
  console.error(err);
  sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
};
