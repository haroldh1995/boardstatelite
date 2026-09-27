# BoardState Lite Next-Generation Architecture

## Product Boundary

BoardState Lite follows the user's physical Commander game. It does not replace
the table and it is not a comprehensive rules authority. BoardState remains the
advanced authority when a complete rules determination is required.

The operating model is: ARGUS sees what is there, Echo hears what happens,
Athena understands supported meaning, Turn Context records when it matters, and
Turn Memory preserves items that still need attention.

## Authority

The physical table is truth. The portable authority ordering is:

1. Explicit player input
2. Explicit battlefield reconciliation
3. High-confidence multimodal observation
4. Single-source observation
5. Athena inference

Explicit actions are committed without an Athena veto. Athena may surface
nonblocking information. Confirmation is reserved for machine uncertainty.

## Action Semantics

- **Game Action:** a physical game event happened. It may enter replacement,
  trigger, derived-state, and history processing.
- **Correction:** Lite's representation is reconciled to existing reality. It
  updates current and derived state but creates no gameplay triggers.
- **Observation:** a sensor or interpretation reports possible evidence. It is
  never canonical state by itself.

These semantics are defined in `src/domain/actionSemantics.ts` and are portable.

## ARGUS Boundary

ARGUS stores observations, snapshots, and canonical-event proposals in
`src/argus`. Camera capture and card recognition belong behind
`ArgusCapturePort` platform adapters.

An observation can be confirmed, probable, uncertain, or unknown. An
observation may create a proposal, but only proposal acceptance and canonical
event processing can mutate gameplay state. Snapshot reconciliation retains the
previous snapshot so rescans can match objects instead of duplicating them.

## Turn Context And Memory

`src/turn` owns shared turn state. The compact UI exposes Start, Main, Combat,
Main 2, and End while the model retains relevant Magic steps. **Start Turn** is
the canonical boundary for resetting turn-scoped state. Phase correction never
manufactures skipped-step triggers.

Turn Memory stores pending, resolved, declined, and possible missed trigger
items. Once-per-turn keys are deduplicated and reset only at Start Turn. The
land-play tracker supports an expected count greater than one and is a memory
aid rather than a legality gate.

## Trigger Watchers

Athena's relationship mapper and pending trigger queue remain the semantic
trigger engine. Turn Memory is the compact player-facing attention layer. It
does not parse Oracle text by keyword alone and it does not choose optional
actions for the player.

## Source And Effect Relationships

Manual static effects are stored with explicit source, target, modification,
duration, origin, and visibility. Their deterministic P/T layer is applied after
Athena's automatic derived layer so permanent, external-state, and custom table
sources share one portable calculation path. Derived-state explanations name
the contributing source. Keyword grants and removals are represented without
rewriting printed card identity.

When a source leaves the battlefield, its source-dependent definition becomes
inactive. Removing or disabling an effect recalculates derived state through the
same canonical store path.

## External Game State

Emblems, dungeons, Initiative, Monarch, Planechase, phenomena, Archenemy
schemes, ongoing schemes, day/night, City's Blessing, and custom table effects
are external state, not battlefield permanents. `ExternalGameState` preserves
dungeon progression, current Plane, planar die history, and ongoing Scheme
identity independently of permanent groups.

## Options And User Tools

- **Options** configure how Lite behaves: display, reminders, Full-Screen Life,
  Echo, personalization, privacy, backup, and application data.
- **User Tools** record or assist with the current physical game: Static
  Effects, External Game State, Dice, Coin, Battlefield Correction, Planner,
  and Turn Memory.

The two surfaces have separate modal identities and entry points.

## Randomizer Results

Random outcome generation is supplied by `RandomNumberSource`. The web adapter
uses platform cryptographic randomness when available. Animation only displays
an already-generated result. A result has one stable ID, source, timestamp, and
public/private marker so shared-session adapters distribute one canonical result
rather than generating independently on each client.

## Grouped Direct Adjustments

`src/domain/numericAdjustment.ts` defines the portable transaction semantics
used by life and commander-damage controls. Rapid taps and press-and-hold input
append to one active delta. Reversing direction changes the net delta from the
transaction's starting value. Presentation commits that net delta once after a
short inactivity window, so history, triggers, and Undo see one deliberate
transaction rather than one event per repeated input. Full-Screen Life and the
normal tracker use the same grouping behavior.

## Card Search Engine

`src/domain/cardSearch.ts` owns provider-neutral interpretation, structured
filters, typo tolerance, progressive fallback planning, deduplication, and
relevance ranking. Structural card properties substantially outrank incidental
Oracle or flavor text. Search interpretation remains advisory and appears as
removable chips rather than a confirmation step.

`src/services/scryfall.ts` is the Scryfall provider adapter. It translates the
portable request into staged provider queries, stops broadening after enough
strong candidates exist, caches merged results, and maps provider metadata back
to `CardIdentity`. A portable serialized rate gate keeps provider traffic below
Scryfall's published request ceiling. React search surfaces only own debounce, cancellation,
preview, pagination, filter presentation, and stale-response protection. All
card-selection workflows therefore reuse one engine without embedding Scryfall
syntax or ranking constants in views.

## Shared Visibility

Public permanents, counters, source/effect relationships, external public game
state, commander damage, and gameplay-relevant randomizer results are modeled
with stable identities for shared-session serialization. Private planner,
observation, or user-specific information must remain participant-scoped. New
state is serialized through the existing canonical field/session envelope.

## Platform Boundaries

Domain and state-machine modules do not depend on the DOM, browser persistence,
camera APIs, speech APIs, or CSS. This includes numeric adjustment transactions
and card-search interpretation/ranking. Web-only behavior remains in React
components and platform adapters. SwiftUI and Android implementations can
reproduce the same contracts with native capture, randomness, persistence,
audio, haptics, animation, and lifecycle adapters.
