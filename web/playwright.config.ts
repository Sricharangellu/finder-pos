import { defineConfig, devices } from "@playwright/test";

/**
 * FinderPOS — Playwright E2E configuration.
 *
 * Tests run against a locally started Next.js dev server pointing at a real
 * backend (DATABASE_URL + JWT_SECRET must be set). In CI the backend is
 * started separately; locally use `npm run dev` with NEXT_PUBLIC_API_BASE_URL
 * set to the backend port.
 *
 * See e2e/README.md for local setup instructions.
 */

const BASE_URL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false, // serial — tests share a single seeded DB state
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 1 : 0,
  workers: 1,
  reporter: process.env["CI"] ? "github" : "list",

  use: {
    baseURL: BASE_URL,
    // Disable MSW in E2E by passing a flag the app can read.
    extraHTTPHeaders: { "X-E2E-Test": "1" },
    // All tests run as the demo owner unless overridden.
    storageState: "e2e/.auth/owner.json",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
  },

  projects: [
    // Setup project — runs login once and saves auth state. Must start with
    // an explicit empty state: `storageState: undefined` inherits the global
    // value (Playwright treats undefined as "not set"), which makes the setup
    // try to READ the file it exists to create — ENOENT on fresh checkouts/CI.
    {
      name: "setup",
      testMatch: "**/global.setup.ts",
      use: { storageState: { cookies: [], origins: [] } },
    },
    // Main test project — all .spec.ts files, reuses saved auth state.
    {
      name: "e2e",
      testMatch: "**/*.spec.ts",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],

  webServer: process.env["CI"]
    ? undefined // CI starts the server manually in the workflow
    : {
        command: "npm run dev",
        url: BASE_URL,
        reuseExistingServer: true,
        timeout: 60_000,
        env: {
          NEXT_PUBLIC_E2E_MODE: "true",
          NEXT_PUBLIC_API_BASE_URL: process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "http://localhost:3001",
        },
      },
});
