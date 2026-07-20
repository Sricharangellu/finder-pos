# Ascend — Project Status (as of 2026-06-14)

This document summarizes what has been done so far, in both plain-language
and technical terms, and what happens next. It's meant to be readable by
both a non-technical stakeholder and a developer picking up the project.

---

## 1. Plain-language summary (non-technical)

**What Ascend is:** A standalone point-of-sale / business-management app
(a custom enterprise point-of-sale and business-management platform). It has a
backend (the "engine" that stores data and runs the business logic) and a
frontend (the website/app screens staff and owners use).

**What's working today:**
- The app is built and has been deployed online (Vercel) — both the backend
  engine and the customer-facing screens.
- Core modules are in place: checkout/terminal, inventory (including
  expiry-dated stock), purchasing, customer records, sales orders/invoices,
  accounting (chart of accounts, deposits), shipping, discounts, gift cards,
  e-commerce hooks, and reporting.
- There's a demo login (`owner@finder-pos.dev`) so anyone can explore it.

**What we did in this session:**
1. Cleaned up and committed ~103 files of work that had been sitting
   uncommitted — a large batch of new modules and pages (purchasing,
   billing, customers, accounting, discounts, etc.). Verified nothing broke
   (typechecks passed) before saving it.
2. Wrote a clear "what's done, what's next" backlog (the Roadmap) so future
   work has a clear queue instead of a vague to-do list.
3. Set up **two automated "developer" agents** that run on a daily schedule:
   - One works on the backend (engine/data side) every morning.
   - One works on the frontend (screens/UI side) a few hours later.
   - Each one picks the next task off the roadmap, builds it, tests it,
     and commits it — like a small, careful daily contribution from a
     teammate, without anyone needing to be at the keyboard.
   - They are **not allowed** to push to the live production site — only to
     a working branch, and any "real" deploys still require a person to
     approve.
4. Pushed the project to a private GitHub repository so these automated
   agents (which run in the cloud) can access and work on it.
5. Did a trial "preview" deployment to Vercel of both the backend and
   frontend — confirmed everything builds and runs correctly. This was a
   test deployment, not the live production site.
6. Clarified an important framing point: Ascend is its **own product**. An
   ERP feature-list document we'd been using for inspiration is just
   that — inspiration. We are not trying to copy or "catch up" to it
   feature-for-feature; we build what's useful for Ascend's users.

**What's coming next:**
- The two automated agents will keep chipping away at the roadmap daily —
  finishing security/permissions work, adding reports, building out
  purchasing/receiving screens, accounting screens, and more.
- A decision is still pending (not urgent) about reconciling some older
  branches that diverged from the main one — this needs a human call, not
  an automated one.
- Periodically, we'll review what the agents built, and decide when/what to
  promote to the live production deployment.

---

## 2. Technical summary

### 2.1 Architecture
- **Backend**: Node.js + TypeScript + Express + Postgres, modular monolith
  under `src/modules/*`. Each module = `index.ts` (migrations + register),
  `service.ts`, `routes.ts`, registered in `src/modules/index.ts`.
- **Frontend**: Next.js 14 (App Router) under `web/`.
- Conventions: tenant-scoped (`tenant_id` everywhere), money as integer
  cents, timestamps as epoch ms, IDs as prefixed `uuidv7`, cross-module
  communication via an EventBus (no direct imports), zod validation on
  mutating routes, `requireRole("manager")` RBAC guard from
  `src/gateway/auth.ts`.

### 2.2 Work completed this session
- **Repo hygiene**: resolved 103 uncommitted files on `master`.
  - Fixed 6 files that were mis-staged as "deleted" (`git add -A` re-staged
    them correctly as modified — they had new content on disk).
  - Removed ~20 leftover scratch/verify files (`.bcverify.ts`,
    `pgtest_tmp.ts`, etc.).
  - Verified `npm run typecheck` clean on both backend and frontend before
    committing.
  - Commit `af02e27`: "Wave F-H + cycle3 modules" — 86 files, +8273/-425.
    Adds purchasing, billing, team, webhooks, customers, giftcards, outlets,
    accounting, discounts, ecommerce, fulfillment, sales, search, settings,
    shipping modules + reports/inventory/catalog enhancements.

- **Branching status**: `master` (frontend + now also consolidated backend
  work) has diverged from `backend-cycle3` / `dev` / `testing` / `prod`
  since commit `66af0a6`. Not a clean fast-forward. Tracked as `PROD-1` in
  the roadmap — explicitly flagged as **human-decision-required**, agents
  are instructed never to touch this automatically.

- **New orchestration docs** (commit `1772322`):
  - `orchestration/ROADMAP.md` — living backlog, split into Backend lane,
    Frontend lane, and Cross-cutting items, plus a run log agents append to.
    Includes a "Product framing" note: `ERP_BENCHMARK.md` is inspiration
    only, not a spec to match.
  - `orchestration/AGENT_BACKEND_CYCLE.md` — playbook for the scheduled
    backend agent (owns `src/`, `contracts/`, `scripts/`, `db/`).
  - `orchestration/AGENT_FRONTEND_CYCLE.md` — playbook for the scheduled
    frontend agent (owns `web/` only).
  - Both playbooks define: sync → pick roadmap item → implement per
    conventions → verify (`npm run typecheck`, `npm test`) → optional
    non-prod preview deploy → commit to `master` → update roadmap +
    `INTEGRATION_LOG.md`. Hard stops: dirty tree, failing checks, anything
    needing the other lane/other branches/`--prod`/secrets.

- **GitHub repo**: created `https://github.com/Sricharangellu/Ascend`
  (private), pushed `master`, `backend-cycle3`, `dev`, `testing`, `prod`.
  Required because cloud-scheduled agents can't see the local filesystem.

- **Scheduled cloud agents** (via `/schedule`, CCR cron routines, both on
  `master`, preview-deploy-only, never `--prod`):
  - `trig_01BHMDD24e45xUxjrLXqsJV8` — "Ascend Backend Dev Cycle", daily
    `0 3 * * *` UTC, follows `AGENT_BACKEND_CYCLE.md`.
  - `trig_018Riha7cTs7qfnwpEx7yCFA` — "Ascend Frontend Dev Cycle", daily
    `0 6 * * *` UTC, follows `AGENT_FRONTEND_CYCLE.md`.

- **Vercel preview deploy** (testing env, `DEPLOY_ENV=testing`, no
  `--prod`): ran `scripts/deploy.sh both` with a one-time user-suppli
  ed
  token (not persisted). Result: exit 0, "Done (both)."
  - Frontend: build succeeded (28s, 13 routes), deployment
    `dpl_BPC4e9nTxNVurbYn47nQaXwjM85p`, `readyState: READY`, live at
    `https://finder-pos-frontend-85r8fe1sk-gellusricharan-4715s-projects.vercel.app`.
  - Backend: deployed and passed its `/readyz` check (script uses
    `set -euo pipefail`, so it would have aborted on failure) before the
    frontend step ran.
  - Production aliases (`finder-pos-backend.vercel.app`,
    `finder-pos-frontend.vercel.app`) were **not** touched.

### 2.3 Open roadmap (see `ROADMAP.md` for full detail)
- **Backend lane**: BE-1 (finish RBAC matrix), BE-2 (refresh-token
  rotation/revocation), BE-3 (sales-by-rep/vendor pivots + P&L report),
  BE-4 (multi-store `storeIds[]` filter), BE-5 (per-customer discount usage
  limits).
- **Frontend lane**: FE-1 (purchasing/receiving UI), FE-2 (AP/AR surface),
  FE-3 (near-expiry/markdown report + lot column), FE-4 (locations grid +
  pick & pack queue), FE-5 (COA tree editor + batch deposits), FE-6 (audit
  mocked endpoints vs live routes).
- **Cross-cutting**: DB-1 (Postgres RLS), DB-2 (Redis-based rate limiting),
  PERF-1 (cursor pagination on large list endpoints), PROD-1 (branch
  reconciliation — human decision pending).

---

## 3. Next steps
1. **Automatic (no action needed)**: the two scheduled agents run daily,
   each picking up the next roadmap item, implementing, verifying, and
   committing to `master`. Progress will show up in `ROADMAP.md`'s run log
   and `INTEGRATION_LOG.md`.
2. **Pending human decisions**:
   - `PROD-1`: decide how/whether to reconcile `master` with
     `backend-cycle3`/`dev`/`testing`/`prod` (they diverged since
     `66af0a6`).
   - When to rotate the Vercel deploy token pasted into this session.
   - When/whether to promote any preview build to production
     (`--prod` deploy is intentionally gated behind a human).
3. **Periodic review**: check in on the roadmap run log and decide whether
   the daily cadence, lane split, or task priorities need adjusting.

---

## 4. 2026-06-15 update — production deploy + orchestration reorg

- **Production deploy**: ran `DEPLOY_ENV=prod scripts/deploy.sh both` with a
  one-time user-supplied Vercel token. Both backend (`/readyz` → `db:
  connected`, 21 modules) and frontend (21 routes, `/login` 200) are live at
  `finder-pos-backend.vercel.app` / `finder-pos-frontend.vercel.app`. This
  reflects everything already on `master` (the scheduled agents' work) —
  nothing new was merged for this deploy.
- **Orchestration cleanup**: moved 9 superseded docs (the old three-parallel-
  agent prompt book, one-time DB/security audits, the stale dev/testing/prod
  environment doc, and Antigravity/cycle-3 handoff notes) to
  `orchestration/_archive/` (see its `README.md` for why each was retired).
  Nothing in the active flow (`ROADMAP.md`, `AGENT_*_CYCLE.md`) depended on
  them.
- **New gap analysis**: a fresh enterprise-architecture assessment (modeled
  on the same erp.fairtradetx.com benchmark as `ERP_BENCHMARK.md`) was
  triaged into `orchestration/gaps/*.md` — one file per business module
  (inventory, purchasing, sales/orders, accounting, customers,
  fulfillment/shipping, ecommerce, discounts, reports, settings/team/
  compliance). Each file separates "already built" (several assessment
  findings were outdated — e.g. discounts already support volume/BOGO/tier
  rules, purchasing already has receiving + AP posting) from genuinely
  useful gaps, with explicit **out-of-scope** calls (GL/ledger, carrier
  integrations, multi-channel ecommerce, EDI) per Ascend's "inspiration
  only" framing.
- **Roadmap additions**: appended **BE-9..BE-17** and **FE-10..FE-12** to
  `ROADMAP.md`, each linking to its source gap file. Highest-value items:
  inventory reservation/oversell prevention (BE-9), customer credit limits
  (BE-13), AR dunning (BE-14), and age-verification + register
  open/close (BE-16/17/FE-12). The scheduled backend/frontend agents will
  pick these up in lane order, same as before — no change to the agent
  playbooks was needed, only to the shared backlog they read.
