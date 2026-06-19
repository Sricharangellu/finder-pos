import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import type { SettingsService } from "./service.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

const shippingSchema = z.object({
  name: z.string().min(1), amountCents: z.number().int().nonnegative(),
  freeLimitCents: z.number().int().nonnegative().optional(), ecommerce: z.boolean().optional(),
  sequence: z.number().int().optional(), creditAccountId: z.string().optional(), debitAccountId: z.string().optional(),
});
const termSchema = z.object({ name: z.string().min(1), daysDue: z.number().int().nonnegative(), description: z.string().optional() });
const modeSchema = z.object({ name: z.string().min(1) });
const taxSchema = z.object({ name: z.string().min(1), rateBps: z.number().int().nonnegative(), applyToCategory: z.string().optional(), state: z.string().optional() });
const flagsSchema = z.object({}).catchall(z.boolean());
const businessSchema = z.object({}).catchall(z.unknown());

export function registerRoutes(router: Router, service: SettingsService): void {
  const mgr = requireRole("manager");

  router.post("/seed", mgr, handler(async (_req, res) => res.json(await service.seedDefaults(tenantId(res)))));

  // Business profile + feature flags
  router.get("/business", handler(async (_req, res) => res.json(await service.getBusiness(tenantId(res)))));
  router.put("/business", mgr, handler(async (req, res) => res.json(await service.setBusiness(parseBody(businessSchema, req.body), tenantId(res)))));
  // PATCH is an alias for PUT — both merge into the stored KV blob.
  router.patch("/business", mgr, handler(async (req, res) => res.json(await service.setBusiness(parseBody(businessSchema, req.body), tenantId(res)))));
  router.get("/feature-flags", handler(async (_req, res) => res.json(await service.getFlags(tenantId(res)))));
  router.put("/feature-flags", mgr, handler(async (req, res) => res.json(await service.setFlags(parseBody(flagsSchema, req.body), tenantId(res)))));

  // Shipping methods
  router.get("/shipping-methods", handler(async (_req, res) => res.json({ items: await service.listShipping(tenantId(res)) })));
  router.post("/shipping-methods", mgr, handler(async (req, res) => res.status(201).json(await service.createShipping(parseBody(shippingSchema, req.body), tenantId(res)))));
  router.delete("/shipping-methods/:id", mgr, handler(async (req, res) => res.json(await service.deleteShipping(String(req.params.id), tenantId(res)))));

  // Payment terms
  router.get("/payment-terms", handler(async (_req, res) => res.json({ items: await service.listTerms(tenantId(res)) })));
  router.post("/payment-terms", mgr, handler(async (req, res) => res.status(201).json(await service.createTerm(parseBody(termSchema, req.body), tenantId(res)))));

  // Payment modes
  router.get("/payment-modes", handler(async (_req, res) => res.json({ items: await service.listModes(tenantId(res)) })));
  router.post("/payment-modes", mgr, handler(async (req, res) => res.status(201).json(await service.createMode(parseBody(modeSchema, req.body), tenantId(res)))));

  // Tax rates
  router.get("/tax-rates", handler(async (_req, res) => res.json({ items: await service.listTaxRates(tenantId(res)) })));
  router.post("/tax-rates", mgr, handler(async (req, res) => res.status(201).json(await service.createTaxRate(parseBody(taxSchema, req.body), tenantId(res)))));

  // Edition presets (BE-18)
  const editionSchema = z.object({ edition: z.enum(["retail", "wholesale", "enterprise", "hybrid"]) });
  router.post("/edition", mgr, handler(async (req, res) => {
    const { edition } = parseBody(editionSchema, req.body);
    const presets: Record<string, boolean> =
      edition === "retail"     ? { groupRetailPOS: true,  groupWholesale: false, groupEnterprise: false } :
      edition === "wholesale"  ? { groupRetailPOS: false, groupWholesale: true,  groupEnterprise: false } :
      edition === "enterprise" ? { groupRetailPOS: true,  groupWholesale: true,  groupEnterprise: true  } :
                                 { groupRetailPOS: true,  groupWholesale: true,  groupEnterprise: true  }; // hybrid
    res.json(await service.setFlags(presets, tenantId(res)));
  }));

  // Email config — sender address + optional API key label (key itself never returned).
  const emailConfigSchema = z.object({
    fromAddress: z.string().email(),
    storeName: z.string().min(1).optional(),
    provider: z.enum(["sendgrid", "webhook", "none"]).optional(),
    webhookUrl: z.string().url().optional(),
  });

  router.get("/email-config", mgr, handler(async (_req, res) => {
    const cfg = await service.getBusiness(tenantId(res));
    const { email_from, email_store_name, email_provider, email_webhook_url } = cfg;
    res.json({ fromAddress: email_from ?? null, storeName: email_store_name ?? null, provider: email_provider ?? "none", webhookUrl: email_webhook_url ?? null });
  }));

  router.put("/email-config", mgr, handler(async (req, res) => {
    const body = parseBody(emailConfigSchema, req.body);
    await service.setBusiness({
      email_from: body.fromAddress,
      email_store_name: body.storeName,
      email_provider: body.provider ?? "none",
      email_webhook_url: body.webhookUrl,
    }, tenantId(res));
    res.json({ ok: true });
  }));

  // Currencies
  router.get("/currencies", handler(async (_req, res) => {
    res.json({ items: await service.listCurrencies(tenantId(res)) });
  }));
}
