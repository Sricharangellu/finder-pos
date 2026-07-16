# Audit — Variant category inheritance + naming (PRD #1, #8)

Date: 2026-07-13T03:19:42Z
Session: Claude session A (Opus 4.8, Matrix Builder PRD backend slices)
Status label: **Built and verified**

Two small, fully-verifiable backend rules from the PRD, in the `catalog` module only.

## Changes — `src/modules/catalog/service.ts`

- **#8 — naming without hyphen.** `generateVariants` now names variants
  `` `${master.name} ${label}` `` (was `` `${master.name} - ${label}` ``), so a variant
  reads "Coca-Cola 330ml", not "Coca-Cola - 330ml".
- **#1 — category inheritance (a child always shares its master's category):**
  - `assignVariants` sets the child's `category` to the master's when linking.
  - `update()` coerces the category of any product that is (or is becoming) a variant to
    its master's category — a child's category cannot be set independently (an attempt is
    silently overridden, not applied).
  - Changing a **master's** category cascades to all its child variants (they inherit it);
    children have no children, so the recursion terminates at one level, and each cascaded
    child re-resolves its tax class from the new category.

No schema change, no web change, no new dependencies.

## Verification

- PASS: `npm run typecheck`.
- PASS: `catalog.test.ts` in isolation — **35/35** (4 new):
  - generated variant name has no hyphen (#8);
  - assigning a product as a variant inherits the master's category (#1);
  - a child variant's category cannot be changed independently — coerced back (#1);
  - changing a master's category cascades to all its variants (#1).
- PASS: `npm test` — **401/401** (+4); `npm run smoke` — 20/20; `npm run hygiene` — 926
  files. `update()` is a core path; full suite confirms no regression.

## Notes
- Cascade + child update run as separate statements (matching the existing non-transactional
  `update`); a mid-cascade failure could leave some children un-updated. Rare; a follow-up
  could wrap the master+children update in one transaction.
- Remaining Matrix Builder PRD slices (sort/reorder #3, locations/promo bulk #4, storefront
  grouping #9, virtualization #10) still open — see the matrix-builder-v1 audit.
