"use client";

/**
 * /reports/ar-aging — Accounts Receivable Aging report.
 * Shows outstanding balances bucketed by aging period, with a totals row.
 * 60d buckets are amber-tinted; 90d+ buckets are red-tinted.
 */

import { useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ArAgingItem {
  customerId: string;
  customerName: string;
  current: number;
  days30: number;
  days60: number;
  days90plus: number;
  total: number;
}

interface ArAgingResponse {
  items: ArAgingItem[];
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading AR aging data" className="animate-pulse space-y-2 px-1 py-2">
      {Array.from({ length: 7 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 6 }).map((__, j) => (
            <div
              key={j}
              className="h-5 flex-1 rounded bg-slate-100"
              style={{ opacity: 1 - i * 0.1 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sum(items: ArAgingItem[], key: keyof ArAgingItem): number {
  return items.reduce((acc, item) => acc + (item[key] as number), 0);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ArAgingReportPage() {
  const [items, setItems] = useState<ArAgingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const data = await apiGet<ArAgingResponse>("/api/v1/reports/ar-aging");
        if (!cancelled) {
          setItems(data.items ?? []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof ApiResponseError
              ? err.message
              : "Failed to load AR aging report."
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const totals = {
    current: sum(items, "current"),
    days30: sum(items, "days30"),
    days60: sum(items, "days60"),
    days90plus: sum(items, "days90plus"),
    total: sum(items, "total"),
  };

  return (
    <EnterpriseShell
      active="reports"
      title="AR Aging"
      subtitle="Accounts receivable aging · Demo Store"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6">
        <div className="mb-5"><ReportsSubNav /></div>
        <Card title="AR Aging Report" noPadding>
          <div className="p-5">
            {loading ? (
              <TableSkeleton />
            ) : error ? (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            ) : items.length === 0 ? (
              <p className="text-sm text-slate-500">No outstanding receivables found.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                      <th className="pb-2 pr-4">Customer</th>
                      <th className="pb-2 pr-4 text-right">Current</th>
                      <th className="pb-2 pr-4 text-right">30d</th>
                      <th className="pb-2 pr-4 text-right">60d</th>
                      <th className="pb-2 pr-4 text-right">90d+</th>
                      <th className="pb-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item) => (
                      <tr key={item.customerId} className="hover:bg-slate-50">
                        <td className="py-2.5 pr-4 font-medium text-slate-950">
                          {item.customerName}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-slate-600">
                          {formatMoney(item.current)}
                        </td>
                        <td className="py-2.5 pr-4 text-right text-slate-600">
                          {formatMoney(item.days30)}
                        </td>
                        <td
                          className={`py-2.5 pr-4 text-right font-medium ${
                            item.days60 > 0
                              ? "text-amber-600"
                              : "text-slate-600"
                          }`}
                        >
                          {formatMoney(item.days60)}
                        </td>
                        <td
                          className={`py-2.5 pr-4 text-right font-medium ${
                            item.days90plus > 0
                              ? "text-red-600"
                              : "text-slate-600"
                          }`}
                        >
                          {formatMoney(item.days90plus)}
                        </td>
                        <td className="py-2.5 text-right font-semibold text-slate-950">
                          {formatMoney(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-950">
                      <td className="py-2.5 pr-4">Totals</td>
                      <td className="py-2.5 pr-4 text-right">{formatMoney(totals.current)}</td>
                      <td className="py-2.5 pr-4 text-right">{formatMoney(totals.days30)}</td>
                      <td
                        className={`py-2.5 pr-4 text-right ${
                          totals.days60 > 0 ? "text-amber-700" : ""
                        }`}
                      >
                        {formatMoney(totals.days60)}
                      </td>
                      <td
                        className={`py-2.5 pr-4 text-right ${
                          totals.days90plus > 0 ? "text-red-700" : ""
                        }`}
                      >
                        {formatMoney(totals.days90plus)}
                      </td>
                      <td className="py-2.5 text-right">{formatMoney(totals.total)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </Card>

        {/* Legend */}
        {!loading && !error && items.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-4 text-xs text-slate-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded bg-amber-400" aria-hidden="true" />
              60-day overdue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded bg-red-500" aria-hidden="true" />
              90+ days overdue
            </span>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
