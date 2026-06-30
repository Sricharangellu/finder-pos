"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import { formatMoney, parseToCents } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { VendorCredit, PurchaseOrderDetail } from "./shared";

export function CreditsTab({
  orderId,
  order,
  canManage,
}: {
  orderId: string;
  order: PurchaseOrderDetail;
  canManage: boolean;
}) {
  const [credits, setCredits] = useState<VendorCredit[]>([]);
  const [creditOpen, setCreditOpen] = useState(false);
  const [creditType, setCreditType] = useState<"chargeback" | "credit_memo">("credit_memo");
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");
  const [creditSource, setCreditSource] = useState<"manual" | "expired" | "damaged">("manual");
  const [expiredLots, setExpiredLots] = useState<{ id: string; name: string; lot_code: string | null; qty_on_hand: number }[]>([]);
  const [expiredLotsLoading, setExpiredLotsLoading] = useState(false);
  const [creditBusy, setCreditBusy] = useState(false);
  const [creditError, setCreditError] = useState<string | null>(null);

  const loadCredits = useCallback(async () => {
    try {
      const vc = await apiGet<{ items: VendorCredit[] }>(`/api/v1/purchasing/vendor-credits?poId=${orderId}`);
      setCredits(vc.items ?? []);
    } catch { /* ignore */ }
  }, [orderId]);

  useEffect(() => { void loadCredits(); }, [loadCredits]);

  const openCreditModal = async (type: "chargeback" | "credit_memo") => {
    setCreditType(type);
    setCreditSource("manual");
    setCreditAmount("");
    setCreditReason("");
    setCreditError(null);
    setCreditOpen(true);
    if (type === "credit_memo" && expiredLots.length === 0) {
      setExpiredLotsLoading(true);
      try {
        const res = await apiGet<{ items: { id: string; name: string; lot_code: string | null; qty_on_hand: number }[] }>("/api/v1/inventory/expired");
        setExpiredLots(res.items ?? []);
      } catch { /* ignore */ } finally { setExpiredLotsLoading(false); }
    }
  };

  const submitCredit = async () => {
    if (!creditAmount || !creditReason.trim()) { setCreditError("Amount and reason are required."); return; }
    const amountCents = parseToCents(creditAmount);
    if (isNaN(amountCents) || amountCents <= 0) { setCreditError("Enter a positive dollar amount."); return; }
    setCreditBusy(true); setCreditError(null);
    try {
      const vc = await apiPost<VendorCredit>("/api/v1/purchasing/vendor-credits", {
        supplierId: order.supplier_id,
        type: creditType,
        amountCents,
        reason: creditReason.trim(),
        poId: orderId,
      });
      setCredits((prev) => [...prev, vc]);
      setCreditOpen(false);
    } catch (e) {
      setCreditError(e instanceof ApiResponseError ? e.message : "Failed to create credit.");
    } finally { setCreditBusy(false); }
  };

  const voidCredit = async (creditId: string) => {
    try {
      await apiPost(`/api/v1/purchasing/vendor-credits/${creditId}/void`, {});
      setCredits((prev) => prev.map((c) => c.id === creditId ? { ...c, status: "void" } : c));
    } catch { /* ignore */ }
  };

  const openTotal = credits.filter((c) => c.status === "open").reduce((s, c) => s + c.amount_cents, 0);

  return (
    <div className="space-y-5 p-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Vendor credits for this PO</p>
          <p className="text-xs text-slate-500">Chargebacks reduce what you owe; credit memos come from vendor-initiated adjustments.</p>
        </div>
        {canManage && (
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => void openCreditModal("chargeback")}>Chargeback</Button>
            <Button variant="primary" size="sm" onClick={() => void openCreditModal("credit_memo")}>Credit memo</Button>
          </div>
        )}
      </div>

      {credits.length === 0 ? (
        <p className="text-sm text-slate-400">No credits for this PO yet.</p>
      ) : (
        <div className="overflow-hidden divide-y divide-slate-100 rounded-xl border border-slate-200">
          {credits.map((vc) => (
            <div key={vc.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="flex items-center gap-3">
                <Badge variant={vc.type === "chargeback" ? "yellow" : "blue"}>
                  {vc.type === "chargeback" ? "Chargeback" : "Credit memo"}
                </Badge>
                <div>
                  <p className="text-sm font-medium text-slate-900">{vc.reason ?? "—"}</p>
                  <p className="text-xs text-slate-400">{fmtDate(vc.created_at)}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="text-sm font-bold tabular-nums text-emerald-700">−{formatMoney(vc.amount_cents)}</span>
                <Badge variant={vc.status === "open" ? "green" : vc.status === "void" ? "gray" : "blue"}>{vc.status}</Badge>
                {canManage && vc.status === "open" && (
                  <button type="button" onClick={() => void voidCredit(vc.id)} className="text-xs text-red-500 hover:text-red-700">Void</button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {credits.length > 0 && (
        <div className="flex justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm">
          <span className="font-semibold text-emerald-800">Total credits (open)</span>
          <span className="font-bold tabular-nums text-emerald-800">−{formatMoney(openTotal)}</span>
        </div>
      )}

      <Modal open={creditOpen} onClose={() => setCreditOpen(false)} title={creditType === "chargeback" ? "Create Chargeback" : "Create Credit Memo"} size="md"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreditOpen(false)}>Cancel</Button>
            <Button variant="primary" size="sm" disabled={creditBusy} onClick={() => void submitCredit()}>Create</Button>
          </div>
        }
      >
        {creditError && <p className="mb-3 rounded bg-red-50 px-3 py-2 text-sm text-red-600">{creditError}</p>}
        <div className="space-y-4">
          {creditType === "credit_memo" && (
            <div>
              <label className="mb-2 block text-xs font-medium text-slate-500">Source of credit</label>
              <div className="flex gap-2">
                {(["manual", "expired", "damaged"] as const).map((s) => (
                  <button key={s} type="button" onClick={() => setCreditSource(s)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${creditSource === s ? "bg-blue-600 text-white" : "border border-slate-300 text-slate-600 hover:border-blue-300"}`}>
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
              </div>
              {creditSource === "expired" && (
                <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                  {expiredLotsLoading
                    ? <p className="text-xs text-amber-600">Loading expired lots…</p>
                    : expiredLots.length === 0
                    ? <p className="text-xs text-amber-600">No expired lots on hand.</p>
                    : (
                      <div className="space-y-1.5">
                        {expiredLots.map((lot) => (
                          <div key={lot.id} className="flex justify-between text-xs">
                            <span className="text-amber-900">{lot.name} — {lot.lot_code ?? "no lot"}</span>
                            <span className="font-semibold text-amber-800">{lot.qty_on_hand} units expired</span>
                          </div>
                        ))}
                      </div>
                    )
                  }
                </div>
              )}
            </div>
          )}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Amount ($)</label>
            <input type="text" value={creditAmount} onChange={(e) => setCreditAmount(e.target.value)} placeholder="0.00"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-500">Reason</label>
            <input type="text" value={creditReason} onChange={(e) => setCreditReason(e.target.value)} placeholder="Reason for credit"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none" />
          </div>
        </div>
      </Modal>
    </div>
  );
}
