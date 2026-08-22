import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import { ATHENA_EVENT_CATEGORIES } from "./dependencyGraphTypes";
import { createAthenaEffectRelationshipQueryApi } from "./effectRelationshipMapper";
import type { AthenaMappedEffectRelationship } from "./effectRelationshipMapperTypes";
import type {
  AthenaForecastCharacteristicField,
  AthenaForecastEnvironment,
  AthenaForecastInput,
} from "./eventForecastTypes";
import { rankAthenaAuthoritySource } from "./foundation";
import {
  ATHENA_REPLACEMENT_CACHE_VERSION,
  ATHENA_REPLACEMENT_CHAIN_VERSION,
  ATHENA_REPLACEMENT_MAX_CHAIN_LENGTH,
  ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY,
  type AthenaExcludedReplacement,
  type AthenaReplacementApplication,
  type AthenaReplacementChoiceRequirement,
  type AthenaReplacementDefinition,
  type AthenaReplacementDiagnostics,
  type AthenaReplacementEngineDiagnostics,
  type AthenaReplacementEngineOptions,
  type AthenaReplacementInvalidationInput,
  type AthenaReplacementModification,
  type AthenaReplacementProcessingOptions,
  type AthenaReplacementProcessingResult,
  type AthenaReplacementScope,
  type AthenaReplacementValidity,
  type AthenaReplacementVersionSnapshot,
  type AthenaReplacementWarning,
} from "./replacementEffectTypes";

const EVENT_CATEGORY_SET = new Set<string>(ATHENA_EVENT_CATEGORIES);
const ENTRY_CHARACTERISTIC_FIELDS: AthenaForecastCharacteristicField[] = [
  "cardTypes",
  "supertypes",
  "subtypes",
  "colors",
  "manaValue",
  "isToken",
  "isCreature",
  "isLegendary",
];

interface ReplacementCandidate {
  definition: AthenaReplacementDefinition;
  relationship: AthenaMappedEffectRelationship | null;
}

interface ReplacementApplicationCandidate extends ReplacementCandidate {
  applicationId: string;
  sourceInstance: number;
}

interface AppliedModification {
  event: AthenaForecastInput;
  explanation: string;
  error: "overflow" | "invalid" | null;
}

export function processAthenaReplacementEffects(
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
  options: AthenaReplacementProcessingOptions = {},
): AthenaReplacementProcessingResult {
  const started = monotonicNowMs();
  const originalEvent = copyForecastInput(event);
  const timestamp = options.timestamp ?? originalEvent.timestamp;
  const versions = replacementVersionSnapshot(originalEvent, environment);
  const cacheKey = replacementCacheKey(originalEvent, versions, options);
  const resultId = `athena-replacement:${normalizeIdPart(originalEvent.eventId)}:${stableHash(cacheKey)}`;

  if (options.cancellation?.cancelled) {
    return terminalResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "cancelled",
      event: originalEvent,
      versions,
      warning: replacementWarning(
        "cancelled",
        options.cancellation.reason ?? "Replacement processing was cancelled.",
      ),
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
    });
  }

  const staleReason = validateReplacementVersions(originalEvent, environment);
  if (staleReason) {
    return terminalResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "stale",
      event: originalEvent,
      versions,
      warning: replacementWarning("stale-version", staleReason),
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
    });
  }

  if (!EVENT_CATEGORY_SET.has(originalEvent.eventCategory)) {
    return terminalResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "invalid",
      event: originalEvent,
      versions,
      warning: replacementWarning(
        "invalid-event",
        "Replacement processing received an unsupported event category.",
      ),
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
    });
  }

  if (
    !Number.isSafeInteger(originalEvent.quantity) ||
    originalEvent.quantity <= 0 ||
    originalEvent.quantity > ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY
  ) {
    return terminalResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "invalid",
      event: originalEvent,
      versions,
      warning: replacementWarning(
        "invalid-quantity",
        "Replacement processing requires a positive, safely representable integer quantity.",
      ),
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
    });
  }

  if (
    originalEvent.eventSource === "correction-only" ||
    originalEvent.authoritySource === "correction-only"
  ) {
    return successfulResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "bypassed",
      originalEvent,
      finalEvent: originalEvent,
      versions,
      definitions: [],
      excluded: [],
      steps: [],
      choices: [],
      warnings: [],
      authorityFinalEventAccepted: false,
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
      discrepancyCount: 0,
      semanticDescriptions: [
        "Correction Only bypasses replacement effects and gameplay triggers.",
      ],
    });
  }

  if (originalEvent.authoritySource === "boardstate-authoritative-result") {
    const authoritative = copyForecastInput(
      options.authoritativeFinalEvent ?? originalEvent,
    );
    if (
      authoritative.canonicalSessionId !== originalEvent.canonicalSessionId ||
      authoritative.participantId !== originalEvent.participantId ||
      !EVENT_CATEGORY_SET.has(authoritative.eventCategory) ||
      !Number.isSafeInteger(authoritative.quantity) ||
      authoritative.quantity < 0 ||
      authoritative.quantity > ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY
    ) {
      return terminalResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "invalid",
        event: originalEvent,
        versions,
        warning: replacementWarning(
          "invalid-event",
          "The authoritative final event has invalid session, participant, event, or quantity metadata.",
        ),
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }
    const localPrediction = numericMetadata(
      originalEvent.metadata.localPredictedQuantity,
    );
    const discrepancyCount =
      localPrediction !== null && localPrediction !== authoritative.quantity
        ? 1
        : 0;
    const warnings =
      discrepancyCount > 0
        ? [
            replacementWarning(
              "authority-discrepancy",
              "BoardState authoritative quantity supersedes the different Lite preview quantity.",
            ),
          ]
        : [];
    return successfulResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "resolved",
      originalEvent,
      finalEvent: authoritative,
      versions,
      definitions: [],
      excluded: [],
      steps: [],
      choices: [],
      warnings,
      authorityFinalEventAccepted: true,
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
      discrepancyCount,
      semanticDescriptions: [
        "BoardState authoritative final event accepted without contradictory Lite replacement processing.",
      ],
    });
  }

  try {
    const query = createAthenaEffectRelationshipQueryApi(
      environment.relationshipMap,
      environment.graph,
    );
    const mappedRelationships = uniqueById(
      query.getReplacementEffectsModifyingEvent(originalEvent.eventCategory),
    );
    const excluded: AthenaExcludedReplacement[] = [];
    let candidates: ReplacementCandidate[] = [];
    const invalidMappedRelationships: AthenaMappedEffectRelationship[] = [];

    for (const relationship of mappedRelationships) {
      const exclusion = exclusionForRelationship(
        relationship,
        environment,
        originalEvent,
      );
      if (exclusion) {
        excluded.push(exclusion);
        continue;
      }
      const definition = definitionFromRelationship(
        relationship,
        originalEvent.eventCategory,
      );
      if (!definition) {
        invalidMappedRelationships.push(relationship);
        excluded.push(
          excludedReplacement(
            relationship,
            "invalid-definition",
            `${relationship.source.currentCardFace ?? "Replacement source"} does not have a complete structured modifier definition.`,
          ),
        );
        continue;
      }
      candidates.push({ definition, relationship });
    }

    if (invalidMappedRelationships.length > 0) {
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "manual-required",
        event: originalEvent,
        versions,
        definitions: [],
        excluded,
        choices: [],
        warnings: invalidMappedRelationships.map((relationship) =>
          replacementWarning(
            "unsupported-modifier",
            `${relationship.source.currentCardFace ?? "Replacement source"} does not have a complete structured modifier definition.`,
            relationship.id,
            relationship.source.battlefieldObjectGroupId,
          ),
        ),
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    for (const customDefinition of options.customDefinitions ?? []) {
      if (
        !customDefinition.eventCategories.includes(originalEvent.eventCategory)
      )
        continue;
      const customExclusion = exclusionForCustomDefinition(
        customDefinition,
        environment,
        originalEvent,
      );
      if (customExclusion) {
        excluded.push(customExclusion);
        continue;
      }
      candidates.push({
        definition: copyDefinition(customDefinition),
        relationship: null,
      });
    }

    let definitions = uniqueDefinitions(
      candidates.map((candidate) => candidate.definition),
    );
    const invalidDefinitions = definitions.filter(
      (definition) => validateDefinition(definition) !== null,
    );
    if (invalidDefinitions.length > 0) {
      const warnings = invalidDefinitions.map((definition) =>
        replacementWarning(
          "unsupported-modifier",
          validateDefinition(definition) ?? "Invalid replacement definition.",
          definition.relationshipId,
          definition.sourceGroupId,
        ),
      );
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "manual-required",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices: [],
        warnings,
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    const authorityDefinitions = definitions.filter(
      (definition) => definition.requiresAuthority,
    );
    if (authorityDefinitions.length > 0) {
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "authority-required",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices: [],
        warnings: authorityDefinitions.map((definition) =>
          replacementWarning(
            "authority-required",
            `${definition.sourceLabel} requires BoardState authority before the event can be finalized.`,
            definition.relationshipId,
            definition.sourceGroupId,
          ),
        ),
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    const manualDefinitions = definitions.filter(
      (definition) =>
        definition.requiresManualResolution ||
        definition.support === "unsupported-effect",
    );
    if (manualDefinitions.length > 0) {
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "manual-required",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices: [],
        warnings: manualDefinitions.map((definition) =>
          replacementWarning(
            "manual-required",
            `${definition.sourceLabel} requires manual replacement resolution.`,
            definition.relationshipId,
            definition.sourceGroupId,
          ),
        ),
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    const optionalDefinitions = definitions.filter(
      (definition) =>
        definition.optional &&
        options.optionalReplacementDecisions?.[definition.relationshipId] ===
          undefined,
    );
    if (optionalDefinitions.length > 0) {
      const choices: AthenaReplacementChoiceRequirement[] =
        optionalDefinitions.map((definition) => ({
          id: `athena-replacement-choice:optional:${normalizeIdPart(originalEvent.eventId)}:${normalizeIdPart(definition.relationshipId)}`,
          kind: "optional-decision",
          prompt: `Choose whether to apply ${definition.sourceLabel}.`,
          relationshipIds: [definition.relationshipId],
          sourceGroupIds: definition.sourceGroupId
            ? [definition.sourceGroupId]
            : [],
          requiredBeforeFinalEvent: true,
        }));
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "unresolved",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices,
        warnings: [],
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    candidates = candidates.filter(
      (candidate) =>
        !candidate.definition.optional ||
        options.optionalReplacementDecisions?.[
          candidate.definition.relationshipId
        ] === true,
    );
    definitions = uniqueDefinitions(
      candidates.map((candidate) => candidate.definition),
    );

    const applicationCount = definitions.reduce(
      (total, definition) => total + definition.sourceQuantity,
      0,
    );
    if (applicationCount > ATHENA_REPLACEMENT_MAX_CHAIN_LENGTH) {
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "authority-required",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices: [],
        warnings: [
          replacementWarning(
            "authority-required",
            "The replacement chain exceeds Lite's supported bounded chain length.",
          ),
        ],
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }
    const applications = expandApplications(candidates, originalEvent.eventId);

    const ordered = orderApplications(
      applications,
      options.selectedReplacementOrder,
    );
    if (!ordered.safe) {
      const choice: AthenaReplacementChoiceRequirement = {
        id: `athena-replacement-choice:order:${normalizeIdPart(originalEvent.eventId)}`,
        kind: "replacement-order",
        prompt:
          "Replacement order requires BoardState authority or manual resolution.",
        relationshipIds: uniqueStrings(
          applications.map(
            (application) => application.definition.relationshipId,
          ),
        ),
        sourceGroupIds: uniqueStrings(
          applications.flatMap((application) =>
            application.definition.sourceGroupId
              ? [application.definition.sourceGroupId]
              : [],
          ),
        ),
        requiredBeforeFinalEvent: true,
      };
      return unresolvedResult({
        id: resultId,
        cacheKey,
        timestamp,
        validity: "manual-required",
        event: originalEvent,
        versions,
        definitions,
        excluded,
        choices: [choice],
        warnings: [
          replacementWarning(
            "unresolved-order",
            "Non-commutative replacement ordering cannot be safely inferred by Lite.",
          ),
        ],
        durationMs: monotonicNowMs() - started,
        forecastReference: options.forecastReference ?? null,
        cacheHit: Boolean(options.cacheHit),
      });
    }

    const previouslyApplied = new Set(
      options.previouslyAppliedApplicationIds ?? [],
    );
    const appliedIds = new Set<string>();
    const signatures = new Set<string>([eventSignature(originalEvent)]);
    const steps: AthenaReplacementApplication[] = [];
    const duplicateWarnings: AthenaReplacementWarning[] = [];
    let duplicateCount = 0;
    let currentEvent = originalEvent;

    for (let index = 0; index < ordered.applications.length; index += 1) {
      if (options.cancellation?.cancelled) {
        return terminalResult({
          id: resultId,
          cacheKey,
          timestamp,
          validity: "cancelled",
          event: originalEvent,
          versions,
          warning: replacementWarning(
            "cancelled",
            options.cancellation.reason ??
              "Replacement processing was cancelled.",
          ),
          durationMs: monotonicNowMs() - started,
          forecastReference: options.forecastReference ?? null,
          cacheHit: Boolean(options.cacheHit),
        });
      }
      const application = ordered.applications[index];
      if (
        appliedIds.has(application.applicationId) ||
        previouslyApplied.has(application.applicationId)
      ) {
        duplicateCount += 1;
        duplicateWarnings.push(
          replacementWarning(
            "duplicate-prevented",
            `${application.definition.sourceLabel} was prevented from applying twice to the same event.`,
            application.definition.relationshipId,
            application.definition.sourceGroupId,
          ),
        );
        continue;
      }
      const applied = applyModification(
        originalEvent,
        currentEvent,
        application,
        steps.length + 1,
      );
      if (applied.error === "overflow") {
        return unresolvedResult({
          id: resultId,
          cacheKey,
          timestamp,
          validity: "overflow",
          event: originalEvent,
          versions,
          definitions,
          excluded,
          choices: [],
          warnings: [
            replacementWarning(
              "overflow",
              "A replacement would exceed the maximum safely representable quantity.",
              application.definition.relationshipId,
              application.definition.sourceGroupId,
            ),
          ],
          durationMs: monotonicNowMs() - started,
          forecastReference: options.forecastReference ?? null,
          cacheHit: Boolean(options.cacheHit),
        });
      }
      if (applied.error === "invalid") {
        return unresolvedResult({
          id: resultId,
          cacheKey,
          timestamp,
          validity: "manual-required",
          event: originalEvent,
          versions,
          definitions,
          excluded,
          choices: [],
          warnings: [
            replacementWarning(
              "unsupported-modifier",
              "A replacement definition could not be applied safely.",
              application.definition.relationshipId,
              application.definition.sourceGroupId,
            ),
          ],
          durationMs: monotonicNowMs() - started,
          forecastReference: options.forecastReference ?? null,
          cacheHit: Boolean(options.cacheHit),
        });
      }
      const signature = eventSignature(applied.event);
      if (signatures.has(signature)) {
        return unresolvedResult({
          id: resultId,
          cacheKey,
          timestamp,
          validity: "loop-detected",
          event: originalEvent,
          versions,
          definitions,
          excluded,
          choices: [],
          warnings: [
            replacementWarning(
              "loop-detected",
              "Replacement Loop Detected. BoardState authority or manual resolution is required.",
              application.definition.relationshipId,
              application.definition.sourceGroupId,
            ),
          ],
          durationMs: monotonicNowMs() - started,
          forecastReference: options.forecastReference ?? null,
          cacheHit: Boolean(options.cacheHit),
          loopDetected: true,
        });
      }
      signatures.add(signature);
      appliedIds.add(application.applicationId);
      const remainingApplicationIds = ordered.applications
        .slice(index + 1)
        .map((entry) => entry.applicationId);
      steps.push({
        id: `athena-replacement-step:${normalizeIdPart(originalEvent.eventId)}:${steps.length + 1}:${stableHash(application.applicationId)}`,
        applicationId: application.applicationId,
        definitionId: application.definition.id,
        relationshipId: application.definition.relationshipId,
        sourceGroupId: application.definition.sourceGroupId,
        sourceLabel: application.definition.sourceLabel,
        sourceInstance: application.sourceInstance,
        modificationCategory: application.definition.modification.category,
        previousEventId: currentEvent.eventId,
        resultingEventId: applied.event.eventId,
        quantityBefore: currentEvent.quantity,
        quantityAfter: applied.event.quantity,
        eventCategoryBefore: currentEvent.eventCategory,
        eventCategoryAfter: applied.event.eventCategory,
        zoneBefore: currentEvent.zoneDestination,
        zoneAfter: applied.event.zoneDestination,
        authoritySource: application.definition.authoritySource,
        authorityPrecedence: application.definition.authorityPrecedence,
        supportStatus: application.definition.supportStatus,
        support: application.definition.support,
        explanation: applied.explanation,
        remainingApplicationIds,
        applied: true,
      });
      currentEvent = applied.event;
    }

    return successfulResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "resolved",
      originalEvent,
      finalEvent: currentEvent,
      versions,
      definitions,
      excluded,
      steps,
      choices: [],
      warnings: uniqueWarnings(duplicateWarnings),
      authorityFinalEventAccepted: false,
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
      discrepancyCount: 0,
      duplicateCount,
      semanticDescriptions:
        steps.length === 0
          ? ["No supported active replacement effect modifies this event."]
          : steps.map((step) => step.explanation),
    });
  } catch (error) {
    return terminalResult({
      id: resultId,
      cacheKey,
      timestamp,
      validity: "unresolved",
      event: originalEvent,
      versions,
      warning: replacementWarning(
        "manual-required",
        error instanceof Error
          ? error.message
          : "Replacement processing failed safely.",
      ),
      durationMs: monotonicNowMs() - started,
      forecastReference: options.forecastReference ?? null,
      cacheHit: Boolean(options.cacheHit),
    });
  }
}

export function createAthenaDuplicateReplacementResult(
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
  timestamp = event.timestamp,
): AthenaReplacementProcessingResult {
  const originalEvent = copyForecastInput(event);
  const versions = replacementVersionSnapshot(originalEvent, environment);
  const cacheKey = replacementCacheKey(originalEvent, versions, {});
  return successfulResult({
    id: `athena-replacement:duplicate:${normalizeIdPart(originalEvent.eventId)}`,
    cacheKey,
    timestamp,
    validity: "resolved",
    originalEvent,
    finalEvent: originalEvent,
    versions,
    definitions: [],
    excluded: [],
    steps: [],
    choices: [],
    warnings: [],
    authorityFinalEventAccepted: false,
    durationMs: 0,
    forecastReference: null,
    cacheHit: true,
    discrepancyCount: 0,
    duplicateCount: 1,
    semanticDescriptions: [
      "Previously committed canonical event lineage was not processed again.",
    ],
  });
}

export class AthenaReplacementCancellationController {
  private readonly state = {
    cancelled: false,
    reason: null as string | null,
  };
  readonly signal = this.state;

  cancel(reason = "Replacement processing was cancelled."): void {
    this.state.cancelled = true;
    this.state.reason = reason;
  }
}

export class AthenaReplacementEffectEngine {
  private readonly cache = new Map<string, AthenaReplacementProcessingResult>();
  private readonly results = new Map<
    string,
    AthenaReplacementProcessingResult
  >();
  private readonly maxCacheEntries: number;
  private readonly maxResultRecords: number;
  private analysisCount = 0;
  private totalDurationMs = 0;
  private maximumDurationMs = 0;
  private totalChainLength = 0;
  private maximumChainLength = 0;
  private cacheHitCount = 0;
  private cacheMissCount = 0;
  private staleChainRejectionCount = 0;
  private aggregate = emptyAggregateDiagnostics();

  constructor(options: AthenaReplacementEngineOptions = {}) {
    this.maxCacheEntries = boundedInteger(options.maxCacheEntries, 1, 200, 30);
    this.maxResultRecords = boundedInteger(
      options.maxResultRecords,
      1,
      1000,
      120,
    );
  }

  process(
    environment: AthenaForecastEnvironment,
    event: AthenaForecastInput,
    options: AthenaReplacementProcessingOptions = {},
  ): AthenaReplacementProcessingResult {
    const versions = replacementVersionSnapshot(event, environment);
    const key = replacementCacheKey(event, versions, options);
    const cached = this.cache.get(key);
    let result: AthenaReplacementProcessingResult;
    if (
      cached &&
      (cached.validity === "resolved" || cached.validity === "bypassed")
    ) {
      this.cacheHitCount += 1;
      result = {
        ...cached,
        diagnostics: { ...cached.diagnostics, cacheHit: true },
      };
    } else {
      this.cacheMissCount += 1;
      result = processAthenaReplacementEffects(environment, event, {
        ...options,
        cacheHit: false,
      });
      if (result.validity === "resolved" || result.validity === "bypassed") {
        this.cache.set(key, result);
        trimMap(this.cache, this.maxCacheEntries);
      }
    }
    this.analysisCount += 1;
    this.totalDurationMs += result.diagnostics.processingDurationMs;
    this.maximumDurationMs = Math.max(
      this.maximumDurationMs,
      result.diagnostics.processingDurationMs,
    );
    this.totalChainLength += result.steps.length;
    this.maximumChainLength = Math.max(
      this.maximumChainLength,
      result.steps.length,
    );
    if (result.validity === "stale") this.staleChainRejectionCount += 1;
    this.aggregate = addDiagnostics(this.aggregate, result.diagnostics);
    this.results.set(result.id, result);
    trimMap(this.results, this.maxResultRecords);
    return result;
  }

  getResult(id: string): AthenaReplacementProcessingResult | null {
    return this.results.get(id) ?? null;
  }

  invalidate(
    input: AthenaReplacementInvalidationInput,
  ): AthenaReplacementProcessingResult[] {
    const stale: AthenaReplacementProcessingResult[] = [];
    for (const result of this.results.values()) {
      if (!replacementResultAffected(result, input)) continue;
      const timestamp = input.timestamp ?? result.updatedAt;
      const warning = replacementWarning("stale-version", input.reason);
      const updated: AthenaReplacementProcessingResult = {
        ...result,
        validity: "stale",
        updatedAt: timestamp,
        finalEvent: null,
        warnings: uniqueWarnings([...result.warnings, warning]),
        semanticDescriptions: uniqueStrings([
          ...result.semanticDescriptions,
          input.reason,
        ]),
        diagnostics: {
          ...result.diagnostics,
          staleChainRejected: true,
        },
      };
      this.results.set(result.id, updated);
      this.cache.delete(result.cacheKey);
      this.staleChainRejectionCount += 1;
      stale.push(updated);
    }
    return stale.sort((a, b) => a.id.localeCompare(b.id));
  }

  clearDerivedCache(): void {
    this.cache.clear();
  }

  dispose(): void {
    this.cache.clear();
    this.results.clear();
  }

  getDiagnostics(): AthenaReplacementEngineDiagnostics {
    return {
      version: ATHENA_REPLACEMENT_CHAIN_VERSION,
      replacementAnalysisCount: this.analysisCount,
      appliedReplacementCount: this.aggregate.appliedReplacementCount,
      tokenMultiplierCount: this.aggregate.tokenMultiplierCount,
      counterMultiplierCount: this.aggregate.counterMultiplierCount,
      additiveModifierCount: this.aggregate.additiveModifierCount,
      destinationReplacementCount: this.aggregate.destinationReplacementCount,
      eventSubstitutionCount: this.aggregate.eventSubstitutionCount,
      unresolvedReplacementCount: this.aggregate.unresolvedReplacementCount,
      authorityRequiredReplacementCount:
        this.aggregate.authorityRequiredReplacementCount,
      duplicatePreventionCount: this.aggregate.duplicatePreventionCount,
      loopDetectionCount: this.aggregate.loopDetectionCount,
      averageChainLength:
        this.analysisCount === 0
          ? 0
          : this.totalChainLength / this.analysisCount,
      maximumChainLength: this.maximumChainLength,
      averageProcessingDurationMs:
        this.analysisCount === 0
          ? 0
          : this.totalDurationMs / this.analysisCount,
      maximumProcessingDurationMs: this.maximumDurationMs,
      cacheHitCount: this.cacheHitCount,
      cacheMissCount: this.cacheMissCount,
      staleChainRejectionCount: this.staleChainRejectionCount,
      localAuthorityDiscrepancyCount:
        this.aggregate.localAuthorityDiscrepancyCount,
      lastReplacementError: this.aggregate.lastReplacementError,
      productionVisible: false,
    };
  }
}

export const athenaReplacementEffectEngine =
  new AthenaReplacementEffectEngine();

export function invalidateAthenaReplacementResult(
  result: AthenaReplacementProcessingResult,
  input: AthenaReplacementInvalidationInput,
): AthenaReplacementProcessingResult {
  if (!replacementResultAffected(result, input)) return result;
  const timestamp = input.timestamp ?? result.updatedAt;
  return {
    ...result,
    validity: "stale",
    updatedAt: timestamp,
    finalEvent: null,
    warnings: uniqueWarnings([
      ...result.warnings,
      replacementWarning("stale-version", input.reason),
    ]),
    semanticDescriptions: uniqueStrings([
      ...result.semanticDescriptions,
      input.reason,
    ]),
    diagnostics: { ...result.diagnostics, staleChainRejected: true },
  };
}

export function isAthenaReplacementResultCurrent(
  result: AthenaReplacementProcessingResult,
  versions: AthenaReplacementVersionSnapshot,
): boolean {
  return (
    (result.validity === "resolved" || result.validity === "bypassed") &&
    serializeStable(result.versions) === serializeStable(versions)
  );
}

function definitionFromRelationship(
  relationship: AthenaMappedEffectRelationship,
  eventCategory: AthenaForecastInput["eventCategory"],
): AthenaReplacementDefinition | null {
  const metadata = relationship.relationshipMetadata;
  const kind = stringMetadata(metadata.replacementKind);
  let modification: AthenaReplacementModification | null = null;
  if (kind === "quantity-multiplier") {
    const factor = numericMetadata(metadata.replacementFactor);
    if (factor !== null) {
      modification = { category: "quantity-multiplier", factor };
    }
  } else if (kind === "quantity-additive") {
    const amount = numericMetadata(metadata.replacementAddend);
    if (amount !== null) {
      modification = { category: "quantity-additive", amount };
    }
  } else if (kind === "quantity-setter") {
    const quantity = numericMetadata(metadata.replacementQuantity);
    if (quantity !== null) {
      modification = { category: "quantity-setter", quantity };
    }
  } else if (kind === "destination-replacement") {
    const destination = zoneMetadata(metadata.replacementDestination);
    if (destination) {
      modification = { category: "destination-replacement", destination };
    }
  } else if (kind === "event-substitution") {
    const substituted = stringMetadata(metadata.replacementEventCategory);
    if (substituted && EVENT_CATEGORY_SET.has(substituted)) {
      modification = {
        category: "event-substitution",
        eventCategory: substituted as AthenaForecastInput["eventCategory"],
      };
    }
  } else if (kind === "entry-state") {
    modification = {
      category: "entry-state",
      tapped: booleanMetadata(metadata.replacementEntersTapped),
      transformed: booleanMetadata(metadata.replacementEntersTransformed),
      counterType: stringMetadata(metadata.replacementCounterType) ?? undefined,
      counterQuantity:
        numericMetadata(metadata.replacementCounterQuantity) ?? undefined,
    };
  }
  if (!modification) return null;
  const rawSourceQuantity =
    (numericMetadata(metadata.sourceQuantity) ??
      relationship.source.objectIds.length) ||
    1;
  const sourceQuantity = Math.trunc(rawSourceQuantity);
  return {
    version: ATHENA_REPLACEMENT_CHAIN_VERSION,
    id: `athena-replacement-definition:${normalizeIdPart(relationship.id)}:${eventCategory}`,
    relationshipId: relationship.id,
    sourceGroupId: relationship.source.battlefieldObjectGroupId,
    sourceObjectIds: [...relationship.source.objectIds],
    sourceLabel:
      relationship.source.currentCardFace ??
      relationship.source.abilityIdentifier,
    sourceQuantity,
    eventCategories: [eventCategory],
    modification,
    scope: scopeForRelationship(relationship, eventCategory),
    enabled: relationship.enabled,
    optional: relationship.optional,
    commutative: booleanMetadata(metadata.replacementCommutative) ?? false,
    appliesOncePerEvent:
      booleanMetadata(metadata.replacementAppliesOnce) ?? true,
    order: numericMetadata(metadata.replacementOrder),
    supportStatus: relationship.supportStatus,
    support: relationship.support,
    authoritySource: relationship.authoritySource,
    authorityPrecedence: relationship.authorityPrecedence,
    requiresAuthority: relationship.requiresAuthority,
    requiresManualResolution: relationship.requiresManualResolution,
    definitionVersion: boundedInteger(
      numericMetadata(metadata.replacementDefinitionVersion),
      1,
      999999,
      1,
    ),
    metadata: { ...metadata },
  };
}

function scopeForRelationship(
  relationship: AthenaMappedEffectRelationship,
  eventCategory: AthenaForecastInput["eventCategory"],
): AthenaReplacementScope {
  const controllerMode =
    relationship.relationshipMetadata.replacementScope === "any"
      ? "any"
      : "source-controller";
  if (eventCategory === "token-created") {
    return {
      kind: "controlled-tokens",
      counterTypes: [],
      permanentTypes: [],
      controllerMode,
    };
  }
  if (eventCategory === "counter-placed") {
    return {
      kind: "controlled-permanents",
      counterTypes: ["*"],
      permanentTypes: [],
      controllerMode,
    };
  }
  return {
    kind: "all-personal-events",
    counterTypes: [],
    permanentTypes: [],
    controllerMode,
  };
}

function exclusionForRelationship(
  relationship: AthenaMappedEffectRelationship,
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
): AthenaExcludedReplacement | null {
  if (relationship.state === "tracking-disabled") {
    return excludedReplacement(
      relationship,
      "not-tracked",
      `${relationship.source.currentCardFace ?? "Replacement source"} is Not Tracked and does not modify this event.`,
    );
  }
  if (relationship.state === "depowered") {
    return excludedReplacement(
      relationship,
      "depowered",
      `${relationship.source.currentCardFace ?? "Replacement source"} is depowered for this ability.`,
    );
  }
  if (
    relationship.state === "disabled" ||
    relationship.state === "temporarily-inactive" ||
    !relationship.source.enabled
  ) {
    return excludedReplacement(
      relationship,
      "disabled",
      `${relationship.source.currentCardFace ?? "Replacement source"} is not an active replacement source.`,
    );
  }
  const sourceGroupId = relationship.source.battlefieldObjectGroupId;
  const source = sourceGroupId
    ? environment.context.battlefield.find(
        (object) => object.groupId === sourceGroupId,
      )
    : null;
  if (sourceGroupId && !source) {
    return excludedReplacement(
      relationship,
      "source-missing",
      "The replacement source is no longer on the battlefield.",
    );
  }
  if (source && (!source.trackingEnabled || source.zone !== "battlefield")) {
    return excludedReplacement(
      relationship,
      source.trackingEnabled ? "disabled" : "not-tracked",
      `${source.label} is not an active tracked battlefield source.`,
    );
  }
  if (
    !relationship.observedEvents.some(
      (entry) => entry.eventCategory === event.eventCategory,
    )
  ) {
    return excludedReplacement(
      relationship,
      "event-mismatch",
      "The replacement does not apply to this event category.",
    );
  }
  if (!relationshipScopeMatches(relationship, environment, event)) {
    return excludedReplacement(
      relationship,
      "scope-mismatch",
      `${relationship.source.currentCardFace ?? "Replacement source"} does not apply to the affected controller or object scope.`,
    );
  }
  return null;
}

function relationshipScopeMatches(
  relationship: AthenaMappedEffectRelationship,
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
): boolean {
  const sourceController = relationship.source.controller;
  const explicitController = stringMetadata(event.metadata.controller);
  const targetControllers = uniqueStrings(
    event.subjectGroupIds.flatMap((groupId) => {
      const target = environment.context.battlefield.find(
        (object) => object.groupId === groupId,
      );
      return target?.controller ? [String(target.controller)] : [];
    }),
  );
  if (
    sourceController &&
    explicitController &&
    explicitController !== String(sourceController)
  ) {
    return false;
  }
  if (
    sourceController &&
    targetControllers.some(
      (controller) => controller !== String(sourceController),
    )
  ) {
    return false;
  }
  if (
    event.eventCategory === "counter-placed" &&
    event.metadata.targetKind === "player"
  ) {
    return false;
  }
  return true;
}

function excludedReplacement(
  relationship: AthenaMappedEffectRelationship,
  reason: AthenaExcludedReplacement["reason"],
  explanation: string,
): AthenaExcludedReplacement {
  return {
    id: `athena-replacement-excluded:${normalizeIdPart(relationship.id)}:${reason}`,
    relationshipId: relationship.id,
    sourceGroupId: relationship.source.battlefieldObjectGroupId,
    sourceLabel:
      relationship.source.currentCardFace ??
      relationship.source.abilityIdentifier,
    reason,
    explanation,
  };
}

function excludedCustomReplacement(
  definition: AthenaReplacementDefinition,
  reason: AthenaExcludedReplacement["reason"],
): AthenaExcludedReplacement {
  return {
    id: `athena-replacement-excluded:${normalizeIdPart(definition.relationshipId)}:${reason}`,
    relationshipId: definition.relationshipId,
    sourceGroupId: definition.sourceGroupId,
    sourceLabel: definition.sourceLabel,
    reason,
    explanation: `${definition.sourceLabel} was excluded because its custom replacement definition is ${reason.replace(/-/g, " ")}.`,
  };
}

function exclusionForCustomDefinition(
  definition: AthenaReplacementDefinition,
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
): AthenaExcludedReplacement | null {
  if (!definition.enabled) {
    return excludedCustomReplacement(definition, "disabled");
  }
  if (definition.sourceGroupId) {
    const source = environment.context.battlefield.find(
      (object) => object.groupId === definition.sourceGroupId,
    );
    if (!source) {
      return excludedCustomReplacement(definition, "source-missing");
    }
    if (!source.trackingEnabled) {
      return excludedCustomReplacement(definition, "not-tracked");
    }
    if (
      source.sourceUnavailableReason === "depowered" ||
      !source.abilitiesActive
    ) {
      return excludedCustomReplacement(definition, "depowered");
    }
    if (source.zone !== "battlefield") {
      return excludedCustomReplacement(definition, "disabled");
    }
  }
  if (!customDefinitionScopeMatches(definition, environment, event)) {
    return excludedCustomReplacement(definition, "scope-mismatch");
  }
  return null;
}

function customDefinitionScopeMatches(
  definition: AthenaReplacementDefinition,
  environment: AthenaForecastEnvironment,
  event: AthenaForecastInput,
): boolean {
  if (definition.sourceGroupId) {
    const source = environment.context.battlefield.find(
      (object) => object.groupId === definition.sourceGroupId,
    );
    if (!source || !source.trackingEnabled || source.zone !== "battlefield") {
      return false;
    }
  }
  if (
    definition.scope.kind === "controlled-tokens" &&
    event.eventCategory !== "token-created"
  ) {
    return false;
  }
  if (
    definition.scope.kind === "controlled-permanents" &&
    (event.eventCategory !== "counter-placed" ||
      event.metadata.targetKind === "player")
  ) {
    return false;
  }
  if (
    definition.scope.kind === "specific-counter-types" &&
    !definition.scope.counterTypes.includes("*") &&
    (!event.counterType ||
      !definition.scope.counterTypes.some(
        (counter) => counter.toLowerCase() === event.counterType?.toLowerCase(),
      ))
  ) {
    return false;
  }
  if (
    definition.scope.kind === "specific-permanent-types" &&
    !definition.scope.permanentTypes.some((type) =>
      event.knownCharacteristics?.cardTypes.some(
        (cardType) => cardType.toLowerCase() === type.toLowerCase(),
      ),
    )
  ) {
    return false;
  }
  if (definition.scope.controllerMode === "any") return true;
  const sourceController = definition.sourceGroupId
    ? environment.context.battlefield.find(
        (object) => object.groupId === definition.sourceGroupId,
      )?.controller
    : null;
  const targetControllers = uniqueStrings(
    event.subjectGroupIds.flatMap((groupId) => {
      const target = environment.context.battlefield.find(
        (object) => object.groupId === groupId,
      );
      return target?.controller ? [String(target.controller)] : [];
    }),
  );
  return !sourceController
    ? true
    : targetControllers.every(
        (controller) => controller === String(sourceController),
      );
}

function validateDefinition(
  definition: AthenaReplacementDefinition,
): string | null {
  if (
    definition.version !== ATHENA_REPLACEMENT_CHAIN_VERSION ||
    !definition.id.trim() ||
    !definition.relationshipId.trim() ||
    !definition.sourceLabel.trim() ||
    definition.eventCategories.length === 0 ||
    definition.eventCategories.some(
      (eventCategory) => !EVENT_CATEGORY_SET.has(eventCategory),
    ) ||
    !Number.isSafeInteger(definition.sourceQuantity) ||
    definition.sourceQuantity <= 0
  ) {
    return `${definition.sourceLabel || "Custom replacement"} has invalid identity, event, or source quantity metadata.`;
  }
  const modification = definition.modification;
  if (
    modification.category === "quantity-multiplier" &&
    (!Number.isSafeInteger(modification.factor) || modification.factor <= 0)
  ) {
    return `${definition.sourceLabel} has an invalid quantity multiplier.`;
  }
  if (
    modification.category === "quantity-additive" &&
    (!Number.isSafeInteger(modification.amount) || modification.amount === 0)
  ) {
    return `${definition.sourceLabel} has an invalid additive modifier.`;
  }
  if (
    modification.category === "quantity-setter" &&
    (!Number.isSafeInteger(modification.quantity) || modification.quantity < 0)
  ) {
    return `${definition.sourceLabel} has an invalid quantity setter.`;
  }
  if (
    modification.category === "event-substitution" &&
    !EVENT_CATEGORY_SET.has(modification.eventCategory)
  ) {
    return `${definition.sourceLabel} has an unsupported event substitution.`;
  }
  if (
    modification.category === "entry-state" &&
    modification.tapped === undefined &&
    modification.transformed === undefined &&
    modification.counterType === undefined &&
    modification.characteristicPatch === undefined
  ) {
    return `${definition.sourceLabel} has an empty entry-state modifier.`;
  }
  return null;
}

function expandApplications(
  candidates: ReplacementCandidate[],
  eventId: string,
): ReplacementApplicationCandidate[] {
  const applications: ReplacementApplicationCandidate[] = [];
  for (const candidate of candidates) {
    for (
      let sourceInstance = 1;
      sourceInstance <= candidate.definition.sourceQuantity;
      sourceInstance += 1
    ) {
      applications.push({
        ...candidate,
        applicationId: `${eventId}:${candidate.definition.relationshipId}:application:${sourceInstance}`,
        sourceInstance,
      });
    }
  }
  return uniqueApplications(applications);
}

function orderApplications(
  applications: ReplacementApplicationCandidate[],
  selectedReplacementOrder: string[] | undefined,
): {
  safe: boolean;
  applications: ReplacementApplicationCandidate[];
} {
  if (applications.length <= 1) {
    return { safe: true, applications: [...applications] };
  }
  if (selectedReplacementOrder && selectedReplacementOrder.length > 0) {
    const relationshipIds = uniqueStrings(
      applications.map((application) => application.definition.relationshipId),
    );
    const normalizedOrder = [
      ...new Set(selectedReplacementOrder.filter((id) => Boolean(id))),
    ];
    if (
      normalizedOrder.length === relationshipIds.length &&
      relationshipIds.every((id) => normalizedOrder.includes(id))
    ) {
      const rank = new Map(
        normalizedOrder.map((relationshipId, index) => [relationshipId, index]),
      );
      return {
        safe: true,
        applications: [...applications].sort(
          (a, b) =>
            (rank.get(a.definition.relationshipId) ?? Number.MAX_SAFE_INTEGER) -
              (rank.get(b.definition.relationshipId) ??
                Number.MAX_SAFE_INTEGER) ||
            a.applicationId.localeCompare(b.applicationId),
        ),
      };
    }
  }
  const categories = uniqueStrings(
    applications.map(
      (application) => application.definition.modification.category,
    ),
  );
  const sameCommutativeCategory =
    categories.length === 1 &&
    applications.every((application) => application.definition.commutative) &&
    (categories[0] === "quantity-multiplier" ||
      categories[0] === "quantity-additive");
  if (sameCommutativeCategory) {
    return {
      safe: true,
      applications: [...applications].sort((a, b) =>
        a.applicationId.localeCompare(b.applicationId),
      ),
    };
  }
  const explicitOrders = applications.map(
    (application) => application.definition.order,
  );
  const hasCompleteDistinctOrder =
    explicitOrders.every((order) => order !== null) &&
    new Set(explicitOrders).size === explicitOrders.length;
  if (hasCompleteDistinctOrder) {
    return {
      safe: true,
      applications: [...applications].sort(
        (a, b) =>
          (a.definition.order ?? 0) - (b.definition.order ?? 0) ||
          a.applicationId.localeCompare(b.applicationId),
      ),
    };
  }
  return { safe: false, applications: [...applications] };
}

function applyModification(
  originalEvent: AthenaForecastInput,
  currentEvent: AthenaForecastInput,
  application: ReplacementApplicationCandidate,
  stepNumber: number,
): AppliedModification {
  const modification = application.definition.modification;
  let quantity = currentEvent.quantity;
  let eventCategory = currentEvent.eventCategory;
  let zoneDestination = currentEvent.zoneDestination;
  let knownCharacteristics = currentEvent.knownCharacteristics
    ? {
        ...currentEvent.knownCharacteristics,
        cardTypes: [...currentEvent.knownCharacteristics.cardTypes],
        supertypes: [...currentEvent.knownCharacteristics.supertypes],
        subtypes: [...currentEvent.knownCharacteristics.subtypes],
        colors: [...currentEvent.knownCharacteristics.colors],
        knownFields: [...currentEvent.knownCharacteristics.knownFields],
      }
    : null;
  const metadata = { ...currentEvent.metadata };
  let explanation = "";

  if (modification.category === "quantity-multiplier") {
    const product = quantity * modification.factor;
    if (
      !Number.isSafeInteger(product) ||
      product > ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY
    ) {
      return { event: currentEvent, explanation: "", error: "overflow" };
    }
    quantity = product;
    explanation = `${application.definition.sourceLabel} changes ${currentEvent.quantity} into ${quantity}.`;
  } else if (modification.category === "quantity-additive") {
    const sum = quantity + modification.amount;
    if (
      !Number.isSafeInteger(sum) ||
      sum < 0 ||
      sum > ATHENA_REPLACEMENT_MAX_SAFE_QUANTITY
    ) {
      return { event: currentEvent, explanation: "", error: "overflow" };
    }
    quantity = sum;
    explanation = `${application.definition.sourceLabel} changes ${currentEvent.quantity} into ${quantity}.`;
  } else if (modification.category === "quantity-setter") {
    quantity = modification.quantity;
    explanation = `${application.definition.sourceLabel} sets the event quantity to ${quantity}.`;
  } else if (modification.category === "destination-replacement") {
    zoneDestination = modification.destination;
    explanation = `${application.definition.sourceLabel} changes the destination to ${modification.destination}.`;
  } else if (modification.category === "event-substitution") {
    eventCategory = modification.eventCategory;
    explanation = `${application.definition.sourceLabel} substitutes ${currentEvent.eventCategory} with ${eventCategory}.`;
  } else if (modification.category === "entry-state") {
    if (modification.tapped !== undefined) {
      metadata.entersTapped = modification.tapped;
    }
    if (modification.transformed !== undefined) {
      metadata.entersTransformed = modification.transformed;
    }
    if (modification.counterType) {
      metadata.entryCounterType = modification.counterType;
      metadata.entryCounterQuantity = modification.counterQuantity ?? 1;
    }
    if (modification.characteristicPatch) {
      knownCharacteristics = mergeCharacteristics(
        knownCharacteristics,
        modification.characteristicPatch,
      );
    }
    explanation = `${application.definition.sourceLabel} changes how the object enters.`;
  } else {
    return { event: currentEvent, explanation: "", error: "invalid" };
  }

  const eventId = `${originalEvent.eventId}:r${stepNumber}`;
  const event: AthenaForecastInput = {
    ...currentEvent,
    id: `${originalEvent.id}:replacement:${stepNumber}`,
    eventId,
    eventCategory,
    eventSource: "lite-helper",
    authoritySource: "lite-local-helper-result",
    authorityPrecedence: rankAthenaAuthoritySource("lite-local-helper-result"),
    quantity,
    knownCharacteristics,
    zoneDestination,
    metadata: {
      ...metadata,
      replacementRootEventId: originalEvent.eventId,
      replacementStep: stepNumber,
      replacementSource: application.definition.sourceLabel,
      replacementApplicationId: application.applicationId,
    },
  };
  return { event, explanation, error: null };
}

function mergeCharacteristics(
  current: AthenaForecastInput["knownCharacteristics"],
  patch: NonNullable<
    Extract<
      AthenaReplacementModification,
      { category: "entry-state" }
    >["characteristicPatch"]
  >,
): AthenaForecastInput["knownCharacteristics"] {
  const cardTypes = patch.cardTypes ?? current?.cardTypes ?? [];
  const supertypes = patch.supertypes ?? current?.supertypes ?? [];
  const subtypes = patch.subtypes ?? current?.subtypes ?? [];
  const colors = patch.colors ?? current?.colors ?? [];
  const knownFields = uniqueStrings([
    ...(current?.knownFields ?? []),
    ...ENTRY_CHARACTERISTIC_FIELDS.filter((field) =>
      Object.prototype.hasOwnProperty.call(patch, field),
    ),
  ]);
  return {
    cardTypes: uniqueStrings(cardTypes),
    supertypes: uniqueStrings(supertypes),
    subtypes: uniqueStrings(subtypes),
    colors: uniqueStrings(colors),
    manaValue:
      typeof patch.manaValue === "number"
        ? patch.manaValue
        : (current?.manaValue ?? null),
    isToken: patch.isToken ?? current?.isToken ?? false,
    isCreature:
      patch.isCreature ?? current?.isCreature ?? cardTypes.includes("Creature"),
    isLegendary:
      patch.isLegendary ??
      current?.isLegendary ??
      supertypes.includes("Legendary"),
    knownFields,
  };
}

function successfulResult(input: {
  id: string;
  cacheKey: string;
  timestamp: string;
  validity: "resolved" | "bypassed";
  originalEvent: AthenaForecastInput;
  finalEvent: AthenaForecastInput;
  versions: AthenaReplacementVersionSnapshot;
  definitions: AthenaReplacementDefinition[];
  excluded: AthenaExcludedReplacement[];
  steps: AthenaReplacementApplication[];
  choices: AthenaReplacementChoiceRequirement[];
  warnings: AthenaReplacementWarning[];
  authorityFinalEventAccepted: boolean;
  durationMs: number;
  forecastReference: string | null;
  cacheHit: boolean;
  discrepancyCount: number;
  duplicateCount?: number;
  semanticDescriptions: string[];
}): AthenaReplacementProcessingResult {
  const appliedRelationshipIds = uniqueStrings(
    input.steps.map((step) => step.relationshipId),
  );
  const appliedApplicationIds = uniqueStrings(
    input.steps.map((step) => step.applicationId),
  );
  const diagnostics = replacementDiagnostics({
    durationMs: input.durationMs,
    definitions: input.definitions,
    steps: input.steps,
    validity: input.validity,
    duplicateCount: input.duplicateCount ?? 0,
    loopDetected: false,
    cacheHit: input.cacheHit,
    stale: false,
    discrepancyCount: input.discrepancyCount,
    error: null,
  });
  return {
    version: ATHENA_REPLACEMENT_CHAIN_VERSION,
    id: input.id,
    cacheKey: input.cacheKey,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    validity: input.validity,
    originalEvent: input.originalEvent,
    currentModifiedEvent: input.finalEvent,
    finalEvent: input.finalEvent,
    applicableDefinitions: input.definitions,
    excludedReplacements: uniqueExcluded(input.excluded),
    appliedRelationshipIds,
    appliedApplicationIds,
    replacementOrder: input.steps.map((step) => step.id),
    steps: input.steps,
    requiredChoices: input.choices,
    warnings: uniqueWarnings(input.warnings),
    semanticDescriptions: uniqueStrings(input.semanticDescriptions),
    authoritySource: input.authorityFinalEventAccepted
      ? "boardstate-authoritative-result"
      : input.steps.length > 0
        ? "lite-local-helper-result"
        : input.originalEvent.authoritySource,
    authorityPrecedence: input.authorityFinalEventAccepted
      ? rankAthenaAuthoritySource("boardstate-authoritative-result")
      : input.steps.length > 0
        ? rankAthenaAuthoritySource("lite-local-helper-result")
        : input.originalEvent.authorityPrecedence,
    authorityFinalEventAccepted: input.authorityFinalEventAccepted,
    versions: input.versions,
    forecastReference: input.forecastReference,
    canonicalEventReference: input.originalEvent.canonicalResultReference,
    diagnostics,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    directBattlefieldMutation: false,
    canonicalStateMutated: false,
  };
}

function unresolvedResult(input: {
  id: string;
  cacheKey: string;
  timestamp: string;
  validity: Exclude<AthenaReplacementValidity, "resolved" | "bypassed">;
  event: AthenaForecastInput;
  versions: AthenaReplacementVersionSnapshot;
  definitions: AthenaReplacementDefinition[];
  excluded: AthenaExcludedReplacement[];
  choices: AthenaReplacementChoiceRequirement[];
  warnings: AthenaReplacementWarning[];
  durationMs: number;
  forecastReference: string | null;
  cacheHit: boolean;
  loopDetected?: boolean;
}): AthenaReplacementProcessingResult {
  const diagnostics = replacementDiagnostics({
    durationMs: input.durationMs,
    definitions: input.definitions,
    steps: [],
    validity: input.validity,
    duplicateCount: 0,
    loopDetected: Boolean(input.loopDetected),
    cacheHit: input.cacheHit,
    stale: input.validity === "stale",
    discrepancyCount: 0,
    error: input.warnings[0]?.message ?? null,
  });
  return {
    version: ATHENA_REPLACEMENT_CHAIN_VERSION,
    id: input.id,
    cacheKey: input.cacheKey,
    createdAt: input.timestamp,
    updatedAt: input.timestamp,
    validity: input.validity,
    originalEvent: input.event,
    currentModifiedEvent: input.event,
    finalEvent: null,
    applicableDefinitions: input.definitions,
    excludedReplacements: uniqueExcluded(input.excluded),
    appliedRelationshipIds: [],
    appliedApplicationIds: [],
    replacementOrder: [],
    steps: [],
    requiredChoices: input.choices,
    warnings: uniqueWarnings(input.warnings),
    semanticDescriptions: uniqueStrings([
      ...input.warnings.map((warning) => warning.message),
      ...input.choices.map((choice) => choice.prompt),
    ]),
    authoritySource: input.event.authoritySource,
    authorityPrecedence: input.event.authorityPrecedence,
    authorityFinalEventAccepted: false,
    versions: input.versions,
    forecastReference: input.forecastReference,
    canonicalEventReference: input.event.canonicalResultReference,
    diagnostics,
    committedStateReadOnly: true,
    previewStateIsolated: true,
    directBattlefieldMutation: false,
    canonicalStateMutated: false,
  };
}

function terminalResult(input: {
  id: string;
  cacheKey: string;
  timestamp: string;
  validity: Exclude<AthenaReplacementValidity, "resolved" | "bypassed">;
  event: AthenaForecastInput;
  versions: AthenaReplacementVersionSnapshot;
  warning: AthenaReplacementWarning;
  durationMs: number;
  forecastReference: string | null;
  cacheHit: boolean;
}): AthenaReplacementProcessingResult {
  return unresolvedResult({
    id: input.id,
    cacheKey: input.cacheKey,
    timestamp: input.timestamp,
    validity: input.validity,
    event: input.event,
    versions: input.versions,
    definitions: [],
    excluded: [],
    choices: [],
    warnings: [input.warning],
    durationMs: input.durationMs,
    forecastReference: input.forecastReference,
    cacheHit: input.cacheHit,
  });
}

function replacementDiagnostics(input: {
  durationMs: number;
  definitions: AthenaReplacementDefinition[];
  steps: AthenaReplacementApplication[];
  validity: AthenaReplacementValidity;
  duplicateCount: number;
  loopDetected: boolean;
  cacheHit: boolean;
  stale: boolean;
  discrepancyCount: number;
  error: string | null;
}): AthenaReplacementDiagnostics {
  const tokenRelationships = new Set(
    input.definitions
      .filter(
        (definition) =>
          definition.modification.category === "quantity-multiplier" &&
          definition.eventCategories.includes("token-created"),
      )
      .map((definition) => definition.relationshipId),
  );
  const counterRelationships = new Set(
    input.definitions
      .filter(
        (definition) =>
          definition.modification.category === "quantity-multiplier" &&
          definition.eventCategories.includes("counter-placed"),
      )
      .map((definition) => definition.relationshipId),
  );
  return {
    chainVersion: ATHENA_REPLACEMENT_CHAIN_VERSION,
    cacheVersion: ATHENA_REPLACEMENT_CACHE_VERSION,
    processingDurationMs: input.durationMs,
    applicableReplacementCount: input.definitions.length,
    appliedReplacementCount: input.steps.length,
    tokenMultiplierCount: input.steps.filter((step) =>
      tokenRelationships.has(step.relationshipId),
    ).length,
    counterMultiplierCount: input.steps.filter((step) =>
      counterRelationships.has(step.relationshipId),
    ).length,
    additiveModifierCount: input.steps.filter(
      (step) => step.modificationCategory === "quantity-additive",
    ).length,
    destinationReplacementCount: input.steps.filter(
      (step) => step.modificationCategory === "destination-replacement",
    ).length,
    eventSubstitutionCount: input.steps.filter(
      (step) => step.modificationCategory === "event-substitution",
    ).length,
    unresolvedReplacementCount:
      input.validity === "resolved" || input.validity === "bypassed" ? 0 : 1,
    authorityRequiredReplacementCount:
      input.validity === "authority-required" ? 1 : 0,
    duplicatePreventionCount: input.duplicateCount,
    loopDetectionCount: input.loopDetected ? 1 : 0,
    chainLength: input.steps.length,
    cacheHit: input.cacheHit,
    staleChainRejected: input.stale,
    localAuthorityDiscrepancyCount: input.discrepancyCount,
    lastReplacementError: input.error,
    productionVisible: false,
    directBattlefieldMutation: false,
  };
}

function replacementVersionSnapshot(
  event: AthenaForecastInput,
  environment: AthenaForecastEnvironment,
): AthenaReplacementVersionSnapshot {
  return {
    awarenessContextVersion: environment.context.version,
    awarenessContextFingerprint: event.awarenessContextFingerprint,
    dependencyGraphVersion: environment.graph.version,
    dependencyGraphFingerprint: environment.graph.fingerprint,
    relationshipMapVersion: environment.relationshipMap.version,
    relationshipMapFingerprint: environment.relationshipMap.fingerprint,
  };
}

function validateReplacementVersions(
  event: AthenaForecastInput,
  environment: AthenaForecastEnvironment,
): string | null {
  if (event.canonicalSessionId !== environment.context.sessionId) {
    return "Replacement input belongs to a different canonical session.";
  }
  if (event.awarenessContextVersion !== environment.context.version) {
    return "Replacement awareness-context version is stale.";
  }
  if (
    event.dependencyGraphVersion !== environment.graph.version ||
    event.dependencyGraphFingerprint !== environment.graph.fingerprint
  ) {
    return "Replacement dependency-graph version is stale.";
  }
  if (
    event.relationshipMapVersion !== environment.relationshipMap.version ||
    event.relationshipMapFingerprint !== environment.relationshipMap.fingerprint
  ) {
    return "Replacement relationship-map version is stale.";
  }
  return null;
}

function replacementCacheKey(
  event: AthenaForecastInput,
  versions: AthenaReplacementVersionSnapshot,
  options: AthenaReplacementProcessingOptions,
): string {
  return stableHash(
    serializeStable({
      cacheVersion: ATHENA_REPLACEMENT_CACHE_VERSION,
      event,
      versions,
      customDefinitions: options.customDefinitions ?? [],
      authoritativeFinalEvent: options.authoritativeFinalEvent ?? null,
      previouslyAppliedApplicationIds:
        options.previouslyAppliedApplicationIds ?? [],
      selectedReplacementOrder: options.selectedReplacementOrder ?? [],
      optionalReplacementDecisions: options.optionalReplacementDecisions ?? {},
    }),
  );
}

function eventSignature(event: AthenaForecastInput): string {
  return serializeStable({
    eventCategory: event.eventCategory,
    quantity: event.quantity,
    knownCharacteristics: event.knownCharacteristics,
    zoneOrigin: event.zoneOrigin,
    zoneDestination: event.zoneDestination,
    counterType: event.counterType,
    metadata: {
      entersTapped: event.metadata.entersTapped ?? null,
      entersTransformed: event.metadata.entersTransformed ?? null,
      entryCounterType: event.metadata.entryCounterType ?? null,
      entryCounterQuantity: event.metadata.entryCounterQuantity ?? null,
    },
  });
}

function replacementResultAffected(
  result: AthenaReplacementProcessingResult,
  input: AthenaReplacementInvalidationInput,
): boolean {
  if (result.validity === "stale" || result.validity === "cancelled") {
    return false;
  }
  if (
    input.currentVersions &&
    Object.entries(input.currentVersions).some(
      ([key, value]) =>
        value !== undefined &&
        result.versions[key as keyof AthenaReplacementVersionSnapshot] !==
          value,
    )
  ) {
    return true;
  }
  const relationshipIds = new Set(
    result.applicableDefinitions.map((definition) => definition.relationshipId),
  );
  if (input.relationshipIds?.some((id) => relationshipIds.has(id))) return true;
  const groupIds = new Set([
    ...result.originalEvent.subjectGroupIds,
    ...result.applicableDefinitions.flatMap((definition) =>
      definition.sourceGroupId ? [definition.sourceGroupId] : [],
    ),
  ]);
  return Boolean(input.groupIds?.some((id) => groupIds.has(id)));
}

function copyForecastInput(event: AthenaForecastInput): AthenaForecastInput {
  return {
    ...event,
    subjectGroupIds: [...event.subjectGroupIds],
    subjectObjectIds: [...event.subjectObjectIds],
    knownCharacteristics: event.knownCharacteristics
      ? {
          ...event.knownCharacteristics,
          cardTypes: [...event.knownCharacteristics.cardTypes],
          supertypes: [...event.knownCharacteristics.supertypes],
          subtypes: [...event.knownCharacteristics.subtypes],
          colors: [...event.knownCharacteristics.colors],
          knownFields: [...event.knownCharacteristics.knownFields],
        }
      : null,
    tokenDefinition: event.tokenDefinition
      ? {
          ...event.tokenDefinition,
          characteristics: {
            ...event.tokenDefinition.characteristics,
            cardTypes: [...event.tokenDefinition.characteristics.cardTypes],
            supertypes: [...event.tokenDefinition.characteristics.supertypes],
            subtypes: [...event.tokenDefinition.characteristics.subtypes],
            colors: [...event.tokenDefinition.characteristics.colors],
            knownFields: [...event.tokenDefinition.characteristics.knownFields],
          },
        }
      : null,
    permanentDefinition: event.permanentDefinition
      ? {
          ...event.permanentDefinition,
          colors: [...event.permanentDefinition.colors],
          colorIdentity: [...event.permanentDefinition.colorIdentity],
          keywords: [...event.permanentDefinition.keywords],
          cardFaces: event.permanentDefinition.cardFaces.map((face) => ({
            ...face,
          })),
        }
      : null,
    relevantTotalImplications: { ...event.relevantTotalImplications },
    confidence: event.confidence ? { ...event.confidence } : null,
    metadata: { ...event.metadata },
  };
}

function copyDefinition(
  definition: AthenaReplacementDefinition,
): AthenaReplacementDefinition {
  return {
    ...definition,
    sourceObjectIds: [...definition.sourceObjectIds],
    eventCategories: [...definition.eventCategories],
    modification: { ...definition.modification },
    scope: {
      ...definition.scope,
      counterTypes: [...definition.scope.counterTypes],
      permanentTypes: [...definition.scope.permanentTypes],
    },
    metadata: { ...definition.metadata },
  };
}

function replacementWarning(
  code: AthenaReplacementWarning["code"],
  message: string,
  relationshipId: string | null = null,
  sourceGroupId: string | null = null,
): AthenaReplacementWarning {
  return {
    id: `athena-replacement-warning:${code}:${stableHash(`${relationshipId ?? "none"}:${sourceGroupId ?? "none"}:${message}`)}`,
    code,
    message,
    relationshipId,
    sourceGroupId,
  };
}

function uniqueDefinitions(
  definitions: AthenaReplacementDefinition[],
): AthenaReplacementDefinition[] {
  const byId = new Map<string, AthenaReplacementDefinition>();
  for (const definition of definitions) {
    if (!byId.has(definition.id)) byId.set(definition.id, definition);
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueApplications(
  applications: ReplacementApplicationCandidate[],
): ReplacementApplicationCandidate[] {
  const byId = new Map<string, ReplacementApplicationCandidate>();
  for (const application of applications) {
    if (!byId.has(application.applicationId)) {
      byId.set(application.applicationId, application);
    }
  }
  return [...byId.values()].sort((a, b) =>
    a.applicationId.localeCompare(b.applicationId),
  );
}

function uniqueExcluded(
  values: AthenaExcludedReplacement[],
): AthenaExcludedReplacement[] {
  return uniqueById(values);
}

function uniqueWarnings(
  values: AthenaReplacementWarning[],
): AthenaReplacementWarning[] {
  return uniqueById(values);
}

function uniqueById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  for (const value of values)
    if (!byId.has(value.id)) byId.set(value.id, value);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numericMetadata(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function booleanMetadata(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function zoneMetadata(value: unknown): AthenaForecastInput["zoneDestination"] {
  return value === "battlefield" ||
    value === "hand" ||
    value === "graveyard" ||
    value === "exile" ||
    value === "library" ||
    value === "command"
    ? value
    : null;
}

function boundedInteger(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function trimMap<K, V>(map: Map<K, V>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value as K | undefined;
    if (oldest === undefined) break;
    map.delete(oldest);
  }
}

function emptyAggregateDiagnostics(): Pick<
  AthenaReplacementDiagnostics,
  | "appliedReplacementCount"
  | "tokenMultiplierCount"
  | "counterMultiplierCount"
  | "additiveModifierCount"
  | "destinationReplacementCount"
  | "eventSubstitutionCount"
  | "unresolvedReplacementCount"
  | "authorityRequiredReplacementCount"
  | "duplicatePreventionCount"
  | "loopDetectionCount"
  | "localAuthorityDiscrepancyCount"
  | "lastReplacementError"
> {
  return {
    appliedReplacementCount: 0,
    tokenMultiplierCount: 0,
    counterMultiplierCount: 0,
    additiveModifierCount: 0,
    destinationReplacementCount: 0,
    eventSubstitutionCount: 0,
    unresolvedReplacementCount: 0,
    authorityRequiredReplacementCount: 0,
    duplicatePreventionCount: 0,
    loopDetectionCount: 0,
    localAuthorityDiscrepancyCount: 0,
    lastReplacementError: null,
  };
}

function addDiagnostics(
  aggregate: ReturnType<typeof emptyAggregateDiagnostics>,
  current: AthenaReplacementDiagnostics,
): ReturnType<typeof emptyAggregateDiagnostics> {
  return {
    appliedReplacementCount:
      aggregate.appliedReplacementCount + current.appliedReplacementCount,
    tokenMultiplierCount:
      aggregate.tokenMultiplierCount + current.tokenMultiplierCount,
    counterMultiplierCount:
      aggregate.counterMultiplierCount + current.counterMultiplierCount,
    additiveModifierCount:
      aggregate.additiveModifierCount + current.additiveModifierCount,
    destinationReplacementCount:
      aggregate.destinationReplacementCount +
      current.destinationReplacementCount,
    eventSubstitutionCount:
      aggregate.eventSubstitutionCount + current.eventSubstitutionCount,
    unresolvedReplacementCount:
      aggregate.unresolvedReplacementCount + current.unresolvedReplacementCount,
    authorityRequiredReplacementCount:
      aggregate.authorityRequiredReplacementCount +
      current.authorityRequiredReplacementCount,
    duplicatePreventionCount:
      aggregate.duplicatePreventionCount + current.duplicatePreventionCount,
    loopDetectionCount:
      aggregate.loopDetectionCount + current.loopDetectionCount,
    localAuthorityDiscrepancyCount:
      aggregate.localAuthorityDiscrepancyCount +
      current.localAuthorityDiscrepancyCount,
    lastReplacementError:
      current.lastReplacementError ?? aggregate.lastReplacementError,
  };
}
