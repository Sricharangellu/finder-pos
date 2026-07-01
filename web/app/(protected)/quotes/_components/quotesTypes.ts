// ── Types ──────────────────────────────────────────────────────────────────────

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

export interface Quote {
  id: string;
  quote_number: string;
  status: QuoteStatus;
  customer_id: string | null;
  customer_name?: string | null;
  sales_rep_id?: string | null;
  sales_rep_name?: string | null;
  note?: string | null;
  total_cents: number;
  currency: string;
  valid_until: number;
  created_at: number;
}

export interface QuoteLine {
  id: string;
  name: string;
  quantity: number;
  unit_cents: number;
  sku?: string;
}

export interface QuoteDetail extends Quote {
  lines: QuoteLine[];
  subtotal_cents?: number;
  discount_cents?: number;
}

// ── Avatar helpers ─────────────────────────────────────────────────────────────

const AVATAR_COLORS = ["#F97316", "#EAB308", "#8B5CF6", "#10B981", "#EC4899", "#3B82F6", "#EF4444", "#14B8A6"];

export function avatarColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length]!;
}

export function initials(name: string): string {
  return name.split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

// ── Status style ───────────────────────────────────────────────────────────────

export const STATUS_STYLE: Record<QuoteStatus, string> = {
  draft:    "bg-gray-100 text-gray-600",
  sent:     "bg-blue-50 text-blue-700",
  accepted: "bg-emerald-50 text-emerald-700",
  rejected: "bg-red-50 text-red-600",
  expired:  "bg-amber-50 text-amber-700",
};

// ── Money helper ───────────────────────────────────────────────────────────────

export function parseCents(v: string): number {
  const n = parseFloat(v.replace(/,/g, ""));
  return isNaN(n) ? 0 : Math.round(n * 100);
}

