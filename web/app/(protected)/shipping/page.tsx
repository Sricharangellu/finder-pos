"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import type { Shipment } from "@/api-client/types";

const STATUS_STYLE: Record<string, string> = {
  pending_shipment: "bg-amber-50 text-amber-700 ring-amber-200",
  shipped: "bg-blue-50 text-blue-700 ring-blue-200",
  delivered: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};

export default function ShippingPage() {
  const [items, setItems] = useState<Shipment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shipFormId, setShipFormId] = useState<string | null>(null);
  const [carrier, setCarrier] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const { addToast } = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      const r = await apiGet<{ items: Shipment[] }>("/api/v1/shipping");
      setItems(r.items ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shipments");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const openShipForm = (id: string) => {
    setShipFormId(id);
    setCarrier("");
    setTrackingNumber("");
  };

  const cancelShipForm = () => setShipFormId(null);

  const confirmShip = async (id: string) => {
    if (!carrier.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/v1/shipping/${id}/ship`, {
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim() || null,
      });
      setShipFormId(null);
      await load();
      addToast({ title: "Marked as shipped", variant: "success" });
    } catch (e) {
      addToast({ title: "Action failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const deliver = async (id: string) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/shipping/${id}/deliver`, {});
      await load();
      addToast({ title: "Marked as delivered", variant: "success" });
    } catch (e) {
      addToast({ title: "Action failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseShell active="shipping" title="Shipping" subtitle="Fulfil and track shipping orders" contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        <div className="border-b border-slate-200 pb-4">
          <h1 className="text-lg font-semibold text-slate-950">Shipping operations</h1>
          <p className="mt-1 text-sm text-slate-500">Track shipment readiness, carrier handoff, and delivery confirmation.</p>
        </div>
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <Card title="Shipping Orders" description="Generated from invoices. Mark shipped and delivered." noPadding>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                  <th className="px-5 py-3">Ship #</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Method</th>
                  <th className="px-4 py-3">Carrier</th>
                  <th className="px-4 py-3">Tracking</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.length === 0 && (
                  <tr><td colSpan={6} className="px-5 py-8 text-center text-slate-500">No shipping orders</td></tr>
                )}
                {items.map((s) => (
                  <Fragment key={s.id}>
                    <tr className="hover:bg-slate-50">
                      <td className="whitespace-nowrap px-5 py-3 font-medium text-slate-950">{s.ship_number}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[s.status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
                          {s.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 capitalize text-slate-700">{s.method}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-700">{s.carrier ?? "-"}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-600">{s.tracking_number ?? "-"}</td>
                      <td className="whitespace-nowrap px-5 py-3 text-right">
                        {s.status === "pending_shipment" && shipFormId !== s.id && (
                          <Button size="sm" variant="secondary" onClick={() => openShipForm(s.id)}>
                            Mark shipped
                          </Button>
                        )}
                        {s.status === "shipped" && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => deliver(s.id)}>
                            Mark delivered
                          </Button>
                        )}
                      </td>
                    </tr>
                    {shipFormId === s.id && (
                      <tr key={`${s.id}-form`}>
                        <td colSpan={6} className="bg-slate-50 px-5 py-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:gap-4">
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                Carrier <span className="text-danger-600">*</span>
                              </label>
                              <input
                                value={carrier}
                                onChange={(e) => setCarrier(e.target.value)}
                                placeholder="UPS / FedEx / USPS"
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-950 focus:ring-2 focus:ring-slate-950 outline-none"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-xs font-medium text-slate-700 mb-1">
                                Tracking number <span className="text-slate-400">(optional)</span>
                              </label>
                              <input
                                value={trackingNumber}
                                onChange={(e) => setTrackingNumber(e.target.value)}
                                placeholder="1Z999AA10123456784"
                                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-950 focus:ring-2 focus:ring-slate-950 outline-none"
                              />
                            </div>
                            <div className="flex gap-2 shrink-0">
                              <Button size="sm" variant="secondary" onClick={cancelShipForm}>Cancel</Button>
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={!carrier.trim() || busy}
                                loading={busy}
                                onClick={() => confirmShip(s.id)}
                              >
                                Confirm
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
