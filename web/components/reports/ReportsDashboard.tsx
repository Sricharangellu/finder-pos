"use client";

/**
 * Presentational sales dashboard — metric cards match retail_ui_spec:
 *   ALL-CAPS label | large value | sparkline | "View report" link
 *
 * Spec metrics: Revenue · Sale Count · Customer Count · Gross Profit ·
 *               Avg Sale Value · Avg Items/Sale · Discounted
 *
 * Every value comes from the real /api/v1/reports/summary payload. Cards show
 * no comparison delta or per-outlet split because the endpoint does not report
 * them yet — rendering invented numbers is worse than rendering none.
 */

import { formatMoney } from "@/lib/money";
import type { SalesSummary, TopProduct } from "@/api-client/types";

// ── Sparkline ──────────────────────────────────────────────────────────────────

function Sparkline({ data }: { data: number[] }) {
  if (data.length < 2) return null;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const rng = max - min || 1;
  const pts = data
    .map((v, i) => `${(i / (data.length - 1)) * 100},${28 - ((v - min) / rng) * 24}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full text-brand-600" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Spec metric card ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  note,
  trend,
  href,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: number[];
  href?: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-[#F0F0F0] shadow-sm p-4 flex flex-col gap-2">
      {/* ALL-CAPS label */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">{label}</p>

      {/* Large value */}
      <p className="text-2xl font-bold tabular-nums text-[#111] leading-none">{value}</p>

      {/* Context note (e.g. cost-coverage confidence) */}
      {note && <p className="text-[11px] text-[#aaa]">{note}</p>}

      {/* Sparkline (only when the endpoint provides a real series) */}
      {trend && <Sparkline data={trend} />}

      {/* View report link */}
      {href && (
        <a href={href} className="text-[11px] font-medium text-brand-600 hover:underline mt-auto">
          View report →
        </a>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function ReportsDashboard({
  summary,
  topProducts = [],
}: {
  summary: SalesSummary;
  topProducts?: TopProduct[];
}) {
  const { revenue, payments, kpi, sparklines } = summary;

  const grossProfitValue =
    kpi.grossProfitCents === null ? "—" : formatMoney(kpi.grossProfitCents);
  const grossProfitNote =
    kpi.grossProfitCents === null
      ? "No product costs recorded"
      : kpi.costCoveragePct < 100
      ? `${kpi.costCoveragePct}% of units costed`
      : undefined;

  return (
    <div className="flex flex-col gap-6" aria-label="Sales summary">

      {/* ── Spec: 7 metric cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard label="Revenue"         value={formatMoney(revenue.grossCents)}     trend={sparklines.revenue}   href="/reports" />
        <MetricCard label="Sale Count"      value={String(kpi.saleCount)}               trend={sparklines.saleCount} href="/reports" />
        <MetricCard label="Customer Count"  value={String(kpi.customerCount)} />
        <MetricCard label="Gross Profit"    value={grossProfitValue} note={grossProfitNote} href="/reports/p-l" />
        <MetricCard label="Avg Sale Value"  value={formatMoney(kpi.avgSaleValueCents)} />
        <MetricCard label="Avg Items/Sale"  value={kpi.avgItemsPerSale.toFixed(1)} />
        <MetricCard label="Discounted"      value={`${kpi.discountedPct}%`} note={formatMoney(kpi.discountedAmountCents)} />
      </div>

      {/* ── Products Sold table ───────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-5">

        {/* Products sold */}
        <div className="bg-white rounded-lg border border-[#F0F0F0] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F5F5F5] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#111]">Products sold</h2>
            <span className="text-xs text-[#888]">{topProducts.reduce((s, p) => s + p.units, 0)} units total</span>
          </div>
          {topProducts.length === 0 ? (
            <p className="px-5 py-6 text-sm text-[#888]">No product sales yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F5F5F5] bg-[#FAFAFA] text-left text-xs font-semibold text-[#888] uppercase tracking-wider">
                  <th className="px-4 py-2.5 w-7">#</th>
                  <th className="px-4 py-2.5">Product</th>
                  <th className="px-4 py-2.5 text-right">Units</th>
                  <th className="px-4 py-2.5 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#F5F5F5]">
                {topProducts.slice(0, 8).map((p, i) => (
                  <tr key={p.productId} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-2.5 text-xs font-bold text-[#ccc]">#{i + 1}</td>
                    <td className="px-4 py-2.5 font-medium text-[#111] truncate max-w-[180px]">{p.name}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-[#555]">{p.units}</td>
                    <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-[#111]">{formatMoney(p.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>

      {/* ── Payment breakdown ─────────────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-[#F0F0F0] shadow-sm p-5">
        <h2 className="text-sm font-semibold text-[#111] mb-4">Payment methods</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          {Object.entries(payments.byMethod).map(([method, cents]) => {
            const pct = payments.capturedCents > 0
              ? Math.round((cents / payments.capturedCents) * 100) : 0;
            return (
              <div key={method}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#888] capitalize">{method}</p>
                <p className="text-lg font-bold text-[#111] tabular-nums mt-1">{formatMoney(cents)}</p>
                <div className="mt-2 h-1.5 rounded-full bg-[#F0F0F0]">
                  <div className="h-1.5 rounded-full bg-brand-600" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[11px] text-[#aaa] mt-1">{pct}% of total</p>
              </div>
            );
          })}
        </div>
      </div>

    </div>
  );
}
