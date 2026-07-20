export interface POLine {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string;
  product_barcode?: string;
  selling_price_cents: number;
  last_cost_cents: number;
  margin_pct: number;
  quantity: number;
  unit_cost_cents: number;
  line_cost_cents: number;
  received_qty: number;
  remaining_qty: number;
  expiry_date: number | null;
  lot_code: string | null;
  cases_ordered?: number;
  units_per_case?: number;
  landed_cost_cents?: number;
}

export interface PurchaseOrderDetail {
  id: string;
  po_number?: number;
  supplier_id: string;
  status: string;
  receive_status: string | null;
  total_cost_cents: number;
  freight_cost_cents: number;
  other_charges_cents: number;
  created_at: number;
  received_at: number | null;
  notes?: string;
  lines: POLine[];
}

export interface PriceHistoryItem {
  product_id: string;
  product_name: string;
  sku: string;
  /** Quantity ordered on the current PO line. */
  ordered_qty: number;
  /** Current cost being paid on this PO line. */
  invoiced_cents: number;
  /** Last cost paid to the PO's own supplier (any date within filters). */
  last_from_supplier: { unit_cost_cents: number; received_at: number } | null;
  /** Lowest cost paid across all suppliers, with who + when. */
  best_across_suppliers: {
    unit_cost_cents: number;
    received_at: number;
    supplier_id: string | null;
    supplier_name: string | null;
  } | null;
  /** Suggested purchase qty from reorder point + recent sales velocity. */
  suggested_qty: number;
  velocity_per_day: number;
  current_stock: number;
  history: Array<{ unit_cost_cents: number; received_at: number; po_id: string }>;
}

export interface PODocument {
  id: string;
  name: string;
  type: string;
  size_bytes: number;
  uploaded_at: number;
}

export interface BillingAdj {
  id: string;
  po_id: string;
  line_id: string | null;
  reason: string;
  amount_cents: number;
  created_at: number;
}

export type BillStatus = "draft" | "approved" | "held" | "posted";

export interface BillSummary {
  id: string;
  po_id: string;
  invoice_number: string;
  invoice_date: number | null;
  total_cents: number;
  status: BillStatus;
  created_at: number;
}

export interface BillMatchLine {
  line_id: string | null;
  product_id: string;
  product_name: string;
  ordered_qty: number;
  received_qty: number;
  invoiced_qty: number;
  po_unit_cost_cents: number;
  invoiced_unit_cost_cents: number;
  expected_cents: number;
  invoiced_cents: number;
  variance_cents: number;
  flags: string[];
  matched: boolean;
}

export interface BillDetail {
  id: string;
  po_id: string;
  invoice_number: string;
  invoice_date: number | null;
  document_id: string | null;
  subtotal_cents: number;
  tax_cents: number;
  total_cents: number;
  status: BillStatus;
  created_at: number;
  updated_at: number;
  match: {
    match_status: "matched" | "variance";
    expected_cents: number;
    invoiced_subtotal_cents: number;
    total_variance_cents: number;
    lines: BillMatchLine[];
  };
}

/** Human labels for per-line 3-way-match variance flags. */
export const BILL_FLAG_LABELS: Record<string, string> = {
  short_received: "Short received",
  qty_variance: "Qty ≠ received",
  price_variance: "Price ≠ PO",
  not_invoiced: "Not invoiced",
  unexpected: "Not on PO",
};

export interface VendorCredit {
  id: string;
  supplier_id: string;
  type: string;
  amount_cents: number;
  reason: string | null;
  po_id: string | null;
  status: string;
  created_at: number;
}

export interface ReceiveEntry {
  lineId: string;
  cases: string;
  unitsPerCase: string;
  totalQty: number;
  expiryDate: string;
  lotCode: string;
}

export type DetailTab = "lines" | "receive" | "billing" | "credits";

export function remaining(line: POLine): number {
  return Math.max(0, line.quantity - (line.received_qty ?? 0));
}

export function computeTotal(cases: string, upc: string): number {
  const c = parseInt(cases, 10), u = parseInt(upc, 10);
  if (isNaN(c) || isNaN(u) || c <= 0 || u <= 0) return 0;
  return c * u;
}

export function marginColor(pct: number): string {
  if (pct < 10) return "text-red-600";
  if (pct < 25) return "text-amber-600";
  return "text-emerald-700";
}

export function docTypeLabel(t: string): string {
  return ({ invoice: "Invoice", delivery_note: "Delivery Note", excel: "Excel/CSV", other: "Other" } as Record<string, string>)[t] ?? t;
}

export function fmtBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}
