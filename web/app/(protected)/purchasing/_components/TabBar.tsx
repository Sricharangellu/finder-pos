"use client";

import type { PurchasingTab } from "./shared";

export function TabBar({
  active,
  onChange,
  showVendorQuotes = true,
}: {
  active: PurchasingTab;
  onChange: (t: PurchasingTab) => void;
  showVendorQuotes?: boolean;
}) {
  const tabs: { key: PurchasingTab; label: string }[] = [
    { key: "orders",   label: "Purchase Orders" },
    { key: "suppliers", label: "Suppliers" },
    { key: "reorder",  label: "Reorder Suggestions" },
    ...(showVendorQuotes ? [{ key: "vendor-quotes" as PurchasingTab, label: "Vendor Quotes" }] : []),
  ];
  return (
    <div className="border-b border-slate-200">
      <nav className="-mb-px flex gap-0 px-4" aria-label="Purchasing tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => onChange(t.key)}
            className={`min-h-[44px] border-b-2 px-4 text-sm font-medium transition-colors ${
              active === t.key
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
            aria-current={active === t.key ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
