import type { Router, Response } from "express";
import { handler } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { RunHistoryService } from "./run-history.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

/**
 * Registers /run-history on the workflows router. Must be registered BEFORE
 * routes.ts's `GET /:id` catch-all — same ordering rule as /approval-chains
 * and /templates; index.ts enforces this by calling this function first.
 */
export function registerRunHistoryRoutes(router: Router, service: RunHistoryService): void {
  router.get(
    "/run-history",
    requireRole("manager"),
    handler(async (req, res) => {
      const limit = req.query["limit"] ? Number(req.query["limit"]) : undefined;
      const cursor = typeof req.query["cursor"] === "string" ? req.query["cursor"] : undefined;
      const page = await service.list(tenantId(res), { limit, cursor });
      res.json({ items: page.items, total: page.total, nextCursor: page.nextCursor, limit: page.limit });
    }),
  );
}
