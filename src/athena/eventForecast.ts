import type {
  CardIdentity,
  Characteristics,
  FieldState,
  RelevantTotalKey,
  Zone,
} from "../domain/types";
import type {
  AmbientEntityReference,
  AmbientIntent,
  AmbientIntentKind,
  AmbientIntentSource,
} from "../echo/ambientEventTypes";
import type { PlannedAction } from "../echo/preTurnPlannerTypes";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import {
  buildAthenaDependencyGraphFromContext,
  getAthenaRelevantTotalsForSubject,
} from "./dependencyGraph";
import type {
  AthenaDependencyGraph,
  AthenaEventCategory,
  AthenaGraphChange,
} from "./dependencyGraphTypes";
import { ATHENA_EVENT_CATEGORIES } from "./dependencyGraphTypes";
import {
  buildAthenaEffectRelationshipMapFromContext,
  createAthenaEffectRelationshipQueryApi,
} from "./effectRelationshipMapper";
import type {
  AthenaEffectChoiceRequirementDescriptor,
  AthenaEffectRelationshipMap,
  AthenaMappedEffectRelationship,
} from "./effectRelationshipMapperTypes";
import {
  createAthenaAwarenessContext,
  rankAthenaAuthoritySource,
} from "./foundation";
import { processAthenaReplacementEffects } from "./replacementEffect";
import {
  ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY,
  type AthenaReplacementProcessingResult,
} from "./replacementEffectTypes";
import {
  ATHENA_EVENT_FORECAST_CACHE_VERSION,
  ATHENA_EVENT_FORECAST_DEFAULT_DEPTH,
  ATHENA_EVENT_FORECAST_MAX_DEPTH,
  ATHENA_EVENT_FORECAST_VERSION,
  type AthenaActionStripForecastAdapterInput,
  type AthenaEchoForecastAdapterInput,
  type AthenaEventForecastDiagnostics,
  type AthenaEventForecastResult,
  type AthenaForecastAdapterOptions,
  type AthenaForecastCancellationSignal,
  type AthenaForecastCharacteristicField,
  type AthenaForecastCertainty,
  type AthenaForecastChoiceRequirement,
  type AthenaForecastDirectConsequence,
  type AthenaForecastEngineDiagnostics,
  type AthenaForecastEngineOptions,
  type AthenaForecastEnvironment,
  type AthenaForecastGeneratedEvent,
  type AthenaGameEventForecastAdapterInput,
  type AthenaForecastInput,
  type AthenaForecastInputDraft,
  type AthenaForecastInputSource,
  type AthenaForecastInvalidationInput,
  type AthenaForecastKnownCharacteristics,
  type AthenaForecastOptions,
  type AthenaForecastReasonCode,
  type AthenaForecastRelationshipFinding,
  type AthenaForecastRelevantTotalChange,
  type AthenaForecastReplacementFinding,
  type AthenaForecastStaticDependency,
  type AthenaForecastTokenDefinitionReference,
  type AthenaForecastValidity,
  type AthenaForecastVersionSnapshot,
  type AthenaForecastWarning,
  type AthenaPlannerForecastAdapterInput,
} from "./eventForecastTypes";
import type { AthenaAuthoritySource, AthenaAwarenessContext } from "./types";

const DEFAULT_TIMESTAMP = "1970-01-01T00:00:00.000Z";
const EVENT_CATEGORY_SET = new Set<string>(ATHENA_EVENT_CATEGORIES);
const CHARACTERISTIC_FIELDS: AthenaForecastCharacteristicField[] = [
  "cardTypes",
  "supertypes",
  "subtypes",
  "colors",
  "manaValue",
  "isToken",
  "isCreature",
  "isLegendary",
];
const BROAD_INVALIDATION_KINDS = new Set<AthenaGraphChange["kind"]>([
  "full-rebuild",
  "import",
  "reload",
  "undo",
  "redo",
  "authority-result-received",
]);
const ENTER_EVENTS = new Set<AthenaEventCategory>([
  "permanent-entered",
  "creature-entered",
  "land-entered",
  "token-created",
  "token-entered",
  "permanent-returned-to-battlefield",
]);
const LEAVE_EVENTS = new Set<AthenaEventCategory>([
  "permanent-died",
  "permanent-sacrificed",
  "permanent-exiled",
  "permanent-returned-to-hand",
  "token-removed",
]);

interface DirectAnalysis {
  consequences: AthenaForecastDirectConsequence[];
  totalChanges: AthenaForecastRelevantTotalChange[];
  generatedEvents: AthenaForecastGeneratedEvent[];
  choices: AthenaForecastChoiceRequirement[];
  warnings: AthenaForecastWarning[];
}

interface EventExplorationEntry {
  category: AthenaEventCategory;
  relationshipDepth: number;
  generatedDepth: number;
  path: AthenaEventCategory[];
  quantity: number | null;
  certainty: AthenaForecastCertainty;
  sourceRelationshipId: string | null;
}

interface ForecastRequestOptions extends AthenaForecastOptions {
  environment?: AthenaForecastEnvironment;
}

export function createAthenaForecastInput(
  draft: AthenaForecastInput | AthenaForecastInputDraft,
  environment: AthenaForecastEnvironment,
): AthenaForecastInput {
  const authoritySource =
    draft.authoritySource ?? environment.context.currentAuthoritySource;
  const timestamp = sanitizeTimestamp(
    draft.timestamp,
    environment.context.createdAt || DEFAULT_TIMESTAMP,
  );
  const eventId = sanitizeId(draft.eventId, "event");
  const id = sanitizeId(draft.id, `forecast-input:${eventId}`);
  const knownCharacteristics = normalizeKnownCharacteristics(
    draft.knownCharacteristics,
  );
  const versions = versionSnapshot(environment);
  return {
    version: ATHENA_EVENT_FORECAST_VERSION,
    id,
    canonicalSessionId:
      sanitizeId(draft.canonicalSessionId, environment.context.sessionId) ||
      environment.context.sessionId,
    participantId:
      sanitizeId(draft.participantId, environment.context.localParticipantId) ||
      environment.context.localParticipantId,
    eventId,
    eventCategory: draft.eventCategory,
    eventSource: draft.eventSource ?? sourceForAuthority(authoritySource),
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    sequence: finiteInteger(draft.sequence, 0, 999999999, 0),
    batchId: sanitizeId(draft.batchId, eventId),
    timestamp,
    sourceObjectId: nullableId(draft.sourceObjectId),
    subjectGroupIds: uniqueStrings(draft.subjectGroupIds ?? []),
    subjectObjectIds: uniqueStrings(draft.subjectObjectIds ?? []),
    quantity: normalizeForecastQuantity(draft.quantity),
    knownCharacteristics,
    zoneOrigin: normalizeZone(draft.zoneOrigin),
    zoneDestination: normalizeZone(draft.zoneDestination),
    counterType: nullableText(draft.counterType),
    tokenDefinition: normalizeTokenDefinition(
      draft.tokenDefinition,
      knownCharacteristics,
    ),
    permanentDefinition: clonePermanentDefinition(draft.permanentDefinition),
    lifeDelta: finiteNumberOrNull(draft.lifeDelta),
    commanderDamageDelta: finiteNumberOrNull(draft.commanderDamageDelta),
    relevantTotalImplications: normalizeTotalImplications(
      draft.relevantTotalImplications,
    ),
    confidence: draft.confidence
      ? {
          level: draft.confidence.level,
          score: finiteNumberOrNull(draft.confidence.score),
          speakerVerified:
            typeof draft.confidence.speakerVerified === "boolean"
              ? draft.confidence.speakerVerified
              : null,
        }
      : null,
    echoIntentReference: nullableId(draft.echoIntentReference),
    plannerReference: nullableId(draft.plannerReference),
    actionStripReference: nullableId(draft.actionStripReference),
    canonicalResultReference: nullableId(draft.canonicalResultReference),
    awarenessContextVersion:
      draft.awarenessContextVersion ?? environment.context.version,
    awarenessContextFingerprint:
      draft.awarenessContextFingerprint ?? versions.awarenessContextFingerprint,
    dependencyGraphVersion:
      draft.dependencyGraphVersion ?? environment.graph.version,
    dependencyGraphFingerprint:
      draft.dependencyGraphFingerprint ?? versions.dependencyGraphFingerprint,
    relationshipMapVersion:
      draft.relationshipMapVersion ?? environment.relationshipMap.version,
    relationshipMapFingerprint:
      draft.relationshipMapFingerprint ?? versions.relationshipMapFingerprint,
    metadata: normalizeMetadata(draft.metadata),
  };
}

export function forecastAthenaEvent(
  environment: AthenaForecastEnvironment,
  draft: AthenaForecastInput | AthenaForecastInputDraft,
  options: AthenaForecastOptions = {},
): AthenaEventForecastResult {
  const started = monotonicNowMs();
  const input = createAthenaForecastInput(draft, environment);
  const timestamp = options.timestamp ?? input.timestamp;
  const versions = versionSnapshot(environment);
  const maxDepth = clampDepth(options.maxDepth);
  const cacheKey = forecastCacheKey(input, versions, maxDepth);
  const forecastId = `athena-forecast:${normalizeIdPart(input.eventId)}:${stableHash(cacheKey)}`;

  if (!EVENT_CATEGORY_SET.has(input.eventCategory)) {
    return emptyForecastResult({
      input,
      versions,
      id: forecastId,
      cacheKey,
      timestamp,
      validity: "invalid",
      maxDepth,
      durationMs: monotonicNowMs() - started,
      error: "Forecast input contains an unsupported event category.",
      cacheHit: Boolean(options.cacheHit),
    });
  }

  if (options.cancellation?.cancelled) {
    return emptyForecastResult({
      input,
      versions,
      id: forecastId,
      cacheKey,
      timestamp,
      validity: "cancelled",
      maxDepth,
      durationMs: monotonicNowMs() - started,
      error: options.cancellation.reason ?? "Forecast was cancelled.",
      cacheHit: Boolean(options.cacheHit),
    });
  }

  const versionWarning = validateForecastVersions(input, environment);
  if (versionWarning) {
    const result = emptyForecastResult({
      input,
      versions,
      id: forecastId,
      cacheKey,
      timestamp,
      validity: "stale",
      maxDepth,
      durationMs: monotonicNowMs() - started,
      error: versionWarning,
      cacheHit: Boolean(options.cacheHit),
    });
    return {
      ...result,
      warnings: [
        warning("stale-version", versionWarning, null, null, input.eventId),
      ],
      semanticDescriptions: [versionWarning],
    };
  }

  try {
    const replacementProcessing = processAthenaReplacementEffects(
      environment,
      input,
      {
        timestamp,
        cancellation: options.cancellation,
        forecastReference: forecastId,
      },
    );
    const analysisInput =
      replacementProcessing.finalEvent ?? replacementProcessing.originalEvent;
    const direct = analyzeDirectConsequences(environment, analysisInput);
    if (input.quantity <= 0) {
      direct.warnings.push(
        warning(
          "invalid-quantity",
          "A positive event quantity is required before consequences can be forecast.",
          null,
          null,
          input.eventId,
        ),
      );
      direct.choices.push({
        id: `athena-forecast-choice:quantity:${normalizeIdPart(input.eventId)}`,
        kind: "quantity",
        prompt: "How many objects are involved?",
        sourceRelationshipId: null,
        sourceGroupId: null,
        candidateGroupIds: [],
        eventCategories: [input.eventCategory],
        requiredBeforeAccurateForecast: true,
        requiredBeforeCommit: true,
      });
    }

    if (options.cancellation?.cancelled) {
      return emptyForecastResult({
        input,
        versions,
        id: forecastId,
        cacheKey,
        timestamp,
        validity: "cancelled",
        maxDepth,
        durationMs: monotonicNowMs() - started,
        error: options.cancellation.reason ?? "Forecast was cancelled.",
        cacheHit: Boolean(options.cacheHit),
      });
    }

    const query = createAthenaEffectRelationshipQueryApi(
      environment.relationshipMap,
      environment.graph,
    );
    const seedEntries = seedExplorationEntries(
      analysisInput,
      direct.generatedEvents,
    );
    const directReplacements = replacementFindingsFromProcessing(
      replacementProcessing,
    );
    const hasUnresolvedReplacement = directReplacements.some(
      (replacement) => replacement.applied === false,
    );
    const explorationSeedEntries = hasUnresolvedReplacement
      ? markReplacementDependentEntries(
          seedEntries,
          directReplacements,
          analysisInput,
        )
      : seedEntries;
    const totalChanges = hasUnresolvedReplacement
      ? markReplacementDependentTotals(
          analysisInput,
          direct.totalChanges,
          directReplacements,
        )
      : direct.totalChanges;
    const exploration = exploreRelationships({
      environment,
      input: analysisInput,
      seedEntries: explorationSeedEntries,
      maxDepth,
      cancellation: options.cancellation,
    });
    const followUpReplacements =
      maxDepth > 0
        ? discoverReplacements(
            exploration.generatedEvents.map((event) => ({
              category: event.category,
              relationshipDepth: event.depth + 1,
              generatedDepth: event.depth,
              path: event.path,
              quantity: event.quantity,
              certainty: event.certainty,
              sourceRelationshipId: event.sourceRelationshipId,
            })),
            query,
          )
        : [];
    const replacements = uniqueById([
      ...directReplacements,
      ...followUpReplacements,
    ]);
    const directGeneratedEvents = hasUnresolvedReplacement
      ? markReplacementDependentGeneratedEvents(
          direct.generatedEvents,
          directReplacements,
          analysisInput,
        )
      : direct.generatedEvents;
    const allGeneratedEvents = uniqueGeneratedEvents([
      ...directGeneratedEvents,
      ...exploration.generatedEvents,
    ]).filter((event) => event.depth <= maxDepth);
    const staticDependencies =
      maxDepth > 0 ? discoverStaticDependencies(totalChanges, query) : [];
    const relationshipChoices = collectRelationshipChoices(
      environment.relationshipMap,
      exploration.relationships,
      replacements,
    );
    const choices = uniqueChoices([
      ...direct.choices,
      ...relationshipChoices,
      ...replacementChoicesFromProcessing(replacementProcessing),
      ...replacementOrderChoices(replacements, analysisInput),
    ]);
    const warnings = uniqueWarnings([
      ...direct.warnings,
      ...warningsForRelationships(exploration.relationships),
      ...warningsForReplacements(replacements),
      ...replacementWarningsFromProcessing(replacementProcessing),
      ...warningsForUnsupportedSources(
        environment.relationshipMap,
        analysisInput,
      ),
    ]);
    const validity: AthenaForecastValidity =
      input.quantity <= 0
        ? "unresolved"
        : replacementProcessing.validity === "cancelled"
          ? "cancelled"
          : replacementProcessing.validity === "stale"
            ? "stale"
            : replacementProcessing.finalEvent === null
              ? "unresolved"
              : exploration.cancelled
                ? "cancelled"
                : "valid";
    const directConsequences = replaceTotalConsequences(
      direct.consequences,
      totalChanges,
    );
    const optionalRelationshipIds = uniqueStrings(
      exploration.relationships
        .filter((relationship) => relationship.optional)
        .map((relationship) => relationship.relationshipId),
    );
    const manualResolutionRelationshipIds = uniqueStrings([
      ...exploration.relationships
        .filter((relationship) => relationship.requiresManualResolution)
        .map((relationship) => relationship.relationshipId),
      ...replacements
        .filter(
          (relationship) =>
            relationship.certainty === "manual-resolution-dependent",
        )
        .map((relationship) => relationship.relationshipId),
    ]);
    const authorityRequiredRelationshipIds = uniqueStrings([
      ...exploration.relationships
        .filter((relationship) => relationship.requiresAuthority)
        .map((relationship) => relationship.relationshipId),
      ...replacements
        .filter((relationship) => relationship.requiresAuthority)
        .map((relationship) => relationship.relationshipId),
    ]);
    const unsupportedRelationshipIds = uniqueStrings([
      ...exploration.relationships
        .filter((relationship) => relationship.certainty === "unsupported")
        .map((relationship) => relationship.relationshipId),
      ...unsupportedRelationshipsForInput(
        environment.relationshipMap,
        input,
      ).map((relationship) => relationship.id),
      ...replacementProcessing.applicableDefinitions
        .filter((definition) => definition.support === "unsupported-effect")
        .map((definition) => definition.relationshipId),
      ...replacements
        .filter((relationship) => relationship.certainty === "unsupported")
        .map((relationship) => relationship.relationshipId),
    ]);
    const durationMs = monotonicNowMs() - started;
    const result: AthenaEventForecastResult = {
      version: ATHENA_EVENT_FORECAST_VERSION,
      id: forecastId,
      cacheKey,
      createdAt: timestamp,
      updatedAt: timestamp,
      validity,
      input,
      versions,
      authoritySource: input.authoritySource,
      authorityPrecedence: input.authorityPrecedence,
      confirmedInput: {
        classification: "confirmed-input",
        eventCategory: input.eventCategory,
        quantity: input.quantity,
        description: confirmedInputDescription(input),
      },
      directConsequences,
      relevantTotalChanges: totalChanges,
      triggerRelationships: exploration.relationships,
      replacementRelationships: replacements,
      replacementProcessing,
      staticDependencies,
      potentialGeneratedEvents: allGeneratedEvents,
      potentialCharacteristicChanges: directConsequences.filter(
        (consequence) => consequence.kind === "transformation",
      ),
      potentialCounterChanges: directConsequences.filter(
        (consequence) => consequence.kind === "counter",
      ),
      potentialTokenChanges: directConsequences.filter(
        (consequence) => consequence.kind === "token-group",
      ),
      potentialLifeChanges: directConsequences.filter(
        (consequence) => consequence.kind === "life",
      ),
      potentialCommanderDamageChanges: directConsequences.filter(
        (consequence) => consequence.kind === "commander-damage",
      ),
      potentialZoneChanges: directConsequences.filter(
        (consequence) => consequence.kind === "zone",
      ),
      potentialStackImplications: directConsequences.filter(
        (consequence) => consequence.kind === "stack-implication",
      ),
      requiredChoices: choices,
      optionalRelationshipIds,
      manualResolutionRelationshipIds,
      authorityRequiredRelationshipIds,
      unsupportedRelationshipIds,
      warnings,
      semanticDescriptions: semanticDescriptions({
        input,
        replacementProcessing,
        totalChanges,
        relationships: exploration.relationships,
        replacements,
        staticDependencies,
        choices,
        warnings,
      }),
      forecastDepth: maxDepth,
      lifecycle: [
        {
          validity,
          reason:
            validity === "valid"
              ? "Consequence forecast completed without committing state."
              : (options.cancellation?.reason ??
                "Forecast requires additional information."),
          timestamp,
        },
      ],
      diagnostics: createForecastDiagnostics({
        durationMs,
        directConsequences,
        relationships: exploration.relationships,
        replacements,
        staticDependencies,
        generatedEvents: allGeneratedEvents,
        choices,
        authorityRequiredRelationshipIds,
        unsupportedRelationshipIds,
        maxDepth,
        cacheHit: Boolean(options.cacheHit),
        cancelled: validity === "cancelled",
        staleResultRejected: false,
        error: null,
      }),
      committedStateReadOnly: true,
      previewStateIsolated: true,
      committedResultShape: false,
      directBattlefieldMutation: false,
      canonicalStateMutated: false,
    };
    return result;
  } catch (error) {
    return emptyForecastResult({
      input,
      versions,
      id: forecastId,
      cacheKey,
      timestamp,
      validity: "unresolved",
      maxDepth,
      durationMs: monotonicNowMs() - started,
      error:
        error instanceof Error ? error.message : "Forecast analysis failed.",
      cacheHit: Boolean(options.cacheHit),
    });
  }
}

export class AthenaForecastCancellationController {
  private readonly signalState = {
    cancelled: false,
    reason: null as string | null,
  };
  readonly signal: AthenaForecastCancellationSignal = this.signalState;

  cancel(reason = "Forecast was cancelled."): void {
    this.signalState.cancelled = true;
    this.signalState.reason = reason;
  }
}

export function createAthenaForecastCancellationController(): {
  signal: AthenaForecastCancellationSignal;
  cancel(reason?: string): void;
} {
  const controller = new AthenaForecastCancellationController();
  return {
    signal: controller.signal,
    cancel(reason = "Forecast was cancelled.") {
      controller.cancel(reason);
    },
  };
}

export class AthenaEventForecastEngine {
  private readonly cache = new Map<string, AthenaEventForecastResult>();
  private readonly forecasts = new Map<string, AthenaEventForecastResult>();
  private readonly activeByScope = new Map<string, string>();
  private readonly maxCacheEntries: number;
  private readonly maxForecastRecords: number;
  private readonly maxDepth: number;
  private forecastCount = 0;
  private invalidatedForecastCount = 0;
  private totalAnalysisDurationMs = 0;
  private maximumAnalysisDurationMs = 0;
  private cacheHitCount = 0;
  private cacheMissCount = 0;
  private cancellationCount = 0;
  private staleResultRejectionCount = 0;
  private lastForecastError: string | null = null;

  constructor(options: AthenaForecastEngineOptions = {}) {
    this.maxCacheEntries = finiteInteger(options.maxCacheEntries, 1, 200, 30);
    this.maxForecastRecords = finiteInteger(
      options.maxForecastRecords,
      1,
      1000,
      120,
    );
    this.maxDepth = clampDepth(options.maxDepth);
  }

  forecast(
    field: FieldState,
    draft: AthenaForecastInput | AthenaForecastInputDraft,
    options: ForecastRequestOptions = {},
  ): AthenaEventForecastResult {
    const environment = options.environment ?? createForecastEnvironment(field);
    const input = createAthenaForecastInput(draft, environment);
    const maxDepth = clampDepth(options.maxDepth ?? this.maxDepth);
    const versions = versionSnapshot(environment);
    const cacheKey = forecastCacheKey(input, versions, maxDepth);
    const scope = forecastScope(input);
    const previousId = this.activeByScope.get(scope);
    if (previousId) {
      const previous = this.forecasts.get(previousId);
      if (previous?.validity === "valid" && previous.cacheKey !== cacheKey) {
        this.storeInvalidated(
          previous,
          "A newer forecast replaced this input.",
          options.timestamp ?? input.timestamp,
          "stale",
        );
      }
    }

    const cached = this.cache.get(cacheKey);
    let result: AthenaEventForecastResult;
    if (cached?.validity === "valid") {
      this.cacheHitCount += 1;
      result = {
        ...cached,
        diagnostics: { ...cached.diagnostics, cacheHit: true },
      };
    } else {
      this.cacheMissCount += 1;
      result = forecastAthenaEvent(environment, input, {
        ...options,
        maxDepth,
        cacheHit: false,
      });
      if (result.validity === "valid") this.putCache(cacheKey, result);
    }

    this.forecastCount += 1;
    this.totalAnalysisDurationMs += result.diagnostics.analysisDurationMs;
    this.maximumAnalysisDurationMs = Math.max(
      this.maximumAnalysisDurationMs,
      result.diagnostics.analysisDurationMs,
    );
    if (result.validity === "cancelled") this.cancellationCount += 1;
    this.lastForecastError = result.diagnostics.lastForecastError;
    this.storeForecast(result);
    if (result.validity === "valid") this.activeByScope.set(scope, result.id);
    return result;
  }

  getForecast(id: string): AthenaEventForecastResult | null {
    return this.forecasts.get(id) ?? null;
  }

  cancelForecast(
    id: string,
    reason = "Forecast was cancelled.",
    timestamp?: string,
  ): AthenaEventForecastResult | null {
    const result = this.forecasts.get(id);
    if (!result || result.validity === "cancelled") return result ?? null;
    this.cancellationCount += 1;
    return this.storeInvalidated(
      result,
      reason,
      timestamp ?? result.updatedAt,
      "cancelled",
    );
  }

  invalidate(
    input: AthenaForecastInvalidationInput,
  ): AthenaEventForecastResult[] {
    const invalidated: AthenaEventForecastResult[] = [];
    for (const result of this.forecasts.values()) {
      if (result.validity !== "valid") continue;
      if (!forecastAffectedByChange(result, input)) continue;
      invalidated.push(
        this.storeInvalidated(
          result,
          input.change.reason ??
            `Forecast invalidated by ${input.change.kind}.`,
          input.timestamp ?? result.updatedAt,
          "stale",
        ),
      );
    }
    return invalidated.sort((a, b) => a.id.localeCompare(b.id));
  }

  clearDerivedCache(): void {
    this.cache.clear();
  }

  clearInactiveForecasts(): void {
    const activeIds = new Set(this.activeByScope.values());
    for (const id of this.forecasts.keys()) {
      if (!activeIds.has(id)) this.forecasts.delete(id);
    }
  }

  dispose(): void {
    this.cache.clear();
    this.forecasts.clear();
    this.activeByScope.clear();
  }

  getDiagnostics(): AthenaForecastEngineDiagnostics {
    return {
      version: ATHENA_EVENT_FORECAST_VERSION,
      forecastCount: this.forecastCount,
      activeForecastCount: [...this.forecasts.values()].filter(
        (forecast) => forecast.validity === "valid",
      ).length,
      invalidatedForecastCount: this.invalidatedForecastCount,
      averageAnalysisDurationMs:
        this.forecastCount === 0
          ? 0
          : this.totalAnalysisDurationMs / this.forecastCount,
      maximumAnalysisDurationMs: this.maximumAnalysisDurationMs,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
      cancellationCount: this.cancellationCount,
      staleResultRejectionCount: this.staleResultRejectionCount,
      lastForecastError: this.lastForecastError,
      productionVisible: false,
    };
  }

  private storeInvalidated(
    result: AthenaEventForecastResult,
    reason: string,
    timestamp: string,
    validity: "stale" | "cancelled",
  ): AthenaEventForecastResult {
    const updated: AthenaEventForecastResult = {
      ...result,
      validity,
      updatedAt: timestamp,
      lifecycle: [...result.lifecycle, { validity, reason, timestamp }],
      diagnostics: {
        ...result.diagnostics,
        cancelled: validity === "cancelled",
        staleResultRejected: validity === "stale",
      },
    };
    this.forecasts.set(result.id, updated);
    this.cache.delete(result.cacheKey);
    if (validity === "stale") {
      this.invalidatedForecastCount += 1;
      this.staleResultRejectionCount += 1;
    }
    for (const [scope, activeId] of this.activeByScope) {
      if (activeId === result.id) this.activeByScope.delete(scope);
    }
    return updated;
  }

  private putCache(key: string, result: AthenaEventForecastResult): void {
    this.cache.set(key, result);
    while (this.cache.size > this.maxCacheEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (typeof oldestKey !== "string") break;
      this.cache.delete(oldestKey);
    }
  }

  private storeForecast(result: AthenaEventForecastResult): void {
    this.forecasts.set(result.id, result);
    while (this.forecasts.size > this.maxForecastRecords) {
      const activeIds = new Set(this.activeByScope.values());
      const removableId = [...this.forecasts.keys()].find(
        (id) => !activeIds.has(id) && id !== result.id,
      );
      if (!removableId) break;
      this.forecasts.delete(removableId);
    }
  }
}

export const athenaEventForecastEngine = new AthenaEventForecastEngine();

export function createForecastEnvironment(
  field: FieldState,
): AthenaForecastEnvironment {
  const context = createAthenaAwarenessContext(field, {
    timestamp: field.updatedAt,
  });
  const graph = buildAthenaDependencyGraphFromContext(context, {
    field,
    timestamp: field.updatedAt,
  });
  const relationshipMap = buildAthenaEffectRelationshipMapFromContext(
    context,
    graph,
    { timestamp: field.updatedAt },
  );
  return { context, graph, relationshipMap };
}

export function createAthenaForecastInputFromEchoIntent(
  adapter: AthenaEchoForecastAdapterInput,
): AthenaForecastInput {
  return createInputFromIntent(
    adapter.context,
    adapter.graph,
    adapter.relationshipMap,
    adapter.intent,
    adapter.options,
  );
}

export function createAthenaForecastInputFromGameEvent(
  adapter: AthenaGameEventForecastAdapterInput,
): AthenaForecastInput {
  const metadata = normalizeMetadata(adapter.event.metadata);
  const authoritySource =
    adapter.authoritySource ?? "confirmed-canonical-session-result";
  const lifeDelta =
    adapter.event.type === "life-gained"
      ? adapter.event.quantity
      : adapter.event.type === "life-lost"
        ? -adapter.event.quantity
        : null;
  return createAthenaForecastInput(
    {
      eventId: adapter.event.id,
      eventCategory: adapter.event.type,
      eventSource:
        adapter.eventSource ??
        (authoritySource === "boardstate-authoritative-result"
          ? "boardstate-result"
          : "canonical-event"),
      authoritySource,
      timestamp: adapter.timestamp ?? adapter.context.createdAt,
      batchId: adapter.event.batchId,
      sourceObjectId: adapter.event.sourceId,
      subjectGroupIds: adapter.event.groupIds,
      quantity: adapter.event.quantity,
      knownCharacteristics: adapter.event.characteristics
        ? {
            ...adapter.event.characteristics,
            isToken:
              adapter.event.token ??
              adapter.event.characteristics.isToken ??
              false,
          }
        : adapter.event.token
          ? { isToken: true }
          : null,
      zoneOrigin: adapter.event.zoneOrigin,
      zoneDestination: adapter.event.zoneDestination,
      counterType: nullableText(metadata.counterType ?? metadata.counterName),
      lifeDelta,
      commanderDamageDelta: adapter.event.commanderDamage
        ? adapter.event.quantity
        : null,
      canonicalResultReference: adapter.canonicalResultReference,
      metadata: {
        ...metadata,
        controller: adapter.event.controller,
        owner: adapter.event.owner,
        combatDamage: Boolean(adapter.event.combatDamage),
        canonicalEvent: true,
      },
    },
    {
      context: adapter.context,
      graph: adapter.graph,
      relationshipMap: adapter.relationshipMap,
    },
  );
}

export function createAthenaForecastInputFromPlannerAction(
  adapter: AthenaPlannerForecastAdapterInput,
): AthenaForecastInput {
  const options = adapter.options ?? {};
  const relatedGroupIds = adapter.action.relatedGroupId
    ? [adapter.action.relatedGroupId]
    : [];
  return createAthenaForecastInput(
    {
      eventId: `planner:${adapter.action.id}:${adapter.action.updatedAt}`,
      eventCategory: eventCategoryForIntentKind(
        adapter.action.actionStrip.intentKind,
        {},
      ),
      eventSource: "planner",
      authoritySource: options.authoritySource ?? "project-echo-planned-action",
      timestamp: options.timestamp ?? adapter.action.updatedAt,
      quantity: options.quantity ?? plannerQuantity(adapter.action),
      subjectGroupIds: relatedGroupIds,
      knownCharacteristics: options.knownCharacteristics,
      plannerReference: adapter.action.id,
      metadata: {
        title: adapter.action.title,
        actionType: adapter.action.type,
        hypothetical: true,
        ...options.metadata,
      },
    },
    {
      context: adapter.context,
      graph: adapter.graph,
      relationshipMap: adapter.relationshipMap,
    },
  );
}

export function createAthenaForecastInputFromActionStripItem(
  adapter: AthenaActionStripForecastAdapterInput,
): AthenaForecastInput {
  const options = adapter.options ?? {};
  const intent = adapter.item.intent;
  const entities = intent.entities ?? [];
  return createAthenaForecastInput(
    {
      eventId: `action-strip:${adapter.item.id}:${adapter.item.updatedAt}`,
      eventCategory: eventCategoryForIntentKind(
        adapter.item.intentKind,
        intent.payload ?? {},
      ),
      eventSource: "action-strip",
      authoritySource: options.authoritySource ?? "project-echo-planned-action",
      timestamp: options.timestamp ?? adapter.item.updatedAt,
      quantity:
        options.quantity ?? numericPayload(intent.payload, "quantity", 1),
      subjectGroupIds: groupIdsFromEntities(entities),
      subjectObjectIds: objectIdsFromEntities(entities),
      zoneOrigin: zoneFromEntities(entities, "origin"),
      zoneDestination: zoneFromEntities(entities, "destination"),
      counterType: counterFromEntities(entities),
      knownCharacteristics: options.knownCharacteristics,
      actionStripReference: adapter.item.id,
      metadata: {
        label: adapter.item.label,
        actionKind: adapter.item.kind,
        hypothetical: true,
        ...options.metadata,
      },
    },
    {
      context: adapter.context,
      graph: adapter.graph,
      relationshipMap: adapter.relationshipMap,
    },
  );
}

export function invalidateAthenaForecast(
  result: AthenaEventForecastResult,
  input: AthenaForecastInvalidationInput,
): AthenaEventForecastResult {
  if (!forecastAffectedByChange(result, input)) return result;
  const timestamp = input.timestamp ?? result.updatedAt;
  const reason =
    input.change.reason ?? `Forecast invalidated by ${input.change.kind}.`;
  return {
    ...result,
    validity: "stale",
    updatedAt: timestamp,
    lifecycle: [...result.lifecycle, { validity: "stale", reason, timestamp }],
    diagnostics: {
      ...result.diagnostics,
      staleResultRejected: true,
    },
  };
}

export function isAthenaForecastCurrent(
  result: AthenaEventForecastResult,
  versions: AthenaForecastVersionSnapshot,
): boolean {
  return (
    result.validity === "valid" &&
    result.versions.awarenessContextFingerprint ===
      versions.awarenessContextFingerprint &&
    result.versions.dependencyGraphFingerprint ===
      versions.dependencyGraphFingerprint &&
    result.versions.relationshipMapFingerprint ===
      versions.relationshipMapFingerprint
  );
}

function analyzeDirectConsequences(
  environment: AthenaForecastEnvironment,
  input: AthenaForecastInput,
): DirectAnalysis {
  const consequences: AthenaForecastDirectConsequence[] = [];
  const totalDeltas = new Map<RelevantTotalKey, number>();
  const totalReasons = new Map<RelevantTotalKey, AthenaForecastReasonCode[]>();
  const generatedEvents: AthenaForecastGeneratedEvent[] = [];
  const choices: AthenaForecastChoiceRequirement[] = [];
  const warnings: AthenaForecastWarning[] = [];
  const quantity = input.quantity;
  if (quantity === 0) {
    return {
      consequences,
      totalChanges: [],
      generatedEvents,
      choices,
      warnings,
    };
  }
  const subjectObjects = input.subjectGroupIds
    .map((groupId) =>
      environment.context.battlefield.find(
        (object) => object.groupId === groupId,
      ),
    )
    .filter((object): object is AthenaAwarenessContext["battlefield"][number] =>
      Boolean(object),
    );

  if (
    input.subjectGroupIds.length > 0 &&
    subjectObjects.length !== input.subjectGroupIds.length
  ) {
    warnings.push(
      warning(
        "missing-object",
        "One or more referenced battlefield objects are no longer available.",
        null,
        input.subjectGroupIds.find(
          (id) => !subjectObjects.some((object) => object.groupId === id),
        ) ?? null,
        input.eventId,
      ),
    );
  }
  const availableObjectIds = new Set(
    environment.context.battlefield.flatMap((object) => object.objectIds),
  );
  const missingObjectId = input.subjectObjectIds.find(
    (objectId) => !availableObjectIds.has(objectId),
  );
  if (missingObjectId) {
    warnings.push(
      warning(
        "missing-object",
        "A referenced battlefield object is no longer available.",
        null,
        null,
        missingObjectId,
      ),
    );
  }
  if (ENTER_EVENTS.has(input.eventCategory)) {
    const suppliedCharacteristics =
      input.tokenDefinition?.characteristics ??
      input.knownCharacteristics ??
      knownCharacteristicsFromAwarenessObject(subjectObjects[0]);
    const characteristics =
      suppliedCharacteristics ??
      inferredCharacteristicsForEvent(input.eventCategory);
    const characteristicsComplete = hasCompleteEntryCharacteristics(
      suppliedCharacteristics,
    );
    if (characteristics) {
      for (const total of relevantTotalsForForecastCharacteristics(
        characteristics,
      )) {
        addTotalDelta(
          totalDeltas,
          totalReasons,
          total,
          quantity,
          "known-characteristics",
        );
      }
    } else {
      warnings.push(
        warning(
          "manual-resolution-required",
          "Object characteristics are required to forecast overlapping totals.",
          null,
          null,
          input.eventId,
        ),
      );
    }
    if (!characteristicsComplete) {
      const tokenEvent =
        input.eventCategory === "token-created" ||
        input.eventCategory === "token-entered" ||
        characteristics?.isToken === true;
      choices.push({
        id: `athena-forecast-choice:characteristics:${normalizeIdPart(input.eventId)}`,
        kind: tokenEvent ? "token-definition" : "object",
        prompt: tokenEvent
          ? "Token characteristics are required to forecast all affected totals."
          : "Object characteristics are required to forecast all affected totals.",
        sourceRelationshipId: null,
        sourceGroupId: input.subjectGroupIds[0] ?? null,
        candidateGroupIds: input.subjectGroupIds,
        eventCategories: [input.eventCategory],
        requiredBeforeAccurateForecast: true,
        requiredBeforeCommit: false,
      });
      warnings.push(
        warning(
          "choice-missing",
          "Some overlapping totals remain unknown until object characteristics are supplied.",
          null,
          input.subjectGroupIds[0] ?? null,
          input.eventId,
        ),
      );
    }
    consequences.push(
      directConsequence(input, {
        kind: "battlefield-quantity",
        description: `${quantity} object(s) would enter the personal battlefield.`,
        quantity,
        delta: quantity,
        reasonCodes: ["input-event", "grouped-quantity"],
      }),
    );
    if (
      input.eventCategory === "token-created" ||
      input.eventCategory === "token-entered" ||
      characteristics?.isToken
    ) {
      consequences.push(
        directConsequence(input, {
          kind: "token-group",
          description: `The grouped token quantity would increase by ${quantity}.`,
          quantity,
          delta: quantity,
          grouped: true,
          reasonCodes: ["grouped-quantity"],
        }),
      );
      generatedEvents.push(
        structuralGeneratedEvent(
          input,
          "token-entered",
          !characteristicsComplete,
          1,
        ),
      );
      if (characteristics?.cardTypes.includes("Creature")) {
        generatedEvents.push(
          structuralGeneratedEvent(
            input,
            "creature-entered",
            !characteristicsComplete,
            1,
          ),
        );
      }
    }
  }

  if (LEAVE_EVENTS.has(input.eventCategory)) {
    const contributionDeltas = contributionDeltasForSubjects(
      environment.graph,
      subjectObjects,
      quantity,
    );
    for (const [total, delta] of contributionDeltas) {
      addTotalDelta(
        totalDeltas,
        totalReasons,
        total,
        -delta,
        "canonical-contribution-relationship",
      );
    }
    consequences.push(
      directConsequence(input, {
        kind:
          input.eventCategory === "token-removed"
            ? "token-group"
            : "battlefield-quantity",
        description: `${quantity} object(s) would leave the personal battlefield.`,
        quantity,
        delta: -quantity,
        grouped: input.eventCategory === "token-removed",
        reasonCodes: ["input-event", "grouped-quantity"],
      }),
    );
  }

  if (
    input.eventCategory === "counter-placed" ||
    input.eventCategory === "counter-removed"
  ) {
    if (!input.counterType) {
      choices.push({
        id: `athena-forecast-choice:counter:${normalizeIdPart(input.eventId)}`,
        kind: "counter-type",
        prompt: "Which counter type is changing?",
        sourceRelationshipId: null,
        sourceGroupId: input.subjectGroupIds[0] ?? null,
        candidateGroupIds: input.subjectGroupIds,
        eventCategories: [input.eventCategory],
        requiredBeforeAccurateForecast: true,
        requiredBeforeCommit: true,
      });
    }
    const delta =
      input.eventCategory === "counter-placed" ? quantity : -quantity;
    consequences.push(
      directConsequence(input, {
        kind: "counter",
        description: `${Math.abs(delta)} ${input.counterType ?? "counter"}(s) would be ${delta > 0 ? "placed" : "removed"}.`,
        quantity,
        delta,
        counterType: input.counterType,
        reasonCodes: ["counter-change"],
      }),
    );
  }

  if (
    input.eventCategory === "life-gained" ||
    input.eventCategory === "life-lost"
  ) {
    const delta =
      input.lifeDelta ??
      (input.eventCategory === "life-gained" ? quantity : -quantity);
    consequences.push(
      directConsequence(input, {
        kind: "life",
        description: `Life would ${delta >= 0 ? "increase" : "decrease"} by ${Math.abs(delta)}.`,
        quantity: Math.abs(delta),
        delta,
        reasonCodes: ["life-change"],
      }),
    );
  }

  if (input.commanderDamageDelta !== null) {
    consequences.push(
      directConsequence(input, {
        kind: "commander-damage",
        description: `Commander damage would change by ${input.commanderDamageDelta}.`,
        quantity: Math.abs(input.commanderDamageDelta),
        delta: input.commanderDamageDelta,
        reasonCodes: ["commander-damage-change"],
      }),
    );
  }

  if (input.zoneOrigin || input.zoneDestination) {
    consequences.push(
      directConsequence(input, {
        kind: "zone",
        description: `${quantity} object(s) would move from ${input.zoneOrigin ?? "an unknown zone"} to ${input.zoneDestination ?? "an unknown zone"}.`,
        quantity,
        delta: quantity,
        zoneOrigin: input.zoneOrigin,
        zoneDestination: input.zoneDestination,
        reasonCodes: ["zone-transition"],
      }),
    );
    addZoneTotalDeltas(input, totalDeltas, totalReasons);
  }

  if (input.eventCategory === "permanent-transformed") {
    const source = subjectObjects[0] ?? null;
    const next = input.knownCharacteristics;
    if (source && next) {
      const previousTotals = getAthenaRelevantTotalsForSubject(source);
      const nextTotals = getAthenaRelevantTotalsForSubject({
        zone: source.zone,
        cardTypes: next.cardTypes,
        subtypes: next.subtypes,
        supertypes: next.supertypes,
        isToken: next.isToken,
      });
      for (const total of previousTotals.filter(
        (total) => !nextTotals.includes(total),
      )) {
        addTotalDelta(
          totalDeltas,
          totalReasons,
          total,
          -source.quantity,
          "transformation",
        );
      }
      for (const total of nextTotals.filter(
        (total) => !previousTotals.includes(total),
      )) {
        addTotalDelta(
          totalDeltas,
          totalReasons,
          total,
          source.quantity,
          "transformation",
        );
      }
      consequences.push(
        directConsequence(input, {
          kind: "transformation",
          description: `${source.label} would retain identity while its characteristics change.`,
          quantity: source.quantity,
          delta: 0,
          reasonCodes: ["transformation"],
        }),
      );
    } else {
      choices.push({
        id: `athena-forecast-choice:transform:${normalizeIdPart(input.eventId)}`,
        kind: "object",
        prompt:
          "The transformed object and its new characteristics are required.",
        sourceRelationshipId: null,
        sourceGroupId: input.subjectGroupIds[0] ?? null,
        candidateGroupIds: input.subjectGroupIds,
        eventCategories: [input.eventCategory],
        requiredBeforeAccurateForecast: true,
        requiredBeforeCommit: true,
      });
    }
  }

  if (
    subjectObjects.length === 1 &&
    quantity > 0 &&
    quantity < subjectObjects[0].quantity
  ) {
    consequences.push(
      directConsequence(input, {
        kind: "stack-implication",
        description: `A future confirmed action may need to split ${quantity} from the existing grouped stack.`,
        quantity,
        delta: 0,
        grouped: true,
        requiresFutureSplit: true,
        reasonCodes: ["grouped-quantity"],
      }),
    );
  }

  for (const [total, delta] of Object.entries(
    input.relevantTotalImplications,
  ) as Array<[RelevantTotalKey, number]>) {
    totalDeltas.set(total, delta);
    totalReasons.set(total, [
      "explicit-total-implication",
      ...(input.authoritySource === "boardstate-authoritative-result"
        ? (["authoritative-input"] as AthenaForecastReasonCode[])
        : []),
    ]);
  }

  const totalsByKey = new Map(
    environment.context.relevantTotals.map((total) => [total.key, total.value]),
  );
  const totalChanges = [...totalDeltas.entries()]
    .filter(([, delta]) => delta !== 0)
    .map(([key, delta]) => {
      const currentValue = totalsByKey.get(key) ?? 0;
      return {
        id: `athena-forecast-total:${normalizeIdPart(input.eventId)}:${key}`,
        key,
        currentValue,
        baseDelta: delta,
        forecastDelta: delta,
        forecastValue: currentValue + delta,
        quantityAware: true as const,
        provisional: false,
        certainty: "deterministic" as const,
        reasonCodes: uniqueReasonCodes(totalReasons.get(key) ?? []),
      };
    })
    .sort((a, b) => a.key.localeCompare(b.key));

  return {
    consequences: [
      ...consequences,
      ...totalChanges.map((change) => totalConsequence(input, change)),
    ].sort((a, b) => a.id.localeCompare(b.id)),
    totalChanges,
    generatedEvents: uniqueGeneratedEvents(generatedEvents),
    choices: uniqueChoices(choices),
    warnings: uniqueWarnings(warnings),
  };
}

function discoverReplacements(
  entries: EventExplorationEntry[],
  query: ReturnType<typeof createAthenaEffectRelationshipQueryApi>,
): AthenaForecastReplacementFinding[] {
  const findings: AthenaForecastReplacementFinding[] = [];
  for (const entry of entries) {
    const relationships = query
      .getReplacementEffectsModifyingEvent(entry.category)
      .filter(isRelevantSourceRelationship);
    const overlap = relationships.length > 1;
    for (const relationship of relationships) {
      findings.push({
        id: `athena-forecast-replacement:${normalizeIdPart(relationship.id)}:${entry.category}`,
        relationshipId: relationship.id,
        sourceGroupId: relationship.source.battlefieldObjectGroupId,
        sourceLabel:
          relationship.source.currentCardFace ??
          relationship.source.abilityIdentifier,
        eventCategory: entry.category,
        modificationCategory: replacementModificationCategory(
          entry.category,
          relationship.modificationCategory,
        ),
        certainty: relationshipCertainty(relationship, entry.certainty),
        optional: relationship.optional,
        overlapping: overlap,
        orderingMayMatter: overlap || relationship.optional,
        applied: false,
        quantityBefore: null,
        quantityAfter: null,
        replacementStepId: null,
        requiresAuthority: relationship.requiresAuthority,
        reasonCodes: uniqueReasonCodes([
          "replacement-discovered",
          "replacement-unresolved",
          ...(relationship.requiresAuthority
            ? (["authority-required"] as AthenaForecastReasonCode[])
            : []),
        ]),
        description: `${relationship.source.currentCardFace ?? "A replacement effect"} may modify ${entry.category}; the replacement is not applied by this forecast.`,
      });
    }
  }
  return uniqueById(findings);
}

function replacementFindingsFromProcessing(
  processing: AthenaReplacementProcessingResult,
): AthenaForecastReplacementFinding[] {
  const stepsByRelationship = new Map<
    string,
    AthenaReplacementProcessingResult["steps"]
  >();
  for (const step of processing.steps) {
    const steps = stepsByRelationship.get(step.relationshipId) ?? [];
    steps.push(step);
    stepsByRelationship.set(step.relationshipId, steps);
  }

  const overlap = processing.applicableDefinitions.length > 1;
  const findings: AthenaForecastReplacementFinding[] = [];
  for (const definition of processing.applicableDefinitions) {
    const steps = stepsByRelationship.get(definition.relationshipId) ?? [];
    if (steps.length > 0) {
      for (const step of steps) {
        findings.push({
          id: `athena-forecast-replacement:${normalizeIdPart(step.id)}`,
          relationshipId: step.relationshipId,
          sourceGroupId: step.sourceGroupId,
          sourceLabel: step.sourceLabel,
          eventCategory: step.eventCategoryBefore,
          modificationCategory: replacementModificationCategory(
            step.eventCategoryBefore,
            step.modificationCategory,
          ),
          certainty: "deterministic",
          optional: definition.optional,
          overlapping: overlap,
          orderingMayMatter: overlap && !definition.commutative,
          applied: true,
          quantityBefore: step.quantityBefore,
          quantityAfter: step.quantityAfter,
          replacementStepId: step.id,
          requiresAuthority: false,
          reasonCodes: ["replacement-discovered", "replacement-applied"],
          description: step.explanation,
        });
      }
      continue;
    }

    const requiresAuthority =
      definition.requiresAuthority ||
      processing.validity === "authority-required";
    const requiresManual =
      definition.requiresManualResolution ||
      processing.validity === "manual-required" ||
      processing.validity === "loop-detected" ||
      processing.validity === "overflow";
    findings.push({
      id: `athena-forecast-replacement:${normalizeIdPart(definition.relationshipId)}:${processing.originalEvent.eventCategory}`,
      relationshipId: definition.relationshipId,
      sourceGroupId: definition.sourceGroupId,
      sourceLabel: definition.sourceLabel,
      eventCategory: processing.originalEvent.eventCategory,
      modificationCategory: definition.modification.category,
      certainty: requiresAuthority
        ? "authority-dependent"
        : requiresManual
          ? "manual-resolution-dependent"
          : definition.optional
            ? "optional"
            : "replacement-dependent",
      optional: definition.optional,
      overlapping: overlap,
      orderingMayMatter: overlap && !definition.commutative,
      applied: false,
      quantityBefore: processing.originalEvent.quantity,
      quantityAfter: null,
      replacementStepId: null,
      requiresAuthority,
      reasonCodes: uniqueReasonCodes([
        "replacement-discovered",
        "replacement-unresolved",
        ...(requiresAuthority
          ? (["authority-required"] as AthenaForecastReasonCode[])
          : []),
        ...(requiresManual
          ? (["manual-resolution-required"] as AthenaForecastReasonCode[])
          : []),
        ...(definition.optional
          ? (["optional-effect"] as AthenaForecastReasonCode[])
          : []),
      ]),
      description: `${definition.sourceLabel} may modify ${processing.originalEvent.eventCategory}; a final modified event is not yet available.`,
    });
  }
  for (const excluded of processing.excludedReplacements) {
    if (
      excluded.reason !== "invalid-definition" &&
      excluded.reason !== "unsupported" &&
      excluded.reason !== "manual-required" &&
      excluded.reason !== "authority-required"
    ) {
      continue;
    }
    const requiresAuthority = excluded.reason === "authority-required";
    const unsupported =
      excluded.reason === "invalid-definition" ||
      excluded.reason === "unsupported";
    findings.push({
      id: `athena-forecast-replacement:${normalizeIdPart(excluded.id)}`,
      relationshipId: excluded.relationshipId,
      sourceGroupId: excluded.sourceGroupId,
      sourceLabel: excluded.sourceLabel,
      eventCategory: processing.originalEvent.eventCategory,
      modificationCategory: "unknown",
      certainty: requiresAuthority
        ? "authority-dependent"
        : unsupported
          ? "unsupported"
          : "manual-resolution-dependent",
      optional: false,
      overlapping: processing.applicableDefinitions.length > 0,
      orderingMayMatter: false,
      applied: false,
      quantityBefore: processing.originalEvent.quantity,
      quantityAfter: null,
      replacementStepId: null,
      requiresAuthority,
      reasonCodes: uniqueReasonCodes([
        "replacement-discovered",
        "replacement-unresolved",
        ...(requiresAuthority
          ? (["authority-required"] as AthenaForecastReasonCode[])
          : []),
        ...(unsupported
          ? (["unsupported-effect"] as AthenaForecastReasonCode[])
          : (["manual-resolution-required"] as AthenaForecastReasonCode[])),
      ]),
      description: excluded.explanation,
    });
  }
  return uniqueById(findings);
}

function exploreRelationships(input: {
  environment: AthenaForecastEnvironment;
  input: AthenaForecastInput;
  seedEntries: EventExplorationEntry[];
  maxDepth: number;
  cancellation?: AthenaForecastCancellationSignal;
}): {
  relationships: AthenaForecastRelationshipFinding[];
  generatedEvents: AthenaForecastGeneratedEvent[];
  cancelled: boolean;
} {
  if (input.input.eventSource === "correction-only") {
    return { relationships: [], generatedEvents: [], cancelled: false };
  }
  const query = createAthenaEffectRelationshipQueryApi(
    input.environment.relationshipMap,
    input.environment.graph,
  );
  const queue = [...input.seedEntries];
  const visited = new Set<string>();
  const relationships: AthenaForecastRelationshipFinding[] = [];
  const generatedEvents: AthenaForecastGeneratedEvent[] = [];

  while (queue.length > 0) {
    if (input.cancellation?.cancelled) {
      return {
        relationships: uniqueById(relationships),
        generatedEvents: uniqueGeneratedEvents(generatedEvents),
        cancelled: true,
      };
    }
    const entry = queue.shift();
    if (!entry || entry.relationshipDepth > input.maxDepth) continue;
    const visitKey = `${entry.category}:${entry.relationshipDepth}:${entry.path.join(">")}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);
    const mapped = query
      .getTriggersObservingEvent(entry.category)
      .filter(isRelevantSourceRelationship);
    for (const relationship of mapped) {
      const finding = relationshipFinding(relationship, entry);
      relationships.push(finding);
      if (entry.relationshipDepth >= input.maxDepth) continue;
      for (const generated of relationship.generatedEvents) {
        const certainty = generatedCertainty(relationship, entry.certainty);
        const event: AthenaForecastGeneratedEvent = {
          id: `athena-forecast-generated:${normalizeIdPart(input.input.eventId)}:${stableHash(`${relationship.id}:${generated.category}:${entry.path.join(">")}`)}`,
          category: generated.category,
          sourceRelationshipId: relationship.id,
          parentEventCategory: entry.category,
          depth: entry.relationshipDepth,
          path: [...entry.path, generated.category],
          quantity:
            finding.instanceCount !== null &&
            relationship.relationshipMetadata.helper ===
              "life-on-creature-entry"
              ? finding.instanceCount
              : null,
          certainty,
          classification: "potential-follow-up",
          optional: relationship.optional || generated.optional,
          requiresChoice:
            relationship.requiredChoices.length > 0 || generated.requiresChoice,
          replacementDependent: entry.certainty === "replacement-dependent",
          bounded: true,
          description: generated.label,
          reasonCodes: uniqueReasonCodes([
            "generated-event",
            "bounded-depth",
            ...(relationship.optional
              ? (["optional-effect"] as AthenaForecastReasonCode[])
              : []),
          ]),
        };
        generatedEvents.push(event);
        queue.push({
          category: generated.category,
          relationshipDepth: entry.relationshipDepth + 1,
          generatedDepth: event.depth,
          path: event.path,
          quantity: event.quantity,
          certainty,
          sourceRelationshipId: relationship.id,
        });
      }
    }
  }
  return {
    relationships: uniqueById(relationships),
    generatedEvents: uniqueGeneratedEvents(generatedEvents),
    cancelled: false,
  };
}

function discoverStaticDependencies(
  totalChanges: AthenaForecastRelevantTotalChange[],
  query: ReturnType<typeof createAthenaEffectRelationshipQueryApi>,
): AthenaForecastStaticDependency[] {
  const grouped = new Map<string, AthenaForecastStaticDependency>();
  for (const total of totalChanges) {
    for (const relationship of query
      .getStaticEffectsReadingValue(total.key)
      .filter(isRelevantSourceRelationship)) {
      const key = `${relationship.source.definitionIdentifier}:${total.key}`;
      const existing = grouped.get(key);
      if (existing) {
        existing.relationshipIds = uniqueStrings([
          ...existing.relationshipIds,
          relationship.id,
        ]);
        continue;
      }
      grouped.set(key, {
        id: `athena-forecast-static:${normalizeIdPart(key)}`,
        relationshipIds: [relationship.id],
        sourceGroupId: relationship.source.battlefieldObjectGroupId,
        sourceLabel:
          relationship.source.currentCardFace ??
          relationship.source.abilityIdentifier,
        relevantTotal: total.key,
        currentObservedValue: total.currentValue,
        forecastObservedValue: total.forecastValue,
        observedDelta: total.forecastDelta,
        characteristic: characteristicForRelationship(relationship),
        recalculationRequired: true,
        committed: false,
        certainty: total.certainty,
        reasonCodes: ["static-dependency-invalidated"],
        description: `${relationship.source.currentCardFace ?? "A static effect"} would require recalculation because ${total.key} changes.`,
      });
    }
  }
  return [...grouped.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function relationshipFinding(
  relationship: AthenaMappedEffectRelationship,
  entry: EventExplorationEntry,
): AthenaForecastRelationshipFinding {
  const multiplicity = triggerMultiplicity(relationship);
  const instanceCount =
    entry.certainty === "replacement-dependent"
      ? null
      : triggerInstanceCount(multiplicity, entry.quantity, relationship);
  const multiplicityRequiresManualResolution =
    multiplicity === "unknown" && (entry.quantity ?? 0) > 1;
  const certainty = multiplicityRequiresManualResolution
    ? "manual-resolution-dependent"
    : relationshipCertainty(relationship, entry.certainty);
  return {
    id: `athena-forecast-trigger:${normalizeIdPart(relationship.id)}:${entry.category}:${entry.relationshipDepth}`,
    relationshipId: relationship.id,
    category: relationship.category,
    state: relationship.state,
    classification: classificationForCertainty(certainty),
    certainty,
    sourceGroupId: relationship.source.battlefieldObjectGroupId,
    sourceLabel:
      relationship.source.currentCardFace ??
      relationship.source.abilityIdentifier,
    observedEvent: entry.category,
    depth: entry.relationshipDepth,
    instanceCount,
    multiplicity,
    optional: relationship.optional,
    requiresChoice: relationship.requiredChoices.length > 0,
    requiresAuthority: relationship.requiresAuthority,
    requiresManualResolution:
      relationship.requiresManualResolution ||
      multiplicityRequiresManualResolution,
    generatedEventCategories: relationship.generatedEventCategories,
    affectedGroupIds: relationship.targetGroupIds,
    reasonCodes: uniqueReasonCodes([
      "trigger-observed",
      ...(relationship.optional
        ? (["optional-effect"] as AthenaForecastReasonCode[])
        : []),
      ...(relationship.requiresAuthority
        ? (["authority-required"] as AthenaForecastReasonCode[])
        : []),
      ...(relationship.requiresManualResolution
        ? (["manual-resolution-required"] as AthenaForecastReasonCode[])
        : []),
      ...(multiplicityRequiresManualResolution
        ? (["manual-resolution-required"] as AthenaForecastReasonCode[])
        : []),
    ]),
    description: `${relationship.source.currentCardFace ?? "An effect"} cares about ${entry.category}.`,
  };
}

function collectRelationshipChoices(
  relationshipMap: AthenaEffectRelationshipMap,
  findings: AthenaForecastRelationshipFinding[],
  replacements: AthenaForecastReplacementFinding[],
): AthenaForecastChoiceRequirement[] {
  const ids = new Set([
    ...findings.map((finding) => finding.relationshipId),
    ...replacements.map((finding) => finding.relationshipId),
  ]);
  return relationshipMap.relationships
    .filter((relationship) => ids.has(relationship.id))
    .flatMap((relationship) =>
      relationship.requiredChoices.map((choice) =>
        forecastChoiceFromMappedChoice(choice, relationship),
      ),
    );
}

function replacementOrderChoices(
  replacements: AthenaForecastReplacementFinding[],
  input: AthenaForecastInput,
): AthenaForecastChoiceRequirement[] {
  const byEvent = new Map<
    AthenaEventCategory,
    AthenaForecastReplacementFinding[]
  >();
  for (const replacement of replacements.filter((entry) => !entry.applied)) {
    const entries = byEvent.get(replacement.eventCategory) ?? [];
    entries.push(replacement);
    byEvent.set(replacement.eventCategory, entries);
  }
  return [...byEvent.entries()]
    .filter(([, entries]) => entries.length > 1)
    .map(([eventCategory, entries]) => ({
      id: `athena-forecast-choice:replacement-order:${normalizeIdPart(input.eventId)}:${eventCategory}`,
      kind: "replacement-order" as const,
      prompt:
        "Replacement ordering must be confirmed before a final quantity can be calculated.",
      sourceRelationshipId: entries[0].relationshipId,
      sourceGroupId: entries[0].sourceGroupId,
      candidateGroupIds: uniqueStrings(
        entries.flatMap((entry) =>
          entry.sourceGroupId ? [entry.sourceGroupId] : [],
        ),
      ),
      eventCategories: [eventCategory],
      requiredBeforeAccurateForecast: true,
      requiredBeforeCommit: true,
    }));
}

function replacementChoicesFromProcessing(
  processing: AthenaReplacementProcessingResult,
): AthenaForecastChoiceRequirement[] {
  return processing.requiredChoices.map((choice) => ({
    id: `athena-forecast-choice:${normalizeIdPart(choice.id)}`,
    kind: choice.kind === "scope" ? "target" : choice.kind,
    prompt: choice.prompt,
    sourceRelationshipId: choice.relationshipIds[0] ?? null,
    sourceGroupId: choice.sourceGroupIds[0] ?? null,
    candidateGroupIds: [...choice.sourceGroupIds],
    eventCategories: [processing.originalEvent.eventCategory],
    requiredBeforeAccurateForecast: true,
    requiredBeforeCommit: true,
  }));
}

function markReplacementDependentTotals(
  input: AthenaForecastInput,
  totals: AthenaForecastRelevantTotalChange[],
  replacements: AthenaForecastReplacementFinding[],
): AthenaForecastRelevantTotalChange[] {
  const replacementAffectsQuantity = replacements.some(
    (replacement) =>
      replacement.eventCategory === input.eventCategory ||
      replacement.eventCategory === "token-created" ||
      replacement.eventCategory === "counter-placed",
  );
  if (!replacementAffectsQuantity) return totals;
  return totals.map((total) => ({
    ...total,
    forecastDelta: null,
    forecastValue: null,
    provisional: true,
    certainty: "replacement-dependent",
    reasonCodes: uniqueReasonCodes([
      ...total.reasonCodes,
      "replacement-unresolved",
    ]),
  }));
}

function markReplacementDependentEntries(
  entries: EventExplorationEntry[],
  replacements: AthenaForecastReplacementFinding[],
  input: AthenaForecastInput,
): EventExplorationEntry[] {
  const affected = new Set(
    replacements.map((replacement) => replacement.eventCategory),
  );
  if (!affected.has(input.eventCategory)) return entries;
  return entries.map((entry) => ({
    ...entry,
    certainty:
      entry.category === input.eventCategory
        ? entry.certainty
        : "replacement-dependent",
  }));
}

function markReplacementDependentGeneratedEvents(
  events: AthenaForecastGeneratedEvent[],
  replacements: AthenaForecastReplacementFinding[],
  input: AthenaForecastInput,
): AthenaForecastGeneratedEvent[] {
  if (
    !replacements.some(
      (replacement) => replacement.eventCategory === input.eventCategory,
    )
  ) {
    return events;
  }
  return events.map((event) => ({
    ...event,
    certainty: "replacement-dependent",
    replacementDependent: true,
    reasonCodes: uniqueReasonCodes([
      ...event.reasonCodes,
      "replacement-unresolved",
    ]),
  }));
}

function replaceTotalConsequences(
  consequences: AthenaForecastDirectConsequence[],
  totals: AthenaForecastRelevantTotalChange[],
): AthenaForecastDirectConsequence[] {
  return [
    ...consequences.filter(
      (consequence) => consequence.kind !== "relevant-total",
    ),
    ...totals.map((total) => ({
      id: `athena-forecast-consequence:total:${total.id}`,
      kind: "relevant-total" as const,
      classification: "forecasted-consequence" as const,
      certainty: total.certainty,
      description:
        total.forecastDelta === null
          ? `${total.key} would change, but its final value depends on unresolved replacements.`
          : `${total.key} would change by ${total.forecastDelta}.`,
      quantity: Math.abs(total.baseDelta),
      groupIds: [],
      objectIds: [],
      relevantTotal: total.key,
      currentValue: total.currentValue,
      forecastValue: total.forecastValue,
      delta: total.forecastDelta,
      counterType: null,
      zoneOrigin: null,
      zoneDestination: null,
      grouped: true,
      requiresFutureSplit: false,
      reasonCodes: total.reasonCodes,
    })),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

function seedExplorationEntries(
  input: AthenaForecastInput,
  structuralEvents: AthenaForecastGeneratedEvent[],
): EventExplorationEntry[] {
  if (input.quantity === 0) return [];
  const seeds: EventExplorationEntry[] = [
    {
      category: input.eventCategory,
      relationshipDepth: 1,
      generatedDepth: 0,
      path: [input.eventCategory],
      quantity: input.quantity,
      certainty: "deterministic",
      sourceRelationshipId: null,
    },
  ];
  if (
    input.eventCategory === "creature-entered" ||
    input.eventCategory === "land-entered" ||
    input.eventCategory === "token-entered"
  ) {
    seeds.push({
      category: "permanent-entered",
      relationshipDepth: 1,
      generatedDepth: 0,
      path: [input.eventCategory, "permanent-entered"],
      quantity: input.quantity,
      certainty: "deterministic",
      sourceRelationshipId: null,
    });
  }
  for (const event of structuralEvents) {
    if (event.category === input.eventCategory) continue;
    seeds.push({
      category: event.category,
      relationshipDepth: 1,
      generatedDepth: event.depth,
      path: event.path,
      quantity: event.quantity,
      certainty: event.certainty,
      sourceRelationshipId: event.sourceRelationshipId,
    });
  }
  const byKey = new Map<string, EventExplorationEntry>();
  for (const seed of seeds) {
    const key = `${seed.category}:${seed.relationshipDepth}`;
    if (!byKey.has(key)) byKey.set(key, seed);
  }
  return [...byKey.values()].sort((a, b) =>
    `${a.relationshipDepth}:${a.category}`.localeCompare(
      `${b.relationshipDepth}:${b.category}`,
    ),
  );
}

function structuralGeneratedEvent(
  input: AthenaForecastInput,
  category: AthenaEventCategory,
  requiresChoice: boolean,
  depth: number,
): AthenaForecastGeneratedEvent {
  return {
    id: `athena-forecast-generated:${normalizeIdPart(input.eventId)}:structural:${category}`,
    category,
    sourceRelationshipId: null,
    parentEventCategory: input.eventCategory,
    depth,
    path: [input.eventCategory, category],
    quantity: input.quantity,
    certainty: "deterministic",
    classification: "potential-follow-up",
    optional: false,
    requiresChoice,
    replacementDependent: false,
    bounded: true,
    description: `${category} may follow from the confirmed ${input.eventCategory} input.`,
    reasonCodes: ["generated-event", "bounded-depth"],
  };
}

function contributionDeltasForSubjects(
  graph: AthenaDependencyGraph,
  subjects: AthenaAwarenessContext["battlefield"],
  requestedQuantity: number,
): Map<RelevantTotalKey, number> {
  const deltas = new Map<RelevantTotalKey, number>();
  if (subjects.length === 0) return deltas;
  const totalAvailable = subjects.reduce(
    (sum, subject) => sum + subject.quantity,
    0,
  );
  const quantity = Math.min(requestedQuantity, totalAvailable);
  let remaining = quantity;
  for (const subject of subjects) {
    if (remaining <= 0) break;
    const removed = Math.min(subject.quantity, remaining);
    const contributorRelationships = graph.relationships.filter(
      (relationship) =>
        relationship.type === "contributes-to" &&
        relationship.sourceGroupId === subject.groupId,
    );
    for (const relationship of contributorRelationships) {
      for (const total of relationship.relevantTotals) {
        deltas.set(total, (deltas.get(total) ?? 0) + removed);
      }
    }
    remaining -= removed;
  }
  return deltas;
}

function addZoneTotalDeltas(
  input: AthenaForecastInput,
  deltas: Map<RelevantTotalKey, number>,
  reasons: Map<RelevantTotalKey, AthenaForecastReasonCode[]>,
): void {
  const originTotal = totalForZone(input.zoneOrigin);
  const destinationTotal = totalForZone(input.zoneDestination);
  if (originTotal) {
    addTotalDelta(
      deltas,
      reasons,
      originTotal,
      -input.quantity,
      "zone-transition",
    );
  }
  if (destinationTotal) {
    addTotalDelta(
      deltas,
      reasons,
      destinationTotal,
      input.quantity,
      "zone-transition",
    );
  }
}

function totalForZone(zone: Zone | null): RelevantTotalKey | null {
  if (zone === "hand") return "cardsInHand";
  if (zone === "graveyard") return "cardsInGraveyard";
  if (zone === "exile") return "cardsInExile";
  if (zone === "library") return "cardsRemainingInLibrary";
  return null;
}

function addTotalDelta(
  deltas: Map<RelevantTotalKey, number>,
  reasons: Map<RelevantTotalKey, AthenaForecastReasonCode[]>,
  key: RelevantTotalKey,
  delta: number,
  reason: AthenaForecastReasonCode,
): void {
  deltas.set(key, (deltas.get(key) ?? 0) + delta);
  reasons.set(key, uniqueReasonCodes([...(reasons.get(key) ?? []), reason]));
}

function totalConsequence(
  input: AthenaForecastInput,
  change: AthenaForecastRelevantTotalChange,
): AthenaForecastDirectConsequence {
  return directConsequence(input, {
    kind: "relevant-total",
    description: `${change.key} would change by ${change.baseDelta}.`,
    quantity: Math.abs(change.baseDelta),
    delta: change.forecastDelta,
    relevantTotal: change.key,
    currentValue: change.currentValue,
    forecastValue: change.forecastValue,
    reasonCodes: change.reasonCodes,
  });
}

function directConsequence(
  input: AthenaForecastInput,
  values: Partial<AthenaForecastDirectConsequence> &
    Pick<
      AthenaForecastDirectConsequence,
      "kind" | "description" | "quantity" | "delta" | "reasonCodes"
    >,
): AthenaForecastDirectConsequence {
  return {
    id: `athena-forecast-consequence:${normalizeIdPart(input.eventId)}:${values.kind}:${stableHash(values.description)}`,
    kind: values.kind,
    classification: "forecasted-consequence",
    certainty: values.certainty ?? "deterministic",
    description: values.description,
    quantity: values.quantity,
    groupIds: values.groupIds ?? input.subjectGroupIds,
    objectIds: values.objectIds ?? input.subjectObjectIds,
    relevantTotal: values.relevantTotal ?? null,
    currentValue: values.currentValue ?? null,
    forecastValue: values.forecastValue ?? null,
    delta: values.delta,
    counterType: values.counterType ?? null,
    zoneOrigin: values.zoneOrigin ?? input.zoneOrigin,
    zoneDestination: values.zoneDestination ?? input.zoneDestination,
    grouped: values.grouped ?? input.quantity > 1,
    requiresFutureSplit: values.requiresFutureSplit ?? false,
    reasonCodes: uniqueReasonCodes(values.reasonCodes),
  };
}

function createInputFromIntent(
  context: AthenaAwarenessContext,
  graph: AthenaDependencyGraph,
  relationshipMap: AthenaEffectRelationshipMap,
  intent: AmbientIntent,
  options: AthenaForecastAdapterOptions = {},
): AthenaForecastInput {
  const quantity =
    options.quantity ??
    numericPayload(
      intent.payload,
      "quantity",
      numericPayload(intent.payload, "amount", 1),
    );
  const knownCharacteristics =
    options.knownCharacteristics ??
    characteristicsFromReferencedGroup(
      context,
      groupIdsFromEntities(intent.entities)[0],
    );
  const eventCategory = eventCategoryForIntentKind(intent.kind, intent.payload);
  const authoritySource =
    options.authoritySource ?? authorityForIntentSource(intent.source);
  const delta = numericPayload(intent.payload, "delta", quantity);
  return createAthenaForecastInput(
    {
      eventId: intent.id,
      eventCategory,
      eventSource: forecastSourceForIntent(intent.source),
      authoritySource,
      timestamp: options.timestamp ?? intent.createdAt,
      quantity,
      subjectGroupIds: groupIdsFromEntities(intent.entities),
      subjectObjectIds: objectIdsFromEntities(intent.entities),
      zoneOrigin: zoneFromEntities(intent.entities, "origin"),
      zoneDestination: zoneFromEntities(intent.entities, "destination"),
      counterType:
        counterFromEntities(intent.entities) ??
        nullableText(intent.payload.counterName),
      knownCharacteristics,
      lifeDelta:
        intent.kind === "modify-life"
          ? intent.payload.mode === "loss" ||
            intent.payload.direction === "loss"
            ? -Math.abs(delta)
            : delta
          : null,
      commanderDamageDelta:
        intent.kind === "modify-commander-damage" ? Math.abs(delta) : null,
      echoIntentReference: intent.id,
      metadata: {
        intentKind: intent.kind,
        intentSource: intent.source,
        correlationId: intent.correlationId,
        hypothetical:
          intent.source === "turn-planner" ||
          intent.source === "combat-preview",
        ...options.metadata,
      },
      confidence: {
        level: intent.confidence.level,
        score: intent.confidence.score,
        speakerVerified:
          intent.source === "voice-command" &&
          intent.payload.speakerVerified === true
            ? true
            : null,
      },
    },
    { context, graph, relationshipMap },
  );
}

function eventCategoryForIntentKind(
  kind: AmbientIntentKind,
  payload: Record<string, unknown>,
): AthenaEventCategory {
  switch (kind) {
    case "play-land":
      return "land-entered";
    case "cast-spell":
      return "spell-cast";
    case "draw-cards":
      return "cards-drawn";
    case "discard-cards":
      return "cards-discarded";
    case "create-token":
      return "token-created";
    case "add-counters":
      return "counter-placed";
    case "remove-counters":
      return "counter-removed";
    case "modify-life":
      return payload.mode === "loss" || payload.direction === "loss"
        ? "life-lost"
        : "life-gained";
    case "modify-commander-damage":
      return "damage-dealt";
    case "attack":
      return "attack-declared";
    case "tap":
      return "permanent-tapped";
    case "untap":
      return "permanent-untapped";
    case "destroy-permanent":
      return "permanent-died";
    case "sacrifice-permanent":
      return "permanent-sacrificed";
    case "exile-permanent":
      return "permanent-exiled";
    case "return-permanent":
      return payload.destination === "hand"
        ? "permanent-returned-to-hand"
        : "permanent-returned-to-battlefield";
    case "transform-permanent":
      return "permanent-transformed";
    case "activate-ability":
      return "trigger-announced";
    default:
      return "trigger-announced";
  }
}

function forecastSourceForIntent(
  source: AmbientIntentSource,
): AthenaForecastInputSource {
  if (source === "turn-planner" || source === "combat-preview") {
    return "echo-planned";
  }
  if (source === "voice-command" || source === "contextual-listening") {
    return "echo-reported";
  }
  if (source === "user-correction") return "correction-only";
  if (source === "manual") return "manual-report";
  return "preview-only";
}

function authorityForIntentSource(
  source: AmbientIntentSource,
): AthenaAuthoritySource {
  if (source === "turn-planner" || source === "combat-preview") {
    return "project-echo-planned-action";
  }
  if (source === "voice-command" || source === "contextual-listening") {
    return "project-echo-voice-report";
  }
  if (source === "user-correction") return "correction-only";
  if (source === "manual") return "confirmed-user-report";
  return "lite-preview";
}

function plannerQuantity(action: PlannedAction): number {
  if (action.type === "land-play") return 1;
  const match = action.title.match(/\b(\d+)\b/);
  return match ? finiteInteger(Number(match[1]), 1, 999999999, 1) : 1;
}

function groupIdsFromEntities(entities: AmbientEntityReference[]): string[] {
  return uniqueStrings(
    entities.flatMap((entity) => (entity.kind === "group" ? [entity.id] : [])),
  );
}

function objectIdsFromEntities(entities: AmbientEntityReference[]): string[] {
  return uniqueStrings(
    entities.flatMap((entity) => (entity.kind === "object" ? [entity.id] : [])),
  );
}

function zoneFromEntities(
  entities: AmbientEntityReference[],
  role: "origin" | "destination",
): Zone | null {
  return (
    (
      entities.find(
        (entity) => entity.kind === "zone" && entity.role === role,
      ) as Extract<AmbientEntityReference, { kind: "zone" }> | undefined
    )?.zone ?? null
  );
}

function counterFromEntities(
  entities: AmbientEntityReference[],
): string | null {
  return (
    (
      entities.find((entity) => entity.kind === "counter") as
        | Extract<AmbientEntityReference, { kind: "counter" }>
        | undefined
    )?.name ?? null
  );
}

function characteristicsFromReferencedGroup(
  context: AthenaAwarenessContext,
  groupId: string | undefined,
): Partial<Characteristics> | null {
  const object = context.battlefield.find((entry) => entry.groupId === groupId);
  if (!object) return null;
  return {
    cardTypes: object.cardTypes,
    supertypes: object.supertypes,
    subtypes: object.subtypes,
    colors: [],
    manaValue: 0,
    isToken: object.isToken,
    isCreature: object.isCreature,
    isLegendary: object.supertypes.includes("Legendary"),
  };
}

function knownCharacteristicsFromAwarenessObject(
  object: AthenaAwarenessContext["battlefield"][number] | undefined,
): AthenaForecastKnownCharacteristics | null {
  if (!object) return null;
  return {
    cardTypes: object.cardTypes,
    supertypes: object.supertypes,
    subtypes: object.subtypes,
    colors: [],
    manaValue: null,
    isToken: object.isToken,
    isCreature: object.isCreature,
    isLegendary: object.supertypes.includes("Legendary"),
    knownFields: [...CHARACTERISTIC_FIELDS],
  };
}

function versionSnapshot(
  environment: AthenaForecastEnvironment,
): AthenaForecastVersionSnapshot {
  return {
    awarenessContextVersion: environment.context.version,
    awarenessContextFingerprint: awarenessFingerprint(environment.context),
    dependencyGraphVersion: environment.graph.version,
    dependencyGraphFingerprint: environment.graph.fingerprint,
    relationshipMapVersion: environment.relationshipMap.version,
    relationshipMapFingerprint: environment.relationshipMap.fingerprint,
  };
}

function awarenessFingerprint(context: AthenaAwarenessContext): string {
  return stableHash(
    serializeStable({
      fieldId: context.fieldId,
      sessionId: context.sessionId,
      createdAt: context.createdAt,
      battlefield: context.battlefield.map((object) => ({
        groupId: object.groupId,
        objectIds: object.objectIds,
        quantity: object.quantity,
        zone: object.zone,
        trackingEnabled: object.trackingEnabled,
        depowerMode: object.depowerMode,
        transformed: object.lineage.transformed,
        counters: object.counters,
        attachments: object.attachments,
      })),
      totals: context.relevantTotals,
      authority: context.currentAuthoritySource,
    }),
  );
}

function validateForecastVersions(
  input: AthenaForecastInput,
  environment: AthenaForecastEnvironment,
): string | null {
  if (input.canonicalSessionId !== environment.context.sessionId) {
    return "Forecast input belongs to a different canonical session.";
  }
  if (input.awarenessContextVersion !== environment.context.version) {
    return "Forecast awareness-context version is stale.";
  }
  if (
    input.awarenessContextFingerprint !==
    awarenessFingerprint(environment.context)
  ) {
    return "Forecast awareness-context fingerprint is stale.";
  }
  if (input.dependencyGraphVersion !== environment.graph.version) {
    return "Forecast dependency-graph version is stale.";
  }
  if (input.dependencyGraphFingerprint !== environment.graph.fingerprint) {
    return "Forecast dependency-graph fingerprint is stale.";
  }
  if (input.relationshipMapVersion !== environment.relationshipMap.version) {
    return "Forecast relationship-map version is stale.";
  }
  if (
    input.relationshipMapFingerprint !== environment.relationshipMap.fingerprint
  ) {
    return "Forecast relationship-map fingerprint is stale.";
  }
  return null;
}

function forecastCacheKey(
  input: AthenaForecastInput,
  versions: AthenaForecastVersionSnapshot,
  depth: number,
): string {
  return stableHash(
    serializeStable({
      cacheVersion: ATHENA_EVENT_FORECAST_CACHE_VERSION,
      input,
      versions,
      depth,
    }),
  );
}

function forecastScope(input: AthenaForecastInput): string {
  return input.canonicalSessionId;
}

function forecastAffectedByChange(
  result: AthenaEventForecastResult,
  input: AthenaForecastInvalidationInput,
): boolean {
  if (result.validity !== "valid") return false;
  if (BROAD_INVALIDATION_KINDS.has(input.change.kind)) return true;
  if (
    input.currentVersions &&
    Object.entries(input.currentVersions).some(
      ([key, value]) =>
        value !== undefined &&
        result.versions[key as keyof AthenaForecastVersionSnapshot] !== value,
    )
  ) {
    return true;
  }
  const groupIds = new Set([
    ...result.input.subjectGroupIds,
    ...result.triggerRelationships.flatMap(
      (relationship) => relationship.affectedGroupIds,
    ),
    ...result.triggerRelationships.flatMap((relationship) =>
      relationship.sourceGroupId ? [relationship.sourceGroupId] : [],
    ),
  ]);
  const relationshipIds = new Set([
    ...result.triggerRelationships.map(
      (relationship) => relationship.relationshipId,
    ),
    ...result.replacementRelationships.map(
      (relationship) => relationship.relationshipId,
    ),
    ...result.staticDependencies.flatMap(
      (relationship) => relationship.relationshipIds,
    ),
  ]);
  const totalKeys = new Set(
    result.relevantTotalChanges.map((change) => change.key),
  );
  if (input.change.groupIds?.some((id) => groupIds.has(id))) return true;
  if (input.change.relationshipIds?.some((id) => relationshipIds.has(id))) {
    return true;
  }
  if (input.change.relevantTotals?.some((key) => totalKeys.has(key))) {
    return true;
  }
  if (
    input.change.eventCategories?.includes(result.input.eventCategory) ||
    input.change.kind === "preview-invalidation" ||
    input.change.kind === "echo-staged-intent-changed"
  ) {
    return true;
  }
  return false;
}

function emptyForecastResult(input: {
  input: AthenaForecastInput;
  versions: AthenaForecastVersionSnapshot;
  id: string;
  cacheKey: string;
  timestamp: string;
  validity: AthenaForecastValidity;
  maxDepth: number;
  durationMs: number;
  error: string;
  cacheHit: boolean;
}): AthenaEventForecastResult {
  const diagnostics = createForecastDiagnostics({
    durationMs: input.durationMs,
    directConsequences: [],
    relationships: [],
    replacements: [],
    staticDependencies: [],
    generatedEvents: [],
    choices: [],
    authorityRequiredRelationshipIds: [],
    unsupportedRelationshipIds: [],
    maxDepth: input.maxDepth,
    cacheHit: input.cacheHit,
    cancelled: input.validity === "cancelled",
    staleResultRejected: input.validity === "stale",
    error: input.error,
  });
  return {
    version: ATHENA_EVENT_FORECAST_VERSION,
    id: input.id,
    cacheKey: input.cacheKey,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    validity: input.validity,
    input: input.input,
    versions: input.versions,
    authoritySource: input.input.authoritySource,
    authorityPrecedence: input.input.authorityPrecedence,
    confirmedInput: {
      classification: "confirmed-input",
      eventCategory: input.input.eventCategory,
      quantity: input.input.quantity,
      description: confirmedInputDescription(input.input),
    },
    directConsequences: [],
    relevantTotalChanges: [],
    triggerRelationships: [],
    replacementRelationships: [],
    replacementProcessing: null,
    staticDependencies: [],
    potentialGeneratedEvents: [],
    potentialCharacteristicChanges: [],
    potentialCounterChanges: [],
    potentialTokenChanges: [],
    potentialLifeChanges: [],
    potentialCommanderDamageChanges: [],
    potentialZoneChanges: [],
    potentialStackImplications: [],
    requiredChoices: [],
    optionalRelationshipIds: [],
    manualResolutionRelationshipIds: [],
    authorityRequiredRelationshipIds: [],
    unsupportedRelationshipIds: [],
    warnings: [
      warning(
        input.validity === "cancelled" ? "cancelled" : "invalid-event",
        input.error,
        null,
        null,
        input.input.eventId,
      ),
    ],
    semanticDescriptions: [input.error],
    forecastDepth: input.maxDepth,
    lifecycle: [
      {
        validity: input.validity,
        reason: input.error,
        timestamp: input.timestamp,
      },
    ],
    diagnostics,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    committedResultShape: false,
    directBattlefieldMutation: false,
    canonicalStateMutated: false,
  };
}

function createForecastDiagnostics(input: {
  durationMs: number;
  directConsequences: AthenaForecastDirectConsequence[];
  relationships: AthenaForecastRelationshipFinding[];
  replacements: AthenaForecastReplacementFinding[];
  staticDependencies: AthenaForecastStaticDependency[];
  generatedEvents: AthenaForecastGeneratedEvent[];
  choices: AthenaForecastChoiceRequirement[];
  authorityRequiredRelationshipIds: string[];
  unsupportedRelationshipIds: string[];
  maxDepth: number;
  cacheHit: boolean;
  cancelled: boolean;
  staleResultRejected: boolean;
  error: string | null;
}): AthenaEventForecastDiagnostics {
  return {
    forecastVersion: ATHENA_EVENT_FORECAST_VERSION,
    cacheVersion: ATHENA_EVENT_FORECAST_CACHE_VERSION,
    analysisDurationMs: input.durationMs,
    directConsequenceCount: input.directConsequences.length,
    triggerRelationshipCount: input.relationships.length,
    replacementRelationshipCount: input.replacements.length,
    staticInvalidationCount: input.staticDependencies.length,
    generatedEventCount: input.generatedEvents.length,
    choiceRequirementCount: input.choices.length,
    authorityRequiredCount: input.authorityRequiredRelationshipIds.length,
    unsupportedConsequenceCount: input.unsupportedRelationshipIds.length,
    forecastDepth: input.maxDepth,
    cacheHit: input.cacheHit,
    cancelled: input.cancelled,
    staleResultRejected: input.staleResultRejected,
    lastForecastError: input.error,
    productionVisible: false,
    directBattlefieldMutation: false,
  };
}

function semanticDescriptions(input: {
  input: AthenaForecastInput;
  replacementProcessing: AthenaReplacementProcessingResult;
  totalChanges: AthenaForecastRelevantTotalChange[];
  relationships: AthenaForecastRelationshipFinding[];
  replacements: AthenaForecastReplacementFinding[];
  staticDependencies: AthenaForecastStaticDependency[];
  choices: AthenaForecastChoiceRequirement[];
  warnings: AthenaForecastWarning[];
}): string[] {
  return uniqueStrings([
    confirmedInputDescription(input.input),
    ...input.replacementProcessing.semanticDescriptions,
    ...input.totalChanges.map((change) =>
      change.forecastDelta === null
        ? `${readableTotal(change.key)} would change, but unresolved replacement effects prevent a final value.`
        : `${readableTotal(change.key)} would ${change.forecastDelta >= 0 ? "increase" : "decrease"} by ${Math.abs(change.forecastDelta)}.`,
    ),
    ...input.relationships.map((relationship) =>
      relationship.optional
        ? `${relationship.sourceLabel} may trigger when ${readableEvent(relationship.observedEvent)}.`
        : `${relationship.sourceLabel} would become relevant when ${readableEvent(relationship.observedEvent)}.`,
    ),
    ...input.replacements.map((replacement) =>
      replacement.applied
        ? replacement.description
        : `${replacement.sourceLabel} may modify this ${readableEvent(replacement.eventCategory)} event.`,
    ),
    ...input.staticDependencies.map(
      (dependency) =>
        `${dependency.sourceLabel} would require recalculation because ${readableTotal(dependency.relevantTotal)} changes.`,
    ),
    ...input.choices.map((choice) => choice.prompt),
    ...input.warnings.map((entry) => entry.message),
  ]);
}

function warningsForRelationships(
  relationships: AthenaForecastRelationshipFinding[],
): AthenaForecastWarning[] {
  return relationships.flatMap((relationship) => {
    if (relationship.certainty === "unsupported") {
      return [
        warning(
          "unsupported-effect",
          `${relationship.sourceLabel} remains unsupported by Lite forecasting.`,
          relationship.relationshipId,
          relationship.sourceGroupId,
          relationship.id,
        ),
      ];
    }
    if (relationship.requiresAuthority) {
      return [
        warning(
          "authority-required",
          `${relationship.sourceLabel} requires BoardState authority or manual resolution.`,
          relationship.relationshipId,
          relationship.sourceGroupId,
          relationship.id,
        ),
      ];
    }
    if (
      relationship.multiplicity === "unknown" &&
      (relationship.instanceCount ?? 0) === 0
    ) {
      return [
        warning(
          "manual-resolution-required",
          `${relationship.sourceLabel} trigger multiplicity cannot be determined locally.`,
          relationship.relationshipId,
          relationship.sourceGroupId,
          relationship.id,
        ),
      ];
    }
    return [];
  });
}

function warningsForReplacements(
  replacements: AthenaForecastReplacementFinding[],
): AthenaForecastWarning[] {
  return replacements
    .filter((replacement) => !replacement.applied)
    .map((replacement) =>
      warning(
        "replacement-unresolved",
        `${replacement.sourceLabel} was discovered but cannot yet be applied safely.`,
        replacement.relationshipId,
        replacement.sourceGroupId,
        replacement.id,
      ),
    );
}

function replacementWarningsFromProcessing(
  processing: AthenaReplacementProcessingResult,
): AthenaForecastWarning[] {
  return processing.warnings.map((entry) =>
    warning(
      replacementWarningReasonCode(entry.code),
      entry.message,
      entry.relationshipId,
      entry.sourceGroupId,
      entry.id,
    ),
  );
}

function replacementWarningReasonCode(
  code: AthenaReplacementProcessingResult["warnings"][number]["code"],
): AthenaForecastReasonCode {
  if (code === "invalid-event") return "invalid-event";
  if (code === "invalid-quantity") return "invalid-quantity";
  if (code === "authority-required") return "authority-required";
  if (code === "stale-version") return "stale-version";
  if (code === "cancelled") return "cancelled";
  if (code === "unresolved-order") return "replacement-unresolved";
  if (code === "authority-discrepancy") return "authoritative-input";
  if (code === "duplicate-prevented") return "replacement-discovered";
  return "manual-resolution-required";
}

function unsupportedRelationshipsForInput(
  relationshipMap: AthenaEffectRelationshipMap,
  input: AthenaForecastInput,
): AthenaMappedEffectRelationship[] {
  const groupIds = new Set(input.subjectGroupIds);
  return relationshipMap.relationships.filter(
    (relationship) =>
      relationship.support === "unsupported-effect" &&
      ((relationship.source.battlefieldObjectGroupId !== null &&
        groupIds.has(relationship.source.battlefieldObjectGroupId)) ||
        (input.sourceObjectId !== null &&
          relationship.source.objectIds.includes(input.sourceObjectId))),
  );
}

function warningsForUnsupportedSources(
  relationshipMap: AthenaEffectRelationshipMap,
  input: AthenaForecastInput,
): AthenaForecastWarning[] {
  return unsupportedRelationshipsForInput(relationshipMap, input).map(
    (relationship) =>
      warning(
        "unsupported-effect",
        `${relationship.source.currentCardFace ?? "The referenced source"} has unsupported effects and requires manual resolution or BoardState authority.`,
        relationship.id,
        relationship.source.battlefieldObjectGroupId,
        relationship.id,
      ),
  );
}

function relationshipCertainty(
  relationship: AthenaMappedEffectRelationship,
  inherited: AthenaForecastCertainty,
): AthenaForecastCertainty {
  if (relationship.support === "unsupported-effect") return "unsupported";
  if (relationship.requiresAuthority) return "authority-dependent";
  if (relationship.requiresManualResolution)
    return "manual-resolution-dependent";
  if (relationship.requiredChoices.length > 0) return "choice-dependent";
  if (relationship.optional) return "optional";
  if (inherited !== "deterministic") return inherited;
  return "deterministic";
}

function replacementModificationCategory(
  eventCategory: AthenaEventCategory,
  fallback: string | null,
): string {
  if (eventCategory === "token-created") return "token-multiplier";
  if (eventCategory === "counter-placed") return "counter-multiplier";
  if (eventCategory === "permanent-entered") {
    return "enter-battlefield-replacement";
  }
  return fallback ?? "event-modifier";
}

function generatedCertainty(
  relationship: AthenaMappedEffectRelationship,
  inherited: AthenaForecastCertainty,
): AthenaForecastCertainty {
  const relationshipValue = relationshipCertainty(relationship, inherited);
  return relationshipValue === "deterministic"
    ? "conditional"
    : relationshipValue;
}

function classificationForCertainty(
  certainty: AthenaForecastCertainty,
): AthenaForecastRelationshipFinding["classification"] {
  if (certainty === "optional") return "optional";
  if (certainty === "choice-dependent") return "choice-required";
  if (certainty === "authority-dependent") return "authority-required";
  if (certainty === "manual-resolution-dependent") {
    return "manual-resolution-required";
  }
  if (certainty === "unsupported") return "unsupported";
  return "forecasted-consequence";
}

function triggerMultiplicity(
  relationship: AthenaMappedEffectRelationship,
): AthenaForecastRelationshipFinding["multiplicity"] {
  const configured = relationship.relationshipMetadata.triggerMultiplicity;
  if (
    configured === "per-object" ||
    configured === "per-event" ||
    configured === "single"
  ) {
    return configured;
  }
  const helper = relationship.relationshipMetadata.helper;
  if (
    helper === "cathars-crusade" ||
    helper === "life-on-creature-entry" ||
    helper === "impact-tremors" ||
    helper === "rampaging-baloths"
  ) {
    return "per-object";
  }
  if (helper === "anim-pakal") return "per-event";
  return "unknown";
}

function triggerInstanceCount(
  multiplicity: AthenaForecastRelationshipFinding["multiplicity"],
  quantity: number | null,
  relationship: AthenaMappedEffectRelationship,
): number | null {
  if (relationship.optional || relationship.requiredChoices.length > 0) {
    return null;
  }
  if (quantity === null) return null;
  if (multiplicity === "per-object") return quantity;
  if (multiplicity === "per-event" || multiplicity === "single") return 1;
  return quantity === 1 ? 1 : null;
}

function isRelevantSourceRelationship(
  relationship: AthenaMappedEffectRelationship,
): boolean {
  if (relationship.state === "tracking-disabled") return false;
  if (relationship.state === "depowered") return false;
  if (relationship.state === "disabled") return false;
  if (relationship.state === "temporarily-inactive") return false;
  return (
    relationship.enabled ||
    relationship.requiresAuthority ||
    relationship.requiresManualResolution ||
    relationship.state === "unsupported"
  );
}

function forecastChoiceFromMappedChoice(
  choice: AthenaEffectChoiceRequirementDescriptor,
  relationship: AthenaMappedEffectRelationship,
): AthenaForecastChoiceRequirement {
  return {
    id: `athena-forecast-choice:${normalizeIdPart(choice.id)}`,
    kind: choice.kind,
    prompt: choice.prompt,
    sourceRelationshipId: relationship.id,
    sourceGroupId: choice.sourceGroupId,
    candidateGroupIds: choice.candidateGroupIds,
    eventCategories: choice.eventCategories,
    requiredBeforeAccurateForecast: true,
    requiredBeforeCommit: choice.requiredBeforeCommit,
  };
}

function characteristicForRelationship(
  relationship: AthenaMappedEffectRelationship,
): AthenaForecastStaticDependency["characteristic"] {
  const value = relationship.relationshipMetadata.characteristic;
  if (
    value === "power" ||
    value === "toughness" ||
    value === "power-and-toughness"
  ) {
    return value;
  }
  return "unknown";
}

function normalizeKnownCharacteristics(
  value:
    | Partial<Characteristics>
    | AthenaForecastKnownCharacteristics
    | null
    | undefined,
): AthenaForecastKnownCharacteristics | null {
  if (!value) return null;
  const candidate = value as Partial<AthenaForecastKnownCharacteristics>;
  const suppliedKnownFields = Array.isArray(candidate.knownFields)
    ? candidate.knownFields.filter((field) =>
        CHARACTERISTIC_FIELDS.includes(field),
      )
    : CHARACTERISTIC_FIELDS.filter((field) =>
        Object.prototype.hasOwnProperty.call(value, field),
      );
  const cardTypes = uniqueStrings(value.cardTypes ?? []);
  const supertypes = uniqueStrings(value.supertypes ?? []);
  const subtypes = uniqueStrings(value.subtypes ?? []);
  return {
    cardTypes,
    supertypes,
    subtypes,
    colors: uniqueStrings(value.colors ?? []),
    manaValue: finiteNumberOrNull(value.manaValue),
    isToken: Boolean(value.isToken),
    isCreature: value.isCreature ?? cardTypes.includes("Creature"),
    isLegendary: value.isLegendary ?? supertypes.includes("Legendary"),
    knownFields: uniqueStrings(suppliedKnownFields),
  };
}

function hasCompleteEntryCharacteristics(
  value: AthenaForecastKnownCharacteristics | null,
): boolean {
  if (!value) return false;
  return ["cardTypes", "supertypes", "subtypes", "isToken"].every((field) =>
    value.knownFields.includes(field as AthenaForecastCharacteristicField),
  );
}

function relevantTotalsForForecastCharacteristics(
  value: AthenaForecastKnownCharacteristics,
): RelevantTotalKey[] {
  return getAthenaRelevantTotalsForSubject({
    zone: "battlefield",
    cardTypes: value.cardTypes,
    subtypes: value.subtypes,
    supertypes: value.supertypes,
    isToken: value.isToken,
  }).filter((total) => {
    if (
      total === "nonbasicLands" &&
      !value.knownFields.includes("supertypes")
    ) {
      return false;
    }
    if (
      (total === "tokens" || total === "nontokenPermanents") &&
      !value.knownFields.includes("isToken")
    ) {
      return false;
    }
    return true;
  });
}

function inferredCharacteristicsForEvent(
  eventCategory: AthenaEventCategory,
): AthenaForecastKnownCharacteristics | null {
  if (eventCategory === "creature-entered") {
    return normalizeKnownCharacteristics({
      cardTypes: ["Creature"],
      isCreature: true,
    });
  }
  if (eventCategory === "land-entered") {
    return normalizeKnownCharacteristics({ cardTypes: ["Land"] });
  }
  if (eventCategory === "token-created" || eventCategory === "token-entered") {
    return normalizeKnownCharacteristics({ isToken: true });
  }
  return null;
}

function normalizeTokenDefinition(
  value: Partial<AthenaForecastTokenDefinitionReference> | null | undefined,
  fallbackCharacteristics: AthenaForecastKnownCharacteristics | null,
): AthenaForecastTokenDefinitionReference | null {
  if (!value) return null;
  const characteristics =
    normalizeKnownCharacteristics(value.characteristics) ??
    fallbackCharacteristics ??
    normalizeKnownCharacteristics({ isToken: true });
  if (!characteristics) return null;
  return {
    id: sanitizeId(value.id, "token-definition"),
    name: nullableText(value.name) ?? "Token",
    power: finiteNumberOrNull(value.power),
    toughness: finiteNumberOrNull(value.toughness),
    characteristics: { ...characteristics, isToken: true },
  };
}

function clonePermanentDefinition(
  value: CardIdentity | null | undefined,
): CardIdentity | null {
  if (!value?.cardId || !value.name) return null;
  return {
    ...value,
    colors: [...value.colors],
    colorIdentity: [...value.colorIdentity],
    keywords: [...value.keywords],
    cardFaces: value.cardFaces.map((face) => ({ ...face })),
  };
}

function normalizeTotalImplications(
  value: Partial<Record<RelevantTotalKey, number>> | undefined,
): Partial<Record<RelevantTotalKey, number>> {
  const normalized: Partial<Record<RelevantTotalKey, number>> = {};
  for (const [key, entry] of Object.entries(value ?? {})) {
    if (typeof entry === "number" && Number.isFinite(entry)) {
      normalized[key as RelevantTotalKey] = Math.trunc(entry);
    }
  }
  return normalized;
}

function normalizeMetadata(
  value: Record<string, string | number | boolean | null> | undefined,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(value ?? {})
      .filter(
        ([, entry]) =>
          entry === null ||
          typeof entry === "string" ||
          typeof entry === "boolean" ||
          (typeof entry === "number" && Number.isFinite(entry)),
      )
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

function sourceForAuthority(
  authority: AthenaAuthoritySource,
): AthenaForecastInputSource {
  if (authority === "boardstate-authoritative-result")
    return "boardstate-result";
  if (authority === "confirmed-canonical-session-result")
    return "canonical-event";
  if (authority === "confirmed-user-report") return "manual-report";
  if (authority === "lite-local-helper-result") return "lite-helper";
  if (authority === "project-echo-voice-report") return "echo-reported";
  if (authority === "project-echo-planned-action") return "echo-planned";
  if (authority === "correction-only") return "correction-only";
  if (authority === "imported-canonical-event") return "imported-event";
  if (authority === "lite-preview") return "preview-only";
  return "unknown";
}

function confirmedInputDescription(input: AthenaForecastInput): string {
  return `${input.quantity} ${readableEvent(input.eventCategory)} event(s) supplied as ${input.eventSource}.`;
}

function readableEvent(event: AthenaEventCategory): string {
  return typeof event === "string" ? event.replace(/-/g, " ") : "unknown";
}

function readableTotal(total: RelevantTotalKey): string {
  return total.replace(/([A-Z])/g, " $1").toLowerCase();
}

function warning(
  code: AthenaForecastReasonCode,
  message: string,
  relationshipId: string | null,
  groupId: string | null,
  scope: string,
): AthenaForecastWarning {
  return {
    id: `athena-forecast-warning:${normalizeIdPart(scope)}:${code}`,
    code,
    message,
    relationshipId,
    groupId,
  };
}

function uniqueGeneratedEvents(
  events: AthenaForecastGeneratedEvent[],
): AthenaForecastGeneratedEvent[] {
  return uniqueById(events);
}

function uniqueChoices(
  choices: AthenaForecastChoiceRequirement[],
): AthenaForecastChoiceRequirement[] {
  return uniqueById(choices);
}

function uniqueWarnings(
  warnings: AthenaForecastWarning[],
): AthenaForecastWarning[] {
  return uniqueById(warnings);
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values)
    if (!byId.has(value.id)) byId.set(value.id, value);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueReasonCodes(
  values: AthenaForecastReasonCode[],
): AthenaForecastReasonCode[] {
  return uniqueStrings(values);
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function sanitizeId(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : fallback;
}

function nullableId(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 180)
    : null;
}

function nullableText(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 240)
    : null;
}

function sanitizeTimestamp(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function finiteInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeForecastQuantity(value: unknown): number {
  if (value === undefined) return 1;
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY
  ) {
    return 0;
  }
  return value;
}

function finiteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function numericPayload(
  payload: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = payload?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback;
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

function clampDepth(value: unknown): number {
  return finiteInteger(
    value,
    0,
    ATHENA_EVENT_FORECAST_MAX_DEPTH,
    ATHENA_EVENT_FORECAST_DEFAULT_DEPTH,
  );
}
