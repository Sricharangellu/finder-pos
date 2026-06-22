# FinderPOS — System Design Reference

Last updated: 2026-06-21. Living document — update each section when the
implementation changes. This is design intent + rationale, not a spec
agents must match exactly; actual code is authoritative.

---

## 1. High-level architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser / POS Terminal                                            │
│  Next.js 14 App Router (web/)                                      │
│  • Static assets → CDN (Vercel Edge)                               │
│  • SSR/RSC pages → Vercel serverless functions                     │
│  • Auth: access token in-memory, refresh token in sessionStorage   │
│    (planned: both in httpOnly cookies — see §Auth)                 │
└──────────────────┬─────────────────────────────────────────────────┘
                   │  HTTPS (rewrites via next.config.mjs)
                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  API Gateway / Express (src/)                                      │
│  • Helmet security headers (CORS, XSS, CSP)                        │
│  • Rate limiting: global 120/min, identity 10/min (Redis-backed)   │
│  • authMiddleware: JWT Bearer verification on /api/v1/*            │
│  • PosModule registry: each domain = { migrations, register() }    │
│  • EventBus: in-process pub/sub; planned: Redis Streams for multi- │
│    instance (see §Scaling)                                         │
└──────────────────┬─────────────────────────────────────────────────┘
                   │  DB connection pool (node-postgres)
                   ▼
┌────────────────────────────────────────────────────────────────────┐
│  PostgreSQL / Neon (db/)                                           │
│  • Row-level security enabled (tenant_id isolation)                │
│  • All tenant tables have: tenant_id, created_at, updated_at       │
│  • Money: integer cents. IDs: prefixed uuidv7. Booleans: native.   │
│  • Migrations: in-app (PosModule.migrations[]) — self-provisioning │
└────────────────────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
  Redis (ioredis)           Stripe Terminal
  • Rate limit buckets      • Card-present payments
  • Session cache (planned) • PCI DSS P2PE (card data
  • BullMQ job queue          never touches our servers)
    (planned — see §Jobs)
```

---

## 2. Auth § Auth

### Current state (2026-06-21)
- Login → `POST /api/identity/login` returns `{ accessToken, refreshToken, expiresIn }`.
- Access token: RS256 JWT, 15-minute TTL, stored **in-memory only** (module variable in `web/lib/auth.ts`). Survives page navigation but not tab close/refresh.
- Refresh token: stored in `sessionStorage` under `finder_refresh_token`. On page mount, `silentRefresh()` re-hydrates the in-memory access token. Lost on tab close.
- Backend: `authMiddleware` verifies JWT signature + expiry; writes `res.locals.auth { userId, tenantId, role }`.
- Refresh token rotation: single-use, revoked on rotation (`refresh_tokens` table with `revoked_at`).

### Planned upgrade (BE-31) — httpOnly cookies
To enable server-side auth in Next.js middleware (and harden against XSS), move tokens to cookies:

```
Set-Cookie: finder_refresh=<token>; HttpOnly; Secure; SameSite=Lax; Path=/api/identity/refresh; Max-Age=2592000
Set-Cookie: finder_session=<short_opaque_id>; HttpOnly; Secure; SameSite=Strict; Path=/
```

With a cookie-based session, `web/middleware.ts` can check `request.cookies.get("finder_session")` and redirect unauthenticated requests server-side before the page renders.

### Role hierarchy
```
owner > manager > cashier
```
- `requireRole("manager")` passes for both manager and owner.
- Custom roles extend cashier permissions via `permissions[]` array in the JWT.
- Owner-only actions (billing, API keys, user management) must explicitly check `role === "owner"`.

### MFA
TOTP-based (Google Authenticator compatible). Setup: `POST /api/identity/mfa/setup` → QR code. Verify: `POST /api/identity/mfa/verify`. Stored as `mfa_secret` in `users` table (encrypted at rest recommended for production).

---

## 3. Multi-tenancy

Every tenant-scoped table carries `tenant_id TEXT NOT NULL` as the second column after `id`. This is the primary isolation mechanism:

- **Application layer**: every service method takes `tenantId` as an explicit parameter and includes `AND tenant_id = @tenantId` in all queries.
- **Database layer**: Row-Level Security policies (`db/rls/policies.sql`) enforce isolation at the Postgres level as defense-in-depth. `DB.withTenant(tenantId)` wraps queries in a transaction that sets `app.current_tenant` via `set_config`.
- **JWT**: `tenantId` is embedded in every access token and written to `res.locals.auth` by `authMiddleware`. The application never trusts a tenant ID from the request body for reads/writes.

Tenant onboarding: `POST /api/identity/register` → creates `tenants`, `users`, and seeds `feature_flags` with defaults.

---

## 4. Module system

Each business domain is a `PosModule`:

```ts
export interface PosModule {
  name: string;
  migrations: string[];      // DDL run once at startup (idempotent — IF NOT EXISTS)
  register(deps: {
    db: DB;
    events: EventBus;
    router: Router;
  }): void;
}
```

Modules registered in `src/app.ts`. The DB runs all migrations on boot in order — new tables are auto-provisioned on the first deploy that includes a new module. This enables zero-downtime feature additions without a separate migration runner in CI (though `db/migrations/` SQL files remain the design-canonical source).

Current modules: identity, catalog, inventory, orders, customers, sales, purchasing, billing, accounting, payments, discounts, settings, reports, insights, loyalty, shipping, ecommerce, store_locations, service_orders, workforce, notifications, custom_roles, giftcards, compliance.

---

## 5. EventBus

In-process pub/sub (`src/shared/events.ts`). Pattern:

```ts
events.publish("invoice.overdue", { tenantId, invoiceId, dunningLevel });
events.subscribe("invoice.overdue", handler);
```

**Current limitation**: events are in-process only — not durable, not cross-instance. In a multi-instance/serverless deployment, events fired on one instance are not received on others.

**Planned upgrade (§Scaling)**: move to Redis Streams or Neon's logical replication LISTEN/NOTIFY for durable cross-instance fan-out.

---

## 6. Payments § Payments

- Provider: Stripe Terminal (card-present) + Stripe Payments (card-not-present).
- P2PE: card data is encrypted at the terminal hardware and never passes through FinderPOS servers. The backend receives a `paymentIntent.id` and amount, calls Stripe's capture API.
- Split tender: `POST /api/v1/payments` accepts `method: "split"` with `cashCents` + `cardCents`.
- EBT/WIC: not yet integrated — planned for compliance vertical (Phase 5+).
- PCI scope: Stripe Terminal's P2PE reduces FinderPOS PCI scope to SAQ P2PE (minimal). Do not log card data, PAN, or CVV anywhere.
- Idempotency: `idempotency_keys` table prevents duplicate captures. Pass `idempotencyKey` from the client on every payment capture.

---

## 7. Offline-first POS (FE-29) § Offline

The terminal page must function during transient network outages (Wi-Fi dropout, internet downtime while processing a customer):

**Design**:
1. **Service Worker** (Next.js + Workbox): cache the terminal page shell, product catalog bundle, and static assets. Strategy: cache-first for assets, network-first with 3s timeout for API calls.
2. **IndexedDB queue**: when `POST /api/v1/orders` fails due to network error, store the order JSON in IndexedDB. On reconnect, drain the queue in FIFO order.
3. **Conflict resolution**: orders in the queue are submitted with an `idempotencyKey` generated at queue time. If the network was actually up and the response was lost, the server deduplicates and returns the existing order.
4. **Offline indicator**: `navigator.onLine` event → show a banner in EnterpriseShell.

**Out of scope for offline**: real-time inventory reservations, credit limit checks, loyalty point accrual — these are reconciled post-sync.

---

## 8. Real-time updates (FE-30) § Realtime

FinderPOS uses Server-Sent Events (SSE) for server→client push:

- Endpoint: `GET /api/v1/stream` (auth-required, one connection per client).
- Events emitted: `order.created`, `inventory.low_stock`, `notification.created`, `invoice.overdue`, `loyalty.tier_upgraded`.
- Client: `useSSE()` hook in `web/lib/useSSE.ts` wraps `EventSource`, reconnects on close.
- Current limitation: SSE connections are per-instance. In a multi-instance deployment, events published on instance A are not sent to clients connected to instance B (see §Scaling).

**Planned WebSocket upgrade**: for the customer-facing display (FE-31) and multi-register real-time sync, SSE is insufficient. Replace with WebSocket (`ws` or Socket.io) backed by Redis pub/sub for cross-instance broadcast.

---

## 9. Background jobs § Jobs

Current state: long-running operations (dunning sweep, report pre-cache) run synchronously in the request handler. This blocks the response and fails on timeout.

**Planned (BE-34)**: introduce BullMQ (Redis-backed):

```ts
// Producer (in route handler)
await jobQueue.add("dunning_sweep", { tenantId }, { repeat: { cron: "0 2 * * *" } });

// Consumer (worker process)
jobQueue.process("dunning_sweep", async (job) => {
  await billingService.runDunningSweep(job.data.tenantId);
});
```

Jobs to migrate:
| Job | Trigger | Current |
|---|---|---|
| Dunning sweep | Daily 2am / manual button | Sync request |
| Report pre-cache | After close-of-day | Not implemented |
| Webhook delivery | EventBus publish | Not implemented |
| Core-Mark ETL sync | Scheduled (configurable) | Not implemented |
| Scheduled report email | Cron per subscription | Sync |

Job status visible via `GET /api/v1/jobs` (owner-only).

---

## 10. Webhooks § Webhooks

Design (BE-33):

```
tenant configures webhook:
  POST /api/identity/webhooks { url, events: ["order.created", "invoice.overdue"] }
  → stores in webhook_subscriptions(id, tenant_id, url, secret, events, active)

on EventBus publish("order.created", payload):
  → look up active subscriptions for this tenant+event
  → enqueue BullMQ job: POST url with body=payload, headers:
      X-FinderPOS-Event: order.created
      X-FinderPOS-Signature: sha256=HMAC(secret, body)
      X-FinderPOS-Delivery: <delivery_id>
  → retry on failure: 1s, 5s, 30s, 5m, 30m (× 5 attempts)
  → log in webhook_deliveries(id, subscription_id, event, status, response_code, attempted_at)
```

Signature verification for the recipient:
```python
import hmac, hashlib
sig = "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
assert sig == request.headers["X-FinderPOS-Signature"]
```

---

## 11. Hardware integration § Hardware

### Barcode scanner
USB HID (keyboard emulation) — scans are received as keystrokes. The terminal page listens for rapid character sequences ending in Enter in a global `keydown` listener (`web/components/terminal/BarcodeListener.tsx`). UPC/EAN-13 lookup: `GET /api/v1/catalog/barcode/:code`.

### Receipt printer
Network or USB thermal printer (ESC/POS). Current: `window.print()` with CSS `@media print` (implemented in ReceiptView.tsx). Planned: direct ESC/POS printing via WebSerial API (Chrome only) or a local print bridge service.

### Card reader
Stripe Terminal P2PE device (BBPOS WisePOS E or Stripe Reader M2). SDK: `@stripe/terminal-js`. Simulated in the UI via the 4-state `CardReaderScreen` animation (FE-15).

### Cash drawer
Triggered via receipt printer's `DLE EOT` command immediately after a cash tender print. Controlled by the print bridge service (see §Receipt printer planned).

### Customer display (FE-31)
Second screen driven by `BroadcastChannel("finder_display")`. The terminal page posts cart updates; the display page (`/display`) renders them. Intended for a customer-facing tablet on the counter or a pole display via a browser kiosk.

---

## 12. Scaling § Scaling

Current architecture handles a single-store deployment cleanly. Multi-store enterprise scale requires:

| Concern | Current | At scale |
|---|---|---|
| EventBus | In-process only | Redis Streams (durable, cross-instance) |
| SSE | Per-instance | Redis pub/sub fan-out to all instances |
| Rate limiting | Redis fixed-window (already done) | No change |
| DB connections | pg pool per instance | PgBouncer connection pooler |
| Session state | Stateless JWT (already done) | No change |
| Tenant routing | Single DB, RLS | Shard by tenant at pg level for large tenants |
| Job queue | Synchronous (move to BullMQ) | BullMQ with separate worker instances |

**Deployment**: Vercel (frontend) + Railway/Render/Fly.io (backend Express) + Neon (Postgres serverless) + Upstash (Redis serverless).

---

## 13. Security checklist (production go-live)

- [ ] Set `METRICS_TOKEN` env var — protects `/metrics` endpoint from public access
- [ ] Set `JWT_SECRET` to a 256-bit random value (not a memorable string)
- [ ] Set `ALLOWED_ORIGINS` to the exact Vercel deployment URL (no wildcard)
- [ ] Enable `HTTPS` termination at the load balancer / Vercel Edge
- [ ] Move refresh token to `httpOnly; Secure` cookie (BE-31)
- [ ] Configure Stripe live keys (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`)
- [ ] Set `REDIS_URL` for distributed rate limiting (already implemented)
- [ ] Enable Neon's connection pooling (PgBouncer) for serverless scale
- [ ] Set `NODE_ENV=production` (disables dev-only endpoints like `/register`)
- [ ] Review `NEXT_PUBLIC_API_BASE_URL` — must not include a trailing slash
- [ ] Enable Vercel's DDoS protection and WAF on the frontend domain
- [ ] Rotate all seed credentials from `db/seeds/0001_demo.sql`
- [ ] Confirm RLS policies are active (`SELECT * FROM pg_policies` on the DB)
- [ ] Set up Prometheus scraper with `METRICS_TOKEN` bearer auth
- [ ] Configure structured logging (pino/winston) to ship to Datadog/Logtail

---

## 14. Data model quick reference

Key tables and their tenant-scoping patterns. All tenant tables: `id TEXT PK, tenant_id TEXT NOT NULL, created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL`.

| Domain | Core tables |
|---|---|
| Identity | tenants, users, refresh_tokens, api_keys, mfa_secrets, audit_log |
| Catalog | products, categories, product_categories |
| Inventory | inventory_levels, inventory_movements, cycle_count_sessions, cycle_count_lines, serial_numbers |
| Orders | orders, order_lines, order_events |
| Customers | customers, customer_addresses, customer_contacts, customer_groups, customer_notes |
| Sales | quotations, quotation_lines, sales_orders, sales_order_lines, sales_reps |
| Purchasing | purchase_orders, po_lines, purchasing_returns |
| Billing | bills, invoices, bill_payments, invoice_payments |
| Payments | payments, idempotency_keys |
| Accounting | accounts, journal_entries, batch_deposits |
| Loyalty | loyalty_tiers, loyalty_members, loyalty_rewards, loyalty_redemptions |
| Workforce | employees, shifts, time_off_requests |
| Settings | feature_flags, shipping_methods, payment_terms, payment_modes, tax_rates, receipt_templates, outlets, registers |
| Compliance | (product columns: tobacco_type, flavored, menthol, restricted_states) |
| Notifications | notifications |
| Webhooks | webhook_subscriptions, webhook_deliveries (planned BE-33) |
