"use client";

/**
 * Unified Purchasing tab — consolidates Suppliers, Purchase by Supplier, and
 * Supplier Price Comparison into one workspace so all supplier/purchasing data
 * for this product is in one place.
 */

import { useState } from "react";
import { SuppliersTab } from "./SuppliersTab";
import { PurchasesTab } from "./PurchasesTab";
import { SupplierPriceComparisonTab } from "./SupplierPriceComparisonTab";

type PTab = "purchase-orders" | "suppliers" | "price-comparison";

const PTABS: { key: PTab; label: string; description: string }[] = [
  { key: "purchase-orders",   label: "Purchase Orders",    description: "All POs for this product, status, and receiving history" },
  { key: "suppliers",         label: "Suppliers",          description: "Approved suppliers and vendor SKU mappings for this product" },
  { key: "price-comparison",  label: "Price Comparison",   description: "Compare supplier quoted prices and find the best landed cost" },
];

export function PurchasingTab({ productId }: { productId: string }) {
  const [tab, setTab] = useState<PTab>("purchase-orders");

  const current = PTABS.find((t) => t.key === tab)!;

  return (
    <div className="space-y-4">
      {/* Sub-tab picker */}
      <div className="flex flex-wrap gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        {PTABS.map((t) => (
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

      {/* Description */}
      <p className="text-xs text-slate-400">{current.description}</p>

      {/* Content */}
      {tab === "purchase-orders"  && <PurchasesTab productId={productId} />}
      {tab === "suppliers"        && <SuppliersTab productId={productId} />}
      {tab === "price-comparison" && <SupplierPriceComparisonTab productId={productId} />}
    </div>
  );
}
