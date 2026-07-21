# Echo Ambient Foundation Audit

This document records the ECHO-01 preparation pass, the ECHO-02 Ambient Gameplay core architecture, and the ECHO-03 Canonical Ambient Event Pipeline for BoardState Lite. It is intentionally an internal architecture note. The application does not expose Ambient Gameplay controls, voice controls, AI recommendations, combat prediction, speaker verification, or new user workflows after these milestones.

## Scope

BoardState Lite remains the portrait-first physical-table companion. Its current ownership stays unchanged:

- Lite owns the personal battlefield, life tracker, counters, tokens, generic placeholders, quick actions, local persistence, one-button helper resolution, offline use, and mobile battlefield presentation.
- BoardState remains the future authoritative rules, advanced gameplay, simulation, tutorial, and shared-game authority.
- BoardState Hub remains the future profile, friend, notification, cloud-backup, and ecosystem-service authority.

ECHO-01 does not add gameplay authority to Lite and does not add cross-repository dependencies.

## Repository Audit Summary

The current app is a React, TypeScript, Vite, Zustand, Dexie, Vitest, Playwright, and vite-plugin-pwa application. The inspected architecture is organized around:

- `src/domain`: field shape, card/group construction, totals, local helper engine, stack splitting/merging, counters, tracking, depower, transformations, and import normalization.
- `src/state`: Zustand store, transaction history, modal state, persistence calls, and UI-facing actions.
- `src/components`: life tracker, totals, battlefield sections, card presentation, bottom dock, Scryfall search, and shared modal system.
- `src/services`: Dexie/localStorage persistence and Scryfall search/cache integration.
- `src/rulesAdapter`: future BoardState authority boundary and current Lite-helper fallback.
- `src/rulesResult`: canonical rules-result rendering for local helper and future authoritative results.
- `src/sharedSession`, `src/gameModes`, `src/multiplayer`, and `src/hub`: local-only ecosystem metadata and inert future integration hooks.
- `tests/e2e`: Playwright smoke and visual regression coverage.

No Android wrapper exists in this repository. Deployment is GitHub Pages through the existing workflow.

## Echo Preparation Added

The `src/echo` module provides an internal, local-only foundation for future Echo milestones:

- A complete capability contract for future Ambient Gameplay systems. Only the internal mode architecture reports available today; voice, AI, prediction, recognition, and planner features remain unavailable.
- A read-only ambient context derived from the existing field, session, totals, and canonical Lite snapshot.
- Deterministic serialization for that context.
- Diagnostics that report architecture-ready, local-only, user-facing Echo disabled.
- A deterministic Ambient Gameplay state machine with Passive, Pre-Turn Preparation, Active Turn, Combat, Resolution, Recovery, and Post-Turn modes.
- A canonical Ambient Event Pipeline that future Echo features must use for battlefield mutations.

This module deliberately does not:

- Listen to audio.
- Parse commands.
- Predict combat.
- Recommend actions.
- Create network calls.
- Mutate field state.
- Add UI, settings, buttons, routes, or tutorials.

Future Echo milestones should build on this foundation instead of duplicating field snapshots, totals aggregation, session metadata, or authority-boundary logic.

## ECHO-02 Ambient Gameplay Engine

`src/echo/ambientEngine.ts` is the single deterministic source for Ambient Gameplay mode state. It is not a rules authority and does not replace Lite's existing turn, phase, battlefield, undo, persistence, or rules-helper systems.

The engine owns only:

- Current Ambient Gameplay mode.
- Previous and requested mode metadata.
- Transition reason and timestamp.
- Valid transition rules.
- Entry, exit, invalid-transition, and listener hooks.
- Safe recovery and cancellation behavior.
- Temporary mode context for future Echo services.
- Conservative session and application lifecycle event handlers.

The mode graph supports the intended stable path:

Passive -> Pre-Turn Preparation -> Active Turn -> Combat -> Resolution -> Active Turn -> Post-Turn -> Passive

It also supports skipped preparation, focused action resolution, combat cancellation, recovery from interrupted workflows, session reset, session completion, and safe persistence restoration.

Invalid transitions fail safely, increment diagnostics, and do not mutate battlefield state.

## Persistence Behavior

The current `FieldState` now contains an `ambient` value. Existing saves without that property are migrated non-destructively to Passive Mode during `sanitizeImportedField` and `normalizeField`.

Only stable modes are restored directly after reload:

- Passive
- Pre-Turn Preparation
- Active Turn

Focused or unsafe persisted modes fall back to Passive Mode unless a later milestone implements additional validation. This prevents a crash or stale reload from trapping the user in Combat, Resolution, Recovery, or Post-Turn workflows.

The canonical Lite snapshot includes the normalized Ambient Gameplay state so future BoardState adapters can evaluate the same local context without reading UI-only state.

## Turn And Phase Boundary

BoardState Lite still does not have a full authoritative turn or phase tracker. The Ambient Gameplay engine exposes conservative `handleSessionEvent` hooks for future established turn/phase events, but it does not create a second turn tracker and does not override current Lite controls.

Future Echo milestones may feed trusted turn-owner and phase events into this engine. The current runtime does not expose automatic mode changes to users.

## ECHO-03 Canonical Ambient Event Pipeline

`src/echo/ambientEventPipeline.ts` is the single internal pathway future Ambient Gameplay features must use to request committed Lite battlefield changes. It does not replace existing user-facing actions yet and does not introduce new controls. It is the reusable architecture for future planner, voice, correction, AI, and combat systems.

The pipeline stages are explicit and testable:

1. Intent Created
2. Entity Resolution
3. Context Validation
4. Rule Validation
5. Confidence Assignment
6. Action Preview
7. Approval Decision
8. Canonical Event Creation
9. Battlefield Mutation
10. Undo Snapshot
11. History Recording
12. Synchronization
13. Completion

The pipeline owns Ambient request structure, canonical event metadata, preview scaffolding, approval routing, validation, duplicate-request protection, failure handling, local-only synchronization metadata, and HistoryEntry creation for the existing undo stack.

It deliberately does not:

- Parse voice or text commands.
- Search Scryfall.
- Predict combat.
- Calculate AI recommendations.
- Enforce full Magic rules.
- Create a separate undo or history system.
- Create networking or cloud synchronization.

Future Echo code should call `AmbientEventPipeline.process` or the store-level `processAmbientIntent` entry point instead of mutating field state directly. Mutation handlers must still use existing domain helpers and `normalizeField` so Lite remains the local helper, not an authoritative rules engine.

## Architecture Hardening

Stable serialization was extracted into `src/utils/stableSerialization.ts` and reused by existing rules-adapter and shared-session serializers. This removes duplicated recursive object sorting without changing export format or snapshot behavior.

## Future Echo Boundaries

Future Echo work should observe these constraints:

- Use `EchoFoundationManager.createAmbientContext` for read-only field context.
- Use the existing Zustand store actions or a future centralized action dispatcher for committed field changes.
- Keep AI, speech, recognition, and prediction services behind unavailable capability checks until real implementations exist.
- Do not bypass the rules adapter or rules-result renderer when applying automated outcomes.
- Do not expose unavailable Echo functions in the production UI.
- Do not treat Lite as the authoritative rules engine.

## Regression Guardrails

The Echo foundation tests verify:

- Echo is architecture-ready, local-only, and user-facing Echo remains disabled.
- Only internal mode architecture capabilities are available.
- Ambient context creation does not mutate the field.
- Context serialization is deterministic.
- Existing Activate Field behavior remains on the Lite-helper path.
- Ambient Gameplay valid and invalid transitions are deterministic.
- Recovery, cancellation, reload fallback, lifecycle interruption, listener cleanup, field normalization, snapshots, and Lite-helper compatibility are covered.
- Ambient Event Pipeline tests cover intent creation, entity resolution, context and rule validation, confidence, preview, approval, canonical events, undo/history reuse, synchronization metadata, duplicate rejection, cancellation, recovery, mutation failure, store undo/redo integration, and existing field compatibility.
