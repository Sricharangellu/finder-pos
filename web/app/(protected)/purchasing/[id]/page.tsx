"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge, statusBadge } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { hasRole } from "@/lib/auth";
import type { Supplier, SuppliersResponse } from "@/api-client/types";

// ── Local types ──────────────────────────────────────────────────────────────

interface POLine {
  id: string;
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  line_cost_cents: number;
  received_qty: number;
  expiry_date: number | null;
  lot_code: string | null;
}

interface PurchaseOrderDetail {
  id: string;
  supplier_id: string;
  status: string;
  receive_status: string | null;
  total_cost_cents: number;
  created_at: number;
  received_at: number | null;
  lines: POLine[];
}

interface ReceiveLine {
  lineId: string;
  qty: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function remaining(line: POLine): number {
  return Math.max(0, line.quantity - (line.received_qty ?? 0));
}

// ── Component ────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = String(params.id);

  const [order, setOrder] = useState<PurchaseOrderDetail | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Receive modal state
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const canManage = hasRole("manager");

  const load = useCallback(async () => {
    try {
      setError(null);
      const [orderRes, suppliersRes] = await Promise.all([
        apiGet<PurchaseOrderDetail>(`/api/v1/purchasing/orders/${id}`),
        apiGet<SuppliersResponse>("/api/v1/purchasing/suppliers"),
      ]);
      setOrder(orderRes);
      setSuppliers(suppliersRes.items ?? []);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load purchase order.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const supplierName = (sid: string) => suppliers.find((s) => s.id === sid)?.name ?? sid;

  // ── Receive modal ──────────────────────────────────────────────────────────

  const openReceiveModal = () => {
    if (!order) return;
    setReceiveLines(
      order.lines.map((line) => ({
        lineId: line.id,
        qty: remaining(line),
      }))
    );
    setReceiveError(null);
    setReceiveOpen(true);
  };

  const updateReceiveLine = (lineId: string, qty: number) => {
    setReceiveLines((prev) => prev.map((l) => (l.lineId === lineId ? { ...l, qty } : l)));
  };

  const submitReceive = async () => {
    if (!order) return;
    setReceiveBusy(true);
    setReceiveError(null);
    try {
      await apiPost(`/api/v1/purchasing/orders/${id}/receive`, { lines: receiveLines });
      setReceiveOpen(false);
      await load();
    } catch (err) {
      setReceiveError(err instanceof ApiResponseError ? err.message : "Could not receive stock.");
    } finally {
      setReceiveBusy(false);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  const title = order
    ? `PO — ${supplierName(order.supplier_id)}`
    : "Purchase Order";

  return (
    <EnterpriseShell
      active="purchasing"
      title="Purchase Order"
      subtitle={order ? `${supplierName(order.supplier_id)} · #${order.id}` : "Loading…"}
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        {/* Back link */}
        <div>
          <button
            type="button"
            onClick={() => router.push("/purchasing")}
            className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-950"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            Back to Purchasing
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && !order && (
          <div className="py-16 text-center text-sm text-slate-400">Loading…</div>
        )}

        {order && (
          <>
            {/* Header card */}
            <Card>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusBadge(order.status)}>
                      {order.status}
                    </Badge>
                    {order.receive_status && order.receive_status !== order.status && (
                      <Badge variant={statusBadge(order.receive_status)}>
                        {order.receive_status}
                      </Badge>
                    )}
                  </div>
                  <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Supplier</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-slate-950">
                        {supplierName(order.supplier_id)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Total cost</dt>
                      <dd className="mt-0.5 text-sm font-semibold text-slate-950">
                        {formatMoney(order.total_cost_cents)}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs font-medium uppercase text-slate-500">Created</dt>
                      <dd className="mt-0.5 text-sm text-slate-700">{fmtDate(order.created_at)}</dd>
                    </div>
                    {order.received_at && (
                      <div>
                        <dt className="text-xs font-medium uppercase text-slate-500">Received</dt>
                        <dd className="mt-0.5 text-sm text-slate-700">{fmtDate(order.received_at)}</dd>
                      </div>
                    )}
                  </dl>
                </div>

                {canManage && order.status !== "received" && (
                  <Button variant="primary" size="sm" onClick={openReceiveModal}>
                    Receive Stock
                  </Button>
                )}
              </div>
            </Card>

            {/* Lines table */}
            <Card className="overflow-hidden p-0">
              <div className="border-b border-slate-200 px-4 py-3">
                <h2 className="text-base font-semibold text-slate-950">Order lines</h2>
                <p className="text-sm text-slate-500">Line items in this purchase order.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                    <tr>
                      <th className="px-4 py-3">Product ID</th>
                      <th className="px-4 py-3 text-right">Ordered</th>
                      <th className="px-4 py-3 text-right">Received</th>
                      <th className="px-4 py-3 text-right">Remaining</th>
                      <th className="px-4 py-3 text-right">Unit Cost</th>
                      <th className="px-4 py-3 text-right">Line Cost</th>
                      <th className="px-4 py-3">Lot</th>
                      <th className="px-4 py-3">Expiry</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {order.lines.length === 0 ? (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-slate-400">
                          No lines on this order.
                        </td>
                      </tr>
                    ) : (
                      order.lines.map((line) => {
                        const rem = remaining(line);
                        return (
                          <tr key={line.id}>
                            <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">
                              {line.product_id}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-950">
                              {line.quantity}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-950">
                              {line.received_qty ?? 0}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                              <span className={rem > 0 ? "font-semibold text-amber-700" : "text-emerald-700"}>
                                {rem}
                              </span>
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-700">
                              {formatMoney(line.unit_cost_cents)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-slate-950">
                              {formatMoney(line.line_cost_cents)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                              {line.lot_code ?? "—"}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-slate-500">
                              {fmtDate(line.expiry_date)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </div>

      {/* Receive Stock Modal */}
      <Modal
        open={receiveOpen}
        onClose={() => setReceiveOpen(false)}
        title="Receive Stock"
        size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReceiveOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" disabled={receiveBusy} onClick={() => void submitReceive()}>
              {receiveBusy ? "Saving…" : "Confirm receipt"}
            </Button>
          </div>
        }
      >
        {receiveError && (
          <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            {receiveError}
          </div>
        )}
        <p className="mb-4 text-sm text-slate-500">
          Enter the quantity received for each line. Quantities are capped at the remaining amount.
        </p>
        <div className="flex flex-col gap-3">
          {order?.lines.map((line) => {
            const rem = remaining(line);
            const receiveEntry = receiveLines.find((r) => r.lineId === line.id);
            return (
              <div key={line.id} className="flex items-center gap-4 rounded-md border border-slate-200 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-xs font-semibold text-slate-700">{line.product_id}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Ordered: {line.quantity} · Received: {line.received_qty ?? 0} · Remaining: {rem}
                  </p>
                </div>
                <label className="flex items-center gap-2">
                  <span className="text-xs font-medium text-slate-500">Qty</span>
                  <input
                    type="number"
                    min={0}
                    max={rem}
                    value={receiveEntry?.qty ?? 0}
                    onChange={(e) =>
                      updateReceiveLine(line.id, Math.min(rem, Math.max(0, Number(e.target.value))))
                    }
                    disabled={rem === 0}
                    className="w-20 rounded-md border border-slate-300 bg-white px-2 py-1.5 text-right text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950 disabled:opacity-50"
                  />
                </label>
              </div>
            );
          })}
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
