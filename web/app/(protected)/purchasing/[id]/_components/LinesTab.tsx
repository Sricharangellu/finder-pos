"use client";

import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import {
  marginColor,
  remaining,
  type POLine,
  type PurchaseOrderDetail,
  type PriceHistoryItem,
} from "./shared";

export interface PriceFilters {
  from: string;
  to: string;
  qtyBreak: string;
}

/** Cost delta vs the current invoiced price. Negative = a cheaper reference. */
function Delta({ invoiced, ref }: { invoiced: number; ref: number }) {
  const d = invoiced - ref;
  if (d === 0) return <span className="ml-1 text-xs text-slate-400">even</span>;
  const worse = d > 0; // invoiced costs more than the reference → overpaying
  return (
    <span className={`ml-1 text-xs ${worse ? "text-red-500" : "text-emerald-600"}`}>
      {worse ? "▲" : "▼"}{formatMoney(Math.abs(d))}
    </span>
  );
}

export function LinesTab({
  order,
  priceHistory,
  goodsTotal,
  filters,
  onFiltersChange,
  loading,
}: {
  order: PurchaseOrderDetail;
  priceHistory: PriceHistoryItem[];
  goodsTotal: number;
  filters: PriceFilters;
  onFiltersChange: (f: PriceFilters) => void;
  loading: boolean;
}) {
  const set = (patch: Partial<PriceFilters>) => onFiltersChange({ ...filters, ...patch });
  const hasFilters = !!(filters.from || filters.to || filters.qtyBreak);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50 text-left text-xs font-semibold uppercase text-slate-500">
          <tr>
            <th className="px-4 py-3">Product</th>
            <th className="px-4 py-3 text-right">Ordered</th>
            <th className="px-4 py-3 text-right">Received</th>
            <th className="px-4 py-3 text-right">Remaining</th>
            <th className="px-4 py-3 text-right">Unit cost</th>
            <th className="px-4 py-3 text-right">Last cost</th>
            <th className="px-4 py-3 text-right">Sell price</th>
            <th className="px-4 py-3 text-right">Margin</th>
            <th className="px-4 py-3 text-right">Line total</th>
            <th className="px-4 py-3">Lot / Expiry</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 bg-white">
          {order.lines.length === 0 ? (
            <tr><td colSpan={10} className="px-4 py-6 text-center text-slate-400">No lines on this order.</td></tr>
          ) : order.lines.map((line: POLine) => {
            const rem = remaining(line);
            const hist = priceHistory.find((h) => h.product_id === line.product_id);
            const prevCost = hist?.history?.[1]?.unit_cost_cents;
            const costDelta = prevCost != null ? line.unit_cost_cents - prevCost : null;
            const suggested = hist?.suggested_qty ?? 0;
            return (
              <tr key={line.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{line.product_name}</p>
                  <p className="font-mono text-xs text-slate-400">{line.product_sku}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {line.quantity}
                  {suggested > 0 && suggested !== line.quantity && (
                    <span
                      className="ml-1 rounded bg-brand-50 px-1 text-xs font-medium text-brand-600"
                      title="Suggested purchase qty from reorder point + sales velocity"
                    >
                      sug {suggested}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-emerald-700">{line.received_qty ?? 0}</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  <span className={rem > 0 ? "font-semibold text-amber-700" : "text-emerald-600"}>{rem}</span>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                  {formatMoney(line.unit_cost_cents)}
                  {costDelta != null && (
                    <span className={`ml-1 text-xs ${costDelta > 0 ? "text-red-500" : "text-emerald-600"}`}>
                      {costDelta > 0 ? "▲" : "▼"}{formatMoney(Math.abs(costDelta))}
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-400">
                  {line.last_cost_cents ? formatMoney(line.last_cost_cents) : "—"}
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums text-slate-600">{formatMoney(line.selling_price_cents)}</td>
                <td className={`whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold ${marginColor(line.margin_pct)}`}>{line.margin_pct}%</td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums font-semibold text-slate-950">{formatMoney(line.line_cost_cents)}</td>
                <td className="px-4 py-3 text-xs text-slate-500">
                  <p>{line.lot_code ?? "—"}</p>
                  <p>{fmtDate(line.expiry_date)}</p>
                </td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t-2 border-slate-300 bg-slate-50">
            <td colSpan={8} className="px-4 py-3 text-right text-xs font-semibold uppercase text-slate-500">Total</td>
            <td className="px-4 py-3 text-right font-bold text-slate-950">{formatMoney(goodsTotal)}</td>
            <td />
          </tr>
        </tfoot>
      </table>

      {/* ── Price intelligence ─────────────────────────────────────────── */}
      <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <p className="text-xs font-semibold uppercase text-slate-500">
            Price intelligence
            {loading && <span className="ml-2 font-normal text-slate-400">updating…</span>}
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="flex flex-col text-xs text-slate-500">
              From
              <input
                type="date"
                value={filters.from}
                onChange={(e) => set({ from: e.target.value })}
                className="mt-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              To
              <input
                type="date"
                value={filters.to}
                onChange={(e) => set({ to: e.target.value })}
                className="mt-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
              />
            </label>
            <label className="flex flex-col text-xs text-slate-500">
              Qty break ≥
              <input
                type="number"
                min={0}
                inputMode="numeric"
                value={filters.qtyBreak}
                onChange={(e) => set({ qtyBreak: e.target.value })}
                placeholder="any"
                className="mt-1 w-24 rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-900"
              />
            </label>
            {hasFilters && (
              <button
                type="button"
                onClick={() => onFiltersChange({ from: "", to: "", qtyBreak: "" })}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {priceHistory.length === 0 ? (
          <p className="text-xs text-slate-400">
            {hasFilters ? "No price history matches these filters." : "No price history yet for these products."}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {priceHistory.map((ph) => (
              <div key={ph.product_id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">{ph.product_name}</p>
                <p className="mb-2 font-mono text-xs text-slate-400">{ph.sku}</p>

                <dl className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Invoiced (this PO)</dt>
                    <dd className="font-bold tabular-nums text-slate-900">{formatMoney(ph.invoiced_cents)}</dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Last · this supplier</dt>
                    <dd className="tabular-nums text-slate-700">
                      {ph.last_from_supplier ? (
                        <>
                          {formatMoney(ph.last_from_supplier.unit_cost_cents)}
                          <Delta invoiced={ph.invoiced_cents} ref={ph.last_from_supplier.unit_cost_cents} />
                          <span className="ml-1 text-slate-400">{fmtDate(ph.last_from_supplier.received_at)}</span>
                        </>
                      ) : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between">
                    <dt className="text-slate-500">Best · all suppliers</dt>
                    <dd className="tabular-nums text-slate-700">
                      {ph.best_across_suppliers ? (
                        <>
                          {formatMoney(ph.best_across_suppliers.unit_cost_cents)}
                          <Delta invoiced={ph.invoiced_cents} ref={ph.best_across_suppliers.unit_cost_cents} />
                        </>
                      ) : "—"}
                    </dd>
                  </div>
                  {ph.best_across_suppliers?.supplier_name && (
                    <p className="text-right text-[11px] text-slate-400">
                      {ph.best_across_suppliers.supplier_name} · {fmtDate(ph.best_across_suppliers.received_at)}
                    </p>
                  )}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-1">
                    <dt className="text-slate-500">Suggested qty</dt>
                    <dd className="font-semibold tabular-nums text-brand-700">
                      {ph.suggested_qty > 0 ? ph.suggested_qty : "—"}
                    </dd>
                  </div>
                  {ph.suggested_qty > 0 && (
                    <p className="text-right text-[11px] text-slate-400">
                      stock {ph.current_stock} · {ph.velocity_per_day}/day
                    </p>
                  )}
                </dl>

                {ph.history.length > 0 && (
                  <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
                    {ph.history.map((h, i) => (
                      <div key={i} className="flex justify-between text-[11px]">
                        <span className={i === 0 ? "font-medium text-slate-600" : "text-slate-400"}>{fmtDate(h.received_at)}</span>
                        <span className={i === 0 ? "tabular-nums text-slate-600" : "tabular-nums text-slate-400"}>{formatMoney(h.unit_cost_cents)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
