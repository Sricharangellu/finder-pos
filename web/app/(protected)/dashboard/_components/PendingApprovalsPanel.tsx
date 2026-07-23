"use client";

import { useCallback, useEffect, useState } from "react";
import { apiGet, apiPost, ApiResponseError } from "@/api-client/client";
import type { PurchaseOrder, PurchaseOrdersResponse } from "@/api-client/types";
import { Button } from "@/components/Button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { formatMoney } from "@/lib/money";

// The PO approval gate is real on the backend (tiered auto/manager/owner
// limits, enforced again at receive time) but had zero surface anywhere in
// the app before this panel — a PO could get stuck pending forever with no
// way to act on it short of calling the API directly.
export function PendingApprovalsPanel() {
  const [orders, setOrders] = useState<PurchaseOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null);

  const load = useCallback(() => {
    apiGet<PurchaseOrdersResponse>("/api/v1/purchasing/orders?approvalStatus=pending&limit=5")
      .then((r) => setOrders(r.items))
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load pending approvals"));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const approve = useCallback(
    async (po: PurchaseOrder) => {
      setBusyId(po.id);
      setRowError((prev) => ({ ...prev, [po.id]: "" }));
      try {
        await apiPost(`/api/v1/purchasing/orders/${po.id}/approve`, {});
        setOrders((prev) => (prev ?? []).filter((o) => o.id !== po.id));
      } catch (err) {
        const message = err instanceof ApiResponseError ? err.message : "Failed to approve";
        setRowError((prev) => ({ ...prev, [po.id]: message }));
      } finally {
        setBusyId(null);
      }
    },
    [],
  );

  const reject = useCallback(async (po: PurchaseOrder) => {
    setBusyId(po.id);
    setRowError((prev) => ({ ...prev, [po.id]: "" }));
    try {
      await apiPost(`/api/v1/purchasing/orders/${po.id}/reject`, {});
      setOrders((prev) => (prev ?? []).filter((o) => o.id !== po.id));
    } catch (err) {
      const message = err instanceof ApiResponseError ? err.message : "Failed to reject";
      setRowError((prev) => ({ ...prev, [po.id]: message }));
    } finally {
      setBusyId(null);
      setRejectTarget(null);
    }
  }, []);

  if (error) {
    return (
      <section aria-label="Pending approvals">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
          Pending Approvals
        </h2>
        <div className="rounded-md border border-danger-100 bg-danger-50 px-4 py-3 text-sm text-danger-700">
          {error}
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Pending approvals">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">
          Pending Approvals
        </h2>
        {orders && orders.length > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-500 px-1.5 text-xs font-semibold text-white">
            {orders.length}
          </span>
        )}
      </div>

      {orders === null && (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          Loading…
        </div>
      )}

      {orders !== null && orders.length === 0 && (
        <div className="rounded-md border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">
          No purchase orders awaiting approval.
        </div>
      )}

      {orders !== null && orders.length > 0 && (
        <ul className="flex flex-col gap-2">
          {orders.map((po) => (
            <li
              key={po.id}
              className="flex flex-col gap-2 rounded-md border border-slate-200 bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-800">
                  PO {po.po_number ?? po.id} — {po.supplier_name ?? "Unknown supplier"}
                </p>
                <p className="text-xs text-slate-500">
                  {formatMoney(po.total_cost_cents)} · placed {new Date(po.created_at).toLocaleDateString()}
                </p>
                {rowError[po.id] && (
                  <p className="mt-1 text-xs text-danger-600">{rowError[po.id]}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busyId === po.id}
                  onClick={() => setRejectTarget(po)}
                >
                  Reject
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  loading={busyId === po.id}
                  disabled={busyId === po.id}
                  onClick={() => void approve(po)}
                >
                  Approve
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={rejectTarget !== null}
        title="Reject purchase order"
        message={
          rejectTarget
            ? `Reject PO ${rejectTarget.po_number ?? rejectTarget.id} from ${rejectTarget.supplier_name ?? "this supplier"}? A rejected PO cannot be received or re-approved — a new PO must be created instead.`
            : ""
        }
        confirmLabel="Reject"
        destructive
        onConfirm={() => rejectTarget && void reject(rejectTarget)}
        onCancel={() => setRejectTarget(null)}
      />
    </section>
  );
}
