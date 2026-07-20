import { z } from "zod";
import type { Router, Response } from "express";
import { handler, parseBody, HttpError } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { PermissionRequestsService } from "../permission_requests/service.js";
import type { TeamService } from "./service.js";

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

function requireManagement(res: Response): string {
  const { role, tenantId } = auth(res);
  if (role !== "owner" && role !== "manager") {
    throw new HttpError(403, "forbidden", "team directory requires owner or manager");
  }
  return tenantId;
}

/** Self-or-management guard: members may act on their OWN record (clock in/out,
 *  view their own entries/permissions); anything else requires owner/manager. */
function requireSelfOrManagement(res: Response, targetUserId: string): string {
  const { role, tenantId, userId } = auth(res);
  if (userId === targetUserId || role === "owner" || role === "manager") return tenantId;
  throw new HttpError(403, "forbidden", "you can only access your own record");
}

const createMemberSchema = z.object({
  name: z.string().min(1).max(128),
  email: z.string().email(),
  role: z.enum(["cashier", "manager", "owner"]).optional(),
});

export function registerRoutes(
  router: Router,
  service: TeamService,
  permissionRequests: PermissionRequestsService,
): void {
  // GET /api/v1/team — owner/manager only.
  router.get(
    "/",
    handler(async (_req, res) => {
      res.json({ items: await service.list(requireManagement(res)) });
    }),
  );

  // POST /api/v1/team — invite a member (owner/manager only). Only an owner
  // may grant the owner role.
  router.post(
    "/",
    handler(async (req, res) => {
      const tenantId = requireManagement(res);
      const body = parseBody(createMemberSchema, req.body);
      if (body.role === "owner" && auth(res).role !== "owner") {
        throw new HttpError(403, "forbidden", "only an owner can grant the owner role");
      }
      res.status(201).json(await service.create(body, tenantId));
    }),
  );

  // GET /api/v1/team/:id — single member (owner/manager only).
  router.get(
    "/:id",
    handler(async (req, res) => {
      res.json(await service.get(String(req.params.id), requireManagement(res)));
    }),
  );

  // ── Time clock (self-or-management) ─────────────────────────────────────────

  // POST /api/v1/team/:id/clock-in — open a time entry (409 if one is open).
  router.post(
    "/:id/clock-in",
    handler(async (req, res) => {
      const userId = String(req.params.id);
      const tenantId = requireSelfOrManagement(res, userId);
      res.status(201).json(await service.clockIn(tenantId, userId));
    }),
  );

  // POST /api/v1/team/:id/clock-out — close the open time entry (409 if none).
  router.post(
    "/:id/clock-out",
    handler(async (req, res) => {
      const userId = String(req.params.id);
      const tenantId = requireSelfOrManagement(res, userId);
      res.json(await service.clockOut(tenantId, userId));
    }),
  );

  // GET /api/v1/team/:id/time-entries — recent entries, newest first.
  router.get(
    "/:id/time-entries",
    handler(async (req, res) => {
      const userId = String(req.params.id);
      const tenantId = requireSelfOrManagement(res, userId);
      const limit = Number(req.query["limit"] ?? 100);
      res.json({ items: await service.listTimeEntries(tenantId, userId, Number.isFinite(limit) ? limit : 100) });
    }),
  );

  // ── Per-member permission surface (self-or-management), delegating to the
  //    permission_requests module which owns both tables. ─────────────────────

  // GET /api/v1/team/:id/permission-requests
  router.get(
    "/:id/permission-requests",
    handler(async (req, res) => {
      const userId = String(req.params.id);
      const tenantId = requireSelfOrManagement(res, userId);
      res.json(await permissionRequests.listForUser(tenantId, userId));
    }),
  );

  // GET /api/v1/team/:id/permission-overrides
  router.get(
    "/:id/permission-overrides",
    handler(async (req, res) => {
      const userId = String(req.params.id);
      const tenantId = requireSelfOrManagement(res, userId);
      res.json(await permissionRequests.listOverridesForUser(tenantId, userId));
    }),
  );
}
