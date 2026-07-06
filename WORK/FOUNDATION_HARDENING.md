# FinderPOS — Foundation Hardening, Cleanup & End-to-End Wiring (queued initiative)

> **Status: QUEUED — not started.** Authored by Sri 2026-07-05. This is a whole-repo
> restructure. **Run it as a SINGLE EXCLUSIVE claim when `WORK/LOCK.md` shows no other
> active session** — running it alongside parallel Codex/Claude sessions will collide and
> the lock protocol will (correctly) stop it. If it must proceed anyway, the operator must
> explicitly declare a broad lock and tell other sessions to stand down.
>
> **How to run:** claim the whole initiative in `WORK/LOCK.md` (broad file scope), work
> through sections 0–8 below, verify with the gates in §5, and hand off per §8. Before
> moving files, produce a short restructure plan and get Sri's OK (see the final line).

---

You are working in the finder-pos repository (GitHub Sricharangellu/finder-pos,
branch master). Your job is to give this project a SOLID FOUNDATION: clean it up,
restructure it, consolidate its governance files, and prove the backend and frontend
are wired together end-to-end and fully functional. Work autonomously — Sri grants
permission to make and apply decisions yourself. Only stop to ask when a choice is
destructive, irreversible, or genuinely Sri's to make (see "Escalate vs. resolve").

## 0. Session start (do this first, in order)
1. Read AGENTS.md at the repo root, then WORK/README.md → WORK/RULES.md →
   WORK/WORK_STATE.md → WORK/FORWARD_PLAN.md, and the newest WORK/AUDIT_*.md.
2. `git pull --ff-only origin master`. Read WORK/LOCK.md and claim your work there
   before editing any file. Release the claim only after commit + push succeed.
3. Do NOT run two `next build`s at once in this checkout (it corrupts .next).

## 1. Cleanup & de-duplication (non-negotiable)
- Delete untracked/duplicate copies: any file ending in " 2" (e.g. "EnterpriseShell 2.tsx",
  "fixtures 2.ts"), stray "*.orig", leftover merge artifacts, and any tracked build
  output (.next, dist, node_modules husks). Never leave file variants — override in place.
  (Note: `.gitignore` + a CI guard already block ` N.<ext>` / `*.collision-backup.md`
  copies from being tracked — extend, don't weaken, that protection.)
- Find and remove genuinely unused files: dead components, orphaned pages with no route
  or nav entry, mock handlers for endpoints nothing calls, and abandoned scripts. Prove
  a file is unused (grep for imports/routes) before deleting; when unsure, list it for Sri
  instead of guessing.
- Enforce .gitignore hygiene so build artifacts and node_modules can never be committed.

## 2. Consolidate governance to "one file for agents, one plan"
Right now agent instructions and planning are scattered across AGENTS.md, CLAUDE.md,
WORK/README.md, WORK/RULES.md, WORK/FORWARD_PLAN.md, WORK/WORK_STATE.md, WORK/LOCK.md,
and a pile of dated WORK/AUDIT_*.md files (whose single-letter naming keeps colliding
between parallel sessions). Restructure to:
- ONE canonical agent instruction file (AGENTS.md) that every AI agent, teammate, and
  session follows: session-start read order, the lock protocol, git/commit rules,
  verification gates, the runbook, and the hard security rules. CLAUDE.md and any other
  entrypoint should be a 2-line pointer to it, not a second source of truth.
- ONE canonical plan file that holds commands, rules, current state, and updates in a
  predictable structure — so "what do I run", "what are the rules", and "what's the
  status / what changed" each live in exactly one known place.
- Fix the audit-file sprawl: adopt a collision-proof naming scheme (timestamp or
  session-id, not next-free-letter) OR fold historical audits into an archive so the
  active docs stay small. Preserve the evidence, kill the noise.
Do not delete history blindly — migrate content, then remove the redundant file.

## 3. Verify + build backend↔frontend end-to-end
Prove the whole retail spine works against the REAL backend, not mocks:
- Go through every frontend page and its API calls. For each, confirm the endpoint
  exists on the real Express backend and the request/response shapes MATCH (this repo
  has a recurring mock-vs-real drift bug: mock returns camelCase, backend returns
  snake_case; the endpoint contract differs; or the endpoint is mock-only). Fix each
  drift at the fetch boundary or in the backend so mock mode and real mode behave
  identically.
- Confirm the golden path works login → setup (outlet/register/tax/payment/receipt) →
  product → receive → checkout → payment → receipt → register close → end-of-day →
  refund, on a production build with NEXT_PUBLIC_MOCK=false against real Postgres.
- Remember: `npm run dev` ALWAYS mocks — verifying real-backend behavior requires a
  production build. `npm run smoke` boots the real app on Postgres and is the strongest
  single proof; keep it green and extend it if you find an unproven segment.
- Map every page's status honestly: live / mocked / partial / broken. Anything that only
  works with mocks or crashes without them is a finding, not "done."

## 4. Streamline structure & flow
Propose and apply a cleaner project layout (routes, components, contexts, hooks,
api-client, mocks, backend modules) with consistent naming and clear ownership. Reduce
duplication (one authority per concern — e.g. capabilities/feature gating should have a
single source, not three). Keep the modular monolith; do not split into microservices.

## 5. Gates (must pass before every commit; never commit red)
- Backend: `npm run typecheck` and the full test suite (real Postgres).
- Frontend: `cd web && npm run typecheck && npm run lint && npm run build` (mock off).
- `npm run smoke` green. If you touch behavior, prove it with a test.

## 6. Hard rules (do not break)
- NEVER write VERCEL_TOKEN or any secret/key/token into any file.
- NEVER reference competitor POS/ERP brand names anywhere.
- Deploys are CI-only (push to master triggers them) — never deploy manually or with
  --prod locally. Push only after all gates pass.
- Conventional commits; explicit file lists (never `git add -A`).

## 7. Escalate vs. resolve
Resolve on your own: cleanup, restructuring, doc consolidation, drift fixes, test
additions, wiring gaps, anything reversible that follows from the above.
Escalate to Sri (list clearly, don't block on): deleting anything you can't prove is
unused, destructive DB/prod actions, security exposures (e.g. live demo credentials,
orphaned/broken public URLs, missing env config), scope changes, and any decision that's
genuinely a product call. Batch these into a "Needs your attention" list at the end.

## 8. Handoff
Update the single plan/state file with what you did, what's proven, what's still open,
and the next 3 actions. Write the audit evidence in the collision-proof scheme. Working
tree clean, no stray files, servers stopped. Commit, push, release the lock. Report
plainly what passed AND what failed — including anything you deferred to Sri.

Begin by reading the session-start files and giving Sri a short restructure plan before
you start moving files, then execute it.

---

## Progress log (append as sections of this initiative complete)

- _not started — no session has claimed this yet._
