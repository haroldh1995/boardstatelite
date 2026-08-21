import type { PermanentGroup } from "../domain/types";
import type { ActiveTurnActionStripItem } from "../echo/activeTurnActionStripTypes";
import type {
  AthenaLiveTurnLifecycle,
  AthenaLiveTurnPhase,
} from "./liveTurnOrchestratorTypes";

export const ATHENA_PERFORMANCE_OPTIMIZATION_VERSION = 1;

export type AthenaPerformanceMetric =
  | "app-restore"
  | "battlefield-update"
  | "dependency-invalidation"
  | "static-recalculation"
  | "forecast-generation"
  | "replacement-processing"
  | "trigger-generation"
  | "trigger-resolution"
  | "prepared-action-execution"
  | "decision-generation"
  | "echo-command-dispatch"
  | "combat-processing"
  | "reconciliation"
  | "persistence";

export type AthenaInteractionKind =
  | "tap"
  | "voice-command"
  | "modal-open"
  | "confirmation"
  | "numeric-change"
  | "decision-interruption"
  | "clarification"
  | "planner-reopen"
  | "correction-step";

export type AthenaInteractionWorkflow =
  | "prepared-action"
  | "voice-prepared-action"
  | "contextual-decision"
  | "reconciliation"
  | "combat"
  | "end-turn"
  | "planner";

export interface AthenaPerformanceSample {
  metric: AthenaPerformanceMetric;
  durationMs: number;
  workUnits: number;
  recordedAt: string;
}

export interface AthenaInteractionSample {
  workflow: AthenaInteractionWorkflow;
  kind: AthenaInteractionKind;
  count: number;
  recordedAt: string;
}

export interface AthenaPerformanceDiagnostics {
  version: typeof ATHENA_PERFORMANCE_OPTIMIZATION_VERSION;
  enabled: boolean;
  samples: AthenaPerformanceSample[];
  interactions: AthenaInteractionSample[];
  metricAveragesMs: Partial<Record<AthenaPerformanceMetric, number>>;
  metricMaximumsMs: Partial<Record<AthenaPerformanceMetric, number>>;
  interactionTotals: Partial<
    Record<
      AthenaInteractionWorkflow,
      Partial<Record<AthenaInteractionKind, number>>
    >
  >;
  gauges: Record<string, number>;
  lastPerformanceWarning: string | null;
  productionVisible: false;
}

export interface AthenaActionRelevanceContext {
  lifecycle: AthenaLiveTurnLifecycle;
  phase: AthenaLiveTurnPhase;
  currentActionId: string | null;
}

export interface AthenaRankedAction {
  item: ActiveTurnActionStripItem;
  score: number;
  reason: string;
}

export interface AthenaReconciliationGroupRankingInput {
  groups: PermanentGroup[];
  preparedGroupIds: ReadonlySet<string>;
  decisionCandidateGroupIds: ReadonlySet<string>;
  currentGroupId?: string | null;
}
