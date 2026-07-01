"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { clsx } from "clsx";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch, apiDelete, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { Product, Category, ProductStatus, ProductsResponse } from "@/api-client/types";
import { ProductFormModal } from "./ProductFormModal";
import { PrintLabelsModal } from "./PrintLabelsModal";
import { ImportCSVModal } from "./ImportCSVModal";
import { SortTh } from "./SortTh";
import { BulkActionBar } from "./BulkActionBar";

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(s: ProductStatus): "green" | "yellow" | "gray" {
  if (s === "active") return "green";
  if (s === "draft")  return "yellow";
  return "gray";
}

function productStatusStyle(status: ProductStatus) {
  if (status === "active") {
    return { row: "border-l-success-500 bg-success-50/30 hover:bg-success-50/70", card: "border-l-success-500 bg-success-50/30", dot: "bg-success-500" };
  }
  if (status === "draft") {
    return { row: "border-l-warning-500 bg-warning-50/30 hover:bg-warning-50/70", card: "border-l-warning-500 bg-warning-50/30", dot: "bg-warning-500" };
  }
  return { row: "border-l-slate-300 bg-slate-50/70 text-slate-500 hover:bg-slate-100", card: "border-l-slate-300 bg-slate-50/80", dot: "bg-slate-400" };
}

type MetricTone = "neutral" | "success" | "warning" | "muted" | "restricted";

function metricToneClass(tone: MetricTone) {
  const tones: Record<MetricTone, string> = {
    neutral: "border-slate-200 bg-white",
    success: "border-success-200 bg-success-50",
    warning: "border-warning-200 bg-warning-50",
    muted: "border-slate-200 bg-slate-50",
    restricted: "border-orange-200 bg-orange-50",
  };
  return tones[tone];
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CatalogMetric({ label, value, helper, tone = "neutral", active = false }: {
  label: string; value: number; helper: string;
  tone?: MetricTone; active?: boolean;
}) {
  return (
    <div className={clsx("rounded-md border px-4 py-3 transition-colors", metricToneClass(tone), active && "ring-2 ring-brand-200")}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums text-slate-950">{value}</span>
        <span className="text-xs text-slate-500">{helper}</span>
      </div>
    </div>
  );
}

function ProductListCard({ product, onEdit, onArchive }: {
  product: Product; onEdit: () => void; onArchive: () => void;
}) {
  const style = productStatusStyle(product.status);
  return (
    <article className={clsx("space-y-3 border-l-4 px-4 py-4", style.card)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          <span className={clsx("mt-1.5 h-2 w-2 shrink-0 rounded-full", style.dot)} aria-hidden="true" />
          <div className="min-w-0">
            <h3 className={clsx("truncate text-sm font-semibold", product.status === "archived" ? "text-slate-600" : "text-slate-950")}>{product.name}</h3>
            <p className="mt-1 font-mono text-xs text-slate-500">{product.sku}</p>
          </div>
        </div>
        <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-950">{formatMoney(product.price_cents)}</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={statusBadge(product.status)}>{product.status.charAt(0).toUpperCase() + product.status.slice(1)}</Badge>
        <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{product.category}</span>
        {product.brand && <span className="text-xs text-slate-500">{product.brand}</span>}
        {product.age_restricted === 1 && (
          <span className="rounded-md bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-orange-200">18+</span>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onEdit} className="min-h-[36px] rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-700 hover:bg-slate-100">Edit</button>
        {product.status !== "archived" && (
          <button type="button" onClick={onArchive} className="min-h-[36px] rounded-md border border-slate-200 px-3 text-xs font-medium text-slate-500 hover:bg-slate-100">Archive</button>
        )}
      </div>
    </article>
  );
}

// ── ProductsTab ───────────────────────────────────────────────────────────────

export function ProductsTab({ categories }: { categories: Category[] }) {
  const router = useRouter();
  const [products, setProducts]     = useState<Product[]>([]);
  const [total, setTotal]           = useState(0);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState<string | null>(null);

  const [filterStatus, setFilterStatus]     = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [search, setSearch]                 = useState("");
  const [debouncedQ, setDebouncedQ]         = useState("");

  const [filterTaxClass, setFilterTaxClass]           = useState("");
  const [filterBrand, setFilterBrand]                 = useState("");
  const [filterAgeRestricted, setFilterAgeRestricted] = useState(false);
  const [priceMin, setPriceMin]                       = useState("");
  const [priceMax, setPriceMax]                       = useState("");
  const [showMoreFilters, setShowMoreFilters]          = useState(false);

  const [sortCol, setSortCol] = useState("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set());
  const [showPrintLabels, setShowPrintLabels] = useState(false);

  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkError, setBulkError]     = useState<string | null>(null);

  const [showImport, setShowImport]           = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [duplicating, setDuplicating]         = useState<string | null>(null);

  const [showCreate, setShowCreate]       = useState(false);
  const [editTarget, setEditTarget]       = useState<Product | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Product | null>(null);
  const [archiving, setArchiving]         = useState(false);
  const [actionError, setActionError]     = useState<string | null>(null);

  const activeCount     = products.filter(p => p.status === "active").length;
  const draftCount      = products.filter(p => p.status === "draft").length;
  const archivedCount   = products.filter(p => p.status === "archived").length;
  const restrictedCount = products.filter(p => p.age_restricted === 1).length;

  const hasFilters = Boolean(filterStatus || filterCategory || debouncedQ || filterTaxClass || filterBrand || filterAgeRestricted || priceMin || priceMax);

  const filterSummary = [
    filterStatus         ? `Status: ${filterStatus}`          : null,
    filterCategory       ? `Category: ${filterCategory}`      : null,
    debouncedQ           ? `Search: "${debouncedQ}"`          : null,
    filterTaxClass       ? `Tax: ${filterTaxClass}`           : null,
    filterBrand          ? `Brand: "${filterBrand}"`          : null,
    filterAgeRestricted  ? "Age restricted only"              : null,
    priceMin && priceMax ? `Price: $${priceMin}–$${priceMax}` : priceMin ? `Price ≥ $${priceMin}` : priceMax ? `Price ≤ $${priceMax}` : null,
  ].filter(Boolean);

  const clearFilters = () => {
    setFilterStatus(""); setFilterCategory(""); setSearch(""); setDebouncedQ("");
    setFilterTaxClass(""); setFilterBrand(""); setFilterAgeRestricted(false);
    setPriceMin(""); setPriceMax("");
  };

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(search), 300);
    return () => clearTimeout(t);
  }, [search]);

  const visibleProducts = useMemo<Product[]>(() => {
    let result = products;
    if (filterTaxClass)      result = result.filter(p => p.tax_class === filterTaxClass);
    if (filterBrand)         result = result.filter(p => (p.brand ?? "").toLowerCase().includes(filterBrand.toLowerCase()));
    if (filterAgeRestricted) result = result.filter(p => p.age_restricted === 1);
    if (priceMin)            result = result.filter(p => p.price_cents >= parseFloat(priceMin) * 100);
    if (priceMax)            result = result.filter(p => p.price_cents <= parseFloat(priceMax) * 100);
    return [...result].sort((a, b) => {
      let av: string | number, bv: string | number;
      switch (sortCol) {
        case "price_cents": av = a.price_cents; bv = b.price_cents; break;
        case "sku":         av = a.sku.toLowerCase(); bv = b.sku.toLowerCase(); break;
        case "category":    av = a.category.toLowerCase(); bv = b.category.toLowerCase(); break;
        case "status":      av = a.status; bv = b.status; break;
        default:            av = a.name.toLowerCase(); bv = b.name.toLowerCase();
      }
      if (av < bv) return sortDir === "asc" ? -1 : 1;
      if (av > bv) return sortDir === "asc" ?  1 : -1;
      return 0;
    });
  }, [products, filterTaxClass, filterBrand, filterAgeRestricted, priceMin, priceMax, sortCol, sortDir]);

  const selectedProducts = visibleProducts.filter(p => selectedIds.has(p.id));
  const allSelected      = visibleProducts.length > 0 && visibleProducts.every(p => selectedIds.has(p.id));
  const someSelected     = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const toggleSelectAll = () => {
    setSelectedIds(allSelected ? new Set<string>() : new Set<string>(visibleProducts.map(p => p.id)));
  };
  function handleSort(col: string) {
    if (col === sortCol) { setSortDir(d => d === "asc" ? "desc" : "asc"); }
    else { setSortCol(col); setSortDir("asc"); }
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "50", offset: "0" });
      if (filterStatus)   params.set("status",   filterStatus);
      if (filterCategory) params.set("category", filterCategory);
      if (debouncedQ)     params.set("q",        debouncedQ);
      const data = await apiGet<ProductsResponse>(`/api/v1/catalog?${params}`);
      setProducts(data.items ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to load products.");
    } finally { setLoading(false); }
  }, [filterStatus, filterCategory, debouncedQ]);

  useEffect(() => { void load(); }, [load]);

  const handleCreate = async (body: Record<string, unknown>) => { await apiPost("/api/v1/catalog", body); await load(); };
  const handleEdit   = async (body: Record<string, unknown>) => { if (!editTarget) return; await apiPatch(`/api/v1/catalog/${editTarget.id}`, body); await load(); };

  const handleArchive = async () => {
    if (!archiveTarget) return;
    setArchiving(true); setActionError(null);
    try { await apiDelete(`/api/v1/catalog/${archiveTarget.id}`); setArchiveTarget(null); await load(); }
    catch (err) { setActionError(err instanceof ApiResponseError ? err.message : "Archive failed."); }
    finally { setArchiving(false); }
  };

  const handleBulkUpdate = async (field: string, value: string) => {
    setBulkLoading(true); setBulkError(null);
    try {
      const parsed = field === "age_restricted" ? value === "true" : value;
      await Promise.all([...selectedIds].map(id => apiPatch(`/api/v1/catalog/${id}`, { [field]: parsed })));
      setSelectedIds(new Set()); await load();
    } catch { setBulkError("Some updates failed — check individual products."); }
    finally { setBulkLoading(false); }
  };

  const handleExportCSV = () => {
    const headers = ["SKU", "Name", "Brand", "Category", "Price ($)", "Cost ($)", "MSRP ($)", "Tax Class", "Status", "Barcode", "Age Restricted"];
    const rows = visibleProducts.map(p => [
      p.sku, p.name, p.brand ?? "", p.category,
      (p.price_cents / 100).toFixed(2),
      p.raw_cost_price_cents != null ? (p.raw_cost_price_cents / 100).toFixed(2) : "",
      p.msrp_cents != null ? (p.msrp_cents / 100).toFixed(2) : "",
      p.tax_class, p.status, p.barcode ?? "",
      p.age_restricted === 1 ? "yes" : "no",
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `catalog-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDuplicate = async (id: string) => {
    setDuplicating(id);
    try { await apiPost(`/api/v1/catalog/${id}/duplicate`, {}); await load(); }
    catch { /* silent — row button reverts visually */ }
    finally { setDuplicating(null); }
  };

  return (
    <>
      <Card className="overflow-hidden p-0">
        {/* ── Spec: header row — Import + Add product ─────────────────────────── */}
        <div className="flex items-center justify-between border-b border-[#E8E8E8] px-5 py-3">
          <span className="text-sm font-semibold text-[#111]">Products</span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setShowImport(true)}
              className="flex items-center gap-1.5 rounded border border-[#D9D9D9] bg-white px-3 py-1.5 text-sm text-[#555] hover:bg-gray-50 transition-colors">
              ↑ Import
            </button>
            <button type="button" onClick={() => { setShowCreate(true); setActionError(null); }}
              className="rounded bg-[#5D5FEF] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
              + Add product
            </button>
          </div>
        </div>

        {/* ── Spec: standard filter bar ────────────────────────────────────── */}
        <div className="border-b border-[#E8E8E8] bg-white px-5 py-3">
          <div className="flex flex-wrap items-end gap-3">
            {/* Name / SKU */}
            <div className="flex flex-col gap-1">
              <label htmlFor="catalog-search" className="text-xs font-medium text-[#555]">Name or SKU</label>
              <input id="catalog-search" type="search" value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search…"
                className="h-8 w-44 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none focus:ring-1 focus:ring-[#5D5FEF]" />
            </div>
            {/* Category */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Category</label>
              <select value={filterCategory} onChange={e => setFilterCategory(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none">
                <option value="">All categories</option>
                {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
              </select>
            </div>
            {/* Brand */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Brand</label>
              <input type="text" value={filterBrand} onChange={e => setFilterBrand(e.target.value)} placeholder="Brand…"
                className="h-8 w-28 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none" />
            </div>
            {/* Channel (ecommerce status) */}
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-[#555]">Channel</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            {/* More filters */}
            {showMoreFilters && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#555]">Tax class</label>
                  <select value={filterTaxClass} onChange={e => setFilterTaxClass(e.target.value)}
                    className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none">
                    <option value="">All</option>
                    <option value="standard">Standard</option>
                    <option value="exempt">Exempt</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-[#555]">Age restricted</label>
                  <select value={filterAgeRestricted ? "1" : "0"} onChange={e => setFilterAgeRestricted(e.target.value === "1")}
                    className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] focus:border-[#5D5FEF] focus:outline-none">
                    <option value="0">All</option>
                    <option value="1">18+ only</option>
                  </select>
                </div>
              </>
            )}
            {/* Actions */}
            <div className="flex items-center gap-2 ml-auto">
              <button type="button" onClick={clearFilters} className="text-sm text-[#5D5FEF] hover:underline">Clear filters</button>
              <button type="button" onClick={() => setShowMoreFilters(v => !v)} className="text-sm text-[#5D5FEF] hover:underline">
                {showMoreFilters ? "Fewer filters" : "More filters"}
              </button>
              <button type="button" onClick={() => void load()}
                className="h-8 rounded bg-[#5D5FEF] px-4 text-sm font-medium text-white hover:bg-[#4849d0] transition-colors">
                Search
              </button>
            </div>
          </div>
          {/* Results count */}
          <div className="mt-2 flex items-center justify-between text-xs text-[#666]">
            <span>Showing <strong>{visibleProducts.length}</strong> of {total} products
              {someSelected && <span className="ml-2 text-[#5D5FEF]">· {selectedIds.size} selected</span>}
            </span>
            <div className="flex items-center gap-3">
              {someSelected && (
                <button type="button" onClick={() => setShowPrintLabels(true)}
                  className="text-[#5D5FEF] hover:underline">Labels ({selectedIds.size})</button>
              )}
              <button type="button" onClick={handleExportCSV} className="text-[#5D5FEF] hover:underline">Export CSV</button>
            </div>
          </div>
        </div>


        {someSelected && (
          <BulkActionBar count={selectedIds.size} categories={categories} onApply={handleBulkUpdate}
            onClear={() => setSelectedIds(new Set())} loading={bulkLoading} error={bulkError} />
        )}

        {actionError && (
          <div className="border-b border-red-100 bg-red-50 px-4 py-2">
            <p role="alert" className="text-sm text-red-700">{actionError}</p>
          </div>
        )}


        {loading ? (
          <TableSkeleton headers={["", "Product", "SKU", "Category", "Price", "Status", ""]} rows={8} />
        ) : error ? (
          <div className="px-4 py-6"><p role="alert" className="text-sm text-red-700">{error}</p></div>
        ) : visibleProducts.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="text-sm font-medium text-[var(--color-text-primary)]">No products found.</p>
            {hasFilters && <button type="button" onClick={clearFilters} className="mt-2 text-xs text-brand-600 hover:underline">Clear filters</button>}
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              {/* ── Spec: checkbox | thumbnail+Name | Brand | Supplier | Available | Retail price | Channels | Created | ✎ */}
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA] text-left text-xs font-semibold uppercase tracking-wider text-[#888]">
                    <th className="px-4 py-3">
                      <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} aria-label="Select all products" className="h-4 w-4 rounded border-slate-300" />
                    </th>
                    <SortTh col="name"        label="Name"          cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <SortTh col="brand"       label="Brand"         cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3">Supplier</th>
                    <th className="px-4 py-3">Available</th>
                    <SortTh col="price_cents" label="Retail price"  cur={sortCol} dir={sortDir} onSort={handleSort} right />
                    <th className="px-4 py-3">Channels</th>
                    <SortTh col="created_at"  label="Created"       cur={sortCol} dir={sortDir} onSort={handleSort} />
                    <th className="w-10 px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#F5F5F5]">
                  {visibleProducts.map(p => {
                    const isSelected = selectedIds.has(p.id);
                    const isAvailable = p.status === "active";
                    const createdDate = p.created_at
                      ? new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" })
                      : "—";
                    return (
                      <tr key={p.id}
                        className={clsx("hover:bg-[#FAFAFA] transition-colors", isSelected && "bg-blue-50")}
                        onClick={() => { setEditTarget(p); setActionError(null); }}
                        style={{ cursor: "pointer" }}
                      >
                        {/* Checkbox */}
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(p.id)}
                            aria-label={`Select ${p.name}`} className="h-4 w-4 rounded border-slate-300" />
                        </td>

                        {/* thumbnail + Name + SKU */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            {p.image_url ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={p.image_url} alt="" className="h-9 w-9 shrink-0 rounded-md object-cover" aria-hidden="true" />
                            ) : (
                              <span className={clsx("flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
                                p.status === "active" ? "bg-[#5D5FEF]" : p.status === "draft" ? "bg-amber-400" : "bg-slate-300")}
                                aria-hidden="true">
                                {p.name.charAt(0).toUpperCase()}
                              </span>
                            )}
                            <div className="min-w-0">
                              <p className={clsx("font-medium text-[#111] leading-snug", p.status === "archived" && "text-[#888] line-through")}>{p.name}</p>
                              <p className="text-[11px] text-[#888] font-mono">{p.sku}</p>
                            </div>
                          </div>
                        </td>

                        {/* Brand */}
                        <td className="px-4 py-3 text-[#555]">{p.brand ?? <span className="text-[#ccc]">—</span>}</td>

                        {/* Supplier */}
                        <td className="px-4 py-3 text-[#555]">
                          {p.preferred_vendor_name ?? <span className="text-[#ccc]">—</span>}
                        </td>

                        {/* Available indicator */}
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5">
                            <span className={clsx("h-2 w-2 rounded-full shrink-0",
                              isAvailable ? "bg-emerald-500" : p.status === "draft" ? "bg-amber-400" : "bg-slate-300"
                            )} aria-hidden="true" />
                            <span className={clsx("text-xs font-medium capitalize",
                              isAvailable ? "text-emerald-700" : p.status === "draft" ? "text-amber-700" : "text-[#888]"
                            )}>
                              {p.status}
                            </span>
                            {p.age_restricted === 1 && (
                              <span className="rounded bg-orange-100 px-1 py-0.5 text-[10px] font-semibold text-orange-700">18+</span>
                            )}
                          </div>
                        </td>

                        {/* Retail price */}
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">
                          {formatMoney(p.price_cents)}
                        </td>

                        {/* Channels */}
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            <span className="rounded-full bg-[#F0F0F0] px-2 py-0.5 text-[11px] font-medium text-[#555]">In-store</span>
                            {p.ecommerce === 1 && (
                              <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700">Online</span>
                            )}
                          </div>
                        </td>

                        {/* Created */}
                        <td className="px-4 py-3 text-xs text-[#888] tabular-nums">{createdDate}</td>

                        {/* Edit icon */}
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <button type="button"
                            onClick={() => { setEditTarget(p); setActionError(null); }}
                            aria-label={`Edit ${p.name}`}
                            className="text-[#aaa] hover:text-[#5D5FEF] transition-colors">
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {visibleProducts.map(p => (
                <ProductListCard key={p.id} product={p}
                  onEdit={() => { setEditTarget(p); setActionError(null); }}
                  onArchive={() => { setArchiveTarget(p); setActionError(null); }} />
              ))}
            </div>
          </>
        )}
      </Card>

      {showImport    && <ImportCSVModal onDone={async () => { await load(); }} onClose={() => setShowImport(false)} />}
      {showPrintLabels && <PrintLabelsModal selected={selectedProducts} onClose={() => setShowPrintLabels(false)} />}
      {showCreate    && <ProductFormModal categories={categories} onSave={handleCreate} onClose={() => setShowCreate(false)} />}
      {editTarget    && <ProductFormModal initial={editTarget} categories={categories} onSave={handleEdit} onClose={() => setEditTarget(null)} />}

      {archiveTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setArchiveTarget(null)}>
          <div className="w-full max-w-sm rounded-md bg-white p-6 shadow-xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-semibold text-slate-950">Archive &ldquo;{archiveTarget.name}&rdquo;?</h2>
            <p className="mt-2 text-sm text-slate-600">The product will be set to archived and hidden from active views. You can restore it by editing the status.</p>
            {actionError && <p className="mt-3 text-sm text-red-700">{actionError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setArchiveTarget(null)} className="min-h-[40px] rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Cancel</button>
              <button type="button" onClick={handleArchive} disabled={archiving}
                className="min-h-[40px] rounded-md bg-slate-700 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60">
                {archiving ? "Archiving..." : "Archive"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
