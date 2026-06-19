"use client";

/**
 * /orders — Order history & management.
 *
 * Lists all tenant orders with status-tab filtering (all / open / completed /
 * refunded / voided). Managers and owners can refund or void orders inline.
 * Clicking a row expands order lines for detail.
 */

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { formatMoney } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type { Order, OrderLine, OrderStatus } from "@/api-client/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrdersResponse {
  items: Order[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_TABS: Array<{ label: string; value: OrderStatus | "all" }> = [
  { label: "All", value: "all" },
  { label: "Open", value: "open" },
  { label: "Completed", value: "completed" },
  { label: "Refunded", value: "refunded" },
  { label: "Voided", value: "voided" },
];

const STATUS_BADGE: Record<
  OrderStatus,
  "green" | "blue" | "red" | "gray" | "yellow"
> = {
  open: "blue",
  completed: "green",
  refunded: "yellow",
  voided: "gray",
};

function fmtDate(ms: number) {
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function OrderLinesTable({ lines }: { lines: OrderLine[] }) {
  return (
    <table className="w-full text-left text-sm">
      <thead>
        <tr className="border-b border-slate-100 text-xs font-medium uppercase text-slate-400">
          <th className="py-2 pr-4">Product</th>
          <th className="py-2 pr-4 text-right">Qty</th>
          <th className="py-2 pr-4 text-right">Unit</th>
          <th className="py-2 pr-4 text-right">Tax</th>
          <th className="py-2 text-right">Line total</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((l) => (
          <tr key={l.id} className="border-b border-slate-50 last:border-0">
            <td className="py-2 pr-4 font-medium text-slate-800">{l.name}</td>
            <td className="py-2 pr-4 text-right text-slate-600">{l.quantity}</td>
            <td className="py-2 pr-4 text-right text-slate-600">{formatMoney(l.unitCents)}</td>
            <td className="py-2 pr-4 text-right text-slate-500 text-xs">{formatMoney(l.taxCents)}</td>
            <td className="py-2 text-right font-medium text-slate-800">{formatMoney(l.lineCents)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OrderDetailModal({
  order,
  onClose,
  onRefund,
  onVoid,
  actionBusy,
}: {
  order: Order;
  onClose: () => void;
  onRefund: (id: string) => Promise<void>;
  onVoid: (id: string) => Promise<void>;
  actionBusy: boolean;
}) {
  const canAct = hasRole("manager");
  const canRefund = canAct && order.status === "completed";
  const canVoid = canAct && order.status === "open";

  return (
    <Modal
      open
      onClose={onClose}
      title={`Order ${order.orderNumber}`}
      footer={
        <div className="flex items-center justify-between w-full gap-2">
          <div className="flex gap-2">
            {canRefund && (
              <Button
                variant="danger"
                size="sm"
                loading={actionBusy}
                onClick={() => void onRefund(order.id)}
              >
                Refund
              </Button>
            )}
            {canVoid && (
              <Button
                variant="danger"
                size="sm"
                loading={actionBusy}
                onClick={() => void onVoid(order.id)}
              >
                Void
              </Button>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Status row */}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <div>
            <span className="text-slate-400">Status</span>
            <span className="ml-2">
              <Badge variant={STATUS_BADGE[order.status]}>
                {order.status}
              </Badge>
            </span>
          </div>
          <div>
            <span className="text-slate-400">State</span>
            <span className="ml-2 font-medium text-slate-700">{order.stateCode}</span>
          </div>
          <div>
            <span className="text-slate-400">Created</span>
            <span className="ml-2 text-slate-700">{fmtDate(order.createdAt)}</span>
          </div>
        </div>

        {/* Lines */}
        <OrderLinesTable lines={order.lines} />

        {/* Totals */}
        <div className="space-y-1 border-t border-slate-100 pt-3 text-sm">
          <div className="flex justify-between text-slate-600">
            <span>Subtotal</span>
            <span>{formatMoney(order.subtotalCents)}</span>
          </div>
          {order.discountCents > 0 && (
            <div className="flex justify-between text-emerald-600">
              <span>Discount</span>
              <span>−{formatMoney(order.discountCents)}</span>
            </div>
          )}
          <div className="flex justify-between text-slate-600">
            <span>Tax</span>
            <span>{formatMoney(order.taxCents)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 font-semibold text-slate-900">
            <span>Total</span>
            <span>{formatMoney(order.totalCents)}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [tab, setTab] = useState<OrderStatus | "all">("all");
  const [orders, setOrders] = useState<Order[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const LIMIT = 25;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const load = useCallback(
    async (tabValue: OrderStatus | "all", off: number) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: String(LIMIT), offset: String(off) });
        if (tabValue !== "all") params.set("status", tabValue);
        const res = await apiGet<OrdersResponse>(`/api/v1/orders?${params}`);
        setOrders(res.items ?? []);
        setTotal(res.total ?? 0);
      } catch (err) {
        setError(err instanceof ApiResponseError ? err.message : "Could not load orders.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(tab, offset);
  }, [load, tab, offset]);

  const changeTab = (t: OrderStatus | "all") => {
    setTab(t);
    setOffset(0);
  };

  const handleRefund = useCallback(
    async (id: string) => {
      setActionBusy(true);
      try {
        await apiPost(`/api/v1/orders/${id}/refund`, {});
        setSelectedOrder(null);
        await load(tab, offset);
      } catch (err) {
        alert(err instanceof ApiResponseError ? err.message : "Refund failed.");
      } finally {
        setActionBusy(false);
      }
    },
    [load, tab, offset],
  );

  const handleVoid = useCallback(
    async (id: string) => {
      setActionBusy(true);
      try {
        await apiPost(`/api/v1/orders/${id}/void`, {});
        setSelectedOrder(null);
        await load(tab, offset);
      } catch (err) {
        alert(err instanceof ApiResponseError ? err.message : "Void failed.");
      } finally {
        setActionBusy(false);
      }
    },
    [load, tab, offset],
  );

  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <EnterpriseShell
      active="orders"
      title="Orders"
      subtitle="Order history & management"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h1 className="text-lg font-semibold text-slate-950">Orders</h1>
            <p className="mt-1 text-sm text-slate-500">
              {total > 0 ? `${total} order${total !== 1 ? "s" : ""}` : "All orders across the tenant"}
            </p>
          </div>
        </div>

        {/* Status tabs */}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1 w-fit shadow-sm">
          {STATUS_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => changeTab(t.value)}
              className={`min-h-[36px] rounded px-4 text-sm font-medium transition-colors ${
                tab === t.value
                  ? "bg-slate-950 text-white"
                  : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <Card>
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          </Card>
        )}

        {/* Table */}
        {loading ? (
          <p className="text-sm text-slate-500" aria-busy="true">
            Loading…
          </p>
        ) : orders.length === 0 ? (
          <Card>
            <p className="text-sm text-slate-500">
              {tab === "all" ? "No orders yet. Ring up a sale on the Register." : `No ${tab} orders.`}
            </p>
          </Card>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-slate-100 bg-slate-50">
                <tr>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Order #
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    State
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Total
                  </th>
                  <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Date
                  </th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {orders.map((order) => (
                  <tr
                    key={order.id}
                    className="group cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setSelectedOrder(order)}
                  >
                    <td className="px-4 py-3 font-mono text-xs font-medium text-slate-800">
                      {order.orderNumber}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[order.status]}>{order.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{order.stateCode}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {formatMoney(order.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {fmtDate(order.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-xs text-slate-400 group-hover:text-slate-600">
                        View →
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {total > LIMIT && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-slate-500">
              Showing {offset + 1}–{Math.min(offset + LIMIT, total)} of {total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasPrev}
                onClick={() => setOffset((o) => Math.max(0, o - LIMIT))}
              >
                ← Prev
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={!hasNext}
                onClick={() => setOffset((o) => o + LIMIT)}
              >
                Next →
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {selectedOrder && (
        <OrderDetailModal
          order={selectedOrder}
          onClose={() => setSelectedOrder(null)}
          onRefund={handleRefund}
          onVoid={handleVoid}
          actionBusy={actionBusy}
        />
      )}
    </EnterpriseShell>
  );
}
