"use client";

/**
 * BillsView — the enterprise Bill List (accounts payable). Presentational: bills +
 * suppliers + current filters come in as props, filter changes go out as
 * callbacks, so it renders identically under test and in the container.
 *
 * Bills are auto-drafted when a purchase order is received (billing listens to
 * the `purchase_order.received` event), so this list is the payables view of the
 * procurement pipeline — filterable by supplier and status.
 */

import { Card } from "@/components/Card";
import { Badge, type BadgeVariant } from "@/components/Badge";
import { formatMoney } from "@/lib/money";
import { fmtDate } from "@/lib/date";
import type { Bill, BillingStatus } from "@/api-client/types";

const STATUS_BADGE: Record<BillingStatus, BadgeVariant> = {
  open: "blue",
  partial: "yellow",
  paid: "green",
  void: "gray",
};

const STATUS_LABEL: Record<BillingStatus, string> = {
  open: "Open",
  partial: "Partial",
  paid: "Paid",
  void: "Void",
};

export interface BillsViewProps {
  bills: Bill[];
  suppliers: Array<{ id: string; name: string }>;
  supplierFilter: string;
  statusFilter: string;
  loading: boolean;
  error: string | null;
  onSupplierChange: (supplierId: string) => void;
  onStatusChange: (status: string) => void;
}

function balanceOf(b: Bill): number {
  return Math.max(b.total_cents - b.paid_cents, 0);
}

function SummaryTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-slate-950">{value}</p>
    </div>
  );
}

export function BillsView({
  bills,
  suppliers,
  supplierFilter,
  statusFilter,
  loading,
  error,
  onSupplierChange,
  onStatusChange,
}: BillsViewProps) {
  const outstanding = bills
    .filter((b) => b.status === "open" || b.status === "partial")
    .reduce((sum, b) => sum + balanceOf(b), 0);

  return (
    <div className="space-y-5">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <SummaryTile label="Bills" value={String(bills.length)} />
        <SummaryTile label="Outstanding" value={formatMoney(outstanding)} />
        <SummaryTile label="Suppliers" value={String(new Set(bills.map((b) => b.supplier_id)).size)} />
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="bill-supplier" className="mb-1 block text-xs font-medium text-slate-600">Supplier</label>
            <select
              id="bill-supplier"
              value={supplierFilter}
              onChange={(e) => onSupplierChange(e.target.value)}
              className="h-9 min-w-[200px] rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-600"
            >
              <option value="">All suppliers</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="bill-status" className="mb-1 block text-xs font-medium text-slate-600">Status</label>
            <select
              id="bill-status"
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value)}
              className="h-9 rounded-md border border-slate-300 bg-white px-2 text-sm outline-none focus:border-brand-600"
            >
              <option value="">All statuses</option>
              <option value="open">Open</option>
              <option value="partial">Partial</option>
              <option value="paid">Paid</option>
              <option value="void">Void</option>
            </select>
          </div>
        </div>
      </Card>

      {error && (
        <p role="alert" className="rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {loading ? (
          <div role="status" aria-label="Loading bills" className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-10 animate-pulse rounded bg-slate-50" />)}
          </div>
        ) : bills.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-slate-500">
            No bills match these filters. Bills are created automatically when a purchase order is received.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-4 py-3 font-semibold">Bill #</th>
                  <th className="px-4 py-3 font-semibold">Supplier</th>
                  <th className="px-4 py-3 font-semibold">PO</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 text-right font-semibold">Balance</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                </tr>
              </thead>
              <tbody>
                {bills.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{b.bill_number}</td>
                    <td className="px-4 py-3 text-slate-700">{b.supplier_name ?? b.supplier_id}</td>
                    <td className="px-4 py-3 text-slate-500">{b.po_id ? "Linked" : "—"}</td>
                    <td className="px-4 py-3"><Badge variant={STATUS_BADGE[b.status]}>{STATUS_LABEL[b.status]}</Badge></td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatMoney(b.total_cents)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-900">{formatMoney(balanceOf(b))}</td>
                    <td className="px-4 py-3 text-slate-500">{fmtDate(b.due_date)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
