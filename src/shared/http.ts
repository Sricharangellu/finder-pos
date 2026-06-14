import type { Request, Response, NextFunction } from "express";
import { ZodError, type ZodSchema } from "zod";

/** Thrown by services/routes to signal a 4xx with a stable error code. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
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
    throw new HttpError(400, "validation_error", flatten(result.error));
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
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }
  // Security: never echo raw error text (it can leak SQL/stack internals). Log
  // the detail server-side; return a generic message to the client.
  console.error("[unhandled]", err instanceof Error ? err.stack ?? err.message : err);
  res.status(500).json({ error: { code: "internal", message: "internal error" } });
}
