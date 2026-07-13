#!/usr/bin/env node
/**
 * tools/hygiene-check.mjs — repo hygiene guard (no dependencies).
 *
 * Fails (exit 1) on the patterns that have caused multi-session collisions or
 * would leak configuration/secrets in this repo: duplicate "copy" files,
 * collision backups, merge-conflict leftovers/markers, a missing or duplicated
 * AGENTS.md, tracked .env files, and high-confidence secret tokens. This is the
 * "machines enforce hygiene, not humans" control — run it locally and wire it
 * into CI / a pre-commit hook so junk or a secret can never be committed.
 *
 *   node tools/hygiene-check.mjs   (aka `npm run hygiene`)
 *
 * Scans git-tracked files plus untracked-but-not-ignored files, so it catches
 * problems before they are ever committed.
 */
import { execSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

function gitList(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8" }).split("\n").map((s) => s.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

const files = [
  ...gitList("git ls-files"),
  ...gitList("git ls-files --others --exclude-standard"),
];

const violations = [];
const base = (f) => f.split("/").pop() ?? f;

// 1. Numeric "copy" files: "AGENTS 2.md", "report 3.txt" — editor/export/merge copies.
//    Git history is the version store; these never belong in the tree.
const copyRe = / \d+\.[A-Za-z0-9]+$/;
for (const f of files) if (copyRe.test(base(f))) violations.push(`duplicate copy file: ${f}`);

// 2. Collision-backup files produced by botched merges/saves.
for (const f of files) if (f.endsWith(".collision-backup.md")) violations.push(`collision backup: ${f}`);

// 3. Merge-conflict leftovers.
for (const f of files) if (f.endsWith(".orig") || f.endsWith(".rej")) violations.push(`merge leftover: ${f}`);

// 4. Exactly one AGENTS.md — the single agent-instruction file (also guarded in CI).
const agents = files.filter((f) => base(f) === "AGENTS.md");
if (agents.length === 0) violations.push("missing AGENTS.md (the single agent-instruction file is required)");
if (agents.length > 1) violations.push(`multiple AGENTS.md (must be exactly one): ${agents.join(", ")}`);

// 5. Tracked .env files. Real env files hold config/secrets and must be gitignored;
//    only the committed template (.env.example / *.env.example) is allowed.
const envRe = /(^|\/)\.env(\.[A-Za-z0-9_-]+)?$/;
for (const f of files) {
  if (envRe.test(f) && !f.endsWith(".example")) violations.push(`tracked env file (should be gitignored): ${f}`);
}

// 6. Content scan — merge-conflict markers and high-confidence secret tokens.
//    Read each tracked/untracked text file once; skip binaries, large files, and
//    this checker itself (it contains the marker/secret patterns as literals).
const SELF = "tools/hygiene-check.mjs";
const BINARY_EXT = /\.(png|jpe?g|gif|webp|ico|svg|pdf|woff2?|ttf|eot|otf|mp[34]|zip|gz|tgz|wasm|node|lock)$/i;
const SECRET_PATTERNS = [
  [/vcp_[A-Za-z0-9]{20,}/, "Vercel token"],
  [/sk_live_[A-Za-z0-9]{16,}/, "Stripe live secret key"],
  [/rk_live_[A-Za-z0-9]{16,}/, "Stripe live restricted key"],
  [/AKIA[0-9A-Z]{16}/, "AWS access key id"],
  [/gh[posru]_[A-Za-z0-9]{36,}/, "GitHub token"],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/, "private key"],
];
const CONFLICT_START = /^<{7}( |$)/m;
const CONFLICT_END = /^>{7}( |$)/m;

for (const f of files) {
  if (f === SELF || BINARY_EXT.test(f)) continue;
  let content;
  try {
    if (statSync(f).size > 512 * 1024) continue; // skip large files (unlikely to hold hand-written secrets)
    content = readFileSync(f, "utf8");
  } catch {
    continue; // unreadable / deleted-in-tree — not our concern here
  }
  if (CONFLICT_START.test(content) && CONFLICT_END.test(content)) {
    violations.push(`merge-conflict markers in file: ${f}`);
  }
  if (!f.endsWith(".example")) {
    for (const [re, label] of SECRET_PATTERNS) {
      if (re.test(content)) { violations.push(`possible secret (${label}) in: ${f}`); break; }
    }
  }
}

if (violations.length) {
  console.error("✗ repo-hygiene check FAILED:\n" + violations.map((v) => "  - " + v).join("\n"));
  console.error(
    "\nThese patterns cause multi-session collisions (diverged trees, blocked rebases, lost work)\n" +
      "or leak config/secrets. Fix: delete junk / gitignore env files / rotate + remove the secret.\n" +
      "Use git history and branches for versions — never file copies.",
  );
  process.exit(1);
}

console.log(`✓ repo-hygiene check passed (${files.length} files scanned; no junk, tracked env, conflict markers, or secrets).`);
