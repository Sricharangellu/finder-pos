import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { PermissionRequestsService, Reviewer } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}
function reviewer(res: Response): Reviewer {
  const a = res.locals["auth"] as AuthPayload;
  return { userId: a.userId, name: (a as { name?: string }).name ?? null };
}

const createSchema = z.object({
  requestedForUserId: z.string().min(1),
  requestedForName: z.string().optional(),
  requestedByUserId: z.string().optional(),
  requestedByName: z.string().optional(),
  permissionCode: z.string().min(1),
  reason: z.string().min(1),
  businessJustification: z.string().optional(),
  accessType: z.enum(["temporary", "permanent"]).optional(),
  startAt: z.number().int().optional(),
  endAt: z.number().int().optional(),
  urgency: z.enum(["low", "normal", "high", "critical"]).optional(),
});
const reviewSchema = z.object({ review_notes: z.string().optional(), expires_at: z.number().int().optional() });

export function registerRoutes(router: Router, service: PermissionRequestsService): void {
  // Admin review view — list all requests (optionally by status).
  router.get(
    "/",
    requireRole("manager"),
    handler(async (req, res) => {
      const status = typeof req.query.status === "string" ? req.query.status : undefined;
      res.json(await service.list(tenantId(res), status));
    }),
  );

  // Self-service: any authenticated user may submit an access request.
  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      res.status(201).json(await service.create(body, tenantId(res), reviewer(res)));
    }),
  );

  router.get(
    "/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      res.json(await service.get(String(req.params.id), tenantId(res)));
    }),
  );

  router.post(
    "/:id/approve",
    requireRole("manager"),
    handler(async (req, res) => {
      const b = parseBody(reviewSchema, req.body);
      res.json(await service.approve(String(req.params.id), tenantId(res), reviewer(res), b.review_notes, b.expires_at));
    }),
  );

  router.post(
    "/:id/reject",
    requireRole("manager"),
    handler(async (req, res) => {
      const b = parseBody(reviewSchema, req.body);
      res.json(await service.reject(String(req.params.id), tenantId(res), reviewer(res), b.review_notes));
    }),
  );

  router.post(
    "/:id/revoke",
    requireRole("manager"),
    handler(async (req, res) => {
      const b = parseBody(reviewSchema, req.body);
      res.json(await service.revoke(String(req.params.id), tenantId(res), reviewer(res), b.review_notes));
    }),
  );
}
