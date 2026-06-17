"use client";

/**
 * /reports/sales-by-rep — Sales performance by sales representative.
 * Owner/manager only. Supports Today / 7d / 30d date ranges.
 * Table: Rep Name | Orders | Revenue | Avg Order, sorted by revenue descending.
 */

import { useEffect, useState } from "react";
import { apiGet, ApiResponseError } from "@/api-client/client";
import { getUser } from "@/lib/auth";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";

// ─── Types ────────────────────────────────────────────────────────────────────

type Range = "today" | "7d" | "30d";

interface RepItem {
  repId: string;
  repName: string;
  orderCount: number;
  revenueCents: number;
  avgOrderCents: number;
}

interface RepResponse {
  items: RepItem[];
}

// ─── Sub-nav ──────────────────────────────────────────────────────────────────


// ─── Range toggle ─────────────────────────────────────────────────────────────

function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const labels: Record<Range, string> = { today: "Today", "7d": "7 days", "30d": "30 days" };
  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm">
      {(["today", "7d", "30d"] as const).map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => onChange(r)}
          className={`min-h-[38px] rounded px-4 text-sm font-medium transition-colors ${
            value === r ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
          }`}
        >
          {labels[r]}
        </button>
      ))}
    </div>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function TableSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading sales by rep data" className="animate-pulse space-y-2 px-1 py-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex gap-4">
          {Array.from({ length: 4 }).map((__, j) => (
            <div
              key={j}
              className="h-5 flex-1 rounded bg-slate-100"
              style={{ opacity: 1 - i * 0.15 }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function SalesByRepPage() {
  const [range, setRange] = useState<Range>("today");
  const [items, setItems] = useState<RepItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const role = getUser()?.role ?? "cashier";
  const allowed = role === "owner" || role === "manager";

  const rangeLabel =
    range === "today" ? "Today" : range === "7d" ? "Last 7 days" : "Last 30 days";

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
        const data = await apiGet<RepResponse>(`/api/v1/reports/sales-by-rep?range=${range}`);
        if (!cancelled) {
          // Sort by revenue descending
          const sorted = [...(data.items ?? [])].sort(
            (a, b) => b.revenueCents - a.revenueCents
          );
          setItems(sorted);
        }
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof ApiResponseError
              ? err.message
              : "Failed to load sales by rep report."
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowed, range]);

  // Totals for footer
  const totalOrders = items.reduce((s, r) => s + r.orderCount, 0);
  const totalRevenue = items.reduce((s, r) => s + r.revenueCents, 0);
  const overallAvg = totalOrders > 0 ? Math.round(totalRevenue / totalOrders) : 0;

  return (
    <EnterpriseShell
      active="reports"
      title="Sales by Rep"
      subtitle={`Sales by representative · Demo Store · ${rangeLabel}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200 pb-4">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-slate-950">Sales by Representative</h1>
            <p className="mt-1 text-sm text-slate-500">Revenue and order performance broken down by sales rep.</p>
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
            {/* Range selector */}
            <RangeToggle value={range} onChange={setRange} />

            <Card noPadding>
              <div className="p-5">
                {loading ? (
                  <TableSkeleton />
                ) : error ? (
                  <p role="alert" className="text-sm text-red-600">
                    {error}
                  </p>
                ) : items.length === 0 ? (
                  <p className="text-sm text-slate-500">No sales data for this period.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                          <th className="pb-2 pr-4">#</th>
                          <th className="pb-2 pr-4">Rep Name</th>
                          <th className="pb-2 pr-4 text-right">Orders</th>
                          <th className="pb-2 pr-4 text-right">Revenue</th>
                          <th className="pb-2 text-right">Avg Order</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {items.map((item, idx) => (
                          <tr key={item.repId} className="hover:bg-slate-50">
                            <td className="py-2.5 pr-4 text-slate-400">{idx + 1}</td>
                            <td className="py-2.5 pr-4 font-medium text-slate-950">
                              {item.repName}
                            </td>
                            <td className="py-2.5 pr-4 text-right text-slate-600">
                              {item.orderCount}
                            </td>
                            <td className="py-2.5 pr-4 text-right font-semibold text-slate-950">
                              {formatMoney(item.revenueCents)}
                            </td>
                            <td className="py-2.5 text-right text-slate-600">
                              {formatMoney(item.avgOrderCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-200 bg-slate-50 font-semibold text-slate-950">
                          <td className="py-2.5 pr-4" />
                          <td className="py-2.5 pr-4">Total</td>
                          <td className="py-2.5 pr-4 text-right">{totalOrders}</td>
                          <td className="py-2.5 pr-4 text-right">{formatMoney(totalRevenue)}</td>
                          <td className="py-2.5 text-right">{formatMoney(overallAvg)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>
            </Card>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
