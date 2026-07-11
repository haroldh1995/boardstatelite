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
import { sharedSessionManager } from "../sharedSession";

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
      settings: { ...before.settings, ...settings },
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
    void saveField(entry.after);
  },
}));

function commitResult(
  label: string,
  result: ResolutionResult,
  set: (partial: Partial<FieldStore>) => void,
  showSummary = true,
): void {
  const before = useFieldStore.getState().field;
  commitField(
    label,
    before,
    result.field,
    result.summary,
    set,
    showSummary ? result : null,
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
  void saveField(after);
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
