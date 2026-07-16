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

/** A received PO line awaiting cost confirmation (mirrors the backend
 *  CostEntryItem). */
interface CostEntryItem {
  line_id: string;
  product_id: string;
  sku: string | null;
  product_name: string;
  received_qty: number;
  po_cost_cents: number;
  supplier_name: string | null;
  received_at: number | null;
  selling_price_cents: number;
  last_purchase_cost_cents: number | null;
  prev_vendor_cost_cents: number | null;
}

/** Dollars string → integer cents, or null if blank/invalid. */
function parseCents(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const money = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? "—" : formatMoney(cents);

export default function PurchasePage() {
  const [items, setItems] = useState<CostEntryItem[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Top-bar toggle: hide the reference-price columns to declutter cost entry.
  const [showReference, setShowReference] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: CostEntryItem[] }>("/api/v1/purchasing/cost-entry");
      setItems(res.items);
      // Pre-fill each draft with the PO cost so managers confirm or adjust.
      setDrafts((prev) => {
        const next = { ...prev };
        for (const it of res.items) {
          if (next[it.line_id] === undefined) next[it.line_id] = (it.po_cost_cents / 100).toString();
        }
        return next;
      });
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load the purchase queue.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveCost = useCallback(async (item: CostEntryItem) => {
    const cents = parseCents(drafts[item.line_id] ?? "");
    if (cents === null) {
      setError(`Enter a valid cost for ${item.product_name}.`);
      return;
    }
    setSavingId(item.line_id);
    setError(null);
    setNotice(null);
    try {
      await apiPost("/api/v1/purchasing/cost-entry", { productId: item.product_id, costCents: cents });
      setNotice(`Saved cost ${formatMoney(cents)} for ${item.product_name}.`);
      // Reflect the new cost as the last-purchase-cost reference locally.
      setItems((rows) =>
        rows.map((r) => (r.product_id === item.product_id ? { ...r, last_purchase_cost_cents: cents } : r)),
      );
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to save the cost.");
    } finally {
      setSavingId(null);
    }
  }, [drafts]);

  const marginBadge = (costStr: string, sellingCents: number) => {
    const cents = parseCents(costStr);
    if (cents === null || sellingCents <= 0) return null;
    const marginPct = Math.round(((sellingCents - cents) / sellingCents) * 100);
    const variant = marginPct < 0 ? "red" : marginPct < 15 ? "yellow" : "green";
    return <Badge variant={variant}>{marginPct}%</Badge>;
  };

  return (
    <EnterpriseShell
      active="inventory"
      title="Purchase"
      subtitle="Confirm the cost of received goods before they hit inventory valuation"
      contentClassName="overflow-y-auto"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-[var(--erp-text-muted)]">
          {items.length} received {items.length === 1 ? "line" : "lines"} awaiting cost confirmation
        </p>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={showReference}
            onChange={(e) => setShowReference(e.target.checked)}
            className="h-4 w-4"
          />
          Show reference prices
        </label>
      </div>

      {error && (
        <div role="alert" className="mb-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </div>
      )}
      {notice && (
        <div role="status" className="mb-3 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {notice}
        </div>
      )}

      <Card>
        {loading ? (
          <TableSkeleton rows={6} />
        ) : items.length === 0 ? (
          <p className="py-10 text-center text-sm text-[var(--erp-text-muted)]">
            No received goods are waiting for cost confirmation. Receive a purchase order and its lines appear here.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--erp-border)] text-left text-xs uppercase text-[var(--erp-text-muted)]">
                  <th className="py-2 pr-3">Product</th>
                  <th className="py-2 pr-3">Vendor</th>
                  <th className="py-2 pr-3 text-right">Received</th>
                  {showReference && <th className="py-2 pr-3 text-right">Prev. (this vendor)</th>}
                  {showReference && <th className="py-2 pr-3 text-right">Last cost</th>}
                  {showReference && <th className="py-2 pr-3 text-right">Selling</th>}
                  <th className="py-2 pr-3 text-right">Cost</th>
                  <th className="py-2 pr-3 text-right">Margin</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.line_id} className="border-b border-[var(--erp-border)] last:border-0">
                    <td className="py-2 pr-3">
                      <div className="font-medium text-[var(--erp-text)]">{it.product_name}</div>
                      <div className="text-xs text-[var(--erp-text-muted)]">
                        {it.sku ?? it.product_id}
                        {it.received_at ? ` · ${fmtDate(it.received_at)}` : ""}
                      </div>
                    </td>
                    <td className="py-2 pr-3">{it.supplier_name ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{it.received_qty}</td>
                    {showReference && <td className="py-2 pr-3 text-right tabular-nums">{money(it.prev_vendor_cost_cents)}</td>}
                    {showReference && <td className="py-2 pr-3 text-right tabular-nums">{money(it.last_purchase_cost_cents)}</td>}
                    {showReference && <td className="py-2 pr-3 text-right tabular-nums">{money(it.selling_price_cents)}</td>}
                    <td className="py-2 pr-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <span className="text-[var(--erp-text-muted)]">$</span>
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={drafts[it.line_id] ?? ""}
                          onChange={(e) => setDrafts((d) => ({ ...d, [it.line_id]: e.target.value }))}
                          className="w-24 rounded-md border border-[var(--erp-border)] px-2 py-1 text-right tabular-nums"
                          aria-label={`Cost for ${it.product_name}`}
                        />
                      </div>
                    </td>
                    <td className="py-2 pr-3 text-right">{marginBadge(drafts[it.line_id] ?? "", it.selling_price_cents)}</td>
                    <td className="py-2 text-right">
                      <Button
                        size="sm"
                        onClick={() => void saveCost(it)}
                        disabled={savingId === it.line_id}
                      >
                        {savingId === it.line_id ? "Saving…" : "Save"}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </EnterpriseShell>
  );
}
