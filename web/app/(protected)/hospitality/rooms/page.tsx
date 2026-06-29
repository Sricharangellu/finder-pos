"use client";

import { useState, useEffect, useCallback } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Badge } from "@/components/Badge";
import { TableSkeleton } from "@/components/TableSkeleton";
import { apiGet, apiPost, apiPatch } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { HospitalityRoom, HospitalityRoomsResponse, RoomStatus, RoomFolioResponse } from "@/api-client/types";
import { clsx } from "clsx";

type BadgeVariant = "gray" | "blue" | "yellow" | "green" | "red" | "purple";

const STATUS_BADGE: Record<RoomStatus, BadgeVariant> = {
  available:   "green",
  occupied:    "blue",
  checkout:    "yellow",
  cleaning:    "gray",
  maintenance: "red",
};

const STATUS_LABEL: Record<RoomStatus, string> = {
  available:   "Available",
  occupied:    "Occupied",
  checkout:    "Checkout",
  cleaning:    "Cleaning",
  maintenance: "Maintenance",
};

const ALL_STATUSES: RoomStatus[] = ["available", "occupied", "checkout", "cleaning", "maintenance"];

interface CreateRoomForm { roomNumber: string; type: string; floor: string; rateCents: string; }
const EMPTY_FORM: CreateRoomForm = { roomNumber: "", type: "standard", floor: "1", rateCents: "10000" };

export default function HospitalityRoomsPage() {
  const [rooms, setRooms] = useState<HospitalityRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<RoomStatus | "all">("all");
  const [selected, setSelected] = useState<HospitalityRoom | null>(null);
  const [folio, setFolio] = useState<RoomFolioResponse | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showCharge, setShowCharge] = useState(false);
  const [chargeDesc, setChargeDesc] = useState("");
  const [chargeAmount, setChargeAmount] = useState("");
  const [form, setForm] = useState<CreateRoomForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const data = await apiGet<HospitalityRoomsResponse>("/api/v1/hospitality/rooms");
      setRooms(data.items ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : "Failed to load rooms"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadFolio = useCallback(async (room: HospitalityRoom) => {
    setSelected(room); setFolio(null);
    try {
      const data = await apiGet<RoomFolioResponse>(`/api/v1/hospitality/rooms/${room.id}/folio`);
      setFolio(data);
    } catch { setFolio(null); }
  }, []);

  const visible = statusFilter === "all" ? rooms : rooms.filter(r => r.status === statusFilter);
  const counts = ALL_STATUSES.reduce<Record<string, number>>((a, s) => { a[s] = rooms.filter(r => r.status === s).length; return a; }, {});

  async function createRoom() {
    if (!form.roomNumber.trim()) return;
    setSaving(true);
    try {
      await apiPost("/api/v1/hospitality/rooms", { roomNumber: form.roomNumber.trim(), type: form.type, floor: form.floor, rateCents: parseInt(form.rateCents) || 0 });
      setShowCreate(false); setForm(EMPTY_FORM); await load();
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  async function setStatus(roomId: string, status: RoomStatus) {
    try { await apiPatch(`/api/v1/hospitality/rooms/${roomId}/status`, { status }); await load(); setSelected(null); }
    catch (e) { alert(e instanceof Error ? e.message : "Failed"); }
  }

  async function postCharge() {
    if (!selected || !chargeDesc.trim() || !chargeAmount) return;
    setSaving(true);
    try {
      await apiPost(`/api/v1/hospitality/rooms/${selected.id}/charge`, { description: chargeDesc.trim(), amountCents: Math.round(parseFloat(chargeAmount) * 100) });
      setShowCharge(false); setChargeDesc(""); setChargeAmount("");
      await loadFolio(selected);
    } catch (e) { alert(e instanceof Error ? e.message : "Failed"); } finally { setSaving(false); }
  }

  return (
    <EnterpriseShell active="hospitality-rooms" title="Rooms" subtitle="Guest room management & folio posting">
      <div className="flex flex-col gap-6 p-6">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {ALL_STATUSES.map(s => (
            <Card key={s} className="p-4 cursor-pointer hover:shadow-md transition-shadow" onClick={() => setStatusFilter(f => f === s ? "all" : s)}>
              <p className="text-xs text-[rgba(0,0,0,0.45)] uppercase tracking-wide">{STATUS_LABEL[s]}</p>
              <p className={clsx("mt-1 text-2xl font-bold", statusFilter === s && "text-brand-600")}>{counts[s] ?? 0}</p>
            </Card>
          ))}
        </div>
        <div className="flex justify-end">
          <Button size="sm" onClick={() => setShowCreate(true)}>+ Add Room</Button>
        </div>
        {loading && <TableSkeleton rows={6} cols={5} />}
        {error && <p className="text-red-600 text-sm py-4">{error}</p>}
        {!loading && (
          <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {visible.map(room => (
              <button key={room.id} type="button" onClick={() => void loadFolio(room)}
                className={clsx("rounded-lg border-2 p-4 text-left transition-all hover:shadow-md",
                  room.status === "available" && "border-emerald-300 bg-emerald-50",
                  room.status === "occupied" && "border-blue-300 bg-blue-50",
                  room.status === "checkout" && "border-amber-300 bg-amber-50",
                  room.status === "cleaning" && "border-gray-200 bg-gray-50",
                  room.status === "maintenance" && "border-red-200 bg-red-50",
                )}>
                <div className="flex items-center justify-between">
                  <span className="text-xl font-bold">{room.room_number}</span>
                  <Badge variant={STATUS_BADGE[room.status]} size="sm">{STATUS_LABEL[room.status]}</Badge>
                </div>
                <p className="mt-1 text-xs text-[rgba(0,0,0,0.45)] capitalize">{room.type} · Floor {room.floor ?? "—"}</p>
                <p className="mt-0.5 text-xs font-medium">{formatMoney(room.rate_cents)}/night</p>
              </button>
            ))}
            {visible.length === 0 && (
              <div className="col-span-full p-12 text-center text-sm text-[rgba(0,0,0,0.45)]">No rooms found. Add your first room to get started.</div>
            )}
          </div>
        )}

        {/* Room detail / folio */}
        {selected && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setSelected(null)}>
            <div className="w-full max-w-md rounded-xl bg-white shadow-2xl p-6 overflow-y-auto max-h-[90vh]" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold">Room {selected.room_number}</h3>
                  <p className="text-xs text-[rgba(0,0,0,0.45)] capitalize">{selected.type} · Floor {selected.floor ?? "—"} · {formatMoney(selected.rate_cents)}/night</p>
                </div>
                <Badge variant={STATUS_BADGE[selected.status]}>{STATUS_LABEL[selected.status]}</Badge>
              </div>
              {folio && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <h4 className="text-sm font-semibold text-[rgba(0,0,0,0.65)]">Guest Folio</h4>
                    <span className="text-sm font-bold">{formatMoney(folio.total_cents)} total</span>
                  </div>
                  {folio.charges.length === 0 && <p className="text-xs text-[rgba(0,0,0,0.35)]">No charges posted.</p>}
                  <div className="space-y-1 max-h-40 overflow-y-auto">
                    {folio.charges.map(c => (
                      <div key={c.id} className="flex items-center justify-between text-xs">
                        <span className="text-[rgba(0,0,0,0.65)]">{c.description}</span>
                        <span className="font-medium">{formatMoney(c.amount_cents)}</span>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" className="mt-3 w-full" variant="secondary" onClick={() => setShowCharge(true)}>+ Post Charge</Button>
                </div>
              )}
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-[rgba(0,0,0,0.45)] uppercase tracking-wide">Change Status</h4>
                <div className="grid grid-cols-2 gap-2">
                  {ALL_STATUSES.filter(s => s !== selected.status).map(s => (
                    <button key={s} type="button" onClick={() => void setStatus(selected.id, s)}
                      className="rounded border border-[#D9D9D9] px-3 py-1.5 text-xs text-[rgba(0,0,0,0.65)] hover:bg-[#F5F5F5]">
                      Set {STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="mt-4 w-full rounded border border-[#D9D9D9] py-1.5 text-xs text-[rgba(0,0,0,0.45)] hover:bg-[#F5F5F5]">Close</button>
            </div>
          </div>
        )}

        {/* Post charge modal */}
        {showCharge && selected && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCharge(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Post Charge — Room {selected.room_number}</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Description *</label>
                  <input type="text" placeholder="Room service, minibar…" value={chargeDesc} onChange={e => setChargeDesc(e.target.value)} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[rgba(0,0,0,0.65)] mb-1">Amount ($) *</label>
                  <input type="number" min="0.01" step="0.01" placeholder="0.00" value={chargeAmount} onChange={e => setChargeAmount(e.target.value)} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCharge(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void postCharge()} loading={saving}>Post</Button>
              </div>
            </div>
          </div>
        )}

        {/* Create room modal */}
        {showCreate && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCreate(false)}>
            <div className="w-full max-w-sm rounded-xl bg-white shadow-2xl p-6" onClick={e => e.stopPropagation()}>
              <h3 className="text-lg font-bold mb-4">Add Room</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium mb-1">Room Number *</label>
                  <input type="text" placeholder="101, A-201…" value={form.roomNumber} onChange={e => setForm(f => ({ ...f, roomNumber: e.target.value }))} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" autoFocus />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium mb-1">Type</label>
                    <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm">
                      {["standard","deluxe","suite","penthouse","single","double","twin","family"].map(t => <option key={t} value={t} className="capitalize">{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1">Floor</label>
                    <input type="text" placeholder="1" value={form.floor} onChange={e => setForm(f => ({ ...f, floor: e.target.value }))} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1">Nightly Rate ($)</label>
                  <input type="number" min="0" step="0.01" value={(parseInt(form.rateCents) / 100).toFixed(2)} onChange={e => setForm(f => ({ ...f, rateCents: String(Math.round(parseFloat(e.target.value) * 100)) }))} className="w-full rounded border border-[#D9D9D9] px-2 py-1 text-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Cancel</Button>
                <Button size="sm" onClick={() => void createRoom()} loading={saving}>Create</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </EnterpriseShell>
  );
}
