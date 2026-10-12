# Personalized Tracking and Dungeon Intelligence

## State Ownership

`settings.playerTrackers` owns visible tracker IDs, custom display names and saved layouts. IDs do not change when names change. Hiding, reordering, selecting a preset and restoring defaults never mutate `player.counters`, create a gameplay event or enter Undo history. The existing settings persistence and centralized New Game operation preserve these preferences. Counter values remain game-scoped; custom values use stable IDs, not display names. All adjustments reuse `NumericAdjuster`, the grouped numeric transaction and the lifecycle-safe hold adapter.

`externalGameState.dungeons` is versioned, game-scoped, player-specific state. Each player has an active run, completed runs and room-resolution records. Initiative ownership is an independent designation. The old singular `dungeon` property is a derived local-player compatibility projection, not a second editable state source. Import migrates recognized legacy dungeon/room names as corrections without manufacturing abilities.

New Game clears dungeon state, room requests, initiative, manual table players and all counter values through the existing centralized session reset. Restore preserves active runs and pending work. Presentation transitions do not reset either system.

## Verified Catalog

The catalog covers the four requested established dungeon cards. Stable identity is Scryfall's Oracle UUID; printing IDs and official image URLs are retained separately. The complete normalized graph and room text are bundled, so progression works offline. Official card images are optional and use the existing image-cache infrastructure; the accessible native HTML diagram never depends on image availability.

Validated against current Oracle records and the September 25, 2026 Comprehensive Rules on October 11, 2026:

- [Official Comprehensive Rules](https://magic.wizards.com/en/rules), rules 309, 701.49 and 726.
- [Lost Mine of Phandelver record](https://api.scryfall.com/cards/59b11ff8-f118-4978-87dd-509dc0c8c932).
- [Dungeon of the Mad Mage record](https://api.scryfall.com/cards/6f509dbe-6ec7-4438-ab36-e20be46c9922).
- [Tomb of Annihilation record](https://api.scryfall.com/cards/70b284bd-7a8f-4b60-8238-f746bdc5b236).
- [Undercity record](https://api.scryfall.com/cards/2c65185b-6cf0-451d-985e-56aa45d9a57d).

Magic card artwork belongs to Wizards of the Coast; card data and image delivery are attributed to Scryfall. No artwork is copied into the repository.

## Progression and Resolution

`dungeons.ts` is platform-independent transition logic. Ordinary venture starts one of the original three dungeons; venture into Undercity starts Undercity. Either instruction advances an existing dungeon along an actual outgoing arrow. Only the explicit correction path can relocate freely. Requests and accepted movements carry stable IDs; replays cannot advance a room twice.

Room entry creates a pending ability, not an assumed resolved outcome. Reaching a final room does not itself complete the dungeon. Completion follows resolution/countering of every pending room ability for that run. Under rule 701.49c, another venture from the final room completes/removes the old dungeon while preserving unresolved abilities, then starts the appropriate new dungeon. Completed history remains available in Athena's awareness context. Corrections and their Undo/Redo never create room abilities.

`dungeonBookkeeping.ts` translates verified room metadata into existing Athena canonical life, token and targeted-counter primitives. Targeted counters split one creature from a stack. Supported resolution and resulting bookkeeping are one Undo transaction. Room choice and subsequent explicit resolution are separate player decisions. Resolution IDs prevent repeated application.

Scry, library/hand operations, optional choices, goad and restrictions whose exact duration/target semantics are not represented by the current engine remain explicit physical-table resolution. The verified text is shown, with Resolved at Table and Countered / No Effect. Opponents' life totals are not invented or locally maintained. Multi-player life rooms update the local total only and explicitly leave other players' bookkeeping at the table. Unknown instructions never create placeholders.

## Initiative, Turn Memory and Observations

Taking initiative queues a venture even if the same player already holds it. Assign / Correct Holder changes the designation only. Losing initiative never deletes a run. Manual table-player identities coexist with existing session participants.

An observed holder upkeep queues one request per player/turn identity. Start Turn reaches untap; Begin Upkeep records the actual upkeep. Direct phase correction does not replay skipped steps or create initiative requests. Shared/adapted upkeep observations can call `observeUpkeep(playerId, turnId)` with the owning turn identity; Lite does not infer opponents' turns from the local clock. Turn Memory derives pending dungeon requests and room abilities from the dungeon state, preserving unresolved work across local turn boundaries without duplicate entries.

Echo's existing command grammar recognizes initiative and venture phrases. Recognition alone changes nothing. `dungeonIntentMutation` is executed only through the existing accepted-intent/confidence pipeline. ARGUS observations remain observations; current card data, Deck Nexus corroboration and Athena awareness retain their existing boundaries. Dungeon use never requires deck membership.

## Portability and Privacy

Catalog, preference normalization, transition functions, request identity and per-player history contain no browser APIs. React presentation reuses existing interaction adapters. Native SwiftUI/Android clients can map the same serializable contracts and pure transition semantics; this repository has no native build target, so an Apple or Android binary cannot be validated here.

The shared public projection includes public dungeon progress, initiative and table-player labels. Counter layouts and private Deck Nexus snapshots are not added to the public projection. Incoming observers must retain canonical event identities; they must not reinterpret an already accepted room entry as a new local venture.

## Validation

Domain tests cover catalog identities/topology, entry restrictions, branching, correction, final-room sequencing, repeated runs, idempotency, per-player progress and upkeep. Store tests cover effects, targets, Undo/Redo, persistence, New Game, public projection and presentation-only preferences. Browser tests cover counter customization, saved layouts, hide/show value preservation, hold cancellation, room progression and phone/tablet layouts. Hardware speech, VoiceOver and native compilation require their actual platforms; browser accessibility is checked through semantic roles and keyboard actions.
