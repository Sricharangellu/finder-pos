"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useQuery } from "@/lib/useQuery";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type {
  CatalogProduct,
  CatalogProductsResponse,
  CatalogCategoriesResponse,
} from "@/api-client/types";
import { StatusBadge, DropdownItem, buildCategoryName } from "./ui";
import type { CatalogStatusFilter, LocalProductStatus } from "./shared";

export function CatalogTab() {
  const router = useRouter();
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatusFilter>("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);

  const { data: productsData, loading: catalogProductsLoading, error: catalogProductsError } =
    useQuery("inventory:catalog-products", () => apiGet<CatalogProductsResponse>("/api/v1/catalog?limit=200&excludeMasters=true"), {
      staleMs: 60_000,
    });
  const { data: categoriesData, loading: catalogCategoriesLoading } =
    useQuery("inventory:catalog-categories", () => apiGet<CatalogCategoriesResponse>("/api/v1/catalog/categories"), {
      staleMs: 60_000,
    });

  const [productsOverride, setProductsOverride] = useState<CatalogProduct[] | null>(null);
  const [catalogMutationError, setCatalogMutationError] = useState<string | null>(null);
  const products = useMemo(
    () => productsOverride ?? productsData?.items ?? [],
    [productsData, productsOverride],
  );
  useEffect(() => { if (productsData) setProductsOverride(null); }, [productsData]);
  const categories = useMemo(() => categoriesData?.items ?? [], [categoriesData]);
  const catalogLoading = catalogProductsLoading || catalogCategoriesLoading;
  const catalogError = catalogProductsError ?? catalogMutationError;

  useEffect(() => {
    if (!actionsOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (actionsRef.current && !actionsRef.current.contains(e.target as Node)) {
        setActionsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsOpen]);

  const catalogCategoryOptions = useMemo(() => {
    return ["All", ...categories.map((c) => buildCategoryName(c, categories)).sort()];
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesQuery = q.length === 0 || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q);
      let matchesCategory = true;
      if (catalogCategory !== "All") {
        const cat = categories.find((c) => buildCategoryName(c, categories) === catalogCategory);
        matchesCategory = cat ? p.category === cat.name : true;
      }
      const matchesStatus = catalogStatus === "All" || p.status === catalogStatus;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [products, categories, catalogQuery, catalogCategory, catalogStatus]);

  function toggleSelectAll() {
    if (selectedIds.size === filteredProducts.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  }

  function toggleSelectOne(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleBulkStatus(status: LocalProductStatus) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkLoading(true);
    setActionsOpen(false);
    try {
      await apiPost("/api/v1/catalog/bulk-update", { ids, update: { status } });
      setProductsOverride((prev) =>
        (prev ?? products).map((p) => (selectedIds.has(p.id) ? { ...p, status } : p)),
      );
      setSelectedIds(new Set());
    } catch (err) {
      setCatalogMutationError(err instanceof ApiResponseError ? err.message : "Bulk update failed.");
    } finally {
      setBulkLoading(false);
    }
  }

  function handleExportCSV() {
    setActionsOpen(false);
    const token =
      typeof window !== "undefined" ? (localStorage.getItem("accessToken") ?? "") : "";
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    const url = `${base}/api/v1/catalog/export`;
    const a = document.createElement("a");
    a.href = `${url}?token=${encodeURIComponent(token)}`;
    a.download = "catalog-export.csv";
    a.click();
  }

  const allChecked = filteredProducts.length > 0 && selectedIds.size === filteredProducts.length;
  const someChecked = selectedIds.size > 0 && !allChecked;

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Product catalog</h2>
          {selectedIds.size > 0 && (
            <p className="text-sm text-slate-900">
              {selectedIds.size} product{selectedIds.size !== 1 ? "s" : ""} selected
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <div className="relative" ref={actionsRef}>
            <Button
              variant="secondary" size="sm"
              disabled={selectedIds.size === 0 || bulkLoading}
              loading={bulkLoading}
              onClick={() => setActionsOpen((v) => !v)}
            >
              Actions
              <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M6 9l6 6 6-6" />
              </svg>
            </Button>
            {actionsOpen && (
              <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white shadow-lg">
                <div className="py-1">
                  <DropdownItem onClick={() => void handleBulkStatus("active")}>Set Active</DropdownItem>
                  <DropdownItem onClick={() => void handleBulkStatus("draft")}>Set Draft</DropdownItem>
                  <DropdownItem onClick={() => void handleBulkStatus("archived")}>Set Archived</DropdownItem>
                  <div className="my-1 border-t border-slate-100" />
                  <DropdownItem onClick={handleExportCSV}>Export CSV</DropdownItem>
                </div>
              </div>
            )}
          </div>
          <Button variant="primary" size="sm" onClick={() => router.push("/catalog?new=product")}>
            New product
          </Button>
        </div>
      </div>

      <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_14rem_10rem]">
        <label className="block">
          <span className="sr-only">Search catalog</span>
          <input
            type="search"
            value={catalogQuery}
            onChange={(e) => setCatalogQuery(e.target.value)}
            placeholder="Search SKU or product name"
            className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
          />
        </label>
        <label className="block">
          <span className="sr-only">Filter by category</span>
          <select
            value={catalogCategory}
            onChange={(e) => setCatalogCategory(e.target.value)}
            className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
          >
            {catalogCategoryOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="sr-only">Filter by status</span>
          <select
            value={catalogStatus}
            onChange={(e) => setCatalogStatus(e.target.value as CatalogStatusFilter)}
            className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
          >
            <option value="All">All statuses</option>
            <option value="active">Active</option>
            <option value="draft">Draft</option>
            <option value="archived">Archived</option>
          </select>
        </label>
      </div>

      {catalogLoading ? (
        <div className="p-6 text-sm text-slate-500" aria-busy="true">Loading...</div>
      ) : catalogError ? (
        <div className="p-6 text-sm text-danger-700" role="alert">{catalogError}</div>
      ) : filteredProducts.length === 0 ? (
        <div className="p-6 text-sm text-slate-500">No products match the current filters.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-200 text-sm">
            <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    ref={(el) => { if (el) el.indeterminate = someChecked; }}
                    onChange={toggleSelectAll}
                    aria-label="Select all products"
                    className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950"
                  />
                </th>
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Price</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredProducts.map((product) => (
                <tr
                  key={product.id}
                  className={selectedIds.has(product.id) ? "bg-slate-100" : "hover:bg-slate-50"}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(product.id)}
                      onChange={() => toggleSelectOne(product.id)}
                      aria-label={`Select ${product.name}`}
                      className="h-4 w-4 rounded border-slate-300 text-slate-950 focus:ring-slate-950"
                    />
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <Link
                      href={`/catalog/${product.id}`}
                      className="font-mono text-xs font-semibold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-950"
                    >
                      {product.sku}
                    </Link>
                  </td>
                  <td className="px-4 py-3 font-medium text-slate-950">
                    {product.name}
                    {product.parent_product_id && (
                      <span className="ml-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">variant</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{product.brand ?? "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-600">{product.category || "-"}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">{formatMoney(product.price_cents)}</td>
                  <td className="whitespace-nowrap px-4 py-3"><StatusBadge status={product.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
