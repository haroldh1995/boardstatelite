import { makeId } from "../domain/cards";
import type { FieldState } from "../domain/types";
import { normalizeAmbientConfidence } from "./ambientConfidence";
import type { AmbientGameplayMode } from "./ambientTypes";
import type {
  AmbientConfidenceAssessment,
  AmbientConfidenceLevel,
} from "./ambientConfidenceTypes";
import type { AmbientIntentKind } from "./ambientEventTypes";
import { recognizeMagicCommand } from "./magicCommandGrammar";
import type {
  EchoMagicCommandGrammarInput,
  EchoMagicCommandGrammarResult,
  EchoMagicCommandObjectKind,
} from "./magicCommandGrammarTypes";
import {
  ECHO_CONTEXTUAL_LISTENING_VERSION,
  ECHO_LISTENING_WINDOW_KINDS,
  type EchoContextualEntityPrioritySignal,
  type EchoContextualListeningDiagnostics,
  type EchoContextualListeningSettings,
  type EchoContextualListeningState,
  type EchoListeningWindow,
  type EchoListeningWindowActivationSource,
  type EchoListeningWindowEntityPriority,
  type EchoListeningWindowKind,
  type EchoListeningWindowLifecycleRecord,
  type EchoListeningWindowLifecycleStatus,
  type EchoListeningWindowVocabulary,
  type EchoWindowedMagicCommandInput,
  type EchoWindowedMagicCommandResult,
  type EchoWindowedMagicCommandStatus,
} from "./contextualListeningTypes";

type GrammarField = EchoMagicCommandGrammarInput["field"];

interface WindowDefinition {
  kind: EchoListeningWindowKind;
  label: string;
  verbs: string[];
  nouns: string[];
  counterNames?: string[];
  tokenTypes?: string[];
  zones?: string[];
  manaColors?: string[];
  intentKinds: AmbientIntentKind[];
  entityPriorities: EchoListeningWindowEntityPriority[];
  expectedActions: string[];
  preferredAmbientMode: AmbientGameplayMode;
  defaultTimeoutMs: number | null;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_DEPTH = 4;
const TERMINAL_WINDOW_STATUSES = new Set<EchoListeningWindowLifecycleStatus>([
  "expired",
  "cancelled",
  "completed",
  "destroyed",
]);

const VALID_WINDOW_TRANSITIONS: Record<
  EchoListeningWindowLifecycleStatus,
  EchoListeningWindowLifecycleStatus[]
> = {
  created: ["activated", "cancelled", "destroyed"],
  activated: [
    "updated",
    "suspended",
    "expired",
    "cancelled",
    "completed",
    "recovered",
    "destroyed",
  ],
  updated: [
    "activated",
    "suspended",
    "expired",
    "cancelled",
    "completed",
    "recovered",
    "destroyed",
  ],
  suspended: ["resumed", "recovered", "expired", "cancelled", "destroyed"],
  resumed: [
    "updated",
    "suspended",
    "expired",
    "cancelled",
    "completed",
    "recovered",
    "destroyed",
  ],
  expired: ["destroyed", "recovered"],
  cancelled: ["destroyed", "recovered"],
  completed: ["destroyed", "recovered"],
  recovered: ["activated", "updated", "suspended", "destroyed"],
  destroyed: [],
};

const BASIC_LAND_NAMES = [
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
  "Wastes",
];

const COMMON_COUNTER_NAMES = [
  "+1/+1",
  "-1/-1",
  "Shield",
  "Stun",
  "Charge",
  "Loyalty",
  "Oil",
  "Time",
  "Lore",
  "Quest",
  "Experience",
  "Poison",
];

const WINDOW_DEFINITIONS: Record<EchoListeningWindowKind, WindowDefinition> = {
  generalGameplay: {
    kind: "generalGameplay",
    label: "General Gameplay",
    verbs: [
      "play",
      "cast",
      "activate",
      "tap",
      "untap",
      "create",
      "draw",
      "discard",
      "pass",
      "end",
    ],
    nouns: [
      "card",
      "permanent",
      "commander",
      "token",
      "counter",
      "life",
      "turn",
      "priority",
    ],
    counterNames: COMMON_COUNTER_NAMES,
    tokenTypes: ["Soldier", "Gnome", "Treasure", "Clue", "Food", "Creature"],
    zones: ["battlefield", "hand", "graveyard", "exile", "library"],
    manaColors: ["white", "blue", "black", "red", "green", "colorless"],
    intentKinds: [
      "play-land",
      "cast-spell",
      "activate-ability",
      "tap",
      "untap",
      "create-token",
      "add-counters",
      "remove-counters",
      "modify-life",
      "modify-commander-damage",
      "draw-cards",
      "discard-cards",
      "pass-priority",
      "hold-priority",
      "end-turn",
    ],
    entityPriorities: [
      priority(
        "battlefield-object",
        0.46,
        "General gameplay can reference any permanent.",
      ),
      priority(
        "card",
        0.4,
        "General gameplay can reference recently used cards.",
      ),
      priority("player", 0.3, "General gameplay can reference players."),
    ],
    expectedActions: [
      "General battlefield updates",
      "Card and token management",
      "Life and counter updates",
    ],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: null,
  },
  landPlay: {
    kind: "landPlay",
    label: "Land Play",
    verbs: ["play", "drop", "put down"],
    nouns: [...BASIC_LAND_NAMES, "land", "fetch", "target"],
    zones: ["battlefield", "hand", "library"],
    intentKinds: ["play-land"],
    entityPriorities: [
      priority(
        "land",
        0.9,
        "Land windows prioritize land names and known lands.",
      ),
      priority(
        "card",
        0.5,
        "Land windows may reference land cards not on the battlefield.",
      ),
    ],
    expectedActions: ["Play a land", "Choose a land alternative"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  spellCasting: {
    kind: "spellCasting",
    label: "Spell Casting",
    verbs: ["cast", "play", "pay for"],
    nouns: ["spell", "card", "commander"],
    zones: ["hand", "command", "battlefield"],
    manaColors: ["white", "blue", "black", "red", "green", "colorless"],
    intentKinds: ["cast-spell", "counter-spell"],
    entityPriorities: [
      priority("card", 0.82, "Spell windows prioritize card names."),
      priority("commander", 0.7, "Spell windows may reference the commander."),
    ],
    expectedActions: ["Cast a planned spell", "Counter a spell"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  activatedAbility: {
    kind: "activatedAbility",
    label: "Activated Ability",
    verbs: ["activate", "tap", "untap", "equip", "attach"],
    nouns: ["ability", "permanent", "equipment", "aura"],
    intentKinds: ["activate-ability", "tap", "untap", "equip", "attach"],
    entityPriorities: [
      priority(
        "battlefield-object",
        0.85,
        "Activated ability windows prioritize battlefield permanents.",
      ),
      priority(
        "land",
        0.62,
        "Activated ability windows may reference mana abilities.",
      ),
    ],
    expectedActions: ["Activate an ability", "Tap or untap a permanent"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  triggerResolution: {
    kind: "triggerResolution",
    label: "Trigger Resolution",
    verbs: ["resolve", "add", "create", "draw", "gain", "lose"],
    nouns: ["trigger", "counter", "token", "life", "card"],
    counterNames: COMMON_COUNTER_NAMES,
    tokenTypes: ["Soldier", "Gnome", "Treasure", "Clue", "Food", "Creature"],
    intentKinds: [
      "add-counters",
      "remove-counters",
      "create-token",
      "modify-life",
      "draw-cards",
      "custom",
    ],
    entityPriorities: [
      priority(
        "battlefield-object",
        0.7,
        "Trigger windows prioritize current trigger sources and targets.",
      ),
      priority("counter", 0.68, "Trigger windows often reference counters."),
      priority(
        "token",
        0.62,
        "Trigger windows often reference token creation.",
      ),
    ],
    expectedActions: ["Resolve a trigger", "Adjust trigger-created objects"],
    preferredAmbientMode: "resolution",
    defaultTimeoutMs: 20_000,
  },
  counterModification: {
    kind: "counterModification",
    label: "Counter Modification",
    verbs: ["add", "put", "remove", "counter"],
    nouns: ["counter", "counters"],
    counterNames: COMMON_COUNTER_NAMES,
    intentKinds: ["add-counters", "remove-counters"],
    entityPriorities: [
      priority("counter", 0.95, "Counter windows prioritize counter names."),
      priority(
        "battlefield-object",
        0.78,
        "Counter windows prioritize permanents that can receive counters.",
      ),
      priority("player", 0.5, "Counter windows may reference player counters."),
    ],
    expectedActions: ["Add counters", "Remove counters"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  tokenCreation: {
    kind: "tokenCreation",
    label: "Token Creation",
    verbs: ["create", "make"],
    nouns: ["token", "tokens", "creature"],
    tokenTypes: ["Soldier", "Gnome", "Treasure", "Clue", "Food", "Beast"],
    intentKinds: ["create-token"],
    entityPriorities: [
      priority("token", 0.94, "Token creation windows prioritize token types."),
      priority(
        "card",
        0.4,
        "Token creation may reference a card-created token template.",
      ),
    ],
    expectedActions: ["Create a token", "Choose a token quantity"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  tokenRemoval: {
    kind: "tokenRemoval",
    label: "Token Removal",
    verbs: ["destroy", "sacrifice", "exile", "remove"],
    nouns: ["token", "tokens"],
    tokenTypes: ["Soldier", "Gnome", "Treasure", "Clue", "Food", "Beast"],
    intentKinds: [
      "destroy-permanent",
      "sacrifice-permanent",
      "exile-permanent",
    ],
    entityPriorities: [
      priority(
        "token",
        0.95,
        "Token removal windows prioritize existing token stacks.",
      ),
      priority(
        "battlefield-object",
        0.46,
        "Token removal can still target battlefield objects.",
      ),
    ],
    expectedActions: ["Remove a token", "Sacrifice or destroy tokens"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  lifeAdjustment: {
    kind: "lifeAdjustment",
    label: "Life Adjustment",
    verbs: ["gain", "lose", "pay", "damage"],
    nouns: ["life", "damage", "opponent"],
    intentKinds: ["modify-life"],
    entityPriorities: [
      priority("player", 0.92, "Life windows prioritize player references."),
    ],
    expectedActions: ["Change life total"],
    preferredAmbientMode: "activeTurn",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  commanderDamage: {
    kind: "commanderDamage",
    label: "Commander Damage",
    verbs: ["deal", "take", "mark", "damage"],
    nouns: ["commander", "damage", "opponent"],
    intentKinds: ["modify-commander-damage"],
    entityPriorities: [
      priority(
        "commander",
        0.94,
        "Commander damage windows prioritize commanders.",
      ),
      priority(
        "player",
        0.78,
        "Commander damage windows prioritize affected players.",
      ),
    ],
    expectedActions: ["Record commander damage"],
    preferredAmbientMode: "combat",
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
  },
  combatPreparation: {
    kind: "combatPreparation",
    label: "Combat Preparation",
    verbs: ["combat", "attack", "swing", "move"],
    nouns: ["combat", "attackers", "creatures", "commander"],
    intentKinds: ["attack", "hold-priority", "pass-priority"],
    entityPriorities: [
      priority("commander", 0.88, "Combat windows prioritize commanders."),
      priority(
        "battlefield-object",
        0.8,
        "Combat windows prioritize creatures.",
      ),
    ],
    expectedActions: ["Move to combat", "Prepare attacks"],
    preferredAmbientMode: "combat",
    defaultTimeoutMs: 20_000,
  },
  combatDeclaration: {
    kind: "combatDeclaration",
    label: "Combat Declaration",
    verbs: ["attack", "swing", "block"],
    nouns: ["attacker", "attackers", "blocker", "creature", "commander"],
    intentKinds: ["attack", "block"],
    entityPriorities: [
      priority("commander", 0.96, "Combat declaration prioritizes commanders."),
      priority(
        "battlefield-object",
        0.9,
        "Combat declaration prioritizes creatures.",
      ),
    ],
    expectedActions: ["Declare attacks", "Declare blocks"],
    preferredAmbientMode: "combat",
    defaultTimeoutMs: 20_000,
  },
  combatResolution: {
    kind: "combatResolution",
    label: "Combat Resolution",
    verbs: ["destroyed", "survived", "died", "blocked", "damage"],
    nouns: ["damage", "dead", "blocked", "creature", "commander"],
    intentKinds: [
      "destroy-permanent",
      "sacrifice-permanent",
      "modify-life",
      "modify-commander-damage",
      "remove-counters",
    ],
    entityPriorities: [
      priority(
        "battlefield-object",
        0.86,
        "Combat resolution prioritizes creatures involved in combat.",
      ),
      priority(
        "commander",
        0.84,
        "Combat resolution prioritizes commanders for commander damage.",
      ),
      priority("player", 0.72, "Combat resolution can affect players."),
    ],
    expectedActions: ["Resolve combat damage", "Record combat outcomes"],
    preferredAmbientMode: "combat",
    defaultTimeoutMs: 24_000,
  },
  endStep: {
    kind: "endStep",
    label: "End Step",
    verbs: ["end step", "cleanup", "trigger", "resolve"],
    nouns: ["end step", "trigger", "cleanup", "discard"],
    intentKinds: [
      "discard-cards",
      "hold-priority",
      "pass-priority",
      "end-turn",
    ],
    entityPriorities: [
      priority("card", 0.5, "End step windows may reference cards in hand."),
      priority(
        "battlefield-object",
        0.42,
        "End step windows may reference delayed triggers.",
      ),
    ],
    expectedActions: ["Resolve end-step reminders", "Pass through cleanup"],
    preferredAmbientMode: "postTurn",
    defaultTimeoutMs: 20_000,
  },
  endTurn: {
    kind: "endTurn",
    label: "End Turn",
    verbs: ["pass", "done", "end turn", "go ahead"],
    nouns: ["turn", "priority"],
    intentKinds: ["end-turn", "pass-priority"],
    entityPriorities: [
      priority(
        "player",
        0.42,
        "End turn windows may reference priority passing.",
      ),
    ],
    expectedActions: ["End turn", "Pass priority"],
    preferredAmbientMode: "postTurn",
    defaultTimeoutMs: 18_000,
  },
};

export function createDefaultContextualListeningSettings(
  overrides: Partial<EchoContextualListeningSettings> = {},
): EchoContextualListeningSettings {
  return normalizeContextualListeningSettings({
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    enabled: false,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    preserveWindowStackOnRestore: false,
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    lastResetAt: null,
    ...overrides,
  });
}

export function normalizeContextualListeningSettings(
  value: unknown,
): EchoContextualListeningSettings {
  const defaults: EchoContextualListeningSettings = {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    enabled: false,
    defaultTimeoutMs: DEFAULT_TIMEOUT_MS,
    preserveWindowStackOnRestore: false,
    accessibilityAnnouncementsPrepared: true as const,
    localizationReady: true as const,
    lastResetAt: null,
  };
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoContextualListeningSettings>;
  return {
    ...defaults,
    enabled: Boolean(candidate.enabled),
    defaultTimeoutMs: clampMilliseconds(
      candidate.defaultTimeoutMs,
      DEFAULT_TIMEOUT_MS,
    ),
    preserveWindowStackOnRestore: Boolean(
      candidate.preserveWindowStackOnRestore,
    ),
    accessibilityAnnouncementsPrepared: true,
    localizationReady: true,
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultContextualListeningState(
  options: {
    timestamp?: string;
    sessionId?: string | null;
    defaultTimeoutMs?: number;
  } = {},
): EchoContextualListeningState {
  void options.timestamp;
  const defaultTimeoutMs = clampMilliseconds(
    options.defaultTimeoutMs,
    DEFAULT_TIMEOUT_MS,
  );
  return withDiagnostics({
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    sessionId: options.sessionId ?? null,
    activeWindowId: null,
    windows: [],
    defaultTimeoutMs,
    maxDepth: DEFAULT_MAX_DEPTH,
    lastRecoveredWindowId: null,
    lastExpiredWindowId: null,
    lastGrammarResultId: null,
    diagnostics: createDiagnostics({
      sessionId: options.sessionId ?? null,
      activeWindow: null,
      stackDepth: 0,
      lastRecoveredWindowId: null,
      lastExpiredWindowId: null,
      lastGrammarResultId: null,
      lastStatus: null,
      lastError: null,
      windowSwitchCount: 0,
    }),
  });
}

export function normalizeContextualListeningState(
  value: unknown,
  options: {
    fallbackTimestamp: string;
    sessionId?: string | null;
    ambientMode?: AmbientGameplayMode;
    defaultTimeoutMs?: number;
    preserveWindowStackOnRestore?: boolean;
  },
): EchoContextualListeningState {
  const defaults = createDefaultContextualListeningState({
    timestamp: options.fallbackTimestamp,
    sessionId: options.sessionId ?? null,
    defaultTimeoutMs: options.defaultTimeoutMs,
  });
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoContextualListeningState>;
  const normalizedWindows = Array.isArray(candidate.windows)
    ? candidate.windows
        .map((entry) =>
          normalizeListeningWindow(entry, {
            fallbackTimestamp: options.fallbackTimestamp,
            ambientMode: options.ambientMode ?? "passive",
          }),
        )
        .filter((entry): entry is EchoListeningWindow => Boolean(entry))
    : [];
  const windows = options.preserveWindowStackOnRestore
    ? pruneWindows(normalizedWindows)
    : pruneWindows(
        normalizedWindows.filter(
          (entry) => !TERMINAL_WINDOW_STATUSES.has(entry.status),
        ),
      );
  const activeWindowId =
    typeof candidate.activeWindowId === "string" &&
    windows.some((entry) => entry.id === candidate.activeWindowId)
      ? candidate.activeWindowId
      : null;
  const activeWindow = activeWindowId
    ? (windows.find((entry) => entry.id === activeWindowId) ?? null)
    : null;
  const safeActiveWindow =
    activeWindow &&
    !TERMINAL_WINDOW_STATUSES.has(activeWindow.status) &&
    !isWindowExpired(activeWindow, options.fallbackTimestamp)
      ? activeWindow
      : null;
  const safeWindows = safeActiveWindow
    ? windows
    : windows.map((entry) =>
        entry.id === activeWindow?.id
          ? transitionListeningWindow(entry, "expired", {
              timestamp: options.fallbackTimestamp,
              reason: "Persisted listening window was stale.",
            })
          : entry,
      );

  return withDiagnostics({
    ...defaults,
    sessionId:
      typeof candidate.sessionId === "string"
        ? candidate.sessionId
        : (options.sessionId ?? null),
    activeWindowId: safeActiveWindow?.id ?? null,
    windows: pruneWindows(safeWindows),
    defaultTimeoutMs: clampMilliseconds(
      candidate.defaultTimeoutMs ?? options.defaultTimeoutMs,
      defaults.defaultTimeoutMs,
    ),
    maxDepth: clampCount(candidate.maxDepth, DEFAULT_MAX_DEPTH, 1, 8),
    lastRecoveredWindowId: sanitizeNullableText(
      candidate.lastRecoveredWindowId,
    ),
    lastExpiredWindowId: safeActiveWindow
      ? sanitizeNullableText(candidate.lastExpiredWindowId)
      : (activeWindow?.id ??
        sanitizeNullableText(candidate.lastExpiredWindowId)),
    lastGrammarResultId: sanitizeNullableText(candidate.lastGrammarResultId),
  });
}

export function createListeningWindow(
  kind: EchoListeningWindowKind,
  options: {
    timestamp?: string;
    source?: EchoListeningWindowActivationSource;
    parentId?: string | null;
    depth?: number;
    ambientMode?: AmbientGameplayMode;
    timeoutMs?: number | null;
    reason?: string;
  } = {},
): EchoListeningWindow {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const definition = WINDOW_DEFINITIONS[kind];
  const timeoutMs =
    options.timeoutMs === null
      ? null
      : clampMilliseconds(
          options.timeoutMs ?? definition.defaultTimeoutMs,
          definition.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS,
        );
  const lifecycle = createLifecycle("created", timestamp, options.reason);
  return {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    id: makeId("listening-window"),
    kind,
    status: "created",
    source: options.source ?? "system",
    parentId: options.parentId ?? null,
    depth: clampCount(options.depth, 0, 0, DEFAULT_MAX_DEPTH),
    ambientMode: options.ambientMode ?? definition.preferredAmbientMode,
    createdAt: timestamp,
    updatedAt: timestamp,
    activatedAt: null,
    expiresAt:
      timeoutMs === null ? null : addMilliseconds(timestamp, timeoutMs),
    vocabulary: createVocabulary(definition),
    entityPriorities: definition.entityPriorities.map((entry) => ({
      ...entry,
    })),
    allowedIntentKinds: [...definition.intentKinds],
    expectedActions: [...definition.expectedActions],
    accessibilityLabel: `${definition.label} listening window`,
    lifecycle,
  };
}

export function isContextualListeningWindowTransitionAllowed(
  from: EchoListeningWindowLifecycleStatus,
  to: EchoListeningWindowLifecycleStatus,
): boolean {
  return from === to || VALID_WINDOW_TRANSITIONS[from].includes(to);
}

export function transitionListeningWindow(
  window: EchoListeningWindow,
  targetStatus: EchoListeningWindowLifecycleStatus,
  options: { timestamp?: string; reason?: string } = {},
): EchoListeningWindow {
  const timestamp = options.timestamp ?? new Date().toISOString();
  if (
    !isContextualListeningWindowTransitionAllowed(window.status, targetStatus)
  ) {
    return {
      ...window,
      updatedAt: timestamp,
      lifecycle: [
        ...window.lifecycle,
        {
          status: window.status,
          timestamp,
          reason:
            options.reason ??
            `Invalid listening window transition from ${window.status} to ${targetStatus}.`,
        },
      ],
    };
  }
  return {
    ...window,
    status: targetStatus,
    updatedAt: timestamp,
    activatedAt:
      targetStatus === "activated" || targetStatus === "resumed"
        ? (window.activatedAt ?? timestamp)
        : window.activatedAt,
    lifecycle: [
      ...window.lifecycle,
      {
        status: targetStatus,
        timestamp,
        reason:
          options.reason ?? `Listening window transitioned to ${targetStatus}.`,
      },
    ],
  };
}

export function activateListeningWindow(
  state: EchoContextualListeningState,
  kind: EchoListeningWindowKind,
  options: {
    timestamp?: string;
    source?: EchoListeningWindowActivationSource;
    ambientMode?: AmbientGameplayMode;
    nested?: boolean;
    timeoutMs?: number | null;
    reason?: string;
  } = {},
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const normalized = normalizeContextualListeningState(state, {
    fallbackTimestamp: timestamp,
    sessionId: state.sessionId,
    ambientMode: options.ambientMode,
    defaultTimeoutMs: state.defaultTimeoutMs,
    preserveWindowStackOnRestore: true,
  });
  const active = getActiveWindow(normalized);
  if (active?.kind === kind && active.status !== "suspended") {
    const updated = transitionListeningWindow(active, "updated", {
      timestamp,
      reason: options.reason ?? "Listening window context updated.",
    });
    return withDiagnostics({
      ...normalized,
      activeWindowId: updated.id,
      windows: normalized.windows.map((entry) =>
        entry.id === updated.id ? updated : entry,
      ),
    });
  }

  const useNested =
    options.nested === true &&
    active !== null &&
    active.depth + 1 < normalized.maxDepth;
  const parentId = useNested ? (active?.id ?? null) : null;
  const depth = useNested ? (active?.depth ?? 0) + 1 : 0;
  const suspendedActive =
    active && !TERMINAL_WINDOW_STATUSES.has(active.status)
      ? transitionListeningWindow(active, "suspended", {
          timestamp,
          reason: `Suspended for ${windowLabel(kind)} window.`,
        })
      : null;
  const created = createListeningWindow(kind, {
    timestamp,
    source: options.source,
    parentId,
    depth,
    ambientMode: options.ambientMode,
    timeoutMs:
      options.timeoutMs === undefined
        ? normalized.defaultTimeoutMs
        : options.timeoutMs,
    reason: options.reason,
  });
  const activated = transitionListeningWindow(created, "activated", {
    timestamp,
    reason: options.reason ?? `${windowLabel(kind)} window activated.`,
  });
  const retainedWindows = normalized.windows
    .filter((entry) => entry.id !== active?.id)
    .concat(suspendedActive ? [suspendedActive] : [])
    .filter((entry) => useNested || entry.parentId !== active?.id);
  return withDiagnostics({
    ...normalized,
    activeWindowId: activated.id,
    windows: pruneWindows([...retainedWindows, activated]),
    diagnostics: {
      ...normalized.diagnostics,
      windowSwitchCount: normalized.diagnostics.windowSwitchCount + 1,
    },
  });
}

export function suspendActiveListeningWindow(
  state: EchoContextualListeningState,
  options: { timestamp?: string; reason?: string } = {},
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const active = getActiveWindow(state);
  if (!active) return withDiagnostics(state);
  const suspended = transitionListeningWindow(active, "suspended", {
    timestamp,
    reason: options.reason ?? "Listening window suspended.",
  });
  return withDiagnostics({
    ...state,
    activeWindowId: null,
    windows: state.windows.map((entry) =>
      entry.id === suspended.id ? suspended : entry,
    ),
  });
}

export function completeActiveListeningWindow(
  state: EchoContextualListeningState,
  options: { timestamp?: string; reason?: string } = {},
): EchoContextualListeningState {
  return closeActiveWindow(state, "completed", {
    timestamp: options.timestamp,
    reason: options.reason ?? "Listening window completed.",
  });
}

export function cancelActiveListeningWindow(
  state: EchoContextualListeningState,
  options: { timestamp?: string; reason?: string } = {},
): EchoContextualListeningState {
  return closeActiveWindow(state, "cancelled", {
    timestamp: options.timestamp,
    reason: options.reason ?? "Listening window cancelled.",
  });
}

export function destroyListeningWindow(
  state: EchoContextualListeningState,
  windowId: string,
  options: { timestamp?: string; reason?: string } = {},
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const target = state.windows.find((entry) => entry.id === windowId);
  if (!target) return withDiagnostics(state);
  const descendants = collectDescendantWindowIds(state.windows, windowId);
  const destroyedIds = new Set([windowId, ...descendants]);
  const parent = target.parentId
    ? state.windows.find((entry) => entry.id === target.parentId)
    : null;
  const resumedParent =
    parent && !TERMINAL_WINDOW_STATUSES.has(parent.status)
      ? transitionListeningWindow(parent, "resumed", {
          timestamp,
          reason: options.reason ?? "Parent listening window restored.",
        })
      : null;
  const windows = state.windows
    .filter((entry) => !destroyedIds.has(entry.id))
    .map((entry) => (entry.id === resumedParent?.id ? resumedParent : entry));
  return withDiagnostics({
    ...state,
    activeWindowId: resumedParent?.id ?? null,
    windows: pruneWindows(windows),
  });
}

export function expireListeningWindows(
  state: EchoContextualListeningState,
  timestamp = new Date().toISOString(),
): EchoContextualListeningState {
  const active = getActiveWindow(state);
  if (!active || !isWindowExpired(active, timestamp)) {
    return withDiagnostics(state);
  }
  const expired = transitionListeningWindow(active, "expired", {
    timestamp,
    reason: "Listening window timed out.",
  });
  const parent = expired.parentId
    ? state.windows.find((entry) => entry.id === expired.parentId)
    : null;
  const resumedParent =
    parent && !TERMINAL_WINDOW_STATUSES.has(parent.status)
      ? transitionListeningWindow(parent, "resumed", {
          timestamp,
          reason: "Parent listening window restored after timeout.",
        })
      : null;
  return withDiagnostics({
    ...state,
    activeWindowId: resumedParent?.id ?? null,
    lastExpiredWindowId: expired.id,
    windows: pruneWindows(
      state.windows.map((entry) => {
        if (entry.id === expired.id) return expired;
        if (entry.id === resumedParent?.id) return resumedParent;
        return entry;
      }),
    ),
  });
}

export function recoverListeningWindowStack(
  state: EchoContextualListeningState,
  options: {
    timestamp?: string;
    reason?: string;
    ambientMode?: AmbientGameplayMode;
  } = {},
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const active = getActiveWindow(state);
  if (!active) {
    return activateListeningWindow(
      state,
      deriveListeningWindowKindFromAmbientMode(
        options.ambientMode ?? "passive",
      ),
      {
        timestamp,
        source: "recovery",
        ambientMode: options.ambientMode,
        reason: options.reason ?? "Recovered to a safe listening window.",
      },
    );
  }
  const recovered = transitionListeningWindow(active, "recovered", {
    timestamp,
    reason: options.reason ?? "Listening window recovered safely.",
  });
  const parent = active.parentId
    ? state.windows.find((entry) => entry.id === active.parentId)
    : null;
  const resumedParent =
    parent && !TERMINAL_WINDOW_STATUSES.has(parent.status)
      ? transitionListeningWindow(parent, "resumed", {
          timestamp,
          reason: "Parent listening window restored after recovery.",
        })
      : null;
  return withDiagnostics({
    ...state,
    activeWindowId: resumedParent?.id ?? null,
    lastRecoveredWindowId: recovered.id,
    windows: pruneWindows(
      state.windows.map((entry) => {
        if (entry.id === recovered.id) return recovered;
        if (entry.id === resumedParent?.id) return resumedParent;
        return entry;
      }),
    ),
  });
}

export function syncContextualListeningWithAmbientMode(
  state: EchoContextualListeningState,
  options: {
    ambientMode: AmbientGameplayMode;
    timestamp?: string;
    source?: EchoListeningWindowActivationSource;
    timeoutMs?: number | null;
  },
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  if (options.ambientMode === "recovery") {
    return recoverListeningWindowStack(state, {
      timestamp,
      ambientMode: options.ambientMode,
      reason: "Ambient Gameplay entered recovery.",
    });
  }
  return activateListeningWindow(
    {
      ...state,
      sessionId: state.sessionId,
    },
    deriveListeningWindowKindFromAmbientMode(options.ambientMode),
    {
      timestamp,
      source: options.source ?? "ambient-mode",
      ambientMode: options.ambientMode,
      nested: false,
      timeoutMs:
        options.timeoutMs === undefined
          ? windowDefinitionForMode(options.ambientMode).defaultTimeoutMs
          : options.timeoutMs,
      reason: `Ambient Gameplay mode is ${options.ambientMode}.`,
    },
  );
}

export function deriveListeningWindowKindFromAmbientMode(
  mode: AmbientGameplayMode,
): EchoListeningWindowKind {
  if (mode === "combat") return "combatPreparation";
  if (mode === "resolution") return "triggerResolution";
  if (mode === "postTurn") return "endStep";
  return "generalGameplay";
}

export function getListeningWindowDefinition(
  kind: EchoListeningWindowKind,
): WindowDefinition {
  return {
    ...WINDOW_DEFINITIONS[kind],
    verbs: [...WINDOW_DEFINITIONS[kind].verbs],
    nouns: [...WINDOW_DEFINITIONS[kind].nouns],
    counterNames: [...(WINDOW_DEFINITIONS[kind].counterNames ?? [])],
    tokenTypes: [...(WINDOW_DEFINITIONS[kind].tokenTypes ?? [])],
    zones: [...(WINDOW_DEFINITIONS[kind].zones ?? [])],
    manaColors: [...(WINDOW_DEFINITIONS[kind].manaColors ?? [])],
    intentKinds: [...WINDOW_DEFINITIONS[kind].intentKinds],
    entityPriorities: WINDOW_DEFINITIONS[kind].entityPriorities.map(
      (entry) => ({ ...entry }),
    ),
    expectedActions: [...WINDOW_DEFINITIONS[kind].expectedActions],
  };
}

export function getActiveListeningWindow(
  state: EchoContextualListeningState,
): EchoListeningWindow | null {
  return getActiveWindow(state);
}

export function getActiveVocabulary(
  state: EchoContextualListeningState,
): EchoListeningWindowVocabulary | null {
  return getActiveWindow(state)?.vocabulary ?? null;
}

export function getEntityPrioritySignalsForWindow(
  window: EchoListeningWindow | null,
  field: GrammarField | FieldState,
): EchoContextualEntityPrioritySignal[] {
  if (!window) return [];
  const priorities = new Map(
    window.entityPriorities.map((entry) => [entry.kind, entry]),
  );
  const signals: EchoContextualEntityPrioritySignal[] = [];
  for (const group of field.groups) {
    for (const kind of kindsForGroup(group)) {
      const priorityEntry = priorities.get(kind);
      if (!priorityEntry) continue;
      signals.push({
        entityId: group.id,
        label: group.label,
        kind,
        weight: priorityEntry.weight,
        reason: priorityEntry.reason,
      });
    }
  }
  if (priorities.has("counter")) {
    const priorityEntry = priorities.get("counter")!;
    const counterNames = new Set<string>();
    for (const group of field.groups) {
      const counters =
        "counters" in group &&
        group.counters &&
        typeof group.counters === "object"
          ? group.counters
          : {};
      for (const [name, count] of Object.entries(counters)) {
        if (count > 0) counterNames.add(name);
      }
    }
    for (const counterName of counterNames) {
      signals.push({
        entityId: `counter:${counterName}`,
        label: counterName,
        kind: "counter",
        weight: priorityEntry.weight,
        reason: priorityEntry.reason,
      });
    }
  }
  if (priorities.has("player")) {
    const priorityEntry = priorities.get("player")!;
    signals.push({
      entityId: "player:you",
      label: "You",
      kind: "player",
      weight: priorityEntry.weight,
      reason: priorityEntry.reason,
    });
    signals.push({
      entityId: "player:opponent",
      label: "Opponent",
      kind: "player",
      weight: priorityEntry.weight * 0.84,
      reason: priorityEntry.reason,
    });
  }
  return signals.sort(
    (left, right) =>
      right.weight - left.weight || left.label.localeCompare(right.label),
  );
}

export function recognizeMagicCommandInWindow(
  input: EchoWindowedMagicCommandInput,
): EchoWindowedMagicCommandResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const grammarInput = input.window
    ? withWindowAmbientContext(input, input.window)
    : input;
  const grammar = recognizeMagicCommand(grammarInput);
  return applyListeningWindowToGrammarResult({
    grammar,
    window: input.window,
    field: input.field,
    timestamp,
  });
}

export function applyListeningWindowToGrammarResult(input: {
  grammar: EchoMagicCommandGrammarResult;
  window: EchoListeningWindow | null;
  field: GrammarField | FieldState;
  timestamp?: string;
}): EchoWindowedMagicCommandResult {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const window = input.window;
  const allowedIntentKinds = window?.allowedIntentKinds ?? [];
  const matchedIntentKind = input.grammar.intentKind;
  const restricted = Boolean(window);
  const intentAllowed =
    !window ||
    !matchedIntentKind ||
    window.allowedIntentKinds.includes(matchedIntentKind);
  const entityPrioritySignals = getEntityPrioritySignalsForWindow(
    window,
    input.field,
  );
  const status = statusForWindowedGrammar({
    grammar: input.grammar,
    intentAllowed,
  });
  const confidenceAdjustment = confidenceAdjustmentForWindow({
    grammar: input.grammar,
    window,
    intentAllowed,
    entityPrioritySignals,
  });
  const confidence = adjustConfidence(
    input.grammar.confidence,
    confidenceAdjustment,
    timestamp,
  );
  const accepted = status === "accepted";
  return {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    status,
    windowId: window?.id ?? null,
    windowKind: window?.kind ?? null,
    grammar: input.grammar,
    accepted,
    confidence,
    confidenceAdjustment,
    vocabulary: {
      allowedIntentKinds,
      matchedIntentKind,
      restricted,
    },
    entityPrioritySignals,
    recovery: {
      required:
        status === "window-mismatch" ||
        status === "rejected" ||
        status === "unknown",
      reason: recoveryReasonForStatus(status, input.grammar, window),
    },
    accessibilityAnnouncement: announcementForWindowedResult(
      status,
      input.grammar,
      window,
    ),
    directBattlefieldMutation: false,
  };
}

export function getContextualListeningDiagnostics(
  state: EchoContextualListeningState,
): EchoContextualListeningDiagnostics {
  return createDiagnostics({
    sessionId: state.sessionId,
    activeWindow: getActiveWindow(state),
    stackDepth: activeStackDepth(state),
    lastRecoveredWindowId: state.lastRecoveredWindowId,
    lastExpiredWindowId: state.lastExpiredWindowId,
    lastGrammarResultId: state.lastGrammarResultId,
    lastStatus: state.diagnostics.lastStatus,
    lastError: state.diagnostics.lastError,
    windowSwitchCount: state.diagnostics.windowSwitchCount,
  });
}

export class EchoContextualListeningManager {
  private state: EchoContextualListeningState;
  private settings: EchoContextualListeningSettings;
  private listeners = new Set<(state: EchoContextualListeningState) => void>();

  constructor(
    state: unknown = undefined,
    settings: unknown = undefined,
    options: {
      timestamp?: string;
      sessionId?: string | null;
      ambientMode?: AmbientGameplayMode;
    } = {},
  ) {
    this.settings = normalizeContextualListeningSettings(settings);
    this.state = normalizeContextualListeningState(state, {
      fallbackTimestamp: options.timestamp ?? new Date().toISOString(),
      sessionId: options.sessionId ?? null,
      ambientMode: options.ambientMode,
      defaultTimeoutMs: this.settings.defaultTimeoutMs,
      preserveWindowStackOnRestore: this.settings.preserveWindowStackOnRestore,
    });
  }

  hydrate(
    state: unknown,
    settings: unknown,
    options: {
      timestamp?: string;
      sessionId?: string | null;
      ambientMode?: AmbientGameplayMode;
    } = {},
  ): EchoContextualListeningState {
    this.settings = normalizeContextualListeningSettings(settings);
    this.state = normalizeContextualListeningState(state, {
      fallbackTimestamp: options.timestamp ?? new Date().toISOString(),
      sessionId: options.sessionId ?? null,
      ambientMode: options.ambientMode,
      defaultTimeoutMs: this.settings.defaultTimeoutMs,
      preserveWindowStackOnRestore: this.settings.preserveWindowStackOnRestore,
    });
    this.emit();
    return this.getState();
  }

  getState(): EchoContextualListeningState {
    return structuredClone(this.state);
  }

  getSettings(): EchoContextualListeningSettings {
    return { ...this.settings };
  }

  subscribe(
    listener: (state: EchoContextualListeningState) => void,
  ): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  activate(
    kind: EchoListeningWindowKind,
    options: Parameters<typeof activateListeningWindow>[2] = {},
  ): EchoContextualListeningState {
    this.state = activateListeningWindow(this.state, kind, options);
    this.emit();
    return this.getState();
  }

  syncWithAmbientMode(
    ambientMode: AmbientGameplayMode,
    timestamp = new Date().toISOString(),
  ): EchoContextualListeningState {
    this.state = syncContextualListeningWithAmbientMode(this.state, {
      ambientMode,
      timestamp,
    });
    this.emit();
    return this.getState();
  }

  expire(timestamp = new Date().toISOString()): EchoContextualListeningState {
    this.state = expireListeningWindows(this.state, timestamp);
    this.emit();
    return this.getState();
  }

  cancel(timestamp = new Date().toISOString()): EchoContextualListeningState {
    this.state = cancelActiveListeningWindow(this.state, { timestamp });
    this.emit();
    return this.getState();
  }

  recover(
    reason: string,
    ambientMode: AmbientGameplayMode,
    timestamp = new Date().toISOString(),
  ): EchoContextualListeningState {
    this.state = recoverListeningWindowStack(this.state, {
      timestamp,
      ambientMode,
      reason,
    });
    this.emit();
    return this.getState();
  }

  recognize(
    input: Omit<EchoWindowedMagicCommandInput, "window">,
  ): EchoWindowedMagicCommandResult {
    const result = recognizeMagicCommandInWindow({
      ...input,
      window: getActiveWindow(this.state),
    });
    this.state = withDiagnostics({
      ...this.state,
      lastGrammarResultId: result.grammar.resultId,
      diagnostics: {
        ...this.state.diagnostics,
        lastStatus: result.status,
        lastError: result.recovery.reason,
      },
    });
    this.emit();
    return result;
  }

  diagnostics(): EchoContextualListeningDiagnostics {
    return getContextualListeningDiagnostics(this.state);
  }

  dispose(): void {
    this.listeners.clear();
  }

  private emit(): void {
    const snapshot = this.getState();
    for (const listener of this.listeners) listener(snapshot);
  }
}

export const echoContextualListeningManager =
  new EchoContextualListeningManager();

function closeActiveWindow(
  state: EchoContextualListeningState,
  targetStatus: "completed" | "cancelled",
  options: { timestamp?: string; reason?: string },
): EchoContextualListeningState {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const active = getActiveWindow(state);
  if (!active) return withDiagnostics(state);
  const closed = transitionListeningWindow(active, targetStatus, {
    timestamp,
    reason: options.reason,
  });
  const parent = closed.parentId
    ? state.windows.find((entry) => entry.id === closed.parentId)
    : null;
  const resumedParent =
    parent && !TERMINAL_WINDOW_STATUSES.has(parent.status)
      ? transitionListeningWindow(parent, "resumed", {
          timestamp,
          reason: "Nested listening window closed; parent restored.",
        })
      : null;
  return withDiagnostics({
    ...state,
    activeWindowId: resumedParent?.id ?? null,
    windows: pruneWindows(
      state.windows.map((entry) => {
        if (entry.id === closed.id) return closed;
        if (entry.id === resumedParent?.id) return resumedParent;
        return entry;
      }),
    ),
  });
}

function statusForWindowedGrammar(input: {
  grammar: EchoMagicCommandGrammarResult;
  intentAllowed: boolean;
}): EchoWindowedMagicCommandStatus {
  if (input.grammar.status === "disabled") return "disabled";
  if (input.grammar.status === "rejected") return "rejected";
  if (input.grammar.status === "unknown") return "unknown";
  if (input.grammar.status === "incomplete") return "incomplete";
  if (!input.intentAllowed) return "window-mismatch";
  if (input.grammar.status === "ambiguous") return "ambiguous";
  return "accepted";
}

function confidenceAdjustmentForWindow(input: {
  grammar: EchoMagicCommandGrammarResult;
  window: EchoListeningWindow | null;
  intentAllowed: boolean;
  entityPrioritySignals: EchoContextualEntityPrioritySignal[];
}): EchoWindowedMagicCommandResult["confidenceAdjustment"] {
  if (!input.window) {
    return {
      level: input.grammar.confidence.level,
      scoreDelta: 0,
      reasons: [],
    };
  }
  if (!input.intentAllowed) {
    return {
      level: downgradeConfidence(input.grammar.confidence.level),
      scoreDelta: -0.25,
      reasons: [
        `${windowLabel(input.window.kind)} window does not expect ${input.grammar.intentKind ?? "this"} commands.`,
      ],
    };
  }
  if (
    input.grammar.status !== "recognized" &&
    input.grammar.status !== "ambiguous"
  ) {
    return {
      level: input.grammar.confidence.level,
      scoreDelta: 0,
      reasons: ["Listening window could not improve an unrecognized command."],
    };
  }
  const objectKind = input.grammar.primaryObject?.kind ?? null;
  const primaryPriority = input.window.entityPriorities.find(
    (entry) => entry.kind === objectKind,
  );
  const exactIntent = Boolean(
    input.grammar.intentKind &&
    input.window.allowedIntentKinds.includes(input.grammar.intentKind),
  );
  const scoreDelta = roundScore(
    Math.min(0.1, (primaryPriority?.weight ?? 0.2) * 0.1),
  );
  const level =
    exactIntent &&
    input.grammar.confidence.level === "medium" &&
    (primaryPriority || input.window.kind !== "generalGameplay")
      ? "high"
      : input.grammar.confidence.level;
  return {
    level,
    scoreDelta,
    reasons: [
      `${windowLabel(input.window.kind)} window matched expected command context.`,
      ...(primaryPriority ? [primaryPriority.reason] : []),
      ...(input.entityPrioritySignals.length
        ? ["Relevant battlefield entities were prioritized for recognition."]
        : []),
    ],
  };
}

function adjustConfidence(
  confidence: AmbientConfidenceAssessment,
  adjustment: EchoWindowedMagicCommandResult["confidenceAdjustment"],
  timestamp: string,
): AmbientConfidenceAssessment {
  const score =
    confidence.score === null
      ? null
      : roundScore(
          Math.max(0, Math.min(1, confidence.score + adjustment.scoreDelta)),
        );
  return normalizeAmbientConfidence(
    {
      ...confidence,
      level: adjustment.level,
      score,
      assessedAt: timestamp,
      reasons: [...confidence.reasons, ...adjustment.reasons].slice(0, 8),
      validation: {
        ...confidence.validation,
        warningCount:
          confidence.validation.warningCount +
          (adjustment.scoreDelta < 0 ? 1 : 0),
      },
    },
    {
      source: confidence.source,
      timestamp,
      contextValid: confidence.validation.contextValid,
      rulesValid: confidence.validation.rulesValid,
      warningCount: confidence.validation.warningCount,
    },
  );
}

function withWindowAmbientContext(
  input: EchoWindowedMagicCommandInput,
  window: EchoListeningWindow,
): EchoMagicCommandGrammarInput {
  const preferred = WINDOW_DEFINITIONS[window.kind].preferredAmbientMode;
  return {
    ...input,
    field: {
      ...input.field,
      ambient: { currentMode: preferred },
    },
  };
}

function kindsForGroup(
  group: GrammarField["groups"][number] | FieldState["groups"][number],
): EchoMagicCommandObjectKind[] {
  const kinds: EchoMagicCommandObjectKind[] = ["battlefield-object"];
  const cardTypes = new Set(group.characteristics.cardTypes);
  if (cardTypes.has("Land")) kinds.push("land");
  if (group.characteristics.isToken) kinds.push("token");
  if (group.characteristics.isLegendary && group.characteristics.isCreature) {
    kinds.push("commander");
  }
  if (group.identity) kinds.push("card");
  return kinds;
}

function windowDefinitionForMode(mode: AmbientGameplayMode): WindowDefinition {
  return WINDOW_DEFINITIONS[deriveListeningWindowKindFromAmbientMode(mode)];
}

function getActiveWindow(
  state: EchoContextualListeningState,
): EchoListeningWindow | null {
  if (!state.activeWindowId) return null;
  return (
    state.windows.find((entry) => entry.id === state.activeWindowId) ?? null
  );
}

function withDiagnostics(
  state: EchoContextualListeningState,
): EchoContextualListeningState {
  return {
    ...state,
    windows: pruneWindows(state.windows),
    diagnostics: createDiagnostics({
      sessionId: state.sessionId,
      activeWindow: getActiveWindow(state),
      stackDepth: activeStackDepth(state),
      lastRecoveredWindowId: state.lastRecoveredWindowId,
      lastExpiredWindowId: state.lastExpiredWindowId,
      lastGrammarResultId: state.lastGrammarResultId,
      lastStatus: state.diagnostics?.lastStatus ?? null,
      lastError: state.diagnostics?.lastError ?? null,
      windowSwitchCount: state.diagnostics?.windowSwitchCount ?? 0,
    }),
  };
}

function createDiagnostics(input: {
  sessionId: string | null;
  activeWindow: EchoListeningWindow | null;
  stackDepth: number;
  lastRecoveredWindowId: string | null;
  lastExpiredWindowId: string | null;
  lastGrammarResultId: string | null;
  lastStatus: EchoWindowedMagicCommandResult["status"] | null;
  lastError: string | null;
  windowSwitchCount: number;
}): EchoContextualListeningDiagnostics {
  return {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    sessionId: input.sessionId,
    activeWindowId: input.activeWindow?.id ?? null,
    activeWindowKind: input.activeWindow?.kind ?? null,
    activeWindowStatus: input.activeWindow?.status ?? null,
    stackDepth: input.stackDepth,
    lastRecoveredWindowId: input.lastRecoveredWindowId,
    lastExpiredWindowId: input.lastExpiredWindowId,
    lastGrammarResultId: input.lastGrammarResultId,
    lastStatus: input.lastStatus,
    lastError: input.lastError,
    windowSwitchCount: input.windowSwitchCount,
    grammarConstrained: Boolean(input.activeWindow),
  };
}

function activeStackDepth(state: EchoContextualListeningState): number {
  const active = getActiveWindow(state);
  return active ? active.depth + 1 : 0;
}

function normalizeListeningWindow(
  value: unknown,
  options: { fallbackTimestamp: string; ambientMode: AmbientGameplayMode },
): EchoListeningWindow | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoListeningWindow>;
  const kind = normalizeWindowKind(candidate.kind);
  if (!kind) return null;
  const definition = WINDOW_DEFINITIONS[kind];
  const status = normalizeWindowStatus(candidate.status);
  const createdAt =
    typeof candidate.createdAt === "string"
      ? candidate.createdAt
      : options.fallbackTimestamp;
  const updatedAt =
    typeof candidate.updatedAt === "string"
      ? candidate.updatedAt
      : options.fallbackTimestamp;
  return {
    version: ECHO_CONTEXTUAL_LISTENING_VERSION,
    id:
      typeof candidate.id === "string"
        ? candidate.id
        : makeId("listening-window"),
    kind,
    status,
    source: normalizeActivationSource(candidate.source),
    parentId: sanitizeNullableText(candidate.parentId),
    depth: clampCount(candidate.depth, 0, 0, DEFAULT_MAX_DEPTH),
    ambientMode: normalizeAmbientMode(
      candidate.ambientMode,
      options.ambientMode,
    ),
    createdAt,
    updatedAt,
    activatedAt:
      typeof candidate.activatedAt === "string" ? candidate.activatedAt : null,
    expiresAt:
      typeof candidate.expiresAt === "string" ? candidate.expiresAt : null,
    vocabulary: normalizeVocabulary(candidate.vocabulary, definition),
    entityPriorities: normalizeEntityPriorities(
      candidate.entityPriorities,
      definition.entityPriorities,
    ),
    allowedIntentKinds: normalizeIntentKinds(
      candidate.allowedIntentKinds,
      definition.intentKinds,
    ),
    expectedActions: normalizeStringList(
      candidate.expectedActions,
      definition.expectedActions,
    ),
    accessibilityLabel: sanitizeText(
      candidate.accessibilityLabel,
      `${definition.label} listening window`,
    ),
    lifecycle: normalizeLifecycle(candidate.lifecycle, {
      status,
      timestamp: updatedAt,
    }),
  };
}

function normalizeVocabulary(
  value: unknown,
  definition: WindowDefinition,
): EchoListeningWindowVocabulary {
  const defaults = createVocabulary(definition);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoListeningWindowVocabulary>;
  return {
    verbs: normalizeStringList(candidate.verbs, defaults.verbs),
    nouns: normalizeStringList(candidate.nouns, defaults.nouns),
    counterNames: normalizeStringList(
      candidate.counterNames,
      defaults.counterNames,
    ),
    tokenTypes: normalizeStringList(candidate.tokenTypes, defaults.tokenTypes),
    zones: normalizeStringList(candidate.zones, defaults.zones),
    manaColors: normalizeStringList(candidate.manaColors, defaults.manaColors),
    intentKinds: normalizeIntentKinds(
      candidate.intentKinds,
      defaults.intentKinds,
    ),
  };
}

function normalizeEntityPriorities(
  value: unknown,
  defaults: EchoListeningWindowEntityPriority[],
): EchoListeningWindowEntityPriority[] {
  if (!Array.isArray(value)) return defaults.map((entry) => ({ ...entry }));
  const normalized = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<EchoListeningWindowEntityPriority>;
      const kind = normalizeObjectKind(candidate.kind);
      if (!kind) return null;
      return {
        kind,
        weight: clampScore(candidate.weight, 0.5),
        reason: sanitizeText(candidate.reason, "Contextual entity priority."),
      };
    })
    .filter((entry): entry is EchoListeningWindowEntityPriority =>
      Boolean(entry),
    );
  return normalized.length
    ? normalized
    : defaults.map((entry) => ({ ...entry }));
}

function normalizeLifecycle(
  value: unknown,
  fallback: {
    status: EchoListeningWindowLifecycleStatus;
    timestamp: string;
  },
): EchoListeningWindowLifecycleRecord[] {
  if (!Array.isArray(value)) {
    return createLifecycle(fallback.status, fallback.timestamp);
  }
  const records = value
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const candidate = entry as Partial<EchoListeningWindowLifecycleRecord>;
      return {
        status: normalizeWindowStatus(candidate.status),
        timestamp:
          typeof candidate.timestamp === "string"
            ? candidate.timestamp
            : fallback.timestamp,
        reason: sanitizeText(candidate.reason, "Listening window lifecycle."),
      };
    })
    .filter((entry): entry is EchoListeningWindowLifecycleRecord =>
      Boolean(entry),
    )
    .slice(-20);
  return records.length
    ? records
    : createLifecycle(fallback.status, fallback.timestamp);
}

function createVocabulary(
  definition: WindowDefinition,
): EchoListeningWindowVocabulary {
  return {
    verbs: [...definition.verbs],
    nouns: [...definition.nouns],
    counterNames: [...(definition.counterNames ?? [])],
    tokenTypes: [...(definition.tokenTypes ?? [])],
    zones: [...(definition.zones ?? [])],
    manaColors: [...(definition.manaColors ?? [])],
    intentKinds: [...definition.intentKinds],
  };
}

function createLifecycle(
  status: EchoListeningWindowLifecycleStatus,
  timestamp: string,
  reason = "Listening window created.",
): EchoListeningWindowLifecycleRecord[] {
  return [{ status, timestamp, reason: reason.slice(0, 240) }];
}

function priority(
  kind: EchoMagicCommandObjectKind,
  weight: number,
  reason: string,
): EchoListeningWindowEntityPriority {
  return { kind, weight: clampScore(weight, 0.5), reason };
}

function pruneWindows(windows: EchoListeningWindow[]): EchoListeningWindow[] {
  const live = windows.filter(
    (entry) => !TERMINAL_WINDOW_STATUSES.has(entry.status),
  );
  const terminal = windows
    .filter((entry) => TERMINAL_WINDOW_STATUSES.has(entry.status))
    .slice(-12);
  const retained = [...live, ...terminal].filter(
    (entry, index, all) =>
      all.findIndex((candidate) => candidate.id === entry.id) === index,
  );
  return retained.sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt),
  );
}

function collectDescendantWindowIds(
  windows: EchoListeningWindow[],
  parentId: string,
): string[] {
  const direct = windows.filter((entry) => entry.parentId === parentId);
  return direct.flatMap((entry) => [
    entry.id,
    ...collectDescendantWindowIds(windows, entry.id),
  ]);
}

function isWindowExpired(
  window: EchoListeningWindow,
  timestamp: string,
): boolean {
  return Boolean(window.expiresAt && window.expiresAt <= timestamp);
}

function recoveryReasonForStatus(
  status: EchoWindowedMagicCommandStatus,
  grammar: EchoMagicCommandGrammarResult,
  window: EchoListeningWindow | null,
): string | null {
  if (
    status === "accepted" ||
    status === "ambiguous" ||
    status === "incomplete"
  ) {
    return grammar.recovery.message;
  }
  if (status === "window-mismatch") {
    return `${window?.accessibilityLabel ?? "Active listening window"} does not expect ${grammar.intentKind ?? "this command"}.`;
  }
  return grammar.recovery.message ?? grammar.errors[0] ?? null;
}

function announcementForWindowedResult(
  status: EchoWindowedMagicCommandStatus,
  grammar: EchoMagicCommandGrammarResult,
  window: EchoListeningWindow | null,
): string {
  if (status === "accepted") {
    return `${grammar.accessibilityAnnouncement} ${windowLabel(window?.kind ?? "generalGameplay")} context matched.`;
  }
  if (status === "window-mismatch") {
    return `${windowLabel(window?.kind ?? "generalGameplay")} context did not match the command.`;
  }
  return grammar.accessibilityAnnouncement;
}

function downgradeConfidence(
  level: AmbientConfidenceLevel,
): AmbientConfidenceLevel {
  if (level === "high") return "low";
  if (level === "medium") return "low";
  return level;
}

function normalizeWindowKind(value: unknown): EchoListeningWindowKind | null {
  return typeof value === "string" &&
    ECHO_LISTENING_WINDOW_KINDS.includes(value as EchoListeningWindowKind)
    ? (value as EchoListeningWindowKind)
    : null;
}

function normalizeWindowStatus(
  value: unknown,
): EchoListeningWindowLifecycleStatus {
  if (
    value === "activated" ||
    value === "updated" ||
    value === "suspended" ||
    value === "resumed" ||
    value === "expired" ||
    value === "cancelled" ||
    value === "completed" ||
    value === "recovered" ||
    value === "destroyed"
  ) {
    return value;
  }
  return "created";
}

function normalizeActivationSource(
  value: unknown,
): EchoListeningWindowActivationSource {
  if (
    value === "ambient-mode" ||
    value === "phase" ||
    value === "planner" ||
    value === "action-strip" ||
    value === "explicit-command" ||
    value === "recovery" ||
    value === "session-restoration"
  ) {
    return value;
  }
  return "system";
}

function normalizeAmbientMode(
  value: unknown,
  fallback: AmbientGameplayMode,
): AmbientGameplayMode {
  if (
    value === "passive" ||
    value === "preTurnPreparation" ||
    value === "activeTurn" ||
    value === "combat" ||
    value === "resolution" ||
    value === "recovery" ||
    value === "postTurn"
  ) {
    return value;
  }
  return fallback;
}

function normalizeObjectKind(
  value: unknown,
): EchoMagicCommandObjectKind | null {
  if (
    value === "battlefield-object" ||
    value === "card" ||
    value === "commander" ||
    value === "token" ||
    value === "player" ||
    value === "counter" ||
    value === "zone" ||
    value === "land" ||
    value === "mana" ||
    value === "mechanic" ||
    value === "unknown"
  ) {
    return value;
  }
  return null;
}

function normalizeIntentKinds(
  value: unknown,
  fallback: AmbientIntentKind[],
): AmbientIntentKind[] {
  const known = new Set<AmbientIntentKind>([
    "play-land",
    "cast-spell",
    "attack",
    "block",
    "create-token",
    "destroy-permanent",
    "sacrifice-permanent",
    "tap",
    "untap",
    "add-counters",
    "remove-counters",
    "add-mana",
    "end-turn",
    "pass-priority",
    "draw-cards",
    "discard-cards",
    "return-permanent",
    "exile-permanent",
    "modify-life",
    "modify-commander-damage",
    "counter-spell",
    "hold-priority",
    "activate-ability",
    "equip",
    "attach",
    "transform-permanent",
    "explore",
    "surveil",
    "mill-cards",
    "manual-correction",
    "custom",
  ]);
  const normalized = Array.isArray(value)
    ? value.filter((entry): entry is AmbientIntentKind =>
        known.has(entry as AmbientIntentKind),
      )
    : [];
  return normalized.length ? [...new Set(normalized)] : [...fallback];
}

function normalizeStringList(value: unknown, fallback: string[]): string[] {
  const normalized = Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => sanitizeText(entry, ""))
        .filter(Boolean)
    : [];
  return normalized.length ? [...new Set(normalized)] : [...fallback];
}

function sanitizeText(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  return (
    value
      .replace(/[<>{}`]/g, "")
      .trim()
      .slice(0, 240) || fallback
  );
}

function sanitizeNullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 160)
    : null;
}

function clampMilliseconds(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(300_000, Math.max(2_000, Math.trunc(value)))
    : fallback;
}

function clampCount(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(max, Math.max(min, Math.trunc(value)))
    : fallback;
}

function clampScore(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? roundScore(Math.min(1, Math.max(0, value)))
    : fallback;
}

function addMilliseconds(timestamp: string, milliseconds: number): string {
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return new Date().toISOString();
  return new Date(time + milliseconds).toISOString();
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function windowLabel(kind: EchoListeningWindowKind): string {
  return WINDOW_DEFINITIONS[kind].label;
}
