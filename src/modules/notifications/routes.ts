import type { Router, Response, Request } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import { requireRole } from "../../gateway/auth.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { NotificationsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function readInt(val: unknown, fallback: number): number {
  const n = Number(val);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

const createSchema = z.object({
  type: z.enum(["low_stock", "overdue_invoice", "new_order", "system", "payment_failed", "reorder_point"]),
  severity: z.enum(["info", "warning", "critical"]),
  title: z.string().min(1),
  message: z.string().min(1),
});

export function registerRoutes(router: Router, service: NotificationsService): void {
  router.get(
    "/",
    handler(async (req: Request, res) => {
      const unread = req.query.unread === "true";
      const limit = readInt(req.query.limit, 25);
      const offset = readInt(req.query.offset, 0);
      res.json(await service.list(tenantId(res), { unread, limit, offset }));
    }),
  );

  router.post(
    "/mark-all-read",
    handler(async (_req, res) => {
      const count = await service.markAllRead(tenantId(res));
      res.json({ updated: count });
    }),
  );

  router.patch(
    "/:id/read",
    handler(async (req, res) => {
      const ok = await service.markRead(String(req.params.id), tenantId(res));
      if (!ok) throw notFound(`notification '${req.params.id}' not found`);
      res.json({ ok: true });
    }),
  );

  // Manual notification creation is manager+ — otherwise any cashier could post
  // spoofed notifications ("System: ...") to the tenant. Internal event-driven
  // creation (notifications/index.ts) calls the service directly and bypasses
  // this route, so it is unaffected. mark-read endpoints above stay open (a
  // user acting on their own tenant's feed).
  router.post(
    "/",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const notif = await service.create(body, tenantId(res));
      res.status(201).json(notif);
    }),
  );
}
