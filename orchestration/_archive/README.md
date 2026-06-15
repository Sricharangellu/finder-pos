# Archived orchestration docs

These documents are superseded snapshots, kept for history/reference. Nothing
in the active orchestration flow (`ROADMAP.md`, `AGENT_BACKEND_CYCLE.md`,
`AGENT_FRONTEND_CYCLE.md`, `orchestration/gaps/*`) depends on them.

- `00_EXECUTION_PROMPT_BOOK.md`, `AGENT_BACKEND.md`, `AGENT_DATABASE.md`,
  `AGENT_FRONTEND.md` — the original three-parallel-agent (database/backend/
  frontend on separate branches) execution model. Superseded by the
  two-scheduled-agent, `master`-only model in `AGENT_BACKEND_CYCLE.md` /
  `AGENT_FRONTEND_CYCLE.md`.
- `BACKEND_HANDOFF.md` — Cycle-3 git-coordination note for the
  `backend-cycle3` branch. Resolved (see ROADMAP `PROD-1`); branch is frozen.
- `CONTINUE_IN_ANTIGRAVITY.md` — onboarding for a one-off session in Google
  Antigravity, referencing the old branch/agent assignments above.
- `DB_REVIEW.md`, `SECURITY_AUDIT.md` — one-time audit passes (2026-06-13);
  all findings were fixed in that pass. Any items still open were carried
  forward into `ROADMAP.md` (DB-1, DB-2).
- `ENVIRONMENTS.md` — described a `dev`/`testing`/`prod` branch-promotion
  model. Superseded: the project is now `master`-only, with
  `.github/workflows/deploy-prod.yml` auto-deploying to production on every
  push to `master` (see `PROJECT_STATUS.md`).
