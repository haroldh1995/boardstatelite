# Ability Automation and Turn-Only Gameplay

## Authority and State

The physical table remains authoritative. Ability Focus is local presentation
state, switched through the existing Activate Field control. It never changes
the session, turn, life, or Undo history. Normal gameplay no longer exposes phase
selectors. Legacy phase fields remain import/adapter compatibility data, not proof
of sorcery timing. Start Turn is idempotent while a turn is active. End Turn does
not invent an opponent's turn boundary. Once-per-game usage survives both.

`abilityMetadata` parses bounded Oracle paragraphs and caches syntax only. Live
availability reads permanent-instance usage, tap state and loyalty. Sorcery speed
is advisory. Restricted abilities remain inspectable and physical activations can
be recorded manually. Individual stack members are separated before paying costs
and receive stable instance identity so normalization cannot merge used copies.
Supported quoted static grants retain the granting source in ability identity.

## One Workflow

Both triggered and activated selections create an `AbilityWorkflow` payload on
the existing Turn Memory item. There is no separate queue or state store.
The workflow distinguishes selection, committed costs, pending resolution,
resolved, manual and cancelled states. Choices and ability text survive session
restore. Closing a sheet does not resolve anything. New Game clears memory and
usage while preserving Options, counter layouts and tutorial preferences.

`abilityInstructions` is a bounded full-clause compiler. It reuses the existing
life/token classifier; `abilityWorkflow` uses Athena's target candidate builder
and canonical consequence pipeline. It does not mutate counters, life or zones
through presentation code. Targets and modes are collected before activation,
and reused at resolution. Optional decisions are never filled by an automation
profile. Sacrifice/discard selections, explicit counter distributions, external
target references, and mana-payment acknowledgment are represented separately.
Unsupported conditional text stays manual, including reflexive "when you do"
instructions rather than flattening them into unconditional outcomes.

Costs and resolution are different Undo transactions. Cancelling a pending effect
does not undo its costs. An interrupted selection pays nothing. Each commit has
stable consequence IDs, and terminal workflows reject repeated application.
Unresolved workflows remain in Turn Memory across turn transitions.

## Recovery, Privacy and Portability

Game Activity stores a bounded explanation of committed actions, not a second
gameplay history. Review Last Action uses the existing full-transaction Undo and
reapply path; it does not attempt unsafe partial reversal. Local activity and
private workflow choices are excluded from public session projections. Public
trigger summaries do not serialize hand-card decisions or deck snapshots.

Oracle parsing, restrictions, instructions and transitions contain no browser
APIs. React pointer events and images remain presentation adapters. Persistence
continues through existing platform ports. No new network dependency is needed
for cached-card activations, life, counters, dungeons or pending resolution.

Manual and Assisted profiles require review of inferred ambient actions;
Automatic retains the existing confidence policy. Explicit manual commands do
not acquire new confirmation barriers. ARGUS proposals use the same conservative
profile boundary; observations remain separate from canonical state.

## Rules Reference and Scope

Reviewed against the [official Comprehensive Rules, September 25, 2026](https://media.wizards.com/2026/downloads/MagicCompRules%2020260925.txt),
particularly 602 (activation), 603 (triggering/reflexive triggers), and 606
(loyalty). Current document discovery uses the [official rules page](https://magic.wizards.com/en/rules).

This is not a full rules interpreter. Complex free-form costs, arbitrary granted
ability templates, hidden information, cost modifiers, replacement-dependent
choices and reflexive-trigger continuation still require table resolution.
Unknown text must not be described as fully automated. Current opponent life
totals are not invented when Lite does not manage them.
