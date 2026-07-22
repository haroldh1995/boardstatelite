import { describe, expect, it } from "vitest";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { setLife as resolveSetLife } from "../domain/engine";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { useFieldStore } from "../state/useFieldStore";
import {
  AmbientEventPipeline,
  createAmbientIntent,
} from "./ambientEventPipeline";
import {
  addPlannedAction,
  clearAllPlans,
  clearCompletedPlans,
  createActionStripPlan,
  createDefaultPreTurnPlannerState,
  getPreTurnPlannerAvailability,
  getPreTurnPlannerDiagnostics,
  plannedActionToAmbientIntent,
  removePlannedAction,
  reorderPlannedAction,
  resetPreTurnPlanner,
  setPlannedActionStatus,
  setPlannerGroupCollapsed,
  syncPlannerWithAmbientMode,
  updatePlannedAction,
} from "./preTurnPlanner";

const timestamp = "2026-07-21T00:00:00.000Z";

describe("One-Minute Pre-Turn Planner", () => {
  it("creates an empty local planner without battlefield side effects", () => {
    const field = createDefaultField();
    const planner = createDefaultPreTurnPlannerState({
      timestamp,
      sessionId: field.session.id,
    });

    expect(planner).toMatchObject({
      status: "empty",
      sessionId: field.session.id,
      lifecycle: {
        availability: "available",
        readOnly: false,
      },
      actionStrip: { preparedActionIds: [] },
    });
    expect(getPreTurnPlannerDiagnostics(planner)).toMatchObject({
      actionCount: 0,
      activeActionCount: 0,
    });
    expect(field.groups).toHaveLength(1);
  });

  it("adds, edits, reorders, completes, skips, cancels, and clears planned actions", () => {
    let planner = createDefaultPreTurnPlannerState({ timestamp });
    planner = addPlannedAction(
      planner,
      {
        type: "land-play",
        title: "Play Command Tower",
        notes: "Hold if landfall timing matters",
        reminders: ["Remember landfall"],
        land: {
          primary: "Command Tower",
          alternatives: ["Forest"],
          intentionallyHeld: false,
        },
      },
      timestamp,
    );
    planner = addPlannedAction(
      planner,
      {
        type: "spell-sequence",
        title: "Cast commander",
        dependencyIds: [planner.actions[0].id],
        mana: { generic: 2, red: 1, white: 1, notes: "Use treasure last" },
      },
      "2026-07-21T00:00:01.000Z",
    );
    planner = updatePlannedAction(
      planner,
      planner.actions[1].id,
      { notes: "Cast before combat" },
      "2026-07-21T00:00:02.000Z",
    );
    planner = reorderPlannedAction(
      planner,
      planner.actions[1].id,
      -1,
      "2026-07-21T00:00:03.000Z",
    );

    expect(planner.actions.map((action) => action.title)).toEqual([
      "Cast commander",
      "Play Command Tower",
    ]);
    expect(planner.actions[0].notes).toBe("Cast before combat");

    planner = setPlannedActionStatus(
      planner,
      planner.actions[0].id,
      "completed",
      "2026-07-21T00:00:04.000Z",
    );
    planner = setPlannedActionStatus(
      planner,
      planner.actions[1].id,
      "skipped",
      "2026-07-21T00:00:05.000Z",
    );
    planner = clearCompletedPlans(planner, "2026-07-21T00:00:06.000Z");

    expect(planner.actions).toHaveLength(1);
    expect(planner.actions[0]).toMatchObject({
      title: "Play Command Tower",
      status: "skipped",
      skipped: true,
    });

    planner = setPlannedActionStatus(
      planner,
      planner.actions[0].id,
      "cancelled",
      "2026-07-21T00:00:07.000Z",
    );
    expect(planner.actions[0].cancelled).toBe(true);
    expect(clearAllPlans(planner).actions).toHaveLength(0);
    expect(resetPreTurnPlanner(planner).status).toBe("empty");
  });

  it("keeps dependent actions editable when earlier actions are removed", () => {
    let planner = createDefaultPreTurnPlannerState({ timestamp });
    planner = addPlannedAction(planner, {
      id: "play-land",
      type: "land-play",
      title: "Play land",
    });
    planner = addPlannedAction(planner, {
      id: "cast-spell",
      type: "spell-sequence",
      title: "Cast spell",
      dependencyIds: ["play-land"],
    });
    planner = removePlannedAction(planner, "play-land");

    expect(planner.actions).toHaveLength(1);
    expect(planner.actions[0]).toMatchObject({
      id: "cast-spell",
      title: "Cast spell",
      dependencyIds: [],
    });
  });

  it("tracks planner group collapse state without changing actions", () => {
    const planner = addPlannedAction(createDefaultPreTurnPlannerState(), {
      type: "trigger-reminder",
      title: "Do upkeep trigger",
    });
    const collapsed = setPlannerGroupCollapsed(
      planner,
      "trigger-reminder",
      true,
    );

    expect(collapsed.collapsedGroups["trigger-reminder"]).toBe(true);
    expect(collapsed.actions).toEqual(planner.actions);
  });

  it("maps ambient modes to planner lifecycle availability", () => {
    expect(getPreTurnPlannerAvailability("passive")).toBe("available");
    expect(getPreTurnPlannerAvailability("preTurnPreparation")).toBe("primary");
    expect(getPreTurnPlannerAvailability("activeTurn")).toBe("read-only");
    expect(getPreTurnPlannerAvailability("combat")).toBe("minimized");
    expect(getPreTurnPlannerAvailability("resolution")).toBe("unavailable");
    expect(getPreTurnPlannerAvailability("recovery")).toBe("recovery");

    const planner = createDefaultPreTurnPlannerState();
    const active = syncPlannerWithAmbientMode(planner, "activeTurn", timestamp);
    const recovery = syncPlannerWithAmbientMode(active, "recovery", timestamp);

    expect(active.lifecycle.readOnly).toBe(true);
    expect(recovery.lifecycle).toMatchObject({
      availability: "recovery",
      readOnly: true,
    });
  });

  it("prepares future action strip items and Ambient intents without executing them", () => {
    const field = createDefaultField();
    const group = field.groups[0];
    const planner = addPlannedAction(field.preTurnPlanner, {
      id: "counter-plan",
      type: "counter-placement",
      title: "Add counters after landfall",
      relatedGroupId: group.id,
      reminders: ["Use Correction Only if this is bookkeeping"],
    });
    const { items } = createActionStripPlan(planner, timestamp);
    const intentInput = plannedActionToAmbientIntent(planner.actions[0]);
    const pipeline = new AmbientEventPipeline();
    const preview = pipeline.process({
      field,
      intent: intentInput,
      approval: { method: "manual" },
      mutation: ({ field: current }) => resolveSetLife(current, 99, "set"),
    });

    expect(items).toHaveLength(1);
    expect(items[0].intent).toMatchObject({
      source: "turn-planner",
      confidence: "medium",
      requiresPreview: true,
    });
    expect(createAmbientIntent(intentInput).source).toBe("turn-planner");
    expect(preview.status).toBe("preview");
    expect(preview.field.player.life).toBe(40);
  });

  it("persists through normalization, migration, snapshots, and imports", () => {
    let field = createDefaultField();
    field = normalizeField({
      ...field,
      preTurnPlanner: addPlannedAction(field.preTurnPlanner, {
        id: "stored-plan",
        type: "end-step-reminder",
        title: "Hold up interaction",
        notes: "Use removal before end step",
      }),
    });

    const normalized = normalizeField(structuredClone(field));
    const imported = sanitizeImportedField(structuredClone(field));
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.preTurnPlanner;
    const migrated = sanitizeImportedField(legacy);
    const snapshot = createLiteFieldSnapshot(normalized);

    expect(normalized.preTurnPlanner.actions[0].id).toBe("stored-plan");
    expect(imported?.preTurnPlanner.actions[0].title).toBe(
      "Hold up interaction",
    );
    expect(migrated?.preTurnPlanner.status).toBe("empty");
    expect(snapshot.preTurnPlanner.actions[0].id).toBe("stored-plan");
  });

  it("uses the Lite store without changing battlefield undo history or executing actions", () => {
    const field = createDefaultField();
    useFieldStore.setState({
      field,
      hydrated: true,
      startupVisible: false,
      modal: null,
      lastResult: null,
      undoStack: [],
      redoStack: [],
    });

    useFieldStore.getState().plannerAddAction({
      type: "planned-attack",
      title: "Attack after counters",
      relatedGroupId: field.groups[0].id,
    });

    const state = useFieldStore.getState();
    expect(state.field.preTurnPlanner.actions).toHaveLength(1);
    expect(state.field.ambient.currentMode).toBe("preTurnPreparation");
    expect(state.field.groups).toEqual(field.groups);
    expect(state.undoStack).toHaveLength(0);

    useFieldStore
      .getState()
      .plannerSetActionStatus(
        state.field.preTurnPlanner.actions[0].id,
        "completed",
      );
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("completed");
  });
});
