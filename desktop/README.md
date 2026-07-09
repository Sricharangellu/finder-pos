# Ascend — Desktop App

A minimal desktop wrapper around the live Ascend web app
(`https://finder-pos-frontend.vercel.app`). It's a standard Electron app —
opening it gives you the same product in its own window (no browser tabs/UI
chrome), with your data stored on the live backend exactly as it is on the
web.

## Install (macOS)

1. Build it (if not already built):
   ```bash
   cd desktop
   npm install
   npm run dist:mac
   ```
2. Open `desktop/release/Ascend-1.0.0-arm64.dmg`.
3. Drag **Ascend** into Applications.
4. Launch it. First run: macOS Gatekeeper will warn the app is from an
   unidentified developer (it isn't code-signed/notarized). Right-click the
   app → **Open** to bypass this once.
5. Log in with `owner@finder-pos.dev` / `FinderDemo!2026` (or your own
   account).

## Other platforms

```bash
npm run dist:win     # Windows installer (.exe via NSIS)
npm run dist:linux   # Linux AppImage
```

Cross-building for Windows/Linux from macOS may require additional tooling
(Wine for Windows). Easiest is to run the relevant `dist:*` command on a
machine of that OS.

## Configuration

By default the app points at the production deployment. To point it at a
different URL (e.g. a preview deploy or local dev server), set
`FINDER_APP_URL` before launching from source:

```bash
FINDER_APP_URL=http://localhost:3000 npm start
```

(Packaged builds always use the production URL baked into `main.js`.)

## Staying up to date

This app always loads the live production site, and production now
auto-deploys on every push to `master` (see
`.github/workflows/deploy-prod.yml` — runs typecheck/tests, then
`scripts/deploy.sh both` with `DEPLOY_ENV=prod`). So whenever the scheduled
dev-cycle agents (or anyone) push to `master`, the live site updates within
a few minutes.

The desktop app itself:
- Reloads automatically when it regains focus, if it's been in the
  background for more than 10 minutes (avoids interrupting an active
  checkout).
- Reloads every 6 hours in the background as a safety net.
- You can always force a manual refresh: **Ascend menu → Reload**
  (or Cmd+R).

## Notes

- This is a thin wrapper, not an offline app — it requires internet access
  to reach the live backend/frontend on Vercel.
- Code signing/notarization isn't set up, so unsigned builds will trigger
  Gatekeeper warnings on macOS and SmartScreen warnings on Windows. For
  distribution beyond your own machine, set up an Apple Developer ID /
  Windows code-signing certificate in `electron-builder`.
