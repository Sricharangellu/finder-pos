"use client";

import { useCallback, useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Button } from "@/components/Button";
import { Badge, statusBadge } from "@/components/Badge";
import { Table } from "@/components/Table";
import { Modal } from "@/components/Modal";
import { apiGet, apiPost } from "@/api-client/client";

interface Location { id: string; name: string; code: string; type: string; description?: string; }
interface PickList { id: string; pick_number: string; status: string; assigned_to?: string; created_at: number; line_count?: number; }

export default function OperationsPage() {
  const [tab, setTab] = useState<"locations" | "picklists">("locations");
  const [locations, setLocations] = useState<Location[]>([]);
  const [pickLists, setPickLists] = useState<PickList[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewLocation, setShowNewLocation] = useState(false);
  const [newLoc, setNewLoc] = useState({ name: "", code: "", type: "bin", description: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [locRes, plRes] = await Promise.all([
        apiGet<{ items: Location[] }>("/api/v1/fulfillment/locations").catch(() => ({ items: [] as Location[] })),
        apiGet<{ items: PickList[] }>("/api/v1/fulfillment/pick-lists").catch(() => ({ items: [] as PickList[] })),
      ]);
      setLocations(locRes.items);
      setPickLists(plRes.items);
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

  const locationCols = [
    { key: "code", header: "Code", render: (r: Location) => <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded">{r.code}</span> },
    { key: "name", header: "Name", render: (r: Location) => <span className="font-medium text-gray-900">{r.name}</span> },
    { key: "type", header: "Type", render: (r: Location) => <Badge variant="blue">{r.type}</Badge> },
    { key: "desc", header: "Description", render: (r: Location) => <span className="text-gray-500">{r.description ?? "—"}</span> },
  ];

  const pickCols = [
    { key: "num", header: "Pick #", render: (r: PickList) => <span className="font-medium text-gray-900">{r.pick_number}</span> },
    { key: "status", header: "Status", render: (r: PickList) => <Badge variant={statusBadge(r.status)}>{r.status}</Badge> },
    { key: "assigned", header: "Assigned To", render: (r: PickList) => <span className="text-gray-500">{r.assigned_to ?? "Unassigned"}</span> },
    { key: "created", header: "Created", render: (r: PickList) => <span className="text-gray-500 text-xs">{new Date(r.created_at).toLocaleDateString()}</span> },
  ];

  return (
    <EnterpriseShell active="operations" title="Operations" subtitle="Locations & Pick/Pack" contentClassName="overflow-y-auto">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Tabs */}
        <div className="border-b border-gray-200">
          <nav className="flex gap-6">
            {(["locations", "picklists"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className={`pb-3 text-sm font-medium capitalize transition-colors border-b-2 ${tab === t ? "border-brand-600 text-brand-600" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t === "picklists" ? "Pick Lists" : "Locations"}
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
    </EnterpriseShell>
  );
}
