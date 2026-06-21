"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";

interface CardReaderSuccessPayload {
  id: string;
  amount: number;
  method: "card";
  status: "completed";
}

interface CardReaderScreenProps {
  amountCents: number;
  onSuccess: (payload: CardReaderSuccessPayload) => void;
  onCancel: () => void;
}

type ReaderState = "waiting" | "reading" | "processing" | "approved";

export function CardReaderScreen({
  amountCents,
  onSuccess,
  onCancel,
}: CardReaderScreenProps) {
  const [readerState, setReaderState] = useState<ReaderState>("waiting");
  const [progressWidth, setProgressWidth] = useState(0);
  const onSuccessRef = useRef(onSuccess);
  onSuccessRef.current = onSuccess;

  useEffect(() => {
    const t1 = setTimeout(() => {
      setReaderState("reading");
      // start the progress bar: 0→60% over 600ms
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setProgressWidth(60));
      });
    }, 1200);

    const t2 = setTimeout(() => {
      setReaderState("processing");
    }, 1800);

    const t3 = setTimeout(() => {
      setReaderState("approved");
    }, 2800);

    const t4 = setTimeout(() => {
      onSuccessRef.current({
        id: `pay_sim_${Math.random().toString(36).slice(2, 12)}`,
        amount: amountCents,
        method: "card",
        status: "completed",
      });
    }, 3300);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      clearTimeout(t4);
    };
  // amountCents intentionally excluded — amount is fixed at mount
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="mx-auto w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-2xl">
        {readerState === "waiting" && (
          <WaitingState onCancel={onCancel} />
        )}
        {readerState === "reading" && (
          <ReadingState progressWidth={progressWidth} />
        )}
        {readerState === "processing" && (
          <ProcessingState amountCents={amountCents} />
        )}
        {readerState === "approved" && (
          <ApprovedState amountCents={amountCents} />
        )}
      </div>
    </div>
  );
}

// ── State views ───────────────────────────────────────────────────────────────

function WaitingState({ onCancel }: { onCancel: () => void }) {
  return (
    <>
      <div className="relative mx-auto mb-6 flex h-24 w-24 items-center justify-center">
        <span
          className="absolute inline-flex h-24 w-24 animate-ping rounded-full bg-brand-400 opacity-30"
          aria-hidden="true"
        />
        <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-brand-600">
          <CreditCardIcon />
        </span>
      </div>
      <p className="text-lg font-semibold text-slate-900">Tap, insert, or swipe card</p>
      <p className="mt-1 text-sm text-slate-400">Waiting for card…</p>
      <button
        type="button"
        onClick={onCancel}
        className="mt-8 min-h-[44px] w-full rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50"
      >
        Cancel
      </button>
    </>
  );
}

function ReadingState({ progressWidth }: { progressWidth: number }) {
  return (
    <>
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand-50 text-brand-600">
        <CreditCardIcon />
      </div>
      <p className="text-lg font-semibold text-slate-900">Reading card…</p>
      <div className="mt-5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-brand-600 transition-all duration-[600ms] ease-out"
          style={{ width: `${progressWidth}%` }}
          aria-hidden="true"
        />
      </div>
    </>
  );
}

function ProcessingState({ amountCents }: { amountCents: number }) {
  return (
    <>
      <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-brand-50">
        <SpinnerIcon />
      </div>
      <p className="text-3xl font-bold text-slate-900">{formatMoney(amountCents)}</p>
      <p className="mt-2 text-lg font-semibold text-slate-700">Processing payment…</p>
    </>
  );
}

function ApprovedState({ amountCents }: { amountCents: number }) {
  return (
    <>
      <div className="animate-in zoom-in duration-300 mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-green-50">
        <CheckIcon />
      </div>
      <p className="text-3xl font-bold text-green-700">{formatMoney(amountCents)}</p>
      <p className="mt-2 text-lg font-semibold text-green-700">Payment approved</p>
    </>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function CreditCardIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
      <line x1="1" y1="10" x2="23" y2="10" />
    </svg>
  );
}

function SpinnerIcon() {
  return (
    <svg
      className="h-10 w-10 animate-spin text-brand-600"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-green-600" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
