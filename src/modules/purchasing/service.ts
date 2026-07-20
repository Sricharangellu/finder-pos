import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";
import { nextDocSeq, nextDocNumber } from "../../shared/docnumber.js";

import { clampLimit, decodeCursor, toPage } from "../../shared/pagination.js";
export type { CursorPage } from "../../shared/pagination.js";
import type { CursorPage } from "../../shared/pagination.js";

/** Purchasing — suppliers + purchase orders + receiving. Tenant-scoped.
 *  Receiving publishes `purchase_order.received`; the inventory module listens
 *  and increments stock (modules stay decoupled via events). Unit costs are
 *  captured into `product_costs` so the inventory grid can show cost. */

export type POStatus = "ordered" | "partially_received" | "received" | "cancelled";
export type VendorCreditType = "chargeback" | "credit_memo";
export type ReturnReason = "damaged" | "expired" | "other";

/** A received PO line awaiting cost confirmation on the Purchase page, with the
 *  reference prices that inform the cost decision. */
export interface CostEntryItem {
  line_id: string;
  product_id: string;
  sku: string | null;
  product_name: string;
  received_qty: number;
  po_cost_cents: number;                    // cost carried on the PO line (default)
  po_id: string;
  supplier_id: string;
  supplier_name: string | null;
  received_at: number | null;
  selling_price_cents: number;              // our current selling price
  last_purchase_cost_cents: number | null;  // last confirmed cost (any vendor)
  prev_vendor_cost_cents: number | null;    // most recent cost from THIS vendor
}

/** One line being received. `qty` is required; the rest are the receive-time
 *  actuals captured at the desk (only known when goods physically arrive). */
export interface ReceiveLineInput {
  lineId: string;
  qty: number;
  expiryDate?: number;      // epoch ms — drives the inventory lot's shelf-life
  lotCode?: string;
  unitCostCents?: number;   // actual cost on the invoice, if it differs from PO
  locationId?: string;      // stock location the goods are received into
}

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
  landed_cost_cents: number;   // allocated share of freight + other charges
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
  approval_status: POApprovalStatus;
  approved_at: number | null;
  total_cost_cents: number;
  freight_cost_cents: number;
  other_charges_cents: number;
  notes: string | null;
  created_at: number;
  received_at: number | null;
}

/** Approval state, orthogonal to the fulfillment status. Legacy rows default to 'approved'. */
export type POApprovalStatus = "approved" | "pending" | "rejected";

/** Who acted — passed from the route's auth payload into approval methods. */
export interface Actor {
  id: string | null;
  role: string;
}

/** Per-tenant approval tiers. Absent config = approvals disabled (auto-approve all). */
export interface POApprovalConfig {
  auto_limit_cents: number;    // total <  this → auto-approved
  manager_limit_cents: number; // total <  this → manager may approve; >= → owner only
  enabled: boolean;
}

export interface POApprovalEntry {
  id: string;
  tenant_id: string;
  po_id: string;
  action: "auto_approved" | "submitted" | "approved" | "rejected";
  actor_id: string | null;
  actor_role: string | null;
  amount_cents: number;
  note: string | null;
  created_at: number;
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
    return this.db.query<Supplier>("SELECT * FROM suppliers WHERE tenant_id = @tenantId ORDER BY name ASC LIMIT 500", { tenantId });
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

  // ── Vendor-360 detail views ─────────────────────────────────────────────────

  /** Full vendor profile: supplier row + spend / credit / fulfillment KPIs. */
  async vendorDetail(id: string, tenantId: string): Promise<Record<string, unknown>> {
    const supplier = await this.getSupplier(id, tenantId);
    if (!supplier) throw new HttpError(404, "not_found", `vendor '${id}' not found`);

    const spend = await this.db.one<{ po_count: number; spent: number }>(
      `SELECT COUNT(*)::int AS po_count, COALESCE(SUM(total_cost_cents),0) AS spent
         FROM purchase_orders WHERE tenant_id = @tenantId AND supplier_id = @id AND status = 'received'`,
      { tenantId, id },
    );
    const credits = await this.db.one<{ credits: number }>(
      `SELECT COALESCE(SUM(amount_cents),0) AS credits
         FROM vendor_credits WHERE tenant_id = @tenantId AND supplier_id = @id AND status = 'open'`,
      { tenantId, id },
    );
    // Fill rate = received qty vs ordered qty across all non-cancelled PO lines.
    const fill = await this.db.one<{ ordered: number; received: number }>(
      `SELECT COALESCE(SUM(l.quantity),0) AS ordered, COALESCE(SUM(l.received_qty),0) AS received
         FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.po_id AND po.tenant_id = l.tenant_id
        WHERE l.tenant_id = @tenantId AND po.supplier_id = @id AND po.status <> 'cancelled'`,
      { tenantId, id },
    );

    const poCount = Number(spend?.po_count ?? 0);
    const totalSpentCents = Number(spend?.spent ?? 0);
    const ordered = Number(fill?.ordered ?? 0);
    const received = Number(fill?.received ?? 0);
    return {
      ...supplier,
      poCount,
      totalSpentCents,
      openCreditsCents: Number(credits?.credits ?? 0),
      avg_po_value_cents: poCount > 0 ? Math.round(totalSpentCents / poCount) : 0,
      fill_rate_pct: ordered > 0 ? Math.round((received / ordered) * 100) : null,
      on_time_delivery_pct: null, // no promised-date tracking yet
      dispute_rate_pct: null,
    };
  }

  /** Products purchased from this vendor, derived from PO line history. */
  async vendorProducts(id: string, tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT DISTINCT ON (l.product_id)
              'vp_' || l.product_id                        AS id,
              l.product_id,
              COALESCE(p.name, l.product_id)               AS product_name,
              p.sku,
              NULL::text                                    AS vendor_sku,
              l.unit_cost_cents                             AS cost_cents,
              p.price_cents                                 AS retail_price_cents,
              CASE WHEN p.price_cents > 0
                   THEN ROUND((p.price_cents - l.unit_cost_cents)::numeric * 100 / p.price_cents, 1)::float
                   ELSE NULL END                            AS margin_pct,
              l.unit_cost_cents                             AS last_cost_cents,
              NULL::int                                     AS moq,
              s.lead_time_days,
              (p.preferred_vendor_id = @id)                 AS is_preferred,
              po.created_at                                 AS last_ordered_at
         FROM purchase_order_lines l
         JOIN purchase_orders po ON po.id = l.po_id AND po.tenant_id = l.tenant_id
         LEFT JOIN products p ON p.id = l.product_id AND p.tenant_id = l.tenant_id
         LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
        WHERE l.tenant_id = @tenantId AND po.supplier_id = @id
        ORDER BY l.product_id, po.created_at DESC
        LIMIT 200`,
      { tenantId, id },
    );
  }

  /** Purchase orders placed with this vendor (newest first). */
  async vendorPurchaseOrders(id: string, tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT po.id,
              CASE WHEN po.po_number IS NOT NULL THEN 'PO-' || po.po_number
                   ELSE 'PO-' || UPPER(RIGHT(po.id, 4)) END AS po_number,
              po.status,
              po.receive_status,
              po.total_cost_cents,
              (SELECT COUNT(*)::int FROM purchase_order_lines l
                WHERE l.po_id = po.id AND l.tenant_id = po.tenant_id) AS line_count,
              po.created_at,
              po.received_at
         FROM purchase_orders po
        WHERE po.tenant_id = @tenantId AND po.supplier_id = @id
        ORDER BY po.created_at DESC
        LIMIT 200`,
      { tenantId, id },
    );
  }

  /** Supplier bills (AP invoices) for this vendor. Reads the shared bills table. */
  async vendorInvoices(id: string, tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT b.id, b.bill_number, b.po_id,
              CASE WHEN po.po_number IS NOT NULL THEN 'PO-' || po.po_number
                   WHEN b.po_id IS NOT NULL THEN 'PO-' || UPPER(RIGHT(b.po_id, 4)) END AS po_number,
              b.status, b.total_cents, b.paid_cents, b.due_date, b.issued_at
         FROM bills b
         LEFT JOIN purchase_orders po ON po.id = b.po_id AND po.tenant_id = b.tenant_id
        WHERE b.tenant_id = @tenantId AND b.supplier_id = @id
        ORDER BY b.issued_at DESC
        LIMIT 200`,
      { tenantId, id },
    );
  }

  /** Chargebacks and credit memos for this vendor. */
  async vendorCreditsFor(id: string, tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT vc.id, vc.type, vc.amount_cents, vc.reason, vc.po_id,
              CASE WHEN po.po_number IS NOT NULL THEN 'PO-' || po.po_number
                   WHEN vc.po_id IS NOT NULL THEN 'PO-' || UPPER(RIGHT(vc.po_id, 4)) END AS po_number,
              vc.status, vc.created_at
         FROM vendor_credits vc
         LEFT JOIN purchase_orders po ON po.id = vc.po_id AND po.tenant_id = vc.tenant_id
        WHERE vc.tenant_id = @tenantId AND vc.supplier_id = @id
        ORDER BY vc.created_at DESC
        LIMIT 200`,
      { tenantId, id },
    );
  }

  /** Receiving history: per-PO ordered vs received quantities. */
  async vendorReceiving(id: string, tenantId: string): Promise<unknown[]> {
    return this.db.query(
      `SELECT 'rcv_' || po.id                               AS id,
              po.id                                          AS po_id,
              'PO-' || UPPER(RIGHT(po.id, 4))                AS po_number,
              NULL::text                                     AS received_by,
              po.received_at,
              COALESCE(SUM(l.quantity),0)::int               AS qty_ordered,
              COALESCE(SUM(l.received_qty),0)::int           AS qty_received,
              GREATEST(COALESCE(SUM(l.quantity),0) - COALESCE(SUM(l.received_qty),0), 0)::int AS short_qty,
              0                                              AS damage_qty,
              NULL::text                                     AS notes
         FROM purchase_orders po
         JOIN purchase_order_lines l ON l.po_id = po.id AND l.tenant_id = po.tenant_id
        WHERE po.tenant_id = @tenantId AND po.supplier_id = @id
          AND po.receive_status <> 'pending'
        GROUP BY po.id, po.received_at
        ORDER BY po.received_at DESC NULLS LAST
        LIMIT 200`,
      { tenantId, id },
    );
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

  /** Cursor-paginated (keyset) — the old LIMIT 500 silently hid older credits,
   *  and the by-supplier branch had no LIMIT at all. */
  async listVendorCredits(
    tenantId: string,
    supplierId?: string,
    query: { cursor?: string; limit?: number } = {},
  ): Promise<CursorPage<VendorCredit>> {
    const limit = clampLimit(query.limit, 500, 500);
    const cur = decodeCursor(query.cursor);
    const where = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId, limit };
    if (supplierId) { where.push("supplier_id = @s"); params["s"] = supplierId; }
    if (cur) { where.push("(created_at, id) < (@curAt, @curId)"); params["curAt"] = cur.at; params["curId"] = cur.id; }
    const items = await this.db.query<VendorCredit>(
      `SELECT * FROM vendor_credits WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      params,
    );
    return toPage(items as unknown as Array<VendorCredit & Record<string, unknown>>, limit, "created_at") as CursorPage<VendorCredit>;
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
    await this.db.withTenant(tenantId).tx(async (tdb) => {
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

  /** Cursor-paginated (keyset) — replaces the silent LIMIT 500 cap. */
  async listReturns(tenantId: string, query: { cursor?: string; limit?: number } = {}): Promise<CursorPage<VendorReturn>> {
    const limit = clampLimit(query.limit, 500, 500);
    const cur = decodeCursor(query.cursor);
    const where = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId, limit };
    if (cur) { where.push("(created_at, id) < (@curAt, @curId)"); params["curAt"] = cur.at; params["curId"] = cur.id; }
    const items = await this.db.query<VendorReturn>(
      `SELECT * FROM vendor_returns WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      params,
    );
    return toPage(items as unknown as Array<VendorReturn & Record<string, unknown>>, limit, "created_at") as CursorPage<VendorReturn>;
  }

  // ── PO approval workflow ─────────────────────────────────────────────────────

  async getApprovalConfig(tenantId: string): Promise<POApprovalConfig | null> {
    const row = await this.db.one<POApprovalConfig & { enabled: boolean }>(
      "SELECT auto_limit_cents::bigint::int8 AS auto_limit_cents, manager_limit_cents, enabled FROM po_approval_config WHERE tenant_id = @t",
      { t: tenantId },
    );
    if (!row) return null;
    return { auto_limit_cents: Number(row.auto_limit_cents), manager_limit_cents: Number(row.manager_limit_cents), enabled: row.enabled };
  }

  async setApprovalConfig(cfg: { autoLimitCents: number; managerLimitCents: number; enabled?: boolean }, tenantId: string): Promise<POApprovalConfig> {
    if (cfg.autoLimitCents < 0 || cfg.managerLimitCents < cfg.autoLimitCents) {
      throw new HttpError(400, "bad_request", "managerLimitCents must be >= autoLimitCents >= 0");
    }
    await this.db.query(
      `INSERT INTO po_approval_config (tenant_id, auto_limit_cents, manager_limit_cents, enabled, updated_at)
       VALUES (@t, @auto, @mgr, @enabled, @now)
       ON CONFLICT (tenant_id) DO UPDATE SET auto_limit_cents = @auto, manager_limit_cents = @mgr, enabled = @enabled, updated_at = @now`,
      { t: tenantId, auto: cfg.autoLimitCents, mgr: cfg.managerLimitCents, enabled: cfg.enabled ?? true, now: Date.now() },
    );
    return { auto_limit_cents: cfg.autoLimitCents, manager_limit_cents: cfg.managerLimitCents, enabled: cfg.enabled ?? true };
  }

  /** The role tier required to approve a PO of this amount under the given config. */
  private requiredTier(totalCents: number, cfg: POApprovalConfig | null): "auto" | "manager" | "owner" {
    if (!cfg || !cfg.enabled || totalCents < cfg.auto_limit_cents) return "auto";
    return totalCents < cfg.manager_limit_cents ? "manager" : "owner";
  }

  /** Append-only audit write. Nothing in the codebase updates or deletes these rows. */
  private async logApproval(
    poId: string, tenantId: string,
    action: POApprovalEntry["action"], actor: Actor | null, amountCents: number, note?: string | null,
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO po_approvals (id, tenant_id, po_id, action, actor_id, actor_role, amount_cents, note, created_at)
       VALUES (@id, @t, @po, @action, @actorId, @actorRole, @amount, @note, @now)`,
      { id: `poa_${uuidv7()}`, t: tenantId, po: poId, action, actorId: actor?.id ?? null, actorRole: actor?.role ?? null, amount: amountCents, note: note ?? null, now: Date.now() },
    );
  }

  async listApprovals(poId: string, tenantId: string): Promise<POApprovalEntry[]> {
    await this.getOrder(poId, tenantId); // 404 if the PO doesn't exist
    return this.db.query<POApprovalEntry>(
      "SELECT * FROM po_approvals WHERE tenant_id = @t AND po_id = @po ORDER BY created_at ASC, id ASC",
      { t: tenantId, po: poId },
    );
  }

  async approveOrder(poId: string, actor: Actor, tenantId: string): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(poId, tenantId);
    if (po.approval_status === "approved") throw new HttpError(409, "already_approved", "purchase order is already approved");
    if (po.approval_status === "rejected") throw new HttpError(409, "rejected", "a rejected purchase order cannot be approved; create a new PO");
    const cfg = await this.getApprovalConfig(tenantId);
    const tier = this.requiredTier(po.total_cost_cents, cfg);
    if (tier === "owner" && actor.role !== "owner") {
      throw new HttpError(403, "approval_tier", "this purchase order amount requires owner approval");
    }
    const now = Date.now();
    await this.db.query(
      "UPDATE purchase_orders SET approval_status = 'approved', approved_at = @now WHERE id = @id AND tenant_id = @t",
      { now, id: poId, t: tenantId },
    );
    await this.logApproval(poId, tenantId, "approved", actor, po.total_cost_cents);
    return this.getOrder(poId, tenantId);
  }

  async rejectOrder(poId: string, actor: Actor, tenantId: string, note?: string): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(poId, tenantId);
    if (po.approval_status !== "pending") throw new HttpError(409, "not_pending", "only a pending purchase order can be rejected");
    await this.db.query(
      "UPDATE purchase_orders SET approval_status = 'rejected' WHERE id = @id AND tenant_id = @t",
      { id: poId, t: tenantId },
    );
    await this.logApproval(poId, tenantId, "rejected", actor, po.total_cost_cents, note);
    return this.getOrder(poId, tenantId);
  }

  /** Guard used by receiving: goods cannot be received against an unapproved PO. */
  private assertApproved(po: PurchaseOrder): void {
    if (po.approval_status === "pending") throw new HttpError(409, "approval_pending", "purchase order is awaiting approval and cannot be received");
    if (po.approval_status === "rejected") throw new HttpError(409, "rejected", "a rejected purchase order cannot be received");
  }

  async createOrder(supplierId: string, lines: POLineInput[], tenantId: string, actor?: Actor): Promise<PurchaseOrderWithLines> {
    if (lines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");
    const supplier = await this.db.one("SELECT id FROM suppliers WHERE id = @supplierId AND tenant_id = @tenantId", { supplierId, tenantId });
    if (!supplier) throw new HttpError(404, "not_found", `supplier '${supplierId}' not found`);
    const now = Date.now();
    const poId = `po_${uuidv7()}`;
    // Race-free po_number via the shared atomic counter — MAX(po_number)+1 let
    // two concurrent creates mint the same number. Seeded from existing MAX in
    // the migration so numbering continues without collision.
    const poNumber = await nextDocSeq(this.db, tenantId, "purchase_orders");
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
      landed_cost_cents: 0,
      expiry_date: l.expiryDate ?? null,
      lot_code: l.lotCode ?? null,
      received_qty: 0,
      billed_qty: null,
    }));
    const total = poLines.reduce((s, l) => s + l.line_cost_cents, 0);
    // Amount-tier approval gate. No config (or below the auto limit) → auto-approved,
    // preserving the pre-workflow behavior; otherwise the PO waits in 'pending'.
    const cfg = await this.getApprovalConfig(tenantId);
    const tier = this.requiredTier(total, cfg);
    const approvalStatus: POApprovalStatus = tier === "auto" ? "approved" : "pending";
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO purchase_orders (id, tenant_id, supplier_id, status, approval_status, approved_at, total_cost_cents, po_number, created_at, received_at)
         VALUES (@id,@tenant_id,@supplier_id,'ordered',@approval_status,@approved_at,@total,@po_number,@created_at,NULL)`,
        { id: poId, tenant_id: tenantId, supplier_id: supplierId, approval_status: approvalStatus, approved_at: approvalStatus === "approved" ? now : null, total, po_number: poNumber, created_at: now },
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
    await this.logApproval(poId, tenantId, approvalStatus === "approved" ? "auto_approved" : "submitted", actor ?? null, total);
    return {
      id: poId, tenant_id: tenantId, supplier_id: supplierId, po_number: poNumber,
      status: "ordered", receive_status: "pending",
      approval_status: approvalStatus, approved_at: approvalStatus === "approved" ? now : null,
      total_cost_cents: total,
      freight_cost_cents: 0, other_charges_cents: 0, notes: null,
      created_at: now, received_at: null, lines: poLines,
    };
  }

  async listOrders(tenantId: string, query: { cursor?: string; limit?: number } = {}): Promise<CursorPage<PurchaseOrder>> {
    const limit = clampLimit(query.limit);
    const cur = query.cursor
      ? (JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as { at: number; id: string })
      : null;
    const where = ["tenant_id = @tenantId"];
    const params: Record<string, unknown> = { tenantId };
    if (cur) {
      where.push("(created_at, id) < (@curAt, @curId)");
      params.curAt = cur.at;
      params.curId = cur.id;
    }
    const items = await this.db.query<PurchaseOrder>(
      `SELECT * FROM purchase_orders WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      { ...params, limit },
    );
    const last = items[items.length - 1];
    const nextCursor =
      items.length === limit && last
        ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString("base64url")
        : null;
    return { items, nextCursor, limit };
  }

  async getOrder(id: string, tenantId: string): Promise<PurchaseOrderWithLines> {
    const po = await this.db.one<PurchaseOrder>("SELECT * FROM purchase_orders WHERE id = @id AND tenant_id = @tenantId", { id, tenantId });
    if (!po) throw new HttpError(404, "not_found", `purchase order '${id}' not found`);
    const lines = await this.db.query<PurchaseOrderLine>("SELECT * FROM purchase_order_lines WHERE po_id = @id AND tenant_id = @tenantId", { id, tenantId });
    return { ...po, lines };
  }

  /** Apply freight and other charges to a PO, distributing them across lines by value.
   *
   * Distribution method: value (proportional to each line's goods cost).
   *   line_landed_cost = total_extra × (line_cost / goods_total)
   * Rounding remainder goes to the largest line to keep totals exact.
   * Can be called multiple times — each call replaces the previous allocation. */
  async applyLandedCosts(
    poId: string,
    tenantId: string,
    freightCents: number,
    otherChargesCents: number,
  ): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(poId, tenantId);
    if (po.status === "received") throw new HttpError(409, "already_received", "cannot modify landed costs on a fully-received PO");
    if (freightCents < 0 || otherChargesCents < 0) throw new HttpError(400, "bad_request", "costs must be non-negative");

    const totalExtra = freightCents + otherChargesCents;
    const goodsTotal = po.lines.reduce((s, l) => s + Number(l.line_cost_cents), 0);

    // Distribute proportionally by value; accumulate to detect rounding remainder.
    let allocated = 0;
    const allocations: Array<{ id: string; share: number }> = po.lines.map((l, i) => {
      const isLast = i === po.lines.length - 1;
      const share = isLast
        ? totalExtra - allocated
        : goodsTotal === 0
        ? Math.round(totalExtra / po.lines.length)
        : Math.round(totalExtra * (Number(l.line_cost_cents) / goodsTotal));
      allocated += share;
      return { id: l.id, share };
    });

    await this.db.withTenant(tenantId).tx(async (tdb) => {
      for (const { id, share } of allocations) {
        await tdb.query(
          "UPDATE purchase_order_lines SET landed_cost_cents = @share WHERE id = @id AND tenant_id = @tenantId",
          { share, id, tenantId },
        );
      }
      await tdb.query(
        "UPDATE purchase_orders SET freight_cost_cents = @freight, other_charges_cents = @other WHERE id = @id AND tenant_id = @tenantId",
        { freight: freightCents, other: otherChargesCents, id: poId, tenantId },
      );
    });

    return this.getOrder(poId, tenantId);
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
    receiveLines: ReceiveLineInput[],
  ): Promise<PurchaseOrderWithLines> {
    const po = await this.getOrder(id, tenantId);
    if (po.status === "received") throw new HttpError(409, "already_received", "purchase order already fully received");
    if (po.status === "cancelled") throw new HttpError(409, "cancelled", "purchase order is cancelled");
    this.assertApproved(po);
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
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      for (const rl of receiveLines) {
        // Persist the receive-time actuals onto the line so the PO reflects what
        // actually arrived; COALESCE keeps prior values when a field is omitted.
        await tdb.query(
          `UPDATE purchase_order_lines
              SET received_qty = received_qty + @qty,
                  expiry_date  = COALESCE(@expiryDate, expiry_date),
                  lot_code     = COALESCE(@lotCode, lot_code)
            WHERE id = @lid AND tenant_id = @tenantId`,
          { qty: rl.qty, expiryDate: rl.expiryDate ?? null, lotCode: rl.lotCode ?? null, lid: rl.lineId, tenantId },
        );
        const line = lineMap.get(rl.lineId)!;
        // True unit cost = (goods cost + landed cost share) / quantity.
        const landedUnitCost = Math.round(
          (line.line_cost_cents + (line.landed_cost_cents ?? 0)) / line.quantity,
        );
        await tdb.query(
          `INSERT INTO product_costs (tenant_id, product_id, cost_cents, updated_at) VALUES (@tenant_id,@product_id,@cost,@now)
           ON CONFLICT (tenant_id, product_id) DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at`,
          { tenant_id: tenantId, product_id: line.product_id, cost: landedUnitCost, now },
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
      // Prefer the actuals entered at the receiving desk; fall back to whatever
      // was planned on the PO line. This is what drives the inventory lot.
      return {
        productId: line.product_id,
        quantity: rl.qty,
        unitCostCents: rl.unitCostCents ?? line.unit_cost_cents,
        expiryDate: rl.expiryDate ?? line.expiry_date ?? undefined,
        lotCode: rl.lotCode ?? line.lot_code ?? undefined,
        locationId: rl.locationId ?? undefined,
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

  // ── Supplier addresses ───────────────────────────────────────────────────────
  async listSupplierAddresses(supplierId: string, tenantId: string) {
    return this.db.query("SELECT * FROM supplier_addresses WHERE supplier_id = @sid AND tenant_id = @t ORDER BY is_default DESC, created_at ASC LIMIT 100", { sid: supplierId, t: tenantId });
  }

  async addSupplierAddress(supplierId: string, tenantId: string, input: { addressType?: string; addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; zip?: string | null; country?: string; county?: string | null; isDefault?: boolean }) {
    const now = Date.now();
    const id = `saddr_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO supplier_addresses (id, tenant_id, supplier_id, address_type, address_line1, address_line2, city, state, zip, country, county, is_default, created_at, updated_at)
       VALUES (@id, @t, @sid, @type, @l1, @l2, @city, @state, @zip, @country, @county, @def, @now, @now)`,
      { id, t: tenantId, sid: supplierId, type: input.addressType ?? 'billing', l1: input.addressLine1 ?? null, l2: input.addressLine2 ?? null, city: input.city ?? null, state: input.state ?? null, zip: input.zip ?? null, country: input.country ?? 'US', county: input.county ?? null, def: input.isDefault ?? false, now },
    );
    return { id, supplier_id: supplierId, tenant_id: tenantId, ...input, created_at: now, updated_at: now };
  }

  // ── Supplier contacts ────────────────────────────────────────────────────────
  async listSupplierContacts(supplierId: string, tenantId: string) {
    return this.db.query("SELECT * FROM supplier_contacts WHERE supplier_id = @sid AND tenant_id = @t ORDER BY is_primary DESC, created_at ASC LIMIT 100", { sid: supplierId, t: tenantId });
  }

  async addSupplierContact(supplierId: string, tenantId: string, input: { contactName: string; title?: string | null; email?: string | null; phone?: string | null; isPrimary?: boolean }) {
    const now = Date.now();
    const id = `scon_${uuidv7()}`;
    await this.db.query(
      `INSERT INTO supplier_contacts (id, tenant_id, supplier_id, contact_name, title, email, phone, is_primary, created_at, updated_at)
       VALUES (@id, @t, @sid, @name, @title, @email, @phone, @primary, @now, @now)`,
      { id, t: tenantId, sid: supplierId, name: input.contactName, title: input.title ?? null, email: input.email ?? null, phone: input.phone ?? null, primary: input.isPrimary ?? false, now },
    );
    return { id, supplier_id: supplierId, tenant_id: tenantId, ...input, created_at: now, updated_at: now };
  }

  // ── PO documents ─────────────────────────────────────────────────────────────

  async listPODocuments(poId: string, tenantId: string) {
    return this.db.query<{ id: string; po_id: string; name: string; type: string; size_bytes: number; uploaded_at: number }>(
      "SELECT id, po_id, name, type, size_bytes, uploaded_at FROM po_documents WHERE po_id = @poId AND tenant_id = @t ORDER BY uploaded_at DESC LIMIT 100",
      { poId, t: tenantId },
    );
  }

  async addPODocument(poId: string, tenantId: string, input: { name: string; type: string; sizeBytes: number }) {
    const id = `pdoc_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      "INSERT INTO po_documents (id, tenant_id, po_id, name, type, size_bytes, uploaded_at) VALUES (@id, @t, @poId, @name, @type, @size, @now)",
      { id, t: tenantId, poId, name: input.name, type: input.type, size: input.sizeBytes, now },
    );
    return { id, po_id: poId, name: input.name, type: input.type, size_bytes: input.sizeBytes, uploaded_at: now };
  }

  async deletePODocument(poId: string, docId: string, tenantId: string) {
    await this.db.query(
      "DELETE FROM po_documents WHERE id = @docId AND po_id = @poId AND tenant_id = @t",
      { docId, poId, t: tenantId },
    );
  }

  // ── PO billing adjustments ───────────────────────────────────────────────────

  async listBillingAdj(poId: string, tenantId: string) {
    return this.db.query<{ id: string; po_id: string; line_id: string | null; reason: string; amount_cents: number; created_at: number }>(
      "SELECT id, po_id, line_id, reason, amount_cents, created_at FROM po_billing_adjustments WHERE po_id = @poId AND tenant_id = @t ORDER BY created_at ASC",
      { poId, t: tenantId },
    );
  }

  async createBillingAdj(poId: string, tenantId: string, input: { lineId?: string; reason: string; amountCents: number }) {
    const id = `badj_${uuidv7()}`;
    const now = Date.now();
    await this.db.query(
      "INSERT INTO po_billing_adjustments (id, tenant_id, po_id, line_id, reason, amount_cents, created_at) VALUES (@id, @t, @poId, @lineId, @reason, @amount, @now)",
      { id, t: tenantId, poId, lineId: input.lineId ?? null, reason: input.reason, amount: input.amountCents, now },
    );
    return { id, po_id: poId, line_id: input.lineId ?? null, reason: input.reason, amount_cents: input.amountCents, created_at: now };
  }

  // ── Vendor price history ─────────────────────────────────────────────────────
  // Returns the last 5 unit costs for each product on the given PO, sourced
  // from product_costs (which is updated on every receive).

  /**
   * Per-line purchasing price intelligence for a PO. For each line it surfaces
   * three reference prices — the current invoiced cost, the last cost paid to
   * *this* supplier, and the best (lowest) cost across *all* suppliers — each
   * with the date it applied, plus a suggested purchase quantity derived from
   * the product's reorder point and recent sales velocity.
   *
   * History is drawn from received (or partially-received) POs and can be
   * narrowed with `from`/`to` (received-at epoch ms) and `qtyBreak` (only count
   * historical lines whose quantity ≥ the break, so per-case pricing isn't
   * skewed by odd-lot buys). The `history` array is preserved for the existing
   * sparkline UI. Part 2 of 3 (purchasing price intelligence).
   */
  async priceHistory(
    poId: string,
    tenantId: string,
    opts: { from?: number; to?: number; qtyBreak?: number } = {},
  ) {
    const po = await this.db.one<{ supplier_id: string }>(
      "SELECT supplier_id FROM purchase_orders WHERE id = @poId AND tenant_id = @t",
      { poId, t: tenantId },
    );
    if (!po) return [];

    const lines = await this.db.query<{ product_id: string; product_name: string | null; unit_cost_cents: number; quantity: number }>(
      "SELECT product_id, product_name, unit_cost_cents, quantity FROM purchase_order_lines WHERE po_id = @poId AND tenant_id = @t",
      { poId, t: tenantId },
    );

    const from = opts.from ?? 0;
    const to = opts.to ?? Number.MAX_SAFE_INTEGER;
    const qtyBreak = opts.qtyBreak ?? 0;
    const lookbackDays = 90;
    const since = Date.now() - lookbackDays * 86_400_000;

    const items = await Promise.all(
      lines.map(async (l) => {
        // All received prices for this product, newest first, within filters.
        const hist = await this.db.query<{ unit_cost_cents: number; received_at: number; po_id: string; supplier_id: string | null; supplier_name: string | null }>(
          `SELECT pol.unit_cost_cents, po.received_at, po.id AS po_id,
                  po.supplier_id, s.name AS supplier_name
           FROM purchase_order_lines pol
           JOIN purchase_orders po ON po.id = pol.po_id AND po.tenant_id = pol.tenant_id
           LEFT JOIN suppliers s ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
           WHERE pol.product_id = @productId AND pol.tenant_id = @t
             AND po.status IN ('received','partially_received')
             AND po.received_at IS NOT NULL
             AND po.received_at >= @from AND po.received_at <= @to
             AND pol.quantity >= @qtyBreak
           ORDER BY po.received_at DESC`,
          { productId: l.product_id, t: tenantId, from, to, qtyBreak },
        );

        const lastFromSupplierRow = hist.find((h) => h.supplier_id === po.supplier_id) ?? null;
        // Best = lowest unit cost; tie broken by most recent (hist is DESC by date).
        const bestRow = hist.reduce<typeof hist[number] | null>((best, h) => {
          if (!best || h.unit_cost_cents < best.unit_cost_cents) return h;
          return best;
        }, null);

        // Suggested purchase qty from reorder point + recent sales velocity.
        const stats = await this.db.one<{ current_stock: number; reorder_point: number; reorder_quantity: number; lead_time_days: number; units_sold: number }>(
          `SELECT COALESCE(inv.stock_qty, 0)        AS current_stock,
                  COALESCE(p.reorder_point, 0)      AS reorder_point,
                  COALESCE(p.reorder_quantity, 0)   AS reorder_quantity,
                  COALESCE(p.lead_time_days, 7)     AS lead_time_days,
                  COALESCE((
                    SELECT SUM(ol.quantity)
                    FROM order_lines ol
                    JOIN orders o ON o.id = ol.order_id
                    WHERE ol.product_id = p.id AND ol.tenant_id = p.tenant_id
                      AND o.created_at >= @since
                  ), 0)                             AS units_sold
           FROM products p
           LEFT JOIN inventory inv ON inv.product_id = p.id AND inv.tenant_id = p.tenant_id
           WHERE p.id = @productId AND p.tenant_id = @t`,
          { productId: l.product_id, t: tenantId, since },
        );

        const velocityPerDay = stats ? stats.units_sold / lookbackDays : 0;
        // Target on-hand = reorder point + expected demand over the lead time.
        let suggestedQty = 0;
        if (stats) {
          const target = stats.reorder_point + velocityPerDay * stats.lead_time_days;
          suggestedQty = Math.max(0, Math.ceil(target - stats.current_stock));
          // Respect a configured reorder lot size as a floor when we do reorder.
          if (suggestedQty > 0 && stats.reorder_quantity > 0) {
            suggestedQty = Math.max(suggestedQty, stats.reorder_quantity);
          }
        }

        return {
          product_id: l.product_id,
          product_name: l.product_name ?? l.product_id,
          sku: l.product_id,
          ordered_qty: l.quantity,
          invoiced_cents: l.unit_cost_cents,
          last_from_supplier: lastFromSupplierRow
            ? { unit_cost_cents: lastFromSupplierRow.unit_cost_cents, received_at: lastFromSupplierRow.received_at }
            : null,
          best_across_suppliers: bestRow
            ? {
                unit_cost_cents: bestRow.unit_cost_cents,
                received_at: bestRow.received_at,
                supplier_id: bestRow.supplier_id,
                supplier_name: bestRow.supplier_name,
              }
            : null,
          suggested_qty: suggestedQty,
          velocity_per_day: Math.round(velocityPerDay * 100) / 100,
          current_stock: stats?.current_stock ?? 0,
          history: hist.slice(0, 5).map((h) => ({ unit_cost_cents: h.unit_cost_cents, received_at: h.received_at, po_id: h.po_id })),
        };
      }),
    );
    return items;
  }

  // ── Purchase cost entry ──────────────────────────────────────────────────────
  // Received PO lines flow into a costing worksheet: enter the true cost per
  // product, with reference prices (previous cost from the SAME vendor, last
  // purchase cost from any vendor, our selling price) to inform the decision.

  async getCostEntryQueue(tenantId: string): Promise<CostEntryItem[]> {
    return this.db.query<CostEntryItem>(
      `SELECT pol.id                                   AS line_id,
              pol.product_id                           AS product_id,
              p.sku                                    AS sku,
              COALESCE(p.name, pol.product_name)       AS product_name,
              pol.received_qty                         AS received_qty,
              pol.unit_cost_cents                      AS po_cost_cents,
              po.id                                    AS po_id,
              po.supplier_id                           AS supplier_id,
              s.name                                   AS supplier_name,
              po.received_at                           AS received_at,
              COALESCE(p.price_cents, 0)               AS selling_price_cents,
              pc.cost_cents                            AS last_purchase_cost_cents,
              (SELECT pol2.unit_cost_cents
                 FROM purchase_order_lines pol2
                 JOIN purchase_orders po2 ON po2.id = pol2.po_id AND po2.tenant_id = pol2.tenant_id
                WHERE pol2.product_id = pol.product_id AND pol2.tenant_id = pol.tenant_id
                  AND po2.supplier_id = po.supplier_id AND po2.id <> po.id
                  AND po2.status IN ('received','partially_received')
                ORDER BY po2.received_at DESC NULLS LAST
                LIMIT 1)                               AS prev_vendor_cost_cents
         FROM purchase_order_lines pol
         JOIN purchase_orders po ON po.id = pol.po_id AND po.tenant_id = pol.tenant_id
         LEFT JOIN suppliers s   ON s.id = po.supplier_id AND s.tenant_id = po.tenant_id
         LEFT JOIN products p    ON p.id = pol.product_id AND p.tenant_id = pol.tenant_id
         LEFT JOIN product_costs pc ON pc.product_id = pol.product_id AND pc.tenant_id = pol.tenant_id
        WHERE pol.tenant_id = @t
          AND po.status IN ('received','partially_received')
          AND pol.received_qty > 0
        ORDER BY po.received_at DESC NULLS LAST, pol.id
        LIMIT 200`,
      { t: tenantId },
    );
  }

  /** Set a product's confirmed cost (updates product_costs — the cost the
   *  inventory grid & COGS read — and notifies inventory to revalue). */
  async submitProductCost(tenantId: string, productId: string, costCents: number): Promise<{ product_id: string; cost_cents: number }> {
    if (!Number.isInteger(costCents) || costCents < 0) {
      throw new HttpError(400, "bad_request", "cost must be a non-negative integer (cents)");
    }
    const now = Date.now();
    await this.db.query(
      `INSERT INTO product_costs (tenant_id, product_id, cost_cents, updated_at) VALUES (@t,@p,@c,@now)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET cost_cents = EXCLUDED.cost_cents, updated_at = EXCLUDED.updated_at`,
      { t: tenantId, p: productId, c: costCents, now },
    );
    await this.events.publish("product.cost_updated", { tenantId, productId, costCents }, productId);
    return { product_id: productId, cost_cents: costCents };
  }

  // ── Vendor quotes ────────────────────────────────────────────────────────────

  async listVendorQuotes(tenantId: string) {
    const quotes = await this.db.query<{ id: string; supplier_id: string; status: string; expires_at: number | null; total_cents: number; created_at: number; updated_at: number }>(
      "SELECT id, supplier_id, status, expires_at, total_cents, created_at, updated_at FROM vendor_quotes WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 100",
      { t: tenantId },
    );
    const items = await Promise.all(quotes.map(async (q) => {
      const lines = await this.db.query<{ id: string; product_id: string; product_name: string | null; qty: number; unit_price_cents: number }>(
        "SELECT id, product_id, product_name, qty, unit_price_cents FROM vendor_quote_lines WHERE quote_id = @qid AND tenant_id = @t",
        { qid: q.id, t: tenantId },
      );
      const [supplier] = await this.db.query<{ name: string }>("SELECT name FROM suppliers WHERE id = @id AND tenant_id = @t", { id: q.supplier_id, t: tenantId });
      return { ...q, vendor: supplier?.name ?? q.supplier_id, line_items: lines };
    }));
    return items;
  }

  async createVendorQuote(tenantId: string, input: { supplierId: string; lines: Array<{ productId: string; productName?: string; qty: number; unitPriceCents: number }>; expiresAt?: number }) {
    const id = `vq_${uuidv7()}`;
    const now = Date.now();
    const total = input.lines.reduce((s, l) => s + l.qty * l.unitPriceCents, 0);
    await this.db.query(
      "INSERT INTO vendor_quotes (id, tenant_id, supplier_id, status, expires_at, total_cents, created_at, updated_at) VALUES (@id, @t, @sid, 'pending', @exp, @total, @now, @now)",
      { id, t: tenantId, sid: input.supplierId, exp: input.expiresAt ?? null, total, now },
    );
    for (const l of input.lines) {
      await this.db.query(
        "INSERT INTO vendor_quote_lines (id, tenant_id, quote_id, product_id, product_name, qty, unit_price_cents) VALUES (@lid, @t, @qid, @pid, @pname, @qty, @price)",
        { lid: `vql_${uuidv7()}`, t: tenantId, qid: id, pid: l.productId, pname: l.productName ?? null, qty: l.qty, price: l.unitPriceCents },
      );
    }
    const [supplier] = await this.db.query<{ name: string }>("SELECT name FROM suppliers WHERE id = @sid AND tenant_id = @t", { sid: input.supplierId, t: tenantId });
    return { id, supplier_id: input.supplierId, vendor: supplier?.name ?? input.supplierId, status: "pending", expires_at: input.expiresAt ?? null, total_cents: total, line_items: input.lines.map((l, i) => ({ id: `vql_${i}`, product_id: l.productId, product_name: l.productName ?? null, qty: l.qty, unit_price_cents: l.unitPriceCents })), created_at: now, updated_at: now };
  }

  async updateVendorQuoteStatus(id: string, tenantId: string, status: "accepted" | "rejected") {
    await this.db.query(
      "UPDATE vendor_quotes SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t",
      { status, now: Date.now(), id, t: tenantId },
    );
    const [q] = await this.db.query<{ id: string; supplier_id: string; status: string; expires_at: number | null; total_cents: number; created_at: number; updated_at: number }>(
      "SELECT * FROM vendor_quotes WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!q) throw new HttpError(404, "not_found", "Vendor quote not found");
    return q;
  }

  // ── Override listVendorCredits to support poId filter ───────────────────────

  async listVendorCreditsFiltered(tenantId: string, filters: { supplierId?: string; poId?: string }) {
    const { supplierId, poId } = filters;
    if (poId) {
      return this.db.query<VendorCredit>(
        "SELECT * FROM vendor_credits WHERE tenant_id = @t AND po_id = @poId ORDER BY created_at DESC LIMIT 100",
        { t: tenantId, poId },
      );
    }
    if (supplierId) {
      return this.db.query<VendorCredit>(
        "SELECT * FROM vendor_credits WHERE tenant_id = @t AND supplier_id = @sid ORDER BY created_at DESC LIMIT 100",
        { t: tenantId, sid: supplierId },
      );
    }
    return this.db.query<VendorCredit>(
      "SELECT * FROM vendor_credits WHERE tenant_id = @t ORDER BY created_at DESC LIMIT 100",
      { t: tenantId },
    );
  }

  // ── Purchase requisitions (procurement PRD module 1 / ACPA E2) ─────────────
  // draft → submitted → approved | rejected → converted (to a PO).
  // Only drafts are editable; conversion requires approval and goes through
  // createOrder, so the resulting PO is still subject to PO approval tiers.

  private async getRequisitionOrThrow(id: string, tenantId: string): Promise<Requisition> {
    const row = await this.db.one<Requisition>(
      "SELECT * FROM purchase_requisitions WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    if (!row) throw new HttpError(404, "not_found", `requisition '${id}' not found`);
    return row;
  }

  async getRequisition(id: string, tenantId: string): Promise<RequisitionWithLines> {
    const req = await this.getRequisitionOrThrow(id, tenantId);
    const lines = await this.db.query<RequisitionLine>(
      "SELECT * FROM purchase_requisition_lines WHERE requisition_id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
    return { ...req, lines };
  }

  async createRequisition(
    input: {
      department?: string | null;
      requiredDate?: number | null;
      priority?: "low" | "normal" | "high";
      notes?: string | null;
      lines: Array<{ productId: string; quantity: number; estCostCents?: number; productName?: string | null }>;
    },
    actor: Actor,
    tenantId: string,
  ): Promise<RequisitionWithLines> {
    if (input.lines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");
    const now = Date.now();
    const id = `preq_${uuidv7()}`;
    const reqNumber = await nextDocNumber(this.db, tenantId, "purchase_requisitions", "PR");
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO purchase_requisitions (id, tenant_id, req_number, status, department, requested_by, required_date, priority, notes, created_at, updated_at)
         VALUES (@id, @t, @num, 'draft', @dept, @by, @reqDate, @prio, @notes, @now, @now)`,
        { id, t: tenantId, num: reqNumber, dept: input.department ?? null, by: actor.id, reqDate: input.requiredDate ?? null, prio: input.priority ?? "normal", notes: input.notes ?? null, now },
      );
      for (const l of input.lines) {
        await tdb.query(
          `INSERT INTO purchase_requisition_lines (id, tenant_id, requisition_id, product_id, product_name, quantity, est_cost_cents)
           VALUES (@id, @t, @req, @pid, @pname, @qty, @est)`,
          { id: `preql_${uuidv7()}`, t: tenantId, req: id, pid: l.productId, pname: l.productName ?? null, qty: l.quantity, est: l.estCostCents ?? 0 },
        );
      }
    });
    return this.getRequisition(id, tenantId);
  }

  /** Draft-only edits: header fields and full line replacement. */
  async updateRequisition(
    id: string,
    input: {
      department?: string | null;
      requiredDate?: number | null;
      priority?: "low" | "normal" | "high";
      notes?: string | null;
      lines?: Array<{ productId: string; quantity: number; estCostCents?: number; productName?: string | null }>;
    },
    tenantId: string,
  ): Promise<RequisitionWithLines> {
    const req = await this.getRequisitionOrThrow(id, tenantId);
    if (req.status !== "draft") throw new HttpError(409, "not_draft", "only a draft requisition can be edited");
    if (input.lines && input.lines.length === 0) throw new HttpError(400, "bad_request", "at least one line is required");
    const now = Date.now();
    await this.db.withTenant(tenantId).tx(async (tdb) => {
      await tdb.query(
        `UPDATE purchase_requisitions SET
           department = COALESCE(@dept, department),
           required_date = COALESCE(@reqDate, required_date),
           priority = COALESCE(@prio, priority),
           notes = COALESCE(@notes, notes),
           updated_at = @now
         WHERE id = @id AND tenant_id = @t`,
        { dept: input.department ?? null, reqDate: input.requiredDate ?? null, prio: input.priority ?? null, notes: input.notes ?? null, now, id, t: tenantId },
      );
      if (input.lines) {
        await tdb.query("DELETE FROM purchase_requisition_lines WHERE requisition_id = @id AND tenant_id = @t", { id, t: tenantId });
        for (const l of input.lines) {
          await tdb.query(
            `INSERT INTO purchase_requisition_lines (id, tenant_id, requisition_id, product_id, product_name, quantity, est_cost_cents)
             VALUES (@id, @t, @req, @pid, @pname, @qty, @est)`,
            { id: `preql_${uuidv7()}`, t: tenantId, req: id, pid: l.productId, pname: l.productName ?? null, qty: l.quantity, est: l.estCostCents ?? 0 },
          );
        }
      }
    });
    return this.getRequisition(id, tenantId);
  }

  private async transitionRequisition(
    id: string, tenantId: string,
    from: RequisitionStatus[], to: RequisitionStatus,
    actor?: Actor, note?: string,
  ): Promise<RequisitionWithLines> {
    const req = await this.getRequisitionOrThrow(id, tenantId);
    if (!from.includes(req.status)) {
      throw new HttpError(409, "invalid_transition", `requisition is '${req.status}'; expected ${from.join("/")}`);
    }
    await this.db.query(
      `UPDATE purchase_requisitions SET status = @to, decided_by = COALESCE(@by, decided_by),
         decided_at = CASE WHEN @by IS NULL THEN decided_at ELSE @now END,
         decision_note = COALESCE(@note, decision_note), updated_at = @now
       WHERE id = @id AND tenant_id = @t`,
      { to, by: actor?.id ?? null, note: note ?? null, now: Date.now(), id, t: tenantId },
    );
    return this.getRequisition(id, tenantId);
  }

  async submitRequisition(id: string, tenantId: string): Promise<RequisitionWithLines> {
    return this.transitionRequisition(id, tenantId, ["draft"], "submitted");
  }

  async approveRequisition(id: string, actor: Actor, tenantId: string): Promise<RequisitionWithLines> {
    return this.transitionRequisition(id, tenantId, ["submitted"], "approved", actor);
  }

  async rejectRequisition(id: string, actor: Actor, tenantId: string, note?: string): Promise<RequisitionWithLines> {
    return this.transitionRequisition(id, tenantId, ["submitted"], "rejected", actor, note);
  }

  /** Convert an approved requisition into a PO for the given supplier. The PO
   *  is created through createOrder, so PO approval tiers still apply. */
  async convertRequisition(id: string, supplierId: string, actor: Actor, tenantId: string): Promise<{ requisition: RequisitionWithLines; po: PurchaseOrderWithLines }> {
    const req = await this.getRequisition(id, tenantId);
    if (req.status !== "approved") throw new HttpError(409, "not_approved", "only an approved requisition can be converted");
    const po = await this.createOrder(
      supplierId,
      req.lines.map((l) => ({
        productId: l.product_id,
        quantity: l.quantity,
        unitCostCents: Number(l.est_cost_cents ?? 0),
        productName: l.product_name ?? null,
      })),
      tenantId,
      actor,
    );
    await this.db.query(
      "UPDATE purchase_requisitions SET status = 'converted', po_id = @po, updated_at = @now WHERE id = @id AND tenant_id = @t",
      { po: po.id, now: Date.now(), id, t: tenantId },
    );
    return { requisition: await this.getRequisition(id, tenantId), po };
  }

  /** Cursor-paginated requisition list, optionally filtered by status. */
  async listRequisitions(
    tenantId: string,
    opts: { status?: RequisitionStatus; cursor?: string; limit?: number } = {},
  ): Promise<CursorPage<Requisition>> {
    const limit = clampLimit(opts.limit, 100, 500);
    const cur = decodeCursor(opts.cursor);
    const where = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId, limit };
    if (opts.status) { where.push("status = @s"); params["s"] = opts.status; }
    if (cur) { where.push("(created_at, id) < (@curAt, @curId)"); params["curAt"] = cur.at; params["curId"] = cur.id; }
    const items = await this.db.query<Requisition>(
      `SELECT * FROM purchase_requisitions WHERE ${where.join(" AND ")} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      params,
    );
    return toPage(items as unknown as Array<Requisition & Record<string, unknown>>, limit, "created_at") as CursorPage<Requisition>;
  }
}

export type RequisitionStatus = "draft" | "submitted" | "approved" | "rejected" | "converted";

export interface Requisition {
  id: string;
  tenant_id: string;
  req_number: string;
  status: RequisitionStatus;
  department: string | null;
  requested_by: string | null;
  required_date: number | null;
  priority: "low" | "normal" | "high";
  notes: string | null;
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  po_id: string | null;
  created_at: number;
  updated_at: number;
}

export interface RequisitionLine {
  id: string;
  tenant_id: string;
  requisition_id: string;
  product_id: string;
  product_name: string | null;
  quantity: number;
  est_cost_cents: number;
}

export interface RequisitionWithLines extends Requisition {
  lines: RequisitionLine[];
}
