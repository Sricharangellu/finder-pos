"use client";

/**
 * /reports — tenant sales dashboard. Owner/manager only (cashiers are blocked).
 * Fetches GET /api/v1/reports/summary and renders the KPI dashboard.
 */

import { useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import type { SalesSummary } from "@/api-client/types";
import { getUser } from "@/lib/auth";
import { ReportsDashboard } from "@/components/reports/ReportsDashboard";
import { Card } from "@/components/Card";

export default function ReportsPage() {
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const role = getUser()?.role ?? "cashier";
  const allowed = role === "owner" || role === "manager";

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await apiGet<SalesSummary>("/api/v1/reports/summary");
        if (!cancelled) setSummary(data);
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
  }, [allowed]);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold text-gray-900">Sales dashboard</h1>

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
        <ReportsDashboard summary={summary} />
      ) : null}
    </main>
  );
}
