# Echo Ambient Foundation Audit

This document records the ECHO-01 preparation pass for BoardState Lite. It is intentionally an internal architecture note. The application does not expose Ambient Gameplay, voice controls, AI recommendations, combat prediction, speaker verification, or new user workflows after this milestone.

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

The `src/echo` module provides a dormant read-only foundation for future Echo milestones:

- A complete capability contract for future Ambient Gameplay systems, with every capability disabled today.
- A read-only ambient context derived from the existing field, session, totals, and canonical Lite snapshot.
- Deterministic serialization for that context.
- Diagnostics that always report dormant, local-only, user-facing Echo disabled.

This module deliberately does not:

- Listen to audio.
- Parse commands.
- Start passive, active-turn, combat, recovery, or resolution modes.
- Predict combat.
- Recommend actions.
- Create network calls.
- Mutate field state.
- Add UI, settings, buttons, routes, or tutorials.

Future Echo milestones should build on this foundation instead of duplicating field snapshots, totals aggregation, session metadata, or authority-boundary logic.

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

- Echo is dormant and local-only.
- All future capabilities are explicitly disabled.
- Ambient context creation does not mutate the field.
- Context serialization is deterministic.
- Existing Activate Field behavior remains on the Lite-helper path.
