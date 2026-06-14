import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
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
}

const DAY = 86_400_000;

export class BillingService {
  constructor(private readonly db: DB) {}

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
    input: { supplierId?: string; poId?: string; totalCents?: number; dueDate?: number },
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
    };
    await this.db.query(
      `INSERT INTO bills (id, tenant_id, supplier_id, po_id, bill_number, status, total_cents, paid_cents, due_date, issued_at)
       VALUES (@id,@tenant_id,@supplier_id,@po_id,@bill_number,@status,@total_cents,@paid_cents,@due_date,@issued_at)`,
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

  async listBills(tenantId: string, status?: string): Promise<Bill[]> {
    if (status) return this.db.query<Bill>("SELECT * FROM bills WHERE tenant_id = @t AND status = @s ORDER BY issued_at DESC LIMIT 500", { t: tenantId, s: status });
    return this.db.query<Bill>("SELECT * FROM bills WHERE tenant_id = @t ORDER BY issued_at DESC LIMIT 500", { t: tenantId });
  }

  async payBill(id: string, amountCents: number, method: string, tenantId: string): Promise<Bill> {
    if (amountCents <= 0) throw new HttpError(400, "bad_request", "amountCents must be positive");
    return this.db.tx(async (tdb) => {
      const bill = await tdb.one<Bill>("SELECT * FROM bills WHERE id = @id AND tenant_id = @t FOR UPDATE", { id, t: tenantId });
      if (!bill) throw new HttpError(404, "not_found", `bill '${id}' not found`);
      if (bill.status === "void") throw new HttpError(409, "void", "bill is void");
      const paid = Number(bill.paid_cents) + amountCents;
      if (paid > Number(bill.total_cents)) throw new HttpError(400, "overpayment", "payment exceeds amount due");
      const status = this.nextStatus(Number(bill.total_cents), paid);
      await tdb.query("UPDATE bills SET paid_cents = @paid, status = @status WHERE id = @id AND tenant_id = @t", { paid, status, id, t: tenantId });
      await tdb.query(
        "INSERT INTO billing_payments (id, tenant_id, doc_type, doc_id, amount_cents, method, created_at) VALUES (@id,@t,'bill',@doc,@amt,@m,@now)",
        { id: `blp_${uuidv7()}`, t: tenantId, doc: id, amt: amountCents, m: method, now: Date.now() },
      );
      return { ...bill, paid_cents: paid, status };
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
    const now = Date.now();
    const inv: Invoice = {
      id: `inv_${uuidv7()}`, tenant_id: tenantId, customer_id: input.customerId, order_id: input.orderId ?? null,
      invoice_number: await this.nextNumber("invoices", "INV", tenantId), status: "open",
      total_cents: total, paid_cents: 0, due_date: input.dueDate ?? now + 30 * DAY, issued_at: now,
    };
    await this.db.query(
      `INSERT INTO invoices (id, tenant_id, customer_id, order_id, invoice_number, status, total_cents, paid_cents, due_date, issued_at)
       VALUES (@id,@tenant_id,@customer_id,@order_id,@invoice_number,@status,@total_cents,@paid_cents,@due_date,@issued_at)`,
      inv as unknown as Record<string, unknown>,
    );
    return inv;
  }

  async listInvoices(tenantId: string, status?: string): Promise<Invoice[]> {
    if (status) return this.db.query<Invoice>("SELECT * FROM invoices WHERE tenant_id = @t AND status = @s ORDER BY issued_at DESC LIMIT 500", { t: tenantId, s: status });
    return this.db.query<Invoice>("SELECT * FROM invoices WHERE tenant_id = @t ORDER BY issued_at DESC LIMIT 500", { t: tenantId });
  }

  async payInvoice(id: string, amountCents: number, method: string, tenantId: string): Promise<Invoice> {
    if (amountCents <= 0) throw new HttpError(400, "bad_request", "amountCents must be positive");
    return this.db.tx(async (tdb) => {
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
}
