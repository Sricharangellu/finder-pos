"use client";

import { useEffect, useState, useCallback } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { SalesSummary, TopProduct, TopProductsResponse } from "@/api-client/types";
import { getUser } from "@/lib/auth";
import { ReportsDashboard } from "@/components/reports/ReportsDashboard";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { Card } from "@/components/Card";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { usePathname, useRouter } from "next/navigation";
import { useFinderContext, type FinderDateRange } from "@/lib/useFinderContext";
import { Skeleton } from "./_components/reportHelpers";
import { SalesByProductSection } from "./_components/SalesByProductSection";
import { MarginByCategorySection } from "./_components/MarginByCategorySection";
import { InventoryValuationSection } from "./_components/InventoryValuationSection";
import { LowStockSection } from "./_components/LowStockSection";

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
                      range === r ? "bg-brand-600 text-white" : "text-[#555] hover:bg-gray-50"
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
              <select className="h-8 rounded border border-[#D9D9D9] px-2 text-sm text-[#111] bg-white focus:border-brand-600 focus:outline-none">
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
