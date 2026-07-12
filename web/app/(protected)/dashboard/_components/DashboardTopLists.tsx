"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";

interface TopProductItem {
  id: string; name: string; category?: string; qty: number; revenue: number;
}

interface TopCustomerItem {
  customer_id: string; name: string; orderCount: number; totalCents: number;
}

interface CategoryItem {
  key: string; name: string; revenueCents: number;
}

function SkeletonBox({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-slate-200 ${className}`} />;
}

export function DashboardTopLists({
  topProducts,
  topCustomers,
  categoryItems,
  loading,
  loadingCategory,
}: {
  topProducts: TopProductItem[];
  topCustomers: TopCustomerItem[];
  categoryItems: CategoryItem[];
  loading: boolean;
  loadingCategory: boolean;
}) {
  return (
    <>
      {/* ── Top Products & Top Customers ───────────────────────────────── */}
      <section aria-label="Top products and customers" className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Card title="Top Products" noPadding>
          {loading ? (
            <div className="space-y-3 px-5 py-4">
              {[...Array(5)].map((_, i) => <SkeletonBox key={i} className="h-8 w-full" />)}
            </div>
          ) : topProducts.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No data for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-5 py-3 font-medium text-slate-600">Product</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-600">Qty</th>
                  <th className="px-5 py-3 text-right font-medium text-slate-600">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topProducts.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/catalog/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {p.name}
                      </Link>
                      {p.category && <span className="ml-2 text-xs text-slate-400">{p.category}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{p.qty}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatMoney(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title="Top Customers" noPadding>
          {loading ? (
            <div className="space-y-3 px-5 py-4">
              {[...Array(5)].map((_, i) => <SkeletonBox key={i} className="h-8 w-full" />)}
            </div>
          ) : topCustomers.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No data for this period.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-5 py-3 font-medium text-slate-600">Customer</th>
                  <th className="px-3 py-3 text-right font-medium text-slate-600">Orders</th>
                  <th className="px-5 py-3 text-right font-medium text-slate-600">Total Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {topCustomers.map((c) => (
                  <tr key={c.customer_id} className="transition-colors hover:bg-slate-50">
                    <td className="px-5 py-3">
                      <Link href={`/customers/${c.customer_id}`} className="font-medium text-slate-900 hover:text-brand-700 hover:underline">
                        {c.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-slate-700">{c.orderCount}</td>
                    <td className="px-5 py-3 text-right tabular-nums text-slate-700">{formatMoney(c.totalCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      {/* ── Sales by Category ─────────────────────────────────────────── */}
      {(loadingCategory || categoryItems.length > 0) && (
        <section aria-label="Sales by category">
          <Card title="Sales by Category" noPadding>
            {loadingCategory ? (
              <div className="space-y-2 px-5 py-4">
                {[...Array(4)].map((_, i) => <SkeletonBox key={i} className="h-7 w-full" />)}
              </div>
            ) : (
              <div className="space-y-2 px-5 py-3">
                {(() => {
                  const maxRev = Math.max(...categoryItems.map((c) => c.revenueCents), 1);
                  return categoryItems.map((c) => {
                    const pct = Math.round((c.revenueCents / maxRev) * 100);
                    return (
                      <div key={c.key}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium text-slate-700">{c.name}</span>
                          <span className="tabular-nums text-slate-500">{formatMoney(c.revenueCents)}</span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-violet-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  });
                })()}
              </div>
            )}
          </Card>
        </section>
      )}
    </>
  );
}
