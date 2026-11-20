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

/** Errors raised by express.json() or URL decoding: they carry a 4xx status. */
interface ClientHttpError {
  status: number;
  type?: string;
  message: string;
  limit?: number;
}

function isClientHttpError(err: unknown): err is ClientHttpError {
  if (typeof err !== "object" || err === null || !("status" in err)) return false;
  const { status } = err as { status: unknown };
  return typeof status === "number" && status >= 400 && status < 500;
}

/** Gives each kind of client error a code that matches its status (D27). */
function describeClientError(err: ClientHttpError): { code: ErrorCode; message: string } {
  if (err.type === "entity.parse.failed") {
    return { code: "VALIDATION_ERROR", message: "Request body is not valid JSON" };
  }
  if (err.status === 413) {
    const limit = typeof err.limit === "number" ? ` (max ${err.limit} bytes)` : "";
    return { code: "PAYLOAD_TOO_LARGE", message: `Request body is too large${limit}` };
  }
  if (err.status === 415) {
    return { code: "UNSUPPORTED_MEDIA_TYPE", message: `${err.message}; send JSON as UTF-8` };
  }
  return { code: "BAD_REQUEST", message: err.message };
}

/** Any route that doesn't exist gets the same JSON error shape as everything else. */
export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(res, 404, "NOT_FOUND", `Route ${req.method} ${req.path} not found`);
};

/**
 * Last handler on a route: the path exists, but not with this method
 * (e.g. DELETE /patients/1). Answers 405 with an Allow header instead of a
 * misleading 404. OPTIONS gets the Allow header and 204, as HTTP intends.
 */
export function methodNotAllowed(...allowed: string[]): RequestHandler {
  const allow = [...allowed, ...(allowed.includes("GET") ? ["HEAD"] : [])].join(", ");

  return (req, res, next) => {
    res.set("Allow", allow);

    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }

    next(
      new AppError(
        405,
        "METHOD_NOT_ALLOWED",
        `${req.method} is not allowed on ${req.path}. Allowed: ${allow}`,
      ),
    );
  };
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof AppError) {
    sendError(res, err.status, err.code, err.message, err.details);
    return;
  }

  if (isClientHttpError(err)) {
    const { code, message } = describeClientError(err);
    sendError(res, err.status, code, message);
    return;
  }

  // Unexpected: log the real cause for us, send nothing internal to the client.
  console.error(err);
  sendError(res, 500, "INTERNAL_ERROR", "An unexpected error occurred");
};
