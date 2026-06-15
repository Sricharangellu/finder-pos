import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Cents } from "../../shared/money.js";
import type { Page } from "../../shared/types.js";
import { notFound, conflict } from "../../shared/http.js";

export type TaxClass = "standard" | "exempt";
export type ProductStatus = "active" | "draft" | "archived";

export interface Product {
  id: string;
  tenant_id: string;
  sku: string;
  name: string;
  price_cents: Cents;
  category: string;
  tax_class: TaxClass;
  barcode: string | null;
  status: ProductStatus;
  created_at: number;
  updated_at: number;
  description: string | null;
  brand: string | null;
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  weight_grams: number | null;
  image_url: string | null;
  preferred_vendor_id: string | null;
  vendor_upc: string | null;
  min_qty_to_sell: number | null;
  max_qty_to_sell: number | null;
  qty_increment: number;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  price_cents: Cents;
  category?: string;
  tax_class?: TaxClass;
  barcode?: string | null;
  status?: ProductStatus;
  description?: string | null;
  brand?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_grams?: number | null;
  image_url?: string | null;
  preferred_vendor_id?: string | null;
  vendor_upc?: string | null;
  min_qty_to_sell?: number | null;
  max_qty_to_sell?: number | null;
  qty_increment?: number;
}

export interface UpdateProductInput {
  name?: string;
  price_cents?: Cents;
  category?: string;
  tax_class?: TaxClass;
  barcode?: string | null;
  status?: ProductStatus;
  description?: string | null;
  brand?: string | null;
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_grams?: number | null;
  image_url?: string | null;
  preferred_vendor_id?: string | null;
  vendor_upc?: string | null;
  min_qty_to_sell?: number | null;
  max_qty_to_sell?: number | null;
  qty_increment?: number;
}

export interface Category {
  id: string;
  tenant_id: string;
  name: string;
  parent_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface CreateCategoryInput {
  name: string;
  parent_id?: string | null;
}

export interface UpdateCategoryInput {
  name?: string;
  parent_id?: string | null;
}

export interface ListProductsQuery {
  category?: string;
  status?: ProductStatus;
  limit?: number;
  offset?: number;
}

/**
 * Tax rule from CONTRACTS.md: products in the 'groceries' category are always
 * tax-exempt. Otherwise the caller's tax_class is respected, defaulting to
 * 'standard' (caller may explicitly choose 'exempt').
 */
function resolveTaxClass(category: string, requested?: TaxClass): TaxClass {
  if (category === "groceries") return "exempt";
  return requested ?? "standard";
}

export class CatalogService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateProductInput, tenantId: string): Promise<Product> {
    const existing = await this.db.one(
      "SELECT id FROM products WHERE tenant_id = @tenantId AND sku = @sku",
      { tenantId, sku: input.sku },
    );
    if (existing) {
      throw conflict(`product with sku '${input.sku}' already exists`);
    }

    const now = Date.now();
    const category = input.category ?? "general";
    const product: Product = {
      id: `prod_${uuidv7()}`,
      tenant_id: tenantId,
      sku: input.sku,
      name: input.name,
      price_cents: input.price_cents,
      category,
      tax_class: resolveTaxClass(category, input.tax_class),
      barcode: input.barcode ?? null,
      status: input.status ?? "active",
      created_at: now,
      updated_at: now,
      description: input.description ?? null,
      brand: input.brand ?? null,
      length_mm: input.length_mm ?? null,
      width_mm: input.width_mm ?? null,
      height_mm: input.height_mm ?? null,
      weight_grams: input.weight_grams ?? null,
      image_url: input.image_url ?? null,
      preferred_vendor_id: input.preferred_vendor_id ?? null,
      vendor_upc: input.vendor_upc ?? null,
      min_qty_to_sell: input.min_qty_to_sell ?? null,
      max_qty_to_sell: input.max_qty_to_sell ?? null,
      qty_increment: input.qty_increment ?? 1,
    };

    try {
      await this.db.query(
        `INSERT INTO products
           (id, tenant_id, sku, name, price_cents, category, tax_class, barcode, status, created_at, updated_at,
            description, brand, length_mm, width_mm, height_mm, weight_grams, image_url,
            preferred_vendor_id, vendor_upc, min_qty_to_sell, max_qty_to_sell, qty_increment)
         VALUES
           (@id, @tenant_id, @sku, @name, @price_cents, @category, @tax_class, @barcode, @status, @created_at, @updated_at,
            @description, @brand, @length_mm, @width_mm, @height_mm, @weight_grams, @image_url,
            @preferred_vendor_id, @vendor_upc, @min_qty_to_sell, @max_qty_to_sell, @qty_increment)`,
        product as unknown as Record<string, unknown>,
      );
    } catch (err) {
      // The pre-check above handles the common case, but two concurrent creates
      // can both pass it and race to INSERT. The (tenant_id, sku) UNIQUE constraint
      // is the real guard: translate its violation (Postgres code 23505) into a clean
      // 409 instead of leaking a raw driver error as a 500.
      if (isUniqueViolation(err)) {
        throw conflict(`product with sku '${input.sku}' already exists`);
      }
      throw err;
    }

    await this.events.publish(
      "product.created",
      {
        id: product.id,
        sku: product.sku,
        name: product.name,
        priceCents: product.price_cents,
        category: product.category,
        taxClass: product.tax_class,
      },
      product.id,
    );

    return product;
  }

  async get(id: string, tenantId: string): Promise<Product | undefined> {
    return this.db.one<Product>(
      "SELECT * FROM products WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
  }

  async getOrThrow(id: string, tenantId: string): Promise<Product> {
    const product = await this.get(id, tenantId);
    if (!product) throw notFound(`product '${id}' not found`);
    return product;
  }

  /** Bulk upsert products by (tenant_id, sku). Used for catalog import.
   *  Updates name/price/barcode/category on conflict; tenant-scoped. */
  async bulkImport(
    items: Array<{
      sku: string; name: string; priceCents: number; barcode?: string | null; category?: string;
      barcodes?: Array<{ barcode: string; kind?: string; packSize?: number }>;
    }>,
    tenantId: string,
  ): Promise<{ imported: number; barcodes: number }> {
    if (items.length === 0) return { imported: 0, barcodes: 0 };
    const now = Date.now();
    let barcodeCount = 0;
    await this.db.tx(async (tdb) => {
      for (const it of items) {
        const category = it.category && it.category.trim() ? it.category.trim() : "general";
        const taxClass = category.toLowerCase() === "groceries" ? "exempt" : "standard";
        const rows = await tdb.query<{ id: string }>(
          `INSERT INTO products (id, tenant_id, sku, name, price_cents, category, tax_class, barcode, status, created_at, updated_at)
           VALUES (@id, @t, @sku, @name, @price, @category, @tax, @barcode, 'active', @now, @now)
           ON CONFLICT (tenant_id, sku) DO UPDATE SET
             name = EXCLUDED.name, price_cents = EXCLUDED.price_cents,
             barcode = EXCLUDED.barcode, category = EXCLUDED.category, updated_at = EXCLUDED.updated_at
           RETURNING id`,
          { id: `prod_${uuidv7()}`, t: tenantId, sku: it.sku, name: it.name, price: Math.max(0, Math.round(it.priceCents)), category, tax: taxClass, barcode: it.barcode ?? null, now },
        );
        const productId = rows[0]?.id;
        if (!productId) continue;
        const allBarcodes = [
          ...(it.barcode ? [{ barcode: it.barcode, kind: "each", packSize: 1 }] : []),
          ...(it.barcodes ?? []),
        ];
        for (const b of allBarcodes) {
          if (!b.barcode) continue;
          const r = await tdb.query<{ barcode: string }>(
            `INSERT INTO product_barcodes (tenant_id, product_id, barcode, kind, pack_size)
             VALUES (@t, @pid, @bc, @kind, @ps)
             ON CONFLICT (tenant_id, barcode) DO NOTHING RETURNING barcode`,
            { t: tenantId, pid: productId, bc: b.barcode, kind: b.kind ?? "alt", ps: b.packSize ?? 1 },
          );
          barcodeCount += r.length;
        }
      }
    });
    return { imported: items.length, barcodes: barcodeCount };
  }

  /** Look up a sellable product by ANY of its UPCs (each/single/box/case/vendor),
   *  falling back to the legacy products.barcode column. Active products only. */
  async getByBarcode(barcode: string, tenantId: string): Promise<Product | undefined> {
    const viaTable = await this.db.one<Product>(
      `SELECT p.* FROM products p
         JOIN product_barcodes pb ON pb.product_id = p.id AND pb.tenant_id = p.tenant_id
        WHERE pb.tenant_id = @tenantId AND pb.barcode = @barcode AND p.status = 'active'
        LIMIT 1`,
      { tenantId, barcode },
    );
    if (viaTable) return viaTable;
    return this.db.one<Product>(
      "SELECT * FROM products WHERE tenant_id = @tenantId AND barcode = @barcode AND status = 'active' LIMIT 1",
      { tenantId, barcode },
    );
  }

  /** All UPCs registered for a product. */
  async listBarcodes(productId: string, tenantId: string): Promise<Array<{ barcode: string; kind: string; pack_size: number }>> {
    return this.db.query("SELECT barcode, kind, pack_size FROM product_barcodes WHERE tenant_id = @tenantId AND product_id = @productId ORDER BY kind", { tenantId, productId });
  }

  /** Register an additional UPC for a product. */
  async addBarcode(productId: string, barcode: string, kind: string, packSize: number, tenantId: string): Promise<void> {
    await this.getOrThrow(productId, tenantId); // ensure product exists in-tenant
    await this.db.query(
      `INSERT INTO product_barcodes (tenant_id, product_id, barcode, kind, pack_size) VALUES (@t,@pid,@bc,@kind,@ps)
       ON CONFLICT (tenant_id, barcode) DO UPDATE SET product_id = EXCLUDED.product_id, kind = EXCLUDED.kind, pack_size = EXCLUDED.pack_size`,
      { t: tenantId, pid: productId, bc: barcode, kind, ps: packSize },
    );
  }

  async list(query: ListProductsQuery = {}, tenantId: string): Promise<Page<Product>> {
    const limit = clampLimit(query.limit);
    const offset = query.offset && query.offset > 0 ? Math.floor(query.offset) : 0;

    const where: string[] = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (query.category) {
      where.push("category = @category");
      params.category = query.category;
    }
    if (query.status) {
      where.push("status = @status");
      params.status = query.status;
    }
    const whereSql = `WHERE ${where.join(" AND ")}`;

    const totalRow = await this.db.one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM products ${whereSql}`,
      params,
    );
    const total = totalRow?.n ?? 0;

    const items = await this.db.query<Product>(
      `SELECT * FROM products ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT @limit OFFSET @offset`,
      { ...params, limit, offset },
    );

    return { items, total, limit, offset };
  }

  async update(id: string, input: UpdateProductInput, tenantId: string): Promise<Product> {
    const current = await this.getOrThrow(id, tenantId);

    const next: Product = { ...current };
    const changed: Partial<Product> = {};

    if (input.name !== undefined && input.name !== current.name) {
      next.name = input.name;
      changed.name = input.name;
    }
    if (input.price_cents !== undefined && input.price_cents !== current.price_cents) {
      next.price_cents = input.price_cents;
      changed.price_cents = input.price_cents;
    }
    if (input.barcode !== undefined && (input.barcode ?? null) !== current.barcode) {
      next.barcode = input.barcode ?? null;
      changed.barcode = next.barcode;
    }
    if (input.status !== undefined && input.status !== current.status) {
      next.status = input.status;
      changed.status = input.status;
    }

    const nextCategory = input.category ?? current.category;
    if (input.category !== undefined && input.category !== current.category) {
      next.category = input.category;
      changed.category = input.category;
    }
    const resolvedTax = resolveTaxClass(nextCategory, input.tax_class ?? current.tax_class);
    if (resolvedTax !== current.tax_class) {
      next.tax_class = resolvedTax;
      changed.tax_class = resolvedTax;
    }

    const detailFields = [
      "description", "brand", "length_mm", "width_mm", "height_mm", "weight_grams",
      "image_url", "preferred_vendor_id", "vendor_upc", "min_qty_to_sell", "max_qty_to_sell", "qty_increment",
    ] as const;
    for (const field of detailFields) {
      const value = input[field];
      if (value !== undefined && value !== current[field]) {
        (next as unknown as Record<string, unknown>)[field] = value;
        (changed as unknown as Record<string, unknown>)[field] = value;
      }
    }

    if (Object.keys(changed).length === 0) {
      return current;
    }

    next.updated_at = Date.now();

    await this.db.query(
      `UPDATE products SET
         name = @name,
         price_cents = @price_cents,
         category = @category,
         tax_class = @tax_class,
         barcode = @barcode,
         status = @status,
         description = @description,
         brand = @brand,
         length_mm = @length_mm,
         width_mm = @width_mm,
         height_mm = @height_mm,
         weight_grams = @weight_grams,
         image_url = @image_url,
         preferred_vendor_id = @preferred_vendor_id,
         vendor_upc = @vendor_upc,
         min_qty_to_sell = @min_qty_to_sell,
         max_qty_to_sell = @max_qty_to_sell,
         qty_increment = @qty_increment,
         updated_at = @updated_at
       WHERE id = @id`,
      next as unknown as Record<string, unknown>,
    );

    await this.events.publish("product.updated", { id: next.id, ...changed }, next.id);

    return next;
  }

  /** Soft delete: archive the product. */
  async archive(id: string, tenantId: string): Promise<Product> {
    return this.update(id, { status: "archived" }, tenantId);
  }

  async count(tenantId: string): Promise<number> {
    const row = await this.db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM products WHERE tenant_id = @tenantId",
      { tenantId },
    );
    return row?.n ?? 0;
  }

  /** Seed realistic demo products for tnt_demo on first init. Idempotent: only seeds when empty. */
  async seed(): Promise<void> {
    const DEMO_TENANT_ID = "tnt_demo";
    if ((await this.count(DEMO_TENANT_ID)) > 0) return;
    const demo: CreateProductInput[] = [
      { sku: "GRO-COFFEE-001", name: "Organic Dark Roast Beans", price_cents: 1499, category: "groceries", barcode: "0123456789012" },
      { sku: "GRO-HONEY-001", name: "Wildflower Honey", price_cents: 899, category: "groceries", barcode: "0123456789029" },
      { sku: "APP-TSHIRT-001", name: "Finder Logo T-Shirt", price_cents: 2200, category: "apparel", barcode: "0123456789036" },
      { sku: "HOME-MUG-001", name: "Ceramic Coffee Mug", price_cents: 1200, category: "home", barcode: "0123456789043" },
    ];
    for (const p of demo) {
      try {
        await this.create(p, DEMO_TENANT_ID);
      } catch {
        // Tolerate a concurrent seeder racing on the same SKU (cold-start races).
      }
    }
  }

  // ---- Category tree (BE-6) ----

  async listCategories(tenantId: string): Promise<Category[]> {
    return this.db.query<Category>(
      "SELECT * FROM categories WHERE tenant_id = @tenantId ORDER BY name",
      { tenantId },
    );
  }

  async getCategoryOrThrow(id: string, tenantId: string): Promise<Category> {
    const category = await this.db.one<Category>(
      "SELECT * FROM categories WHERE id = @id AND tenant_id = @tenantId",
      { id, tenantId },
    );
    if (!category) throw notFound(`category '${id}' not found`);
    return category;
  }

  async createCategory(input: CreateCategoryInput, tenantId: string): Promise<Category> {
    if (input.parent_id) await this.getCategoryOrThrow(input.parent_id, tenantId);
    const now = Date.now();
    const category: Category = {
      id: `cat_${uuidv7()}`,
      tenant_id: tenantId,
      name: input.name,
      parent_id: input.parent_id ?? null,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO categories (id, tenant_id, name, parent_id, created_at, updated_at)
       VALUES (@id, @tenant_id, @name, @parent_id, @created_at, @updated_at)`,
      category as unknown as Record<string, unknown>,
    );
    return category;
  }

  async updateCategory(id: string, input: UpdateCategoryInput, tenantId: string): Promise<Category> {
    const current = await this.getCategoryOrThrow(id, tenantId);
    if (input.parent_id) {
      if (input.parent_id === id) throw conflict("a category cannot be its own parent");
      await this.getCategoryOrThrow(input.parent_id, tenantId);
    }
    const next: Category = {
      ...current,
      name: input.name ?? current.name,
      parent_id: input.parent_id !== undefined ? input.parent_id : current.parent_id,
      updated_at: Date.now(),
    };
    await this.db.query(
      `UPDATE categories SET name = @name, parent_id = @parent_id, updated_at = @updated_at WHERE id = @id`,
      next as unknown as Record<string, unknown>,
    );
    return next;
  }

  async deleteCategory(id: string, tenantId: string): Promise<void> {
    await this.getCategoryOrThrow(id, tenantId);
    await this.db.tx(async (tdb) => {
      await tdb.query("UPDATE categories SET parent_id = NULL WHERE tenant_id = @tenantId AND parent_id = @id", { tenantId, id });
      await tdb.query("DELETE FROM product_categories WHERE tenant_id = @tenantId AND category_id = @id", { tenantId, id });
      await tdb.query("DELETE FROM categories WHERE tenant_id = @tenantId AND id = @id", { tenantId, id });
    });
  }

  /** Category ids assigned to a product. */
  async listProductCategories(productId: string, tenantId: string): Promise<string[]> {
    const rows = await this.db.query<{ category_id: string }>(
      "SELECT category_id FROM product_categories WHERE tenant_id = @tenantId AND product_id = @productId",
      { tenantId, productId },
    );
    return rows.map((r) => r.category_id);
  }

  /** Replace the full set of categories assigned to a product. */
  async setProductCategories(productId: string, categoryIds: string[], tenantId: string): Promise<void> {
    await this.getOrThrow(productId, tenantId);
    for (const categoryId of categoryIds) {
      await this.getCategoryOrThrow(categoryId, tenantId);
    }
    await this.db.tx(async (tdb) => {
      await tdb.query("DELETE FROM product_categories WHERE tenant_id = @tenantId AND product_id = @productId", { tenantId, productId });
      for (const categoryId of categoryIds) {
        await tdb.query(
          `INSERT INTO product_categories (tenant_id, product_id, category_id) VALUES (@tenantId, @productId, @categoryId)
           ON CONFLICT DO NOTHING`,
          { tenantId, productId, categoryId },
        );
      }
    });
  }
}

function clampLimit(limit?: number): number {
  if (!limit || limit <= 0) return 50;
  return Math.min(Math.floor(limit), 200);
}

/** Postgres signals a unique-constraint breach with SQLSTATE 23505. */
function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "23505"
  );
}
