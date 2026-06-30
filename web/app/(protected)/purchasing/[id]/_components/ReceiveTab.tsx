"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import {
  remaining,
  computeTotal,
  docTypeLabel,
  fmtBytes,
  type PODocument,
  type ReceiveEntry,
  type PurchaseOrderDetail,
  type POLine,
} from "./shared";

function buildEntries(lines: POLine[]): ReceiveEntry[] {
  return lines
    .filter((l) => remaining(l) > 0)
    .map((l) => ({
      lineId: l.id,
      cases: l.cases_ordered != null ? String(l.cases_ordered) : "1",
      unitsPerCase: l.units_per_case != null ? String(l.units_per_case) : String(remaining(l)),
      totalQty: remaining(l),
      expiryDate: l.expiry_date ? new Date(l.expiry_date).toISOString().slice(0, 10) : "",
      lotCode: l.lot_code ?? "",
    }));
}

export function ReceiveTab({
  orderId,
  order,
  canManage,
  onReceived,
}: {
  orderId: string;
  order: PurchaseOrderDetail;
  canManage: boolean;
  onReceived: () => void;
}) {
  const [documents, setDocuments] = useState<PODocument[]>([]);
  const [receiveEntries, setReceiveEntries] = useState<ReceiveEntry[]>(() => buildEntries(order.lines));
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveBusy, setReceiveBusy] = useState(false);
  const [receiveError, setReceiveError] = useState<string | null>(null);
  const [docName, setDocName] = useState("");
  const [docType, setDocType] = useState("invoice");
  const [docBusy, setDocBusy] = useState(false);

  const loadDocs = useCallback(async () => {
    try {
      const d = await apiGet<{ items: PODocument[] }>(`/api/v1/purchasing/orders/${orderId}/documents`);
      setDocuments(d.items ?? []);
    } catch { /* ignore */ }
  }, [orderId]);

  useEffect(() => { void loadDocs(); }, [loadDocs]);

  const updateEntry = (lineId: string, patch: Partial<ReceiveEntry>) => {
    setReceiveEntries((prev) => prev.map((e) => {
      if (e.lineId !== lineId) return e;
      const u = { ...e, ...patch };
      if ("cases" in patch || "unitsPerCase" in patch) {
        u.totalQty = computeTotal(
          "cases" in patch ? (patch.cases ?? e.cases) : e.cases,
          "unitsPerCase" in patch ? (patch.unitsPerCase ?? e.unitsPerCase) : e.unitsPerCase,
        );
      }
      return u;
    }));
  };

  const submitReceive = async () => {
    const lines = receiveEntries.filter((e) => e.totalQty > 0).map((e) => ({ lineId: e.lineId, qty: e.totalQty }));
    if (lines.length === 0) { setReceiveError("Enter quantities to receive."); return; }
    setReceiveBusy(true); setReceiveError(null);
    try {
      await apiPost(`/api/v1/purchasing/orders/${orderId}/receive`, { lines });
      setReceiveOpen(false);
      onReceived();
    } catch { setReceiveError("Could not receive stock."); }
    finally { setReceiveBusy(false); }
  };

  const uploadDoc = async () => {
    if (!docName.trim()) return;
    setDocBusy(true);
    try {
      const doc = await apiPost<PODocument>(`/api/v1/purchasing/orders/${orderId}/documents`, {
        name: docName.trim(), type: docType, size_bytes: Math.round(Math.random() * 500000 + 50000),
      });
      setDocuments((prev) => [...prev, doc]);
      setDocName("");
    } catch { /* ignore */ } finally { setDocBusy(false); }
  };

  return (
    <div className="space-y-4 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Receive incoming goods</p>
          <p className="text-xs text-slate-500">Enter cases × units per case for each line</p>
        </div>
        {canManage && order.status !== "received" && (
          <Button variant="primary" size="sm" onClick={() => setReceiveOpen(true)}>Open receive form</Button>
        )}
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase text-slate-500">Attached documents</p>
        <div className="mb-3 flex flex-wrap gap-2">
          {documents.map((doc) => (
            <div key={doc.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
              <svg aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
              <div>
                <p className="text-xs font-medium text-slate-800">{doc.name}</p>
                <p className="text-xs text-slate-400">{docTypeLabel(doc.type)} · {fmtBytes(doc.size_bytes)}</p>
              </div>
            </div>
          ))}
          {documents.length === 0 && <p className="text-xs text-slate-400">No documents attached.</p>}
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">File name</label>
            <input type="text" value={docName} onChange={(e) => setDocName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void uploadDoc(); }} placeholder="Invoice-2026.pdf"
              className="w-52 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Type</label>
            <select value={docType} onChange={(e) => setDocType(e.target.value)} className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none">
              <option value="invoice">Invoice</option>
              <option value="delivery_note">Delivery Note</option>
              <option value="excel">Excel / CSV</option>
              <option value="other">Other</option>
            </select>
          </div>
          <Button variant="secondary" size="sm" disabled={!docName.trim() || docBusy} onClick={() => void uploadDoc()}>Attach</Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Product</th>
              <th className="px-4 py-2.5 text-right">Ordered</th>
              <th className="px-4 py-2.5 text-right">Received</th>
              <th className="px-4 py-2.5 text-right">Remaining</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Lot / Expiry</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50 bg-white">
            {order.lines.map((l) => {
              const rem = remaining(l);
              const recvd = l.received_qty ?? 0;
              const status = rem === 0 ? "received" : recvd > 0 ? "partial" : "pending";
              return (
                <tr key={l.id}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900">{l.product_name}</p>
                    <p className="font-mono text-xs text-slate-400">{l.product_sku}</p>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-emerald-700">{recvd}</td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    <span className={rem > 0 ? "font-semibold text-amber-700" : "text-emerald-600"}>{rem}</span>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={status === "received" ? "green" : status === "partial" ? "yellow" : "gray"}>{status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <p>{l.lot_code ?? "—"}</p>
                    <p>{fmtDate(l.expiry_date)}</p>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Modal open={receiveOpen} onClose={() => setReceiveOpen(false)} title="Receive Stock" size="lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setReceiveOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={receiveBusy} onClick={() => void submitReceive()}>
              {receiveBusy ? "Saving…" : "Confirm receipt"}
            </Button>
          </div>
        }
      >
        {receiveError && <div className="mb-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{receiveError}</div>}
        <p className="mb-4 text-sm text-slate-500">Enter cases × units/case for each line. Total is auto-calculated.</p>
        <div className="flex flex-col gap-4">
          {order.lines.filter((l) => remaining(l) > 0).map((line) => {
            const entry = receiveEntries.find((e) => e.lineId === line.id);
            if (!entry) return null;
            const rem = remaining(line);
            return (
              <div key={line.id} className="space-y-3 rounded-xl border border-slate-200 px-4 py-3">
                <div className="flex justify-between">
                  <div>
                    <p className="font-medium text-slate-900">{line.product_name}</p>
                    <p className="font-mono text-xs text-slate-400">{line.product_sku} · remaining: {rem}</p>
                  </div>
                  <span className="text-xs text-slate-400">{formatMoney(line.unit_cost_cents)}/unit</span>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Cases</label>
                    <input type="number" min={0} value={entry.cases} onChange={(e) => updateEntry(line.id, { cases: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Units/case</label>
                    <input type="number" min={1} value={entry.unitsPerCase} onChange={(e) => updateEntry(line.id, { unitsPerCase: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-center text-sm focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Total</label>
                    <div className={`rounded-lg border px-2 py-1.5 text-center text-sm font-bold tabular-nums ${entry.totalQty > rem ? "border-red-300 bg-red-50 text-red-700" : "border-slate-200 bg-slate-50"}`}>{entry.totalQty}</div>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Expiry</label>
                    <input type="date" value={entry.expiryDate} onChange={(e) => updateEntry(line.id, { expiryDate: e.target.value })}
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-500">Lot code</label>
                    <input type="text" value={entry.lotCode} onChange={(e) => updateEntry(line.id, { lotCode: e.target.value })} placeholder="LOT-2026"
                      className="w-full rounded-lg border border-slate-300 px-2 py-1.5 font-mono text-xs focus:border-blue-500 focus:outline-none" />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Modal>
    </div>
  );
}
