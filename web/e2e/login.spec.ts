/**
 * E2E — Login golden path.
 *
 * Verifies that the login flow works end-to-end:
 *   - Valid credentials → redirect to app
 *   - Wrong password → error message, stays on /login
 *   - Logout → redirect to /login
 */

import { test, expect } from "@playwright/test";

// Use no stored auth for login tests so we can test the login form itself.
test.use({ storageState: { cookies: [], origins: [] } });

test("valid credentials redirect to the app", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("owner@ascend.dev");
  await page.getByRole("textbox", { name: /password/i }).fill("AscendDemo!2026");
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  await page.waitForURL(/\/(dashboard|terminal|sell)/, { timeout: 15_000 });
  await expect(page).not.toHaveURL("/login");
});

test("wrong password shows error and stays on /login", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("owner@ascend.dev");
  await page.getByRole("textbox", { name: /password/i }).fill("wrongpassword");
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // Should stay on login with an error message.
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByText(/invalid|incorrect|wrong|failed/i),
  ).toBeVisible({ timeout: 8_000 });
});

test("logout returns to /login", async ({ page }) => {
  // Log in first.
  await page.goto("/login");
  await page.getByLabel(/email/i).fill("owner@ascend.dev");
  await page.getByRole("textbox", { name: /password/i }).fill("AscendDemo!2026");
  await page.getByRole("button", { name: /sign in|log in/i }).click();
  await page.waitForURL(/\/(dashboard|terminal|sell)/);

  // Find and click logout (may be in a user menu).
  const logoutBtn = page.getByRole("button", { name: /sign out|log out|logout/i });
  if (await logoutBtn.isVisible()) {
    await logoutBtn.click();
  } else {
    // Try clicking the user avatar/menu to reveal logout.
    await page.getByLabel(/user|account|profile/i).first().click();
    await page.getByRole("button", { name: /sign out|log out|logout/i }).click();
  }

  await page.waitForURL(/\/login/, { timeout: 10_000 });
  await expect(page).toHaveURL(/\/login/);
});
