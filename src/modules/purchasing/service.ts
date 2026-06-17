import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";

/** Purchasing — suppliers + purchase orders + receiving. Tenant-scoped.
 *  Receiving publishes `purchase_order.received`; the inventory module listens
 *  and increments stock (modules stay decoupled via events). Unit costs are
 *  captured into `product_costs` so the inventory grid can show cost. */

export type POStatus = "ordered" | "partially_received" | "received" | "cancelled";
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
  // Identity
  name: string;
  company: string | null;
  dba: string | null;
  email: string | null;
  phone: string | null;
  description: string | null;
  // Financial / compliance
  tax_id: string | null;
  fein_number: string | null;
  vendor_type: string | null;   // 'manufacturer' | 'wholesaler'
  msa_type: string | null;      // MSA category for tobacco compliance
  // AP
  due_amount_cents: number;
  terms_days: number | null;
  // Relationship
  contact_name: string | null;
  primary_sales_rep: string | null;
  // Address (structured)
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  county: string | null;
  zip: string | null;
  country: string | null;
  // Legacy address blob (kept for backward compat)
  address: string | null;
  // Status
  status: string;
  created_at: number;
  updated_at: number | null;
}

export interface UpdateSupplierInput {
  name?: string;
  company?: string | null;
  dba?: string | null;
  email?: string | null;
  phone?: string | null;
  description?: string | null;
  taxId?: string | null;
  feinNumber?: string | null;
  vendorType?: string | null;
  msaType?: string | null;
  termsDays?: number | null;
  contactName?: string | null;
  primarySalesRep?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  state?: string | null;
  county?: string | null;
  zip?: string | null;
  country?: string | null;
  status?: 'active' | 'inactive';
}

export interface POLineInput {
  productId: string;
  quantity: number;
  unitCostCents: number;
  expiryDate?: number | null; // epoch ms — captured into an inventory lot on receive
  lotCode?: string | null;
  productName?: string | null;
  upc?: string | null;
  vendorUpc?: string | null;
  rawCostPriceCents?: number | null;
  unitPriceCents?: number | null;
}

export interface PurchaseOrderLine {
  id: string;
  tenant_id: string;
  po_id: string;
  product_id: string;
  product_name: string | null;
  upc: string | null;
  vendor_upc: string | null;
  quantity: number;
  unit_cost_cents: number;
  raw_cost_price_cents: number | null;
  unit_price_cents: number | null;
  line_cost_cents: number;
  expiry_date: number | null;
  lot_code: string | null;
  received_qty: number;
  billed_qty: number | null;
}

export interface PurchaseOrder {
  id: string;
  tenant_id: string;
  supplier_id: string;
  po_number: number | null;
  status: POStatus;
  receive_status: string;
  total_cost_cents: number;
  notes: string | null;
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

  async createSupplier(
    name: string,
    email: string | undefined,
    tenantId: string,
    extra?: {
      company?: string | null; dba?: string | null; phone?: string | null;
      description?: string | null; taxId?: string | null; feinNumber?: string | null;
      vendorType?: string | null; msaType?: string | null;
      contactName?: string | null; primarySalesRep?: string | null;
      termsDays?: number | null;
      address?: string | null; address1?: string | null; address2?: string | null;
      city?: string | null; state?: string | null; county?: string | null;
      zip?: string | null; country?: string | null;
    },
  ): Promise<Supplier> {
    const id = `sup_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      `INSERT INTO suppliers (
         id, tenant_id, name, email, company, dba, phone, description,
         tax_id, fein_number, vendor_type, msa_type,
         contact_name, primary_sales_rep, terms_days,
         address, address1, address2, city, state, county, zip, country,
         status, due_amount_cents, created_at, updated_at
       ) VALUES (
         @id, @tenant_id, @name, @email, @company, @dba, @phone, @description,
         @tax_id, @fein_number, @vendor_type, @msa_type,
         @contact_name, @primary_sales_rep, @terms_days,
         @address, @address1, @address2, @city, @state, @county, @zip, @country,
         'active', 0, @created_at, @updated_at
       )`,
      {
        id, tenant_id: tenantId, name, email: email ?? null,
        company: extra?.company ?? null,
        dba: extra?.dba ?? null,
        phone: extra?.phone ?? null,
        description: extra?.description ?? null,
        tax_id: extra?.taxId ?? null,
        fein_number: extra?.feinNumber ?? null,
        vendor_type: extra?.vendorType ?? null,
        msa_type: extra?.msaType ?? null,
        contact_name: extra?.contactName ?? null,
        primary_sales_rep: extra?.primarySalesRep ?? null,
        terms_days: extra?.termsDays ?? null,
        address: extra?.address ?? null,
        address1: extra?.address1 ?? null,
        address2: extra?.address2 ?? null,
        city: extra?.city ?? null,
        state: extra?.state ?? null,
        county: extra?.county ?? null,
        zip: extra?.zip ?? null,
        country: extra?.country ?? null,
        created_at: now,
        updated_at: now,
      },
    );
    return (await this.db.one<Supplier>("SELECT * FROM suppliers WHERE id = @id", { id }))!;
  }

  async updateSupplier(id: string, patch: UpdateSupplierInput, tenantId: string): Promise<Supplier> {
    const current = await this.db.one<Supplier>("SELECT * FROM suppliers WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
    if (!current) throw new HttpError(404, "not_found", `supplier '${id}' not found`);
    const map: Record<string, unknown> = {
      name: patch.name,
      company: patch.company,
      dba: patch.dba,
      email: patch.email,
      phone: patch.phone,
      description: patch.description,
      tax_id: patch.taxId,
      fein_number: patch.feinNumber,
      vendor_type: patch.vendorType,
      msa_type: patch.msaType,
      terms_days: patch.termsDays,
      contact_name: patch.contactName,
      primary_sales_rep: patch.primarySalesRep,
      address1: patch.address1,
      address2: patch.address2,
      city: patch.city,
      state: patch.state,
      county: patch.county,
      zip: patch.zip,
      country: patch.country,
      status: patch.status,
    };
    const sets: string[] = [];
    const params: Record<string, unknown> = { id, tenantId, now: Date.now() };
    for (const [col, val] of Object.entries(map)) {
      if (val !== undefined) { sets.push(`${col} = @${col}`); params[col] = val; }
    }
    if (sets.length === 0) return current;
    await this.db.query(
      `UPDATE suppliers SET ${sets.join(", ")}, updated_at = @now WHERE id = @id AND tenant_id = @tenantId`,
      params,
    );
    return (await this.db.one<Supplier>("SELECT * FROM suppliers WHERE id = @id", { id }))!;
  }

  async getSupplier(id: string, tenantId: string): Promise<Supplier | undefined> {
    return this.db.one<Supplier>("SELECT * FROM suppliers WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
  }

  async listSuppliers(tenantId: string): Promise<Supplier[]> {
    return this.db.query<Supplier>("SELECT * FROM suppliers WHERE tenant_id = @tenantId ORDER BY name ASC", { tenantId });
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
    // Auto-increment po_number: max existing + 1 for this tenant.
    const lastPo = await this.db.one<{ n: number }>(
      "SELECT COALESCE(MAX(po_number), 0)::int AS n FROM purchase_orders WHERE tenant_id = @t",
      { t: tenantId },
    );
    const poNumber = (lastPo?.n ?? 0) + 1;
    const poLines: PurchaseOrderLine[] = lines.map((l) => ({
      id: `pol_${uuidv7()}`,
      tenant_id: tenantId,
      po_id: poId,
      product_id: l.productId,
      product_name: l.productName ?? null,
      upc: l.upc ?? null,
      vendor_upc: l.vendorUpc ?? null,
      quantity: l.quantity,
      unit_cost_cents: l.unitCostCents,
      raw_cost_price_cents: l.rawCostPriceCents ?? null,
      unit_price_cents: l.unitPriceCents ?? null,
      line_cost_cents: l.quantity * l.unitCostCents,
      expiry_date: l.expiryDate ?? null,
      lot_code: l.lotCode ?? null,
      received_qty: 0,
      billed_qty: null,
    }));
    const total = poLines.reduce((s, l) => s + l.line_cost_cents, 0);
    await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, total_cost_cents, po_number, created_at, received_at)
         VALUES (@id,@tenant_id,@supplier_id,'ordered',@total,@po_number,@created_at,NULL)`,
        { id: poId, tenant_id: tenantId, supplier_id: supplierId, total, po_number: poNumber, created_at: now },
      );
      for (const l of poLines) {
        await tdb.query(
          `INSERT INTO purchase_order_lines
             (id, tenant_id, po_id, product_id, product_name, upc, vendor_upc, quantity,
              unit_cost_cents, raw_cost_price_cents, unit_price_cents, line_cost_cents,
              expiry_date, lot_code, received_qty, billed_qty)
           VALUES
             (@id,@tenant_id,@po_id,@product_id,@product_name,@upc,@vendor_upc,@quantity,
              @unit_cost_cents,@raw_cost_price_cents,@unit_price_cents,@line_cost_cents,
              @expiry_date,@lot_code,@received_qty,@billed_qty)`,
          l as unknown as Record<string, unknown>,
        );
      }
    });
    return {
      id: poId, tenant_id: tenantId, supplier_id: supplierId, po_number: poNumber,
      status: "ordered", receive_status: "pending", total_cost_cents: total,
      notes: null, created_at: now, received_at: null, lines: poLines,
    };
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

  /** Partially or fully receive a PO.
   *
   * Body: `{ lines: [{ lineId, qty }] }` where qty ≤ remaining on that line.
   * Each call increments `received_qty` on each referenced line.
   * PO status: ordered → partially_received → received.
   * Emits `purchase_order.received` on every receive call (with the qty
   * actually received this call), so inventory increments immediately. */
  async receive(
    id: string,
    tenantId: string,
    receiveLines: Array<{ lineId: string; qty: number }>,
  ): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(id, tenantId);
    if (po.status === "received") throw new HttpError(409, "already_received", "purchase order already fully received");
    if (po.status === "cancelled") throw new HttpError(409, "cancelled", "purchase order is cancelled");
    if (receiveLines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");

    // Validate each line: must belong to this PO, qty must be ≤ remaining.
    const lineMap = new Map(po.lines.map((l) => [l.id, l]));
    for (const rl of receiveLines) {
      const line = lineMap.get(rl.lineId);
      if (!line) throw new HttpError(404, "not_found", `line '${rl.lineId}' not found on this PO`);
      if (rl.qty <= 0) throw new HttpError(400, "bad_request", `qty for line '${rl.lineId}' must be positive`);
      const remaining = line.quantity - (line.received_qty ?? 0);
      if (rl.qty > remaining) throw new HttpError(400, "bad_request", `qty ${rl.qty} exceeds remaining ${remaining} on line '${rl.lineId}'`);
    }

    const now = Date.now();

    // Apply the increments and compute new PO status.
    await this.db.tx(async (tdb) => {
      for (const rl of receiveLines) {
        await tdb.query(
          "UPDATE purchase_order_lines SET received_qty = received_qty + @qty WHERE id = @lid AND tenant_id = @tenantId",
          { qty: rl.qty, lid: rl.lineId, tenantId },
        );
        const line = lineMap.get(rl.lineId)!;
        await tdb.query(
          `INSERT INTO product_costs (tenant_id, product_id, cost_cents, updated_at) VALUES (@tenant_id,@product_id,@cost,@now)
           ON CONFLICT (tenant_id, product_id) DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at`,
          { tenant_id: tenantId, product_id: line.product_id, cost: line.unit_cost_cents, now },
        );
      }

      // Re-read updated lines to determine the new PO status.
      const updatedLines = await tdb.query<PurchaseOrderLine>(
        "SELECT * FROM purchase_order_lines WHERE po_id = @id AND tenant_id = @tenantId",
        { id, tenantId },
      );
      const fullyReceived = updatedLines.every((l) => (l.received_qty ?? 0) >= l.quantity);
      const anyReceived = updatedLines.some((l) => (l.received_qty ?? 0) > 0);
      const newStatus: POStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : "ordered";
      const receiveStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : "pending";

      await tdb.query(
        "UPDATE purchase_orders SET status = @status, receive_status = @receiveStatus, received_at = @receivedAt WHERE id = @id AND tenant_id = @tenantId",
        { status: newStatus, receiveStatus, receivedAt: fullyReceived ? now : null, id, tenantId },
      );
    });

    // Emit event for the quantities received in this call so inventory can
    // increment stock immediately (partial receives are cumulative).
    const receivedLineDetails = receiveLines.map((rl) => {
      const line = lineMap.get(rl.lineId)!;
      return {
        productId: line.product_id,
        quantity: rl.qty,
        unitCostCents: line.unit_cost_cents,
        expiryDate: line.expiry_date ?? undefined,
        lotCode: line.lot_code ?? undefined,
      };
    });

    await this.events.publish(
      "purchase_order.received",
      { tenantId, poId: id, lines: receivedLineDetails },
      id,
    );

    // Return the refreshed PO.
    return this.getOrder(id, tenantId);
  }

  /** BE-11: Named alias for partial PO receiving — accepts per-line quantities.
   *  Delegates to `receive()` which already handles partial receives. */
  async receiveLines(
    poId: string,
    lines: Array<{ lineId: string; quantity: number }>,
    tenantId: string,
  ): Promise<PurchaseOrderWithLines> {
    return this.receive(poId, tenantId, lines.map((l) => ({ lineId: l.lineId, qty: l.quantity })));
  }
}
