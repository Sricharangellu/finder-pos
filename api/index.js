// Vercel serverless entry for the Ascend modular monolith (Postgres-backed).
// buildApp is async (migrations + seed run once per cold start against the
// DATABASE_URL Postgres); we cache the promise so a warm instance reuses the
// same Express app + connection pool. Redirects/rewrites in vercel.json route
// all traffic here.
import { buildApp } from "../dist/src/app.js";

let appPromise;

export default async function handler(req, res) {
  if (!appPromise) {
    appPromise = buildApp({ connectionString: process.env.DATABASE_URL });
    // A rejected promise must not stay cached: a transient failure (DB
    // hiccup during migrations) would otherwise wedge this instance until
    // Vercel recycles it. Clear so the next request retries the build.
    appPromise.catch(() => {
      appPromise = undefined;
    });
  }
  const { express } = await appPromise;
  return express(req, res);
}
