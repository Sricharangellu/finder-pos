// Shared types, constants, and helpers for the customer detail page.

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  points: number;
  tier?: number;
  company?: string;
  dba?: string;
  taxId?: string;
  licenseNo?: string;
  state?: string;
  billingAddress?: string;
  shippingAddress?: string;
  salesRepId?: string;
  status: string;
  verified?: boolean;
  credit_limit_cents?: number;
}

export interface CustomerSummary {
  customer: Customer;
  visits: number;
  totalSpentCents: number;
  avgOrderCents: number;
  lastVisitAt: number | null;
  recentOrders: Array<{
    id: string;
    orderNumber: string;
    status: string;
    totalCents: number;
    createdAt: number;
  }>;
}

export interface CustomerFinancials {
  openInvoicesCents: number;
  paidInvoicesCents: number;
  storeCredit?: number;
}

export type DetailTab = "general" | "transactions" | "orders" | "financials" | "store-credit" | "contacts" | "addresses";

export interface CustomerLoyalty {
  customerId: string;
  currentPoints: number;
  currentTierLevel: number;
  currentTierName: string | null;
  pointMultiplier: number;
  discountPct: number;
  nextTierName: string | null;
  pointsToNextTier: number | null;
}

export interface CustomerSearchResult { id: string; name: string; email: string; phone: string; }
export type MergeStep = "search" | "confirm";

export const INPUT_CLASS =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-950 focus:ring-2 focus:ring-slate-950 outline-none min-h-[44px]";
export const LABEL_CLASS = "block text-xs font-semibold uppercase text-slate-500 mb-1";

export function tierLabel(tier?: number): string {
  if (!tier) return "Standard";
  return `Tier ${tier}`;
}

export function statusColor(status: string) {
  if (status === "active") return "bg-success-100 text-success-700";
  return "bg-slate-100 text-slate-600";
}

export function orderStatusColor(status: string) {
  if (status === "completed") return "bg-success-100 text-success-700";
  if (status === "refunded") return "bg-warning-100 text-warning-700";
  if (status === "voided") return "bg-danger-100 text-danger-700";
  return "bg-slate-100 text-slate-600";
}

export function ReadField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <p className={LABEL_CLASS}>{label}</p>
      <div className="min-h-[40px] rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-950">
        {value || <span className="text-slate-400">—</span>}
      </div>
    </div>
  );
}
