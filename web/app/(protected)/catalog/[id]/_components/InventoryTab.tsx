"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/Button";
import { apiGet, apiPatch, apiPost, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── Shared primitives ─────────────────────────────────────────────────────────

const FIELD = "w-full rounded-md border border-slate-200 px-3 py-2 text-sm text-[#111] outline-none focus:border-[#5D5FEF] focus:ring-1 focus:ring-[#5D5FEF]";

function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium text-slate-500">{children}</label>;
}

function Section({
  title,
  sub,
  action,
  children,
}: {
  title: string;
  sub?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-3.5">
        <div>
          <h3 className="text-sm font-semibold text-[#111]">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
        </div>
        {action}
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

// ── Variant price helpers ─────────────────────────────────────────────────────

function calcPriceFields(retail: number, cost: number) {
  if (retail <= 0) return { markup: 0, margin: 0 };
  const markup = cost > 0 ? ((retail - cost) / cost) * 100 : 0;
  const margin = ((retail - cost) / retail) * 100;
  return { markup, margin };
}

// ── Variant sub-tab types ─────────────────────────────────────────────────────

type VariantSubTab = "inventory" | "image" | "price" | "tax" | "marketing" | "dimensions";

const VARIANT_SUB_TABS: { key: VariantSubTab; label: string }[] = [
  { key: "inventory",  label: "Inventory" },
  { key: "image",      label: "Image" },
  { key: "price",      label: "Price" },
  { key: "tax",        label: "Tax" },
  { key: "marketing",  label: "Marketing" },
  { key: "dimensions", label: "Weight and dimensions" },
];

// ── Variant sub-tab content ───────────────────────────────────────────────────

function VariantPricePane({ variant }: { variant: CatalogProduct }) {
  const initialRetail = variant.price_cents / 100;
  const initialCost = (variant.raw_cost_price_cents ?? 0) / 100;
  const initialSupplier = (variant.wholesale_price_cents ?? 0) / 100;
  const { markup: initMarkup, margin: initMargin } = calcPriceFields(initialRetail, initialCost);

  const [retail, setRetail] = useState(initialRetail.toFixed(2));
  const [cost, setCost] = useState(initialCost.toFixed(2));
  const [markup, setMarkup] = useState(initMarkup > 0 ? initMarkup.toFixed(2) : "");
  const [margin, setMargin] = useState(initMargin > 0 ? initMargin.toFixed(2) : "");

  function onRetailChange(val: string) {
    const r = parseFloat(val) || 0;
    const c = parseFloat(cost) || 0;
    const { markup: mu, margin: ma } = calcPriceFields(r, c);
    setRetail(val);
    setMarkup(mu > 0 ? mu.toFixed(2) : "");
    setMargin(ma > 0 ? ma.toFixed(2) : "");
  }

  function onCostChange(val: string) {
    const c = parseFloat(val) || 0;
    const r = parseFloat(retail) || 0;
    const { markup: mu, margin: ma } = calcPriceFields(r, c);
    setCost(val);
    setMarkup(mu > 0 ? mu.toFixed(2) : "");
    setMargin(ma > 0 ? ma.toFixed(2) : "");
  }

  const marginNum = parseFloat(margin) || 0;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-100 bg-white text-xs font-semibold uppercase tracking-wide text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">Price point</th>
            <th className="px-3 py-2 text-right">Supplier price</th>
            <th className="px-3 py-2 text-right">Latest landed cost</th>
            <th className="px-3 py-2 text-right">Markup %</th>
            <th className="px-3 py-2 text-right">Margin %</th>
            <th className="px-3 py-2 text-right">Retail price (excl. tax)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td className="px-3 py-2.5 text-xs text-slate-500">General Price Book</td>
            <td className="px-3 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <span className="text-slate-400 text-xs">$</span>
                <input
                  type="number" step="0.01" min="0"
                  className="w-20 rounded border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#5D5FEF]"
                  defaultValue={initialSupplier.toFixed(2)}
                />
              </div>
            </td>
            <td className="px-3 py-2.5 text-right text-xs text-slate-400">
              {cost ? `$${parseFloat(cost).toFixed(2)}` : "—"}
            </td>
            <td className="px-3 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <input
                  type="number" step="0.01" min="0"
                  className="w-16 rounded border border-slate-200 px-2 py-1.5 text-right text-sm outline-none focus:border-[#5D5FEF]"
                  value={markup}
                  onChange={(e) => {
                    const mu = parseFloat(e.target.value) || 0;
                    const c = parseFloat(cost) || 0;
                    if (c > 0) {
                      const r = c * (1 + mu / 100);
                      setRetail(r.toFixed(2));
                      setMargin((mu / (1 + mu / 100)).toFixed(2));
                    }
                    setMarkup(e.target.value);
                  }}
                  placeholder="0.00"
                />
                <span className="text-slate-400 text-xs">%</span>
              </div>
            </td>
            <td className="px-3 py-2.5 text-right">
              <span className={`text-sm font-semibold ${marginNum >= 30 ? "text-emerald-600" : marginNum > 0 ? "text-amber-600" : "text-slate-400"}`}>
                {margin ? `${parseFloat(margin).toFixed(1)}%` : "—"}
              </span>
            </td>
            <td className="px-3 py-2.5">
              <div className="flex items-center justify-end gap-1">
                <span className="text-slate-400 text-xs">$</span>
                <input
                  type="number" step="0.01" min="0"
                  className="w-24 rounded border border-slate-200 px-2 py-1.5 text-right text-sm font-semibold outline-none focus:border-[#5D5FEF]"
                  value={retail}
                  onChange={(e) => onRetailChange(e.target.value)}
                />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function VariantInventoryPane({ variant }: { variant: CatalogProduct }) {
  const [track, setTrack] = useState(!!(variant.track_inventory ?? 1));
  return (
    <div className="space-y-3">
      <label className="flex cursor-pointer items-center gap-2.5">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-slate-300 text-[#5D5FEF] focus:ring-[#5D5FEF]"
          checked={track}
          onChange={(e) => setTrack(e.target.checked)}
        />
        <span className="text-sm text-[#111]">Track inventory for this variant</span>
      </label>
    </div>
  );
}

function VariantImagePane() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50 py-8">
      <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-slate-400" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
      <p className="text-xs text-slate-500">No image for this variant</p>
      <button type="button" className="text-xs font-medium text-[#5D5FEF] hover:underline">
        Choose image
      </button>
    </div>
  );
}

function VariantTaxPane({ variant }: { variant: CatalogProduct }) {
  return (
    <div>
      <Label>Tax class</Label>
      <select className={FIELD} defaultValue={variant.tax_class}>
        <option value="standard">Default tax for outlet</option>
        <option value="exempt">Tax exempt</option>
      </select>
    </div>
  );
}

function VariantMarketingPane() {
  const [mode, setMode] = useState<"default" | "custom">("default");
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Loyalty</p>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="radio" className="mt-0.5 h-4 w-4 border-slate-300 text-[#5D5FEF]"
          checked={mode === "default"} onChange={() => setMode("default")} />
        <div>
          <p className="text-sm font-medium text-[#111]">Earn default loyalty</p>
          <p className="text-xs text-slate-400">Inherits the default loyalty ratio from the parent product.</p>
        </div>
      </label>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="radio" className="mt-0.5 h-4 w-4 border-slate-300 text-[#5D5FEF]"
          checked={mode === "custom"} onChange={() => setMode("custom")} />
        <div>
          <p className="text-sm font-medium text-[#111]">Earn custom loyalty</p>
          {mode === "custom" && (
            <div className="mt-2 flex items-center gap-2">
              <input type="number" step="0.01" min="0" max="100"
                className="w-20 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-[#5D5FEF]"
                defaultValue="5.00"
              />
              <span className="text-sm text-slate-500">%</span>
            </div>
          )}
        </div>
      </label>
    </div>
  );
}

function VariantDimensionsPane({ variant }: { variant: CatalogProduct }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {(
        [
          ["Weight", variant.weight_grams != null ? (variant.weight_grams / 453.592).toFixed(2) : "", "lb"],
          ["Length", variant.length_mm != null ? (variant.length_mm / 25.4).toFixed(2) : "", "in"],
          ["Width",  variant.width_mm  != null ? (variant.width_mm  / 25.4).toFixed(2) : "", "in"],
          ["Height", variant.height_mm != null ? (variant.height_mm / 25.4).toFixed(2) : "", "in"],
        ] as const
      ).map(([lbl, val, unit]) => (
        <div key={lbl}>
          <Label>{lbl} ({unit})</Label>
          <input
            type="number" step="0.01" min="0"
            className={FIELD}
            defaultValue={val}
            placeholder="0.00"
          />
        </div>
      ))}
    </div>
  );
}

// ── Expanded variant row ──────────────────────────────────────────────────────

function VariantExpandedRow({
  variant,
  colSpan,
  activeSubTab,
  onSubTabChange,
}: {
  variant: CatalogProduct;
  colSpan: number;
  activeSubTab: VariantSubTab;
  onSubTabChange: (tab: VariantSubTab) => void;
}) {
  return (
    <tr>
      <td colSpan={colSpan} className="border-b border-slate-100 bg-slate-50 p-0">
        <div className="px-4 pt-2 pb-4">
          {/* Sub-tab bar */}
          <div className="mb-4 flex gap-0 border-b border-slate-200">
            {VARIANT_SUB_TABS.map(({ key, label }) => (
              <button
                key={key}
                type="button"
                onClick={(e) => { e.stopPropagation(); onSubTabChange(key); }}
                className={`px-3 py-2 text-xs font-medium transition-colors ${
                  activeSubTab === key
                    ? "border-b-2 border-[#5D5FEF] text-[#5D5FEF]"
                    : "border-b-2 border-transparent text-slate-500 hover:text-[#111]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Sub-tab content */}
          {activeSubTab === "price"      && <VariantPricePane variant={variant} />}
          {activeSubTab === "inventory"  && <VariantInventoryPane variant={variant} />}
          {activeSubTab === "image"      && <VariantImagePane />}
          {activeSubTab === "tax"        && <VariantTaxPane variant={variant} />}
          {activeSubTab === "marketing"  && <VariantMarketingPane />}
          {activeSubTab === "dimensions" && <VariantDimensionsPane variant={variant} />}
        </div>
      </td>
    </tr>
  );
}

// ── InventoryTab ──────────────────────────────────────────────────────────────

type AttributeType = "VARIANT" | "MATRIX";

export function InventoryTab({
  product,
  onSaved,
}: {
  product: CatalogProduct;
  onSaved: (p: CatalogProduct) => void;
}) {
  const router = useRouter();

  // ── Supplier ──────────────────────────────────────────────────────────────
  const [supplierRows, setSupplierRows] = useState([
    {
      id: "1",
      name: product.preferred_vendor_name ?? "",
      code: product.vendor_upc ?? "",
      price: product.wholesale_price_cents != null
        ? String((product.wholesale_price_cents / 100).toFixed(2))
        : "",
    },
  ]);
  const [savingSupplier, setSavingSupplier] = useState(false);
  const [supplierError, setSupplierError] = useState<string | null>(null);

  const addSupplierRow = () =>
    setSupplierRows((rows) => [...rows, { id: String(Date.now()), name: "", code: "", price: "" }]);

  const saveSupplier = async () => {
    setSavingSupplier(true);
    setSupplierError(null);
    try {
      const primary = supplierRows[0];
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, {
        vendor_upc: primary?.code.trim() || undefined,
        wholesale_price_cents: primary?.price
          ? Math.round(parseFloat(primary.price) * 100)
          : undefined,
      });
      onSaved(updated);
    } catch (e) {
      setSupplierError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally {
      setSavingSupplier(false);
    }
  };

  // ── Inventory levels ──────────────────────────────────────────────────────
  const [invForm, setInvForm] = useState({
    track: true,
    replenish_method: "min_max" as "min_max" | "reorder_point",
    min_qty: product.min_qty_to_sell != null ? String(product.min_qty_to_sell) : "",
    max_qty: product.max_qty_to_sell != null ? String(product.max_qty_to_sell) : "",
    reorder_point: "",
    reorder_qty: product.qty_increment != null ? String(product.qty_increment) : "",
  });
  const [savingInv, setSavingInv] = useState(false);
  const [invError, setInvError] = useState<string | null>(null);

  const saveInventory = async () => {
    setSavingInv(true);
    setInvError(null);
    try {
      const patch: Partial<CatalogProduct> = {};
      if (invForm.replenish_method === "min_max") {
        patch.min_qty_to_sell = invForm.min_qty ? Number(invForm.min_qty) : undefined;
        patch.max_qty_to_sell = invForm.max_qty ? Number(invForm.max_qty) : undefined;
      } else {
        patch.qty_increment = invForm.reorder_qty ? Number(invForm.reorder_qty) : undefined;
      }
      const updated = await apiPatch<CatalogProduct>(`/api/v1/catalog/${product.id}`, patch);
      onSaved(updated);
    } catch (e) {
      setInvError(e instanceof ApiResponseError ? e.message : "Save failed.");
    } finally {
      setSavingInv(false);
    }
  };

  // ── Variants ──────────────────────────────────────────────────────────────
  const [attributeType, setAttributeType] = useState<AttributeType>("VARIANT");
  const [variants, setVariants] = useState<CatalogProduct[]>([]);
  const [variantsLoaded, setVariantsLoaded] = useState(false);
  const [variantsLoading, setVariantsLoading] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [subTabs, setSubTabs] = useState<Record<string, VariantSubTab>>({});

  const [showAddVariant, setShowAddVariant] = useState(false);
  const [allProducts, setAllProducts] = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [addVariantId, setAddVariantId] = useState("");
  const [addVariantAxis, setAddVariantAxis] = useState("Size");
  const [addVariantValue, setAddVariantValue] = useState("");
  const [addVariantBusy, setAddVariantBusy] = useState(false);
  const [addVariantError, setAddVariantError] = useState<string | null>(null);

  const loadVariants = async () => {
    if (variantsLoaded) return;
    setVariantsLoading(true);
    try {
      const res = await apiGet<{ items: CatalogProduct[] }>(
        `/api/v1/catalog/${product.id}/variants`
      );
      setVariants(res.items ?? []);
      setVariantsLoaded(true);
    } catch {
      /* ignore */
    } finally {
      setVariantsLoading(false);
    }
  };

  const openAddVariant = async () => {
    setShowAddVariant(true);
    setAddVariantError(null);
    if (allProducts.length === 0) {
      try {
        const res = await apiGet<{ items: Array<{ id: string; sku: string; name: string }> }>(
          "/api/v1/catalog?pageSize=200"
        );
        setAllProducts((res.items ?? []).filter((p) => p.id !== product.id));
      } catch {
        /* ignore */
      }
    }
  };

  const assignVariant = async () => {
    if (!addVariantId || !addVariantValue.trim()) {
      setAddVariantError("Select a product and enter a value.");
      return;
    }
    const label =
      addVariantAxis === "Custom"
        ? addVariantValue.trim()
        : `${addVariantAxis}: ${addVariantValue.trim()}`;
    setAddVariantBusy(true);
    setAddVariantError(null);
    try {
      await apiPost(`/api/v1/catalog/${product.id}/variants/assign`, {
        productIds: [addVariantId],
        label,
      });
      setAddVariantId("");
      setAddVariantValue("");
      setShowAddVariant(false);
      setVariantsLoaded(false);
      await loadVariants();
    } catch (e) {
      setAddVariantError(
        e instanceof ApiResponseError ? e.message : "Failed to assign variant."
      );
    } finally {
      setAddVariantBusy(false);
    }
  };

  const unlinkVariant = async (childId: string) => {
    try {
      await apiDelete(`/api/v1/catalog/${product.id}/variants/${childId}`);
      setVariants((v) => v.filter((x) => x.id !== childId));
      if (expandedId === childId) setExpandedId(null);
    } catch {
      /* ignore */
    }
  };

  const toggleExpanded = (id: string) => {
    if (!variantsLoaded) void loadVariants();
    setExpandedId((prev) => (prev === id ? null : id));
    setSubTabs((prev) => ({ ...prev, [id]: prev[id] ?? "inventory" }));
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (product.parent_product_id) {
    return (
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[#5D5FEF]/10 px-2.5 py-0.5 text-xs font-semibold text-[#5D5FEF]">
            Child variant
          </span>
          {product.variant_label && (
            <span className="text-sm text-slate-500">{product.variant_label}</span>
          )}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          This product is a variant of{" "}
          <button
            type="button"
            onClick={() => router.push(`/catalog/${product.parent_product_id}`)}
            className="font-medium text-[#5D5FEF] hover:underline"
          >
            the master product
          </button>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">

      {/* ── Supplier Information ─────────────────────────────────────────── */}
      <Section
        title="Supplier Information"
        action={
          <Button size="sm" variant="secondary" onClick={addSupplierRow}>
            + Add another supplier
          </Button>
        }
      >
        {supplierError && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {supplierError}
          </p>
        )}
        <div className="space-y-3">
          {supplierRows.map((row, idx) => (
            <div key={row.id} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                {idx === 0 && <Label>Supplier</Label>}
                <input
                  className={FIELD}
                  value={row.name}
                  onChange={(e) => setSupplierRows((rows) => rows.map((r) => r.id === row.id ? { ...r, name: e.target.value } : r))}
                  placeholder="Supplier name…"
                />
              </div>
              <div>
                {idx === 0 && <Label>Supplier code</Label>}
                <input
                  className={FIELD}
                  value={row.code}
                  onChange={(e) => setSupplierRows((rows) => rows.map((r) => r.id === row.id ? { ...r, code: e.target.value } : r))}
                  placeholder="e.g. SKU-1234"
                />
              </div>
              <div>
                {idx === 0 && <Label>Supplier price ($)</Label>}
                <input
                  type="number" step="0.01" min="0"
                  className={FIELD}
                  value={row.price}
                  onChange={(e) => setSupplierRows((rows) => rows.map((r) => r.id === row.id ? { ...r, price: e.target.value } : r))}
                  placeholder="0.00"
                />
              </div>
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="primary" loading={savingSupplier} onClick={() => void saveSupplier()}>
            Save supplier
          </Button>
        </div>
      </Section>

      {/* ── Inventory Levels ─────────────────────────────────────────────── */}
      <Section title="Inventory Levels">
        {invError && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {invError}
          </p>
        )}
        <label className="mb-4 flex cursor-pointer items-center gap-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 rounded border-slate-300 text-[#5D5FEF] focus:ring-[#5D5FEF]"
            checked={invForm.track}
            onChange={(e) => setInvForm((f) => ({ ...f, track: e.target.checked }))}
          />
          <span className="text-sm font-medium text-[#111]">Track inventory for this product</span>
        </label>

        {invForm.track && (
          <div className="space-y-4">
            <div>
              <p className="mb-2 text-xs font-semibold text-slate-500">Replenish method</p>
              <div className="space-y-3">
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    className="mt-0.5 h-4 w-4 border-slate-300 text-[#5D5FEF]"
                    checked={invForm.replenish_method === "min_max"}
                    onChange={() => setInvForm((f) => ({ ...f, replenish_method: "min_max" }))}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#111]">Min and max quantity</p>
                    <p className="text-xs text-slate-500">
                      Min triggers replenishment; Max is the refill target
                    </p>
                    {invForm.replenish_method === "min_max" && (
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <Label>Min quantity</Label>
                          <input
                            type="number" min="0" className={FIELD}
                            value={invForm.min_qty}
                            onChange={(e) => setInvForm((f) => ({ ...f, min_qty: e.target.value }))}
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <Label>Max quantity</Label>
                          <input
                            type="number" min="0" className={FIELD}
                            value={invForm.max_qty}
                            onChange={(e) => setInvForm((f) => ({ ...f, max_qty: e.target.value }))}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </label>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="radio"
                    className="mt-0.5 h-4 w-4 border-slate-300 text-[#5D5FEF]"
                    checked={invForm.replenish_method === "reorder_point"}
                    onChange={() => setInvForm((f) => ({ ...f, replenish_method: "reorder_point" }))}
                  />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#111]">Reorder point and reorder quantity</p>
                    <p className="text-xs text-slate-500">
                      Reorder point = drop-to level; Reorder quantity = set order amount
                    </p>
                    {invForm.replenish_method === "reorder_point" && (
                      <div className="mt-2 grid grid-cols-2 gap-3">
                        <div>
                          <Label>Reorder point</Label>
                          <input
                            type="number" min="0" className={FIELD}
                            value={invForm.reorder_point}
                            onChange={(e) => setInvForm((f) => ({ ...f, reorder_point: e.target.value }))}
                            placeholder="0"
                          />
                        </div>
                        <div>
                          <Label>Reorder quantity</Label>
                          <input
                            type="number" min="0" className={FIELD}
                            value={invForm.reorder_qty}
                            onChange={(e) => setInvForm((f) => ({ ...f, reorder_qty: e.target.value }))}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </label>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm" variant="primary" loading={savingInv}
                onClick={() => void saveInventory()}
              >
                Save inventory settings
              </Button>
            </div>
          </div>
        )}
      </Section>

      {/* ── Variants ─────────────────────────────────────────────────────── */}
      <Section
        title="Variants"
        sub="Child products with different sizes, colors, or other attributes"
        action={
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => { void loadVariants(); }}>
              ✏️ Edit value names
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => { void (variantsLoaded ? Promise.resolve() : loadVariants()); void openAddVariant(); }}
            >
              + Add another attribute
            </Button>
          </div>
        }
      >
        {/* Attribute type */}
        <div className="mb-5 flex items-center gap-3">
          <Label>Attribute type</Label>
          <div className="flex gap-1">
            {(["VARIANT", "MATRIX"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => setAttributeType(type)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                  attributeType === type
                    ? "bg-[#5D5FEF] text-white"
                    : "border border-slate-200 bg-white text-slate-600 hover:border-[#5D5FEF]/40"
                }`}
              >
                {type}
              </button>
            ))}
          </div>
        </div>

        {/* Add variant form */}
        {showAddVariant && (
          <div className="mb-4 rounded-lg border border-[#5D5FEF]/20 bg-[#5D5FEF]/5 p-4 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-[#5D5FEF]">
              Add attribute value
            </p>
            {addVariantError && (
              <p role="alert" className="rounded bg-red-50 px-3 py-1.5 text-xs text-red-700">
                {addVariantError}
              </p>
            )}
            <div>
              <Label>Option axis</Label>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {["Size", "Color", "Flavor", "Weight", "Pack", "Custom"].map((ax) => (
                  <button
                    key={ax}
                    type="button"
                    onClick={() => setAddVariantAxis(ax)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                      addVariantAxis === ax
                        ? "bg-[#5D5FEF] text-white"
                        : "border border-slate-200 bg-white text-slate-600 hover:border-[#5D5FEF]/40"
                    }`}
                  >
                    {ax}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                {addVariantAxis !== "Custom" && (
                  <span className="flex h-9 items-center rounded-md border border-slate-100 bg-slate-50 px-3 text-sm text-slate-400 shrink-0">
                    {addVariantAxis}:
                  </span>
                )}
                <input
                  value={addVariantValue}
                  onChange={(e) => setAddVariantValue(e.target.value)}
                  placeholder={addVariantAxis === "Custom" ? "e.g. 500ml / Red / King Size" : "e.g. Large"}
                  className={FIELD}
                />
              </div>
            </div>
            <div>
              <Label>Product to assign</Label>
              <select
                value={addVariantId}
                onChange={(e) => setAddVariantId(e.target.value)}
                className={FIELD}
              >
                <option value="">Select a product…</option>
                {allProducts
                  .filter((p) => !variants.some((v) => v.id === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>
                  ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowAddVariant(false)}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" loading={addVariantBusy} onClick={() => void assignVariant()}>
                Assign
              </Button>
            </div>
          </div>
        )}

        {/* Load trigger */}
        {!variantsLoaded && !showAddVariant && (
          <button
            type="button"
            className="mb-3 text-xs font-medium text-[#5D5FEF] hover:underline"
            onClick={() => void loadVariants()}
          >
            Load variants
          </button>
        )}

        {/* Variants table */}
        {variantsLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : variantsLoaded && variants.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">
            No variants yet.{" "}
            <button
              type="button"
              onClick={() => void openAddVariant()}
              className="text-[#5D5FEF] hover:underline"
            >
              Add a child product
            </button>
          </p>
        ) : variantsLoaded ? (
          <div>
            <p className="mb-2 text-xs text-slate-500 font-medium">
              This product has {variants.length} variant{variants.length !== 1 ? "s" : ""}
            </p>
            <div className="overflow-hidden rounded-lg border border-slate-100">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <tr>
                    <th className="w-6 px-3 py-2.5" />
                    <th className="px-4 py-2.5 text-left">Variant</th>
                    <th className="px-4 py-2.5 text-left">SKU Code</th>
                    <th className="px-4 py-2.5 text-left">Supplier Code</th>
                    <th className="px-4 py-2.5 text-right">Supplier Price</th>
                    <th className="px-4 py-2.5 text-right">Retail Price</th>
                    <th className="px-4 py-2.5 text-center">Enabled</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {variants.map((v) => {
                    const isExpanded = expandedId === v.id;
                    const activeSubTab = subTabs[v.id] ?? "inventory";
                    return (
                      <>
                        <tr
                          key={v.id}
                          className={`cursor-pointer transition-colors ${isExpanded ? "bg-[#5D5FEF]/5" : "hover:bg-slate-50"}`}
                          onClick={() => toggleExpanded(v.id)}
                        >
                          {/* expand chevron */}
                          <td className="px-3 py-2.5 text-slate-400">
                            <svg
                              width="12" height="12" viewBox="0 0 12 12" fill="none"
                              stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
                              strokeLinejoin="round"
                              aria-hidden="true"
                              className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
                            >
                              <path d="M4 2l4 4-4 4" />
                            </svg>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="inline-block rounded-full bg-[#5D5FEF]/10 px-2 py-0.5 text-xs font-semibold text-[#5D5FEF]">
                              {v.variant_label ?? "—"}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 font-mono text-xs text-slate-500">
                            {v.sku}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-slate-400">
                            {v.vendor_upc ?? "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right text-xs text-slate-500">
                            {v.wholesale_price_cents != null
                              ? formatMoney(v.wholesale_price_cents)
                              : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-[#111]">
                            {formatMoney(v.price_cents)}
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            <span
                              className={`inline-block h-2 w-2 rounded-full ${v.status === "active" ? "bg-emerald-500" : "bg-slate-300"}`}
                            />
                          </td>
                          <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => router.push(`/catalog/${v.id}`)}
                              className="mr-3 text-xs text-[#5D5FEF] hover:underline"
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              onClick={() => void unlinkVariant(v.id)}
                              className="text-xs text-red-400 hover:text-red-700"
                              aria-label={`Unlink ${v.name}`}
                            >
                              Unlink
                            </button>
                          </td>
                        </tr>

                        {isExpanded && (
                          <VariantExpandedRow
                            key={`${v.id}-expanded`}
                            variant={v}
                            colSpan={8}
                            activeSubTab={activeSubTab}
                            onSubTabChange={(tab) =>
                              setSubTabs((prev) => ({ ...prev, [v.id]: tab }))
                            }
                          />
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
