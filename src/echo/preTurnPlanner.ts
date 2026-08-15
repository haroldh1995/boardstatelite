import { makeId } from "../domain/cards";
import { sanitizeText } from "../domain/field";
import type { CardIdentity, Owner, Zone } from "../domain/types";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import {
  PRE_TURN_PLANNER_ACTION_STRIP_VERSION,
  PRE_TURN_PLANNER_VERSION,
  type PlannedAction,
  type PlannedActionExecution,
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
  type PreparedActionMetadata,
  type PreparedActionRequirement,
  type TurnIntentConfidence,
  type TurnIntentSource,
} from "./preTurnPlannerTypes";

export const PRE_TURN_PLANNER_ACTION_TYPES: PreTurnPlannerActionType[] = [
  "land-play",
  "spell-sequence",
  "mana-use",
  "planned-attack",
  "blocker-reminder",
  "token-creation",
  "counter-placement",
  "sacrifice",
  "activated-ability",
  "zone-movement",
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
  sacrifice: "Sacrifice",
  "activated-ability": "Activated ability",
  "zone-movement": "Move card",
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
    sacrifice: "sacrifice-permanent",
    "activated-ability": "activate-ability",
    "zone-movement": "return-permanent",
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
    participantId: null,
    status: "empty",
    createdAt: timestamp,
    updatedAt: timestamp,
    turnId: makeId("turn-intent"),
    intentVersion: 1,
    canonicalSessionVersion: null,
    privateToParticipant: true,
    availableLandPlays: {
      planned: 0,
      remaining: 0,
      confirmed: 0,
      updatedAt: timestamp,
      source: "pre-turn-survey",
    },
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
      participantId: sanitizeNullableText(candidate.participantId),
      status,
      createdAt,
      updatedAt,
      turnId: sanitizeId(candidate.turnId) ?? defaults.turnId,
      intentVersion: boundedInteger(candidate.intentVersion, 1, 999999999, 1),
      canonicalSessionVersion: sanitizeNullableText(
        candidate.canonicalSessionVersion,
      ),
      privateToParticipant: true,
      availableLandPlays: normalizeAvailableLandPlays(
        candidate.availableLandPlays,
        updatedAt,
      ),
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
  const nextActions = [...planner.actions, action];
  const plannedLandActions = nextActions.filter(
    (entry) => entry.type === "land-play" && entry.status === "planned",
  ).length;
  const availableLandPlays =
    action.type === "land-play" &&
    planner.availableLandPlays.remaining < plannedLandActions
      ? {
          ...planner.availableLandPlays,
          planned: planner.availableLandPlays.confirmed + plannedLandActions,
          remaining: plannedLandActions,
          updatedAt: timestamp,
          source: action.prepared.intentSource,
        }
      : planner.availableLandPlays;
  return normalizePreTurnPlannerState(
    {
      ...planner,
      status: "planning",
      updatedAt: timestamp,
      intentVersion: planner.intentVersion + 1,
      availableLandPlays,
      actions: nextActions,
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
      intentVersion: planner.intentVersion + 1,
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

export function setAvailableLandPlays(
  planner: PreTurnPlannerState,
  remaining: number,
  timestamp = new Date().toISOString(),
  source: TurnIntentSource = "pre-turn-survey",
): PreTurnPlannerState {
  const nextRemaining = boundedInteger(remaining, 0, 999, 0);
  return normalizePreTurnPlannerState(
    {
      ...planner,
      status:
        nextRemaining > 0 || planner.actions.length > 0
          ? "planning"
          : planner.status,
      updatedAt: timestamp,
      intentVersion: planner.intentVersion + 1,
      availableLandPlays: {
        planned: planner.availableLandPlays.confirmed + nextRemaining,
        remaining: nextRemaining,
        confirmed: planner.availableLandPlays.confirmed,
        updatedAt: timestamp,
        source,
      },
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function recordConfirmedLandPlay(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
  quantity = 1,
): PreTurnPlannerState {
  const appliedQuantity = boundedInteger(quantity, 1, 999, 1);
  const confirmed = Math.min(
    999,
    planner.availableLandPlays.confirmed + appliedQuantity,
  );
  const remaining = Math.max(
    0,
    planner.availableLandPlays.remaining - appliedQuantity,
  );
  return normalizePreTurnPlannerState(
    {
      ...planner,
      updatedAt: timestamp,
      intentVersion: planner.intentVersion + 1,
      availableLandPlays: {
        ...planner.availableLandPlays,
        planned: confirmed + remaining,
        remaining,
        confirmed,
        updatedAt: timestamp,
      },
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: planner.lifecycle.lastAmbientMode,
    },
  );
}

export function recordPlannedActionExecution(
  planner: PreTurnPlannerState,
  actionId: string,
  input: {
    timestamp: string;
    confirmationReceiptId: string;
    canonicalEventIds: string[];
  },
): PreTurnPlannerState {
  const action = planner.actions.find((entry) => entry.id === actionId);
  if (!action || action.status === "completed") return planner;
  let next: PreTurnPlannerState = {
    ...planner,
    updatedAt: input.timestamp,
    intentVersion: planner.intentVersion + 1,
    actions: planner.actions.map((entry) =>
      entry.id === actionId
        ? {
            ...entry,
            status: "completed" as const,
            skipped: false,
            cancelled: false,
            updatedAt: input.timestamp,
            completedAt: input.timestamp,
            skippedAt: null,
            cancelledAt: null,
            prepared: {
              ...entry.prepared,
              validity: "ready" as const,
              confirmedAt: input.timestamp,
              confirmationReceiptId: input.confirmationReceiptId,
              canonicalEventIds: uniqueStrings(input.canonicalEventIds),
              reasonCodes: uniqueStrings([
                ...entry.prepared.reasonCodes,
                "confirmed-real-game-action",
              ]),
            },
          }
        : entry,
    ),
  };
  if (action.type === "land-play") {
    next = recordConfirmedLandPlay(next, input.timestamp);
  }
  return normalizePreTurnPlannerState(next, {
    fallbackTimestamp: input.timestamp,
    sessionId: planner.sessionId,
    ambientMode: planner.lifecycle.lastAmbientMode,
  });
}

export function expireTurnIntent(
  planner: PreTurnPlannerState,
  timestamp = new Date().toISOString(),
): PreTurnPlannerState {
  if (
    planner.status === "archived" &&
    planner.availableLandPlays.remaining === 0 &&
    planner.actions.every((action) => action.status !== "planned")
  ) {
    return planner;
  }
  return normalizePreTurnPlannerState(
    {
      ...planner,
      status: planner.actions.length > 0 ? "archived" : "empty",
      updatedAt: timestamp,
      intentVersion: planner.intentVersion + 1,
      availableLandPlays: {
        ...planner.availableLandPlays,
        planned: planner.availableLandPlays.confirmed,
        remaining: 0,
        updatedAt: timestamp,
      },
      actions: planner.actions.map((action) =>
        action.status === "planned"
          ? {
              ...action,
              status: "cancelled" as const,
              cancelled: true,
              cancelledAt: timestamp,
              updatedAt: timestamp,
              prepared: {
                ...action.prepared,
                validity: "stale" as const,
                reasonCodes: uniqueStrings([
                  ...action.prepared.reasonCodes,
                  "turn-ended",
                ]),
              },
            }
          : action,
      ),
    },
    {
      fallbackTimestamp: timestamp,
      sessionId: planner.sessionId,
      ambientMode: "postTurn",
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
    const expired = expireTurnIntent(planner, timestamp);
    return {
      ...expired,
      lifecycle: {
        ...expired.lifecycle,
        lastAmbientMode: mode,
        availability,
        readOnly: true,
        lastArchivedAt: expired.actions.length > 0 ? timestamp : null,
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
  if (mode === "activeTurn") return "available";
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
    id: `planned-intent:${action.prepared.preparedActionId}`,
    kind: action.actionStrip.intentKind,
    source: "turn-planner",
    actor: action.relatedPlayer ?? "you",
    confidence: action.prepared.confidence === "explicit" ? "high" : "medium",
    requiresPreview: true,
    entities: action.relatedGroupId
      ? [{ kind: "group", id: action.relatedGroupId, role: "target" }]
      : [],
    payload: {
      plannedActionId: action.id,
      plannedActionType: action.type,
      title: action.title,
      notes: action.notes,
      quantity: action.quantity,
      primaryCardId: action.relatedCardId,
      primaryGroupId: action.relatedGroupId,
      originZone: action.execution.originZone,
      destinationZone: action.execution.destinationZone,
      preparedActionId: action.prepared.preparedActionId,
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
    availableLandPlays: planner.availableLandPlays.remaining,
    preparedActionCount: planner.actions.filter(
      (action) => action.prepared.validity === "ready",
    ).length,
    invalidatedActionCount: planner.actions.filter(
      (action) => action.status === "invalidated",
    ).length,
    divergedActionCount: planner.actions.filter(
      (action) => action.status === "diverged",
    ).length,
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
  const id = sanitizeId(input.id) ?? makeId("planned-action");
  const confidence = normalizeIntentConfidence(input.confidence) ?? "explicit";
  const intentSource =
    normalizeIntentSource(input.intentSource) ?? "manual-planner";
  return {
    id,
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
    quantity: boundedInteger(input.quantity, 1, 999999999, 1),
    cardSnapshot: normalizeCardSnapshot(input.cardSnapshot),
    land: normalizeLandOptions(input.land),
    mana: normalizeManaUse(input.mana),
    execution: normalizeActionExecution(input.execution, type),
    prepared: createPreparedActionMetadata({
      id,
      confidence,
      intentSource,
    }),
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
  const id = sanitizeId(candidate.id) ?? makeId("planned-action");
  const relatedGroupId =
    sanitizeNullableText(candidate.relatedGroupId) &&
    (options.knownGroupIds.size === 0 ||
      options.knownGroupIds.has(String(candidate.relatedGroupId)))
      ? sanitizeNullableText(candidate.relatedGroupId)
      : null;
  return {
    id,
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
    quantity: boundedInteger(candidate.quantity, 1, 999999999, 1),
    cardSnapshot: normalizeCardSnapshot(candidate.cardSnapshot),
    land: normalizeLandOptions(candidate.land),
    mana: normalizeManaUse(candidate.mana),
    execution: normalizeActionExecution(candidate.execution, type),
    prepared: normalizePreparedActionMetadata(candidate.prepared, id),
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
  const semanticUpdate =
    update.type !== undefined ||
    update.title !== undefined ||
    update.relatedCardId !== undefined ||
    update.relatedGroupId !== undefined ||
    update.quantity !== undefined ||
    update.cardSnapshot !== undefined ||
    update.land !== undefined ||
    update.execution !== undefined;
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
    quantity:
      update.quantity === undefined
        ? action.quantity
        : boundedInteger(update.quantity, 1, 999999999, 1),
    cardSnapshot:
      update.cardSnapshot === undefined
        ? action.cardSnapshot
        : normalizeCardSnapshot(update.cardSnapshot),
    land:
      update.land === undefined
        ? action.land
        : normalizeLandOptions(update.land),
    mana:
      update.mana === undefined ? action.mana : normalizeManaUse(update.mana),
    execution:
      update.execution === undefined
        ? action.execution
        : normalizeActionExecution(update.execution, nextType),
    prepared: semanticUpdate
      ? {
          ...action.prepared,
          confidence:
            normalizeIntentConfidence(update.confidence) ??
            action.prepared.confidence,
          intentSource:
            normalizeIntentSource(update.intentSource) ??
            action.prepared.intentSource,
          validity: "prepared",
          canonicalStateFingerprint: null,
          forecastReference: null,
          expectedReplacementReferences: [],
          expectedTriggerSummary: [],
          expectedBookkeeping: [],
          reasonCodes: ["intent-updated"],
          authorityRequired: false,
          manualActionRequired: false,
          confirmedAt: null,
          confirmationReceiptId: null,
          canonicalEventIds: [],
        }
      : action.prepared,
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
    sacrifice: false,
    "activated-ability": false,
    "zone-movement": false,
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
    value === "cancelled" ||
    value === "invalidated" ||
    value === "diverged"
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

function normalizeAvailableLandPlays(
  value: unknown,
  fallbackTimestamp: string,
): PreTurnPlannerState["availableLandPlays"] {
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<PreTurnPlannerState["availableLandPlays"]>)
      : {};
  const remaining = boundedInteger(candidate.remaining, 0, 999, 0);
  const confirmed = boundedInteger(candidate.confirmed, 0, 999, 0);
  return {
    planned: Math.max(
      confirmed + remaining,
      boundedInteger(candidate.planned, 0, 999, confirmed + remaining),
    ),
    remaining,
    confirmed,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : fallbackTimestamp,
    source: normalizeIntentSource(candidate.source) ?? "pre-turn-survey",
  };
}

function normalizeActionExecution(
  value: Partial<PlannedActionExecution> | null | undefined,
  type: PreTurnPlannerActionType,
): PlannedActionExecution {
  const candidate = value ?? {};
  const defaults = defaultExecutionForType(type);
  return {
    support:
      candidate.support === "local" ||
      candidate.support === "manual" ||
      candidate.support === "authority" ||
      candidate.support === "unsupported"
        ? candidate.support
        : defaults.support,
    eventCategory:
      normalizeGameEventType(candidate.eventCategory) ?? defaults.eventCategory,
    quantity: boundedInteger(candidate.quantity, 0, 999999999, 1),
    counterType: sanitizeNullableText(candidate.counterType),
    originZone: normalizeZone(candidate.originZone),
    destinationZone: normalizeZone(candidate.destinationZone),
    targetGroupIds: normalizeStringArray(candidate.targetGroupIds),
    mode: sanitizeNullableText(candidate.mode),
    requirements: normalizeRequirements(candidate.requirements),
    token: normalizeTokenDefinition(candidate.token),
  };
}

function defaultExecutionForType(
  type: PreTurnPlannerActionType,
): Pick<PlannedActionExecution, "support" | "eventCategory"> {
  if (type === "land-play") {
    return { support: "local", eventCategory: "land-entered" };
  }
  if (type === "spell-sequence") {
    return { support: "local", eventCategory: "permanent-entered" };
  }
  if (type === "sacrifice") {
    return { support: "local", eventCategory: "permanent-sacrificed" };
  }
  if (type === "counter-placement") {
    return { support: "manual", eventCategory: "counter-placed" };
  }
  if (type === "token-creation") {
    return { support: "manual", eventCategory: "token-created" };
  }
  if (type === "zone-movement") {
    return { support: "manual", eventCategory: null };
  }
  return { support: "manual", eventCategory: null };
}

function createPreparedActionMetadata(input: {
  id: string;
  confidence: TurnIntentConfidence;
  intentSource: TurnIntentSource;
}): PreparedActionMetadata {
  return {
    preparedActionId: `prepared:${input.id}`,
    validity: "prepared",
    confidence: input.confidence,
    intentSource: input.intentSource,
    canonicalStateFingerprint: null,
    forecastReference: null,
    expectedReplacementReferences: [],
    expectedTriggerSummary: [],
    expectedBookkeeping: [],
    reasonCodes: ["intent-recorded"],
    authorityRequired: false,
    manualActionRequired: false,
    confirmedAt: null,
    confirmationReceiptId: null,
    canonicalEventIds: [],
    sourceFaceCardId: null,
  };
}

function normalizePreparedActionMetadata(
  value: unknown,
  actionId: string,
): PreparedActionMetadata {
  const defaults = createPreparedActionMetadata({
    id: actionId,
    confidence: "explicit",
    intentSource: "manual-planner",
  });
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<PreparedActionMetadata>;
  return {
    ...defaults,
    preparedActionId:
      sanitizeId(candidate.preparedActionId) ?? defaults.preparedActionId,
    validity: normalizePreparedValidity(candidate.validity),
    confidence:
      normalizeIntentConfidence(candidate.confidence) ?? defaults.confidence,
    intentSource:
      normalizeIntentSource(candidate.intentSource) ?? defaults.intentSource,
    canonicalStateFingerprint: sanitizeNullableText(
      candidate.canonicalStateFingerprint,
    ),
    forecastReference: sanitizeNullableText(candidate.forecastReference),
    expectedReplacementReferences: normalizeStringArray(
      candidate.expectedReplacementReferences,
    ),
    expectedTriggerSummary: normalizeStringArray(
      candidate.expectedTriggerSummary,
    ),
    expectedBookkeeping: normalizeStringArray(candidate.expectedBookkeeping),
    reasonCodes: normalizeStringArray(candidate.reasonCodes),
    authorityRequired: Boolean(candidate.authorityRequired),
    manualActionRequired: Boolean(candidate.manualActionRequired),
    confirmedAt: normalizeNullableDate(candidate.confirmedAt),
    confirmationReceiptId: sanitizeNullableText(
      candidate.confirmationReceiptId,
    ),
    canonicalEventIds: normalizeStringArray(candidate.canonicalEventIds),
    sourceFaceCardId: sanitizeNullableText(candidate.sourceFaceCardId),
  };
}

function normalizePreparedValidity(
  value: unknown,
): PreparedActionMetadata["validity"] {
  return value === "prepared" ||
    value === "ready" ||
    value === "awaiting-confirmation" ||
    value === "awaiting-target" ||
    value === "awaiting-quantity" ||
    value === "awaiting-mode" ||
    value === "awaiting-selection" ||
    value === "awaiting-order" ||
    value === "authority-required" ||
    value === "manual-action-required" ||
    value === "unsupported" ||
    value === "invalidated" ||
    value === "diverged" ||
    value === "stale"
    ? value
    : "prepared";
}

function normalizeRequirements(value: unknown): PreparedActionRequirement[] {
  if (!Array.isArray(value)) return ["confirmation"];
  const valid: PreparedActionRequirement[] = [
    "confirmation",
    "target",
    "quantity",
    "mode",
    "selection",
    "order",
    "authority",
    "manual-resolution",
  ];
  const values = value.filter(
    (entry): entry is PreparedActionRequirement =>
      typeof entry === "string" &&
      valid.includes(entry as PreparedActionRequirement),
  );
  return uniqueStrings(values.length > 0 ? values : ["confirmation"]);
}

function normalizeTokenDefinition(
  value: PlannedActionExecution["token"] | undefined,
): PlannedActionExecution["token"] {
  if (!value || typeof value !== "object") return null;
  return {
    name: sanitizeText(value.name, "Token"),
    power: boundedInteger(value.power, -999999, 999999, 0),
    toughness: boundedInteger(value.toughness, -999999, 999999, 0),
    cardTypes: normalizeStringArray(value.cardTypes),
    subtypes: normalizeStringArray(value.subtypes),
    colors: normalizeStringArray(value.colors),
    tapped: Boolean(value.tapped),
    attacking: Boolean(value.attacking),
  };
}

function normalizeCardSnapshot(value: unknown): CardIdentity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<CardIdentity>;
  const cardId = sanitizeId(candidate.cardId);
  const name = sanitizeNullableText(candidate.name);
  if (!cardId || !name) return null;
  const supportStatus =
    candidate.supportStatus === "fully-automated" ||
    candidate.supportStatus === "partially-automated" ||
    candidate.supportStatus === "quantity-tracking-only" ||
    candidate.supportStatus === "unsupported"
      ? candidate.supportStatus
      : "quantity-tracking-only";
  return {
    cardId,
    ...(sanitizeNullableText(candidate.oracleId)
      ? { oracleId: sanitizeNullableText(candidate.oracleId)! }
      : {}),
    name,
    manaCost: sanitizeText(candidate.manaCost, ""),
    manaValue:
      typeof candidate.manaValue === "number" &&
      Number.isFinite(candidate.manaValue)
        ? Math.max(0, candidate.manaValue)
        : 0,
    typeLine: sanitizeText(candidate.typeLine, ""),
    oracleText: sanitizeText(candidate.oracleText, ""),
    imageUrl: sanitizeText(candidate.imageUrl, ""),
    imageSmall: sanitizeText(candidate.imageSmall, ""),
    imageArt: sanitizeText(candidate.imageArt, ""),
    ...(sanitizeNullableText(candidate.scryfallUri)
      ? { scryfallUri: sanitizeNullableText(candidate.scryfallUri)! }
      : {}),
    ...(sanitizeNullableText(candidate.setCode)
      ? { setCode: sanitizeNullableText(candidate.setCode)! }
      : {}),
    ...(sanitizeNullableText(candidate.collectorNumber)
      ? { collectorNumber: sanitizeNullableText(candidate.collectorNumber)! }
      : {}),
    colors: normalizeStringArray(candidate.colors),
    colorIdentity: normalizeStringArray(candidate.colorIdentity),
    keywords: normalizeStringArray(candidate.keywords),
    power: sanitizeNullableText(candidate.power),
    toughness: sanitizeNullableText(candidate.toughness),
    loyalty: sanitizeNullableText(candidate.loyalty),
    defense: sanitizeNullableText(candidate.defense),
    isToken: Boolean(candidate.isToken),
    cardFaces: Array.isArray(candidate.cardFaces)
      ? candidate.cardFaces
          .filter((face): face is CardIdentity["cardFaces"][number] =>
            Boolean(face && typeof face === "object" && face.name),
          )
          .map((face) => ({
            name: sanitizeText(face.name, ""),
            typeLine: sanitizeText(face.typeLine, ""),
            oracleText: sanitizeText(face.oracleText, ""),
            manaCost: sanitizeText(face.manaCost, ""),
            imageUrl: sanitizeText(face.imageUrl, ""),
            imageSmall: sanitizeText(face.imageSmall, ""),
            power: sanitizeNullableText(face.power),
            toughness: sanitizeNullableText(face.toughness),
            loyalty: sanitizeNullableText(face.loyalty),
            defense: sanitizeNullableText(face.defense),
          }))
      : [],
    supportStatus,
  };
}

function normalizeIntentConfidence(
  value: unknown,
): TurnIntentConfidence | null {
  return value === "explicit" ||
    value === "inferred-high-confidence" ||
    value === "inferred-low-confidence"
    ? value
    : null;
}

function normalizeIntentSource(value: unknown): TurnIntentSource | null {
  return value === "pre-turn-survey" ||
    value === "manual-planner" ||
    value === "echo-voice" ||
    value === "card-selection" ||
    value === "scryfall" ||
    value === "known-card-state" ||
    value === "boardstate-session" ||
    value === "previous-intent"
    ? value
    : null;
}

function normalizeZone(value: unknown): Zone | null {
  return value === "battlefield" ||
    value === "hand" ||
    value === "graveyard" ||
    value === "exile" ||
    value === "library" ||
    value === "command"
    ? value
    : null;
}

function normalizeGameEventType(
  value: unknown,
): PlannedActionExecution["eventCategory"] {
  const values = [
    "permanent-entered",
    "creature-entered",
    "token-created",
    "counter-placed",
    "counter-removed",
    "life-gained",
    "life-lost",
    "damage-dealt",
    "land-entered",
    "spell-cast",
    "permanent-died",
    "permanent-sacrificed",
    "permanent-exiled",
    "permanent-returned-to-hand",
    "permanent-returned-to-battlefield",
    "permanent-transformed",
    "permanent-tapped",
    "permanent-untapped",
    "trigger-announced",
    "reminder-created",
    "battlefield-note-created",
  ];
  return typeof value === "string" && values.includes(value)
    ? (value as PlannedActionExecution["eventCategory"])
    : null;
}

function boundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(value)));
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
