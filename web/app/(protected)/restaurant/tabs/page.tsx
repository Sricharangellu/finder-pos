"use client";

/**
 * FE-R3: Bar Tabs — list, open, manage multi-round tabs.
 * Module-gated by module:bar_tabs.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtTime } from "@/lib/date";

interface BarTab {
  id: string;
  customer_name: string | null;
  table_id: string | null;
  status: "open" | "closed";
  opened_at: number;
  closed_at: number | null;
  order_ids: string[];
}

function elapsed(ms: number): string {
  const mins = Math.floor((Date.now() - ms) / 60_000);
  return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
}

export default function BarTabsPage() {
  const [tabs, setTabs]         = useState<BarTab[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filter, setFilter]     = useState<"open" | "closed">("open");
  const [newModal, setNewModal] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [processing, setProcessing]     = useState(false);
  const [closing, setClosing]   = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: BarTab[] }>(`/api/v1/restaurant/tabs?status=${filter}`)
        .then((d) => setTabs(d.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleOpenTab = async () => {
    setProcessing(true);
    try {
      await apiPost("/api/v1/restaurant/tabs", { customerName: customerName || undefined });
      setCustomerName("");
      setNewModal(false);
      load();
    } finally { setProcessing(false); }
  };

  const handleCloseTab = async (tabId: string) => {
    setClosing(tabId);
    try {
      await apiPost(`/api/v1/restaurant/tabs/${tabId}/close`, {});
      load();
    } finally { setClosing(null); }
  };

  const openCount   = tabs.filter(t => t.status === "open").length;

  return (
    <EnterpriseShell active="bar-tabs" title="Bar Tabs" subtitle="Open tabs and multi-round orders">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Header actions */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex gap-1.5">
            {(["open", "closed"] as const).map((s) => (
              <button key={s} type="button" onClick={() => setFilter(s)}
                className={`rounded-full px-4 py-1.5 text-sm font-medium capitalize transition-colors ${
                  filter === s ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                }`}>
                {s}
                {s === "open" && openCount > 0 && (
                  <span className="ml-1.5 rounded-full bg-white/20 px-1.5 py-0.5 text-xs">{openCount}</span>
                )}
              </button>
            ))}
          </div>
          <Button variant="primary" size="sm" onClick={() => setNewModal(true)}>
            + Open Tab
          </Button>
        </div>

        {/* Tabs grid */}
        {loading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1,2,3].map(i => <div key={i} className="h-40 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : tabs.length === 0 ? (
          <Card>
            <p className="py-10 text-center text-sm text-[var(--color-text-secondary)]">
              {filter === "open" ? "No open tabs right now." : "No closed tabs found."}
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tabs.map((tab) => (
              <div key={tab.id}
                className="rounded-xl border border-[var(--color-table-border)] bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-base font-semibold text-[var(--color-text-primary)]">
                      {tab.customer_name ?? "Walk-in"}
                    </p>
                    <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                      {elapsed(tab.opened_at)} ago · {tab.order_ids.length} round{tab.order_ids.length !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <Badge variant={tab.status === "open" ? "green" : "gray"} size="sm">
                    {tab.status}
                  </Badge>
                </div>

                {tab.status === "open" && (
                  <div className="mt-4 flex gap-2">
                    <Button
                      variant="secondary"
                      size="sm"
                      fullWidth
                      loading={closing === tab.id}
                      onClick={() => handleCloseTab(tab.id)}
                    >
                      Close Tab
                    </Button>
                  </div>
                )}

                {tab.status === "closed" && tab.closed_at && (
                  <p className="mt-3 text-xs text-[var(--color-text-secondary)]">
                    Closed {fmtTime(tab.closed_at)}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Open new tab modal */}
      <Modal open={newModal} onClose={() => setNewModal(false)} title="Open New Tab">
        <div className="space-y-4 p-4">
          <div>
            <label className="block text-sm font-medium text-[var(--color-text-secondary)] mb-1">
              Customer name (optional)
            </label>
            <input
              type="text"
              placeholder="e.g. John, Table 5"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleOpenTab()}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              autoFocus
            />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setNewModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={processing} onClick={handleOpenTab}>
              Open Tab
            </Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
