"use client";

/**
 * /reports/p-l — Profit & Loss report.
 * Owner/manager only. Supports Today / 7d / 30d date ranges.
 * Shows Revenue (gross/tax/net), COGS, Gross Profit (with %), OpEx, Net Profit (with %).
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

interface PLResponse {
  revenue: { grossCents: number; taxCents: number; netCents: number };
  cogs: { costCents: number };
  grossProfit: { cents: number; pct: number };
  opex: { cents: number };
  netProfit: { cents: number; pct: number };
  period: string;
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

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: "positive" | "negative" | "neutral";
}) {
  const valueColor =
    accent === "positive"
      ? "text-emerald-600"
      : accent === "negative"
      ? "text-red-600"
      : "text-slate-950";
  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${valueColor}`}>{value}</p>
      {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
    </Card>
  );
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function KpiSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading P&L data" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="animate-pulse rounded-lg border border-slate-200 bg-white p-4">
          <div className="h-3 w-24 rounded bg-slate-100" />
          <div className="mt-2 h-7 w-32 rounded bg-slate-100" style={{ opacity: 1 - i * 0.1 }} />
          <div className="mt-1.5 h-3 w-20 rounded bg-slate-100" />
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PLReportPage() {
  const [range, setRange] = useState<Range>("today");
  const [data, setData] = useState<PLResponse | null>(null);
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
        const result = await apiGet<PLResponse>(`/api/v1/reports/p-l?range=${range}`);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled)
          setError(
            err instanceof ApiResponseError ? err.message : "Failed to load P&L report."
          );
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
      title="Profit & Loss"
      subtitle={`P&L report · Demo Store · ${rangeLabel}`}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200 pb-4">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-slate-950">Profit &amp; Loss</h1>
            <p className="mt-1 text-sm text-slate-500">Revenue, cost of goods, and net profit for the selected period.</p>
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
            <div className="flex items-center gap-3">
              <RangeToggle value={range} onChange={setRange} />
              {data && (
                <span className="text-sm text-slate-500">{data.period}</span>
              )}
            </div>

            {loading ? (
              <KpiSkeleton />
            ) : error ? (
              <Card>
                <p role="alert" className="text-sm text-red-600">
                  {error}
                </p>
              </Card>
            ) : data ? (
              <>
                {/* Revenue section */}
                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Revenue
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <KpiCard label="Gross Revenue" value={formatMoney(data.revenue.grossCents)} />
                    <KpiCard label="Tax Collected" value={formatMoney(data.revenue.taxCents)} />
                    <KpiCard label="Net Revenue" value={formatMoney(data.revenue.netCents)} />
                  </div>
                </div>

                {/* Profitability section */}
                <div>
                  <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">
                    Profitability
                  </h2>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <KpiCard
                      label="Cost of Goods Sold"
                      value={formatMoney(data.cogs.costCents)}
                      accent="negative"
                    />
                    <KpiCard
                      label="Gross Profit"
                      value={formatMoney(data.grossProfit.cents)}
                      sub={`${data.grossProfit.pct.toFixed(1)}% margin`}
                      accent={data.grossProfit.cents >= 0 ? "positive" : "negative"}
                    />
                    <KpiCard
                      label="Operating Expenses"
                      value={formatMoney(data.opex.cents)}
                      accent="negative"
                    />
                    <KpiCard
                      label="Net Profit"
                      value={formatMoney(data.netProfit.cents)}
                      sub={`${data.netProfit.pct.toFixed(1)}% margin`}
                      accent={data.netProfit.cents >= 0 ? "positive" : "negative"}
                    />
                  </div>
                </div>

                {/* Summary table */}
                <Card title="P&L Summary" noPadding>
                  <div className="overflow-x-auto p-5">
                    <table className="w-full text-sm">
                      <tbody className="divide-y divide-slate-100">
                        <tr className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 text-slate-700">Gross Revenue</td>
                          <td className="py-2.5 text-right font-semibold text-slate-950">
                            {formatMoney(data.revenue.grossCents)}
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 text-slate-500 pl-4">− Tax Collected</td>
                          <td className="py-2.5 text-right text-slate-600">
                            ({formatMoney(data.revenue.taxCents)})
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 font-medium text-slate-700">Net Revenue</td>
                          <td className="py-2.5 text-right font-semibold text-slate-950">
                            {formatMoney(data.revenue.netCents)}
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 text-slate-500 pl-4">− Cost of Goods Sold</td>
                          <td className="py-2.5 text-right text-red-600">
                            ({formatMoney(data.cogs.costCents)})
                          </td>
                        </tr>
                        <tr className="border-t border-slate-200 bg-slate-50 hover:bg-slate-100">
                          <td className="py-2.5 pr-4 font-semibold text-slate-950">Gross Profit</td>
                          <td className={`py-2.5 text-right font-bold ${data.grossProfit.cents >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatMoney(data.grossProfit.cents)}{" "}
                            <span className="text-xs font-normal">({data.grossProfit.pct.toFixed(1)}%)</span>
                          </td>
                        </tr>
                        <tr className="hover:bg-slate-50">
                          <td className="py-2.5 pr-4 text-slate-500 pl-4">− Operating Expenses</td>
                          <td className="py-2.5 text-right text-red-600">
                            ({formatMoney(data.opex.cents)})
                          </td>
                        </tr>
                        <tr className="border-t-2 border-slate-200 bg-slate-50 hover:bg-slate-100">
                          <td className="py-2.5 pr-4 font-bold text-slate-950">Net Profit</td>
                          <td className={`py-2.5 text-right font-bold text-lg ${data.netProfit.cents >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                            {formatMoney(data.netProfit.cents)}{" "}
                            <span className="text-xs font-normal">({data.netProfit.pct.toFixed(1)}%)</span>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </Card>
              </>
            ) : null}
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}
