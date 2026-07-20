import type { Router, Request, Response, NextFunction } from "express";
import { z } from "zod";
import { handler, parseBody, notFound, badRequest } from "../../shared/http.js";
import type { CatalogService, ProductStatus, TaxClass, VariantChannel, VariantSortMode, PriceTarget, PriceOp } from "./service.js";
import { VARIANT_SORT_MODES, PRICE_OPS } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";
import { requireRole } from "../../gateway/auth.js";
import { parseCsv, toCsv } from "../../shared/csv.js";
import type { DB } from "../../shared/db.js";

const taxClassSchema = z.enum(["standard", "exempt"]);
const statusSchema = z.enum(["active", "draft", "archived"]);

const PRODUCT_STATUSES: readonly ProductStatus[] = ["active", "draft", "archived"];

function readStatusFilter(value: unknown): ProductStatus | undefined {
  if (typeof value !== "string" || value === "") return undefined;
  if (!PRODUCT_STATUSES.includes(value as ProductStatus)) {
    throw badRequest(
      `invalid status '${value}'; expected one of ${PRODUCT_STATUSES.join(", ")}`,
    );
  }
  return value as ProductStatus;
}

// Product detail fields — all optional/nullable. Groups mirror the Product interface.
const detailFieldsSchema = {
  // Descriptive
  description: z.string().nullable().optional(),
  short_description: z.string().nullable().optional(),
  full_description: z.string().nullable().optional(),
  alternative_name: z.string().nullable().optional(),
  model_name: z.string().nullable().optional(),
  manufacturer: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  tags: z.string().nullable().optional(),           // comma-separated
  url_alias: z.string().nullable().optional(),
  // Pricing
  msrp_cents: z.number().int().nonnegative().nullable().optional(),
  min_selling_price_cents: z.number().int().nonnegative().nullable().optional(),
  raw_cost_price_cents: z.number().int().nonnegative().nullable().optional(),
  wholesale_price_cents: z.number().int().nonnegative().nullable().optional(),
  enterprise_price_cents: z.number().int().nonnegative().nullable().optional(),
  // Physical dimensions (integers in base units)
  length_mm: z.number().int().positive().nullable().optional(),
  width_mm: z.number().int().positive().nullable().optional(),
  height_mm: z.number().int().positive().nullable().optional(),
  weight_grams: z.number().int().positive().nullable().optional(),
  size: z.string().nullable().optional(),
  unit_description: z.string().nullable().optional(),
  nicotine_strength_mg: z.number().int().nonnegative().nullable().optional(),
  volume_ml: z.number().int().positive().nullable().optional(),
  oz_per_product_x100: z.number().int().nonnegative().nullable().optional(),
  // Media
  image_url: z.string().url().nullable().optional(),
  // Compliance / regulatory
  state_description: z.string().nullable().optional(),
  federal_description: z.string().nullable().optional(),
  msa_category_code: z.string().nullable().optional(),
  msa_promotion_indicator: z.boolean().optional(),
  msa_promotion_description: z.string().nullable().optional(),
  msa_manufacturer_description: z.string().nullable().optional(),
  // SEO
  meta_title: z.string().nullable().optional(),
  meta_keywords: z.string().nullable().optional(),
  meta_description: z.string().nullable().optional(),
  // Vendor / supply chain
  preferred_vendor_id: z.string().min(1).nullable().optional(),
  preferred_vendor_name: z.string().nullable().optional(),
  primary_vendor: z.string().nullable().optional(),
  vendor_upc: z.string().min(1).nullable().optional(),
  drop_shipment: z.boolean().optional(),
  reorder_quantity: z.number().int().positive().nullable().optional(),
  // Qty limits
  min_qty_to_sell: z.number().int().positive().nullable().optional(),
  max_qty_to_sell: z.number().int().positive().nullable().optional(),
  qty_increment: z.number().int().positive().optional(),
  // Variant (BE-8)
  parent_product_id: z.string().min(1).nullable().optional(),
  variant_label: z.string().min(1).nullable().optional(),
  // Structured attribute map, JSON object of attribute name -> value.
  variant_options: z
    .string()
    .refine((s) => {
      try {
        const o = JSON.parse(s) as unknown;
        return Boolean(o) && typeof o === "object" && !Array.isArray(o) &&
          Object.values(o as Record<string, unknown>).every((v) => typeof v === "string");
      } catch { return false; }
    }, { message: "variant_options must be a JSON object mapping attribute name to value" })
    .nullable()
    .optional(),
  // Operational flags
  age_restricted: z.boolean().optional(),
  returnable: z.boolean().optional(),
  service_product: z.boolean().optional(),
  customer_specific: z.boolean().optional(),
  exclude_from_po: z.boolean().optional(),
  composite_product: z.boolean().optional(),
  track_inventory: z.boolean().optional(),
  track_inventory_by_imei: z.boolean().optional(),
  // Ecommerce visibility flag (toggled by ecommerce module)
  ecommerce: z.boolean().optional(),
};

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  category: z.string().min(1).optional(),
  tax_class: taxClassSchema.optional(),
  barcode: z.string().min(1).nullable().optional(),
  status: statusSchema.optional(),
  ...detailFieldsSchema,
});

const updateFieldsSchema = z.object({
  sku: z.string().min(1).optional(),
  name: z.string().min(1).optional(),
  price_cents: z.number().int().nonnegative().optional(),
  category: z.string().min(1).optional(),
  tax_class: taxClassSchema.optional(),
  barcode: z.string().min(1).nullable().optional(),
  status: statusSchema.optional(),
  ...detailFieldsSchema,
});

const updateSchema = updateFieldsSchema.refine((o) => Object.keys(o).length > 0, {
  message: "at least one field is required",
});

const bulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
  update: updateFieldsSchema.refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  }),
});
const bulkPriceSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1).max(500),
    target: z.enum(["selling", "cost"]),
    op: z.enum(PRICE_OPS as unknown as [string, ...string[]]),
    value: z.number().nonnegative().optional(),
  })
  .refine((o) => o.op === "round_99" || o.op === "round_95" || o.value !== undefined, {
    message: "value is required for this operation",
  });

const importCsvSchema = z.object({
  csv: z.string().min(1),
});

const bulkBarcodesSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(500),
});

// BE-7: column order for CSV export — mirrors the columns importCsv accepts
// (sku/name/priceCents/category/barcode) plus the rest of the product shape.
const EXPORT_COLUMNS = [
  "id", "sku", "name", "price_cents", "category", "tax_class", "barcode", "status",
  "description", "brand", "length_mm", "width_mm", "height_mm", "weight_grams",
  "image_url", "preferred_vendor_id", "vendor_upc", "min_qty_to_sell", "max_qty_to_sell",
  "qty_increment", "parent_product_id", "variant_label",
];

const createCategorySchema = z.object({
  name: z.string().min(1),
  parent_id: z.string().min(1).nullable().optional(),
});

const updateCategorySchema = z
  .object({
    name: z.string().min(1).optional(),
    parent_id: z.string().min(1).nullable().optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
  });

const setProductCategoriesSchema = z.object({
  categoryIds: z.array(z.string().min(1)),
});

const assignVariantsSchema = z.object({
  productIds: z.array(z.string().min(1)).min(1),
  label: z.string().min(1).nullable().optional(),
  variant_label: z.string().min(1).nullable().optional(),
});

const generateVariantsSchema = z.object({
  attributes: z
    .array(
      z.object({
        name: z.string().min(1),
        values: z.array(z.string().min(1)).min(1).max(50),
      }),
    )
    .min(1)
    .max(5),
  // Value combinations to skip (removed/disabled in the preview), each a list of
  // attribute values. Matched order-independently against the generated matrix.
  exclude: z.array(z.array(z.string().min(1))).max(200).optional(),
});
const channelSchema = z.enum(["online", "offline"]);
const reorderVariantsSchema = z.object({
  channel: channelSchema,
  orderedIds: z.array(z.string().min(1)).min(1).max(500),
});
const variantSortSchema = z.object({
  channel: channelSchema,
  mode: z.enum(VARIANT_SORT_MODES as unknown as [string, ...string[]]),
});

const createVariantSchema = z.object({
  variant_label: z.string().min(1),
  upc: z.string().min(1),
  sku: z.string().min(1),
  selling_price_cents: z.number().int().nonnegative(),
  category: z.string().min(1),
});

function parseInt0(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function readQuery(req: Request) {
  const category = typeof req.query.category === "string" ? req.query.category : undefined;
  const status = readStatusFilter(req.query.status);
  return {
    category,
    status,
    limit: parseInt0(req.query.limit),
    offset: parseInt0(req.query.offset),
    excludeMasters: req.query.excludeMasters === "true",
  };
}

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
}

function actorId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).userId;
}

const importSchema = z.object({
  items: z
    .array(
      z.object({
        sku: z.string().min(1),
        name: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
        barcode: z.string().min(1).nullable().optional(),
        category: z.string().min(1).optional(),
        barcodes: z
          .array(z.object({ barcode: z.string().min(1), kind: z.string().min(1).optional(), packSize: z.number().int().positive().optional() }))
          .optional(),
      }),
    )
    .min(1)
    .max(2000),
});

// ── Retail package isolation (strict business-package separation) ─────────────
// Wholesale-only pricing lives on the shared product entity for wholesale/hybrid
// tenants, but must never surface for tenants without the `wholesale` capability:
// not in any catalog response, and not writable through any catalog input. UI
// hiding is not a boundary (the capabilities context deliberately fails open), so
// the API is scrubbed here — a retail user should never learn these fields exist.
// Data is untouched: columns keep their values; only the API surface is scoped.
const WHOLESALE_ONLY_FIELDS: readonly string[] = [
  "wholesale_price_cents",
  "enterprise_price_cents",
  "customer_specific",
];

/** Recursively remove wholesale-only keys from a response/request payload. */
function scrubWholesaleDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubWholesaleDeep);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (WHOLESALE_ONLY_FIELDS.includes(key)) continue;
      out[key] = scrubWholesaleDeep(val);
    }
    return out;
  }
  return value;
}

/**
 * Router-level guard: one indexed lookup per request (same cost class as
 * requirePlan). Fail-closed — if the capability cannot be confirmed, the tenant
 * is treated as retail-only and the fields are scrubbed. Inputs are stripped
 * silently (a 400 naming the field would reveal that it exists).
 */
function wholesaleFieldIsolation() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const auth = res.locals["auth"] as AuthPayload | undefined;
    const db = res.locals["db"] as DB | undefined;
    let wholesaleEnabled = false;
    if (auth?.tenantId && db) {
      try {
        const row = await db.one<{ enabled: boolean | number }>(
          "SELECT enabled FROM tenant_capabilities WHERE tenant_id = @t AND capability = 'wholesale' LIMIT 1",
          { t: auth.tenantId },
        );
        wholesaleEnabled = row ? row.enabled === true || row.enabled === 1 : false;
      } catch {
        wholesaleEnabled = false;
      }
    }
    if (!wholesaleEnabled) {
      if (req.body !== null && typeof req.body === "object") {
        req.body = scrubWholesaleDeep(req.body);
      }
      const json = res.json.bind(res);
      res.json = ((body: unknown) => json(scrubWholesaleDeep(body))) as typeof res.json;
    }
    next();
  };
}

export function registerRoutes(router: Router, service: CatalogService): void {
  router.use(wholesaleFieldIsolation());

  // Bulk import / upsert by SKU (owner/manager only). For catalog onboarding.
  router.post(
    "/import",
    handler(async (req, res) => {
      const role = (res.locals["auth"] as AuthPayload).role;
      if (role !== "owner" && role !== "manager") {
        throw badRequest("catalog import requires owner or manager");
      }
      const body = parseBody(importSchema, req.body);
      res.status(200).json(await service.bulkImport(body.items, (res.locals["auth"] as AuthPayload).tenantId));
    }),
  );

  // BE-7: bulk field update across many SKUs (manager-gated).
  router.post(
    "/bulk-update",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(bulkUpdateSchema, req.body);
      const update = {
        ...body.update,
        tax_class: body.update.tax_class as TaxClass | undefined,
        status: body.update.status as ProductStatus | undefined,
      };
      const items = await service.bulkUpdate(body.ids, update, tenantId(res));
      res.json({ updated: items.length, items });
    }),
  );

  // Bulk price/cost adjustment computed per product (increase/decrease by % or fixed
  // amount, set exact, round to .99/.95) — for the Matrix Builder bulk toolbar.
  router.post(
    "/bulk-price",
    requireRole("manager"),
    handler(async (req, res) => {
      const b = parseBody(bulkPriceSchema, req.body);
      const items = await service.bulkAdjustPrice(b.ids, b.target as PriceTarget, b.op as PriceOp, b.value ?? 0, tenantId(res));
      res.json({ updated: items.length, items });
    }),
  );

  // BE-7: CSV export of the full catalog.
  router.get(
    "/export",
    handler(async (_req, res) => {
      const items = await service.listAll(tenantId(res));
      const csv = toCsv(items as unknown as Array<Record<string, unknown>>, EXPORT_COLUMNS);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="catalog.csv"');
      res.status(200).send(csv);
    }),
  );

  // BE-7: CSV import (upsert by SKU), manager/owner only — wraps bulkImport.
  router.post(
    "/import-csv",
    handler(async (req, res) => {
      const role = (res.locals["auth"] as AuthPayload).role;
      if (role !== "owner" && role !== "manager") {
        throw badRequest("catalog import requires owner or manager");
      }
      const body = parseBody(importCsvSchema, req.body);
      const rows = parseCsv(body.csv);
      const items = rows.map((row) => ({
        sku: row.sku ?? "",
        name: row.name ?? "",
        priceCents: Number(row.priceCents ?? row.price_cents ?? 0),
        category: row.category || undefined,
        barcode: row.barcode || undefined,
      }));
      const invalid = items.find((it) => !it.sku || !it.name || !Number.isFinite(it.priceCents));
      if (invalid) throw badRequest("each CSV row requires sku, name, and a numeric priceCents");
      res.status(200).json(await service.bulkImport(items, tenantId(res)));
    }),
  );

  // BE-7: generate barcodes for SKUs that don't have one yet (manager-gated).
  router.post(
    "/bulk-barcodes",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(bulkBarcodesSchema, req.body);
      const generated = await service.generateBarcodes(body.ids, tenantId(res));
      res.json({ generated });
    }),
  );

  router.post(
    "/",
    handler(async (req, res) => {
      const body = parseBody(createSchema, req.body);
      const product = await service.create(
        {
          ...body,
          tax_class: body.tax_class as TaxClass | undefined,
          status: body.status as ProductStatus | undefined,
        },
        tenantId(res),
        { actorId: actorId(res) },
      );
      res.status(201).json(product);
    }),
  );

  router.get(
    "/",
    handler(async (req, res) => {
      const page = await service.list(readQuery(req), tenantId(res));
      res.json(page);
    }),
  );

  // Barcode scan lookup — registered before /:id so "barcode" isn't read as an id.
  router.get(
    "/barcode/:code",
    handler(async (req, res) => {
      const code = String(req.params.code);
      const product = await service.getByBarcode(code, tenantId(res));
      if (!product) throw notFound(`no active product with barcode '${code}'`);
      res.json(product);
    }),
  );

  router.get(
    "/:id/barcodes",
    handler(async (req, res) => {
      res.json({ items: await service.listBarcodes(String(req.params.id), tenantId(res)) });
    }),
  );

  router.post(
    "/:id/barcodes",
    handler(async (req, res) => {
      const b = parseBody(
        z.object({ barcode: z.string().min(1), kind: z.string().min(1).optional(), packSize: z.number().int().positive().optional() }),
        req.body,
      );
      await service.addBarcode(String(req.params.id), b.barcode, b.kind ?? "alt", b.packSize ?? 1, tenantId(res));
      res.status(201).json({ ok: true });
    }),
  );

  // Category tree (BE-6). Registered before "/:id" so "categories" isn't read as an id.
  router.get(
    "/categories",
    handler(async (_req, res) => {
      res.json({ items: await service.listCategories(tenantId(res)) });
    }),
  );

  router.post(
    "/categories",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(createCategorySchema, req.body);
      res.status(201).json(await service.createCategory(body, tenantId(res)));
    }),
  );

  router.patch(
    "/categories/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(updateCategorySchema, req.body);
      res.json(await service.updateCategory(String(req.params.id), body, tenantId(res)));
    }),
  );

  router.delete(
    "/categories/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      await service.deleteCategory(String(req.params.id), tenantId(res));
      res.status(204).end();
    }),
  );

  // ── Product Attributes (static — registered before /:id) ────────────────────
  const createAttributeSchema = z.object({
    name: z.string().min(1),
    dataType: z.string().min(1).optional(),
    isFilterable: z.boolean().optional(),
    isVariantOption: z.boolean().optional(),
  });

  router.get(
    "/attributes",
    handler(async (_req, res) => {
      res.json({ items: await service.listAttributes(tenantId(res)) });
    }),
  );

  router.post(
    "/attributes",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(createAttributeSchema, req.body);
      res.status(201).json(await service.createAttribute(tenantId(res), body));
    }),
  );

  // DELETE /images/:imageId — static segment "images" must be before /:id
  router.delete(
    "/images/:imageId",
    requireRole("manager"),
    handler(async (req, res) => {
      await service.deleteImage(String(req.params.imageId), tenantId(res));
      res.status(204).end();
    }),
  );

  router.get(
    "/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      const product = await service.get(id, tenantId(res));
      if (!product) throw notFound(`product '${id}' not found`);
      res.json(product);
    }),
  );

  router.get(
    "/:id/categories",
    handler(async (req, res) => {
      res.json({ items: await service.listProductCategories(String(req.params.id), tenantId(res)) });
    }),
  );

  router.put(
    "/:id/categories",
    handler(async (req, res) => {
      const body = parseBody(setProductCategoriesSchema, req.body);
      await service.setProductCategories(String(req.params.id), body.categoryIds, tenantId(res));
      res.json({ ok: true });
    }),
  );

  // Append-only price-change timeline (selling + cost), newest first.
  router.get(
    "/:id/price-history",
    handler(async (req, res) => {
      const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : undefined;
      res.json({ items: await service.listPriceHistory(String(req.params.id), tenantId(res), limit) });
    }),
  );

  // Master/child variants (BE-8).
  router.get(
    "/:id/variants",
    handler(async (req, res) => {
      const channel = req.query.channel === "online" || req.query.channel === "offline" ? (req.query.channel as VariantChannel) : undefined;
      res.json({ items: await service.listVariants(String(req.params.id), tenantId(res), channel) });
    }),
  );

  // Persist a manual drag order of a master's variants for one channel (independent
  // online vs offline). Switches that channel's sort mode to 'manual'.
  router.post(
    "/:id/variants/reorder",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(reorderVariantsSchema, req.body);
      const items = await service.reorderVariants(String(req.params.id), body.channel, body.orderedIds, tenantId(res));
      res.json({ items });
    }),
  );

  // Set the sort mode for a master's variants on one channel.
  router.patch(
    "/:id/variants/sort",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(variantSortSchema, req.body);
      const items = await service.setVariantSort(String(req.params.id), body.channel, body.mode as VariantSortMode, tenantId(res));
      res.json({ items });
    }),
  );

  router.post(
    "/:id/variants",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(createVariantSchema, req.body);
      const product = await service.createVariant(String(req.params.id), body, tenantId(res));
      res.status(201).json(product);
    }),
  );

  router.post(
    "/:id/variants/assign",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(assignVariantsSchema, req.body);
      const variantLabel = body.variant_label !== undefined ? body.variant_label : body.label;
      const items = await service.assignVariants(String(req.params.id), body.productIds, tenantId(res), variantLabel);
      res.json({ ok: true, items });
    }),
  );

  router.post(
    "/:id/variants/generate",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(generateVariantsSchema, req.body);
      const items = await service.generateVariants(String(req.params.id), body.attributes, tenantId(res), body.exclude);
      res.json({ items });
    }),
  );

  router.delete(
    "/:id/variants/:childId",
    requireRole("manager"),
    handler(async (req, res) => {
      const product = await service.unlinkVariant(String(req.params.id), String(req.params.childId), tenantId(res));
      res.json(product);
    }),
  );

  router.patch(
    "/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(updateSchema, req.body);
      const product = await service.update(String(req.params.id), body, tenantId(res), { actorId: actorId(res) });
      res.json(product);
    }),
  );

  router.delete(
    "/:id",
    requireRole("manager"),
    handler(async (req, res) => {
      const product = await service.archive(String(req.params.id), tenantId(res), actorId(res));
      res.json(product);
    }),
  );

  // BE-22: compliance fields — manager-gated
  const complianceSchema = z.object({
    tobacco_type: z.string().nullable().optional(),
    flavored: z.boolean().optional(),
    menthol: z.boolean().optional(),
    msa_reportable: z.boolean().optional(),
    restricted_states: z.array(z.string().length(2)).optional(),
  });

  router.patch(
    "/:id/compliance",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(complianceSchema, req.body);
      const product = await service.updateCompliance(String(req.params.id), body, tenantId(res), actorId(res));
      res.json(product);
    }),
  );

  // ── Product Images ─────────────────────────────────────────────────────────
  const addImageSchema = z.object({
    imageUrl: z.string().url(),
    altText: z.string().nullable().optional(),
    sortOrder: z.number().int().nonnegative().optional(),
    isPrimary: z.boolean().optional(),
  });

  router.get(
    "/:id/images",
    handler(async (req, res) => {
      res.json({ items: await service.listImages(String(req.params.id), tenantId(res)) });
    }),
  );

  router.post(
    "/:id/images",
    requireRole("manager"),
    handler(async (req, res) => {
      const body = parseBody(addImageSchema, req.body);
      const img = await service.addImage(String(req.params.id), tenantId(res), body);
      res.status(201).json(img);
    }),
  );


}
