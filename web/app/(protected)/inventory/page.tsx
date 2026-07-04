"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type {
  InventoryLevel,
  InventoryLevelsResponse,
  CatalogProduct,
  CatalogProductsResponse,
  CatalogCategoriesResponse,
  CatalogCategory,
} from "@/api-client/types";

// ─── Stock ledger types ───────────────────────────────────────────────────────

type StockStatus = "Healthy" | "Watch" | "Reorder";
type StockStatusFilter = "All" | StockStatus;

interface InventoryRow {
  id: string;
  sku: string;
  name: string;
  category: string;
  productStatus: string;
  priceCents: number;
  onHand: number;
  committed: number;
  available: number;
  reorderPoint: number;
  costCents: number | null;
  stockStatus: StockStatus;
  velocity: number;
}

function stockStatusFor(item: InventoryLevel): StockStatus {
  if (item.lowStock || item.available <= item.reorderPoint) return "Reorder";
  if (item.reorderPoint > 0 && item.available <= item.reorderPoint * 1.5) return "Watch";
  return "Healthy";
}

function toInventoryRow(item: InventoryLevel): InventoryRow {
  return {
    id: item.id,
    sku: item.sku,
    name: item.name,
    category: item.category,
    productStatus: item.status,
    priceCents: item.priceCents,
    onHand: item.onHand,
    committed: item.committed,
    available: item.available,
    reorderPoint: item.reorderPoint,
    costCents: item.costCents,
    stockStatus: stockStatusFor(item),
    velocity: item.velocity,
  };
}

function formatCost(cents: number | null) {
  return cents === null ? "-" : formatMoney(cents);
}

function formatMargin(priceCents: number, costCents: number | null) {
  if (costCents === null || priceCents <= 0) return "-";
  const margin = ((priceCents - costCents) / priceCents) * 100;
  return `${margin.toFixed(1)}%`;
}

function formatVelocity(value: number) {
  return value > 0 ? `${value}/wk` : "Learning";
}

// ─── Catalog view ─────────────────────────────────────────────────────────────

type ProductStatus = "active" | "draft" | "archived";
type CatalogStatusFilter = "All" | ProductStatus;

function StatusBadge({ status }: { status: string }) {
  const classes =
    status === "active"
      ? "bg-success-100 text-success-700"
      : status === "archived"
      ? "bg-danger-100 text-danger-700"
      : "bg-gray-100 text-gray-600";
  return (
    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold capitalize ${classes}`}>
      {status}
    </span>
  );
}

function buildCategoryName(
  cat: CatalogCategory,
  allCats: CatalogCategory[]
): string {
  if (!cat.parent_id) return cat.name;
  const parent = allCats.find((c) => c.id === cat.parent_id);
  if (!parent) return cat.name;
  return `${parent.name} / ${cat.name}`;
}

// ─── Main page ────────────────────────────────────────────────────────────────

type ActiveTab = "ledger" | "catalog";

export default function InventoryPage() {
  const [activeTab, setActiveTab] = useState<ActiveTab>("ledger");

  // Stock ledger state
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(true);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerCategory, setLedgerCategory] = useState("All");
  const [ledgerStatus, setLedgerStatus] = useState<StockStatusFilter>("All");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  // Catalog state
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatusFilter>("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Load stock ledger
  useEffect(() => {
    const controller = new AbortController();
    setLedgerLoading(true);
    apiGet<InventoryLevelsResponse>("/api/v1/inventory/levels?pageSize=200", {
      signal: controller.signal,
    })
      .then((data) => {
        const nextRows = data.items.map(toInventoryRow);
        setRows(nextRows);
        setSelectedSku((current) =>
          current && nextRows.some((row) => row.sku === current)
            ? current
            : nextRows[0]?.sku ?? null
        );
        setLedgerError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setLedgerError(
          err instanceof ApiResponseError ? err.message : "Could not load inventory."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLedgerLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, []);

  // Load catalog data when catalog tab is first shown
  useEffect(() => {
    if (activeTab !== "catalog") return;
    if (products.length > 0 || catalogLoading) return;

    const controller = new AbortController();
    setCatalogLoading(true);

    Promise.all([
      apiGet<CatalogProductsResponse>("/api/v1/catalog?limit=200&excludeMasters=true", {
        signal: controller.signal,
      }),
      apiGet<CatalogCategoriesResponse>("/api/v1/catalog/categories", {
        signal: controller.signal,
      }),
    ])
      .then(([productsData, categoriesData]) => {
        setProducts(productsData.items);
        setCategories(categoriesData.items);
        setCatalogError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setCatalogError(
          err instanceof ApiResponseError ? err.message : "Could not load catalog."
        );
      })
      .finally(() => {
        if (!controller.signal.aborted) setCatalogLoading(false);
      });

    return () => {
      controller.abort();
    };
  }, [activeTab, products.length, catalogLoading]);

  // Close actions dropdown when clicking outside
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

  // Stock ledger computed values
  const ledgerCategories = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((row) => row.category))).sort()],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = ledgerQuery.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.sku.toLowerCase().includes(normalizedQuery);
      const matchesCategory =
        ledgerCategory === "All" || row.category === ledgerCategory;
      const matchesStatus =
        ledgerStatus === "All" || row.stockStatus === ledgerStatus;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [rows, ledgerQuery, ledgerCategory, ledgerStatus]);

  const selectedRow = useMemo(
    () =>
      rows.find((row) => row.sku === selectedSku) ?? filteredRows[0] ?? null,
    [rows, selectedSku, filteredRows]
  );

  const metrics = useMemo(() => {
    const active = rows.filter((row) => row.productStatus === "active").length;
    const low = rows.filter((row) => row.stockStatus === "Reorder").length;
    const watch = rows.filter((row) => row.stockStatus === "Watch").length;
    const value = rows.reduce(
      (sum, row) => sum + row.onHand * (row.costCents ?? 0),
      0
    );
    return { active, low, watch, value };
  }, [rows]);

  // Catalog computed values
  const catalogCategoryOptions = useMemo(() => {
    return [
      "All",
      ...categories.map((c) => buildCategoryName(c, categories)).sort(),
    ];
  }, [categories]);

  const filteredProducts = useMemo(() => {
    const q = catalogQuery.trim().toLowerCase();
    return products.filter((p) => {
      const matchesQuery =
        q.length === 0 ||
        p.name.toLowerCase().includes(q) ||
        p.sku.toLowerCase().includes(q);

      let matchesCategory = true;
      if (catalogCategory !== "All") {
        const cat = categories.find(
          (c) => buildCategoryName(c, categories) === catalogCategory
        );
        matchesCategory = cat ? p.category === cat.name : true;
      }

      const matchesStatus =
        catalogStatus === "All" || p.status === catalogStatus;

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

  async function handleBulkStatus(status: ProductStatus) {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBulkLoading(true);
    setActionsOpen(false);
    try {
      await apiPost("/api/v1/catalog/bulk-update", { ids, update: { status } });
      setProducts((prev) =>
        prev.map((p) => (selectedIds.has(p.id) ? { ...p, status } : p))
      );
      setSelectedIds(new Set());
    } catch (err) {
      setCatalogError(
        err instanceof ApiResponseError ? err.message : "Bulk update failed."
      );
    } finally {
      setBulkLoading(false);
    }
  }

  function handleExportCSV() {
    setActionsOpen(false);
    const token =
      typeof window !== "undefined"
        ? (localStorage.getItem("accessToken") ?? "")
        : "";
    const base = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
    const url = `${base}/api/v1/catalog/export`;
    const a = document.createElement("a");
    a.href = url;
    a.download = "catalog-export.csv";
    // Append auth as a query param since the browser won't send the header
    a.href = `${url}?token=${encodeURIComponent(token)}`;
    a.click();
  }

  const allChecked =
    filteredProducts.length > 0 &&
    selectedIds.size === filteredProducts.length;
  const someChecked = selectedIds.size > 0 && !allChecked;

  return (
    <EnterpriseShell
      active="inventory"
      title="Inventory"
      subtitle={`Stock control · Demo Store · ${rows.length || "-"} tracked SKUs`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <Metric
            label="Active products"
            value={String(metrics.active)}
            detail="sellable catalog items"
          />
          <Metric
            label="Reorder items"
            value={String(metrics.low)}
            detail={`${metrics.watch} items on watch`}
            tone="warning"
          />
          <Metric
            label="Inventory value"
            value={formatMoney(metrics.value)}
            detail="using tracked cost"
          />
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-gray-200">
          <TabButton
            active={activeTab === "ledger"}
            onClick={() => setActiveTab("ledger")}
          >
            Stock ledger
          </TabButton>
          <TabButton
            active={activeTab === "catalog"}
            onClick={() => setActiveTab("catalog")}
          >
            Catalog
          </TabButton>
        </div>

        {activeTab === "ledger" && (
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
            <Card className="overflow-hidden p-0">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-gray-900">
                    Stock ledger
                  </h2>
                  <p className="text-sm text-gray-500">
                    Operational view for counts, receiving, and reorder decisions.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm">
                    Count
                  </Button>
                  <Button variant="primary" size="sm">
                    Receive stock
                  </Button>
                </div>
              </div>

              <div className="grid gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_10rem]">
                <label className="block">
                  <span className="sr-only">Search inventory</span>
                  <input
                    type="search"
                    value={ledgerQuery}
                    onChange={(e) => setLedgerQuery(e.target.value)}
                    placeholder="Search SKU or product"
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Filter by category</span>
                  <select
                    value={ledgerCategory}
                    onChange={(e) => setLedgerCategory(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                  >
                    {ledgerCategories.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="sr-only">Filter by stock status</span>
                  <select
                    value={ledgerStatus}
                    onChange={(e) =>
                      setLedgerStatus(e.target.value as StockStatusFilter)
                    }
                    className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                  >
                    <option value="All">All statuses</option>
                    <option value="Healthy">Healthy</option>
                    <option value="Watch">Watch</option>
                    <option value="Reorder">Reorder</option>
                  </select>
                </label>
              </div>

              {ledgerLoading ? (
                <div className="p-6 text-sm text-gray-500" aria-busy="true">
                  Loading inventory...
                </div>
              ) : ledgerError ? (
                <div className="p-6 text-sm text-danger-700" role="alert">
                  {ledgerError}
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="p-6 text-sm text-gray-500">
                  No inventory rows match the current filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200 text-sm">
                    <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3">SKU</th>
                        <th className="px-4 py-3">Product</th>
                        <th className="px-4 py-3">Category</th>
                        <th className="px-4 py-3 text-right">Available</th>
                        <th className="px-4 py-3 text-right">On hand</th>
                        <th className="px-4 py-3 text-right">Committed</th>
                        <th className="px-4 py-3 text-right">Avg cost</th>
                        <th className="px-4 py-3 text-right">Margin</th>
                        <th className="px-4 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 bg-white">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.sku}
                          className={
                            selectedRow?.sku === row.sku
                              ? "bg-brand-50"
                              : "hover:bg-gray-50"
                          }
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedSku(row.sku)}
                              className="font-mono text-xs font-semibold text-brand-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-600"
                            >
                              {row.sku}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">
                            {row.name}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                            {row.category}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">
                            {row.available}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">
                            {row.onHand}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">
                            {row.committed}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">
                            {formatCost(row.costCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">
                            {formatMargin(row.priceCents, row.costCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <LedgerStatus label={row.stockStatus} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="h-fit">
              {selectedRow ? (
                <div className="flex flex-col gap-5">
                  <div>
                    <p className="text-xs font-semibold uppercase text-gray-500">
                      Selected SKU
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-gray-900">
                      {selectedRow.name}
                    </h2>
                    <p className="font-mono text-xs text-gray-500">
                      {selectedRow.sku}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Detail label="Available" value={String(selectedRow.available)} />
                    <Detail label="On hand" value={String(selectedRow.onHand)} />
                    <Detail
                      label="Committed"
                      value={String(selectedRow.committed)}
                    />
                    <Detail
                      label="Reorder at"
                      value={String(selectedRow.reorderPoint)}
                    />
                  </div>

                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-gray-500">Sell price</span>
                      <span className="font-semibold text-gray-900">
                        {formatMoney(selectedRow.priceCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500">Average cost</span>
                      <span className="font-semibold text-gray-900">
                        {formatCost(selectedRow.costCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500">Margin</span>
                      <span className="font-semibold text-gray-900">
                        {formatMargin(selectedRow.priceCents, selectedRow.costCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-gray-500">Velocity</span>
                      <span className="font-semibold text-gray-900">
                        {formatVelocity(selectedRow.velocity)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button variant="secondary" size="sm" fullWidth>
                      Adjust
                    </Button>
                    <Button variant="primary" size="sm" fullWidth>
                      Receive
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-500">
                  Select a SKU to inspect stock details.
                </p>
              )}
            </Card>
          </div>
        )}

        {activeTab === "catalog" && (
          <Card className="overflow-hidden p-0">
            {/* Catalog toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">
                  Product catalog
                </h2>
                {selectedIds.size > 0 && (
                  <p className="text-sm text-brand-700">
                    {selectedIds.size} product{selectedIds.size !== 1 ? "s" : ""}{" "}
                    selected
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                {/* Actions dropdown */}
                <div className="relative" ref={actionsRef}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={selectedIds.size === 0 || bulkLoading}
                    loading={bulkLoading}
                    onClick={() => setActionsOpen((v) => !v)}
                  >
                    Actions
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                  </Button>
                  {actionsOpen && (
                    <div className="absolute right-0 z-20 mt-1 w-44 rounded-lg border border-gray-200 bg-white shadow-lg">
                      <div className="py-1">
                        <DropdownItem onClick={() => void handleBulkStatus("active")}>
                          Set Active
                        </DropdownItem>
                        <DropdownItem onClick={() => void handleBulkStatus("draft")}>
                          Set Draft
                        </DropdownItem>
                        <DropdownItem onClick={() => void handleBulkStatus("archived")}>
                          Set Archived
                        </DropdownItem>
                        <div className="my-1 border-t border-gray-100" />
                        <DropdownItem onClick={handleExportCSV}>
                          Export CSV
                        </DropdownItem>
                      </div>
                    </div>
                  )}
                </div>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => router.push("/inventory/products/new")}
                >
                  New product
                </Button>
              </div>
            </div>

            {/* Filters */}
            <div className="grid gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_14rem_10rem]">
              <label className="block">
                <span className="sr-only">Search catalog</span>
                <input
                  type="search"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  placeholder="Search SKU or product name"
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                />
              </label>
              <label className="block">
                <span className="sr-only">Filter by category</span>
                <select
                  value={catalogCategory}
                  onChange={(e) => setCatalogCategory(e.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                >
                  {catalogCategoryOptions.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Filter by status</span>
                <select
                  value={catalogStatus}
                  onChange={(e) =>
                    setCatalogStatus(e.target.value as CatalogStatusFilter)
                  }
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                >
                  <option value="All">All statuses</option>
                  <option value="active">Active</option>
                  <option value="draft">Draft</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
            </div>

            {catalogLoading ? (
              <div className="p-6 text-sm text-gray-500" aria-busy="true">
                Loading...
              </div>
            ) : catalogError ? (
              <div className="p-6 text-sm text-danger-700" role="alert">
                {catalogError}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">
                No products match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={allChecked}
                          ref={(el) => {
                            if (el) el.indeterminate = someChecked;
                          }}
                          onChange={toggleSelectAll}
                          aria-label="Select all products"
                          className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
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
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {filteredProducts.map((product) => (
                      <tr
                        key={product.id}
                        className={
                          selectedIds.has(product.id)
                            ? "bg-brand-50"
                            : "hover:bg-gray-50"
                        }
                      >
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={selectedIds.has(product.id)}
                            onChange={() => toggleSelectOne(product.id)}
                            aria-label={`Select ${product.name}`}
                            className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-600"
                          />
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Link
                            href={`/inventory/products/${product.id}`}
                            className="font-mono text-xs font-semibold text-brand-700 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-brand-600"
                          >
                            {product.sku}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium text-gray-900">
                          {product.name}
                          {product.parent_product_id && (
                            <span className="ml-2 inline-flex rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-500">
                              variant
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {product.brand ?? "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">
                          {product.category || "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">
                          {formatMoney(product.price_cents)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <StatusBadge status={product.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        )}
      </div>
    </EnterpriseShell>
  );
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        "px-4 py-2.5 text-sm font-medium border-b-2 transition-colors",
        active
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

function DropdownItem({
  onClick,
  children,
}: {
  onClick: () => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  children?: any;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-50"
    >
      {children}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <p className="text-xs font-medium uppercase text-gray-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "warning";
}) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase text-gray-500">{label}</span>
      <span
        className={
          tone === "warning"
            ? "text-2xl font-bold text-warning-700"
            : "text-2xl font-bold text-gray-900"
        }
      >
        {value}
      </span>
      <span className="text-xs text-gray-500">{detail}</span>
    </Card>
  );
}

function LedgerStatus({ label }: { label: StockStatus }) {
  const classes =
    label === "Reorder"
      ? "bg-warning-100 text-warning-700"
      : label === "Watch"
      ? "bg-brand-100 text-brand-700"
      : "bg-success-100 text-success-700";
  return (
    <span
      className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${classes}`}
    >
      {label}
    </span>
  );
}
