import { z } from "zod";
import type { Router, Response } from "express";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { CustomRolesService } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

const KNOWN_PERMISSIONS = [
  "orders:read", "orders:write", "orders:void",
  "customers:read", "customers:write",
  "catalog:read", "catalog:write",
  "inventory:read", "inventory:write",
  "purchasing:read", "purchasing:write",
  "reports:read",
  "discounts:read", "discounts:write",
  "ecommerce:read", "ecommerce:write",
  "team:read",
];

const CreateBody = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(255).optional(),
  permissions: z.array(z.string()).refine(
    (perms) => perms.every((p) => KNOWN_PERMISSIONS.includes(p)),
    { message: `permissions must be from: ${KNOWN_PERMISSIONS.join(", ")}` },
  ),
});

const UpdateBody = CreateBody.partial();

const AssignBody = z.object({
  customRoleId: z.string().nullable(),
});

export function registerRoutes(router: Router, service: CustomRolesService): void {
  // GET /api/v1/custom-roles — owner/manager
  router.get(
    "/",
    requireRole("manager"),
    handler(async (_req, res) => {
      const { tenantId } = auth(res);
      res.json({ items: await service.list(tenantId) });
    }),
  );

  // GET /api/v1/custom-roles/:id — owner/manager
  router.get(
    "/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const { tenantId } = auth(res);
      res.json(await service.get(tenantId, String(req.params["id"])));
    }),
  );

  // POST /api/v1/custom-roles — owner only
  router.post(
    "/",
    requireRole("owner"),
    handler(async (req, res) => {
      const { tenantId } = auth(res);
      const body = parseBody(CreateBody, req.body);
      const role = await service.create(tenantId, body);
      res.status(201).json(role);
    }),
  );

  // PATCH /api/v1/custom-roles/assign/:userId — owner only
  // Must be registered BEFORE /:id to avoid route shadowing.
  router.patch(
    "/assign/:userId",
    requireRole("owner"),
    handler(async (req, res) => {
      const { tenantId } = auth(res);
      const { customRoleId } = parseBody(AssignBody, req.body);
      await service.assignToUser(tenantId, String(req.params["userId"]), customRoleId);
      res.status(204).end();
    }),
  );

  // PATCH /api/v1/custom-roles/:id — owner only
  router.patch(
    "/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      const { tenantId } = auth(res);
      const body = parseBody(UpdateBody, req.body);
      res.json(await service.update(tenantId, String(req.params["id"]), body));
    }),
  );

  // DELETE /api/v1/custom-roles/:id — owner only
  router.delete(
    "/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      const { tenantId } = auth(res);
      await service.delete(tenantId, String(req.params["id"]));
      res.status(204).end();
    }),
  );
}

export { KNOWN_PERMISSIONS };
