# BoardState Lite Portability Audit

BoardState Lite must keep gameplay, rules-helper, Echo, Athena, session, persistence-shape, and field-state logic portable enough to move into a future Swift Playground implementation. React, DOM, browser storage, browser networking, and Web Audio APIs are adapter concerns, not gameplay concerns.

## Portable Core

The portable core includes:

- `src/domain`
- `src/sharedSession`
- `src/rulesAdapter`
- `src/rulesResult`
- `src/athena`
- `src/echo`
- `src/services`
- `src/state`

These modules must not directly read browser APIs such as `document`, `navigator`, `localStorage`, `fetch`, Web Audio, DOM event types, browser timers, wall-clock globals, or random globals. When core logic needs one of those capabilities, it must use an explicit platform port.

## Platform Ports

The current platform boundary is under `src/platform`:

- `runtime.ts` owns current time, monotonic time, async sleeps, and portable ID randomness.
- `storage.ts` owns key-value persistence access and falls back to memory storage when browser storage is unavailable.
- `network.ts` owns online status and JSON fetch access.
- `persistence.ts` owns the current IndexedDB/Dexie adapter behind a field persistence port.
- `webMicrophoneAdapter.ts` owns web-only microphone, permission, device-change, and Web Audio sample capture behavior.

Future Apple work should replace these ports with Swift-backed implementations instead of changing gameplay logic.

## Web UI Boundary

The web-only layer is limited to:

- React components under `src/components`
- `src/App.tsx`
- `src/main.tsx`
- Browser development helpers under `src/dev`
- Platform web adapters under `src/platform`
- Browser and Playwright tests

UI code may call DOM APIs for rendering, events, focus management, and PWA behavior. It must not become the only home for battlefield rules, Echo interpretation, Athena relationship logic, undo behavior, persistence shape, or canonical session rules.

## Microphone Boundary

`EchoMicrophoneService` is now adapter-driven. The core service defaults to an unavailable platform adapter and exposes `configurePlatformAdapter` so each runtime can provide the correct microphone implementation. The web app wires `createWebMicrophonePlatformAdapter` from `src/platform/webMicrophoneAdapter.ts` during startup.

Future iOS or Swift Playground work should provide an equivalent adapter for microphone availability, permission, audio sessions, device changes, and sample capture without changing Echo lifecycle logic.

## Regression Guard

`src/platform/platformBoundary.test.ts` scans portable core source files and fails if direct web runtime dependencies are introduced. This test is intentionally architectural: it protects the non-negotiable rule that BoardState Lite gameplay logic must not become trapped in web-only UI code.

When adding new runtime needs:

- Add or extend a platform port.
- Keep React and DOM code inside UI or platform adapter files.
- Keep canonical field mutations in existing domain/store pathways.
- Keep Echo and Athena logic independent from browser-only primitives.
- Do not move gameplay calculations into UI components to make a web feature easier.
