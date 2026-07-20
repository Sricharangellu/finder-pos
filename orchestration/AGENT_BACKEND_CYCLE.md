# Superseded (2026-07-20) — kept at this path for external schedulers

**This file's original scheduled-agent-cycle procedure is retired.** It
described a single-branch (`master`-only), pre-3-tier-pipeline workflow that
predates the current process. Kept at this exact path (not moved/deleted)
because `orchestration/README.md` notes external scheduled routines may
reference it by path directly.

**Current process:**
- Orchestration protocol: `docs/architecture/ORCHESTRATION.md`
- Autonomous loop program: `WORK/LOOP_PROTOCOL.md` (re-read before resuming
  any loop iteration — never work from memory)
- Live state: `WORK/LOOP_STATE.md`, `WORK/LOCK.md`
- Design principles: `docs/architecture/DESIGN_PRINCIPLES.md`
- Entry point for all agents: `AGENTS.md` (repo root)

The historical content of this file is archived at
`orchestration/_archive/AGENT_BACKEND_CYCLE.md` if needed for reference.
