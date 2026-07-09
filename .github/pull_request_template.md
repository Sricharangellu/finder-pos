<!-- Ascend PR checklist — aligned with WORK/RULES.md. Delete lines that don't apply. -->

## What & why

<!-- One or two sentences: the queue item / defect, and the user-visible effect. -->

## Queue / lock

- WORK/LOCK.md claim: <!-- item name; link the WORK/AUDIT_*.md if one was produced -->

## Status label (required — RULES.md vocabulary)

<!-- Built and verified / Built but not verified / UI-only / Mocked / Partial / Planned -->

## Gates run locally (paste real results, including failures)

- [ ] `npm run typecheck` (backend)
- [ ] `npm test` (backend)
- [ ] `npm run smoke` — required for any backend change
- [ ] `cd web && npm run typecheck && npm run lint && npm test && npm run build`
- [ ] e2e (if the change touches a golden path)

## Domain rules respected

- [ ] tenant-scoped queries / RBAC checked / integer cents / immutable inventory movements / no production mock dependency (strike out non-applicable)

## Honest notes

<!-- What is NOT covered by this change; known gaps; follow-ups filed in WORK/WORK_STATE.md -->
