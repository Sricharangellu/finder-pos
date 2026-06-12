"use client";

/**
 * Presentational sales dashboard. Pure render from a SalesSummary so it is
 * trivially unit-testable (no fetching here). The page component handles data
 * loading and role-gating.
 */

import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import type { SalesSummary } from "@/api-client/types";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="text-2xl font-bold text-gray-900">{value}</span>
      {sub ? <span className="text-xs text-gray-500">{sub}</span> : null}
    </Card>
  );
}

export function ReportsDashboard({ summary }: { summary: SalesSummary }) {
  const { orders, revenue, payments } = summary;
  const methods = Object.entries(payments.byMethod);

  return (
    <div className="flex flex-col gap-6" aria-label="Sales summary">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Revenue</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Gross" value={formatMoney(revenue.grossCents)} sub="completed orders" />
          <Kpi label="Tax" value={formatMoney(revenue.taxCents)} />
          <Kpi label="Net" value={formatMoney(revenue.netCents)} sub="gross − tax" />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Orders</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Kpi label="Open" value={String(orders.open)} />
          <Kpi label="Completed" value={String(orders.completed)} />
          <Kpi label="Refunded" value={String(orders.refunded)} />
          <Kpi label="Voided" value={String(orders.voided)} />
          <Kpi label="Total" value={String(orders.total)} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-600">Payments captured</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Kpi label="Count" value={String(payments.capturedCount)} />
          <Kpi label="Captured" value={formatMoney(payments.capturedCents)} />
          <Card className="flex flex-col gap-1">
            <span className="text-xs font-medium uppercase tracking-wide text-gray-500">By method</span>
            {methods.length === 0 ? (
              <span className="text-sm text-gray-500">No payments yet</span>
            ) : (
              <ul className="text-sm text-gray-800">
                {methods.map(([method, cents]) => (
                  <li key={method} className="flex justify-between">
                    <span className="capitalize">{method}</span>
                    <span className="font-medium">{formatMoney(cents)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </section>
    </div>
  );
}
