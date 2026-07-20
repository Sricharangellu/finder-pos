/**
 * E2E global setup — logs in as the demo owner and saves auth state.
 * Runs once before all spec files. All specs share this auth state to
 * avoid re-logging in for every test, which is slow.
 */

import { test as setup, expect } from "@playwright/test";
import path from "path";

const AUTH_FILE = path.join(__dirname, ".auth/owner.json");

const E2E_EMAIL = process.env["E2E_EMAIL"] ?? "owner@ascend.dev";
const E2E_PASSWORD = process.env["E2E_PASSWORD"] ?? "AscendDemo!2026";

setup("authenticate as owner", async ({ page }) => {
  await page.goto("/login");

  // Wait for the login form to be visible.
  await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({ timeout: 15_000 });

  await page.getByLabel(/email/i).fill(E2E_EMAIL);
  await page.getByRole("textbox", { name: /password/i }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // After login, we should land on /dashboard or /terminal.
  await page.waitForURL(/\/(dashboard|terminal|sell)/, { timeout: 15_000 });
  await expect(page).not.toHaveURL("/login");

  // Let the landing page's boot-time token rotation settle BEFORE saving —
  // refresh tokens are single-use, so snapshotting mid-rotation saves a
  // cookie the server has already revoked and every consumer starts dead.
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

  // Save the authenticated state (cookies + localStorage).
  await page.context().storageState({ path: AUTH_FILE });
});
