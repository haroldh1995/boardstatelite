import { describe, expect, it } from "vitest";
import { calculateTotals } from "../domain/field";
import type { ActiveTurnActionStripItem } from "../echo/activeTurnActionStripTypes";
import {
  createHeavyLateGamePerformanceFixture,
  createNormalMidgamePerformanceFixture,
} from "../test/performanceFixtures";
import { buildAthenaDecisionCandidates } from "./decisionEngine";
import {
  AthenaDerivedStateEngine,
  buildAthenaDerivedBattlefieldState,
} from "./derivedState";
import { buildAthenaEffectRelationshipMap } from "./effectRelationshipMapper";
import {
  AthenaPerformanceMonitor,
  rankAthenaActionStripItems,
  rankAthenaReconciliationGroups,
} from "./performanceOptimization";
import {
  applyAthenaReconciliation,
  createAthenaReconciliationRequest,
} from "./reconciliation";
import { revalidateAthenaTurnIntent } from "./turnIntent";

describe("ATHENA-14 performance and friction optimization", () => {
  it("keeps development performance and interaction telemetry bounded and local", () => {
    const monitor = new AthenaPerformanceMonitor();
    monitor.setEnabled(true);
    for (let index = 0; index < 220; index += 1) {
      monitor.recordDuration("forecast-generation", index % 7, {
        recordedAt: `2026-08-21T12:00:${String(index % 60).padStart(2, "0")}.000Z`,
      });
      monitor.recordInteraction("prepared-action", "tap");
    }
    monitor.recordDuration("decision-generation", 150);
    monitor.setGauge("active-prepared-actions", 8);
    const diagnostics = monitor.getDiagnostics();

    expect(diagnostics.samples).toHaveLength(160);
    expect(diagnostics.interactions).toHaveLength(160);
    expect(diagnostics.interactionTotals["prepared-action"]?.tap).toBe(220);
    expect(diagnostics.gauges["active-prepared-actions"]).toBe(8);
    expect(diagnostics.lastPerformanceWarning).toContain("decision-generation");
    expect(diagnostics.productionVisible).toBe(false);
    expect(JSON.stringify(diagnostics)).not.toMatch(
      /window|document|navigator|HTMLElement|localStorage|sessionStorage|indexedDB/,
    );
  });

  it("tracks minimum-safe interaction budgets without production analytics", () => {
    const monitor = new AthenaPerformanceMonitor();
    monitor.setEnabled(true);
    monitor.recordInteraction("prepared-action", "tap");
    monitor.recordInteraction("voice-prepared-action", "voice-command");
    monitor.recordInteraction("contextual-decision", "decision-interruption");
    monitor.recordInteraction("contextual-decision", "tap");
    monitor.recordInteraction("reconciliation", "modal-open");
    monitor.recordInteraction("reconciliation", "correction-step", {
      count: 4,
    });
    monitor.recordInteraction("reconciliation", "confirmation");
    const interactions = monitor.getDiagnostics().interactionTotals;

    expect(interactions["prepared-action"]).toEqual({ tap: 1 });
    expect(interactions["voice-prepared-action"]).toEqual({
      "voice-command": 1,
    });
    expect(interactions["contextual-decision"]).toEqual({
      "decision-interruption": 1,
      tap: 1,
    });
    expect(interactions.reconciliation).toEqual({
      "modal-open": 1,
      "correction-step": 4,
      confirmation: 1,
    });
  });

  it("preserves a stable current tap target while ranking current context", () => {
    const current = actionItem("current", "cast-planned-spell", 50, "current");
    const combat = actionItem("combat", "declare-planned-attack", 1, "pending");
    const ranked = rankAthenaActionStripItems([combat, current], {
      lifecycle: "ready-for-next-action",
      phase: "combat",
      currentActionId: current.id,
    });
    expect(ranked[0]).toMatchObject({
      item: { id: current.id },
      reason: "stable current action",
    });

    const contextual = rankAthenaActionStripItems([combat], {
      lifecycle: "combat-active",
      phase: "combat",
      currentActionId: null,
    });
    expect(contextual[0]).toMatchObject({
      item: { id: combat.id },
      reason: "current combat workflow",
    });
  });

  it("prioritizes reconciliation objects that affect active work", () => {
    const field = createHeavyLateGamePerformanceFixture();
    const groups = field.groups.filter((group) => group.zone === "battlefield");
    const prepared = groups.at(-1)!;
    const target = groups.at(-2)!;
    const ranked = rankAthenaReconciliationGroups({
      groups,
      preparedGroupIds: new Set([prepared.id]),
      decisionCandidateGroupIds: new Set([target.id]),
      currentGroupId: prepared.id,
    });

    expect(ranked[0].id).toBe(prepared.id);
    expect(ranked[1].id).toBe(target.id);
    expect(ranked).toHaveLength(groups.length);
  });

  it("keeps normal and heavy fixtures stack-based and within generous budgets", () => {
    const normal = createNormalMidgamePerformanceFixture();
    const heavy = createHeavyLateGamePerformanceFixture();
    const battlefield = heavy.groups.filter(
      (group) => group.zone === "battlefield",
    );
    const tokenStacks = battlefield.filter(
      (group) => group.characteristics.isToken,
    );
    const aggregateTokens = tokenStacks.reduce(
      (sum, group) => sum + group.quantity,
      0,
    );

    expect(normal.groups.length).toBeGreaterThan(40);
    expect(battlefield).toHaveLength(110);
    expect(tokenStacks).toHaveLength(20);
    expect(aggregateTokens).toBeGreaterThan(1_000);

    const totalsStarted = performance.now();
    const totals = calculateTotals(heavy.groups);
    const totalsDuration = performance.now() - totalsStarted;
    expect(totals.tokens).toBe(aggregateTokens);
    expect(totalsDuration).toBeLessThan(100);

    const derivedStarted = performance.now();
    const derived = buildAthenaDerivedBattlefieldState(heavy);
    const derivedDuration = performance.now() - derivedStarted;
    const relationships = buildAthenaEffectRelationshipMap(heavy);
    expect(derived.objects.length).toBeGreaterThan(30);
    expect(derivedDuration).toBeLessThan(600);
    expect(relationships.diagnostics.staticCount).toBeGreaterThanOrEqual(10);
    expect(relationships.diagnostics.replacementCount).toBeGreaterThanOrEqual(
      2,
    );
    expect(relationships.diagnostics.triggerCount).toBeGreaterThanOrEqual(3);

    const candidatesStarted = performance.now();
    const candidates = buildAthenaDecisionCandidates(heavy, {
      zones: ["battlefield"],
      controller: "you",
      cardTypes: ["Creature"],
    });
    expect(performance.now() - candidatesStarted).toBeLessThan(100);
    expect(candidates.length).toBeGreaterThan(30);
  });

  it("reuses bounded derived caches and prepared forecasts", () => {
    const field = createHeavyLateGamePerformanceFixture();
    const engine = new AthenaDerivedStateEngine();
    const cold = engine.build(field);
    const warmStarted = performance.now();
    const warm = engine.build(field);
    const warmDuration = performance.now() - warmStarted;

    expect(warm.canonicalFingerprint).toBe(cold.canonicalFingerprint);
    expect(warmDuration).toBeLessThan(100);
    expect(engine.getDiagnostics()).toMatchObject({
      cacheHitCount: 1,
      cacheMissCount: 1,
      cacheSize: 1,
    });

    const first = revalidateAthenaTurnIntent(field);
    const stableStarted = performance.now();
    const stable = revalidateAthenaTurnIntent(first);
    const stableDuration = performance.now() - stableStarted;
    expect(stableDuration).toBeLessThan(100);
    expect(
      stable.preTurnPlanner.actions
        .filter((action) => action.prepared.forecastReference)
        .every((action) =>
          action.prepared.reasonCodes.includes("forecast-reused"),
        ),
    ).toBe(true);
  });

  it("applies a 100-object Catch Me Up batch atomically without fake events", () => {
    const field = createHeavyLateGamePerformanceFixture();
    const repairs = field.groups
      .filter((group) => group.zone === "battlefield")
      .slice(0, 100)
      .map((group, index) => ({
        id: `athena14-repair-${index}`,
        kind: "set-group-quantity" as const,
        groupId: group.id,
        value: group.quantity + 1,
      }));
    const request = createAthenaReconciliationRequest({
      field,
      repairs,
      level: "catch-me-up",
      timestamp: field.updatedAt,
    });
    const started = performance.now();
    const result = applyAthenaReconciliation(field, request);
    const duration = performance.now() - started;

    expect(result.ok).toBe(true);
    expect(result.discrepancies).toHaveLength(100);
    expect(result.generatedGameEvents).toEqual([]);
    expect(duration).toBeLessThan(500);
  });
});

function actionItem(
  id: string,
  kind: ActiveTurnActionStripItem["kind"],
  order: number,
  status: ActiveTurnActionStripItem["status"],
): ActiveTurnActionStripItem {
  return {
    id,
    key: id,
    kind,
    label: id,
    detail: "",
    source: "planner",
    sourceActionId: id,
    intentKind: "custom",
    intent: { kind: "custom", source: "turn-planner" },
    order,
    status,
    requiredMode: "activeTurn",
    createdAt: "2026-08-21T12:00:00.000Z",
    updatedAt: "2026-08-21T12:00:00.000Z",
    completedAt: null,
    skippedAt: null,
    cancelledAt: null,
    deferredAt: null,
    blockedReason: null,
    preparedActionId: `prepared:${id}`,
    turnIntentId: "turn:athena14",
    validity: "ready",
    confidence: "explicit",
    plannedQuantity: 1,
    confirmationRequirements: ["confirmation"],
    canonicalStateFingerprint: null,
    forecastReference: null,
    expectedCanonicalEventId: `event:${id}`,
    expectedTriggerSummary: [],
    expectedBookkeeping: [],
    confirmationReceiptId: null,
    resultingCanonicalEventIds: [],
    semanticDescription: id,
  };
}
