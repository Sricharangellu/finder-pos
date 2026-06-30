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

export function LinesTab({
  order,
  priceHistory,
  goodsTotal,
}: {
  order: PurchaseOrderDetail;
  priceHistory: PriceHistoryItem[];
  goodsTotal: number;
}) {
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
            return (
              <tr key={line.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-900">{line.product_name}</p>
                  <p className="font-mono text-xs text-slate-400">{line.product_sku}</p>
                </td>
                <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">{line.quantity}</td>
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

      {priceHistory.length > 0 && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-4">
          <p className="mb-3 text-xs font-semibold uppercase text-slate-500">Vendor price history</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {priceHistory.map((ph) => (
              <div key={ph.product_id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">{ph.product_name}</p>
                <p className="mb-2 font-mono text-xs text-slate-400">{ph.sku}</p>
                <div className="space-y-1">
                  {ph.history.map((h, i) => (
                    <div key={i} className="flex justify-between text-xs">
                      <span className={i === 0 ? "font-semibold text-slate-900" : "text-slate-400"}>{new Date(h.received_at).toLocaleDateString()}</span>
                      <span className={i === 0 ? "font-bold tabular-nums text-slate-900" : "tabular-nums text-slate-400"}>{formatMoney(h.unit_cost_cents)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
