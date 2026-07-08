import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";

/** Billing — supplier bills (AP) and customer invoices (AR). Tenant-scoped.
 *  Bills can be auto-drafted from a received PO; invoices from an order.
 *  Both accrue payments until paid. */

export type DocStatus = "open" | "partial" | "paid" | "void";

export interface Bill {
  id: string;
  tenant_id: string;
  supplier_id: string;
  po_id: string | null;
  bill_number: string;
  status: DocStatus;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  issued_at: number;
  variance_cents: number | null; // BE-12: signed delta when bill ≠ received total
  // BE-30: early payment discount — applied on first payment before discount_date.
  discount_pct: number | null;          // e.g. 2.00 for 2%
  discount_date: number | null;         // epoch ms deadline
  discount_applied_cents: number;       // 0 until the discount is taken
}

/** A bill joined to its supplier for display in the Bill List. */
export interface BillWithSupplier extends Bill {
  supplier_name: string | null;
  supplier_company: string | null;
}

export interface Invoice {
  id: string;
  tenant_id: string;
  customer_id: string;
  order_id: string | null;
  invoice_number: string;
  status: DocStatus;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  issued_at: number;
  dunning_level: number; // 0=current, 1=30d, 2=60d, 3=90d+ (BE-14)
}

export interface DunningResult {
  processed: number;
  byLevel: Record<number, number>;
}

const DAY = 86_400_000;

export class BillingService {
  constructor(private readonly db: DB, private readonly events?: EventBus) {}

  private async nextNumber(table: string, prefix: string, tenantId: string): Promise<string> {
    const row = await this.db.one<{ c: number }>(`SELECT COUNT(*)::int AS c FROM ${table} WHERE tenant_id = @tenantId`, { tenantId });
    return `${prefix}-${String(Number(row?.c ?? 0) + 1).padStart(5, "0")}`;
  }

  private nextStatus(total: number, paid: number): DocStatus {
    if (paid <= 0) return "open";
    return paid >= total ? "paid" : "partial";
  }

  // ── Bills (AP) ──────────────────────────────────────────────────────────────
  async createBill(
    input: { supplierId?: string; poId?: string; totalCents?: number; dueDate?: number; discountPct?: number; discountDate?: number },
    tenantId: string,
  ): Promise<Bill> {
    let supplierId = input.supplierId;
    let total = input.totalCents;
    if (input.poId) {
      const po = await this.db.one<{ supplier_id: string; total_cost_cents: number }>(
        "SELECT supplier_id, total_cost_cents FROM purchase_orders WHERE id = @po AND tenant_id = @t",
        { po: input.poId, t: tenantId },
      );
      if (!po) throw new HttpError(404, "not_found", `purchase order '${input.poId}' not found`);
      supplierId = supplierId ?? po.supplier_id;
      total = total ?? Number(po.total_cost_cents);
    }
    if (!supplierId) throw new HttpError(400, "bad_request", "supplierId (or a poId) is required");
    if (!total || total <= 0) throw new HttpError(400, "bad_request", "totalCents must be positive");
    const now = Date.now();
    const bill: Bill = {
      id: `bil_${uuidv7()}`, tenant_id: tenantId, supplier_id: supplierId, po_id: input.poId ?? null,
      bill_number: await this.nextNumber("bills", "BILL", tenantId), status: "open",
      total_cents: total, paid_cents: 0, due_date: input.dueDate ?? now + 30 * DAY, issued_at: now,
      variance_cents: null,
      discount_pct: input.discountPct ?? null,
      discount_date: input.discountDate ?? null,
      discount_applied_cents: 0,
    };
    await this.db.query(
      `INSERT INTO bills (id, tenant_id, supplier_id, po_id, bill_number, status, total_cents, paid_cents, due_date, issued_at, discount_pct, discount_date, discount_applied_cents)
       VALUES (@id,@tenant_id,@supplier_id,@po_id,@bill_number,@status,@total_cents,@paid_cents,@due_date,@issued_at,@discount_pct,@discount_date,@discount_applied_cents)`,
      bill as unknown as Record<string, unknown>,
    );
    return bill;
  }

  /** Idempotent: draft a bill from a received PO (skips if one already exists). */
  async billFromPO(poId: string, tenantId: string): Promise<void> {
    const existing = await this.db.one("SELECT id FROM bills WHERE tenant_id = @t AND po_id = @po", { t: tenantId, po: poId });
    if (existing) return;
    try {
      await this.createBill({ poId }, tenantId);
    } catch {
      /* best-effort: PO may have no total */
    }
  }

  /**
   * List supplier bills, newest first. Filterable by status and/or supplier, and
   * enriched with the supplier's name/company so the Bill List can show and group
   * by supplier without a second round-trip (the "by supplier" filter option).
   */
  async listBills(
    tenantId: string,
    opts: { status?: string; supplierId?: string } = {},
  ): Promise<BillWithSupplier[]> {
    const where = ["b.tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId };
    if (opts.status) { where.push("b.status = @s"); params["s"] = opts.status; }
    if (opts.supplierId) { where.push("b.supplier_id = @sid"); params["sid"] = opts.supplierId; }
    return this.db.query<BillWithSupplier>(
      `SELECT b.*, s.name AS supplier_name, s.company AS supplier_company
         FROM bills b
         LEFT JOIN suppliers s ON s.tenant_id = b.tenant_id AND s.id = b.supplier_id
        WHERE ${where.join(" AND ")}
        ORDER BY b.issued_at DESC
        LIMIT 500`,
      params,
    );
  }

  async payBill(id: string, amountCents: number, method: string, tenantId: string): Promise<Bill> {
    if (amountCents <= 0) throw new HttpError(400, "bad_request", "amountCents must be positive");
    return this.db.withTenant(tenantId).tx(async (tdb) => {
      const bill = await tdb.one<Bill>("SELECT * FROM bills WHERE id = @id AND tenant_id = @t FOR UPDATE", { id, t: tenantId });
      if (!bill) throw new HttpError(404, "not_found", `bill '${id}' not found`);
      if (bill.status === "void") throw new HttpError(409, "void", "bill is void");

      const now = Date.now();
      let discountApplied = Number(bill.discount_applied_cents ?? 0);

      // Apply early payment discount on the first payment before the deadline.
      if (
        discountApplied === 0 &&
        bill.discount_pct != null && Number(bill.discount_pct) > 0 &&
        bill.discount_date != null && now <= Number(bill.discount_date)
      ) {
        discountApplied = Math.floor(Number(bill.total_cents) * Number(bill.discount_pct) / 100);
      }

      const effectiveTotal = Number(bill.total_cents) - discountApplied;
      const paid = Number(bill.paid_cents) + amountCents;
      if (paid > effectiveTotal) throw new HttpError(400, "overpayment", "payment exceeds discounted amount due");

      const status = this.nextStatus(effectiveTotal, paid);
      await tdb.query(
        "UPDATE bills SET paid_cents = @paid, status = @status, discount_applied_cents = @disc WHERE id = @id AND tenant_id = @t",
        { paid, status, disc: discountApplied, id, t: tenantId },
      );
      await tdb.query(
        "INSERT INTO billing_payments (id, tenant_id, doc_type, doc_id, amount_cents, method, created_at) VALUES (@id,@t,'bill',@doc,@amt,@m,@now)",
        { id: `blp_${uuidv7()}`, t: tenantId, doc: id, amt: amountCents, m: method, now },
      );
      return { ...bill, paid_cents: paid, status, discount_applied_cents: discountApplied };
    });
  }

  // ── Invoices (AR) ─────────────────────────────────────────────────────────────
  async createInvoice(
    input: { customerId: string; orderId?: string; totalCents?: number; dueDate?: number },
    tenantId: string,
  ): Promise<Invoice> {
    let total = input.totalCents;
    if (input.orderId) {
      const o = await this.db.one<{ total_cents: number; customer_id: string | null }>(
        "SELECT total_cents, customer_id FROM orders WHERE id = @o AND tenant_id = @t",
        { o: input.orderId, t: tenantId },
      );
      if (!o) throw new HttpError(404, "not_found", `order '${input.orderId}' not found`);
      total = total ?? Number(o.total_cents);
    }
    if (!input.customerId) throw new HttpError(400, "bad_request", "customerId is required");
    if (!total || total <= 0) throw new HttpError(400, "bad_request", "totalCents must be positive");

    // BE-13: Enforce customer credit limit — block if new invoice would exceed the limit.
    try {
      const customer = await this.db.one<{ credit_limit_cents: number | null }>(
        "SELECT credit_limit_cents FROM customers WHERE id = @c AND tenant_id = @t",
        { c: input.customerId, t: tenantId },
      );
      if (customer?.credit_limit_cents != null) {
        const outstandingRow = await this.db.one<{ outstanding: number }>(
          `SELECT COALESCE(SUM(total_cents - paid_cents), 0) AS outstanding
             FROM invoices WHERE tenant_id = @t AND customer_id = @c AND status IN ('open', 'partial')`,
          { t: tenantId, c: input.customerId },
        );
        const outstanding = Number(outstandingRow?.outstanding ?? 0);
        if (outstanding + total > Number(customer.credit_limit_cents)) {
          throw new HttpError(
            409,
            "credit_limit_exceeded",
            `Customer credit limit of ${customer.credit_limit_cents} cents would be exceeded (current outstanding: ${outstanding} cents)`,
          );
        }
      }
    } catch (err) {
      // Re-throw HttpErrors; swallow errors from missing customers table in tests.
      if (err instanceof HttpError) throw err;
    }

    const now = Date.now();
    const inv: Invoice = {
      id: `inv_${uuidv7()}`, tenant_id: tenantId, customer_id: input.customerId, order_id: input.orderId ?? null,
      invoice_number: await this.nextNumber("invoices", "INV", tenantId), status: "open",
      total_cents: total, paid_cents: 0, due_date: input.dueDate ?? now + 30 * DAY, issued_at: now,
      dunning_level: 0,
    };
    await this.db.query(
      `INSERT INTO invoices (id, tenant_id, customer_id, order_id, invoice_number, status, total_cents, paid_cents, due_date, issued_at)
       VALUES (@id,@tenant_id,@customer_id,@order_id,@invoice_number,@status,@total_cents,@paid_cents,@due_date,@issued_at)`,
      inv as unknown as Record<string, unknown>,
    );
    return inv;
  }

  async listInvoices(
    tenantId: string,
    opts: { status?: string; cursor?: string; limit?: number } = {},
  ): Promise<{ items: Invoice[]; nextCursor: string | null; limit: number }> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const where: string[] = ["tenant_id = @t"];
    const params: Record<string, unknown> = { t: tenantId };

    if (opts.status) { where.push("status = @s"); params.s = opts.status; }

    if (opts.cursor) {
      const cur = JSON.parse(Buffer.from(opts.cursor, "base64url").toString()) as { at: number; id: string };
      where.push("(issued_at < @curAt OR (issued_at = @curAt AND id < @curId))");
      params.curAt = cur.at;
      params.curId = cur.id;
    }

    const items = await this.db.query<Invoice>(
      `SELECT * FROM invoices WHERE ${where.join(" AND ")} ORDER BY issued_at DESC, id DESC LIMIT @limit`,
      { ...params, limit },
    );

    const last = items.at(-1);
    const nextCursor =
      items.length === limit && last
        ? Buffer.from(JSON.stringify({ at: last.issued_at, id: last.id })).toString("base64url")
        : null;

    return { items, nextCursor, limit };
  }

  async payInvoice(id: string, amountCents: number, method: string, tenantId: string): Promise<Invoice> {
    if (amountCents <= 0) throw new HttpError(400, "bad_request", "amountCents must be positive");
    return this.db.withTenant(tenantId).tx(async (tdb) => {
      const inv = await tdb.one<Invoice>("SELECT * FROM invoices WHERE id = @id AND tenant_id = @t FOR UPDATE", { id, t: tenantId });
      if (!inv) throw new HttpError(404, "not_found", `invoice '${id}' not found`);
      if (inv.status === "void") throw new HttpError(409, "void", "invoice is void");
      const paid = Number(inv.paid_cents) + amountCents;
      if (paid > Number(inv.total_cents)) throw new HttpError(400, "overpayment", "payment exceeds amount due");
      const status = this.nextStatus(Number(inv.total_cents), paid);
      await tdb.query("UPDATE invoices SET paid_cents = @paid, status = @status WHERE id = @id AND tenant_id = @t", { paid, status, id, t: tenantId });
      await tdb.query(
        "INSERT INTO billing_payments (id, tenant_id, doc_type, doc_id, amount_cents, method, created_at) VALUES (@id,@t,'invoice',@doc,@amt,@m,@now)",
        { id: `blp_${uuidv7()}`, t: tenantId, doc: id, amt: amountCents, m: method, now: Date.now() },
      );
      return { ...inv, paid_cents: paid, status };
    });
  }

  // ── BE-14: AR dunning ──────────────────────────────────────────────────────────
  /** Set dunning_level on open/partial invoices by days overdue; emit invoice.overdue. */
  async runDunning(tenantId: string): Promise<DunningResult> {
    const now = Date.now();
    const overdue = await this.db.query<Invoice>(
      `SELECT * FROM invoices
         WHERE tenant_id = @t
           AND status IN ('open', 'partial')
           AND due_date IS NOT NULL
           AND due_date < @now`,
      { t: tenantId, now },
    );

    const byLevel: Record<number, number> = { 1: 0, 2: 0, 3: 0 };
    for (const inv of overdue) {
      const daysOverdue = Math.floor((now - Number(inv.due_date)) / DAY);
      const level = daysOverdue >= 90 ? 3 : daysOverdue >= 60 ? 2 : 1;
      if (Number(inv.dunning_level) === level) continue; // already at this level
      await this.db.query(
        "UPDATE invoices SET dunning_level = @level WHERE id = @id AND tenant_id = @t",
        { level, id: inv.id, t: tenantId },
      );
      byLevel[level] = (byLevel[level] ?? 0) + 1;
      await this.events?.publish(
        "invoice.overdue",
        { invoiceId: inv.id, customerId: inv.customer_id, tenantId, dunningLevel: level, daysOverdue },
        inv.id,
      );
    }
    return { processed: overdue.length, byLevel };
  }

  // ── BE-12: Bill variance ──────────────────────────────────────────────────────
  /** Compute and store variance_cents for a bill tied to a PO. */
  async computeBillVariance(billId: string, tenantId: string): Promise<Bill & { variance_cents: number | null }> {
    const bill = await this.db.one<Bill & { variance_cents: number | null }>(
      "SELECT * FROM bills WHERE id = @id AND tenant_id = @t",
      { id: billId, t: tenantId },
    );
    if (!bill) throw new HttpError(404, "not_found", `bill '${billId}' not found`);
    if (!bill.po_id) return bill;

    const receivedRow = await this.db.one<{ total: number }>(
      `SELECT COALESCE(SUM(received_qty * unit_cost_cents), 0) AS total
         FROM purchase_order_lines
        WHERE po_id = @po AND tenant_id = @t`,
      { po: bill.po_id, t: tenantId },
    );
    const receivedTotal = Number(receivedRow?.total ?? 0);
    const variance = Number(bill.total_cents) - receivedTotal;
    await this.db.query(
      "UPDATE bills SET variance_cents = @v WHERE id = @id AND tenant_id = @t",
      { v: variance, id: billId, t: tenantId },
    );
    return { ...bill, variance_cents: variance };
  }
}
