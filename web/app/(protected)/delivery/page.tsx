"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import type {
  SalesOrder,
  SalesOrdersResponse,
  SOFulfillmentStatus,
  PickList,
  Shipment,
  ShipmentsResponse,
  Invoice,
} from "@/api-client/types";

// The five pipeline stages, in order. `fulfillment_status` on a sales order
// names the stage it has reached.
const STAGES: SOFulfillmentStatus[] = ["unfulfilled", "picking", "packed", "shipped", "delivered"];
const STAGE_LABEL: Record<string, string> = {
  unfulfilled: "Unfulfilled",
  picking: "Picking",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
};
const STAGE_STYLE: Record<string, string> = {
  unfulfilled: "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300",
  picking: "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300",
  packed: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300",
  shipped: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300",
  delivered: "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300",
};

function StageBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_STYLE[status] ?? STAGE_STYLE.unfulfilled}`}>
      {STAGE_LABEL[status] ?? status}
    </span>
  );
}

/** Horizontal stepper showing how far a sales order has progressed. */
function StageStepper({ status }: { status: string }) {
  const idx = Math.max(0, STAGES.indexOf(status as SOFulfillmentStatus));
  return (
    <div className="flex items-center gap-1.5">
      {STAGES.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div className="flex flex-col items-center gap-1">
            <div
              className={`h-2.5 w-2.5 rounded-full ${i <= idx ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-700"}`}
              aria-current={i === idx ? "step" : undefined}
            />
            <span className={`text-[10px] ${i <= idx ? "text-neutral-700 dark:text-neutral-200" : "text-neutral-400"}`}>{STAGE_LABEL[s]}</span>
          </div>
          {i < STAGES.length - 1 && <div className={`h-px w-6 ${i < idx ? "bg-blue-500" : "bg-neutral-300 dark:bg-neutral-700"}`} />}
        </div>
      ))}
    </div>
  );
}

export default function DeliveryPage() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pickList, setPickList] = useState<PickList | null>(null);
  const [shipment, setShipment] = useState<Shipment | null>(null);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canManage = hasRole("manager");

  const selected = useMemo(() => orders.find((o) => o.id === selectedId) ?? null, [orders, selectedId]);

  const loadOrders = useCallback(async () => {
    setError(null);
    try {
      const res = await apiGet<SalesOrdersResponse>("/api/v1/sales/sales-orders?limit=100");
      setOrders(res.items ?? []);
      setSelectedId((cur) => cur ?? res.items?.[0]?.id ?? null);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load sales orders.");
    }
  }, []);

  // Load the pick list + shipment attached to the selected order so the panel
  // can show the right action for its current stage.
  const loadDetail = useCallback(async (order: SalesOrder) => {
    setPickList(null);
    setShipment(null);
    setInvoice(null);
    try {
      const [pls, ships, invoices] = await Promise.all([
        apiGet<{ items: PickList[] }>("/api/v1/fulfillment/pick-lists"),
        apiGet<ShipmentsResponse>("/api/v1/shipping/"),
        apiGet<{ items: Invoice[] }>(`/api/v1/billing/invoices?salesOrderId=${order.id}`),
      ]);
      const pl = (pls.items ?? []).find((p) => p.order_id === order.id && p.source_type === "sales_order") ?? null;
      if (pl) setPickList(await apiGet<PickList>(`/api/v1/fulfillment/pick-lists/${pl.id}`));
      setShipment((ships.items ?? []).find((s) => s.sales_order_id === order.id) ?? null);
      setInvoice((invoices.items ?? [])[0] ?? null);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load pipeline detail.");
    }
  }, []);

  useEffect(() => { void loadOrders(); }, [loadOrders]);
  useEffect(() => { if (selected) void loadDetail(selected); }, [selected, loadDetail]);

  // Any pipeline action reloads both the order list (fulfillment_status changes)
  // and the selected order's detail.
  const act = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await loadOrders();
      if (selected) await loadDetail(selected);
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }, [loadOrders, loadDetail, selected]);

  const startPicking = (o: SalesOrder) =>
    act(() => apiPost("/api/v1/fulfillment/pick-lists/from-sales-order", { salesOrderId: o.id }));
  const pickLine = (lineId: string) =>
    act(() => apiPost(`/api/v1/fulfillment/pick-lists/${pickList!.id}/lines/${lineId}/pick`, {}));
  const pack = () => act(() => apiPost(`/api/v1/fulfillment/pick-lists/${pickList!.id}/pack`, {}));
  const ship = () => act(() => apiPost(`/api/v1/shipping/${shipment!.id}/ship`, {}));
  const deliver = () => act(() => apiPost(`/api/v1/shipping/${shipment!.id}/deliver`, {}));
  // Billing runs parallel to fulfilment: an approved order can be invoiced, which
  // raises the AR invoice (linked back to this order) that we surface below.
  const createInvoice = () => act(() => apiPost(`/api/v1/sales/sales-orders/${selected!.id}/invoice`, {}));

  const allPicked = pickList?.lines?.every((l) => l.status === "picked") ?? false;

  return (
    <EnterpriseShell
      active="delivery"
      title="Delivery"
      subtitle="Fulfil sales & ecommerce orders: pick → pack → ship → deliver"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6">
        {error && (
          <Card className="border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-900/20 dark:text-red-300">
            {error}
          </Card>
        )}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
          {/* ── Sales order list ─────────────────────────────────────────── */}
          <Card className="overflow-hidden p-0">
            <div className="border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
              <h2 className="text-sm font-semibold">Sales orders</h2>
            </div>
            {orders.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-neutral-500">
                No sales orders yet. Create one from Sales or an ecommerce checkout.
              </p>
            ) : (
              <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {orders.map((o) => (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-neutral-50 dark:hover:bg-neutral-800/50 ${
                        o.id === selectedId ? "bg-blue-50 dark:bg-blue-900/20" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{o.so_number}</p>
                        <p className="truncate text-xs text-neutral-500">{formatMoney(o.total_cents)}</p>
                      </div>
                      <StageBadge status={o.fulfillment_status} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* ── Pipeline panel for the selected order ────────────────────── */}
          <Card className="p-4">
            {!selected ? (
              <p className="py-8 text-center text-sm text-neutral-500">Select a sales order to manage its delivery.</p>
            ) : (
              <div className="flex flex-col gap-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold">{selected.so_number}</h2>
                    <p className="text-xs text-neutral-500">{formatMoney(selected.total_cents)}</p>
                  </div>
                  <StageBadge status={selected.fulfillment_status} />
                </div>

                <StageStepper status={selected.fulfillment_status} />

                {!canManage && (
                  <p className="text-xs text-neutral-500">You need the manager role to advance the pipeline.</p>
                )}

                {/* Stage-appropriate action */}
                <div className="rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                  {selected.fulfillment_status === "unfulfilled" && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-neutral-600 dark:text-neutral-300">Create a pick list to begin fulfilment.</p>
                      <Button onClick={() => startPicking(selected)} disabled={busy || !canManage}>Start picking</Button>
                    </div>
                  )}

                  {selected.fulfillment_status === "picking" && pickList && (
                    <div className="flex flex-col gap-3">
                      <p className="text-sm font-medium">Pick list</p>
                      <ul className="flex flex-col gap-2">
                        {(pickList.lines ?? []).map((l) => (
                          <li key={l.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="min-w-0 truncate">
                              {l.product_id} — {l.picked_qty}/{l.quantity}
                            </span>
                            {l.status === "picked" ? (
                              <StageBadge status="delivered" />
                            ) : (
                              <Button size="sm" variant="secondary" onClick={() => pickLine(l.id)} disabled={busy || !canManage}>
                                Pick
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                      <div className="flex justify-end">
                        <Button onClick={pack} disabled={busy || !canManage || !allPicked}>Pack</Button>
                      </div>
                    </div>
                  )}

                  {selected.fulfillment_status === "packed" && (
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm text-neutral-600 dark:text-neutral-300">
                        Packed{shipment ? ` — shipment ${shipment.ship_number} ready` : ""}. Ship it out.
                      </p>
                      <Button onClick={ship} disabled={busy || !canManage || !shipment}>Mark shipped</Button>
                    </div>
                  )}

                  {selected.fulfillment_status === "shipped" && (
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm text-neutral-600 dark:text-neutral-300">
                        In transit{shipment?.carrier ? ` via ${shipment.carrier}` : ""}
                        {shipment?.tracking_number ? ` (${shipment.tracking_number})` : ""}.
                      </div>
                      <Button onClick={deliver} disabled={busy || !canManage || !shipment}>Mark delivered</Button>
                    </div>
                  )}

                  {selected.fulfillment_status === "delivered" && (
                    <p className="text-sm font-medium text-green-700 dark:text-green-300">
                      Delivered{shipment?.tracking_number ? ` — ${shipment.tracking_number}` : ""}. Pipeline complete.
                    </p>
                  )}
                </div>

                {/* Billing — parallel to fulfilment. Show the linked AR invoice, or
                    offer to raise one once the order is approved. */}
                <div className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
                  {invoice ? (
                    <p className="flex flex-wrap items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                      Invoice <span className="font-medium">{invoice.invoice_number}</span> — {formatMoney(invoice.total_cents)}
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          invoice.status === "paid"
                            ? "bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300"
                            : "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
                        }`}
                      >
                        {invoice.status}
                      </span>
                    </p>
                  ) : selected.status === "invoiced" ? (
                    <p className="text-sm text-neutral-500">Invoiced.</p>
                  ) : selected.status === "approved" ? (
                    <>
                      <p className="text-sm text-neutral-600 dark:text-neutral-300">Not invoiced yet.</p>
                      <Button variant="secondary" onClick={createInvoice} disabled={busy || !canManage}>Create invoice</Button>
                    </>
                  ) : (
                    <p className="text-sm text-neutral-500">Approve the order to raise an invoice.</p>
                  )}
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </EnterpriseShell>
  );
}
