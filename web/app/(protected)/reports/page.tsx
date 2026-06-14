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
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        {allowed && (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1">
              {(["today", "7d", "30d"] as const).map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setRange(item)}
                  className={`min-h-[40px] rounded-md px-3 text-sm font-medium transition-colors ${
                    range === item ? "bg-brand-600 text-white" : "text-gray-600 hover:bg-gray-100"
                  }`}
                >
                  {item === "today" ? "Today" : item === "7d" ? "7 days" : "30 days"}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button className="min-h-[40px] rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 hover:bg-gray-50" type="button">
                Export CSV
              </button>
              <button className="min-h-[40px] rounded-lg bg-brand-600 px-3 text-sm font-medium text-white hover:bg-brand-700" type="button">
                Schedule report
              </button>
            </div>
          </div>
        )}

        {!allowed ? (
          <Card>
            <p role="alert" className="text-sm text-gray-700">
              You don&apos;t have access to reports. Ask an owner or manager.
            </p>
          </Card>
        ) : loading ? (
          <p className="text-sm text-gray-500" aria-busy="true">
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
