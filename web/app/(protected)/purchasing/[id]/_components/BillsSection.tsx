"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { apiGet, apiPost } from "@/api-client/client";
import { formatMoney, parseToCents } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import {
  BILL_FLAG_LABELS,
  type BillDetail,
  type BillSummary,
  type PODocument,
  type PurchaseOrderDetail,
} from "./shared";

/** Draft invoice-line entry, prefilled from the PO's own lines. */
interface DraftLine {
  lineId: string;
  productId: string;
  productName: string;
  orderedQty: number;
  receivedQty: number;
  invoicedQty: string;
  invoicedUnitCost: string; // dollars
}

function StatusBadge({ status }: { status: BillDetail["status"] }) {
  const styles: Record<string, string> = {
    draft: "bg-slate-100 text-slate-600",
    approved: "bg-emerald-50 text-emerald-700",
    held: "bg-amber-50 text-amber-700",
    posted: "bg-brand-50 text-brand-700",
  };
  return <span className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${styles[status] ?? ""}`}>{status}</span>;
}

export function BillsSection({
  order,
  canManage,
  documents,
}: {
  order: PurchaseOrderDetail;
  canManage: boolean;
  documents: PODocument[];
}) {
  const orderId = order.id;
  const [bills, setBills] = useState<BillSummary[]>([]);
  const [selected, setSelected] = useState<BillDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Create-form state
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState("");
  const [tax, setTax] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  const loadBills = useCallback(async () => {
    try {
      const r = await apiGet<{ items: BillSummary[] }>(`/api/v1/purchasing/orders/${orderId}/bills`);
      setBills(r.items ?? []);
    } catch { /* non-fatal */ }
  }, [orderId]);

  useEffect(() => { void loadBills(); }, [loadBills]);

  const openCreate = () => {
    setDraftLines(order.lines.map((l) => ({
      lineId: l.id,
      productId: l.product_id,
      productName: l.product_name,
      orderedQty: l.quantity,
      receivedQty: l.received_qty ?? 0,
      invoicedQty: String(l.received_qty ?? 0),      // default: bill what was received
      invoicedUnitCost: (l.unit_cost_cents / 100).toFixed(2), // default: PO price
    })));
    setInvoiceNumber(""); setInvoiceDate(""); setTax(""); setDocumentId("");
    setError(null);
    setCreating(true);
  };

  const patchLine = (i: number, patch: Partial<DraftLine>) =>
    setDraftLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  const openBill = async (id: string) => {
    setError(null);
    try {
      setSelected(await apiGet<BillDetail>(`/api/v1/purchasing/bills/${id}`));
    } catch { setError("Could not load bill."); }
  };

  const submitBill = async () => {
    if (!invoiceNumber.trim()) { setError("Invoice number is required."); return; }
    setBusy(true); setError(null);
    try {
      const bill = await apiPost<BillDetail>(`/api/v1/purchasing/orders/${orderId}/bills`, {
        invoiceNumber: invoiceNumber.trim(),
        invoiceDate: invoiceDate ? new Date(invoiceDate).getTime() : null,
        documentId: documentId || null,
        taxCents: tax ? parseToCents(tax) : 0,
        lines: draftLines.map((l) => ({
          lineId: l.lineId,
          productId: l.productId,
          productName: l.productName,
          invoicedQty: parseInt(l.invoicedQty || "0", 10),
          invoicedUnitCostCents: parseToCents(l.invoicedUnitCost || "0"),
        })),
      });
      setCreating(false);
      setSelected(bill);
      await loadBills();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create bill.");
    } finally { setBusy(false); }
  };

  const setStatus = async (status: "approved" | "held") => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      setSelected(await apiPost<BillDetail>(`/api/v1/purchasing/bills/${selected.id}/status`, { status }));
      await loadBills();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update bill."); }
    finally { setBusy(false); }
  };

  const post = async () => {
    if (!selected) return;
    setBusy(true); setError(null);
    try {
      setSelected(await apiPost<BillDetail>(`/api/v1/purchasing/bills/${selected.id}/post`, {}));
      await loadBills();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not post bill."); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-xs font-semibold uppercase text-slate-500">Bills · 3-way match</p>
        {canManage && !creating && (
          <Button variant="secondary" size="sm" onClick={openCreate}>New bill</Button>
        )}
      </div>

      {error && <p role="alert" className="mb-2 text-xs text-red-600">{error}</p>}

      {/* Existing bills */}
      {bills.length > 0 && !creating && (
        <div className="mb-4 space-y-2">
          {bills.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => void openBill(b.id)}
              className={`flex w-full items-center justify-between rounded-lg border px-4 py-2.5 text-left transition-colors ${
                selected?.id === b.id ? "border-brand-400 bg-brand-50" : "border-slate-200 hover:bg-slate-50"
              }`}
            >
              <div>
                <p className="text-sm font-medium text-slate-900">{b.invoice_number}</p>
                <p className="text-xs text-slate-400">{fmtDate(b.invoice_date ?? b.created_at)}</p>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMoney(b.total_cents)}</span>
                <StatusBadge status={b.status} />
              </div>
            </button>
          ))}
        </div>
      )}

      {bills.length === 0 && !creating && (
        <p className="mb-2 text-xs text-slate-400">No bills entered yet. Enter a supplier invoice to validate it against this PO.</p>
      )}

      {/* Create form */}
      {creating && (
        <div className="mb-4 rounded-xl border border-slate-200 p-4">
          <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-4">
            <label className="flex flex-col text-xs text-slate-500">
              Invoice #
              <input value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900" placeholder="INV-1001" />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Invoice date
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900" />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Tax ($)
              <input inputMode="decimal" value={tax} onChange={(e) => setTax(e.target.value)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900" placeholder="0.00" />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Invoice PDF
              <select value={documentId} onChange={(e) => setDocumentId(e.target.value)}
                className="mt-1 rounded border border-slate-300 px-2 py-1 text-sm text-slate-900">
                <option value="">— none —</option>
                {documents.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </label>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs font-semibold uppercase text-slate-400">
                <tr>
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 px-3 text-right">Ordered</th>
                  <th className="py-2 px-3 text-right">Received</th>
                  <th className="py-2 px-3 text-right">Invoiced qty</th>
                  <th className="py-2 px-3 text-right">Invoiced unit $</th>
                </tr>
              </thead>
              <tbody>
                {draftLines.map((l, i) => (
                  <tr key={l.lineId} className="border-t border-slate-100">
                    <td className="py-2 pr-3 text-slate-900">{l.productName}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-500">{l.orderedQty}</td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-500">{l.receivedQty}</td>
                    <td className="py-2 px-3 text-right">
                      <input type="number" min={0} value={l.invoicedQty}
                        onChange={(e) => patchLine(i, { invoicedQty: e.target.value })}
                        className="w-20 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums" />
                    </td>
                    <td className="py-2 px-3 text-right">
                      <input inputMode="decimal" value={l.invoicedUnitCost}
                        onChange={(e) => patchLine(i, { invoicedUnitCost: e.target.value })}
                        className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setCreating(false)} disabled={busy}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void submitBill()} loading={busy} disabled={busy}>
              Create &amp; match
            </Button>
          </div>
        </div>
      )}

      {/* 3-way match result */}
      {selected && !creating && <MatchPanel bill={selected} canManage={canManage} busy={busy} onApprove={() => void setStatus("approved")} onHold={() => void setStatus("held")} onPost={() => void post()} />}
    </div>
  );
}

function MatchPanel({
  bill, canManage, busy, onApprove, onHold, onPost,
}: {
  bill: BillDetail; canManage: boolean; busy: boolean;
  onApprove: () => void; onHold: () => void; onPost: () => void;
}) {
  const m = bill.match;
  const variance = m.match_status === "variance";
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <p className="text-sm font-semibold text-slate-900">{bill.invoice_number}</p>
          <StatusBadge status={bill.status} />
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${variance ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}>
          {variance ? "Variance — review" : "Matched"}
        </span>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs font-semibold uppercase text-slate-400">
            <tr>
              <th className="py-2 pr-3">Product</th>
              <th className="py-2 px-3 text-right">Ord</th>
              <th className="py-2 px-3 text-right">Rec</th>
              <th className="py-2 px-3 text-right">Inv</th>
              <th className="py-2 px-3 text-right">PO $</th>
              <th className="py-2 px-3 text-right">Inv $</th>
              <th className="py-2 px-3 text-right">Variance</th>
              <th className="py-2 pl-3">Flags</th>
            </tr>
          </thead>
          <tbody>
            {m.lines.map((l, i) => (
              <tr key={l.line_id ?? `x${i}`} className={`border-t border-slate-100 ${l.matched ? "" : "bg-red-50/40"}`}>
                <td className="py-2 pr-3 text-slate-900">{l.product_name}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-500">{l.ordered_qty}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-500">{l.received_qty}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-900">{l.invoiced_qty}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-500">{formatMoney(l.po_unit_cost_cents)}</td>
                <td className="py-2 px-3 text-right tabular-nums text-slate-900">{formatMoney(l.invoiced_unit_cost_cents)}</td>
                <td className={`py-2 px-3 text-right tabular-nums ${l.variance_cents === 0 ? "text-slate-400" : l.variance_cents > 0 ? "text-red-600" : "text-emerald-600"}`}>
                  {l.variance_cents === 0 ? "—" : `${l.variance_cents > 0 ? "+" : "−"}${formatMoney(Math.abs(l.variance_cents))}`}
                </td>
                <td className="py-2 pl-3">
                  <div className="flex flex-wrap gap-1">
                    {l.flags.map((f) => (
                      <span key={f} className="rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-medium text-red-700">
                        {BILL_FLAG_LABELS[f] ?? f}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-slate-300">
              <td colSpan={6} className="py-2 pr-3 text-right text-xs font-semibold uppercase text-slate-500">
                Expected {formatMoney(m.expected_cents)} · Invoiced {formatMoney(bill.total_cents)}
                {bill.tax_cents > 0 && ` (incl. tax ${formatMoney(bill.tax_cents)})`}
              </td>
              <td className={`py-2 px-3 text-right font-bold tabular-nums ${m.total_variance_cents === 0 ? "text-slate-500" : "text-red-600"}`}>
                {m.total_variance_cents === 0 ? "—" : `${m.total_variance_cents > 0 ? "+" : "−"}${formatMoney(Math.abs(m.total_variance_cents))}`}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Approve / hold / post gate */}
      {canManage && bill.status !== "posted" && (
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {variance && (
            <p className="mr-auto text-xs text-amber-700">Variances above — approve to override, or hold for follow-up.</p>
          )}
          <Button variant="ghost" size="sm" onClick={onHold} disabled={busy || bill.status === "held"}>Hold</Button>
          <Button variant="secondary" size="sm" onClick={onApprove} disabled={busy || bill.status === "approved"}>Approve</Button>
          <Button variant="primary" size="sm" onClick={onPost} disabled={busy || bill.status !== "approved"}
            title={bill.status !== "approved" ? "Approve the bill before posting" : undefined}>
            Post bill
          </Button>
        </div>
      )}
      {bill.status === "posted" && (
        <p className="mt-4 text-right text-xs font-medium text-brand-700">Posted {fmtDate(bill.updated_at)}</p>
      )}
    </div>
  );
}
