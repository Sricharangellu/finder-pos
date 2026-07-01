"use client";

import { useState, useCallback, useEffect } from "react";
import { apiGet, apiPost } from "@/api-client/client";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { formatMoney } from "@/lib/money";
import type { Deposit } from "@/api-client/types";
import { fmtDate } from "@/lib/date";

export function DepositsSection({ canManage }: { canManage: boolean }) {
  const { addToast } = useToast();
  const [deposits, setDeposits] = useState<Deposit[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ amountCents: "", note: "" });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    apiGet<{ items: Deposit[] }>("/api/v1/accounting/deposits")
      .then(r => setDeposits(r.items ?? []))
      .catch(() => setDeposits([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const cents = Math.round(parseFloat(form.amountCents || "0") * 100);
    if (cents <= 0) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/accounting/deposits", { totalCents: cents, note: form.note.trim() || undefined });
      setShowAdd(false);
      setForm({ amountCents: "", note: "" });
      load();
      addToast({ title: "Deposit created", variant: "success" });
    } catch (e) {
      addToast({ title: "Failed", description: e instanceof Error ? e.message : "Unknown error", variant: "error" });
    } finally { setBusy(false); }
  };

  const statusColor = (s: string) => {
    if (s === "completed" || s === "deposited") return "text-emerald-700";
    if (s === "pending") return "text-amber-700";
    return "text-slate-500";
  };

  return (
    <Card className="overflow-hidden p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Batch Deposits</h2>
          <p className="text-sm text-slate-500">Record cash and payment deposits to the bank.</p>
        </div>
        {canManage && !showAdd && <Button variant="primary" size="sm" onClick={() => setShowAdd(true)}>New deposit</Button>}
      </div>
      {showAdd && canManage && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-4">
          <div className="flex flex-wrap gap-3">
            <input value={form.amountCents} onChange={e => setForm(f => ({ ...f, amountCents: e.target.value }))} placeholder="Amount ($)" type="number" min="0" step="0.01" className="w-36 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Note (optional)" className="flex-1 min-w-40 rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-950" />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={parseFloat(form.amountCents || "0") <= 0} onClick={add}>Create</Button>
            </div>
          </div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-slate-500">
            <th className="px-4 py-3">Deposit #</th>
            <th className="px-4 py-3">Status</th>
            <th className="px-4 py-3">Amount</th>
            <th className="px-4 py-3">Date</th>
            <th className="px-4 py-3">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {loading && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">Loading…</td></tr>}
          {!loading && deposits.length === 0 && <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-400">No deposits yet</td></tr>}
          {deposits.map(d => (
            <tr key={d.id}>
              <td className="px-4 py-3 font-medium">{d.batch_number}</td>
              <td className={`px-4 py-3 capitalize font-medium ${statusColor(d.status)}`}>{d.status.replace(/_/g, " ")}</td>
              <td className="px-4 py-3">{formatMoney(d.total_cents)}</td>
              <td className="px-4 py-3 text-slate-500">{fmtDate(d.created_at)}</td>
              <td className="px-4 py-3 text-slate-500">{d.description ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
