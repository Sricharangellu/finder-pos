"use client";

import { useState } from "react";
import { ApiResponseError } from "@/api-client/client";
import { Button } from "@/components/Button";
import type { Product, Category, ProductStatus, TaxClass } from "@/api-client/types";
import {
  buildProductCreateBody,
  createInitialProductForm,
  validateProductForm,
  type ProductFormState,
  type ProductKind,
} from "./productCreatePayload";

export function emptyForm(): ProductFormState {
  return createInitialProductForm();
}

export function productToForm(p: Product): ProductFormState {
  return {
    ...createInitialProductForm(p.parent_product_id ?? "", p.variant_label ?? ""),
    productKind: p.parent_product_id ? "variant" : "standalone",
    name: p.name,
    sku: p.sku,
    priceInput: (p.price_cents / 100).toFixed(2),
    category: p.category,
    barcode: p.barcode ?? "",
    taxClass: p.tax_class,
    status: p.status,
    brand: p.brand ?? "", description: p.description ?? "",
    msrpInput: p.msrp_cents != null ? (p.msrp_cents / 100).toFixed(2) : "",
    costInput: p.raw_cost_price_cents != null ? (p.raw_cost_price_cents / 100).toFixed(2) : "",
    wholesaleInput: p.wholesale_price_cents != null ? (p.wholesale_price_cents / 100).toFixed(2) : "",
    vendorUpc: p.vendor_upc ?? "",
    imageUrl: p.image_url ?? "",
    minQtyToSell: p.min_qty_to_sell != null ? String(p.min_qty_to_sell) : "",
    maxQtyToSell: p.max_qty_to_sell != null ? String(p.max_qty_to_sell) : "",
    qtyIncrement: p.qty_increment != null ? String(p.qty_increment) : "1",
    trackInventory: p.track_inventory === 1,
    returnable: p.returnable === 1,
    ageRestricted: p.age_restricted === 1,
    ecommerce: p.ecommerce === 1,
  };
}

export function formToBody(f: ProductFormState): Record<string, unknown> {
  return buildProductCreateBody(f);
}

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="rounded-lg border border-slate-200 bg-white p-4">
      <legend className="px-1 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">
        {title}
      </legend>
      {description && <p className="mb-4 mt-1 text-xs text-slate-500">{description}</p>}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {children}
      </div>
    </fieldset>
  );
}

export function ProductFormModal({
  initial,
  categories,
  onSave,
  onClose,
}: {
  initial?: Product;
  categories: Category[];
  onSave: (body: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ProductFormState>(initial ? productToForm(initial) : emptyForm());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const set = (k: keyof ProductFormState, v: string | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateProductForm(form);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setErr("Fix the highlighted product fields.");
      return;
    }
    setSaving(true); setErr(null);
    try {
      await onSave(formToBody(form));
      onClose();
    } catch (ex) {
      setErr(ex instanceof ApiResponseError ? ex.message : "Save failed.");
      setSaving(false);
    }
  };

  const inputCls = "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-600";
  const labelCls = "mb-1 block text-sm font-medium text-slate-700";
  const kindOptions: Array<{ value: ProductKind; label: string }> = [
    { value: "standalone", label: "Standalone" },
    { value: "master", label: "Master" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-md bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">
            {initial ? "Edit product" : "New product"}
          </h2>
          <button type="button" onClick={onClose} aria-label="Close product form" className="flex h-9 w-9 items-center justify-center rounded-md text-xl leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600">&times;</button>
        </div>

        <form id="product-form" onSubmit={handleSubmit} className="flex-1 space-y-4 overflow-y-auto bg-slate-50 px-5 py-4">
          {err && (
            <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{err}</p>
          )}

          <FormSection
            title="Retail identity"
            description="Visible catalog fields used by cashiers, search, labels, and online listings."
          >
            {!initial && (
              <div className="sm:col-span-2">
                <label className={labelCls}>Product type</label>
                <div className="flex flex-wrap gap-2">
                  {kindOptions.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => set("productKind", option.value)}
                      className={[
                        "min-h-9 rounded-md border px-3 text-sm font-medium transition-colors",
                        form.productKind === option.value
                          ? "border-slate-950 bg-slate-950 text-white"
                          : "border-slate-300 bg-white text-slate-700 hover:border-slate-500",
                      ].join(" ")}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="sm:col-span-2">
              <label className={labelCls}>Name <span className="text-red-500">*</span></label>
              <input type="text" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Product name" className={inputCls} required />
              {fieldErrors.name && <p className="mt-1 text-xs text-red-600">{fieldErrors.name}</p>}
            </div>

            <div>
              <label className={labelCls}>SKU <span className="text-red-500">*</span></label>
              <input type="text" value={form.sku} onChange={(e) => set("sku", e.target.value)} placeholder="BEV-001" className={inputCls} required />
              {fieldErrors.sku && <p className="mt-1 text-xs text-red-600">{fieldErrors.sku}</p>}
            </div>

            <div>
              <label className={labelCls}>UPC / Barcode</label>
              <input type="text" value={form.barcode} onChange={(e) => set("barcode", e.target.value)} placeholder="012345678901" className={inputCls} />
            </div>
          </FormSection>

          <FormSection
            title="Pricing"
            description="Retail price is customer-facing. Cost, MSRP, wholesale, and vendor UPC stay internal."
          >
            <div>
              <label className={labelCls}>Sell price ($) {form.productKind !== "master" && <span className="text-red-500">*</span>}</label>
              <input type="number" step="0.01" min="0" value={form.priceInput} onChange={(e) => set("priceInput", e.target.value)} placeholder={form.productKind === "master" ? "0.00" : "9.99"} className={inputCls} required={form.productKind !== "master"} />
              {fieldErrors.priceInput && <p className="mt-1 text-xs text-red-600">{fieldErrors.priceInput}</p>}
            </div>

            <div>
              <label className={labelCls}>MSRP ($)</label>
              <input type="number" step="0.01" min="0" value={form.msrpInput} onChange={(e) => set("msrpInput", e.target.value)} placeholder="0.00" className={inputCls} />
              {fieldErrors.msrpInput && <p className="mt-1 text-xs text-red-600">{fieldErrors.msrpInput}</p>}
            </div>

            <div>
              <label className={labelCls}>Cost price ($)</label>
              <input type="number" step="0.01" min="0" value={form.costInput} onChange={(e) => set("costInput", e.target.value)} placeholder="0.00" className={inputCls} />
              {fieldErrors.costInput && <p className="mt-1 text-xs text-red-600">{fieldErrors.costInput}</p>}
            </div>

            <div>
              <label className={labelCls}>Wholesale price ($)</label>
              <input type="number" step="0.01" min="0" value={form.wholesaleInput} onChange={(e) => set("wholesaleInput", e.target.value)} placeholder="0.00" className={inputCls} />
              {fieldErrors.wholesaleInput && <p className="mt-1 text-xs text-red-600">{fieldErrors.wholesaleInput}</p>}
            </div>
          </FormSection>

          <FormSection
            title="Classification"
            description="Organize reporting, tax behavior, brand browsing, and supplier matching."
          >
            <div>
              <label className={labelCls}>Category</label>
              {categories.length > 0 ? (
                <select value={form.category} onChange={(e) => set("category", e.target.value)} className={inputCls}>
                  <option value="">— Select category —</option>
                  {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
                </select>
              ) : (
                <input type="text" value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Beverages" className={inputCls} />
              )}
            </div>

            <div>
              <label className={labelCls}>Tax class</label>
              <select value={form.taxClass} onChange={(e) => set("taxClass", e.target.value as TaxClass)} className={inputCls}>
                <option value="standard">Standard</option>
                <option value="exempt">Tax exempt</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Status</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value as ProductStatus)} className={inputCls}>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>

            <div>
              <label className={labelCls}>Brand</label>
              <input type="text" value={form.brand} onChange={(e) => set("brand", e.target.value)} placeholder="Brand name" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Vendor UPC</label>
              <input type="text" value={form.vendorUpc} onChange={(e) => set("vendorUpc", e.target.value)} placeholder="Supplier code" className={inputCls} />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>Image URL</label>
              <input type="url" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://..." className={inputCls} />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>Description</label>
              <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} placeholder="Short product description" className={`${inputCls} resize-none`} />
            </div>
          </FormSection>

          <FormSection
            title="Selling rules"
            description="Control quantity limits, inventory behavior, and channel availability."
          >
            <div>
              <label className={labelCls}>Min qty to sell</label>
              <input type="number" min="1" step="1" value={form.minQtyToSell} onChange={(e) => set("minQtyToSell", e.target.value)} className={inputCls} />
              {fieldErrors.minQtyToSell && <p className="mt-1 text-xs text-red-600">{fieldErrors.minQtyToSell}</p>}
            </div>

            <div>
              <label className={labelCls}>Max qty to sell</label>
              <input type="number" min="1" step="1" value={form.maxQtyToSell} onChange={(e) => set("maxQtyToSell", e.target.value)} className={inputCls} />
              {fieldErrors.maxQtyToSell && <p className="mt-1 text-xs text-red-600">{fieldErrors.maxQtyToSell}</p>}
            </div>

            <div>
              <label className={labelCls}>Qty increment</label>
              <input type="number" min="1" step="1" value={form.qtyIncrement} onChange={(e) => set("qtyIncrement", e.target.value)} className={inputCls} />
              {fieldErrors.qtyIncrement && <p className="mt-1 text-xs text-red-600">{fieldErrors.qtyIncrement}</p>}
            </div>

            <div className="sm:col-span-2 flex flex-wrap gap-5">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.ageRestricted} onChange={(e) => set("ageRestricted", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Age restricted
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.trackInventory} onChange={(e) => set("trackInventory", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Track inventory
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.returnable} onChange={(e) => set("returnable", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Returnable
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.serviceProduct} onChange={(e) => set("serviceProduct", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Service product
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={form.ecommerce} onChange={(e) => set("ecommerce", e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-brand-600" />
                Online
              </label>
            </div>
          </FormSection>
        </form>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="product-form" loading={saving}>
            {initial ? "Save changes" : "Create product"}
          </Button>
        </div>
      </div>
    </div>
  );
}
