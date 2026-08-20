import { describe, expect, it } from "vitest";
import { createGenericGroup } from "../domain/cards";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import type { FieldState, GameEvent } from "../domain/types";
import { AmbientGameplayEngine } from "../echo/ambientEngine";
import {
  addPlannedAction,
  recordPlannedActionExecution,
  setAvailableLandPlays,
  setPlannedActionStatus,
  syncPlannerWithAmbientMode,
} from "../echo/preTurnPlanner";
import { synchronizeActionStripWithPlanner } from "../echo/activeTurnActionStrip";
import {
  answerAthenaDecision,
  createAthenaDecisionRequest,
  enqueueAthenaDecision,
} from "./decisionEngine";
import { createAthenaPendingTriggerQueue } from "./triggerQueue";
import { executeAthenaPreparedAction } from "./turnIntent";
import type {
  AthenaPendingTriggerQueueSnapshot,
  AthenaTriggerInstance,
  AthenaTriggerQueueState,
} from "./triggerQueueTypes";
import {
  beginAthenaLiveTurnWork,
  completeAthenaLiveTurnWork,
  coordinateAthenaLiveTurnField,
  createDefaultAthenaLiveTurnState,
  normalizeAthenaLiveTurnState,
  reconcileAthenaLiveTurn,
  requestAthenaLiveTurnEnd,
} from "./liveTurnOrchestrator";

const timestamp = "2026-08-20T12:00:00.000Z";

describe("Athena Live Turn Orchestrator", () => {
  it("creates portable lifecycle state without canonical mutation authority", () => {
    const state = createDefaultAthenaLiveTurnState({ updatedAt: timestamp });

    expect(state).toMatchObject({
      lifecycle: "pre-turn-preparation",
      directBattlefieldMutation: false,
      rulesAuthorityTransferred: false,
      inFlightWork: null,
    });
    expect(JSON.stringify(state)).not.toMatch(
      /window|document|navigator|HTMLElement|localStorage|sessionStorage|indexedDB/,
    );
  });

  it("loads prepared turn intent and becomes ready to begin", () => {
    const field = plannerField([
      { id: "forest", type: "land-play", title: "Forest" },
    ]);
    const result = reconcileAthenaLiveTurn(field, { timestamp });

    expect(result.state.lifecycle).toBe("ready-to-begin");
    expect(result.selectedActionId).toBeTruthy();
    expect(result.state.turnId).toBe(field.preTurnPlanner.turnId);
  });

  it("starts a live turn and focuses the first useful action", () => {
    const field = activeField(
      plannerField([
        { id: "forest", type: "land-play", title: "Forest" },
        { id: "sol-ring", type: "spell-sequence", title: "Sol Ring" },
      ]),
    );
    const result = reconcileAthenaLiveTurn(field, {
      signal: "turn-started",
      timestamp,
    });

    expect(result.state.lifecycle).toBe("turn-active");
    expect(result.state.startedAt).toBe(timestamp);
    expect(result.state.semanticEvents).toContain("live-turn-started");
    expect(result.selectedActionId).toBe(
      field.activeTurnActionStrip.items.find(
        (item) => item.status === "current",
      )?.id,
    );
  });

  it("blocks explicit action dependencies until their prerequisite completes", () => {
    let field = plannerField([
      { id: "source", type: "spell-sequence", title: "Sol Ring" },
      {
        id: "dependent",
        type: "activated-ability",
        title: "Use Sol Ring",
        dependencyIds: ["source"],
      },
    ]);
    field = activeField(field);
    const blocked = coordinateAthenaLiveTurnField(field, { timestamp });
    const blockedItem = blocked.activeTurnActionStrip.items.find(
      (item) => item.sourceActionId === "dependent",
    );
    expect(blockedItem).toMatchObject({ status: "blocked" });
    expect(blockedItem?.blockedReason).toBe("dependency:source");

    const planner = setPlannedActionStatus(
      blocked.preTurnPlanner,
      "source",
      "completed",
      timestamp,
    );
    const released = coordinateAthenaLiveTurnField(
      withPlanner(blocked, planner, "activeTurn"),
      { timestamp },
    );
    expect(
      released.activeTurnActionStrip.items.find(
        (item) => item.sourceActionId === "dependent",
      )?.status,
    ).not.toBe("blocked");
  });

  it("automatically focuses the next action after a prepared action completes", () => {
    let field = activeField(
      plannerField([
        { id: "first", type: "land-play", title: "Forest" },
        { id: "second", type: "spell-sequence", title: "Sol Ring" },
      ]),
    );
    const first = field.preTurnPlanner.actions.find(
      (action) => action.id === "first",
    )!;
    const planner = recordPlannedActionExecution(
      field.preTurnPlanner,
      first.id,
      {
        timestamp,
        confirmationReceiptId: "receipt:first",
        canonicalEventIds: ["event:first"],
      },
    );
    field = withPlanner(field, planner, "activeTurn");
    const result = reconcileAthenaLiveTurn(field, {
      signal: "action-completed",
      actionId: "first",
      preparedActionId: first.prepared.preparedActionId,
      confirmationReceiptId: "receipt:first",
      canonicalEvents: [event("event:first", "land-entered")],
      timestamp,
    });

    expect(result.state.completedPreparedActionIds).toContain(
      first.prepared.preparedActionId,
    );
    expect(result.state.confirmationReceiptIds).toEqual(["receipt:first"]);
    expect(result.state.processedCanonicalEventIds).toContain("event:first");
    expect(result.state.currentPreparedActionId).not.toBe(
      first.prepared.preparedActionId,
    );
  });

  it("pauses only at a required decision and resumes after the answer", () => {
    let field = activeField(plannerField([]));
    const request = createAthenaDecisionRequest({
      id: "decision-target",
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      type: "yes-no",
      prompt: "Use this required branch?",
      stateFingerprint: "state",
      timestamp,
    });
    field = {
      ...field,
      athena: {
        ...field.athena,
        decisions: enqueueAthenaDecision(
          field.athena.decisions,
          request,
          timestamp,
        ),
      },
    };
    const paused = coordinateAthenaLiveTurnField(field, {
      signal: "decision-created",
      timestamp,
    });
    expect(paused.athena.liveTurn.lifecycle).toBe("awaiting-decision");
    expect(paused.athena.liveTurn.blockingDecisionId).toBe(request.id);
    expect(paused.athena.liveTurn.semanticEvents).toContain("decision-paused");

    const response = answerAthenaDecision(
      paused.athena.decisions,
      request.id,
      {
        accepted: true,
        channel: "touch",
        answeredAt: timestamp,
      },
      paused,
      timestamp,
    );
    const resumed = coordinateAthenaLiveTurnField(
      {
        ...paused,
        athena: { ...paused.athena, decisions: response.queue },
      },
      { signal: "decision-answered", timestamp },
    );
    expect(resumed.athena.liveTurn.blockingDecisionId).toBeNull();
    expect(resumed.athena.liveTurn.lifecycle).toBe("ready-for-next-action");
    expect(resumed.athena.liveTurn.semanticEvents).toContain(
      "decision-resumed",
    );
  });

  it("blocks End Turn for unresolved actual trigger bookkeeping", () => {
    const field = activeField(plannerField([]));
    const queue = queueSnapshot(field, "pending", "trigger-pending");
    const coordinated = coordinateAthenaLiveTurnField(field, {
      signal: "consequences-processing",
      queue,
      timestamp,
    });
    const end = requestAthenaLiveTurnEnd(coordinated, timestamp);

    expect(end.allowed).toBe(false);
    expect(end.blockers[0]).toMatchObject({ kind: "pending-trigger" });
    expect(end.state.lifecycle).toBe("turn-reconciliation");
  });

  it("does not block End Turn for merely unperformed planner intent", () => {
    const field = activeField(
      plannerField([
        { id: "forest", type: "land-play", title: "Forest" },
        { id: "combat", type: "planned-attack", title: "Combat" },
      ]),
    );
    const end = requestAthenaLiveTurnEnd(field, timestamp);

    expect(end.allowed).toBe(true);
    expect(end.blockers).toEqual([]);
  });

  it.each([
    ["authority-required", "authority"],
    ["manual-resolution-required", "manual-result"],
    ["failed-safe", "processing-failure"],
  ] as const)("preserves %s queue work as a %s blocker", (queueState, kind) => {
    const field = activeField(plannerField([]));
    const coordinated = coordinateAthenaLiveTurnField(field, {
      queue: queueSnapshot(field, queueState, `trigger-${queueState}`),
      timestamp,
    });

    expect(coordinated.athena.liveTurn.blockers).toContainEqual(
      expect.objectContaining({ kind }),
    );
  });

  it("hands off to existing combat mode without phase enforcement", () => {
    const field = activeField(plannerField([]));
    const engine = new AmbientGameplayEngine(field.ambient);
    const transition = engine.requestTransition({
      targetMode: "combat",
      reason: "combat-started",
      timestamp,
    });
    const combat = coordinateAthenaLiveTurnField(
      { ...field, ambient: transition.state },
      { signal: "combat-started", timestamp },
    );

    expect(combat.athena.liveTurn.lifecycle).toBe("combat-active");
    expect(combat.athena.liveTurn.phase).toBe("combat");
    expect(combat.combatDeclaration).toBe(field.combatDeclaration);
  });

  it("returns to second main after existing combat reconciliation", () => {
    let field = activeField(plannerField([]));
    field = coordinateAthenaLiveTurnField(field, {
      signal: "combat-started",
      timestamp,
    });
    field = {
      ...field,
      athena: {
        ...field.athena,
        liveTurn: {
          ...field.athena.liveTurn,
          lifecycle: "combat-active",
          phase: "combat",
        },
      },
    };
    const result = reconcileAthenaLiveTurn(field, {
      signal: "combat-completed",
      timestamp,
    });

    expect(result.state.lifecycle).toBe("combat-reconciliation");
    const settled = reconcileAthenaLiveTurn(
      {
        ...field,
        athena: { ...field.athena, liveTurn: result.state },
      },
      { timestamp },
    );
    expect(settled.state.phase).toBe("postcombat-main");
    expect(settled.state.lifecycle).toBe("second-main");
  });

  it("accepts an unexpected physical action without restarting the plan", () => {
    const field = activeField(
      plannerField([
        { id: "forest", type: "land-play", title: "Forest" },
        { id: "spell", type: "spell-sequence", title: "Soul Warden" },
      ]),
    );
    const result = reconcileAthenaLiveTurn(field, {
      signal: "unexpected-action",
      canonicalEvents: [event("event:mountain", "land-entered")],
      timestamp,
    });

    expect(result.state.unexpectedCanonicalEventIds).toEqual([
      "event:mountain",
    ]);
    expect(field.preTurnPlanner.actions).toHaveLength(2);
    expect(result.state.diagnostics.unexpectedActionsProcessed).toBe(1);
  });

  it("keeps Available Land Plays as plan state with no event side effect", () => {
    const field = activeField(plannerField([]));
    const groups = field.groups;
    const planner = setAvailableLandPlays(
      field.preTurnPlanner,
      2,
      timestamp,
      "manual-planner",
    );
    const coordinated = coordinateAthenaLiveTurnField(
      withPlanner(field, planner, "activeTurn"),
      { timestamp },
    );

    expect(coordinated.preTurnPlanner.availableLandPlays.remaining).toBe(2);
    expect(coordinated.groups).toEqual(groups);
    expect(coordinated.athena.liveTurn.processedCanonicalEventIds).toEqual([]);
  });

  it("records confirmed draw quantity through the canonical Athena pipeline", () => {
    const base = plannerField([]);
    const field = activeField({
      ...base,
      groups: [
        ...base.groups,
        createGenericGroup({
          kind: "Custom",
          label: "Library cards",
          quantity: 60,
          zone: "library",
        }),
      ],
    });
    const draw = field.activeTurnActionStrip.items.find(
      (item) => item.kind === "draw",
    );
    if (!draw) throw new Error("Missing live draw action.");
    const result = executeAthenaPreparedAction({
      field,
      item: draw,
      queue: createAthenaPendingTriggerQueue({
        canonicalSessionId: field.session.id,
        participantId: field.multiplayer.registry.localParticipantId,
        timestamp,
      }),
      channel: "voice",
      speakerVerified: true,
      recognizedText: "Draw two",
      timestamp,
    });

    expect(result.status).toBe("committed");
    expect(result.canonicalEvents[0]).toMatchObject({
      type: "cards-drawn",
      quantity: 2,
      zoneOrigin: "library",
      zoneDestination: "hand",
    });
    expect(
      result.field.groups
        .filter((group) => group.zone === "hand")
        .reduce((sum, group) => sum + group.quantity, 0),
    ).toBe(2);
    expect(
      result.field.groups
        .filter((group) => group.zone === "library")
        .reduce((sum, group) => sum + group.quantity, 0),
    ).toBe(58);
  });

  it("rejects stale asynchronous work without overwriting newer state", () => {
    const base = createDefaultAthenaLiveTurnState({
      sessionId: "session",
      participantId: "player",
      turnId: "turn",
      updatedAt: timestamp,
    });
    const first = beginAthenaLiveTurnWork(base, {
      actionId: "first",
      timestamp,
    });
    const second = beginAthenaLiveTurnWork(first.state, {
      actionId: "second",
      timestamp,
    });
    const stale = completeAthenaLiveTurnWork(
      second.state,
      first.token,
      timestamp,
    );

    expect(stale.accepted).toBe(false);
    expect(stale.stale).toBe(true);
    expect(stale.state.inFlightWork?.id).toBe(second.token.id);
    expect(stale.state.diagnostics.staleWorkRejections).toBe(1);
  });

  it("tracks duplicate confirmation receipts without duplicating identity", () => {
    let field = activeField(plannerField([]));
    field = coordinateAthenaLiveTurnField(field, {
      signal: "action-completed",
      confirmationReceiptId: "receipt:draw",
      canonicalEvents: [event("event:draw", "cards-drawn")],
      timestamp,
    });
    field = coordinateAthenaLiveTurnField(field, {
      signal: "action-completed",
      confirmationReceiptId: "receipt:draw",
      canonicalEvents: [event("event:draw", "cards-drawn")],
      timestamp,
    });

    expect(field.athena.liveTurn.confirmationReceiptIds).toEqual([
      "receipt:draw",
    ]);
    expect(field.athena.liveTurn.processedCanonicalEventIds).toEqual([
      "event:draw",
    ]);
    expect(field.athena.liveTurn.diagnostics.duplicateActionPreventions).toBe(
      1,
    );
  });

  it("recovers persisted transient processing without retaining a lock", () => {
    const base = createDefaultAthenaLiveTurnState({
      sessionId: "session",
      participantId: "player",
      turnId: "turn",
      updatedAt: timestamp,
    });
    const processing = beginAthenaLiveTurnWork(base, {
      actionId: "forest",
      timestamp,
    }).state;
    const restored = normalizeAthenaLiveTurnState(processing, {
      sessionId: "session",
      participantId: "player",
      turnId: "turn",
      timestamp,
    });

    expect(restored.lifecycle).toBe("recovering");
    expect(restored.inFlightWork).toBeNull();
    expect(restored.diagnostics.recoveryCount).toBe(1);
  });

  it("rejects an old turn or session during restoration", () => {
    const old = createDefaultAthenaLiveTurnState({
      sessionId: "old-session",
      participantId: "player",
      turnId: "old-turn",
      lifecycle: "turn-active",
      startedAt: timestamp,
      updatedAt: timestamp,
    });
    const restored = normalizeAthenaLiveTurnState(old, {
      sessionId: "new-session",
      participantId: "player",
      turnId: "new-turn",
      timestamp,
    });

    expect(restored.sessionId).toBe("new-session");
    expect(restored.turnId).toBe("new-turn");
    expect(restored.lifecycle).toBe("recovering");
    expect(restored.completedPreparedActionIds).toEqual([]);
  });

  it("completes and archives turn lifecycle when Echo enters post-turn", () => {
    let field = activeField(plannerField([]));
    const engine = new AmbientGameplayEngine(field.ambient);
    const transition = engine.requestTransition({
      targetMode: "postTurn",
      reason: "phase-changed",
      timestamp,
    });
    field = { ...field, ambient: transition.state };
    const result = reconcileAthenaLiveTurn(field, {
      signal: "turn-completed",
      timestamp,
    });

    expect(result.state.lifecycle).toBe("completed");
    expect(result.state.completedAt).toBe(timestamp);
    expect(result.state.semanticEvents).toContain("live-turn-completed");
  });

  it("bounds checkpoints and event identity history for long sessions", () => {
    let field = activeField(plannerField([]));
    for (let index = 0; index < 520; index += 1) {
      field = coordinateAthenaLiveTurnField(field, {
        signal: "unexpected-action",
        canonicalEvents: [event(`event:${index}`, "spell-cast")],
        timestamp: `2026-08-20T12:${String(index % 60).padStart(2, "0")}:00.000Z`,
      });
    }

    expect(field.athena.liveTurn.checkpoints.length).toBeLessThanOrEqual(24);
    expect(
      field.athena.liveTurn.processedCanonicalEventIds.length,
    ).toBeLessThanOrEqual(400);
    expect(field.athena.liveTurn.processedCanonicalEventIds.at(-1)).toBe(
      "event:519",
    );
  });

  it("keeps grouped token quantities grouped while coordinating a large plan", () => {
    const tokens = createGenericGroup({
      kind: "Token",
      label: "Treasure",
      quantity: 1_000,
      cardTypes: ["Artifact"],
      subtypes: ["Treasure"],
      token: true,
    });
    let field = plannerField(
      Array.from({ length: 20 }, (_, index) => ({
        id: `action-${index}`,
        type: "spell-sequence" as const,
        title: `Spell ${index}`,
      })),
    );
    field = activeField({ ...field, groups: [tokens] });
    const coordinated = coordinateAthenaLiveTurnField(field, { timestamp });

    expect(coordinated.groups).toHaveLength(1);
    expect(coordinated.groups[0].quantity).toBe(1_000);
    expect(coordinated.preTurnPlanner.actions).toHaveLength(20);
  });

  it("serializes structured checkpoints without functions or closures", () => {
    const field = activeField(plannerField([]));
    const coordinated = coordinateAthenaLiveTurnField(field, {
      signal: "turn-started",
      timestamp,
    });
    const roundTrip = JSON.parse(
      JSON.stringify(coordinated.athena.liveTurn),
    ) as unknown;
    const restored = normalizeAthenaLiveTurnState(roundTrip, {
      sessionId: field.session.id,
      participantId: field.multiplayer.registry.localParticipantId,
      turnId: field.preTurnPlanner.turnId,
      timestamp,
      recoverTransientWork: false,
    });

    expect(restored.checkpoints.length).toBeGreaterThan(0);
    expect(JSON.stringify(restored)).not.toContain("function");
  });

  it("persists current turn state and migrates older saves nondestructively", () => {
    const field = coordinateAthenaLiveTurnField(activeField(plannerField([])), {
      signal: "turn-started",
      timestamp,
    });
    const restored = sanitizeImportedField(structuredClone(field));
    expect(restored?.athena.liveTurn.turnId).toBe(field.preTurnPlanner.turnId);
    expect(restored?.athena.liveTurn.startedAt).toBe(timestamp);

    const legacy = structuredClone(field) as unknown as {
      athena: Partial<FieldState["athena"]>;
    };
    delete legacy.athena.liveTurn;
    const migrated = sanitizeImportedField(legacy);
    expect(migrated?.athena.liveTurn.sessionId).toBe(field.session.id);
    expect(migrated?.athena.liveTurn.inFlightWork).toBeNull();
    expect(migrated?.groups).toEqual(field.groups);
  });
});

function plannerField(
  actions: Array<
    Parameters<typeof addPlannedAction>[1] & { id: string; title: string }
  >,
): FieldState {
  let field = createDefaultField();
  let planner = field.preTurnPlanner;
  for (const action of actions) {
    planner = addPlannedAction(planner, action, timestamp);
  }
  planner = syncPlannerWithAmbientMode(
    planner,
    "preTurnPreparation",
    timestamp,
  );
  field = normalizeField({
    ...field,
    updatedAt: timestamp,
    ambient: transitionAmbient(field, "preTurnPreparation"),
    preTurnPlanner: planner,
  });
  return withPlanner(field, planner, "preTurnPreparation");
}

function activeField(field: FieldState): FieldState {
  const ambient = transitionAmbient(field, "activeTurn");
  return withPlanner(
    { ...field, ambient },
    syncPlannerWithAmbientMode(field.preTurnPlanner, "activeTurn", timestamp),
    "activeTurn",
  );
}

function withPlanner(
  field: FieldState,
  planner: FieldState["preTurnPlanner"],
  mode: FieldState["ambient"]["currentMode"],
): FieldState {
  return {
    ...field,
    preTurnPlanner: planner,
    activeTurnActionStrip: synchronizeActionStripWithPlanner(
      field.activeTurnActionStrip,
      {
        planner,
        ambientMode: mode,
        timestamp,
        sessionId: field.session.id,
      },
    ),
  };
}

function transitionAmbient(
  field: FieldState,
  targetMode: "preTurnPreparation" | "activeTurn",
): FieldState["ambient"] {
  const engine = new AmbientGameplayEngine(field.ambient);
  const result = engine.requestTransition({
    targetMode,
    reason: "manual",
    timestamp,
  });
  return result.ok ? result.state : field.ambient;
}

function queueSnapshot(
  field: FieldState,
  queueState: AthenaTriggerQueueState,
  id: string,
): AthenaPendingTriggerQueueSnapshot {
  const snapshot = createAthenaPendingTriggerQueue({
    canonicalSessionId: field.session.id,
    participantId: field.multiplayer.registry.localParticipantId,
    timestamp,
  }).toSnapshot();
  return {
    ...snapshot,
    entries: [{ id, queueState } as AthenaTriggerInstance],
  };
}

function event(id: string, type: GameEvent["type"]): GameEvent {
  return {
    id,
    type,
    sourceId: null,
    controller: "you",
    owner: "you",
    quantity: 1,
    batchId: id,
    groupIds: [],
    zoneDestination: type === "land-entered" ? "battlefield" : undefined,
    metadata: { confirmed: true },
  };
}
