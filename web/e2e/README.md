# Ascend — E2E Tests (Playwright)

Three golden paths: **login**, **POS checkout**, **inventory receive / invoice pay**.

## Local setup

1. Start the backend:
   ```bash
   # From finder-pos/ root
   DATABASE_URL=postgresql://... JWT_SECRET=... node dist/src/server.js
   # or in dev: tsx src/server.ts
   ```

2. Start the frontend in E2E mode (no MSW, real API calls):
   ```bash
   cd web
   NEXT_PUBLIC_E2E_MODE=true NEXT_PUBLIC_API_BASE_URL=http://localhost:3001 npm run dev
   ```

3. Run E2E tests:
   ```bash
   cd web
   npx playwright test
   ```

4. Run with UI (visual debugger):
   ```bash
   npx playwright test --ui
   ```

## Environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PLAYWRIGHT_BASE_URL` | `http://localhost:3000` | Frontend URL |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:3001` | Backend URL |
| `E2E_EMAIL` | `owner@demo.com` | Login email for setup |
| `E2E_PASSWORD` | `demo1234` | Login password for setup |

## CI

The E2E job in `.github/workflows/ci.yml` runs after `backend` and `frontend` jobs pass. It:
1. Builds the backend (`tsc`)
2. Seeds the demo data
3. Starts `node dist/src/server.js` on port 3001
4. Builds and starts `next start` on port 3000
5. Runs `npx playwright test --reporter=github`

Only runs on push to `master` or `staging` (not on PRs to avoid flakiness on external PRs).
