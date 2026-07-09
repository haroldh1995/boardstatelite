# Live Deployment Checklist

Use this checklist before claiming BoardState Lite is deployed and usable from the web.

## Local Install

1. Run `npm install` or `npm ci`.
2. Confirm Node 24-compatible tooling is available.
3. Confirm no unexpected local changes are present before starting release work.

## Local Development Server

1. Run `npm run dev`.
2. Open `http://127.0.0.1:5173/` or the Vite-provided local URL.
3. Confirm the browser title and header show `Baord State Lite`.
4. Confirm the first-launch warning appears.
5. Continue to the field and verify the life tracker, relevant totals, battlefield, and bottom controls render.

## Production Build

1. Run `npm run typecheck`.
2. Run `npm run lint`.
3. Run `npm test`.
4. Run `npm run build`.
5. Confirm `dist/index.html`, hashed assets, `manifest.webmanifest`, and `sw.js` are generated.

## PWA Behavior

1. Serve the production build with `npm run preview -- --host 127.0.0.1`.
2. Open `http://127.0.0.1:4173/`.
3. Confirm the manifest name is `Baord State Lite`.
4. Confirm the app shell loads after service worker registration.
5. Toggle offline mode after first load and confirm the app shell still renders.
6. Confirm cached Scryfall data is used when available and offline messaging is graceful.

## GitHub Deployment

1. Push to `main`.
2. Verify `.github/workflows/ci.yml` completes successfully.
3. Verify `.github/workflows/deploy-pages.yml` completes successfully.
4. Confirm the Pages artifact deploys from `dist`.
5. Confirm the Vite base path is `/boardstatelite/` in GitHub Actions.

## Live App URL

Production URL:

```text
https://haroldh1995.github.io/boardstatelite/
```

Live checks:

1. Open the production URL.
2. Confirm the app is not blank.
3. Confirm no framework error overlay appears.
4. Confirm the browser console has no app-breaking errors.
5. Confirm the startup warning appears on a fresh profile.
6. Confirm the life tracker is visible and usable.
7. Confirm ACTIVATE FIELD is visible.
8. Confirm Add opens.
9. Confirm Scryfall search can find a real card when online.
10. Confirm a real card can be added and rendered with a real Scryfall image.
11. Confirm a generic placeholder can be added.
12. Confirm long-press menu opens.
13. Confirm outside-tap popup cancellation closes without applying changes.
14. Confirm a field save reloads after page refresh.
15. Confirm there are no false claims of Hub, shared-session, sync, Advanced Mode, profile, friend, tournament, or notification integration.

## Viewports

Verify at minimum:

- Mobile width around 390px or 430px.
- Desktop width around 1280px.

For visual changes, also run:

```bash
npm run test:visual
```

## Current Lite Flow

The live app must still behave as Lite:

1. Local-only startup.
2. Personal life tracking.
3. Quick field setup.
4. Scryfall-backed tracked cards.
5. Generic placeholders for untracked objects.
6. Counter/status management.
7. One-button ACTIVATE FIELD local helper automation.
8. Undo/redo and local persistence.
