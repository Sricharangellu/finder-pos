"use client";

import { CartContext, useCartReducer } from "@/lib/useCart";
import { TerminalInner } from "./_components/TerminalInner";

export default function TerminalPage() {
  const cartValue = useCartReducer();
  return (
    <CartContext.Provider value={cartValue}>
      <TerminalInner />
    </CartContext.Provider>
  );
}
