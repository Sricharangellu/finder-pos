"use client";

/**
 * CartPanel — line items, totals (from the API), and proceed-to-tender button.
 *
 * Tax/discount/total come FROM the order API — never recomputed on the client.
 * While the API round-trip is in-flight a local optimistic subtotal is shown.
 *
 * Accessibility: labelled region, keyboard controls, ≥44px targets.
 */

import { useCallback, useState } from "react";
import { clsx } from "clsx";
import type { CartLine, CartContextValue } from "@/lib/useCart";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/Button";
import { NumpadModal } from "@/components/terminal/NumpadModal";

interface CartPanelProps {
  cart: CartContextValue;
  onCharge: () => void;
  onClear: () => void;
  /** Role of the current user — cashier may not void a completed order */
  role?: "owner" | "manager" | "cashier";
  ageVerified?: boolean;
  onAgeVerifiedChange?: (v: boolean) => void;
}

export function CartPanel({ cart, onCharge, onClear, role, ageVerified, onAgeVerifiedChange }: CartPanelProps) {
  const { state, setQty, removeProduct, itemCount, localSubtotalCents } = cart;
  const { lines, order, syncing } = state;

  const isEmpty = lines.length === 0;

  // Totals: server-authoritative when we have an order, optimistic otherwise
  const subtotal = order?.subtotalCents ?? localSubtotalCents;
  const discount = order?.discountCents ?? 0;
  const tax = order?.taxCents ?? 0;
  const total = order?.totalCents ?? localSubtotalCents;

  const hasAgeRestricted = lines.some(l => l.product.ageRestricted);
  const canCharge = !isEmpty && !syncing && order !== null && (!hasAgeRestricted || ageVerified);
  const canClear = role === "owner" || role === "manager" || role === "cashier";

  return (
    <section
      aria-label="Shopping cart"
      className="flex flex-col h-full bg-white border-l border-gray-200"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <CartIcon />
          <h2 className="text-base font-semibold text-gray-900">
            Cart
            {itemCount > 0 && (
              <span
                aria-label={`${itemCount} items`}
                className="ml-2 inline-flex items-center justify-center h-5 min-w-[20px] rounded-full bg-brand-600 text-white text-xs font-bold px-1"
              >
                {itemCount}
              </span>
            )}
          </h2>
        </div>

        {!isEmpty && canClear && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear cart"
            title="Clear cart"
            className={clsx(
              "flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-gray-400 transition-colors",
              "hover:bg-danger-50 hover:text-danger-600",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger-600"
            )}
          >
            <TrashIcon />
          </button>
        )}
      </div>

      {/* ── Line items ──────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full py-16 text-gray-300 select-none">
            <CartEmptyIcon />
            <p className="mt-3 text-sm text-gray-400">Cart is empty</p>
            <p className="text-xs text-gray-300 mt-1">Tap a product to add it</p>
          </div>
        ) : (
          <ul aria-label="Cart items" className="divide-y divide-gray-100">
            {lines.map((line) => (
              <CartLineItem
                key={line.product.id}
                line={line}
                onQtyChange={(qty) => setQty(line.product.id, qty)}
                onRemove={() => removeProduct(line.product.id)}
              />
            ))}
          </ul>
        )}
      </div>

      {/* ── Totals ──────────────────────────────────────────────────────── */}
      {!isEmpty && (
        <div className="flex-none space-y-1.5 border-t border-gray-200 bg-gray-50 px-4 py-3">
          <TotalRow label="Subtotal" cents={subtotal} />
          {discount > 0 && (
            <TotalRow label="Discount" cents={-discount} className="text-success-600" />
          )}
          <TotalRow
            label="Tax"
            cents={tax}
            className="text-gray-500"
            loading={syncing}
          />
          <div className="border-t border-gray-200 pt-2 mt-2">
            <TotalRow
              label="Total"
              cents={total}
              className="text-gray-900 font-bold text-base"
              loading={syncing}
            />
          </div>

          {syncing && (
            <p className="text-xs text-gray-400 text-center animate-pulse mt-1" aria-live="polite">
              Calculating totals…
            </p>
          )}
        </div>
      )}

      {/* ── Age verification banner ─────────────────────────────────────── */}
      {hasAgeRestricted && (
        <div className="flex-none mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex items-start gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mt-0.5 shrink-0 text-amber-600" aria-hidden="true">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <div className="flex-1">
              <p className="text-xs font-semibold text-amber-800">Age-Restricted Item</p>
              <p className="text-xs text-amber-700 mt-0.5">Cart contains an age-restricted product. Verify customer ID before charging.</p>
              <label className="mt-2 flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={ageVerified ?? false}
                  onChange={e => onAgeVerifiedChange?.(e.target.checked)}
                  className="h-4 w-4 rounded border-gray-300 text-brand-600 focus:ring-brand-500"
                />
                <span className="text-xs font-medium text-amber-800">Customer ID verified — age confirmed</span>
              </label>
            </div>
          </div>
        </div>
      )}

      {/* ── Charge button ───────────────────────────────────────────────── */}
      <div className="flex-none px-4 pb-4 pt-2">
        <Button
          variant="primary"
          size="lg"
          fullWidth
          disabled={!canCharge}
          loading={syncing}
          onClick={onCharge}
          aria-label={
            canCharge ? `Charge ${formatMoney(total)}` : "Add items to charge"
          }
          className="text-base"
        >
          {syncing ? "Calculating…" : isEmpty ? "Add items to charge" : `Charge ${formatMoney(total)}`}
        </Button>
      </div>
    </section>
  );
}

// ─── Cart line item ───────────────────────────────────────────────────────────

interface CartLineItemProps {
  line: CartLine;
  onQtyChange: (qty: number) => void;
  onRemove: () => void;
}

function CartLineItem({ line, onQtyChange, onRemove }: CartLineItemProps) {
  const { product, quantity } = line;
  const lineCents = product.priceCents * quantity;
  const [numpadOpen, setNumpadOpen] = useState(false);

  const decrement = useCallback(() => {
    if (quantity === 1) {
      onRemove();
    } else {
      onQtyChange(quantity - 1);
    }
  }, [quantity, onRemove, onQtyChange]);

  const increment = useCallback(() => {
    onQtyChange(quantity + 1);
  }, [quantity, onQtyChange]);

  return (
    <>
      <li className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-gray-50">
        {/* Name + unit price */}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{product.name}</p>
          <p className="text-xs text-gray-400">{formatMoney(product.priceCents)} each</p>
        </div>

        {/* Qty controls */}
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label={`${product.name} quantity`}
        >
          <button
            type="button"
            onClick={decrement}
            aria-label={quantity === 1 ? `Remove ${product.name}` : `Decrease ${product.name} quantity`}
            title={quantity === 1 ? `Remove ${product.name}` : `Decrease ${product.name} quantity`}
            className={clsx(
              "flex h-8 w-8 items-center justify-center rounded text-sm font-bold transition-colors",
              "bg-gray-100 text-gray-600 hover:bg-danger-100 hover:text-danger-700",
              "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
              "min-h-[44px] min-w-[44px]"
            )}
          >
            {quantity === 1 ? <TrashIcon /> : <MinusIcon />}
          </button>

          <button
            type="button"
            onClick={() => setNumpadOpen(true)}
            aria-label={`${product.name} quantity: ${quantity}. Tap to edit`}
            title="Tap to set quantity"
            className={clsx(
              "w-11 rounded text-center text-sm font-semibold text-gray-900",
              "hover:bg-brand-50 hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-600",
              "min-h-[44px]"
            )}
          >
            {quantity}
          </button>

          <button
            type="button"
            onClick={increment}
            aria-label={`Increase ${product.name} quantity`}
            title={`Increase ${product.name} quantity`}
            className={clsx(
              "flex h-8 w-8 items-center justify-center rounded text-sm font-bold transition-colors",
              "bg-gray-100 text-gray-600 hover:bg-brand-100 hover:text-brand-700",
              "focus-visible:ring-2 focus-visible:ring-brand-600 focus-visible:outline-none",
              "min-h-[44px] min-w-[44px]"
            )}
          >
            <PlusIcon />
          </button>
        </div>

        {/* Line total */}
        <div className="w-16 text-right">
          <span className="text-sm font-semibold text-gray-900">
            {formatMoney(lineCents)}
          </span>
        </div>
      </li>

      {numpadOpen && (
        <NumpadModal
          value={quantity}
          label={product.name}
          max={999}
          onConfirm={(qty) => {
            onQtyChange(qty);
            setNumpadOpen(false);
          }}
          onClose={() => setNumpadOpen(false)}
        />
      )}
    </>
  );
}

// ─── Total row ────────────────────────────────────────────────────────────────

function TotalRow({
  label,
  cents,
  className,
  loading,
}: {
  label: string;
  cents: number;
  className?: string;
  loading?: boolean;
}) {
  return (
    <div className={clsx("flex justify-between text-sm", className)}>
      <span className="text-gray-500">{label}</span>
      {loading ? (
        <span className="w-16 h-4 bg-gray-200 animate-pulse rounded" aria-hidden="true" />
      ) : (
        <span>{formatMoney(cents)}</span>
      )}
    </div>
  );
}

// ─── Icons ────────────────────────────────────────────────────────────────────

function CartIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function CartEmptyIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="9" cy="21" r="1" />
      <circle cx="20" cy="21" r="1" />
      <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v5" />
      <path d="M14 11v5" />
    </svg>
  );
}

function MinusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true">
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  );
}
