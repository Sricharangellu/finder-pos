import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";
import { logError, contextFromRequest } from "./monitoring.js";

/**
 * Shared error-code vocabulary. Every code here has ONE meaning and ONE
 * canonical status; use these for cross-cutting failures. Modules may mint
 * domain-specific codes (snake_case, stable — e.g. `already_received`,
 * `invalid_transition`) for state-machine conflicts; those live with the
 * module, not here. Codes are part of the public API contract: additive
 * only, never remove or repurpose (see CODING_STANDARDS.md).
 */
export const ERROR_CODES = {
  bad_request: 400,
  validation_error: 400,
  unauthenticated: 401,
  token_expired: 401,
  invalid_credentials: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  rate_limit_exceeded: 429,
  account_locked: 429,
  internal: 500,
  misconfigured: 500,
} as const;
export type SharedErrorCode = keyof typeof ERROR_CODES;

/** Thrown by services/routes to signal a 4xx with a stable error code. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** Optional structured detail (e.g. per-field validation issues). */
    public details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (msg: string) => new HttpError(404, "not_found", msg);
export const badRequest = (msg: string) => new HttpError(400, "bad_request", msg);
export const conflict = (msg: string) => new HttpError(409, "conflict", msg);
export const forbidden = (msg: string) => new HttpError(403, "forbidden", msg);

/** Wrap an async route handler so thrown errors hit the error middleware. */
export function handler(
  fn: (req: Request, res: Response) => unknown | Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };
}

/** Validate req.body against a zod schema, throwing 400 on failure. */
export function parseBody<T>(schema: ZodSchema<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    // Structured per-field issues ride along in `details` (additive — the
    // flattened message stays the same for existing clients).
    const details = result.error.issues.map((i) => ({
      field: i.path.join(".") || "(root)",
      message: i.message,
    }));
    throw new HttpError(400, "validation_error", flatten(result.error), details);
  }
  return result.data;
}

function flatten(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

/** Express error-handling middleware. Mount last. */
export function errorMiddleware(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: {
        code: err.code,
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
    return;
  }
  // Security: never echo raw error text (it can leak SQL/stack internals). Log
  // structured detail server-side; return a generic message to the client.
  logError(err, { ...contextFromRequest(req), statusCode: 500 });
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
}
