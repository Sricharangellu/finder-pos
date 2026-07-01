"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type {
  SalesSummary,
  TopProduct,
  TopProductsResponse,
  SalesByProductItem,
  SalesByProductResponse,
  MarginByCategoryItem,
  MarginByCategoryResponse,
  InventoryValuationResponse,
  LowStockItem,
} from "@/api-client/types";
import { getUser } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { ReportsDashboard } from "@/components/reports/ReportsDashboard";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { Card } from "@/components/Card";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { usePathname, useRouter } from "next/navigation";
import { useFinderContext, type FinderDateRange } from "@/lib/useFinderContext";

// ─── Types ─────────────────────────────────────────────────────────────────────

type Range = "7d" | "30d" | "90d" | "custom";
type SortKey = "name" | "units" | "revenueCents" | "costCents" | "marginPct";
type SortDir = "asc" | "desc";

function relativeDateRange(days: number): FinderDateRange {
  const end = new Date();
  const start = new Date(end);
  start.setDate(end.getDate() - days + 1);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return {
    startDate: iso(start),
    endDate: iso(end),
    preset: days === 7 ? "current_week" : days === 30 ? "current_month" : "custom",
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function exportCsv(filename: string, rows: string[][]): void {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function Skeleton({ className }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-slate-100 ${className ?? ""}`} />;
}

function CsvButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 active:bg-slate-100 transition-colors"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      CSV
    </button>
  );
}

function SectionHeader({
  title,
  subtitle,
  onExport,
}: {
  title: string;
  subtitle?: string;
  onExport?: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 mb-4">
      <div>
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {onExport && <CsvButton onClick={onExport} />}
    </div>
  );
}

// ─── Sales by Product ──────────────────────────────────────────────────────────

function SalesByProductSection({ range }: { range: string }) {
  const [items, setItems] = useState<SalesByProductItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState<SortKey>("revenueCents");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<SalesByProductResponse>(`/api/v1/reports/sales-by-product?range=${range}`)
      .then((d) => {
        if (!cancelled) {
          setItems(d.items ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const sorted = [...items].sort((a, b) => {
    const mul = sortDir === "asc" ? 1 : -1;
    if (sortKey === "name") return mul * a.name.localeCompare(b.name);
    return mul * (a[sortKey] - b[sortKey]);
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const Indicator = ({ k }: { k: SortKey }) => (
    <span className="ml-1 opacity-40 text-[10px]">
      {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "⇅"}
    </span>
  );

  const handleExport = () =>
    exportCsv(`sales-by-product-${range}.csv`, [
      ["SKU", "Name", "Category", "Units", "Revenue", "Cost", "Margin %"],
      ...sorted.map((r) => [
        r.sku,
        r.name,
        r.category,
        String(r.units),
        String((r.revenueCents / 100).toFixed(2)),
        String((r.costCents / 100).toFixed(2)),
        String(r.marginPct),
      ]),
    ]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 pt-5 pb-2">
        <SectionHeader
          title="Sales by Product"
          subtitle="Top 20 SKUs — click column headers to sort"
          onExport={items.length > 0 ? handleExport : undefined}
        />
      </div>
      {loading ? (
        <div className="px-5 pb-5 space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-y border-slate-100">
              <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-[0.07em]">
                <th className="px-4 py-2.5 w-7">#</th>
                <th
                  className="px-4 py-2.5 cursor-pointer select-none hover:text-slate-800 transition-colors"
                  onClick={() => toggleSort("name")}
                >
                  Product
                  <Indicator k="name" />
                </th>
                <th className="px-4 py-2.5">Category</th>
                <th
                  className="px-4 py-2.5 text-right cursor-pointer select-none hover:text-slate-800 transition-colors"
                  onClick={() => toggleSort("units")}
                >
                  Units <Indicator k="units" />
                </th>
                <th
                  className="px-4 py-2.5 text-right cursor-pointer select-none hover:text-slate-800 transition-colors"
                  onClick={() => toggleSort("revenueCents")}
                >
                  Revenue <Indicator k="revenueCents" />
                </th>
                <th
                  className="px-4 py-2.5 text-right cursor-pointer select-none hover:text-slate-800 transition-colors"
                  onClick={() => toggleSort("marginPct")}
                >
                  Margin <Indicator k="marginPct" />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sorted.map((row, idx) => (
                <tr
                  key={row.productId}
                  className="hover:bg-slate-50/70 transition-colors"
                >
                  <td className="px-4 py-2.5 text-xs text-slate-400 tabular-nums">
                    {idx + 1}
                  </td>
                  <td className="px-4 py-2.5">
                    <p className="font-medium text-slate-900 leading-tight">
                      {row.name}
                    </p>
                    <p className="text-[11px] text-slate-400 font-mono">{row.sku}</p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                      {row.category}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.units.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                    {formatMoney(row.revenueCents)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span
                      className={`font-semibold ${
                        row.marginPct >= 50
                          ? "text-emerald-600"
                          : row.marginPct >= 35
                          ? "text-slate-700"
                          : "text-amber-600"
                      }`}
                    >
                      {row.marginPct}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Margin by Category ────────────────────────────────────────────────────────

function MarginByCategorySection({ range }: { range: string }) {
  const [items, setItems] = useState<MarginByCategoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<MarginByCategoryResponse>(
      `/api/v1/reports/margin-by-category?range=${range}`
    )
      .then((d) => {
        if (!cancelled) {
          setItems(d.items ?? []);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range]);

  const sorted = [...items].sort((a, b) => b.marginPct - a.marginPct);

  const handleExport = () =>
    exportCsv(`margin-by-category-${range}.csv`, [
      ["Category", "Units", "Revenue", "Cost", "Margin %"],
      ...sorted.map((r) => [
        r.category,
        String(r.units),
        String((r.revenueCents / 100).toFixed(2)),
        String((r.costCents / 100).toFixed(2)),
        String(r.marginPct),
      ]),
    ]);

  return (
    <Card>
      <SectionHeader
        title="Margin by Category"
        subtitle="Gross margin % per product category"
        onExport={items.length > 0 ? handleExport : undefined}
      />
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-10" />
          ))}
        </div>
      ) : sorted.length === 0 ? (
        <p className="text-sm text-slate-500">No data available.</p>
      ) : (
        <div className="space-y-4">
          {sorted.map((row) => (
            <div key={row.category}>
              <div className="flex items-baseline justify-between mb-1.5">
                <span className="text-sm font-medium text-slate-800">
                  {row.category}
                </span>
                <div className="flex items-baseline gap-4">
                  <span className="text-xs text-slate-400">
                    {formatMoney(row.revenueCents)} rev
                  </span>
                  <span
                    className={`font-semibold text-sm tabular-nums ${
                      row.marginPct >= 50
                        ? "text-emerald-600"
                        : row.marginPct >= 35
                        ? "text-slate-800"
                        : "text-amber-600"
                    }`}
                  >
                    {row.marginPct}%
                  </span>
                </div>
              </div>
              <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    row.marginPct >= 50
                      ? "bg-emerald-500"
                      : row.marginPct >= 35
                      ? "bg-blue-500"
                      : "bg-amber-500"
                  }`}
                  style={{ width: `${Math.min(row.marginPct, 100)}%` }}
                  aria-label={`${row.category}: ${row.marginPct}% margin`}
                />
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                {row.units.toLocaleString()} units · cost{" "}
                {formatMoney(row.costCents)}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Inventory Valuation ───────────────────────────────────────────────────────

function InventoryValuationSection() {
  const [data, setData] = useState<InventoryValuationResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<InventoryValuationResponse>("/api/v1/reports/inventory-valuation")
      .then((d) => {
        if (!cancelled) {
          setData(d);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = () => {
    if (!data) return;
    exportCsv("inventory-valuation.csv", [
      [
        "Product",
        "Stock Qty",
        "Cost/unit",
        "Retail/unit",
        "Total Cost",
        "Total Retail",
      ],
      ...data.rows.map((r) => [
        r.name,
        String(r.stockQty),
        String((r.costCents / 100).toFixed(2)),
        String((r.retailCents / 100).toFixed(2)),
        String((r.costValueCents / 100).toFixed(2)),
        String((r.retailValueCents / 100).toFixed(2)),
      ]),
    ]);
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 pt-5 pb-2">
        <SectionHeader
          title="Inventory Valuation"
          subtitle="Stock cost value on hand"
          onExport={data && data.rows.length > 0 ? handleExport : undefined}
        />
        {data && (
          <div className="flex flex-wrap gap-6 mb-3">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Cost Value
              </p>
              <p className="text-xl font-semibold tabular-nums text-slate-950">
                {formatMoney(data.totalCostCents)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Retail Value
              </p>
              <p className="text-xl font-semibold tabular-nums text-slate-700">
                {formatMoney(data.totalRetailCents)}
              </p>
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                Potential Margin
              </p>
              <p className="text-xl font-semibold tabular-nums text-emerald-600">
                {data.totalRetailCents > 0
                  ? `${Math.round(
                      ((data.totalRetailCents - data.totalCostCents) /
                        data.totalRetailCents) *
                        100
                    )}%`
                  : "—"}
              </p>
            </div>
          </div>
        )}
      </div>
      {loading ? (
        <div className="px-5 pb-5 space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : !data || data.rows.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-500">No inventory data.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-y border-slate-100">
              <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-[0.07em]">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5 text-right">On Hand</th>
                <th className="px-4 py-2.5 text-right">Cost/unit</th>
                <th className="px-4 py-2.5 text-right">Retail/unit</th>
                <th className="px-4 py-2.5 text-right">Cost Value</th>
                <th className="px-4 py-2.5 text-right">Retail Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.rows.map((row) => (
                <tr
                  key={row.productId}
                  className="hover:bg-slate-50/70 transition-colors"
                >
                  <td className="px-4 py-2.5 font-medium text-slate-900">
                    {row.name}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-700">
                    {row.stockQty.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {formatMoney(row.costCents)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                    {formatMoney(row.retailCents)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-medium text-slate-900">
                    {formatMoney(row.costValueCents)}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-slate-900">
                    {formatMoney(row.retailValueCents)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
                <td colSpan={4} className="px-4 py-2.5 text-slate-700 text-sm">
                  Totals
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-950 text-sm">
                  {formatMoney(data.totalCostCents)}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-slate-950 text-sm">
                  {formatMoney(data.totalRetailCents)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Low Stock SKUs ────────────────────────────────────────────────────────────

function LowStockSection() {
  const [items, setItems] = useState<LowStockItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiGet<{ items: LowStockItem[] }>("/api/v1/inventory/levels?lowStock=true&limit=50")
      .then((d) => {
        if (!cancelled) {
          setItems(
            (d.items ?? []).filter(
              (i) => i.stock_qty <= i.reorder_pt && i.reorder_pt > 0
            )
          );
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleExport = () =>
    exportCsv("low-stock.csv", [
      ["SKU", "Name", "Category", "On Hand", "Reorder Point", "Shortage"],
      ...items.map((r) => [
        r.sku,
        r.name,
        r.category,
        String(r.stock_qty),
        String(r.reorder_pt),
        String(r.reorder_pt - r.stock_qty),
      ]),
    ]);

  return (
    <Card className="overflow-hidden p-0">
      <div className="px-5 pt-5 pb-2">
        <SectionHeader
          title="Low Stock SKUs"
          subtitle="Products at or below their reorder point"
          onExport={items.length > 0 ? handleExport : undefined}
        />
      </div>
      {loading ? (
        <div className="px-5 pb-5 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-9" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="px-5 pb-5 flex items-center gap-2 text-sm text-slate-500">
          <span className="text-emerald-500 text-base">✓</span>
          All products are above their reorder points.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 border-y border-slate-100">
              <tr className="text-left text-[11px] font-semibold text-slate-500 uppercase tracking-[0.07em]">
                <th className="px-4 py-2.5">Product</th>
                <th className="px-4 py-2.5">Category</th>
                <th className="px-4 py-2.5 text-right">On Hand</th>
                <th className="px-4 py-2.5 text-right">Reorder Pt</th>
                <th className="px-4 py-2.5 text-right">Shortage</th>
                <th className="px-4 py-2.5 text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((row) => {
                const shortage = row.reorder_pt - row.stock_qty;
                const isOut = row.stock_qty === 0;
                return (
                  <tr
                    key={row.id}
                    className="hover:bg-slate-50/70 transition-colors"
                  >
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-900">{row.name}</p>
                      <p className="text-[11px] text-slate-400 font-mono">
                        {row.sku}
                      </p>
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                        {row.category}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums font-semibold text-amber-700">
                      {row.stock_qty}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-slate-600">
                      {row.reorder_pt}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-red-600 font-medium">
                      {shortage}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                          isOut
                            ? "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200"
                            : "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200"
                        }`}
                      >
                        {isOut ? "Out of stock" : "Low stock"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const {
    storeId,
    outletId,
    dateRange,
    comparisonPeriod,
    granularity,
    setDateRange,
    setGranularity,
  } = useFinderContext();
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [kpiLoading, setKpiLoading] = useState(true);
  const [kpiError, setKpiError] = useState<string | null>(null);
  const [range, setRange] = useState<Range>(() =>
    dateRange.preset === "today" || dateRange.preset === "current_week" ? "7d" :
      dateRange.preset === "current_month" ? "30d" : "custom"
  );
  const [customFrom, setCustomFrom] = useState(dateRange.startDate);
  const [customTo, setCustomTo] = useState(dateRange.endDate);

  const role = getUser()?.role ?? "cashier";
  const allowed = role === "owner" || role === "manager";

  const rangeParam =
    range === "custom" && customFrom && customTo
      ? `custom&from=${customFrom}&to=${customTo}`
      : range === "custom"
      ? "30d"
      : range;

  const applyRange = useCallback((next: Range) => {
    setRange(next);
    if (next === "7d") setDateRange(relativeDateRange(7));
    if (next === "30d") setDateRange(relativeDateRange(30));
    if (next === "90d") setDateRange(relativeDateRange(90));
  }, [setDateRange]);

  useEffect(() => {
    if (range === "custom" && customFrom && customTo) {
      setDateRange({ startDate: customFrom, endDate: customTo, preset: "custom" });
    }
  }, [customFrom, customTo, range, setDateRange]);

  useEffect(() => {
    const definition = {
      metric: "revenue",
      dimension: "sales_summary",
      constraints: [
        { field: "store_id", operator: "eq", value: storeId },
        { field: "outlet_id", operator: "eq", value: outletId },
      ],
      granularity,
      periodType: range === "custom" ? "absolute" : "last_n_days",
      periodCount: range === "custom" ? null : Number.parseInt(range, 10),
      startDate: dateRange.startDate,
      endDate: dateRange.endDate,
      comparison: comparisonPeriod,
      order: { column: "revenue", direction: "desc" },
      reportView: "table",
      optionalAggregates: ["sale_count", "gross_profit", "avg_sale_value"],
      dimensionMetadata: { store_id: "Store", outlet_id: "Outlet" },
    };
    const params = new URLSearchParams({
      definition: window.btoa(JSON.stringify(definition)),
      id: "overview",
      type: "prepared",
    });
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [comparisonPeriod, dateRange, granularity, outletId, pathname, range, router, storeId]);

  const loadKpi = useCallback(async () => {
    if (!allowed) {
      setKpiLoading(false);
      return;
    }
    setKpiLoading(true);
    setKpiError(null);
    try {
      const [summaryData, topData] = await Promise.all([
        apiGet<SalesSummary>(`/api/v1/reports/summary?range=${rangeParam}`),
        apiGet<TopProductsResponse>(
          `/api/v1/reports/top-products?range=${rangeParam}&limit=4`
        ),
      ]);
      setSummary(summaryData);
      setTopProducts(topData.items ?? []);
    } catch (err) {
      setKpiError(
        err instanceof ApiResponseError ? err.message : "Failed to load report."
      );
    } finally {
      setKpiLoading(false);
    }
  }, [allowed, rangeParam]);

  useEffect(() => {
    void loadKpi();
  }, [loadKpi]);

  const rangeLabel =
    range === "7d"
      ? "Last 7 days"
      : range === "30d"
      ? "Last 30 days"
      : range === "90d"
      ? "Last 90 days"
      : customFrom && customTo
      ? `${customFrom} – ${customTo}`
      : "Custom range";

  return (
    <EnterpriseShell
      active="reports"
      title="Reporting"
      subtitle={`Analytics · Demo Store · ${rangeLabel}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-5 sm:px-6">
        {/* Header + sub-nav */}
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Analytics</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              Sales performance, margins, and inventory health.
            </p>
          </div>
          <ReportsSubNav />
        </div>

        {!allowed ? (
          <Card>
            <p role="alert" className="text-sm text-slate-700">
              You don&apos;t have access to reports. Ask an owner or manager.
            </p>
          </Card>
        ) : (
          <>
            {/* ── Spec: Day/Week/Month pill toggle | ← date nav → | Outlet ─ */}
            <div className="bg-white border-b border-[#E8E8E8] -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 flex flex-wrap items-center gap-3">
              {/* Day / Week / Month pills */}
              <div className="inline-flex rounded border border-[#D9D9D9] bg-white overflow-hidden">
                {(["7d", "30d", "90d"] as Range[]).map((r, i) => (
                  <button key={r} type="button" onClick={() => applyRange(r)}
                    className={`px-4 py-1.5 text-sm font-medium transition-colors border-r border-[#D9D9D9] last:border-r-0 ${
                      range === r ? "bg-[#5D5FEF] text-white" : "text-[#555] hover:bg-gray-50"
                    }`}
                    aria-pressed={range === r}>
                    {["Day", "Week", "Month"][i]}
                  </button>
                ))}
              </div>

              {/* Date navigator ← [label] → */}
              <div className="flex items-center gap-1 rounded border border-[#D9D9D9] bg-white overflow-hidden">
                <button type="button"
                  onClick={() => applyRange(range === "7d" ? "7d" : range === "30d" ? "30d" : "90d")}
                  className="px-2.5 py-1.5 text-[#555] hover:bg-gray-50 transition-colors text-sm border-r border-[#D9D9D9]"
                  aria-label="Previous period">←</button>
                <span className="px-3 py-1.5 text-sm font-medium text-[#111]">{rangeLabel}</span>
                <button type="button"
                  onClick={() => applyRange(range)}
                  className="px-2.5 py-1.5 text-[#555] hover:bg-gray-50 transition-colors text-sm border-l border-[#D9D9D9]"
                  aria-label="Next period">→</button>
              </div>

              {/* Outlet dropdown */}
              <select className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] bg-white focus:border-[#5D5FEF] focus:outline-none">
                <option>All outlets</option>
                <option>Main Outlet</option>
              </select>
            </div>

            {/* ── KPI summary ────────────────────────────────────────────── */}
            {kpiLoading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-24 rounded-xl" />
                ))}
              </div>
            ) : kpiError ? (
              <Card>
                <p role="alert" className="text-sm text-red-600">
                  {kpiError}
                </p>
              </Card>
            ) : summary ? (
              <ReportsDashboard
                summary={summary}
                topProducts={topProducts}
              />
            ) : null}

            {/* ── Report cards ───────────────────────────────────────────── */}
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <SalesByProductSection range={rangeParam} />
              <MarginByCategorySection range={rangeParam} />
            </div>

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <InventoryValuationSection />
              <LowStockSection />
            </div>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
