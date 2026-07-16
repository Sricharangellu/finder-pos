/**
 * Shared e2e fixtures — worker-scoped authenticated browser context.
 *
 * The backend rotates refresh tokens (strict single-use). The default
 * Playwright model — a fresh context per test restored from a storageState
 * snapshot — replays the SAME refresh cookie in every test; the first
 * silent refresh revokes it and every later test 401s back to /login.
 *
 * A worker-scoped context behaves like a real browser session instead: the
 * cookie jar carries each rotation forward across tests, exactly like a
 * user keeping one window open. Tests still get a fresh page each.
 *
 * Use for authenticated specs:  import { test, expect } from "./fixtures";
 * (login.spec.ts keeps the vanilla test — it exercises the login form with
 * fresh unauthenticated contexts.)
 */

import { test as base, expect, type BrowserContext } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/owner.json");

const E2E_EMAIL = process.env["E2E_EMAIL"] ?? "owner@ascend.dev";
const E2E_PASSWORD = process.env["E2E_PASSWORD"] ?? "AscendDemo!2026";

export const test = base.extend<object, { workerContext: BrowserContext }>({
  workerContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({ storageState: AUTH_FILE });

      // Self-heal: Playwright starts a NEW worker after any test failure, and
      // the snapshot's single-use refresh cookie may already have been rotated
      // by the previous worker. Probe the session and log in fresh if dead —
      // otherwise one failure cascades into auth failures for every later test.
      // The dead-session redirect to /login is client-side and races
      // networkidle, so wait explicitly for either outcome to render.
      const probe = await context.newPage();
      await probe.goto("/dashboard");
      const loginHeading = probe.getByRole("heading", { name: /sign in/i });
      const shellMarker = probe.getByRole("button", { name: /user menu/i });
      await expect(loginHeading.or(shellMarker).first()).toBeVisible({ timeout: 20_000 });
      if (await loginHeading.isVisible()) {
        await probe.getByLabel(/email/i).fill(E2E_EMAIL);
        await probe.getByRole("textbox", { name: /password/i }).fill(E2E_PASSWORD);
        await probe.getByRole("button", { name: /sign in|log in/i }).click();
        await probe.waitForURL(/\/(dashboard|terminal|sell)/, { timeout: 15_000 });
      }
      // Drain before closing: the landing page's boot-time token rotation may
      // still be in flight, and killing it strands the jar on a revoked token
      // (same reason the page fixture drains below).
      await probe.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
      await probe.close();

      await use(context);
      await context.close();
    },
    { scope: "worker" },
  ],
  context: async ({ workerContext }, use) => {
    await use(workerContext);
  },
  page: async ({ context }, use) => {
    const page = await context.newPage();
    await use(page);
    // Let any in-flight token rotation settle before closing — killing the
    // page mid-refresh strands the shared cookie jar on a revoked token and
    // logs out every later test in this worker.
    await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => {});
    await page.close();
  },
});

export { expect };
