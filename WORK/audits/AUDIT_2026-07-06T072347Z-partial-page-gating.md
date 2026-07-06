# Audit — NEXT_PUBLIC_SHOW_PARTIAL_PAGES nav gating

Status label: **built_verified**

## What
Implemented the operating prompt's "Mock And Partial Rules" nav requirement
(previously zero code): mock-backed / preview pages stay hidden from navigation
unless `NEXT_PUBLIC_SHOW_PARTIAL_PAGES=true`.

Marked partial in `web/components/EnterpriseShell.tsx` (from the wiring matrix):
- Pricing (`/pricing`) — Pricing Engine, UI-only preview
- Promotions (`/catalog/promotions`) — Promotion Engine, real gap (no backend)
- Warehouse (`/warehouse`) — WMS, UI-only preview
- Document Center (`/documents`) — Document Center, UI-only

Not gated here (correct): Golf is already business-pack-gated for retail tenants;
permission-requests now has a real backend (session A). Pages stay deep-linkable
and developable — only the nav entry is hidden by default.

Extracted the gate as a pure exported `isNavChildVisible(child, {showPartial,
routeEnabled, hasFeature})` — the four-layer check (partial → tenant route →
user feature) — unit-tested without rendering the shell.

## Verified
- New `web/tests/navPartialGate.test.ts` 4/4: partial hidden when flag off, shown
  when on, real pages never hidden, tenant/feature gates still apply.
- web tsc 0, full Vitest 100/100, lint 4 pre-existing warnings, mock-off build green.

## Follow-ups (route-alignment queue, not done here)
- `auth/*` REAL DRIFT: SecuritySection calls `/api/v1/auth/backup-codes` +
  `/api/v1/auth/login`; auth is under `/api/identity/*` → 404 on real backend.
- `promotions` backend build (Promotion Engine) is the real gap behind the hidden page.
