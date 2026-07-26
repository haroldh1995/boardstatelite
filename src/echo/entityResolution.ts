import { COUNTER_OPTIONS } from "../domain/cards";
import type {
  CardIdentity,
  FieldState,
  PermanentGroup,
  Zone,
} from "../domain/types";
import { resolveAmbientEntities } from "./ambientEventPipeline";
import type { AmbientConfidenceLevel } from "./ambientConfidenceTypes";
import type {
  AmbientEntityReference,
  AmbientEntityResolver,
  AmbientIntent,
} from "./ambientEventTypes";
import {
  ECHO_ENTITY_RESOLUTION_CACHE_LIMIT,
  ECHO_ENTITY_RESOLUTION_VERSION,
  type EchoBattlefieldContext,
  type EchoBattlefieldContextEntity,
  type EchoContextReference,
  type EchoDeckSnapshotCard,
  type EchoEntityKind,
  type EchoEntityRelationship,
  type EchoEntityResolutionAmbiguity,
  type EchoEntityResolutionCandidate,
  type EchoEntityResolutionDiagnostics,
  type EchoEntityResolutionFallbackRequest,
  type EchoEntityResolutionPriority,
  type EchoEntityResolutionRequest,
  type EchoEntityResolutionResult,
  type EchoEntityResolutionSettings,
  type EchoEntityResolutionState,
  type EchoRecentlyResolvedEntity,
} from "./entityResolutionTypes";
import { applyPronunciationLearningToResolutionResult } from "./pronunciationLearning";

const PRIORITY_RANK: Record<EchoEntityResolutionPriority, number> = {
  battlefield: 900,
  tracked: 850,
  planner: 760,
  actionStrip: 720,
  recent: 660,
  deckSnapshot: 560,
  localCache: 500,
  scryfall: 380,
  fuzzy: 260,
};

const GROUP_TYPE_KIND: Array<{
  kind: EchoEntityKind;
  cardType?: string;
  subtype?: string;
}> = [
  { kind: "creature", cardType: "Creature" },
  { kind: "land", cardType: "Land" },
  { kind: "artifact", cardType: "Artifact" },
  { kind: "enchantment", cardType: "Enchantment" },
  { kind: "planeswalker", cardType: "Planeswalker" },
  { kind: "battle", cardType: "Battle" },
  { kind: "token" },
  { kind: "tokenStack" },
  { kind: "commander" },
  { kind: "permanent" },
];

const BASIC_LANDS = new Set([
  "plains",
  "island",
  "swamp",
  "mountain",
  "forest",
  "wastes",
]);

const ZONE_ALIASES: Record<string, Zone> = {
  hand: "hand",
  battlefield: "battlefield",
  graveyard: "graveyard",
  yard: "graveyard",
  exile: "exile",
  library: "library",
  deck: "library",
  command: "command",
  commandzone: "command",
  commandzonecard: "command",
};

const MANA_ALIASES = new Set([
  "white",
  "blue",
  "black",
  "red",
  "green",
  "colorless",
  "generic",
  "w",
  "u",
  "b",
  "r",
  "g",
  "c",
]);

const PLAYER_ALIASES: Record<string, "you" | "opponent"> = {
  me: "you",
  myself: "you",
  my: "you",
  you: "you",
  self: "you",
  opponent: "opponent",
  opponents: "opponent",
  them: "opponent",
};

const LOW_CONFIDENCE_THRESHOLD = 0.42;
const MEDIUM_CONFIDENCE_THRESHOLD = 0.68;
const HIGH_CONFIDENCE_THRESHOLD = 0.86;
const SAFE_SELECTION_MARGIN = 0.09;

export function createDefaultEntityResolutionSettings(
  input: Partial<EchoEntityResolutionSettings> = {},
): EchoEntityResolutionSettings {
  return {
    version: ECHO_ENTITY_RESOLUTION_VERSION,
    diagnosticsEnabled: false,
    cacheManagementPrepared: true,
    resolutionResetPrepared: true,
    localCacheSize: ECHO_ENTITY_RESOLUTION_CACHE_LIMIT,
    scryfallFallbackEnabled: true,
    fuzzySearchEnabled: true,
    lastResetAt: null,
    ...input,
  };
}

export function normalizeEntityResolutionSettings(
  value: unknown,
): EchoEntityResolutionSettings {
  const defaults = createDefaultEntityResolutionSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<EchoEntityResolutionSettings>;
  return {
    ...defaults,
    diagnosticsEnabled: Boolean(candidate.diagnosticsEnabled),
    cacheManagementPrepared: true,
    resolutionResetPrepared: true,
    localCacheSize: clampNumber(
      candidate.localCacheSize,
      50,
      5000,
      defaults.localCacheSize,
    ),
    scryfallFallbackEnabled:
      candidate.scryfallFallbackEnabled === undefined
        ? defaults.scryfallFallbackEnabled
        : Boolean(candidate.scryfallFallbackEnabled),
    fuzzySearchEnabled:
      candidate.fuzzySearchEnabled === undefined
        ? defaults.fuzzySearchEnabled
        : Boolean(candidate.fuzzySearchEnabled),
    lastResetAt:
      typeof candidate.lastResetAt === "string" ? candidate.lastResetAt : null,
  };
}

export function createDefaultEntityResolutionState(
  input: Partial<EchoEntityResolutionState> = {},
): EchoEntityResolutionState {
  const diagnostics =
    input.diagnostics ?? createEntityResolutionDiagnostics(null);
  return {
    version: ECHO_ENTITY_RESOLUTION_VERSION,
    recentlyResolved: [],
    frequentlyReferenced: {},
    localCache: [],
    ...input,
    diagnostics: {
      ...createEntityResolutionDiagnostics(null),
      ...diagnostics,
      directBattlefieldMutation: false,
    },
  };
}

export function normalizeEntityResolutionState(
  value: unknown,
  options: {
    fallbackTimestamp?: string;
    settings?: EchoEntityResolutionSettings;
    knownGroupIds?: string[];
  } = {},
): EchoEntityResolutionState {
  const settings = normalizeEntityResolutionSettings(options.settings);
  if (!value || typeof value !== "object") {
    return createDefaultEntityResolutionState();
  }
  const candidate = value as Partial<EchoEntityResolutionState>;
  const knownGroupIds = new Set(options.knownGroupIds ?? []);
  const recentlyResolved = Array.isArray(candidate.recentlyResolved)
    ? candidate.recentlyResolved
        .map((entry) => normalizeRecentEntity(entry, options.fallbackTimestamp))
        .filter(
          (entry): entry is EchoRecentlyResolvedEntity =>
            entry !== null &&
            (!entry.groupId ||
              !knownGroupIds.size ||
              knownGroupIds.has(entry.groupId)),
        )
        .slice(0, settings.localCacheSize)
    : [];
  const localCache = Array.isArray(candidate.localCache)
    ? candidate.localCache
        .map((entry) => normalizeCandidate(entry))
        .filter(
          (entry): entry is EchoEntityResolutionCandidate =>
            entry !== null &&
            (!entry.groupId ||
              !knownGroupIds.size ||
              knownGroupIds.has(entry.groupId)),
        )
        .slice(0, settings.localCacheSize)
    : [];
  const frequentlyReferenced =
    candidate.frequentlyReferenced &&
    typeof candidate.frequentlyReferenced === "object"
      ? Object.fromEntries(
          Object.entries(candidate.frequentlyReferenced)
            .filter(([, count]) => typeof count === "number" && count > 0)
            .slice(0, settings.localCacheSize),
        )
      : {};
  return createDefaultEntityResolutionState({
    recentlyResolved,
    frequentlyReferenced,
    localCache,
    diagnostics: {
      ...createEntityResolutionDiagnostics(null),
      ...(candidate.diagnostics && typeof candidate.diagnostics === "object"
        ? candidate.diagnostics
        : {}),
      cacheSize: localCache.length,
      directBattlefieldMutation: false,
    },
  });
}

export function createBattlefieldContext(
  field: FieldState,
  options: { timestamp?: string } = {},
): EchoBattlefieldContext {
  const createdAt = options.timestamp ?? new Date().toISOString();
  const activeWindow = field.contextualListening.windows.find(
    (window) => window.id === field.contextualListening.activeWindowId,
  );
  const battlefield = field.groups
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .map(contextEntityFromGroup);
  const plannerReferences = createPlannerReferences(field);
  const actionStripReferences = createActionStripReferences(field);
  const recentReferences = createRecentReferences(field);
  const relationships = createEntityRelationships(field);
  return {
    version: ECHO_ENTITY_RESOLUTION_VERSION,
    createdAt,
    fieldId: field.id,
    sessionId: field.session.id,
    ambientMode: field.ambient.currentMode,
    currentPhase: field.ambient.context?.observedTurn?.phase ?? null,
    currentTurn: field.ambient.context?.observedTurn?.activeController ?? null,
    activeWindowKind: activeWindow?.kind ?? null,
    battlefield,
    plannerReferences,
    actionStripReferences,
    recentReferences,
    relationships,
    diagnostics: {
      battlefieldObjectCount: battlefield.length,
      plannerReferenceCount: plannerReferences.length,
      actionStripReferenceCount: actionStripReferences.length,
      recentReferenceCount: recentReferences.length,
      relationshipCount: relationships.length,
      directBattlefieldMutation: false,
    },
  };
}

export function resolveEchoEntity(
  request: EchoEntityResolutionRequest,
): EchoEntityResolutionResult {
  return resolveEntityInternal(request, []);
}

export async function resolveEchoEntityWithFallback(
  request: EchoEntityResolutionFallbackRequest,
): Promise<EchoEntityResolutionResult> {
  const settings = normalizeEntityResolutionSettings(request.settings);
  const localResult = resolveEchoEntity({ ...request, settings });
  if (
    !shouldUseExternalFallback(localResult, settings, request.scryfallSearch)
  ) {
    return localResult;
  }
  try {
    const cards = await request.scryfallSearch!(request.text);
    const externalCandidates = cards
      .slice(0, 8)
      .map((card, index) =>
        cardCandidate({
          card,
          text: request.text,
          priority: "scryfall",
          source: "scryfall",
          index,
        }),
      )
      .filter((candidate) => candidate.score >= LOW_CONFIDENCE_THRESHOLD);
    const result = resolveEntityInternal(request, externalCandidates, {
      scryfallFallbackAttempted: true,
      scryfallFallbackReason: "No confident local entity matched.",
    });
    return result;
  } catch {
    return {
      ...localResult,
      diagnostics: {
        ...localResult.diagnostics,
        scryfallFallbackAttempted: true,
        scryfallFallbackReason: "Scryfall fallback failed safely.",
      },
    };
  }
}

export function createEntityResolutionAmbientResolver(
  options: {
    expectedKinds?: EchoEntityKind[];
    recentEntityIds?: string[];
    deckSnapshot?: EchoDeckSnapshotCard[];
    cachedCards?: CardIdentity[];
    settings?: EchoEntityResolutionSettings;
  } = {},
): AmbientEntityResolver {
  return (field, intent) => {
    const base = resolveAmbientEntities(field, intent);
    const inferred = inferEntityTextsFromIntent(intent).flatMap((entry) => {
      const result = resolveEchoEntity({
        field,
        intent,
        text: entry.text,
        role: entry.role,
        expectedKinds: options.expectedKinds,
        recentEntityIds: options.recentEntityIds,
        deckSnapshot: options.deckSnapshot,
        cachedCards: options.cachedCards,
        settings: options.settings,
      });
      return result.resolvedEntities;
    });
    const references = dedupeEntityReferences([
      ...base.map((entity) => entity.reference),
      ...inferred,
    ]);
    return resolveAmbientEntities(field, {
      ...intent,
      entities: references,
    });
  };
}

export function recordResolvedEntity(
  state: EchoEntityResolutionState,
  result: EchoEntityResolutionResult,
  options: {
    timestamp?: string;
    settings?: EchoEntityResolutionSettings;
  } = {},
): EchoEntityResolutionState {
  const settings = normalizeEntityResolutionSettings(options.settings);
  const selected = result.selected;
  const timestamp = options.timestamp ?? result.context.createdAt;
  if (!selected) {
    return {
      ...state,
      diagnostics: result.diagnostics,
    };
  }
  const existing = state.recentlyResolved.find(
    (entry) => entry.id === selected.id,
  );
  const recent: EchoRecentlyResolvedEntity = {
    id: selected.id,
    label: selected.label,
    normalizedLabel: selected.normalizedLabel,
    kind: selected.kind,
    groupId: selected.groupId,
    cardId: selected.cardId,
    lastResolvedAt: timestamp,
    count: (existing?.count ?? 0) + 1,
  };
  const recentList = [
    recent,
    ...state.recentlyResolved.filter((entry) => entry.id !== selected.id),
  ].slice(0, settings.localCacheSize);
  const cache = [
    selected,
    ...state.localCache.filter((entry) => entry.id !== selected.id),
  ].slice(0, settings.localCacheSize);
  return normalizeEntityResolutionState(
    {
      ...state,
      recentlyResolved: recentList,
      localCache: cache,
      frequentlyReferenced: {
        ...state.frequentlyReferenced,
        [selected.id]: recent.count,
      },
      diagnostics: {
        ...result.diagnostics,
        cacheSize: cache.length,
      },
    },
    { settings },
  );
}

export class EchoEntityResolutionEngine {
  private state: EchoEntityResolutionState;
  private settings: EchoEntityResolutionSettings;

  constructor(
    options: {
      state?: EchoEntityResolutionState;
      settings?: EchoEntityResolutionSettings;
    } = {},
  ) {
    this.settings = normalizeEntityResolutionSettings(options.settings);
    this.state = normalizeEntityResolutionState(options.state, {
      settings: this.settings,
    });
  }

  hydrate(input: {
    state?: EchoEntityResolutionState;
    settings?: EchoEntityResolutionSettings;
  }): void {
    this.settings = normalizeEntityResolutionSettings(input.settings);
    this.state = normalizeEntityResolutionState(input.state, {
      settings: this.settings,
    });
  }

  resolve(request: Omit<EchoEntityResolutionRequest, "settings">) {
    const result = resolveEchoEntity({
      ...request,
      settings: this.settings,
      cachedCards: [
        ...(request.cachedCards ?? []),
        ...this.state.localCache
          .map((candidate) =>
            candidate.cardId
              ? ({
                  cardId: candidate.cardId,
                  name: candidate.label,
                  typeLine: "",
                  oracleText: "",
                } as CardIdentity)
              : null,
          )
          .filter((entry): entry is CardIdentity => Boolean(entry)),
      ],
    });
    this.state = recordResolvedEntity(this.state, result, {
      settings: this.settings,
    });
    return result;
  }

  async resolveWithFallback(
    request: Omit<EchoEntityResolutionFallbackRequest, "settings">,
  ) {
    const result = await resolveEchoEntityWithFallback({
      ...request,
      settings: this.settings,
      cachedCards: request.cachedCards,
    });
    this.state = recordResolvedEntity(this.state, result, {
      settings: this.settings,
    });
    return result;
  }

  context(field: FieldState): EchoBattlefieldContext {
    return createBattlefieldContext(field);
  }

  remember(result: EchoEntityResolutionResult): EchoEntityResolutionState {
    this.state = recordResolvedEntity(this.state, result, {
      settings: this.settings,
    });
    return this.getState();
  }

  reset(timestamp = new Date().toISOString()): EchoEntityResolutionState {
    this.state = createDefaultEntityResolutionState({
      diagnostics: createEntityResolutionDiagnostics(null),
    });
    this.settings = {
      ...this.settings,
      lastResetAt: timestamp,
    };
    return this.getState();
  }

  getState(): EchoEntityResolutionState {
    return structuredClone(this.state);
  }

  diagnostics(): EchoEntityResolutionDiagnostics {
    return { ...this.state.diagnostics };
  }
}

export const echoEntityResolutionEngine = new EchoEntityResolutionEngine();

function resolveEntityInternal(
  request: EchoEntityResolutionRequest,
  externalCandidates: EchoEntityResolutionCandidate[] = [],
  diagnosticsPatch: Partial<EchoEntityResolutionDiagnostics> = {},
): EchoEntityResolutionResult {
  const settings = normalizeEntityResolutionSettings(request.settings);
  const timestamp = request.timestamp ?? new Date().toISOString();
  const context = createBattlefieldContext(request.field, { timestamp });
  const normalizedText = normalizeEntityText(request.text);
  const expectedKinds = new Set(request.expectedKinds ?? []);
  if (!normalizedText) {
    return createResolutionResult({
      request,
      context,
      candidates: [],
      ambiguities: [
        {
          type: "missing-entity",
          message: "No entity reference was provided.",
          candidates: [],
        },
      ],
      diagnosticsPatch,
    });
  }
  const candidates = rankEntityCandidates(
    dedupeCandidates([
      ...battlefieldCandidates(request, context),
      ...plannerCandidates(request, context),
      ...actionStripCandidates(request, context),
      ...recentCandidates(request, context),
      ...deckSnapshotCandidates(request),
      ...localCacheCandidates(request),
      ...literalGameEntityCandidates(request),
      ...(settings.fuzzySearchEnabled ? fuzzyCandidates(request, context) : []),
      ...externalCandidates,
    ]).filter((candidate) =>
      expectedKinds.size ? expectedKinds.has(candidate.kind) : true,
    ),
  );
  const result = createResolutionResult({
    request,
    context,
    candidates,
    ambiguities: [],
    diagnosticsPatch,
  });
  return applyPronunciationLearningToResolutionResult(result, {
    field: request.field,
    settings: request.field.settings.voice.pronunciationLearning,
    state: request.field.pronunciationLearning,
    deckSnapshot: request.deckSnapshot,
    expectedKinds: request.expectedKinds,
    timestamp,
  });
}

export function rankEntityCandidates(
  candidates: EchoEntityResolutionCandidate[],
): EchoEntityResolutionCandidate[] {
  return candidates
    .map((candidate) => ({
      ...candidate,
      score: Math.max(0, Math.min(1, candidate.score)),
      confidenceLevel: confidenceLevelForScore(candidate.score),
    }))
    .sort(
      (left, right) =>
        right.priorityRank - left.priorityRank ||
        right.score - left.score ||
        left.label.localeCompare(right.label) ||
        left.id.localeCompare(right.id),
    );
}

function createResolutionResult(input: {
  request: EchoEntityResolutionRequest;
  context: EchoBattlefieldContext;
  candidates: EchoEntityResolutionCandidate[];
  ambiguities: EchoEntityResolutionAmbiguity[];
  diagnosticsPatch?: Partial<EchoEntityResolutionDiagnostics>;
}): EchoEntityResolutionResult {
  const normalizedText = normalizeEntityText(input.request.text);
  const candidates = rankEntityCandidates(input.candidates);
  const selected = chooseSafeCandidate(candidates);
  const generatedAmbiguities = createAmbiguities({
    text: normalizedText,
    candidates,
    selected,
    existing: input.ambiguities,
  });
  const status =
    selected && !generatedAmbiguities.length
      ? "resolved"
      : generatedAmbiguities.some((entry) => entry.type.startsWith("multiple"))
        ? "ambiguous"
        : candidates.length
          ? "ambiguous"
          : "missing";
  const confidence: EchoEntityResolutionResult["confidence"] =
    selected && !generatedAmbiguities.length
      ? {
          level: selected.confidenceLevel,
          score: selected.score,
          reasons: [`${selected.priority} context matched ${selected.label}.`],
        }
      : {
          level: candidates.length ? "low" : "unknown",
          score: candidates[0]?.score ?? null,
          reasons: generatedAmbiguities.map((entry) => entry.message),
        };
  const diagnostics = createEntityResolutionDiagnostics({
    status,
    lastResolvedAt: input.context.createdAt,
    lastText: input.request.text,
    lastSelectedId: selected?.id ?? null,
    candidateCount: candidates.length,
    ambiguityCount: generatedAmbiguities.length,
    cacheSize: input.request.field.entityResolution?.localCache.length ?? 0,
    ...input.diagnosticsPatch,
  });
  return {
    version: ECHO_ENTITY_RESOLUTION_VERSION,
    status,
    text: input.request.text,
    normalizedText,
    selected: generatedAmbiguities.length ? null : selected,
    candidates,
    ambiguities: generatedAmbiguities,
    confidence,
    resolvedEntities:
      selected && !generatedAmbiguities.length && selected.entity
        ? [selected.entity]
        : [],
    context: input.context,
    diagnostics,
    accessibilityAnnouncement:
      status === "resolved"
        ? `${selected?.label ?? "Entity"} resolved.`
        : status === "ambiguous"
          ? "Entity reference is ambiguous."
          : "Entity reference could not be resolved.",
    directBattlefieldMutation: false,
  };
}

function createEntityResolutionDiagnostics(
  input: Partial<EchoEntityResolutionDiagnostics> | null,
): EchoEntityResolutionDiagnostics {
  return {
    version: ECHO_ENTITY_RESOLUTION_VERSION,
    status: input?.status ?? null,
    lastResolvedAt: input?.lastResolvedAt ?? null,
    lastText: input?.lastText ?? null,
    lastSelectedId: input?.lastSelectedId ?? null,
    candidateCount: input?.candidateCount ?? 0,
    ambiguityCount: input?.ambiguityCount ?? 0,
    scryfallFallbackAttempted: Boolean(input?.scryfallFallbackAttempted),
    scryfallFallbackReason: input?.scryfallFallbackReason ?? null,
    cacheSize: input?.cacheSize ?? 0,
    directBattlefieldMutation: false,
  };
}

function battlefieldCandidates(
  request: EchoEntityResolutionRequest,
  context: EchoBattlefieldContext,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  const special = specialBattlefieldRequests(text);
  const candidates: EchoEntityResolutionCandidate[] = [];
  for (const group of request.field.groups) {
    const contextEntity = context.battlefield.find(
      (entry) => entry.groupId === group.id,
    );
    if (!contextEntity) continue;
    const typeKinds = kindsForGroup(group);
    const labels = labelsForGroup(group);
    const directScore = bestTextScore(text, labels);
    const typeScore = typeKinds.some((kind) => special.kindMatches.has(kind))
      ? special.score
      : 0;
    const subtypeScore = bestTextScore(
      text,
      group.characteristics.subtypes.map(normalizeEntityText),
    );
    const score = Math.max(directScore, typeScore, subtypeScore * 0.88);
    if (score < LOW_CONFIDENCE_THRESHOLD) continue;
    const primaryKind =
      typeKinds.find((kind) => special.kindMatches.has(kind)) ??
      kindForGroup(group);
    candidates.push(
      groupCandidate({
        group,
        context,
        kind: primaryKind,
        text,
        priority: group.trackingEnabled !== false ? "battlefield" : "tracked",
        score,
        role: request.role,
      }),
    );
  }
  return candidates;
}

function plannerCandidates(
  request: EchoEntityResolutionRequest,
  context: EchoBattlefieldContext,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  return context.plannerReferences
    .map((reference) => {
      const score = bestTextScore(text, [
        reference.normalizedLabel,
        normalizeEntityText(reference.label),
      ]);
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return referenceCandidate({
        reference,
        field: request.field,
        priority: "planner",
        source: "planner",
        score,
        role: request.role,
      });
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function actionStripCandidates(
  request: EchoEntityResolutionRequest,
  context: EchoBattlefieldContext,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  return context.actionStripReferences
    .map((reference) => {
      const score = bestTextScore(text, [
        reference.normalizedLabel,
        normalizeEntityText(reference.label),
      ]);
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return referenceCandidate({
        reference,
        field: request.field,
        priority: "actionStrip",
        source: "action-strip",
        score,
        role: request.role,
      });
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function recentCandidates(
  request: EchoEntityResolutionRequest,
  context: EchoBattlefieldContext,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  const explicitIds = new Set(request.recentEntityIds ?? []);
  return context.recentReferences
    .map((reference) => {
      const score = Math.max(
        bestTextScore(text, [reference.normalizedLabel]),
        explicitIds.has(reference.groupId ?? reference.id) ? 0.92 : 0,
      );
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return referenceCandidate({
        reference,
        field: request.field,
        priority: "recent",
        source: "recent",
        score,
        role: request.role,
      });
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function deckSnapshotCandidates(
  request: EchoEntityResolutionRequest,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  return (request.deckSnapshot ?? [])
    .map((card, index) => {
      const score = bestTextScore(text, [
        normalizeEntityText(card.name),
        ...nicknameParts(card.name),
      ]);
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return deckCandidate(card, text, score, index);
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function localCacheCandidates(
  request: EchoEntityResolutionRequest,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  const cards = [
    ...(request.cachedCards ?? []),
    ...(request.field.recentCards ?? []),
  ];
  return cards
    .map((card, index) => {
      const score = bestTextScore(text, [
        normalizeEntityText(card.name),
        ...nicknameParts(card.name),
      ]);
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return cardCandidate({
        card,
        text,
        priority: "localCache",
        source: "local-cache",
        index,
        score,
      });
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function literalGameEntityCandidates(
  request: EchoEntityResolutionRequest,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  const candidates: EchoEntityResolutionCandidate[] = [];
  const player = PLAYER_ALIASES[text];
  if (player) {
    candidates.push({
      id: `player:${player}`,
      kind: player === "opponent" ? "opponent" : "player",
      label: player,
      normalizedLabel: text,
      priority: "battlefield",
      priorityRank: PRIORITY_RANK.battlefield,
      score: 0.96,
      confidenceLevel: "high",
      entity: {
        kind: "player",
        owner: player,
        role: request.role === "source" ? "source" : "target",
      },
      groupId: null,
      objectIds: [],
      owner: player,
      controller: player,
      zone: null,
      cardId: null,
      source: "battlefield",
      relationshipIds: [],
      relationshipSummary: [],
      metadata: {},
    });
  }
  const zone = ZONE_ALIASES[text.replace(/\s+/g, "")] ?? ZONE_ALIASES[text];
  if (zone) {
    candidates.push({
      id: `zone:${zone}`,
      kind: "zone",
      label: zone,
      normalizedLabel: text,
      priority: "battlefield",
      priorityRank: PRIORITY_RANK.battlefield,
      score: 0.96,
      confidenceLevel: "high",
      entity: {
        kind: "zone",
        zone,
        role: request.role === "origin" ? "origin" : "destination",
      },
      groupId: null,
      objectIds: [],
      owner: null,
      controller: null,
      zone,
      cardId: null,
      source: "battlefield",
      relationshipIds: [],
      relationshipSummary: [],
      metadata: {},
    });
  }
  const manaText = text.replace(/\s+mana$/, "");
  if (MANA_ALIASES.has(manaText)) {
    candidates.push({
      id: `mana:${manaText}`,
      kind: "mana",
      label: titleCase(manaText),
      normalizedLabel: manaText,
      priority: "battlefield",
      priorityRank: PRIORITY_RANK.battlefield,
      score: 0.94,
      confidenceLevel: "high",
      entity: null,
      groupId: null,
      objectIds: [],
      owner: null,
      controller: null,
      zone: null,
      cardId: null,
      source: "battlefield",
      relationshipIds: [],
      relationshipSummary: [],
      metadata: { manaColor: manaText },
    });
  }
  const counter = counterNameForText(text, request.field);
  if (counter) {
    candidates.push({
      id: `counter:${normalizeEntityText(counter)}`,
      kind: "counter",
      label: counter,
      normalizedLabel: normalizeEntityText(counter),
      priority: "tracked",
      priorityRank: PRIORITY_RANK.tracked,
      score: 0.95,
      confidenceLevel: "high",
      entity: { kind: "counter", name: counter, role: "counter" },
      groupId: null,
      objectIds: [],
      owner: null,
      controller: null,
      zone: null,
      cardId: null,
      source: "battlefield",
      relationshipIds: [],
      relationshipSummary: [],
      metadata: {},
    });
  }
  return candidates;
}

function fuzzyCandidates(
  request: EchoEntityResolutionRequest,
  context: EchoBattlefieldContext,
): EchoEntityResolutionCandidate[] {
  const text = normalizeEntityText(request.text);
  if (text.length < 3) return [];
  return request.field.groups
    .map((group) => {
      const labels = labelsForGroup(group);
      const score = Math.max(
        ...labels.map((label) => fuzzyTextScore(text, label)),
      );
      if (score < LOW_CONFIDENCE_THRESHOLD) return null;
      return groupCandidate({
        group,
        context,
        kind: kindForGroup(group),
        text,
        priority: "fuzzy",
        score,
        role: request.role,
      });
    })
    .filter((entry): entry is EchoEntityResolutionCandidate => Boolean(entry));
}

function groupCandidate(input: {
  group: PermanentGroup;
  context: EchoBattlefieldContext;
  kind: EchoEntityKind;
  text: string;
  priority: EchoEntityResolutionPriority;
  score: number;
  role?: EchoEntityResolutionRequest["role"];
}): EchoEntityResolutionCandidate {
  const objectIds = [...(input.group.session?.objectIds ?? [input.group.id])];
  const relationships = input.context.relationships.filter(
    (relationship) =>
      relationship.sourceId === input.group.id ||
      relationship.targetId === input.group.id,
  );
  return {
    id: `group:${input.group.id}:${input.kind}`,
    kind: input.kind,
    label: input.group.label,
    normalizedLabel: normalizeEntityText(input.group.label),
    priority: input.priority,
    priorityRank: PRIORITY_RANK[input.priority],
    score: input.score,
    confidenceLevel: confidenceLevelForScore(input.score),
    entity: groupReference(input.group.id, input.role),
    groupId: input.group.id,
    objectIds,
    owner: input.group.owner,
    controller: input.group.controller,
    zone: input.group.zone,
    cardId: input.group.identity?.cardId ?? null,
    source: input.priority === "fuzzy" ? "fuzzy" : "battlefield",
    relationshipIds: relationships.map((relationship) => relationship.id),
    relationshipSummary: relationships.map(
      (relationship) => relationship.label,
    ),
    metadata: {
      quantity: input.group.quantity,
      trackingEnabled: input.group.trackingEnabled !== false,
      isGeneric: input.group.isGeneric,
      isToken: input.group.characteristics.isToken,
    },
  };
}

function referenceCandidate(input: {
  reference: EchoContextReference;
  field: FieldState;
  priority: Extract<
    EchoEntityResolutionPriority,
    "planner" | "actionStrip" | "recent"
  >;
  source: "planner" | "action-strip" | "recent";
  score: number;
  role?: EchoEntityResolutionRequest["role"];
}): EchoEntityResolutionCandidate {
  const group = input.reference.groupId
    ? input.field.groups.find((entry) => entry.id === input.reference.groupId)
    : null;
  return {
    id: `${input.source}:${input.reference.id}`,
    kind: group ? kindForGroup(group) : "card",
    label: input.reference.label,
    normalizedLabel: input.reference.normalizedLabel,
    priority: input.priority,
    priorityRank: PRIORITY_RANK[input.priority],
    score: input.score,
    confidenceLevel: confidenceLevelForScore(input.score),
    entity: group ? groupReference(group.id, input.role) : null,
    groupId: group?.id ?? input.reference.groupId,
    objectIds: group?.session?.objectIds ?? (group ? [group.id] : []),
    owner: group?.owner ?? null,
    controller: group?.controller ?? null,
    zone: group?.zone ?? null,
    cardId: input.reference.cardId,
    source: input.source,
    relationshipIds: [],
    relationshipSummary: [],
    metadata: {
      intentKind: input.reference.intentKind,
      order: input.reference.order,
    },
  };
}

function deckCandidate(
  card: EchoDeckSnapshotCard,
  text: string,
  score: number,
  index: number,
): EchoEntityResolutionCandidate {
  return {
    id: `deck:${card.cardId}:${index}`,
    kind: card.isCommander ? "commander" : kindForTypeLine(card.typeLine),
    label: card.name,
    normalizedLabel: normalizeEntityText(card.name),
    priority: "deckSnapshot",
    priorityRank: PRIORITY_RANK.deckSnapshot,
    score,
    confidenceLevel: confidenceLevelForScore(score),
    entity: null,
    groupId: null,
    objectIds: [],
    owner: null,
    controller: null,
    zone: null,
    cardId: card.cardId,
    source: "deck-snapshot",
    relationshipIds: [],
    relationshipSummary: [],
    metadata: { query: text, quantity: card.quantity ?? 1 },
  };
}

function cardCandidate(input: {
  card: CardIdentity;
  text: string;
  priority: Extract<EchoEntityResolutionPriority, "localCache" | "scryfall">;
  source: "local-cache" | "scryfall";
  index: number;
  score?: number;
}): EchoEntityResolutionCandidate {
  const score =
    input.score ??
    bestTextScore(input.text, [
      normalizeEntityText(input.card.name),
      ...nicknameParts(input.card.name),
    ]);
  return {
    id: `${input.source}:${input.card.cardId}:${input.index}`,
    kind: kindForTypeLine(input.card.typeLine),
    label: input.card.name,
    normalizedLabel: normalizeEntityText(input.card.name),
    priority: input.priority,
    priorityRank: PRIORITY_RANK[input.priority],
    score,
    confidenceLevel: confidenceLevelForScore(score),
    entity: null,
    groupId: null,
    objectIds: [],
    owner: null,
    controller: null,
    zone: null,
    cardId: input.card.cardId,
    source: input.source,
    relationshipIds: [],
    relationshipSummary: [],
    metadata: { query: input.text },
  };
}

function contextEntityFromGroup(
  group: PermanentGroup,
): EchoBattlefieldContextEntity {
  return {
    groupId: group.id,
    objectIds: [...(group.session?.objectIds ?? [group.id])],
    label: group.label,
    normalizedLabel: normalizeEntityText(group.label),
    owner: group.owner,
    controller: group.controller,
    zone: group.zone,
    quantity: group.quantity,
    cardId: group.identity?.cardId ?? null,
    isCommanderCandidate: isCommanderCandidate(group),
    isToken: group.characteristics.isToken,
    isGeneric: group.isGeneric,
    cardTypes: [...group.characteristics.cardTypes],
    subtypes: [...group.characteristics.subtypes],
    supertypes: [...group.characteristics.supertypes],
    counters: { ...group.counters },
    attachedTo: group.attachedTo,
    attachments: [...group.attachments],
    trackingEnabled: group.trackingEnabled !== false,
  };
}

function createPlannerReferences(field: FieldState): EchoContextReference[] {
  return field.preTurnPlanner.actions
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .flatMap((action, index) => {
      const references: EchoContextReference[] = [];
      if (action.title) {
        references.push({
          id: `planner:${action.id}:title`,
          source: "planner",
          label: action.title,
          normalizedLabel: normalizeEntityText(action.title),
          groupId: action.relatedGroupId,
          cardId: action.relatedCardId,
          intentKind: action.actionStrip.intentKind,
          order: index,
        });
      }
      for (const [reminderIndex, reminder] of action.reminders.entries()) {
        references.push({
          id: `planner:${action.id}:reminder:${reminderIndex}`,
          source: "planner",
          label: reminder,
          normalizedLabel: normalizeEntityText(reminder),
          groupId: action.relatedGroupId,
          cardId: action.relatedCardId,
          intentKind: action.actionStrip.intentKind,
          order: index,
        });
      }
      return references;
    });
}

function createActionStripReferences(
  field: FieldState,
): EchoContextReference[] {
  return field.activeTurnActionStrip.items
    .slice()
    .sort(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    )
    .map((item, index) => ({
      id: `action-strip:${item.id}`,
      source: "action-strip",
      label: [item.label, item.detail].filter(Boolean).join(" "),
      normalizedLabel: normalizeEntityText(
        [item.label, item.detail].filter(Boolean).join(" "),
      ),
      groupId:
        typeof item.intent?.payload?.primaryGroupId === "string"
          ? item.intent.payload.primaryGroupId
          : null,
      cardId:
        typeof item.intent?.payload?.primaryCardId === "string"
          ? item.intent.payload.primaryCardId
          : null,
      intentKind: item.intentKind,
      order: index,
    }));
}

function createRecentReferences(field: FieldState): EchoContextReference[] {
  const diagnostics = field.entityResolution?.recentlyResolved ?? [];
  const recentEntities = diagnostics.map((entry, index) => ({
    id: `recent:${entry.id}`,
    source: "recent" as const,
    label: entry.label,
    normalizedLabel: entry.normalizedLabel,
    groupId: entry.groupId,
    cardId: entry.cardId,
    intentKind: null,
    order: index,
  }));
  const recentCards = (field.recentCards ?? []).map((card, index) => ({
    id: `field-recent:${card.cardId}`,
    source: "field-recent" as const,
    label: card.name,
    normalizedLabel: normalizeEntityText(card.name),
    groupId: null,
    cardId: card.cardId,
    intentKind: null,
    order: index + recentEntities.length,
  }));
  return [...recentEntities, ...recentCards];
}

function createEntityRelationships(
  field: FieldState,
): EchoEntityRelationship[] {
  const relationships: EchoEntityRelationship[] = [];
  for (const group of field.groups) {
    if (group.attachedTo) {
      relationships.push({
        id: `attached-to:${group.id}:${group.attachedTo}`,
        kind: "attached-to",
        sourceId: group.id,
        targetId: group.attachedTo,
        label: `${group.label} is attached to ${labelForGroup(field, group.attachedTo)}.`,
      });
      relationships.push({
        id: `attachment:${group.attachedTo}:${group.id}`,
        kind: "attachment",
        sourceId: group.attachedTo,
        targetId: group.id,
        label: `${labelForGroup(field, group.attachedTo)} has ${group.label} attached.`,
      });
    }
    if (group.characteristics.isToken && group.quantity > 1) {
      relationships.push({
        id: `token-stack:${group.id}`,
        kind: "token-stack",
        sourceId: group.id,
        targetId: null,
        label: `${group.label} represents ${group.quantity} tokens.`,
      });
    }
    if (isCommanderCandidate(group)) {
      relationships.push({
        id: `commander:${group.id}:${group.owner}`,
        kind: "commander-owned-by",
        sourceId: group.id,
        targetId: null,
        label: `${group.label} is a commander candidate for ${group.owner}.`,
      });
    }
    for (const [counter, amount] of Object.entries(group.counters)) {
      if (amount <= 0) continue;
      relationships.push({
        id: `counter:${group.id}:${normalizeEntityText(counter)}`,
        kind: "counter-on",
        sourceId: group.id,
        targetId: null,
        label: `${group.label} has ${amount} ${counter} counter${amount === 1 ? "" : "s"}.`,
      });
    }
  }
  for (const action of field.preTurnPlanner.actions) {
    if (!action.relatedGroupId) continue;
    relationships.push({
      id: `planner-reference:${action.id}:${action.relatedGroupId}`,
      kind: "planner-reference",
      sourceId: action.relatedGroupId,
      targetId: null,
      label: `${action.title} references ${labelForGroup(field, action.relatedGroupId)}.`,
    });
  }
  for (const item of field.activeTurnActionStrip.items) {
    const groupId =
      typeof item.intent?.payload?.primaryGroupId === "string"
        ? item.intent.payload.primaryGroupId
        : null;
    if (!groupId) continue;
    relationships.push({
      id: `action-strip-reference:${item.id}:${groupId}`,
      kind: "action-strip-reference",
      sourceId: groupId,
      targetId: null,
      label: `${item.label} references ${labelForGroup(field, groupId)}.`,
    });
  }
  return relationships;
}

function inferEntityTextsFromIntent(
  intent: AmbientIntent,
): Array<{ text: string; role?: EchoEntityResolutionRequest["role"] }> {
  const entries: Array<{
    text: string;
    role?: EchoEntityResolutionRequest["role"];
  }> = [];
  const payload = intent.payload;
  const keys: Array<[string, EchoEntityResolutionRequest["role"]]> = [
    ["primaryObjectText", "target"],
    ["primaryObjectLabel", "target"],
    ["primaryCardName", "target"],
    ["primaryLandName", "target"],
    ["secondaryObjectText", "target"],
    ["secondaryObjectLabel", "target"],
    ["targetObjectText", "target"],
    ["targetObjectLabel", "target"],
    ["counterName", "counter"],
    ["tokenName", "target"],
    ["zone", "destination"],
    ["player", "target"],
  ];
  for (const [key, role] of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) {
      entries.push({ text: value, role });
    }
  }
  return entries;
}

function chooseSafeCandidate(
  candidates: EchoEntityResolutionCandidate[],
): EchoEntityResolutionCandidate | null {
  if (!candidates.length) return null;
  const top = candidates[0];
  if (!top || top.score < MEDIUM_CONFIDENCE_THRESHOLD) return null;
  const second = candidates[1];
  if (!second) return top;
  if (top.priorityRank > second.priorityRank) return top;
  if (top.score - second.score >= SAFE_SELECTION_MARGIN) return top;
  if (top.groupId && top.groupId === second.groupId) return top;
  return null;
}

function createAmbiguities(input: {
  text: string;
  candidates: EchoEntityResolutionCandidate[];
  selected: EchoEntityResolutionCandidate | null;
  existing: EchoEntityResolutionAmbiguity[];
}): EchoEntityResolutionAmbiguity[] {
  if (input.existing.length) return input.existing;
  if (!input.candidates.length) {
    return [
      {
        type: "missing-entity",
        message: `No local entity matched "${input.text}".`,
        candidates: [],
      },
    ];
  }
  if (input.selected) return [];
  const topPriority = input.candidates[0]?.priority;
  const close = input.candidates
    .filter((candidate) => candidate.priority === topPriority)
    .slice(0, 5);
  if (close.length > 1) {
    const type = close.every((candidate) => candidate.kind === "token")
      ? "multiple-token-stacks"
      : close.every((candidate) => candidate.kind === "player")
        ? "multiple-players"
        : "multiple-battlefield-objects";
    return [
      {
        type,
        message: `"${input.text}" matches multiple local entities.`,
        candidates: close.map((candidate) => candidate.label),
      },
    ];
  }
  return [
    {
      type: "low-confidence",
      message: `"${input.text}" did not reach safe resolution confidence.`,
      candidates: input.candidates
        .slice(0, 5)
        .map((candidate) => candidate.label),
    },
  ];
}

function shouldUseExternalFallback(
  result: EchoEntityResolutionResult,
  settings: EchoEntityResolutionSettings,
  scryfallSearch: EchoEntityResolutionFallbackRequest["scryfallSearch"],
): boolean {
  if (!settings.scryfallFallbackEnabled || !scryfallSearch) return false;
  if (result.status === "resolved") return false;
  if (
    result.ambiguities.some(
      (entry) =>
        entry.type === "multiple-battlefield-objects" ||
        entry.type === "multiple-token-stacks" ||
        entry.type === "multiple-players",
    )
  ) {
    return false;
  }
  return result.candidates.every(
    (candidate) => candidate.priorityRank < PRIORITY_RANK.deckSnapshot,
  );
}

function dedupeCandidates(
  candidates: EchoEntityResolutionCandidate[],
): EchoEntityResolutionCandidate[] {
  const byKey = new Map<string, EchoEntityResolutionCandidate>();
  for (const candidate of candidates) {
    const key = candidate.groupId
      ? `${candidate.kind}:group:${candidate.groupId}:${candidate.priority}`
      : candidate.cardId
        ? `${candidate.kind}:card:${candidate.cardId}:${candidate.priority}`
        : `${candidate.kind}:${candidate.id}`;
    const existing = byKey.get(key);
    if (!existing || candidate.score > existing.score) {
      byKey.set(key, candidate);
    }
  }
  return [...byKey.values()];
}

function dedupeEntityReferences(
  references: AmbientEntityReference[],
): AmbientEntityReference[] {
  const seen = new Set<string>();
  const deduped: AmbientEntityReference[] = [];
  for (const reference of references) {
    const key = JSON.stringify(reference);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(reference);
  }
  return deduped;
}

function specialBattlefieldRequests(text: string): {
  kindMatches: Set<EchoEntityKind>;
  score: number;
} {
  if (text === "commander" || text === "my commander") {
    return { kindMatches: new Set(["commander"]), score: 0.94 };
  }
  if (text === "token" || text === "the token") {
    return { kindMatches: new Set(["token", "tokenStack"]), score: 0.82 };
  }
  if (text.startsWith("my ")) {
    return specialBattlefieldRequests(text.replace(/^my\s+/, ""));
  }
  const kind = GROUP_TYPE_KIND.find((entry) => entry.kind === text);
  return {
    kindMatches: new Set(kind ? [kind.kind] : []),
    score: kind ? 0.74 : 0,
  };
}

function kindsForGroup(group: PermanentGroup): EchoEntityKind[] {
  const kinds: EchoEntityKind[] = [kindForGroup(group), "permanent"];
  if (group.characteristics.isLegendary && group.characteristics.isCreature) {
    kinds.push("commander");
  }
  if (group.characteristics.isToken) {
    kinds.push(group.quantity > 1 ? "tokenStack" : "token");
  }
  for (const entry of GROUP_TYPE_KIND) {
    if (
      entry.cardType &&
      group.characteristics.cardTypes.includes(entry.cardType)
    ) {
      kinds.push(entry.kind);
    }
    if (
      entry.subtype &&
      group.characteristics.subtypes.includes(entry.subtype)
    ) {
      kinds.push(entry.kind);
    }
  }
  return [...new Set(kinds)];
}

function kindForGroup(group: PermanentGroup): EchoEntityKind {
  if (group.characteristics.isToken) {
    return group.quantity > 1 ? "tokenStack" : "token";
  }
  if (isCommanderCandidate(group)) return "commander";
  return kindForTypeLine(
    group.identity?.typeLine ?? group.characteristics.cardTypes.join(" "),
  );
}

function kindForTypeLine(typeLine: string | undefined): EchoEntityKind {
  const normalized = normalizeEntityText(typeLine ?? "");
  if (normalized.includes("creature")) return "creature";
  if (normalized.includes("land")) return "land";
  if (normalized.includes("artifact")) return "artifact";
  if (normalized.includes("enchantment")) return "enchantment";
  if (normalized.includes("planeswalker")) return "planeswalker";
  if (normalized.includes("battle")) return "battle";
  if (normalized.includes("token")) return "token";
  return "card";
}

function labelsForGroup(group: PermanentGroup): string[] {
  return [
    normalizeEntityText(group.label),
    normalizeEntityText(group.identity?.name ?? ""),
    ...nicknameParts(group.label),
    ...nicknameParts(group.identity?.name ?? ""),
    ...group.characteristics.subtypes.map(normalizeEntityText),
    ...group.characteristics.cardTypes.map(normalizeEntityText),
    group.characteristics.isToken ? "token" : "",
    group.quantity > 1 && group.characteristics.isToken ? "token stack" : "",
    isCommanderCandidate(group) ? "commander" : "",
    ...basicLandAliases(group),
  ].filter(Boolean);
}

function nicknameParts(name: string): string[] {
  const normalized = normalizeEntityText(name);
  const [beforeComma] = normalized.split(",");
  return [
    beforeComma ?? "",
    ...normalized
      .split(/\s+/)
      .filter(
        (part) => part.length >= 3 && !["the", "and", "with"].includes(part),
      ),
  ].filter(Boolean);
}

function basicLandAliases(group: PermanentGroup): string[] {
  return group.characteristics.subtypes
    .map(normalizeEntityText)
    .filter((subtype) => BASIC_LANDS.has(subtype));
}

function bestTextScore(text: string, labels: string[]): number {
  const normalizedLabels = labels.map(normalizeEntityText).filter(Boolean);
  let best = 0;
  for (const label of normalizedLabels) {
    if (text === label) best = Math.max(best, 1);
    if (label.startsWith(text) && text.length >= 3) best = Math.max(best, 0.92);
    if (text.startsWith(label) && label.length >= 3)
      best = Math.max(best, 0.88);
    if (label.includes(text) && text.length >= 3) best = Math.max(best, 0.78);
    if (text.includes(label) && label.length >= 3) best = Math.max(best, 0.72);
    best = Math.max(best, fuzzyTextScore(text, label));
  }
  return best;
}

function fuzzyTextScore(text: string, label: string): number {
  const normalizedText = normalizeEntityText(text);
  const normalizedLabel = normalizeEntityText(label);
  if (!normalizedText || !normalizedLabel) return 0;
  if (normalizedText === normalizedLabel) return 1;
  const textParts = normalizedText.split(/\s+/);
  const labelParts = normalizedLabel.split(/\s+/);
  const matchingParts = textParts.filter((part) =>
    labelParts.some(
      (labelPart) => labelPart.startsWith(part) || part.startsWith(labelPart),
    ),
  ).length;
  const partScore =
    matchingParts / Math.max(textParts.length, labelParts.length);
  const subsequenceScore = isSubsequence(normalizedText, normalizedLabel)
    ? 0.54
    : 0;
  return Math.max(partScore * 0.76, subsequenceScore);
}

function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return false;
}

function confidenceLevelForScore(score: number): AmbientConfidenceLevel {
  if (score >= HIGH_CONFIDENCE_THRESHOLD) return "high";
  if (score >= MEDIUM_CONFIDENCE_THRESHOLD) return "medium";
  if (score >= LOW_CONFIDENCE_THRESHOLD) return "low";
  return "unknown";
}

function groupReference(
  id: string,
  role?: EchoEntityResolutionRequest["role"],
): AmbientEntityReference {
  if (role === "source" || role === "attachment" || role === "host") {
    return { kind: "group", id, role };
  }
  return { kind: "group", id, role: "target" };
}

function counterNameForText(text: string, field: FieldState): string | null {
  const normalized = text
    .replace(/\bcounters?\b/g, "")
    .replace(/\bone\s+one\b/g, "+1/+1")
    .trim();
  const names = new Set([
    ...COUNTER_OPTIONS,
    ...field.groups.flatMap((group) => Object.keys(group.counters)),
  ]);
  for (const name of names) {
    const normalizedName = normalizeEntityText(name)
      .replace(/\bcounters?\b/g, "")
      .trim();
    if (normalized === normalizedName || normalized.includes(normalizedName)) {
      return name;
    }
  }
  if (text.includes("+1/+1") || text.includes("plus one")) return "+1/+1";
  if (text.includes("-1/-1") || text.includes("minus one")) return "-1/-1";
  return null;
}

function isCommanderCandidate(group: PermanentGroup): boolean {
  const label = normalizeEntityText(group.label);
  return (
    label.includes("commander") ||
    (group.characteristics.isLegendary && group.characteristics.isCreature)
  );
}

function labelForGroup(field: FieldState, groupId: string): string {
  return field.groups.find((group) => group.id === groupId)?.label ?? groupId;
}

function normalizeEntityText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`]/g, "")
    .replace(/[^a-zA-Z0-9+/-]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/^(my|the|a|an)\s+/, "")
    .replace(/\s+/g, " ");
}

function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

function normalizeRecentEntity(
  value: unknown,
  timestamp?: string,
): EchoRecentlyResolvedEntity | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoRecentlyResolvedEntity>;
  if (typeof candidate.id !== "string" || typeof candidate.label !== "string") {
    return null;
  }
  return {
    id: candidate.id,
    label: candidate.label.slice(0, 120),
    normalizedLabel:
      typeof candidate.normalizedLabel === "string"
        ? candidate.normalizedLabel
        : normalizeEntityText(candidate.label),
    kind: isEntityKind(candidate.kind) ? candidate.kind : "card",
    groupId: typeof candidate.groupId === "string" ? candidate.groupId : null,
    cardId: typeof candidate.cardId === "string" ? candidate.cardId : null,
    lastResolvedAt:
      typeof candidate.lastResolvedAt === "string"
        ? candidate.lastResolvedAt
        : (timestamp ?? new Date().toISOString()),
    count: clampNumber(candidate.count, 1, 999999, 1),
  };
}

function normalizeCandidate(
  value: unknown,
): EchoEntityResolutionCandidate | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<EchoEntityResolutionCandidate>;
  if (typeof candidate.id !== "string" || typeof candidate.label !== "string") {
    return null;
  }
  const priority = isPriority(candidate.priority)
    ? candidate.priority
    : "localCache";
  const score = clampFraction(candidate.score, 0);
  return {
    id: candidate.id.slice(0, 160),
    kind: isEntityKind(candidate.kind) ? candidate.kind : "card",
    label: candidate.label.slice(0, 120),
    normalizedLabel:
      typeof candidate.normalizedLabel === "string"
        ? candidate.normalizedLabel
        : normalizeEntityText(candidate.label),
    priority,
    priorityRank: PRIORITY_RANK[priority],
    score,
    confidenceLevel: confidenceLevelForScore(score),
    entity: null,
    groupId: typeof candidate.groupId === "string" ? candidate.groupId : null,
    objectIds: Array.isArray(candidate.objectIds)
      ? candidate.objectIds.filter((id): id is string => typeof id === "string")
      : [],
    owner:
      candidate.owner === "you" || candidate.owner === "opponent"
        ? candidate.owner
        : null,
    controller:
      candidate.controller === "you" || candidate.controller === "opponent"
        ? candidate.controller
        : null,
    zone: isZone(candidate.zone) ? candidate.zone : null,
    cardId: typeof candidate.cardId === "string" ? candidate.cardId : null,
    source: candidate.source ?? "local-cache",
    relationshipIds: Array.isArray(candidate.relationshipIds)
      ? candidate.relationshipIds.filter(
          (id): id is string => typeof id === "string",
        )
      : [],
    relationshipSummary: Array.isArray(candidate.relationshipSummary)
      ? candidate.relationshipSummary.filter(
          (entry): entry is string => typeof entry === "string",
        )
      : [],
    metadata: {},
  };
}

function isEntityKind(value: unknown): value is EchoEntityKind {
  return (
    typeof value === "string" &&
    [
      "card",
      "commander",
      "creature",
      "token",
      "tokenStack",
      "player",
      "opponent",
      "permanent",
      "land",
      "artifact",
      "enchantment",
      "planeswalker",
      "battle",
      "counter",
      "mana",
      "zone",
      "trigger",
      "reminder",
    ].includes(value)
  );
}

function isPriority(value: unknown): value is EchoEntityResolutionPriority {
  return typeof value === "string" && value in PRIORITY_RANK;
}

function isZone(value: unknown): value is Zone {
  return (
    value === "battlefield" ||
    value === "hand" ||
    value === "graveyard" ||
    value === "exile" ||
    value === "library" ||
    value === "command"
  );
}

function clampNumber(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(numeric)));
}

function clampFraction(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(1, Math.max(0, numeric));
}
