import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import type { Cents } from "../../shared/money.js";
import type { Page } from "../../shared/types.js";
import { notFound, conflict } from "../../shared/http.js";

export type TaxClass = "standard" | "exempt";
export type ProductStatus = "active" | "draft" | "archived";

export interface ProductImage {
  id: string;
  tenant_id: string;
  product_id: string;
  image_url: string;
  alt_text: string | null;
  sort_order: number;
  is_primary: boolean;
  created_at: number;
}

export interface ProductAttribute {
  id: string;
  tenant_id: string;
  name: string;
  data_type: string;
  is_filterable: boolean;
  is_variant_option: boolean;
  created_at: number;
  updated_at: number;
}

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
  // Core descriptive fields
  description: string | null;
  short_description: string | null;
  full_description: string | null;
  alternative_name: string | null;
  model_name: string | null;
  manufacturer: string | null;
  brand: string | null;
  tags: string | null;             // comma-separated
  url_alias: string | null;
  // Pricing
  msrp_cents: Cents | null;
  min_selling_price_cents: Cents | null;
  raw_cost_price_cents: Cents | null;
  wholesale_price_cents: Cents | null;
  enterprise_price_cents: Cents | null;
  // Physical dimensions
  length_mm: number | null;
  width_mm: number | null;
  height_mm: number | null;
  weight_grams: number | null;
  size: string | null;
  unit_description: string | null;  // "each", "pack of 12", etc.
  nicotine_strength_mg: number | null;
  volume_ml: number | null;
  oz_per_product_x100: number | null; // ounces × 100 (supports 1.5oz = 150)
  // Images & media
  image_url: string | null;
  // Compliance / regulatory
  state_description: string | null;
  federal_description: string | null;
  msa_category_code: string | null;
  msa_promotion_indicator: number;  // 1|0
  msa_promotion_description: string | null;
  msa_manufacturer_description: string | null;
  // SEO
  meta_title: string | null;
  meta_keywords: string | null;
  meta_description: string | null;
  // Vendor / supply chain
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  primary_vendor: string | null;
  vendor_upc: string | null;
  drop_shipment: number;    // 1|0
  reorder_quantity: number | null;
  // Qty limits
  min_qty_to_sell: number | null;
  max_qty_to_sell: number | null;
  qty_increment: number;
  // Variant / master
  parent_product_id: string | null;
  variant_label: string | null;
  // BE-22: regulated product compliance
  tobacco_type: string | null;
  flavored: number;        // 1|0
  menthol: number;         // 1|0
  msa_reportable: number;  // 1|0
  restricted_states: string | null;  // JSON array e.g. '["CA","MA"]'
  // Operational flags (1|0)
  age_restricted: number;
  returnable: number;
  service_product: number;
  customer_specific: number;
  exclude_from_po: number;
  composite_product: number;
  track_inventory: number;
  track_inventory_by_imei: number;
  // Ecommerce visibility (owned by ecommerce module, stored on products)
  ecommerce: number;
  // Expiry — denormalized MIN(lot.expiry_date) written by InventoryService.syncProductExpiry()
  expiry_date: number | null;
}

export interface CreateProductInput {
  sku: string;
  name: string;
  price_cents: Cents;
  category?: string;
  tax_class?: TaxClass;
  barcode?: string | null;
  status?: ProductStatus;
  // Descriptive
  description?: string | null;
  short_description?: string | null;
  full_description?: string | null;
  alternative_name?: string | null;
  model_name?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  tags?: string | null;
  url_alias?: string | null;
  // Pricing
  msrp_cents?: Cents | null;
  min_selling_price_cents?: Cents | null;
  raw_cost_price_cents?: Cents | null;
  wholesale_price_cents?: Cents | null;
  enterprise_price_cents?: Cents | null;
  // Physical
  length_mm?: number | null;
  width_mm?: number | null;
  height_mm?: number | null;
  weight_grams?: number | null;
  size?: string | null;
  unit_description?: string | null;
  nicotine_strength_mg?: number | null;
  volume_ml?: number | null;
  oz_per_product_x100?: number | null;
  // Media
  image_url?: string | null;
  // Compliance
  state_description?: string | null;
  federal_description?: string | null;
  msa_category_code?: string | null;
  msa_promotion_indicator?: boolean;
  msa_promotion_description?: string | null;
  msa_manufacturer_description?: string | null;
  // SEO
  meta_title?: string | null;
  meta_keywords?: string | null;
  meta_description?: string | null;
  // Vendor
  preferred_vendor_id?: string | null;
  preferred_vendor_name?: string | null;
  primary_vendor?: string | null;
  vendor_upc?: string | null;
  drop_shipment?: boolean;
  reorder_quantity?: number | null;
  // Qty limits
  min_qty_to_sell?: number | null;
  max_qty_to_sell?: number | null;
  qty_increment?: number;
  // Variant
  parent_product_id?: string | null;
  variant_label?: string | null;
  // Flags
  age_restricted?: boolean;
  returnable?: boolean;
  service_product?: boolean;
  customer_specific?: boolean;
  exclude_from_po?: boolean;
  composite_product?: boolean;
  track_inventory?: boolean;
  track_inventory_by_imei?: boolean;
  // Ecommerce visibility flag
  ecommerce?: boolean;
}

// UpdateProductInput mirrors CreateProductInput but all fields optional (sku is immutable).
export type UpdateProductInput = Omit<Partial<CreateProductInput>, "sku">;

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
  /** Exclude master/variant-parent rows (products referenced by another
   *  product's parent_product_id) — for sellable/browse lists (FE-7). */
  excludeMasters?: boolean;
}

export interface VariantAttributeInput {
  name: string;
  values: string[];
}

interface MutationOptions {
  publishEvent?: boolean;
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

function variantCombinations(groups: string[][]): string[][] {
  return groups.reduce<string[][]>(
    (acc, group) => acc.flatMap((combo) => group.map((value) => [...combo, value])),
    [[]],
  );
}

function skuToken(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export class CatalogService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateProductInput, tenantId: string, options: MutationOptions = {}): Promise<Product> {
    const existing = await this.db.one(
      "SELECT id FROM products WHERE tenant_id = @tenantId AND sku = @sku",
      { tenantId, sku: input.sku },
    );
    if (existing) {
      throw conflict(`product with sku '${input.sku}' already exists`);
    }

    const now = Date.now();
    const category = input.category ?? "general";
    const id = `prod_${uuidv7()}`;
    await this.assertCanBecomeVariant(id, input.parent_product_id ?? null, tenantId);
    const product: Product = {
      id,
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
      // Descriptive
      description: input.description ?? null,
      short_description: input.short_description ?? null,
      full_description: input.full_description ?? null,
      alternative_name: input.alternative_name ?? null,
      model_name: input.model_name ?? null,
      manufacturer: input.manufacturer ?? null,
      brand: input.brand ?? null,
      tags: input.tags ?? null,
      url_alias: input.url_alias ?? null,
      // Pricing
      msrp_cents: input.msrp_cents ?? null,
      min_selling_price_cents: input.min_selling_price_cents ?? null,
      raw_cost_price_cents: input.raw_cost_price_cents ?? null,
      wholesale_price_cents: input.wholesale_price_cents ?? null,
      enterprise_price_cents: input.enterprise_price_cents ?? null,
      // Physical
      length_mm: input.length_mm ?? null,
      width_mm: input.width_mm ?? null,
      height_mm: input.height_mm ?? null,
      weight_grams: input.weight_grams ?? null,
      size: input.size ?? null,
      unit_description: input.unit_description ?? null,
      nicotine_strength_mg: input.nicotine_strength_mg ?? null,
      volume_ml: input.volume_ml ?? null,
      oz_per_product_x100: input.oz_per_product_x100 ?? null,
      // Media
      image_url: input.image_url ?? null,
      // Compliance
      state_description: input.state_description ?? null,
      federal_description: input.federal_description ?? null,
      msa_category_code: input.msa_category_code ?? null,
      msa_promotion_indicator: input.msa_promotion_indicator ? 1 : 0,
      msa_promotion_description: input.msa_promotion_description ?? null,
      msa_manufacturer_description: input.msa_manufacturer_description ?? null,
      // SEO
      meta_title: input.meta_title ?? null,
      meta_keywords: input.meta_keywords ?? null,
      meta_description: input.meta_description ?? null,
      // Vendor
      preferred_vendor_id: input.preferred_vendor_id ?? null,
      preferred_vendor_name: input.preferred_vendor_name ?? null,
      primary_vendor: input.primary_vendor ?? null,
      vendor_upc: input.vendor_upc ?? null,
      drop_shipment: input.drop_shipment ? 1 : 0,
      reorder_quantity: input.reorder_quantity ?? null,
      // Qty limits
      min_qty_to_sell: input.min_qty_to_sell ?? null,
      max_qty_to_sell: input.max_qty_to_sell ?? null,
      qty_increment: input.qty_increment ?? 1,
      // Variant
      parent_product_id: input.parent_product_id ?? null,
      variant_label: input.variant_label ?? null,
      // BE-22: regulated compliance
      tobacco_type: null,
      flavored: 0,
      menthol: 0,
      msa_reportable: 0,
      restricted_states: null,
      // Flags
      age_restricted: input.age_restricted ? 1 : 0,
      returnable: input.returnable !== false ? 1 : 0,
      service_product: input.service_product ? 1 : 0,
      customer_specific: input.customer_specific ? 1 : 0,
      exclude_from_po: input.exclude_from_po ? 1 : 0,
      composite_product: input.composite_product ? 1 : 0,
      track_inventory: input.track_inventory !== false ? 1 : 0,
      track_inventory_by_imei: input.track_inventory_by_imei ? 1 : 0,
      ecommerce: input.ecommerce ? 1 : 0,
      // Expiry cache — null on create; written by InventoryService.syncProductExpiry()
      expiry_date: null,
    };

    try {
      await this.db.query(
        `INSERT INTO products
           (id, tenant_id, sku, name, price_cents, category, tax_class, barcode, status, created_at, updated_at,
            description, short_description, full_description, alternative_name, model_name, manufacturer, brand, tags, url_alias,
            msrp_cents, min_selling_price_cents, raw_cost_price_cents, wholesale_price_cents, enterprise_price_cents,
            length_mm, width_mm, height_mm, weight_grams, size, unit_description, nicotine_strength_mg, volume_ml, oz_per_product_x100,
            image_url,
            state_description, federal_description, msa_category_code, msa_promotion_indicator, msa_promotion_description, msa_manufacturer_description,
            meta_title, meta_keywords, meta_description,
            preferred_vendor_id, preferred_vendor_name, primary_vendor, vendor_upc, drop_shipment, reorder_quantity,
            min_qty_to_sell, max_qty_to_sell, qty_increment,
            parent_product_id, variant_label,
            age_restricted, returnable, service_product, customer_specific, exclude_from_po, composite_product, track_inventory, track_inventory_by_imei, ecommerce,
            tobacco_type, flavored, menthol, msa_reportable, restricted_states)
         VALUES
           (@id, @tenant_id, @sku, @name, @price_cents, @category, @tax_class, @barcode, @status, @created_at, @updated_at,
            @description, @short_description, @full_description, @alternative_name, @model_name, @manufacturer, @brand, @tags, @url_alias,
            @msrp_cents, @min_selling_price_cents, @raw_cost_price_cents, @wholesale_price_cents, @enterprise_price_cents,
            @length_mm, @width_mm, @height_mm, @weight_grams, @size, @unit_description, @nicotine_strength_mg, @volume_ml, @oz_per_product_x100,
            @image_url,
            @state_description, @federal_description, @msa_category_code, @msa_promotion_indicator, @msa_promotion_description, @msa_manufacturer_description,
            @meta_title, @meta_keywords, @meta_description,
            @preferred_vendor_id, @preferred_vendor_name, @primary_vendor, @vendor_upc, @drop_shipment, @reorder_quantity,
            @min_qty_to_sell, @max_qty_to_sell, @qty_increment,
            @parent_product_id, @variant_label,
            @age_restricted, @returnable, @service_product, @customer_specific, @exclude_from_po, @composite_product, @track_inventory, @track_inventory_by_imei, @ecommerce,
            @tobacco_type, @flavored, @menthol, @msa_reportable, @restricted_states)`,
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

    if (options.publishEvent !== false) {
      await this.publishProductCreated(product);
    }

    return product;
  }

  private async publishProductCreated(product: Product): Promise<void> {
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
    await this.db.withTenant(tenantId).tx(async (tdb) => {
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
    if (query.excludeMasters) {
      where.push("NOT EXISTS (SELECT 1 FROM products c WHERE c.tenant_id = products.tenant_id AND c.parent_product_id = products.id)");
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

  async update(id: string, input: UpdateProductInput, tenantId: string, options: MutationOptions = {}): Promise<Product> {
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

    if (input.parent_product_id !== undefined) {
      await this.assertCanBecomeVariant(id, input.parent_product_id ?? null, tenantId);
    }

    // Boolean flag fields — convert boolean input → integer storage.
    const boolFlags: Array<[keyof UpdateProductInput, keyof Product]> = [
      ["age_restricted", "age_restricted"],
      ["msa_promotion_indicator", "msa_promotion_indicator"],
      ["drop_shipment", "drop_shipment"],
      ["returnable", "returnable"],
      ["service_product", "service_product"],
      ["customer_specific", "customer_specific"],
      ["exclude_from_po", "exclude_from_po"],
      ["composite_product", "composite_product"],
      ["track_inventory", "track_inventory"],
      ["track_inventory_by_imei", "track_inventory_by_imei"],
      ["ecommerce", "ecommerce"],
    ];
    for (const [inputKey, productKey] of boolFlags) {
      const value = input[inputKey];
      if (value !== undefined) {
        const nextVal = value ? 1 : 0;
        if (nextVal !== (current as unknown as Record<string, unknown>)[productKey]) {
          (next as unknown as Record<string, unknown>)[productKey] = nextVal;
          (changed as unknown as Record<string, unknown>)[productKey] = nextVal;
        }
      }
    }

    // Nullable text + numeric fields — pass through as-is.
    const detailFields = [
      "description", "short_description", "full_description", "alternative_name",
      "model_name", "manufacturer", "brand", "tags", "url_alias",
      "msrp_cents", "min_selling_price_cents", "raw_cost_price_cents", "wholesale_price_cents", "enterprise_price_cents",
      "length_mm", "width_mm", "height_mm", "weight_grams",
      "size", "unit_description", "nicotine_strength_mg", "volume_ml", "oz_per_product_x100",
      "image_url",
      "state_description", "federal_description",
      "msa_category_code", "msa_promotion_description", "msa_manufacturer_description",
      "meta_title", "meta_keywords", "meta_description",
      "preferred_vendor_id", "preferred_vendor_name", "primary_vendor",
      "vendor_upc", "reorder_quantity",
      "min_qty_to_sell", "max_qty_to_sell", "qty_increment",
      "parent_product_id", "variant_label",
    ] as const;
    for (const field of detailFields) {
      const value = (input as Record<string, unknown>)[field];
      if (value !== undefined && value !== (current as unknown as Record<string, unknown>)[field]) {
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
         name = @name, price_cents = @price_cents, category = @category, tax_class = @tax_class,
         barcode = @barcode, status = @status,
         description = @description, short_description = @short_description, full_description = @full_description,
         alternative_name = @alternative_name, model_name = @model_name, manufacturer = @manufacturer,
         brand = @brand, tags = @tags, url_alias = @url_alias,
         msrp_cents = @msrp_cents, min_selling_price_cents = @min_selling_price_cents, raw_cost_price_cents = @raw_cost_price_cents,
         wholesale_price_cents = @wholesale_price_cents, enterprise_price_cents = @enterprise_price_cents,
         length_mm = @length_mm, width_mm = @width_mm, height_mm = @height_mm, weight_grams = @weight_grams,
         size = @size, unit_description = @unit_description, nicotine_strength_mg = @nicotine_strength_mg,
         volume_ml = @volume_ml, oz_per_product_x100 = @oz_per_product_x100,
         image_url = @image_url,
         state_description = @state_description, federal_description = @federal_description,
         msa_category_code = @msa_category_code, msa_promotion_indicator = @msa_promotion_indicator,
         msa_promotion_description = @msa_promotion_description, msa_manufacturer_description = @msa_manufacturer_description,
         meta_title = @meta_title, meta_keywords = @meta_keywords, meta_description = @meta_description,
         preferred_vendor_id = @preferred_vendor_id, preferred_vendor_name = @preferred_vendor_name,
         primary_vendor = @primary_vendor, vendor_upc = @vendor_upc,
         drop_shipment = @drop_shipment, reorder_quantity = @reorder_quantity,
         min_qty_to_sell = @min_qty_to_sell, max_qty_to_sell = @max_qty_to_sell, qty_increment = @qty_increment,
         parent_product_id = @parent_product_id, variant_label = @variant_label,
         age_restricted = @age_restricted, returnable = @returnable, service_product = @service_product,
         customer_specific = @customer_specific, exclude_from_po = @exclude_from_po,
         composite_product = @composite_product, track_inventory = @track_inventory,
         track_inventory_by_imei = @track_inventory_by_imei,
         ecommerce = @ecommerce,
         updated_at = @updated_at
       WHERE id = @id`,
      next as unknown as Record<string, unknown>,
    );

    if (options.publishEvent !== false) {
      await this.publishProductUpdated(next, changed);
    }

    return next;
  }

  private async publishProductUpdated(product: Product, changed: Partial<Product>): Promise<void> {
    await this.events.publish("product.updated", { id: product.id, ...changed }, product.id);
  }

  /** Soft delete: archive the product. */
  async archive(id: string, tenantId: string): Promise<Product> {
    return this.update(id, { status: "archived" }, tenantId);
  }

  /** BE-22: update regulated-product compliance fields (manager-gated at route level). */
  async updateCompliance(
    id: string,
    input: {
      tobacco_type?: string | null;
      flavored?: boolean;
      menthol?: boolean;
      msa_reportable?: boolean;
      restricted_states?: string[];
    },
    tenantId: string,
  ): Promise<Product> {
    const current = await this.getOrThrow(id, tenantId);
    const now = Date.now();

    const tobacco_type = input.tobacco_type !== undefined ? (input.tobacco_type ?? null) : current.tobacco_type;
    const flavored = input.flavored !== undefined ? (input.flavored ? 1 : 0) : current.flavored;
    const menthol = input.menthol !== undefined ? (input.menthol ? 1 : 0) : current.menthol;
    const msa_reportable = input.msa_reportable !== undefined ? (input.msa_reportable ? 1 : 0) : current.msa_reportable;
    const restricted_states =
      input.restricted_states !== undefined
        ? JSON.stringify(input.restricted_states)
        : current.restricted_states;

    await this.db.query(
      `UPDATE products
       SET tobacco_type = @tobacco_type,
           flavored = @flavored,
           menthol = @menthol,
           msa_reportable = @msa_reportable,
           restricted_states = @restricted_states,
           updated_at = @now
       WHERE id = @id AND tenant_id = @tenantId`,
      { id, tenantId, tobacco_type, flavored, menthol, msa_reportable, restricted_states, now },
    );

    await this.events.publish("product.updated", { id, tobacco_type, flavored, menthol, msa_reportable, restricted_states }, id);

    return {
      ...current,
      tobacco_type,
      flavored,
      menthol,
      msa_reportable,
      restricted_states,
      updated_at: now,
    };
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
      { sku: "APP-TSHIRT-001", name: "Ascend Logo T-Shirt", price_cents: 2200, category: "apparel", barcode: "0123456789036" },
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

  // ---- Bulk operations (BE-7) ----

  /** Apply the same field update to many products by id (manager-gated route). */
  async bulkUpdate(ids: string[], input: UpdateProductInput, tenantId: string): Promise<Product[]> {
    const updated: Product[] = [];
    for (const id of ids) {
      updated.push(await this.update(id, input, tenantId));
    }
    return updated;
  }

  /** All products for a tenant, for CSV export. Unpaginated (catalogs are small per tenant). */
  async listAll(tenantId: string): Promise<Product[]> {
    return this.db.query<Product>(
      "SELECT * FROM products WHERE tenant_id = @tenantId ORDER BY sku",
      { tenantId },
    );
  }

  /** Generate and register a barcode for each product that has none. Returns the
   *  ids that were assigned a new barcode (products that already had one are skipped). */
  async generateBarcodes(ids: string[], tenantId: string): Promise<Array<{ id: string; barcode: string }>> {
    const generated: Array<{ id: string; barcode: string }> = [];
    for (const id of ids) {
      const product = await this.getOrThrow(id, tenantId);
      const existing = await this.listBarcodes(id, tenantId);
      if (product.barcode || existing.length > 0) continue;
      const barcode = await this.nextBarcode(tenantId);
      await this.update(id, { barcode }, tenantId);
      await this.addBarcode(id, barcode, "each", 1, tenantId);
      generated.push({ id, barcode });
    }
    return generated;
  }

  /** Generate a fresh EAN-13 (GS1 "2" restricted-circulation prefix + random body + check digit),
   *  retrying on the rare collision with an existing barcode for this tenant. */
  private async nextBarcode(tenantId: string): Promise<string> {
    for (let attempt = 0; attempt < 10; attempt++) {
      const body = `2${String(Math.floor(Math.random() * 1e11)).padStart(11, "0")}`;
      const candidate = body + ean13CheckDigit(body);
      const taken = await this.db.one(
        "SELECT 1 FROM product_barcodes WHERE tenant_id = @tenantId AND barcode = @barcode",
        { tenantId, barcode: candidate },
      );
      if (!taken) return candidate;
    }
    throw conflict("could not generate a unique barcode, try again");
  }

  // ---- Master/child variants (BE-8) ----

  private async assertCanBeMaster(masterId: string, tenantId: string): Promise<Product> {
    const master = await this.getOrThrow(masterId, tenantId);
    if (master.parent_product_id) {
      throw conflict("a variant product cannot be used as a master product");
    }
    return master;
  }

  private async hasChildVariants(productId: string, tenantId: string): Promise<boolean> {
    const row = await this.db.one(
      "SELECT 1 FROM products WHERE tenant_id = @tenantId AND parent_product_id = @productId LIMIT 1",
      { tenantId, productId },
    );
    return Boolean(row);
  }

  private async assertCanBecomeVariant(childId: string, parentId: string | null, tenantId: string): Promise<void> {
    if (!parentId) return;
    if (parentId === childId) throw conflict("a product cannot be its own variant parent");
    await this.assertCanBeMaster(parentId, tenantId);
    if (await this.hasChildVariants(childId, tenantId)) {
      throw conflict("a master product cannot be assigned as a child variant");
    }
  }

  /** Child products (variants) assigned to a master product. */
  async listVariants(masterId: string, tenantId: string): Promise<Product[]> {
    await this.getOrThrow(masterId, tenantId);
    return this.db.query<Product>(
      "SELECT * FROM products WHERE tenant_id = @tenantId AND parent_product_id = @masterId ORDER BY variant_label, sku",
      { tenantId, masterId },
    );
  }

  /** Bulk-assign the given products as children (variants) of a master product. */
  async assignVariants(
    masterId: string,
    productIds: string[],
    tenantId: string,
    variantLabel?: string | null,
  ): Promise<Product[]> {
    const updatedProducts = await this.db.withTenant(tenantId).tx(async (tdb) => {
      const catalog = new CatalogService(tdb, this.events);
      const updated: Product[] = [];
      await catalog.assertCanBeMaster(masterId, tenantId);
      for (const productId of [...new Set(productIds)]) {
        if (productId === masterId) throw conflict("a product cannot be its own variant parent");
        updated.push(
          await catalog.update(
            productId,
            {
              parent_product_id: masterId,
              ...(variantLabel !== undefined ? { variant_label: variantLabel } : {}),
            },
            tenantId,
            { publishEvent: false },
          ),
        );
      }
      return updated;
    });

    for (const product of updatedProducts) {
      await this.publishProductUpdated(product, {
        parent_product_id: product.parent_product_id,
        ...(variantLabel !== undefined ? { variant_label: product.variant_label } : {}),
      });
    }

    return this.listVariants(masterId, tenantId);
  }

  async unlinkVariant(masterId: string, childId: string, tenantId: string): Promise<Product> {
    await this.assertCanBeMaster(masterId, tenantId);
    const child = await this.getOrThrow(childId, tenantId);
    if (child.parent_product_id !== masterId) {
      throw conflict("product is not a child variant of this master product");
    }
    return this.update(childId, { parent_product_id: null, variant_label: null }, tenantId);
  }

  async generateVariants(masterId: string, attributes: VariantAttributeInput[], tenantId: string): Promise<Product[]> {
    const createdProducts = await this.db.withTenant(tenantId).tx(async (tdb) => {
      const catalog = new CatalogService(tdb, this.events);
      const created: Product[] = [];
      const master = await catalog.assertCanBeMaster(masterId, tenantId);
      const normalized = attributes
        .map((attr) => ({
          name: attr.name.trim(),
          values: [...new Set(attr.values.map((value) => value.trim()).filter(Boolean))],
        }))
        .filter((attr) => attr.name && attr.values.length > 0);

      if (normalized.length === 0) {
        throw conflict("variant generation requires at least one attribute with values");
      }

      const combinations = variantCombinations(normalized.map((attr) => attr.values));
      if (combinations.length > 200) {
        throw conflict("variant generation is limited to 200 combinations");
      }

      const existing = await catalog.listVariants(masterId, tenantId);
      const existingLabels = new Set(existing.map((variant) => variant.variant_label).filter(Boolean));

      for (const combo of combinations) {
        const label = combo.join(" / ");
        if (existingLabels.has(label)) continue;
        existingLabels.add(label);
        created.push(
          await catalog.create(
            {
              sku: await catalog.nextVariantSku(master.sku, label, tenantId),
              name: `${master.name} - ${label}`,
              price_cents: master.price_cents,
              category: master.category,
              tax_class: master.tax_class,
              status: master.status,
              description: master.description,
              brand: master.brand,
              image_url: master.image_url,
              parent_product_id: masterId,
              variant_label: label,
              age_restricted: master.age_restricted === 1,
              returnable: master.returnable === 1,
              service_product: master.service_product === 1,
              track_inventory: master.track_inventory === 1,
              ecommerce: master.ecommerce === 1,
            },
            tenantId,
            { publishEvent: false },
          ),
        );
      }

      return created;
    });

    for (const product of createdProducts) {
      await this.publishProductCreated(product);
    }

    return this.listVariants(masterId, tenantId);
  }

  private async nextVariantSku(masterSku: string, variantLabel: string, tenantId: string): Promise<string> {
    const suffix = skuToken(variantLabel) || "VARIANT";
    const base = `${masterSku}-${suffix}`;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
      const existing = await this.db.one(
        "SELECT id FROM products WHERE tenant_id = @tenantId AND sku = @sku",
        { tenantId, sku: candidate },
      );
      if (!existing) return candidate;
    }
    throw conflict("could not generate a unique variant SKU");
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
    await this.db.withTenant(tenantId).tx(async (tdb) => {
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
    await this.db.withTenant(tenantId).tx(async (tdb) => {
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

  // ── Product Images ───────────────────────────────────────────────────────────

  async listImages(productId: string, tenantId: string): Promise<ProductImage[]> {
    return this.db.query<ProductImage>(
      "SELECT * FROM product_images WHERE tenant_id = @tenantId AND product_id = @productId ORDER BY sort_order ASC, created_at ASC",
      { tenantId, productId },
    );
  }

  async addImage(
    productId: string,
    tenantId: string,
    input: { imageUrl: string; altText?: string | null; sortOrder?: number; isPrimary?: boolean },
  ): Promise<ProductImage> {
    const now = Date.now();
    const img: ProductImage = {
      id: `pimg_${uuidv7()}`,
      tenant_id: tenantId,
      product_id: productId,
      image_url: input.imageUrl,
      alt_text: input.altText ?? null,
      sort_order: input.sortOrder ?? 0,
      is_primary: input.isPrimary ?? false,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO product_images (id, tenant_id, product_id, image_url, alt_text, sort_order, is_primary, created_at)
       VALUES (@id, @tenant_id, @product_id, @image_url, @alt_text, @sort_order, @is_primary, @created_at)`,
      img as unknown as Record<string, unknown>,
    );
    return img;
  }

  async deleteImage(imageId: string, tenantId: string): Promise<void> {
    await this.db.query(
      "DELETE FROM product_images WHERE id = @id AND tenant_id = @tenantId",
      { id: imageId, tenantId },
    );
  }

  // ── Product Attributes ───────────────────────────────────────────────────────

  async listAttributes(tenantId: string): Promise<ProductAttribute[]> {
    return this.db.query<ProductAttribute>(
      "SELECT * FROM product_attributes WHERE tenant_id = @tenantId ORDER BY name ASC",
      { tenantId },
    );
  }

  async createAttribute(
    tenantId: string,
    input: { name: string; dataType?: string; isFilterable?: boolean; isVariantOption?: boolean },
  ): Promise<ProductAttribute> {
    const now = Date.now();
    const attr: ProductAttribute = {
      id: `pattr_${uuidv7()}`,
      tenant_id: tenantId,
      name: input.name,
      data_type: input.dataType ?? "text",
      is_filterable: input.isFilterable ?? false,
      is_variant_option: input.isVariantOption ?? false,
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO product_attributes (id, tenant_id, name, data_type, is_filterable, is_variant_option, created_at, updated_at)
       VALUES (@id, @tenant_id, @name, @data_type, @is_filterable, @is_variant_option, @created_at, @updated_at)`,
      attr as unknown as Record<string, unknown>,
    );
    return attr;
  }
}

/** EAN-13 check digit: sum digits from the right, alternating x1/x3 weights. */
function ean13CheckDigit(body12: string): string {
  let sum = 0;
  for (let i = 0; i < body12.length; i++) {
    const digit = Number(body12[body12.length - 1 - i]);
    sum += i % 2 === 0 ? digit * 3 : digit;
  }
  return String((10 - (sum % 10)) % 10);
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
