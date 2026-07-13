"use client";

import { useState } from "react";
import { useQuery } from "@/lib/useQuery";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { ReportsSubNav } from "@/components/reports/ReportsSubNav";
import { Card } from "@/components/Card";
import { Badge } from "@/components/Badge";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";

interface RegisterClosure {
  id: string;
  register_id: string;
  register_name: string | null;
  outlet_name: string | null;
  opened_by: string;
  opening_float_cents: number;
  closing_float_cents: number | null;
  counted_cash_cents: number | null;
  variance_cents: number | null;
  status: string;
  opened_at: number;
  closed_at: number | null;
}

interface ClosureDetail {
  session: RegisterClosure;
  cashMovements: Array<{ movement_type: string; amount: number; reason: string | null; created_by: string | null; created_at: number }>;
  paymentBreakdown: Array<{ method: string; total_cents: number; count: number }>;
}

export default function RegisterClosuresPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, loading } = useQuery(
    "register-closures",
    () => apiGet<{ items: RegisterClosure[] }>("/api/v1/reports/register-closures?limit=100"),
    { staleMs: 60_000 },
  );

  const { data: detail, loading: detailLoading } = useQuery(
    `register-closure-detail:${selectedId}`,
    () => selectedId
      ? apiGet<ClosureDetail>(`/api/v1/reports/register-closures/${selectedId}`)
      : Promise.resolve(null),
    { staleMs: 30_000 },
  );

  const sessions = data?.items ?? [];

  return (
    <EnterpriseShell active="reports" title="Register Closures" subtitle="Session history and payment breakdown">
      <div className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6">
        <ReportsSubNav />
        <div className="h-5" />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-5">

          {/* Session list */}
          <div className="lg:col-span-2">
            <Card>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Sessions</h2>
                <span className="text-xs text-[var(--color-text-secondary)]">{sessions.length} total</span>
              </div>
              {loading ? (
                <div className="space-y-2">
                  {[1,2,3,4,5].map(i => <div key={i} className="h-16 animate-pulse rounded-lg bg-gray-100" />)}
                </div>
              ) : sessions.length === 0 ? (
                <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No register sessions found.</p>
              ) : (
                <ul className="divide-y divide-[var(--color-table-border)]">
                  {sessions.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(s.id)}
                        className={`w-full px-2 py-3 text-left transition-colors rounded-lg ${selectedId === s.id ? "bg-brand-50" : "hover:bg-gray-50"}`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium text-[var(--color-text-primary)]">
                            {s.register_name ?? s.register_id}
                          </span>
                          <Badge variant={s.status === "open" ? "green" : "gray"} size="sm">
                            {s.status}
                          </Badge>
                        </div>
                        <div className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                          {s.outlet_name ?? "—"} · {fmtDateTime(s.opened_at)}
                        </div>
                        {s.variance_cents !== null && s.variance_cents !== 0 && (
                          <div className={`mt-0.5 text-xs font-medium ${s.variance_cents < 0 ? "text-danger-500" : "text-success-600"}`}>
                            Variance: {formatMoney(Math.abs(s.variance_cents))} {s.variance_cents < 0 ? "short" : "over"}
                          </div>
                        )}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-3">
            {!selectedId ? (
              <Card>
                <p className="py-12 text-center text-sm text-[var(--color-text-secondary)]">
                  Select a session to view its payment breakdown and cash movements.
                </p>
              </Card>
            ) : detailLoading ? (
              <Card><div className="h-64 animate-pulse rounded bg-gray-100" /></Card>
            ) : detail ? (
              <div className="space-y-4">
                {/* Header */}
                <Card>
                  <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Session Summary</h3>
                  <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                    {[
                      ["Register", detail.session.register_name ?? detail.session.register_id],
                      ["Outlet", detail.session.outlet_name ?? "—"],
                      ["Opened by", detail.session.opened_by],
                      ["Opened", fmtDateTime(detail.session.opened_at)],
                      ["Closed", detail.session.closed_at ? fmtDateTime(detail.session.closed_at) : "Still open"],
                      ["Opening float", formatMoney(detail.session.opening_float_cents)],
                      ["Closing float", detail.session.closing_float_cents !== null ? formatMoney(detail.session.closing_float_cents) : "—"],
                      ["Counted cash", detail.session.counted_cash_cents !== null ? formatMoney(detail.session.counted_cash_cents) : "—"],
                      ["Variance", detail.session.variance_cents !== null ? formatMoney(detail.session.variance_cents) : "—"],
                    ].map(([label, value]) => (
                      <div key={label as string}>
                        <dt className="text-xs text-[var(--color-text-secondary)]">{label}</dt>
                        <dd className="font-medium text-[var(--color-text-primary)]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>

                {/* Payment breakdown */}
                {detail.paymentBreakdown.length > 0 && (
                  <Card>
                    <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Payment Breakdown</h3>
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-[var(--color-table-border)] text-xs text-[var(--color-text-secondary)]">
                          <th className="pb-2 text-left">Method</th>
                          <th className="pb-2 text-right">Transactions</th>
                          <th className="pb-2 text-right">Total</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--color-table-border)]">
                        {detail.paymentBreakdown.map((p) => (
                          <tr key={p.method}>
                            <td className="py-2 capitalize text-[var(--color-text-primary)]">{p.method}</td>
                            <td className="py-2 text-right text-[var(--color-text-secondary)]">{p.count}</td>
                            <td className="py-2 text-right font-medium text-[var(--color-text-primary)]">{formatMoney(p.total_cents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Card>
                )}

                {/* Cash movements */}
                {detail.cashMovements.length > 0 && (
                  <Card>
                    <h3 className="mb-3 text-sm font-semibold text-[var(--color-text-primary)]">Cash Movements</h3>
                    <ul className="divide-y divide-[var(--color-table-border)] text-sm">
                      {detail.cashMovements.map((m, i) => (
                        <li key={i} className="flex items-center justify-between py-2">
                          <div>
                            <span className="capitalize text-[var(--color-text-primary)]">{m.movement_type.replace(/_/g, " ")}</span>
                            {m.reason && <span className="ml-2 text-xs text-[var(--color-text-secondary)]">— {m.reason}</span>}
                          </div>
                          <span className={`font-medium ${m.movement_type === "cash_out" ? "text-danger-500" : "text-success-600"}`}>
                            {m.movement_type === "cash_out" ? "-" : "+"}{formatMoney(m.amount)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </EnterpriseShell>
  );
}
