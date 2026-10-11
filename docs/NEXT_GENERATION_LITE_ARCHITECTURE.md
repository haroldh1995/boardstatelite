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

### Interaction Ownership And Session Boundaries

`domain/interactions.ts` owns one active press at a time. `HoldRepeater` uses an
injected scheduler and generation invalidation: cancellation invalidates even an
already queued callback. The web `usePressLifetime` adapter ends ownership on
release, capture loss, touch cancellation, blur, page hiding, unmount, and
presentation changes. Native adapters must forward their equivalent lifecycle
events. Life, commander damage, counters, token quantity and player resources
share this primitive. Numeric transaction grouping is independent of repetition.
Committing clears the transaction before invoking gameplay code; New Game discards
it before replacing the session. Direction changes cancel the previous repeater
but retain the net transaction delta.

Full-Screen Life is store-owned presentation state, separate from its persistent
Options preference. The magnification adapter accepts only an unobstructed
two-finger gesture after an intent threshold. Options, sheets, controls and text
entry are excluded. A keyboard/screen-reader action provides the same transition.
Neither transition creates a game event. New Game returns to standard presentation
without changing the preference used at the next app launch.

`domain/sessionLifecycle.ts` creates a fresh game and retains explicit app/profile
preferences. New Game clears game, turn, deck association, session recent cards,
observations, histories and undo state. It does not delete card caches or voice
enrollment. Start Turn resets only turn-scoped state. Persistence serializes
durable writes and updates the latest fallback synchronously, preventing an older
in-flight save from becoming the restored session after New Game.

### Battlefield Intelligence And Available Actions

`domain/battlefieldIndex.ts` derives quantities and contributor IDs exclusively
from canonical battlefield groups, including stack quantities and current
characteristics. Basic lands require the Basic supertype. Turn land plays are
separate planner state and are never decremented when a land leaves. User Tools /
Battlefield Counts derives a fresh snapshot on open and every canonical group
change; drill-down references those same groups. Land breakdown is a press-lifetime
peek, with the complete breakdown also included in its accessible label.

Available tap actions are derived from current identified Oracle abilities,
tracking state and tap state. One affordance opens the available actions. Recording
an activation splits one object from a stack if necessary. Deterministically
supported outcomes flow through the existing Athena event/bookkeeping boundary;
unmodeled costs and outcomes remain pending manual resolution, never fake tokens.
Summoning restrictions are advisory, not a veto. The affordance model can host
additional action kinds without adding multiple artwork badges.

### Deck Nexus Consumption And Privacy

The existing Hub integration manager exposes `DeckNexusPort`. A host supplies
authenticated `listDecks` and `snapshot` transport implementations. This repository
does not contain a deployed authenticated Deck Nexus API or its credentials;
the standalone adapter therefore reports unavailable and offers Play Without Deck.
It does not read another application's storage or fabricate saved decks.

Transport data is normalized into a detached `SessionDeckSnapshot` and rich
`DeckCardSnapshot` identities. A session snapshot remains usable offline and is
changed only by explicit selection/disconnection. Those operations never rewrite
the battlefield; gameplay undo also preserves the selected deck. New Game clears
the old association before selection. Saved deck metadata and recent-card history
are private and are excluded from the public gameplay projection.

`services/cardSearch.ts` composes the existing progressive provider engine with
portable contextual ranking. My Deck is a local fast path with basic-land access
and an immediate All Cards alternative. Exact names remain the highest ranking
tier. Deck presence and relevant session history add positive evidence; absence
never subtracts confidence or prohibits adding a card. Current provider data wins
over stale snapshot metadata when merging. Echo reuses its existing deck-candidate
contract; ARGUS corroboration can raise an uncertain observation to probable but
does not accept it or manufacture canonical state.

Native camera, speech, magnification and real-device validation remain platform
adapter responsibilities. The portable contracts and web lifecycle tests do not
constitute an iOS/Android hardware validation claim.

Domain and state-machine modules do not depend on the DOM, browser persistence,
camera APIs, speech APIs, or CSS. This includes numeric adjustment transactions
and card-search interpretation/ranking. Web-only behavior remains in React
components and platform adapters. SwiftUI and Android implementations can
reproduce the same contracts with native capture, randomness, persistence,
audio, haptics, animation, and lifecycle adapters.
