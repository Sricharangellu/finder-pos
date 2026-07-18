import type { Router, Response } from "express";
import { handler } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { PipelineViewsService } from "./pipeline-views.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function actor(res: Response): { id: string | null; role: string } {
  const auth = res.locals["auth"] as AuthPayload;
  return { id: auth.userId ?? null, role: auth.role };
}

/**
 * Inventory > Pipeline tabs. Registered under the inventory module's own
 * mount (/api/v1/inventory), so these are full paths /pipeline/pending etc.
 * Must be registered before the /:productId catch-all in routes.ts for the
 * same reason /counts, /locations, and /reorder-suggestions were — see the
 * 2026-07-18 route-shadowing fix.
 */
export function registerPipelineRoutes(router: Router, service: PipelineViewsService): void {
  router.get("/pipeline/pending", handler(async (_req, res) => {
    res.json(await service.pending(tenantId(res)));
  }));

  router.get("/pipeline/history", handler(async (_req, res) => {
    res.json(await service.history(tenantId(res)));
  }));

  router.get("/pipeline/reorder-alerts", handler(async (_req, res) => {
    res.json(await service.reorderAlerts(tenantId(res)));
  }));

  router.post("/pipeline/reorder-alerts/:id/create-po", handler(async (req, res) => {
    const result = await service.createPoFromAlert(String(req.params.id), tenantId(res), actor(res));
    res.status(201).json(result);
  }));
}
