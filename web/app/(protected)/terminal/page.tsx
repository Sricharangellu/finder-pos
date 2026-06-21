"use client";

/**
 * /terminal — POS terminal (Wave 1).
 *
 * Layout: [Product grid (left)] | [Cart panel (right)]
 * Overlays: TenderScreen, ReceiptView
 *
 * Order lifecycle:
 *   Cart changes → PUT /api/v1/orders/:id (or POST on first item)
 *   Charge pressed → TenderScreen → POST /api/v1/payments
 *   Payment captured → ReceiptView → "New Sale" clears cart
 *
 * Offline: if isOffline, sales go into the sync outbox (lib/syncOutbox) and
 * OfflineQueueBanner tracks the backlog; reconciled on reconnect.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/useAuth";
import { useOffline } from "@/lib/useOffline";
import { useCart, useCartReducer, CartContext } from "@/lib/useCart";
import { useToast } from "@/components/Toast";
import { enqueue } from "@/lib/syncOutbox";
import { formatMoney } from "@/lib/money";
import { apiGet, apiPost, apiPut, ApiResponseError } from "@/api-client/client";
import type { Order, Payment, TerminalProduct as Product } from "@/api-client/types";
import { useBarcodeScanner } from "@/lib/useBarcodeScanner";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { ProductGrid } from "@/components/terminal/ProductGrid";
import { CartPanel } from "@/components/terminal/CartPanel";
import { TenderScreen } from "@/components/terminal/TenderScreen";
import { ReceiptView } from "@/components/terminal/ReceiptView";
import { OfflineQueueBanner } from "@/components/terminal/OfflineQueueBanner";
import { RegisterSessionGuard } from "@/components/terminal/RegisterSessionGuard";
import { useFlag } from "@/flags/useFlag";

// ─── Terminal inner (has access to cart context) ──────────────────────────────

interface OutletLocation {
  id: string;
  name: string;
  state: string;
}

function TerminalInner() {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const cart = useCart();
  const { addToast } = useToast();
  const splitTenderEnabled = useFlag("checkout_split_tender");

  const [screen, setScreen] = useState<"terminal" | "tender" | "receipt">("terminal");
  const [completedPayment, setCompletedPayment] = useState<Payment | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);
  const [ageVerified, setAgeVerified] = useState(false);
  const [returnMode, setReturnMode] = useState(false);

  const [outlets, setOutlets] = useState<OutletLocation[]>([]);
  const [activeOutletId, setActiveOutletId] = useState<string>("");
  const [outletState, setOutletState] = useState<string>("TX");

  useEffect(() => {
    apiGet<{ items: OutletLocation[] }>("/api/v1/inventory/locations")
      .then(({ items }) => {
        setOutlets(items);
        if (items.length > 0) {
          setActiveOutletId(items[0].id);
          setOutletState(items[0].state ?? "TX");
        }
      })
      .catch(() => {/* non-fatal */});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleOutletChange = useCallback((id: string) => {
    setActiveOutletId(id);
    const found = outlets.find((o) => o.id === id);
    if (found) setOutletState(found.state ?? "TX");
  }, [outlets]);

  // Debounce ref for order sync
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const orderIdRef = useRef<string | null>(null);

  // ── Sync cart lines to server after each change ──────────────────────────
  useEffect(() => {
    if (cart.state.lines.length === 0) {
      // Cart cleared — reset order ref but don't DELETE (order may be voided/completed)
      orderIdRef.current = null;
      cart.dispatch({ type: "SET_SYNCING", value: false });
      return;
    }

    // Debounce rapid qty changes
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);

    cart.dispatch({ type: "SET_SYNCING", value: true });

    syncTimerRef.current = setTimeout(() => {
      void syncOrder();
    }, 400);

    return () => {
      if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.state.lines]);

  const syncOrder = useCallback(async () => {
    const lines = cart.state.lines;
    if (lines.length === 0) return;

    const payload = {
      lines: lines.map((l) => ({
        productId: l.product.id,
        quantity: l.quantity,
        ...(l.product.ageRestricted ? { ageVerified } : {}),
      })),
    };

    // If offline, queue the sale instead of calling the API
    if (isOffline) {
      enqueue(
        orderIdRef.current ? "create_order" : "create_order",
        payload
      );
      cart.dispatch({ type: "SET_SYNCING", value: false });
      return;
    }

    try {
      let order: Order;
      if (orderIdRef.current) {
        order = await apiPut<Order>(
          `/api/v1/orders/${orderIdRef.current}`,
          payload
        );
      } else {
        order = await apiPost<Order>("/api/v1/orders", payload);
        orderIdRef.current = order.id;
      }
      cart.dispatch({ type: "SET_ORDER", order });
    } catch (err) {
      cart.dispatch({ type: "SET_SYNCING", value: false });
      if (err instanceof ApiResponseError && err.status !== 409) {
        addToast({
          title: "Could not sync cart",
          description: err.message,
          variant: "error",
        });
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart.state.lines, isOffline, ageVerified]);

  const handleAddProduct = useCallback(
    (product: Product) => {
      if (product.restricted_states?.includes(outletState)) {
        addToast({
          title: `${product.name} restricted in ${outletState}`,
          variant: "error",
        });
        return;
      }
      cart.addProduct(product);
    },
    [cart, outletState, addToast]
  );

  // Keyboard-wedge barcode scanner: look up product by barcode and add to cart.
  const handleBarcodeScan = useCallback(async (code: string) => {
    if (screen !== "terminal") return;
    try {
      const product = await apiGet<Product>(`/api/v1/catalog/barcode/${encodeURIComponent(code)}`);
      cart.addProduct(product);
      addToast({ title: `Added: ${product.name}`, variant: "success" });
    } catch {
      addToast({ title: `Barcode not found: ${code}`, variant: "error" });
    }
  }, [screen, cart, addToast]);

  useBarcodeScanner({ onScan: handleBarcodeScan });

  const handleCharge = useCallback(() => {
    if (!cart.state.order) return;
    setScreen("tender");
  }, [cart.state.order]);

  const handleAction = useCallback((action: string) => {
    addToast({
      title: action,
      description: "Workflow surface is ready; backend flow is queued for implementation.",
      variant: "info",
    });
  }, [addToast]);

  const handleReturnMode = useCallback(() => {
    setReturnMode((current) => {
      const next = !current;
      addToast({
        title: next ? "Return mode enabled" : "Return mode disabled",
        variant: next ? "warning" : "info",
      });
      return next;
    });
  }, [addToast]);

  const handleTenderSuccess = useCallback(
    (payment: Payment) => {
      setCompletedPayment(payment);
      setCompletedOrder(cart.state.order);
      setScreen("receipt");
    },
    [cart.state.order]
  );

  const handleTenderCancel = useCallback(() => {
    setScreen("terminal");
  }, []);

  const handleNewSale = useCallback(() => {
    cart.clearCart();
    orderIdRef.current = null;
    setCompletedPayment(null);
    setCompletedOrder(null);
    setScreen("terminal");
    setAgeVerified(false);
    setReturnMode(false);
    addToast({ title: "New sale started", variant: "info" });
  }, [cart, addToast]);

  const handleClearCart = useCallback(() => {
    cart.clearCart();
    orderIdRef.current = null;
    setAgeVerified(false);
    setReturnMode(false);
  }, [cart]);

  const hasAgeRestricted = cart.state.lines.some((line) => line.product.ageRestricted);
  const canCharge =
    cart.state.lines.length > 0 &&
    !cart.state.syncing &&
    cart.state.order !== null &&
    (!hasAgeRestricted || ageVerified);
  const totalCents = cart.state.order?.totalCents ?? cart.localSubtotalCents;

  return (
    <EnterpriseShell
      active="register"
      title="Register"
      subtitle="Demo Store · Front Counter · Register 01"
      banner={<OfflineQueueBanner />}
      contentClassName="flex flex-1 flex-col overflow-hidden lg:flex-row"
    >
      <RegisterSessionGuard registerId="reg_01">
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <CheckoutStatusStrip
            cashier={user?.name ?? "Cashier"}
            isOffline={isOffline}
            returnMode={returnMode}
            itemCount={cart.itemCount}
          />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
            {/* Left: Product grid */}
            <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
              <ProductGrid onAddProduct={handleAddProduct} />
            </div>

            {/* Right: Cart panel on desktop; bottom drawer on tablet/mobile */}
            <div className="h-[42vh] shrink-0 overflow-hidden border-t border-slate-200 lg:h-auto lg:w-80 lg:border-l lg:border-t-0 xl:w-96">
              <CartPanel
                cart={cart}
                onCharge={handleCharge}
                onClear={handleClearCart}
                role={user?.role}
                ageVerified={ageVerified}
                onAgeVerifiedChange={setAgeVerified}
              />
            </div>
          </div>
          <TerminalActionBar
            canCharge={canCharge}
            totalCents={totalCents}
            returnMode={returnMode}
            hasCart={cart.state.lines.length > 0}
            onHoldSale={() => handleAction("Hold sale")}
            onDiscount={() => handleAction("Discount")}
            onReturnMode={handleReturnMode}
            onCashDrawer={() => handleAction("Cash drawer")}
            onPrintReceipt={() => handleAction("Print receipt")}
            onCharge={handleCharge}
          />
        </div>
      </RegisterSessionGuard>

      {/* ── Overlays ──────────────────────────────────────────────────────── */}
      {screen === "tender" && cart.state.order && (
        <TenderScreen
          order={cart.state.order}
          onSuccess={handleTenderSuccess}
          onCancel={handleTenderCancel}
          splitEnabled={splitTenderEnabled}
        />
      )}

      {screen === "receipt" && completedOrder && completedPayment && (
        <ReceiptView
          order={completedOrder}
          payment={completedPayment}
          onNewSale={handleNewSale}
          role={user?.role ?? "cashier"}
        />
      )}
    </EnterpriseShell>
  );
}

function CheckoutStatusStrip({
  cashier,
  isOffline,
  returnMode,
  itemCount,
}: {
  cashier: string;
  isOffline: boolean;
  returnMode: boolean;
  itemCount: number;
}) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 text-xs sm:px-4">
      <StatusPill label="Store" value="Demo Store" tone="neutral" />
      <StatusPill label="Register" value="Front Counter 01" tone="neutral" />
      <StatusPill label="Cashier" value={cashier} tone="neutral" />
      <StatusPill label="Shift" value="Open" tone="success" />
      <StatusPill label="Network" value={isOffline ? "Offline queue" : "Online"} tone={isOffline ? "warning" : "success"} />
      <StatusPill label="Cart" value={`${itemCount} item${itemCount === 1 ? "" : "s"}`} tone={itemCount > 0 ? "brand" : "neutral"} />
      {returnMode && <StatusPill label="Mode" value="Return" tone="warning" />}
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "success" | "warning" | "brand";
}) {
  const toneClass = {
    neutral: "border-slate-200 bg-slate-50 text-slate-600",
    success: "border-success-200 bg-success-50 text-success-700",
    warning: "border-warning-200 bg-warning-50 text-warning-700",
    brand: "border-brand-200 bg-brand-50 text-brand-700",
  }[tone];

  return (
    <div className={`inline-flex min-h-[30px] items-center gap-1.5 rounded-md border px-2.5 ${toneClass}`}>
      <span className="font-semibold uppercase tracking-[0.08em] opacity-70">{label}</span>
      <span className="font-semibold">{value}</span>
    </div>
  );
}

function TerminalActionBar({
  canCharge,
  totalCents,
  returnMode,
  hasCart,
  onHoldSale,
  onDiscount,
  onReturnMode,
  onCashDrawer,
  onPrintReceipt,
  onCharge,
}: {
  canCharge: boolean;
  totalCents: number;
  returnMode: boolean;
  hasCart: boolean;
  onHoldSale: () => void;
  onDiscount: () => void;
  onReturnMode: () => void;
  onCashDrawer: () => void;
  onPrintReceipt: () => void;
  onCharge: () => void;
}) {
  return (
    <div className="flex flex-none gap-2 overflow-x-auto border-t border-slate-200 bg-white px-3 py-2 shadow-[0_-8px_24px_rgba(15,23,42,0.06)] sm:px-4">
      <TerminalAction label="Hold" disabled={!hasCart} onClick={onHoldSale} icon={<HoldIcon />} />
      <TerminalAction label="Discount" disabled={!hasCart} onClick={onDiscount} icon={<PercentIcon />} />
      <TerminalAction label={returnMode ? "Sale mode" : "Return"} active={returnMode} onClick={onReturnMode} icon={<ReturnIcon />} />
      <TerminalAction label="Drawer" onClick={onCashDrawer} icon={<DrawerIcon />} />
      <TerminalAction label="Receipt" disabled={!hasCart} onClick={onPrintReceipt} icon={<ReceiptIcon />} />
      <button
        type="button"
        disabled={!canCharge}
        onClick={onCharge}
        className="ml-auto inline-flex min-h-[44px] min-w-[150px] shrink-0 items-center justify-center rounded-md bg-brand-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        {canCharge ? `Complete ${formatMoney(totalCents)}` : "Complete sale"}
      </button>
    </div>
  );
}

function TerminalAction({
  label,
  icon,
  onClick,
  disabled = false,
  active = false,
}: {
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={active || undefined}
      className={`inline-flex min-h-[44px] min-w-[72px] shrink-0 flex-col items-center justify-center gap-1 rounded-md border px-3 text-xs font-semibold transition-colors ${
        active
          ? "border-warning-300 bg-warning-50 text-warning-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
      } disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-300`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function HoldIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="6" y="4" width="4" height="16" rx="1" />
      <rect x="14" y="4" width="4" height="16" rx="1" />
    </svg>
  );
}

function PercentIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 5 5 19" />
      <circle cx="7" cy="7" r="2" />
      <circle cx="17" cy="17" r="2" />
    </svg>
  );
}

function ReturnIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 14-4-4 4-4" />
      <path d="M5 10h11a4 4 0 0 1 0 8h-1" />
    </svg>
  );
}

function DrawerIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="8" width="18" height="12" rx="2" />
      <path d="M7 8V5h10v3" />
      <path d="M9 14h6" />
    </svg>
  );
}

function ReceiptIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2z" />
      <path d="M8 7h8" />
      <path d="M8 11h8" />
      <path d="M8 15h5" />
    </svg>
  );
}

// ─── Page — provides CartContext ──────────────────────────────────────────────

export default function TerminalPage() {
  const cartValue = useCartReducer();

  return (
    <CartContext.Provider value={cartValue}>
      <TerminalInner />
    </CartContext.Provider>
  );
}
