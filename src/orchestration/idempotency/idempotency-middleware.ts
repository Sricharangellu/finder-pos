import type { Request, Response, NextFunction } from "express";
import { IdempotencyStore } from "./idempotency-store.js";
import type { DB } from "../../shared/db.js";

/**
 * Express middleware that enforces idempotency on POST/PATCH routes.
 *
 * Usage: add header `Idempotency-Key: <client-generated UUID>` on any
 * mutating request. A second request with the same key returns the
 * cached response without re-executing the handler.
 *
 * attach to routes: router.post("/refund", idempotencyMiddleware(db), handler)
 */
export function idempotencyMiddleware(db: DB) {
  const store = new IdempotencyStore(db);

  return async function (req: Request, res: Response, next: NextFunction): Promise<void> {
    const key = req.headers["idempotency-key"] as string | undefined;
    if (!key) {
      next();
      return;
    }

    const tenantId = (req as unknown as Record<string, unknown>)["tenantId"] as string ?? "default";

    try {
      const cached = await store.check(tenantId, key);
      if (cached) {
        const result = JSON.parse(cached) as { status: number; body: unknown };
        res.status(result.status).json(result.body);
        return;
      }

      // Capture the response by intercepting res.json.
      const originalJson = res.json.bind(res);
      res.json = function (body: unknown) {
        // Record the result asynchronously — don't block the response.
        store
          .record(tenantId, key, null, { status: res.statusCode, body })
          .catch((err) => console.error("[idempotency] record failed:", err instanceof Error ? err.message : err));
        return originalJson(body);
      };

      next();
    } catch (err) {
      next(err);
    }
  };
}
