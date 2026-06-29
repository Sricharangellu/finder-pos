"use client";

/**
 * FE-31: Customer-facing receipt / display page — /display
 *
 * Designed to run on a second screen (customer pole display or tablet).
 * Receives cart state from the POS terminal via BroadcastChannel and shows:
 * • Cart line items (product name, qty, price)
 * • Subtotal, discount, tax, total
 * • Waiting / idle state when no sale is active
 *
 * Usage: Open /display in a second browser window.
 * The terminal page broadcasts cart updates via the "finder-pos-display" channel.
 */

import { useEffect, useState } from "react";
import { formatMoney } from "@/lib/money";
import { DISPLAY_CHANNEL } from "@/lib/displayChannel";

interface CartLine {
  id: string;
  name: string;
  quantity: number;
  unitCents: number;
  lineCents: number;
}

interface DisplayMessage {
  type: "cart_update" | "sale_complete" | "idle";
  lines?: CartLine[];
  subtotalCents?: number;
  discountCents?: number;
  taxCents?: number;
  totalCents?: number;
  storeName?: string;
  thankYouMessage?: string;
}

const IDLE_LOGO = (
  <div className="flex flex-col items-center gap-4">
    <div className="flex h-24 w-24 items-center justify-center rounded-2xl bg-brand-600 text-white">
      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
        <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
      </svg>
    </div>
    <p className="text-2xl font-semibold text-white/60">Welcome</p>
    <p className="text-sm text-white/40">Your items will appear here</p>
  </div>
);

export default function CustomerDisplayPage() {
  const [state, setState] = useState<DisplayMessage>({ type: "idle" });

  useEffect(() => {
    if (typeof window === "undefined" || !("BroadcastChannel" in window)) return;
    const channel = new BroadcastChannel(DISPLAY_CHANNEL);
    channel.onmessage = (e: MessageEvent<DisplayMessage>) => {
      setState(e.data);
      // Auto-return to idle 6 seconds after sale completes
      if (e.data.type === "sale_complete") {
        setTimeout(() => setState({ type: "idle" }), 6_000);
      }
    };
    return () => channel.close();
  }, []);

  return (
    <div className="flex min-h-screen flex-col bg-[#030B25] text-white">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/10 px-8 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
              <path d="M3 6h18M16 10a4 4 0 0 1-8 0" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-white/70">Finder POS</span>
        </div>
        <span className="text-xs text-white/30">Customer Display</span>
      </div>

      {/* Main content */}
      <div className="flex flex-1 flex-col items-center justify-center px-8 py-10">
        {state.type === "idle" && IDLE_LOGO}

        {state.type === "sale_complete" && (
          <div className="flex flex-col items-center gap-6 text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-success-500">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20 6 9 17l-5-5" />
              </svg>
            </div>
            <p className="text-4xl font-bold text-white">Thank you!</p>
            {state.totalCents !== undefined && (
              <p className="text-xl text-white/70">
                Total paid: <span className="font-semibold text-white">{formatMoney(state.totalCents)}</span>
              </p>
            )}
            {state.thankYouMessage && (
              <p className="text-sm text-white/50">{state.thankYouMessage}</p>
            )}
          </div>
        )}

        {state.type === "cart_update" && (
          <div className="w-full max-w-lg">
            {/* Line items */}
            <div className="mb-6 space-y-3">
              {(state.lines ?? []).map((line) => (
                <div key={line.id} className="flex items-center justify-between rounded-xl bg-white/5 px-5 py-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600/30 text-sm font-bold text-brand-400">
                      {line.quantity}×
                    </div>
                    <span className="text-base font-medium text-white">{line.name}</span>
                  </div>
                  <span className="text-base font-semibold tabular-nums text-white">
                    {formatMoney(line.lineCents)}
                  </span>
                </div>
              ))}
              {(state.lines ?? []).length === 0 && (
                <p className="py-8 text-center text-sm text-white/30">Cart is empty</p>
              )}
            </div>

            {/* Totals */}
            <div className="rounded-2xl bg-white/8 border border-white/10 px-6 py-5 space-y-3">
              <div className="flex items-center justify-between text-sm text-white/60">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatMoney(state.subtotalCents ?? 0)}</span>
              </div>
              {(state.discountCents ?? 0) > 0 && (
                <div className="flex items-center justify-between text-sm text-success-400">
                  <span>Discount</span>
                  <span className="tabular-nums">-{formatMoney(state.discountCents ?? 0)}</span>
                </div>
              )}
              <div className="flex items-center justify-between text-sm text-white/60">
                <span>Tax</span>
                <span className="tabular-nums">{formatMoney(state.taxCents ?? 0)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-white/10 pt-3 text-xl font-bold text-white">
                <span>Total</span>
                <span className="tabular-nums">{formatMoney(state.totalCents ?? 0)}</span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
