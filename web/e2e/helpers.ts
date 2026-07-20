import { expect, type Page } from "@playwright/test";

const E2E_EMAIL = process.env["E2E_EMAIL"] ?? "owner@ascend.dev";
const E2E_PASSWORD = process.env["E2E_PASSWORD"] ?? "AscendDemo!2026";

function isLoginPage(page: Page) {
  return new URL(page.url()).pathname === "/login";
}

export async function gotoAuthenticated(page: Page, url: string) {
  await page.goto(url);
  await expect(page.locator("body")).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});

  if (isLoginPage(page)) {
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByLabel(/email/i).fill(E2E_EMAIL);
    await page.getByRole("textbox", { name: /password/i }).fill(E2E_PASSWORD);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await page.waitForURL((nextUrl) => nextUrl.pathname !== "/login", {
      timeout: 15_000,
    });
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
    await page.goto(url);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
  }

  await expect(page).not.toHaveURL(/\/login/);
}

export async function expectNoAppCrash(page: Page) {
  await expect(page.getByText(/something went wrong|unexpected error|500/i)).not.toBeVisible();
}
