"use client";

/**
 * FE-H1: Hospitality — Room grid with status badges + charge modal.
 * Module-gated by module:room_billing.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, apiPatch, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDateTime } from "@/lib/date";

interface Room {
  id: string;
  room_number: string;
  type: string;
  floor: string | null;
  rate_cents: number;
  status: "available" | "occupied" | "checkout" | "cleaning" | "maintenance";
  notes: string | null;
}

interface RoomCharge {
  id: string;
  description: string;
  amount_cents: number;
  posted_at: number;
  settled_at: number | null;
}

const STATUS_STYLE: Record<string, { bg: string; label: string; badge: "green" | "red" | "yellow" | "gray" | "blue" }> = {
  available:   { bg: "bg-green-50 border-green-300",  label: "Available",   badge: "green" },
  occupied:    { bg: "bg-red-50 border-red-300",      label: "Occupied",    badge: "red" },
  checkout:    { bg: "bg-amber-50 border-amber-300",  label: "Check-out",   badge: "yellow" },
  cleaning:    { bg: "bg-blue-50 border-blue-300",    label: "Cleaning",    badge: "blue" },
  maintenance: { bg: "bg-gray-50 border-gray-300",    label: "Maintenance", badge: "gray" },
};

const STATUS_SEQUENCE: Record<string, string> = {
  available: "occupied", occupied: "checkout", checkout: "cleaning", cleaning: "available",
};

export default function HospitalityPage() {
  const [rooms, setRooms]             = useState<Room[]>([]);
  const [loading, setLoading]         = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const [selected, setSelected]       = useState<Room | null>(null);
  const [charges, setCharges]         = useState<RoomCharge[]>([]);
  const [chargeModal, setChargeModal] = useState(false);
  const [addModal, setAddModal]       = useState(false);
  const [saving, setSaving]           = useState(false);
  const [advancing, setAdvancing]     = useState<string | null>(null);
  const [chargeForm, setChargeForm]   = useState({ description: "", amountCents: "" });
  const [roomForm, setRoomForm]       = useState({ roomNumber: "", type: "standard", floor: "", rateCents: "" });

  const loadRooms = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: Room[] }>("/api/v1/hospitality/rooms")
        .then(r => setRooms(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  const loadCharges = (roomId: string) => {
    safeLoad(
      apiGet<{ items: RoomCharge[] }>(`/api/v1/hospitality/rooms/${roomId}/charges`)
        .then(r => setCharges(r.items ?? [])),
    );
  };

  useEffect(() => { loadRooms(); }, []);

  const openRoom = (room: Room) => { setSelected(room); loadCharges(room.id); };

  const advanceStatus = async (room: Room) => {
    const next = STATUS_SEQUENCE[room.status];
    if (!next) return;
    setAdvancing(room.id);
    try {
      await apiPatch(`/api/v1/hospitality/rooms/${room.id}/status`, { status: next });
      loadRooms();
      if (selected?.id === room.id) setSelected({ ...room, status: next as Room["status"] });
    } finally { setAdvancing(null); }
  };

  const handleCharge = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/hospitality/rooms/${selected.id}/charge`, {
        description: chargeForm.description,
        amountCents: Number(chargeForm.amountCents),
      });
      setChargeModal(false);
      setChargeForm({ description: "", amountCents: "" });
      loadCharges(selected.id);
    } finally { setSaving(false); }
  };

  const handleSettle = async () => {
    if (!selected) return;
    await apiPost(`/api/v1/hospitality/rooms/${selected.id}/settle`, {});
    loadCharges(selected.id);
  };

  const handleAddRoom = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/hospitality/rooms", {
        roomNumber: roomForm.roomNumber,
        type: roomForm.type,
        floor: roomForm.floor || undefined,
        rateCents: Number(roomForm.rateCents) || 0,
      });
      setAddModal(false);
      setRoomForm({ roomNumber: "", type: "standard", floor: "", rateCents: "" });
      loadRooms();
    } finally { setSaving(false); }
  };

  const STATUS_FILTERS = ["all", "available", "occupied", "checkout", "cleaning", "maintenance"];
  const visible = filterStatus === "all" ? rooms : rooms.filter(r => r.status === filterStatus);
  const unsettled = charges.filter(c => !c.settled_at);

  return (
    <EnterpriseShell active="hospitality" title="Rooms" subtitle="Hotel room management and guest folios">
      <div className="mx-auto w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 grid grid-cols-1 lg:grid-cols-5">

        {/* Room grid (3 cols) */}
        <div className="lg:col-span-3 space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex gap-1 flex-wrap">
              {STATUS_FILTERS.map(s => (
                <button key={s} type="button" onClick={() => setFilterStatus(s)}
                  className={`rounded-full px-3 py-1 text-xs font-medium capitalize transition-colors ${
                    filterStatus === s ? "bg-brand-600 text-white" : "bg-gray-100 text-[var(--color-text-secondary)] hover:bg-gray-200"
                  }`}>
                  {s === "all" ? `All (${rooms.length})` : `${s} (${rooms.filter(r => r.status === s).length})`}
                </button>
              ))}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setAddModal(true)}>+ Room</Button>
          </div>

          {loading ? (
            <div className="grid grid-cols-3 gap-3">
              {[1,2,3,4,5,6].map(i => <div key={i} className="h-28 animate-pulse rounded-xl bg-gray-100" />)}
            </div>
          ) : visible.length === 0 ? (
            <Card><p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No rooms found.</p></Card>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {visible.map(room => {
                const style = STATUS_STYLE[room.status] ?? STATUS_STYLE.available;
                return (
                  <button key={room.id} type="button"
                    onClick={() => openRoom(room)}
                    className={`rounded-xl border-2 p-4 text-left transition-all hover:shadow-md ${style.bg} ${
                      selected?.id === room.id ? "ring-2 ring-brand-500" : ""
                    }`}>
                    <p className="text-lg font-bold text-[var(--color-text-primary)]">{room.room_number}</p>
                    <p className="text-xs text-[var(--color-text-secondary)] capitalize">{room.type}{room.floor ? ` · Fl ${room.floor}` : ""}</p>
                    <div className="mt-2">
                      <Badge variant={style.badge} size="sm">{style.label}</Badge>
                    </div>
                    <p className="mt-1.5 text-xs font-medium text-[var(--color-text-secondary)]">
                      {formatMoney(room.rate_cents)}/night
                    </p>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Room detail panel (2 cols) */}
        <div className="lg:col-span-2">
          {!selected ? (
            <Card>
              <div className="py-16 text-center">
                <p className="text-2xl">🏨</p>
                <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Select a room to view details</p>
              </div>
            </Card>
          ) : (
            <div className="space-y-3">
              <Card>
                <div className="space-y-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="text-base font-bold text-[var(--color-text-primary)]">Room {selected.room_number}</h3>
                      <p className="text-sm capitalize text-[var(--color-text-secondary)]">
                        {selected.type}{selected.floor ? ` · Floor ${selected.floor}` : ""}
                      </p>
                      <p className="text-sm text-[var(--color-text-secondary)]">{formatMoney(selected.rate_cents)}/night</p>
                    </div>
                    <Badge variant={STATUS_STYLE[selected.status]?.badge ?? "gray"} size="sm">
                      {STATUS_STYLE[selected.status]?.label ?? selected.status}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    {STATUS_SEQUENCE[selected.status] && (
                      <Button variant="primary" size="sm" fullWidth
                        loading={advancing === selected.id}
                        onClick={() => advanceStatus(selected)}>
                        Mark {STATUS_SEQUENCE[selected.status]}
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" fullWidth onClick={() => setChargeModal(true)}>
                      + Charge
                    </Button>
                  </div>
                </div>
              </Card>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">
                    Folio ({charges.length}) {unsettled.length > 0 && `· ${formatMoney(unsettled.reduce((s,c) => s + c.amount_cents, 0))} outstanding`}
                  </h4>
                  {unsettled.length > 0 && (
                    <Button variant="secondary" size="sm" onClick={handleSettle}>Settle All</Button>
                  )}
                </div>
                {charges.length === 0 ? (
                  <Card><p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No charges.</p></Card>
                ) : (
                  <div className="space-y-1.5">
                    {charges.map(c => (
                      <div key={c.id} className="flex items-center justify-between rounded-lg border border-[var(--color-table-border)] bg-white px-3 py-2">
                        <div>
                          <p className="text-sm font-medium text-[var(--color-text-primary)]">{c.description}</p>
                          <p className="text-xs text-[var(--color-text-secondary)]">
                            {fmtDateTime(c.posted_at)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-[var(--color-text-primary)]">{formatMoney(c.amount_cents)}</p>
                          <Badge variant={c.settled_at ? "green" : "yellow"} size="sm">
                            {c.settled_at ? "Settled" : "Pending"}
                          </Badge>
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

      {/* Post charge modal */}
      <Modal open={chargeModal} onClose={() => setChargeModal(false)} title={`Post Charge — Room ${selected?.room_number}`}>
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Description *</label>
            <input type="text" value={chargeForm.description}
              onChange={e => setChargeForm(f => ({ ...f, description: e.target.value }))}
              placeholder="e.g. Restaurant dinner, Mini bar, Room service"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Amount (cents) *</label>
            <input type="number" min={1} value={chargeForm.amountCents}
              onChange={e => setChargeForm(f => ({ ...f, amountCents: e.target.value }))}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setChargeModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCharge}
              disabled={!chargeForm.description || !chargeForm.amountCents}>Post</Button>
          </div>
        </div>
      </Modal>

      {/* Add room modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Add Room">
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Room number *</label>
            <input type="text" value={roomForm.roomNumber}
              onChange={e => setRoomForm(f => ({ ...f, roomNumber: e.target.value }))}
              placeholder="101"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Type</label>
              <select value={roomForm.type} onChange={e => setRoomForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600">
                {["standard","deluxe","suite","penthouse","dormitory"].map(t => (
                  <option key={t} value={t} className="capitalize">{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Floor</label>
              <input type="text" value={roomForm.floor}
                onChange={e => setRoomForm(f => ({ ...f, floor: e.target.value }))}
                placeholder="1"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Rate (cents/night)</label>
            <input type="number" min={0} value={roomForm.rateCents}
              onChange={e => setRoomForm(f => ({ ...f, rateCents: e.target.value }))}
              placeholder="15000"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setAddModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleAddRoom}
              disabled={!roomForm.roomNumber}>Add</Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
