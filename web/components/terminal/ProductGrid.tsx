"use client";

/**
 * ProductGrid — catalog browser with search and category filter.
 *
 * Fetches GET /api/v1/catalog on mount and on filter changes.
 * Clicking a product card fires onAddProduct.
 *
 * Accessibility: keyboard-navigable grid, ARIA labels on all interactive elements.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { apiGet } from "@/api-client/client";
import type { TerminalProduct as Product, CatalogListResponse } from "@/api-client/types";
import { formatMoney } from "@/lib/money";
import { normalizeTerminalProduct } from "@/lib/normalizeTerminalProduct";
import { LotPickerModal } from "./LotPickerModal";

interface ProductGridProps {
  onAddProduct: (product: Product) => void;
}

// Derive categories from the product list
function getCategories(products: Product[]): string[] {
  const set = new Set(products.map((p) => p.category));
  return ["All", ...Array.from(set).sort()];
}

// ── Quick Keys (spec: configurable grid of product shortcuts) ─────────────────

const QUICK_KEY_COLORS = ["#5D5FEF", "#10B981", "#F97316", "#EAB308", "#EC4899", "#3B82F6", "#8B5CF6", "#EF4444", "#14B8A6", "#F97316"];

function QuickKeysGrid({ allProducts, onAddProduct }: { allProducts: Product[]; onAddProduct: (p: Product) => void }) {
  // Pin the first 10 products as quick keys — in production this would be user-configurable
  const keys = allProducts.slice(0, 10);

  if (keys.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-[#999]">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="mb-3 opacity-40" aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 8h10M7 12h4"/><path d="M15 12h2M15 16h2M7 16h4"/>
        </svg>
        <p className="text-sm">No products available</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-3">
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4" role="list">
        {keys.map((product, idx) => {
          const bg = QUICK_KEY_COLORS[idx % QUICK_KEY_COLORS.length]!;
          return (
            <li key={product.id} role="listitem">
              <button type="button" onClick={() => onAddProduct(product)}
                aria-label={`Quick key: ${product.name} — ${formatMoney(product.priceCents)}`}
                className="group flex min-h-[100px] w-full select-none flex-col items-start justify-between rounded-xl p-3.5 text-white shadow-sm active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                style={{ backgroundColor: bg }}>
                <span className="text-sm font-semibold leading-tight line-clamp-2 text-white/90">{product.name}</span>
                <span className="mt-2 text-base font-bold text-white tabular-nums">{formatMoney(product.priceCents)}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function ProductGrid({ onAddProduct }: ProductGridProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [mode, setMode] = useState<"catalog" | "quickkeys">("catalog");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lotPicker, setLotPicker] = useState<Product | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  // Initial load — fetch full catalog
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<CatalogListResponse>("/api/v1/catalog?pageSize=200")
      .then((data) => {
        if (!cancelled) {
          // Normalize: the real backend returns snake_case (price_cents);
          // the mock layer returns camelCase. See normalizeTerminalProduct.
          const items = data.items.map(normalizeTerminalProduct);
          setAllProducts(items);
          setProducts(items);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError("Could not load products. Please try again.");
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-filter locally for instant UX; the real backend also supports params.
  useEffect(() => {
    let filtered = allProducts;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.barcode?.toLowerCase().includes(q)
      );
    }
    if (category !== "All") {
      filtered = filtered.filter((p) => p.category === category);
    }
    setProducts(filtered);
  }, [search, category, allProducts]);

  const categories = getCategories(allProducts);

  // Auto-focus the search input on mount so keyboard-wedge scanners work immediately.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // Re-focus after each product add so the cashier can scan the next item
  // without clicking the search box again (critical for barcode scanner workflow).
  const handleAddProduct = useCallback(
    (product: Product) => {
      // FE-46: If the product has lot tracking, show FEFO lot picker before adding.
      if (product.lotTracked) {
        setLotPicker(product);
        return;
      }
      onAddProduct(product);
      // Small timeout lets React re-render the cart before stealing focus back.
      setTimeout(() => searchRef.current?.focus(), 50);
    },
    [onAddProduct],
  );

  const handleLotConfirm = useCallback(
    (_lotId: string, lotCode: string | null) => {
      if (!lotPicker) return;
      // Attach lot code to the product before adding to cart.
      onAddProduct({ ...lotPicker, barcode: lotCode ?? lotPicker.barcode });
      setLotPicker(null);
      setTimeout(() => searchRef.current?.focus(), 50);
    },
    [lotPicker, onAddProduct],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent, product: Product) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleAddProduct(product);
      }
    },
    [handleAddProduct],
  );

  return (
    <section
      aria-label="Product catalog"
      className="flex flex-col h-full overflow-hidden"
    >
      {/* ── Search bar + mode toggle ────────────────────────────────────── */}
      <div className="flex-none border-b border-gray-200 bg-white px-3 pb-3 pt-3 sm:px-4 sm:pt-4">
        {/* Mode pills: All Products | Quick Keys */}
        <div className="mb-2.5 flex gap-1.5">
          <button type="button" onClick={() => setMode("catalog")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${mode === "catalog" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            All Products
          </button>
          <button type="button" onClick={() => setMode("quickkeys")}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${mode === "quickkeys" ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            Quick Keys
          </button>
        </div>
        {mode === "catalog" && (
          <>
            <label htmlFor="catalog-search" className="sr-only">
              Search products
            </label>
            <div className="relative">
              <span aria-hidden="true" className="absolute inset-y-0 left-3 flex items-center text-gray-400 pointer-events-none">
                <SearchIcon />
              </span>
              <input
                id="catalog-search"
                ref={searchRef}
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name, SKU, or barcode…"
                className={clsx(
                  "w-full rounded-lg border border-gray-300 bg-white py-2.5 pl-10 pr-4",
                  "text-sm text-gray-900 placeholder-gray-400",
                  "focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600",
                  "min-h-[44px]"
                )}
                autoComplete="off"
                aria-label="Search products"
              />
            </div>
          </>
        )}
      </div>

      {/* ── Quick Keys grid ─────────────────────────────────────────────── */}
      {mode === "quickkeys" && (
        <QuickKeysGrid allProducts={allProducts} onAddProduct={handleAddProduct} />
      )}

      {/* ── Category filter tabs (catalog mode only) ─────────────────────── */}
      {mode === "catalog" && (
        <div
          role="tablist"
          aria-label="Product categories"
          className="scrollbar-hide flex flex-none gap-2 overflow-x-auto border-b border-gray-200 bg-white px-3 py-2.5 sm:px-4"
        >
          {categories.map((cat) => (
            <button
              key={cat}
              role="tab"
              aria-selected={category === cat}
              onClick={() => setCategory(cat)}
              className={clsx(
                "shrink-0 rounded-lg px-4 py-1.5 text-sm font-medium transition-colors",
                "min-h-[36px] focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
                category === cat
                  ? "bg-brand-600 text-white"
                  : "bg-gray-100 text-gray-700 hover:bg-gray-200"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* ── Product grid (catalog mode only) ────────────────────────────── */}
      {mode === "catalog" && (
      <div
        className="flex-1 overflow-y-auto p-3 sm:p-4"
        role="tabpanel"
        aria-label={`${category} products`}
      >
        {loading && (
          <div className="flex items-center justify-center py-16">
            <div
              className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600"
              aria-label="Loading products"
            />
          </div>
        )}

        {!loading && error && (
          <div role="alert" className="rounded-lg bg-danger-50 p-4 text-sm text-danger-700 border border-danger-200">
            {error}
          </div>
        )}

        {!loading && !error && products.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-gray-400">
            <SearchEmptyIcon />
            <p className="text-sm">No products found</p>
          </div>
        )}

        {!loading && !error && products.length > 0 && (
          <ul
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-3 2xl:grid-cols-4"
            role="list"
            aria-label="Product list"
          >
            {products.map((product) => (
              <li key={product.id} role="listitem">
                <ProductCard
                  product={product}
                  onAdd={handleAddProduct}
                  onKeyDown={(e) => handleKeyDown(e, product)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
      )} {/* end catalog mode */}

      {/* FE-46: Lot picker modal — shown for lot-tracked products */}
      {lotPicker && (
        <LotPickerModal
          productId={lotPicker.id}
          productName={lotPicker.name}
          onConfirm={handleLotConfirm}
          onCancel={() => { setLotPicker(null); setTimeout(() => searchRef.current?.focus(), 50); }}
        />
      )}
    </section>
  );
}

// ─── Product card ─────────────────────────────────────────────────────────────

interface ProductCardProps {
  product: Product;
  onAdd: (product: Product) => void;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

function ProductCard({ product, onAdd, onKeyDown }: ProductCardProps) {
  // Category colour accent
  const accent = categoryAccent(product.category);

  return (
    <button
      type="button"
      onClick={() => onAdd(product)}
      onKeyDown={onKeyDown}
      aria-label={`Add ${product.name} — ${formatMoney(product.priceCents)} to cart`}
      className={clsx(
        "group relative flex min-h-[112px] w-full select-none flex-col justify-between rounded-lg border bg-white text-left shadow-sm",
        "transition-all duration-150 select-none",
        "p-3",
        "hover:shadow-md hover:border-brand-300 hover:-translate-y-px",
        "active:scale-95 active:shadow-sm",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:ring-offset-2",
        "border-gray-200"
      )}
    >
      {/* Category dot */}
      <div
        className={clsx("absolute top-2.5 right-2.5 h-2 w-2 rounded-full", accent)}
        aria-hidden="true"
      />

      <div>
        <p className="mb-0.5 text-xs font-medium uppercase text-gray-400">
          {product.category}
        </p>
        <p className="text-sm font-semibold text-gray-900 leading-tight line-clamp-2">
          {product.name}
        </p>
        <p className="mt-1 truncate text-xs text-gray-400">{product.sku}</p>
      </div>

      <div className="mt-2 flex items-end justify-between">
        <span className="text-base font-bold text-brand-700">
          {formatMoney(product.priceCents)}
        </span>
        <span
          className={clsx(
            "rounded-md bg-brand-50 p-1 text-brand-600",
            "group-hover:bg-brand-600 group-hover:text-white transition-colors",
            "text-base leading-none font-bold"
          )}
          aria-hidden="true"
        >
          +
        </span>
      </div>
    </button>
  );
}

function categoryAccent(category: string): string {
  const map: Record<string, string> = {
    Coffee: "bg-amber-500",
    Pastry: "bg-orange-400",
    "Cold Drinks": "bg-cyan-500",
    Specialty: "bg-purple-500",
  };
  return map[category] ?? "bg-gray-400";
}

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  );
}

function SearchEmptyIcon() {
  return (
    <svg
      className="mb-2"
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
      <path d="M8 11h6" />
    </svg>
  );
}
