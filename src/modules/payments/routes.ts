import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, badRequest } from "../../shared/http.js";
import { PaymentsService } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";

const captureSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum(["cash", "card", "split"]),
  cashCents: z.number().int().nonnegative().optional(),
  cardCents: z.number().int().nonnegative().optional(),
  tenderedCents: z.number().int().nonnegative().optional(),
  cardLast4: z.string().length(4).optional(), // from POS terminal UI; backend may override via card reader simulation
  idempotencyKey: z.string().min(1).optional(),
});

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

export function registerRoutes(router: Router, service: PaymentsService): void {
  router.post(
    "/",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(captureSchema, req.body);
      const payment = await service.capture(body, tenantId(res));
      res.status(201).json(payment);
    }),
  );

  router.get(
    "/",
    handler(async (req: Request, res: Response) => {
      const orderId = req.query.orderId;
      if (typeof orderId !== "string" || orderId.length === 0) {
        throw badRequest("orderId query parameter is required");
      }
      res.json(await service.listByOrder(orderId, tenantId(res)));
    }),
  );

  router.get(
    "/:id",
    handler(async (req: Request, res: Response) => {
      res.json(await service.get(String(req.params.id), tenantId(res)));
    }),
  );
}
