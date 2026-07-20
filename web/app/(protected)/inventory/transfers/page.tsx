import { redirect } from "next/navigation";

// This used to re-export /operations, which has no transfers tab at all (its
// tabs are Locations/Pick Lists/Outlets/Stock-Locations) — a dead end for
// anyone reaching this URL. Real transfer data lives on /inventory's own
// Transfers tab.
export default function LegacyTransfersRedirect() {
  redirect("/inventory?tab=transfers");
}
