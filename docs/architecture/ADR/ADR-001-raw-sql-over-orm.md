# ADR-001: Raw SQL with named parameters, not Prisma/ORM

Date: 2026-07-13 · Status: Accepted

**Context:** Multiple charter templates assume Prisma. The codebase uses raw
SQL with named params (@param) across 52 modules and 100+ migrations.
**Decision:** Keep raw SQL. It is the incumbent, it is fast, explicit, and
already enforces tenant scoping per query; an ORM migration is churn with no
measurable benefit (CTO_CHARTER: never replace architecture without evidence).
**Consequences:** Query safety relies on the named-param layer + whitelisted
SQL fragments; reviews check for interpolation. Revisit only if type-safety
gaps cause real defects.
