"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { Badge, statusBadge } from "@/components/Badge";
import { Table } from "@/components/Table";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import type { FulfillmentLocation, PickList, Register, Outlet } from "@/api-client/types";

interface InventoryLocation {
  id: string;
  code: string;
  name: string;
  location_type: string;
  outlet_id: string | null;
  is_sellable: boolean;
  is_receiving_location: boolean;
  is_active: boolean;
}

interface LocationStock {
  id: string;
  product_id: string;
  quantity_on_hand: number;
  quantity_committed: number;
  quantity_available: number;
  average_cost_cents: number;
  reorder_level: number;
  updated_at: number;
}

export default function OperationsPage() {
  const [tab, setTab] = useState<"locations" | "picklists" | "outlets" | "stock-locations">("locations");
  const [locations, setLocations] = useState<FulfillmentLocation[]>([]);
  const [pickLists, setPickLists] = useState<PickList[]>([]);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLoc, setNewLoc] = useState({ name: "", code: "", type: "bin", description: "" });
  const [saving, setSaving] = useState(false);

  // Outlet modal state
  const [showNewOutlet, setShowNewOutlet] = useState(false);
  const [newOutlet, setNewOutlet] = useState({ name: "", timezone: "UTC" });
  const [savingOutlet, setSavingOutlet] = useState(false);

  // Per-outlet inline add-register state: outletId -> input value (undefined = not open)
  const [addRegisterState, setAddRegisterState] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locRes, plRes, outRes] = await Promise.all([
        apiGet<{ items: FulfillmentLocation[] }>("/api/v1/fulfillment/locations").catch(() => ({ items: [] as FulfillmentLocation[] })),
        apiGet<{ items: PickList[] }>("/api/v1/fulfillment/pick-lists").catch(() => ({ items: [] as PickList[] })),
        apiGet<{ items: Outlet[] }>("/api/v1/outlets").catch(() => ({ items: [] as Outlet[] })),
      ]);
      setLocations(locRes.items);
      setPickLists(plRes.items);
      setOutlets(outRes.items);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleCreateLocation = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/fulfillment/locations", newLoc);
      setShowNewLocation(false);
      setNewLoc({ name: "", code: "", type: "bin", description: "" });
      await load();
    } finally { setSaving(false); }
  };

  const handleCreateOutlet = async () => {
    setSavingOutlet(true);
    try {
      await apiPost("/api/v1/outlets", newOutlet);
      setShowNewOutlet(false);
      setNewOutlet({ name: "", timezone: "UTC" });
      await load();
    } finally { setSavingOutlet(false); }
  };

  const handleAddRegister = async (outletId: string) => {
    const name = addRegisterState[outletId]?.trim();
    if (!name) return;
    await apiPost(`/api/v1/outlets/${outletId}/registers`, { name });
    setAddRegisterState(prev => {
      const next = { ...prev };
      delete next[outletId];
      return next;
    });
    await load();
  };

  const locationCols = [
    { key: "code", header: "Code", render: (r: FulfillmentLocation) => <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.code}</span> },
    { key: "name", header: "Name", render: (r: FulfillmentLocation) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: "type", header: "Type", render: (r: FulfillmentLocation) => <Badge variant="blue">{r.type}</Badge> },
    { key: "desc", header: "Description", render: (r: FulfillmentLocation) => <span className="text-gray-500">{r.description ?? "—"}</span> },
  ];

  const pickCols = [
    { key: "num", header: "Pick #", render: (r: PickList) => <span className="font-medium text-gray-900">{r.pick_number}</span> },
    { key: "status", header: "Status", render: (r: PickList) => <Badge variant={statusBadge(r.status)}>{r.status}</Badge> },
    { key: "assigned", header: "Assigned To", render: (r: PickList) => <span className="text-gray-500">{r.assigned_to ?? "Unassigned"}</span> },
    { key: "created", header: "Created", render: (r: PickList) => <span className="text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</span> },
  ];

  const registerCols = [
    { key: "name", header: "Register Name", render: (r: Register) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: "status", header: "Status", render: (r: Register) => <Badge variant={r.status === "open" ? "green" : "gray"}>{r.status}</Badge> },
  ];

  return (
    <EnterpriseShell active="operations" title="Operations" subtitle="Locations & Pick/Pack" contentClassName="overflow-y-auto">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {(["locations", "picklists", "outlets", "stock-locations"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-3 text-sm font-medium capitalize transition-colors border-b-2 ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t === "picklists" ? "Pick Lists" : t === "outlets" ? "Outlets" : t === "stock-locations" ? "Stock Locations" : "Locations"}
              </button>
            ))}
          </nav>
        </div>

        {tab === "locations" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Storage Locations ({locations.length})</h2>
              <Button variant="primary" size="sm" onClick={() => setShowNewLocation(true)}>+ New Location</Button>
            </div>
            <Table columns={locationCols} rows={locations} loading={loading} rowKey={r => r.id} emptyMessage="No locations yet. Add bins, shelves, or aisles." />
          </div>
        )}

        {tab === "picklists" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Pick Lists ({pickLists.length})</h2>
            </div>
            <Table columns={pickCols} rows={pickLists} loading={loading} rowKey={r => r.id} emptyMessage="No pick lists. They're auto-created when sales orders are fulfilled." />
          </div>
        )}

        {tab === "stock-locations" && <StockLocationsTab />}

        {tab === "outlets" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900">Outlets ({outlets.length})</h2>
              <Button variant="primary" size="sm" onClick={() => setShowNewOutlet(true)}>+ New Outlet</Button>
            </div>
            {loading ? (
              <p className="text-sm text-gray-500">Loading outlets…</p>
            ) : outlets.length === 0 ? (
              <p className="text-sm text-gray-500">No outlets yet. Create one to get started.</p>
            ) : (
              <div className="space-y-4">
                {outlets.map(outlet => (
                  <div key={outlet.id} className="border border-gray-200 rounded-lg p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">{outlet.name}</h3>
                        {outlet.timezone && <p className="text-xs text-gray-500">{outlet.timezone}</p>}
                      </div>
                      <Badge variant="blue">{outlet.registers.length} register{outlet.registers.length !== 1 ? "s" : ""}</Badge>
                    </div>

                    <Table
                      columns={registerCols}
                      rows={outlet.registers}
                      rowKey={r => r.id}
                      emptyMessage="No registers in this outlet."
                    />

                    {/* Inline add register */}
                    {addRegisterState[outlet.id] !== undefined ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={addRegisterState[outlet.id]}
                          onChange={e => setAddRegisterState(prev => ({ ...prev, [outlet.id]: e.target.value }))}
                          onKeyDown={e => { if (e.key === "Enter") void handleAddRegister(outlet.id); if (e.key === "Escape") setAddRegisterState(prev => { const n = { ...prev }; delete n[outlet.id]; return n; }); }}
                          placeholder="Register name"
                          className="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                        />
                        <Button variant="primary" size="sm" onClick={() => void handleAddRegister(outlet.id)}>Add</Button>
                        <Button variant="secondary" size="sm" onClick={() => setAddRegisterState(prev => { const n = { ...prev }; delete n[outlet.id]; return n; })}>Cancel</Button>
                      </div>
                    ) : (
                      <Button variant="secondary" size="sm" onClick={() => setAddRegisterState(prev => ({ ...prev, [outlet.id]: "" }))}>+ Add Register</Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <Modal open={showNewLocation} onClose={() => setShowNewLocation(false)} title="New Location"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowNewLocation(false)}>Cancel</Button><Button variant="primary" loading={saving} onClick={() => void handleCreateLocation()}>Create</Button></div>}>
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Location Code</label>
            <input value={newLoc.code} onChange={e => setNewLoc(p => ({ ...p, code: e.target.value }))} placeholder="A-01-B" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input value={newLoc.name} onChange={e => setNewLoc(p => ({ ...p, name: e.target.value }))} placeholder="Aisle A, Shelf 1, Bin B" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
            <select value={newLoc.type} onChange={e => setNewLoc(p => ({ ...p, type: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500">
              <option value="bin">Bin</option><option value="shelf">Shelf</option><option value="aisle">Aisle</option><option value="zone">Zone</option><option value="rack">Rack</option>
            </select></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input value={newLoc.description} onChange={e => setNewLoc(p => ({ ...p, description: e.target.value }))} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
        </div>
      </Modal>

      <Modal open={showNewOutlet} onClose={() => setShowNewOutlet(false)} title="New Outlet"
        footer={<div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setShowNewOutlet(false)}>Cancel</Button><Button variant="primary" loading={savingOutlet} onClick={() => void handleCreateOutlet()}>Create</Button></div>}>
        <div className="space-y-4">
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input value={newOutlet.name} onChange={e => setNewOutlet(p => ({ ...p, name: e.target.value }))} placeholder="Main Store" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
          <div><label className="block text-sm font-medium text-gray-700 mb-1">Timezone</label>
            <input value={newOutlet.timezone} onChange={e => setNewOutlet(p => ({ ...p, timezone: e.target.value }))} placeholder="UTC" className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500" /></div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}

// ─── Stock Locations Tab ──────────────────────────────────────────────────────

const LOC_TYPE_BADGE: Record<string, "blue" | "gray" | "red" | "yellow"> = {
  floor: "blue",
  warehouse: "gray",
  damage: "red",
  receiving: "yellow",
};

function StockLocationsTab() {
  const [items, setItems] = useState<InventoryLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ code: "", name: "", location_type: "floor", outlet_id: "", is_sellable: false, is_receiving_location: false });
  const [busy, setBusy] = useState(false);
  const [toggling, setToggling] = useState<string | null>(null);
  const [viewStockLoc, setViewStockLoc] = useState<InventoryLocation | null>(null);
  const [stockItems, setStockItems] = useState<LocationStock[]>([]);
  const [stockLoading, setStockLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await apiGet<{ items: InventoryLocation[] }>("/api/v1/inventory/locations").catch(() => ({ items: [] as InventoryLocation[] }));
      setItems(r.items);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!form.code.trim() || !form.name.trim()) return;
    setBusy(true);
    try {
      await apiPost("/api/v1/inventory/locations", {
        code: form.code.trim(),
        name: form.name.trim(),
        location_type: form.location_type,
        outlet_id: form.outlet_id.trim() || null,
        is_sellable: form.is_sellable,
        is_receiving_location: form.is_receiving_location,
      });
      setShowForm(false);
      setForm({ code: "", name: "", location_type: "floor", outlet_id: "", is_sellable: false, is_receiving_location: false });
      void load();
    } finally { setBusy(false); }
  };

  const openStockModal = async (loc: InventoryLocation) => {
    setViewStockLoc(loc);
    setStockItems([]);
    setStockLoading(true);
    try {
      const data = await apiGet<LocationStock[]>(`/api/v1/inventory/locations/${loc.id}/stock`).catch(() => [] as LocationStock[]);
      setStockItems(Array.isArray(data) ? data : []);
    } finally { setStockLoading(false); }
  };

  const toggleActive = async (loc: InventoryLocation) => {
    setToggling(loc.id);
    try {
      await apiPatch(`/api/v1/inventory/locations/${loc.id}`, { is_active: !loc.is_active });
      setItems(prev => prev.map(l => l.id === loc.id ? { ...l, is_active: !l.is_active } : l));
    } finally { setToggling(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-900">Stock Locations ({items.length})</h2>
        <Button variant="primary" size="sm" onClick={() => setShowForm(v => !v)}>+ New Location</Button>
      </div>

      {showForm && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div className="flex flex-wrap gap-3">
            <input value={form.code} onChange={e => setForm(f => ({ ...f, code: e.target.value }))} placeholder="Code (e.g. MAIN-FLR)" className="w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Name" className="flex-1 min-w-36 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
            <select value={form.location_type} onChange={e => setForm(f => ({ ...f, location_type: e.target.value }))} className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none">
              <option value="floor">Floor</option>
              <option value="warehouse">Warehouse</option>
              <option value="damage">Damage</option>
              <option value="receiving">Receiving</option>
            </select>
            <input value={form.outlet_id} onChange={e => setForm(f => ({ ...f, outlet_id: e.target.value }))} placeholder="Outlet ID (optional)" className="w-40 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
          </div>
          <div className="flex flex-wrap items-center gap-4">
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_sellable} onChange={e => setForm(f => ({ ...f, is_sellable: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 accent-blue-600" />
              Sellable
            </label>
            <label className="flex items-center gap-1.5 text-sm cursor-pointer">
              <input type="checkbox" checked={form.is_receiving_location} onChange={e => setForm(f => ({ ...f, is_receiving_location: e.target.checked }))} className="h-4 w-4 rounded border-gray-300 accent-blue-600" />
              Receiving
            </label>
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" variant="primary" loading={busy} disabled={!form.code.trim() || !form.name.trim()} onClick={() => void create()}>Create</Button>
            </div>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Outlet</th>
              <th className="px-4 py-3">Sellable</th>
              <th className="px-4 py-3">Receiving</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">Loading…</td></tr>}
            {!loading && items.length === 0 && <tr><td colSpan={8} className="px-4 py-6 text-center text-gray-400">No stock locations yet. Create one above.</td></tr>}
            {items.map(loc => (
              <tr key={loc.id} className="hover:bg-gray-50">
                <td className="px-4 py-3">
                  <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{loc.code}</span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-900">{loc.name}</td>
                <td className="px-4 py-3">
                  <Badge variant={LOC_TYPE_BADGE[loc.location_type] ?? "gray"}>{loc.location_type}</Badge>
                </td>
                <td className="px-4 py-3 text-gray-500">{loc.outlet_id ?? "—"}</td>
                <td className="px-4 py-3">
                  {loc.is_sellable ? <span className="text-green-700 font-medium">Yes</span> : <span className="text-gray-400">No</span>}
                </td>
                <td className="px-4 py-3">
                  {loc.is_receiving_location ? <span className="text-green-700 font-medium">Yes</span> : <span className="text-gray-400">No</span>}
                </td>
                <td className="px-4 py-3">
                  <button
                    type="button"
                    disabled={toggling === loc.id}
                    onClick={() => void toggleActive(loc)}
                    aria-pressed={loc.is_active}
                    className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${loc.is_active ? "bg-blue-600" : "bg-gray-300"} ${toggling === loc.id ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
                  >
                    <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${loc.is_active ? "translate-x-4" : "translate-x-0.5"}`} />
                    <span className="sr-only">{loc.is_active ? "Active" : "Inactive"}</span>
                  </button>
                </td>
                <td className="px-4 py-3">
                  <Button size="sm" variant="secondary" onClick={() => void openStockModal(loc)}>View Stock</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={viewStockLoc !== null}
        onClose={() => setViewStockLoc(null)}
        title={viewStockLoc ? `Stock at ${viewStockLoc.name} (${viewStockLoc.code})` : "Stock"}
      >
        {stockLoading && <p className="py-6 text-center text-sm text-gray-400">Loading stock…</p>}
        {!stockLoading && stockItems.length === 0 && (
          <p className="py-6 text-center text-sm text-gray-400">No stock recorded at this location.</p>
        )}
        {!stockLoading && stockItems.length > 0 && (
          <div className="overflow-x-auto -mx-4 sm:-mx-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs font-semibold uppercase tracking-[0.08em] text-gray-500">
                  <th className="px-4 py-2.5">Product ID</th>
                  <th className="px-4 py-2.5 text-right">On Hand</th>
                  <th className="px-4 py-2.5 text-right">Committed</th>
                  <th className="px-4 py-2.5 text-right">Available</th>
                  <th className="px-4 py-2.5 text-right">Avg Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {stockItems.map(s => (
                  <tr key={s.product_id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-700">{s.product_id}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{s.quantity_on_hand}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-orange-600">{s.quantity_committed}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums font-medium ${s.quantity_available <= 0 ? "text-red-600" : "text-green-700"}`}>{s.quantity_available}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-500">${(s.average_cost_cents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </div>
  );
}
