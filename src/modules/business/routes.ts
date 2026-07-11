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

const updateSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  kind: z.string().min(1).max(40).optional(),
  channels: z.array(z.string().min(1).max(40)).optional(),
  modules: z.array(z.string().min(1).max(60)).optional(),
  defaultRoute: z.string().min(1).max(200).optional(),
  status: z.enum(["active", "inactive"]).optional(),
});

const capabilitySchema = z.object({
  businessUnitId: z.string().min(1).nullable().optional(),
  moduleKey: z.string().min(1).max(80),
  featureKey: z.string().min(1).max(80),
  enabled: z.boolean(),
  config: z.record(z.unknown()).optional(),
});

const switchSchema = z.object({
  businessUnitId: z.string().min(1),
});

const visibilitySchema = z.object({
  businessUnitId: z.string().min(1),
  moduleKey: z.string().min(1).max(80),
  visible: z.boolean(),
  userId: z.string().min(1).nullable().optional(),
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

  router.patch(
    "/business-units/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      const a = auth(res);
      const body = parseBody(updateSchema, req.body);
      res.json(await service.updateBusinessUnit(String(req.params.id), body, a.tenantId));
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

  router.get(
    "/business-capabilities",
    handler(async (req, res) => {
      const a = auth(res);
      const businessUnitId = typeof req.query.businessUnitId === "string" ? req.query.businessUnitId : undefined;
      res.json({ items: await service.listCapabilities(a.tenantId, businessUnitId) });
    }),
  );

  router.put(
    "/capabilities/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      const a = auth(res);
      const body = parseBody(capabilitySchema, req.body);
      res.json(await service.upsertCapability(body, a.tenantId));
    }),
  );

  router.post(
    "/me/switch-business-unit",
    handler(async (req, res) => {
      const a = auth(res);
      const body = parseBody(switchSchema, req.body);
      res.json(await service.setActiveBusinessUnit(a.tenantId, a.userId ?? "", a.role, body.businessUnitId));
    }),
  );

  router.put(
    "/module-visibility",
    requireRole("owner"),
    handler(async (req, res) => {
      const a = auth(res);
      const body = parseBody(visibilitySchema, req.body);
      await service.setModuleVisibility(a.tenantId, body.businessUnitId, body.moduleKey, body.visible, body.userId ?? null);
      res.json({ ok: true });
    }),
  );
}
