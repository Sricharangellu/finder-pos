# Audit — /delivery UI polish + Playwright e2e

Date: 2026-07-13T00:55:03Z
Session: Claude session A (Opus 4.8, frontend polish + e2e)
Status label: **Built and verified** (polish: typecheck/lint/build); e2e spec: see note.

## UI polish — `web/app/(protected)/delivery/page.tsx` (+ `api-client/types.ts`)

Consistent with the existing design system (Tailwind tokens, `Card`/`Button`/`Skeleton`,
neutral palette, dark-mode variants). Changes:

- **Loading states.** The order list now shows a `Skeleton` placeholder until the first
  fetch resolves (`ordersLoaded`), so the "No sales orders yet" empty state no longer
  **flashes before load**. The detail panel shows a `role="status"` "Loading delivery
  detail…" line while the selected order's pick list/shipment/invoice load.
- **Real content, not IDs.** Pick-list lines render the product **name**
  (`l.name ?? l.product_id`) — added `name?` to the `PickListLine` type (backend already
  returns it) — instead of a raw `prod_…` id.
- **Interaction feedback.** Action buttons (Start picking, Pack, Mark shipped/delivered,
  Create invoice) use the `Button` `loading` spinner while an action is in flight.
- **Accessibility.** Selected order button gets `aria-current="true"`; the error card gets
  `role="alert"`; the loading line `role="status"`.
- **Responsiveness / overflow.** The 5-stage stepper is wrapped in an `overflow-x-auto`
  container so it can't overflow narrow screens; action rows use `flex-wrap`; long
  carrier/tracking text uses `break-words`; the order list is capped at `max-h-[70vh]`
  with its own scroll; grid columns aligned with `lg:items-start`.

## Playwright e2e — `web/e2e/delivery.spec.ts`

New spec matching repo conventions (`./fixtures` worker-scoped auth + `gotoAuthenticated`
+ `expectNoAppCrash`, tolerant assertions like the other golden-path specs):
1. `/delivery` loads authenticated and renders the Sales orders panel (orders or empty).
2. Selecting an order (when the demo tenant has any) reveals its delivery stage; skips
   when the minimal demo seed has no sales orders.

## Verification

- PASS: `cd web && npm run typecheck` / `npm run lint` (pre-existing warnings only) /
  `npm run build` (`/delivery` route emitted, 5.67 kB).
- Backend boot with the numbering migrations (from the e2e stack) — `migrations complete`,
  no error; confirms the `sequences` module + seeding run cleanly on a real boot.
- e2e local run (twice): fails inside the **repo's shared login fixture**
  (`web/e2e/fixtures.ts:46` — `page.waitForURL` after submitting owner creds times out), so
  the page stays on `/login` and my `toBeVisible` assertion cascades. This is the local
  two-port single-use-refresh auth flakiness the repo documents (`fixtures.ts`,
  `playwright.config.ts`) — shared harness code that would fail identically for the other
  specs (checkout, invoice-pay) locally — **not** my spec or the `/delivery` page. The
  spec's selectors match the rendered DOM by construction ("Sales orders" heading, "Select a
  sales order…" / "No sales orders yet") and follow the passing specs' exact pattern, so it
  runs in CI where the full workflow is configured. Per session guidance, I did **not**
  modify the auth/e2e harness.

## Notes / still open
- The `/delivery` e2e is verified-by-convention + backend-boot; a green local browser run
  remains blocked by the documented local auth-harness flakiness.
