#!/usr/bin/env node
/**
 * Bulk-load products into the catalog via POST /api/v1/catalog/import.
 * Reads scripts/products-import.json (generated from a product-export sheet),
 * logs in with demo creds, and uploads in batches.
 *
 *   node scripts/import-products.mjs [baseUrl] [batchSize]
 *   BASE default https://finder-pos-backend.vercel.app, batch default 500.
 *   Override creds with EMAIL / PASSWORD env vars.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const BASE = process.argv[2] || process.env.BASE || "https://finder-pos-backend.vercel.app";
const BATCH = Number(process.argv[3] || process.env.BATCH || 500);
const EMAIL = process.env.EMAIL || "owner@finder-pos.dev";
const PASSWORD = process.env.PASSWORD || "FinderDemo!2026";

const here = dirname(fileURLToPath(import.meta.url));
const items = JSON.parse(readFileSync(join(here, "products-import.json"), "utf8"));
console.log(`Loaded ${items.length} products from products-import.json`);

const login = await fetch(`${BASE}/api/identity/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
if (!login.ok) throw new Error(`login failed: ${login.status}`);
const token = (await login.json()).accessToken;

let imported = 0;
for (let i = 0; i < items.length; i += BATCH) {
  const batch = items.slice(i, i + BATCH);
  const res = await fetch(`${BASE}/api/v1/catalog/import`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ items: batch }),
  });
  if (!res.ok) {
    console.error(`batch @${i} failed: ${res.status} ${await res.text()}`);
    process.exit(1);
  }
  imported += (await res.json()).imported;
  console.log(`  imported ${imported}/${items.length}`);
}
console.log(`✓ Done — ${imported} products upserted into the catalog.`);
