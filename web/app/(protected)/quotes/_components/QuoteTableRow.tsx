"use client";

import { Fragment } from "react";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";
import { QuoteDarkPanel } from "./QuoteDarkPanel";
import { avatarColor, initials, STATUS_STYLE } from "./quotesTypes";
import { SendIcon, TrashIcon } from "./quotesIcons";
import type { Quote, QuoteStatus } from "./quotesTypes";

export function QuoteTableRow({
  quote,
  isExpanded,
  canManage,
  actioning,
  onToggleExpand,
  onSend,
  onConvert,
  onDelete,
  onClosePanel,
}: {
  quote: Quote;
  isExpanded: boolean;
  canManage: boolean;
  actioning: string | null;
  onToggleExpand: () => void;
  onSend: (id: string) => void;
  onConvert: (id: string, quoteNumber: string) => void;
  onDelete: (id: string, quoteNumber: string) => void;
  onClosePanel: () => void;
}) {
  const custName = quote.customer_name ?? quote.customer_id ?? "Walk-in";
  const repName  = quote.sales_rep_name ?? "Sales Team";

  return (
    <Fragment>
      <tr
        className="border-b border-[#F5F5F5] hover:bg-[#FAFAFA] cursor-pointer"
        onClick={onToggleExpand}
      >
        {/* Chevron */}
        <td className="px-4 py-3">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
            strokeLinecap="round" strokeLinejoin="round"
            className={`text-[#999] transition-transform ${isExpanded ? "rotate-90" : ""}`} aria-hidden="true">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </td>

        {/* Quote # / date */}
        <td className="px-4 py-3">
          <p className="font-semibold text-[#5D5FEF] font-mono text-xs">{quote.quote_number}</p>
          <p className="text-xs text-[#888]">{fmtDateTime(quote.created_at)}</p>
        </td>

        {/* Customer — avatar */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
              style={{ backgroundColor: avatarColor(custName) }} aria-hidden="true">
              {initials(custName)}
            </div>
            <span className="text-sm text-[#111]">{custName}</span>
          </div>
        </td>

        {/* Served by — avatar + outlet */}
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-bold text-white"
              style={{ backgroundColor: avatarColor(repName) }} aria-hidden="true">
              {initials(repName)}
            </div>
            <div>
              <p className="text-xs font-medium text-[#111]">{repName}</p>
              <p className="text-[11px] text-[#888]">Main Outlet</p>
            </div>
          </div>
        </td>

        {/* Note */}
        <td className="px-4 py-3 text-xs text-[#888] italic max-w-[140px] truncate">
          {quote.note ?? "—"}
        </td>

        {/* Total */}
        <td className="px-4 py-3 text-right font-semibold tabular-nums text-[#111]">
          {formatMoney(quote.total_cents)}
        </td>

        {/* Status */}
        <td className="px-4 py-3">
          <span className={`inline-block rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize ${STATUS_STYLE[quote.status as QuoteStatus]}`}>
            {quote.status}
          </span>
        </td>

        {/* Send / delete action */}
        <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
          {canManage && quote.status === "draft" && (
            <button type="button" onClick={() => onSend(quote.id)} disabled={actioning === quote.id}
              aria-label="Send quote" className="text-[#aaa] hover:text-[#5D5FEF] transition-colors disabled:opacity-40">
              <SendIcon />
            </button>
          )}
          {canManage && quote.status !== "draft" && (
            <button type="button" onClick={() => onDelete(quote.id, quote.quote_number)}
              disabled={actioning === quote.id}
              aria-label="Delete quote" className="text-[#aaa] hover:text-red-500 transition-colors disabled:opacity-40">
              <TrashIcon />
            </button>
          )}
        </td>
      </tr>

      {/* Dark expand panel */}
      {isExpanded && (
        <tr key={`${quote.id}-panel`}>
          <td colSpan={8} className="p-0">
            <QuoteDarkPanel
              quoteId={quote.id}
              quoteNumber={quote.quote_number}
              status={quote.status}
              onConvert={() => onConvert(quote.id, quote.quote_number)}
              onSend={() => onSend(quote.id)}
              onClose={onClosePanel}
              converting={actioning === quote.id}
            />
          </td>
        </tr>
      )}
    </Fragment>
  );
}
