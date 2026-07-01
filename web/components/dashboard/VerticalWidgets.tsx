"use client";

/**
 * UX-3: Vertical-specific dashboard widgets.
 * Renders only the widgets relevant to the current business type
 * by checking enabled modules via useModuleFlags().
 *
 * Each widget is independent: fetches its own data, fails silently.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { useModuleFlags } from "@/hooks/useModuleFlags";
import { apiGet, safeLoad } from "@/api-client/client";
import { formatMoney } from "@/lib/money";
import { fmtDate, fmtTime } from "@/lib/date";

// ── Generic mini-widget shell ────────────────────────────────────────────────

function Widget({
  title, href, linkLabel = "View all →", children,
}: {
  title: string; href: string; linkLabel?: string; children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[var(--color-table-border)] bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">{title}</h3>
        <Link href={href} className="text-xs text-brand-600 hover:underline">{linkLabel}</Link>
      </div>
      {children}
    </div>
  );
}

function WidgetRow({ label, value, sub, color = "" }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-gray-50">
      <p className="text-sm text-[var(--color-text-primary)] truncate">{label}</p>
      <div className="text-right shrink-0 ml-2">
        <p className={`text-sm font-semibold ${color || "text-[var(--color-text-primary)]"}`}>{value}</p>
        {sub && <p className="text-xs text-[var(--color-text-secondary)]">{sub}</p>}
      </div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="space-y-2">
      {[1,2,3].map(i => <div key={i} className="h-8 animate-pulse rounded-lg bg-gray-100" />)}
    </div>
  );
}

// ── Table Overview (Restaurant) ──────────────────────────────────────────────

interface TableRow { id: string; table_number: string; status: string; }

function TableWidget() {
  const [tables, setTables] = useState<TableRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: TableRow[] }>("/api/v1/restaurant/tables")
        .then(r => setTables(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  const occupied  = tables.filter(t => t.status === "occupied").length;
  const available = tables.filter(t => t.status === "available").length;
  const reserved  = tables.filter(t => t.status === "reserved").length;
  return (
    <Widget title="Table Overview" href="/restaurant/floor-plan">
      {loading ? <Skeleton /> : (
        <div className="space-y-1">
          <WidgetRow label="Occupied"  value={String(occupied)}  color="text-red-600" />
          <WidgetRow label="Available" value={String(available)} color="text-green-600" />
          <WidgetRow label="Reserved"  value={String(reserved)}  color="text-amber-600" />
          <WidgetRow label="Total"     value={String(tables.length)} />
        </div>
      )}
    </Widget>
  );
}

// ── Today's Appointments (Services) ─────────────────────────────────────────

interface ApptRow { id: string; service: string; starts_at: number; status: string; }

function AppointmentsWidget() {
  const [appts, setAppts]   = useState<ApptRow[]>([]);
  const [loading, setLoading] = useState(true);
  const today = new Date().toISOString().slice(0, 10);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: ApptRow[] }>(`/api/v1/appointments?date=${today}`)
        .then(r => setAppts(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, [today]);
  const upcoming  = appts.filter(a => a.status === "scheduled" || a.status === "confirmed");
  const completed = appts.filter(a => a.status === "completed").length;
  return (
    <Widget title="Today's Appointments" href="/appointments">
      {loading ? <Skeleton /> : appts.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No appointments today.</p>
      ) : (
        <div className="space-y-1">
          <WidgetRow label="Upcoming"  value={String(upcoming.length)}  color="text-brand-600" />
          <WidgetRow label="Completed" value={String(completed)} color="text-green-600" />
          <WidgetRow label="Total"     value={String(appts.length)} />
          {upcoming.slice(0, 2).map(a => (
            <div key={a.id} className="flex items-center justify-between rounded-lg bg-brand-50 px-2 py-1.5 mt-1">
              <p className="text-xs font-medium text-brand-800 truncate">{a.service}</p>
              <p className="text-xs text-brand-600 shrink-0 ml-2">
                {fmtTime(a.starts_at)}
              </p>
            </div>
          ))}
        </div>
      )}
    </Widget>
  );
}

// ── Room Occupancy (Hospitality) ─────────────────────────────────────────────

interface RoomRow { id: string; room_number: string; status: string; rate_cents: number; }

function RoomsWidget() {
  const [rooms, setRooms]   = useState<RoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: RoomRow[] }>("/api/v1/hospitality/rooms")
        .then(r => setRooms(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  const occupied  = rooms.filter(r => r.status === "occupied");
  const available = rooms.filter(r => r.status === "available").length;
  const cleaning  = rooms.filter(r => r.status === "cleaning").length;
  const revToday  = occupied.reduce((s, r) => s + r.rate_cents, 0);
  const pctOcc    = rooms.length ? Math.round((occupied.length / rooms.length) * 100) : 0;
  return (
    <Widget title="Room Occupancy" href="/hospitality">
      {loading ? <Skeleton /> : rooms.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No rooms configured.</p>
      ) : (
        <div className="space-y-1">
          <div className="mb-2">
            <div className="flex items-center justify-between text-xs text-[var(--color-text-secondary)] mb-1">
              <span>Occupancy</span><span className="font-semibold text-[var(--color-text-primary)]">{pctOcc}%</span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-100">
              <div className={`h-2 rounded-full transition-all ${pctOcc > 80 ? "bg-green-500" : pctOcc > 50 ? "bg-amber-400" : "bg-red-400"}`}
                style={{ width: `${pctOcc}%` }} />
            </div>
          </div>
          <WidgetRow label="Occupied"  value={String(occupied.length)}  color="text-red-600" />
          <WidgetRow label="Available" value={String(available)} color="text-green-600" />
          <WidgetRow label="Cleaning"  value={String(cleaning)}  color="text-amber-600" />
          <WidgetRow label="Est. revenue today" value={formatMoney(revToday)} />
        </div>
      )}
    </Widget>
  );
}

// ── Active Production Orders (Manufacturing) ─────────────────────────────────

interface ProdRow { id: string; product_id: string; quantity: number; status: string; }

function ManufacturingWidget() {
  const [orders, setOrders]   = useState<ProdRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: ProdRow[] }>("/api/v1/manufacturing/orders?status=in_progress")
        .then(r => setOrders(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  return (
    <Widget title="Active Production" href="/manufacturing">
      {loading ? <Skeleton /> : orders.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No orders in production.</p>
      ) : (
        <div className="space-y-1">
          {orders.slice(0, 5).map(o => (
            <WidgetRow key={o.id} label={o.product_id} value={`Qty ${o.quantity}`} sub="in progress" color="text-amber-600" />
          ))}
          {orders.length > 5 && (
            <p className="text-center text-xs text-[var(--color-text-secondary)] pt-1">+{orders.length - 5} more</p>
          )}
        </div>
      )}
    </Widget>
  );
}

// ── Active Rentals (Rental) ──────────────────────────────────────────────────

interface RentalRow { id: string; asset_name: string; ends_at: number; total_cents: number; }

function RentalWidget() {
  const [contracts, setContracts] = useState<RentalRow[]>([]);
  const [loading, setLoading]     = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: RentalRow[] }>("/api/v1/rental/contracts?status=active")
        .then(r => setContracts(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  const overdue = contracts.filter(c => c.ends_at < Date.now());
  return (
    <Widget title="Active Rentals" href="/rental">
      {loading ? <Skeleton /> : contracts.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No active rentals.</p>
      ) : (
        <div className="space-y-1">
          <WidgetRow label="Active"  value={String(contracts.length)} color="text-brand-600" />
          {overdue.length > 0 && (
            <WidgetRow label="Overdue" value={String(overdue.length)} color="text-red-600" />
          )}
          {contracts.slice(0, 3).map(c => (
            <WidgetRow key={c.id}
              label={c.asset_name}
              value={formatMoney(c.total_cents)}
              sub={`Due ${fmtDate(c.ends_at)}`}
              color={c.ends_at < Date.now() ? "text-red-600" : undefined}
            />
          ))}
        </div>
      )}
    </Widget>
  );
}

// ── Upcoming Events (Entertainment) ─────────────────────────────────────────

interface EventRow { id: string; name: string; starts_at: number; sold: number; capacity: number; }

function EntertainmentWidget() {
  const [events, setEvents]   = useState<EventRow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: EventRow[] }>("/api/v1/entertainment/events?status=on_sale")
        .then(r => setEvents(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  return (
    <Widget title="Upcoming Events" href="/entertainment">
      {loading ? <Skeleton /> : events.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No upcoming events.</p>
      ) : (
        <div className="space-y-1">
          {events.slice(0, 4).map(e => {
            const pct = Math.round((e.sold / e.capacity) * 100);
            return (
              <div key={e.id} className="rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-[var(--color-text-primary)] truncate">{e.name}</p>
                  <p className="text-xs text-[var(--color-text-secondary)] shrink-0 ml-2">{pct}% sold</p>
                </div>
                <div className="mt-1 h-1 w-full rounded-full bg-gray-100">
                  <div className={`h-1 rounded-full ${pct >= 90 ? "bg-red-500" : "bg-brand-500"}`}
                    style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Widget>
  );
}

// ── Active Work Orders (Automotive) ─────────────────────────────────────────

interface WORow { id: string; description: string; status: string; total_cents: number; make: string; model: string; }

function AutomotiveWidget() {
  const [orders, setOrders]   = useState<WORow[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: WORow[] }>("/api/v1/automotive/work-orders?status=in_progress")
        .then(r => setOrders(r.items ?? []))
        .finally(() => setLoading(false)),
    );
  }, []);
  return (
    <Widget title="Work Orders" href="/automotive">
      {loading ? <Skeleton /> : orders.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No active work orders.</p>
      ) : (
        <div className="space-y-1">
          {orders.slice(0, 4).map(wo => (
            <WidgetRow key={wo.id}
              label={`${wo.make} ${wo.model}`}
              value={formatMoney(wo.total_cents)}
              sub={wo.description.slice(0, 30)}
              color="text-amber-600"
            />
          ))}
          {orders.length > 4 && (
            <p className="text-center text-xs text-[var(--color-text-secondary)] pt-1">+{orders.length - 4} more</p>
          )}
        </div>
      )}
    </Widget>
  );
}

// ── Outstanding Student Fees (Education) ─────────────────────────────────────

interface StudentRow { id: string; name: string; outstanding: number; }

function EducationWidget() {
  const [students, setStudents] = useState<StudentRow[]>([]);
  const [loading, setLoading]   = useState(true);
  useEffect(() => {
    safeLoad(
      apiGet<{ items: StudentRow[] }>("/api/v1/education/students?status=active")
        .then(async r => {
          // Show students with outstanding fees — we only have summary from list endpoint
          // so we just show recent students; detail fees are on student page
          setStudents(r.items?.slice(0, 5) ?? []);
        })
        .finally(() => setLoading(false)),
    );
  }, []);
  return (
    <Widget title="Students" href="/education">
      {loading ? <Skeleton /> : students.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--color-text-secondary)]">No students enrolled.</p>
      ) : (
        <div className="space-y-1">
          {students.map(s => (
            <WidgetRow key={s.id} label={s.name} value={s.outstanding > 0 ? formatMoney(s.outstanding) : "Paid"} sub={s.outstanding > 0 ? "outstanding" : undefined} color={s.outstanding > 0 ? "text-red-600" : "text-green-600"} />
          ))}
        </div>
      )}
    </Widget>
  );
}

// ── Orchestrator ─────────────────────────────────────────────────────────────

const WIDGET_MAP: Record<string, { module: string; component: React.FC }> = {
  tables:              { module: "tables",              component: TableWidget },
  appointments:        { module: "appointments",        component: AppointmentsWidget },
  room_billing:        { module: "room_billing",        component: RoomsWidget },
  production_orders:   { module: "production_orders",   component: ManufacturingWidget },
  rental_contracts:    { module: "rental_contracts",    component: RentalWidget },
  tickets:             { module: "tickets",             component: EntertainmentWidget },
  vehicle_history:     { module: "vehicle_history",     component: AutomotiveWidget },
  student_accounts:    { module: "student_accounts",    component: EducationWidget },
};

export function VerticalWidgets() {
  const { enabled, loading } = useModuleFlags();

  if (loading) return null;

  const active = Object.entries(WIDGET_MAP)
    .filter(([, { module: m }]) => enabled.has(m) || enabled.has("*"))
    .map(([key, { component: C }]) => ({ key, C }));

  if (active.length === 0) return null;

  return (
    <section aria-label="Vertical operations">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
        Operations
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {active.map(({ key, C }) => <C key={key} />)}
      </div>
    </section>
  );
}
