"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { ErrorsSummaryTab } from "./_components/ErrorsSummaryTab";
import { ErrorsListTab } from "./_components/ErrorsListTab";

type ErrCategory =
  | "sku_mapping" | "supplier_mapping" | "price_mismatch" | "qty_mismatch"
  | "duplicate_doc" | "missing_barcode" | "missing_cost" | "below_min_order"
  | "expiry_risk" | "unapproved_supplier" | "edi_parse" | "po_invoice_mismatch"
  | "receiving_mismatch";

type Tab = "summary" | "open" | "in-review" | "resolved";

const TABS: { key: Tab; label: string }[] = [
  { key: "summary",   label: "Overview" },
  { key: "open",      label: "Open" },
  { key: "in-review", label: "In Review" },
  { key: "resolved",  label: "Resolved" },
];

export default function InventoryErrorsPage() {
  const [tab, setTab] = useState<Tab>("summary");
  const [drillCategory, setDrillCategory] = useState<ErrCategory | null>(null);

  function handleCategoryClick(cat: ErrCategory) {
    setDrillCategory(cat);
    setTab("open");
  }

  function handleTabChange(t: Tab) {
    setTab(t);
    if (t !== "open") setDrillCategory(null);
  }

  return (
    <EnterpriseShell
      active="inventory-errors"
      title="Error Check Center"
      subtitle="13 error categories — detect, investigate, and resolve inventory issues"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-6xl space-y-5 px-4 py-5 sm:px-6">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabChange(t.key)}
              className={[
                "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                tab === t.key
                  ? "bg-white text-brand-600 shadow-sm"
                  : "text-slate-500 hover:text-slate-800",
              ].join(" ")}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "summary" && (
          <ErrorsSummaryTab onCategoryClick={handleCategoryClick} />
        )}
        {tab === "open" && (
          <ErrorsListTab
            category={drillCategory ?? "all"}
            showResolved={false}
          />
        )}
        {tab === "in-review" && (
          <ErrorsListTab
            category="all"
            showResolved={false}
          />
        )}
        {tab === "resolved" && (
          <ErrorsListTab
            category="all"
            showResolved={true}
          />
        )}
      </div>
    </EnterpriseShell>
  );
}
