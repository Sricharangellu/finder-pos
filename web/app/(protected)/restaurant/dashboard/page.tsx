"use client";

/**
 * FE-R4: Restaurant Dashboard — F&B KPI overlay.
 * Covers today, avg ticket, table turns, peak hour, revenue.
 * Hourly revenue bar chart, top menu items, active table sessions.
 */

import { useState } from "react";
import Link from "next/link";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { KpiCard } from "@/components/KpiCard";
import { BarChart } from "@/components/charts/BarChart";
import { useQuery } from "@/lib/useQuery";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

// ── Types ─────────────────────────────────────────────────────────────────────

type Range = "today" | "yesterday" | "week";

interface DashboardKpis {
  covers_today: number;
  avg_ticket_cents: number;
  table_turns_today: number;
  peak_hour: string;
  open_tables: number;
  total_tables: number;
  revenue_today_cents: number;
}

interface TopItem {
  name: string;
  qty_sold: number;
  revenue_cents: number;
}

interface HourlyBucket {
  hour: string;
  label: string;
  revenue_cents: number;
}

interface ActiveSession {
  table_number: string;
  floor_section: string | null;
  party_size: number;
  elapsed_mins: number;
}

interface DashboardResponse {
  kpis: DashboardKpis;
  top_items: TopItem[];
  hourly_revenue: HourlyBucket[];
  active_sessions: ActiveSession[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function elapsed(mins: number): string {
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

function sessionTone(mins: number): string {
  if (mins > 90) return "text-red-600";
  if (mins > 60) return "text-amber-600";
  return "text-emerald-600";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RangeButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
        active
          ? "bg-brand-600 text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
}

function QuickLink({ href, label, sub }: { href: string; label: string; sub: string }) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm transition-colors hover:border-brand-600/40 hover:bg-brand-600/5"
    >
      <div>
        <p className="text-sm font-semibold text-[#111]">{label}</p>
        <p className="text-xs text-slate-500">{sub}</p>
      </div>
      <svg className="h-4 w-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function RestaurantDashboardPage() {
  const [range, setRange] = useState<Range>("today");

  const { data, loading } = useQuery(
    `restaurant:dashboard:${range}`,
    () => apiGet<DashboardResponse>(`/api/v1/restaurant/dashboard?range=${range}`),
  );

  const kpis = data?.kpis;
  const topItems = data?.top_items ?? [];
  const hourly = (data?.hourly_revenue ?? []).map((h) => ({
    label: h.label,
    value: h.revenue_cents / 100,
  }));
  const sessions = data?.active_sessions ?? [];

  const peakBucket = data?.hourly_revenue.reduce(
    (best, h) => (h.revenue_cents > best.revenue_cents ? h : best),
    data?.hourly_revenue[0] ?? { label: "—", revenue_cents: 0 },
  );

  const maxQty = topItems[0]?.qty_sold ?? 1;

  return (
    <EnterpriseShell
      active="restaurant-dashboard"
      title="Restaurant Dashboard"
      subtitle="F&B performance overview"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-5 sm:px-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-lg font-semibold text-[#111]">Restaurant Dashboard</h1>
            <p className="text-sm text-slate-500">
              {new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date())}
            </p>
          </div>
          <div className="flex gap-2">
            <RangeButton label="Today"     active={range === "today"}     onClick={() => setRange("today")} />
            <RangeButton label="Yesterday" active={range === "yesterday"} onClick={() => setRange("yesterday")} />
            <RangeButton label="This Week" active={range === "week"}      onClick={() => setRange("week")} />
          </div>
        </div>

        {/* ── KPI Tiles ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <KpiCard
            title="Covers today"
            value={loading ? "—" : String(kpis?.covers_today ?? 0)}
            tone="blue"
            trend={{ value: 12, label: "vs yesterday" }}
            loading={loading}
          />
          <KpiCard
            title="Avg ticket"
            value={loading ? "—" : formatMoney(kpis?.avg_ticket_cents ?? 0)}
            tone="green"
            trend={{ value: -3, label: "vs yesterday" }}
            loading={loading}
          />
          <KpiCard
            title="Table turns"
            value={loading ? "—" : `${kpis?.table_turns_today?.toFixed(1) ?? "0.0"}×`}
            tone="amber"
            loading={loading}
          />
          <KpiCard
            title="Peak hour"
            value={loading ? "—" : (kpis?.peak_hour ?? peakBucket?.label ?? "—")}
            tone="neutral"
            loading={loading}
          />
          <KpiCard
            title="Revenue today"
            value={loading ? "—" : formatMoney(kpis?.revenue_today_cents ?? 0)}
            tone="green"
            trend={{ value: 8, label: "vs yesterday" }}
            loading={loading}
          />
        </div>

        {/* ── Table occupancy bar ──────────────────────────────────────────── */}
        {!loading && kpis && (
          <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-[#111]">Table Occupancy</span>
              <span className="text-xs text-slate-500">
                {kpis.open_tables} of {kpis.total_tables} tables occupied
              </span>
            </div>
            <div className="h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-brand-600 transition-all duration-500"
                style={{
                  width: `${kpis.total_tables > 0 ? (kpis.open_tables / kpis.total_tables) * 100 : 0}%`,
                }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-[11px] text-slate-400">
              <span>0%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>
        )}

        {/* ── Main content row ─────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">

          {/* Hourly revenue chart — 3 cols */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-3">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-[#111]">Hourly Revenue</h2>
              {!loading && peakBucket && (
                <span className="text-xs text-slate-400">
                  Peak: {peakBucket.label} · {formatMoney(peakBucket.revenue_cents)}
                </span>
              )}
            </div>
            <div className="px-4 py-4">
              <BarChart
                data={hourly}
                height={180}
                color="#5D5FEF"
                formatValue={(v) => `$${v.toFixed(0)}`}
                loading={loading}
                showEveryNthLabel={2}
              />
            </div>
          </div>

          {/* Top menu items — 2 cols */}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:col-span-2">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-semibold text-[#111]">Top Menu Items</h2>
              <span className="text-xs text-slate-400">by qty sold</span>
            </div>
            <div>
              {loading ? (
                <div className="space-y-3 px-4 py-4">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-5 animate-pulse rounded bg-slate-100" />
                  ))}
                </div>
              ) : topItems.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-500">No sales data yet.</p>
              ) : (
                <div className="divide-y divide-slate-50">
                  {topItems.map((item, i) => (
                    <div key={item.name} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                      <span className="w-5 shrink-0 text-right text-[11px] font-semibold text-slate-400">
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-[#111]">{item.name}</p>
                        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-brand-600/70"
                            style={{ width: `${(item.qty_sold / maxQty) * 100}%` }}
                          />
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-[#111]">{item.qty_sold}</p>
                        <p className="text-[11px] text-slate-400">{formatMoney(item.revenue_cents)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Active table sessions ────────────────────────────────────────── */}
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <h2 className="text-sm font-semibold text-[#111]">
              Active Sessions
              {!loading && sessions.length > 0 && (
                <span className="ml-2 inline-flex items-center rounded-full bg-brand-600/10 px-1.5 py-0.5 text-[11px] font-semibold text-brand-600">
                  {sessions.length}
                </span>
              )}
            </h2>
            <Link href="/restaurant/floor-plan" className="text-xs text-brand-600 hover:underline">
              View floor plan →
            </Link>
          </div>

          {loading ? (
            <div className="space-y-3 px-4 py-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="py-10 text-center text-sm text-slate-500">No active table sessions right now.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="border-b border-slate-100 bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 text-left">Table</th>
                  <th className="px-4 py-2.5 text-left">Section</th>
                  <th className="px-4 py-2.5 text-right">Covers</th>
                  <th className="px-4 py-2.5 text-right">Elapsed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sessions.map((s, i) => (
                  <tr key={i} className="hover:bg-[#FAFAFA]">
                    <td className="px-4 py-2.5 font-semibold text-[#111]">{s.table_number}</td>
                    <td className="px-4 py-2.5 text-slate-500">{s.floor_section ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-[#111]">{s.party_size}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${sessionTone(s.elapsed_mins)}`}>
                      {elapsed(s.elapsed_mins)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Quick links ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <QuickLink href="/restaurant/floor-plan" label="Floor Plan" sub="Table status and session management" />
          <QuickLink href="/restaurant/kitchen"    label="Kitchen Display" sub="Course queue and bump interface" />
          <QuickLink href="/restaurant/tabs"       label="Bar Tabs" sub="Open tabs and multi-round orders" />
        </div>

      </div>
    </EnterpriseShell>
  );
}
