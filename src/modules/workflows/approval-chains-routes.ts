import { z } from "zod";
import type { Router, Response } from "express";
import { handler, parseBody } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { ApprovalChainsService } from "./approval-chains.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const StepSchema = z.object({
  role: z.string().min(1).max(32),
  label: z.string().min(1).max(128),
});

const CreateChainBody = z.object({
  name: z.string().min(1).max(128),
  trigger: z.string().min(1).max(64),
  threshold: z.number().nullable().optional(),
  steps: z.array(StepSchema).optional(),
  enabled: z.boolean().optional(),
});

const UpdateChainBody = CreateChainBody.partial();

/**
 * Registers /approval-chains routes on the workflows router. Must be
 * registered BEFORE routes.ts's `GET /:id` (a single-segment catch-all) —
 * otherwise `GET /approval-chains` would be swallowed as `:id = "approval-
 * chains"`. Same ordering rule documented on the /templates routes in
 * routes.ts; index.ts enforces this by calling this function first.
 */
export function registerApprovalChainRoutes(router: Router, service: ApprovalChainsService): void {
  router.get(
    "/approval-chains",
    requireRole("manager"),
    handler(async (_req, res) => {
      res.json({ items: await service.list(tenantId(res)) });
    }),
  );

  // Owner-only: approval chains gate sensitive operations (price overrides,
  // large refunds, vendor onboarding); creating/editing the rule itself is
  // an owner-tier action, matching purchasing's approval-config convention.
  router.post(
    "/approval-chains",
    requireRole("owner"),
    handler(async (req, res) => {
      const body = parseBody(CreateChainBody, req.body);
      res.status(201).json(await service.create(body, tenantId(res)));
    }),
  );

  router.get(
    "/approval-chains/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      res.json(await service.get(String(req.params["id"]), tenantId(res)));
    }),
  );

  router.patch(
    "/approval-chains/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      const body = parseBody(UpdateChainBody, req.body);
      res.json(await service.update(String(req.params["id"]), body, tenantId(res)));
    }),
  );

  router.delete(
    "/approval-chains/:id",
    requireRole("owner"),
    handler(async (req, res) => {
      await service.delete(String(req.params["id"]), tenantId(res));
      res.status(204).end();
    }),
  );
}
