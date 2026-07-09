# Baord State Lite

Baord State Lite is a mobile-first Magic: The Gathering companion app for tracking a personal battlefield without becoming a full digital battlefield simulator.

The app tracks your life total, player counters, relevant battlefield objects, generic placeholders, counters, statuses, tokens, selected real-card abilities, and supported trigger/replacement chains. Cards added through Scryfall are treated as active tracked permanents, so users should add only cards whose abilities they want automated. Other permanents should be represented by generic placeholders. If a real card is already on the field but its abilities should be ignored temporarily, long-press it and choose Stop Tracking Card.

## Current Automated Card Logic

- Anim Pakal, Thousandth Moon initiating attack trigger.
- Cathars' Crusade creature-entered trigger.
- Doubling Season token and counter replacement effects.
- Rampaging Baloths landfall token creation.
- Soul Warden and Essence Warden creature-entered life gain.
- Impact Tremors opponent damage summary.
- User-defined custom effects for activate-field actions.

Unsupported cards can still be tracked as permanents, receive counters, count toward totals, be depowered, be transformed, and be removed, but their unsupported Oracle text is not guessed.

## Tracking Controls

Stop Tracking Card is a user-controlled automation preference, separate from Depower. A not-tracked card stays visible, keeps its current counters and statuses, continues contributing to relevant totals, and remains an eligible recipient for effects from tracked cards. Its own supported abilities, replacement effects, static effects, background watcher responses, and attached card automation are ignored until Resume Tracking Card is used.

## Stack

- React, TypeScript, and Vite
- Zustand for app state
- Dexie / IndexedDB for local field and Scryfall cache persistence
- Scryfall API search and cached card data/images
- Vite PWA service worker and manifest
- Vitest and React Testing Library
- Playwright e2e tests
- oxlint and Prettier
- GitHub Actions CI and GitHub Pages deployment workflow

## Development

```bash
npm install
npm run dev
```

## Quality Commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run e2e
npm run test:visual
```

Update the committed visual baselines after intentional UI changes:

```bash
npm run test:visual:update
```

## Reference Visual Fixture

For local and test-only visual audits, open:

```text
http://127.0.0.1:5173/?fixture=reference
```

The fixture loads the reference battlefield with life 40, the specified counters,
tracked cards, attachments, resource chips, and bottom controls. It is gated to
local/dev hosts and is not available as a normal field on the GitHub Pages
deployment.

The current 430px fixture screenshot is saved at
`docs/screenshots/reference-fixture-430.png`, with a side-by-side comparison at
`docs/screenshots/reference-comparison-430.png`.

## Deployment

The Vite config uses `/boardstatelite/` as the base path in GitHub Actions and `/` locally. The `Deploy GitHub Pages` workflow builds `dist` and publishes it through GitHub Pages.

The app is installable as a PWA and caches the app shell, Scryfall card API responses, and previously viewed Scryfall card images. Offline search gracefully falls back to cached card data.

## Data Safety

- Scryfall does not require an API key.
- Local field data is saved in IndexedDB.
- Import validates the expected schema and sanitizes labels.
- Imported data is never executed as code.
- Export creates a JSON backup of the current local field.

## Scryfall Attribution

Card names, Oracle text, print data, and images are provided by Scryfall. Baord State Lite is unofficial Fan Content and is not produced, endorsed, supported, or affiliated with Wizards of the Coast.
