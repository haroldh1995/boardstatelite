import { create } from "zustand";
import { createGenericGroup, makeId, withStackKey } from "../domain/cards";
import {
  activateField as resolveActivateField,
  setTrackingEnabled as resolveSetTrackingEnabled,
} from "../domain/engine";
import {
  calculateTotals,
  createDefaultField,
  normalizeField,
  normalizeSettings,
  sanitizeImportedField,
} from "../domain/field";
import type {
  CardIdentity,
  CounterApplicationMode,
  FieldState,
  GameEvent,
  HistoryEntry,
  ModalState,
  RelevantTotalKey,
  ResolutionResult,
  SettingsState,
  StackScope,
} from "../domain/types";
import { loadLastField, saveField } from "../services/db";
import { createReferenceFixtureField } from "../dev/referenceFixture";
import { isReferenceFixtureMode } from "../dev/referenceMode";
import { rulesAdapterManager } from "../rulesAdapter";
import { rulesResultRenderer } from "../rulesResult";
import { sharedSessionManager } from "../sharedSession";
import { AmbientGameplayEngine } from "../echo/ambientEngine";
import { ambientEventPipeline } from "../echo/ambientEventPipeline";
import {
  addPlannedAction,
  clearAllPlans,
  clearCompletedPlans,
  removePlannedAction,
  reorderPlannedAction,
  resetPreTurnPlanner,
  setAvailableLandPlays,
  setPlannedActionStatus,
  setPlannerGroupCollapsed,
  syncPlannerWithAmbientMode,
  updatePlannedAction,
} from "../echo/preTurnPlanner";
import {
  clearCompletedActionStripItems,
  markActionStripPipelineResult,
  plannerStatusFromActionStripStatus,
  reorderActionStripItem,
  setActionStripCompletedCollapsed,
  setActionStripExpanded,
  setActionStripItemStatus,
  synchronizeActionStripWithPlanner,
} from "../echo/activeTurnActionStrip";
import {
  echoMicrophoneService,
  normalizeEchoVoiceSettings,
} from "../echo/microphoneService";
import { syncContextualListeningWithAmbientMode } from "../echo/contextualListening";
import { syncAdaptiveListeningTailWithAmbientMode } from "../echo/adaptiveListeningTail";
import {
  addEnvironmentCalibration,
  deleteVoiceProfile as clearVoiceProfile,
  getCurrentEnrollmentPhrase,
  recordVoiceEnrollmentSample as applyVoiceEnrollmentSample,
  startVoiceEnrollment,
  updateEnrollmentContext,
} from "../echo/voiceEnrollment";
import {
  applySpeakerVerificationResult,
  echoSpeakerVerificationEngine,
  resetSpeakerVerificationSettings,
} from "../echo/speakerVerification";
import {
  removePronunciationVocabularyEntry,
  resetPronunciationLearningState,
} from "../echo/pronunciationLearning";
import {
  acceptPersonalGameplaySuggestion,
  dismissPersonalGameplaySuggestion,
  observePersonalGameplaySignal,
  personalGameplaySignalForCommit,
  resetPersonalGameplayState,
} from "../echo/personalGameplay";
import {
  recordAmbientPipelineCompletion,
  refreshAmbientOrchestratorContext,
} from "../echo/ambientOrchestrator";
import type {
  AmbientFieldMutation,
  AmbientIntent,
  AmbientIntentInput,
  AmbientPipelineResult,
} from "../echo/ambientEventTypes";
import type { AmbientLifecycleEvent } from "../echo/ambientTypes";
import type {
  EchoCalibrationEnvironment,
  EchoMicrophonePosition,
  EchoVoiceEnrollmentSession,
} from "../echo/voiceEnrollmentTypes";
import type {
  PlannedActionInput,
  PlannedActionUpdate,
  PreTurnPlannerActionStatus,
  PreTurnPlannerActionType,
} from "../echo/preTurnPlannerTypes";
import type { ActiveTurnActionStatus } from "../echo/activeTurnActionStripTypes";
import type { AmbientIntentKind } from "../echo/ambientEventTypes";
import type {
  EchoAudioSampleMetrics,
  EchoVoiceSettings,
} from "../echo/listeningTypes";
import { applyAthenaDerivedStateToField } from "../athena/derivedState";
import {
  createAthenaForecastInput,
  createForecastEnvironment,
} from "../athena/eventForecast";
import {
  createAthenaPendingTriggerQueue,
  AthenaPendingTriggerQueue,
} from "../athena/triggerQueue";
import {
  processAthenaConfirmedEventWithBookkeeping,
  processAthenaPendingTriggers,
  resolveAthenaPendingTrigger,
} from "../athena/triggerResolution";
import type {
  AthenaForecastInput,
  AthenaForecastInputDraft,
} from "../athena/eventForecastTypes";
import type { AthenaConfirmedConsequencePipelineResult } from "../athena/triggerResolutionTypes";
import {
  answerAthenaDecision as resolveAthenaDecisionAnswer,
  answerAthenaDecisionFromVoice as resolveAthenaDecisionVoiceAnswer,
  answerToTriggerResolutionDecision,
  createAthenaPreparedChoiceRequest,
  createAthenaReplacementDecisionRequest,
  enqueueAthenaDecision,
  revalidateAthenaDecisions,
  withNextAthenaTriggerDecision,
} from "../athena/decisionEngine";
import { createAthenaManualResultForecast } from "../athena/decisionManualResult";
import type {
  AthenaDecisionAnswer,
  AthenaDecisionResponseResult,
} from "../athena/decisionEngineTypes";
import type { AthenaPendingTriggerQueueSnapshot } from "../athena/triggerQueueTypes";
import {
  executeAthenaPreparedAction,
  matchAthenaPreparedActionForVoice,
  reconcileAthenaTurnIntentWithCanonicalAction,
  revalidateAthenaTurnIntent,
} from "../athena/turnIntent";
import {
  coordinateAthenaLiveTurnField,
  recordAthenaLiveTurnPipeline,
  requestAthenaLiveTurnEnd,
} from "../athena/liveTurnOrchestrator";
import { reconcileUnknownZoneGroupIdentity } from "../domain/zoneComposition";
import {
  applyAthenaReconciliation,
  createAthenaReconciliationRequest,
  markAthenaReconciliationLifecycle,
  structuredCorrectionIntentToRequest,
} from "../athena/reconciliation";
import type {
  AthenaReconciliationRepair,
  AthenaReconciliationResult,
  AthenaStructuredCorrectionIntent,
} from "../athena/reconciliationTypes";
import { athenaPerformanceMonitor } from "../athena/performanceOptimization";
import { parseEchoReconciliationCommand } from "../echo/reconciliationCommand";
import type {
  ZoneCompositionCommandResult,
  ZoneCompositionCorrectionInput,
} from "../domain/zoneCompositionTypes";

const HISTORY_LIMIT = 80;
let activeAthenaTriggerQueue: AthenaPendingTriggerQueue | null = null;

interface FieldStore {
  field: FieldState;
  hydrated: boolean;
  startupVisible: boolean;
  modal: ModalState | null;
  lastResult: ResolutionResult | null;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  initialize: () => Promise<void>;
  acknowledgeStartup: () => void;
  openModal: (modal: ModalState) => void;
  closeModal: () => void;
  addCard: (card: CardIdentity, quantity?: number) => void;
  addGeneric: (input: Parameters<typeof createGenericGroup>[0]) => void;
  activateField: () => void;
  applyCounters: (
    groupId: string,
    counter: string,
    amount: number,
    scope: StackScope,
    customQuantity: number,
    mode: CounterApplicationMode,
  ) => void;
  removeGroup: (groupId: string, quantity: number) => void;
  replaceGeneric: (
    groupId: string,
    card: CardIdentity,
    scope: StackScope,
    customQuantity: number,
  ) => void;
  transformCreatures: (
    card: CardIdentity,
    scope: "all" | "nontoken" | "tokens" | "selected",
    selectedIds: string[],
    restoreAbilities: boolean,
  ) => void;
  restoreTransformations: () => void;
  adjustLife: (delta: number, mode: "gain" | "loss" | "damage" | "pay") => void;
  setLifeExact: (value: number) => void;
  setPlayerCounter: (
    key: "poison" | "energy" | "experience" | "rad" | "commanderDamage",
    value: number,
  ) => void;
  toggleStatus: (
    groupId: string,
    status: keyof FieldState["groups"][number]["statuses"],
    value?: boolean,
  ) => void;
  setDepowerMode: (
    groupId: string,
    mode: FieldState["groups"][number]["depowerMode"],
  ) => void;
  setTrackingEnabled: (
    groupId: string,
    trackingEnabled: boolean,
    scope: StackScope,
    customQuantity: number,
  ) => void;
  setBasePowerToughness: (
    groupId: string,
    power: number | null,
    toughness: number | null,
  ) => void;
  setRelevantTotal: (
    key: RelevantTotalKey,
    value: number,
    mode?: "one-at-a-time" | "simultaneous" | "correction",
  ) => void;
  correctZoneComposition: (
    input: ZoneCompositionCorrectionInput,
  ) => ZoneCompositionCommandResult<FieldState>;
  applyReconciliation: (input: {
    repairs: AthenaReconciliationRepair[];
    source?: Parameters<typeof createAthenaReconciliationRequest>[0]["source"];
    level?: Parameters<typeof createAthenaReconciliationRequest>[0]["level"];
    confidence?: Parameters<
      typeof createAthenaReconciliationRequest
    >[0]["confidence"];
    atomic?: boolean;
    timestamp?: string;
    provenance?: string;
  }) => AthenaReconciliationResult;
  processEchoReconciliation: (input: {
    transcript: string;
    speakerVerified: boolean;
    catchUpMode?: boolean;
  }) => {
    intent: AthenaStructuredCorrectionIntent;
    result: AthenaReconciliationResult | null;
  };
  dismissCatchUpSuggestion: () => void;
  processAmbientIntent: (
    intent: AmbientIntent | AmbientIntentInput,
    mutation: AmbientFieldMutation,
  ) => AmbientPipelineResult;
  processConfirmedAthenaEvent: (
    event: AthenaForecastInput,
  ) => AthenaConfirmedConsequencePipelineResult;
  answerAthenaDecision: (
    decisionId: string,
    answer: Partial<AthenaDecisionAnswer>,
  ) => AthenaDecisionResponseResult | null;
  answerAthenaDecisionVoice: (input: {
    decisionId: string;
    transcript: string;
    speakerVerified: boolean;
    responseId?: string;
  }) => AthenaDecisionResponseResult | null;
  identifyAthenaDecisionZoneCard: (
    decisionId: string,
    candidateId: string,
    card: CardIdentity,
  ) => AthenaDecisionResponseResult | null;
  plannerAddAction: (input: PlannedActionInput) => void;
  plannerUpdateAction: (actionId: string, update: PlannedActionUpdate) => void;
  plannerRemoveAction: (actionId: string) => void;
  plannerReorderAction: (actionId: string, direction: -1 | 1) => void;
  plannerSetActionStatus: (
    actionId: string,
    status: PreTurnPlannerActionStatus,
  ) => void;
  plannerClearCompleted: () => void;
  plannerClearAll: () => void;
  plannerReset: () => void;
  plannerSetAvailableLandPlays: (remaining: number) => void;
  plannerSetGroupCollapsed: (
    group: PreTurnPlannerActionType | "completed",
    collapsed: boolean,
  ) => void;
  actionStripSelectItem: (itemId: string) => AmbientPipelineResult | null;
  actionStripConfirmVoice: (input: {
    intentKind: AmbientIntentKind;
    transcript: string;
    speakerVerified: boolean;
  }) => AmbientPipelineResult | null;
  actionStripSetItemStatus: (
    itemId: string,
    status: ActiveTurnActionStatus,
  ) => AmbientPipelineResult | null;
  actionStripReorderItem: (itemId: string, direction: -1 | 1) => void;
  actionStripClearCompleted: () => void;
  actionStripSetExpanded: (expanded: boolean) => void;
  actionStripSetCompletedCollapsed: (completedCollapsed: boolean) => void;
  initializeListening: () => Promise<void>;
  setVoiceSettings: (settings: Partial<EchoVoiceSettings>) => Promise<void>;
  requestMicrophonePermission: () => Promise<void>;
  startMicrophoneTest: () => Promise<void>;
  toggleListeningMute: () => Promise<void>;
  beginVoiceEnrollment: (mode?: EchoVoiceEnrollmentSession["mode"]) => void;
  setVoiceEnrollmentContext: (context: {
    environment?: EchoCalibrationEnvironment;
    devicePosition?: EchoMicrophonePosition;
    alternativePacing?: boolean;
  }) => void;
  recordVoiceEnrollmentSample: () => Promise<void>;
  deleteVoiceProfile: () => void;
  recordEnvironmentCalibration: () => Promise<void>;
  runSpeakerVerificationTest: () => Promise<void>;
  resetSpeakerVerificationData: () => void;
  removePronunciationLearningEntry: (entryId: string) => void;
  resetPronunciationLearning: () => void;
  acceptSmartSuggestion: (suggestionId: string) => void;
  dismissSmartSuggestion: (suggestionId: string) => void;
  resetPersonalGameplay: () => void;
  stopListening: () => Promise<void>;
  resetVoiceConfiguration: () => Promise<void>;
  handleListeningLifecycleEvent: (
    event: AmbientLifecycleEvent,
  ) => Promise<void>;
  reorderGroups: (groupId: string, direction: -1 | 1) => void;
  updateSettings: (settings: Partial<SettingsState>) => void;
  renameField: (name: string) => void;
  resetField: () => void;
  importField: (value: unknown) => boolean;
  exportField: () => string;
  undo: () => void;
  redo: () => void;
}

export const useFieldStore = create<FieldStore>((set, get) => ({
  field: createDefaultField(),
  hydrated: false,
  startupVisible: true,
  modal: { kind: "startup" },
  lastResult: null,
  undoStack: [],
  redoStack: [],

  async initialize() {
    activeAthenaTriggerQueue = null;
    if (isReferenceFixtureMode()) {
      const field = withDerivedField(createReferenceFixtureField());
      set({
        field,
        hydrated: true,
        startupVisible: false,
        modal: null,
        undoStack: [],
        redoStack: [],
        lastResult: null,
      });
      return;
    }
    const loaded = await loadLastField();
    if (loaded) {
      const sanitized = sanitizeImportedField(loaded);
      if (sanitized) {
        set({
          field: withDerivedField(sanitized),
          hydrated: true,
          startupVisible: true,
          modal: { kind: "startup" },
        });
        return;
      }
    }
    set({ hydrated: true, startupVisible: true, modal: { kind: "startup" } });
  },

  acknowledgeStartup() {
    set({ startupVisible: false, modal: null });
  },

  openModal(modal) {
    const field = get().field;
    if (modal.kind === "catchUp") {
      athenaPerformanceMonitor.recordInteraction(
        "reconciliation",
        "modal-open",
        { enabled: field.settings.athena.developerDiagnosticsEnabled },
      );
    }
    if (modal.kind === "planner") {
      athenaPerformanceMonitor.recordInteraction(
        "planner",
        field.preTurnPlanner.actions.length > 0
          ? "planner-reopen"
          : "modal-open",
        { enabled: field.settings.athena.developerDiagnosticsEnabled },
      );
    }
    set({ modal });
  },

  closeModal() {
    set({ modal: null });
  },

  addCard(card, quantity = 1) {
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Tracked card added as already present",
      repairs: [
        {
          id: makeId("repair-add-card"),
          kind: "add-card-already-present",
          identity: card,
          quantity: Math.max(1, Math.trunc(quantity)),
          zone: "battlefield",
        },
      ],
    });
  },

  addGeneric(input) {
    const generic = createGenericGroup(input);
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Generic placeholder added as already present",
      repairs: [
        {
          id: makeId("repair-add-generic"),
          kind: "add-generic-already-present",
          label: generic.label,
          quantity: generic.quantity,
          cardTypes: [...generic.characteristics.cardTypes],
          subtypes: [...generic.characteristics.subtypes],
          token: generic.characteristics.isToken,
          power: generic.pt.basePower,
          toughness: generic.pt.baseToughness,
          zone: generic.zone,
        },
      ],
    });
  },

  activateField() {
    const field = get().field;
    commitResult(
      "Activate Field",
      rulesAdapterManager.evaluateWithFallback(field, () =>
        resolveActivateField(field),
      ),
      set,
    );
  },

  applyCounters(groupId, counter, amount, scope, customQuantity, mode) {
    const field = get().field;
    const group = field.groups.find((entry) => entry.id === groupId);
    const normalizedAmount = Math.max(0, Math.trunc(amount));
    if (mode === "game-action" && group && normalizedAmount > 0) {
      const targetQuantity =
        scope === "one"
          ? 1
          : scope === "custom"
            ? Math.max(1, Math.min(Math.trunc(customQuantity), group.quantity))
            : group.quantity;
      get().processConfirmedAthenaEvent(
        createConfirmedManualAthenaEvent(field, {
          eventCategory: "counter-placed",
          quantity: normalizedAmount,
          subjectGroupIds: [group.id],
          counterType: counter,
          knownCharacteristics: group.characteristics,
          metadata: {
            label: group.label,
            targetQuantity,
            interaction: "counter-game-action",
          },
        }),
      );
      return;
    }
    if (!group || normalizedAmount === 0) return;
    const targetQuantity =
      scope === "one"
        ? 1
        : scope === "custom"
          ? Math.max(1, Math.min(Math.trunc(customQuantity), group.quantity))
          : group.quantity;
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Counter correction control",
      repairs: [
        {
          id: makeId("repair-counter"),
          kind: "set-counter",
          groupId,
          counter,
          value: (group.counters[counter] ?? 0) + normalizedAmount,
          quantity: targetQuantity,
        },
      ],
    });
  },

  removeGroup(groupId, quantity) {
    const group = get().field.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Neutral representation removal",
      repairs: [
        {
          id: makeId("repair-group-quantity"),
          kind: "set-group-quantity",
          groupId,
          value: Math.max(
            0,
            group.quantity - Math.max(0, Math.trunc(quantity)),
          ),
        },
      ],
    });
  },

  replaceGeneric(groupId, card, scope, customQuantity) {
    const group = get().field.groups.find((entry) => entry.id === groupId);
    if (!group || !group.isGeneric) return;
    const quantity =
      scope === "one"
        ? 1
        : scope === "custom"
          ? Math.max(1, Math.min(Math.trunc(customQuantity), group.quantity))
          : group.quantity;
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Generic placeholder identity replacement",
      repairs: [
        {
          id: makeId("repair-replace-identity"),
          kind: "replace-identity",
          groupId,
          identity: card,
          quantity,
        },
      ],
    });
  },

  transformCreatures(card, scope, selectedIds, restoreAbilities) {
    const targets = get().field.groups.filter((group) => {
      if (group.zone !== "battlefield" || !group.characteristics.isCreature)
        return false;
      if (scope === "nontoken") return !group.characteristics.isToken;
      if (scope === "tokens") return group.characteristics.isToken;
      if (scope === "selected") return selectedIds.includes(group.id);
      return true;
    });
    if (targets.length === 0) return;
    get().applyReconciliation({
      source: "manual-correction",
      level:
        targets.length > 1 ? "battlefield-reconciliation" : "quick-correction",
      confidence: "exact",
      provenance: "Transform All current-state identity update",
      repairs: targets.map((group) => ({
        id: makeId("repair-transform-face"),
        kind: "set-current-face" as const,
        groupId: group.id,
        identity: card,
        transformed: true,
        restoreAbilities,
      })),
    });
  },

  restoreTransformations() {
    const targets = get().field.groups.filter(
      (group) =>
        group.statuses.transformed &&
        group.originalIdentity &&
        group.originalCharacteristics,
    );
    if (targets.length === 0) return;
    get().applyReconciliation({
      source: "manual-correction",
      level:
        targets.length > 1 ? "battlefield-reconciliation" : "quick-correction",
      confidence: "exact",
      provenance: "Restore transformed current-state identities",
      repairs: targets.map((group) => ({
        id: makeId("repair-restore-face"),
        kind: "set-current-face" as const,
        groupId: group.id,
        identity: group.originalIdentity!,
        transformed: false,
      })),
    });
  },

  adjustLife(delta, mode) {
    const field = get().field;
    const quantity = Math.abs(Math.trunc(delta));
    if (quantity === 0) return;
    get().processConfirmedAthenaEvent(
      createConfirmedManualAthenaEvent(field, {
        eventCategory: delta > 0 ? "life-gained" : "life-lost",
        quantity,
        metadata: { lifeChangeMode: mode, interaction: "life-step" },
      }),
    );
  },

  setLifeExact(value) {
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Exact life editor",
      repairs: [
        {
          id: makeId("repair-life"),
          kind: "set-life",
          value: Math.max(0, Math.trunc(value)),
        },
      ],
    });
  },

  setPlayerCounter(key, value) {
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Exact player counter editor",
      repairs: [
        {
          id: makeId("repair-player-counter"),
          kind: "set-player-counter",
          counter: key,
          value: Math.max(0, Math.trunc(value)),
        },
      ],
    });
  },

  toggleStatus(groupId, status, value) {
    const group = get().field.groups.find((entry) => entry.id === groupId);
    if (!group) return;
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Permanent status control",
      repairs: [
        {
          id: makeId("repair-status"),
          kind: "set-status",
          groupId,
          status,
          value: value ?? !group.statuses[status],
        },
      ],
    });
  },

  setDepowerMode(groupId, mode) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      groups: before.groups.map((group) =>
        group.id === groupId
          ? withStackKey({
              ...group,
              abilitiesActive: mode === "none",
              depowerMode: mode,
              statuses: {
                ...group.statuses,
                depowered: mode !== "none",
              },
            })
          : group,
      ),
    });
    commitField(
      "Depower updated",
      before,
      next,
      [mode === "none" ? "Abilities restored." : "Abilities disabled."],
      set,
    );
  },

  setTrackingEnabled(groupId, trackingEnabled, scope, customQuantity) {
    commitResult(
      trackingEnabled ? "Resume tracking card" : "Stop tracking card",
      resolveSetTrackingEnabled(
        get().field,
        groupId,
        trackingEnabled,
        scope,
        customQuantity,
      ),
      set,
      false,
    );
  },

  setBasePowerToughness(groupId, power, toughness) {
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance: "Base power and toughness editor",
      repairs: [
        {
          id: makeId("repair-base-power-toughness"),
          kind: "set-base-power-toughness",
          groupId,
          power,
          toughness,
        },
      ],
    });
  },

  setRelevantTotal(key, value, mode = "correction") {
    const field = get().field;
    const totals = calculateTotals(field.groups);
    const current = totals[key] ?? 0;
    const nextValue = Math.max(0, Math.trunc(value));
    const delta = nextValue - current;
    if (delta === 0) return;
    if (key === "lands" && delta > 0 && mode !== "correction") {
      get().processConfirmedAthenaEvent(
        createConfirmedManualAthenaEvent(field, {
          eventCategory: "land-entered",
          quantity: delta,
          knownCharacteristics: { cardTypes: ["Land"] },
          zoneDestination: "battlefield",
          metadata: {
            label: "Generic Land",
            landEntryMode: mode,
            interaction: "relevant-total-game-action",
          },
        }),
      );
      return;
    }
    get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      provenance:
        mode === "correction"
          ? "Relevant total editor"
          : "Unsupported historical total adjustment reconciled as current state",
      repairs: [
        {
          id: makeId("repair-relevant-total"),
          kind: "set-relevant-total",
          key,
          value: nextValue,
        },
      ],
    });
  },

  correctZoneComposition(input) {
    const result = get().applyReconciliation({
      source: "manual-correction",
      level: "quick-correction",
      confidence: "exact",
      timestamp: input.timestamp,
      provenance: `${input.zone} composition editor`,
      repairs: [
        {
          id: makeId("repair-zone-composition"),
          kind: "set-zone-composition",
          zone: input.zone,
          physicalTotal: input.physicalTotal,
          manuallyAccountedPhysicalCards: input.manuallyAccountedPhysicalCards,
          categoryTotals: input.categoryTotals,
        },
      ],
    });
    return {
      ok: result.ok,
      field: result.field,
      reason: result.failureReason ?? result.semanticDescription,
      summary: result.discrepancies.map((entry) => entry.semanticDescription),
      changedCategoryKeys:
        input.selectedCategoryKeys ??
        (Object.keys(
          input.categoryTotals ?? {},
        ) as ZoneCompositionCommandResult<FieldState>["changedCategoryKeys"]),
      correctionOnly: true,
      gameplayEventsGenerated: false,
      replacementEffectsApplied: false,
      triggerInstancesGenerated: 0,
      consequenceEventsGenerated: 0,
    };
  },

  applyReconciliation(input) {
    const before = get().field;
    athenaPerformanceMonitor.recordInteraction(
      "reconciliation",
      "confirmation",
      { enabled: before.settings.athena.developerDiagnosticsEnabled },
    );
    athenaPerformanceMonitor.recordInteraction(
      "reconciliation",
      "correction-step",
      {
        count: input.repairs.length,
        enabled: before.settings.athena.developerDiagnosticsEnabled,
      },
    );
    const request = createAthenaReconciliationRequest({
      field: before,
      ...input,
      timestamp: input.timestamp ?? new Date().toISOString(),
    });
    const result = applyAthenaReconciliation(before, request);
    if (result.discrepancies.length === 0) {
      set({ field: result.field, lastResult: null });
      void saveField(result.field);
      return result;
    }
    const reconciled = withReconciliationInvalidationDiagnostics(
      before,
      withDerivedField(normalizeField(result.field)),
    );
    commitField(
      result.record.level === "catch-me-up"
        ? "Reconciliation: Catch Me Up"
        : "Correction",
      before,
      reconciled,
      result.discrepancies.length > 1
        ? [
            result.semanticDescription,
            ...result.discrepancies.map((entry) => entry.semanticDescription),
          ]
        : [result.semanticDescription],
      set,
      null,
      false,
      [],
    );
    const field = get().field;
    return {
      ...result,
      field,
      state: field.athena.reconciliation,
    };
  },

  processEchoReconciliation(input) {
    const field = get().field;
    const intent = parseEchoReconciliationCommand({
      ...input,
      field,
      timestamp: new Date().toISOString(),
    });
    const request = structuredCorrectionIntentToRequest({ field, intent });
    if (!request) return { intent, result: null };
    const result = get().applyReconciliation({
      repairs: request.repairs,
      source: request.source,
      level: request.level,
      confidence: request.confidence,
      atomic: request.atomic,
      timestamp: request.createdAt,
      provenance: request.provenance,
    });
    return { intent, result };
  },

  dismissCatchUpSuggestion() {
    const field = get().field;
    if (!field.athena.reconciliation.catchUpSuggested) return;
    const next = {
      ...field,
      athena: {
        ...field.athena,
        reconciliation: {
          ...field.athena.reconciliation,
          catchUpSuggested: false,
          updatedAt: new Date().toISOString(),
        },
      },
    };
    set({ field: next });
    void saveField(next);
  },

  processAmbientIntent(intent, mutation) {
    const timestamp = new Date().toISOString();
    const outcome = ambientEventPipeline.process({
      field: get().field,
      intent,
      mutation,
      approval: { method: "automatic" },
      timestamp,
    });
    if (outcome.status !== "completed") return outcome;
    const current = get();
    const observedField = withPersonalGameplayObservation(
      outcome.field,
      "Ambient intent processed",
      outcome.feedback.map((entry) => entry.message),
      timestamp,
    );
    const coordinatedField = withDerivedField(
      withAmbientOrchestratorPipelineCompletion(
        observedField,
        outcome,
        timestamp,
      ),
    );
    set({
      field: coordinatedField,
      undoStack: [
        ...current.undoStack,
        { ...outcome.historyEntry, after: coordinatedField },
      ].slice(-HISTORY_LIMIT),
      redoStack: [],
      lastResult: null,
    });
    void saveField(coordinatedField);
    return outcome;
  },

  processConfirmedAthenaEvent(event) {
    const before = get().field;
    const queue = athenaTriggerQueueForField(before, event.timestamp);
    const result = processAthenaConfirmedEventWithBookkeeping({
      field: before,
      event,
      queue,
      timestamp: event.timestamp,
    });
    if (result.validity !== "committed") {
      const request = createAthenaReplacementDecisionRequest({
        field: before,
        event,
        replacement: result.rootReplacement,
        queue: result.queue,
        timestamp: event.timestamp,
      });
      if (!request) return result;
      const decisionField = {
        ...before,
        athena: {
          ...before.athena,
          decisions: enqueueAthenaDecision(
            before.athena.decisions,
            request,
            event.timestamp,
          ),
        },
      };
      commitField(
        "Athena decision required",
        before,
        decisionField,
        [request.semanticPrompt],
        set,
        null,
        false,
      );
      return { ...result, resultingField: decisionField };
    }
    const resultingFieldWithDecision = withNextAthenaTriggerDecision(
      result.resultingField,
      result.queue,
      event.timestamp,
    );
    const resultingField = recordAthenaLiveTurnPipeline(
      resultingFieldWithDecision,
      {
        queue: result.queue,
        canonicalEvents: [
          ...(result.rootCanonicalEvent ? [result.rootCanonicalEvent] : []),
          ...(result.autoResolution?.generatedCanonicalEvents ?? []),
        ],
        unexpected: true,
        timestamp: event.timestamp,
      },
    );
    commitField(
      "Athena automatic bookkeeping",
      before,
      resultingField,
      [
        result.autoResolution?.semanticDescription ??
          "Confirmed event committed through Athena.",
      ],
      set,
      null,
      false,
      [
        ...(result.rootCanonicalEvent ? [result.rootCanonicalEvent] : []),
        ...(result.autoResolution?.generatedCanonicalEvents ?? []),
      ],
    );
    return { ...result, resultingField };
  },

  answerAthenaDecision(decisionId, answer) {
    const field = get().field;
    athenaPerformanceMonitor.recordInteraction("contextual-decision", "tap", {
      enabled: field.settings.athena.developerDiagnosticsEnabled,
    });
    return processAthenaDecisionResponse(field, decisionId, answer, set);
  },

  answerAthenaDecisionVoice(input) {
    const field = get().field;
    athenaPerformanceMonitor.recordInteraction(
      "contextual-decision",
      "voice-command",
      { enabled: field.settings.athena.developerDiagnosticsEnabled },
    );
    const timestamp = new Date().toISOString();
    const response = resolveAthenaDecisionVoiceAnswer(
      field.athena.decisions,
      field,
      { ...input, timestamp },
    );
    if (!response) return null;
    return continueAthenaDecisionResponse(field, response, set, timestamp);
  },

  identifyAthenaDecisionZoneCard(decisionId, candidateId, card) {
    const field = get().field;
    const request = field.athena.decisions.requests.find(
      (entry) => entry.id === decisionId,
    );
    const candidate = request?.candidates.find(
      (entry) => entry.id === candidateId && entry.kind === "untracked-card",
    );
    const zone = candidate?.zone;
    if (!request || (zone !== "graveyard" && zone !== "exile")) return null;
    const unknown = field.groups.find(
      (group) => group.zone === zone && !group.identity,
    );
    if (!unknown) return null;
    const timestamp = new Date().toISOString();
    const reconciled = reconcileUnknownZoneGroupIdentity(field, {
      groupId: unknown.id,
      card,
      quantity: 1,
      source: "scryfall-reconciliation",
      timestamp,
    });
    if (!reconciled.ok) return null;
    const identified = reconciled.field.groups.find(
      (group) =>
        group.zone === zone &&
        group.identity?.cardId === card.cardId &&
        (group.id === unknown.id ||
          !field.groups.some((entry) => entry.id === group.id)),
    );
    if (!identified) return null;
    const current = withDerivedField(normalizeField(reconciled.field));
    const response = resolveAthenaDecisionAnswer(
      current.athena.decisions,
      decisionId,
      {
        selectedOptionIds: [identified.id],
        targetGroupIds: [identified.id],
        selectedGroupIds: [identified.id],
        channel: "touch",
        answeredAt: timestamp,
      },
      current,
      timestamp,
    );
    return continueAthenaDecisionResponse(
      current,
      response,
      set,
      timestamp,
      field,
      reconciled.summary.join(" "),
    );
  },

  plannerAddAction(input) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const prepared = preparePlannerField(before, timestamp);
    if (prepared.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...prepared,
        preTurnPlanner: addPlannedAction(
          prepared.preTurnPlanner,
          input,
          timestamp,
        ),
      }),
      set,
    );
  },

  plannerUpdateAction(actionId, update) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: updatePlannedAction(
          synced.preTurnPlanner,
          actionId,
          update,
          timestamp,
        ),
      }),
      set,
    );
  },

  plannerRemoveAction(actionId) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: removePlannedAction(
          synced.preTurnPlanner,
          actionId,
          timestamp,
        ),
      }),
      set,
    );
  },

  plannerReorderAction(actionId, direction) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: reorderPlannedAction(
          synced.preTurnPlanner,
          actionId,
          direction,
          timestamp,
        ),
      }),
      set,
    );
  },

  plannerSetActionStatus(actionId, status) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: setPlannedActionStatus(
          synced.preTurnPlanner,
          actionId,
          status,
          timestamp,
        ),
      }),
      set,
    );
  },

  plannerClearCompleted() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: clearCompletedPlans(synced.preTurnPlanner, timestamp),
      }),
      set,
    );
  },

  plannerClearAll() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: clearAllPlans(synced.preTurnPlanner, timestamp),
      }),
      set,
    );
  },

  plannerReset() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    if (synced.preTurnPlanner.lifecycle.readOnly) return;
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: resetPreTurnPlanner(synced.preTurnPlanner, timestamp),
      }),
      set,
    );
  },

  plannerSetAvailableLandPlays(remaining) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const prepared = preparePlannerField(before, timestamp);
    commitPlannerField(
      normalizeField({
        ...prepared,
        preTurnPlanner: setAvailableLandPlays(
          prepared.preTurnPlanner,
          remaining,
          timestamp,
          "pre-turn-survey",
        ),
      }),
      set,
    );
  },

  plannerSetGroupCollapsed(group, collapsed) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncPlannerField(before, timestamp);
    commitPlannerField(
      normalizeField({
        ...synced,
        preTurnPlanner: setPlannerGroupCollapsed(
          synced.preTurnPlanner,
          group,
          collapsed,
          timestamp,
        ),
      }),
      set,
    );
  },

  actionStripSelectItem(itemId) {
    return processActionStripItem(get, set, itemId, "completed");
  },

  actionStripConfirmVoice(input) {
    const field = syncActionStripField(get().field, new Date().toISOString());
    const match = matchAthenaPreparedActionForVoice({ field, ...input });
    if (!match.accepted || !match.itemId) return null;
    return processActionStripItem(
      get,
      set,
      match.itemId,
      "completed",
      "voice",
      input.speakerVerified,
      input.transcript,
    );
  },

  actionStripSetItemStatus(itemId, status) {
    return processActionStripItem(get, set, itemId, status);
  },

  actionStripReorderItem(itemId, direction) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncActionStripField(before, timestamp);
    commitPlannerField(
      normalizeField({
        ...synced,
        activeTurnActionStrip: reorderActionStripItem(
          synced.activeTurnActionStrip,
          itemId,
          direction,
          timestamp,
        ),
      }),
      set,
    );
  },

  actionStripClearCompleted() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const synced = syncActionStripField(before, timestamp);
    commitPlannerField(
      normalizeField({
        ...synced,
        activeTurnActionStrip: clearCompletedActionStripItems(
          synced.activeTurnActionStrip,
          timestamp,
        ),
      }),
      set,
    );
  },

  actionStripSetExpanded(expanded) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    commitPlannerField(
      normalizeField({
        ...before,
        activeTurnActionStrip: setActionStripExpanded(
          before.activeTurnActionStrip,
          expanded,
          timestamp,
        ),
      }),
      set,
    );
  },

  actionStripSetCompletedCollapsed(completedCollapsed) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    commitPlannerField(
      normalizeField({
        ...before,
        activeTurnActionStrip: setActionStripCompletedCollapsed(
          before.activeTurnActionStrip,
          completedCollapsed,
          timestamp,
        ),
      }),
      set,
    );
  },

  async initializeListening() {
    ensureMicrophoneStoreSubscription(set);
    const field = get().field;
    echoMicrophoneService.hydrate(
      field.listening,
      field.settings.voice,
      field.ambient.currentMode,
      field.updatedAt,
    );
    await echoMicrophoneService.refreshAvailability(field.ambient.currentMode);
    persistMicrophoneStateFromService(set);
  },

  async setVoiceSettings(settings) {
    ensureMicrophoneStoreSubscription(set);
    const before = get().field;
    const voice = normalizeEchoVoiceSettings({
      ...before.settings.voice,
      ...settings,
    });
    const next = normalizeField({
      ...before,
      settings: normalizeSettings({
        ...before.settings,
        voice,
      }),
    });
    commitField(
      "Voice settings updated",
      before,
      next,
      ["Voice settings saved."],
      set,
    );
    echoMicrophoneService.hydrate(
      next.listening,
      next.settings.voice,
      next.ambient.currentMode,
      next.updatedAt,
    );
    await echoMicrophoneService.configure(voice, next.ambient.currentMode);
    persistMicrophoneStateFromService(set);
  },

  async requestMicrophonePermission() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    await echoMicrophoneService.requestPermission(
      get().field.ambient.currentMode,
    );
    persistMicrophoneStateFromService(set);
  },

  async startMicrophoneTest() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    await echoMicrophoneService.startListening({
      ambientMode: get().field.ambient.currentMode,
      testSession: true,
    });
    persistMicrophoneStateFromService(set);
  },

  async toggleListeningMute() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    const field = get().field;
    if (field.listening.status === "listening") {
      await echoMicrophoneService.stop("manual-stop", "manual-stop");
      persistMicrophoneStateFromService(set);
      return;
    }
    if (
      !field.settings.voice.voiceFeaturesEnabled ||
      !field.settings.voice.ambientListeningEnabled
    ) {
      persistMicrophoneStateFromService(set);
      return;
    }
    await echoMicrophoneService.startListening({
      ambientMode: field.ambient.currentMode,
      testSession: false,
    });
    persistMicrophoneStateFromService(set);
  },

  beginVoiceEnrollment(mode = "new") {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const enrollment = startVoiceEnrollment(
      before.settings.voice.enrollment,
      mode,
      timestamp,
    );
    commitVoiceSettingsField(
      "Voice enrollment started",
      before,
      {
        ...before.settings.voice,
        voiceFeaturesEnabled: true,
        privacyAcknowledged: true,
        enrollment,
        verification:
          mode === "new" || mode === "replace"
            ? resetSpeakerVerificationSettings(
                before.settings.voice.verification,
                timestamp,
              )
            : before.settings.voice.verification,
      },
      ["Voice enrollment started."],
      set,
    );
  },

  setVoiceEnrollmentContext(context) {
    const before = get().field;
    const enrollment = updateEnrollmentContext(
      before.settings.voice.enrollment,
      context,
    );
    commitVoiceSettingsField(
      "Voice enrollment context updated",
      before,
      {
        ...before.settings.voice,
        enrollment,
      },
      ["Voice enrollment context updated."],
      set,
    );
  },

  async recordVoiceEnrollmentSample() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    const before = get().field;
    const phrase = getCurrentEnrollmentPhrase(before.settings.voice.enrollment);
    if (!phrase) return;
    let metrics: EchoAudioSampleMetrics;
    try {
      metrics = await echoMicrophoneService.captureAudioSample(
        {
          purpose: "voice-enrollment",
          durationMs: before.settings.voice.enrollment.session.alternativePacing
            ? 2_400
            : 1_500,
        },
        before.ambient.currentMode,
      );
    } catch (error) {
      metrics = createFailedAudioSampleMetrics(
        error instanceof Error
          ? error.message
          : "The microphone could not record.",
      );
    }
    persistMicrophoneStateFromService(set);
    const latest = get().field;
    const result = applyVoiceEnrollmentSample(
      latest.settings.voice.enrollment,
      metrics,
    );
    commitVoiceSettingsField(
      result.accepted ? "Voice sample recorded" : "Voice sample rejected",
      latest,
      {
        ...latest.settings.voice,
        voiceFeaturesEnabled: true,
        privacyAcknowledged: true,
        enrollment: result.settings,
      },
      [result.message],
      set,
    );
  },

  deleteVoiceProfile() {
    const before = get().field;
    commitVoiceSettingsField(
      "Voice profile deleted",
      before,
      {
        ...before.settings.voice,
        enrollment: clearVoiceProfile(before.settings.voice.enrollment),
        verification: resetSpeakerVerificationSettings(
          before.settings.voice.verification,
        ),
      },
      ["Voice profile deleted."],
      set,
    );
  },

  async recordEnvironmentCalibration() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    const before = get().field;
    let metrics: EchoAudioSampleMetrics;
    try {
      metrics = await echoMicrophoneService.captureAudioSample(
        {
          purpose: "environment-calibration",
          durationMs: 1_400,
        },
        before.ambient.currentMode,
      );
    } catch (error) {
      metrics = createFailedAudioSampleMetrics(
        error instanceof Error
          ? error.message
          : "The microphone could not record.",
      );
    }
    persistMicrophoneStateFromService(set);
    const latest = get().field;
    if (metrics.corrupted) {
      commitVoiceSettingsField(
        "Environment calibration failed",
        latest,
        {
          ...latest.settings.voice,
          enrollment: updateEnrollmentContext(
            latest.settings.voice.enrollment,
            {},
          ),
        },
        ["Environment calibration could not use the recorded sample."],
        set,
      );
      return;
    }
    const session = latest.settings.voice.enrollment.session;
    const enrollment = addEnvironmentCalibration(
      latest.settings.voice.enrollment,
      {
        environment: session.currentEnvironment,
        devicePosition: session.currentDevicePosition,
        metrics,
      },
    );
    commitVoiceSettingsField(
      "Environment calibration recorded",
      latest,
      {
        ...latest.settings.voice,
        voiceFeaturesEnabled: true,
        privacyAcknowledged: true,
        enrollment,
      },
      ["Environment calibration recorded."],
      set,
    );
  },

  async runSpeakerVerificationTest() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    const before = get().field;
    let metrics: EchoAudioSampleMetrics;
    try {
      metrics = await echoMicrophoneService.captureAudioSample(
        {
          purpose: "speaker-verification",
          durationMs: 1_400,
        },
        before.ambient.currentMode,
      );
    } catch (error) {
      metrics = createFailedAudioSampleMetrics(
        error instanceof Error
          ? error.message
          : "The microphone could not record.",
      );
    }
    persistMicrophoneStateFromService(set);
    const latest = get().field;
    const session = latest.settings.voice.enrollment.session;
    echoSpeakerVerificationEngine.hydrate(latest.settings.voice.verification);
    const result = echoSpeakerVerificationEngine.verify({
      profile: latest.settings.voice.enrollment.profile,
      metrics,
      environment: session.currentEnvironment,
      devicePosition: session.currentDevicePosition,
      ambientMode: latest.ambient.currentMode,
      sensitivity: latest.settings.voice.verification.sensitivity,
    });
    commitVoiceSettingsField(
      result.verified
        ? "Speaker verification passed"
        : "Speaker verification rejected",
      latest,
      {
        ...latest.settings.voice,
        voiceFeaturesEnabled: true,
        privacyAcknowledged: true,
        verification: applySpeakerVerificationResult(
          latest.settings.voice.verification,
          result,
        ),
      },
      [result.reasons[0] ?? "Speaker verification completed."],
      set,
    );
  },

  resetSpeakerVerificationData() {
    const before = get().field;
    commitVoiceSettingsField(
      "Speaker verification reset",
      before,
      {
        ...before.settings.voice,
        verification: resetSpeakerVerificationSettings(
          before.settings.voice.verification,
        ),
      },
      ["Speaker verification data reset."],
      set,
    );
  },

  removePronunciationLearningEntry(entryId) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const next = normalizeField({
      ...before,
      pronunciationLearning: removePronunciationVocabularyEntry(
        before.pronunciationLearning,
        entryId,
        {
          timestamp,
          settings: before.settings.voice.pronunciationLearning,
        },
      ),
    });
    commitField(
      "Learned phrase deleted",
      before,
      next,
      ["Learned phrase deleted."],
      set,
    );
  },

  resetPronunciationLearning() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const next = normalizeField({
      ...before,
      pronunciationLearning: resetPronunciationLearningState({
        timestamp,
        settings: before.settings.voice.pronunciationLearning,
      }),
      settings: normalizeSettings({
        ...before.settings,
        voice: normalizeEchoVoiceSettings({
          ...before.settings.voice,
          pronunciationLearning: {
            ...before.settings.voice.pronunciationLearning,
            lastResetAt: timestamp,
          },
        }),
      }),
    });
    commitField(
      "Learned vocabulary reset",
      before,
      next,
      ["Learned vocabulary reset."],
      set,
    );
  },

  acceptSmartSuggestion(suggestionId) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const next = normalizeField({
      ...before,
      personalGameplay: acceptPersonalGameplaySuggestion(
        before.personalGameplay,
        suggestionId,
        {
          timestamp,
          settings: before.settings.personalGameplay,
        },
      ),
    });
    commitField(
      "Smart suggestion accepted",
      before,
      next,
      ["Smart suggestion accepted."],
      set,
      null,
      false,
    );
  },

  dismissSmartSuggestion(suggestionId) {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const next = normalizeField({
      ...before,
      personalGameplay: dismissPersonalGameplaySuggestion(
        before.personalGameplay,
        suggestionId,
        {
          timestamp,
          settings: before.settings.personalGameplay,
        },
      ),
    });
    commitField(
      "Smart suggestion dismissed",
      before,
      next,
      ["Smart suggestion dismissed."],
      set,
      null,
      false,
    );
  },

  resetPersonalGameplay() {
    const before = get().field;
    const timestamp = new Date().toISOString();
    const next = normalizeField({
      ...before,
      personalGameplay: resetPersonalGameplayState({
        timestamp,
        settings: before.settings.personalGameplay,
      }),
      settings: normalizeSettings({
        ...before.settings,
        personalGameplay: {
          ...before.settings.personalGameplay,
          lastResetAt: timestamp,
        },
      }),
    });
    commitField(
      "Personalization reset",
      before,
      next,
      ["Personalization reset."],
      set,
      null,
      false,
    );
  },

  async stopListening() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    await echoMicrophoneService.stop();
    persistMicrophoneStateFromService(set);
  },

  async resetVoiceConfiguration() {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    echoMicrophoneService.resetVoiceConfiguration();
    persistMicrophoneStateFromService(set);
  },

  async handleListeningLifecycleEvent(event) {
    ensureMicrophoneStoreSubscription(set);
    syncMicrophoneServiceFromField(get().field);
    await echoMicrophoneService.handleLifecycleEvent(event);
    persistMicrophoneStateFromService(set);
    if (
      event.type === "app-backgrounded" ||
      event.type === "app-foregrounded"
    ) {
      const current = get().field;
      const timestamp = event.timestamp ?? new Date().toISOString();
      const next = markAthenaReconciliationLifecycle(
        current,
        event.type,
        timestamp,
      );
      set({ field: next });
      void saveField(next);
    }
  },

  reorderGroups(groupId, direction) {
    const before = get().field;
    const sorted = [...before.groups].sort((a, b) => a.order - b.order);
    const index = sorted.findIndex((group) => group.id === groupId);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) return;
    const currentOrder = sorted[index].order;
    sorted[index] = { ...sorted[index], order: sorted[targetIndex].order };
    sorted[targetIndex] = { ...sorted[targetIndex], order: currentOrder };
    const next = normalizeField({ ...before, groups: sorted });
    commitField(
      "Reorder permanents",
      before,
      next,
      ["Permanent order changed."],
      set,
    );
  },

  updateSettings(settings) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      settings: normalizeSettings({
        ...before.settings,
        ...settings,
        voice:
          settings.voice === undefined
            ? before.settings.voice
            : {
                ...before.settings.voice,
                ...settings.voice,
              },
      }),
    });
    commitField("Settings updated", before, next, ["Settings saved."], set);
  },

  renameField(name) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      name: name.trim().slice(0, 80) || "Baord State Lite Field",
    });
    commitField(
      "Rename field",
      before,
      next,
      [`Renamed field to ${next.name}.`],
      set,
    );
  },

  resetField() {
    const before = get().field;
    const next = createDefaultField();
    activeAthenaTriggerQueue = null;
    commitField("Reset field", before, next, ["Field reset."], set);
  },

  importField(value) {
    const imported = sanitizeImportedField(value);
    if (!imported) return false;
    const before = get().field;
    activeAthenaTriggerQueue = null;
    commitField(
      "Import field",
      before,
      imported,
      ["Imported local backup."],
      set,
    );
    return true;
  },

  exportField() {
    return sharedSessionManager.export(get().field);
  },

  undo() {
    const { undoStack, redoStack } = get();
    const entry = undoStack.at(-1);
    if (!entry) return;
    const field = withDerivedField(entry.before);
    activeAthenaTriggerQueue = null;
    set({
      field,
      undoStack: undoStack.slice(0, -1),
      redoStack: [entry, ...redoStack].slice(0, HISTORY_LIMIT),
      lastResult: null,
    });
    syncSubscribedMicrophoneService(field);
    void saveField(field);
  },

  redo() {
    const { undoStack, redoStack } = get();
    const entry = redoStack[0];
    if (!entry) return;
    const field = withDerivedField(entry.after);
    activeAthenaTriggerQueue = null;
    set({
      field,
      undoStack: [...undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: redoStack.slice(1),
      lastResult: null,
    });
    syncSubscribedMicrophoneService(field);
    void saveField(field);
  },
}));

let microphoneStoreUnsubscribe: (() => void) | null = null;

function ensureMicrophoneStoreSubscription(
  set: (partial: Partial<FieldStore>) => void,
): void {
  if (microphoneStoreUnsubscribe) return;
  microphoneStoreUnsubscribe = echoMicrophoneService.subscribe(() => {
    persistMicrophoneStateFromService(set);
  });
  echoMicrophoneService.startEnvironmentListeners();
}

function syncMicrophoneServiceFromField(field: FieldState): void {
  echoMicrophoneService.hydrate(
    field.listening,
    field.settings.voice,
    field.ambient.currentMode,
    field.updatedAt,
  );
}

function syncSubscribedMicrophoneService(field: FieldState): void {
  if (!microphoneStoreUnsubscribe) return;
  syncMicrophoneServiceFromField(field);
}

function persistMicrophoneStateFromService(
  set: (partial: Partial<FieldStore>) => void,
): void {
  const current = useFieldStore.getState();
  const next = withDerivedField(
    normalizeField({
      ...current.field,
      settings: normalizeSettings({
        ...current.field.settings,
        voice: echoMicrophoneService.getSettings(),
      }),
      listening: echoMicrophoneService.getState(),
    }),
  );
  set({ field: next });
  void saveField(next);
}

function commitVoiceSettingsField(
  label: string,
  before: FieldState,
  voice: EchoVoiceSettings,
  summary: string[],
  set: (partial: Partial<FieldStore>) => void,
): void {
  const next = normalizeField({
    ...before,
    settings: normalizeSettings({
      ...before.settings,
      voice: normalizeEchoVoiceSettings(voice),
    }),
  });
  commitField(label, before, next, summary, set);
}

function createFailedAudioSampleMetrics(error: string): EchoAudioSampleMetrics {
  return {
    capturedAt: new Date().toISOString(),
    durationMs: 0,
    sampleRate: null,
    channelCount: null,
    activeDeviceId: null,
    activeDeviceLabel: error,
    rmsDb: -120,
    peakDb: -120,
    noiseFloorDb: -120,
    dynamicRangeDb: 0,
    clippingRatio: 0,
    zeroCrossingRate: 0,
    spectralCentroidHz: 0,
    corrupted: true,
    rawAudioRetained: false,
  };
}

function createConfirmedManualAthenaEvent(
  field: FieldState,
  draft: Omit<
    AthenaForecastInputDraft,
    "eventId" | "eventSource" | "authoritySource" | "timestamp" | "confidence"
  >,
): AthenaForecastInput {
  const timestamp = new Date().toISOString();
  const eventId = makeId("manual-canonical-event");
  return createAthenaForecastInput(
    {
      ...draft,
      eventId,
      batchId: draft.batchId ?? eventId,
      eventSource: "manual-report",
      authoritySource: "confirmed-user-report",
      timestamp,
      metadata: {
        ...draft.metadata,
        confirmed: true,
        canonicalEvent: true,
        hypothetical: false,
      },
      confidence: {
        level: "high",
        score: 1,
        speakerVerified: null,
      },
    },
    createForecastEnvironment(field),
  );
}

function commitResult(
  label: string,
  result: ResolutionResult,
  set: (partial: Partial<FieldStore>) => void,
  showSummary = true,
): void {
  const before = useFieldStore.getState().field;
  const rendered = rulesResultRenderer.renderLiteHelperResult(before, result);
  commitField(
    label,
    before,
    rendered.result.field,
    rendered.result.summary,
    set,
    showSummary ? rendered.result : null,
    true,
    rendered.result.events,
  );
}

function commitField(
  label: string,
  before: FieldState,
  after: FieldState,
  summary: string[],
  set: (partial: Partial<FieldStore>) => void,
  result: ResolutionResult | null = null,
  observePersonalGameplay = true,
  canonicalEvents: GameEvent[] = result?.events ?? [],
): void {
  const committedAt = new Date().toISOString();
  const reconciledAfter =
    canonicalEvents.reduce(
      (current, event) =>
        reconcileAthenaTurnIntentWithCanonicalAction(
          current,
          event,
          committedAt,
        ),
      after,
    ) ?? after;
  const observedAfter = observePersonalGameplay
    ? withPersonalGameplayObservation(
        reconciledAfter,
        label,
        summary,
        committedAt,
      )
    : reconciledAfter;
  const coordinatedAfter = withAmbientOrchestratorContext(
    observedAfter,
    committedAt,
  );
  const derivedAfter = withDerivedField(coordinatedAfter);
  const entry: HistoryEntry = {
    id: makeId("history"),
    label,
    before,
    after: derivedAfter,
    summary,
    createdAt: committedAt,
  };
  const current = useFieldStore.getState();
  set({
    field: derivedAfter,
    undoStack: [...current.undoStack, entry].slice(-HISTORY_LIMIT),
    redoStack: [],
    lastResult: result ? { ...result, field: derivedAfter } : null,
    modal: result ? { kind: "summary" } : current.modal,
  });
  syncSubscribedMicrophoneService(derivedAfter);
  void saveField(derivedAfter);
}

function athenaTriggerQueueForField(
  field: FieldState,
  timestamp: string,
): AthenaPendingTriggerQueue {
  const participantId = field.multiplayer.registry.localParticipantId;
  const snapshot = activeAthenaTriggerQueue?.toSnapshot();
  if (
    !snapshot ||
    snapshot.canonicalSessionId !== field.session.id ||
    snapshot.participantId !== participantId
  ) {
    activeAthenaTriggerQueue = createAthenaPendingTriggerQueue({
      canonicalSessionId: field.session.id,
      participantId,
      timestamp,
    });
  }
  return activeAthenaTriggerQueue!;
}

function processAthenaDecisionResponse(
  field: FieldState,
  decisionId: string,
  answer: Partial<AthenaDecisionAnswer>,
  set: (partial: Partial<FieldStore>) => void,
): AthenaDecisionResponseResult | null {
  const timestamp = new Date().toISOString();
  const response = resolveAthenaDecisionAnswer(
    field.athena.decisions,
    decisionId,
    { ...answer, channel: answer.channel ?? "touch", answeredAt: timestamp },
    field,
    timestamp,
  );
  return continueAthenaDecisionResponse(field, response, set, timestamp);
}

function continueAthenaDecisionResponse(
  field: FieldState,
  response: AthenaDecisionResponseResult,
  set: (partial: Partial<FieldStore>) => void,
  timestamp: string,
  historyBefore: FieldState = field,
  priorSummary = "",
): AthenaDecisionResponseResult {
  if (!response.accepted) {
    if (response.queue !== field.athena.decisions) {
      const next = {
        ...field,
        athena: { ...field.athena, decisions: response.queue },
      };
      set({ field: next });
      void saveField(next);
    }
    return response;
  }
  let working: FieldState = {
    ...field,
    athena: { ...field.athena, decisions: response.queue },
  };
  const continuation = response.continuation;
  let canonicalEvents: GameEvent[] = [];
  let latestQueue: AthenaPendingTriggerQueueSnapshot | null = null;
  let summary = [priorSummary, response.semanticDescription]
    .filter(Boolean)
    .join(" ");
  if (continuation.kind === "trigger-resolution") {
    const queue = athenaTriggerQueueForContinuation(
      working,
      continuation.queue,
      timestamp,
      continuation.triggerId,
    );
    activeAthenaTriggerQueue = queue;
    if (response.request.type === "manual-result") {
      const manualEvent = createAthenaManualResultForecast(
        working,
        response.request,
        timestamp,
      );
      if (manualEvent) {
        queue.markResolved(
          continuation.triggerId,
          timestamp,
          response.request.answer?.responseId ?? response.request.id,
        );
        const pipeline = processAthenaConfirmedEventWithBookkeeping({
          field: working,
          event: manualEvent,
          queue,
          timestamp,
        });
        latestQueue = pipeline.queue;
        if (pipeline.validity === "committed") {
          working = withNextAthenaTriggerDecision(
            pipeline.resultingField,
            pipeline.queue,
            timestamp,
          );
          canonicalEvents = [
            ...(pipeline.rootCanonicalEvent
              ? [pipeline.rootCanonicalEvent]
              : []),
            ...(pipeline.autoResolution?.generatedCanonicalEvents ?? []),
          ];
          summary =
            "Manual result committed through the canonical Athena pipeline.";
        } else {
          const replacementRequest = createAthenaReplacementDecisionRequest({
            field: working,
            event: manualEvent,
            replacement: pipeline.rootReplacement,
            queue: pipeline.queue,
            timestamp,
          });
          if (replacementRequest) {
            working = {
              ...working,
              athena: {
                ...working.athena,
                decisions: enqueueAthenaDecision(
                  working.athena.decisions,
                  replacementRequest,
                  timestamp,
                ),
              },
            };
          }
          summary = pipeline.reason;
        }
      }
      working = coordinateAthenaLiveTurnField(working, {
        signal: "decision-answered",
        queue: latestQueue,
        canonicalEvents,
        timestamp,
      });
      commitField(
        "Athena manual result",
        historyBefore,
        working,
        [summary],
        set,
        null,
        false,
        canonicalEvents,
      );
      return response;
    }
    const decision = answerToTriggerResolutionDecision(response.request);
    const orderedTriggerIds = response.request.answer?.orderIds ?? [];
    if (orderedTriggerIds.length > 0) {
      queue.applyUserOrder(orderedTriggerIds, timestamp);
    }
    const resolved = resolveAthenaPendingTrigger(
      working,
      queue,
      orderedTriggerIds[0] ?? continuation.triggerId,
      { timestamp, decision },
    );
    latestQueue = resolved.queue;
    working = resolved.resultingField;
    canonicalEvents = resolved.eventRecords.flatMap((record) =>
      record.canonicalEvent ? [record.canonicalEvent] : [],
    );
    summary = resolved.semanticDescription;
    if (resolved.status === "resolved" || resolved.status === "declined") {
      const cycle = processAthenaPendingTriggers({
        field: working,
        queue,
        timestamp,
      });
      latestQueue = cycle.queue;
      working = cycle.field;
      canonicalEvents.push(...cycle.generatedCanonicalEvents);
      summary = [summary, cycle.semanticDescription].filter(Boolean).join(" ");
      working = withNextAthenaTriggerDecision(working, cycle.queue, timestamp);
    } else {
      working = withNextAthenaTriggerDecision(
        working,
        resolved.queue,
        timestamp,
        {
          [continuation.triggerId]: decision,
        },
      );
    }
  } else if (continuation.kind === "replacement-processing") {
    const queue = athenaTriggerQueueForContinuation(
      working,
      continuation.queue,
      timestamp,
    );
    activeAthenaTriggerQueue = queue;
    const selectedOrder =
      response.request.type === "replacement-order"
        ? response.request.answer?.orderIds.length
          ? response.request.answer.orderIds
          : response.request.answer?.selectedOptionIds
        : continuation.selectedOrder;
    const optionalDecision = {
      ...continuation.optionalDecisions,
      ...(response.request.type === "optional-replacement"
        ? Object.fromEntries(
            continuation.relationshipIds.map((relationshipId) => [
              relationshipId,
              response.request.answer?.accepted === true,
            ]),
          )
        : {}),
    };
    const pipeline = processAthenaConfirmedEventWithBookkeeping({
      field: working,
      event: continuation.event,
      queue,
      timestamp,
      replacement: {
        selectedReplacementOrder: selectedOrder,
        optionalReplacementDecisions: optionalDecision,
      },
    });
    latestQueue = pipeline.queue;
    if (pipeline.validity === "committed") {
      working = withNextAthenaTriggerDecision(
        pipeline.resultingField,
        pipeline.queue,
        timestamp,
      );
      canonicalEvents = [
        ...(pipeline.rootCanonicalEvent ? [pipeline.rootCanonicalEvent] : []),
        ...(pipeline.autoResolution?.generatedCanonicalEvents ?? []),
      ];
      summary =
        pipeline.autoResolution?.semanticDescription ??
        "Replacement choice applied and the event completed.";
    } else {
      const nextRequest = createAthenaReplacementDecisionRequest({
        field: working,
        event: continuation.event,
        replacement: pipeline.rootReplacement,
        queue: pipeline.queue,
        optionalDecisions: optionalDecision,
        selectedOrder,
        timestamp,
      });
      if (nextRequest) {
        working = {
          ...working,
          athena: {
            ...working.athena,
            decisions: enqueueAthenaDecision(
              working.athena.decisions,
              nextRequest,
              timestamp,
            ),
          },
        };
      }
      summary = pipeline.reason;
    }
  } else if (continuation.kind === "prepared-action") {
    working = applyPreparedDecisionToField(
      working,
      response.request,
      timestamp,
    );
    const action = working.preTurnPlanner.actions.find(
      (entry) =>
        entry.prepared.preparedActionId === continuation.preparedActionId,
    );
    const item = working.activeTurnActionStrip.items.find(
      (entry) => entry.preparedActionId === continuation.preparedActionId,
    );
    if (action && item) {
      const execution = executeAthenaPreparedAction({
        field: working,
        item,
        queue: athenaTriggerQueueForField(working, timestamp),
        channel: response.request.answer?.channel === "voice" ? "voice" : "tap",
        timestamp,
        speakerVerified:
          response.request.answer?.channel === "voice" ? true : null,
      });
      if (execution.status === "committed") {
        working = execution.field;
        canonicalEvents = execution.canonicalEvents;
        latestQueue = execution.pipeline?.queue ?? latestQueue;
        summary = execution.semanticDescription;
      } else if (execution.status === "awaiting-input") {
        const nextRequest = createAthenaPreparedChoiceRequest({
          field: working,
          action,
          timestamp,
        });
        if (nextRequest) {
          working = {
            ...working,
            athena: {
              ...working.athena,
              decisions: enqueueAthenaDecision(
                working.athena.decisions,
                nextRequest,
                timestamp,
              ),
            },
          };
        }
        summary = execution.reason;
      }
    }
  }
  working = coordinateAthenaLiveTurnField(working, {
    signal: "decision-answered",
    queue: latestQueue,
    canonicalEvents,
    timestamp,
  });
  commitField(
    "Athena decision resolved",
    historyBefore,
    working,
    [summary],
    set,
    null,
    false,
    canonicalEvents,
  );
  return response;
}

function athenaTriggerQueueForContinuation(
  field: FieldState,
  snapshot: AthenaPendingTriggerQueueSnapshot,
  timestamp: string,
  requiredTriggerId?: string,
): AthenaPendingTriggerQueue {
  const participantId = field.multiplayer.registry.localParticipantId;
  const activeSnapshot = activeAthenaTriggerQueue?.toSnapshot();
  if (
    activeAthenaTriggerQueue &&
    activeSnapshot?.canonicalSessionId === field.session.id &&
    activeSnapshot.participantId === participantId &&
    (requiredTriggerId
      ? Boolean(activeAthenaTriggerQueue.get(requiredTriggerId))
      : activeSnapshot.updatedAt >= snapshot.updatedAt)
  ) {
    return activeAthenaTriggerQueue;
  }
  activeAthenaTriggerQueue = new AthenaPendingTriggerQueue({
    canonicalSessionId: field.session.id,
    participantId,
    timestamp,
    snapshot,
  });
  return activeAthenaTriggerQueue;
}

function applyPreparedDecisionToField(
  field: FieldState,
  request: import("../athena/decisionEngineTypes").AthenaDecisionRequest,
  timestamp: string,
): FieldState {
  const answer = request.answer;
  if (!answer || !request.preparedActionId) return field;
  const completedRequirements = new Set<string>();
  if (answer.targetGroupIds.length > 0) {
    completedRequirements.add("target");
    completedRequirements.add("selection");
  }
  if (answer.quantity !== null) completedRequirements.add("quantity");
  if (answer.mode) completedRequirements.add("mode");
  if (answer.orderIds.length > 0) completedRequirements.add("order");
  return {
    ...field,
    preTurnPlanner: {
      ...field.preTurnPlanner,
      updatedAt: timestamp,
      intentVersion: field.preTurnPlanner.intentVersion + 1,
      actions: field.preTurnPlanner.actions.map((action) => {
        if (action.prepared.preparedActionId !== request.preparedActionId)
          return action;
        return {
          ...action,
          updatedAt: timestamp,
          quantity: answer.quantity ?? action.quantity,
          execution: {
            ...action.execution,
            quantity: answer.quantity ?? action.execution.quantity,
            targetGroupIds:
              answer.targetGroupIds.length > 0
                ? [...answer.targetGroupIds]
                : action.execution.targetGroupIds,
            mode: answer.mode ?? action.execution.mode,
            requirements: action.execution.requirements.filter(
              (requirement) => !completedRequirements.has(requirement),
            ),
          },
        };
      }),
    },
  };
}

function withDerivedField(field: FieldState): FieldState {
  athenaPerformanceMonitor.setEnabled(
    field.settings.athena.developerDiagnosticsEnabled,
  );
  const derived = applyAthenaDerivedStateToField(field, {
    timestamp: field.updatedAt,
    reason: "canonical-field-change",
  });
  const planned = revalidateAthenaTurnIntent(derived.field, field.updatedAt);
  const decided = revalidateAthenaDecisions(planned, field.updatedAt);
  return coordinateAthenaLiveTurnField(decided, {
    signal: "reconcile",
    timestamp: field.updatedAt,
  });
}

function withReconciliationInvalidationDiagnostics(
  before: FieldState,
  after: FieldState,
): FieldState {
  const invalidPreparedActionIds = new Set(
    after.preTurnPlanner.actions
      .filter((action) =>
        ["invalidated", "stale"].includes(action.prepared.validity),
      )
      .map((action) => action.id),
  );
  const priorInvalidPreparedActionIds = new Set(
    before.preTurnPlanner.actions
      .filter((action) =>
        ["invalidated", "stale"].includes(action.prepared.validity),
      )
      .map((action) => action.id),
  );
  const invalidDecisionIds = new Set(
    after.athena.decisions.requests
      .filter((request) => ["invalidated", "stale"].includes(request.status))
      .map((request) => request.id),
  );
  const priorInvalidDecisionIds = new Set(
    before.athena.decisions.requests
      .filter((request) => ["invalidated", "stale"].includes(request.status))
      .map((request) => request.id),
  );
  const preparedActionsInvalidated = [...invalidPreparedActionIds].filter(
    (id) => !priorInvalidPreparedActionIds.has(id),
  ).length;
  const decisionsInvalidated = [...invalidDecisionIds].filter(
    (id) => !priorInvalidDecisionIds.has(id),
  ).length;
  if (preparedActionsInvalidated === 0 && decisionsInvalidated === 0) {
    return after;
  }
  const reconciliation = after.athena.reconciliation;
  return {
    ...after,
    athena: {
      ...after.athena,
      reconciliation: {
        ...reconciliation,
        diagnostics: {
          ...reconciliation.diagnostics,
          preparedActionsInvalidated:
            reconciliation.diagnostics.preparedActionsInvalidated +
            preparedActionsInvalidated,
          decisionsInvalidated:
            reconciliation.diagnostics.decisionsInvalidated +
            decisionsInvalidated,
        },
      },
    },
  };
}

function commitPlannerField(
  field: FieldState,
  set: (partial: Partial<FieldStore>) => void,
): void {
  const observedField = withPersonalGameplayObservation(
    field,
    "Planner interaction",
    ["Planner workflow updated."],
  );
  const coordinatedField = withDerivedField(
    withAmbientOrchestratorContext(observedField),
  );
  set({ field: coordinatedField, lastResult: null });
  syncSubscribedMicrophoneService(coordinatedField);
  void saveField(coordinatedField);
}

function withPersonalGameplayObservation(
  field: FieldState,
  label: string,
  summary: string[] = [],
  timestamp = new Date().toISOString(),
): FieldState {
  const result = observePersonalGameplaySignal(
    field.personalGameplay,
    personalGameplaySignalForCommit(field, label, summary, timestamp),
    {
      field,
      settings: field.settings.personalGameplay,
      timestamp,
    },
  );
  return {
    ...field,
    personalGameplay: result.state,
  };
}

function withAmbientOrchestratorContext(
  field: FieldState,
  timestamp = new Date().toISOString(),
): FieldState {
  return {
    ...field,
    ambientOrchestrator: refreshAmbientOrchestratorContext(
      field.ambientOrchestrator,
      field,
      {
        timestamp,
        settings: field.settings.ambientOrchestrator,
      },
    ),
  };
}

function withAmbientOrchestratorPipelineCompletion(
  field: FieldState,
  outcome: AmbientPipelineResult,
  timestamp = new Date().toISOString(),
): FieldState {
  return {
    ...field,
    ambientOrchestrator: recordAmbientPipelineCompletion(
      field.ambientOrchestrator,
      field,
      {
        result: outcome,
        timestamp,
        settings: field.settings.ambientOrchestrator,
      },
    ),
  };
}

function preparePlannerField(field: FieldState, timestamp: string): FieldState {
  if (field.ambient.currentMode !== "passive") {
    return syncPlannerField(field, timestamp);
  }
  const engine = new AmbientGameplayEngine(field.ambient);
  const transition = engine.requestTransition({
    targetMode: "preTurnPreparation",
    reason: "manual",
    timestamp,
  });
  const nextAmbient = transition.ok ? transition.state : field.ambient;
  return normalizeField({
    ...field,
    ambient: nextAmbient,
    preTurnPlanner: syncPlannerWithAmbientMode(
      field.preTurnPlanner,
      nextAmbient.currentMode,
      timestamp,
    ),
    contextualListening: syncContextualListeningWithAmbientMode(
      field.contextualListening,
      {
        ambientMode: nextAmbient.currentMode,
        timestamp,
        source: "planner",
      },
    ),
    adaptiveListeningTail: syncAdaptiveListeningTailWithAmbientMode(
      field.adaptiveListeningTail,
      {
        ambientMode: nextAmbient.currentMode,
        timestamp,
        settings: field.settings.voice.adaptiveListeningTail,
      },
    ),
  });
}

function syncPlannerField(field: FieldState, timestamp: string): FieldState {
  return normalizeField({
    ...field,
    preTurnPlanner: syncPlannerWithAmbientMode(
      field.preTurnPlanner,
      field.ambient.currentMode,
      timestamp,
    ),
    contextualListening: syncContextualListeningWithAmbientMode(
      field.contextualListening,
      {
        ambientMode: field.ambient.currentMode,
        timestamp,
        source: "planner",
      },
    ),
    adaptiveListeningTail: syncAdaptiveListeningTailWithAmbientMode(
      field.adaptiveListeningTail,
      {
        ambientMode: field.ambient.currentMode,
        timestamp,
        settings: field.settings.voice.adaptiveListeningTail,
      },
    ),
  });
}

function syncActionStripField(
  field: FieldState,
  timestamp: string,
): FieldState {
  const syncedPlanner = syncPlannerWithAmbientMode(
    field.preTurnPlanner,
    field.ambient.currentMode,
    timestamp,
  );
  return normalizeField({
    ...field,
    preTurnPlanner: syncedPlanner,
    activeTurnActionStrip: synchronizeActionStripWithPlanner(
      field.activeTurnActionStrip,
      {
        planner: syncedPlanner,
        ambientMode: field.ambient.currentMode,
        timestamp,
        sessionId: field.session.id,
      },
    ),
    contextualListening: syncContextualListeningWithAmbientMode(
      field.contextualListening,
      {
        ambientMode: field.ambient.currentMode,
        timestamp,
        source: "action-strip",
      },
    ),
    adaptiveListeningTail: syncAdaptiveListeningTailWithAmbientMode(
      field.adaptiveListeningTail,
      {
        ambientMode: field.ambient.currentMode,
        timestamp,
        settings: field.settings.voice.adaptiveListeningTail,
      },
    ),
  });
}

function processActionStripItem(
  get: () => FieldStore,
  set: (partial: Partial<FieldStore>) => void,
  itemId: string,
  status: ActiveTurnActionStatus,
  channel: "tap" | "voice" = "tap",
  speakerVerified: boolean | null = null,
  recognizedText: string | null = null,
): AmbientPipelineResult | null {
  const timestamp = new Date().toISOString();
  const baseField = syncActionStripField(get().field, timestamp);
  const item = baseField.activeTurnActionStrip.items.find(
    (entry) => entry.id === itemId,
  );
  if (!item) return null;
  if (status === "completed") {
    athenaPerformanceMonitor.recordInteraction(
      channel === "voice" ? "voice-prepared-action" : "prepared-action",
      channel === "voice" ? "voice-command" : "tap",
      {
        recordedAt: timestamp,
        enabled: baseField.settings.athena.developerDiagnosticsEnabled,
      },
    );
  }
  if (
    status === "completed" &&
    (item.status === "completed" || item.confirmationReceiptId)
  ) {
    return null;
  }

  const confirmationIntentId = `prepared-confirmation:${item.preparedActionId}`;

  const outcome = ambientEventPipeline.process({
    field: baseField,
    intent: {
      ...item.intent,
      id:
        status === "completed"
          ? confirmationIntentId
          : `${confirmationIntentId}:${status}:${timestamp}`,
      confidence: "high",
      requiresPreview: false,
      payload: {
        ...(item.intent.payload ?? {}),
        actionStripItemId: item.id,
        actionStripStatus: status,
        confirmationChannel: channel,
      },
    },
    approval: { method: "automatic" },
    mutation: ({ field: current }) => {
      if (status === "completed" && isPreparedGameplayItem(item.kind)) {
        const preparedExecution = executeAthenaPreparedAction({
          field: current,
          item,
          queue: athenaTriggerQueueForField(current, timestamp),
          channel,
          timestamp,
          speakerVerified,
          recognizedText,
        });
        if (preparedExecution.status === "awaiting-input") {
          const plannedAction = current.preTurnPlanner.actions.find(
            (action) => action.id === item.sourceActionId,
          );
          const request = plannedAction
            ? createAthenaPreparedChoiceRequest({
                field: current,
                action: plannedAction,
                timestamp,
              })
            : null;
          if (!request) throw new Error(preparedExecution.reason);
          athenaPerformanceMonitor.recordInteraction(
            "contextual-decision",
            "decision-interruption",
            {
              recordedAt: timestamp,
              enabled: current.settings.athena.developerDiagnosticsEnabled,
            },
          );
          return {
            field: {
              ...current,
              athena: {
                ...current.athena,
                decisions: enqueueAthenaDecision(
                  current.athena.decisions,
                  request,
                  timestamp,
                ),
              },
            },
            title: "Choice Needed",
            summary: [request.semanticPrompt],
            details: [],
            events: [],
            changedGroupIds: [],
            loopDetected: false,
            accessibilityAnnouncements: [request.semanticPrompt],
          } satisfies ResolutionResult;
        }
        if (preparedExecution.status !== "committed") {
          throw new Error(preparedExecution.reason);
        }
        const orchestratedField = preparedExecution.pipeline
          ? recordAthenaLiveTurnPipeline(preparedExecution.field, {
              queue: preparedExecution.pipeline.queue,
              canonicalEvents: preparedExecution.canonicalEvents,
              actionId: item.id,
              preparedActionId: item.preparedActionId,
              actionKind: item.kind,
              confirmationReceiptId: preparedExecution.confirmationReceiptId,
              timestamp,
            })
          : preparedExecution.field;
        return {
          field: orchestratedField,
          title: "Prepared Action Completed",
          summary: [preparedExecution.semanticDescription],
          details: [],
          events: preparedExecution.canonicalEvents,
          changedGroupIds: uniqueStrings(
            preparedExecution.canonicalEvents.flatMap(
              (event) => event.groupIds,
            ),
          ),
          loopDetected: false,
          accessibilityAnnouncements: [
            preparedExecution.accessibilityDescription,
          ],
        } satisfies ResolutionResult;
      }
      return applyActionStripMutation(current, item.id, status, timestamp);
    },
    timestamp,
  });

  if (outcome.status === "completed") {
    const current = get();
    const observedField = withPersonalGameplayObservation(
      outcome.field,
      "Action Strip item completed",
      outcome.feedback.map((entry) => entry.message),
      timestamp,
    );
    const coordinatedField = withDerivedField(
      withAmbientOrchestratorPipelineCompletion(
        observedField,
        outcome,
        timestamp,
      ),
    );
    set({
      field: coordinatedField,
      undoStack: [
        ...current.undoStack,
        { ...outcome.historyEntry, after: coordinatedField },
      ].slice(-HISTORY_LIMIT),
      redoStack: [],
      lastResult: null,
    });
    syncSubscribedMicrophoneService(coordinatedField);
    void saveField(coordinatedField);
    return outcome;
  }

  const message =
    outcome.event?.result.error ??
    outcome.feedback[0]?.message ??
    `Action Strip item ${item.label} could not be completed.`;
  const blocked = normalizeField({
    ...baseField,
    activeTurnActionStrip: markActionStripPipelineResult(
      baseField.activeTurnActionStrip,
      {
        itemId,
        status: "blocked",
        timestamp,
        eventId: outcome.event?.id ?? null,
        failureReason: message,
      },
    ),
  });
  const observedBlocked = withPersonalGameplayObservation(
    blocked,
    "Action Strip item blocked",
    [message],
    timestamp,
  );
  const coordinatedBlocked = withDerivedField(
    withAmbientOrchestratorPipelineCompletion(
      observedBlocked,
      outcome,
      timestamp,
    ),
  );
  set({ field: coordinatedBlocked, lastResult: null });
  syncSubscribedMicrophoneService(coordinatedBlocked);
  void saveField(coordinatedBlocked);
  return outcome;
}

function isPreparedGameplayItem(
  kind: FieldState["activeTurnActionStrip"]["items"][number]["kind"],
): boolean {
  return (
    kind === "draw" ||
    kind === "play-planned-land" ||
    kind === "cast-planned-spell" ||
    kind === "activate-planned-ability" ||
    kind === "sacrifice-planned-permanent" ||
    kind === "move-planned-card"
  );
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function applyActionStripMutation(
  field: FieldState,
  itemId: string,
  status: ActiveTurnActionStatus,
  timestamp: string,
): FieldState {
  const synced = syncActionStripField(field, timestamp);
  const item = synced.activeTurnActionStrip.items.find(
    (entry) => entry.id === itemId,
  );
  if (!item) return synced;

  if (kindRequestsTurnEnd(item.kind) && status === "completed") {
    const end = requestAthenaLiveTurnEnd(synced, timestamp);
    if (!end.allowed) {
      return coordinateAthenaLiveTurnField(
        normalizeField({
          ...synced,
          athena: { ...synced.athena, liveTurn: end.state },
          activeTurnActionStrip: markActionStripPipelineResult(
            synced.activeTurnActionStrip,
            {
              itemId,
              status: "blocked",
              timestamp,
              failureReason: end.semanticDescription,
            },
          ),
        }),
        { signal: "end-turn-requested", timestamp },
      );
    }
  }

  const nextAmbient =
    status === "completed"
      ? transitionForActionItem(synced, item.kind, timestamp)
      : synced.ambient;
  const plannerStatus = plannerStatusFromActionStripStatus(status);
  const nextPlanner =
    item.sourceActionId && plannerStatus
      ? setPlannedActionStatus(
          synced.preTurnPlanner,
          item.sourceActionId,
          plannerStatus,
          timestamp,
        )
      : synced.preTurnPlanner;
  const nextStrip = markActionStripPipelineResult(
    setActionStripItemStatus(
      synced.activeTurnActionStrip,
      itemId,
      status,
      timestamp,
    ),
    {
      itemId,
      status,
      timestamp,
      eventId: null,
      failureReason: null,
    },
  );

  const nextField = normalizeField({
    ...synced,
    ambient: nextAmbient,
    preTurnPlanner: syncPlannerWithAmbientMode(
      nextPlanner,
      nextAmbient.currentMode,
      timestamp,
    ),
    activeTurnActionStrip: synchronizeActionStripWithPlanner(nextStrip, {
      planner: nextPlanner,
      ambientMode: nextAmbient.currentMode,
      timestamp,
      sessionId: synced.session.id,
    }),
    contextualListening: syncContextualListeningWithAmbientMode(
      synced.contextualListening,
      {
        ambientMode: nextAmbient.currentMode,
        timestamp,
        source: "action-strip",
      },
    ),
    adaptiveListeningTail: syncAdaptiveListeningTailWithAmbientMode(
      synced.adaptiveListeningTail,
      {
        ambientMode: nextAmbient.currentMode,
        timestamp,
        settings: synced.settings.voice.adaptiveListeningTail,
      },
    ),
  });
  return coordinateAthenaLiveTurnField(nextField, {
    signal:
      item.kind === "begin-turn"
        ? "turn-started"
        : item.kind === "move-to-combat"
          ? "combat-started"
          : item.kind === "end-combat"
            ? "combat-completed"
            : item.kind === "end-turn"
              ? "turn-completed"
              : status === "completed"
                ? "action-completed"
                : "reconcile",
    actionId: item.id,
    preparedActionId: item.preparedActionId,
    actionKind: item.kind,
    timestamp,
  });
}

function kindRequestsTurnEnd(
  kind: FieldState["activeTurnActionStrip"]["items"][number]["kind"],
): boolean {
  return kind === "end-turn";
}

function transitionForActionItem(
  field: FieldState,
  kind: FieldState["activeTurnActionStrip"]["items"][number]["kind"],
  timestamp: string,
): FieldState["ambient"] {
  const engine = new AmbientGameplayEngine(field.ambient);
  if (kind === "begin-turn") {
    const result = engine.requestTransition({
      targetMode: "activeTurn",
      reason: "turn-owner-changed",
      timestamp,
    });
    return result.ok ? result.state : field.ambient;
  }
  if (kind === "move-to-combat") {
    const result = engine.requestTransition({
      targetMode: "combat",
      reason: "phase-changed",
      timestamp,
      context: {
        originMode: field.ambient.currentMode,
        focusedAction: "combatDeclaration",
      },
    });
    return result.ok ? result.state : field.ambient;
  }
  if (kind === "end-combat") {
    const result = engine.requestTransition({
      targetMode: "activeTurn",
      reason: "combat-finalized",
      timestamp,
    });
    return result.ok ? result.state : field.ambient;
  }
  if (kind === "end-turn") {
    const result = engine.requestTransition({
      targetMode: "postTurn",
      reason: "phase-changed",
      timestamp,
    });
    return result.ok ? result.state : field.ambient;
  }
  return field.ambient;
}
