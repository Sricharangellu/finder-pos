import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import { HttpError } from "../../shared/http.js";

export interface QuoteLine {
  productId: string;
  sku?: string;
  name: string;
  quantity: number;
  unitCents: number;
  discountCents?: number;
  taxCents?: number;
}

export interface CreateQuoteInput {
  customerId?: string | null;
  outletId?: string | null;
  lines: QuoteLine[];
  validUntil?: number | null;
  notes?: string | null;
  currency?: string;
  createdBy?: string;
}

export class QuotesService {
  constructor(private readonly db: DB) {}

  async create(input: CreateQuoteInput, tenantId: string) {
    const now = Date.now();
    const id = `qt_${uuidv7()}`;
    const quoteNumber = `QT-${now.toString(36).toUpperCase().slice(-8)}`;

    let subtotal = 0, discount = 0, tax = 0;
    for (const l of input.lines) {
      subtotal += l.unitCents * l.quantity;
      discount += (l.discountCents ?? 0);
      tax += (l.taxCents ?? 0);
    }
    const total = subtotal - discount + tax;

    await this.db.query(
      `INSERT INTO quotations (id, tenant_id, outlet_id, customer_id, quote_number, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, valid_until, notes, created_by, created_at, updated_at)
       VALUES (@id, @t, @outlet, @cust, @num, 'draft', @curr, @sub, @disc, @tax, @total, @valid, @notes, @by, @now, @now)`,
      { id, t: tenantId, outlet: input.outletId ?? null, cust: input.customerId ?? null, num: quoteNumber, curr: input.currency ?? 'USD', sub: subtotal, disc: discount, tax, total, valid: input.validUntil ?? null, notes: input.notes ?? null, by: input.createdBy ?? null, now }
    );

    for (const l of input.lines) {
      await this.db.query(
        `INSERT INTO quotation_lines (id, tenant_id, quote_id, product_id, sku, name, quantity, unit_cents, discount_cents, tax_cents, line_cents, created_at)
         VALUES (@id, @t, @qid, @pid, @sku, @name, @qty, @unit, @disc, @tax, @line, @now)`,
        { id: `qtl_${uuidv7()}`, t: tenantId, qid: id, pid: l.productId, sku: l.sku ?? '', name: l.name, qty: l.quantity, unit: l.unitCents, disc: l.discountCents ?? 0, tax: l.taxCents ?? 0, line: l.unitCents * l.quantity - (l.discountCents ?? 0) + (l.taxCents ?? 0), now }
      );
    }

    return this.get(id, tenantId);
  }

  async get(id: string, tenantId: string) {
    const quote = await this.db.one<Record<string, unknown>>("SELECT * FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    const lines = await this.db.query("SELECT * FROM quotation_lines WHERE quote_id = @id AND tenant_id = @t ORDER BY created_at ASC", { id, t: tenantId });
    return { ...quote, lines };
  }

  async list(tenantId: string, limit = 50, offset = 0) {
    const items = await this.db.query("SELECT * FROM quotations WHERE tenant_id = @t ORDER BY created_at DESC LIMIT @limit OFFSET @offset", { t: tenantId, limit, offset });
    const count = await this.db.one<{ n: number }>("SELECT COUNT(*)::int AS n FROM quotations WHERE tenant_id = @t", { t: tenantId });
    return { items, total: Number(count?.n ?? 0) };
  }

  async updateStatus(id: string, status: string, tenantId: string) {
    const now = Date.now();
    await this.db.query("UPDATE quotations SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t", { status, now, id, t: tenantId });
    return this.get(id, tenantId);
  }

  async convertToOrder(id: string, tenantId: string): Promise<{ quoteId: string; message: string }> {
    const quote = await this.db.one<{ status: string; converted_order_id: string | null }>( "SELECT status, converted_order_id FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    if (quote.converted_order_id) throw new HttpError(409, "already_converted", "This quote has already been converted to an order");
    if (quote.status === "expired") throw new HttpError(400, "quote_expired", "Cannot convert an expired quote");
    const now = Date.now();
    await this.db.query("UPDATE quotations SET status = 'converted', updated_at = @now WHERE id = @id AND tenant_id = @t", { now, id, t: tenantId });
    return { quoteId: id, message: "Quote marked as converted. Create the sales order manually with the quoted lines." };
  }

  async delete(id: string, tenantId: string) {
    const quote = await this.db.one<{ status: string }>("SELECT status FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    if (quote.status === "converted") throw new HttpError(400, "cannot_delete", "Cannot delete a converted quote");
    await this.db.query("DELETE FROM quotations WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
  }
}
