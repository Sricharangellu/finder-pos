import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { OutletsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function userId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).userId ?? "unknown";
}

const outletSchema = z.object({ name: z.string().min(1), timezone: z.string().min(1).optional() });
const registerSchema = z.object({ name: z.string().min(1) });
const statusSchema = z.object({ status: z.enum(["open", "closed"]) });
const openSessionSchema = z.object({ openingFloatCents: z.number().int().nonnegative().optional() });
const closeSessionSchema = z.object({
  countedCashCents: z.number().int().nonnegative(),
  closingFloatCents: z.number().int().nonnegative().optional(),
});

export function registerRoutes(router: Router, service: OutletsService): void {
  const mgr = requireRole("manager");

  // GET /api/v1/outlets — outlets with their registers (powers the store/register selector).
  router.get(
    "/",
    handler(async (_req, res) => {
      res.json({ items: await service.list(tenantId(res)) });
    }),
  );

  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(outletSchema, req.body);
      res.status(201).json(await service.createOutlet(body.name, body.timezone, tenantId(res)));
    }),
  );

  router.post(
    "/:outletId/registers",
    handler(async (req, res) => {
      const body = parseBody(registerSchema, req.body);
      res.status(201).json(await service.createRegister(String(req.params.outletId), body.name, tenantId(res)));
    }),
  );

  // Open/close a register for a trading session.
  router.post(
    "/registers/:registerId/status",
    handler(async (req, res) => {
      const body = parseBody(statusSchema, req.body);
      res.json(await service.setRegisterStatus(String(req.params.registerId), body.status, tenantId(res)));
    }),
  );

  // BE-17: full session lifecycle with opening float and cash count.
  router.post(
    "/registers/:registerId/open",
    handler(async (req, res) => {
      const body = parseBody(openSessionSchema, req.body);
      res.status(201).json(await service.openSession(String(req.params.registerId), body.openingFloatCents ?? 0, userId(res), tenantId(res)));
    }),
  );

  router.get(
    "/registers/:registerId/expected-cash",
    handler(async (req, res) => {
      res.json(await service.getExpectedCash(String(req.params.registerId), tenantId(res)));
    }),
  );

  router.post(
    "/registers/:registerId/close",
    handler(async (req, res) => {
      const body = parseBody(closeSessionSchema, req.body);
      res.json(await service.closeSession(String(req.params.registerId), body.countedCashCents, body.closingFloatCents ?? 0, tenantId(res)));
    }),
  );


  router.get(
    "/registers/:registerId/sessions",
    handler(async (req, res) => {
      const limit = req.query.limit ? Number(req.query.limit) : 20;
      res.json({ items: await service.listSessions(String(req.params.registerId), tenantId(res), limit) });
    }),
  );

  // Shifts
  router.get("/shifts/:registerId", handler(async (req, res) => {
    res.json({ items: await service.listShifts(String(req.params.registerId), tenantId(res)) });
  }));
  router.post("/shifts/open", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({ registerId: z.string().min(1), outletId: z.string().min(1), openingCash: z.number().int().nonnegative() }), req.body);
    res.status(201).json(await service.openShift(body.registerId, body.outletId, userId(res), body.openingCash, tenantId(res)));
  }));
  router.post("/shifts/:id/close", mgr, handler(async (req, res) => {
    const body = parseBody(z.object({ closingCash: z.number().int().nonnegative() }), req.body);
    res.json(await service.closeShift(String(req.params.id), userId(res), body.closingCash, tenantId(res)));
  }));
  router.post("/shifts/:shiftId/movements", handler(async (req, res) => {
    const body = parseBody(z.object({ registerId: z.string().min(1), movementType: z.enum(["cash_in","cash_out","paid_in","paid_out","safe_drop"]), amount: z.number().int().positive(), reason: z.string().nullable().optional() }), req.body);
    const auth = res.locals["auth"] as { userId: string } | undefined;
    res.status(201).json(await service.addCashMovement(String(req.params.shiftId), body.registerId, body.movementType, body.amount, body.reason ?? null, auth?.userId ?? null, tenantId(res)));
  }));
  router.get("/shifts/:shiftId/movements", handler(async (req, res) => {
    res.json({ items: await service.listCashMovements(String(req.params.shiftId), tenantId(res)) });
  }));
}
