export type PurchasingTab = "orders" | "suppliers" | "vendor-quotes" | "reorder";

export interface ReorderSuggestion {
  product_id: string;
  product_name: string;
  sku: string;
  stock_qty: number;
  reorder_pt: number;
  suggested_qty: number;
  preferred_vendor_id: string | null;
  preferred_vendor_name: string | null;
  last_unit_cost_cents: number | null;
  last_ordered_at: number | null;
  last_ordered_qty: number | null;
}

export interface VendorPOSummary {
  po_id: string;
  po_number: number;
  created_at: number;
  total_cost_cents: number;
  item_count: number;
  status: string;
}

export interface DraftLine {
  productId: string;
  quantity: string;
  unitCost: string;
  expiryDate: string;
  lotCode: string;
}

export interface QuoteLine {
  product: string;
  qty: number;
  unit_price_cents: number;
}

export interface VendorQuote {
  id: string;
  vendor: string;
  status: "pending" | "accepted" | "rejected";
  expires_at: number;
  line_items: QuoteLine[];
  total_cents: number;
  created_at: number;
}

export const STATUS_STYLE: Record<string, string> = {
  ordered:  "bg-amber-50 text-amber-700 ring-amber-200",
  received: "bg-emerald-50 text-emerald-700 ring-emerald-200",
};

export const VQ_STATUS_BADGE: Record<VendorQuote["status"], "yellow" | "green" | "gray"> = {
  pending:  "yellow",
  accepted: "green",
  rejected: "gray",
};

export function emptyLine(): DraftLine {
  return { productId: "", quantity: "1", unitCost: "", expiryDate: "", lotCode: "" };
}
