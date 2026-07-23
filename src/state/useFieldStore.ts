import { create } from "zustand";
import {
  createCardGroup,
  createGenericGroup,
  makeId,
  recalculateStats,
  withStackKey,
} from "../domain/cards";
import {
  activateField as resolveActivateField,
  applyCounters as resolveApplyCounters,
  removeGroupQuantity as resolveRemoveGroupQuantity,
  replaceGenericIdentity as resolveReplaceGenericIdentity,
  resolveLandEntry,
  restoreTransformations as resolveRestoreTransformations,
  setLife as resolveSetLife,
  setTrackingEnabled as resolveSetTrackingEnabled,
  transformCreatures as resolveTransformCreatures,
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
import {
  addEnvironmentCalibration,
  deleteVoiceProfile as clearVoiceProfile,
  getCurrentEnrollmentPhrase,
  recordVoiceEnrollmentSample as applyVoiceEnrollmentSample,
  startVoiceEnrollment,
  updateEnrollmentContext,
} from "../echo/voiceEnrollment";
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
import type {
  EchoAudioSampleMetrics,
  EchoVoiceSettings,
} from "../echo/listeningTypes";

const HISTORY_LIMIT = 80;

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
  processAmbientIntent: (
    intent: AmbientIntent | AmbientIntentInput,
    mutation: AmbientFieldMutation,
  ) => AmbientPipelineResult;
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
  plannerSetGroupCollapsed: (
    group: PreTurnPlannerActionType | "completed",
    collapsed: boolean,
  ) => void;
  actionStripSelectItem: (itemId: string) => AmbientPipelineResult | null;
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
  beginVoiceEnrollment: (mode?: EchoVoiceEnrollmentSession["mode"]) => void;
  setVoiceEnrollmentContext: (context: {
    environment?: EchoCalibrationEnvironment;
    devicePosition?: EchoMicrophonePosition;
    alternativePacing?: boolean;
  }) => void;
  recordVoiceEnrollmentSample: () => Promise<void>;
  deleteVoiceProfile: () => void;
  recordEnvironmentCalibration: () => Promise<void>;
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
    if (isReferenceFixtureMode()) {
      set({
        field: createReferenceFixtureField(),
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
          field: sanitized,
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
    set({ modal });
  },

  closeModal() {
    set({ modal: null });
  },

  addCard(card, quantity = 1) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      groups: [...before.groups, createCardGroup(card, quantity)],
      recentCards: [
        card,
        ...before.recentCards.filter((entry) => entry.cardId !== card.cardId),
      ].slice(0, 20),
    });
    commitField(
      "Add tracked card",
      before,
      next,
      [`Added ${card.name} as an active tracked permanent.`],
      set,
    );
  },

  addGeneric(input) {
    const before = get().field;
    const generic = createGenericGroup(input);
    const next = normalizeField({
      ...before,
      groups: [...before.groups, generic],
    });
    commitField(
      "Add generic placeholder",
      before,
      next,
      [`Added ${generic.quantity} ${generic.label}.`],
      set,
    );
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
    commitResult(
      "Counters updated",
      resolveApplyCounters(
        get().field,
        groupId,
        counter,
        amount,
        scope,
        customQuantity,
        mode,
      ),
      set,
    );
  },

  removeGroup(groupId, quantity) {
    commitResult(
      "Remove permanent",
      resolveRemoveGroupQuantity(get().field, groupId, quantity),
      set,
    );
  },

  replaceGeneric(groupId, card, scope, customQuantity) {
    commitResult(
      "Replace generic placeholder",
      resolveReplaceGenericIdentity(
        get().field,
        groupId,
        card,
        scope,
        customQuantity,
      ),
      set,
    );
  },

  transformCreatures(card, scope, selectedIds, restoreAbilities) {
    commitResult(
      "Transform all creatures",
      resolveTransformCreatures(
        get().field,
        card,
        scope,
        selectedIds,
        restoreAbilities,
      ),
      set,
    );
  },

  restoreTransformations() {
    commitResult(
      "Restore transformations",
      resolveRestoreTransformations(get().field),
      set,
    );
  },

  adjustLife(delta, mode) {
    const field = get().field;
    commitResult(
      "Life change",
      resolveSetLife(field, field.player.life + delta, mode),
      set,
      false,
    );
  },

  setLifeExact(value) {
    commitResult(
      "Set life total",
      resolveSetLife(get().field, value, "set"),
      set,
      false,
    );
  },

  setPlayerCounter(key, value) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      player: {
        ...before.player,
        counters: {
          ...before.player.counters,
          [key]: Math.max(0, Math.trunc(value)),
        },
      },
    });
    commitField(
      "Player counter updated",
      before,
      next,
      [`${key} set to ${Math.max(0, Math.trunc(value))}.`],
      set,
    );
  },

  toggleStatus(groupId, status, value) {
    const before = get().field;
    const next = normalizeField({
      ...before,
      groups: before.groups.map((group) => {
        if (group.id !== groupId) return group;
        return withStackKey(
          recalculateStats({
            ...group,
            statuses: {
              ...group.statuses,
              [status]: value ?? !group.statuses[status],
            },
          }),
        );
      }),
    });
    commitField("Status updated", before, next, ["Status changed."], set);
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
    const before = get().field;
    const next = normalizeField({
      ...before,
      groups: before.groups.map((group) => {
        if (group.id !== groupId) return group;
        return withStackKey(
          recalculateStats({
            ...group,
            pt: {
              ...group.pt,
              basePower: power,
              baseToughness: toughness,
            },
          }),
        );
      }),
    });
    commitField(
      "Base power and toughness updated",
      before,
      next,
      ["Base power/toughness changed."],
      set,
    );
  },

  setRelevantTotal(key, value, mode = "correction") {
    const field = get().field;
    const totals = calculateTotals(field.groups);
    const current = totals[key] ?? 0;
    const nextValue = Math.max(0, Math.trunc(value));
    const delta = nextValue - current;
    if (delta === 0) return;
    if (key === "lands" && delta > 0 && mode !== "correction") {
      commitResult(
        "Landfall background event",
        resolveLandEntry(field, delta, mode),
        set,
      );
      return;
    }
    const before = field;
    const next = normalizeField({
      ...before,
      groups: adjustManualTotal(before.groups, key, delta),
    });
    commitField(
      "Relevant total updated",
      before,
      next,
      [`${key} adjusted by ${delta}.`],
      set,
    );
  },

  processAmbientIntent(intent, mutation) {
    const outcome = ambientEventPipeline.process({
      field: get().field,
      intent,
      mutation,
      approval: { method: "automatic" },
    });
    if (outcome.status !== "completed") return outcome;
    const current = get();
    set({
      field: outcome.field,
      undoStack: [...current.undoStack, outcome.historyEntry].slice(
        -HISTORY_LIMIT,
      ),
      redoStack: [],
      lastResult: null,
    });
    void saveField(outcome.field);
    return outcome;
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
    commitField("Reset field", before, next, ["Field reset."], set);
  },

  importField(value) {
    const imported = sanitizeImportedField(value);
    if (!imported) return false;
    const before = get().field;
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
    set({
      field: entry.before,
      undoStack: undoStack.slice(0, -1),
      redoStack: [entry, ...redoStack].slice(0, HISTORY_LIMIT),
      lastResult: null,
    });
    syncSubscribedMicrophoneService(entry.before);
    void saveField(entry.before);
  },

  redo() {
    const { undoStack, redoStack } = get();
    const entry = redoStack[0];
    if (!entry) return;
    set({
      field: entry.after,
      undoStack: [...undoStack, entry].slice(-HISTORY_LIMIT),
      redoStack: redoStack.slice(1),
      lastResult: null,
    });
    syncSubscribedMicrophoneService(entry.after);
    void saveField(entry.after);
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
  const next = normalizeField({
    ...current.field,
    settings: normalizeSettings({
      ...current.field.settings,
      voice: echoMicrophoneService.getSettings(),
    }),
    listening: echoMicrophoneService.getState(),
  });
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
  );
}

function commitField(
  label: string,
  before: FieldState,
  after: FieldState,
  summary: string[],
  set: (partial: Partial<FieldStore>) => void,
  result: ResolutionResult | null = null,
): void {
  const entry: HistoryEntry = {
    id: makeId("history"),
    label,
    before,
    after,
    summary,
    createdAt: new Date().toISOString(),
  };
  const current = useFieldStore.getState();
  set({
    field: after,
    undoStack: [...current.undoStack, entry].slice(-HISTORY_LIMIT),
    redoStack: [],
    lastResult: result,
    modal: result ? { kind: "summary" } : current.modal,
  });
  syncSubscribedMicrophoneService(after);
  void saveField(after);
}

function commitPlannerField(
  field: FieldState,
  set: (partial: Partial<FieldStore>) => void,
): void {
  set({ field, lastResult: null });
  syncSubscribedMicrophoneService(field);
  void saveField(field);
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
  });
}

function processActionStripItem(
  get: () => FieldStore,
  set: (partial: Partial<FieldStore>) => void,
  itemId: string,
  status: ActiveTurnActionStatus,
): AmbientPipelineResult | null {
  const timestamp = new Date().toISOString();
  const baseField = syncActionStripField(get().field, timestamp);
  const item = baseField.activeTurnActionStrip.items.find(
    (entry) => entry.id === itemId,
  );
  if (!item) return null;

  const outcome = ambientEventPipeline.process({
    field: baseField,
    intent: {
      ...item.intent,
      id: makeId("strip-intent"),
      confidence: "high",
      requiresPreview: false,
      payload: {
        ...(item.intent.payload ?? {}),
        actionStripItemId: item.id,
        actionStripStatus: status,
      },
    },
    approval: { method: "automatic" },
    mutation: ({ field: current }) =>
      applyActionStripMutation(current, item.id, status, timestamp),
    timestamp,
  });

  if (outcome.status === "completed") {
    const current = get();
    set({
      field: outcome.field,
      undoStack: [...current.undoStack, outcome.historyEntry].slice(
        -HISTORY_LIMIT,
      ),
      redoStack: [],
      lastResult: null,
    });
    syncSubscribedMicrophoneService(outcome.field);
    void saveField(outcome.field);
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
  set({ field: blocked, lastResult: null });
  syncSubscribedMicrophoneService(blocked);
  void saveField(blocked);
  return outcome;
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

  const nextAmbient = transitionForActionItem(synced, item.kind, timestamp);
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

  return normalizeField({
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
  });
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

function adjustManualTotal(
  groups: FieldState["groups"],
  key: RelevantTotalKey,
  delta: number,
): FieldState["groups"] {
  if (delta > 0) {
    return [...groups, createManualGroup(key, delta)];
  }
  let remaining = Math.abs(delta);
  const nextGroups = groups
    .map((group) => {
      if (!group.label.startsWith(`Manual ${key}`) || remaining <= 0)
        return group;
      const removed = Math.min(group.quantity, remaining);
      remaining -= removed;
      return { ...group, quantity: group.quantity - removed };
    })
    .filter((group) => group.quantity > 0);
  return nextGroups;
}

function createManualGroup(
  key: RelevantTotalKey,
  quantity: number,
): FieldState["groups"][number] {
  if (key === "creatures") {
    return createGenericGroup({
      kind: "Creature",
      label: `Manual ${key}`,
      quantity,
    });
  }
  if (key === "artifacts") {
    return createGenericGroup({
      kind: "Artifact",
      label: `Manual ${key}`,
      quantity,
    });
  }
  if (key === "equipment") {
    return createGenericGroup({
      kind: "Equipment",
      label: `Manual ${key}`,
      quantity,
    });
  }
  if (key === "enchantments") {
    return createGenericGroup({
      kind: "Enchantment",
      label: `Manual ${key}`,
      quantity,
    });
  }
  if (key === "cardsInHand") {
    return createGenericGroup({
      kind: "Custom",
      label: `Manual ${key}`,
      quantity,
      zone: "hand",
    });
  }
  if (key === "cardsInGraveyard") {
    return createGenericGroup({
      kind: "Custom",
      label: `Manual ${key}`,
      quantity,
      zone: "graveyard",
    });
  }
  if (key === "cardsInExile") {
    return createGenericGroup({
      kind: "Custom",
      label: `Manual ${key}`,
      quantity,
      zone: "exile",
    });
  }
  if (key === "cardsRemainingInLibrary") {
    return createGenericGroup({
      kind: "Custom",
      label: `Manual ${key}`,
      quantity,
      zone: "library",
    });
  }
  return createGenericGroup({ kind: "Land", label: `Manual ${key}`, quantity });
}
