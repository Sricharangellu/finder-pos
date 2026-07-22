import { redirect } from "next/navigation";

// Retired (2026-07-21): this page was backed by the product_batches table,
// which a batch manager form let you fill in with a "qty" that looked like
// real stock but never touched inventory_stock — creating a batch here had
// zero effect on what actually shows as available/sellable anywhere else.
// /inventory/expiry-pool (inventory_lots) is the real system: it's wired to
// FEFO depletion, the receive pipeline, and the write-off/loss accounting
// flow. product_batches' table and any existing rows are left untouched —
// only this disconnected page is retired, not the data.
export default function LegacyExpiryRedirect() {
  redirect("/inventory/expiry-pool");
}
