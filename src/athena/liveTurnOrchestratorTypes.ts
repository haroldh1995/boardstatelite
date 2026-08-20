import type { GameEvent } from "../domain/types";
import type { ActiveTurnActionKind } from "../echo/activeTurnActionStripTypes";
import type { AthenaPendingTriggerQueueSnapshot } from "./triggerQueueTypes";

export const ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION = 1;
export const ATHENA_LIVE_TURN_SCHEMA_VERSION = 1;

export type AthenaLiveTurnLifecycle =
  | "pre-turn-preparation"
  | "ready-to-begin"
  | "turn-active"
  | "processing-action"
  | "processing-consequences"
  | "awaiting-decision"
  | "ready-for-next-action"
  | "combat-preparation"
  | "combat-active"
  | "combat-reconciliation"
  | "second-main"
  | "end-step"
  | "turn-reconciliation"
  | "ready-to-end"
  | "completed"
  | "interrupted"
  | "recovering"
  | "authority-required"
  | "manual-intervention-required";

export type AthenaLiveTurnPhase =
  | "unknown"
  | "beginning"
  | "precombat-main"
  | "combat"
  | "postcombat-main"
  | "ending";

export type AthenaLiveTurnBlockerKind =
  | "decision"
  | "pending-trigger"
  | "authority"
  | "manual-result"
  | "processing-failure"
  | "combat-reconciliation";

export interface AthenaLiveTurnBlocker {
  id: string;
  kind: AthenaLiveTurnBlockerKind;
  sourceId: string | null;
  required: boolean;
  label: string;
  semanticDescription: string;
}

export interface AthenaLiveTurnCheckpoint {
  id: string;
  lifecycle: AthenaLiveTurnLifecycle;
  phase: AthenaLiveTurnPhase;
  currentActionId: string | null;
  currentPreparedActionId: string | null;
  blockingDecisionId: string | null;
  canonicalEventIds: string[];
  createdAt: string;
  reason: string;
}

export interface AthenaLiveTurnWorkToken {
  id: string;
  sessionId: string;
  turnId: string;
  actionId: string | null;
  generation: number;
  createdAt: string;
}

export type AthenaLiveTurnTutorialEvent =
  | "live-turn-started"
  | "next-action-focused"
  | "action-processing-started"
  | "automatic-sequencing-completed"
  | "decision-paused"
  | "decision-resumed"
  | "combat-handoff-started"
  | "combat-reconciled"
  | "second-main-started"
  | "end-step-started"
  | "turn-reconciliation-started"
  | "live-turn-completed"
  | "live-turn-recovered";

export interface AthenaLiveTurnDiagnostics {
  version: typeof ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION;
  turnsStarted: number;
  turnsCompleted: number;
  actionsFocused: number;
  preparedActionsProcessed: number;
  unexpectedActionsProcessed: number;
  automaticSequences: number;
  decisionPauses: number;
  decisionResumes: number;
  combatHandoffs: number;
  combatReconciliations: number;
  secondMainTransitions: number;
  endTurnRequests: number;
  endTurnBlocks: number;
  recoveryCount: number;
  staleWorkRejections: number;
  duplicateActionPreventions: number;
  incrementalRevalidations: number;
  fullPlanRebuilds: number;
  maximumPendingTriggerCount: number;
  maximumCheckpointCount: number;
  lastTransitionDurationMs: number;
  maximumTransitionDurationMs: number;
  lastError: string | null;
  productionVisible: false;
}

export interface AthenaLiveTurnOrchestratorState {
  schemaVersion: typeof ATHENA_LIVE_TURN_SCHEMA_VERSION;
  version: typeof ATHENA_LIVE_TURN_ORCHESTRATOR_VERSION;
  sessionId: string | null;
  participantId: string | null;
  turnId: string | null;
  lifecycle: AthenaLiveTurnLifecycle;
  previousLifecycle: AthenaLiveTurnLifecycle | null;
  phase: AthenaLiveTurnPhase;
  sequenceVersion: number;
  generation: number;
  canonicalStateFingerprint: string | null;
  currentActionId: string | null;
  currentPreparedActionId: string | null;
  currentActionKind: ActiveTurnActionKind | null;
  blockingDecisionId: string | null;
  pendingTriggerIds: string[];
  authorityRequiredIds: string[];
  manualInterventionIds: string[];
  failedProcessingIds: string[];
  completedPreparedActionIds: string[];
  processedCanonicalEventIds: string[];
  unexpectedCanonicalEventIds: string[];
  confirmationReceiptIds: string[];
  blockers: AthenaLiveTurnBlocker[];
  checkpoints: AthenaLiveTurnCheckpoint[];
  inFlightWork: AthenaLiveTurnWorkToken | null;
  startedAt: string | null;
  lastActionAt: string | null;
  endRequestedAt: string | null;
  completedAt: string | null;
  interruptedAt: string | null;
  recoveredAt: string | null;
  updatedAt: string;
  semanticSummary: string;
  semanticEvents: AthenaLiveTurnTutorialEvent[];
  directBattlefieldMutation: false;
  rulesAuthorityTransferred: false;
  diagnostics: AthenaLiveTurnDiagnostics;
}

export type AthenaLiveTurnSignal =
  | "reconcile"
  | "turn-started"
  | "action-started"
  | "action-completed"
  | "unexpected-action"
  | "consequences-processing"
  | "decision-created"
  | "decision-answered"
  | "combat-started"
  | "combat-completed"
  | "end-step-started"
  | "end-turn-requested"
  | "turn-completed"
  | "interrupted"
  | "recover";

export interface AthenaLiveTurnReconcileOptions {
  signal?: AthenaLiveTurnSignal;
  timestamp?: string;
  actionId?: string | null;
  preparedActionId?: string | null;
  actionKind?: ActiveTurnActionKind | null;
  confirmationReceiptId?: string | null;
  canonicalEvents?: GameEvent[];
  queue?: AthenaPendingTriggerQueueSnapshot | null;
  failureId?: string | null;
  failureReason?: string | null;
}

export interface AthenaLiveTurnOrchestrationResult {
  state: AthenaLiveTurnOrchestratorState;
  selectedActionId: string | null;
  selectedPreparedActionId: string | null;
  blockers: AthenaLiveTurnBlocker[];
  canEndTurn: boolean;
  didAdvance: boolean;
  staleWorkRejected: boolean;
  semanticDescription: string;
  tutorialEvents: AthenaLiveTurnTutorialEvent[];
}

export interface AthenaLiveTurnEndResult {
  allowed: boolean;
  state: AthenaLiveTurnOrchestratorState;
  blockers: AthenaLiveTurnBlocker[];
  semanticDescription: string;
}
