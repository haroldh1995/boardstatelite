import { makeId } from "../domain/cards";
import { sanitizeText } from "../domain/field";
import type { Owner } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import {
  PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
  PRE_TURN_PLANNER_VERSION,
  type PlannedAction,
  type PlannedActionInput,
  type PlannedActionUpdate,
  type PlannedLandOptions,
  type PlannedManaUse,
  type PreTurnPlannerActionStatus,
  type PreTurnPlannerActionStripItem,
  type PreTurnPlannerActionType,
  type PreTurnPlannerAvailability,
  type PreTurnPlannerDiagnostics,
  type PreTurnPlannerState,
} from "./preTurnPlannerTypes";

export const PRE_TURN_PLANNER_ACTION_TYPES: PreTurnPlannerActionType[] = [
  "land-play",
  "spell-sequence",
  "mana-use",
  "planned-attack",
  "blocker-reminder",
  "token-creation",
  "counter-placement",
  "trigger-reminder",
  "end-step-reminder",
  "hold-up-interaction",
  "priority-reminder",
  "note",
];

const ACTION_TYPE_LABELS: Record<PreTurnPlannerActionType, string> = {
  "land-play": "Land play",
  "spell-sequence": "Spell sequence",
  "mana-use": "Mana usage",
  "planned-attack": "Planned attack",
  "blocker-reminder": "Blocker reminder",
  "token-creation": "Token creation",
  "counter-placement": "Counter placement",
  "trigger-reminder": "Trigger reminder",
  "end-step-reminder": "End-step reminder",
  "hold-up-interaction": "Hold-up interaction",
  "priority-reminder": "Priority reminder",
  note: "Note",
};

const ACTION_INTENT_KIND: Record<PreTurnPlannerActionType, AmbientIntentKind> =
  {
    "land-play": "play-land",
    "spell-sequence": "cast-spell",
    "mana-use": "custom",
    "planned-attack": "attack",
    "blocker-reminder": "block",
    "token-creation": "create-token",
    "counter-placement": "add-counters",
    "trigger-reminder": "custom",
    "end-step-reminder": "end-turn",
    "hold-up-interaction": "pass-priority",
    "priority-reminder": "pass-priority",
    note: "custom",
  };

export function createDefaultPreTurnPlannerState(
  options: { timestamp?: string; sessionId?: string | null } = {},
): PreTurnPlannerState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    version: PRE_TURN_PLANNER_VERSION,
    sessionId: options.sessionId ?? null,
    status: "empty",
    createdAt: timestamp,
    updatedAt: timestamp,
    actions: [],
    collapsedGroups: createDefaultCollapsedGroups(),
    lifecycle: {
      lastAmbientMode: "passive",
      availability: "available",
      readOnly: false,
      lastResetAt: null,
      lastArchivedAt: null,
      recoveryReason: null,
    },
    actionStrip: {
      version: PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
      preparedActionIds: [],
      generatedAt: null,
    },
  };
}

export function normalizePreTurnPlannerState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    sessionId?: string | null;
    ambientMode?: AmbientGameplayMode;
    knownGroupIds?: string[];
  },
): PreTurnPlannerState {
  const defaults = createDefaultPreTurnPlannerState({
    timestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? null,
  });
  const ambientMode = options.ambientMode ?? "passive";
  const availability = getPreTurnPlannerAvailability(ambientMode);
  if (!value || typeof value !== "object") {
    return applyPlannerAvailability(defaults, ambientMode, availability);
  }

  const candidate = value as Partial<PreTurnPlannerState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const actions = Array.isArray(candidate.actions)
    ? candidate.actions
        .map((entry, index) =>
          normalizePlannedAction(entry, {
            fallbackTimestamp: options.fallbackTimestamp,
            fallbackOrder: index,
            knownGroupIds,
          }),
        )
        .filter((entry): entry is PlannedAction => Boolean(entry))
        .sort((a, b) => a.order - b.order)
    : [];
  const actionIds = new Set(actions.map((action) => action.id));
  const normalizedActions = actions.map((action) => ({
    ...action,
    dependencyIds: action.dependencyIds.filter((id) => actionIds.has(id)),
  }));
  const status =
    normalizePlannerStatus(candidate.status) ??
    (normalizedActions.length > 0 ? "planning" : "empty");
  const createdAt =
    typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : defaults.createdAt;
  const updatedAt =
    typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : options.fallbackTimestamp;
  return applyPlannerAvailability(
    {
      ...defaults,
      sessionId:
        typeof candidate.sessionId === "string"
          ? candidate.sessionId
          : (options.sessionId ?? defaults.sessionId),
      status,
      createdAt,
      updatedAt,
      actions: normalizedActions,
      collapsedGroups: normalizeCollapsedGroups(candidate.collapsedGroups),
      lifecycle: {
        ...defaults.lifecycle,
        ...normalizeLifecycle(candidate.lifecycle),
      },
      actionStrip: {
        version: PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
        preparedActionIds: Array.isArray(
          candidate.actionStrip?.preparedActionIds,
        )
          ? candidate.actionStrip.preparedActionIds.filter(
              (id): id is string => typeof id === "string" && actionIds.has(id),
            )
          : [],
        generatedAt:
          typeof candidate.actionStrip?.generatedAt === "string"
            ? candidate.actionStrip.generatedAt
            : null,
      },
    },
    ambientMode,
    availability,
  );
}

export function addPlannedAction(
  planner: PreTurnPlannerState,
  input: PlannedActionInput,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  const action = createPlannedAction(input, timestamp, planner.actions.length);
  return normalizePreTurnPlannerState(
    {
      ...planner,
      status: "planning",
      updatedAt: timestamp,
      actions: [...planner.actions, action],
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function updatePlannedAction(
  planner: PreTurnPlannerState,
  actionId: string,
  update: PlannedActionUpdate,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      actions: planner.actions.map((action) =>
        action.id === actionId
          ? normalizeActionPatch(action, update, timestamp)
          : action,
      ),
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function removePlannedAction(
  planner: PreTurnPlannerState,
  actionId: string,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      actions: planner.actions.filter((action) => action.id !== actionId),
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function reorderPlannedAction(
  planner: PreTurnPlannerState,
  actionId: string,
  direction: -1 | 1,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  const sorted = sortPlannedActions(planner.actions);
  const index = sorted.findIndex((action) => action.id === actionId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
    return planner;
  }
  const targetOrder = sorted[targetIndex].order;
  const currentOrder = sorted[index].order;
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      actions: planner.actions.map((action) => {
        if (action.id === sorted[index].id) {
          return { ...action, order: targetOrder, updatedAt: timestamp };
        }
        if (action.id === sorted[targetIndex].id) {
          return { ...action, order: currentOrder, updatedAt: timestamp };
        }
        return action;
      }),
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function setPlannedActionStatus(
  planner: PreTurnPlannerState,
  actionId: string,
  status: PreTurnPlannerActionStatus,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return updatePlannedAction(
    planner,
    actionId,
    {
      status,
      completedAt: status === "completed" ? timestamp : null,
      skippedAt: status === "skipped" ? timestamp : null,
      cancelledAt: status === "cancelled" ? timestamp : null,
    },
    timestamp,
  );
}

export function clearCompletedPlans(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      actions: planner.actions.filter(
        (action) => action.status !== "completed",
      ),
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function clearAllPlans(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return normalizePreTurnPlannerState(
    {
      ...planner,
      status: "empty",
      updatedAt: timestamp,
      actions: [],
      actionStrip: {
        version: PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
        preparedActionIds: [],
        generatedAt: null,
      },
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function resetPreTurnPlanner(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return {
    ...createDefaultPreTurnPlannerState({
      timestamp,
      sessionId: planner.sessionId,
    }),
    lifecycle: {
      ...planner.lifecycle,
      lastResetAt: timestamp,
      recoveryReason: null,
    },
  };
}

export function setPlannerGroupCollapsed(
  planner: PreTurnPlannerState,
  group: PreTurnPlannerActionType | "completed",
  collapsed: boolean,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      collapsedGroups: { ...planner.collapsedGroups, [group]: collapsed },
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function syncPlannerWithAmbientMode(
  planner: PreTurnPlannerState,
  mode: AmbientGameplayMode,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  const availability = getPreTurnPlannerAvailability(mode);
  if (mode === "postTurn") {
    return {
      ...planner,
      status: planner.actions.length > 0 ? "archived" : "empty",
      updatedAt: timestamp,
      lifecycle: {
        ...planner.lifecycle,
        lastAmbientMode: mode,
        availability,
        readOnly: true,
        lastArchivedAt: planner.actions.length > 0 ? timestamp : null,
        recoveryReason: null,
      },
    };
  }
  return applyPlannerAvailability(planner, mode, availability, timestamp);
}

export function getPreTurnPlannerAvailability(
  mode: AmbientGameplayMode,
): PreTurnPlannerAvailability {
  if (mode === "preTurnPreparation") return "primary";
  if (mode === "passive") return "available";
  if (mode === "activeTurn") return "read-only";
  if (mode === "combat") return "minimized";
  if (mode === "resolution") return "unavailable";
  if (mode === "recovery") return "recovery";
  return "read-only";
}

export function createActionStripPlan(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
): {
  planner: PreTurnPlannerState;
  items: PreTurnPlannerActionStripItem[];
} {
  const items = sortPlannedActions(planner.actions)
    .filter((action) => action.status === "planned")
    .map((action) => ({
      id: makeId("planned-strip"),
      order: action.order,
      label: action.title,
      status: action.status,
      sourceActionId: action.id,
      intent: plannedActionToAmbientIntent(action),
    }));
  return {
    planner: {
      ...planner,
      actionStrip: {
        version: PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
        preparedActionIds: items.map((item) => item.sourceActionId),
        generatedAt: timestamp,
      },
    },
    items,
  };
}

export function plannedActionToAmbientIntent(
  action: PlannedAction,
): AmbientIntentInput {
  return {
    id: makeId("planned-intent"),
    kind: action.actionStrip.intentKind,
    source: "turn-planner",
    actor: action.relatedPlayer ?? "you",
    confidence: "medium",
    requiresPreview: true,
    entities: action.relatedGroupId
      ? [{ kind: "group", id: action.relatedGroupId, role: "target" }]
      : [],
    payload: {
      plannedActionId: action.id,
      plannedActionType: action.type,
      title: action.title,
      notes: action.notes,
    },
  };
}

export function getPreTurnPlannerDiagnostics(
  planner: PreTurnPlannerState,
): PreTurnPlannerDiagnostics {
  return {
    version: planner.version,
    sessionId: planner.sessionId,
    status: planner.status,
    availability: planner.lifecycle.availability,
    actionCount: planner.actions.length,
    activeActionCount: planner.actions.filter(
      (action) => action.status === "planned",
    ).length,
    completedActionCount: planner.actions.filter(
      (action) => action.status === "completed",
    ).length,
    cancelledActionCount: planner.actions.filter(
      (action) => action.status === "cancelled",
    ).length,
    readOnly: planner.lifecycle.readOnly,
  };
}

export function actionTypeLabel(type: PreTurnPlannerActionType): string {
  return ACTION_TYPE_LABELS[type];
}

export function sortPlannedActions(actions: PlannedAction[]): PlannedAction[] {
  return [...actions].sort((a, b) => a.order - b.order);
}

function createPlannedAction(
  input: PlannedActionInput,
  timestamp: string,
  fallbackOrder: number,
): PlannedAction {
  const type = normalizeActionType(input.type) ?? "note";
  const status = normalizeActionStatus(input.status) ?? "planned";
  return {
    id: sanitizeId(input.id) ?? makeId("planned-action"),
    type,
    title: sanitizeText(input.title, ACTION_TYPE_LABELS[type]),
    relatedCardId: sanitizeNullableText(input.relatedCardId),
    relatedGroupId: sanitizeNullableText(input.relatedGroupId),
    relatedPlayer: normalizeOwner(input.relatedPlayer),
    order: normalizeOrder(input.order, fallbackOrder),
    dependencyIds: normalizeStringArray(input.dependencyIds),
    notes: sanitizeText(input.notes, ""),
    reminders: normalizeStringArray(input.reminders),
    status,
    skipped: status === "skipped",
    cancelled: status === "cancelled",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    skippedAt: status === "skipped" ? timestamp : null,
    cancelledAt: status === "cancelled" ? timestamp : null,
    land: normalizeLandOptions(input.land),
    mana: normalizeManaUse(input.mana),
    actionStrip: {
      intentKind: ACTION_INTENT_KIND[type],
      readyForActionStrip: true,
      requiresPreview: true,
    },
  };
}

function normalizePlannedAction(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    fallbackOrder: number;
    knownGroupIds: Set<string>;
  },
): PlannedAction | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PlannedAction>;
  const type = normalizeActionType(candidate.type);
  if (!type) return null;
  const status = normalizeActionStatus(candidate.status) ?? "planned";
  const relatedGroupId =
    sanitizeNullableText(candidate.relatedGroupId) &&
    (options.knownGroupIds.size === 0 ||
      options.knownGroupIds.has(String(candidate.relatedGroupId)))
      ? sanitizeNullableText(candidate.relatedGroupId)
      : null;
  return {
    id: sanitizeId(candidate.id) ?? makeId("planned-action"),
    type,
    title: sanitizeText(candidate.title, ACTION_TYPE_LABELS[type]),
    relatedCardId: sanitizeNullableText(candidate.relatedCardId),
    relatedGroupId,
    relatedPlayer: normalizeOwner(candidate.relatedPlayer),
    order: normalizeOrder(candidate.order, options.fallbackOrder),
    dependencyIds: normalizeStringArray(candidate.dependencyIds),
    notes: sanitizeText(candidate.notes, ""),
    reminders: normalizeStringArray(candidate.reminders),
    status,
    skipped: status === "skipped",
    cancelled: status === "cancelled",
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : options.fallbackTimestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.fallbackTimestamp,
    completedAt:
      status === "completed" && typeof candidate.completedAt === "string"
        ? candidate.completedAt
        : null,
    skippedAt:
      status === "skipped" && typeof candidate.skippedAt === "string"
        ? candidate.skippedAt
        : null,
    cancelledAt:
      status === "cancelled" && typeof candidate.cancelledAt === "string"
        ? candidate.cancelledAt
        : null,
    land: normalizeLandOptions(candidate.land),
    mana: normalizeManaUse(candidate.mana),
    actionStrip: {
      intentKind: ACTION_INTENT_KIND[type],
      readyForActionStrip: true,
      requiresPreview: true,
    },
  };
}

function normalizeActionPatch(
  action: PlannedAction,
  update: PlannedActionUpdate,
  timestamp: string,
): PlannedAction {
  const nextType = normalizeActionType(update.type) ?? action.type;
  const nextStatus = normalizeActionStatus(update.status) ?? action.status;
  return {
    ...action,
    type: nextType,
    title:
      update.title === undefined
        ? action.title
        : sanitizeText(update.title, ACTION_TYPE_LABELS[nextType]),
    relatedCardId:
      update.relatedCardId === undefined
        ? action.relatedCardId
        : sanitizeNullableText(update.relatedCardId),
    relatedGroupId:
      update.relatedGroupId === undefined
        ? action.relatedGroupId
        : sanitizeNullableText(update.relatedGroupId),
    relatedPlayer:
      update.relatedPlayer === undefined
        ? action.relatedPlayer
        : normalizeOwner(update.relatedPlayer),
    order:
      update.order === undefined
        ? action.order
        : normalizeOrder(update.order, action.order),
    dependencyIds:
      update.dependencyIds === undefined
        ? action.dependencyIds
        : normalizeStringArray(update.dependencyIds),
    notes:
      update.notes === undefined
        ? action.notes
        : sanitizeText(update.notes, ""),
    reminders:
      update.reminders === undefined
        ? action.reminders
        : normalizeStringArray(update.reminders),
    status: nextStatus,
    skipped: nextStatus === "skipped",
    cancelled: nextStatus === "cancelled",
    updatedAt: timestamp,
    completedAt:
      update.completedAt === undefined
        ? action.completedAt
        : normalizeNullableDate(update.completedAt),
    skippedAt:
      update.skippedAt === undefined
        ? action.skippedAt
        : normalizeNullableDate(update.skippedAt),
    cancelledAt:
      update.cancelledAt === undefined
        ? action.cancelledAt
        : normalizeNullableDate(update.cancelledAt),
    land:
      update.land === undefined
        ? action.land
        : normalizeLandOptions(update.land),
    mana:
      update.mana === undefined ? action.mana : normalizeManaUse(update.mana),
    actionStrip: {
      intentKind: ACTION_INTENT_KIND[nextType],
      readyForActionStrip: true,
      requiresPreview: true,
    },
  };
}

function applyPlannerAvailability(
  planner: PreTurnPlannerState,
  mode: AmbientGameplayMode,
  availability: PreTurnPlannerAvailability,
  timestamp = planner.updatedAt,
): PreTurnPlannerState {
  return {
    ...planner,
    updatedAt: timestamp,
    lifecycle: {
      ...planner.lifecycle,
      lastAmbientMode: mode,
      availability,
      readOnly: availability !== "available" && availability !== "primary",
      recoveryReason:
        availability === "recovery"
          ? (planner.lifecycle.recoveryReason ??
            "Ambient Gameplay is recovering a focused workflow.")
          : null,
    },
  };
}

function normalizeLifecycle(
  value: unknown,
): Partial<PreTurnPlannerState["lifecycle"]> {
  if (!value || typeof value !== "object") return {};
  const candidate = value as Partial<PreTurnPlannerState["lifecycle"]>;
  return {
    lastAmbientMode:
      normalizeAmbientMode(candidate.lastAmbientMode) ?? "passive",
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
    lastArchivedAt:
      typeof candidate.lastArchivedAt === "string"
        ? candidate.lastArchivedAt
        : null,
    recoveryReason: sanitizeNullableText(candidate.recoveryReason),
  };
}

function normalizeCollapsedGroups(
  value: unknown,
): PreTurnPlannerState["collapsedGroups"] {
  return {
    ...createDefaultCollapsedGroups(),
    ...(value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .filter(([key]) =>
              [...PRE_TURN_PLANNER_ACTION_TYPES, "completed"].includes(
                key as PreTurnPlannerActionType | "completed",
              ),
            )
            .map(([key, entry]) => [key, Boolean(entry)]),
        )
      : {}),
  };
}

function createDefaultCollapsedGroups(): PreTurnPlannerState["collapsedGroups"] {
  return {
    "land-play": false,
    "spell-sequence": false,
    "mana-use": false,
    "planned-attack": false,
    "blocker-reminder": false,
    "token-creation": false,
    "counter-placement": false,
    "trigger-reminder": false,
    "end-step-reminder": false,
    "hold-up-interaction": false,
    "priority-reminder": false,
    note: false,
    completed: false,
  };
}

function normalizePlannerStatus(
  value: unknown,
): PreTurnPlannerState["status"] | null {
  return value === "empty" || value === "planning" || value === "archived"
    ? value
    : null;
}

function normalizeActionType(value: unknown): PreTurnPlannerActionType | null {
  return typeof value === "string" &&
    PRE_TURN_PLANNER_ACTION_TYPES.includes(value as PreTurnPlannerActionType)
    ? (value as PreTurnPlannerActionType)
    : null;
}

function normalizeAmbientMode(value: unknown): AmbientGameplayMode | null {
  return value === "passive" ||
    value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
    ? value
    : null;
}

function normalizeActionStatus(
  value: unknown,
): PreTurnPlannerActionStatus | null {
  return value === "planned" ||
    value === "completed" ||
    value === "skipped" ||
    value === "cancelled"
    ? value
    : null;
}

function normalizeOwner(value: unknown): Owner | null {
  return value === "you" || value === "opponent" ? value : null;
}

function normalizeOrder(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function sanitizeId(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 120)
    : null;
}

function sanitizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? sanitizeText(value, "")
    : null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => sanitizeText(entry, ""))
    .filter(Boolean)
    .slice(0, 20);
}

function normalizeNullableDate(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeLandOptions(
  value: Partial<PlannedLandOptions> | null | undefined,
): PlannedLandOptions | null {
  if (!value || typeof value !== "object") return null;
  return {
    primary: sanitizeNullableText(value.primary),
    alternatives: normalizeStringArray(value.alternatives),
    condition: sanitizeText(value.condition, ""),
    intentionallyHeld: Boolean(value.intentionallyHeld),
    futureFetchTarget: sanitizeNullableText(value.futureFetchTarget),
  };
}

function normalizeManaUse(
  value: Partial<PlannedManaUse> | null | undefined,
): PlannedManaUse | null {
  if (!value || typeof value !== "object") return null;
  return {
    generic: normalizeManaNumber(value.generic),
    white: normalizeManaNumber(value.white),
    blue: normalizeManaNumber(value.blue),
    black: normalizeManaNumber(value.black),
    red: normalizeManaNumber(value.red),
    green: normalizeManaNumber(value.green),
    colorless: normalizeManaNumber(value.colorless),
    notes: sanitizeText(value.notes, ""),
  };
}

function normalizeManaNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : 0;
}
