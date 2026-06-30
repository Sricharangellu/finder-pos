"use client";

/**
 * FE-E1: Entertainment — event list, ticket sales, QR redemption.
 * Module-gated by module:tickets.
 */

import { useEffect, useState } from "react";
import { EnterpriseShell } from "@/components/EnterpriseShell";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Modal } from "@/components/Modal";
import { Badge } from "@/components/Badge";
import { apiGet, apiPost, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";

interface FEvent {
  id: string;
  name: string;
  venue: string | null;
  starts_at: number;
  ends_at: number;
  capacity: number;
  sold: number;
  available: number;
  price_cents: number;
  status: string;
  description: string | null;
}

const STATUS_BADGE: Record<string, "green" | "yellow" | "gray" | "red"> = {
  on_sale: "green", sold_out: "red", cancelled: "gray", ended: "gray",
};

export default function EntertainmentPage() {
  const [events, setEvents]         = useState<FEvent[]>([]);
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState<FEvent | null>(null);
  const [eventModal, setEventModal] = useState(false);
  const [sellModal, setSellModal]   = useState(false);
  const [redeemModal, setRedeemModal] = useState(false);
  const [saving, setSaving]         = useState(false);
  const [qrCode, setQrCode]         = useState("");
  const [redeemResult, setRedeemResult] = useState<{ success: boolean; message: string } | null>(null);
  const [eForm, setEForm] = useState({ name: "", venue: "", startsAt: "", endsAt: "", capacity: "100", priceCents: "0", description: "" });
  const [sForm, setSForm] = useState({ quantity: "1" });
  const [soldTickets, setSoldTickets] = useState<{ id: string; qr_code: string }[]>([]);

  const loadEvents = () => {
    setLoading(true);
    safeLoad(
      apiGet<{ items: FEvent[] }>("/api/v1/entertainment/events")
        .then(r => setEvents(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  };

  useEffect(() => { loadEvents(); }, []);

  const handleCreateEvent = async () => {
    setSaving(true);
    try {
      await apiPost("/api/v1/entertainment/events", {
        name: eForm.name,
        venue: eForm.venue || undefined,
        startsAt: new Date(eForm.startsAt).getTime(),
        endsAt: new Date(eForm.endsAt).getTime(),
        capacity: Number(eForm.capacity),
        priceCents: Number(eForm.priceCents),
        description: eForm.description || undefined,
      });
      setEventModal(false);
      setEForm({ name: "", venue: "", startsAt: "", endsAt: "", capacity: "100", priceCents: "0", description: "" });
      loadEvents();
    } finally { setSaving(false); }
  };

  const handleSellTickets = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const result = await apiPost<{ tickets: { id: string; qr_code: string }[] }>(
        `/api/v1/entertainment/events/${selected.id}/sell`,
        { quantity: Number(sForm.quantity) },
      );
      setSoldTickets(result.tickets ?? []);
      loadEvents();
    } finally { setSaving(false); }
  };

  const handleRedeem = async () => {
    if (!qrCode) return;
    setSaving(true);
    setRedeemResult(null);
    try {
      await apiPost("/api/v1/entertainment/tickets/redeem", { qrCode });
      setRedeemResult({ success: true, message: "Ticket redeemed successfully!" });
      setQrCode("");
    } catch {
      setRedeemResult({ success: false, message: "Invalid or already redeemed ticket." });
    } finally { setSaving(false); }
  };

  const openSellModal = (e: FEvent) => {
    setSelected(e);
    setSoldTickets([]);
    setSellModal(true);
  };

  const pctSold = (e: FEvent) => Math.round((e.sold / e.capacity) * 100);

  return (
    <EnterpriseShell active="entertainment" title="Events & Tickets" subtitle="Manage events, sell and redeem tickets">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-4 py-5 sm:px-6">

        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)]">{events.length} events</h2>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRedeemModal(true)}>Redeem Ticket</Button>
            <Button variant="primary" size="sm" onClick={() => setEventModal(true)}>+ Event</Button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-100" />)}
          </div>
        ) : events.length === 0 ? (
          <Card><p className="py-8 text-center text-sm text-[var(--color-text-secondary)]">No events yet.</p></Card>
        ) : (
          <div className="space-y-3">
            {events.map(ev => (
              <div key={ev.id} className="rounded-xl border border-[var(--color-table-border)] bg-white p-4 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-[var(--color-text-primary)]">{ev.name}</p>
                      <Badge variant={STATUS_BADGE[ev.status] ?? "gray"} size="sm">{ev.status.replace("_"," ")}</Badge>
                    </div>
                    <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                      {ev.venue && `${ev.venue} · `}
                      {new Date(ev.starts_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                    </p>
                    <p className="mt-0.5 text-sm text-[var(--color-text-secondary)]">
                      {formatMoney(ev.price_cents)}/ticket
                    </p>
                    {/* Capacity bar */}
                    <div className="mt-2 flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                        <div className={`h-1.5 rounded-full transition-all ${
                          pctSold(ev) >= 90 ? "bg-red-500" : pctSold(ev) >= 70 ? "bg-amber-500" : "bg-green-500"
                        }`} style={{ width: `${pctSold(ev)}%` }} />
                      </div>
                      <span className="text-xs text-[var(--color-text-secondary)]">{ev.sold}/{ev.capacity}</span>
                    </div>
                  </div>
                  {ev.status === "on_sale" && ev.available > 0 && (
                    <Button variant="primary" size="sm" onClick={() => openSellModal(ev)}>Sell</Button>
                  )}
                  {ev.available === 0 && (
                    <Badge variant="red" size="sm">Sold out</Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create event modal */}
      <Modal open={eventModal} onClose={() => setEventModal(false)} title="Create Event">
        <div className="space-y-3 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Event name *</label>
            <input type="text" value={eForm.name} onChange={e => setEForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Summer Concert 2026"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Venue</label>
            <input type="text" value={eForm.venue} onChange={e => setEForm(f => ({ ...f, venue: e.target.value }))}
              placeholder="Main Hall"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Starts *</label>
              <input type="datetime-local" value={eForm.startsAt} onChange={e => setEForm(f => ({ ...f, startsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Ends *</label>
              <input type="datetime-local" value={eForm.endsAt} onChange={e => setEForm(f => ({ ...f, endsAt: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Capacity</label>
              <input type="number" min={1} value={eForm.capacity} onChange={e => setEForm(f => ({ ...f, capacity: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Price (cents)</label>
              <input type="number" min={0} value={eForm.priceCents} onChange={e => setEForm(f => ({ ...f, priceCents: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setEventModal(false)}>Cancel</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleCreateEvent}
              disabled={!eForm.name || !eForm.startsAt || !eForm.endsAt}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* Sell tickets modal */}
      <Modal open={sellModal} onClose={() => { setSellModal(false); setSoldTickets([]); }} title={`Sell Tickets — ${selected?.name}`}>
        <div className="space-y-4 p-4">
          {soldTickets.length === 0 ? (
            <>
              <div>
                <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">Quantity</label>
                <input type="number" min={1} max={selected?.available ?? 1} value={sForm.quantity}
                  onChange={e => setSForm({ quantity: e.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-600" />
                {selected && (
                  <p className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    Total: {formatMoney(Number(sForm.quantity) * selected.price_cents)} · {selected.available} remaining
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" fullWidth onClick={() => setSellModal(false)}>Cancel</Button>
                <Button variant="primary" fullWidth loading={saving} onClick={handleSellTickets}
                  disabled={!sForm.quantity || Number(sForm.quantity) < 1}>Sell</Button>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3">
                <p className="text-sm font-semibold text-green-800">
                  {soldTickets.length} ticket{soldTickets.length !== 1 ? "s" : ""} sold!
                </p>
              </div>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {soldTickets.map(t => (
                  <div key={t.id} className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
                    <p className="font-mono text-xs text-[var(--color-text-secondary)]">{t.qr_code}</p>
                  </div>
                ))}
              </div>
              <Button variant="primary" fullWidth onClick={() => { setSellModal(false); setSoldTickets([]); }}>Done</Button>
            </>
          )}
        </div>
      </Modal>

      {/* Redeem modal */}
      <Modal open={redeemModal} onClose={() => { setRedeemModal(false); setRedeemResult(null); setQrCode(""); }} title="Redeem Ticket">
        <div className="space-y-4 p-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-[var(--color-text-secondary)]">QR code / ticket ID</label>
            <input type="text" value={qrCode} onChange={e => setQrCode(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleRedeem()}
              placeholder="Scan or type ticket code"
              autoFocus
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono outline-none focus:border-brand-600" />
          </div>
          {redeemResult && (
            <div className={`rounded-lg px-4 py-3 text-sm ${redeemResult.success ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
              {redeemResult.message}
            </div>
          )}
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => { setRedeemModal(false); setRedeemResult(null); setQrCode(""); }}>Close</Button>
            <Button variant="primary" fullWidth loading={saving} onClick={handleRedeem} disabled={!qrCode}>Redeem</Button>
          </div>
        </div>
      </Modal>
    </EnterpriseShell>
  );
}
