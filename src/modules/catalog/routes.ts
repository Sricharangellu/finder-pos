import type { Router, Request, Response } from "express";
import { z } from "zod";
import { handler, parseBody, notFound, badRequest } from "../../shared/http.js";
import type { CatalogService, ProductStatus, TaxClass } from "./service.js";
import type { AuthPayload } from "../../gateway/auth.js";

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

const createSchema = z.object({
  sku: z.string().min(1),
  name: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  category: z.string().min(1).optional(),
  tax_class: taxClassSchema.optional(),
  barcode: z.string().min(1).nullable().optional(),
  status: statusSchema.optional(),
});

const updateSchema = z
  .object({
    name: z.string().min(1).optional(),
    price_cents: z.number().int().nonnegative().optional(),
    category: z.string().min(1).optional(),
    tax_class: taxClassSchema.optional(),
    barcode: z.string().min(1).nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine((o) => Object.keys(o).length > 0, {
    message: "at least one field is required",
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
  };
}

function tenantId(res: Response): string {
  return (res.locals["auth"] as AuthPayload).tenantId;
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

export function registerRoutes(router: Router, service: CatalogService): void {
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

  router.get(
    "/:id",
    handler(async (req, res) => {
      const id = String(req.params.id);
      const product = await service.get(id, tenantId(res));
      if (!product) throw notFound(`product '${id}' not found`);
      res.json(product);
    }),
  );

  router.patch(
    "/:id",
    handler(async (req, res) => {
      const body = parseBody(updateSchema, req.body);
      const product = await service.update(String(req.params.id), body, tenantId(res));
      res.json(product);
    }),
  );

  router.delete(
    "/:id",
    handler(async (req, res) => {
      const product = await service.archive(String(req.params.id), tenantId(res));
      res.json(product);
    }),
  );
}
