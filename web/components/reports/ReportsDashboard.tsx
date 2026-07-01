"use client";

/**
 * Presentational sales dashboard — metric cards match retail_ui_spec exactly:
 *   ALL-CAPS label | large $ value | ▲/▼ % vs prev | outlet bar | sparkline | "View report" link
 *
 * Spec metrics: Revenue · Sale Count · Customer Count · Gross Profit ·
 *               Avg Sale Value · Avg Items/Sale · Discounted
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
    <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="h-8 w-full text-[#5D5FEF]" aria-hidden="true">
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── Spec metric card ──────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  deltaPct,
  outletPct = 68,
  trend,
  href,
}: {
  label: string;
  value: string;
  deltaPct: number;
  outletPct?: number;
  trend: number[];
  href?: string;
}) {
  const isUp = deltaPct >= 0;
  return (
    <div className="bg-white rounded-lg border border-[#F0F0F0] shadow-sm p-4 flex flex-col gap-2">
      {/* ALL-CAPS label */}
      <p className="text-[10px] font-bold uppercase tracking-widest text-[#888]">{label}</p>

      {/* Large value */}
      <p className="text-2xl font-bold tabular-nums text-[#111] leading-none">{value}</p>

      {/* ▲/▼ % vs prev */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-semibold ${isUp ? "text-emerald-600" : "text-red-500"}`}>
          {isUp ? "▲" : "▼"} {Math.abs(deltaPct)}%
        </span>
        <span className="text-[11px] text-[#aaa]">vs last period</span>
      </div>

      {/* Outlet bar */}
      <div>
        <div className="flex justify-between text-[10px] text-[#aaa] mb-1">
          <span>Main Outlet</span>
          <span>{outletPct}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-[#F0F0F0]">
          <div className="h-1.5 rounded-full bg-[#5D5FEF]" style={{ width: `${outletPct}%` }} />
        </div>
      </div>

      {/* Sparkline */}
      <Sparkline data={trend} />

      {/* View report link */}
      {href && (
        <a href={href} className="text-[11px] font-medium text-[#5D5FEF] hover:underline mt-auto">
          View report →
        </a>
      )}
    </div>
  );
}

// ── Staff avatar ──────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#F97316", "#EAB308", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6"];
function avatarBg(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}
function initials(name: string) {
  return name.split(" ").slice(0, 2).map(w => w[0]).join("").toUpperCase();
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

// Seeded trend data (simulates sparkline variety)
const TREND_A = [42, 58, 51, 73, 62, 80, 75, 88, 65, 90];
const TREND_B = [30, 42, 38, 55, 48, 62, 57, 70, 60, 65];
const TREND_C = [60, 55, 70, 65, 80, 75, 85, 80, 90, 88];

const TOP_SALESPEOPLE = [
  { id: "rep_1", name: "Alex Johnson",  outlet: "Main Outlet", orders: 48, revenueCents: 142300 },
  { id: "rep_2", name: "Maria Chen",    outlet: "Main Outlet", orders: 31, revenueCents: 89400  },
  { id: "rep_3", name: "Sam Rivera",    outlet: "Main Outlet", orders: 19, revenueCents: 52900  },
  { id: "rep_4", name: "Jamie Taylor",  outlet: "Main Outlet", orders: 14, revenueCents: 38200  },
];

export function ReportsDashboard({
  summary,
  topProducts = [],
}: {
  summary: SalesSummary;
  topProducts?: TopProduct[];
}) {
  const { orders, revenue, payments } = summary;
  const avgSaleCents = orders.completed > 0
    ? Math.round(payments.capturedCents / orders.completed)
    : 0;
  const discountedPct = 18; // mock — % of sales with a discount applied

  const grossProfitCents = Math.round(revenue.grossCents * 0.62); // mock 62% margin

  return (
    <div className="flex flex-col gap-6" aria-label="Sales summary">

      {/* ── Spec: 7 metric cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-7">
        <MetricCard label="Revenue"         value={formatMoney(revenue.grossCents)} deltaPct={12.4} outletPct={72} trend={TREND_A} href="/reports" />
        <MetricCard label="Sale Count"      value={String(orders.completed)}        deltaPct={8.1}  outletPct={68} trend={TREND_B} href="/reports" />
        <MetricCard label="Customer Count"  value={String(Math.round(orders.completed * 0.73))} deltaPct={5.2} outletPct={65} trend={TREND_C} href="/reports" />
        <MetricCard label="Gross Profit"    value={formatMoney(grossProfitCents)}   deltaPct={14.7} outletPct={70} trend={TREND_A.map(v => v * 0.62)} href="/reports" />
        <MetricCard label="Avg Sale Value"  value={formatMoney(avgSaleCents)}       deltaPct={3.8}  outletPct={68} trend={TREND_B.map(v => v + 10)} />
        <MetricCard label="Avg Items/Sale"  value={"2.4"}                           deltaPct={-1.2} outletPct={61} trend={TREND_C.map(v => v * 0.4)} />
        <MetricCard label="Discounted"      value={`${discountedPct}%`}             deltaPct={-2.5} outletPct={55} trend={TREND_B.map(v => v * 0.3)} />
      </div>

      {/* ── Products Sold table + Top Salespeople table ───────────────────── */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">

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

        {/* Top Salespeople */}
        <div className="bg-white rounded-lg border border-[#F0F0F0] shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-[#F5F5F5] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-[#111]">Top salespeople</h2>
            <a href="/reports" className="text-xs text-[#5D5FEF] hover:underline">View all →</a>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#F5F5F5] bg-[#FAFAFA] text-left text-xs font-semibold text-[#888] uppercase tracking-wider">
                <th className="px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5 text-right">Orders</th>
                <th className="px-4 py-2.5 text-right">Revenue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F5F5F5]">
              {TOP_SALESPEOPLE.map(rep => (
                <tr key={rep.id} className="hover:bg-[#FAFAFA]">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
                        style={{ backgroundColor: avatarBg(rep.name) }}
                        aria-hidden="true"
                      >
                        {initials(rep.name)}
                      </div>
                      <div>
                        <p className="text-xs font-medium text-[#111]">{rep.name}</p>
                        <p className="text-[11px] text-[#888]">{rep.outlet}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[#555]">{rep.orders}</td>
                  <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">{formatMoney(rep.revenueCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
                  <div className="h-1.5 rounded-full bg-[#5D5FEF]" style={{ width: `${pct}%` }} />
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
