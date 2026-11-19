export type ErrorCode = "VALIDATION_ERROR" | "BAD_REQUEST" | "NOT_FOUND" | "INTERNAL_ERROR";

export interface ErrorDetail {
  field: string;
  message: string;
}

/**
 * An error that is safe to show to the API client. Anything else that is thrown
 * becomes a generic 500 so internal details never leak.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: ErrorDetail[];

  constructor(status: number, code: ErrorCode, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function validationError(message: string, details: ErrorDetail[]): AppError {
  return new AppError(400, "VALIDATION_ERROR", message, details);
}

export function notFound(message: string): AppError {
  return new AppError(404, "NOT_FOUND", message);
}
