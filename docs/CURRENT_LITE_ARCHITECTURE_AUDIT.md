# Current Lite Architecture Audit

Audit date: 2026-07-11.

This audit describes the current Baord State Lite implementation before ecosystem integration work. The app is displayed as **Baord State Lite** and is deployed from `main` to GitHub Pages at `/boardstatelite/`.

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
- `src/rulesAdapter/*`: optional BoardState authority adapter boundary, snapshot serializer, capability/status model, result parser, version compatibility helpers, diagnostics, and fallback manager. Production status defaults to `unavailable`.
- `src/rulesResult/*`: rules-result renderer, canonical result conversion, validation, object resolution, compact notifications, animation queue preparation, accessibility announcements, and developer diagnostics.
- `src/sharedSession/*`: canonical local session metadata, stable session/object IDs, local-only authority/status model, deterministic session export/import helpers, diagnostics, and inert future synchronization hooks.
- `src/gameModes/*`: Simple/Advanced mode metadata, capability negotiation, compatibility validation, canonical handoff snapshots, unavailable launch/return hooks, diagnostics, and mode persistence defaults.
- `src/multiplayer/*`: mixed Lite / Advanced participant registry, authority ownership, local-only visibility/synchronization metadata, unavailable discovery/synchronization/conflict hooks, diagnostics, and snapshot metadata.
- `src/hub/*`: Hub-ready ecosystem profile, application registry, backup, notification, friend, deep-link, and cross-app launch contracts with standalone defaults and unavailable hooks.
- `src/echo/*`: Ambient Gameplay state machine, canonical Ambient Event Pipeline, confidence/recovery framework, pre-turn planner, action strip, microphone lifecycle service, and personal voice enrollment/acoustic calibration contracts. Echo voice enrollment stores local acoustic features only and does not recognize speech or parse commands.
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
- Updates display a prompt instead of silently disrupting active games; the generated service worker does not skip waiting or claim active clients until the user accepts the update prompt or navigates naturally.

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
- Export shape: canonical `baord-state-lite-session` JSON envelope containing session metadata, Simple Mode metadata, multiplayer metadata, Hub-ready application/profile/backup metadata, and the current `FieldState`.
- Import validation: `sanitizeImportedField` requires schema version 1, groups array, and player data; it sanitizes key text/numeric values and preserves unknown root/group payloads through spreads.
- Current migration posture: non-destructive defaulting only. Missing `trackingEnabled` defaults to `true`; missing session metadata receives a Local Lite session with one local participant and stable object bindings; missing mode metadata receives Simple Mode with Advanced unavailable; missing multiplayer metadata receives one local BoardState Lite participant and Local Lite authority; missing Hub metadata receives a local anonymous profile, Baord State Lite-only application registry, and local-only backup metadata.

## Canonical Shared Session Layer

The shared-session layer is intentionally local-only today. It prepares identity and serialization contracts without enabling multiplayer, cloud sync, Hub status, or BoardState authority.

Modules:

- `src/sharedSession/types.ts`: session authority/status/capability types, participant model, metadata, object bindings, export envelope, diagnostics, and hook results.
- `src/sharedSession/identity.ts`: canonical session IDs, participant IDs, object IDs, local participant lookup, and object-binding normalization.
- `src/sharedSession/metadata.ts`: Local Lite session creation, safe metadata migration, participant normalization, and snapshot metadata.
- `src/sharedSession/serializer.ts`: deterministic session export envelope creation and backward-compatible import unwrapping.
- `src/sharedSession/manager.ts`: centralized session diagnostics, export, snapshot, lifecycle hooks, and unavailable synchronization responses.

Current session behavior:

1. New fields receive a stable `BS-SESSION-*` ID.
2. Every normalized permanent group receives a session binding with object IDs for each object represented by the group quantity.
3. Stack split/merge preserves object IDs instead of regenerating them.
4. Undo/redo snapshots preserve session metadata and object bindings.
5. Exports include session metadata; imports of both new envelopes and legacy raw fields remain local-only.
6. `connect`, `disconnect`, `synchronize`, `publishSnapshot`, and `receiveSnapshot` are inert hooks that return unavailable.

Current supported session states are modeled, but runtime production status remains `localOnly` and authority remains `local-lite`.

## Simple And Advanced Mode Layer

The mode layer prepares future handoff to the original BoardState Advanced application without changing today's Lite runtime.

Modules:

- `src/gameModes/types.ts`: gameplay mode, capability, compatibility, locking, launch, handoff, return, diagnostics, and canonical handoff snapshot types.
- `src/gameModes/capabilities.ts`: Simple Mode capability defaults and unavailable Advanced capability defaults.
- `src/gameModes/state.ts`: default Simple Mode state, safe mode migration, compatibility metadata, and mode snapshots.
- `src/gameModes/serializer.ts`: canonical handoff snapshot creation and deterministic serialization.
- `src/gameModes/manager.ts`: centralized mode diagnostics, capability negotiation, session compatibility validation, unavailable Advanced handoff, unavailable return, and unavailable launch hooks.
- `src/gameModes/index.ts`: public mode exports.

Current runtime behavior:

1. Every field has `field.mode.currentMode === "simple"`.
2. Simple Mode reports life tracker, battlefield, counters, tokens, helper engine, and local persistence as available.
3. Advanced Mode reports unavailable and all Advanced-only capabilities are false.
4. Compatibility validation succeeds for the local Simple Mode session.
5. Preparing a handoff builds a canonical snapshot but returns `advancedUnavailable`; no transfer, lock, launch, or sync occurs.
6. Return and launch abstractions exist but return unavailable.

The canonical handoff snapshot includes mode metadata, session metadata, Lite rules-adapter snapshot, compatibility metadata, current/local authority metadata, lock state, battlefield state, counters, statuses, attachments, tracking/depower state, token stacks, object identities, and version metadata. It excludes UI-only animation and selection state.

## Mixed Lite / Advanced Multiplayer Layer

The multiplayer layer prepares future mixed Lite / Advanced participation without adding networking, matchmaking, lobbies, chat, invitations, or fake remote players.

Modules:

- `src/multiplayer/types.ts`: participant registry, authority ownership, compatibility, synchronization, conflict, discovery, battlefield participation, diagnostics, and unavailable result types.
- `src/multiplayer/state.ts`: local-only multiplayer defaults, participant normalization, compatibility metadata, local battlefield participation, and multiplayer snapshots.
- `src/multiplayer/manager.ts`: centralized participant diagnostics plus inert join, leave, publish, receive, merge, conflict, reconnect, heartbeat, capability exchange, version exchange, and discovery hooks.
- `src/multiplayer/index.ts`: public multiplayer exports.

Current runtime behavior:

1. Every field has `field.multiplayer.status === "localOnly"`.
2. The participant registry contains exactly one local BoardState Lite participant.
3. Authority is Local Lite for local, rules, and session authority; judge authority is unknown.
4. Multiplayer capabilities such as shared battlefield, rules authority, judge actions, chat, notifications, dry run, tutorial, replay, and deck validation are unavailable.
5. Every battlefield group has local-only visibility, local-only synchronization state, and Local Lite authority source metadata.
6. Synchronization, discovery, and conflict hooks exist but return unavailable.

This layer is a data and integration boundary only. It does not make Lite a multiplayer authority.

## Hub-Ready Ecosystem Layer

The Hub layer prepares future ecosystem compatibility without creating accounts, cloud services, friend lists, notifications, or app launches.

Modules:

- `src/hub/types.ts`: profile, application registry, capability, friend, notification, backup, cross-app launch, deep-link, compatibility, diagnostics, and unavailable result types.
- `src/hub/capabilities.ts`: standalone capability defaults. Local profile, local backup, and manual backup are true; remote/future capabilities are false.
- `src/hub/profile.ts`: local anonymous profile creation and safe profile normalization.
- `src/hub/registry.ts`: canonical application registry that currently contains only Baord State Lite.
- `src/hub/state.ts`: default Hub integration state, migration normalization, snapshot creation, and unavailable-reason constants.
- `src/hub/launch.ts`: cross-app launch and deep-link preparation abstraction that returns unavailable today.
- `src/hub/manager.ts`: centralized diagnostics, capability negotiation, Hub/friend/notification/backup/launch hooks, and the developer diagnostics global.

Current runtime behavior:

1. Every field has `field.hub.status === "standalone"` and `field.hub.hubAvailability === "unavailable"`.
2. Every field has a stable local anonymous `BS-PROFILE-*` profile ID.
3. The application registry contains exactly one entry: Baord State Lite in Standalone Mode.
4. Local JSON export/import is the only enabled backup destination.
5. Hub profile sync, friends, cloud backup, remote notifications, cross-app launching, deep links, Deck Nexus, BoardState Hub, and BoardState Advanced launches all report unavailable.
6. Exports and rules-adapter snapshots include Hub metadata without claiming Hub connectivity.
7. Stale imported Hub-connected states normalize back to standalone/local-only unless future work explicitly verifies a real Hub authority.

Developer diagnostics are available through `__BAORD_STATE_LITE_HUB__.getDiagnostics(field?)`. This is not a user-facing Hub integration claim.

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

| State                                             | Owner                                                                                 | Persistence/export                        | Derived/recomputed                        | Future serialization risk                              |
| ------------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------------------------------- | ------------------------------------------------------ |
| Life total                                        | `field.player.life`                                                                   | Persisted/exported                        | Direct                                    | Low                                                    |
| Starting life                                     | `field.player.startingLife` and settings                                              | Persisted/exported                        | Direct                                    | Low                                                    |
| Poison, energy, experience, rad, commander damage | `field.player.counters`                                                               | Persisted/exported                        | Direct                                    | Low                                                    |
| Custom player counters                            | `field.player.counters.custom`                                                        | Persisted/exported                        | Direct                                    | Medium: needs canonical naming                         |
| Player statuses                                   | `field.player.statuses`                                                               | Persisted/exported                        | Direct                                    | Low                                                    |
| Session identity                                  | `field.session`                                                                       | Persisted/exported                        | Normalized on field load/update           | Low: local-only metadata is additive                   |
| Mode state                                        | `field.mode`                                                                          | Persisted/exported                        | Normalized on field load/update           | Low to medium: future handoff must stay honest         |
| Multiplayer participation                         | `field.multiplayer`                                                                   | Persisted/exported                        | Normalized on field load/update           | Medium: future authority must reconcile participants   |
| Hub ecosystem state                               | `field.hub`                                                                           | Persisted/exported                        | Normalized on field load/update           | Medium: future Hub authority must not fake local sync  |
| Local profile                                     | `field.hub.profile` and `field.session.ecosystem.profileId`                           | Persisted/exported                        | Normalized to local anonymous today       | Medium: future login/profile merge must preserve data  |
| Application registry                              | `field.hub.registry`                                                                  | Persisted/exported                        | Normalized to Baord State Lite only today | Medium: future app discovery must remain honest        |
| Backup metadata                                   | `field.hub.backup` and export envelope `backup`                                       | Persisted/exported                        | Normalized to local JSON only today       | Medium: cloud backup must not overwrite local saves    |
| Participants                                      | `field.session.participants`                                                          | Persisted/exported                        | Normalized to one local participant today | Medium: future roles need authority mapping            |
| Permanents and tokens                             | `field.groups` with `group.session.objectIds`                                         | Persisted/exported                        | Direct with normalized stack keys         | Low to medium: grouped objects now have canonical IDs  |
| Generic placeholders                              | `field.groups` where `isGeneric`                                                      | Persisted/exported                        | Direct                                    | Medium: no Oracle identity                             |
| Attachments                                       | `attachments` and `attachedTo` on groups                                              | Persisted/exported                        | Direct                                    | Medium: needs canonical relationship mapping           |
| Counters                                          | group `counters` record                                                               | Persisted/exported                        | Direct                                    | Low to medium: custom counter names                    |
| Base P/T overrides                                | group `pt`                                                                            | Persisted/exported                        | Recalculated by `recalculateStats`        | Medium                                                 |
| Current P/T                                       | group `pt.currentPower/currentToughness`                                              | Persisted/exported                        | Recomputed by normalization               | Medium                                                 |
| Depower state                                     | `abilitiesActive`, `depowerMode`, `disabledAbilities`, `statuses.depowered`           | Persisted/exported                        | Direct                                    | Medium: app/game distinction                           |
| Not Tracked state                                 | `trackingEnabled`                                                                     | Persisted/exported                        | Direct                                    | Low: clearly an app preference                         |
| Transform state                                   | `statuses.transformed`, `originalIdentity`, `originalCharacteristics`                 | Persisted/exported                        | Direct                                    | Medium                                                 |
| Tapped/attacking/blocking/phased statuses         | group `statuses`                                                                      | Persisted/exported                        | Direct                                    | Low                                                    |
| Relevant totals                                   | `calculateTotals(field.groups)` plus `pinnedTotals`                                   | Pinned persisted/exported; values derived | Derived                                   | Low                                                    |
| Zone quantities                                   | generic groups in non-battlefield zones                                               | Persisted/exported                        | Derived into totals                       | Medium                                                 |
| Opponent placeholders                             | `field.opponentValues`                                                                | Persisted/exported                        | Direct                                    | Medium                                                 |
| Saved fields                                      | Dexie `fields` records                                                                | Persisted local only                      | Direct                                    | Medium: future shared sessions must not overwrite      |
| Field templates                                   | No separate template system currently                                                 | Not present                               | Not present                               | N/A                                                    |
| Undo history                                      | `undoStack` in Zustand memory                                                         | Not persisted/exported today              | Snapshot-owned                            | High: shape must remain compatible during a session    |
| Redo history                                      | `redoStack` in Zustand memory                                                         | Not persisted/exported today              | Snapshot-owned                            | High                                                   |
| Tutorial progress                                 | Startup visible state in store only                                                   | Not persisted as never-show-again         | UI-owned                                  | Low                                                    |
| Animation settings                                | `field.settings.animationSpeed` and `reducedMotion`                                   | Persisted/exported                        | Direct                                    | Low                                                    |
| Accessibility settings                            | Reduced motion/card size settings                                                     | Persisted/exported                        | Direct                                    | Medium: incomplete settings surface                    |
| Voice settings                                    | `field.settings.voice`                                                                | Persisted/exported                        | Normalized on field load/update           | Medium: future voice services must remain opt-in       |
| Speaker profile                                   | `field.settings.voice.enrollment.profile`                                             | Persisted/exported                        | Acoustic model rebuilt from samples       | Medium: never serialize raw audio or fake verification |
| Acoustic calibration                              | `field.settings.voice.enrollment.profile.calibrationProfiles`                         | Persisted/exported                        | Direct summaries from sampled metrics     | Medium: future confidence must not treat it as speech  |
| Listening state                                   | `field.listening`                                                                     | Persisted/exported as safe metadata       | Active sessions normalized on restore     | Medium: runtime resources are never restored           |
| PWA cache state                                   | browser/service worker caches                                                         | Browser-owned                             | External                                  | Medium                                                 |
| Scryfall cache state                              | Dexie `searchCache`, `cardCache`, localStorage fallback, service worker runtime cache | Local-only                                | External to field                         | Medium                                                 |
| Export/import data                                | Session envelope with `FieldState` fallback support                                   | User controlled                           | Sanitized on import                       | Medium                                                 |

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

## BoardState Rules Adapter Layer

The adapter layer is intentionally separate from UI components and does not require original BoardState to exist.

Modules:

- `src/rulesAdapter/types.ts`: adapter statuses, capabilities, version metadata, canonical Lite snapshot types, future rules-result types, and adapter interface.
- `src/rulesAdapter/capabilities.ts`: capability list and unavailable capability defaults.
- `src/rulesAdapter/status.ts`: status values and status validation.
- `src/rulesAdapter/serializer.ts`: canonical Lite snapshot creation and deterministic serialization.
- `src/rulesAdapter/result.ts`: defensive parser for future BoardState rules-result payloads.
- `src/rulesAdapter/manager.ts`: centralized status, capability, version, diagnostics, serialization, and fallback manager.
- `src/rulesAdapter/index.ts`: public adapter exports.

Current runtime flow:

1. User presses ACTIVATE FIELD.
2. Store asks `rulesAdapterManager.evaluateWithFallback`.
3. Manager creates a Lite battlefield snapshot and deterministic serialized payload.
4. Manager sees status `unavailable`.
5. Manager records diagnostics and fallback reason.
6. Existing Lite helper engine resolves the activation exactly as before.
7. The helper output is converted to a canonical rules result and passed through `rulesResultRenderer`.
8. Renderer validation, compact summary/details, accessibility announcements, and animation queue metadata are prepared.
9. Existing summary, animations, undo/redo, and persistence behavior continue unchanged.

Current statuses supported: `unavailable`, `disconnected`, `connecting`, `connected`, `error`, and `unsupportedVersion`.

Current capabilities supported by the model: `evaluateSnapshot`, `sharedSession`, `advancedMode`, `multiplayerAuthority`, `dryRun`, `tutorialAuthority`, `rulesReplay`, and `deckValidation`. All capabilities report unavailable unless a future real adapter registers otherwise.

The canonical snapshot includes player state, relevant totals, opponent placeholder values, all permanent/group state, selected card identity and printing data, token/generic flags, tracking and depower state, attachments, counters, power/toughness, transform state, status flags, stack membership, custom effects, preferences, app version, adapter version, snapshot version, serialization version, and field timestamp. It excludes transient UI selection and animation state and omits card image URLs because future rules evaluation should use identity and printing data, not UI imagery.

The snapshot now also includes Local Session metadata, participant metadata, current authority/status metadata, synchronization version, Simple/Advanced mode metadata, multiplayer participant metadata, Hub profile/application/backup metadata, compatibility metadata, object visibility/synchronization metadata, and each permanent group's session/object ownership binding.

Version metadata is prepared with Lite version `0.0.0`, adapter version `0.1.0`, snapshot version `1`, serialization version `1`, and minimum future BoardState version `0.1.0`. Version negotiation currently only updates diagnostics/status and does not create a network connection.

Developer diagnostics are available through the adapter manager and a read-only global `__BAORD_STATE_LITE_RULES_ADAPTER__.getDiagnostics()` for manual verification. This is not a user-facing integration claim.

## Rules Result Renderer Layer

The renderer layer displays rules results without making Lite an authority or importing Advanced gameplay UI.

Modules:

- `src/rulesResult/types.ts`: canonical result schema, change records, rendering modes, notifications, animations, replay markers, validation, and diagnostics types.
- `src/rulesResult/conversion.ts`: conversion from Lite helper `ResolutionResult` and future BoardState adapter evaluations into canonical rules results.
- `src/rulesResult/objectResolver.ts`: maps stable group IDs, object IDs, stack keys, and attachment references to current Lite battlefield groups.
- `src/rulesResult/validation.ts`: rejects malformed results, unknown object references, unknown schema/source values, mismatched field/session IDs, invalid amounts, and missing authority versions.
- `src/rulesResult/renderer.ts`: central rendering pipeline for validation, supported battlefield updates, notifications, animation queues, summary decoration, accessibility announcements, and diagnostics.

Current renderer behavior:

1. Local helper outputs are canonicalized before store commits.
2. Invalid external results are recovered safely with the battlefield unchanged.
3. Supported future changes include life, player counters, counters, token creation/removal, generic permanent creation/removal, zones, attachments, statuses, transforms, depower, tracking, and power/toughness updates.
4. Temporary animation queues and notifications are not persisted in saved fields or exports.
5. Details can show the rendering source as `Local Helper Engine`; no user-facing surface claims BoardState authority is connected.
6. Developer diagnostics are available through `__BAORD_STATE_LITE_RULES_RENDERER__.getDiagnostics()`.

The renderer supports instant, animated, reduced-motion, silent, and future replay modes. It prepares replay markers and judge notes for future use but does not implement replay playback or judge workflows.

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

Adapter coverage includes unavailable adapter creation, capability reporting, status transitions, version compatibility, deterministic snapshot serialization, omission of UI-only image data, Not Tracked/depower snapshot state, future result parsing, fallback through the Lite helper engine, Activate Field/Undo preservation, and saved-field import shape preservation.

Shared-session coverage includes Local Session creation, session ID persistence through undo/redo, legacy save migration, canonical export/import, object ID preservation through stack split/merge, rules-adapter snapshot compatibility, and unavailable synchronization hooks.

Mode coverage includes Simple Mode defaults, Advanced unavailable status, capability negotiation, compatibility validation, unavailable handoff/return/launch paths, canonical handoff snapshot completeness, export metadata, legacy mode migration, Activate Field preservation, undo preservation, and session identity preservation.

Multiplayer coverage includes local participant creation, participant persistence, ownership mapping, Local Lite authority metadata, unavailable multiplayer capability negotiation, compatibility defaults, object visibility/synchronization metadata, rules-adapter snapshot metadata, synchronization/discovery/conflict stubs, export/import metadata, Activate Field preservation, and Scryfall identity snapshot preservation.

Rules-result renderer coverage includes canonical helper conversion, validation failures, unknown object rejection, authoritative result rendering, life/counter/token/status/transform/depower/tracking updates, warnings, unsupported interactions, judge notes, replay markers, reduced-motion mode, accessibility announcements, store Activate Field preservation, undo preservation, export-shape preservation, and Scryfall identity preservation.

Hub coverage includes standalone profile defaults, application registry defaults, capability negotiation, stale connected-state normalization, unavailable Hub/friend/cloud/launch/deep-link hooks, export metadata, legacy migration, rules-adapter snapshot metadata, Activate Field preservation, undo/redo preservation, local helper rendering preservation, and diagnostics honesty.

Final ecosystem readiness coverage validates all prepared integration layers together: local-only defaults, canonical metadata, deterministic snapshots, export/import metadata, Lite helper fallback, compact renderer output, unavailable future hooks, corrupt future metadata recovery, and centralized app identity.

Echo coverage validates the Ambient Gameplay core architecture and canonical Ambient Event Pipeline: internal mode capabilities are available, user-facing Echo authority remains disabled, ambient context creation is read-only, context serialization is deterministic, stable-mode persistence is safe, invalid transitions fail without mutating battlefield state, session/lifecycle recovery is deterministic, existing Lite snapshots include normalized ambient state, pipeline stages are deterministic, canonical Ambient events reuse existing HistoryEntry undo snapshots, local-only synchronization metadata remains honest, the opt-in microphone lifecycle preserves privacy defaults without speech recognition, personal voice enrollment stores acoustic features only, and Activate Field remains on the Lite-helper path.

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
- Canonical object IDs are preserved through current split/merge helpers, but future object-level operations must update the bindings with the same care.
- Shared-session metadata is local-only today; user-facing copy must not present `readyForSharing` types as real synchronization before a real authority exists.
- Mode metadata is local Simple Mode today; user-facing copy must not present Advanced as connected, active, transferred, synced, or authoritative before a real BoardState Advanced target exists.
- Multiplayer metadata is single-participant and local-only today; user-facing copy must not present players joined, lobbies, shared battlefields, judge connections, or synchronization before real authority exists.
- Hub metadata is standalone and local-only today; user-facing copy must not present accounts, friends, cloud backup, remote notifications, app launching, Deck Nexus, Hub, or profile sync before real services exist.
- Not Tracked must remain separate from Depower.
- Lite helper rules must not conflict with future BoardState authoritative rules.
- Adapter diagnostics must remain honest: status is unavailable until a real authority exists, and fallback must not be presented as authoritative.
- Rules-result rendering must stay compact and must not expose raw Advanced engine output or present local helper output as BoardState authority.
- Echo architecture must remain internal until real milestones add concrete user-facing services; do not expose mode controls, voice, AI recommendations, combat prediction, or turn planning from capability metadata alone.
- Ambient Gameplay mode state is not a turn or phase authority. Future integrations must feed trusted turn/phase events into the engine instead of creating parallel ownership or phase trackers.
- Future Echo mutation sources must use the canonical Ambient Event Pipeline and the store-level Ambient intent entry point rather than direct field mutation.
- Future Echo listening, speaker verification, and command systems must use the single microphone service and local enrollment profile, and must not open competing audio streams, retain raw audio, or bypass privacy opt-in defaults.
- User-facing copy must not claim Hub, shared sessions, sync, or Advanced Mode before those systems exist.
