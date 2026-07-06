/**
 * @vitest-environment jsdom
 *
 * Partial/preview nav gating (AGENTS.md "Mock And Partial Rules"): mock-backed
 * pages (Pricing, Promotions, Warehouse, Document Center) must stay hidden from
 * navigation unless NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true, without affecting real
 * pages or the tenant/feature gates.
 */

import { describe, it, expect } from "vitest";
import { isNavChildVisible } from "@/components/EnterpriseShell";

const allow = { routeEnabled: () => true, hasFeature: () => true };

describe("isNavChildVisible — partial gate", () => {
  it("hides a partial page when the opt-in flag is off", () => {
    const pricing = { label: "Pricing", href: "/pricing", featureGate: "catalog", partial: true };
    expect(isNavChildVisible(pricing, { showPartial: false, ...allow })).toBe(false);
  });

  it("shows a partial page when the opt-in flag is on", () => {
    const pricing = { label: "Pricing", href: "/pricing", featureGate: "catalog", partial: true };
    expect(isNavChildVisible(pricing, { showPartial: true, ...allow })).toBe(true);
  });

  it("never hides a real (non-partial) page regardless of the flag", () => {
    const products = { label: "Products", href: "/catalog", featureGate: "catalog" };
    expect(isNavChildVisible(products, { showPartial: false, ...allow })).toBe(true);
    expect(isNavChildVisible(products, { showPartial: true, ...allow })).toBe(true);
  });

  it("still applies the tenant route gate and user feature gate", () => {
    const child = { label: "X", href: "/x", featureGate: "catalog", partial: true };
    // partial + flag on, but route disabled by capabilities → hidden
    expect(
      isNavChildVisible(child, { showPartial: true, routeEnabled: () => false, hasFeature: () => true }),
    ).toBe(false);
    // partial + flag on, route ok, but user lacks the feature → hidden
    expect(
      isNavChildVisible(child, { showPartial: true, routeEnabled: () => true, hasFeature: () => false }),
    ).toBe(false);
  });
});
