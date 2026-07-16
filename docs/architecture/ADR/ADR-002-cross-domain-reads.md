# ADR-002: Writes never cross module boundaries; SQL reads may

Date: 2026-07-13 · Status: Accepted

**Context:** "No direct database access across domains" (org charter) vs.
existing pragmatic joins (billing⋈purchase_orders, availability⋈sales_order_lines).
**Decision:** Writes are strictly module-owned. Cross-domain SQL **reads** are
accepted monolith pragmatism and are the documented seams that become read
models/APIs if a domain is ever extracted.
**Consequences:** Read-joins must be tenant-scoped and documented; no module
imports another module's service code.
