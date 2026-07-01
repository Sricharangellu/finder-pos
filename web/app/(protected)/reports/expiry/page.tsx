"use client";

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { fmtDate } from "@/lib/date";

interface ExpiringLot {
  id: string;
  product_id: string;
  name: string;
  lot_code: string | null;
  quantity: number;
  unit_cost_cents: number | null;
  expiry_date: number;
  days_to_expiry: number;
}

interface ExpiredLot {
  id: string;
  product_id: string;
  name: string;
  lot_code: string | null;
  quantity: number;
  unit_cost_cents: number | null;
  expiry_date: number;
  days_overdue: number;
}

interface ExpirySummary {
  expired: { lots: number; units: number; valueCents: number };
  expiringSoon: { lots: number; units: number; valueCents: number; withinDays: number };
}

function ExpiryBadge({ days }: { days: number }) {
  const cls =
    days <= 7
      ? "bg-red-100 text-red-800"
      : days <= 14
      ? "bg-orange-100 text-orange-800"
      : "bg-yellow-100 text-yellow-800";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
      {days}d
    </span>
  );
}

export default function ExpiryReportPage() {
  const [days, setDays] = useState(30);
  const [expiring, setExpiring] = useState<ExpiringLot[]>([]);
  const [expired, setExpired] = useState<ExpiredLot[]>([]);
  const [summary, setSummary] = useState<ExpirySummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const [expiringData, expiredData, summaryData] = await Promise.all([
          apiGet<{ items: ExpiringLot[] }>(`/api/v1/inventory/expiring?days=${days}`),
          apiGet<{ items: ExpiredLot[] }>("/api/v1/inventory/expired"),
          apiGet<ExpirySummary>(`/api/v1/inventory/expiry-summary?days=${days}`),
        ]);
        if (!cancelled) {
          setExpiring(expiringData.items ?? []);
          setExpired(expiredData.items ?? []);
          setSummary(summaryData);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load expiry data");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [days]);

  const totalAtRiskCents = (summary?.expired.valueCents ?? 0) + (summary?.expiringSoon.valueCents ?? 0);

  return (
    <EnterpriseShell active="reports" title="Expiry Report" subtitle="Near-expiry and expired stock">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200 pb-4">
          <div className="mb-3">
            <h1 className="text-lg font-semibold text-slate-950">Expiry Report</h1>
            <p className="mt-1 text-sm text-slate-500">Identify stock approaching expiry to mark down or return.</p>
          </div>
          <ReportsSubNav />
        </div>

        {/* Look-ahead toggle */}
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-slate-700">Expiring within:</span>
          <div className="inline-flex rounded-md border border-slate-200 bg-white p-1 shadow-sm">
            {([7, 14, 30, 60] as const).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`min-h-[36px] rounded px-4 text-sm font-medium transition-colors ${
                  days === d ? "bg-slate-950 text-white" : "text-slate-600 hover:bg-slate-100"
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className="rounded-md bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">Loading…</p>
        ) : (
          <>
            {/* Summary cards */}
            {summary && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: "Expired lots", value: summary.expired.lots.toString(), sub: `${summary.expired.units} units`, red: true },
                  { label: "Expired value", value: formatMoney(summary.expired.valueCents), sub: "at cost", red: true },
                  { label: `Expiring ≤${days}d lots`, value: summary.expiringSoon.lots.toString(), sub: `${summary.expiringSoon.units} units`, red: false },
                  { label: "Total at risk", value: formatMoney(totalAtRiskCents), sub: "expired + near-expiry", red: false },
                ].map((card) => (
                  <Card key={card.label}>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                    <p className={`mt-1 text-2xl font-bold ${card.red ? "text-red-700" : "text-slate-900"}`}>{card.value}</p>
                    <p className="mt-0.5 text-xs text-slate-400">{card.sub}</p>
                  </Card>
                ))}
              </div>
            )}

            {/* Expired table */}
            <Card title="Already Expired" description="Stock past its expiry date still on hand — write off or return immediately." noPadding>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3">Lot code</th>
                      <th className="px-5 py-3 text-right">Qty</th>
                      <th className="px-5 py-3">Expired</th>
                      <th className="px-5 py-3 text-right">Overdue</th>
                      <th className="px-5 py-3 text-right">Value at cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {expired.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-400">No expired stock on hand.</td>
                      </tr>
                    ) : expired.map((lot) => (
                      <tr key={lot.id} className="hover:bg-red-50">
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-900">{lot.name}</td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-gray-500">{lot.lot_code ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">{lot.quantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-gray-600">{fmtDate(lot.expiry_date)}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <span className="inline-flex rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">{lot.days_overdue}d</span>
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">
                          {lot.unit_cost_cents != null ? formatMoney(lot.unit_cost_cents * lot.quantity) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* Near-expiry table */}
            <Card title={`Expiring Within ${days} Days`} description="Take action before these lots expire." noPadding>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-5 py-3">Product</th>
                      <th className="px-5 py-3">Lot code</th>
                      <th className="px-5 py-3 text-right">Qty</th>
                      <th className="px-5 py-3">Expiry date</th>
                      <th className="px-5 py-3 text-right">Days left</th>
                      <th className="px-5 py-3 text-right">Value at cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {expiring.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-gray-400">No stock expiring within {days} days.</td>
                      </tr>
                    ) : expiring.map((lot) => (
                      <tr key={lot.id} className="hover:bg-amber-50">
                        <td className="whitespace-nowrap px-5 py-3 font-medium text-gray-900">{lot.name}</td>
                        <td className="whitespace-nowrap px-5 py-3 font-mono text-xs text-gray-500">{lot.lot_code ?? "—"}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">{lot.quantity}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-gray-600">{fmtDate(lot.expiry_date)}</td>
                        <td className="whitespace-nowrap px-5 py-3 text-right">
                          <ExpiryBadge days={lot.days_to_expiry} />
                        </td>
                        <td className="whitespace-nowrap px-5 py-3 text-right text-gray-700">
                          {lot.unit_cost_cents != null ? formatMoney(lot.unit_cost_cents * lot.quantity) : "—"}
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
