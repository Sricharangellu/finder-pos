import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound } from "../../shared/http.js";

export type AppointmentStatus = "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";

export interface ServiceCatalog {
  id: string;
  tenant_id: string;
  name: string;
  duration_mins: number;
  price_cents: number;
  category: string | null;
  active: number;
  created_at: number;
  updated_at: number;
}

export interface Appointment {
  id: string;
  tenant_id: string;
  customer_id: string | null;
  employee_id: string | null;
  service_id: string | null;
  starts_at: number;
  ends_at: number;
  status: AppointmentStatus;
  notes: string | null;
  created_at: number;
  updated_at: number;
}

export type AppointmentsService = ReturnType<typeof appointmentsService>;

export function appointmentsService(db: DB, events: EventBus) {
  return {
    async listServices(tenantId: string): Promise<ServiceCatalog[]> {
      return db.query<ServiceCatalog>(
        "SELECT * FROM services_catalog WHERE tenant_id = @t AND active = 1 ORDER BY name",
        { t: tenantId },
      );
    },

    async createService(tenantId: string, input: {
      name: string;
      durationMins?: number;
      priceCents?: number;
      category?: string;
    }): Promise<ServiceCatalog> {
      const now = Date.now();
      const row: ServiceCatalog = {
        id: `svc_${uuidv7()}`,
        tenant_id: tenantId,
        name: input.name,
        duration_mins: input.durationMins ?? 60,
        price_cents: input.priceCents ?? 0,
        category: input.category ?? null,
        active: 1,
        created_at: now,
        updated_at: now,
      };
      await db.query(
        `INSERT INTO services_catalog (id, tenant_id, name, duration_mins, price_cents, category, active, created_at, updated_at)
         VALUES (@id, @tenant_id, @name, @duration_mins, @price_cents, @category, @active, @created_at, @updated_at)`,
        row as unknown as Record<string, unknown>,
      );
      return row;
    },

    async updateService(tenantId: string, id: string, input: Partial<{
      name: string;
      durationMins: number;
      priceCents: number;
      category: string;
      active: number;
    }>): Promise<ServiceCatalog> {
      const existing = await db.one<ServiceCatalog>(
        "SELECT * FROM services_catalog WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`service '${id}'`);
      const now = Date.now();
      const updated: ServiceCatalog = {
        ...existing,
        name: input.name ?? existing.name,
        duration_mins: input.durationMins ?? existing.duration_mins,
        price_cents: input.priceCents ?? existing.price_cents,
        category: input.category !== undefined ? input.category : existing.category,
        active: input.active !== undefined ? input.active : existing.active,
        updated_at: now,
      };
      await db.query(
        `UPDATE services_catalog SET name=@name, duration_mins=@duration_mins, price_cents=@price_cents,
         category=@category, active=@active, updated_at=@updated_at WHERE id=@id AND tenant_id=@tenant_id`,
        updated as unknown as Record<string, unknown>,
      );
      return updated;
    },

    async listAppointments(tenantId: string, opts: {
      date?: string;
      employeeId?: string;
      customerId?: string;
    } = {}): Promise<Appointment[]> {
      const where: string[] = ["tenant_id = @t"];
      const params: Record<string, unknown> = { t: tenantId };
      if (opts.date) {
        // Filter by date: starts_at falls within the day (epoch ms range)
        const dayStart = new Date(opts.date).getTime();
        const dayEnd = dayStart + 86400000;
        where.push("starts_at >= @dayStart AND starts_at < @dayEnd");
        params["dayStart"] = dayStart;
        params["dayEnd"] = dayEnd;
      }
      if (opts.employeeId) { where.push("employee_id = @employeeId"); params["employeeId"] = opts.employeeId; }
      if (opts.customerId) { where.push("customer_id = @customerId"); params["customerId"] = opts.customerId; }
      return db.query<Appointment>(
        `SELECT * FROM appointments WHERE ${where.join(" AND ")} ORDER BY starts_at`,
        params,
      );
    },

    async createAppointment(tenantId: string, input: {
      customerId?: string;
      employeeId?: string;
      serviceId?: string;
      startsAt: number;
      endsAt: number;
      notes?: string;
    }): Promise<Appointment> {
      const now = Date.now();
      const row: Appointment = {
        id: `apt_${uuidv7()}`,
        tenant_id: tenantId,
        customer_id: input.customerId ?? null,
        employee_id: input.employeeId ?? null,
        service_id: input.serviceId ?? null,
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        status: "scheduled",
        notes: input.notes ?? null,
        created_at: now,
        updated_at: now,
      };
      await db.withTenant(tenantId).tx(async (tdb) => {
        await tdb.query(
          `INSERT INTO appointments (id, tenant_id, customer_id, employee_id, service_id, starts_at, ends_at, status, notes, created_at, updated_at)
           VALUES (@id, @tenant_id, @customer_id, @employee_id, @service_id, @starts_at, @ends_at, @status, @notes, @created_at, @updated_at)`,
          row as unknown as Record<string, unknown>,
        );
      });
      void events.publish("appointments.created", { tenantId, appointmentId: row.id }, row.id);
      return row;
    },

    async getAppointment(tenantId: string, id: string): Promise<Appointment> {
      const row = await db.one<Appointment>(
        "SELECT * FROM appointments WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!row) throw notFound(`appointment '${id}'`);
      return row;
    },

    async updateStatus(tenantId: string, id: string, status: AppointmentStatus): Promise<Appointment> {
      const existing = await db.one<Appointment>(
        "SELECT * FROM appointments WHERE id = @id AND tenant_id = @t",
        { id, t: tenantId },
      );
      if (!existing) throw notFound(`appointment '${id}'`);
      const now = Date.now();
      await db.query(
        "UPDATE appointments SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t",
        { status, now, id, t: tenantId },
      );
      void events.publish("appointments.status_changed", { tenantId, appointmentId: id, status }, id);
      return { ...existing, status, updated_at: now };
    },
  };
}
