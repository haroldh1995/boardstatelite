# Current Lite Architecture Audit

Audit date: 2026-07-09.

This audit describes the current BoardState Lite implementation before ecosystem integration work. The app is displayed as **Baord State Lite** and is deployed from `main` to GitHub Pages at `/boardstatelite/`.

## Repository And App Entry Points

- `index.html` defines the browser shell, metadata, title, and root node.
- `src/main.tsx` mounts React with `StrictMode`.
- `src/App.tsx` initializes the store, registers the PWA update prompt, and renders the core Lite surface.
- `vite.config.ts` configures Vite, React, Vitest, PWA generation, GitHub Pages base path, Scryfall runtime caching, and manifest metadata.

## Framework And Build System

- Framework: React 19 with TypeScript.
- Build tool: Vite 8.
- Type checking: `tsc -b`.
- Linting: `oxlint`.
- Formatting: Prettier.
- Routing: no React Router. The app is a single-page surface. The only route-like behavior is a local/test query fixture at `?fixture=reference`.
- Deployment branch: `main`.
- Production base path: `/boardstatelite/` when `GITHUB_ACTIONS` is set, `/` locally.

## Component Organization

- `src/App.tsx`: app shell, PWA update toast, main layout.
- `src/components/LifeTracker.tsx`: personal life, player counters, quick increments, undo/redo exposure.
- `src/components/TotalsStrip.tsx`: relevant totals and exact-total editing entry point.
- `src/components/Battlefield.tsx`: organized sections, sorting, collapse state, drag reorder, attachments, resource chips.
- `src/components/PermanentCard.tsx`: card visuals, gestures, overlays, support indicators, Not Tracked and depower visuals.
- `src/components/BottomDock.tsx`: Add, ACTIVATE FIELD, Transform All hold behavior, Tools.
- `src/components/ModalRoot.tsx`: shared modal/sheet system, startup warning, add/search, preview, counters, removal, tracking confirmation, transform, settings, exact totals, summaries, import/export.
- `src/components/ScryfallSearch.tsx`: Scryfall search UI, preview, printing selection, offline note.

## Domain And State Organization

- `src/domain/types.ts`: canonical TypeScript types for field, groups, counters, events, settings, custom effects, history, modals, and totals.
- `src/domain/cards.ts`: card/group construction, characteristic parsing, support status detection, power/toughness recalculation, stack keys, split/merge helpers.
- `src/domain/field.ts`: default field/player/settings/watchers, total calculation, visible totals, import sanitization, field normalization.
- `src/domain/engine.ts`: Lite local helper resolver for Activate Field, counters, landfall, tracking state, removal, generic replacement, transform, restore, and life changes.
- `src/state/useFieldStore.ts`: Zustand store, local actions, undo/redo, modal state, persistence commits.
- `src/services/db.ts`: Dexie persistence and localStorage fallback.
- `src/services/scryfall.ts`: Scryfall API mapping, search, card fetch, pending request de-duplication, cache calls.

## Styling And Visual System

- Styling is plain CSS in `src/index.css` and `src/App.css`.
- The current UI uses a dark fantasy visual system, fixed wallpaper, transparent battlefield surfaces, luminous section borders, real Scryfall card images, card overlays, bottom dock buttons, and modal sheets.
- Animations are CSS transitions/keyframes plus gesture timers in components. Reduced motion is handled through CSS media query and Playwright visual tests.

## PWA And Service Worker Setup

- `vite-plugin-pwa` generates the service worker and `manifest.webmanifest`.
- Register type is prompt-based through `useRegisterSW` in `App.tsx`.
- Manifest name and short name are `Baord State Lite`.
- App shell assets, wallpaper images, icons, CSS, JS, and HTML are precached.
- Runtime caching:
  - `https://api.scryfall.com/cards/` uses NetworkFirst in `scryfall-card-api`.
  - `https://cards.scryfall.io/` uses CacheFirst in `scryfall-card-images`.
- Updates display a prompt instead of silently disrupting active games.

## Persistence

Persistence is local-first:

- IndexedDB database name: `baord-state-lite`.
- Dexie version: `1`.
- Tables:
  - `fields`: `id, updatedAt`.
  - `searchCache`: `query, cachedAt`.
  - `cardCache`: `cardId, cachedAt`.
- localStorage keys:
  - `baord-state-lite:last-field-id`.
  - `baord-state-lite:last-field-fallback`.
  - `baord-state-lite:search:<query>` fallback.
  - `baord-state-lite:card:<cardId>` fallback.
- Field schema version: `schemaVersion: 1`.
- Export shape: JSON serialization of the current `FieldState`.
- Import validation: `sanitizeImportedField` requires schema version 1, groups array, and player data; it sanitizes key text/numeric values and preserves unknown root/group payloads through spreads.
- Current migration posture: non-destructive defaulting only. Missing `trackingEnabled` defaults to `true`.

## Current Lite Gameplay Model

- The app tracks only the user's personal life total and personal battlefield-relevant state.
- Startup warning reminds users that real Scryfall cards are treated as active tracked permanents.
- Relevant totals are derived from group characteristics plus pinned totals.
- Battlefield sections are creatures, other permanents, attachments, and generics/tokens.
- Generic placeholders have no card abilities and can later be replaced through triple-tap Scryfall search.
- Real cards display support status: fully automated, partially automated, quantity tracking only, or unsupported.
- Stop Tracking / Resume Tracking is an app preference that excludes a real card as an automation source while preserving it as a battlefield object and effect recipient.
- Depower is separate from Not Tracked and represents in-game ability disabling.
- Counters, statuses, base power/toughness, tapped state, attachments, stack quantity, and transformed state are stored on `PermanentGroup`.
- Token stacks and generic stacks use a normalized group model and stack keys; groups split when only part of a stack changes and merge when complete stack state matches.
- ACTIVATE FIELD resolves the current Lite-supported initiating effects and generated triggers as one undoable transaction.
- Hold ACTIVATE FIELD opens Transform All Creatures.
- Land total increases can resolve landfall background watcher behavior when the user chooses a game-action mode.
- Undo and redo store full `FieldState` snapshots with a limit of 80 entries.
- Tutorial behavior is currently limited to the startup warning and "Learn How Tracking Works" copy. There is no separate tutorial sprite engine in this repository.

## Current State Ownership Matrix

| State                                             | Owner                                                                                 | Persistence/export                        | Derived/recomputed                 | Future serialization risk                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ---------------------------------- | ---------------------------------------------------------------- |
| Life total                                        | `field.player.life`                                                                   | Persisted/exported                        | Direct                             | Low                                                              |
| Starting life                                     | `field.player.startingLife` and settings                                              | Persisted/exported                        | Direct                             | Low                                                              |
| Poison, energy, experience, rad, commander damage | `field.player.counters`                                                               | Persisted/exported                        | Direct                             | Low                                                              |
| Custom player counters                            | `field.player.counters.custom`                                                        | Persisted/exported                        | Direct                             | Medium: needs canonical naming                                   |
| Player statuses                                   | `field.player.statuses`                                                               | Persisted/exported                        | Direct                             | Low                                                              |
| Permanents and tokens                             | `field.groups`                                                                        | Persisted/exported                        | Direct with normalized stack keys  | Medium: object identity and quantity stacks need adapter mapping |
| Generic placeholders                              | `field.groups` where `isGeneric`                                                      | Persisted/exported                        | Direct                             | Medium: no Oracle identity                                       |
| Attachments                                       | `attachments` and `attachedTo` on groups                                              | Persisted/exported                        | Direct                             | Medium: needs canonical relationship mapping                     |
| Counters                                          | group `counters` record                                                               | Persisted/exported                        | Direct                             | Low to medium: custom counter names                              |
| Base P/T overrides                                | group `pt`                                                                            | Persisted/exported                        | Recalculated by `recalculateStats` | Medium                                                           |
| Current P/T                                       | group `pt.currentPower/currentToughness`                                              | Persisted/exported                        | Recomputed by normalization        | Medium                                                           |
| Depower state                                     | `abilitiesActive`, `depowerMode`, `disabledAbilities`, `statuses.depowered`           | Persisted/exported                        | Direct                             | Medium: app/game distinction                                     |
| Not Tracked state                                 | `trackingEnabled`                                                                     | Persisted/exported                        | Direct                             | Low: clearly an app preference                                   |
| Transform state                                   | `statuses.transformed`, `originalIdentity`, `originalCharacteristics`                 | Persisted/exported                        | Direct                             | Medium                                                           |
| Tapped/attacking/blocking/phased statuses         | group `statuses`                                                                      | Persisted/exported                        | Direct                             | Low                                                              |
| Relevant totals                                   | `calculateTotals(field.groups)` plus `pinnedTotals`                                   | Pinned persisted/exported; values derived | Derived                            | Low                                                              |
| Zone quantities                                   | generic groups in non-battlefield zones                                               | Persisted/exported                        | Derived into totals                | Medium                                                           |
| Opponent placeholders                             | `field.opponentValues`                                                                | Persisted/exported                        | Direct                             | Medium                                                           |
| Saved fields                                      | Dexie `fields` records                                                                | Persisted local only                      | Direct                             | Medium: future shared sessions must not overwrite                |
| Field templates                                   | No separate template system currently                                                 | Not present                               | Not present                        | N/A                                                              |
| Undo history                                      | `undoStack` in Zustand memory                                                         | Not persisted/exported today              | Snapshot-owned                     | High: shape must remain compatible during a session              |
| Redo history                                      | `redoStack` in Zustand memory                                                         | Not persisted/exported today              | Snapshot-owned                     | High                                                             |
| Tutorial progress                                 | Startup visible state in store only                                                   | Not persisted as never-show-again         | UI-owned                           | Low                                                              |
| Animation settings                                | `field.settings.animationSpeed` and `reducedMotion`                                   | Persisted/exported                        | Direct                             | Low                                                              |
| Accessibility settings                            | Reduced motion/card size settings                                                     | Persisted/exported                        | Direct                             | Medium: incomplete settings surface                              |
| PWA cache state                                   | browser/service worker caches                                                         | Browser-owned                             | External                           | Medium                                                           |
| Scryfall cache state                              | Dexie `searchCache`, `cardCache`, localStorage fallback, service worker runtime cache | Local-only                                | External to field                  | Medium                                                           |
| Export/import data                                | `FieldState` JSON                                                                     | User controlled                           | Sanitized on import                | Medium                                                           |

## Rules And Automation Boundary

Lite's current automation is a local helper engine, not an authoritative MTG rules engine.

Supported built-in automated sources:

- Anim Pakal, Thousandth Moon attack initiation.
- Cathars' Crusade creature-entered trigger.
- Doubling Season token and counter replacement effects.
- Rampaging Baloths landfall token creation.
- Soul Warden and Essence Warden creature-entered life gain.
- Impact Tremors opponent damage summary.

Supported helper concepts:

- Counter placement as game action versus correction.
- Token creation with replacement multiplier.
- Creature-entered trigger handling.
- Land-entry background watcher handling.
- Life gain/loss helper events.
- Custom field-level effects for Activate Field.
- Not Tracked source filtering.
- Depower source filtering.

Unsupported Oracle text is not guessed. Unsupported cards remain objects that can receive counters, be counted, be transformed, be depowered, and be removed.

Lite acts as a calculator when it assumes initiating conditions for ACTIVATE FIELD, summarizes opponent-only effects, and processes only explicitly modeled rules patterns. Future authoritative evaluation must be adapter-based and optional.

## Scryfall Integration

- Search endpoint: `https://api.scryfall.com/cards/search`.
- Fetch endpoint: `https://api.scryfall.com/cards/<id>`.
- Search triggers after 2+ typed characters with 220 ms debounce.
- Search uses `unique=prints`, `order=name`, and `include_extras=true`.
- Results stay inside an inner scroll area and selecting a result only previews it.
- Confirming adds/replaces/transforms.
- Printing selection is available from same-oracle results.
- English Oracle fields mapped into `CardIdentity` drive support detection.
- Double-faced card support maps face identities and first-face fields.
- Caching stores searches and cards in Dexie and localStorage fallback; service worker caches API/card image requests.
- Offline search returns cached results and displays an offline note.
- Scryfall attribution is visible in Settings and README.
- Scryfall code is reasonably reusable but coupled to `CardIdentity`, `supportStatusForCard`, and Dexie cache services.

## Tests And Coverage

Configured test categories:

- Vitest unit/component tests: `npm test`.
- React Testing Library app shell tests.
- Playwright end-to-end tests: `npm run e2e`.
- Playwright visual regression tests: `npm run test:visual`.
- Type checking: `npm run typecheck`.
- Linting: `npm run lint`.
- Production build/PWA generation: `npm run build`.

Current coverage includes app load/startup, life increment/undo, popup outside cancellation, generic add, responsive smoke widths, Not Tracked UI flow, Anim Pakal/Cathars' Crusade, Doubling Season, landfall, placeholder replacement, transform, stack split/merge, import migration, wallpaper visibility, visual fixture, modal surfaces, and Transform All modal.

Known coverage gaps to preserve for future prompts:

- No separate tutorial sprite tests because there is no tutorial sprite system.
- Limited real-network Scryfall testing in automated tests; live/manual verification covers it.
- No separate integration test category beyond e2e.
- No server-side shared-session tests because shared sessions do not exist yet.

## Deployment Workflow

- CI workflow: `.github/workflows/ci.yml` runs install, typecheck, lint, unit/component tests, and build.
- Pages workflow: `.github/workflows/deploy-pages.yml` runs install, tests, build, uploads `dist`, and deploys GitHub Pages.
- Production URL: `https://haroldh1995.github.io/boardstatelite/`.
- The reference fixture is gated to local/dev hosts and is not a normal production field.

## Current Risks

- `schemaVersion` is still `1`; future migrations must remain additive and non-destructive.
- Unknown saved data is currently preserved by spreads, but typed code can accidentally drop it if future transformations narrow the shape.
- Undo/redo snapshots are in-memory and can become incompatible if runtime shape changes during a session.
- Stack keys must include fields that affect object identity; missing new fields can merge incompatible stacks.
- Not Tracked must remain separate from Depower.
- Lite helper rules must not conflict with future BoardState authoritative rules.
- User-facing copy must not claim Hub, shared sessions, sync, or Advanced Mode before those systems exist.
