"use client";

/**
 * FE-A1: Automotive — vehicles list + work order sidebar.
 * Module-gated by module:automotive.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number | null;
  license_plate: string | null;
  vin: string | null;
  color: string | null;
  mileage: number | null;
  customer_id: string | null;
}

interface WorkOrder {
  id: string;
  vehicle_id: string;
  description: string;
  status: string;
  labour_cents: number;
  parts_cents: number;
  total_cents: number;
  mileage_in: number | null;
  mileage_out: number | null;
  started_at: number | null;
  completed_at: number | null;
  created_at: number;
}

interface VehicleDetail extends Vehicle {
  workOrders: WorkOrder[];
}

const STATUS_BADGE: Record<string, "gray" | "blue" | "yellow" | "green" | "red"> = {
  open:        "blue",
  in_progress: "yellow",
  completed:   "green",
  cancelled:   "red",
};

export default function AutomotivePage() {
  const [vehicles, setVehicles]       = useState<Vehicle[]>([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState("");
  const [selected, setSelected]       = useState<VehicleDetail | null>(null);
  const [detailLoading, setDetailLoad] = useState(false);
  const [vehicleModal, setVehicleModal] = useState(false);
  const [woModal, setWoModal]         = useState(false);
  const [saving, setSaving]           = useState(false);
  const [advancing, setAdvancing]     = useState<string | null>(null);
  const [vForm, setVForm]             = useState({ make: "", model: "", year: "", licensePlate: "", vin: "", color: "" });
  const [woForm, setWoForm]           = useState({ description: "", labourCents: "", partsCents: "" });

  const load = (search = "") => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Vehicle[] }>(`/api/v1/automotive/vehicles${search ? `?q=${encodeURIComponent(search)}` : ""}`)
        .then(r => setVehicles(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  const openDetail = (id: string) => {
    setDetailLoad(true);
    safeLoad(
      apiGet<VehicleDetail>(`/api/v1/automotive/vehicles/${id}`)
        .then(r => setSelected(r))
        .finally(() => setDetailLoad(false)),
    );
  };

  useEffect(() => { load(); }, []);

  const handleSearch = (v: string) => { setQ(v); load(v); };

  const handleCreateVehicle = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/automotive/vehicles", {
        make: vForm.make, model: vForm.model,
        year: vForm.year ? Number(vForm.year) : undefined,
        licensePlate: vForm.licensePlate || undefined,
        vin: vForm.vin || undefined,
        color: vForm.color || undefined,
      });
      setVehicleModal(false);
      setVForm({ make: "", model: "", year: "", licensePlate: "", vin: "", color: "" });
      load(q);
    } finally { setSaving(false); }
  };

  const handleCreateWO = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/automotive/work-orders", {
        vehicleId: selected.id,
        description: woForm.description,
        labourCents: Number(woForm.labourCents) || 0,
        partsCents: Number(woForm.partsCents) || 0,
      });
      setWoModal(false);
      setWoForm({ description: "", labourCents: "", partsCents: "" });
      openDetail(selected.id);
    } finally { setSaving(false); }
  };

  const STATUS_NEXT: Record<string, string> = {
    open: "in_progress", in_progress: "completed",
  };

  const advanceWO = async (woId: string, currentStatus: string) => {
    const nextStatus = STATUS_NEXT[currentStatus];
    if (!nextStatus || !selected) return;
    setAdvancing(woId);
    try {
      await apiPatch(`/api/v1/automotive/work-orders/${woId}`, { status: nextStatus });
      openDetail(selected.id);
    } finally { setAdvancing(null); }
  };

  return (
    <EnterpriseShell active="automotive" title="Automotive" subtitle="Vehicles and work orders">
      <div className="mx-auto w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 grid grid-cols-1 lg:grid-cols-5">

        {/* Vehicle list */}
        <div className="lg:col-span-2 space-y-3">
          <div className="flex gap-2">
            <input
              type="search"
              value={q}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search make, model, plate, VIN…"
              className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
            />
            <Button variant="primary" size="sm" onClick={() => setVehicleModal(true)}>+ Vehicle</Button>
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : vehicles.length === 0 ? (
            <Card>
              <p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No vehicles found.</p>
            </Card>
          ) : (
            <div className="space-y-1.5">
              {vehicles.map(v => (
                <button key={v.id} type="button"
                  onClick={() => openDetail(v.id)}
                  className={`w-full rounded-xl border p-3 text-left transition-colors hover:border-brand-400 hover:bg-brand-50 ${
                    selected?.id === v.id ? "border-brand-600 bg-brand-50" : "border-[var(--color-table-border)] bg-white"
                  }`}>
                  <p className="text-sm font-semibold text-[var(--color-text-primary)]">
                    {v.year ? `${v.year} ` : ""}{v.make} {v.model}
                  </p>
                  <p className="text-xs text-[var(--color-text-secondary)]">
                    {[v.license_plate, v.color].filter(Boolean).join(" · ") || "No plate"}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Work orders panel */}
        <div className="lg:col-span-3">
          {!selected && !detailLoading && (
            <Card>
              <div className="py-16 text-center">
                <p className="text-2xl">🚗</p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Select a vehicle to view work orders</p>
              </div>
            </Card>
          )}
          {detailLoading && <div className="h-64 animate-pulse rounded-xl bg-gray-100" />}
          {selected && !detailLoading && (
            <div className="space-y-4">
              <Card>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-bold text-[var(--color-text-primary)]">
                      {selected.year ? `${selected.year} ` : ""}{selected.make} {selected.model}
                    </h3>
                    <p className="text-sm text-[var(--color-text-secondary)]">
                      {[selected.license_plate && `Plate: ${selected.license_plate}`,
                        selected.vin && `VIN: ${selected.vin}`,
                        selected.color,
                        selected.mileage && `${selected.mileage.toLocaleString()} km`,
                      ].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setWoModal(true)}>+ Work Order</Button>
                </div>
              </Card>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">
                  Work Orders ({selected.workOrders.length})
                </h4>
                {selected.workOrders.length === 0 ? (
                  <Card>
                    <p className="py-6 text-center text-sm text-[var(--color-text-secondary)]">No work orders yet.</p>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {selected.workOrders.map(wo => (
                      <div key={wo.id}
                        className="rounded-xl border border-[var(--color-table-border)] bg-white p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{wo.description}</p>
                            <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                              Labour: {formatMoney(wo.labour_cents)} · Parts: {formatMoney(wo.parts_cents)} · Total: {formatMoney(wo.total_cents)}
                            </p>
                            {wo.mileage_in && (
                              <p className="mt-0.5 text-xs text-[var(--color-text-secondary)]">
                                Mileage in: {wo.mileage_in.toLocaleString()}
                                {wo.mileage_out ? ` / out: ${wo.mileage_out.toLocaleString()}` : ""}
                              </p>
                            )}
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1.5">
                            <Badge variant={STATUS_BADGE[wo.status] ?? "gray"} size="sm">
                              {wo.status.replace("_", " ")}
                            </Badge>
                            {STATUS_NEXT[wo.status] && (
                              <Button
                                variant="secondary"
                                size="sm"
                                loading={advancing === wo.id}
                                onClick={() => advanceWO(wo.id, wo.status)}
                              >
                                {wo.status === "open" ? "Start" : "Complete"}
                              </Button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Add vehicle modal */}
      <Modal open={vehicleModal} onClose={() => setVehicleModal(false)} title="Add Vehicle">
        <div className="space-y-3 p-4">
          {[
            { key: "make",         label: "Make *",         placeholder: "Toyota" },
            { key: "model",        label: "Model *",        placeholder: "Camry" },
            { key: "year",         label: "Year",           placeholder: "2022" },
            { key: "licensePlate", label: "License plate",  placeholder: "ABC-1234" },
            { key: "vin",          label: "VIN",            placeholder: "1HGCM82633A004352" },
            { key: "color",        label: "Color",          placeholder: "Silver" },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">{label}</label>
              <input type="text" placeholder={placeholder}
                value={vForm[key as keyof typeof vForm]}
                onChange={e => setVForm(f => ({ ...f, [key]: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setVehicleModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateVehicle}
              disabled={!vForm.make || !vForm.model}>
              Add Vehicle
            </Button>
          </div>
        </div>
      </Modal>

      {/* New work order modal */}
      <Modal open={woModal} onClose={() => setWoModal(false)} title="New Work Order">
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Description *</label>
            <textarea rows={2} value={woForm.description}
              onChange={e => setWoForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Oil change + filter replacement"
              className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Labour (cents)</label>
              <input type="number" min={0} value={woForm.labourCents}
                onChange={e => setWoForm(f => ({ ...f, labourCents: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Parts (cents)</label>
              <input type="number" min={0} value={woForm.partsCents}
                onChange={e => setWoForm(f => ({ ...f, partsCents: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setWoModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateWO}
              disabled={!woForm.description}>
              Create
            </Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
