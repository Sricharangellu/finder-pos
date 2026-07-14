"use client";

import { useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { AllDocumentsTab } from "./_components/AllDocumentsTab";
import { ByTypeTab } from "./_components/ByTypeTab";
import { TemplatesTab } from "./_components/TemplatesTab";

type Tab = "all" | "by-type" | "templates";

const TABS: { key: Tab; label: string }[] = [
  { key: "all",       label: "All Documents" },
  { key: "by-type",   label: "By Type" },
  { key: "templates", label: "Templates" },
];

export default function DocumentsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [refreshKey, setRefreshKey] = useState(0);

  function handleUpload() {
    // Switch to All Documents and trigger a re-fetch after upload
    setTab("all");
    setRefreshKey((k) => k + 1);
  }

  return (
    <EnterpriseShell
      active="documents"
      title="Document Center"
      subtitle="Spec sheets, agreements, compliance docs, and templates"
      contentClassName="overflow-y-auto"
    >
      <div className="mx-auto w-full max-w-7xl space-y-5 px-4 py-5 sm:px-6">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 w-fit">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
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
        {tab === "all" && (
          <AllDocumentsTab refreshKey={refreshKey} onUpload={handleUpload} />
        )}
        {tab === "by-type" && <ByTypeTab />}
        {tab === "templates" && <TemplatesTab />}
      </div>
    </EnterpriseShell>
  );
}
