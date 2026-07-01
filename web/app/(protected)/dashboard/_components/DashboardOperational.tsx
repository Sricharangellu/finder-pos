"use client";

import Link from "next/link";
import { Card } from "@/components/Card";
import { formatMoney } from "@/lib/money";

interface LowStockItem {
  id: string; sku: string; name: string; category: string;
  onHand: number; reorderPoint: number;
}

interface DashNotification {
  id: string; severity: string; title: string; body: string; read: boolean;
}

export function DashboardOperational({
  lowStock,
  recentNotifs,
}: {
  lowStock: LowStockItem[];
  recentNotifs: DashNotification[];
}) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Low Stock Alerts</h2>
          <Link href="/inventory" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        {lowStock.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">All stock levels are healthy.</p>
        ) : (
          <ul className="space-y-2">
            {lowStock.map((item) => (
              <li key={item.id} className="flex items-center justify-between rounded-lg border border-amber-100 bg-amber-50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-900">{item.name}</p>
                  <p className="font-mono text-xs text-slate-500">{item.sku} · {item.category}</p>
                </div>
                <div className="ml-3 shrink-0 text-right">
                  <p className="text-sm font-semibold text-amber-700">{item.onHand} left</p>
                  <p className="text-xs text-slate-400">reorder at {item.reorderPoint}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-slate-900">Recent Alerts</h2>
          <Link href="/notifications" className="text-xs text-blue-600 hover:underline">View all →</Link>
        </div>
        {recentNotifs.length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-400">No recent alerts.</p>
        ) : (
          <ul className="space-y-2">
            {recentNotifs.map((n) => {
              const sevColor = n.severity === "critical" ? "bg-red-50 border-red-100" : n.severity === "warning" ? "bg-amber-50 border-amber-100" : "bg-blue-50 border-blue-100";
              const dotColor = n.severity === "critical" ? "bg-red-500" : n.severity === "warning" ? "bg-amber-400" : "bg-blue-400";
              return (
                <li key={n.id} className={`flex items-start gap-3 rounded-lg border px-3 py-2.5 ${sevColor}`}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotColor}`} aria-hidden="true" />
                  <div className="min-w-0">
                    <p className={`text-sm font-medium ${n.read ? "text-slate-600" : "text-slate-900"}`}>{n.title}</p>
                    <p className="truncate text-xs text-slate-500">{n.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
