"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";
import { GeneralTab }    from "./_components/GeneralTab";
import { InventoryTab }  from "./_components/InventoryTab";
import { MarketingTab }  from "./_components/MarketingTab";
import { ExpiryTab }     from "./_components/ExpiryTab";
import { CategoriesTab } from "./_components/CategoriesTab";
import { SalesTab }      from "./_components/SalesTab";
import { ReturnsTab }    from "./_components/ReturnsTab";
import { CreditsTab }    from "./_components/CreditsTab";
import { InvoicesTab }   from "./_components/InvoicesTab";
import { VariantsTab }   from "./_components/VariantsTab";
import { EcommerceTab }  from "./_components/EcommerceTab";
import { PricingTab }                from "./_components/PricingTab";
import { SuppliersTab }             from "./_components/SuppliersTab";
import { PurchasesTab }             from "./_components/PurchasesTab";
import { AnalyticsTab }             from "./_components/AnalyticsTab";
import { AuditLogTab }              from "./_components/AuditLogTab";
import { ImagesTab }                from "./_components/ImagesTab";
import { SalesCustomerTab }         from "./_components/SalesCustomerTab";
import { ReorderSuggestionsTab }    from "./_components/ReorderSuggestionsTab";
import { SupplierPriceComparisonTab } from "./_components/SupplierPriceComparisonTab";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab =
  | "general" | "variants" | "categories" | "inventory" | "expiry"
  | "sales" | "returns" | "credits" | "invoices" | "marketing" | "ecommerce"
  | "pricing" | "suppliers" | "purchases" | "analytics" | "audit-log" | "images"
  | "sales-customer" | "reorder" | "price-comparison";

const STATUS_BADGE = { active: "green", draft: "yellow", archived: "gray" } as const;

const TABS: { key: Tab; label: string }[] = [
  { key: "general",          label: "General" },
  { key: "variants",         label: "Variants" },
  { key: "pricing",          label: "Pricing" },
  { key: "inventory",        label: "Inventory" },
  { key: "purchases",        label: "Purchase by Supplier" },
  { key: "sales-customer",   label: "Sales by Customer" },
  { key: "reorder",          label: "Reorder" },
  { key: "price-comparison", label: "Supplier Prices" },
  { key: "suppliers",        label: "Suppliers" },
  { key: "expiry",           label: "Expiry" },
  { key: "images",           label: "Images" },
  { key: "ecommerce",        label: "eCommerce" },
  { key: "categories",       label: "Categories" },
  { key: "sales",            label: "Sales" },
  { key: "returns",          label: "Returns" },
  { key: "credits",          label: "Credits" },
  { key: "invoices",         label: "Invoices" },
  { key: "marketing",        label: "Compliance" },
  { key: "analytics",        label: "Analytics" },
  { key: "audit-log",        label: "Audit Log" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct] = useState<CatalogProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("general");
  const [duplicating, setDuplicating] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<"ok" | "not_found" | null>(null);
  const [expiryAlertCount, setExpiryAlertCount] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const prod = await apiGet<CatalogProduct>(`/api/v1/catalog/${id}`);
      setProduct(prod);
      apiGet<{ items: Array<{ expiry_status: string }> }>(`/api/v1/catalog/${id}/expiry`)
        .then((r) => {
          const alerts = (r.items ?? []).filter(
            (b) => b.expiry_status === "expired" || b.expiry_status === "critical"
          ).length;
          setExpiryAlertCount(alerts);
        })
        .catch(() => {});
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load product.");
    } finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const handleDuplicate = async () => {
    if (!product) return;
    setDuplicating(true);
    try {
      const copy = await apiPost<CatalogProduct>(`/api/v1/catalog/${id}/duplicate`, {});
      router.push(`/catalog/${copy.id}`);
    } catch { /* button re-enables */ }
    finally { setDuplicating(false); }
  };

  const testBarcode = async () => {
    if (!product?.barcode) return;
    setBarcodeResult(null);
    try {
      await apiGet(`/api/v1/catalog/barcode/${product.barcode}`);
      setBarcodeResult("ok");
    } catch {
      setBarcodeResult("not_found");
    }
    setTimeout(() => setBarcodeResult(null), 3000);
  };

  if (loading) {
    return (
      <EnterpriseShell active="catalog" title="Product" subtitle="Loading…" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-6">
          {[1, 2, 3].map((i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
        </div>
      </EnterpriseShell>
    );
  }

  if (error || !product) {
    return (
      <EnterpriseShell active="catalog" title="Product" subtitle="Not found" contentClassName="overflow-y-auto">
        <div className="mx-auto max-w-5xl px-4 py-5 sm:px-6">
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {error ?? "Product not found."}
          </p>
          <Button variant="secondary" size="sm" onClick={() => router.back()} className="mt-4">← Back</Button>
        </div>
      </EnterpriseShell>
    );
  }

  return (
    <EnterpriseShell active="catalog" title={product.name} subtitle={product.sku} contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-4 py-5 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          {/* Left: back + name + badges */}
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              onClick={() => router.push("/catalog")}
              className="flex items-center gap-1 text-sm text-slate-500 transition-colors hover:text-[#111]"
              aria-label="Back to Products"
            >
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M10 13L5 8l5-5"/>
              </svg>
              Products
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 leading-tight">{product.name}</h1>
              <Badge variant={STATUS_BADGE[product.status]}>{product.status}</Badge>
              <Badge variant="gray">{product.sku}</Badge>
              {/* Retail price + margin */}
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {formatMoney(product.price_cents)}
              </span>
              {product.raw_cost_price_cents != null && product.raw_cost_price_cents > 0 && (() => {
                const margin = ((product.price_cents - product.raw_cost_price_cents) / product.price_cents) * 100;
                return (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    margin >= 30 ? "bg-emerald-100 text-emerald-700" : margin > 0 ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"
                  }`}>
                    Margin: {margin.toFixed(1)}%
                  </span>
                );
              })()}
              {product.tax_class === "exempt" && <Badge variant="yellow">Tax exempt</Badge>}
              {product.variant_label && (
                <Badge variant="gray">Variant: {product.variant_label}</Badge>
              )}
            </div>
            {product.parent_product_id && (
              <button
                type="button"
                onClick={() => router.push(`/catalog/${product.parent_product_id}`)}
                className="flex items-center gap-1 text-xs font-medium text-[#5D5FEF] hover:underline"
              >
                ↑ Part of master product
              </button>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* Quick action menu */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowActions((v) => !v)}
                className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm hover:bg-slate-50 transition-colors"
                aria-haspopup="menu"
                aria-expanded={showActions}
              >
                Actions
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <polyline points="6 9 12 15 18 9"/>
                </svg>
              </button>
              {showActions && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setShowActions(false)} />
                  <div className="absolute right-0 top-full z-40 mt-1 w-52 rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                    <button
                      type="button"
                      onClick={() => { setShowActions(false); router.push(`/register?product=${product.id}`); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                      </svg>
                      Quick Sell
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowActions(false); setActiveTab("returns"); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
                      </svg>
                      Create Return
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowActions(false); setActiveTab("invoices"); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
                      </svg>
                      Add to Invoice
                    </button>
                    <button
                      type="button"
                      onClick={() => { setShowActions(false); window.open(`/store/${product.id}`, "_blank"); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      View on store
                    </button>
                    {product.barcode && (
                      <button
                        type="button"
                        onClick={() => { setShowActions(false); void testBarcode(); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                          strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="2" y="4" width="2" height="16"/><rect x="6" y="4" width="1" height="16"/><rect x="9" y="4" width="2" height="16"/><rect x="13" y="4" width="1" height="16"/><rect x="16" y="4" width="2" height="16"/><rect x="20" y="4" width="2" height="16"/>
                        </svg>
                        Test barcode scan
                      </button>
                    )}
                    <div className="my-1 border-t border-slate-100" />
                    <button
                      type="button"
                      onClick={() => { setShowActions(false); void handleDuplicate(); }}
                      disabled={duplicating}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                        strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {duplicating ? "Duplicating…" : "Duplicate"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button size="sm" variant="secondary" onClick={() => router.push("/catalog")}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => window.dispatchEvent(new CustomEvent("finder:save-product"))}
            >
              Save
            </Button>
          </div>
        </div>

        {/* ── Barcode test result ──────────────────────────────────────────── */}
        {barcodeResult && (
          <div
            role="status"
            className={`mb-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
              barcodeResult === "ok"
                ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                : "bg-red-50 text-red-700 border border-red-200"
            }`}
          >
            {barcodeResult === "ok" ? "✓ Barcode scan verified — product found" : "✗ Barcode not found in scanner lookup"}
          </div>
        )}

        {/* ── Tab nav (scrollable on mobile) ────────────────────────────────── */}
        <div className="mb-5 -mx-1 overflow-x-auto">
          <div className="flex gap-0 border-b border-slate-200 min-w-max px-1">
            {TABS.map(({ key, label }) => {
              const badge = key === "expiry" && expiryAlertCount > 0 ? expiryAlertCount : null;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveTab(key)}
                  className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                    activeTab === key
                      ? "border-b-2 border-[#5D5FEF] text-[#5D5FEF]"
                      : "border-b-2 border-transparent text-slate-500 hover:text-[#111]"
                  }`}
                >
                  {label}
                  {badge !== null && (
                    <span className="flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ─────────────────────────────────────────────────── */}
        {activeTab === "general" && (
          <GeneralTab product={product} onSaved={setProduct} />
        )}
        {activeTab === "variants" && (
          <VariantsTab product={product} />
        )}
        {activeTab === "categories" && (
          <CategoriesTab productId={product.id} />
        )}
        {activeTab === "inventory" && (
          <InventoryTab product={product} onSaved={setProduct} />
        )}
        {activeTab === "expiry" && (
          <ExpiryTab productId={product.id} />
        )}
        {activeTab === "sales" && (
          <SalesTab productId={product.id} />
        )}
        {activeTab === "returns" && (
          <ReturnsTab productId={product.id} />
        )}
        {activeTab === "credits" && (
          <CreditsTab productId={product.id} />
        )}
        {activeTab === "invoices" && (
          <InvoicesTab productId={product.id} />
        )}
        {activeTab === "marketing" && (
          <MarketingTab product={product} onSaved={setProduct} />
        )}
        {activeTab === "ecommerce" && (
          <EcommerceTab product={product} />
        )}
        {activeTab === "pricing" && (
          <PricingTab product={product} />
        )}
        {activeTab === "suppliers" && (
          <SuppliersTab productId={product.id} />
        )}
        {activeTab === "purchases" && (
          <PurchasesTab productId={product.id} />
        )}
        {activeTab === "analytics" && (
          <AnalyticsTab productId={product.id} />
        )}
        {activeTab === "audit-log" && (
          <AuditLogTab productId={product.id} />
        )}
        {activeTab === "images" && (
          <ImagesTab productId={product.id} />
        )}
        {activeTab === "sales-customer" && (
          <SalesCustomerTab productId={product.id} />
        )}
        {activeTab === "reorder" && (
          <ReorderSuggestionsTab productId={product.id} />
        )}
        {activeTab === "price-comparison" && (
          <SupplierPriceComparisonTab productId={product.id} />
        )}

      </div>
    </EnterpriseShell>
  );
}
