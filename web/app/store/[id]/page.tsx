"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function StatusPill({ status }: { status: string }) {
  const cls = status === "active" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500";
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize ${cls}`}>{status}</span>;
}

// ── Store product detail ──────────────────────────────────────────────────────

export default function StoreProductPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [product, setProduct]       = useState<CatalogProduct | null>(null);
  const [master, setMaster]         = useState<CatalogProduct | null>(null);
  const [variants, setVariants]     = useState<CatalogProduct[]>([]);
  const [selectedId, setSelectedId] = useState<string>(id);
  const [loading, setLoading]       = useState(true);
  const [qty, setQty]               = useState(1);
  const [addedToCart, setAddedToCart] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prod = await apiGet<CatalogProduct>(`/api/v1/catalog/${id}`);
      setProduct(prod);
      setSelectedId(prod.id);

      // If this product IS a child, load its master
      if (prod.parent_product_id) {
        const [masterData, siblingsRes] = await Promise.all([
          apiGet<CatalogProduct>(`/api/v1/catalog/${prod.parent_product_id}`),
          apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog/${prod.parent_product_id}/variants`),
        ]);
        setMaster(masterData);
        setVariants(siblingsRes.items);
      } else {
        // This is a master — load its variants
        const varRes = await apiGet<{ items: CatalogProduct[] }>(`/api/v1/catalog/${prod.id}/variants`);
        setMaster(prod);
        setVariants(varRes.items);
      }
    } catch { /* noop */ }
    finally { setLoading(false); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => variants.find((v) => v.id === selectedId) ?? product,
    [variants, selectedId, product],
  );

  const displayProduct = selected ?? product;

  // Full display name = "Master Name — Variant Label" or just product name
  const displayName = useMemo(() => {
    if (!displayProduct) return "";
    if (displayProduct.parent_product_id && master) {
      return displayProduct.variant_label
        ? `${master.name} — ${displayProduct.variant_label}`
        : displayProduct.name;
    }
    return displayProduct.name;
  }, [displayProduct, master]);

  const handleAddToCart = () => {
    setAddedToCart(true);
    setTimeout(() => setAddedToCart(false), 2500);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        <div className="grid gap-10 md:grid-cols-2">
          <div className="aspect-square animate-pulse rounded-2xl bg-slate-100" />
          <div className="space-y-4 pt-4">
            {[1,2,3,4].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-slate-100" style={{ width: `${[70,50,40,80][i-1]}%` }} />)}
          </div>
        </div>
      </div>
    );
  }

  if (!product || !displayProduct) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 text-center sm:px-6">
        <p className="text-slate-400">Product not found.</p>
        <button type="button" onClick={() => router.push("/store")} className="mt-4 text-sm font-medium text-brand-600 hover:underline">
          ← Back to store
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">

      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-slate-400">
        <button type="button" onClick={() => router.push("/store")} className="hover:text-brand-600 transition-colors">
          Products
        </button>
        <span>/</span>
        {master && master.id !== product.id && (
          <>
            <button type="button" onClick={() => router.push(`/store/${master.id}`)} className="hover:text-brand-600 transition-colors">
              {master.name}
            </button>
            <span>/</span>
          </>
        )}
        <span className="text-[#111] font-medium truncate">{displayName}</span>
      </nav>

      <div className="grid gap-10 md:grid-cols-2">

        {/* ── Image ─────────────────────────────────────────────────────── */}
        <div className="relative aspect-square rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center overflow-hidden shadow-sm">
          {displayProduct.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={displayProduct.image_url} alt={displayName} className="h-full w-full object-contain p-6" />
          ) : (
            <svg className="h-24 w-24 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
            </svg>
          )}
          {displayProduct.status && (
            <div className="absolute top-3 left-3"><StatusPill status={displayProduct.status} /></div>
          )}
        </div>

        {/* ── Details ───────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-5">

          {/* Master + variant full name */}
          <div>
            {master && master.id !== displayProduct.id && (
              <p className="text-xs font-semibold uppercase tracking-wider text-brand-600 mb-1">
                {master.name}
              </p>
            )}
            <h1 className="text-2xl font-bold text-[#111] leading-tight">{displayName}</h1>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="font-mono text-sm text-slate-400">{displayProduct.sku}</span>
              {displayProduct.barcode && (
                <span className="font-mono text-xs text-slate-300">{displayProduct.barcode}</span>
              )}
            </div>
          </div>

          {/* Price */}
          <div>
            <p className="text-3xl font-bold text-[#111]">{formatMoney(displayProduct.price_cents)}</p>
            {displayProduct.msrp_cents && displayProduct.msrp_cents > displayProduct.price_cents && (
              <p className="mt-0.5 text-sm text-slate-400">
                MSRP <span className="line-through">{formatMoney(displayProduct.msrp_cents)}</span>
                <span className="ml-1.5 font-semibold text-emerald-600">
                  Save {formatMoney(displayProduct.msrp_cents - displayProduct.price_cents)}
                </span>
              </p>
            )}
          </div>

          {/* Variant selector */}
          {variants.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-[#111]">
                Select variant
                {selectedId && selectedId !== (master?.id) && (
                  <span className="ml-2 text-brand-600">
                    — {variants.find((v) => v.id === selectedId)?.variant_label ?? ""}
                  </span>
                )}
              </p>
              <div className="flex flex-wrap gap-2">
                {/* Master option */}
                <button
                  type="button"
                  onClick={() => { setSelectedId(master!.id); setProduct(master!); }}
                  className={`rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors ${
                    selectedId === master?.id
                      ? "border-brand-600 bg-brand-600/5 text-brand-600"
                      : "border-slate-200 text-slate-600 hover:border-brand-600/50"
                  }`}
                >
                  Default
                </button>
                {variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => { setSelectedId(v.id); setProduct(v); router.replace(`/store/${v.id}`, { scroll: false }); }}
                    className={`rounded-xl border-2 px-4 py-2 text-sm font-medium transition-colors ${
                      selectedId === v.id
                        ? "border-brand-600 bg-brand-600/5 text-brand-600"
                        : "border-slate-200 text-slate-600 hover:border-brand-600/50"
                    }`}
                    title={v.name}
                  >
                    {v.variant_label ?? v.name}
                    {v.price_cents !== (master?.price_cents ?? v.price_cents) && (
                      <span className="ml-1 text-xs text-slate-400">{formatMoney(v.price_cents)}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Description */}
          {displayProduct.description && (
            <p className="text-sm text-slate-600 leading-relaxed">{displayProduct.description}</p>
          )}

          {/* Qty + add to cart */}
          <div className="flex items-center gap-3 pt-2">
            <div className="flex items-center rounded-xl border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setQty((q) => Math.max(1, q - 1))}
                className="px-4 py-2.5 text-slate-500 hover:bg-slate-50 transition-colors font-medium"
              >
                −
              </button>
              <span className="w-10 text-center text-sm font-semibold text-[#111]">{qty}</span>
              <button
                type="button"
                onClick={() => setQty((q) => q + 1)}
                className="px-4 py-2.5 text-slate-500 hover:bg-slate-50 transition-colors font-medium"
              >
                +
              </button>
            </div>
            <button
              type="button"
              onClick={handleAddToCart}
              className={`flex-1 rounded-xl py-2.5 text-sm font-bold transition-all ${
                addedToCart
                  ? "bg-emerald-500 text-white"
                  : "bg-brand-600 text-white hover:bg-[#4849d0]"
              }`}
            >
              {addedToCart ? "✓ Added to cart" : `Add to cart · ${formatMoney(displayProduct.price_cents * qty)}`}
            </button>
          </div>

          {/* Meta */}
          <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-500 space-y-1">
            {displayProduct.brand && <p>Brand: <span className="font-medium text-[#111]">{displayProduct.brand}</span></p>}
            <p>Category: <span className="font-medium text-[#111]">{displayProduct.category}</span></p>
            <p>SKU: <span className="font-mono font-medium text-[#111]">{displayProduct.sku}</span></p>
            {displayProduct.tax_class === "exempt" && (
              <p className="text-amber-600 font-medium">Tax exempt</p>
            )}
          </div>
        </div>
      </div>

      {/* Back link */}
      <div className="mt-10">
        <button type="button" onClick={() => router.push("/store")} className="text-sm font-medium text-slate-400 hover:text-brand-600 transition-colors">
          ← Back to all products
        </button>
      </div>
    </div>
  );
}
