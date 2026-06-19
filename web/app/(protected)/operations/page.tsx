"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { Badge, statusBadge } from "@/components/Badge";
import { Table } from "@/components/Table";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost } from "@/api-client/client";
import type { FulfillmentLocation, PickList, Register, Outlet } from "@/api-client/types";

export default function OperationsPage() {
  const [tab, setTab] = useState<"locations" | "picklists" | "outlets">("locations");
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
            {(["locations", "picklists", "outlets"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-3 text-sm font-medium capitalize transition-colors border-b-2 ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t === "picklists" ? "Pick Lists" : t === "outlets" ? "Outlets" : "Locations"}
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
