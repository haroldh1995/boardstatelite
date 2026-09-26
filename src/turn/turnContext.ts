import { makeId } from "../domain/cards";
import {
  TURN_CONTEXT_VERSION,
  type TriggerMemoryItem,
  type TriggerMemoryStatus,
  type TurnContextState,
  type TurnMemorySummary,
  type TurnQuickPhase,
  type TurnStep,
} from "./types";

const DEFAULT_STEP: Record<TurnQuickPhase, TurnStep> = {
  beginning: "untap",
  "precombat-main": "precombat-main",
  combat: "begin-combat",
  "postcombat-main": "postcombat-main",
  ending: "end-step",
};

const QUICK_PHASE_ORDER: TurnQuickPhase[] = [
  "beginning",
  "precombat-main",
  "combat",
  "postcombat-main",
  "ending",
];

export function createDefaultTurnContext(
  timestamp = new Date().toISOString(),
): TurnContextState {
  return {
    version: TURN_CONTEXT_VERSION,
    status: "between-turns",
    turnId: makeId("turn"),
    turnNumber: 0,
    quickPhase: "beginning",
    step: "untap",
    startedAt: null,
    endedAt: null,
    phaseChangedAt: timestamp,
    combatAccounted: false,
    triggerMemory: [],
    archivedTriggerCount: 0,
    oncePerTurnKeys: [],
    dismissedReminderKeys: [],
  };
}

export function normalizeTurnContext(
  value: unknown,
  timestamp = new Date().toISOString(),
): TurnContextState {
  const defaults = createDefaultTurnContext(timestamp);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<TurnContextState>;
  const quickPhase = QUICK_PHASE_ORDER.includes(
    candidate.quickPhase as TurnQuickPhase,
  )
    ? (candidate.quickPhase as TurnQuickPhase)
    : defaults.quickPhase;
  return {
    ...defaults,
    ...candidate,
    version: TURN_CONTEXT_VERSION,
    status: candidate.status === "active" ? "active" : "between-turns",
    quickPhase,
    step:
      typeof candidate.step === "string"
        ? candidate.step
        : DEFAULT_STEP[quickPhase],
    turnNumber: bounded(candidate.turnNumber, 0, 999999, 0),
    triggerMemory: Array.isArray(candidate.triggerMemory)
      ? candidate.triggerMemory.slice(-160)
      : [],
    oncePerTurnKeys: unique(candidate.oncePerTurnKeys),
    dismissedReminderKeys: unique(candidate.dismissedReminderKeys),
  };
}

export function startTurn(
  state: TurnContextState,
  timestamp = new Date().toISOString(),
): TurnContextState {
  const archived = state.triggerMemory.filter((entry) =>
    ["resolved", "declined", "possible-missed"].includes(entry.status),
  ).length;
  return {
    ...state,
    status: "active",
    turnId: makeId("turn"),
    turnNumber: state.turnNumber + 1,
    quickPhase: "beginning",
    step: "untap",
    startedAt: timestamp,
    endedAt: null,
    phaseChangedAt: timestamp,
    combatAccounted: false,
    triggerMemory: [],
    archivedTriggerCount: state.archivedTriggerCount + archived,
    oncePerTurnKeys: [],
    dismissedReminderKeys: [],
  };
}

export function endTurn(
  state: TurnContextState,
  timestamp = new Date().toISOString(),
): TurnContextState {
  return {
    ...state,
    status: "between-turns",
    quickPhase: "ending",
    step: "cleanup",
    endedAt: timestamp,
    phaseChangedAt: timestamp,
    triggerMemory: state.triggerMemory.map((entry) =>
      entry.status === "pending"
        ? { ...entry, status: "possible-missed" as const }
        : entry,
    ),
  };
}

export function setTurnPhase(
  state: TurnContextState,
  phase: TurnQuickPhase,
  timestamp = new Date().toISOString(),
): TurnContextState {
  return {
    ...state,
    status: "active",
    quickPhase: phase,
    step: DEFAULT_STEP[phase],
    phaseChangedAt: timestamp,
    combatAccounted:
      state.combatAccounted ||
      phase === "postcombat-main" ||
      phase === "ending",
  };
}

export function advanceTurnPhase(
  state: TurnContextState,
  timestamp = new Date().toISOString(),
): TurnContextState {
  const index = QUICK_PHASE_ORDER.indexOf(state.quickPhase);
  const next =
    QUICK_PHASE_ORDER[Math.min(index + 1, QUICK_PHASE_ORDER.length - 1)];
  return setTurnPhase(state, next, timestamp);
}

export function enqueueTriggerMemory(
  state: TurnContextState,
  item: Omit<
    TriggerMemoryItem,
    "id" | "observedAt" | "resolvedAt" | "status"
  > & {
    id?: string;
    observedAt?: string;
    status?: TriggerMemoryStatus;
  },
): TurnContextState {
  if (
    item.oncePerTurnKey &&
    state.oncePerTurnKeys.includes(item.oncePerTurnKey)
  ) {
    return state;
  }
  const trigger: TriggerMemoryItem = {
    ...item,
    id: item.id ?? makeId("turn-trigger"),
    observedAt: item.observedAt ?? new Date().toISOString(),
    resolvedAt: null,
    status: item.status ?? "pending",
  };
  return {
    ...state,
    triggerMemory: [
      ...state.triggerMemory.filter((entry) => entry.id !== trigger.id),
      trigger,
    ].slice(-160),
    oncePerTurnKeys: item.oncePerTurnKey
      ? unique([...state.oncePerTurnKeys, item.oncePerTurnKey])
      : state.oncePerTurnKeys,
  };
}

export function resolveTriggerMemory(
  state: TurnContextState,
  id: string,
  status: Exclude<TriggerMemoryStatus, "pending">,
  timestamp = new Date().toISOString(),
): TurnContextState {
  return {
    ...state,
    triggerMemory: state.triggerMemory.map((entry) =>
      entry.id === id ? { ...entry, status, resolvedAt: timestamp } : entry,
    ),
  };
}

export function summarizeTurnMemory(
  state: TurnContextState,
): TurnMemorySummary {
  const count = (status: TriggerMemoryStatus) =>
    state.triggerMemory.filter((entry) => entry.status === status).length;
  const pending = count("pending");
  const possibleMissed = count("possible-missed");
  const attention = pending + possibleMissed;
  return {
    pending,
    possibleMissed,
    resolved: count("resolved"),
    declined: count("declined"),
    compactLabel: attention > 0 ? `TURN ${attention}` : "TURN OK",
    complete: attention === 0,
  };
}

export function quickPhaseLabel(phase: TurnQuickPhase): string {
  if (phase === "precombat-main") return "MAIN 1";
  if (phase === "postcombat-main") return "MAIN 2";
  return phase.toUpperCase();
}

function unique(value: unknown): string[] {
  return Array.isArray(value)
    ? [
        ...new Set(
          value.filter((entry): entry is string => typeof entry === "string"),
        ),
      ]
    : [];
}

function bounded(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}
