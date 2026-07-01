"use client";

/**
 * /reports/end-of-day — Z-report / end-of-day summary.
 * Fetches GET /api/v1/reports/end-of-day?date=YYYY-MM-DD
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import { apiGet } from "@/api-client/client";
import { fmtTime } from "@/lib/date";

interface EndOfDayReport {
  date: string;
  businessDate: string;
  openedAt: number;
  closedAt: number | null;
  status: "open" | "closed";
  transactions: {
    count: number;
    voidCount: number;
    refundCount: number;
    averageTicket_cents: number;
  };
  sales: {
    grossSales_cents: number;
    discounts_cents: number;
    refunds_cents: number;
    netSales_cents: number;
    taxCollected_cents: number;
    totalCollected_cents: number;
  };
  tenders: Array<{
    method: string;
    count: number;
    total_cents: number;
  }>;
  topItems: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    total_cents: number;
  }>;
  cashDrawer: {
    openingFloat_cents: number;
    cashSales_cents: number;
    cashRefunds_cents: number;
    expectedCash_cents: number;
    actualCash_cents: number | null;
    variance_cents: number | null;
  };
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function EndOfDayPage() {
  const [date, setDate] = useState<string>(todayISO());
  const [report, setReport] = useState<EndOfDayReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setReport(null);
    void (async () => {
      try {
        const data = await apiGet<EndOfDayReport>(`/api/v1/reports/end-of-day?date=${date}`);
        if (!cancelled) setReport(data);
      } catch {
        if (!cancelled) setError("Failed to load end-of-day report.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  return (
    <EnterpriseShell
      active="reports"
      title="End-of-Day Report"
      subtitle="Z-Report — daily shift summary"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">
        {/* Date picker header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">End-of-Day Summary</h1>
            {report && (
              <p className="mt-0.5 text-sm text-slate-500">{report.businessDate}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            <label htmlFor="eod-date" className="text-sm font-medium text-slate-700">
              Date
            </label>
            <input
              id="eod-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="rounded-md border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-950 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {loading && (
          <p className="text-sm text-slate-500" aria-busy="true">
            Loading report…
          </p>
        )}

        {error && !loading && (
          <Card>
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          </Card>
        )}

        {!loading && !error && report && (
          <>
            {/* Status banner */}
            {report.status === "open" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <span className="font-semibold">Shift is still open</span> — figures may change
                until the shift is closed.
              </div>
            ) : (
              <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
                <span className="font-semibold">Shift closed</span> at{" "}
                {report.closedAt
                  ? fmtTime(report.closedAt)
                  : "—"}
              </div>
            )}

            {/* Sales summary card */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Sales Summary</h2>
              </div>
              <div className="grid grid-cols-1 gap-px bg-slate-100 sm:grid-cols-3">
                <SalesTile label="Gross Sales" value={formatMoney(report.sales.grossSales_cents)} />
                <SalesTile label="Net Sales" value={formatMoney(report.sales.netSales_cents)} />
                <SalesTile
                  label="Tax Collected"
                  value={formatMoney(report.sales.taxCollected_cents)}
                />
              </div>
              <div className="grid grid-cols-2 gap-px border-t border-slate-100 bg-slate-100 sm:grid-cols-3">
                <SalesTile
                  label="Discounts"
                  value={formatMoney(report.sales.discounts_cents)}
                  sub
                />
                <SalesTile
                  label="Refunds"
                  value={formatMoney(report.sales.refunds_cents)}
                  sub
                />
                <SalesTile
                  label="Total Collected"
                  value={formatMoney(report.sales.totalCollected_cents)}
                  sub
                />
              </div>
            </Card>

            {/* Transactions card */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Transactions</h2>
              </div>
              <div className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
                <SalesTile label="Total Transactions" value={String(report.transactions.count)} />
                <SalesTile
                  label="Avg Ticket"
                  value={formatMoney(report.transactions.averageTicket_cents)}
                />
                <SalesTile label="Voids" value={String(report.transactions.voidCount)} />
                <SalesTile label="Refunds" value={String(report.transactions.refundCount)} />
              </div>
            </Card>

            {/* Tender breakdown table */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Tender Breakdown</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Method
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Transactions
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.tenders.map((t) => (
                      <tr key={t.method} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-950">{t.method}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {t.count}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-950">
                          {formatMoney(t.total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-50">
                      <td className="px-4 py-3 font-bold text-slate-950">Subtotal</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-950">
                        {report.tenders.reduce((s, t) => s + t.count, 0)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-950">
                        {formatMoney(
                          report.tenders.reduce((s, t) => s + t.total_cents, 0)
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </Card>

            {/* Cash drawer card */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Cash Drawer</h2>
              </div>
              <div className="grid grid-cols-1 gap-6 p-4 sm:grid-cols-2">
                {/* Left: drawer movements */}
                <div className="space-y-2">
                  <CashDrawerRow
                    label="Opening Float"
                    value={formatMoney(report.cashDrawer.openingFloat_cents)}
                  />
                  <CashDrawerRow
                    label="Cash Sales"
                    value={formatMoney(report.cashDrawer.cashSales_cents)}
                  />
                  <CashDrawerRow
                    label="Cash Refunds"
                    value={`–${formatMoney(report.cashDrawer.cashRefunds_cents)}`}
                  />
                  <div className="border-t border-slate-200 pt-2">
                    <CashDrawerRow
                      label="Expected Cash"
                      value={formatMoney(report.cashDrawer.expectedCash_cents)}
                      bold
                    />
                  </div>
                </div>

                {/* Right: actual / variance */}
                <div className="space-y-2">
                  <CashDrawerRow
                    label="Actual Cash"
                    value={
                      report.cashDrawer.actualCash_cents !== null
                        ? formatMoney(report.cashDrawer.actualCash_cents)
                        : "—"
                    }
                  />
                  <CashDrawerRow
                    label="Variance"
                    value={
                      report.cashDrawer.variance_cents !== null
                        ? formatMoney(report.cashDrawer.variance_cents)
                        : "—"
                    }
                    varianceCents={report.cashDrawer.variance_cents}
                  />
                </div>
              </div>
              <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-400">
                Actual cash and variance are recorded when the shift is closed.
              </p>
            </Card>

            {/* Top items table */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-sm font-semibold text-slate-950">Top Items</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50 text-left">
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        #
                      </th>
                      <th className="px-4 py-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Product
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Qty Sold
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                        Revenue
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {report.topItems.slice(0, 10).map((item, i) => (
                      <tr key={item.productId} className="hover:bg-slate-50">
                        <td className="px-4 py-3 tabular-nums text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-slate-950">
                          {item.productName}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                          {item.quantitySold}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-950">
                          {formatMoney(item.total_cents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>
    </EnterpriseShell>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SalesTile({
  label,
  value,
  sub = false,
}: {
  label: string;
  value: string;
  sub?: boolean;
}) {
  return (
    <div className="bg-white px-4 py-3">
      <p
        className={`tabular-nums font-bold ${sub ? "text-lg text-slate-800" : "text-xl text-slate-950"}`}
      >
        {value}
      </p>
      <p className="mt-0.5 text-xs font-medium uppercase tracking-[0.08em] text-slate-500">
        {label}
      </p>
    </div>
  );
}

function CashDrawerRow({
  label,
  value,
  bold = false,
  varianceCents,
}: {
  label: string;
  value: string;
  bold?: boolean;
  varianceCents?: number | null;
}) {
  let valueClass = "text-slate-950";
  if (varianceCents !== undefined && varianceCents !== null) {
    if (varianceCents === 0) valueClass = "text-green-700";
    else if (varianceCents < 0) valueClass = "text-red-600";
    else valueClass = "text-amber-600";
  }

  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={`text-sm ${bold ? "font-semibold text-slate-950" : "text-slate-600"}`}
      >
        {label}
      </span>
      <span
        className={`text-sm tabular-nums ${bold ? "font-bold" : "font-medium"} ${valueClass}`}
      >
        {value}
      </span>
    </div>
  );
}
