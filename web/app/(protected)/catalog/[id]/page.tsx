"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── New combined tabs ─────────────────────────────────────────────────────────
import { OverviewTab }      from "./_components/OverviewTab";
import { TransactionsTab }  from "./_components/TransactionsTab";
import { PurchasingTab }    from "./_components/PurchasingTab";

// ── Existing tabs ─────────────────────────────────────────────────────────────
import { GeneralTab }    from "./_components/GeneralTab";
import { InventoryTab }  from "./_components/InventoryTab";
import { MarketingTab }  from "./_components/MarketingTab";
import { ExpiryTab }     from "./_components/ExpiryTab";
import { VariantsTab }   from "./_components/VariantsTab";
import { EcommerceTab }  from "./_components/EcommerceTab";
import { PricingTab }    from "./_components/PricingTab";
import { AnalyticsTab }  from "./_components/AnalyticsTab";
import { AuditLogTab }   from "./_components/AuditLogTab";
import { ImagesTab }     from "./_components/ImagesTab";
import { LabelsTab }     from "./_components/LabelsTab";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab =
  | "overview" | "general" | "variants" | "pricing"
  | "inventory" | "purchasing" | "transactions" | "expiry"
  | "media" | "ecommerce" | "compliance" | "labels"
  | "analytics" | "audit-log";

const STATUS_BADGE = { active: "green", draft: "yellow", archived: "gray" } as const;

// 14 tabs (down from 21). Grouped logically:
// Core → Inventory → Activity → Content/Compliance → Insights
const TABS: { key: Tab; label: string; group: string }[] = [
  { key: "general",       label: "Product Details",  group: "core" },
  { key: "variants",      label: "Master & Variants", group: "core" },
  { key: "overview",      label: "Overview",         group: "core" },
  { key: "pricing",       label: "Pricing",          group: "core" },
  { key: "inventory",     label: "Inventory",        group: "inventory" },
  { key: "purchasing",    label: "Purchasing",       group: "inventory" },
  { key: "expiry",        label: "Expiry",           group: "inventory" },
  { key: "transactions",  label: "Transactions",     group: "activity" },
  { key: "media",         label: "Media",            group: "content" },
  { key: "ecommerce",     label: "Online",           group: "content" },
  { key: "compliance",    label: "Compliance",       group: "content" },
  { key: "labels",        label: "Labels",           group: "content" },
  { key: "analytics",     label: "Analytics",        group: "insights" },
  { key: "audit-log",     label: "Audit Log",        group: "insights" },
];

// Visual separators: show a small divider before the first tab of each new group
const GROUP_BREAKS = new Set(["inventory", "activity", "content", "insights"]);

// ── Stock badge helper ────────────────────────────────────────────────────────

function StockBadge({ total, reorderPoint }: { total: number; reorderPoint: number }) {
  if (total === 0) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
      <span className="h-1.5 w-1.5 rounded-full bg-red-500" />Out of stock
    </span>
  );
  if (total <= reorderPoint) return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-700">
      <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />Low stock · {total}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />In stock · {total}
    </span>
  );
}

function ProductTypeBadge({
  product,
  variantCount,
}: {
  product: CatalogProduct;
  variantCount: number | null;
}) {
  if (product.parent_product_id) {
    return <Badge variant="blue">Variant</Badge>;
  }

  if (variantCount !== null && variantCount > 0) {
    return <Badge variant="purple">Master · {variantCount}</Badge>;
  }

  return <Badge variant="gray">Standalone</Badge>;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function ProductDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct]       = useState<CatalogProduct | null>(null);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);
  const [activeTab, setActiveTab]   = useState<Tab>("general");
  const [duplicating, setDuplicating] = useState(false);
  const [showActions, setShowActions] = useState(false);
  const [barcodeResult, setBarcodeResult] = useState<"ok" | "not_found" | null>(null);
  const [expiryAlertCount, setExpiryAlertCount] = useState(0);
  const [stockTotal, setStockTotal] = useState<number | null>(null);
  const [variantCount, setVariantCount] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const prod = await apiGet<CatalogProduct>(`/api/v1/catalog/${id}`);
      setProduct(prod);
      setVariantCount(prod.parent_product_id ? null : 0);

      // Parallel: expiry alert count + stock total for header badge
      const headerRequests = [
        apiGet<{ items: Array<{ expiry_status: string }> }>(`/api/v1/catalog/${id}/expiry`).then((r) => {
          const alerts = (r.items ?? []).filter(
            (b) => b.expiry_status === "expired" || b.expiry_status === "critical"
          ).length;
          setExpiryAlertCount(alerts);
        }),
        apiGet<{ locations: Array<{ quantity_on_hand: number }> }>(`/api/v1/catalog/${id}/stock`).then((r) => {
          const total = (r.locations ?? []).reduce((s, l) => s + l.quantity_on_hand, 0);
          setStockTotal(total);
        }),
      ];

      if (!prod.parent_product_id) {
        headerRequests.push(
          apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog/${id}/variants`).then((r) => {
            setVariantCount((r.items ?? []).length);
          }),
        );
      }

      Promise.allSettled(headerRequests);
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
          {/* Left: breadcrumb + name + all identity badges */}
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

            {/* Name row */}
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base font-bold text-slate-900 leading-tight">{product.name}</h1>
              <Badge variant={STATUS_BADGE[product.status]}>{product.status}</Badge>
              <Badge variant="gray">{product.sku}</Badge>
              <ProductTypeBadge product={product} variantCount={variantCount} />
              {product.tax_class === "exempt" && <Badge variant="yellow">Tax exempt</Badge>}
              {product.variant_label && <Badge variant="gray">Variant: {product.variant_label}</Badge>}
            </div>

            {/* Metrics row: price + margin + stock status */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-slate-200 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                {formatMoney(product.price_cents)}
              </span>
              {product.raw_cost_price_cents != null && product.raw_cost_price_cents > 0 && (() => {
                const margin = ((product.price_cents - product.raw_cost_price_cents) / product.price_cents) * 100;
                return (
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                    margin >= 30 ? "bg-emerald-100 text-emerald-700"
                    : margin > 0 ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
                  }`}>
                    {margin.toFixed(1)}% margin
                  </span>
                );
              })()}
              {stockTotal !== null && (
                <StockBadge total={stockTotal} reorderPoint={product.reorder_point ?? 0} />
              )}
              {product.barcode && (
                <span className="rounded-full border border-slate-100 bg-slate-50 px-2.5 py-0.5 font-mono text-[11px] text-slate-500">
                  {product.barcode}
                </span>
              )}
            </div>

            {product.parent_product_id && (
              <button
                type="button"
                onClick={() => router.push(`/catalog/${product.parent_product_id}`)}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
              >
                ↑ Part of master product
              </button>
            )}
          </div>

          {/* Right: actions */}
          <div className="flex items-center gap-2 flex-wrap">
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
                    <button type="button"
                      onClick={() => { setShowActions(false); router.push(`/register?product=${product.id}`); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
                      </svg>
                      Quick Sell
                    </button>
                    <button type="button"
                      onClick={() => { setShowActions(false); setActiveTab("transactions"); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
                      </svg>
                      Create Return
                    </button>
                    <button type="button"
                      onClick={() => { setShowActions(false); window.open(`/store/${product.id}`, "_blank"); }}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
                      </svg>
                      View on store
                    </button>
                    {product.barcode && (
                      <button type="button"
                        onClick={() => { setShowActions(false); void testBarcode(); }}
                        className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="2" y="4" width="2" height="16"/><rect x="6" y="4" width="1" height="16"/><rect x="9" y="4" width="2" height="16"/><rect x="13" y="4" width="1" height="16"/><rect x="16" y="4" width="2" height="16"/><rect x="20" y="4" width="2" height="16"/>
                        </svg>
                        Test barcode scan
                      </button>
                    )}
                    <div className="my-1 border-t border-slate-100" />
                    <button type="button"
                      onClick={() => { setShowActions(false); void handleDuplicate(); }}
                      disabled={duplicating}
                      className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-40">
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                      </svg>
                      {duplicating ? "Duplicating…" : "Duplicate"}
                    </button>
                  </div>
                </>
              )}
            </div>
            <Button size="sm" variant="secondary" onClick={() => router.push("/catalog")}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => window.dispatchEvent(new CustomEvent("finder:save-product"))}>
              Save
            </Button>
          </div>
        </div>

        {/* ── Barcode test result ──────────────────────────────────────────── */}
        {barcodeResult && (
          <div role="status" className={`mb-3 flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
            barcodeResult === "ok"
              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
              : "bg-red-50 text-red-700 border border-red-200"
          }`}>
            {barcodeResult === "ok" ? "✓ Barcode scan verified — product found" : "✗ Barcode not found in scanner lookup"}
          </div>
        )}

        {/* ── Tab nav ───────────────────────────────────────────────────────── */}
        <div className="mb-5 -mx-1 overflow-x-auto">
          <div className="flex gap-0 border-b border-slate-200 min-w-max px-1">
            {TABS.map(({ key, label, group }, idx) => {
              const prevGroup = idx > 0 ? TABS[idx - 1].group : group;
              const showDivider = GROUP_BREAKS.has(group) && prevGroup !== group;
              const badge = key === "expiry" && expiryAlertCount > 0 ? expiryAlertCount : null;
              return (
                <div key={key} className="flex items-center">
                  {showDivider && (
                    <div className="mx-1 h-5 w-px bg-slate-200 self-center" aria-hidden="true" />
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveTab(key)}
                    className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${
                      activeTab === key
                        ? "border-b-2 border-brand-600 text-brand-600"
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
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Tab content ──────────────────────────────────────────────────── */}
        {activeTab === "overview"     && <OverviewTab product={product} onNavigate={(t) => setActiveTab(t as Tab)} />}
        {activeTab === "general"      && <GeneralTab product={product} onSaved={setProduct} />}
        {activeTab === "variants"     && <VariantsTab product={product} />}
        {activeTab === "pricing"      && <PricingTab product={product} />}
        {activeTab === "inventory"    && <InventoryTab product={product} onSaved={setProduct} />}
        {activeTab === "purchasing"   && <PurchasingTab productId={product.id} />}
        {activeTab === "transactions" && <TransactionsTab productId={product.id} />}
        {activeTab === "expiry"       && <ExpiryTab productId={product.id} />}
        {activeTab === "media"        && <ImagesTab productId={product.id} />}
        {activeTab === "ecommerce"    && <EcommerceTab product={product} />}
        {activeTab === "compliance"   && <MarketingTab product={product} onSaved={setProduct} />}
        {activeTab === "labels"       && <LabelsTab product={product} />}
        {activeTab === "analytics"    && <AnalyticsTab productId={product.id} />}
        {activeTab === "audit-log"    && <AuditLogTab productId={product.id} />}

      </div>
    </EnterpriseShell>
  );
}
