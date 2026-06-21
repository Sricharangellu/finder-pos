"use client";

/**
 * TenderScreen — cash / card (EMV sim) / split payment modal.
 *
 * Calls POST /api/v1/payments on capture.
 * Change-due is calculated and displayed immediately after cash entry.
 * All money math is integer cents.
 *
 * Accessibility: modal with focus trap, ARIA labels, keyboard controls.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { apiPost } from "@/api-client/client";
import type { Order, Payment, CapturePaymentRequest, PaymentMethod } from "@/api-client/types";
import { formatMoney, parseToCents, calcChange } from "@/lib/money";
import { Button } from "@/components/Button";
import { CardReaderScreen } from "@/components/terminal/CardReaderScreen";

interface TenderScreenProps {
  order: Order;
  onSuccess: (payment: Payment) => void;
  onCancel: () => void;
  /** Whether split tender is enabled (feature flag) */
  splitEnabled?: boolean;
}

type TenderTab = "cash" | "card" | "split";

export function TenderScreen({
  order,
  onSuccess,
  onCancel,
  splitEnabled = false,
}: TenderScreenProps) {
  const [tab, setTab] = useState<TenderTab>("cash");
  const [cashInput, setCashInput] = useState("");
  const [splitCash, setSplitCash] = useState("");
  const [cardLast4, setCardLast4] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCardReader, setShowCardReader] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);
  const firstFocusRef = useRef<HTMLButtonElement>(null);

  // Focus trap — focus first element when mounted
  useEffect(() => {
    firstFocusRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel, submitting]);

  const totalCents = order.totalCents;

  // ── Cash change calculation ───────────────────────────────────────────────
  const cashCents = parseToCents(cashInput);
  const changeCents = !isNaN(cashCents) && cashCents >= totalCents
    ? calcChange(cashCents, totalCents)
    : null;

  // ── Quick-cash buttons ────────────────────────────────────────────────────
  const quickAmounts = computeQuickAmounts(totalCents);

  // ── Capture ───────────────────────────────────────────────────────────────
  const capture = useCallback(
    async (method: PaymentMethod, cashAmount?: number, cardAmount?: number, last4?: string) => {
      setSubmitting(true);
      setError(null);
      try {
        const req: CapturePaymentRequest = {
          orderId: order.id,
          method,
          cashCents: cashAmount ?? 0,
          cardCents: cardAmount ?? 0,
          cardLast4: last4 || undefined,
        };
        const payment = await apiPost<Payment>("/api/v1/payments", req);
        onSuccess(payment);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Payment failed. Please try again."
        );
      } finally {
        setSubmitting(false);
      }
    },
    [order.id, onSuccess]
  );

  const handleCashSubmit = () => {
    if (isNaN(cashCents) || cashCents < totalCents) {
      setError("Cash tendered must be at least " + formatMoney(totalCents));
      return;
    }
    void capture("cash", cashCents, 0);
  };

  const handleCardSubmit = () => {
    setShowCardReader(true);
  };

  const handleCardReaderSuccess = useCallback(() => {
    setShowCardReader(false);
    void capture("card", 0, totalCents, cardLast4 || "0000");
  }, [capture, totalCents, cardLast4]);

  const handleCardReaderCancel = useCallback(() => {
    setShowCardReader(false);
  }, []);

  const handleSplitSubmit = () => {
    const cash = parseToCents(splitCash);
    if (isNaN(cash) || cash <= 0) {
      setError("Enter a valid cash amount");
      return;
    }
    const card = totalCents - cash;
    if (card < 0) {
      setError("Cash amount exceeds total");
      return;
    }
    void capture("split", cash, card, cardLast4 || "0000");
  };

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="tender-title"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={!submitting ? onCancel : undefined}
        aria-hidden="true"
      />

      {/* Modal */}
      <div className={clsx(
        "relative flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:rounded-lg",
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 id="tender-title" className="text-lg font-bold text-gray-900">
              Tender Payment
            </h2>
            <p className="text-sm text-gray-500">
              Total due:{" "}
              <span className="font-semibold text-gray-900">{formatMoney(totalCents)}</span>
            </p>
          </div>
          <button
            type="button"
            ref={firstFocusRef}
            onClick={onCancel}
            disabled={submitting}
            aria-label="Close tender screen"
            className={clsx(
              "flex h-10 w-10 items-center justify-center rounded text-gray-400",
              "hover:bg-gray-100 hover:text-gray-600 transition-colors",
              "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
              "min-h-[44px] min-w-[44px]"
            )}
          >
            <CloseIcon />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-6 mt-4 rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {/* Tabs */}
        <div
          role="tablist"
          aria-label="Payment method"
          className="flex border-b border-gray-200 px-6 pt-4"
        >
          <TabButton active={tab === "cash"} id="tender-tab-cash" panelId="tender-panel-cash" onClick={() => setTab("cash")} label="Cash" icon={<CashIcon />} />
          <TabButton active={tab === "card"} id="tender-tab-card" panelId="tender-panel-card" onClick={() => setTab("card")} label="Card" icon={<CardIcon />} />
          {splitEnabled && (
            <TabButton active={tab === "split"} id="tender-tab-split" panelId="tender-panel-split" onClick={() => setTab("split")} label="Split" icon={<SplitIcon />} />
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "cash" && (
            <div id="tender-panel-cash" role="tabpanel" aria-labelledby="tender-tab-cash">
              <CashTab
                totalCents={totalCents}
                cashInput={cashInput}
                onCashChange={(v) => { setCashInput(v); setError(null); }}
                changeCents={changeCents}
                quickAmounts={quickAmounts}
                onQuickAmount={(v) => { setCashInput(formatCentsInput(v)); setError(null); }}
              />
            </div>
          )}

          {tab === "card" && (
            <div id="tender-panel-card" role="tabpanel" aria-labelledby="tender-tab-card">
              <CardTab
                totalCents={totalCents}
                cardLast4={cardLast4}
                onLast4Change={setCardLast4}
              />
            </div>
          )}

          {tab === "split" && (
            <div id="tender-panel-split" role="tabpanel" aria-labelledby="tender-tab-split">
              <SplitTab
                totalCents={totalCents}
                splitCash={splitCash}
                onSplitCashChange={(v) => { setSplitCash(v); setError(null); }}
                cardLast4={cardLast4}
                onLast4Change={setCardLast4}
              />
            </div>
          )}
        </div>

        {/* Action button */}
        <div className="flex-none px-6 pb-6 pt-2 border-t border-gray-100">
          {tab === "cash" && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting || isNaN(cashCents) || cashCents < totalCents}
              onClick={handleCashSubmit}
              aria-label={changeCents !== null ? `Collect cash — change ${formatMoney(changeCents)}` : "Collect cash"}
            >
              {changeCents !== null && changeCents > 0
                ? `Collect — Change: ${formatMoney(changeCents)}`
                : "Collect Cash"}
            </Button>
          )}

          {tab === "card" && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting}
              onClick={handleCardSubmit}
            >
              Charge {formatMoney(totalCents)} to Card
            </Button>
          )}

          {tab === "split" && (
            <Button
              variant="primary"
              size="lg"
              fullWidth
              loading={submitting}
              disabled={submitting || !splitCash}
              onClick={handleSplitSubmit}
            >
              Charge Split
            </Button>
          )}
        </div>
      </div>

      {showCardReader && (
        <CardReaderScreen
          amountCents={totalCents}
          onSuccess={handleCardReaderSuccess}
          onCancel={handleCardReaderCancel}
        />
      )}
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabButton({
  active,
  onClick,
  label,
  icon,
  id,
  panelId,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  id: string;
  panelId: string;
}) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      aria-controls={panelId}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={clsx(
        "flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
        "min-h-[44px]",
        active
          ? "border-brand-600 text-brand-700"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  );
}

// ─── Cash tab ─────────────────────────────────────────────────────────────────

function CashTab({
  totalCents,
  cashInput,
  onCashChange,
  changeCents,
  quickAmounts,
  onQuickAmount,
}: {
  totalCents: number;
  cashInput: string;
  onCashChange: (v: string) => void;
  changeCents: number | null;
  quickAmounts: number[];
  onQuickAmount: (cents: number) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="cash-amount" className="block text-sm font-medium text-gray-700 mb-1.5">
          Cash tendered
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3.5 flex items-center text-gray-500 font-medium pointer-events-none">
            $
          </span>
          <input
            id="cash-amount"
            ref={inputRef}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={cashInput}
            onChange={(e) => onCashChange(e.target.value)}
            placeholder={(totalCents / 100).toFixed(2)}
          className={clsx(
            "w-full rounded-lg border border-gray-300 py-3 pl-8 pr-4 text-xl font-semibold",
              "focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600",
              "min-h-[56px]"
            )}
            aria-label="Cash tendered amount"
          />
        </div>
      </div>

      {/* Quick amounts */}
      <div>
        <p className="text-xs text-gray-400 mb-2">Quick amounts</p>
        <div className="grid grid-cols-4 gap-2">
          {quickAmounts.map((cents) => (
            <button
              key={cents}
              type="button"
              onClick={() => onQuickAmount(cents)}
              className={clsx(
                "rounded-lg border bg-gray-50 py-2 text-sm font-semibold text-gray-700",
                "hover:bg-brand-50 hover:border-brand-300 hover:text-brand-700 transition-colors",
                "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
                "min-h-[44px]"
              )}
            >
              {formatMoney(cents)}
            </button>
          ))}
        </div>
      </div>

      {/* Change due */}
      {changeCents !== null && (
        <div
          aria-live="polite"
          aria-atomic="true"
          className={clsx(
            "rounded-xl p-4 text-center",
            changeCents > 0 ? "bg-success-50 border border-success-200" : "bg-brand-50 border border-brand-200"
          )}
        >
          {changeCents > 0 ? (
            <>
              <p className="text-sm text-success-600 font-medium">Change due</p>
              <p className="text-3xl font-bold text-success-700 mt-1">
                {formatMoney(changeCents)}
              </p>
            </>
          ) : (
            <p className="text-sm font-medium text-brand-600">Exact amount — no change</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Card tab ─────────────────────────────────────────────────────────────────

function CardTab({
  totalCents,
  cardLast4,
  onLast4Change,
}: {
  totalCents: number;
  cardLast4: string;
  onLast4Change: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      {/* EMV sim visual */}
      <div className="flex aspect-[1.6/1] flex-col justify-between rounded-lg bg-slate-900 p-5 text-white shadow-lg">
        <div className="flex justify-between items-start">
          <div className="flex gap-1">
            <div className="w-8 h-6 rounded-sm bg-yellow-300/80" />
            <div className="w-5 h-6 rounded-sm bg-yellow-400/40 -ml-3" />
          </div>
          <span className="text-xs opacity-60">VISA</span>
        </div>
        <div>
          <p className="text-sm opacity-60 mb-1">Total to charge</p>
          <p className="text-2xl font-bold">{formatMoney(totalCents)}</p>
          <p className="text-sm opacity-60 mt-2">
            •••• •••• •••• {cardLast4 || "____"}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="card-last4" className="block text-sm font-medium text-gray-700 mb-1.5">
          Card last 4 digits <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="card-last4"
          type="text"
          inputMode="numeric"
          maxLength={4}
          pattern="\d{4}"
          value={cardLast4}
          onChange={(e) => onLast4Change(e.target.value.replace(/\D/g, ""))}
          placeholder="1234"
          className={clsx(
            "w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-lg",
            "focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600",
            "min-h-[56px]"
          )}
          aria-label="Card last 4 digits"
        />
      </div>

      <p className="text-center text-xs text-gray-400">
        Tap "Charge" to simulate EMV capture — no real card data is processed.
      </p>
    </div>
  );
}

// ─── Split tab ────────────────────────────────────────────────────────────────

function SplitTab({
  totalCents,
  splitCash,
  onSplitCashChange,
  cardLast4,
  onLast4Change,
}: {
  totalCents: number;
  splitCash: string;
  onSplitCashChange: (v: string) => void;
  cardLast4: string;
  onLast4Change: (v: string) => void;
}) {
  const cashCents = parseToCents(splitCash);
  const cardCents = !isNaN(cashCents) ? totalCents - cashCents : null;

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Enter the cash portion; the remainder will be charged to the card.
      </p>

      <div>
        <label htmlFor="split-cash" className="block text-sm font-medium text-gray-700 mb-1.5">
          Cash portion
        </label>
        <div className="relative">
          <span className="absolute inset-y-0 left-3.5 flex items-center text-gray-500 font-medium pointer-events-none">
            $
          </span>
          <input
            id="split-cash"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={splitCash}
            onChange={(e) => onSplitCashChange(e.target.value)}
            placeholder="0.00"
            className={clsx(
              "w-full rounded-lg border border-gray-300 py-3 pl-8 pr-4 text-xl font-semibold",
              "focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600",
              "min-h-[56px]"
            )}
          />
        </div>
      </div>

      {cardCents !== null && cardCents >= 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Cash</span>
            <span className="font-semibold">{formatMoney(cashCents)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">Card</span>
            <span className="font-semibold">{formatMoney(cardCents)}</span>
          </div>
          <div className="flex justify-between text-sm border-t border-gray-200 pt-2 mt-2">
            <span className="text-gray-900 font-medium">Total</span>
            <span className="font-bold text-brand-700">{formatMoney(totalCents)}</span>
          </div>
        </div>
      )}

      <div>
        <label htmlFor="split-card-last4" className="block text-sm font-medium text-gray-700 mb-1.5">
          Card last 4 <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          id="split-card-last4"
          type="text"
          inputMode="numeric"
          maxLength={4}
          value={cardLast4}
          onChange={(e) => onLast4Change(e.target.value.replace(/\D/g, ""))}
          placeholder="1234"
          className={clsx(
            "w-full rounded-lg border border-gray-300 px-4 py-3 font-mono text-lg",
            "focus:outline-none focus:ring-2 focus:ring-brand-600 focus:border-brand-600",
            "min-h-[56px]"
          )}
        />
      </div>
    </div>
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate 4 round-up quick-cash amounts above the total */
function computeQuickAmounts(totalCents: number): number[] {
  const buckets = [500, 1000, 2000, 5000, 10000, 20000, 50000, 100000];
  const above = buckets.filter((b) => b >= totalCents);
  // Also include exact amount
  const result = new Set([totalCents, ...above.slice(0, 3)]);
  return Array.from(result).sort((a, b) => a - b).slice(0, 4);
}

function formatCentsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

function CloseIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2" />
      <path d="M6 10v4" />
      <path d="M18 10v4" />
    </svg>
  );
}

function CardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function SplitIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3v6a6 6 0 0 0 6 6h6" />
      <path d="M18 11l4 4-4 4" />
      <path d="M6 21v-6a6 6 0 0 1 2.1-4.57" />
    </svg>
  );
}
