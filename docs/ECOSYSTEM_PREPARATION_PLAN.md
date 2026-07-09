# Ecosystem Preparation Plan

This plan sequences the BoardState Lite ecosystem-preparation path. Each prompt must preserve the current Lite physical-table workflow and avoid turning Lite into the original BoardState app.

## 1. Audit BoardState Lite And Preserve Current UI/Gameplay

Goal: document current architecture, state ownership, persistence, rules-helper boundaries, risks, tests, and deployment while adding only safe preservation guardrails.

Required boundaries:

- Do not implement ecosystem adapters yet.
- Do not alter current Lite gameplay or visuals.
- Do not delete or invalidate saves.

Major risks:

- Missing documentation causing later prompts to make false assumptions.
- Unprotected schema behavior.
- Misleading future-integration language.

Expected inputs:

- Current repository.
- Existing deployed app.

Expected outputs:

- Boundary docs.
- Architecture audit.
- Integration risk register.
- Live deployment checklist.
- Lightweight guardrail tests.

Systems likely affected:

- Documentation.
- Tests only, unless a blocking bug is found.

Tests to preserve:

- Unit/component tests.
- E2E tests.
- Visual tests.
- Typecheck, lint, build.

## 2. Add BoardState Authoritative Rules-Engine Adapter

Goal: introduce an optional adapter boundary that can ask original BoardState for authoritative evaluation when available.

Required boundaries:

- Default status must be unavailable or local-only.
- No fake successful authoritative responses.
- Lite helper engine must continue working without BoardState.
- Do not import heavy Advanced UI.

Major risks:

- Duplicate rules logic.
- Treating Lite as authority.
- Blocking local play when BoardState is absent.

Expected inputs:

- Adapter API contract from original BoardState.
- Lite field snapshot serializer requirements.

Expected outputs:

- Adapter interfaces.
- Unavailable adapter implementation.
- Safe feature flag defaulted off.
- Tests proving local helper behavior remains unchanged.

Systems likely affected:

- Domain types.
- Engine entry points.
- Store actions.
- Settings/status copy if needed.

Tests to preserve:

- Activate Field.
- Not Tracked and Depower filtering.
- Existing supported card tests.
- Offline/local-only tests.

## 3. Add Canonical Shared-Game-Session Support

Goal: prepare Lite to attach local fields to canonical shared-session IDs when a real session authority exists.

Required boundaries:

- No fake multiplayer.
- No sync claims before a real service exists.
- Existing local fields remain local and usable.

Major risks:

- Save migration issues.
- Confusing local field ID with shared session ID.
- Undo/redo snapshot mismatch.

Expected inputs:

- Canonical session ID format.
- Ownership/controller mapping expectations.

Expected outputs:

- Additive session metadata.
- Local-only status.
- Export/import compatibility.

Systems likely affected:

- Field types.
- Persistence sanitizer.
- Export/import.
- Settings/status surfaces.

Tests to preserve:

- Legacy import.
- Save/reload.
- Export/import.
- Local-only app load.

## 4. Add Simple/Advanced Switching And State Handoff

Goal: allow Lite to export a Simple Mode session into original BoardState Advanced Mode when that destination is available.

Required boundaries:

- Do not build Advanced Mode inside Lite.
- Do not claim Advanced Mode is available until a real destination exists.
- Handoff must be explicit and user-initiated.

Major risks:

- Bloated UI.
- Incomplete snapshot mapping.
- Users losing local state during handoff.

Expected inputs:

- Advanced Mode launch URL or app-link contract.
- Lite snapshot serialization contract.

Expected outputs:

- Explicit export/handoff action.
- Honest unavailable state.
- Tests proving local Lite flow remains primary.

Systems likely affected:

- Settings/tools.
- Snapshot serializer.
- Documentation.

Tests to preserve:

- Add flow.
- Activate Field.
- Saved field reload.
- Mobile layout.

## 5. Add Mixed Lite/Advanced Multiplayer Support

Goal: support future mixed clients where Lite users and Advanced users can participate in the same canonical session.

Required boundaries:

- Original BoardState remains session/rules authority.
- Lite remains a simplified physical-table view.
- No full opponent-board simulation in Lite.

Major risks:

- Authority conflicts.
- Partial data display confusion.
- Race conditions between Lite local edits and authoritative updates.

Expected inputs:

- Shared-session protocol.
- Authority/update model.
- Conflict rules.

Expected outputs:

- Session participant metadata.
- Readable local status.
- Safe conflict or read-only states.

Systems likely affected:

- Store.
- Persistence.
- Rules result display.
- Settings/status UI.

Tests to preserve:

- Local-only offline behavior.
- Undo/redo.
- Totals and stack behavior.

## 6. Add Lite Rules-Result Rendering Without Bloating Lite

Goal: display authoritative rules results compactly in Lite.

Required boundaries:

- Do not expose full Advanced stack UI.
- Keep ACTIVATE FIELD and current summary model.
- Do not overwhelm mobile layout.

Major risks:

- UI bloat.
- Inaccurate result interpretation.
- Confusing helper-engine results with authoritative results.

Expected inputs:

- Rules result payload schema.
- Severity/status mapping.

Expected outputs:

- Compact result display.
- Clear source labels such as local helper or BoardState authority.
- Accessibility-friendly details.

Systems likely affected:

- Resolution summary.
- Details modal.
- Store result types.
- Tests and visual snapshots.

Tests to preserve:

- Summary modal.
- Outside-tap cancellation.
- Mobile visual layouts.

## 7. Add Hub-Ready Profile, Friend, Tournament, Notification, And App-Link Adapters

Goal: add adapter boundaries for future Hub features without pretending the Hub exists.

Required boundaries:

- User-facing status must remain honest.
- No fake profile/friends/tournament/notification screens.
- Local-only Lite remains usable.

Major risks:

- Hub status misrepresentation.
- Privacy issues.
- Scope creep into a social product.

Expected inputs:

- Hub app-link contracts.
- Profile and notification permission model.

Expected outputs:

- Inert adapter interfaces or constants.
- Explicit `not-connected` statuses.
- Documentation and tests preventing false connected claims.

Systems likely affected:

- Settings/about surface.
- Optional app-link utilities.
- Documentation.

Tests to preserve:

- No misleading UI text.
- PWA installability.
- Offline behavior.

## 8. Final Audit, Deployment, Package Update, And Live Verification

Goal: verify all ecosystem preparation work end to end and prepare the app for the next release.

Required boundaries:

- Preserve Lite identity.
- Preserve local data.
- Do not claim unavailable integrations.

Major risks:

- Regressions across prompts.
- Deployment path mismatch.
- PWA stale service worker.
- Incomplete documentation.

Expected inputs:

- Completed prompts 1 through 7.
- Live deployment target.

Expected outputs:

- Final audit report.
- Passing tests.
- Production build.
- Verified deployment.
- Verified live app.

Systems likely affected:

- Documentation.
- CI/deployment config if needed.
- Version/package metadata if chosen.

Tests to preserve:

- All configured automated tests.
- Visual regression tests.
- Manual local and live smoke verification.
