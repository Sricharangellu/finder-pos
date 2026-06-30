"use client";

/**
 * FE-48: Sales Report page — demonstrates ?definition= URL state management.
 * All filter state is serialised to a base64 JSON param so views are
 * bookmarkable, shareable, and deep-linkable.
 */

import { useQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { DateRangePicker } from "@/components/DateRangePicker";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { useReportFilters } from "@/hooks/useReportFilters";
import type { DatePreset } from "@/components/DateRangePicker";
import { Suspense } from "react";

interface SalesItem {
  key: string;
  name: string;
  revenue: number;
  units?: number;
  margin?: number;
}

function SalesReportContent() {
  const { filters, setFilter, setFilters, toParams } = useReportFilters({
    metric: "revenue",
    dimension: "product",
    periodType: "relative",
    periodCount: 30,
    reportView: "table",
  });

  const queryKey = `sales-report:${toParams()}`;
  const { data, loading } = useQuery(
    queryKey,
    () => apiGet<{ items: SalesItem[] }>(`/api/v1/reports/top-products?${toParams()}&limit=50`),
    { staleMs: 60_000 },
  );

  const items = data?.items ?? [];

  const handleDateChange = (range: { from: string; to: string }, preset: DatePreset) => {
    if (preset !== "custom") {
      setFilter("periodType", "relative");
      const days = preset === "today" ? 1 : preset === "7d" ? 7 : preset === "30d" ? 30 : 90;
      setFilter("periodCount", days);
    } else {
      setFilters({ periodType: "absolute", startDate: range.from, endDate: range.to });
    }
  };

  const fromMs = filters.periodType === "relative" && filters.periodCount
    ? Date.now() - filters.periodCount * 86_400_000
    : filters.startDate ? new Date(filters.startDate).getTime() : 0;

  const currentRange = {
    from: filters.startDate ?? new Date(fromMs).toISOString().slice(0, 10),
    to: filters.endDate ?? new Date().toISOString().slice(0, 10),
  };

  const currentPreset: DatePreset = filters.periodType === "relative"
    ? (filters.periodCount === 1 ? "today" : filters.periodCount === 7 ? "7d" : filters.periodCount === 90 ? "90d" : "30d")
    : "custom";

  return (
    <EnterpriseShell active="reports" title="Sales Report" subtitle="Revenue by product, customer, category or rep">
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">

        {/* Filter bar with URL state */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--color-table-border)] pb-4">
          <div className="flex flex-wrap items-center gap-2">
            {/* Dimension selector */}
            <select
              value={filters.dimension ?? "product"}
              onChange={(e) => setFilter("dimension", e.target.value)}
              className="h-8 rounded border border-slate-200 bg-white px-3 text-[13px] outline-none focus:border-brand-600"
            >
              <option value="product">By Product</option>
              <option value="category">By Category</option>
              <option value="customer">By Customer</option>
              <option value="user">By Sales Rep</option>
            </select>

            {/* Date range (integrates with useReportFilters) */}
            <DateRangePicker
              value={currentRange}
              onChange={handleDateChange}
              presets={["today", "7d", "30d", "90d", "custom"]}
            />

            {/* View toggle */}
            <div className="inline-flex rounded border border-slate-200 bg-white p-0.5">
              {(["table", "chart"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setFilter("reportView", v)}
                  className={`rounded px-3 py-1 text-[12px] font-medium capitalize transition-colors ${
                    filters.reportView === v ? "bg-brand-600 text-white" : "text-[var(--color-text-secondary)] hover:bg-gray-50"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {/* Bookmarkable URL indicator */}
          <div className="ml-auto text-xs text-[var(--color-text-secondary)]">
            <span title="This URL can be bookmarked and shared">🔗 Shareable view</span>
          </div>
        </div>

        {/* Results */}
        <Card>
          {loading ? (
            <div className="space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}</div>
          ) : items.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">No sales data for the selected period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-table-border)] text-xs text-[var(--color-text-secondary)]">
                  <th className="pb-2 text-left">{filters.dimension === "product" ? "Product" : "Name"}</th>
                  <th className="pb-2 text-right">Units</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-table-border)]">
                {items.map((item, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-2 font-medium text-[var(--color-text-primary)]">{item.name}</td>
                    <td className="py-2 text-right tabular-nums text-[var(--color-text-secondary)]">{item.units ?? "—"}</td>
                    <td className="py-2 text-right tabular-nums font-medium text-[var(--color-text-primary)]">{formatMoney(item.revenue ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </EnterpriseShell>
  );
}

export default function SalesReportPage() {
  return (
    <Suspense fallback={null}>
      <SalesReportContent />
    </Suspense>
  );
}
