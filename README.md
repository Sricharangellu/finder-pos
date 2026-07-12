# Ascend

**Enterprise-grade Point of Sale platform** for retail, wholesale, and distribution businesses.

Built for the tobacco, vapor, hemp, and specialty retail distribution industry — with full multi-tenant SaaS architecture, real-time inventory, and compliance reporting.

[![CI](https://github.com/Sricharangellu/Ascend/actions/workflows/ci.yml/badge.svg)](https://github.com/Sricharangellu/Ascend/actions/workflows/ci.yml)

---

## Live Demo

| Service | URL |
|---------|-----|
| Frontend | https://finder-pos-frontend.vercel.app |
| Backend API | https://finder-pos-backend.vercel.app |

**Demo credentials:**
- Owner: `owner@finder-pos.dev` / `FinderDemo!2026`
- Cashier: `cashier@finder-pos.dev` / `FinderDemo!2026`

> These demo credentials are public and are also planted by `scripts/seed-e2e.ts`
> for CI. Treat them as demo-only; never seed them into a real database.

---

## Project status

Honest maturity, not marketing — the feature list below describes the codebase's
breadth, not uniform readiness:

- **Retail is the one pack proven end-to-end.** The POS lifecycle (login → open
  register → sale → payment → inventory movement → refund → end-of-day → close) is
  covered by the backend test suite and `npm run smoke`.
- **The other verticals exist as code but are Partial or Planned**, not verified
  production-ready. See [`WORK/FORWARD_PLAN.md`](WORK/FORWARD_PLAN.md) for the
  per-area honest-status labels (`Built and verified` · `Partial` · `Planned` · …).
- **Tenant isolation** is enforced primarily at the application layer (handlers
  scope every query by the JWT tenant), with PostgreSQL **RLS as a defense-in-depth
  backstop** — both are proven by `src/gateway/tenant-isolation.test.ts`.
- **Operational hardening is open work** — Redis-backed rate limiting in
  production, backup/restore drills, monitoring/alerting, and a `/delivery` e2e are
  still pending (FORWARD_PLAN Phase 4).

**New here?** Start with
[docs/getting-started/local-development.md](docs/getting-started/local-development.md)
to run the backend against your own Postgres.

---

## Features

### Retail POS
- Fast checkout terminal with barcode scanner support (keyboard-wedge)
- Split tender (cash + card), gift cards, loyalty points
- Register sessions with cash float tracking
- Age-verification workflow for restricted products
- Offline mode with automatic sync

### Inventory
- Multi-location inventory stock (per outlet/warehouse)
- Batch/lot tracking with expiry dates (FEFO picking)
- Reorder point alerts + auto-draft PO recommendations
- Cycle count sessions
- Real-time low-stock SSE notifications

### Wholesale / B2B
- Sales orders + invoices + quotations
- Customer credit limits with AR dunning
- Vendor management with addresses and contacts
- Purchase orders with partial receive and bill variance
- Landed costs

### Enterprise
- Multi-outlet, multi-register
- Custom RBAC with granular permissions
- SSO (OIDC) for enterprise tenants
- Configurable checkout workflows per outlet
- Scheduled reports (email delivery)
- Inventory forecasting and order recommendations

### Tax & Compliance
- MSA (Master Settlement Agreement) reporting for tobacco manufacturers
- State-specific tobacco, vapor, and hemp tax rules
- Customer license tracking (tobacco, cigarette, vapor, hemp, resale)
- Tax rate management by product class and state

### Platform
- REST API — all features exposed as versioned endpoints
- Webhooks for external integrations (Shopify, QuickBooks, Stripe, etc.)
- Import/export (CSV) for products, customers, and vendors
- Server-Sent Events for real-time dashboard updates

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Recharts |
| Backend | Node.js, TypeScript, Express, modular monolith |
| Database | PostgreSQL (integer cents, idempotent migrations) |
| Auth | JWT (15-min access tokens, single-use refresh rotation), TOTP MFA |
| Deployment | Vercel (frontend + backend serverless) |
| Testing | 300+ backend integration tests, per-test Postgres schema isolation (embedded Postgres) |
| CI/CD | GitHub Actions (typecheck → test → build → deploy) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm 10+

### Local development (Docker)

```bash
git clone https://github.com/Sricharangellu/Ascend.git
cd Ascend
docker-compose up        # Postgres + backend (:3001) + frontend (:3000)
```

Frontend: http://localhost:3000  
Backend API: http://localhost:3001

Compose injects `DATABASE_URL`/`JWT_SECRET` for the backend container, so no
`.env` setup is needed for this path.

### Local development (manual, your own Postgres)

The backend does **not** auto-load `.env`, so you must export the variables (a
plain `cp .env.example .env` alone will fail with `DATABASE_URL is not set`).
Migrations run automatically on startup — there is no separate migrate command.

```bash
# Backend — the server does NOT auto-load .env, so export the two required vars:
export DATABASE_URL='postgresql://finder:finder@localhost:5432/finder_dev'
export JWT_SECRET='dev-only-secret-at-least-32-characters-long'
npm install
npm run dev                          # tsx watch src/server.ts — applies migrations, then serves
curl -s localhost:3001/readyz        # expect "status":"ok","db":"connected"

# Frontend (separate terminal)
cd web && npm install
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev   # Next.js on :3000
```

Full walkthrough (env vars, verification, embedded-postgres test harness vs. your
DB, troubleshooting): **[docs/getting-started/local-development.md](docs/getting-started/local-development.md)**.

### Running tests

```bash
# Backend integration tests (requires PostgreSQL)
npm test

# Frontend type check + lint + build
cd web && npm run typecheck && npm run lint && npm run build
```

---

## Environment Variables

See `.env.example` for all backend variables and `web/.env.example` for frontend.

**Required for production:**
- `DATABASE_URL` — PostgreSQL connection string
- `JWT_SECRET` — minimum 32 random characters

**Optional:**
- `SENDGRID_API_KEY` — email receipt delivery
- `SENTRY_DSN` — error tracking
- `STORE_NAME` — appears on receipts

---

## Project Structure

```
finder-pos/
├── src/
│   ├── app.ts                 # Express app factory
│   ├── server.ts              # HTTP server entry point
│   ├── gateway/               # Auth middleware, rate limiting, metrics
│   ├── identity/              # Users, JWT, MFA, API keys, devices
│   ├── modules/               # ~50 domain modules (many Partial/Planned — see FORWARD_PLAN)
│   │   ├── catalog/           # Products, variants, categories, images
│   │   ├── inventory/         # Stock, movements, locations, cycle counts
│   │   ├── orders/            # POS orders with inventory reservations
│   │   ├── payments/          # Payment capture, refunds
│   │   ├── customers/         # CRM, loyalty, addresses, groups
│   │   ├── purchasing/        # POs, suppliers, partial receive
│   │   ├── quotes/            # Quotations → sales order conversion
│   │   ├── sales/             # Sales orders, invoices, credit limits
│   │   ├── billing/           # Bills, AR dunning, batch deposits
│   │   ├── accounting/        # Chart of accounts, journal entries
│   │   ├── insights/          # Forecasting, reorder recommendations
│   │   ├── reports/           # 10 report types + daily aggregations
│   │   ├── discounts/         # Rules, coupons, per-customer limits
│   │   ├── giftcards/         # Issue, redeem, void
│   │   ├── settings/          # Feature flags, tax rates, currencies
│   │   ├── sso/               # OIDC single sign-on
│   │   ├── workflows/         # Configurable checkout workflows
│   │   └── ...
│   ├── orchestration/         # Sagas, workflows, CQRS, event bus
│   └── shared/                # DB, email, SSE, money, HTTP helpers
├── web/                       # Next.js 14 frontend (~145 pages)
│   ├── app/(protected)/       # Authenticated pages
│   ├── components/            # Design system components
│   └── mocks/                 # MSW mock handlers for dev
├── .github/workflows/ci.yml   # CI/CD pipeline
├── Dockerfile                 # Multi-stage production build
├── docker-compose.yml         # Local dev stack
└── .env.example               # Environment variable template
```

### Business separation work packages

Retail, wholesale, ecommerce, warehouse, and shared-platform implementation prompts are tracked as work packages in `WORK/business-separation/README.md`.

Read those packages before changing module schemas, route contracts, permissions, pricing, inventory, reporting, integrations, workflow orchestration, or frontend navigation that varies by business model.

---

## API Reference

Base URL: `https://finder-pos-backend.vercel.app/api/v1/`

All endpoints require `Authorization: Bearer <access_token>` except `/api/identity/login` and `/api/identity/register`.

Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/identity/register` | Create tenant + owner account |
| POST | `/api/identity/login` | Authenticate, receive JWT pair |
| GET | `/api/v1/catalog` | List products |
| POST | `/api/v1/orders` | Create POS order |
| POST | `/api/v1/payments` | Capture payment |
| GET | `/api/v1/reports/summary` | Sales summary |
| GET | `/api/v1/stream` | SSE real-time events |

Full API documentation: see `contracts/openapi.yaml`

---

## License

MIT — see [LICENSE](LICENSE) file.

---

*Built with care for enterprise retail.*
