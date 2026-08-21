import { monotonicNowMs } from "../platform/runtime";
import type {
  AthenaActionRelevanceContext,
  AthenaInteractionKind,
  AthenaInteractionSample,
  AthenaInteractionWorkflow,
  AthenaPerformanceDiagnostics,
  AthenaPerformanceMetric,
  AthenaPerformanceSample,
  AthenaRankedAction,
  AthenaReconciliationGroupRankingInput,
} from "./performanceOptimizationTypes";
import { ATHENA_PERFORMANCE_OPTIMIZATION_VERSION } from "./performanceOptimizationTypes";

const MAX_SAMPLES = 160;
const MAX_INTERACTIONS = 160;

export const ATHENA14_PERFORMANCE_BUDGETS_MS = {
  interaction: 100,
  typicalCalculation: 100,
  largeDerivedCalculation: 200,
  preparedActionExecution: 200,
  decisionGeneration: 100,
  smallReconciliation: 200,
} as const;

export class AthenaPerformanceMonitor {
  private enabled = false;
  private samples: AthenaPerformanceSample[] = [];
  private interactions: AthenaInteractionSample[] = [];
  private metricStats: Partial<
    Record<
      AthenaPerformanceMetric,
      { totalDurationMs: number; count: number; maximumDurationMs: number }
    >
  > = {};
  private interactionTotals: AthenaPerformanceDiagnostics["interactionTotals"] =
    {};
  private gauges: Record<string, number> = {};
  private lastPerformanceWarning: string | null = null;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  recordDuration(
    metric: AthenaPerformanceMetric,
    durationMs: number,
    input: { workUnits?: number; recordedAt?: string; enabled?: boolean } = {},
  ): void {
    if (!(input.enabled ?? this.enabled) || !Number.isFinite(durationMs))
      return;
    const sample: AthenaPerformanceSample = {
      metric,
      durationMs: Math.max(0, durationMs),
      workUnits: Math.max(1, Math.trunc(input.workUnits ?? 1)),
      recordedAt: input.recordedAt ?? new Date().toISOString(),
    };
    this.samples = [...this.samples, sample].slice(-MAX_SAMPLES);
    const stats = this.metricStats[metric] ?? {
      totalDurationMs: 0,
      count: 0,
      maximumDurationMs: 0,
    };
    this.metricStats[metric] = {
      totalDurationMs: stats.totalDurationMs + sample.durationMs,
      count: stats.count + 1,
      maximumDurationMs: Math.max(stats.maximumDurationMs, sample.durationMs),
    };
    const budget = budgetForMetric(metric);
    if (sample.durationMs > budget) {
      this.lastPerformanceWarning = `${metric} took ${sample.durationMs.toFixed(1)}ms (development budget ${budget}ms).`;
    }
  }

  recordInteraction(
    workflow: AthenaInteractionWorkflow,
    kind: AthenaInteractionKind,
    input: { count?: number; recordedAt?: string; enabled?: boolean } = {},
  ): void {
    if (!(input.enabled ?? this.enabled)) return;
    this.interactions = [
      ...this.interactions,
      {
        workflow,
        kind,
        count: Math.max(1, Math.trunc(input.count ?? 1)),
        recordedAt: input.recordedAt ?? new Date().toISOString(),
      },
    ].slice(-MAX_INTERACTIONS);
    const totals = this.interactionTotals[workflow] ?? {};
    totals[kind] =
      (totals[kind] ?? 0) + Math.max(1, Math.trunc(input.count ?? 1));
    this.interactionTotals[workflow] = totals;
  }

  setGauge(name: string, value: number, enabled = this.enabled): void {
    if (!enabled || !Number.isFinite(value)) return;
    this.gauges = { ...this.gauges, [name]: Math.max(0, value) };
  }

  measure<T>(
    metric: AthenaPerformanceMetric,
    operation: () => T,
    input: { workUnits?: number; recordedAt?: string; enabled?: boolean } = {},
  ): T {
    const started = monotonicNowMs();
    try {
      return operation();
    } finally {
      this.recordDuration(metric, monotonicNowMs() - started, input);
    }
  }

  getDiagnostics(): AthenaPerformanceDiagnostics {
    const metricAveragesMs: AthenaPerformanceDiagnostics["metricAveragesMs"] =
      {};
    const metricMaximumsMs: AthenaPerformanceDiagnostics["metricMaximumsMs"] =
      {};
    for (const [metric, stats] of Object.entries(this.metricStats) as Array<
      [
        AthenaPerformanceMetric,
        NonNullable<(typeof this.metricStats)[AthenaPerformanceMetric]>,
      ]
    >) {
      metricAveragesMs[metric] = stats.totalDurationMs / stats.count;
      metricMaximumsMs[metric] = stats.maximumDurationMs;
    }
    return {
      version: ATHENA_PERFORMANCE_OPTIMIZATION_VERSION,
      enabled: this.enabled,
      samples: this.samples.map((entry) => ({ ...entry })),
      interactions: this.interactions.map((entry) => ({ ...entry })),
      metricAveragesMs,
      metricMaximumsMs,
      interactionTotals: Object.fromEntries(
        Object.entries(this.interactionTotals).map(([workflow, totals]) => [
          workflow,
          { ...totals },
        ]),
      ),
      gauges: { ...this.gauges },
      lastPerformanceWarning: this.lastPerformanceWarning,
      productionVisible: false,
    };
  }

  reset(): void {
    this.samples = [];
    this.interactions = [];
    this.metricStats = {};
    this.interactionTotals = {};
    this.gauges = {};
    this.lastPerformanceWarning = null;
  }
}

export const athenaPerformanceMonitor = new AthenaPerformanceMonitor();

export function rankAthenaActionStripItems(
  items: AthenaRankedAction["item"][],
  context: AthenaActionRelevanceContext,
): AthenaRankedAction[] {
  return items
    .map((item) => {
      let score = Math.max(0, 1_000 - item.order);
      let reason = "explicit planner order";
      if (item.id === context.currentActionId && isExecutable(item)) {
        score += 10_000;
        reason = "stable current action";
      }
      if (item.status === "current") score += 2_000;
      if (item.validity === "ready") score += 500;
      if (item.validity === "awaiting-confirmation") score += 450;
      if (item.source === "planner" && item.sourceActionId) {
        score += 3_000;
        if (reason !== "stable current action") {
          reason = "explicit prepared action";
        }
      }
      if (
        context.phase === "combat" &&
        ["move-to-combat", "declare-planned-attack", "end-combat"].includes(
          item.kind,
        )
      ) {
        score += 300;
        reason = "current combat workflow";
      }
      if (
        context.lifecycle === "second-main" &&
        item.kind === "second-main-reminder"
      ) {
        score += 250;
        reason = "current second main workflow";
      }
      if (item.kind === "end-turn" && items.some(isExecutableNonEndAction)) {
        score -= 200;
      }
      if (!isExecutable(item)) score -= 20_000;
      return { item, score, reason };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.item.order - right.item.order ||
        left.item.id.localeCompare(right.item.id),
    );
}

export function rankAthenaReconciliationGroups(
  input: AthenaReconciliationGroupRankingInput,
): AthenaReconciliationGroupRankingInput["groups"] {
  const scores = new Map(
    input.groups.map((group) => {
      let value = 0;
      if (group.id === input.currentGroupId) value += 1_000;
      if (input.decisionCandidateGroupIds.has(group.id)) value += 800;
      if (input.preparedGroupIds.has(group.id)) value += 600;
      if (group.characteristics.isToken) value += 160;
      if (Object.values(group.counters).some((count) => count > 0))
        value += 120;
      if (group.attachments.length > 0 || group.attachedTo) value += 80;
      return [group.id, value] as const;
    }),
  );
  return [...input.groups].sort((left, right) => {
    return (
      (scores.get(right.id) ?? 0) - (scores.get(left.id) ?? 0) ||
      left.order - right.order
    );
  });
}

function isExecutable(item: AthenaRankedAction["item"]): boolean {
  return (
    (item.status === "current" || item.status === "pending") &&
    (item.validity === "ready" || item.validity === "awaiting-confirmation")
  );
}

function isExecutableNonEndAction(item: AthenaRankedAction["item"]): boolean {
  return item.kind !== "end-turn" && isExecutable(item);
}

function budgetForMetric(metric: AthenaPerformanceMetric): number {
  if (metric === "decision-generation")
    return ATHENA14_PERFORMANCE_BUDGETS_MS.decisionGeneration;
  if (metric === "prepared-action-execution")
    return ATHENA14_PERFORMANCE_BUDGETS_MS.preparedActionExecution;
  if (metric === "reconciliation")
    return ATHENA14_PERFORMANCE_BUDGETS_MS.smallReconciliation;
  if (metric === "static-recalculation")
    return ATHENA14_PERFORMANCE_BUDGETS_MS.largeDerivedCalculation;
  return ATHENA14_PERFORMANCE_BUDGETS_MS.typicalCalculation;
}
