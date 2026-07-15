import { v7 as uuidv7 } from "uuid";
import type { DB } from "../../shared/db.js";
import type { QuoteLine } from "./quotes.dto.js";

export interface QuoteTotals {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
}

export interface InsertQuoteInput {
  id: string;
  tenantId: string;
  outletId?: string | null;
  customerId?: string | null;
  quoteNumber: string;
  currency: string;
  totals: QuoteTotals;
  validUntil?: number | null;
  notes?: string | null;
  createdBy?: string;
  lines: QuoteLine[];
}

/** Wraps every raw SQL call quotes needs — the service holds no `db` reference. */
export class QuotesRepository {
  constructor(private readonly db: DB) {}

  /** Header + line inserts happen inside one transaction: a failure partway
   *  through the line loop must not leave an orphaned quote header behind. */
  async insertQuote(input: InsertQuoteInput): Promise<void> {
    const now = Date.now();
    await this.db.tx(async (tdb) => {
      await tdb.query(
        `INSERT INTO quote_headers (id, tenant_id, outlet_id, customer_id, quote_number, status, currency, subtotal_cents, discount_cents, tax_cents, total_cents, valid_until, notes, created_by, created_at, updated_at)
         VALUES (@id, @t, @outlet, @cust, @num, 'draft', @curr, @sub, @disc, @tax, @total, @valid, @notes, @by, @now, @now)`,
        {
          id: input.id, t: input.tenantId, outlet: input.outletId ?? null, cust: input.customerId ?? null,
          num: input.quoteNumber, curr: input.currency, sub: input.totals.subtotalCents, disc: input.totals.discountCents,
          tax: input.totals.taxCents, total: input.totals.totalCents, valid: input.validUntil ?? null,
          notes: input.notes ?? null, by: input.createdBy ?? null, now,
        },
      );

      for (const l of input.lines) {
        await tdb.query(
          `INSERT INTO quote_lines (id, tenant_id, quote_id, product_id, sku, name, quantity, unit_cents, discount_cents, tax_cents, line_cents, created_at)
           VALUES (@id, @t, @qid, @pid, @sku, @name, @qty, @unit, @disc, @tax, @line, @now)`,
          {
            id: `qtl_${uuidv7()}`, t: input.tenantId, qid: input.id, pid: l.productId, sku: l.sku ?? "",
            name: l.name, qty: l.quantity, unit: l.unitCents, disc: l.discountCents ?? 0, tax: l.taxCents ?? 0,
            line: l.unitCents * l.quantity - (l.discountCents ?? 0) + (l.taxCents ?? 0), now,
          },
        );
      }
    });
  }

  async findById(id: string, tenantId: string): Promise<Record<string, unknown> | undefined> {
    return this.db.one<Record<string, unknown>>(
      "SELECT * FROM quote_headers WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
  }

  async findLines(id: string, tenantId: string): Promise<Record<string, unknown>[]> {
    return this.db.query(
      "SELECT * FROM quote_lines WHERE quote_id = @id AND tenant_id = @t ORDER BY created_at ASC",
      { id, t: tenantId },
    );
  }

  async list(tenantId: string, limit: number, offset: number): Promise<{ items: Record<string, unknown>[]; total: number }> {
    const items = await this.db.query<Record<string, unknown>>(
      "SELECT * FROM quote_headers WHERE tenant_id = @t ORDER BY created_at DESC LIMIT @limit OFFSET @offset",
      { t: tenantId, limit, offset },
    );
    const count = await this.db.one<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM quote_headers WHERE tenant_id = @t",
      { t: tenantId },
    );
    return { items, total: Number(count?.n ?? 0) };
  }

  async updateStatus(id: string, status: string, tenantId: string): Promise<void> {
    await this.db.query(
      "UPDATE quote_headers SET status = @status, updated_at = @now WHERE id = @id AND tenant_id = @t",
      { status, now: Date.now(), id, t: tenantId },
    );
  }

  async findForConversion(id: string, tenantId: string): Promise<{ status: string; converted_order_id: string | null } | undefined> {
    return this.db.one<{ status: string; converted_order_id: string | null }>(
      "SELECT status, converted_order_id FROM quote_headers WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
  }

  async markConverted(id: string, tenantId: string): Promise<void> {
    await this.db.query(
      "UPDATE quote_headers SET status = 'converted', updated_at = @now WHERE id = @id AND tenant_id = @t",
      { now: Date.now(), id, t: tenantId },
    );
  }

  async findForDelete(id: string, tenantId: string): Promise<{ status: string } | undefined> {
    return this.db.one<{ status: string }>(
      "SELECT status FROM quote_headers WHERE id = @id AND tenant_id = @t",
      { id, t: tenantId },
    );
  }

  async deleteQuote(id: string, tenantId: string): Promise<void> {
    await this.db.query("DELETE FROM quote_headers WHERE id = @id AND tenant_id = @t", { id, t: tenantId });
  }
}
