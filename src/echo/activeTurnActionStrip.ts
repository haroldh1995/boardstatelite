import { makeId } from "../domain/cards";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientIntentInput,
  AmbientIntentKind,
} from "./ambientEventTypes";
import {
  actionTypeLabel,
  plannedActionToAmbientIntent,
  sortPlannedActions,
} from "./preTurnPlanner";
import type {
  PlannedAction,
  PreTurnPlannerActionStatus,
  PreTurnPlannerActionType,
  PreTurnPlannerState,
} from "./preTurnPlannerTypes";
import {
  ACTIVE_TURN_ACTION_STRIP_VERSION,
  type ActiveTurnActionKind,
  type ActiveTurnActionSource,
  type ActiveTurnActionStatus,
  type ActiveTurnActionStripDiagnostics,
  type ActiveTurnActionStripItem,
  type ActiveTurnActionStripState,
  type ActiveTurnActionStripVisibility,
} from "./activeTurnActionStripTypes";

const TERMINAL_STATUSES = new Set<ActiveTurnActionStatus>([
  "completed",
  "skipped",
  "cancelled",
]);

const ACTIVE_TURN_SYSTEM_ACTIONS: SystemActionDefinition[] = [
  {
    key: "system-draw",
    kind: "draw",
    label: "Draw",
    detail: "Confirm your normal draw or any draw-step reminder.",
    intentKind: "draw-cards",
    order: -80,
    requiredMode: "activeTurn",
    source: "turn-context",
  },
  {
    key: "system-move-to-combat",
    kind: "move-to-combat",
    label: "Move to Combat",
    detail: "Advance from main phase planning into combat actions.",
    intentKind: "custom",
    order: 9_000,
    requiredMode: "activeTurn",
    source: "phase-context",
  },
  {
    key: "system-pass-priority-active",
    kind: "pass-priority",
    label: "Pass Priority",
    detail: "Reminder checkpoint for priority decisions.",
    intentKind: "pass-priority",
    order: 9_050,
    requiredMode: "activeTurn",
    source: "reminder",
  },
  {
    key: "system-end-turn",
    kind: "end-turn",
    label: "End Turn",
    detail: "Archive this action sequence after end-step reminders are done.",
    intentKind: "end-turn",
    order: 9_100,
    requiredMode: "activeTurn",
    source: "phase-context",
  },
];

const COMBAT_SYSTEM_ACTIONS: SystemActionDefinition[] = [
  {
    key: "system-end-combat",
    kind: "end-combat",
    label: "End Combat",
    detail: "Return to main-phase planning after combat actions.",
    intentKind: "custom",
    order: 9_000,
    requiredMode: "combat",
    source: "phase-context",
  },
  {
    key: "system-pass-priority-combat",
    kind: "pass-priority",
    label: "Pass Priority",
    detail: "Reminder checkpoint for combat priority.",
    intentKind: "pass-priority",
    order: 9_050,
    requiredMode: "combat",
    source: "reminder",
  },
];

export function createDefaultActiveTurnActionStripState(
  options: { timestamp?: string; sessionId?: string | null } = {},
): ActiveTurnActionStripState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  return {
    version: ACTIVE_TURN_ACTION_STRIP_VERSION,
    sessionId: options.sessionId ?? null,
    visibility: "hidden",
    expanded: true,
    completedCollapsed: true,
    generatedAt: null,
    updatedAt: timestamp,
    items: [],
    clearedCompletedItemKeys: [],
    lastPipelineEventId: null,
    lastFailureReason: null,
  };
}

export function normalizeActiveTurnActionStripState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    sessionId?: string | null;
    ambientMode: AmbientGameplayMode;
    planner: PreTurnPlannerState;
  },
): ActiveTurnActionStripState {
  const defaults = createDefaultActiveTurnActionStripState({
    timestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? null,
  });
  const candidate =
    value && typeof value === "object"
      ? (value as Partial<ActiveTurnActionStripState>)
      : {};
  const normalized: ActiveTurnActionStripState = {
    ...defaults,
    sessionId:
      typeof candidate.sessionId === "string"
        ? candidate.sessionId
        : (options.sessionId ?? defaults.sessionId),
    visibility:
      normalizeVisibility(candidate.visibility) ?? defaults.visibility,
    expanded:
      typeof candidate.expanded === "boolean"
        ? candidate.expanded
        : defaults.expanded,
    completedCollapsed:
      typeof candidate.completedCollapsed === "boolean"
        ? candidate.completedCollapsed
        : defaults.completedCollapsed,
    generatedAt:
      typeof candidate.generatedAt === "string" ? candidate.generatedAt : null,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : options.fallbackTimestamp,
    items: Array.isArray(candidate.items)
      ? candidate.items
          .map((item, index) =>
            normalizeActionStripItem(item, options.fallbackTimestamp, index),
          )
          .filter((item): item is ActiveTurnActionStripItem => Boolean(item))
      : [],
    clearedCompletedItemKeys: Array.isArray(candidate.clearedCompletedItemKeys)
      ? candidate.clearedCompletedItemKeys
          .filter(
            (key): key is string => typeof key === "string" && Boolean(key),
          )
          .map((key) => key.slice(0, 120))
      : [],
    lastPipelineEventId:
      typeof candidate.lastPipelineEventId === "string"
        ? candidate.lastPipelineEventId
        : null,
    lastFailureReason: sanitizeNullableText(candidate.lastFailureReason),
  };
  return synchronizeActionStripWithPlanner(normalized, {
    planner: options.planner,
    ambientMode: options.ambientMode,
    timestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? normalized.sessionId,
  });
}

export function synchronizeActionStripWithPlanner(
  strip: ActiveTurnActionStripState,
  options: {
    planner: PreTurnPlannerState;
    ambientMode: AmbientGameplayMode;
    timestamp?: string;
    sessionId?: string | null;
  },
): ActiveTurnActionStripState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const visibility = visibilityForMode(options.ambientMode);
  const existingByKey = new Map(strip.items.map((item) => [item.key, item]));
  const clearedKeys = new Set(strip.clearedCompletedItemKeys);
  const retainedClearedKeys = new Set<string>();
  const catalog = createCatalog(
    options.planner,
    options.ambientMode,
    timestamp,
  );
  const items: ActiveTurnActionStripItem[] = [];
  catalog.forEach((draft, index) => {
    const existing = existingByKey.get(draft.key);
    const plannerStatus = draft.sourceActionId
      ? options.planner.actions.find(
          (action) => action.id === draft.sourceActionId,
        )?.status
      : null;
    const status = chooseItemStatus(
      existing?.status,
      draft.status,
      plannerStatus,
    );
    if (
      clearedKeys.has(draft.key) &&
      (!draft.sourceActionId || TERMINAL_STATUSES.has(status))
    ) {
      retainedClearedKeys.add(draft.key);
      return;
    }
    items.push({
      ...draft,
      id: existing?.id ?? draft.id,
      order: existing?.order ?? draft.order ?? index,
      status,
      createdAt: existing?.createdAt ?? draft.createdAt,
      updatedAt:
        existing && existing.status === status ? existing.updatedAt : timestamp,
      completedAt:
        status === "completed"
          ? (existing?.completedAt ?? timestamp)
          : status === existing?.status
            ? (existing.completedAt ?? null)
            : null,
      skippedAt:
        status === "skipped"
          ? (existing?.skippedAt ?? timestamp)
          : status === existing?.status
            ? (existing.skippedAt ?? null)
            : null,
      cancelledAt:
        status === "cancelled"
          ? (existing?.cancelledAt ?? timestamp)
          : status === existing?.status
            ? (existing.cancelledAt ?? null)
            : null,
      deferredAt:
        status === "deferred"
          ? (existing?.deferredAt ?? timestamp)
          : status === existing?.status
            ? (existing.deferredAt ?? null)
            : null,
      blockedReason: existing?.blockedReason ?? draft.blockedReason,
    });
  });

  return {
    ...strip,
    version: ACTIVE_TURN_ACTION_STRIP_VERSION,
    sessionId: options.sessionId ?? strip.sessionId,
    visibility,
    generatedAt:
      catalog.length > 0 ? (strip.generatedAt ?? timestamp) : strip.generatedAt,
    updatedAt: timestamp,
    clearedCompletedItemKeys: [...retainedClearedKeys].sort(),
    items: assignCurrentAction(items, visibility).sort(
      (a, b) => a.order - b.order || a.label.localeCompare(b.label),
    ),
  };
}

export function reorderActionStripItem(
  strip: ActiveTurnActionStripState,
  itemId: string,
  direction: -1 | 1,
  timestamp = new Date().toISOString(),
): ActiveTurnActionStripState {
  const sorted = sortActionStripItems(strip.items);
  const index = sorted.findIndex((item) => item.id === itemId);
  const targetIndex = index + direction;
  if (index < 0 || targetIndex < 0 || targetIndex >= sorted.length) {
    return strip;
  }
  const targetOrder = sorted[targetIndex].order;
  const currentOrder = sorted[index].order;
  return {
    ...strip,
    updatedAt: timestamp,
    items: assignCurrentAction(
      strip.items.map((item) => {
        if (item.id === sorted[index].id) {
          return { ...item, order: targetOrder, updatedAt: timestamp };
        }
        if (item.id === sorted[targetIndex].id) {
          return { ...item, order: currentOrder, updatedAt: timestamp };
        }
        return item;
      }),
      strip.visibility,
    ),
  };
}

export function setActionStripItemStatus(
  strip: ActiveTurnActionStripState,
  itemId: string,
  status: ActiveTurnActionStatus,
  timestamp = new Date().toISOString(),
): ActiveTurnActionStripState {
  return {
    ...strip,
    updatedAt: timestamp,
    items: assignCurrentAction(
      strip.items.map((item) =>
        item.id === itemId
          ? applyItemStatus(item, status, timestamp, null)
          : item,
      ),
      strip.visibility,
    ),
  };
}

export function markActionStripPipelineResult(
  strip: ActiveTurnActionStripState,
  input: {
    itemId: string;
    status: ActiveTurnActionStatus;
    timestamp?: string;
    eventId?: string | null;
    failureReason?: string | null;
  },
): ActiveTurnActionStripState {
  const timestamp = input.timestamp ?? new Date().toISOString();
  return {
    ...setActionStripItemStatus(strip, input.itemId, input.status, timestamp),
    lastPipelineEventId: input.eventId ?? strip.lastPipelineEventId,
    lastFailureReason: input.failureReason ?? null,
  };
}

export function clearCompletedActionStripItems(
  strip: ActiveTurnActionStripState,
  timestamp = new Date().toISOString(),
): ActiveTurnActionStripState {
  const clearedKeys = new Set(strip.clearedCompletedItemKeys);
  for (const item of strip.items) {
    if (TERMINAL_STATUSES.has(item.status)) clearedKeys.add(item.key);
  }
  return {
    ...strip,
    updatedAt: timestamp,
    clearedCompletedItemKeys: [...clearedKeys].sort(),
    items: assignCurrentAction(
      strip.items.filter((item) => !TERMINAL_STATUSES.has(item.status)),
      strip.visibility,
    ),
  };
}

export function setActionStripExpanded(
  strip: ActiveTurnActionStripState,
  expanded: boolean,
  timestamp = new Date().toISOString(),
): ActiveTurnActionStripState {
  return { ...strip, expanded, updatedAt: timestamp };
}

export function setActionStripCompletedCollapsed(
  strip: ActiveTurnActionStripState,
  completedCollapsed: boolean,
  timestamp = new Date().toISOString(),
): ActiveTurnActionStripState {
  return { ...strip, completedCollapsed, updatedAt: timestamp };
}

export function sortActionStripItems(
  items: ActiveTurnActionStripItem[],
): ActiveTurnActionStripItem[] {
  return [...items].sort((a, b) => a.order - b.order);
}

export function actionStripKindLabel(kind: ActiveTurnActionKind): string {
  return ACTION_KIND_LABELS[kind];
}

export function getActionStripDiagnostics(
  strip: ActiveTurnActionStripState,
): ActiveTurnActionStripDiagnostics {
  return {
    version: strip.version,
    sessionId: strip.sessionId,
    visibility: strip.visibility,
    itemCount: strip.items.length,
    currentItemId:
      strip.items.find((item) => item.status === "current")?.id ?? null,
    pendingCount: strip.items.filter(
      (item) => item.status === "pending" || item.status === "current",
    ).length,
    completedCount: strip.items.filter((item) => item.status === "completed")
      .length,
    blockedCount: strip.items.filter((item) => item.status === "blocked")
      .length,
    lastPipelineEventId: strip.lastPipelineEventId,
    lastFailureReason: strip.lastFailureReason,
  };
}

export function plannerStatusFromActionStripStatus(
  status: ActiveTurnActionStatus,
): PreTurnPlannerActionStatus | null {
  if (status === "pending" || status === "current") return "planned";
  if (status === "completed") return "completed";
  if (status === "skipped") return "skipped";
  if (status === "cancelled") return "cancelled";
  return null;
}

function createCatalog(
  planner: PreTurnPlannerState,
  mode: AmbientGameplayMode,
  timestamp: string,
): ActiveTurnActionStripItem[] {
  if (mode === "passive" || mode === "resolution" || mode === "recovery") {
    return [];
  }
  if (mode === "postTurn") {
    return [];
  }
  const items: ActiveTurnActionStripItem[] = [];
  if (mode === "preTurnPreparation") {
    items.push(
      createSystemItem(
        {
          key: "system-begin-turn",
          kind: "begin-turn",
          label: "Begin Turn",
          detail: "Start active turn mode and bring prepared actions forward.",
          intentKind: "custom",
          order: -100,
          requiredMode: "preTurnPreparation",
          source: "turn-context",
        },
        timestamp,
      ),
    );
  }

  const includePlanner = mode !== "combat";
  if (includePlanner) {
    for (const planned of sortPlannedActions(planner.actions)) {
      const item = createPlannerItem(planned, mode, timestamp);
      if (item) items.push(item);
    }
  } else {
    for (const planned of sortPlannedActions(planner.actions)) {
      if (planned.type !== "planned-attack") continue;
      const item = createPlannerItem(planned, mode, timestamp);
      if (item) items.push(item);
    }
  }

  if (mode === "activeTurn") {
    items.push(
      ...ACTIVE_TURN_SYSTEM_ACTIONS.map((item) =>
        createSystemItem(item, timestamp),
      ),
    );
  }
  if (mode === "combat") {
    items.push(
      ...COMBAT_SYSTEM_ACTIONS.map((item) => createSystemItem(item, timestamp)),
    );
  }
  return items;
}

function createPlannerItem(
  action: PlannedAction,
  mode: AmbientGameplayMode,
  timestamp: string,
): ActiveTurnActionStripItem | null {
  const kind = actionKindForPlannerAction(action.type);
  if (!kind) return null;
  const intent = plannedActionToAmbientIntent(action);
  const label = labelForPlannerAction(action);
  return {
    id: makeId("turn-action"),
    key: `planner-${action.id}`,
    kind,
    label,
    detail: action.reminders[0] || action.notes || actionTypeLabel(action.type),
    source: action.type.includes("reminder") ? "reminder" : "planner",
    sourceActionId: action.id,
    intentKind: intent.kind,
    intent: {
      ...intent,
      id: makeId("strip-intent"),
      confidence: mode === "preTurnPreparation" ? "medium" : "high",
      requiresPreview: mode === "preTurnPreparation",
      requiredMode:
        mode === "preTurnPreparation"
          ? null
          : kind === "declare-planned-attack"
            ? "combat"
            : "activeTurn",
      payload: {
        ...intent.payload,
        actionStripKind: kind,
        actionStripSourceActionId: action.id,
      },
    },
    order: 100 + action.order,
    status: "pending",
    requiredMode:
      mode === "preTurnPreparation"
        ? null
        : kind === "declare-planned-attack"
          ? "combat"
          : "activeTurn",
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    skippedAt: null,
    cancelledAt: null,
    deferredAt: null,
    blockedReason: null,
  };
}

function createSystemItem(
  definition: SystemActionDefinition,
  timestamp: string,
): ActiveTurnActionStripItem {
  return {
    id: makeId("turn-action"),
    key: definition.key,
    kind: definition.kind,
    label: definition.label,
    detail: definition.detail,
    source: definition.source,
    sourceActionId: null,
    intentKind: definition.intentKind,
    intent: {
      id: makeId("strip-intent"),
      kind: definition.intentKind,
      source: "turn-planner",
      actor: "you",
      confidence: "high",
      requiredMode: definition.requiredMode,
      requiresPreview: false,
      payload: {
        actionStripKind: definition.kind,
        actionStripSystemKey: definition.key,
      },
    },
    order: definition.order,
    status: "pending",
    requiredMode: definition.requiredMode,
    createdAt: timestamp,
    updatedAt: timestamp,
    completedAt: null,
    skippedAt: null,
    cancelledAt: null,
    deferredAt: null,
    blockedReason: null,
  };
}

function chooseItemStatus(
  existing: ActiveTurnActionStatus | undefined,
  draft: ActiveTurnActionStatus,
  plannerStatus: PreTurnPlannerActionStatus | null | undefined,
): ActiveTurnActionStatus {
  if (plannerStatus === "completed") return "completed";
  if (plannerStatus === "skipped") return "skipped";
  if (plannerStatus === "cancelled") return "cancelled";
  if (
    plannerStatus === "planned" &&
    existing &&
    TERMINAL_STATUSES.has(existing)
  ) {
    return draft;
  }
  if (!existing) return draft;
  if (TERMINAL_STATUSES.has(existing)) return existing;
  if (existing === "deferred" || existing === "blocked") return existing;
  return existing === "current" ? "current" : draft;
}

function assignCurrentAction(
  items: ActiveTurnActionStripItem[],
  visibility: ActiveTurnActionStripVisibility,
): ActiveTurnActionStripItem[] {
  if (
    visibility === "hidden" ||
    visibility === "suspended" ||
    visibility === "recovery" ||
    visibility === "archived"
  ) {
    return items.map((item) =>
      item.status === "current" ? { ...item, status: "pending" } : item,
    );
  }
  let currentAssigned = false;
  const ordered = sortActionStripItems(items);
  const currentId =
    ordered.find((item) => item.status === "current")?.id ??
    ordered.find((item) => item.status === "pending")?.id ??
    null;
  return items.map((item) => {
    if (item.id === currentId && !currentAssigned) {
      currentAssigned = true;
      return item.status === "current" ? item : { ...item, status: "current" };
    }
    return item.status === "current" ? { ...item, status: "pending" } : item;
  });
}

function applyItemStatus(
  item: ActiveTurnActionStripItem,
  status: ActiveTurnActionStatus,
  timestamp: string,
  blockedReason: string | null,
): ActiveTurnActionStripItem {
  return {
    ...item,
    status,
    updatedAt: timestamp,
    completedAt: status === "completed" ? timestamp : null,
    skippedAt: status === "skipped" ? timestamp : null,
    cancelledAt: status === "cancelled" ? timestamp : null,
    deferredAt: status === "deferred" ? timestamp : null,
    blockedReason: status === "blocked" ? blockedReason : null,
  };
}

function normalizeActionStripItem(
  value: unknown,
  fallbackTimestamp: string,
  fallbackOrder: number,
): ActiveTurnActionStripItem | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<ActiveTurnActionStripItem>;
  const kind = normalizeKind(candidate.kind);
  if (!kind) return null;
  const label = sanitizeText(candidate.label, actionStripKindLabel(kind));
  const intentKind = normalizeIntentKind(candidate.intentKind);
  return {
    id: sanitizeText(candidate.id, makeId("turn-action")),
    key: sanitizeText(candidate.key, `legacy-${candidate.id ?? fallbackOrder}`),
    kind,
    label,
    detail: sanitizeText(candidate.detail, ""),
    source: normalizeSource(candidate.source),
    sourceActionId: sanitizeNullableText(candidate.sourceActionId),
    intentKind,
    intent: normalizeIntent(candidate.intent, intentKind, kind),
    order:
      typeof candidate.order === "number" && Number.isFinite(candidate.order)
        ? candidate.order
        : fallbackOrder,
    status: normalizeItemStatus(candidate.status) ?? "pending",
    requiredMode: normalizeMode(candidate.requiredMode),
    createdAt:
      typeof candidate.createdAt === "string"
        ? candidate.createdAt
        : fallbackTimestamp,
    updatedAt:
      typeof candidate.updatedAt === "string"
        ? candidate.updatedAt
        : fallbackTimestamp,
    completedAt: normalizeNullableDate(candidate.completedAt),
    skippedAt: normalizeNullableDate(candidate.skippedAt),
    cancelledAt: normalizeNullableDate(candidate.cancelledAt),
    deferredAt: normalizeNullableDate(candidate.deferredAt),
    blockedReason: sanitizeNullableText(candidate.blockedReason),
  };
}

function normalizeIntent(
  value: unknown,
  kind: AmbientIntentKind,
  actionKind: ActiveTurnActionKind,
): AmbientIntentInput {
  if (!value || typeof value !== "object") {
    return {
      kind,
      source: "turn-planner",
      confidence: "high",
      payload: { actionStripKind: actionKind },
    };
  }
  const candidate = value as Partial<AmbientIntentInput>;
  return {
    ...candidate,
    kind,
    source: candidate.source ?? "turn-planner",
    confidence: candidate.confidence ?? "high",
    payload: {
      ...(candidate.payload ?? {}),
      actionStripKind: actionKind,
    },
  };
}

function visibilityForMode(
  mode: AmbientGameplayMode,
): ActiveTurnActionStripVisibility {
  if (mode === "preTurnPreparation") return "preview";
  if (mode === "activeTurn") return "primary";
  if (mode === "combat") return "combat";
  if (mode === "resolution") return "suspended";
  if (mode === "recovery") return "recovery";
  if (mode === "postTurn") return "archived";
  return "hidden";
}

function actionKindForPlannerAction(
  type: PreTurnPlannerActionType,
): ActiveTurnActionKind | null {
  if (type === "land-play") return "play-planned-land";
  if (type === "spell-sequence") return "cast-planned-spell";
  if (type === "planned-attack") return "declare-planned-attack";
  if (type === "token-creation") return "activate-planned-ability";
  if (type === "counter-placement") return "activate-planned-ability";
  if (type === "trigger-reminder") return "resolve-planned-trigger";
  if (type === "hold-up-interaction") return "hold-priority-reminder";
  if (type === "priority-reminder") return "pass-priority";
  if (type === "end-step-reminder") return "end-turn";
  if (type === "mana-use") return "second-main-reminder";
  if (type === "blocker-reminder") return "hold-priority-reminder";
  if (type === "note") return "hold-priority-reminder";
  return null;
}

function labelForPlannerAction(action: PlannedAction): string {
  if (action.type === "land-play") return `Play ${action.title}`;
  if (action.type === "spell-sequence") return `Cast ${action.title}`;
  if (action.type === "planned-attack") return `Attack: ${action.title}`;
  if (action.type === "trigger-reminder") return `Resolve ${action.title}`;
  return action.title;
}

function normalizeVisibility(
  value: unknown,
): ActiveTurnActionStripVisibility | null {
  return value === "hidden" ||
    value === "preview" ||
    value === "primary" ||
    value === "combat" ||
    value === "suspended" ||
    value === "recovery" ||
    value === "archived"
    ? value
    : null;
}

function normalizeKind(value: unknown): ActiveTurnActionKind | null {
  return typeof value === "string" && value in ACTION_KIND_LABELS
    ? (value as ActiveTurnActionKind)
    : null;
}

function normalizeItemStatus(value: unknown): ActiveTurnActionStatus | null {
  return value === "pending" ||
    value === "current" ||
    value === "completed" ||
    value === "skipped" ||
    value === "cancelled" ||
    value === "deferred" ||
    value === "blocked"
    ? value
    : null;
}

function normalizeSource(value: unknown): ActiveTurnActionSource {
  return value === "planner" ||
    value === "turn-context" ||
    value === "phase-context" ||
    value === "reminder"
    ? value
    : "planner";
}

function normalizeMode(value: unknown): AmbientGameplayMode | null {
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

function normalizeIntentKind(value: unknown): AmbientIntentKind {
  return value === "play-land" ||
    value === "cast-spell" ||
    value === "attack" ||
    value === "block" ||
    value === "create-token" ||
    value === "destroy-permanent" ||
    value === "sacrifice-permanent" ||
    value === "tap" ||
    value === "untap" ||
    value === "add-counters" ||
    value === "remove-counters" ||
    value === "end-turn" ||
    value === "pass-priority" ||
    value === "draw-cards" ||
    value === "discard-cards" ||
    value === "return-permanent" ||
    value === "exile-permanent" ||
    value === "modify-life" ||
    value === "modify-commander-damage" ||
    value === "manual-correction" ||
    value === "custom"
    ? value
    : "custom";
}

function sanitizeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value
        .replace(/[<>{}`]/g, "")
        .trim()
        .slice(0, 120)
    : fallback;
}

function sanitizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? sanitizeText(value, "")
    : null;
}

function normalizeNullableDate(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

interface SystemActionDefinition {
  key: string;
  kind: ActiveTurnActionKind;
  label: string;
  detail: string;
  intentKind: AmbientIntentKind;
  order: number;
  requiredMode: AmbientGameplayMode;
  source: ActiveTurnActionSource;
}

const ACTION_KIND_LABELS: Record<ActiveTurnActionKind, string> = {
  "begin-turn": "Begin Turn",
  draw: "Draw",
  "play-planned-land": "Play Planned Land",
  "cast-planned-spell": "Cast Planned Spell",
  "activate-planned-ability": "Activate Planned Ability",
  "move-to-combat": "Move to Combat",
  "declare-planned-attack": "Declare Planned Attack",
  "resolve-planned-trigger": "Resolve Planned Trigger",
  "hold-priority-reminder": "Hold Priority Reminder",
  "end-combat": "End Combat",
  "second-main-reminder": "Second Main Reminder",
  "end-turn": "End Turn",
  "pass-priority": "Pass Priority",
};
