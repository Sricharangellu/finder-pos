"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { CustomerSummary } from "./shared";
import { orderStatusColor } from "./shared";

export function TransactionsTab({ summary }: { summary: CustomerSummary | null }) {
  if (!summary) {
    return (
      <Card title="Recent transactions">
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-10 animate-pulse rounded bg-slate-100" />
          ))}
        </div>
      </Card>
    );
  }

  return (
    <Card title="Recent transactions" className="overflow-hidden p-0">
      {summary.recentOrders.length === 0 ? (
        <div className="px-5 py-8 text-center text-sm text-slate-500">No transactions yet.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-5 py-3">Order</th>
                <th className="px-5 py-3">Date</th>
                <th className="px-5 py-3">Status</th>
                <th className="px-5 py-3 text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.recentOrders.map((order) => (
                <tr key={order.id} className="hover:bg-slate-50">
                  <td className="px-5 py-3">
                    <Link
                      href={`/orders?id=${order.id}`}
                      className="font-medium text-blue-600 hover:underline"
                    >
                      {order.orderNumber}
                    </Link>
                  </td>
                  <td className="px-5 py-3 text-slate-500">{fmtDate(order.createdAt)}</td>
                  <td className="px-5 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${orderStatusColor(order.status)}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-medium tabular-nums">
                    {formatMoney(order.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
