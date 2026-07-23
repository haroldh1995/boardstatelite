# Echo Ambient Foundation Audit

This document records the ECHO-01 preparation pass and the active Project Echo
foundation work for BoardState Lite. It is intentionally an internal
architecture note. The application does not expose AI recommendations, combat
prediction, speech recognition, Magic command parsing, or fake voice automation
after these milestones.

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

The `src/echo` module provides a local-only foundation for Echo milestones:

- A complete capability contract for Ambient Gameplay systems. Voice features remain opt-in and recognition, AI, and prediction features remain unavailable.
- A read-only ambient context derived from the existing field, session, totals, and canonical Lite snapshot.
- Deterministic serialization for that context.
- Diagnostics that report local-only status and unavailable future services honestly.
- A deterministic Ambient Gameplay state machine with Passive, Pre-Turn Preparation, Active Turn, Combat, Resolution, Recovery, and Post-Turn modes.
- A canonical Ambient Event Pipeline that future Echo features must use for battlefield mutations.
- A microphone and listening lifecycle service for future opt-in voice features, with no speech recognition or command parsing.
- A personal voice enrollment and acoustic calibration layer, storing only local acoustic features and no raw audio.
- A speaker verification layer that identifies whether incoming audio matches the enrolled user before future voice interactions can proceed.

This module deliberately does not:

- Parse commands.
- Predict combat.
- Recommend actions.
- Create network calls.
- Mutate field state outside the existing store, undo, and Ambient Event Pipeline boundaries.
- Add fake command, recognition, AI, automation, networking, or authority UI.

Future Echo milestones should build on this foundation instead of duplicating field snapshots, totals aggregation, session metadata, or authority-boundary logic.

## ECHO-07 Listening Lifecycle And Privacy

`src/echo/microphoneService.ts` is the single microphone entry point for future Echo listening features. It owns permission checks, availability checks, audio-session creation and shutdown, interruption handling, device-change hooks, lifecycle recovery, diagnostics, and privacy invariants.

Voice features remain disabled by default. Enabling voice in Settings is an explicit opt-in and does not start speech recognition. Push-to-talk and always-listening are represented only as disabled future settings. The current app never retains raw audio, never enables cloud transcription, and never records conversations continuously.

Listening state is persisted as safe metadata in `FieldState.listening`; active audio sessions are normalized to stopped on imported or unsafe restores. The canonical Lite snapshot includes listening metadata so future BoardState and Echo systems can reason about whether listening was available without reading transient audio resources.

Ambient Gameplay remains the mode authority. The microphone service observes ambient mode and application lifecycle events, but it does not create turn or phase state and does not mutate battlefield state.

## ECHO-08 Voice Enrollment And Acoustic Calibration

`src/echo/voiceEnrollment.ts` owns local speaker-profile enrollment for future verification. It builds one unified speaker profile from quiet, normal, and loud Magic-themed samples, validates recording quality, records calibration metadata for play environments and microphone positions, and normalizes legacy data safely.

The enrollment layer stores acoustic feature vectors, quality scores, sample metadata, and calibration summaries only. It does not retain raw audio, recognize speech, parse commands, identify cards, or execute gameplay actions. Profile management is exposed in the existing Voice & Microphone settings area and remains opt-in.

Future speech and command code must reuse the microphone service, enrollment
profile, and speaker verification result instead of opening a separate audio
stream or creating a second profile store.

## ECHO-09 Speaker Verification And Multi-Speaker Identification

`src/echo/speakerVerification.ts` owns local speaker verification. It uses the
single microphone service and the ECHO-08 speaker profile to evaluate incoming
audio metrics through a deterministic pipeline: incoming audio, voice activity,
cleanup, feature extraction, profile comparison, similarity scoring, confidence
assignment, decision, and result publication.

The verification result answers only who is speaking. It never recognizes
words, parses Magic commands, searches cards, predicts actions, or mutates the
battlefield. Results are integrated with the existing Ambient Confidence
Framework so future voice, planner, and contextual listening milestones can
combine speaker confidence with speech, context, and battlefield confidence.

Commander-table safety is intentionally conservative. Possible overlapping
speakers, noisy venues, clipping, missing enrollment, calibration mismatches, or
corrupted profile data reject verification and expose retry/recovery metadata
instead of accepting another player's voice.

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
