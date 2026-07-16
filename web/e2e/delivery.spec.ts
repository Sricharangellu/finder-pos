/**
 * E2E — Delivery pipeline page.
 *
 * Verifies the /delivery page renders against the real backend and its
 * fulfillment-status UI is wired:
 *   1. The authenticated page loads with the Sales orders panel (orders or empty state).
 *   2. Selecting an order (when the demo tenant has any) shows its delivery stage.
 *
 * Kept tolerant of seed contents, like the other golden-path specs: the demo
 * seed is minimal, so the drive step skips when no sales orders exist rather
 * than failing. Full pick → pack → ship → deliver driving needs seeded pipeline
 * data and is covered by the backend suite (delivery-pipeline.test.ts).
 */

import { test, expect } from "./fixtures";
import { gotoAuthenticated, expectNoAppCrash } from "./helpers";

test.describe("Delivery pipeline", () => {
  test("delivery page loads and renders the pipeline UI", async ({ page }) => {
    await gotoAuthenticated(page, "/delivery");

    // Page shell + the Sales orders panel render.
    await expect(
      page
        .getByRole("heading", { name: /delivery/i })
        .or(page.getByText(/sales orders/i))
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // The right panel shows either the "select an order" prompt or the empty state.
    await expect(
      page.getByText(/select a sales order|no sales orders yet/i).first(),
    ).toBeVisible({ timeout: 15_000 });

    await expectNoAppCrash(page);
  });

  test("selecting a sales order reveals its delivery stage", async ({ page }) => {
    await gotoAuthenticated(page, "/delivery");

    const firstOrder = page.locator("ul li button").first();
    const count = await firstOrder.count();
    test.skip(count === 0, "no sales orders seeded in the demo tenant");

    await firstOrder.click();

    // The detail panel renders the stage stepper labels for the selected order.
    await expect(
      page.getByText(/unfulfilled|picking|packed|shipped|delivered/i).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expectNoAppCrash(page);
  });
});
