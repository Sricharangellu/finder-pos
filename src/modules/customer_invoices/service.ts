import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { EventBus } from "../../shared/events.js";
import { notFound, conflict } from "../../shared/http.js";

export type InvoiceStatus = "draft" | "sent" | "partial" | "paid" | "overdue" | "void";

export interface CustomerInvoiceLine {
  id: string;
  tenant_id: string;
  invoice_id: string;
  product_id: string | null;
  upc: string | null;
  sku: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents: number;
  tax_rate_pct: number;
  line_total_cents: number;
  sort_order: number;
  created_at: number;
  updated_at: number;
}

export interface CustomerInvoice {
  id: string;
  tenant_id: string;
  invoice_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  billing_address: string | null;
  status: InvoiceStatus;
  subtotal_cents: number;
  tax_cents: number;
  discount_cents: number;
  total_cents: number;
  paid_cents: number;
  due_date: number | null;
  paid_at: number | null;
  notes: string | null;
  created_at: number;
  updated_at: number;
  lines?: CustomerInvoiceLine[];
}

export interface InvoiceLineInput {
  product_id?: string | null;
  upc?: string | null;
  sku?: string | null;
  name: string;
  quantity: number;
  unit_price_cents: number;
  discount_cents?: number;
  tax_rate_pct?: number;
}

export interface CreateInvoiceInput {
  customer_id?: string | null;
  customer_name?: string;
  customer_email?: string | null;
  customer_phone?: string | null;
  billing_address?: string | null;
  due_date?: number | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
  tax_rate_pct?: number;
}

function calcLineTotal(line: InvoiceLineInput): number {
  const base = line.quantity * line.unit_price_cents;
  const afterDiscount = base - (line.discount_cents ?? 0);
  const tax = Math.round(afterDiscount * (line.tax_rate_pct ?? 0) / 100);
  return afterDiscount + tax;
}

function calcTotals(lines: InvoiceLineInput[]): {
  subtotal_cents: number; tax_cents: number; discount_cents: number; total_cents: number;
} {
  let subtotal = 0, tax = 0, discount = 0;
  for (const l of lines) {
    subtotal += l.quantity * l.unit_price_cents;
    discount += l.discount_cents ?? 0;
    tax += Math.round((l.quantity * l.unit_price_cents - (l.discount_cents ?? 0)) * (l.tax_rate_pct ?? 0) / 100);
  }
  return { subtotal_cents: subtotal, tax_cents: tax, discount_cents: discount, total_cents: subtotal - discount + tax };
}

export function customerInvoicesService(db: DB, events: EventBus) {
  async function nextInvoiceNumber(tenantId: string): Promise<string> {
    const [row] = await db.query<{ n: number }>(`SELECT nextval('customer_invoice_seq') AS n`);
    return `INV-${String(row.n).padStart(5, "0")}`;
  }

  return {
    async list(tenantId: string, opts: { status?: InvoiceStatus; customer_id?: string; limit?: number; offset?: number }): Promise<{ items: CustomerInvoice[]; total: number }> {
      const limit = Math.min(opts.limit ?? 50, 200);
      const offset = opts.offset ?? 0;
      const rows = await db.query<CustomerInvoice & { total_count: number }>(
        `SELECT *, COUNT(*) OVER() AS total_count FROM customer_invoices
         WHERE tenant_id = @tenantId
         ${opts.status ? "AND status = @status" : ""}
         ${opts.customer_id ? "AND customer_id = @customerId" : ""}
         ORDER BY created_at DESC LIMIT @limit OFFSET @offset`,
        { tenantId, status: opts.status ?? null, customerId: opts.customer_id ?? null, limit, offset }
      );
      const total = rows[0]?.total_count ?? 0;
      return { items: rows.map(({ total_count: _, ...r }) => r), total };
    },

    async get(id: string, tenantId: string): Promise<CustomerInvoice> {
      const inv = await db.one<CustomerInvoice>(
        `SELECT * FROM customer_invoices WHERE id=@id AND tenant_id=@tenantId`, { id, tenantId }
      );
      if (!inv) throw notFound("customer_invoice");
      const lines = await db.query<CustomerInvoiceLine>(
        `SELECT * FROM customer_invoice_lines WHERE invoice_id=@id AND tenant_id=@tenantId ORDER BY sort_order`,
        { id, tenantId }
      );
      return { ...inv, lines };
    },

    async create(input: CreateInvoiceInput, tenantId: string): Promise<CustomerInvoice> {
      const id = uuidv7();
      const now = Date.now();
      const invoiceNumber = await nextInvoiceNumber(tenantId);
      const totals = calcTotals(input.lines);
      const customerName = input.customer_name ?? "Walk-in Customer";

      await db.tx(async (tx) => {
        await tx.query(
          `INSERT INTO customer_invoices
             (id, tenant_id, invoice_number, customer_id, customer_name, customer_email, customer_phone,
              billing_address, status, subtotal_cents, tax_cents, discount_cents, total_cents, paid_cents,
              due_date, notes, created_at, updated_at)
           VALUES (@id, @tenantId, @invNum, @customerId, @customerName, @email, @phone,
                   @address, 'draft', @subtotal_cents, @tax_cents, @discount_cents, @total_cents, 0,
                   @dueDate, @notes, @now, @now)`,
          {
            id, tenantId, invNum: invoiceNumber,
            customerId: input.customer_id ?? null, customerName,
            email: input.customer_email ?? null, phone: input.customer_phone ?? null,
            address: input.billing_address ?? null,
            ...totals, dueDate: input.due_date ?? null,
            notes: input.notes ?? null, now,
          }
        );
        for (let i = 0; i < input.lines.length; i++) {
          const l = input.lines[i];
          await tx.query(
            `INSERT INTO customer_invoice_lines
               (id, tenant_id, invoice_id, product_id, upc, sku, name, quantity, unit_price_cents,
                discount_cents, tax_rate_pct, line_total_cents, sort_order, created_at, updated_at)
             VALUES (@lineId, @tenantId, @invoiceId, @productId, @upc, @sku, @name, @qty, @price,
                     @discount, @taxRate, @lineTotal, @sort, @now, @now)`,
            {
              lineId: uuidv7(), tenantId, invoiceId: id,
              productId: l.product_id ?? null, upc: l.upc ?? null, sku: l.sku ?? null,
              name: l.name, qty: l.quantity, price: l.unit_price_cents,
              discount: l.discount_cents ?? 0, taxRate: l.tax_rate_pct ?? 0,
              lineTotal: calcLineTotal(l), sort: i, now,
            }
          );
        }
      });

      events.publish("customer_invoice.created", { tenantId, invoiceId: id, invoiceNumber, total: totals.total_cents });
      return this.get(id, tenantId);
    },

    async updateStatus(id: string, status: InvoiceStatus, paidCents: number | undefined, tenantId: string): Promise<CustomerInvoice> {
      const inv = await this.get(id, tenantId);
      if (inv.status === "void") throw conflict("Invoice is voided and cannot be updated.");
      const now = Date.now();
      const paidAt = status === "paid" ? now : inv.paid_at;
      await db.query(
        `UPDATE customer_invoices SET status=@status, paid_cents=COALESCE(@paidCents, paid_cents),
         paid_at=@paidAt, updated_at=@now WHERE id=@id AND tenant_id=@tenantId`,
        { id, tenantId, status, paidCents: paidCents ?? null, paidAt, now }
      );
      events.publish("customer_invoice.status_changed", { tenantId, invoiceId: id, status });
      return this.get(id, tenantId);
    },

    async lookupByUpc(upc: string, tenantId: string): Promise<{ product_id: string; name: string; price_cents: number; sku: string } | null> {
      const row = await db.one<{ id: string; name: string; price_cents: number; sku: string }>(
        `SELECT p.id, p.name, p.price_cents, p.sku FROM products p
         LEFT JOIN product_barcodes pb ON pb.product_id = p.id AND pb.tenant_id = p.tenant_id
         WHERE p.tenant_id = @tenantId AND (p.sku = @upc OR pb.barcode = @upc)
         LIMIT 1`,
        { tenantId, upc }
      );
      if (!row) return null;
      return { product_id: row.id, name: row.name, price_cents: row.price_cents, sku: row.sku };
    },
  };
}

export type CustomerInvoicesService = ReturnType<typeof customerInvoicesService>;
