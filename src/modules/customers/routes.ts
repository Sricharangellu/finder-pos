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
    handler(async (req, res) => {
      const cursor = typeof req.query.cursor === "string" && req.query.cursor !== "" ? req.query.cursor : undefined;
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      res.json(await service.list(tenantId(res), { cursor, limit }));
    }),
  );

  // ── Customer Groups (static routes MUST be before /:id parameterized routes) ─
  const createGroupSchema = z.object({
    name: z.string().min(1),
    description: z.string().nullable().optional(),
  });

  router.get("/groups", handler(async (_req, res) => {
    res.json({ items: await service.listGroups(tenantId(res)) });
  }));

  router.post("/groups", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(createGroupSchema, req.body);
    res.status(201).json(await service.createGroup(tenantId(res), body));
  }));

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

  router.get("/:id/loyalty", handler(async (req, res) => {
    res.json(await service.loyaltySummary(String(req.params.id), tenantId(res)));
  }));

  // ── Loyalty tier rules (/api/v1/customers/loyalty-tiers) ──────────────────
  const tierSchema = z.object({
    name: z.string().min(1),
    tierLevel: z.number().int().min(1).max(5),
    minPoints: z.number().int().nonnegative(),
    pointMultiplier: z.number().positive().max(10),
    discountPct: z.number().nonnegative().max(100),
  });

  router.get("/loyalty-tiers", handler(async (_req, res) => {
    res.json({ items: await service.listTierRules(tenantId(res)) });
  }));

  router.put("/loyalty-tiers/:level", requireRole("manager"), handler(async (req, res) => {
    const level = parseInt(String(req.params.level), 10);
    if (isNaN(level) || level < 1 || level > 5) throw Object.assign(new Error("tier level must be 1–5"), { status: 400 });
    const body = parseBody(tierSchema, req.body);
    res.json(await service.upsertTierRule(tenantId(res), { ...body, tierLevel: level }));
  }));

  router.delete("/loyalty-tiers/:level", requireRole("manager"), handler(async (req, res) => {
    const level = parseInt(String(req.params.level), 10);
    await service.deleteTierRule(tenantId(res), level);
    res.status(204).end();
  }));

  // ── Customer Addresses ───────────────────────────────────────────────────────
  const addAddressSchema = z.object({
    addressType: z.enum(["billing", "shipping"]).optional(),
    addressLine1: z.string().nullable().optional(),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    state: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
    country: z.string().min(1).optional(),
    county: z.string().nullable().optional(),
    isDefault: z.boolean().optional(),
  });

  router.get("/:id/addresses", handler(async (req, res) => {
    res.json({ items: await service.listAddresses(String(req.params.id), tenantId(res)) });
  }));

  router.post("/:id/addresses", handler(async (req, res) => {
    const body = parseBody(addAddressSchema, req.body);
    res.status(201).json(await service.addAddress(String(req.params.id), tenantId(res), body));
  }));

  // ── Customer Contacts ────────────────────────────────────────────────────────
  const addContactSchema = z.object({
    contactName: z.string().min(1),
    title: z.string().nullable().optional(),
    email: z.string().email().nullable().optional(),
    phone: z.string().nullable().optional(),
    isPrimary: z.boolean().optional(),
  });

  router.get("/:id/contacts", handler(async (req, res) => {
    res.json({ items: await service.listContacts(String(req.params.id), tenantId(res)) });
  }));

  router.post("/:id/contacts", handler(async (req, res) => {
    const body = parseBody(addContactSchema, req.body);
    res.status(201).json(await service.addContact(String(req.params.id), tenantId(res), body));
  }));

  // ── Customer ↔ Group membership ──────────────────────────────────────────────
  router.post("/:id/groups/:groupId", requireRole("manager"), handler(async (req, res) => {
    await service.addToGroup(String(req.params.id), String(req.params.groupId), tenantId(res));
    res.status(201).json({ ok: true });
  }));

  // ── Customer Notes ───────────────────────────────────────────────────────────
  const addNoteSchema = z.object({
    note: z.string().min(1),
    noteType: z.string().min(1).optional(),
  });

  router.get("/:id/notes", handler(async (req, res) => {
    res.json({ items: await service.listNotes(String(req.params.id), tenantId(res)) });
  }));

  router.post("/:id/notes", handler(async (req, res) => {
    const body = parseBody(addNoteSchema, req.body);
    const auth = res.locals["auth"] as { userId?: string } | undefined;
    res.status(201).json(await service.addNote(String(req.params.id), tenantId(res), body.note, body.noteType, auth?.userId ?? null));
  }));
}
