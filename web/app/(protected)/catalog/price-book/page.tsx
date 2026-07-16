import { redirect } from "next/navigation";

// Customer price overrides live in the Pricing Engine now (one pricing surface).
export default function LegacyPriceBookRedirect() {
  redirect("/pricing?tab=customer-overrides");
}
