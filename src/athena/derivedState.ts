import { calculateTotals } from "../domain/field";
import {
  ATHENA_STATIC_EFFECT_DEFINITIONS,
  getAthenaStaticEffectDefinitionsForCard,
  type AthenaStaticEffectDefinition,
  type AthenaStaticTargetFilter,
  type AthenaStaticValueExpression,
} from "../domain/staticEffects";
import type {
  FieldState,
  PermanentGroup,
  RelevantTotalKey,
} from "../domain/types";
import {
  isZoneCategoryRelevantTotalKey,
  zoneCategoryReliability,
  zoneCategoryRelevantTotals,
} from "../domain/zoneComposition";
import type {
  ZoneCategoryRelevantTotalKey,
  ZoneCategorySnapshot,
} from "../domain/zoneCompositionTypes";
import { monotonicNowMs } from "../platform/runtime";
import { serializeStable } from "../utils/stableSerialization";
import { buildAthenaDependencyGraphFromContext } from "./dependencyGraph";
import { buildAthenaEffectRelationshipMapFromContext } from "./effectRelationshipMapper";
import {
  createAthenaAwarenessContext,
  rankAthenaAuthoritySource,
} from "./foundation";
import type {
  AthenaDependencyGraph,
  AthenaGraphChange,
} from "./dependencyGraphTypes";
import type {
  AthenaEffectRelationshipMap,
  AthenaMappedEffectRelationship,
} from "./effectRelationshipMapperTypes";
import {
  ATHENA_DERIVED_MAX_SAFE_VALUE,
  ATHENA_DERIVED_STATE_CACHE_LIMIT,
  ATHENA_DERIVED_STATE_CACHE_VERSION,
  ATHENA_DERIVED_STATE_VERSION,
  type AthenaAuthoritativeDerivedValue,
  type AthenaDerivedBattlefieldState,
  type AthenaDerivedContribution,
  type AthenaDerivedFieldApplicationResult,
  type AthenaDerivedObjectState,
  type AthenaDerivedPreviewRequest,
  type AthenaDerivedPreviewResult,
  type AthenaDerivedStateBuildOptions,
  type AthenaDerivedStateDiagnostics,
  type AthenaDerivedStateQueryApi,
  type AthenaDerivedStateUpdateOptions,
  type AthenaDerivedStateUpdateResult,
  type AthenaDerivedStateValidity,
} from "./derivedStateTypes";
import type {
  AthenaAuthoritySource,
  AthenaSupportFindingStatus,
} from "./types";
import { athenaPerformanceMonitor } from "./performanceOptimization";

interface BuildEnvironment {
  field: FieldState;
  definitions: readonly AthenaStaticEffectDefinition[];
  totals: Record<RelevantTotalKey, number>;
  zoneCategoryReliability: Map<
    ZoneCategoryRelevantTotalKey,
    ZoneCategorySnapshot
  >;
  graph: AthenaDependencyGraph;
  relationshipMap: AthenaEffectRelationshipMap;
  relationshipsByDefinition: Map<string, StaticRelationshipReference>;
  canonicalFingerprint: string;
  timestamp: string;
  authoritySource: AthenaAuthoritySource;
  authoritativeValues: Map<string, AthenaAuthoritativeDerivedValue>;
  cyclicDefinitionIds: Set<string>;
}

interface StaticRelationshipReference {
  id: string;
  enabled: boolean;
  disabledReason: string | null;
  authoritySource: AthenaAuthoritySource;
  support: AthenaSupportFindingStatus | null;
}

interface MutableDerivedObject {
  group: PermanentGroup;
  characteristicPower: number | null;
  characteristicToughness: number | null;
  counterPower: number;
  counterToughness: number;
  staticPower: number;
  staticToughness: number;
  attachmentPower: number;
  attachmentToughness: number;
  contributions: AthenaDerivedContribution[];
  appliedRelationshipIds: Set<string>;
  disabledRelationshipIds: Set<string>;
  reasonCodes: Set<string>;
  support: AthenaSupportFindingStatus;
  validity: AthenaDerivedStateValidity;
  authoritySource: AthenaAuthoritySource;
}

interface RecalculationStats {
  durationMs: number;
  dirtyGroupIds: string[];
  staticRelationshipCount: number;
  activeStaticRelationshipCount: number;
  disabledStaticRelationshipCount: number;
  authorityOverrideCount: number;
  unsupportedStaticCalculationCount: number;
  manualResolutionCount: number;
  cycleDetectionCount: number;
}

export function canonicalDerivedFingerprint(field: FieldState): string {
  return serializeStable({
    fieldId: field.id,
    session: {
      id: field.session.id,
      version: field.session.version,
      synchronizationVersion: field.session.synchronizationVersion,
      currentRulesAuthority: field.session.currentRulesAuthority,
    },
    groups: field.groups.map((group) => ({
      id: group.id,
      session: group.session,
      quantity: group.quantity,
      zone: group.zone,
      owner: group.owner,
      controller: group.controller,
      identity: group.identity,
      originalIdentity: group.originalIdentity,
      characteristics: group.characteristics,
      counters: group.counters,
      attachments: group.attachments,
      attachedTo: group.attachedTo,
      abilitiesActive: group.abilitiesActive,
      trackingEnabled: group.trackingEnabled,
      depowerMode: group.depowerMode,
      disabledAbilities: group.disabledAbilities,
      isGeneric: group.isGeneric,
      pt: {
        printedPower: group.pt.printedPower,
        printedToughness: group.pt.printedToughness,
        basePower: group.pt.basePower,
        baseToughness: group.pt.baseToughness,
        temporaryPower: group.pt.temporaryPower,
        temporaryToughness: group.pt.temporaryToughness,
        powerToughnessSwitch: group.pt.powerToughnessSwitch,
        damage: group.pt.damage,
      },
    })),
    zoneCompositions: field.zoneCompositions,
  });
}

export function buildAthenaDerivedBattlefieldState(
  field: FieldState,
  options: AthenaDerivedStateBuildOptions = {},
): AthenaDerivedBattlefieldState {
  return buildDerivedBattlefieldState(
    field,
    options,
    canonicalDerivedFingerprint(field),
  );
}

function buildDerivedBattlefieldState(
  field: FieldState,
  options: AthenaDerivedStateBuildOptions,
  canonicalFingerprint: string,
): AthenaDerivedBattlefieldState {
  const started = monotonicNowMs();
  const definitions = cloneDefinitions(
    options.definitions ?? ATHENA_STATIC_EFFECT_DEFINITIONS,
  );
  const timestamp = options.timestamp ?? field.updatedAt;
  const authoritySource = authoritySourceForField(
    field,
    (options.authoritativeValues?.length ?? 0) > 0,
  );
  const context = createAthenaAwarenessContext(field, {
    timestamp,
    authoritySource,
  });
  const graph = buildAthenaDependencyGraphFromContext(context, {
    field,
    timestamp,
    authoritySource,
    reason: "full-rebuild",
    staticDefinitions: definitions,
  });
  const relationshipMap = buildAthenaEffectRelationshipMapFromContext(
    context,
    graph,
    { timestamp, reason: options.reason ?? "full-rebuild" },
  );
  const requestedTotals = definitions.flatMap((definition) => definition.reads);
  const canonicalTotals = calculateTotals(field.groups);
  for (const [key, value] of Object.entries(
    zoneCategoryRelevantTotals(field, requestedTotals),
  )) {
    if (value !== undefined) canonicalTotals[key as RelevantTotalKey] = value;
  }
  const totals = applyTotalOverrides(
    canonicalTotals,
    options.relevantTotalOverrides,
  );
  const environment: BuildEnvironment = {
    field,
    definitions,
    totals,
    zoneCategoryReliability: zoneCategoryReliability(field, requestedTotals),
    graph,
    relationshipMap,
    relationshipsByDefinition: relationshipIndex(relationshipMap, graph),
    canonicalFingerprint,
    timestamp,
    authoritySource,
    authoritativeValues: authoritativeValueMap(
      field,
      options.authoritativeValues,
    ),
    cyclicDefinitionIds: detectDefinitionCycles(definitions),
  };

  if (options.cancellation?.cancelled) {
    return emptyDerivedState(
      environment,
      "cancelled",
      {
        durationMs: monotonicNowMs() - started,
        dirtyGroupIds: [],
        staticRelationshipCount: relationshipMap.diagnostics.staticCount,
        activeStaticRelationshipCount: 0,
        disabledStaticRelationshipCount: 0,
        authorityOverrideCount: 0,
        unsupportedStaticCalculationCount: 0,
        manualResolutionCount: 0,
        cycleDetectionCount: environment.cyclicDefinitionIds.size,
      },
      options.cancellation.reason ?? "Derived-state calculation cancelled.",
    );
  }

  if (
    options.expectedCanonicalFingerprint &&
    options.expectedCanonicalFingerprint !== canonicalFingerprint
  ) {
    return emptyDerivedState(
      environment,
      "stale",
      {
        durationMs: monotonicNowMs() - started,
        dirtyGroupIds: [],
        staticRelationshipCount: relationshipMap.diagnostics.staticCount,
        activeStaticRelationshipCount: 0,
        disabledStaticRelationshipCount: 0,
        authorityOverrideCount: 0,
        unsupportedStaticCalculationCount: 0,
        manualResolutionCount: 0,
        cycleDetectionCount: environment.cyclicDefinitionIds.size,
      },
      "The canonical battlefield changed before calculation completed.",
    );
  }

  const mutable = new Map<string, MutableDerivedObject>();
  for (const group of field.groups) {
    if (group.zone !== "battlefield" || !group.characteristics.isCreature) {
      continue;
    }
    mutable.set(group.id, createMutableObject(group, authoritySource));
  }

  let activeStaticRelationshipCount = 0;
  let disabledStaticRelationshipCount = 0;
  let unsupportedStaticCalculationCount = 0;
  let manualResolutionCount = 0;

  for (const source of sortedBattlefieldGroups(field.groups)) {
    const sourceDefinitions = getAthenaStaticEffectDefinitionsForCard(
      source.identity?.name,
      definitions,
    );
    for (const definition of sourceDefinitions) {
      const relationship = environment.relationshipsByDefinition.get(
        definitionRelationshipKey(source.id, definition.id),
      );
      const targets = targetsForDefinition(
        field.groups,
        source,
        definition.target,
      );
      const disabledReason = sourceDisabledReason(
        source,
        definition,
        relationship,
      );
      if (disabledReason) {
        disabledStaticRelationshipCount += 1;
        for (const target of targets) {
          mutable
            .get(target.id)
            ?.disabledRelationshipIds.add(
              relationship?.id ??
                definitionRelationshipKey(source.id, definition.id),
            );
        }
        continue;
      }
      if (!relationship) {
        unsupportedStaticCalculationCount += 1;
        for (const target of targets) {
          const object = mutable.get(target.id);
          if (!object) continue;
          object.validity = "unsupported";
          object.support = "unsupported-effect";
          object.reasonCodes.add("missing-static-relationship");
        }
        continue;
      }
      if (environment.cyclicDefinitionIds.has(definition.id)) {
        manualResolutionCount += 1;
        for (const target of targets) {
          const object = mutable.get(target.id);
          if (!object) continue;
          object.validity = "authority-required";
          object.support = "authority-required";
          object.reasonCodes.add("static-dependency-cycle");
        }
        continue;
      }

      activeStaticRelationshipCount += 1;
      for (const target of targets) {
        const object = mutable.get(target.id);
        if (!object) continue;
        applyDefinition(environment, object, source, definition, relationship);
      }
    }
  }

  for (const relationship of unsupportedStaticRelationships(relationshipMap)) {
    unsupportedStaticCalculationCount += 1;
    for (const targetGroupId of relationship.targetGroupIds) {
      const object = mutable.get(targetGroupId);
      if (!object) continue;
      object.validity = "unsupported";
      object.support = "unsupported-effect";
      object.reasonCodes.add("unsupported-static-relationship");
    }
  }

  let authorityOverrideCount = 0;
  for (const object of mutable.values()) {
    const authoritative = environment.authoritativeValues.get(object.group.id);
    if (authoritative) {
      applyAuthorityValue(object, authoritative);
      authorityOverrideCount += 1;
    }
  }

  const objects = [...mutable.values()]
    .map((entry) => finalizeObject(environment, entry))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  const dirtyGroupIds = objects.map((object) => object.groupId);
  const durationMs = monotonicNowMs() - started;
  const stats: RecalculationStats = {
    durationMs,
    dirtyGroupIds,
    staticRelationshipCount: relationshipMap.diagnostics.staticCount,
    activeStaticRelationshipCount,
    disabledStaticRelationshipCount,
    authorityOverrideCount,
    unsupportedStaticCalculationCount,
    manualResolutionCount,
    cycleDetectionCount: environment.cyclicDefinitionIds.size,
  };

  return {
    version: ATHENA_DERIVED_STATE_VERSION,
    cacheVersion: ATHENA_DERIVED_STATE_CACHE_VERSION,
    fieldId: field.id,
    sessionId: field.session.id,
    createdAt: timestamp,
    canonicalFingerprint,
    awarenessContextVersion: context.version,
    dependencyGraphVersion: graph.version,
    relationshipMapVersion: relationshipMap.version,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    validity: aggregateValidity(objects),
    objects,
    relevantTotals: { ...totals },
    dirtyGroupIds,
    invalidatedRelationshipIds: [],
    unsupportedDefinitionIds: uniqueSorted(
      objects
        .filter((object) => object.validity === "unsupported")
        .flatMap((object) =>
          object.contributions.flatMap((entry) => entry.definitionId ?? []),
        ),
    ),
    authorityRequiredDefinitionIds: uniqueSorted(
      objects
        .filter((object) => object.validity === "authority-required")
        .flatMap((object) =>
          object.contributions.flatMap((entry) => entry.definitionId ?? []),
        ),
    ),
    cycleDefinitionIds: [...environment.cyclicDefinitionIds].sort(),
    warnings: buildWarnings(objects, environment.cyclicDefinitionIds),
    diagnostics: createDiagnostics(stats, objects.length, options.reason),
    committedStateReadOnly: true,
    derivedFromCanonicalState: true,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
  };
}

export function updateAthenaDerivedBattlefieldState(
  previous: AthenaDerivedBattlefieldState,
  field: FieldState,
  options: AthenaDerivedStateUpdateOptions,
): AthenaDerivedStateUpdateResult {
  const full = buildAthenaDerivedBattlefieldState(field, {
    ...options,
    reason: options.reason ?? `incremental:${options.change.kind}`,
  });
  const dirtyGroupIds = dirtyGroupsForChange(previous, full, options.change);
  const previousById = new Map(
    previous.objects.map((object) => [object.groupId, object]),
  );
  const objects = full.objects.map((object) =>
    dirtyGroupIds.includes(object.groupId)
      ? object
      : (previousById.get(object.groupId) ?? object),
  );
  const staleGroupIdsRemoved = previous.objects
    .map((object) => object.groupId)
    .filter((id) => !full.objects.some((object) => object.groupId === id))
    .sort();
  const state: AthenaDerivedBattlefieldState = {
    ...full,
    objects,
    dirtyGroupIds,
    invalidatedRelationshipIds: invalidatedRelationshipsForChange(
      full.relationshipMapVersion,
      options.change,
    ),
    diagnostics: {
      ...full.diagnostics,
      incrementalRecalculationCount: 1,
      fullRebuildCount: 0,
      dirtyNodeCount: dirtyGroupIds.length,
      averageDirtyNodeCount: dirtyGroupIds.length,
      maximumDirtyNodeCount: dirtyGroupIds.length,
      recalculatedGroupIds: dirtyGroupIds,
      lastRecalculationReason:
        options.reason ?? `incremental:${options.change.kind}`,
    },
  };
  return {
    state,
    equivalentToFullRebuild:
      derivedLogicalIdentity(state) === derivedLogicalIdentity(full),
    changedGroupIds: dirtyGroupIds,
    staleGroupIdsRemoved,
  };
}

export function applyAthenaDerivedStateToField(
  field: FieldState,
  options: AthenaDerivedStateBuildOptions = {},
): AthenaDerivedFieldApplicationResult {
  const state = athenaDerivedStateEngine.build(field, options);
  if (state.validity === "stale" || state.validity === "cancelled") {
    return { field, state, applied: false };
  }
  const objects = new Map(
    state.objects.map((object) => [object.groupId, object]),
  );
  let applied = false;
  const groups = field.groups.map((group) => {
    const object = objects.get(group.id);
    if (
      !object ||
      object.currentPower === null ||
      object.currentToughness === null
    ) {
      return group;
    }
    const characteristicPowerAdjustment =
      object.characteristicPower !== null && group.pt.basePower !== null
        ? object.characteristicPower - group.pt.basePower
        : 0;
    const characteristicToughnessAdjustment =
      object.characteristicToughness !== null && group.pt.baseToughness !== null
        ? object.characteristicToughness - group.pt.baseToughness
        : 0;
    const staticPower =
      object.staticPower +
      object.attachmentPower +
      characteristicPowerAdjustment;
    const staticToughness =
      object.staticToughness +
      object.attachmentToughness +
      characteristicToughnessAdjustment;
    if (
      group.pt.currentPower === object.currentPower &&
      group.pt.currentToughness === object.currentToughness &&
      group.pt.staticPower === staticPower &&
      group.pt.staticToughness === staticToughness
    ) {
      return group;
    }
    applied = true;
    return {
      ...group,
      statuses: {
        ...group.statuses,
        modified:
          object.counterPower !== 0 ||
          staticPower !== 0 ||
          staticToughness !== 0 ||
          object.temporaryPower !== 0 ||
          object.temporaryToughness !== 0,
      },
      pt: {
        ...group.pt,
        currentPower: object.currentPower,
        currentToughness: object.currentToughness,
        staticPower,
        staticToughness,
      },
    };
  });
  return {
    field: applied ? { ...field, groups } : field,
    state,
    applied,
  };
}

export function previewAthenaDerivedState(
  field: FieldState,
  request: AthenaDerivedPreviewRequest,
  options: AthenaDerivedStateBuildOptions = {},
): AthenaDerivedPreviewResult {
  const current = buildAthenaDerivedBattlefieldState(field, options);
  const relevantTotalOverrides = Object.fromEntries(
    Object.entries(current.relevantTotals).map(([key, value]) => [
      key,
      value + (request.relevantTotalDeltas[key as RelevantTotalKey] ?? 0),
    ]),
  ) as Record<RelevantTotalKey, number>;
  const preview = buildAthenaDerivedBattlefieldState(field, {
    ...options,
    reason: `${request.source}-preview`,
    relevantTotalOverrides,
  });
  return {
    source: request.source,
    current,
    preview,
    changedGroupIds: preview.objects
      .filter((object) => {
        const existing = current.objects.find(
          (entry) => entry.groupId === object.groupId,
        );
        return (
          existing?.currentPower !== object.currentPower ||
          existing?.currentToughness !== object.currentToughness
        );
      })
      .map((object) => object.groupId),
    committedFieldMutated: false,
  };
}

export function createAthenaDerivedStateQueryApi(
  state: AthenaDerivedBattlefieldState,
): AthenaDerivedStateQueryApi {
  const byId = new Map(state.objects.map((object) => [object.groupId, object]));
  const clone = (
    object: AthenaDerivedObjectState,
  ): AthenaDerivedObjectState => ({
    ...object,
    objectIds: [...object.objectIds],
    appliedSourceRelationshipIds: [...object.appliedSourceRelationshipIds],
    disabledSourceRelationshipIds: [...object.disabledSourceRelationshipIds],
    contributions: object.contributions.map((entry) => ({ ...entry })),
    reasonCodes: [...object.reasonCodes],
  });
  return {
    getObject: (groupId) => {
      const object = byId.get(groupId);
      return object ? clone(object) : null;
    },
    getCurrentPowerToughness: (groupId) => {
      const object = byId.get(groupId);
      return object
        ? { power: object.currentPower, toughness: object.currentToughness }
        : null;
    },
    getContributions: (groupId) =>
      byId.get(groupId)?.contributions.map((entry) => ({ ...entry })) ?? [],
    getObjectsDependingOnTotal: (total) =>
      state.objects
        .filter((object) => object.reasonCodes.includes(`reads-total:${total}`))
        .map(clone),
    getObjectsAffectedBySource: (groupId) =>
      state.objects
        .filter((object) =>
          object.contributions.some((entry) => entry.sourceGroupId === groupId),
        )
        .map(clone),
    getUnsupportedObjects: () =>
      state.objects.filter((object) => object.validity !== "valid").map(clone),
    getSemanticDescription: (groupId) =>
      byId.get(groupId)?.semanticDescription ?? null,
  };
}

export class AthenaDerivedStateEngine {
  private readonly cache = new Map<string, AthenaDerivedBattlefieldState>();
  private builds = 0;
  private cacheHits = 0;
  private cacheMisses = 0;
  private staleRejections = 0;

  build(
    field: FieldState,
    options: AthenaDerivedStateBuildOptions = {},
  ): AthenaDerivedBattlefieldState {
    const started = monotonicNowMs();
    const canonicalFingerprint = canonicalDerivedFingerprint(field);
    const key = `${canonicalFingerprint}:${serializeStable({
      definitions: options.definitions ?? ATHENA_STATIC_EFFECT_DEFINITIONS,
      totals: options.relevantTotalOverrides ?? {},
      authority: options.authoritativeValues ?? [],
    })}`;
    const cached = this.cache.get(key);
    if (cached && !options.cancellation?.cancelled) {
      this.cacheHits += 1;
      athenaPerformanceMonitor.recordDuration(
        "static-recalculation",
        monotonicNowMs() - started,
        {
          workUnits: field.groups.length,
          recordedAt: options.timestamp ?? field.updatedAt,
          enabled: field.settings.athena.developerDiagnosticsEnabled,
        },
      );
      return cloneStateWithCacheDiagnostics(
        cached,
        this.cacheHits,
        this.cacheMisses,
      );
    }
    this.cacheMisses += 1;
    this.builds += 1;
    const state = buildDerivedBattlefieldState(
      field,
      options,
      canonicalFingerprint,
    );
    if (state.validity === "stale") this.staleRejections += 1;
    if (state.validity !== "stale" && state.validity !== "cancelled") {
      this.cache.set(key, state);
      while (this.cache.size > ATHENA_DERIVED_STATE_CACHE_LIMIT) {
        const oldestKey = this.cache.keys().next().value;
        if (typeof oldestKey !== "string") break;
        this.cache.delete(oldestKey);
      }
    }
    athenaPerformanceMonitor.recordDuration(
      "static-recalculation",
      monotonicNowMs() - started,
      {
        workUnits: field.groups.length,
        recordedAt: options.timestamp ?? field.updatedAt,
        enabled: field.settings.athena.developerDiagnosticsEnabled,
      },
    );
    athenaPerformanceMonitor.setGauge(
      "derived-cache-size",
      this.cache.size,
      field.settings.athena.developerDiagnosticsEnabled,
    );
    return cloneStateWithCacheDiagnostics(
      state,
      this.cacheHits,
      this.cacheMisses,
    );
  }

  update(
    previous: AthenaDerivedBattlefieldState,
    field: FieldState,
    options: AthenaDerivedStateUpdateOptions,
  ): AthenaDerivedStateUpdateResult {
    this.builds += 1;
    return updateAthenaDerivedBattlefieldState(previous, field, options);
  }

  discard(): void {
    this.cache.clear();
  }

  getDiagnostics(): {
    buildCount: number;
    cacheHitCount: number;
    cacheMissCount: number;
    staleResultRejectionCount: number;
    cacheSize: number;
  } {
    return {
      buildCount: this.builds,
      cacheHitCount: this.cacheHits,
      cacheMissCount: this.cacheMisses,
      staleResultRejectionCount: this.staleRejections,
      cacheSize: this.cache.size,
    };
  }
}

export const athenaDerivedStateEngine = new AthenaDerivedStateEngine();

function createMutableObject(
  group: PermanentGroup,
  authoritySource: AthenaAuthoritySource,
): MutableDerivedObject {
  const counter =
    safeInteger(
      (group.counters["+1/+1"] ?? 0) - (group.counters["-1/-1"] ?? 0),
    ) ?? 0;
  const contributions: AthenaDerivedContribution[] = [];
  if (group.pt.basePower !== null && group.pt.baseToughness !== null) {
    contributions.push({
      id: `${group.id}:base`,
      kind: "base",
      sourceGroupId: group.id,
      definitionId: null,
      relationshipId: null,
      power: group.pt.basePower,
      toughness: group.pt.baseToughness,
      description: `Base ${group.pt.basePower}/${group.pt.baseToughness}.`,
      authoritySource,
      support: "fully-understood-consequence",
    });
  }
  if (counter !== 0) {
    contributions.push({
      id: `${group.id}:counters`,
      kind: "counter",
      sourceGroupId: group.id,
      definitionId: null,
      relationshipId: null,
      power: counter,
      toughness: counter,
      description: `Counters ${signed(counter)}/${signed(counter)}.`,
      authoritySource,
      support: "fully-understood-consequence",
    });
  }
  if (group.pt.temporaryPower !== 0 || group.pt.temporaryToughness !== 0) {
    contributions.push({
      id: `${group.id}:temporary`,
      kind: "temporary",
      sourceGroupId: group.id,
      definitionId: null,
      relationshipId: null,
      power: group.pt.temporaryPower,
      toughness: group.pt.temporaryToughness,
      description: `Temporary ${signed(group.pt.temporaryPower)}/${signed(group.pt.temporaryToughness)}.`,
      authoritySource,
      support: "fully-understood-consequence",
    });
  }
  return {
    group,
    characteristicPower: null,
    characteristicToughness: null,
    counterPower: counter,
    counterToughness: counter,
    staticPower: 0,
    staticToughness: 0,
    attachmentPower: 0,
    attachmentToughness: 0,
    contributions,
    appliedRelationshipIds: new Set(),
    disabledRelationshipIds: new Set(),
    reasonCodes: new Set(["canonical-base", "canonical-counters"]),
    support: "fully-understood-consequence",
    validity: "valid",
    authoritySource,
  };
}

function applyDefinition(
  environment: BuildEnvironment,
  object: MutableDerivedObject,
  source: PermanentGroup,
  definition: AthenaStaticEffectDefinition,
  relationship: StaticRelationshipReference,
): void {
  const incompleteCategory = definition.reads.find(
    (total) =>
      isZoneCategoryRelevantTotalKey(total) &&
      !environment.zoneCategoryReliability.get(total)?.exact,
  );
  if (incompleteCategory) {
    object.validity = "manual-resolution-required";
    object.support = "partially-understood-consequence";
    object.reasonCodes.add(`partial-zone-composition:${incompleteCategory}`);
    return;
  }
  const power = evaluateExpression(environment, object.group, definition.power);
  const toughness = evaluateExpression(
    environment,
    object.group,
    definition.toughness,
  );
  if (power === null || toughness === null) {
    object.validity = "manual-resolution-required";
    object.support = "manual-resolution-required";
    object.reasonCodes.add("invalid-static-value");
    return;
  }
  if (definition.operation === "set-base") {
    const hasManualBaseOverride =
      (object.group.pt.printedPower !== null &&
        object.group.pt.basePower !== object.group.pt.printedPower) ||
      (object.group.pt.printedToughness !== null &&
        object.group.pt.baseToughness !== object.group.pt.printedToughness) ||
      (object.group.pt.printedPower === null &&
        object.group.pt.basePower !== null) ||
      (object.group.pt.printedToughness === null &&
        object.group.pt.baseToughness !== null);
    if (hasManualBaseOverride) {
      object.validity = "manual-resolution-required";
      object.support = "manual-resolution-required";
      object.reasonCodes.add("base-override-preserved");
      return;
    }
    if (
      (object.characteristicPower !== null &&
        object.characteristicPower !== power) ||
      (object.characteristicToughness !== null &&
        object.characteristicToughness !== toughness)
    ) {
      object.validity = "authority-required";
      object.support = "authority-required";
      object.reasonCodes.add("conflicting-characteristic-definitions");
      return;
    }
    object.characteristicPower = power;
    object.characteristicToughness = toughness;
  } else {
    const sourceQuantity = Math.max(1, source.quantity);
    const contributionPower = safeInteger(power * sourceQuantity);
    const contributionToughness = safeInteger(toughness * sourceQuantity);
    if (contributionPower === null || contributionToughness === null) {
      object.validity = "manual-resolution-required";
      object.support = "manual-resolution-required";
      object.reasonCodes.add("static-value-overflow");
      return;
    }
    if (definition.target.kind === "attached-host") {
      const nextPower = safeInteger(object.attachmentPower + contributionPower);
      const nextToughness = safeInteger(
        object.attachmentToughness + contributionToughness,
      );
      if (nextPower === null || nextToughness === null) {
        object.validity = "manual-resolution-required";
        object.support = "manual-resolution-required";
        object.reasonCodes.add("static-value-overflow");
        return;
      }
      object.attachmentPower = nextPower;
      object.attachmentToughness = nextToughness;
    } else {
      const nextPower = safeInteger(object.staticPower + contributionPower);
      const nextToughness = safeInteger(
        object.staticToughness + contributionToughness,
      );
      if (nextPower === null || nextToughness === null) {
        object.validity = "manual-resolution-required";
        object.support = "manual-resolution-required";
        object.reasonCodes.add("static-value-overflow");
        return;
      }
      object.staticPower = nextPower;
      object.staticToughness = nextToughness;
    }
  }
  object.appliedRelationshipIds.add(relationship.id);
  object.reasonCodes.add(definition.category);
  for (const total of definition.reads) {
    object.reasonCodes.add(`reads-total:${total}`);
  }
  const appliedPower =
    definition.operation === "add"
      ? power * Math.max(1, source.quantity)
      : power;
  const appliedToughness =
    definition.operation === "add"
      ? toughness * Math.max(1, source.quantity)
      : toughness;
  object.contributions.push({
    id: `${relationship.id}:${object.group.id}`,
    kind:
      definition.operation === "set-base"
        ? "characteristic-defining"
        : definition.target.kind === "attached-host"
          ? "attachment"
          : "static",
    sourceGroupId: source.id,
    definitionId: definition.id,
    relationshipId: relationship.id,
    power: appliedPower,
    toughness: appliedToughness,
    description:
      definition.operation === "set-base"
        ? `${source.label} sets base power and toughness to ${power}/${toughness}.`
        : `${source.label} provides ${signed(appliedPower)}/${signed(appliedToughness)}.`,
    authoritySource: "lite-local-helper-result",
    support: relationship.support ?? "fully-understood-consequence",
  });
}

function finalizeObject(
  environment: BuildEnvironment,
  object: MutableDerivedObject,
): AthenaDerivedObjectState {
  const basePower = object.characteristicPower ?? object.group.pt.basePower;
  const baseToughness =
    object.characteristicToughness ?? object.group.pt.baseToughness;
  let currentPower = calculateCurrent(
    basePower,
    object.counterPower,
    object.staticPower,
    object.attachmentPower,
    object.group.pt.temporaryPower,
  );
  let currentToughness = calculateCurrent(
    baseToughness,
    object.counterToughness,
    object.staticToughness,
    object.attachmentToughness,
    object.group.pt.temporaryToughness,
  );
  if (
    (basePower !== null && currentPower === null) ||
    (baseToughness !== null && currentToughness === null)
  ) {
    object.validity = "manual-resolution-required";
    object.support = "manual-resolution-required";
    object.reasonCodes.add("derived-value-overflow");
  }
  if (object.group.pt.powerToughnessSwitch) {
    [currentPower, currentToughness] = [currentToughness, currentPower];
    object.reasonCodes.add("power-toughness-switched");
  }
  const authority = environment.authoritativeValues.get(object.group.id);
  if (authority) {
    currentPower = authority.currentPower;
    currentToughness = authority.currentToughness;
  }
  const label =
    object.group.label || object.group.identity?.name || "Permanent";
  return {
    version: ATHENA_DERIVED_STATE_VERSION,
    groupId: object.group.id,
    objectIds: [
      ...(object.group.session?.objectIds ?? [object.group.id]),
    ].sort(),
    quantity: object.group.quantity,
    basePower: object.group.pt.basePower,
    baseToughness: object.group.pt.baseToughness,
    characteristicPower: object.characteristicPower,
    characteristicToughness: object.characteristicToughness,
    currentPower,
    currentToughness,
    counterPower: object.counterPower,
    counterToughness: object.counterToughness,
    staticPower: object.staticPower,
    staticToughness: object.staticToughness,
    attachmentPower: object.attachmentPower,
    attachmentToughness: object.attachmentToughness,
    temporaryPower: object.group.pt.temporaryPower,
    temporaryToughness: object.group.pt.temporaryToughness,
    appliedSourceRelationshipIds: [...object.appliedRelationshipIds].sort(),
    disabledSourceRelationshipIds: [...object.disabledRelationshipIds].sort(),
    contributions: object.contributions.sort((a, b) =>
      a.id.localeCompare(b.id),
    ),
    authoritySource: object.authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(object.authoritySource),
    support: object.support,
    validity: object.validity,
    calculationVersion: ATHENA_DERIVED_STATE_VERSION,
    dependencyVersion: environment.graph.version,
    relationshipMapVersion: environment.relationshipMap.version,
    canonicalFingerprint: environment.canonicalFingerprint,
    reasonCodes: [...object.reasonCodes].sort(),
    semanticDescription:
      currentPower === null || currentToughness === null
        ? `${label} has an unresolved power and toughness value.`
        : `${label} is currently ${currentPower} power and ${currentToughness} toughness. ${object.contributions.map((entry) => entry.description).join(" ")}`.trim(),
    grouped: object.group.quantity > 1,
    directBattlefieldMutation: false,
  };
}

function applyAuthorityValue(
  object: MutableDerivedObject,
  authority: AthenaAuthoritativeDerivedValue,
): void {
  object.authoritySource = "boardstate-authoritative-result";
  object.validity = "valid";
  object.support = "fully-understood-consequence";
  object.reasonCodes.add("boardstate-authority-override");
  object.contributions.push({
    id: `${object.group.id}:boardstate-authority`,
    kind: "authority",
    sourceGroupId: object.group.id,
    definitionId: null,
    relationshipId: authority.sourceReference,
    power: authority.currentPower ?? 0,
    toughness: authority.currentToughness ?? 0,
    description: "BoardState provided the authoritative current value.",
    authoritySource: "boardstate-authoritative-result",
    support: "fully-understood-consequence",
  });
}

function evaluateExpression(
  environment: BuildEnvironment,
  target: PermanentGroup,
  expression: AthenaStaticValueExpression,
): number | null {
  let value = safeInteger(expression.fixed);
  if (value === null) return null;
  for (const term of expression.terms) {
    let operand = 0;
    if (term.source === "relevant-total") {
      if (!term.total) return null;
      operand = environment.totals[term.total];
    } else {
      for (const group of environment.field.groups) {
        if (
          group.zone !== "battlefield" ||
          group.attachedTo !== target.id ||
          !group.characteristics.subtypes.includes("Equipment")
        ) {
          continue;
        }
        const next = safeInteger(operand + group.quantity);
        if (next === null) return null;
        operand = next;
      }
    }
    const product = safeInteger(operand * term.multiplier);
    if (product === null) return null;
    value = safeInteger(value + product);
    if (value === null) return null;
  }
  return value;
}

function targetsForDefinition(
  groups: PermanentGroup[],
  source: PermanentGroup,
  target: AthenaStaticTargetFilter,
): PermanentGroup[] {
  let candidates: PermanentGroup[];
  if (target.kind === "self") {
    candidates = [source];
  } else if (target.kind === "attached-host") {
    candidates = groups.filter((group) => group.id === source.attachedTo);
  } else {
    candidates = groups.filter(
      (group) =>
        group.zone === "battlefield" &&
        group.controller === source.controller &&
        group.characteristics.isCreature &&
        (target.kind !== "other-controlled-creatures" ||
          group.id !== source.id),
    );
  }
  return candidates
    .filter((group) => group.zone === "battlefield")
    .filter((group) => group.characteristics.isCreature)
    .filter((group) =>
      target.tokenState === "any"
        ? true
        : target.tokenState === "token"
          ? group.characteristics.isToken
          : !group.characteristics.isToken,
    )
    .filter((group) =>
      target.cardType
        ? group.characteristics.cardTypes.includes(target.cardType)
        : true,
    )
    .filter((group) =>
      target.subtype
        ? group.characteristics.subtypes.includes(target.subtype)
        : true,
    )
    .filter((group) =>
      target.color ? group.characteristics.colors.includes(target.color) : true,
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

function sourceDisabledReason(
  source: PermanentGroup,
  definition: AthenaStaticEffectDefinition,
  relationship: StaticRelationshipReference | undefined,
): string | null {
  if (source.zone !== "battlefield") return "zone-not-battlefield";
  if (!source.trackingEnabled) return "not-tracked";
  if (source.isGeneric || !source.identity) return "generic-placeholder";
  if (source.depowerMode === "all") return "depowered";
  if (
    source.depowerMode === "selected" &&
    source.disabledAbilities.some(
      (ability) =>
        ability === definition.id || ability === definition.abilityId,
    )
  ) {
    return "depowered";
  }
  if (!source.abilitiesActive && source.depowerMode === "none")
    return "depowered";
  if (relationship && !relationship.enabled) {
    return relationship.disabledReason ?? "disabled";
  }
  return null;
}

function relationshipIndex(
  relationshipMap: AthenaEffectRelationshipMap,
  graph: AthenaDependencyGraph,
): Map<string, StaticRelationshipReference> {
  const result = new Map<string, StaticRelationshipReference>();
  for (const relationship of relationshipMap.relationships) {
    const definitionId = relationship.relationshipMetadata.staticDefinitionId;
    if (
      typeof definitionId !== "string" ||
      !relationship.source.battlefieldObjectGroupId
    ) {
      continue;
    }
    const key = definitionRelationshipKey(
      relationship.source.battlefieldObjectGroupId,
      definitionId,
    );
    const existing = result.get(key);
    if (!existing || relationship.category !== "relevant-total-reader") {
      result.set(key, relationship);
    }
  }
  for (const node of graph.nodes) {
    const definitionId = node.metadata.staticDefinitionId;
    if (
      node.type !== "effect-definition" ||
      typeof definitionId !== "string" ||
      !node.groupId
    ) {
      continue;
    }
    const key = definitionRelationshipKey(node.groupId, definitionId);
    if (result.has(key)) continue;
    result.set(key, {
      id: node.id,
      enabled: node.enabled,
      disabledReason: node.disabledReason,
      authoritySource: node.authoritySource,
      support: node.support,
    });
  }
  return result;
}

function definitionRelationshipKey(
  sourceGroupId: string,
  definitionId: string,
): string {
  return `${sourceGroupId}:${definitionId}`;
}

function authoritySourceForField(
  field: FieldState,
  hasExplicitAuthority: boolean,
): AthenaAuthoritySource {
  return field.session.currentRulesAuthority === "boardstate-authority" ||
    hasExplicitAuthority
    ? "boardstate-authoritative-result"
    : "lite-local-helper-result";
}

function authoritativeValueMap(
  field: FieldState,
  values: readonly AthenaAuthoritativeDerivedValue[] | undefined,
): Map<string, AthenaAuthoritativeDerivedValue> {
  if (values) {
    return new Map(values.map((entry) => [entry.groupId, { ...entry }]));
  }
  if (field.session.currentRulesAuthority !== "boardstate-authority") {
    return new Map();
  }
  return new Map(
    field.groups
      .filter(
        (group) =>
          group.zone === "battlefield" && group.characteristics.isCreature,
      )
      .map((group) => [
        group.id,
        {
          groupId: group.id,
          currentPower: group.pt.currentPower,
          currentToughness: group.pt.currentToughness,
          sourceReference: "canonical-boardstate-session",
        },
      ]),
  );
}

function unsupportedStaticRelationships(
  relationshipMap: AthenaEffectRelationshipMap,
): AthenaMappedEffectRelationship[] {
  return relationshipMap.relationships.filter(
    (relationship) =>
      relationship.enabled &&
      (relationship.category === "static-effect" ||
        relationship.category === "continuous-effect" ||
        relationship.category === "scaling-effect" ||
        relationship.category === "characteristic-defining-effect") &&
      typeof relationship.relationshipMetadata.staticDefinitionId !== "string",
  );
}

function applyTotalOverrides(
  totals: Record<RelevantTotalKey, number>,
  overrides: Partial<Record<RelevantTotalKey, number>> | undefined,
): Record<RelevantTotalKey, number> {
  const result = { ...totals };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    const safe = safeInteger(value);
    if (safe !== null && safe >= 0) result[key as RelevantTotalKey] = safe;
  }
  return result;
}

function detectDefinitionCycles(
  definitions: readonly AthenaStaticEffectDefinition[],
): Set<string> {
  const dependencies = new Map(
    definitions.map((definition) => [
      definition.id,
      definition.dependsOnDefinitionIds.filter((id) =>
        definitions.some((entry) => entry.id === id),
      ),
    ]),
  );
  const cyclic = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string, path: string[]): void => {
    if (visiting.has(id)) {
      const index = path.indexOf(id);
      for (const entry of path.slice(index)) cyclic.add(entry);
      cyclic.add(id);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      visit(dependency, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of [...dependencies.keys()].sort()) visit(id, []);
  return cyclic;
}

function calculateCurrent(
  base: number | null,
  counter: number,
  staticValue: number,
  attachment: number,
  temporary: number,
): number | null {
  if (base === null) return null;
  return safeInteger(base + counter + staticValue + attachment + temporary);
}

function safeInteger(value: unknown): number | null {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    Math.abs(value) > ATHENA_DERIVED_MAX_SAFE_VALUE
  ) {
    return null;
  }
  return value;
}

function aggregateValidity(
  objects: AthenaDerivedObjectState[],
): AthenaDerivedStateValidity {
  const order: AthenaDerivedStateValidity[] = [
    "invalid",
    "authority-required",
    "manual-resolution-required",
    "unsupported",
    "stale",
    "cancelled",
    "valid",
  ];
  return (
    order.find((validity) =>
      objects.some((object) => object.validity === validity),
    ) ?? "valid"
  );
}

function createDiagnostics(
  stats: RecalculationStats,
  objectCount: number,
  reason = "full-rebuild",
): AthenaDerivedStateDiagnostics {
  return {
    version: ATHENA_DERIVED_STATE_VERSION,
    staticRelationshipCount: stats.staticRelationshipCount,
    activeStaticRelationshipCount: stats.activeStaticRelationshipCount,
    disabledStaticRelationshipCount: stats.disabledStaticRelationshipCount,
    derivedObjectCount: objectCount,
    incrementalRecalculationCount: 0,
    fullRebuildCount: 1,
    averageRecalculationDurationMs: stats.durationMs,
    maximumRecalculationDurationMs: stats.durationMs,
    dirtyNodeCount: stats.dirtyGroupIds.length,
    averageDirtyNodeCount: stats.dirtyGroupIds.length,
    maximumDirtyNodeCount: stats.dirtyGroupIds.length,
    cacheHitCount: 0,
    cacheMissCount: 1,
    staleResultRejectionCount: 0,
    authorityOverrideCount: stats.authorityOverrideCount,
    unsupportedStaticCalculationCount: stats.unsupportedStaticCalculationCount,
    manualResolutionCount: stats.manualResolutionCount,
    cycleDetectionCount: stats.cycleDetectionCount,
    stackGroupCalculationCount: objectCount,
    lastRecalculationReason: reason,
    lastDerivedStateError: null,
    recalculatedGroupIds: [...stats.dirtyGroupIds],
    productionVisible: false,
    directBattlefieldMutation: false,
  };
}

function emptyDerivedState(
  environment: BuildEnvironment,
  validity: AthenaDerivedStateValidity,
  stats: RecalculationStats,
  warning: string,
): AthenaDerivedBattlefieldState {
  return {
    version: ATHENA_DERIVED_STATE_VERSION,
    cacheVersion: ATHENA_DERIVED_STATE_CACHE_VERSION,
    fieldId: environment.field.id,
    sessionId: environment.field.session.id,
    createdAt: environment.timestamp,
    canonicalFingerprint: environment.canonicalFingerprint,
    awarenessContextVersion: environment.graph.contextVersion,
    dependencyGraphVersion: environment.graph.version,
    relationshipMapVersion: environment.relationshipMap.version,
    authoritySource: environment.authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(environment.authoritySource),
    validity,
    objects: [],
    relevantTotals: { ...environment.totals },
    dirtyGroupIds: [],
    invalidatedRelationshipIds: [],
    unsupportedDefinitionIds: [],
    authorityRequiredDefinitionIds: [],
    cycleDefinitionIds: [...environment.cyclicDefinitionIds].sort(),
    warnings: [warning],
    diagnostics: {
      ...createDiagnostics(stats, 0, validity),
      staleResultRejectionCount: validity === "stale" ? 1 : 0,
    },
    committedStateReadOnly: true,
    derivedFromCanonicalState: true,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
  };
}

function dirtyGroupsForChange(
  previous: AthenaDerivedBattlefieldState,
  next: AthenaDerivedBattlefieldState,
  change: AthenaGraphChange,
): string[] {
  if (
    change.kind === "full-rebuild" ||
    change.kind === "import" ||
    change.kind === "reload" ||
    change.kind === "undo" ||
    change.kind === "redo" ||
    change.kind === "authority-result-received"
  ) {
    return next.objects.map((object) => object.groupId);
  }
  const explicitlyChanged = new Set(change.groupIds ?? []);
  for (const total of change.relevantTotals ?? []) {
    for (const object of next.objects) {
      if (object.reasonCodes.includes(`reads-total:${total}`)) {
        explicitlyChanged.add(object.groupId);
      }
    }
  }
  for (const object of next.objects) {
    const old = previous.objects.find(
      (entry) => entry.groupId === object.groupId,
    );
    if (!old || derivedObjectIdentity(old) !== derivedObjectIdentity(object)) {
      explicitlyChanged.add(object.groupId);
    }
  }
  return [...explicitlyChanged]
    .filter((id) => next.objects.some((object) => object.groupId === id))
    .sort();
}

function invalidatedRelationshipsForChange(
  mapVersion: number,
  change: AthenaGraphChange,
): string[] {
  return uniqueSorted([
    ...(change.relationshipIds ?? []),
    ...(change.groupIds ?? []).map((id) => `map-v${mapVersion}:${id}`),
  ]);
}

function derivedLogicalIdentity(state: AthenaDerivedBattlefieldState): string {
  return serializeStable({
    totals: state.relevantTotals,
    objects: state.objects.map(derivedObjectIdentity),
  });
}

function derivedObjectIdentity(object: AthenaDerivedObjectState): string {
  return serializeStable({
    groupId: object.groupId,
    currentPower: object.currentPower,
    currentToughness: object.currentToughness,
    staticPower: object.staticPower,
    staticToughness: object.staticToughness,
    attachmentPower: object.attachmentPower,
    attachmentToughness: object.attachmentToughness,
    relationships: object.appliedSourceRelationshipIds,
    validity: object.validity,
  });
}

function sortedBattlefieldGroups(groups: PermanentGroup[]): PermanentGroup[] {
  return groups
    .filter((group) => group.zone === "battlefield")
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
}

function buildWarnings(
  objects: AthenaDerivedObjectState[],
  cycles: Set<string>,
): string[] {
  const warnings: string[] = [];
  if (cycles.size > 0) {
    warnings.push(
      "A static dependency cycle requires BoardState authority or manual resolution.",
    );
  }
  if (
    objects.some((object) => object.validity === "manual-resolution-required")
  ) {
    warnings.push("At least one derived value requires manual resolution.");
  }
  if (objects.some((object) => object.validity === "unsupported")) {
    warnings.push("At least one static relationship is unsupported locally.");
  }
  return warnings;
}

function cloneDefinitions(
  definitions: readonly AthenaStaticEffectDefinition[],
): AthenaStaticEffectDefinition[] {
  return definitions.map((definition) => ({
    ...definition,
    cardNames: [...definition.cardNames],
    target: { ...definition.target },
    power: {
      ...definition.power,
      terms: definition.power.terms.map((term) => ({ ...term })),
    },
    toughness: {
      ...definition.toughness,
      terms: definition.toughness.terms.map((term) => ({ ...term })),
    },
    reads: [...definition.reads],
    dependsOnDefinitionIds: [...definition.dependsOnDefinitionIds],
  }));
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function signed(value: number): string {
  return value >= 0 ? `+${value}` : String(value);
}

function cloneStateWithCacheDiagnostics(
  state: AthenaDerivedBattlefieldState,
  hits: number,
  misses: number,
): AthenaDerivedBattlefieldState {
  return {
    ...state,
    objects: state.objects.map((object) => ({
      ...object,
      objectIds: [...object.objectIds],
      appliedSourceRelationshipIds: [...object.appliedSourceRelationshipIds],
      disabledSourceRelationshipIds: [...object.disabledSourceRelationshipIds],
      contributions: object.contributions.map((entry) => ({ ...entry })),
      reasonCodes: [...object.reasonCodes],
    })),
    relevantTotals: { ...state.relevantTotals },
    dirtyGroupIds: [...state.dirtyGroupIds],
    invalidatedRelationshipIds: [...state.invalidatedRelationshipIds],
    unsupportedDefinitionIds: [...state.unsupportedDefinitionIds],
    authorityRequiredDefinitionIds: [...state.authorityRequiredDefinitionIds],
    cycleDefinitionIds: [...state.cycleDefinitionIds],
    warnings: [...state.warnings],
    diagnostics: {
      ...state.diagnostics,
      cacheHitCount: hits,
      cacheMissCount: misses,
      recalculatedGroupIds: [...state.diagnostics.recalculatedGroupIds],
    },
  };
}
