"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { apiGet, apiPost, apiPatch, ApiResponseError } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import type { GolfBooking, BookingStatus, GolfMember } from "@/api-client/types";

type BadgeVariant = "green" | "yellow" | "red" | "gray" | "blue" | "purple";

const STATUS_BADGE: Record<BookingStatus, BadgeVariant> = {
  confirmed: "green",
  pending: "yellow",
  cancelled: "gray",
  no_show: "red",
  completed: "blue",
};

interface BookingResponse { items: GolfBooking[]; total: number; }
interface MembersResponse { items: GolfMember[]; total: number; }

interface BookingFormState {
  slot_id: string;
  member_id: string;
  guest_name: string;
  guest_phone: string;
  players: string;
  cart_included: boolean;
  notes: string;
}

const BLANK_FORM: BookingFormState = {
  slot_id: "", member_id: "", guest_name: "", guest_phone: "",
  players: "1", cart_included: false, notes: "",
};

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function BookingModal({ initialSlotId, members, onClose, onSaved }: {
  initialSlotId: string;
  members: GolfMember[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<BookingFormState>({ ...BLANK_FORM, slot_id: initialSlotId });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const field = (k: keyof BookingFormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.member_id && !form.guest_name.trim()) {
      setError("Either select a member or enter a guest name.");
      return;
    }
    setSaving(true); setError(null);
    try {
      const selectedMember = members.find(m => m.id === form.member_id);
      await apiPost("/api/v1/golf/bookings", {
        slot_id: form.slot_id || undefined,
        member_id: form.member_id || null,
        member_name: selectedMember?.name ?? null,
        guest_name: form.guest_name.trim() || null,
        guest_phone: form.guest_phone.trim() || null,
        players: Number(form.players),
        cart_included: form.cart_included,
        notes: form.notes.trim() || null,
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiResponseError ? err.message : "Failed to create booking.");
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl flex flex-col max-h-[90vh]"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">New Booking</h2>
          <button type="button" onClick={onClose} aria-label="Close"
                  className="text-slate-400 hover:text-slate-600 text-xl leading-none">&times;</button>
        </div>
        <form id="booking-form" onSubmit={submit} className="flex-1 overflow-y-auto flex flex-col gap-3 px-5 py-4">
          {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bf-member">Member (optional)</label>
            <select id="bf-member" value={form.member_id} onChange={field("member_id")}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600">
              <option value="">— Walk-in / Guest —</option>
              {members.map(m => (
                <option key={m.id} value={m.id}>{m.name} ({m.membership_number})</option>
              ))}
            </select>
          </div>

          {!form.member_id && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bf-guest">Guest Name</label>
                <input id="bf-guest" type="text" value={form.guest_name} onChange={field("guest_name")} placeholder="Full name"
                       className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bf-phone">Phone</label>
                <input id="bf-phone" type="tel" value={form.guest_phone} onChange={field("guest_phone")} placeholder="+1 555…"
                       className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bf-players">Players</label>
              <input id="bf-players" type="number" min="1" max="8" value={form.players} onChange={field("players")} required
                     className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div className="flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                <input type="checkbox" checked={form.cart_included}
                       onChange={e => setForm(f => ({ ...f, cart_included: e.target.checked }))}
                       className="rounded accent-brand-600" />
                Include cart
              </label>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600" htmlFor="bf-notes">Notes</label>
            <textarea id="bf-notes" rows={2} value={form.notes} onChange={field("notes")} placeholder="Optional…"
                      className="w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
        </form>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="sm" type="submit" form="booking-form" disabled={saving}>
            {saving ? "Saving…" : "Create Booking"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function GolfBookingsPage() {
  const searchParams = useSearchParams();
  const initialSlot = searchParams?.get("slot") ?? "";

  const [bookings, setBookings] = useState<GolfBooking[]>([]);
  const [members, setMembers] = useState<GolfMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(!!initialSlot);
  const [filterDate, setFilterDate] = useState(todayISO());
  const [filterStatus, setFilterStatus] = useState("all");
  const [q, setQ] = useState("");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [bookRes, memRes] = await Promise.all([
        apiGet<BookingResponse>(`/api/v1/golf/bookings?date=${filterDate}`),
        apiGet<MembersResponse>("/api/v1/golf/members"),
      ]);
      setBookings(bookRes.items ?? []);
      setMembers(memRes.items ?? []);
    } catch (e) {
      setError(e instanceof ApiResponseError ? e.message : "Failed to load bookings.");
    } finally { setLoading(false); }
  }, [filterDate]);

  useEffect(() => { void load(); }, [load]);

  const visible = useMemo(() => {
    let list = bookings;
    if (filterStatus !== "all") list = list.filter(b => b.status === filterStatus);
    if (q.trim()) {
      const lq = q.toLowerCase();
      list = list.filter(b =>
        (b.member_name ?? "").toLowerCase().includes(lq) ||
        (b.guest_name ?? "").toLowerCase().includes(lq) ||
        b.tee_time.includes(lq),
      );
    }
    return list;
  }, [bookings, filterStatus, q]);

  async function updateStatus(id: string, status: BookingStatus) {
    setUpdatingId(id);
    try { await apiPatch(`/api/v1/golf/bookings/${id}`, { status }); await load(); }
    finally { setUpdatingId(null); }
  }

  const totalRevenue = visible.reduce((s, b) => s + b.total_cents, 0);
  const outstanding = visible.reduce((s, b) => s + Math.max(0, b.total_cents - b.paid_cents), 0);

  return (
    <EnterpriseShell active="golf-bookings" title="Bookings" subtitle="Tee time reservations"
      contentClassName="overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-6">

        {/* Sub-nav */}
        <div className="flex items-center gap-2 flex-wrap">
          <a href="/golf" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Tee Sheet</a>
          <a href="/golf/bookings" className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white">Bookings</a>
          <a href="/golf/members" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Members</a>
          <a href="/golf/pro-shop" className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">Pro Shop</a>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: "Bookings", value: String(visible.length), color: "text-slate-900" },
            { label: "Revenue", value: formatMoney(totalRevenue), color: "text-green-700" },
            { label: "Outstanding", value: formatMoney(outstanding), color: outstanding > 0 ? "text-amber-700" : "text-slate-400" },
            { label: "Confirmed", value: String(visible.filter(b => b.status === "confirmed").length), color: "text-blue-700" },
          ].map(c => (
            <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <p className="text-xs text-slate-500">{c.label}</p>
              <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2">
          <input type="date" value={filterDate} onChange={e => setFilterDate(e.target.value)}
                 className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600">
            <option value="all">All statuses</option>
            <option value="confirmed">Confirmed</option>
            <option value="pending">Pending</option>
            <option value="cancelled">Cancelled</option>
            <option value="no_show">No Show</option>
            <option value="completed">Completed</option>
          </select>
          <input type="search" placeholder="Search name…" value={q} onChange={e => setQ(e.target.value)}
                 className="w-44 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          <div className="ml-auto">
            <Button variant="primary" size="sm" onClick={() => setShowModal(true)}>+ New Booking</Button>
          </div>
        </div>

        {error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />)}
          </div>
        ) : visible.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 py-14 text-center">
            <p className="text-sm font-medium text-slate-600">No bookings match your filters</p>
            <button onClick={() => setShowModal(true)}
                    className="mt-3 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700">
              Create First Booking
            </button>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs font-medium text-slate-500 uppercase tracking-wide">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Guest / Member</th>
                  <th className="px-4 py-3 text-left">Details</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visible.map(b => (
                  <tr key={b.id} className={`transition-opacity ${updatingId === b.id ? "opacity-40" : ""}`}>
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {b.tee_time}
                      <span className="ml-1 text-xs text-slate-400">{b.holes}H</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">{b.member_name ?? b.guest_name ?? "—"}</p>
                      {b.guest_phone && <p className="text-xs text-slate-400">{b.guest_phone}</p>}
                      {b.member_id && <p className="text-xs text-slate-400">Member</p>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {b.players} player{b.players !== 1 ? "s" : ""}
                      {b.cart_included && " · Cart"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <p className="font-medium text-slate-900">{formatMoney(b.total_cents)}</p>
                      {b.paid_cents < b.total_cents && (
                        <p className="text-xs text-amber-600">Due: {formatMoney(b.total_cents - b.paid_cents)}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[b.status]}>{b.status.replace("_", " ")}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        {b.status === "confirmed" && (
                          <>
                            <button onClick={() => updateStatus(b.id, "completed")}
                                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
                              Complete
                            </button>
                            <button onClick={() => updateStatus(b.id, "no_show")}
                                    className="rounded border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50">
                              No Show
                            </button>
                            <button onClick={() => updateStatus(b.id, "cancelled")}
                                    className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50">
                              Cancel
                            </button>
                          </>
                        )}
                        {b.status === "pending" && (
                          <button onClick={() => updateStatus(b.id, "confirmed")}
                                  className="rounded border border-green-200 px-2 py-1 text-xs text-green-700 hover:bg-green-50">
                            Confirm
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showModal && (
        <BookingModal
          initialSlotId={initialSlot}
          members={members}
          onClose={() => setShowModal(false)}
          onSaved={() => { setShowModal(false); void load(); }}
        />
      )}
    </EnterpriseShell>
  );
}
