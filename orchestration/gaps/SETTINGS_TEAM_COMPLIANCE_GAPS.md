# Settings / Team / Compliance — gap notes

**Source:** the 2026-06-15 "Complete Enterprise Architecture Assessment".
Inspiration only — see `ROADMAP.md`'s framing note. This file covers the
assessment's Modules 11–12 (Settings, Employee/RBAC) plus its cross-cutting
"compliance" findings (Step 7).

Updated: 2026-06-15.

## Where Finder's settings/team/RBAC stand today

- Roles: `owner` > `manager` > `cashier` (`src/identity/types.ts`),
  enforced via `requireRole()` (`src/gateway/auth.ts`). BE-1 (in progress)
  extends `requireRole("manager")` coverage to remaining sensitive
  mutations.
- `src/modules/settings`: business profile, feature flags, shipping
  methods, payment terms/modes, tax rates.
- `src/modules/outlets`: stores/registers (multi-store).
- `src/modules/team`: directory (read-only today).
- `audit_log` (identity module) already records every mutating request
  (actor, action, entity, before/after, ts) — the assessment's "Audit Trail
  report is the only mechanism" undersells this: it's an append-only table,
  not just a report.

## Curated gaps (assessment → verdict for Finder)

| Gap | Verdict |
|---|---|
| RBAC granularity beyond owner/manager/cashier | **BE-1 (in progress) is the right-sized answer** — three roles with a strict hierarchy covers Finder's target tenants (small/mid wholesale). A full permission-matrix engine (per-route, per-role, configurable) is enterprise-RBAC scope creep; revisit only if a tenant explicitly needs a 4th role. |
| Approval workflows / approval chains | **Already exist where it matters**: SO approval (`sales-orders/:id/approve`), batch deposit approve/reject (`accounting/deposits/:id/approve`). A generic approval-chain *engine* for arbitrary entities is out of scope — add approval gates to specific workflows as needed, following the existing pattern. |
| Age verification enforcement (tobacco/alcohol) | **Worth a minimal, generic version**: add an optional `age_restricted` boolean to `products` (catalog) and, at checkout (`POST /api/v1/orders` or sales-order creation), if any line item is age-restricted, require a `customerDobVerified: true` flag in the request (the frontend collects it from the cashier). This is a generic compliance primitive — not tobacco/MSA-specific fields. |
| MSA / regulatory filing automation, cigarette/tobacco schedule reports | **Out of scope** — Finder is explicitly not chasing tobacco-distributor parity (per `ERP_BENCHMARK.md`'s framing); the age-restriction flag above covers the generic case without the regulatory-reporting machinery. |
| Store opening/closing workflow, safe drops, till audits, cash variance | **Worth a minimal version**: a `register_sessions` concept (open with starting cash float, close with counted cash, variance = counted − (float + cash sales)) under a new or existing module (likely `outlets`, since registers live there). This is the most concrete "operations" gap and doesn't depend on anything else. |
| Segregation of duties / SOX-style controls, immutable audit log guarantees | **Audit log already append-only** at the application layer; DB-level immutability (e.g. revoke UPDATE/DELETE grants on `audit_log`) is a `DB-1`-adjacent hardening item — fold into `DB-1` (Postgres RLS) rather than a new item. |
| API key management, webhook config UI, SSO/SAML, multi-company | **Out of scope** — `webhooks` module exists for outbound notifications already; SSO/SAML and multi-company are large auth/org-model changes with no current tenant request. |

## What this turns into on the roadmap

- **BE-16** — Age-restriction compliance flag: `products.age_restricted`
  (boolean, default false); `POST /api/v1/sales/sales-orders` and
  `POST /api/v1/orders` reject (400) if any line is age-restricted and the
  request lacks `ageVerified: true`. Manager override not needed — this is
  a cashier-workflow checkbox, not a permission gate.
- **BE-17** — Register sessions: `outlets` gains
  `POST /registers/:id/open` (starting float), `POST /registers/:id/close`
  (counted cash, computes variance against float + cash-tender sales since
  open). Read endpoint for session history.
- **FE-12** — Checkout UI: age-verification checkbox on the cart when any
  line is `age_restricted` (consumes BE-16); register open/close screen
  with the running cash-variance summary (consumes BE-17).

Everything else above is explicitly **not** on the roadmap unless a future
need justifies it.
