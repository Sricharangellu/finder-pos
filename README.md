# FinderPOS

**Enterprise-grade Point of Sale platform** for retail, wholesale, and distribution businesses.

Built for the tobacco, vapor, hemp, and specialty retail distribution industry — with full multi-tenant SaaS architecture, real-time inventory, and compliance reporting.

[![CI](https://github.com/Sricharangellu/finder-pos/actions/workflows/ci.yml/badge.svg)](https://github.com/Sricharangellu/finder-pos/actions/workflows/ci.yml)

---

## Live Demo

| Service | URL |
|---------|-----|
| Frontend | https://finder-pos-frontend.vercel.app |
| Backend API | https://finder-pos-backend.vercel.app |

**Demo credentials:**
- Owner: `owner@finder-pos.dev` / `FinderDemo!2026`
- Cashier: `cashier@finder-pos.dev` / `FinderDemo!2026`

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
| Testing | 304 integration tests, per-test Postgres schema isolation |
| CI/CD | GitHub Actions (typecheck → test → build → deploy) |

---

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL 16+
- npm 10+

### Local development (Docker)

```bash
git clone https://github.com/Sricharangellu/finder-pos.git
cd finder-pos
cp .env.example .env
docker-compose up
```

Frontend: http://localhost:3000  
Backend API: http://localhost:3001

### Local development (manual)

```bash
# Backend
cp .env.example .env
# Edit .env with your DATABASE_URL
npm install
npm run dev          # starts tsx watch on src/server.ts

# Frontend (separate terminal)
cd web
cp .env.example .env
npm install
npm run dev          # starts Next.js on localhost:3000
```

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
│   ├── modules/               # 27 domain modules
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
├── web/                       # Next.js 14 frontend (45 pages)
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
