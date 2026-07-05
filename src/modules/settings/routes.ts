import type { Router, Response } from "express";
import { z } from "zod";
import { handler, parseBody } from "../../shared/http.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import { parseCapabilitiesImpactQuery, type SettingsService } from "./service.js";
import { MODULE_REGISTRY, BUSINESS_BUNDLES, CORE_MODULES, moduleFlag } from "../../shared/moduleRegistry.js";

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function auth(res: Response): AuthPayload {
  return res.locals["auth"] as AuthPayload;
}

const businessTypeValues = Object.keys(BUSINESS_BUNDLES) as [string, ...string[]];

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
  router.get("/capabilities", handler(async (_req, res) => res.json(await service.getCapabilities(auth(res)))));
  router.get("/capabilities/impact", handler(async (req, res) => {
    res.json(await service.getCapabilitiesImpact(auth(res), parseCapabilitiesImpactQuery(req.query as Record<string, unknown>)));
  }));

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

  // Receipt templates — per outlet
  const receiptSchema = z.object({
    headerText: z.string().max(255).optional(),
    footerText: z.string().max(255).optional(),
    contactInfo: z.string().max(255).optional(),
    returnPolicy: z.string().max(1000).optional(),
    showLogo: z.boolean().optional(),
    showBarcode: z.boolean().optional(),
    showTaxBreakdown: z.boolean().optional(),
  });

  router.get("/receipts/:outletId", handler(async (req, res) => {
    res.json(await service.getReceiptTemplate(String(req.params.outletId), tenantId(res)));
  }));

  router.post("/receipts/:outletId", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(receiptSchema, req.body);
    res.status(201).json(await service.setReceiptTemplate(String(req.params.outletId), body as Record<string, unknown>, tenantId(res)));
  }));

  router.patch("/receipts/:outletId", requireRole("manager"), handler(async (req, res) => {
    const body = parseBody(receiptSchema, req.body);
    res.json(await service.setReceiptTemplate(String(req.params.outletId), body as Record<string, unknown>, tenantId(res)));
  }));

  // ── Business Profile (module registry) ────────────────────────────────────

  /**
   * GET /settings/business-profile
   * Returns the full module registry + current enabled state for this tenant.
   */
  router.get("/business-profile", handler(async (_req, res) => {
    const t = tenantId(res);
    const [currentFlags, businessData] = await Promise.all([
      service.getFlags(t) as Promise<Record<string, unknown>>,
      service.getBusiness(t),
    ]);

    // Build enriched module list with enabled status
    const modules = MODULE_REGISTRY.map((m) => ({
      ...m,
      enabled: m.core ? true : (currentFlags[moduleFlag(m.key)] !== false),
      flagKey: moduleFlag(m.key),
    }));

    const businessType = (businessData as Record<string, unknown>)["businessType"] as string | undefined ?? "retail";

    res.json({
      businessType,
      bundles: BUSINESS_BUNDLES,
      modules,
      coreModules: Array.from(CORE_MODULES),
    });
  }));

  /**
   * POST /settings/business-profile
   * Two update shapes, matching the Business Profile settings page:
   *   { businessType, enabledModules?: string[] } — switch business type;
   *     resets module flags to the bundle (or the provided list).
   *   { moduleFlags: { [key]: boolean } } — delta update: toggle individual
   *     modules WITHOUT changing the business type or other flags. Keys may
   *     be bare module keys or "module:"-prefixed.
   * Both may be combined (type switch first, then per-module overrides).
   * Every change is audit-logged with the acting user (Settings requirement:
   * "last business-type/module changes with actor and timestamp").
   */
  router.post(
    "/business-profile",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(
        z
          .object({
            businessType: z.enum(businessTypeValues).optional(),
            enabledModules: z.array(z.string().min(1)).optional(),
            moduleFlags: z.record(z.boolean()).optional(),
          })
          .refine(
            (b) => b.businessType !== undefined || b.moduleFlags !== undefined || b.enabledModules !== undefined,
            { message: "provide businessType, enabledModules, or moduleFlags" },
          ),
        req.body,
      );

      const t = tenantId(res);
      const actorId = auth(res).userId ?? "system";
      const previous = (await service.getBusiness(t)) as { businessType?: string };
      const flagUpdates: Record<string, boolean> = {};
      let enabledModulesOut: string[] | undefined;

      if (body.businessType) {
        const bundle = BUSINESS_BUNDLES[body.businessType];

        // Start from the bundle's default modules, or the provided list for "custom"
        const desiredModules = new Set(body.enabledModules ?? bundle?.modules ?? []);

        // Core modules are always on
        for (const core of CORE_MODULES) desiredModules.add(core);

        // Build flag updates: enable desired modules, disable others
        flagUpdates["business_type_retail"] = body.businessType === "retail" || body.businessType === "hybrid";
        flagUpdates["business_type_restaurant"] = body.businessType === "restaurant";
        flagUpdates["business_type_wholesale"] = body.businessType === "wholesale" || body.businessType === "hybrid";
        flagUpdates["business_type_golf"] = body.businessType === "golf";
        // Legacy edition flags — keep compatible
        flagUpdates["groupRetailPOS"] = desiredModules.has("pos_terminal");
        flagUpdates["groupWholesale"] = desiredModules.has("sales_orders") || desiredModules.has("purchasing");
        flagUpdates["groupEnterprise"] = desiredModules.has("sso") || desiredModules.has("webhooks");

        // Set module feature flags
        for (const mod of MODULE_REGISTRY) {
          if (!mod.core) {
            flagUpdates[moduleFlag(mod.key)] = desiredModules.has(mod.key);
          }
        }

        enabledModulesOut = Array.from(desiredModules);

        // Persist the business type via the existing business KV store
        await service.setBusiness({ businessType: body.businessType }, t);
      }

      // enabledModules WITHOUT a type switch = explicit module set (mock
      // parity): enable exactly the listed modules, disable the rest.
      const moduleChanges: Record<string, boolean> = {};
      if (!body.businessType && body.enabledModules) {
        const desired = new Set(body.enabledModules);
        for (const core of CORE_MODULES) desired.add(core);
        for (const mod of MODULE_REGISTRY) {
          if (mod.core) continue;
          flagUpdates[moduleFlag(mod.key)] = desired.has(mod.key);
          moduleChanges[mod.key] = desired.has(mod.key);
        }
      }

      // Per-module delta overrides — applied on top of (or without) a type
      // switch; never resets flags that weren't named.
      if (body.moduleFlags) {
        for (const [rawKey, on] of Object.entries(body.moduleFlags)) {
          const key = rawKey.startsWith("module:") ? rawKey.slice(7) : rawKey;
          if (CORE_MODULES.has(key)) continue; // core modules cannot be disabled
          flagUpdates[moduleFlag(key)] = on;
          moduleChanges[key] = on;
        }
      }

      if (Object.keys(flagUpdates).length > 0) {
        await service.setFlags(flagUpdates, t);
      }

      // Audit trail — best-effort, never fails the mutation.
      if (body.businessType && body.businessType !== previous.businessType) {
        await service.auditBusinessProfileChange(t, actorId, "business_profile.type_changed", {
          before: { businessType: previous.businessType ?? "retail" },
          after: { businessType: body.businessType },
        });
      }
      if (Object.keys(moduleChanges).length > 0) {
        await service.auditBusinessProfileChange(t, actorId, "business_profile.modules_changed", {
          after: moduleChanges,
        });
      }

      res.json({
        ok: true,
        businessType: body.businessType ?? previous.businessType ?? "retail",
        ...(enabledModulesOut ? { enabledModules: enabledModulesOut } : {}),
        ...(Object.keys(moduleChanges).length > 0 ? { moduleChanges } : {}),
      });
    }),
  );
}
