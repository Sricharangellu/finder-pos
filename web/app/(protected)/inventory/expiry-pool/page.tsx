"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";

type Tab = "pool" | "upcoming";

interface UpcomingLot {
  id: string;
  product_id: string;
  name: string;
  lot_code: string | null;
  expiry_date: number;
  qty_on_hand: number;
  days_to_expiry: number;
}

interface ExpiryItem {
  id: string;
  product_id: string;
  product_name: string | null;
  lot_code: string | null;
  expiry_date: number | null;
  qty: number;
  unit_cost_cents: number;
  loss_cents: number;
  status: string;
}

// ── Upcoming expiry (near-expiry, still sellable) ─────────────────────────────
function UpcomingTab() {
  const [rows, setRows] = useState<UpcomingLot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ items: UpcomingLot[] }>("/api/v1/inventory/expiring?days=30")
      .then((r) => setRows(r.items ?? []))
      .catch((e) => setError(e instanceof ApiResponseError ? e.message : "Failed to load upcoming expiry"))
      .finally(() => setLoading(false));
  }, []);

  const dayBadge = (d: number): "red" | "yellow" | "gray" => (d <= 7 ? "red" : d <= 14 ? "yellow" : "gray");

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-[var(--erp-text-muted)]">Stock approaching expiry within 30 days — still sellable.</p>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {loading ? <TableSkeleton headers={["Product", "Lot", "Expiry", "Days left", "Qty"]} rows={6} /> : (
        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3">Expiry</th><th className="px-4 py-3">Days left</th><th className="px-4 py-3 text-right">Qty</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">Nothing expiring in the next 30 days.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-950">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.lot_code ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(r.expiry_date)}</td>
                    <td className="px-4 py-3"><Badge variant={dayBadge(r.days_to_expiry)}>{r.days_to_expiry}d</Badge></td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.qty_on_hand}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Expiry pool (written off from active, pending disposition) ────────────────
function PoolTab() {
  const [rows, setRows] = useState<ExpiryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ items: ExpiryItem[] }>("/api/v1/inventory/expiry");
      setRows(r.items ?? []);
      setError(null);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load the expiry pool");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const runSweep = useCallback(async () => {
    setBusy("sweep"); setError(null); setNotice(null);
    try {
      const r = await apiPost<{ swept: number; loss_cents: number }>("/api/v1/inventory/expiry/sweep", {});
      setNotice(r.swept > 0 ? `Swept ${r.swept} expired ${r.swept === 1 ? "item" : "items"} — ${formatMoney(r.loss_cents)} loss booked.` : "No expired stock to sweep.");
      await load();
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Sweep failed");
    } finally { setBusy(null); }
  }, [load]);

  const dispose = useCallback(async (item: ExpiryItem, kind: "discard" | "return-to-vendor") => {
    setBusy(item.id); setError(null); setNotice(null);
    try {
      await apiPost(`/api/v1/inventory/expiry/${item.id}/${kind}`, {});
      setNotice(kind === "discard" ? `Discarded ${item.product_name ?? item.product_id}.` : `Returned ${item.product_name ?? item.product_id} to vendor.`);
      setRows((rs) => rs.filter((r) => r.id !== item.id));
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Disposition failed");
    } finally { setBusy(null); }
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--erp-text-muted)]">Expired stock pulled from active inventory, pending disposition.</p>
        <Button size="sm" onClick={() => void runSweep()} disabled={busy === "sweep"}>
          {busy === "sweep" ? "Sweeping…" : "Run expiry sweep"}
        </Button>
      </div>
      {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
      {notice && <div role="status" className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</div>}
      {loading ? <TableSkeleton headers={["Product", "Lot", "Expired", "Qty", "Loss", ""]} rows={6} /> : (
        <Card noPadding>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
                <tr><th className="px-4 py-3">Product</th><th className="px-4 py-3">Lot</th><th className="px-4 py-3">Expired</th><th className="px-4 py-3 text-right">Qty</th><th className="px-4 py-3 text-right">Loss</th><th className="px-4 py-3 text-right">Disposition</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">The expiry pool is empty. Run a sweep to pull in expired stock.</td></tr>
                ) : rows.map((r) => (
                  <tr key={r.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-slate-950">{r.product_name ?? r.product_id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{r.lot_code ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(r.expiry_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{r.qty}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-red-700">{formatMoney(r.loss_cents)}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="secondary" onClick={() => void dispose(r, "return-to-vendor")} disabled={busy === r.id}>Return to vendor</Button>
                        <Button size="sm" variant="secondary" onClick={() => void dispose(r, "discard")} disabled={busy === r.id}>Discard</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default function ExpiryPoolPage() {
  const [tab, setTab] = useState<Tab>("pool");
  return (
    <EnterpriseShell active="inventory" title="Expiry" subtitle="Expired stock pool, disposition, and upcoming expiry" contentClassName="overflow-y-auto">
      <div className="mb-4 border-b border-slate-200">
        <nav className="-mb-px flex gap-6" aria-label="Expiry tabs">
          {(["pool", "upcoming"] as Tab[]).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-current={tab === id ? "page" : undefined}
              className={["whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition-colors", tab === id ? "border-slate-950 text-slate-950" : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"].join(" ")}
            >
              {id === "pool" ? "Expiry Pool" : "Upcoming Expiry"}
            </button>
          ))}
        </nav>
      </div>
      {tab === "pool" ? <PoolTab /> : <UpcomingTab />}
    </EnterpriseShell>
  );
}
