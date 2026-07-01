"use client";

/**
 * ReceiptView — post-payment receipt with refund/void actions.
 *
 * Displayed after a successful payment capture.
 * Refund and void respect the order lifecycle:
 *   completed → refunded  (via POST /api/v1/orders/:id/refund)
 *   completed → voided    (via POST /api/v1/orders/:id/void, manager+ only)
 *
 * Accessibility: modal with focus trap, ARIA labels.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { clsx } from "clsx";
import { apiPost } from "@/api-client/client";
import { useToast } from "@/components/Toast";
import type { Order, Payment } from "@/api-client/types";
import { formatMoney } from "@/lib/money";
import { Button } from "@/components/Button";
import type { Role } from "@/api-client/types";
import { ThermalReceipt } from "@/components/ThermalReceipt";
import { fmtTime, fmtDateTime } from "@/lib/date";

interface ReceiptViewProps {
  order: Order;
  payment: Payment;
  onNewSale: () => void;
  role: Role;
}

export function ReceiptView({ order, payment, onNewSale, role }: ReceiptViewProps) {
  const [currentOrder, setCurrentOrder] = useState<Order>(order);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailAddr, setEmailAddr] = useState("");
  const [showEmailInput, setShowEmailInput] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const newSaleRef = useRef<HTMLButtonElement>(null);
  const { addToast } = useToast();

  // Focus the "New Sale" button on mount
  useEffect(() => {
    newSaleRef.current?.focus();
  }, []);

  const canRefund = currentOrder.status === "completed";
  // Void requires manager or owner
  const canVoid =
    currentOrder.status === "completed" &&
    (role === "owner" || role === "manager");

  const handleSendEmail = useCallback(async () => {
    const addr = emailAddr.trim();
    if (!addr) return;
    setSendingEmail(true);
    try {
      await apiPost(`/api/v1/orders/${currentOrder.id}/email-receipt`, { email: addr });
      addToast({ title: `Receipt sent to ${addr}`, variant: "success" });
      setShowEmailInput(false);
      setEmailAddr("");
    } catch (err) {
      addToast({ title: "Failed to send receipt", description: err instanceof Error ? err.message : undefined, variant: "error" });
    } finally {
      setSendingEmail(false);
    }
  }, [currentOrder.id, emailAddr, addToast]);

  const handleRefund = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await apiPost<Order>(`/api/v1/orders/${currentOrder.id}/refund`, {});
      setCurrentOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refund failed");
    } finally {
      setLoading(false);
    }
  }, [currentOrder.id]);

  const handleVoid = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const updated = await apiPost<Order>(`/api/v1/orders/${currentOrder.id}/void`, {});
      setCurrentOrder(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Void failed");
    } finally {
      setLoading(false);
    }
  }, [currentOrder.id]);

  const statusConfig = {
    completed: { label: "Paid", classes: "bg-success-100 text-success-700 border-success-200" },
    refunded: { label: "Refunded", classes: "bg-warning-100 text-warning-700 border-warning-200" },
    voided: { label: "Voided", classes: "bg-gray-100 text-gray-600 border-gray-200" },
    open: { label: "Open", classes: "bg-brand-100 text-brand-700 border-brand-200" },
  };

  const status = statusConfig[currentOrder.status];

  return (
    <>
      {/* Thermal receipt print styles — only active when window.print() is called */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: `
        @media print {
          body * { visibility: hidden !important; }
          .receipt-printable, .receipt-printable * { visibility: visible !important; }
          .receipt-printable {
            position: fixed !important;
            inset: 0 !important;
            width: 80mm !important;
            margin: 0 auto !important;
            padding: 4mm 4mm !important;
            font-family: 'Courier New', monospace !important;
            font-size: 11px !important;
            line-height: 1.4 !important;
            color: #000 !important;
            background: #fff !important;
          }
          .receipt-printable .no-print { display: none !important; }
          @page { size: 80mm auto; margin: 0; }
        }
      ` }} />
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receipt-title"
      className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" aria-hidden="true" />

      {/* Modal */}
      <div className="receipt-printable relative flex max-h-[95vh] w-full max-w-md flex-col overflow-hidden rounded-t-lg bg-white shadow-2xl sm:rounded-lg">
        {/* Header */}
        <div className="flex-none flex flex-col items-center gap-2 pt-8 pb-4 px-6 bg-success-50 border-b border-success-100">
          <div
            aria-hidden="true"
            className="flex h-16 w-16 items-center justify-center rounded-lg bg-success-100 text-success-700"
          >
            <CheckIcon />
          </div>
          <h2 id="receipt-title" className="text-xl font-bold text-gray-900">
            {currentOrder.status === "completed" ? "Payment Complete" :
              currentOrder.status === "refunded" ? "Order Refunded" : "Order Voided"}
          </h2>
          <span
            className={clsx(
              "px-3 py-1 rounded-full text-xs font-semibold border",
              status.classes
            )}
          >
            {status.label}
          </span>
        </div>

        {/* Error */}
        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-5 mt-4 rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700"
          >
            {error}
          </div>
        )}

        {/* Receipt body */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* Order info */}
          <div className="flex justify-between text-sm text-gray-500 mb-4">
            <span>Order #{currentOrder.orderNumber}</span>
            <span>{fmtTime(currentOrder.createdAt)}</span>
          </div>

          {/* Line items */}
          <ul aria-label="Receipt items" className="divide-y divide-gray-100 mb-4">
            {currentOrder.lines.map((line) => (
              <li key={line.id} className="flex justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900">{line.name}</span>
                  {line.quantity > 1 && (
                    <span className="ml-2 text-gray-400">× {line.quantity}</span>
                  )}
                </div>
                <span className="text-gray-900">{formatMoney(line.lineCents)}</span>
              </li>
            ))}
          </ul>

          {/* Totals */}
          <div className="border-t border-gray-200 pt-3 space-y-1.5">
            <ReceiptRow label="Subtotal" value={formatMoney(currentOrder.subtotalCents)} />
            {currentOrder.discountCents > 0 && (
              <ReceiptRow
                label="Discount"
                value={`−${formatMoney(currentOrder.discountCents)}`}
                className="text-success-600"
              />
            )}
            <ReceiptRow
              label="Tax"
              value={formatMoney(currentOrder.taxCents)}
              className="text-gray-500"
            />
            <div className="flex justify-between font-bold text-base pt-1 border-t border-gray-200">
              <span>Total</span>
              <span>{formatMoney(currentOrder.totalCents)}</span>
            </div>
          </div>

          {/* Payment info */}
          <div className="mt-4 rounded-xl bg-gray-50 border border-gray-100 p-4 space-y-2">
            <p className="text-xs text-gray-400 uppercase tracking-wide font-medium mb-2">
              Payment
            </p>
            <ReceiptRow
              label="Method"
              value={payment.method.charAt(0).toUpperCase() + payment.method.slice(1)}
            />
            {payment.cashCents > 0 && (
              <ReceiptRow label="Cash" value={formatMoney(payment.cashCents)} />
            )}
            {payment.cardCents > 0 && (
              <ReceiptRow
                label={`Card${payment.cardLast4 ? ` ••••${payment.cardLast4}` : ""}`}
                value={formatMoney(payment.cardCents)}
              />
            )}
            {payment.changeCents > 0 && (
              <ReceiptRow
                label="Change"
                value={formatMoney(payment.changeCents)}
                className="text-success-600 font-semibold"
              />
            )}
            {payment.authCode && (
              <ReceiptRow label="Auth code" value={payment.authCode} className="text-gray-400 text-xs" />
            )}
          </div>

          {/* Hidden thermal receipt — revealed by print CSS */}
          <div className="mt-4 hidden print:block">
            <ThermalReceipt
              storeName="FinderPOS Demo Store"
              receiptNumber={currentOrder.orderNumber}
              dateTime={fmtDateTime(currentOrder.createdAt)}
              lineItems={currentOrder.lines.map((l) => ({
                name: l.name,
                quantity: l.quantity,
                price_cents: l.unitCents,
                total_cents: l.lineCents,
              }))}
              subtotal_cents={currentOrder.subtotalCents}
              tax_cents={currentOrder.taxCents}
              discount_cents={currentOrder.discountCents}
              total_cents={currentOrder.totalCents}
              paymentMethod={payment.method.charAt(0).toUpperCase() + payment.method.slice(1)}
              amountTendered_cents={payment.cashCents > 0 ? payment.cashCents + payment.cardCents : undefined}
              change_cents={payment.changeCents > 0 ? payment.changeCents : undefined}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="no-print flex-none px-6 pb-6 pt-3 border-t border-gray-100 space-y-2">
          <Button
            ref={newSaleRef}
            variant="primary"
            size="lg"
            fullWidth
            onClick={onNewSale}
            aria-label="Start new sale"
          >
            New Sale
          </Button>

          {/* Print + Email row */}
          <div className={`flex gap-2${showEmailInput ? " hidden" : ""}`}>
            <button
              type="button"
              onClick={() => window.print()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-md bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9"/>
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
                <rect x="6" y="14" width="12" height="8"/>
              </svg>
              Print Receipt
            </button>
            <Button variant="ghost" size="sm" fullWidth onClick={() => setShowEmailInput(true)}>
              Email Receipt
            </Button>
          </div>

          {/* Email receipt inline form */}
          {showEmailInput && (
            <div className="flex gap-2">
              <input
                type="email"
                value={emailAddr}
                onChange={(e) => setEmailAddr(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleSendEmail(); if (e.key === "Escape") { setShowEmailInput(false); setEmailAddr(""); } }}
                placeholder="customer@email.com"
                autoFocus
                className="flex-1 min-w-0 rounded border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <Button variant="primary" size="sm" loading={sendingEmail} disabled={!emailAddr.trim() || sendingEmail} onClick={() => void handleSendEmail()}>Send</Button>
              <Button variant="ghost" size="sm" onClick={() => { setShowEmailInput(false); setEmailAddr(""); }}>✕</Button>
            </div>
          )}


          {(canRefund || canVoid) && (
            <div className="flex gap-2">
              {canRefund && (
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  loading={loading}
                  disabled={loading}
                  onClick={() => void handleRefund()}
                  aria-label="Refund this order"
                  className="text-warning-700 hover:bg-warning-50"
                >
                  Refund
                </Button>
              )}
              {canVoid && (
                <Button
                  variant="ghost"
                  size="sm"
                  fullWidth
                  loading={loading}
                  disabled={loading}
                  onClick={() => void handleVoid()}
                  aria-label="Void this order"
                  className="text-danger-600 hover:bg-danger-50"
                >
                  Void
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function ReceiptRow({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={clsx("flex justify-between text-sm", className)}>
      <span className="text-gray-500">{label}</span>
        <span className="text-right">{value}</span>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}
