"use client";

import { useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { formatMoney } from "@/lib/money";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { InventoryLevel, InventoryLevelsResponse } from "@/api-client/types";

type StockStatus = "Healthy" | "Watch" | "Reorder";
type StatusFilter = "All" | StockStatus;

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

function formatVelocity(value: number) {
  return value > 0 ? `${value}/wk` : "Learning";
}

export default function InventoryPage() {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("All");
  const [status, setStatus] = useState<StatusFilter>("All");
  const [selectedSku, setSelectedSku] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
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
        setError(null);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        setError(err instanceof ApiResponseError ? err.message : "Could not load inventory.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, []);

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(rows.map((row) => row.category))).sort()],
    [rows]
  );

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesQuery =
        normalizedQuery.length === 0 ||
        row.name.toLowerCase().includes(normalizedQuery) ||
        row.sku.toLowerCase().includes(normalizedQuery);
      const matchesCategory = category === "All" || row.category === category;
      const matchesStatus = status === "All" || row.stockStatus === status;
      return matchesQuery && matchesCategory && matchesStatus;
    });
  }, [rows, query, category, status]);

  const selectedRow = useMemo(
    () => rows.find((row) => row.sku === selectedSku) ?? filteredRows[0] ?? null,
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

  return (
    <EnterpriseShell
      active="inventory"
      title="Inventory"
      subtitle={`Stock control · Demo Store · ${rows.length || "-"} tracked SKUs`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <Metric label="Active products" value={String(metrics.active)} detail="sellable catalog items" />
          <Metric label="Low stock" value={String(metrics.low)} detail={`${metrics.watch} watch items`} tone="warning" />
          <Metric label="Inventory value" value={formatMoney(metrics.value)} detail="using tracked cost" />
          <Metric label="Pending transfers" value="2" detail="receiving today" />
        </div>

        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_24rem]">
          <Card className="overflow-hidden p-0">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 px-4 py-3">
              <div>
                <h2 className="text-base font-semibold text-gray-900">Stock ledger</h2>
                <p className="text-sm text-gray-500">Operational view for counts, receiving, and reorder decisions.</p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm">Count</Button>
                <Button variant="primary" size="sm">Receive stock</Button>
              </div>
            </div>

            <div className="grid gap-3 border-b border-gray-200 bg-gray-50 px-4 py-3 lg:grid-cols-[minmax(16rem,1fr)_12rem_10rem]">
              <label className="block">
                <span className="sr-only">Search inventory</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search SKU or product"
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                />
              </label>
              <label className="block">
                <span className="sr-only">Filter by category</span>
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                >
                  {categories.map((item) => (
                    <option key={item} value={item}>{item}</option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">Filter by stock status</span>
                <select
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                  className="min-h-[44px] w-full rounded-lg border border-gray-300 bg-white px-3 text-sm text-gray-900 outline-none focus:border-brand-600 focus:ring-2 focus:ring-brand-600"
                >
                  <option value="All">All statuses</option>
                  <option value="Healthy">Healthy</option>
                  <option value="Watch">Watch</option>
                  <option value="Reorder">Reorder</option>
                </select>
              </label>
            </div>

            {loading ? (
              <div className="p-6 text-sm text-gray-500" aria-busy="true">Loading inventory...</div>
            ) : error ? (
              <div className="p-6 text-sm text-danger-700" role="alert">{error}</div>
            ) : filteredRows.length === 0 ? (
              <div className="p-6 text-sm text-gray-500">No inventory rows match the current filters.</div>
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
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {filteredRows.map((row) => (
                      <tr
                        key={row.sku}
                        className={selectedRow?.sku === row.sku ? "bg-brand-50" : "hover:bg-gray-50"}
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
                        <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-900">{row.name}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-gray-600">{row.category}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-gray-900">{row.available}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">{row.onHand}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">{row.committed}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-gray-600">{formatCost(row.costCents)}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <Status label={row.stockStatus} />
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
                  <p className="text-xs font-semibold uppercase text-gray-500">Selected SKU</p>
                  <h2 className="mt-1 text-xl font-bold text-gray-900">{selectedRow.name}</h2>
                  <p className="font-mono text-xs text-gray-500">{selectedRow.sku}</p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Detail label="Available" value={String(selectedRow.available)} />
                  <Detail label="On hand" value={String(selectedRow.onHand)} />
                  <Detail label="Committed" value={String(selectedRow.committed)} />
                  <Detail label="Reorder at" value={String(selectedRow.reorderPoint)} />
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-gray-500">Sell price</span>
                    <span className="font-semibold text-gray-900">{formatMoney(selectedRow.priceCents)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Average cost</span>
                    <span className="font-semibold text-gray-900">{formatCost(selectedRow.costCents)}</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-sm">
                    <span className="text-gray-500">Velocity</span>
                    <span className="font-semibold text-gray-900">{formatVelocity(selectedRow.velocity)}</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" fullWidth>Adjust</Button>
                  <Button variant="primary" size="sm" fullWidth>Receive</Button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-500">Select a SKU to inspect stock details.</p>
            )}
          </Card>
        </div>
      </div>
    </EnterpriseShell>
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

function Metric({ label, value, detail, tone }: { label: string; value: string; detail: string; tone?: "warning" }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase text-gray-500">{label}</span>
      <span className={tone === "warning" ? "text-2xl font-bold text-warning-700" : "text-2xl font-bold text-gray-900"}>{value}</span>
      <span className="text-xs text-gray-500">{detail}</span>
    </Card>
  );
}

function Status({ label }: { label: StockStatus }) {
  const classes = label === "Reorder"
    ? "bg-warning-100 text-warning-700"
    : label === "Watch"
    ? "bg-brand-100 text-brand-700"
    : "bg-success-100 text-success-700";
  return <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ${classes}`}>{label}</span>;
}
