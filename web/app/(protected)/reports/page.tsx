"use client";

/**
 * /reports — tenant sales dashboard. Owner/manager only (cashiers are blocked).
 * Fetches GET /api/v1/reports/summary and renders the KPI dashboard.
 */

import { useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { SalesSummary, TopProduct, TopProductsResponse } from "@/api-client/types";
import { getUser } from "@/lib/auth";
import { ReportsDashboard } from "@/components/reports/ReportsDashboard";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { Card } from "@/components/Card";
import { EnterpriseShell } from "@/components/EnterpriseShell";

export default function ReportsPage() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [topProducts, setTopProducts] = useState<TopProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<"today" | "7d" | "30d">("today");

  const role = getUser()?.role ?? "cashier";
  const allowed = role === "owner" || role === "manager";

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [summaryData, topProductData] = await Promise.all([
          apiGet<SalesSummary>(`/api/v1/reports/summary?range=${range}`),
          apiGet<TopProductsResponse>(`/api/v1/reports/top-products?range=${range}&limit=4`),
        ]);
        if (!cancelled) {
          setSummary(summaryData);
          setTopProducts(topProductData.items);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiResponseError ? err.message : "Failed to load report.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, range]);

  return (
    <EnterpriseShell
      active="reports"
      title="Reports"
      subtitle={`Sales performance · Demo Store · ${range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days"}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* Sub-report navigation */}
        {allowed && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <h1 className="text-lg font-semibold text-slate-950">Reporting center</h1>
              <p className="mt-1 text-sm text-slate-500">
                Operational reporting across sales, inventory, and receivables.
              </p>
            </div>
            <ReportsSubNav />
          </div>
        )}
        {allowed && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm">
              {(["today", "7d", "30d"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRange(item)}
                  className={`min-h-[38px] rounded px-4 text-sm font-medium transition-colors ${
                    range === item ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {item === "today" ? "Today" : item === "7d" ? "7 days" : "30 days"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="min-h-[40px] rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 hover:bg-slate-50" type="button">
                Export CSV
              </button>
              <button className="min-h-[40px] rounded-md bg-slate-950 px-3 text-sm font-medium text-white hover:bg-slate-800" type="button">
                Schedule report
              </button>
            </div>
          </div>
        )}

        {!allowed ? (
          <Card>
            <p role="alert" className="text-sm text-slate-700">
              You don&apos;t have access to reports. Ask an owner or manager.
            </p>
          </Card>
        ) : loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">
            Loading…
          </p>
        ) : error ? (
          <Card>
            <p role="alert" className="text-sm text-danger-700">
              {error}
            </p>
          </Card>
        ) : summary ? (
          <ReportsDashboard summary={summary} topProducts={topProducts} />
        ) : null}
      </div>
    </EnterpriseShell>
  );
}
