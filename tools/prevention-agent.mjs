#!/usr/bin/env node
/**
 * Strict repo drift prevention agent.
 *
 * This is intentionally stricter than hygiene-check.mjs. The hygiene check
 * blocks duplicate/backup junk from landing. This agent also blocks the local
 * "dirty drift" patterns that create unrelated edits and surprise modules:
 * generated design-sync folders, untracked source modules, deleted canonical
 * docs, and any uncommitted tracked edits.
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function lines(s) {
  return s.split("\n").map((line) => line.trim()).filter(Boolean);
}

function fail(title, items, help) {
  console.error(`\n✗ ${title}`);
  for (const item of items) console.error(`  - ${item}`);
  if (help) console.error(`\n${help}`);
  process.exitCode = 1;
}

const root = git(["rev-parse", "--show-toplevel"]);
const status = lines(git(["status", "--porcelain=v1", "--untracked-files=all"]));

const trackedDrift = status.filter((line) => !line.startsWith("?? "));
if (trackedDrift.length) {
  fail(
    "tracked working-tree drift detected",
    trackedDrift,
    "Fix: commit intentional work on a branch/PR, or discard unintended tracked edits with `git restore <path>`.",
  );
}

const untracked = status.filter((line) => line.startsWith("?? ")).map((line) => line.slice(3));

const forbiddenRoots = [
  ".design-sync/",
  ".ds-sync/",
  "ds-bundle/",
  "db/pool/",
];

const forbiddenFound = forbiddenRoots.filter((path) => existsSync(join(root, path)));
if (forbiddenFound.length) {
  fail(
    "generated/copy workspace folders detected",
    forbiddenFound,
    "Fix: remove these local generated folders. They are not source-of-truth repo files.",
  );
}

const untrackedModules = new Set();
for (const file of untracked) {
  const match = file.match(/^src\/modules\/([^/]+)\//);
  if (match) untrackedModules.add(`src/modules/${match[1]}/`);
}
if (untrackedModules.size) {
  fail(
    "untracked source module directories detected",
    [...untrackedModules].sort(),
    "Fix: do not leave new modules floating locally. Either implement them on a claimed branch with tests, or delete them.",
  );
}

const obsoleteDocs = [
  "CLAUDE.md",
  "WORK/RULES.md",
  "WORK/WORK_STATE.md",
  "orchestration/ROADMAP.md",
  "web/PROJECT_PLAN.md",
  "web/WORK_STATE.md",
];
const revivedDocs = obsoleteDocs.filter((path) => existsSync(join(root, path)));
if (revivedDocs.length) {
  fail(
    "obsolete duplicate planning/instruction files detected",
    revivedDocs,
    "Fix: keep the canonical instructions in AGENTS.md and the canonical plan in WORK/FORWARD_PLAN.md.",
  );
}

const copyFiles = untracked.filter((file) => / \d+\.[A-Za-z0-9]+$/.test(file.split("/").pop() ?? ""));
if (copyFiles.length) {
  fail(
    "untracked numeric copy files detected",
    copyFiles,
    "Fix: delete editor/Finder/chat-export copies. Use git branches/history for versions.",
  );
}

if (process.exitCode) process.exit(process.exitCode);

const trackedCount = Number(git(["ls-files"]).split("\n").filter(Boolean).length);
console.log(`✓ prevention agent passed (${trackedCount} tracked files; no dirty drift or stray modules).`);

