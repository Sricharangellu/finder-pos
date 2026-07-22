"use client";

import { KpiCard } from "@/components/KpiCard";
import { formatMoney } from "@/lib/money";

// ── KPI Icons ─────────────────────────────────────────────────────────────────

function IconDollar() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="1" x2="12" y2="23" />
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

function IconCart() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function IconPackage() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  );
}

function IconCreditCard() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

// ── DashboardKpiSection ───────────────────────────────────────────────────────

interface Props {
  loading: boolean;
  gross: number;
  saleCount: number;
  grossProfit: number;
  customerCount: number;
  avgSaleValue: number;
  avgItems: number;
  discountedAmt: number;
  discountedPct: number;
  sparkRev: { value: number }[];
  sparkSales: { value: number }[];
}

export function DashboardKpiSection({
  loading,
  gross,
  saleCount,
  grossProfit,
  customerCount,
  avgSaleValue,
  avgItems,
  discountedAmt,
  discountedPct,
  sparkRev,
  sparkSales,
}: Props) {
  // Every card links to the same /reporting/sales report — that page has no
  // per-metric view (its 3 tabs group by category/customer/product, not by
  // metric), so a `?metric=` suffix implying per-KPI routing would be
  // decoration with no destination to build, not a real omission. Dropped
  // rather than left pointing nowhere.
  return (
    <section aria-label="Key performance indicators">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard title="Revenue" value={formatMoney(gross)} loading={loading}
          tone="green" icon={<IconDollar />} sparkline={sparkRev}
          reportHref="/reporting/sales" />
        <KpiCard title="Sale Count" value={saleCount.toLocaleString()} loading={loading}
          tone="blue" icon={<IconCart />} sparkline={sparkSales}
          reportHref="/reporting/sales" />
        <KpiCard title="Gross Profit" value={formatMoney(grossProfit)} loading={loading}
          tone="green" icon={<IconDollar />}
          reportHref="/reporting/sales" />
        <KpiCard title="Customer Count" value={customerCount.toLocaleString()} loading={loading}
          tone="blue" icon={<IconPackage />}
          reportHref="/reporting/sales" />
        <KpiCard title="Avg Sale Value" value={formatMoney(avgSaleValue)} loading={loading}
          tone="neutral" icon={<IconDollar />}
          reportHref="/reporting/sales" />
        <KpiCard title="Avg Items / Sale" value={avgItems.toFixed(1)} loading={loading}
          tone="neutral" icon={<IconCart />}
          reportHref="/reporting/sales" />
        <KpiCard title="Discounted (amt)" value={formatMoney(discountedAmt)} loading={loading}
          tone="amber" icon={<IconCreditCard />}
          reportHref="/reporting/sales" />
        <KpiCard title="Discounted (%)" value={`${discountedPct.toFixed(1)}%`} loading={loading}
          tone="amber" icon={<IconCreditCard />}
          reportHref="/reporting/sales" />
        <KpiCard title="Avg Order Value" value={formatMoney(avgSaleValue)} loading={loading}
          tone="neutral" icon={<IconDollar />}
          reportHref="/reporting/sales" />
      </div>
    </section>
  );
}
