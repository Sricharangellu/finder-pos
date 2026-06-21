"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@/lib/useQuery";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import type {
  InventoryLevel,
  InventoryLevelsResponse,
  CatalogProduct,
  CatalogProductsResponse,
  CatalogCategoriesResponse,
  CatalogCategory,
} from "@/api-client/types";

// ─── Stock movement types ──────────────────────────────────────────────────────

interface StockMovement {
  id: string;
  type: "sale" | "adjustment" | "receive" | "transfer" | "return";
  delta: number;
  location: string;
  actor: string;
  note: string | null;
  created_at: number;
}

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

// ─── AdjustModal ─────────────────────────────────────────────────────────────

interface AdjustModalProps {
  product: { id: string; name: string; sku: string; onHand: number } | null;
  onClose: () => void;
  onSaved: () => void;
}

function AdjustModal({ product, onClose, onSaved }: AdjustModalProps) {
  const { addToast } = useToast();
  const [reason, setReason] = useState("cycle_count");
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [locationId, setLocationId] = useState("loc_main");
  const [locationOptions, setLocationOptions] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiGet<{ items: { id: string; name: string }[] }>("/api/v1/inventory/locations")
      .then((d) => {
        const items = d.items ?? [];
        setLocationOptions(items);
        if (items.length > 0 && items[0]) setLocationId(items[0].id);
      })
      .catch(() => {});
  }, []);

  if (!product) return null;

  const delta = sign * (parseInt(amount, 10) || 0);
  const newQty = product.onHand + delta;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!amount || parseInt(amount, 10) <= 0) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/inventory/adjustments", {
        product_id: product!.id,
        location_id: locationId,
        delta,
        reason,
        note: note.trim() || null,
      });
      addToast({ title: "Stock adjusted", variant: "success" });
      onSaved();
      onClose();
    } catch (err) {
      addToast({
        title: "Adjustment failed",
        description: err instanceof ApiResponseError ? err.message : "Unknown error",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Adjust stock</h2>
            <p className="text-sm text-slate-500">{product.name} · {product.sku}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-950"
            aria-label="Close"
          >
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="flex flex-col gap-4">
          <label className="block">
            <span className="text-sm font-medium text-slate-700">Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-950"
            >
              <option value="cycle_count">Cycle count</option>
              <option value="damage">Damage</option>
              <option value="theft">Theft</option>
              <option value="received">Received</option>
              <option value="correction">Correction</option>
              <option value="other">Other</option>
            </select>
          </label>

          <div>
            <span className="text-sm font-medium text-slate-700">Adjustment</span>
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setSign(1)}
                className={`min-h-[44px] rounded-md border px-4 text-sm font-semibold transition-colors ${sign === 1 ? "border-success-600 bg-success-50 text-success-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                +
              </button>
              <button
                type="button"
                onClick={() => setSign(-1)}
                className={`min-h-[44px] rounded-md border px-4 text-sm font-semibold transition-colors ${sign === -1 ? "border-danger-600 bg-danger-50 text-danger-700" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"}`}
              >
                −
              </button>
              <input
                type="number"
                min="1"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0"
                className="min-h-[44px] flex-1 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-950"
                required
              />
            </div>
            {amount && parseInt(amount, 10) > 0 && (
              <p className="mt-1 text-xs text-slate-500">
                New quantity:{" "}
                <span className="font-semibold text-slate-950">{newQty}</span>
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Location</span>
            <select
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
              className="mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-950"
            >
              {locationOptions.map((l) => (
                <option key={l.id} value={l.id}>{l.name}</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium text-slate-700">Note (optional)</span>
            <input
              type="text"
              maxLength={255}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Broken in transit"
              className="mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 focus:outline-none focus:ring-2 focus:ring-slate-950"
            />
          </label>

          <div className="flex gap-2 pt-2">
            <Button variant="secondary" size="sm" fullWidth onClick={onClose} type="button">
              Cancel
            </Button>
            <Button variant="primary" size="sm" fullWidth loading={saving} type="submit">
              Save adjustment
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── MovementsDrawer ──────────────────────────────────────────────────────────

const MOVEMENT_TYPE_BADGE: Record<StockMovement["type"], { label: string; color: string }> = {
  sale:       { label: "Sale",       color: "bg-blue-50 text-blue-700 ring-blue-200" },
  adjustment: { label: "Adjustment", color: "bg-warning-50 text-warning-700 ring-warning-200" },
  receive:    { label: "PO Receive", color: "bg-success-50 text-success-700 ring-success-200" },
  transfer:   { label: "Transfer",   color: "bg-purple-50 text-purple-700 ring-purple-200" },
  return:     { label: "Return",     color: "bg-slate-100 text-slate-600 ring-slate-200" },
};

function MovementsDrawer({
  product,
  onClose,
}: {
  product: { id: string; name: string; sku: string } | null;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    if (!product) return;
    setLoading(true);
    setError(null);
    apiGet<{ items: StockMovement[] }>(`/api/v1/inventory/movements?product_id=${encodeURIComponent(product.id)}&limit=20`)
      .then((d) => setMovements(d.items ?? []))
      .catch((err) => setError(err instanceof ApiResponseError ? err.message : "Failed to load movements"))
      .finally(() => setLoading(false));
  }, [product]);

  useEffect(() => { load(); }, [load]);

  if (!product) return null;

  function fmt(ts: number) {
    return new Date(ts).toLocaleString("en-US", {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <div className="fixed inset-y-0 right-0 z-50 flex w-full max-w-lg flex-col bg-white shadow-2xl">
        <div className="flex flex-none items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Stock movements</h2>
            <p className="text-sm text-slate-500">{product.name} · {product.sku}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-400 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-950"
            aria-label="Close drawer"
          >
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 text-sm text-slate-500" aria-busy="true">Loading movements…</div>
          ) : error ? (
            <div className="p-6 text-sm text-danger-700" role="alert">{error}</div>
          ) : movements.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No movements recorded yet.</div>
          ) : (
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Date</th>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3 text-right">Delta</th>
                  <th className="px-4 py-3">Location</th>
                  <th className="px-4 py-3">Actor</th>
                  <th className="px-4 py-3">Note</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {movements.map((m) => {
                  const badge = MOVEMENT_TYPE_BADGE[m.type as StockMovement["type"]];
                  return (
                    <tr key={m.id} className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-4 py-3 text-slate-500">{fmt(m.created_at)}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${badge.color}`}>
                          {badge.label}
                        </span>
                      </td>
                      <td className={`whitespace-nowrap px-4 py-3 text-right font-semibold tabular-nums ${m.delta < 0 ? "text-danger-600" : "text-success-600"}`}>
                        {m.delta > 0 ? `+${m.delta}` : String(m.delta)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.location}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">{m.actor}</td>
                      <td className="px-4 py-3 text-slate-500">{m.note ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
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
      : "bg-slate-100 text-slate-600";
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
  const [ledgerQuery, setLedgerQuery] = useState("");
  const [ledgerCategory, setLedgerCategory] = useState("All");
  const [ledgerStatus, setLedgerStatus] = useState<StockStatusFilter>("All");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const [adjustProduct, setAdjustProduct] = useState<{ id: string; name: string; sku: string; onHand: number } | null>(null);
  const [movementsProduct, setMovementsProduct] = useState<{ id: string; name: string; sku: string } | null>(null);

  // Catalog state
  const [catalogQuery, setCatalogQuery] = useState("");
  const [catalogCategory, setCatalogCategory] = useState("All");
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatusFilter>("All");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [actionsOpen, setActionsOpen] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Load stock ledger via useQuery (SWR caching)
  const { data: ledgerData, loading: ledgerLoading, error: ledgerError, invalidate: invalidateLedger } =
    useQuery("inventory:levels", () => apiGet<InventoryLevelsResponse>("/api/v1/inventory/levels?pageSize=200"), { staleMs: 30_000 });
  const rows = useMemo(() => {
    const nextRows = (ledgerData?.items ?? []).map(toInventoryRow);
    if (nextRows.length > 0 && selectedSku === null) {
      setSelectedSku(nextRows[0]?.sku ?? null);
    }
    return nextRows;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ledgerData]);

  // Load catalog data when catalog tab is first shown (lazy, cached)
  const { data: productsData, loading: catalogProductsLoading, error: catalogProductsError } =
    useQuery("inventory:catalog-products", () => apiGet<CatalogProductsResponse>("/api/v1/catalog?limit=200&excludeMasters=true"), {
      staleMs: 60_000,
      enabled: activeTab === "catalog",
    });
  const { data: categoriesData, loading: catalogCategoriesLoading } =
    useQuery("inventory:catalog-categories", () => apiGet<CatalogCategoriesResponse>("/api/v1/catalog/categories"), {
      staleMs: 60_000,
      enabled: activeTab === "catalog",
    });
  // Local override state for optimistic updates after mutations.
  const [productsOverride, setProductsOverride] = useState<CatalogProduct[] | null>(null);
  const [catalogMutationError, setCatalogMutationError] = useState<string | null>(null);
  const products = useMemo(
    () => productsOverride ?? productsData?.items ?? [],
    [productsData, productsOverride],
  );
  // Sync override when fresh data arrives (clear stale override).
  useEffect(() => { if (productsData) setProductsOverride(null); }, [productsData]);
  const categories = useMemo(() => categoriesData?.items ?? [], [categoriesData]);
  const catalogLoading = catalogProductsLoading || catalogCategoriesLoading;
  const catalogError = catalogProductsError ?? catalogMutationError;

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
      setProductsOverride((prev) =>
        (prev ?? products).map((p) => (selectedIds.has(p.id) ? { ...p, status } : p))
      );
      setSelectedIds(new Set());
    } catch (err) {
      setCatalogMutationError(
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
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric
            label="Active products"
            value={String(metrics.active)}
            detail="sellable catalog items"
          />
          <Metric
            label="Low stock"
            value={String(metrics.low)}
            detail={`${metrics.watch} watch items`}
            tone="warning"
          />
          <Metric
            label="Inventory value"
            value={formatMoney(metrics.value)}
            detail="using tracked cost"
          />
        </div>

        {/* Tab switcher */}
        <div className="flex gap-1 border-b border-slate-200">
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
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-950">
                    Stock ledger
                  </h2>
                  <p className="text-sm text-slate-500">
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

              <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_10rem]">
                <label className="block">
                  <span className="sr-only">Search inventory</span>
                  <input
                    type="search"
                    value={ledgerQuery}
                    onChange={(e) => setLedgerQuery(e.target.value)}
                    placeholder="Search SKU or product"
                    className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
                  />
                </label>
                <label className="block">
                  <span className="sr-only">Filter by category</span>
                  <select
                    value={ledgerCategory}
                    onChange={(e) => setLedgerCategory(e.target.value)}
                    className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
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
                    className="min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950"
                  >
                    <option value="All">All statuses</option>
                    <option value="Healthy">Healthy</option>
                    <option value="Watch">Watch</option>
                    <option value="Reorder">Reorder</option>
                  </select>
                </label>
              </div>

              {ledgerLoading ? (
                <div className="p-6 text-sm text-slate-500" aria-busy="true">
                  Loading inventory...
                </div>
              ) : ledgerError ? (
                <div className="p-6 text-sm text-danger-700" role="alert">
                  {ledgerError}
                </div>
              ) : filteredRows.length === 0 ? (
                <div className="p-6 text-sm text-slate-500">
                  No inventory rows match the current filters.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
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
                        <th className="px-4 py-3">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {filteredRows.map((row) => (
                        <tr
                          key={row.sku}
                          className={
                            selectedRow?.sku === row.sku
                              ? "bg-slate-100"
                              : "hover:bg-slate-50"
                          }
                        >
                          <td className="whitespace-nowrap px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setSelectedSku(row.sku)}
                              className="font-mono text-xs font-semibold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-950"
                            >
                              {row.sku}
                            </button>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 font-medium text-slate-950">
                            {row.name}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                            {row.category}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">
                            {row.available}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                            {row.onHand}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                            {row.committed}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                            {formatCost(row.costCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-right text-slate-600">
                            {formatMargin(row.priceCents, row.costCents)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <LedgerStatus label={row.stockStatus} />
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <div className="flex gap-1">
                              <button
                                type="button"
                                onClick={() => setAdjustProduct({ id: row.id, name: row.name, sku: row.sku, onHand: row.onHand })}
                                className="inline-flex min-h-[32px] items-center rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-950"
                              >
                                Adjust
                              </button>
                              <button
                                type="button"
                                onClick={() => setMovementsProduct({ id: row.id, name: row.name, sku: row.sku })}
                                className="inline-flex min-h-[32px] items-center gap-1 rounded border border-slate-200 bg-white px-2 text-xs font-medium text-slate-600 hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-950"
                                aria-label={`View movement history for ${row.name}`}
                              >
                                <ClockIcon />
                                History
                              </button>
                            </div>
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
                    <p className="text-xs font-semibold uppercase text-slate-500">
                      Selected SKU
                    </p>
                    <h2 className="mt-1 text-xl font-bold text-slate-950">
                      {selectedRow.name}
                    </h2>
                    <p className="font-mono text-xs text-slate-500">
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

                  <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-slate-500">Sell price</span>
                      <span className="font-semibold text-slate-950">
                        {formatMoney(selectedRow.priceCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Average cost</span>
                      <span className="font-semibold text-slate-950">
                        {formatCost(selectedRow.costCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Margin</span>
                      <span className="font-semibold text-slate-950">
                        {formatMargin(selectedRow.priceCents, selectedRow.costCents)}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-500">Velocity</span>
                      <span className="font-semibold text-slate-950">
                        {formatVelocity(selectedRow.velocity)}
                      </span>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => setAdjustProduct({ id: selectedRow.id, name: selectedRow.name, sku: selectedRow.sku, onHand: selectedRow.onHand })}
                    >
                      Adjust
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      onClick={() => setMovementsProduct({ id: selectedRow.id, name: selectedRow.name, sku: selectedRow.sku })}
                    >
                      History
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-slate-500">
                  Select a SKU to inspect stock details.
                </p>
              )}
            </Card>
          </div>
        )}

        {activeTab === "catalog" && (
          <Card className="overflow-hidden p-0">
            {/* Catalog toolbar */}
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Product catalog
                </h2>
                {selectedIds.size > 0 && (
                  <p className="text-sm text-slate-900">
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
                    <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-slate-200 bg-white shadow-lg">
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
                        <div className="my-1 border-t border-slate-100" />
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
              <div className="p-6 text-sm text-slate-500" aria-busy="true">
                Loading...
              </div>
            ) : catalogError ? (
              <div className="p-6 text-sm text-danger-700" role="alert">
                {catalogError}
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-6 text-sm text-slate-500">
                No products match the current filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
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
                        className={
                          selectedIds.has(product.id)
                            ? "bg-slate-100"
                            : "hover:bg-slate-50"
                        }
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
                            href={`/inventory/products/${product.id}`}
                            className="font-mono text-xs font-semibold text-slate-900 underline-offset-2 hover:underline focus:outline-none focus:ring-2 focus:ring-slate-950"
                          >
                            {product.sku}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-medium text-slate-950">
                          {product.name}
                          {product.parent_product_id && (
                            <span className="ml-2 inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                              variant
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {product.brand ?? "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                          {product.category || "-"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">
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
      {adjustProduct && (
        <AdjustModal
          product={adjustProduct}
          onClose={() => setAdjustProduct(null)}
          onSaved={invalidateLedger}
        />
      )}

      {movementsProduct && (
        <MovementsDrawer
          product={movementsProduct}
          onClose={() => setMovementsProduct(null)}
        />
      )}
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
          ? "border-slate-950 text-slate-950"
          : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300",
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
      className="w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
    >
      {children}
    </button>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 p-3">
      <p className="text-xs font-medium uppercase text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-bold text-slate-950">{value}</p>
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
      <span className="text-xs font-medium uppercase text-slate-500">{label}</span>
      <span
        className={
          tone === "warning"
            ? "text-2xl font-bold text-warning-700"
            : "text-2xl font-bold text-slate-950"
        }
      >
        {value}
      </span>
      <span className="text-xs text-slate-500">{detail}</span>
    </Card>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </svg>
  );
}

function LedgerStatus({ label }: { label: StockStatus }) {
  const classes =
    label === "Reorder"
      ? "bg-warning-100 text-warning-700"
      : label === "Watch"
      ? "bg-blue-50 text-blue-700 ring-blue-200"
      : "bg-success-100 text-success-700";
  return (
    <span
      className={`inline-flex rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${classes}`}
    >
      {label}
    </span>
  );
}
