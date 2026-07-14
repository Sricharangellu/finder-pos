import { describe, expect, it } from "vitest";
import {
  buildProductCreateBody,
  createInitialProductForm,
  validateProductForm,
} from "@/app/(protected)/catalog/_components/productCreatePayload";

describe("new product form payload", () => {
  it("builds a child variant create payload with full product fields", () => {
    const form = {
      ...createInitialProductForm("prod_master", "Large"),
      sku: "TEE-L-BLK",
      name: "Tee - Large Black",
      priceInput: "29.99",
      msrpInput: "39.99",
      costInput: "12.50",
      wholesaleInput: "20.00",
      category: "apparel",
      barcode: "0123456789012",
      vendorUpc: "99887766",
      imageUrl: "https://example.com/tee.png",
      description: "Retail tee",
      minQtyToSell: "1",
      maxQtyToSell: "5",
      lengthMm: "300",
      widthMm: "200",
      heightMm: "20",
      weightGrams: "250",
      ageRestricted: true,
      ecommerce: true,
    };

    expect(validateProductForm(form)).toEqual({});
    expect(buildProductCreateBody(form)).toEqual({
      sku: "TEE-L-BLK",
      name: "Tee - Large Black",
      price_cents: 2999,
      category: "apparel",
      tax_class: "standard",
      status: "draft",
      barcode: "0123456789012",
      description: "Retail tee",
      image_url: "https://example.com/tee.png",
      vendor_upc: "99887766",
      msrp_cents: 3999,
      raw_cost_price_cents: 1250,
      wholesale_price_cents: 2000,
      min_qty_to_sell: 1,
      max_qty_to_sell: 5,
      qty_increment: 1,
      length_mm: 300,
      width_mm: 200,
      height_mm: 20,
      weight_grams: 250,
      track_inventory: true,
      returnable: true,
      age_restricted: true,
      service_product: false,
      ecommerce: true,
      parent_product_id: "prod_master",
      variant_label: "Large",
    });
  });

  it("allows a master product with an implicit zero price", () => {
    const form = {
      ...createInitialProductForm(),
      productKind: "master" as const,
      sku: "TEE-MASTER",
      name: "Tee Master",
    };

    expect(validateProductForm(form)).toEqual({});
    expect(buildProductCreateBody(form)).toMatchObject({
      sku: "TEE-MASTER",
      name: "Tee Master",
      price_cents: 0,
    });
    expect(buildProductCreateBody(form)).not.toHaveProperty("parent_product_id");
  });

  it("requires parent id and label for child variants", () => {
    const form = {
      ...createInitialProductForm(),
      productKind: "variant" as const,
      sku: "TEE-L",
      name: "Tee Large",
      priceInput: "19.99",
    };

    expect(validateProductForm(form)).toMatchObject({
      parentProductId: "Parent product ID is required.",
      variantLabel: "Variant label is required.",
    });
  });
});
