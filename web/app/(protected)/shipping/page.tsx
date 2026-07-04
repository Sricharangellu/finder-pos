"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { apiGet, apiPost } from "@/api-client/client";
import { useToast } from "@/components/Toast";

interface Shipment {
  id: string;
  ship_number: string;
  invoice_id: string;
  status: string;
  method: string;
  carrier: string | null;
  tracking_number: string | null;
}

const STYLE: Record<string, string> = {
  pending_shipment: "bg-amber-100 text-amber-800",
  shipped: "bg-blue-100 text-blue-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-700",
};

export default function ShippingPage() {
  const [items, setItems] = useState<Shipment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** ID of the shipment row showing the inline ship form */
  const [shippingRowId, setShippingRowId] = useState<string | null>(null);
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

  function openShipForm(id: string) {
    setShippingRowId(id);
    setCarrier("");
    setTrackingNumber("");
  }

  function cancelShipForm() {
    setShippingRowId(null);
    setCarrier("");
    setTrackingNumber("");
  }

  const confirmShip = async (id: string) => {
    if (!carrier.trim()) return;
    setBusy(true);
    try {
      await apiPost(`/api/v1/shipping/${id}/ship`, {
        carrier: carrier.trim(),
        trackingNumber: trackingNumber.trim(),
      });
      setShippingRowId(null);
      setCarrier("");
      setTrackingNumber("");
      await load();
      addToast({ title: "Shipment marked as shipped", variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      addToast({ title: "Failed to mark shipped", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const deliver = async (id: string) => {
    setBusy(true);
    try {
      await apiPost(`/api/v1/shipping/${id}/deliver`, {});
      await load();
      addToast({ title: "Shipment marked as delivered", variant: "success" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
      addToast({ title: "Failed to mark delivered", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <EnterpriseShell active="shipping" title="Shipping" subtitle="Fulfil and track shipping orders">
      <div className="space-y-4 p-4">
        {error && <div className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700" role="alert">{error}</div>}
        <Card title="Shipping Orders" description="Generated from invoices. Mark shipped and delivered.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="py-2 pr-4">Ship #</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Method</th>
                  <th className="py-2 pr-4">Carrier</th>
                  <th className="py-2 pr-4">Tracking</th>
                  <th className="py-2 pr-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr><td colSpan={6} className="py-6 text-center text-gray-400">No shipping orders</td></tr>
                )}
                {items.map((s) => (
                  <>
                    <tr key={s.id} className="border-b last:border-0">
                      <td className="py-2 pr-4 font-medium">{s.ship_number}</td>
                      <td className="py-2 pr-4">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STYLE[s.status] ?? "bg-gray-100"}`}>
                          {s.status.replace(/_/g, " ")}
                        </span>
                      </td>
                      <td className="py-2 pr-4 capitalize">{s.method}</td>
                      <td className="py-2 pr-4">{s.carrier ?? "—"}</td>
                      <td className="py-2 pr-4 font-mono text-xs">{s.tracking_number ?? "—"}</td>
                      <td className="py-2 pr-4 text-right">
                        {s.status === "pending_shipment" && shippingRowId !== s.id && (
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => openShipForm(s.id)}>
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
                    {shippingRowId === s.id && (
                      <tr key={`${s.id}-form`} className="bg-gray-50">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="flex-1 min-w-[160px]">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Carrier <span className="text-danger-600">*</span>
                              </label>
                              <input
                                value={carrier}
                                onChange={(e) => setCarrier(e.target.value)}
                                placeholder="UPS / FedEx / USPS"
                                required
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600 outline-none"
                              />
                            </div>
                            <div className="flex-1 min-w-[160px]">
                              <label className="block text-sm font-medium text-gray-700 mb-1">
                                Tracking number <span className="text-gray-400 font-normal">(optional)</span>
                              </label>
                              <input
                                value={trackingNumber}
                                onChange={(e) => setTrackingNumber(e.target.value)}
                                placeholder="e.g. 1Z999AA10123456784"
                                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-600 focus:ring-2 focus:ring-brand-600 outline-none"
                              />
                            </div>
                            <div className="flex gap-2 pb-0.5">
                              <Button
                                size="sm"
                                variant="primary"
                                disabled={busy || !carrier.trim()}
                                loading={busy}
                                onClick={() => void confirmShip(s.id)}
                              >
                                Confirm
                              </Button>
                              <Button size="sm" variant="secondary" disabled={busy} onClick={cancelShipForm}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </EnterpriseShell>
  );
}
