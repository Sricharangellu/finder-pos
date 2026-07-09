import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound, badRequest } from "../../shared/http.js";
import type { OrdersService, OrderStatus, CourseValue } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { sendEmail } from "../../shared/email.js";
import { Money } from "../../shared/money.js";

const stateSchema = z.enum(["CA", "NY", "TX", "FL"]);

const ORDER_STATUSES: readonly OrderStatus[] = ["open", "completed", "refunded", "voided"];

function readStatusFilter(value: unknown): OrderStatus | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (!ORDER_STATUSES.includes(value as OrderStatus)) {
    throw badRequest(
      `invalid status '${value}'; expected one of ${ORDER_STATUSES.join(", ")}`,
    );
  }
  return value as OrderStatus;
}

const lineSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().positive(),
  ageVerified: z.boolean().optional(),
});

const createSchema = z.object({
  stateCode: stateSchema.optional(), // optional — POS terminal doesn't send it; defaults to "CA"
  lines: z.array(lineSchema).min(1),
  discountCents: z.number().int().nonnegative().optional(),
  customerId: z.string().min(1).nullable().optional(),
  storeId: z.string().min(1).nullable().optional(),
});

const updateSchema = z.object({
  lines: z.array(lineSchema).min(1),
  discountCents: z.number().int().nonnegative().optional(),
  customerId: z.string().min(1).nullable().optional(),
  storeId: z.string().min(1).nullable().optional(),
});

function parseInt0(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

export function registerRoutes(router: Router, service: OrdersService): void {
  router.post(
    "/",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(createSchema, req.body);
      const { storeIds } = auth(res);
      // If the user is scoped to specific stores and a storeId is provided, validate it.
      if (body.storeId && storeIds.length > 0 && !storeIds.includes(body.storeId)) {
        throw badRequest(`storeId '${body.storeId}' is not in your allowed stores`);
      }
      const order = await service.create(body, tenantId(res), auth(res).userId);
      res.status(201).json(order);
    }),
  );

  router.get(
    "/",
    handler(async (req: Request, res: Response) => {
      const status = readStatusFilter(req.query.status);
      const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
      const { storeIds } = auth(res);
      const requestedStore = typeof req.query.storeId === "string" && req.query.storeId !== "" ? req.query.storeId : undefined;
      // Users scoped to specific stores cannot query outside their allowed set.
      if (requestedStore && storeIds.length > 0 && !storeIds.includes(requestedStore)) {
        throw badRequest(`storeId '${requestedStore}' is not in your allowed stores`);
      }
      // If the user has store restrictions and no specific store filter was requested,
      // implicitly restrict to their first allowed store (prevents cross-store data leak).
      const storeId = requestedStore ?? (storeIds.length === 1 ? storeIds[0] : requestedStore);
      const page = await service.list(
        {
          status,
          limit: parseInt0(req.query.limit),
          offset: parseInt0(req.query.offset),
          cursor,
          storeId,
        },
        tenantId(res),
      );
      res.json(page);
    }),
  );

  router.get(
    "/:id",
    handler(async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const order = await service.get(id, tenantId(res));
      if (!order) throw notFound(`order '${id}' not found`);
      res.json(order);
    }),
  );

  // PUT /:id — replace cart lines (used by POS terminal on every cart change).
  router.put(
    "/:id",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(updateSchema, req.body);
      res.json(await service.update(String(req.params.id), body, tenantId(res)));
    }),
  );

  router.post(
    "/:id/refund",
    handler(async (req: Request, res: Response) => {
      res.json(await service.refund(String(req.params.id), tenantId(res), auth(res).userId));
    }),
  );

  router.post(
    "/:id/void",
    handler(async (req: Request, res: Response) => {
      res.json(await service.void(String(req.params.id), tenantId(res), auth(res).userId));
    }),
  );

  // POST /:id/email-receipt — send (or preview) an order receipt via email.
  const emailReceiptSchema = z.object({
    email: z.string().email().optional(),
    storeName: z.string().optional(),
  });

  router.post(
    "/:id/email-receipt",
    handler(async (req: Request, res: Response) => {
      const id = String(req.params.id);
      const body = parseBody(emailReceiptSchema, req.body);
      const order = await service.getOrThrow(id, tenantId(res));

      const to = body.email ?? (
        order.customer_id
          ? await service.customerEmail(order.customer_id, tenantId(res))
          : null
      );
      if (!to) throw badRequest("provide an email address or attach a customer with an email");

      const storeName = body.storeName ?? process.env["STORE_NAME"] ?? "Ascend";
      const date = new Date(Number(order.created_at)).toLocaleString("en-US", { timeZone: "UTC" });
      const linesHtml = order.lines.map((l) =>
        `<tr><td style="padding:4px 8px">${l.name}</td><td style="padding:4px 8px;text-align:right">×${l.quantity}</td><td style="padding:4px 8px;text-align:right">$${Money.toDollars(Number(l.line_cents))}</td></tr>`
      ).join("\n");
      const linesText = order.lines.map((l) =>
        `  ${l.name} ×${l.quantity}   $${Money.toDollars(Number(l.line_cents))}`
      ).join("\n");

      const html = `<!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:0 auto">
<h2 style="margin-bottom:4px">${storeName}</h2>
<p style="color:#666;margin-top:0">Order #${order.order_number} &mdash; ${date}</p>
<table style="width:100%;border-collapse:collapse;margin:16px 0">
<thead><tr style="background:#f5f5f5"><th style="padding:4px 8px;text-align:left">Item</th><th style="padding:4px 8px;text-align:right">Qty</th><th style="padding:4px 8px;text-align:right">Amount</th></tr></thead>
<tbody>${linesHtml}</tbody>
<tfoot>
<tr><td colspan="2" style="padding:4px 8px;text-align:right;color:#666">Subtotal</td><td style="padding:4px 8px;text-align:right">$${Money.toDollars(Number(order.subtotal_cents))}</td></tr>
<tr><td colspan="2" style="padding:4px 8px;text-align:right;color:#666">Tax</td><td style="padding:4px 8px;text-align:right">$${Money.toDollars(Number(order.tax_cents))}</td></tr>
<tr style="font-weight:bold"><td colspan="2" style="padding:6px 8px;text-align:right">Total</td><td style="padding:6px 8px;text-align:right">$${Money.toDollars(Number(order.total_cents))}</td></tr>
</tfoot></table>
<p style="color:#888;font-size:12px">Thank you for shopping with ${storeName}.</p>
</body></html>`;

      const text = [
        `${storeName}`,
        `Order #${order.order_number} — ${date}`,
        ``,
        linesText,
        ``,
        `  Subtotal  $${Money.toDollars(Number(order.subtotal_cents))}`,
        `  Tax       $${Money.toDollars(Number(order.tax_cents))}`,
        `  Total     $${Money.toDollars(Number(order.total_cents))}`,
        ``,
        `Thank you for shopping with ${storeName}.`,
      ].join("\n");

      const from = process.env["EMAIL_FROM"] ?? `receipts@${storeName.toLowerCase().replace(/\s+/g, "")}.com`;
      const result = await sendEmail({ to, from, subject: `Your receipt from ${storeName} — Order #${order.order_number}`, text, html });
      res.json({ sent: result.sent, to, orderId: id, ...(result.preview ? { preview: result.preview } : {}) });
    }),
  );

  // PATCH /:id/lines/:lineId/course — BE-R3: assign a restaurant course to an order line.
  const courseSchema = z.object({
    course: z.enum(["appetizer", "main", "dessert", "drinks"]),
  });

  router.patch(
    "/:id/lines/:lineId/course",
    handler(async (req: Request, res: Response) => {
      const { course } = parseBody(courseSchema, req.body);
      res.json(await service.assignCourse(String(req.params.id), String(req.params.lineId), course as CourseValue, tenantId(res)));
    }),
  );

  // POST /:id/split — BE-R5: split an open order into N child orders.
  const splitSchema = z.union([
    z.object({ splitCount: z.number().int().min(2).max(20) }),
    z.object({ lineIds: z.array(z.array(z.string().min(1))).min(2) }),
  ]);

  router.post(
    "/:id/split",
    handler(async (req: Request, res: Response) => {
      const body = parseBody(splitSchema, req.body);
      res.status(201).json(await service.splitOrder(String(req.params.id), body, tenantId(res)));
    }),
  );
}
