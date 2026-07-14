"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { apiGet } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtDateTime } from "@/lib/date";
import { Can } from "@/components/rbac";

// ── Types ─────────────────────────────────────────────────────────────────────

type Tab = "dashboard" | "locations" | "receiving" | "putaway" | "picks" | "cycle-counts";

interface WmsDashboard {
  totalLocations: number;
  occupiedLocations: number;
  pendingReceiving: number;
  pendingPutaway: number;
  openPicks: number;
  scheduledCounts: number;
  recentActivity: Array<{ id: string; type: string; label: string; actor: string; ts: number }>;
}

interface WmsLocation {
  id: string;
  code: string;
  name: string;
  type: "warehouse" | "zone" | "aisle" | "rack" | "shelf" | "bin";
  parentId: string | null;
  capacity: number;
  occupied: number;
  skuCount: number;
  temperature?: string;
}

interface ReceivingItem {
  id: string;
  poNumber: string;
  vendorName: string;
  expectedDate: number;
  itemCount: number;
  status: "scheduled" | "in_progress" | "partial" | "complete";
  lines: Array<{ sku: string; name: string; ordered: number; received: number }>;
}

interface PutawayTask {
  id: string;
  sku: string;
  productName: string;
  qty: number;
  fromLocation: string;
  suggestedBin: string;
  poNumber: string;
  receivedAt: number;
  priority: "high" | "normal";
}

interface PickList {
  id: string;
  pickNumber: string;
  orderNumber: string;
  customerName: string;
  lines: number;
  pickedLines: number;
  strategy: "FIFO" | "FEFO" | "LIFO";
  priority: "urgent" | "high" | "normal";
  status: "open" | "in_progress" | "packed" | "complete";
  dueAt: number;
}

interface CycleCount {
  id: string;
  countNumber: string;
  zone: string;
  abcClass: "A" | "B" | "C";
  scheduledDate: number;
  locationCount: number;
  completedLocations: number;
  variance?: number;
  status: "scheduled" | "in_progress" | "complete" | "approved";
}

// ── Constants ─────────────────────────────────────────────────────────────────

const TABS: { key: Tab; label: string }[] = [
  { key: "dashboard",    label: "Dashboard" },
  { key: "locations",    label: "Locations" },
  { key: "receiving",    label: "Receiving" },
  { key: "putaway",      label: "Putaway" },
  { key: "picks",        label: "Pick Lists" },
  { key: "cycle-counts", label: "Cycle Counts" },
];

const RECEIVE_STATUS: Record<ReceivingItem["status"], { label: string; cls: string }> = {
  scheduled:   { label: "Scheduled",   cls: "bg-blue-100 text-blue-700" },
  in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-700" },
  partial:     { label: "Partial",     cls: "bg-orange-100 text-orange-700" },
  complete:    { label: "Complete",    cls: "bg-emerald-100 text-emerald-700" },
};

const PICK_STATUS: Record<PickList["status"], { label: string; cls: string }> = {
  open:        { label: "Open",        cls: "bg-slate-100 text-slate-600" },
  in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-700" },
  packed:      { label: "Packed",      cls: "bg-blue-100 text-blue-700" },
  complete:    { label: "Complete",    cls: "bg-emerald-100 text-emerald-700" },
};

const PRIORITY_CLS: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  high:   "bg-orange-100 text-orange-700",
  normal: "bg-slate-100 text-slate-600",
};

const COUNT_STATUS: Record<CycleCount["status"], { label: string; cls: string }> = {
  scheduled:   { label: "Scheduled",   cls: "bg-slate-100 text-slate-600" },
  in_progress: { label: "In Progress", cls: "bg-amber-100 text-amber-700" },
  complete:    { label: "Complete",    cls: "bg-blue-100 text-blue-700" },
  approved:    { label: "Approved",    cls: "bg-emerald-100 text-emerald-700" },
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${accent ? "text-brand-600" : "text-slate-900"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-slate-400">{sub}</p>}
    </div>
  );
}

function ProgressBar({ value, max, color = "bg-brand-600" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ── Dashboard Tab ─────────────────────────────────────────────────────────────

function DashboardTab() {
  const [data, setData] = useState<WmsDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<WmsDashboard>("/api/v1/warehouse/dashboard").then((d) => {
      setData(d); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />)}</div>;
  if (!data) return null;

  const occupancyPct = data.totalLocations > 0 ? Math.round((data.occupiedLocations / data.totalLocations) * 100) : 0;

  const ACTIVITY_ICONS: Record<string, string> = {
    receive: "📦", putaway: "📍", pick: "🛒", count: "📋", transfer: "↔️", adjust: "✏️",
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        <KpiCard label="Total Locations" value={data.totalLocations.toLocaleString()} />
        <KpiCard label="Occupancy" value={`${occupancyPct}%`} sub={`${data.occupiedLocations} occupied`} accent />
        <KpiCard label="Pending Receiving" value={data.pendingReceiving} />
        <KpiCard label="Putaway Queue" value={data.pendingPutaway} />
        <KpiCard label="Open Picks" value={data.openPicks} />
        <KpiCard label="Scheduled Counts" value={data.scheduledCounts} />
      </div>

      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-5 py-3.5">
          <h3 className="text-sm font-semibold text-slate-900">Recent Activity</h3>
        </div>
        <ul className="divide-y divide-slate-100">
          {data.recentActivity.map((ev) => (
            <li key={ev.id} className="flex items-center gap-3 px-5 py-3 text-sm">
              <span className="text-lg">{ACTIVITY_ICONS[ev.type] ?? "•"}</span>
              <span className="flex-1 text-slate-700">{ev.label}</span>
              <span className="text-xs text-slate-400">{ev.actor}</span>
              <span className="text-xs text-slate-400">{fmtDateTime(ev.ts)}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ── Locations Tab ─────────────────────────────────────────────────────────────

function LocationsTab() {
  const [locations, setLocations] = useState<WmsLocation[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch]         = useState("");

  useEffect(() => {
    void apiGet<{ items: WmsLocation[] }>("/api/v1/warehouse/locations").then((r) => {
      setLocations(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const TYPE_COLOR: Record<WmsLocation["type"], string> = {
    warehouse: "bg-purple-100 text-purple-700",
    zone:      "bg-blue-100 text-blue-700",
    aisle:     "bg-cyan-100 text-cyan-700",
    rack:      "bg-teal-100 text-teal-700",
    shelf:     "bg-green-100 text-green-700",
    bin:       "bg-slate-100 text-slate-700",
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return locations.filter(l => !q || l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q));
  }, [locations, search]);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search locations..."
          className="h-9 w-64 rounded-lg border border-slate-200 px-3 text-sm focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600/20"
        />
        <Can permission="inventory.adjust">
          <button className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + Add Location
          </button>
        </Can>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Code</th>
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3 text-right">SKUs</th>
              <th className="px-5 py-3">Occupancy</th>
              <th className="px-5 py-3">Temperature</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((loc) => {
              const pct = loc.capacity > 0 ? Math.round((loc.occupied / loc.capacity) * 100) : 0;
              const barColor = pct > 90 ? "bg-red-500" : pct > 70 ? "bg-amber-400" : "bg-emerald-500";
              return (
                <tr
                  key={loc.id}
                  className={`cursor-pointer hover:bg-slate-50 transition-colors ${selectedId === loc.id ? "bg-indigo-50" : ""}`}
                  onClick={() => setSelectedId(selectedId === loc.id ? null : loc.id)}
                >
                  <td className="px-5 py-3.5 font-mono text-xs font-semibold text-slate-700">{loc.code}</td>
                  <td className="px-5 py-3.5 font-medium text-slate-900">{loc.name}</td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold capitalize ${TYPE_COLOR[loc.type]}`}>
                      {loc.type}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right text-slate-600">{loc.skuCount}</td>
                  <td className="px-5 py-3.5 min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={loc.occupied} max={loc.capacity} color={barColor} />
                      <span className="text-xs text-slate-500 w-10 text-right">{pct}%</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{loc.temperature ?? "Ambient"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No locations match your search.</p>
        )}
      </div>
    </div>
  );
}

// ── Receiving Tab ─────────────────────────────────────────────────────────────

function ReceivingTab() {
  const [items, setItems]     = useState<ReceivingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: ReceivingItem[] }>("/api/v1/warehouse/receiving").then((r) => {
      setItems(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}</div>;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{items.length} inbound shipments</p>
        <Can permission="inventory.receive">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + Schedule Receiving
          </button>
        </Can>
      </div>

      {items.map((item) => {
        const st = RECEIVE_STATUS[item.status];
        const isOpen = expanded === item.id;
        const totalOrdered  = item.lines.reduce((s, l) => s + l.ordered, 0);
        const totalReceived = item.lines.reduce((s, l) => s + l.received, 0);
        return (
          <div key={item.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-slate-50 transition-colors"
              onClick={() => setExpanded(isOpen ? null : item.id)}
            >
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-900">{item.poNumber}</span>
                  <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">{item.vendorName} · Expected {fmtDate(item.expectedDate)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-semibold text-slate-900">{totalReceived}/{totalOrdered} units</p>
                <ProgressBar value={totalReceived} max={totalOrdered} />
              </div>
              <span className="text-slate-400 ml-2">{isOpen ? "▲" : "▼"}</span>
            </button>

            {isOpen && (
              <div className="border-t border-slate-100">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-xs font-semibold text-slate-500">
                    <tr>
                      <th className="px-5 py-2.5">SKU</th>
                      <th className="px-5 py-2.5">Product</th>
                      <th className="px-5 py-2.5 text-right">Ordered</th>
                      <th className="px-5 py-2.5 text-right">Received</th>
                      <th className="px-5 py-2.5">Progress</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {item.lines.map((ln) => (
                      <tr key={ln.sku}>
                        <td className="px-5 py-2.5 font-mono text-xs text-slate-500">{ln.sku}</td>
                        <td className="px-5 py-2.5 text-slate-900">{ln.name}</td>
                        <td className="px-5 py-2.5 text-right">{ln.ordered}</td>
                        <td className="px-5 py-2.5 text-right font-semibold">{ln.received}</td>
                        <td className="px-5 py-2.5 w-32"><ProgressBar value={ln.received} max={ln.ordered} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
                  <Can permission="inventory.receive">
                    <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                      Print ASN
                    </button>
                    <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
                      Start Receiving
                    </button>
                  </Can>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Putaway Tab ───────────────────────────────────────────────────────────────

function PutawayTab() {
  const [tasks, setTasks]     = useState<PutawayTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: PutawayTask[] }>("/api/v1/warehouse/putaway").then((r) => {
      setTasks(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">{tasks.length} items awaiting putaway</p>
        <Can permission="inventory.adjust">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            Print Putaway Sheet
          </button>
        </Can>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">SKU</th>
              <th className="px-5 py-3">Product</th>
              <th className="px-5 py-3 text-right">Qty</th>
              <th className="px-5 py-3">From</th>
              <th className="px-5 py-3">Suggested Bin</th>
              <th className="px-5 py-3">PO</th>
              <th className="px-5 py-3">Received</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {tasks.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-5 py-3.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_CLS[t.priority]}`}>
                    {t.priority}
                  </span>
                </td>
                <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{t.sku}</td>
                <td className="px-5 py-3.5 font-medium text-slate-900">{t.productName}</td>
                <td className="px-5 py-3.5 text-right font-semibold">{t.qty}</td>
                <td className="px-5 py-3.5 font-mono text-xs text-slate-500">{t.fromLocation}</td>
                <td className="px-5 py-3.5">
                  <span className="rounded bg-indigo-50 px-2 py-0.5 font-mono text-xs font-semibold text-brand-600">
                    {t.suggestedBin}
                  </span>
                </td>
                <td className="px-5 py-3.5 text-xs text-slate-500">{t.poNumber}</td>
                <td className="px-5 py-3.5 text-xs text-slate-400">{fmtDateTime(t.receivedAt)}</td>
                <td className="px-5 py-3.5">
                  <Can permission="inventory.adjust">
                    <button className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#4B4DC8]">
                      Confirm
                    </button>
                  </Can>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tasks.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No items pending putaway.</p>
        )}
      </div>
    </div>
  );
}

// ── Picks Tab ─────────────────────────────────────────────────────────────────

function PicksTab() {
  const [picks, setPicks]     = useState<PickList[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [filter, setFilter]   = useState<PickList["status"] | "all">("all");

  useEffect(() => {
    void apiGet<{ items: PickList[] }>("/api/v1/warehouse/picks").then((r) => {
      setPicks(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const filtered = useMemo(() =>
    filter === "all" ? picks : picks.filter(p => p.status === filter),
  [picks, filter]);

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {(["all", "open", "in_progress", "packed", "complete"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              filter === s ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {s === "all" ? "All" : s.replace("_", " ")}
          </button>
        ))}
        <Can permission="orders.fulfill">
          <button className="ml-auto rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            Generate Pick Lists
          </button>
        </Can>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Pick #</th>
              <th className="px-5 py-3">Order</th>
              <th className="px-5 py-3">Customer</th>
              <th className="px-5 py-3">Priority</th>
              <th className="px-5 py-3">Strategy</th>
              <th className="px-5 py-3">Progress</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3">Due</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {filtered.map((p) => {
              const st = PICK_STATUS[p.status];
              const overdue = p.status !== "complete" && Date.now() > p.dueAt;
              return (
                <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-brand-600">{p.pickNumber}</td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{p.orderNumber}</td>
                  <td className="px-5 py-3.5 text-slate-900">{p.customerName}</td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold capitalize ${PRIORITY_CLS[p.priority]}`}>
                      {p.priority}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-mono text-slate-600">{p.strategy}</span>
                  </td>
                  <td className="px-5 py-3.5 min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={p.pickedLines} max={p.lines} />
                      <span className="text-xs text-slate-500 w-12 text-right">{p.pickedLines}/{p.lines}</span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className={`px-5 py-3.5 text-xs ${overdue ? "font-bold text-red-600" : "text-slate-400"}`}>
                    {fmtDate(p.dueAt)}{overdue ? " ⚠" : ""}
                  </td>
                  <td className="px-5 py-3.5">
                    <Can permission="orders.fulfill">
                      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        {p.status === "open" ? "Start" : "View"}
                      </button>
                    </Can>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No pick lists match this filter.</p>
        )}
      </div>
    </div>
  );
}

// ── Cycle Counts Tab ──────────────────────────────────────────────────────────

function CycleCountsTab() {
  const [counts, setCounts]   = useState<CycleCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  useEffect(() => {
    void apiGet<{ items: CycleCount[] }>("/api/v1/warehouse/cycle-counts").then((r) => {
      setCounts(r.items ?? []); setLoading(false);
    }).catch((err: unknown) => { setError((err as Error).message ?? "Failed to load"); setLoading(false); });
  }, []);

  const ABC_CLS: Record<CycleCount["abcClass"], string> = {
    A: "bg-red-100 text-red-700",
    B: "bg-amber-100 text-amber-700",
    C: "bg-slate-100 text-slate-600",
  };

  if (error) return <p className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{error}</p>;
  if (loading) return <div className="h-64 animate-pulse rounded-xl bg-slate-100" />;

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-blue-100 bg-blue-50 px-5 py-3 text-sm text-blue-700">
        <strong>ABC Classification:</strong> Class A = high-value/high-velocity (count monthly) · Class B = mid-value (quarterly) · Class C = low-value (annually)
      </div>

      <div className="flex justify-end">
        <Can permission="inventory.count">
          <button className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-[#4B4DC8]">
            + Schedule Count
          </button>
        </Can>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-5 py-3">Count #</th>
              <th className="px-5 py-3">Zone</th>
              <th className="px-5 py-3">Class</th>
              <th className="px-5 py-3">Scheduled</th>
              <th className="px-5 py-3">Progress</th>
              <th className="px-5 py-3 text-right">Variance</th>
              <th className="px-5 py-3">Status</th>
              <th className="px-5 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {counts.map((c) => {
              const st = COUNT_STATUS[c.status];
              return (
                <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3.5 font-semibold text-brand-600">{c.countNumber}</td>
                  <td className="px-5 py-3.5 font-medium text-slate-900">{c.zone}</td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${ABC_CLS[c.abcClass]}`}>
                      Class {c.abcClass}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-xs text-slate-500">{fmtDate(c.scheduledDate)}</td>
                  <td className="px-5 py-3.5 min-w-[140px]">
                    <div className="flex items-center gap-2">
                      <ProgressBar value={c.completedLocations} max={c.locationCount} />
                      <span className="text-xs text-slate-500 w-16 text-right">
                        {c.completedLocations}/{c.locationCount}
                      </span>
                    </div>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    {c.variance !== undefined ? (
                      <span className={`font-semibold ${c.variance === 0 ? "text-emerald-600" : c.variance < 0 ? "text-red-600" : "text-amber-600"}`}>
                        {c.variance > 0 ? "+" : ""}{formatMoney(c.variance)}
                      </span>
                    ) : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-5 py-3.5">
                    <Can permission="inventory.count">
                      <button className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                        {c.status === "scheduled" ? "Start" : c.status === "complete" ? "Approve" : "View"}
                      </button>
                    </Can>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {counts.length === 0 && (
          <p className="py-10 text-center text-sm text-slate-400">No cycle counts scheduled.</p>
        )}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function WarehousePage() {
  const [activeTab, setActiveTab] = useState<Tab>("dashboard");

  return (
    <EnterpriseShell active="warehouse" title="Warehouse" subtitle="WMS — locations, receiving, putaway, picks, and cycle counts" contentClassName="overflow-y-auto">
      <div className="mx-auto max-w-[1400px] space-y-6 px-6 py-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Warehouse Management</h1>
            <p className="mt-1 text-sm text-slate-500">Location hierarchy, receiving, putaway, picking, and cycle counts</p>
          </div>
          <Can permission="inventory.receive">
            <button className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-[#4B4DC8]">
              Receive Inventory
            </button>
          </Can>
        </div>

        {/* Tabs */}
        <div className="border-b border-slate-200">
          <nav className="flex gap-1" aria-label="WMS tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2.5 text-sm font-semibold transition-colors ${
                  activeTab === t.key
                    ? "border-b-2 border-brand-600 text-brand-600"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Content */}
        {activeTab === "dashboard"    && <DashboardTab />}
        {activeTab === "locations"    && <LocationsTab />}
        {activeTab === "receiving"    && <ReceivingTab />}
        {activeTab === "putaway"      && <PutawayTab />}
        {activeTab === "picks"        && <PicksTab />}
        {activeTab === "cycle-counts" && <CycleCountsTab />}
      </div>
    </EnterpriseShell>
  );
}
