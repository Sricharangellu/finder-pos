import { z } from "zod";

export const lineSchema = z.object({
  productId: z.string().min(1),
  sku: z.string().optional(),
  name: z.string().min(1),
  quantity: z.number().int().positive(),
  unitCents: z.number().int().nonnegative(),
  discountCents: z.number().int().nonnegative().optional(),
  taxCents: z.number().int().nonnegative().optional(),
});

export const createQuoteSchema = z.object({
  customerId: z.string().nullable().optional(),
  outletId: z.string().nullable().optional(),
  lines: z.array(lineSchema).min(1),
  validUntil: z.number().int().positive().nullable().optional(),
  notes: z.string().nullable().optional(),
  currency: z.string().length(3).optional(),
});

export const updateStatusSchema = z.object({
  status: z.enum(["draft", "sent", "accepted", "rejected", "expired"]),
});

export type QuoteLine = z.infer<typeof lineSchema>;
export type CreateQuoteDto = z.infer<typeof createQuoteSchema>;
export type UpdateStatusDto = z.infer<typeof updateStatusSchema>;

/** What the service actually needs to create a quote — the DTO plus server-assigned fields. */
export interface CreateQuoteInput extends CreateQuoteDto {
  createdBy?: string;
}

export interface QuoteResponseDto {
  [key: string]: unknown;
  lines: Record<string, unknown>[];
}

export interface QuoteListResponseDto {
  items: Record<string, unknown>[];
  total: number;
}

export interface ConvertQuoteResponseDto {
  quoteId: string;
  message: string;
}
