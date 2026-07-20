#!/usr/bin/env node
/**
 * Table-collision scan — fails CI when two modules declare a
 * `CREATE TABLE IF NOT EXISTS` for the same table name.
 *
 * Module registration order in `src/modules/index.ts` drives both migration
 * execution order AND Express mount order (see src/app.ts). If two modules
 * happen to pick the same table name, whichever module is registered first
 * "wins" the `CREATE TABLE IF NOT EXISTS` race — the second module's table
 * silently keeps the first module's (usually incompatible) schema. Every
 * write from the losing module then 500s on a missing/renamed column, and
 * because `IF NOT EXISTS` never errors, nothing signals the problem until a
 * real request hits it.
 *
 * This exact bug class was found three separate times during the 2026-07
 * Phase 0 effort, each time making a whole module 100% non-functional until
 * fixed:
 *   - `team` vs `workforce` on `time_entries`
 *   - `quotes` vs `sales` on `quotations`
 *   - `store_locations` vs `fulfillment` on `product_locations`
 *
 * All three were caught by hand, only after someone happened to write
 * integration tests against real Postgres for the losing module. This script
 * makes that check automatic and structural instead of hoping the next
 * collision gets caught the same lucky way.
 *
 * What it does:
 *   1. Scans every module's index.ts under src/modules (migrations live
 *      there, one file per module, per repo convention).
 *   2. Extracts every `CREATE TABLE IF NOT EXISTS <name>` declaration.
 *   3. Fails (exit 1) if any table name is declared in more than one module.
 *
 * Run: node tools/table-collision-scan.mjs   (aka `npm run table:scan`,
 * wired into `npm run hygiene`)
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
const MODULES_DIR = join(ROOT, "src", "modules");

/** @type {Map<string, string[]>} table name -> list of module dirs that declare it */
const owners = new Map();

const CREATE_TABLE_RE = /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+"?([a-zA-Z_][a-zA-Z0-9_]*)"?/g;

for (const entry of readdirSync(MODULES_DIR)) {
  const modDir = join(MODULES_DIR, entry);
  if (!statSync(modDir).isDirectory()) continue;
  const indexFile = join(modDir, "index.ts");
  let src;
  try {
    src = readFileSync(indexFile, "utf8");
  } catch {
    continue; // not every entry under src/modules is a module dir with index.ts (e.g. types.ts lives alongside)
  }

  for (const match of src.matchAll(CREATE_TABLE_RE)) {
    const table = match[1];
    const list = owners.get(table) ?? [];
    if (!list.includes(entry)) list.push(entry);
    owners.set(table, list);
  }
}

const collisions = [...owners.entries()]
  .filter(([, mods]) => mods.length > 1)
  .sort(([a], [b]) => a.localeCompare(b));

if (collisions.length > 0) {
  console.error("table-collision-scan: FAILED\n");
  console.error(
    "The following table names are each declared by more than one module's\n" +
      "`CREATE TABLE IF NOT EXISTS` migration. Whichever module registers first\n" +
      "in src/modules/index.ts silently wins the race, and every write from the\n" +
      "other module(s) will 500 against the wrong schema. Rename one side to a\n" +
      "unique table name (see WORK/FORWARD_PLAN.md Phase 0 continuation notes\n" +
      "for three real precedents of this exact bug):\n",
  );
  for (const [table, mods] of collisions) {
    console.error(`  ${table}  ←  ${mods.join(", ")}`);
  }
  console.error(`\n${collisions.length} colliding table name(s) across ${owners.size} total tables scanned.`);
  process.exit(1);
}

console.log(`table-collision-scan: ${owners.size} table names across all modules, no collisions`);
