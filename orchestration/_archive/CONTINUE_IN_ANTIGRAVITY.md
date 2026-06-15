# Continue Finder ERP in Google Antigravity

Onboarding for the next agent/developer picking this project up in Antigravity.

## 1. Open the project
Open the folder **`finder-pos/`** as your Antigravity project. It's a single repo holding both apps:
- **Backend** — `src/` (Node + TypeScript + Express + Postgres, modular monolith).
- **Frontend** — `web/` (Next.js 14 app-router).

In Antigravity you can add both as one project (it supports multi-folder projects); opening `finder-pos/`
covers both. Read this file and the docs in §5 first, then start a conversation in the Manager.

## 2. What's built
Full wholesale/distribution ERP benchmarked to `ERP-Prompt-Guide.html`. ~19 backend modules:
catalog (multi-UPC), inventory (lots/expiry/FEFO), purchasing (+vendor credits/returns), billing (AP/AR),
fulfillment/WMS, sales (quotes→SO→invoice, tier pricing), customers, accounting (COA + batch deposits),
shipping, discounts, settings, search, ecommerce, reports. Frontend has pages for terminal, inventory,
customers, reports, sales, accounting, shipping, discounts, ecommerce, settings.

Both apps are live on Vercel: `finder-pos-backend.vercel.app`, `finder-pos-frontend.vercel.app`.

## 3. Branch & deploy model (important)
- **Backend** commits go to `backend-cycle3`, then mirror to `dev` / `testing` / `prod`.
- **Frontend** commits go to `master`.
- Deploys are **manual via Vercel CLI** (no git integration):
  - Backend: from `finder-pos/`, `VERCEL_PROJECT_ID=prj_krZ34CIFjzQrMvZ08PWqqbxzBf7d`
  - Frontend: from `finder-pos/web/`, `VERCEL_PROJECT_ID=prj_TiPX9UYctGKJbQr4Lb1WFwSsKiN1`
  - Team: `VERCEL_ORG_ID=team_WNp8vBq1RmWTEH8WSnenP7jM`
  - Command: `npx vercel deploy --prod --archive=tgz --yes --token <token>`
  - Set the Vercel deploy token as an Antigravity/workspace secret (don't commit it).
- Demo login: `owner@finder-pos.dev` / `FinderDemo!2026`. Backend env needs `JWT_SECRET` + `DATABASE_URL`.

## 4. Module conventions (follow these when adding features)
Each module = `index.ts` (migrations[] + register) + `service.ts` + `routes.ts`. Register it in
`src/modules/index.ts`. Tenant-scoped (`tenant_id` on every table + every query). Money = integer cents
(BIGINT); time = epoch ms (BIGINT); IDs = prefixed uuidv7. Cross-module coupling only via the EventBus
(`events.publish(type, payload, aggregateId)` / `events.on`). Migrations idempotent
(`CREATE TABLE/INDEX IF NOT EXISTS`, `ALTER … ADD COLUMN IF NOT EXISTS`). Routes mount at
`/api/v1/<module>` behind auth + tenant middleware. Validate bodies with zod. Role-gate sensitive
mutations with `requireRole("manager")` from `src/gateway/auth.ts`.

Verify a change with: `npm run typecheck`, then a standalone request test against the in-memory PG
harness (`scripts/pg-harness.js` — see any recent module's verify pattern). Keep Codex's MSW mocks in
`web/mocks/lightspeedHandlers.ts` in sync so the frontend can run offline.

## 5. Read these next
- `orchestration/ERP_BENCHMARK.md` — the benchmark + parity matrix + wave roadmap (A–H, all done).
- `orchestration/BACKEND_HANDOFF.md` — every endpoint, per module, with examples.
- `orchestration/DB_REVIEW.md` — schema review + recommendations.
- `orchestration/SECURITY_AUDIT.md` — security posture + the open follow-ups.

## 6. Open follow-ups (suggested next work)
1. Finish the RBAC matrix: apply `requireRole` to remaining sensitive mutations (voids/refunds, vendor
   credits/returns, PO receive, discount create, price changes). Guard + pattern already in place.
2. DB-level Row-Level Security as defense-in-depth (DB_REVIEW §6).
3. Distributed rate limiting (Redis) — the in-memory limiter doesn't share state across serverless
   instances (SECURITY_AUDIT H1).
4. Refresh-token rotation/revocation check.
5. Multi-store `storeIds[]` filter across all list endpoints; product master/child variants; the long
   tail of the 60+ named reports.

## 7. Starter prompt to paste into the Antigravity agent
> You're continuing the Finder ERP project. Read `orchestration/CONTINUE_IN_ANTIGRAVITY.md`,
> `ERP_BENCHMARK.md`, and `BACKEND_HANDOFF.md` first. Follow the module conventions exactly. Pick up
> follow-up #1 (finish the RBAC matrix): add `requireRole` guards to the remaining sensitive mutations,
> typecheck, write a standalone verify, and report a diff. Don't deploy until I confirm.
