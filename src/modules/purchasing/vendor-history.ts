import type { DB } from "../../shared/db.js";

/**
 * Vendor purchase-order history for the Purchasing > Reorder tab
 * (web/app/(protected)/purchasing/_components/ReorderTab.tsx), grouped by
 * supplier id. Real join over purchase_orders — purchasing already has real
 * PO data, so unlike EDI-imports there is no content-never-arrives blocker
 * here. Built 2026-07-18, Phase 0 FE↔BE gap-closure pass; see
 * WORK/audits/AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md.
 *
 * Bounded to the most recent 20 POs per supplier (a window-function rank,
 * same "don't return an unbounded list" discipline as the rest of this
 * effort's fixes) rather than the whole PO history for large tenants.
 *
 * po_number is nullable on very old rows created before the po_number
 * column existed; COALESCE to 0 rather than omitting the field, since the
 * frontend's VendorPOSummary contract requires a number.
 */
export interface VendorPOSummary {
  po_id: string;
  po_number: number;
  created_at: number;
  total_cost_cents: number;
  item_count: number;
  status: string;
}

interface VendorHistoryRow {
  supplier_id: string;
  po_id: string;
  po_number: number | null;
  created_at: number;
  total_cost_cents: number;
  item_count: number;
  status: string;
}

export async function getVendorHistory(db: DB, tenantId: string): Promise<Record<string, VendorPOSummary[]>> {
  const rows = await db.query<VendorHistoryRow>(
    `SELECT supplier_id, po_id, po_number, created_at, total_cost_cents, item_count, status
       FROM (
         SELECT po.supplier_id,
                po.id AS po_id,
                po.po_number,
                po.created_at,
                po.total_cost_cents,
                po.status,
                (SELECT COUNT(*)::int FROM purchase_order_lines l
                  WHERE l.po_id = po.id AND l.tenant_id = po.tenant_id) AS item_count,
                ROW_NUMBER() OVER (PARTITION BY po.supplier_id ORDER BY po.created_at DESC) AS rn
           FROM purchase_orders po
          WHERE po.tenant_id = @t
       ) ranked
      WHERE rn <= 20
      ORDER BY supplier_id, created_at DESC`,
    { t: tenantId },
  );

  const history: Record<string, VendorPOSummary[]> = {};
  for (const r of rows) {
    const list = history[r.supplier_id] ?? (history[r.supplier_id] = []);
    list.push({
      po_id: r.po_id,
      po_number: Number(r.po_number ?? 0),
      created_at: Number(r.created_at),
      total_cost_cents: Number(r.total_cost_cents),
      item_count: Number(r.item_count),
      status: r.status,
    });
  }
  return history;
}
