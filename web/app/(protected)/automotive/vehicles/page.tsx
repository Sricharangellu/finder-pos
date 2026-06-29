"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost } from "@/api-client/client";
import type { Vehicle, VehiclesResponse } from "@/api-client/types";

interface CreateVehicleForm { vin: string; make: string; model: string; year: string; color: string; licensePlate: string; customerName: string; }
const EMPTY_FORM: CreateVehicleForm = { vin: "", make: "", model: "", year: new Date().getFullYear().toString(), color: "", licensePlate: "", customerName: "" };

export default function AutomotiveVehiclesPage() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Vehicle | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateVehicleForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<VehiclesResponse>("/api/v1/automotive/vehicles");
      setVehicles(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load vehicles"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createVehicle() {
    if (!form.vin.trim() || !form.make.trim() || !form.model.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/automotive/vehicles", {
        vin: form.vin.trim().toUpperCase(),
        make: form.make.trim(),
        model: form.model.trim(),
        year: parseInt(form.year) || new Date().getFullYear(),
        color: form.color.trim() || undefined,
        licensePlate: form.licensePlate.trim() || undefined,
        customerName: form.customerName.trim() || undefined,
      });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  const filtered = vehicles.filter(v =>
    search === "" ||
    [v.vin ?? "", v.make, v.model, v.license_plate ?? "", v.customer_name ?? ""].some(f => f.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <EnterpriseShell active="automotive-vehicles" title="Vehicles" subtitle="Vehicle registry & owner records">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-3 gap-3">
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Total Vehicles</p>
            <p className="mt-1 text-2xl font-bold">{vehicles.length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">With Owner Info</p>
            <p className="mt-1 text-2xl font-bold">{vehicles.filter(v => v.customer_name).length}</p>
          </Card>
          <Card className="p-4">
            <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">With VIN</p>
            <p className="mt-1 text-2xl font-bold">{vehicles.filter(v => v.vin).length}</p>
          </Card>
        </div>

        <div className="flex items-center gap-3">
          <input type="text" placeholder="Search by VIN, make, model, plate…" value={search} onChange={e => setSearch(e.target.value)}
            className="flex-1 rounded border border-[#D9D9D9] px-3 py-1.5 text-sm" />
          <Button size="sm" onClick={() => setShowCreate(true)}>+ Add Vehicle</Button>
        </div>

        {loading && <TableSkeleton rows={5} cols={6} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}

        {!loading && (
          <div className="overflow-hidden rounded-lg border border-[#E8E8E8] bg-white">
            {filtered.length === 0 ? (
              <div className="p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No vehicles found. Add the first vehicle to get started.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#F0F0F0] bg-[#FAFAFA]">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Vehicle</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">VIN</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Plate</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Color</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(v => (
                    <tr key={v.id} className="border-b border-[#F0F0F0] cursor-pointer hover:bg-[#FAFAFA]" onClick={() => setSelected(v)}>
                      <td className="px-4 py-3 font-medium text-[rgba(0,0,0,0.88)]">{v.year} {v.make} {v.model}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[rgba(0,0,0,0.65)]">{v.vin ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{v.license_plate ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)] capitalize">{v.color ?? "—"}</td>
                      <td className="px-4 py-3 text-[rgba(0,0,0,0.65)]">{v.customer_name ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* Detail modal */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-1">{selected.year} {selected.make} {selected.model}</h3>
              <p className="text-xs text-[rgba(0,0,0,0.45)] font-mono mb-4">VIN: {selected.vin ?? "—"}</p>
              <div className="space-y-2 text-sm mb-4">
                {selected.license_plate && <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">License Plate</span><span>{selected.license_plate}</span></div>}
                {selected.color && <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Color</span><span className="capitalize">{selected.color}</span></div>}
                {selected.customer_name && <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Owner</span><span>{selected.customer_name}</span></div>}
                <div className="flex justify-between"><span className="text-[rgba(0,0,0,0.45)]">Mileage</span><span>{selected.mileage.toLocaleString()} mi</span></div>
              </div>
              {selected.notes && <p className="mb-4 text-xs text-[rgba(0,0,0,0.55)] bg-[#FAFAFA] rounded p-2">{selected.notes}</p>}
              <button type="button" onClick={() => setSelected(null)} className="w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Create modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Vehicle</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">VIN *</label>
                  <input type="text" placeholder="1HGCM82633A123456" value={form.vin}
                    onChange={e => setForm(f => ({ ...f, vin: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm font-mono" autoFocus maxLength={17} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <div className="col-span-1">
                    <label className="block text-xs font-medium mb-1">Year</label>
                    <input type="number" min="1900" max="2099" value={form.year}
                      onChange={e => setForm(f => ({ ...f, year: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-medium mb-1">Make *</label>
                    <input type="text" placeholder="Toyota" value={form.make}
                      onChange={e => setForm(f => ({ ...f, make: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                  <div className="col-span-1">
                    <label className="block text-xs font-medium mb-1">Model *</label>
                    <input type="text" placeholder="Camry" value={form.model}
                      onChange={e => setForm(f => ({ ...f, model: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-medium mb-1">Color</label>
                    <input type="text" placeholder="Silver" value={form.color}
                      onChange={e => setForm(f => ({ ...f, color: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">License Plate</label>
                    <input type="text" placeholder="ABC-1234" value={form.licensePlate}
                      onChange={e => setForm(f => ({ ...f, licensePlate: e.target.value }))}
                      className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Owner Name</label>
                  <input type="text" placeholder="John Smith" value={form.customerName}
                    onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))}
                    className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createVehicle()} loading={saving}>Add</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
