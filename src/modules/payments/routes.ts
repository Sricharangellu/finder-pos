import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, badRequest } from "../../shared/http.js";
import { PaymentsService } from "./service.js";
import { isStripeConfigured, getStripe } from "./stripe.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import { HttpError } from "../../shared/http.js";

const captureSchema = z.object({
  orderId: z.string().min(1),
  method: z.enum(["cash", "card", "split", "store_credit"]),
  cashCents: z.number().int().nonnegative().optional(),
  cardCents: z.number().int().nonnegative().optional(),
  tenderedCents: z.number().int().nonnegative().optional(),
  idempotencyKey: z.string().min(1).optional(),
  stripePaymentIntentId: z.string().min(1).optional(),
  // Required for store_credit payments.
  customerId: z.string().min(1).optional(),
});

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function userId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).userId;
}

export function registerRoutes(router: Router, service: PaymentsService): void {
  const mgr = requireRole("manager");

  // ── Stripe Terminal: connection token (browser SDK uses this to authenticate)
  router.post(
    "/connection-token",
    handler(async (_req, res) => {
      if (!isStripeConfigured()) {
        throw new HttpError(503, "payment_unconfigured", "Card payments require STRIPE_SECRET_KEY.");
      }
      const token = await getStripe().terminal.connectionTokens.create();
      res.json({ secret: token.secret });
    }),
  );

  // ── Stripe Terminal: create intent + present to reader (server-driven)
  router.post(
    "/terminal/start",
    handler(async (req: Request, res: Response) => {
      const { orderId } = parseBody(z.object({ orderId: z.string().min(1) }), req.body);
      const result = await service.createTerminalIntent(orderId, tenantId(res));
      res.status(201).json(result);
    }),
  );

  // ── Stripe Terminal: poll intent status until "succeeded"
  router.get(
    "/terminal/status/:intentId",
    handler(async (req: Request, res: Response) => {
      const intentId = String(req.params["intentId"]);
      if (!intentId) throw badRequest("intentId path param is required");
      const result = await service.getTerminalIntentStatus(intentId);
      res.json(result);
    }),
  );

  // ── Stripe Terminal: cancel intent (customer pressed Cancel before paying)
  router.post(
    "/terminal/cancel/:intentId",
    handler(async (req: Request, res: Response) => {
      const intentId = String(req.params["intentId"]);
      await service.cancelTerminalIntent(intentId);
      res.json({ ok: true });
    }),
  );

  // ── Capture payment (cash / card / split)
  router.post(
    "/",
    mgr,
    handler(async (req: Request, res: Response) => {
      const body = parseBody(captureSchema, req.body);
      const payment = await service.capture(body, tenantId(res), userId(res));
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
