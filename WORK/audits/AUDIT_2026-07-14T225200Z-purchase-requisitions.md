# Audit — Purchase Requisitions (procurement PRD module 1 / ACPA E2)

Date: 2026-07-14T225200Z
Session: Claude session A (Opus 4.8)
Status label: **Built and verified** (backend; UI is a follow-up slice)

Departments request inventory; a requisition moves draft → submitted →
approved/rejected → converted. Conversion creates a real PO through
createOrder, so PO approval tiers still apply downstream — the two approval
stages compose. Purchasing module only.

## Changes
- Tables: purchase_requisitions (+lines, FK CASCADE), PR-xxxxx numbers via the
  race-free document_counters, priority/department/required_date/notes,
  decision snapshot (decided_by/at/note), po_id link.
- Service: create/update (draft-only, full line replacement), submit, approve,
  reject (manager), convert (manager; approved-only; links po_id; blocks
  double-convert), cursor-paginated list with status filter.
- Routes: POST/GET/PATCH /purchasing/requisitions(+/:id), POST :id/submit |
  approve | reject | convert. Decisions + conversion manager-gated.

## Verification
- purchasing 19/19 in isolation (+3): full lifecycle incl. PR numbering, draft
  edit allowed / post-submit edit 409, decided_by recorded, converted PO
  carries qty 20 @ 300c, double-convert 409; reject keeps note + blocks
  convert; draft convert 409; cashier approve 403; status filter + cursor walk.
- Full suite 458/458, smoke 20/20, hygiene clean, typecheck clean.

## Notes / next (E2)
- GRN as first-class document (accepted/rejected/damaged splits) → three-way
  match → GRNI refinement. Requisition UI (purchasing page tab) follows.
- Approval-history unification with po_approvals is the E4 workflow story.
