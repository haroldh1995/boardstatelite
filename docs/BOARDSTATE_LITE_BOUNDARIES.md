# Baord State Lite Boundaries

This repository contains Baord State Lite, displayed in the app as **Baord State Lite**. The spelling is intentional in the current product surface and must not be silently changed by ecosystem work.

## What Lite Is

Baord State Lite is a fast physical-table companion for a player who wants local help tracking their own battlefield. It is optimized for mobile use during real tabletop Magic: The Gathering games.

Lite is responsible for:

- Personal life tracking and player counters.
- Relevant totals, zone quantities, and quick corrections.
- Tracked permanents, generic placeholders, counters, tokens, statuses, attachments, and stacks.
- Scryfall-backed card lookup, selected printings, and real card imagery.
- Local helper automation for supported triggers, replacement effects, counters, tokens, and life changes.
- A single ACTIVATE FIELD flow for current Lite-supported interactions.
- Local persistence, local export/import, PWA installability, and offline use after data is cached.
- Clear support-status honesty for unsupported Oracle text.

## What Lite Is Not

Lite must not be converted into:

- The original BoardState app.
- A full match simulator.
- A complete tabletop replacement.
- A full opponent-board tracker.
- An authoritative rules engine.
- A Dry Run simulation engine.
- A full Advanced Gameplay client.
- A multiplayer rules server.
- A Hub replacement.
- A profile, friends, tournament, or notification product.

## Lite Versus Original BoardState

Original BoardState is planned as the ecosystem authority for rules enforcement, Advanced Gameplay, Dry Run/simulation, tutorials, shared-session authority, and future Advanced Mode. Lite remains the fast Simple Mode companion.

The future relationship should be adapter-based:

- Lite may send a serialized Lite field snapshot to original BoardState.
- Original BoardState may return authoritative rules results.
- Lite may display compact returned results without importing heavy Advanced UI or rules authority.
- Lite may hand off a Simple Mode session into BoardState Advanced Mode when that product path exists.
- Lite may accept a compatible return snapshot from Advanced Mode when that path exists.

Until those integrations actually exist, Lite must use honest wording such as `Not connected`, `Coming later`, `Requires BoardState`, `Requires future Hub support`, `Local-only`, `Export file available`, or `Adapter not configured`.

## Must Stay In Lite

- Mobile-first layout and current dark fantasy visual identity.
- Current wallpaper visibility and Arena-style card presentation.
- Personal life tracker and player counters.
- Relevant totals strip.
- Creatures, other permanents, attachments, generics, and tokens sections.
- Generic placeholder flow and triple-tap replacement.
- Scryfall search, previews, images, support statuses, and cache behavior.
- Counter management, status management, depower, Not Tracked, base power/toughness overrides, and stack split/merge.
- ACTIVATE FIELD as the one Lite activation control.
- Hold ACTIVATE FIELD to Transform All.
- Current local helper resolver for modeled interactions.
- Undo/redo snapshots and current local save/export/import behavior.
- PWA/offline support.

## Must Stay Out Of Lite

- Heavy Advanced Gameplay screens.
- Complete rules enforcement.
- Full stack/priority/casting legality enforcement.
- Full opponent board simulation.
- Server-authoritative multiplayer state.
- Fake Hub/profile/friends/tournament/notification screens.
- Claims that an ecosystem adapter is connected before it is actually wired.
- Destructive migrations that invalidate local Lite saves.

## Rules-Authority Boundary

Lite currently contains a local helper engine. It is useful for supported physical-table calculations, but it is not the ecosystem-authoritative rules engine. Future prompts may add an adapter that can defer to original BoardState when available. That adapter must be optional and must default to unavailable or local-only behavior until a real BoardState authority is connected.

## Hub And Linked-App Honesty

Lite must not claim Hub, shared-session, profile, friends, tournament, notification, sync, or Advanced Mode availability before those systems exist. Internal placeholders may be documented or typed, but production UI must not present them as connected or working.

## Local-Only Workflow Preservation

Every ecosystem step must preserve the current local-only physical-table workflow:

1. Open Lite.
2. Acknowledge the startup warning.
3. Track life and counters.
4. Add real tracked cards or generic placeholders.
5. Adjust counters/totals/statuses.
6. Press ACTIVATE FIELD for supported local helper automation.
7. Undo/redo as needed.
8. Save locally and keep playing without an external service.
