"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useStoreAuth } from "@/contexts/StoreAuthContext";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";

interface Order {
  id: string;
  so_number: string;
  status: string;
  total_cents: number;
  created_at: number;
}

const STATUS_COLOR: Record<string, string> = {
  pending_approve: "bg-amber-100 text-amber-700",
  confirmed:       "bg-blue-100 text-blue-700",
  invoiced:        "bg-purple-100 text-purple-700",
  fulfilled:       "bg-emerald-100 text-emerald-700",
  cancelled:       "bg-red-100 text-red-700",
};

const STATUS_LABEL: Record<string, string> = {
  pending_approve: "Pending",
  confirmed:       "Confirmed",
  invoiced:        "Invoiced",
  fulfilled:       "Fulfilled",
  cancelled:       "Cancelled",
};

export default function StoreAccountPage() {
  const router = useRouter();
  const { customer, logout, loading } = useStoreAuth();
  const [orders, setOrders]   = useState<Order[]>([]);
  const [ordersLoading, setOrdersLoading] = useState(true);

  useEffect(() => {
    if (!loading && !customer) { router.replace("/store/login"); return; }
    if (!customer) return;
    apiGet<{ salesOrders: Order[] }>(`/api/v1/ecommerce/portal/${customer.id}/orders`)
      .then((r) => setOrders(r.salesOrders ?? []))
      .catch(() => {})
      .finally(() => setOrdersLoading(false));
  }, [customer, loading, router]);

  const handleLogout = async () => {
    await logout();
    router.replace("/store/login");
  };

  if (loading || !customer) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-brand-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">

      {/* Account header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#111]">My Account</h1>
          <p className="mt-0.5 text-sm text-slate-400">{customer.email}</p>
        </div>
        <button
          type="button"
          onClick={() => void handleLogout()}
          className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
        >
          Sign out
        </button>
      </div>

      {/* Profile card */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-600/10 text-xl font-bold text-brand-600">
            {customer.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-semibold text-[#111]">{customer.name}</p>
            <p className="text-sm text-slate-400">{customer.email}</p>
            <p className="mt-0.5 text-xs text-slate-300">Member since {fmtDate(customer.created_at)}</p>
          </div>
        </div>
      </div>

      {/* Order history */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-[#111]">Order History</h2>
        </div>

        {ordersLoading ? (
          <div className="space-y-2 p-4">{[1,2,3].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}</div>
        ) : orders.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-sm text-slate-400">No orders yet.</p>
            <button type="button" onClick={() => router.push("/store")}
              className="mt-2 text-sm font-medium text-brand-600 hover:underline">
              Browse products →
            </button>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {orders.map((o) => (
              <div key={o.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[#111]">{o.so_number}</p>
                  <p className="text-xs text-slate-400">{fmtDate(o.created_at)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_COLOR[o.status] ?? "bg-slate-100 text-slate-500"}`}>
                  {STATUS_LABEL[o.status] ?? o.status}
                </span>
                <p className="text-sm font-bold text-[#111] w-20 text-right">{formatMoney(o.total_cents)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="mt-6">
        <button type="button" onClick={() => router.push("/store")}
          className="text-sm font-medium text-slate-400 hover:text-brand-600 transition-colors">
          ← Continue shopping
        </button>
      </div>
    </div>
  );
}
