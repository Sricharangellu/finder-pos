"use client";

import { useEffect, useState } from "react";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { QuoteDetail, QuoteStatus } from "./quotesTypes";

export function QuoteDarkPanel({
  quoteId,
  quoteNumber,
  status,
  onConvert,
  onSend,
  onClose,
  converting,
}: {
  quoteId: string;
  quoteNumber: string;
  status: QuoteStatus;
  onConvert: () => void;
  onSend: () => void;
  onClose: () => void;
  converting: boolean;
}) {
  // Suppress unused — quoteNumber kept for future PDF/email use
  void quoteNumber;

  const [detail, setDetail] = useState<QuoteDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<QuoteDetail>(`/api/v1/quotes/${quoteId}`)
      .then(setDetail).catch(() => {}).finally(() => setLoading(false));
  }, [quoteId]);

  const lines    = detail?.lines ?? [];
  const subtotal = lines.reduce((s, l) => s + l.unit_cents * l.quantity, 0);
  const discount = detail?.discount_cents ?? 0;
  const total    = detail?.total_cents ?? 0;

  return (
    <div className="bg-[#2a2a2a] text-white px-6 py-5">
      <div className="mb-4 border-b border-white/10">
        <button type="button" className="pb-2 text-sm font-medium text-white border-b-2 border-[#5D5FEF]">
          Quote details
        </button>
        <button type="button" onClick={onClose}
          className="ml-auto float-right text-white/40 hover:text-white/70 text-sm pb-2">✕ Close</button>
      </div>

      <div className="flex gap-8">
        {/* Line items */}
        <div className="flex-1">
          {loading ? (
            <div className="space-y-2">{[1, 2, 3].map((i) => <div key={i} className="h-5 rounded bg-white/10 animate-pulse" />)}</div>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-white/40 uppercase">
                    <th className="pb-2">Qty</th>
                    <th className="pb-2">Product</th>
                    <th className="pb-2 text-right">Unit price</th>
                    <th className="pb-2 text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2 text-white/60">{l.quantity}</td>
                      <td className="py-2 font-medium text-white">
                        {l.name}{l.sku && <span className="ml-1.5 text-white/40 text-xs">[{l.sku}]</span>}
                      </td>
                      <td className="py-2 text-right text-white/70">{formatMoney(l.unit_cents)}</td>
                      <td className="py-2 text-right font-semibold tabular-nums">{formatMoney(l.unit_cents * l.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 border-t border-white/10 pt-3 space-y-1 text-sm">
                <div className="flex justify-between text-white/60">
                  <span>Subtotal</span><span>{formatMoney(subtotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-emerald-400 text-sm">
                    <span>Discount</span><span>−{formatMoney(discount)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-white text-base uppercase">
                  <span>Quote total</span><span>{formatMoney(total)}</span>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex flex-col gap-2 min-w-[160px]">
          {(status === "draft" || status === "sent" || status === "accepted") && (
            <button type="button" onClick={onConvert} disabled={converting}
              className="w-full rounded bg-[#5D5FEF] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#4849d0] disabled:opacity-50 transition-colors">
              {converting ? "Converting…" : "Convert to sale"}
            </button>
          )}
          {status === "draft" && (
            <button type="button" onClick={onSend}
              className="w-full rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors">
              Send to customer
            </button>
          )}
          <button type="button" className="w-full rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors">
            Download PDF
          </button>
          <button type="button" className="w-full rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors">
            Email quote
          </button>
          <button type="button" className="w-full rounded bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20 transition-colors">
            Duplicate
          </button>
        </div>
      </div>
    </div>
  );
}
