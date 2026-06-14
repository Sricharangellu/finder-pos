"use client";

/**
 * Presentational sales dashboard. Pure render from a SalesSummary so it is
 * trivially unit-testable (no fetching here). The page component handles data
 * loading and role-gating.
 */

import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import type { SalesSummary, TopProduct } from "@/api-client/types";

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "success" | "warning" }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className={tone === "success" ? "text-2xl font-bold text-success-700" : tone === "warning" ? "text-2xl font-bold text-warning-700" : "text-2xl font-bold text-gray-900"}>{value}</span>
      {sub ? <span className="text-xs text-gray-500">{sub}</span> : null}
    </Card>
  );
}

export function ReportsDashboard({
  summary,
  topProducts = [],
}: {
  summary: SalesSummary;
  topProducts?: TopProduct[];
}) {
  const { orders, revenue, payments } = summary;
  const methods = Object.entries(payments.byMethod);
  const averageOrderCents = orders.completed > 0
    ? Math.round(payments.capturedCents / orders.completed)
    : 0;
  const refundRate = orders.total > 0
    ? Math.round((orders.refunded / orders.total) * 100)
    : 0;
  const hourlySales = [
    { hour: "8 AM", value: 42 },
    { hour: "10 AM", value: 78 },
    { hour: "12 PM", value: 56 },
    { hour: "2 PM", value: 38 },
    { hour: "4 PM", value: 64 },
    { hour: "6 PM", value: 47 },
  ];

  return (
    <div className="flex flex-col gap-6" aria-label="Sales summary">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Revenue</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <Kpi label="Gross" value={formatMoney(revenue.grossCents)} sub="completed orders" tone="success" />
          <Kpi label="Tax" value={formatMoney(revenue.taxCents)} />
          <Kpi label="Net" value={formatMoney(revenue.netCents)} sub="gross − tax" />
          <Kpi label="Average order" value={formatMoney(averageOrderCents)} />
          <Kpi label="Refund rate" value={`${refundRate}%`} tone={refundRate > 5 ? "warning" : undefined} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Sales rhythm</h2>
          <Card className="flex min-h-[17rem] flex-col gap-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-gray-900">Hourly sales index</h3>
                <p className="text-sm text-gray-500">Relative demand across the business day.</p>
              </div>
              <span className="rounded bg-success-100 px-2 py-1 text-xs font-semibold text-success-700">
                On pace
              </span>
            </div>
            <div className="flex flex-1 items-end gap-3">
              {hourlySales.map((bar) => (
                <div key={bar.hour} className="flex flex-1 flex-col items-center gap-2">
                  <div className="flex h-40 w-full items-end rounded bg-gray-100">
                    <div
                      className="w-full rounded bg-brand-600"
                      style={{ height: `${bar.value}%` }}
                      aria-label={`${bar.hour}: ${bar.value}% sales index`}
                    />
                  </div>
                  <span className="text-xs font-medium text-gray-500">{bar.hour}</span>
                </div>
              ))}
            </div>
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Payments</h2>
          <Card className="flex min-h-[17rem] flex-col gap-4">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Captured</p>
              <p className="mt-1 text-2xl font-bold text-gray-900">{formatMoney(payments.capturedCents)}</p>
              <p className="text-xs text-gray-500">{payments.capturedCount} successful payments</p>
            </div>
            {methods.length === 0 ? (
              <p className="text-sm text-gray-500">No payments yet</p>
            ) : (
              <div className="flex flex-col gap-3">
                {methods.map(([method, cents]) => {
                  const pct = payments.capturedCents > 0
                    ? Math.round((cents / payments.capturedCents) * 100)
                    : 0;
                  return (
                    <div key={method}>
                      <div className="mb-1 flex justify-between text-sm">
                        <span className="capitalize text-gray-600">{method}</span>
                        <span className="font-semibold text-gray-900">{formatMoney(cents)}</span>
                      </div>
                      <div className="h-2 rounded bg-gray-100">
                        <div className="h-2 rounded bg-brand-600" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Order status</h2>
          <Card className="overflow-hidden p-0">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Count</th>
                  <th className="px-4 py-3 text-right">Share</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[
                  ["Open", orders.open],
                  ["Completed", orders.completed],
                  ["Refunded", orders.refunded],
                  ["Voided", orders.voided],
                ].map(([label, count]) => {
                  const numericCount = Number(count);
                  const pct = orders.total > 0 ? Math.round((numericCount / orders.total) * 100) : 0;
                  return (
                    <tr key={label}>
                      <td className="px-4 py-3 font-medium text-gray-900">{label}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{numericCount}</td>
                      <td className="px-4 py-3 text-right text-gray-700">{pct}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Top products</h2>
          <Card className="overflow-hidden p-0">
            {topProducts.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500">No product sales yet.</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {topProducts.map((product, index) => (
                  <li key={product.productId} className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-4 py-3 text-sm">
                    <span className="text-xs font-bold text-gray-400">#{index + 1}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-medium text-gray-900">{product.name}</span>
                      <span className="block text-xs text-gray-500">{product.units} units</span>
                    </span>
                    <span className="font-semibold text-gray-900">{formatMoney(product.revenueCents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </section>
      </div>
    </div>
  );
}
