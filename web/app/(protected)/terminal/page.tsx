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
import { apiPost, apiPut, ApiResponseError } from "@/api-client/client";
import type { Order, Payment, Product } from "@/api-client/types";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { ProductGrid } from "@/components/terminal/ProductGrid";
import { CartPanel } from "@/components/terminal/CartPanel";
import { TenderScreen } from "@/components/terminal/TenderScreen";
import { ReceiptView } from "@/components/terminal/ReceiptView";
import { OfflineQueueBanner } from "@/components/terminal/OfflineQueueBanner";
import { useFlag } from "@/flags/useFlag";

// ─── Terminal inner (has access to cart context) ──────────────────────────────

function TerminalInner() {
  const { user } = useAuth();
  const { isOffline } = useOffline();
  const cart = useCart();
  const { addToast } = useToast();
  const splitTenderEnabled = useFlag("checkout_split_tender");

  const [screen, setScreen] = useState<"terminal" | "tender" | "receipt">("terminal");
  const [completedPayment, setCompletedPayment] = useState<Payment | null>(null);
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null);

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
  }, [cart.state.lines, isOffline]);

  const handleAddProduct = useCallback(
    (product: Product) => {
      cart.addProduct(product);
    },
    [cart]
  );

  const handleCharge = useCallback(() => {
    if (!cart.state.order) return;
    setScreen("tender");
  }, [cart.state.order]);

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
    addToast({ title: "New sale started", variant: "info" });
  }, [cart, addToast]);

  const handleClearCart = useCallback(() => {
    cart.clearCart();
    orderIdRef.current = null;
  }, [cart]);

  return (
    <EnterpriseShell
      active="register"
      title="Register"
      subtitle="Demo Store · Front Counter · Register 01"
      banner={<OfflineQueueBanner />}
      contentClassName="flex flex-1 flex-col overflow-hidden lg:flex-row"
    >
      {/* Left: Product grid */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <ProductGrid onAddProduct={handleAddProduct} />
      </div>

      {/* Right: Cart panel on desktop; bottom drawer on tablet/mobile */}
      <div className="h-[42vh] shrink-0 overflow-hidden border-t border-gray-200 lg:h-auto lg:w-80 lg:border-l lg:border-t-0 xl:w-96">
        <CartPanel
          cart={cart}
          onCharge={handleCharge}
          onClear={handleClearCart}
          role={user?.role}
        />
      </div>

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

// ─── Page — provides CartContext ──────────────────────────────────────────────

export default function TerminalPage() {
  const cartValue = useCartReducer();

  return (
    <CartContext.Provider value={cartValue}>
      <TerminalInner />
    </CartContext.Provider>
  );
}
