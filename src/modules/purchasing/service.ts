import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";

/** Purchasing — suppliers + purchase orders + receiving. Tenant-scoped.
 *  Receiving publishes `purchase_order.received`; the inventory module listens
 *  and increments stock (modules stay decoupled via events). Unit costs are
 *  captured into `product_costs` so the inventory grid can show cost. */

export type POStatus = "ordered" | "received" | "cancelled";
export type VendorCreditType = "chargeback" | "credit_memo";
export type ReturnReason = "damaged" | "expired" | "other";

export interface VendorReturn {
  id: string;
  tenant_id: string;
  supplier_id: string | null;
  reason: ReturnReason;
  total_cost_cents: number;
  credit_id: string | null;
  status: "recorded";
  created_at: number;
}

export interface VendorCredit {
  id: string;
  tenant_id: string;
  supplier_id: string;
  type: VendorCreditType;
  amount_cents: number;
  reason: string | null;
  po_id: string | null;
  status: "open" | "applied" | "void";
  created_at: number;
  updated_at: number;
}

export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  email: string | null;
  created_at: number;
}

export interface POLineInput {
  productId: string;
  quantity: number;
  unitCostCents: number;
  expiryDate?: number | null; // epoch ms — captured into an inventory lot on receive
  lotCode?: string | null;
}

export interface PurchaseOrderLine {
  id: string;
  tenant_id: string;
  po_id: string;
  product_id: string;
  quantity: number;
  unit_cost_cents: number;
  line_cost_cents: number;
  expiry_date: number | null;
  lot_code: string | null;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  supplier_id: string;
  status: POStatus;
  total_cost_cents: number;
  created_at: number;
  received_at: number | null;
}

export interface PurchaseOrderWithLines extends PurchaseOrder {
  lines: PurchaseOrderLine[];
}

export class PurchasingService {
  constructor(
    private readonly db: DB,
    private readonly events: EventBus,
  ) {}

  async createSupplier(name: string, email: string | undefined, tenantId: string): Promise<Supplier> {
    const s: Supplier = { id: `sup_${uuidv7()}`, tenant_id: tenantId, name, email: email ?? null, created_at: Date.now() };
    await this.db.query(
      "INSERT INTO suppliers (id, tenant_id, name, email, created_at) VALUES (@id,@tenant_id,@name,@email,@created_at)",
      s as unknown as Record<string, unknown>,
    );
    return s;
  }

  async listSuppliers(tenantId: string): Promise<Supplier[]> {
    return this.db.query<Supplier>("SELECT * FROM suppliers WHERE tenant_id = @tenantId ORDER BY created_at DESC", { tenantId });
  }

  /** Vendor directory with spend + open-credit balances (the vendor list). */
  async vendors(tenantId: string): Promise<Array<Supplier & { poCount: number; totalSpentCents: number; openCreditsCents: number }>> {
    const suppliers = await this.listSuppliers(tenantId);
    const spend = await this.db.query<{ supplier_id: string; po_count: number; spent: number }>(
      `SELECT supplier_id, COUNT(*)::int AS po_count, COALESCE(SUM(total_cost_cents),0) AS spent
         FROM purchase_orders WHERE tenant_id = @tenantId AND status = 'received' GROUP BY supplier_id`,
      { tenantId },
    );
    const credits = await this.db.query<{ supplier_id: string; credits: number }>(
      `SELECT supplier_id, COALESCE(SUM(amount_cents),0) AS credits
         FROM vendor_credits WHERE tenant_id = @tenantId AND status = 'open' GROUP BY supplier_id`,
      { tenantId },
    );
    const spendMap = new Map(spend.map((s) => [s.supplier_id, s]));
    const creditMap = new Map(credits.map((c) => [c.supplier_id, Number(c.credits)]));
    return suppliers.map((s) => ({
      ...s,
      poCount: Number(spendMap.get(s.id)?.po_count ?? 0),
      totalSpentCents: Number(spendMap.get(s.id)?.spent ?? 0),
      openCreditsCents: creditMap.get(s.id) ?? 0,
    }));
  }

  // ── Vendor AP credits: chargebacks + credit memos ───────────────────────────
  async createVendorCredit(
    input: { supplierId: string; type: VendorCreditType; amountCents: number; reason?: string; poId?: string },
    tenantId: string,
  ): Promise<VendorCredit> {
    if (input.amountCents <= 0) throw new HttpError(400, "bad_request", "amountCents must be positive");
    const supplier = await this.db.one("SELECT id FROM suppliers WHERE id = @s AND tenant_id = @t", { s: input.supplierId, t: tenantId });
    if (!supplier) throw new HttpError(404, "not_found", `supplier '${input.supplierId}' not found`);
    const now = Date.now();
    const vc: VendorCredit = {
      id: `vcr_${uuidv7()}`,
      tenant_id: tenantId,
      supplier_id: input.supplierId,
      type: input.type,
      amount_cents: input.amountCents,
      reason: input.reason ?? null,
      po_id: input.poId ?? null,
      status: "open",
      created_at: now,
      updated_at: now,
    };
    await this.db.query(
      `INSERT INTO vendor_credits (id, tenant_id, supplier_id, type, amount_cents, reason, po_id, status, created_at, updated_at)
       VALUES (@id,@tenant_id,@supplier_id,@type,@amount_cents,@reason,@po_id,@status,@created_at,@updated_at)`,
      vc as unknown as Record<string, unknown>,
    );
    return vc;
  }

  async listVendorCredits(tenantId: string, supplierId?: string): Promise<VendorCredit[]> {
    if (supplierId) {
      return this.db.query<VendorCredit>(
        "SELECT * FROM vendor_credits WHERE tenant_id = @t AND supplier_id = @s ORDER BY created_at DESC",
        { t: tenantId, s: supplierId },
      );
    }
    return this.db.query<VendorCredit>("SELECT * FROM vendor_credits WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 500", { t: tenantId });
  }

  async voidVendorCredit(id: string, tenantId: string): Promise<VendorCredit> {
    const vc = await this.db.one<VendorCredit>("SELECT * FROM vendor_credits WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!vc) throw new HttpError(404, "not_found", `vendor credit '${id}' not found`);
    await this.db.query("UPDATE vendor_credits SET status = 'void', updated_at = @now WHERE id = @id AND tenant_id = @t", { now: Date.now(), id, t: tenantId });
    return { ...vc, status: "void" };
  }

  // ── Vendor returns / write-offs (damaged + expired) ─────────────────────────
  /** Record a return/write-off of damaged or expired stock. Reduces inventory
   *  (and the specific lot) via the `stock.written_off` event, and optionally
   *  raises a vendor credit memo for the returned value. */
  async createReturn(
    input: {
      supplierId?: string;
      reason: ReturnReason;
      lines: Array<{ productId: string; quantity: number; unitCostCents?: number; lotId?: string }>;
      createCredit?: boolean;
    },
    tenantId: string,
  ): Promise<VendorReturn> {
    if (input.lines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");
    const now = Date.now();
    const id = `ret_${uuidv7()}`;
    const total = input.lines.reduce((s, l) => s + l.quantity * (l.unitCostCents ?? 0), 0);
    await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO vendor_returns (id, tenant_id, supplier_id, reason, total_cost_cents, credit_id, status, created_at)
         VALUES (@id,@t,@sup,@reason,@total,NULL,'recorded',@now)`,
        { id, t: tenantId, sup: input.supplierId ?? null, reason: input.reason, total, now },
      );
      for (const l of input.lines) {
        await tdb.query(
          `INSERT INTO vendor_return_lines (id, tenant_id, return_id, product_id, quantity, unit_cost_cents, lot_id)
           VALUES (@id,@t,@ret,@pid,@qty,@cost,@lot)`,
          { id: `rtl_${uuidv7()}`, t: tenantId, ret: id, pid: l.productId, qty: l.quantity, cost: l.unitCostCents ?? 0, lot: l.lotId ?? null },
        );
      }
    });

    let creditId: string | null = null;
    if (input.createCredit && input.supplierId && total > 0) {
      const vc = await this.createVendorCredit(
        { supplierId: input.supplierId, type: "credit_memo", amountCents: total, reason: `${input.reason} return` },
        tenantId,
      );
      creditId = vc.id;
      await this.db.query("UPDATE vendor_returns SET credit_id = @c WHERE id = @id AND tenant_id = @t", { c: creditId, id, t: tenantId });
    }

    await this.events.publish(
      "stock.written_off",
      { tenantId, returnId: id, reason: input.reason, lines: input.lines.map((l) => ({ productId: l.productId, quantity: l.quantity, lotId: l.lotId ?? null })) },
      id,
    );

    return { id, tenant_id: tenantId, supplier_id: input.supplierId ?? null, reason: input.reason, total_cost_cents: total, credit_id: creditId, status: "recorded", created_at: now };
  }

  async listReturns(tenantId: string): Promise<VendorReturn[]> {
    return this.db.query<VendorReturn>("SELECT * FROM vendor_returns WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 500", { t: tenantId });
  }

  async createOrder(supplierId: string, lines: POLineInput[], tenantId: string): Promise<PurchaseOrderWithLines> {
    if (lines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");
    const supplier = await this.db.one("SELECT id FROM suppliers WHERE id = @supplierId AND tenant_id = @tenantId", { supplierId, tenantId });
    if (!supplier) throw new HttpError(404, "not_found", `supplier '${supplierId}' not found`);
    const now = Date.now();
    const poId = `po_${uuidv7()}`;
    const poLines: PurchaseOrderLine[] = lines.map((l) => ({
      id: `pol_${uuidv7()}`,
      tenant_id: tenantId,
      po_id: poId,
      product_id: l.productId,
      quantity: l.quantity,
      unit_cost_cents: l.unitCostCents,
      line_cost_cents: l.quantity * l.unitCostCents,
      expiry_date: l.expiryDate ?? null,
      lot_code: l.lotCode ?? null,
    }));
    const total = poLines.reduce((s, l) => s + l.line_cost_cents, 0);
    await this.db.tx(async (tdb) => {
      await tdb.query(
        "INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, total_cost_cents, created_at, received_at) VALUES (@id,@tenant_id,@supplier_id,'ordered',@total,@created_at,NULL)",
        { id: poId, tenant_id: tenantId, supplier_id: supplierId, total, created_at: now },
      );
      for (const l of poLines) {
        await tdb.query(
          "INSERT INTO purchase_order_lines (id, tenant_id, po_id, product_id, quantity, unit_cost_cents, line_cost_cents, expiry_date, lot_code) VALUES (@id,@tenant_id,@po_id,@product_id,@quantity,@unit_cost_cents,@line_cost_cents,@expiry_date,@lot_code)",
          l as unknown as Record<string, unknown>,
        );
      }
    });
    return { id: poId, tenant_id: tenantId, supplier_id: supplierId, status: "ordered", total_cost_cents: total, created_at: now, received_at: null, lines: poLines };
  }

  async listOrders(tenantId: string): Promise<PurchaseOrder[]> {
    return this.db.query<PurchaseOrder>("SELECT * FROM purchase_orders WHERE tenant_id = @tenantId ORDER BY created_at DESC LIMIT 200", { tenantId });
  }

  async getOrder(id: string, tenantId: string): Promise<PurchaseOrderWithLines> {
    const po = await this.db.one<PurchaseOrder>("SELECT * FROM purchase_orders WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
    if (!po) throw new HttpError(404, "not_found", `purchase order '${id}' not found`);
    const lines = await this.db.query<PurchaseOrderLine>("SELECT * FROM purchase_order_lines WHERE po_id = @id AND tenant_id = @tenantId", { id, tenantId });
    return { ...po, lines };
  }

  /** Receive a PO: capture unit costs, mark received, and emit an event so the
   *  inventory module increments stock. Idempotent-ish: rejects if already received. */
  async receive(id: string, tenantId: string): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(id, tenantId);
    if (po.status === "received") throw new HttpError(409, "already_received", "purchase order already received");
    if (po.status === "cancelled") throw new HttpError(409, "cancelled", "purchase order is cancelled");
    const now = Date.now();
    await this.db.tx(async (tdb) => {
      await tdb.query("UPDATE purchase_orders SET status = 'received', received_at = @now WHERE id = @id AND tenant_id = @tenantId", { now, id, tenantId });
      for (const l of po.lines) {
        await tdb.query(
          `INSERT INTO product_costs (tenant_id, product_id, cost_cents, updated_at) VALUES (@tenant_id,@product_id,@cost,@now)
           ON CONFLICT (tenant_id, product_id) DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at`,
          { tenant_id: tenantId, product_id: l.product_id, cost: l.unit_cost_cents, now },
        );
      }
    });
    await this.events.publish(
      "purchase_order.received",
      {
        tenantId,
        poId: id,
        lines: po.lines.map((l) => ({
          productId: l.product_id,
          quantity: l.quantity,
          unitCostCents: l.unit_cost_cents,
          expiryDate: l.expiry_date ?? undefined,
          lotCode: l.lot_code ?? undefined,
        })),
      },
      id,
    );
    return { ...po, status: "received", received_at: now };
  }
}
