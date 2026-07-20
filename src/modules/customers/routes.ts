import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole, requireCapability } from "../../gateway/auth.js";
import type { CustomersService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

// Fields any authenticated user can supply when creating/updating a customer.
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
  bankName: z.string().nullable().optional(),
  // Retail
  dateOfBirth: z.number().int().positive().nullable().optional(),
  drivingLicenseNumber: z.string().nullable().optional(),
  // Shared
  notes: z.string().nullable().optional(),
};

// Privileged fields that require manager role — affect credit, pricing tier, and account status.
const managerFieldsSchema = {
  tier: z.number().int().min(1).max(5).optional(),
  paymentTermDays: z.number().int().nonnegative().nullable().optional(),
  creditLimitCents: z.number().int().nonnegative().nullable().optional(),
  status: z.enum(["active", "inactive"]).optional(),
  verified: z.boolean().optional(),
  achVerified: z.boolean().optional(),
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
  ...managerFieldsSchema,
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

  // GET /api/v1/customers/search?q= — merge-dialog lookup. Registered BEFORE
  // /:id so the literal "search" segment is never captured as a customer id.
  router.get(
    "/search",
    handler(async (req, res) => {
      const q = String(req.query["q"] ?? "");
      res.json(await service.search(tenantId(res), q));
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

  // POST /api/v1/customers/:id/merge — absorb a duplicate into :id. Destructive
  // (the duplicate row is deleted), so manager+ only.
  const mergeSchema = z.object({ merge_from_id: z.string().min(1) });
  router.post(
    "/:id/merge",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(mergeSchema, req.body);
      res.json(await service.merge(String(req.params.id), body.merge_from_id, tenantId(res)));
    }),
  );

  router.patch(
    "/:id",
    requireRole("manager"),
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

  // Business-account contacts are a wholesale (B2B) concept — strict package
  // separation (WP 08): tenants without the wholesale capability get 403 and
  // never learn the surface exists. Addresses/notes/loyalty stay open — those
  // are retail-legitimate (delivery, ecommerce).
  router.get("/:id/contacts", requireCapability("wholesale"), handler(async (req, res) => {
    res.json({ items: await service.listContacts(String(req.params.id), tenantId(res)) });
  }));

  router.post("/:id/contacts", requireCapability("wholesale"), handler(async (req, res) => {
    const body = parseBody(addContactSchema, req.body);
    res.status(201).json(await service.addContact(String(req.params.id), tenantId(res), body));
  }));

  router.patch("/:id/contacts/:contactId", requireCapability("wholesale"), handler(async (req, res) => {
    const body = parseBody(addContactSchema.partial(), req.body);
    res.json(await service.updateContact(String(req.params.contactId), tenantId(res), body));
  }));

  router.delete("/:id/contacts/:contactId", requireCapability("wholesale"), handler(async (req, res) => {
    await service.deleteContact(String(req.params.contactId), tenantId(res));
    res.status(204).end();
  }));

  router.patch("/:id/addresses/:addressId", handler(async (req, res) => {
    const body = parseBody(addAddressSchema.partial(), req.body);
    res.json(await service.updateAddress(String(req.params.addressId), tenantId(res), body));
  }));

  router.delete("/:id/addresses/:addressId", handler(async (req, res) => {
    await service.deleteAddress(String(req.params.addressId), tenantId(res));
    res.status(204).end();
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

  // ── Store Credit ────────────────────────────────────────────────────────────
  const storeCreditSchema = z.object({
    deltaCents: z.number().int().refine((n) => n !== 0, "deltaCents must be non-zero"),
    reason: z.string().min(1).max(200),
  });

  // GET  /:id/store-credit — current balance (any authenticated user)
  router.get("/:id/store-credit", handler(async (req, res) => {
    res.json(await service.getStoreCredit(String(req.params.id), tenantId(res)));
  }));

  // POST /:id/store-credit — apply a delta
  //   positive delta (add credit) → manager only
  //   negative delta (deduct at checkout) → cashier allowed
  router.post("/:id/store-credit", handler(async (req, res) => {
    const body = parseBody(storeCreditSchema, req.body);
    const auth = res.locals["auth"] as AuthPayload;
    // Adding credit requires manager or above; deducting is allowed for cashiers.
    if (body.deltaCents > 0 && auth.role === "cashier") {
      res.status(403).json({ error: { code: "forbidden", message: "Only managers can add store credit." } });
      return;
    }
    const result = await service.adjustStoreCredit(
      String(req.params.id),
      body.deltaCents,
      body.reason,
      tenantId(res),
    );
    res.json(result);
  }));

  // ── Customer-specific product price overrides (BE-39) ─────────────────────

  const priceOverrideSchema = z.object({
    productId: z.string().min(1),
    priceCents: z.number().int().nonnegative(),
  });

  // Customer-specific pricing is a wholesale (B2B) concept — the exact
  // "customer price levels" strict retail separation forbids. Capability-gated
  // like contacts above; retail tenants never see these routes exist.
  // GET  /:id/product-prices — list all overrides for this customer
  router.get("/:id/product-prices", requireCapability("wholesale"), handler(async (req, res) => {
    const rows = await service.listPriceOverrides(String(req.params.id), tenantId(res));
    res.json({ items: rows });
  }));

  // POST /:id/product-prices — upsert a price override (manager only)
  router.post(
    "/:id/product-prices",
    requireCapability("wholesale"),
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(priceOverrideSchema, req.body);
      const row = await service.upsertPriceOverride(
        String(req.params.id),
        body.productId,
        body.priceCents,
        tenantId(res),
      );
      res.status(201).json(row);
    }),
  );

  // DELETE /:id/product-prices/:productId — remove a price override (manager only)
  router.delete(
    "/:id/product-prices/:productId",
    requireCapability("wholesale"),
    requireRole("manager"),
    handler(async (req, res) => {
      await service.deletePriceOverride(
        String(req.params.id),
        String(req.params.productId),
        tenantId(res),
      );
      res.status(204).end();
    }),
  );

  // GET /product-prices/lookup?customerId=&productId= — price resolution at POS
  // Returns the resolved price for a customer + product combination.
  router.get("/product-prices/lookup", requireCapability("wholesale"), handler(async (req, res) => {
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const productId  = typeof req.query.productId  === "string" ? req.query.productId  : undefined;
    if (!customerId || !productId) {
      res.status(400).json({ error: { code: "bad_request", message: "customerId and productId are required" } });
      return;
    }
    const resolved = await service.resolvePriceForCustomer(customerId, productId, tenantId(res));
    res.json(resolved);
  }));
}
