import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { BusinessService } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

const createSchema = z.object({
  name: z.string().min(1).max(120),
  kind: z.string().min(1).max(40),
  channels: z.array(z.string().min(1).max(40)).optional(),
  modules: z.array(z.string().min(1).max(60)).optional(),
  defaultRoute: z.string().min(1).max(200).optional(),
});

export function registerRoutes(router: Router, service: BusinessService): void {
  // GET /api/v1/me/context — the caller's business-unit-scoped app context.
  // The whole frontend (navigation, active unit, permissions) reads this; it
  // must never hardcode "show retail" / "show wholesale".
  router.get(
    "/me/context",
    handler(async (_req, res) => {
      const a = auth(res);
      res.json(await service.getContext(a.tenantId, a.userId ?? "", a.role));
    }),
  );

  // GET /api/v1/business-units — units the caller may access.
  router.get(
    "/business-units",
    handler(async (_req, res) => {
      const a = auth(res);
      res.json({ items: await service.listBusinessUnits(a.tenantId, a.userId ?? "", a.role) });
    }),
  );

  // POST /api/v1/business-units — create a unit (owner only).
  router.post(
    "/business-units",
    requireRole("owner"),
    handler(async (req, res) => {
      const a = auth(res);
      const body = parseBody(createSchema, req.body);
      res.status(201).json(await service.createBusinessUnit(body, a.tenantId));
    }),
  );

  // GET /api/v1/business-units/:id — access-checked for non-owners.
  router.get(
    "/business-units/:id",
    handler(async (req, res) => {
      const a = auth(res);
      res.json(await service.getBusinessUnit(String(req.params.id), a.tenantId, a.userId ?? "", a.role));
    }),
  );
}
