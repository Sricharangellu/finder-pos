#!/usr/bin/env node
/**
 * API gap scan — fails CI when the frontend calls a backend path that does not
 * exist. This is the guardrail against the exact incident class documented in
 * WORK/audits/AUDIT_2026-07-18T005030Z-fe-be-gap-audit.md: pages shipped
 * against MSW mocks while the real API 404'd in production (at its worst,
 * 10 whole modules were unreachable and nobody noticed because mocks answered
 * in every dev environment).
 *
 * What it does:
 *   1. Extracts every registered backend route: module register() routes with
 *      mountPath resolution, app.ts direct routes, and identity routes.
 *   2. Extracts every /api/v1|/api/identity path literal in the web client.
 *   3. Normalizes params (`:id`, `${expr}` → `:p`) and diffs FE → BE.
 *   4. Fails (exit 1) on any FE path with no backend route, unless the path is
 *      in tools/api-gap-allowlist.json (known Preview surfaces / tracked gaps).
 *   5. Warns on stale allowlist entries (backend route now exists) so the
 *      allowlist only ever shrinks.
 *
 * The double-prefix bug class (router mounted at /api/v1/<mod> registering
 * "/<mod>/…" internally) is caught automatically: the registered path becomes
 * /api/v1/<mod>/<mod>/… which never matches what the FE calls.
 *
 * Run: npm run gap:scan   (wired into CI's hygiene job)
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

// ─── helpers ──────────────────────────────────────────────────────────────────

function* walk(dir, skip = /node_modules|\.next|test-results/) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (skip.test(p)) continue;
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p, skip);
    else yield p;
  }
}

/** Normalize a route/call path: params and template holes become `:p`. */
function norm(p) {
  return (
    p
      .replace(/:[A-Za-z_]+/g, ":p")
      .replace(/\$\{[^}]*\}/g, ":p")
      .replace(/\$\{.*$/, "") // dangling template hole (multiline literal) — trim
      .replace(/\?.*$/, "")
      .trim()
      .replace(/\/+$/, "") || "/"
  );
}

// ─── 1. backend routes ────────────────────────────────────────────────────────

const MODULES_DIR = join(ROOT, "src/modules");
const ROUTE_RE = /\brouter\.(get|post|put|patch|delete)\(\s*[`"']([^`"']*)[`"']/g;

const backend = new Set(); // normalized full paths

for (const mod of readdirSync(MODULES_DIR)) {
  const modDir = join(MODULES_DIR, mod);
  if (!statSync(modDir).isDirectory()) continue;
  const idx = join(modDir, "index.ts");
  if (!existsSync(idx)) continue;
  const idxSrc = readFileSync(idx, "utf8");
  const name = idxSrc.match(/name:\s*"([^"]+)"/)?.[1] ?? mod;
  const mountPath = idxSrc.match(/mountPath:\s*"([^"]+)"/)?.[1] ?? `/api/v1/${name}`;
  for (const file of readdirSync(modDir)) {
    if (!file.endsWith(".ts") || file.includes(".test.")) continue;
    const src = readFileSync(join(modDir, file), "utf8");
    for (const m of src.matchAll(ROUTE_RE)) {
      const sub = m[2] === "/" ? "" : m[2];
      backend.add(norm(mountPath.replace(/\/$/, "") + sub));
    }
  }
}

// app.ts direct routes (flags, capabilities, stream, jobs, …)
const appSrc = readFileSync(join(ROOT, "src/app.ts"), "utf8");
for (const m of appSrc.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*[`"']([^`"']+)[`"']/g)) {
  backend.add(norm(m[2]));
}
// SSO public routes are registered via registerPublicRoutes on /api/v1/sso —
// already collected from the sso module's routes.ts above.

// identity routes
const IDENTITY_DIR = join(ROOT, "src/identity");
for (const file of readdirSync(IDENTITY_DIR)) {
  if (!file.endsWith(".ts") || file.includes(".test.")) continue;
  const src = readFileSync(join(IDENTITY_DIR, file), "utf8");
  for (const m of src.matchAll(ROUTE_RE)) {
    backend.add(norm("/api/identity" + m[2]));
  }
}

// ─── 2. frontend path literals ────────────────────────────────────────────────

const FE_DIRS = ["web/app", "web/api-client", "web/hooks", "web/lib", "web/components", "web/contexts"];
const FE_RE = /[`"'](\/api\/(?:v1|identity)\/[^`"']*)[`"']/g;

// Catches a distinct incident class from the missing-route gap above: a call
// site that forgets the /api/v1 (or /api/identity) prefix entirely. FE_RE
// above only matches literals that already contain the prefix, so a bare path
// like apiGet("/inventory/serials") is invisible to it — found 2026-07-18 in
// inventory/serials/page.tsx, which called apiGet/apiPost/apiPatch without the
// prefix and 404'd against the real API on every request. This regex targets
// exactly those four API-client call sites so it doesn't flag unrelated
// strings (hrefs, external URLs, etc.) elsewhere in the app.
const FE_MISSING_PREFIX_RE = /\bapi(?:Get|Post|Patch|Put|Delete)(?:<[^>]*>)?\s*\(\s*[`"']([^`"']+)[`"']/g;

/** path → Set<file> */
const frontend = new Map();
const missingPrefix = []; // { path, file }
for (const d of FE_DIRS) {
  const dir = join(ROOT, d);
  if (!existsSync(dir)) continue;
  for (const file of walk(dir)) {
    if (!/\.(ts|tsx)$/.test(file)) continue;
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(FE_RE)) {
      const p = norm(m[1]);
      if (!frontend.has(p)) frontend.set(p, new Set());
      frontend.get(p).add(relative(ROOT, file));
    }
    for (const m of src.matchAll(FE_MISSING_PREFIX_RE)) {
      if (!m[1].startsWith("/api/")) {
        missingPrefix.push({ path: m[1], file: relative(ROOT, file) });
      }
    }
  }
}

// ─── 3. diff with allowlist ───────────────────────────────────────────────────

const ALLOWLIST_PATH = join(ROOT, "tools", "api-gap-allowlist.json");
const allowlist = existsSync(ALLOWLIST_PATH)
  ? JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"))
  : { prefixes: [], paths: [] };

const allowedByPrefix = (p) => allowlist.prefixes.some((pre) => p.startsWith(pre));
const allowedExact = new Set(allowlist.paths);

const failures = [];
const allowedHits = new Set();
for (const [p, files] of [...frontend.entries()].sort()) {
  if (backend.has(p)) continue;
  // Concatenation artifacts: a normalized FE string that still contains a
  // template hole glued to a path segment (e.g. "…/orders:p") or is a comment
  // example. These are not real calls; the audit's §5 documents each class.
  if (/[^/]:p$/.test(p)) {
    // Glued concat like "…/products:p" (path + `?${params}` template): judge the base.
    const base = p.replace(/:p$/, "");
    if (backend.has(base) || allowedByPrefix(base) || allowedExact.has(base)) continue;
  }
  if (/:p$/.test(p) && backend.has(p.replace(/\/?:p$/, ""))) continue; // querystring concat
  if (allowedByPrefix(p) || allowedExact.has(p)) {
    if (allowedExact.has(p)) allowedHits.add(p);
    continue;
  }
  // Two trailing params often mean `${id}/${action}` fan-out — accept when any
  // backend route matches the same prefix with the same segment count.
  const fanout = p.replace(/:p\/:p$/, "");
  if (
    p.endsWith(":p/:p") &&
    [...backend].some((b) => b.startsWith(fanout) && b.split("/").length === p.split("/").length)
  ) continue;
  failures.push({ path: p, files: [...files].slice(0, 3) });
}

// Stale allowlist entries: the backend caught up — shrink the list.
const stale = allowlist.paths.filter((p) => backend.has(p));

// ─── report ───────────────────────────────────────────────────────────────────

console.log(`api-gap-scan: ${backend.size} backend paths, ${frontend.size} frontend paths, ${allowlist.paths.length} allowlisted`);

if (stale.length) {
  console.warn("\n⚠ stale allowlist entries (backend route now exists — remove from tools/api-gap-allowlist.json):");
  for (const p of stale) console.warn(`  - ${p}`);
}

if (missingPrefix.length) {
  console.error("\n✗ API-client calls missing the /api/v1 (or /api/identity) prefix (would 404):");
  for (const f of missingPrefix) console.error(`  - "${f.path}"\n      called from: ${f.file}`);
  console.error(
    "\nFix: add the /api/v1 (or /api/identity) prefix to the call. This is the" +
      "\nsame incident class as a missing route — the request just never reaches" +
      "\nthe API at all.",
  );
}

if (failures.length || missingPrefix.length) {
  if (failures.length) {
    console.error("\n✗ frontend calls with NO backend route (would 404 in production):");
    for (const f of failures) console.error(`  - ${f.path}\n      called from: ${f.files.join(", ")}`);
    console.error(
      "\nFix: implement the backend route (and matching MSW mock), or — only for a" +
        "\ndeliberate UI-preview surface — add the path to tools/api-gap-allowlist.json" +
        "\nWITH a matching entry on the board (WORK/FORWARD_PLAN.md or LOOP_STATE backlog)." +
        "\nNever ship a page against mocks silently: that is how 10 modules 404'd in prod" +
        "\nunnoticed (AUDIT_2026-07-18T005030Z).",
    );
  }
  process.exit(1);
}

console.log("✓ no unexplained frontend→backend gaps");
