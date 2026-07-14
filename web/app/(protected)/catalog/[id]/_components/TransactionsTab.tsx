"use client";

/**
 * Unified Transactions tab — consolidates Sales, Returns, Credits, Invoices,
 * and Sales by Customer into a single tabbed workspace so users don't need to
 * jump between 5 separate top-level tabs for transaction history.
 */

import { useState } from "react";
import { SalesTab } from "./SalesTab";
import { ReturnsTab } from "./ReturnsTab";
import { CreditsTab } from "./CreditsTab";
import { InvoicesTab } from "./InvoicesTab";
import { SalesCustomerTab } from "./SalesCustomerTab";

type TxTab = "sales" | "returns" | "credits" | "invoices" | "by-customer";

const TX_TABS: { key: TxTab; label: string; description: string }[] = [
  { key: "sales",       label: "Sales",          description: "All transactions where this product was sold" },
  { key: "by-customer", label: "By Customer",    description: "Sales broken down by customer — top buyers, loyalty" },
  { key: "returns",     label: "Returns",         description: "Return records, refunds, and restock status" },
  { key: "credits",     label: "Credit Notes",    description: "Store credit issued in connection with this product" },
  { key: "invoices",    label: "Purchase Invoice", description: "Supplier invoices and received purchase orders" },
];

export function TransactionsTab({ productId }: { productId: string }) {
  const [tab, setTab] = useState<TxTab>("sales");

  const current = TX_TABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      {/* Sub-tab picker */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {TX_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={[
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              tab === t.key
                ? "bg-white text-brand-600 shadow-sm"
                : "text-slate-500 hover:text-slate-800",
            ].join(" ")}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Current tab description */}
      <p className="text-xs text-slate-400">{current.description}</p>

      {/* Tab content — lazy mounted */}
      {tab === "sales"       && <SalesTab productId={productId} />}
      {tab === "by-customer" && <SalesCustomerTab productId={productId} />}
      {tab === "returns"     && <ReturnsTab productId={productId} />}
      {tab === "credits"     && <CreditsTab productId={productId} />}
      {tab === "invoices"    && <InvoicesTab productId={productId} />}
    </div>
  );
}
