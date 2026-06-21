"use client";

import { useEffect, useState } from "react";

interface NumpadModalProps {
  value: number;
  label: string;
  max?: number;
  onConfirm: (qty: number) => void;
  onClose: () => void;
}

export function NumpadModal({
  value,
  label,
  max,
  onConfirm,
  onClose,
}: NumpadModalProps) {
  const [display, setDisplay] = useState(String(value));

  const current = parseInt(display, 10) || 0;
  const exceedsMax = max !== undefined && current > max;

  const pressDigit = (d: string) => {
    setDisplay((prev) => {
      if (prev === "0") return d;
      if (prev.length >= 4) return prev;
      return prev + d;
    });
  };

  const pressBackspace = () => {
    setDisplay((prev) => (prev.length <= 1 ? "0" : prev.slice(0, -1)));
  };

  const pressConfirm = () => {
    if (current < 1) return;
    if (exceedsMax) return;
    onConfirm(current);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key >= "0" && e.key <= "9") {
        pressDigit(e.key);
      } else if (e.key === "Backspace") {
        pressBackspace();
      } else if (e.key === "Enter") {
        pressConfirm();
      } else if (e.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  // pressConfirm, pressDigit, pressBackspace are stable closures derived from state —
  // including them would cause stale captures; the handler is re-registered on each render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, max, onConfirm, onClose]);

  const keyCls = "h-14 w-full rounded-xl text-xl font-semibold transition-all active:scale-95";
  const digitCls = `${keyCls} bg-slate-100 hover:bg-slate-200 text-slate-900`;
  const confirmCls = `${keyCls} bg-slate-900 text-white hover:bg-slate-800`;
  const backspaceCls = `${keyCls} bg-red-50 text-red-600 hover:bg-red-100`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/50" aria-hidden="true" />
      <div
        className="relative w-full max-w-xs rounded-t-2xl bg-white p-5 sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Product label */}
        <p className="mb-2 truncate text-sm text-slate-500">{label}</p>

        {/* Quantity display */}
        <div className="mb-1 flex min-h-[64px] items-center justify-center">
          <span
            className={`text-5xl font-bold tabular-nums ${exceedsMax ? "text-red-600" : "text-slate-900"}`}
            aria-live="polite"
            aria-atomic="true"
          >
            {display}
          </span>
        </div>

        {exceedsMax && max !== undefined && (
          <p className="mb-2 text-center text-xs text-red-500">Max: {max}</p>
        )}

        {current < 1 && display !== "0" && (
          <p className="mb-2 text-center text-xs text-red-500">Qty must be at least 1</p>
        )}

        {/* Numpad 3×4 grid */}
        <div className="mt-3 grid grid-cols-3 gap-2">
          {["7","8","9","4","5","6","1","2","3"].map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => pressDigit(d)}
              className={digitCls}
            >
              {d}
            </button>
          ))}

          {/* Row 4: ⌫  0  ✓ */}
          <button type="button" onClick={pressBackspace} className={backspaceCls} aria-label="Backspace">
            ⌫
          </button>
          <button type="button" onClick={() => pressDigit("0")} className={digitCls}>
            0
          </button>
          <button
            type="button"
            onClick={pressConfirm}
            disabled={current < 1 || exceedsMax}
            className={`${confirmCls} disabled:opacity-50`}
            aria-label="Confirm quantity"
          >
            ✓
          </button>
        </div>
      </div>
    </div>
  );
}
