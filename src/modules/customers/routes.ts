import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { CustomersService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

// All customer profile fields shared by create and update schemas.
const profileFieldsSchema = {
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().min(1).nullable().optional(),
  customerType: z.enum(["retail", "business"]).optional(),
  primaryBusiness: z.string().nullable().optional(),
  // Business profile
  company: z.string().nullable().optional(),
  dba: z.string().nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  feinNumber: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  licenseNo: z.string().nullable().optional(),
  salesRepId: z.string().nullable().optional(),
  salesRepName: z.string().nullable().optional(),
  // Compliance licenses
  tobaccoId: z.string().nullable().optional(),
  tobaccoLicenseExpiry: z.number().int().positive().nullable().optional(),
  cigaretteId: z.string().nullable().optional(),
  cigaretteLicenseExpiry: z.number().int().positive().nullable().optional(),
  vaporTaxId: z.string().nullable().optional(),
  vaporTaxExpiry: z.number().int().positive().nullable().optional(),
  salesTaxId: z.string().nullable().optional(),
  salesTaxExpiry: z.number().int().positive().nullable().optional(),
  hempLicenseNumber: z.string().nullable().optional(),
  hempLicenseExpiry: z.number().int().positive().nullable().optional(),
  // Address (structured)
  address1: z.string().nullable().optional(),
  address2: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  state: z.string().nullable().optional(),
  zip: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  county: z.string().nullable().optional(),
  // Legacy address blobs
  billingAddress: z.string().nullable().optional(),
  shippingAddress: z.string().nullable().optional(),
  // Financial
  tier: z.number().int().min(1).max(5).optional(),
  paymentTermDays: z.number().int().nonnegative().nullable().optional(),
  creditLimitCents: z.number().int().nonnegative().nullable().optional(),
  bankName: z.string().nullable().optional(),
  // Retail
  dateOfBirth: z.number().int().positive().nullable().optional(),
  drivingLicenseNumber: z.string().nullable().optional(),
  // Shared
  notes: z.string().nullable().optional(),
};

const createSchema = z.object({
  name: z.string().min(1),
  ...profileFieldsSchema,
});

const redeemSchema = z.object({
  points: z.number().int().positive(),
});

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  ...profileFieldsSchema,
  status: z.enum(["active", "inactive"]).optional(),
  verified: z.boolean().optional(),
  achVerified: z.boolean().optional(),
});

export function registerRoutes(router: Router, service: CustomersService): void {
  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const customer = await service.create(body, tenantId(res));
      res.status(201).json(customer);
    }),
  );

  router.get(
    "/",
    handler(async (_req, res) => {
      res.json({ items: await service.list(tenantId(res)) });
    }),
  );

  router.get(
    "/:id",
    handler(async (req, res) => {
      const customer = await service.get(String(req.params.id), tenantId(res));
      if (!customer) throw notFound(`customer '${req.params.id}' not found`);
      res.json(customer);
    }),
  );

  router.patch(
    "/:id",
    handler(async (req, res) => {
      const body = parseBody(updateSchema, req.body);
      res.json(await service.update(String(req.params.id), body, tenantId(res)));
    }),
  );

  router.get(
    "/:id/summary",
    handler(async (req, res) => {
      res.json(await service.summary(String(req.params.id), tenantId(res)));
    }),
  );

  router.get(
    "/:id/financials",
    handler(async (req, res) => {
      res.json(await service.financials(String(req.params.id), tenantId(res)));
    }),
  );

  router.post(
    "/:id/redeem",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(redeemSchema, req.body);
      const result = await service.redeem(String(req.params.id), body.points, tenantId(res));
      res.json(result);
    }),
  );
}
