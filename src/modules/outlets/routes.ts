import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import type { OutletsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const outletSchema = z.object({ name: z.string().min(1), timezone: z.string().min(1).optional() });
const registerSchema = z.object({ name: z.string().min(1) });
const statusSchema = z.object({ status: z.enum(["open", "closed"]) });

export function registerRoutes(router: Router, service: OutletsService): void {
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
}
