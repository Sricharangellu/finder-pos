"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney, parseToCents } from "@/lib/money";
import { hasRole } from "@/lib/auth";
import type {
  CreatePurchaseOrderLineRequest,
  InventoryLevelsResponse,
  PurchaseOrder,
  PurchaseOrdersResponse,
  Supplier,
  SuppliersResponse,
} from "@/api-client/types";
import { STATUS_STYLE, emptyLine, type DraftLine } from "./shared";

export function OrdersTab() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [orders, setOrders]       = useState<PurchaseOrder[]>([]);
  const [products, setProducts]   = useState<Array<{ id: string; sku: string; name: string }>>([]);
  const [error, setError]         = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);
  const [poSupplierId, setPoSupplierId] = useState("");
  const [lines, setLines]         = useState<DraftLine[]>([emptyLine()]);
  const canManage                 = hasRole("manager");

  const load = useCallback(async () => {
    setError(null);
    try {
      const [suppliersRes, ordersRes, inventoryRes] = await Promise.all([
        apiGet<SuppliersResponse>("/api/v1/purchasing/suppliers"),
        apiGet<PurchaseOrdersResponse>("/api/v1/purchasing/orders"),
        apiGet<InventoryLevelsResponse>("/api/v1/inventory/levels?pageSize=200"),
      ]);
      setSuppliers(suppliersRes.items ?? []);
      setOrders(ordersRes.items ?? []);
      setProducts((inventoryRes.items ?? []).map((item) => ({ id: item.id, sku: item.sku, name: item.name })));
      setPoSupplierId((cur) => cur || suppliersRes.items?.[0]?.id || "");
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not load purchasing data.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const supplierName = (id: string) => suppliers.find((s) => s.id === id)?.name ?? id;

  const updateLine = (index: number, patch: Partial<DraftLine>) =>
    setLines((cur) => cur.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const addLine    = () => setLines((cur) => [...cur, emptyLine()]);
  const removeLine = (index: number) => setLines((cur) => cur.filter((_, i) => i !== index));

  const receiveOrder = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/v1/purchasing/orders/${id}/receive`, {});
      await load();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not receive purchase order.");
    } finally { setBusy(false); }
  };

  const createOrder = async () => {
    if (!poSupplierId) return;
    const requestLines: CreatePurchaseOrderLineRequest[] = [];
    for (const line of lines) {
      if (!line.productId || !line.quantity || !line.unitCost) continue;
      const entry: CreatePurchaseOrderLineRequest = {
        productId: line.productId,
        quantity: Number(line.quantity),
        unitCostCents: parseToCents(line.unitCost),
      };
      if (line.expiryDate) entry.expiryDate = new Date(line.expiryDate).getTime();
      if (line.lotCode.trim()) entry.lotCode = line.lotCode.trim();
      requestLines.push(entry);
    }
    if (requestLines.length === 0) {
      setError("Add at least one line with a product, quantity, and unit cost.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/v1/purchasing/orders", { supplierId: poSupplierId, lines: requestLines });
      setLines([emptyLine()]);
      await load();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Could not create purchase order.");
    } finally { setBusy(false); }
  };

  const INPUT = "mt-1 min-h-[44px] w-full rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 outline-none focus:border-slate-950 focus:ring-2 focus:ring-slate-950";

  return (
    <div className="flex flex-col gap-5 p-4">
      {error && <p role="alert" className="rounded-md bg-red-50 px-4 py-2 text-sm text-red-700">{error}</p>}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <tr>
              <th className="px-4 py-3">PO</th>
              <th className="px-4 py-3">Supplier</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Total</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {orders.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-slate-400">No purchase orders yet.</td>
              </tr>
            ) : (
              orders.map((order) => (
                <tr key={order.id} className="transition-colors hover:bg-slate-50">
                  <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-slate-700">{order.id}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-950">{supplierName(order.supplier_id)}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`inline-flex rounded px-2 py-1 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[order.status] ?? "bg-slate-100 text-slate-700 ring-slate-200"}`}>
                      {order.status}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right font-semibold text-slate-950">{formatMoney(order.total_cost_cents)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {order.status === "ordered" && canManage && (
                      <Button size="sm" variant="primary" disabled={busy} onClick={() => void receiveOrder(order.id)}>
                        Receive
                      </Button>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <div className="border-t border-slate-200 pt-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-950">Create purchase order</h3>
          <label className="mb-3 block max-w-sm">
            <span className="text-xs font-medium uppercase text-slate-500">Supplier</span>
            <select value={poSupplierId} onChange={(e) => setPoSupplierId(e.target.value)} className={INPUT}>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <div className="flex flex-col gap-3">
            {lines.map((line, index) => (
              <div key={index} className="grid grid-cols-1 gap-2 rounded-md border border-slate-200 p-3 sm:grid-cols-5">
                <label className="block sm:col-span-2">
                  <span className="text-xs font-medium uppercase text-slate-500">Product</span>
                  <select value={line.productId} onChange={(e) => updateLine(index, { productId: e.target.value })} className={INPUT}>
                    <option value="">Select product</option>
                    {products.map((p) => <option key={p.id} value={p.id}>{p.sku} — {p.name}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase text-slate-500">Quantity</span>
                  <input type="number" min="1" value={line.quantity} onChange={(e) => updateLine(index, { quantity: e.target.value })} className={INPUT} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase text-slate-500">Unit cost</span>
                  <input type="text" inputMode="decimal" value={line.unitCost} onChange={(e) => updateLine(index, { unitCost: e.target.value })} placeholder="0.00" className={INPUT} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase text-slate-500">Expiry date</span>
                  <input type="date" value={line.expiryDate} onChange={(e) => updateLine(index, { expiryDate: e.target.value })} className={INPUT} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium uppercase text-slate-500">Lot code</span>
                  <input type="text" value={line.lotCode} onChange={(e) => updateLine(index, { lotCode: e.target.value })} placeholder="Optional" className={INPUT} />
                </label>
                {lines.length > 1 && (
                  <div className="sm:col-span-5">
                    <Button variant="ghost" size="sm" onClick={() => removeLine(index)}>Remove line</Button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <Button variant="secondary" size="sm" onClick={addLine}>Add line</Button>
            <Button variant="primary" size="sm" disabled={busy || !poSupplierId} onClick={() => void createOrder()}>
              Create purchase order
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
