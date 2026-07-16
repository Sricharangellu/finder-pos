# ADR-004: Configurable workflows ship default-off

Date: 2026-07-13 · Status: Accepted

**Context:** PO approval tiers could have broken every existing PO flow,
test, and deployed tenant if mandatory.
**Decision:** Workflow gates (approval tiers, and future workflow/rules
features) ship disabled-by-default; enabling is an explicit per-tenant act.
**Consequences:** Zero regression on ship; enterprise features are opt-in;
tests cover both modes. Pattern applies to future engine work (Levels 3–4).
