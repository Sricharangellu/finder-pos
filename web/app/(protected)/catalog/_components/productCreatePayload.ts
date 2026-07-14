import { parseToCents } from "@/lib/money";

export type ProductKind = "standalone" | "master" | "variant";

export interface ProductFormState {
  productKind: ProductKind;
  sku: string;
  name: string;
  priceInput: string;
  msrpInput: string;
  costInput: string;
  wholesaleInput: string;
  brand: string;
  category: string;
  taxClass: "standard" | "exempt";
  status: "active" | "draft" | "archived";
  description: string;
  barcode: string;
  vendorUpc: string;
  imageUrl: string;
  parentProductId: string;
  variantLabel: string;
  minQtyToSell: string;
  maxQtyToSell: string;
  qtyIncrement: string;
  lengthMm: string;
  widthMm: string;
  heightMm: string;
  weightGrams: string;
  trackInventory: boolean;
  returnable: boolean;
  ageRestricted: boolean;
  serviceProduct: boolean;
  ecommerce: boolean;
}

export function createInitialProductForm(parentProductId = "", variantLabel = ""): ProductFormState {
  return {
    productKind: parentProductId ? "variant" : "standalone",
    sku: "",
    name: "",
    priceInput: "",
    msrpInput: "",
    costInput: "",
    wholesaleInput: "",
    brand: "",
    category: "",
    taxClass: "standard",
    status: "draft",
    description: "",
    barcode: "",
    vendorUpc: "",
    imageUrl: "",
    parentProductId,
    variantLabel,
    minQtyToSell: "",
    maxQtyToSell: "",
    qtyIncrement: "1",
    lengthMm: "",
    widthMm: "",
    heightMm: "",
    weightGrams: "",
    trackInventory: true,
    returnable: true,
    ageRestricted: false,
    serviceProduct: false,
    ecommerce: false,
  };
}

function optionalText(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed || undefined;
}

function optionalCents(value: string): number | undefined {
  if (!value.trim()) return undefined;
  return parseToCents(value);
}

function optionalPositiveInt(value: string): number | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function moneyError(value: string, label: string): string | undefined {
  if (!value.trim()) return undefined;
  const cents = parseToCents(value);
  return Number.isFinite(cents) && cents >= 0 ? undefined : `${label} must be a valid amount.`;
}

function positiveIntError(value: string, label: string): string | undefined {
  if (!value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? undefined : `${label} must be a whole number above 0.`;
}

export function validateProductForm(form: ProductFormState): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!form.sku.trim()) errors.sku = "SKU is required.";
  if (!form.name.trim()) errors.name = "Name is required.";

  const priceCents = form.productKind === "master" && !form.priceInput.trim()
    ? 0
    : parseToCents(form.priceInput);
  if (form.productKind !== "master" && !form.priceInput.trim()) {
    errors.priceInput = "Price is required.";
  } else if (!Number.isFinite(priceCents) || priceCents < 0) {
    errors.priceInput = "Enter a valid price.";
  }

  if (form.productKind === "variant") {
    if (!form.parentProductId.trim()) errors.parentProductId = "Parent product ID is required.";
    if (!form.variantLabel.trim()) errors.variantLabel = "Variant label is required.";
  }

  const moneyFields: Array<[keyof ProductFormState, string]> = [
    ["msrpInput", "MSRP"],
    ["costInput", "Cost price"],
    ["wholesaleInput", "Wholesale price"],
  ];
  for (const [field, label] of moneyFields) {
    const message = moneyError(String(form[field]), label);
    if (message) errors[field] = message;
  }

  const intFields: Array<[keyof ProductFormState, string]> = [
    ["minQtyToSell", "Min qty"],
    ["maxQtyToSell", "Max qty"],
    ["qtyIncrement", "Qty increment"],
    ["lengthMm", "Length"],
    ["widthMm", "Width"],
    ["heightMm", "Height"],
    ["weightGrams", "Weight"],
  ];
  for (const [field, label] of intFields) {
    const message = positiveIntError(String(form[field]), label);
    if (message) errors[field] = message;
  }

  return errors;
}

export function buildProductCreateBody(form: ProductFormState): Record<string, unknown> {
  const priceCents = form.productKind === "master" && !form.priceInput.trim()
    ? 0
    : parseToCents(form.priceInput);

  const body: Record<string, unknown> = {
    sku: form.sku.trim(),
    name: form.name.trim(),
    price_cents: priceCents,
    category: optionalText(form.category),
    tax_class: form.taxClass,
    status: form.status,
    barcode: optionalText(form.barcode),
    brand: optionalText(form.brand),
    description: optionalText(form.description),
    image_url: optionalText(form.imageUrl),
    vendor_upc: optionalText(form.vendorUpc),
    msrp_cents: optionalCents(form.msrpInput),
    raw_cost_price_cents: optionalCents(form.costInput),
    wholesale_price_cents: optionalCents(form.wholesaleInput),
    min_qty_to_sell: optionalPositiveInt(form.minQtyToSell),
    max_qty_to_sell: optionalPositiveInt(form.maxQtyToSell),
    qty_increment: optionalPositiveInt(form.qtyIncrement),
    length_mm: optionalPositiveInt(form.lengthMm),
    width_mm: optionalPositiveInt(form.widthMm),
    height_mm: optionalPositiveInt(form.heightMm),
    weight_grams: optionalPositiveInt(form.weightGrams),
    track_inventory: form.trackInventory,
    returnable: form.returnable,
    age_restricted: form.ageRestricted,
    service_product: form.serviceProduct,
    ecommerce: form.ecommerce,
    parent_product_id: form.productKind === "variant" ? form.parentProductId.trim() : undefined,
    variant_label: form.productKind === "variant" ? form.variantLabel.trim() : undefined,
  };

  for (const key of Object.keys(body)) {
    if (body[key] === undefined) delete body[key];
  }

  return body;
}
