import { v7 as uuidv7 } from "uuid";
import type { EventBus } from "../../shared/events.js";
import { HttpError } from "../../shared/http.js";
import type { QuotesRepository } from "./quotes.repository.js";
import type {
  CreateQuoteInput,
  ConvertQuoteResponseDto,
  QuoteListResponseDto,
  QuoteResponseDto,
} from "./quotes.dto.js";

export class QuotesService {
  constructor(
    private readonly repo: QuotesRepository,
    private readonly events: EventBus,
  ) {}

  async create(input: CreateQuoteInput, tenantId: string): Promise<QuoteResponseDto> {
    const now = Date.now();
    const id = `qt_${uuidv7()}`;
    const quoteNumber = `QT-${now.toString(36).toUpperCase().slice(-8)}`;

    let subtotalCents = 0, discountCents = 0, taxCents = 0;
    for (const l of input.lines) {
      subtotalCents += l.unitCents * l.quantity;
      discountCents += l.discountCents ?? 0;
      taxCents += l.taxCents ?? 0;
    }
    const totalCents = subtotalCents - discountCents + taxCents;

    await this.repo.insertQuote({
      id,
      tenantId,
      outletId: input.outletId,
      customerId: input.customerId,
      quoteNumber,
      currency: input.currency ?? "USD",
      totals: { subtotalCents, discountCents, taxCents, totalCents },
      validUntil: input.validUntil,
      notes: input.notes,
      createdBy: input.createdBy,
      lines: input.lines,
    });

    return this.get(id, tenantId);
  }

  async get(id: string, tenantId: string): Promise<QuoteResponseDto> {
    const quote = await this.repo.findById(id, tenantId);
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    const lines = await this.repo.findLines(id, tenantId);
    return { ...quote, lines };
  }

  async list(tenantId: string, limit = 50, offset = 0): Promise<QuoteListResponseDto> {
    return this.repo.list(tenantId, limit, offset);
  }

  async updateStatus(id: string, status: string, tenantId: string): Promise<QuoteResponseDto> {
    await this.repo.updateStatus(id, status, tenantId);
    return this.get(id, tenantId);
  }

  /** Converting a quote is the aggregate's one state-transition boundary: this
   *  is the only place `quote.converted` is raised, matching the discipline
   *  sales/service.ts uses for `sales_order.*` events. */
  async convertToOrder(id: string, tenantId: string): Promise<ConvertQuoteResponseDto> {
    const quote = await this.repo.findForConversion(id, tenantId);
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    if (quote.converted_order_id || quote.status === "converted") throw new HttpError(409, "already_converted", "This quote has already been converted to an order");
    if (quote.status === "expired") throw new HttpError(400, "quote_expired", "Cannot convert an expired quote");

    await this.repo.markConverted(id, tenantId);
    await this.events.publish("quote.converted", { quoteId: id, tenantId }, id);

    return { quoteId: id, message: "Quote marked as converted. Create the sales order manually with the quoted lines." };
  }

  async delete(id: string, tenantId: string): Promise<void> {
    const quote = await this.repo.findForDelete(id, tenantId);
    if (!quote) throw new HttpError(404, "not_found", `Quote '${id}' not found`);
    if (quote.status === "converted") throw new HttpError(400, "cannot_delete", "Cannot delete a converted quote");
    await this.repo.deleteQuote(id, tenantId);
  }
}
