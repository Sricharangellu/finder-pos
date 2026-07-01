"use client";

import { useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { KpiCard } from "@/components/KpiCard";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";

interface CashMovement {
  movement_type: string;
  amount: number;
  reason: string | null;
  created_by: string | null;
  created_at: number;
}

interface CashMovementResponse {
  items: CashMovement[];
  totalInCents: number;
  totalOutCents: number;
  netCents: number;
}

export default function CashMovementPage() {
  const [registerId, setRegisterId] = useState("");

  const params = new URLSearchParams();
  if (registerId) params.set("registerId", registerId);

  const { data, loading } = useQuery(
    `cash-movement:${registerId}`,
    () => apiGet<CashMovementResponse>(`/api/v1/reports/cash-movement?${params}&limit=200`),
    { staleMs: 60_000 },
  );

  const movements = data?.items ?? [];

  return (
    <EnterpriseShell active="reports" title="Cash Movement" subtitle="Cash in / out events within register sessions">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Filter */}
        <div className="flex items-center gap-3">
          <input
            type="text"
            placeholder="Filter by register ID (optional)"
            value={registerId}
            onChange={(e) => setRegisterId(e.target.value)}
            className="h-8 w-64 rounded border border-slate-200 px-3 text-[13px] text-[var(--color-text-primary)] outline-none focus:border-brand-600"
          />
        </div>

        {/* Aggregates */}
        <div className="grid grid-cols-3 gap-4">
          <KpiCard title="Total In" value={formatMoney(data?.totalInCents ?? 0)} loading={loading} tone="green" />
          <KpiCard title="Total Out" value={formatMoney(data?.totalOutCents ?? 0)} loading={loading} tone="red" />
          <KpiCard title="Net" value={formatMoney(data?.netCents ?? 0)} loading={loading} tone={data && data.netCents >= 0 ? "green" : "red"} />
        </div>

        {/* Movement table */}
        <Card>
          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4,5].map(i => <div key={i} className="h-10 animate-pulse rounded bg-gray-100" />)}
            </div>
          ) : movements.length === 0 ? (
            <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">No cash movements found.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-table-border)] text-xs text-[var(--color-text-secondary)]">
                  <th className="pb-2 text-left">Type</th>
                  <th className="pb-2 text-left">Reason</th>
                  <th className="pb-2 text-left">By</th>
                  <th className="pb-2 text-left">When</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-table-border)]">
                {movements.map((m, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="py-2 capitalize text-[var(--color-text-primary)]">
                      {m.movement_type.replace(/_/g, " ")}
                    </td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{m.reason ?? "—"}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">{m.created_by ?? "—"}</td>
                    <td className="py-2 text-[var(--color-text-secondary)]">
                      {fmtDateTime(m.created_at)}
                    </td>
                    <td className={`py-2 text-right font-medium tabular-nums ${m.movement_type === "cash_out" ? "text-danger-500" : "text-success-600"}`}>
                      {m.movement_type === "cash_out" ? "-" : "+"}{formatMoney(m.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </EnterpriseShell>
  );
}
