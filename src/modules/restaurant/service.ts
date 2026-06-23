import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, HttpError } from "../../shared/http.js";

export type TableStatus = "available" | "occupied" | "reserved" | "cleaning";
export type TabStatus = "open" | "closed";

export interface RestaurantTable {
  id: string;
  tenant_id: string;
  outlet_id: string | null;
  table_number: string;
  capacity: number;
  floor_section: string | null;
  status: TableStatus;
  created_at: number;
  updated_at: number;
}

export interface TableSession {
  id: string;
  tenant_id: string;
  table_id: string;
  server_id: string | null;
  party_size: number;
  status: "open" | "closed";
  opened_at: number;
  closed_at: number | null;
  notes: string | null;
  created_at: number;
}

export interface BarTab {
  id: string;
  tenant_id: string;
  table_id: string | null;
  session_id: string | null;
  customer_name: string | null;
  status: TabStatus;
  opened_at: number;
  closed_at: number | null;
  order_ids: string[];
}

export class RestaurantService {
  constructor(private readonly db: DB, private readonly events: EventBus) {}

  // ── Tables ────────────────────────────────────────────────────────────────

  async listTables(tenantId: string, outletId?: string): Promise<RestaurantTable[]> {
    const where = outletId
      ? "WHERE tenant_id = @t AND outlet_id = @o ORDER BY table_number ASC"
      : "WHERE tenant_id = @t ORDER BY table_number ASC";
    return this.db.query<RestaurantTable>(
      `SELECT * FROM restaurant_tables ${where} LIMIT 500`,
      outletId ? { t: tenantId, o: outletId } : { t: tenantId },
    );
  }

  async createTable(
    tenantId: string,
    input: { tableNumber: string; capacity: number; outletId?: string; floorSection?: string },
  ): Promise<RestaurantTable> {
    const now = Date.now();
    const table: RestaurantTable = {
      id: `tbl_${uuidv7()}`,
      tenant_id: tenantId,
      outlet_id: input.outletId ?? null,
      table_number: input.tableNumber,
      capacity: input.capacity,
      floor_section: input.floorSection ?? null,
      status: "available",
      created_at: now,
      updated_at: now,
    };
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO restaurant_tables (id, tenant_id, outlet_id, table_number, capacity, floor_section, status, created_at, updated_at)
         VALUES (@id, @tenant_id, @outlet_id, @table_number, @capacity, @floor_section, @status, @created_at, @updated_at)`,
        table as unknown as Record<string, unknown>,
      );
    });
    return table;
  }

  async setTableStatus(tableId: string, tenantId: string, status: TableStatus): Promise<RestaurantTable> {
    const tbl = await this.db.one<RestaurantTable>(
      "SELECT * FROM restaurant_tables WHERE id = @id AND tenant_id = @t",
      { id: tableId, t: tenantId },
    );
    if (!tbl) throw notFound(`table '${tableId}'`);
    await this.db.query(
      "UPDATE restaurant_tables SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t",
      { status, now: Date.now(), id: tableId, t: tenantId },
    );
    void this.events.publish("restaurant.table_status_changed", { tenantId, tableId, status }, tableId);
    return { ...tbl, status, updated_at: Date.now() };
  }

  async openSession(
    tableId: string,
    tenantId: string,
    input: { partySize: number; serverId?: string; notes?: string },
  ): Promise<TableSession> {
    // Verify no open session already exists
    const existing = await this.db.one<{ id: string }>(
      "SELECT id FROM table_sessions WHERE tenant_id = @t AND table_id = @tableId AND status = 'open' LIMIT 1",
      { t: tenantId, tableId },
    );
    if (existing) throw new HttpError(409, "session_open", "Table already has an open session.");
    const now = Date.now();
    const session: TableSession = {
      id: `tsn_${uuidv7()}`,
      tenant_id: tenantId,
      table_id: tableId,
      server_id: input.serverId ?? null,
      party_size: input.partySize,
      status: "open",
      opened_at: now,
      closed_at: null,
      notes: input.notes ?? null,
      created_at: now,
    };
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO table_sessions (id, tenant_id, table_id, server_id, party_size, status, opened_at, notes, created_at)
         VALUES (@id, @tenant_id, @table_id, @server_id, @party_size, 'open', @opened_at, @notes, @created_at)`,
        session as unknown as Record<string, unknown>,
      );
      await tdb.query(
        "UPDATE restaurant_tables SET status = 'occupied', updated_at = @now WHERE id = @tableId AND tenant_id = @t",
        { now, tableId, t: tenantId },
      );
    });
    return session;
  }

  async closeSession(sessionId: string, tenantId: string): Promise<TableSession> {
    const session = await this.db.one<TableSession>(
      "SELECT * FROM table_sessions WHERE id = @id AND tenant_id = @t",
      { id: sessionId, t: tenantId },
    );
    if (!session) throw notFound(`session '${sessionId}'`);
    if (session.status === "closed") throw new HttpError(409, "already_closed", "Session is already closed.");
    const now = Date.now();
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        "UPDATE table_sessions SET status = 'closed', closed_at = @now WHERE id = @id AND tenant_id = @t",
        { now, id: sessionId, t: tenantId },
      );
      await tdb.query(
        "UPDATE restaurant_tables SET status = 'available', updated_at = @now WHERE id = @tableId AND tenant_id = @t",
        { now, tableId: session.table_id, t: tenantId },
      );
    });
    return { ...session, status: "closed", closed_at: now };
  }

  // ── Bar Tabs ──────────────────────────────────────────────────────────────

  async listTabs(tenantId: string, status?: TabStatus): Promise<BarTab[]> {
    const rows = await this.db.query<Omit<BarTab, "order_ids"> & { id: string }>(
      status
        ? "SELECT * FROM bar_tabs WHERE tenant_id = @t AND status = @s ORDER BY opened_at DESC LIMIT 200"
        : "SELECT * FROM bar_tabs WHERE tenant_id = @t ORDER BY opened_at DESC LIMIT 200",
      status ? { t: tenantId, s: status } : { t: tenantId },
    );
    const tabs: BarTab[] = [];
    for (const row of rows) {
      const orderRows = await this.db.query<{ order_id: string }>(
        "SELECT order_id FROM bar_tab_orders WHERE tab_id = @id ORDER BY added_at ASC",
        { id: row.id },
      );
      tabs.push({ ...row, order_ids: orderRows.map((o) => o.order_id) });
    }
    return tabs;
  }

  async openTab(
    tenantId: string,
    input: { tableId?: string; sessionId?: string; customerName?: string },
  ): Promise<BarTab> {
    const now = Date.now();
    const tab = {
      id: `tab_${uuidv7()}`,
      tenant_id: tenantId,
      table_id: input.tableId ?? null,
      session_id: input.sessionId ?? null,
      customer_name: input.customerName ?? null,
      status: "open" as const,
      opened_at: now,
      closed_at: null,
      created_at: now,
    };
    await this.db.query(
      `INSERT INTO bar_tabs (id, tenant_id, table_id, session_id, customer_name, status, opened_at, created_at)
       VALUES (@id, @tenant_id, @table_id, @session_id, @customer_name, 'open', @opened_at, @created_at)`,
      tab as unknown as Record<string, unknown>,
    );
    return { ...tab, order_ids: [] };
  }

  async addRoundToTab(tabId: string, orderId: string, tenantId: string): Promise<void> {
    const tab = await this.db.one<{ id: string; status: string }>(
      "SELECT id, status FROM bar_tabs WHERE id = @id AND tenant_id = @t",
      { id: tabId, t: tenantId },
    );
    if (!tab) throw notFound(`tab '${tabId}'`);
    if (tab.status !== "open") throw new HttpError(409, "tab_closed", "Tab is closed.");
    await this.db.query(
      "INSERT INTO bar_tab_orders (tab_id, order_id, added_at) VALUES (@tabId, @orderId, @now) ON CONFLICT DO NOTHING",
      { tabId, orderId, now: Date.now() },
    );
  }

  async closeTab(tabId: string, tenantId: string): Promise<BarTab> {
    const tab = await this.db.one<Omit<BarTab, "order_ids">>(
      "SELECT * FROM bar_tabs WHERE id = @id AND tenant_id = @t",
      { id: tabId, t: tenantId },
    );
    if (!tab) throw notFound(`tab '${tabId}'`);
    if (tab.status === "closed") throw new HttpError(409, "already_closed", "Tab is already closed.");
    const now = Date.now();
    await this.db.query(
      "UPDATE bar_tabs SET status = 'closed', closed_at = @now WHERE id = @id AND tenant_id = @t",
      { now, id: tabId, t: tenantId },
    );
    const orderRows = await this.db.query<{ order_id: string }>(
      "SELECT order_id FROM bar_tab_orders WHERE tab_id = @id ORDER BY added_at ASC",
      { id: tabId },
    );
    return { ...tab, status: "closed", closed_at: now, order_ids: orderRows.map((o) => o.order_id) };
  }
}
