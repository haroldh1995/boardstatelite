# Integration Risks

This register documents risks for future ecosystem work. It is intentionally conservative so Baord State Lite remains a fast physical-table companion while original BoardState becomes the authoritative Advanced engine.

## State Shape Incompatibility

Risk: Lite stacks many physical objects into grouped `PermanentGroup` records. Original BoardState may expect individual canonical objects.

Mitigation:

- Add explicit serializers instead of exposing raw store state as the final ecosystem contract.
- Preserve group quantity and stack-split metadata.
- Keep unknown legacy fields during import.

## Save Migration Risk

Risk: Future session metadata or adapter fields could invalidate current `schemaVersion: 1` saves or overwrite local fields.

Mitigation:

- Use additive migrations.
- Default missing fields safely.
- Never wipe IndexedDB/localStorage during migration.
- Test older saved field shapes.

## Rules-Authority Conflict

Risk: Lite helper automation and original BoardState authoritative results could both try to resolve the same event.

Mitigation:

- Label result source clearly.
- Keep Lite helper engine local and optional.
- When authoritative evaluation is available, route through a single adapter boundary rather than duplicated checks.
- Keep adapter fallback diagnostics separate from user-facing claims.

## Adapter Availability Drift

Risk: Internal adapter status or diagnostics could be mistaken for a live BoardState connection.

Mitigation:

- Default status to `unavailable`.
- Report every capability as unavailable until a real adapter registers it.
- Use `Local Rules Engine`, `BoardState Not Connected`, or `Authoritative Rules Unavailable` if status is ever surfaced.
- Never display connected, synced, authoritative, shared-session, or Advanced Mode language unless verified by the adapter.

## Duplicate Rules Logic

Risk: Future prompts may copy Advanced rules logic into Lite and create divergence.

Mitigation:

- Keep Lite's built-in resolver small.
- Add adapter calls for authoritative evaluation instead of importing Advanced systems.
- Document which logic remains local helper logic.

## Lite UI Bloat

Risk: Hub, shared-session, Advanced Mode, and rules-result UI could make Lite slow and cluttered.

Mitigation:

- Use compact status surfaces.
- Keep advanced details behind explicit actions.
- Preserve current main-screen section order and bottom dock.

## Scryfall Cache Coupling

Risk: Scryfall card identity and cache data may not match canonical BoardState object IDs or print identities.

Mitigation:

- Preserve Scryfall IDs, Oracle IDs, and selected printings in snapshots.
- Map to canonical identities in a serializer layer.
- Do not make shared-session identity depend only on card names.

## Offline-First Conflicts

Risk: Shared sessions or authoritative rules checks can require network access while Lite currently works offline after caching.

Mitigation:

- Keep local-only mode as the default fallback.
- Display honest unavailable/offline status.
- Queue no destructive updates without a real authority contract.

## Deployment Path Mismatch

Risk: GitHub Pages serves the app under `/boardstatelite/`, while local development serves `/`.

Mitigation:

- Keep Vite base path tied to `GITHUB_ACTIONS`.
- Verify page refresh, assets, manifest, and service worker under the production path.

## App-Link Ambiguity

Risk: Future handoff links to BoardState, Advanced Mode, or Hub may be ambiguous or unavailable.

Mitigation:

- Use explicit link status.
- Never show an action as available until a real destination exists.
- Include source app and return target in any future link payload.

## Hub Status Misrepresentation

Risk: UI could say connected, synced, Hub ready, tournament linked, or notifications enabled before those systems exist.

Mitigation:

- Use `Not connected`, `Coming later`, `Requires future Hub support`, or `Adapter not configured`.
- Add tests for misleading copy when Hub surfaces are introduced.

## Mixed-Session Authority Issues

Risk: Lite and Advanced clients may disagree on who owns state changes in a mixed session.

Mitigation:

- Treat original BoardState as authoritative for shared sessions.
- Clearly mark local pending edits.
- Avoid applying authoritative and local helper results to the same event without reconciliation.

## Undo/Redo Snapshot Incompatibility

Risk: Current undo/redo stores full in-memory `FieldState` snapshots. Runtime shape changes can break undo within active sessions.

Mitigation:

- Keep action changes additive.
- Normalize snapshots on commit if schema evolves.
- Test undo/redo around any new session metadata.

## Tutorial Claims Becoming Inaccurate

Risk: Startup and tutorial copy may claim current capabilities that are not actually connected.

Mitigation:

- Keep tutorial language capability-based and honest.
- Review tutorial copy whenever integration status changes.

## Linked-App Status Claims Before Apps Exist

Risk: Internal adapter stubs may leak into user-facing UI as if linked apps are available.

Mitigation:

- Default adapter status to unavailable.
- Use no-op placeholders only in code/docs until real apps exist.
- Require live verification that false linked-app claims are absent.
