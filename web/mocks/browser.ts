/**
 * MSW browser worker setup.
 *
 * Import and call `startWorker()` in the dev entry point.
 * The service worker file (mockServiceWorker.js) must be copied to /public:
 *
 *   npx msw init public/ --save
 *
 * This is done automatically by the `postinstall` script (see package.json).
 */

import { setupWorker } from "msw/browser";
import { handlers } from "./handlers";

export const worker = setupWorker(...handlers);
let workerStart: ReturnType<typeof worker.start> | null = null;

/**
 * Start the MSW service worker.
 * Safe to call multiple times, including React Strict Mode effect replays.
 */
export async function startWorker(): Promise<void> {
  workerStart ??= worker.start({
    onUnhandledRequest: "warn", // Warn, don't error, on un-mocked requests
    serviceWorker: { url: "/mockServiceWorker.js" },
  });
  await workerStart;
}
