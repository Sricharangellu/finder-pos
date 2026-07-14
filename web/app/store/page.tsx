"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { CatalogProduct } from "@/api-client/types";

// ── Types ─────────────────────────────────────────────────────────────────────

interface ProductGroup {
  master: CatalogProduct;
  variants: CatalogProduct[];
  isStandalone: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function groupProducts(products: CatalogProduct[]): ProductGroup[] {
  const masters   = products.filter((p) => !p.parent_product_id);
  const childMap  = new Map<string, CatalogProduct[]>();
  products.filter((p) => !!p.parent_product_id).forEach((p) => {
    const arr = childMap.get(p.parent_product_id!) ?? [];
    arr.push(p);
    childMap.set(p.parent_product_id!, arr);
  });
  return masters.map((m) => ({
    master: m,
    variants: childMap.get(m.id) ?? [],
    isStandalone: (childMap.get(m.id) ?? []).length === 0,
  }));
}

// ── Product card ──────────────────────────────────────────────────────────────

function ProductCard({ group }: { group: ProductGroup }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const { master, variants, isStandalone } = group;

  const minPrice = variants.length > 0
    ? Math.min(master.price_cents, ...variants.map((v) => v.price_cents))
    : master.price_cents;
  const maxPrice = variants.length > 0
    ? Math.max(master.price_cents, ...variants.map((v) => v.price_cents))
    : master.price_cents;
  const priceRange = minPrice === maxPrice
    ? formatMoney(minPrice)
    : `${formatMoney(minPrice)} – ${formatMoney(maxPrice)}`;

  return (
    <article className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition-all overflow-hidden">
      {/* Image / placeholder */}
      <div
        className="relative aspect-[4/3] cursor-pointer bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center overflow-hidden"
        onClick={() => router.push(`/store/${master.id}`)}
      >
        {master.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={master.image_url} alt={master.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        ) : (
          <svg className="h-14 w-14 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 10V7" />
          </svg>
        )}
        {/* Variant count badge */}
        {variants.length > 0 && (
          <div className="absolute top-2 right-2 rounded-full bg-brand-600 px-2 py-0.5 text-[11px] font-bold text-white shadow">
            {variants.length} variants
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex flex-1 flex-col gap-2 p-4">
        <div>
          <p className="text-xs text-slate-400 uppercase tracking-wide">{master.category}</p>
          <h2
            className="mt-0.5 text-sm font-semibold text-[#111] leading-snug cursor-pointer hover:text-brand-600 transition-colors line-clamp-2"
            onClick={() => router.push(`/store/${master.id}`)}
          >
            {master.name}
          </h2>
          <p className="mt-0.5 font-mono text-[11px] text-slate-400">{master.sku}</p>
        </div>

        <p className="text-base font-bold text-[#111]">{priceRange}</p>

        {/* Variant pills preview */}
        {variants.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
            >
              {expanded ? "Hide" : "Show"} variants
              <svg className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expanded && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {variants.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => router.push(`/store/${v.id}`)}
                    className="rounded-full border border-brand-600/30 bg-brand-600/5 px-2.5 py-0.5 text-xs font-medium text-brand-600 hover:bg-brand-600 hover:text-white transition-colors"
                    title={v.name}
                  >
                    {v.variant_label ?? v.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* CTA */}
        <div className="mt-auto pt-2">
          <button
            type="button"
            onClick={() => router.push(`/store/${master.id}`)}
            className="w-full rounded-xl bg-brand-600 py-2 text-sm font-semibold text-white hover:bg-[#4849d0] transition-colors"
          >
            {isStandalone ? "View product" : "Select variant"}
          </button>
        </div>
      </div>
    </article>
  );
}

// ── Store page ─────────────────────────────────────────────────────────────────

export default function StorePage() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [loading, setLoading]   = useState(true);
  const [q, setQ]               = useState("");
  const [category, setCategory] = useState("all");

  useEffect(() => {
    apiGet<{ items: CatalogProduct[] }>("/api/v1/catalog?status=active&limit=200")
      .then((r) => setProducts(r.items))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const categories = useMemo(
    () => ["all", ...Array.from(new Set(products.filter((p) => !p.parent_product_id).map((p) => p.category)))],
    [products],
  );

  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return products.filter((p) => {
      if (category !== "all" && p.category !== category && p.parent_product_id == null) return false;
      if (lq && !p.name.toLowerCase().includes(lq) && !p.sku.toLowerCase().includes(lq)) return false;
      return true;
    });
  }, [products, q, category]);

  const groups = useMemo(() => groupProducts(filtered), [filtered]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">

      {/* Search + filter */}
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-[#111]">Our Products</h1>
          <p className="mt-1 text-sm text-slate-500">{groups.length} product{groups.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="flex gap-2">
          <div className="relative">
            <svg className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round"/>
            </svg>
            <input
              className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-4 text-sm shadow-sm focus:border-brand-600 focus:outline-none"
              placeholder="Search products…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Category pills */}
      <div className="mb-6 flex flex-wrap gap-2">
        {categories.map((cat) => (
          <button
            key={cat}
            type="button"
            onClick={() => setCategory(cat)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors capitalize ${
              category === cat
                ? "bg-brand-600 text-white"
                : "bg-white border border-slate-200 text-slate-600 hover:border-brand-600 hover:text-brand-600"
            }`}
          >
            {cat === "all" ? "All" : cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[1,2,3,4,5,6,7,8].map((i) => (
            <div key={i} className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="aspect-[4/3] animate-pulse bg-slate-100" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 animate-pulse rounded bg-slate-100" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-slate-100" />
                <div className="h-8 animate-pulse rounded-xl bg-slate-100 mt-4" />
              </div>
            </div>
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="py-20 text-center">
          <p className="text-slate-400">No products found.</p>
        </div>
      ) : (
        <div className="grid gap-5 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {groups.map((g) => <ProductCard key={g.master.id} group={g} />)}
        </div>
      )}
    </div>
  );
}
