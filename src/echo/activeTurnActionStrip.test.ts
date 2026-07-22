import { describe, expect, it } from "vitest";
import {
  createDefaultField,
  normalizeField,
  sanitizeImportedField,
} from "../domain/field";
import { createLiteFieldSnapshot } from "../rulesAdapter";
import { useFieldStore } from "../state/useFieldStore";
import { AmbientGameplayEngine } from "./ambientEngine";
import {
  addPlannedAction,
  setPlannedActionStatus,
  syncPlannerWithAmbientMode,
} from "./preTurnPlanner";
import {
  clearCompletedActionStripItems,
  createDefaultActiveTurnActionStripState,
  getActionStripDiagnostics,
  reorderActionStripItem,
  setActionStripCompletedCollapsed,
  setActionStripExpanded,
  setActionStripItemStatus,
  synchronizeActionStripWithPlanner,
} from "./activeTurnActionStrip";

const timestamp = "2026-07-21T00:00:00.000Z";

describe("Active Turn Action Strip", () => {
  it("starts hidden and creates a pre-turn preview from planner actions", () => {
    const field = createDefaultField();
    const planner = addPlannedAction(field.preTurnPlanner, {
      id: "planned-land",
      type: "land-play",
      title: "Command Tower",
      reminders: ["Landfall after this"],
    });
    const strip = synchronizeActionStripWithPlanner(
      createDefaultActiveTurnActionStripState({
        timestamp,
        sessionId: field.session.id,
      }),
      {
        planner: syncPlannerWithAmbientMode(
          planner,
          "preTurnPreparation",
          timestamp,
        ),
        ambientMode: "preTurnPreparation",
        timestamp,
        sessionId: field.session.id,
      },
    );

    expect(strip.visibility).toBe("preview");
    expect(strip.items.map((item) => item.kind)).toEqual([
      "begin-turn",
      "play-planned-land",
    ]);
    expect(strip.items[0].status).toBe("current");
    expect(getActionStripDiagnostics(strip)).toMatchObject({
      itemCount: 2,
      pendingCount: 2,
    });
  });

  it("creates active-turn and combat actions without using AI or automation", () => {
    const field = createDefaultField();
    const planner = addPlannedAction(field.preTurnPlanner, {
      id: "planned-attack",
      type: "planned-attack",
      title: "Swing with team",
    });
    const active = synchronizeActionStripWithPlanner(
      field.activeTurnActionStrip,
      {
        planner: syncPlannerWithAmbientMode(planner, "activeTurn", timestamp),
        ambientMode: "activeTurn",
        timestamp,
        sessionId: field.session.id,
      },
    );
    const combat = synchronizeActionStripWithPlanner(active, {
      planner: syncPlannerWithAmbientMode(planner, "combat", timestamp),
      ambientMode: "combat",
      timestamp,
      sessionId: field.session.id,
    });

    expect(active.visibility).toBe("primary");
    expect(active.items.some((item) => item.kind === "draw")).toBe(true);
    expect(active.items.some((item) => item.kind === "move-to-combat")).toBe(
      true,
    );
    expect(combat.visibility).toBe("combat");
    expect(combat.items.map((item) => item.kind)).toContain(
      "declare-planned-attack",
    );
    expect(
      combat.items.every((item) => item.intent.source === "turn-planner"),
    ).toBe(true);
  });

  it("supports ordering, status changes, completed collapse, and clearing", () => {
    let field = createDefaultField();
    const engine = new AmbientGameplayEngine(field.ambient);
    const active = engine.requestTransition({
      targetMode: "activeTurn",
      reason: "manual",
      timestamp,
    });
    field = normalizeField({
      ...field,
      ambient: active.ok ? active.state : field.ambient,
      preTurnPlanner: addPlannedAction(field.preTurnPlanner, {
        id: "planned-spell",
        type: "spell-sequence",
        title: "Sol Ring",
      }),
    });
    let strip = field.activeTurnActionStrip;
    const spell = strip.items.find(
      (item) => item.sourceActionId === "planned-spell",
    );
    expect(spell).toBeTruthy();
    if (!spell) throw new Error("Expected planned spell item.");

    strip = reorderActionStripItem(strip, spell.id, -1, timestamp);
    strip = setActionStripItemStatus(strip, spell.id, "deferred", timestamp);
    expect(strip.items.find((item) => item.id === spell.id)?.status).toBe(
      "deferred",
    );
    strip = setActionStripItemStatus(strip, spell.id, "completed", timestamp);
    strip = setActionStripCompletedCollapsed(strip, false, timestamp);
    expect(strip.completedCollapsed).toBe(false);
    strip = setActionStripExpanded(strip, false, timestamp);
    expect(strip.expanded).toBe(false);
    strip = clearCompletedActionStripItems(strip, timestamp);
    expect(strip.items.some((item) => item.id === spell.id)).toBe(false);
    const completedPlanner = setPlannedActionStatus(
      field.preTurnPlanner,
      "planned-spell",
      "completed",
      timestamp,
    );
    strip = synchronizeActionStripWithPlanner(strip, {
      planner: completedPlanner,
      ambientMode: field.ambient.currentMode,
      timestamp,
      sessionId: field.session.id,
    });
    expect(strip.items.some((item) => item.id === spell.id)).toBe(false);
  });

  it("routes selected actions through the Ambient Event Pipeline and existing undo history", () => {
    let field = createDefaultField();
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
      id: "planned-spell",
      type: "spell-sequence",
      title: "Sol Ring",
    });

    field = useFieldStore.getState().field;
    const begin = field.activeTurnActionStrip.items.find(
      (item) => item.kind === "begin-turn",
    );
    expect(begin).toBeTruthy();
    if (!begin) throw new Error("Expected begin turn item.");
    const beginResult = useFieldStore
      .getState()
      .actionStripSelectItem(begin.id);

    expect(beginResult?.status).toBe("completed");
    expect(useFieldStore.getState().field.ambient.currentMode).toBe(
      "activeTurn",
    );
    expect(useFieldStore.getState().undoStack).toHaveLength(1);
    expect(useFieldStore.getState().field.groups).toEqual(field.groups);

    const planned = useFieldStore
      .getState()
      .field.activeTurnActionStrip.items.find(
        (item) => item.sourceActionId === "planned-spell",
      );
    expect(planned).toBeTruthy();
    if (!planned) throw new Error("Expected planned action item.");
    const plannedResult = useFieldStore
      .getState()
      .actionStripSelectItem(planned.id);

    expect(plannedResult?.status).toBe("completed");
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("completed");
    expect(useFieldStore.getState().undoStack).toHaveLength(2);
    useFieldStore.getState().actionStripClearCompleted();
    expect(
      useFieldStore
        .getState()
        .field.activeTurnActionStrip.items.some(
          (item) => item.sourceActionId === "planned-spell",
        ),
    ).toBe(false);

    useFieldStore.getState().undo();
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("planned");
    expect(
      useFieldStore
        .getState()
        .field.activeTurnActionStrip.items.some(
          (item) => item.sourceActionId === "planned-spell",
        ),
    ).toBe(true);
    useFieldStore.getState().redo();
    expect(
      useFieldStore.getState().field.preTurnPlanner.actions[0].status,
    ).toBe("completed");
  });

  it("uses Action Strip mode actions for active turn, combat, and post-turn transitions", () => {
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
      id: "planned-attack",
      type: "planned-attack",
      title: "Attack",
    });
    const begin = useFieldStore
      .getState()
      .field.activeTurnActionStrip.items.find(
        (item) => item.kind === "begin-turn",
      );
    if (!begin) throw new Error("Expected begin turn item.");
    useFieldStore.getState().actionStripSelectItem(begin.id);

    const combat = useFieldStore
      .getState()
      .field.activeTurnActionStrip.items.find(
        (item) => item.kind === "move-to-combat",
      );
    if (!combat) throw new Error("Expected move to combat item.");
    useFieldStore.getState().actionStripSelectItem(combat.id);
    expect(useFieldStore.getState().field.ambient.currentMode).toBe("combat");

    const endCombat = useFieldStore
      .getState()
      .field.activeTurnActionStrip.items.find(
        (item) => item.kind === "end-combat",
      );
    if (!endCombat) throw new Error("Expected end combat item.");
    useFieldStore.getState().actionStripSelectItem(endCombat.id);
    expect(useFieldStore.getState().field.ambient.currentMode).toBe(
      "activeTurn",
    );

    const endTurn = useFieldStore
      .getState()
      .field.activeTurnActionStrip.items.find(
        (item) => item.kind === "end-turn",
      );
    if (!endTurn) throw new Error("Expected end turn item.");
    useFieldStore.getState().actionStripSelectItem(endTurn.id);
    expect(useFieldStore.getState().field.ambient.currentMode).toBe("postTurn");
  });

  it("persists through migration, snapshots, and imports", () => {
    let field = createDefaultField();
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
      id: "stored-plan",
      type: "trigger-reminder",
      title: "Upkeep trigger",
    });
    field = useFieldStore.getState().field;

    const normalized = normalizeField(structuredClone(field));
    const imported = sanitizeImportedField(structuredClone(field));
    const snapshot = createLiteFieldSnapshot(normalized);
    const legacy = createDefaultField() as unknown as Record<string, unknown>;
    delete legacy.activeTurnActionStrip;
    const migrated = sanitizeImportedField(legacy);

    expect(normalized.activeTurnActionStrip.items.length).toBeGreaterThan(0);
    expect(imported?.activeTurnActionStrip.items.length).toBeGreaterThan(0);
    expect(snapshot.activeTurnActionStrip.items.length).toBeGreaterThan(0);
    expect(migrated?.activeTurnActionStrip.visibility).toBe("hidden");
  });
});
