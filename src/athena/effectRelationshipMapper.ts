import type { FieldState, RelevantTotalKey, Zone } from "../domain/types";
import type { AmbientIntentKind } from "../echo/ambientEventTypes";
import { serializeStable } from "../utils/stableSerialization";
import {
  buildAthenaDependencyGraph,
  buildAthenaDependencyGraphFromContext,
  invalidateAthenaDependencyGraph,
} from "./dependencyGraph";
import type {
  AthenaDependencyGraph,
  AthenaEventCategory,
  AthenaGraphChange,
  AthenaGraphNode,
  AthenaGraphRelationship,
} from "./dependencyGraphTypes";
import {
  createAthenaAwarenessContext,
  rankAthenaAuthoritySource,
} from "./foundation";
import type {
  AthenaAuthoritySource,
  AthenaAwarenessContext,
  AthenaBattlefieldObject,
} from "./types";
import {
  ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION,
  type AthenaEffectChoiceRequirementDescriptor,
  type AthenaEffectChoiceRequirementKind,
  type AthenaEffectModificationCategory,
  type AthenaEffectRelationshipBuildOptions,
  type AthenaEffectRelationshipCategory,
  type AthenaEffectRelationshipDiagnostics,
  type AthenaEffectRelationshipIndexes,
  type AthenaEffectRelationshipMap,
  type AthenaEffectRelationshipQueryApi,
  type AthenaEffectRelationshipState,
  type AthenaEffectRelationshipUpdateResult,
  type AthenaEffectSourceDescriptor,
  type AthenaEffectTargetSetDescriptor,
  type AthenaEffectTargetSetKind,
  type AthenaGeneratedEventDescriptor,
  type AthenaMappedEffectRelationship,
  type AthenaTriggerConditionDescriptor,
} from "./effectRelationshipMapperTypes";

const EFFECT_RELATIONSHIP_CATEGORIES: AthenaEffectRelationshipCategory[] = [
  "triggered-ability",
  "replacement-effect",
  "static-effect",
  "continuous-effect",
  "scaling-effect",
  "characteristic-defining-effect",
  "token-creation",
  "counter-placement",
  "life-modification",
  "relevant-total-reader",
  "background-watcher",
  "custom-supported-automation",
  "authority-required",
  "unsupported-effect",
];

export function buildAthenaEffectRelationshipMap(
  field: FieldState,
  options: AthenaEffectRelationshipBuildOptions = {},
): AthenaEffectRelationshipMap {
  const context = createAthenaAwarenessContext(field, {
    timestamp: options.timestamp,
  });
  const graph = buildAthenaDependencyGraphFromContext(context, {
    field,
    timestamp: options.timestamp,
    reason: "full-rebuild",
  });
  return buildAthenaEffectRelationshipMapFromContext(context, graph, options);
}

export function buildAthenaEffectRelationshipMapFromContext(
  context: AthenaAwarenessContext,
  graph: AthenaDependencyGraph,
  options: AthenaEffectRelationshipBuildOptions = {},
): AthenaEffectRelationshipMap {
  const started = performanceNow();
  const relationships = sortMappedRelationships([
    ...mapEffectDefinitionRelationships(context, graph),
    ...mapUnsupportedObjectRelationships(context, graph),
  ]);
  const duration = performanceNow() - started;
  const indexes = buildIndexes(relationships);

  return {
    version: ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    contextVersion: context.version,
    graphVersion: graph.version,
    createdAt: options.timestamp ?? context.createdAt,
    fingerprint: fingerprintMapperInput(context, graph, relationships),
    authoritySource: context.currentAuthoritySource,
    authorityPrecedence: context.authorityPrecedence,
    relationships,
    indexes,
    diagnostics: createDiagnostics({
      relationships,
      fullRebuildDurationMs: duration,
      incrementalUpdateDurationMs: 0,
      relationshipRebuildReason: options.reason ?? "full-rebuild",
      lastMapperError: null,
    }),
    committedStateReadOnly: true,
    derivedFromCanonicalState: true,
    directBattlefieldMutation: false,
    duplicateBattlefieldState: false,
    duplicateEventHistory: false,
    duplicateUndoStack: false,
  };
}

export function updateAthenaEffectRelationshipMap(
  previous: AthenaEffectRelationshipMap,
  field: FieldState,
  change: AthenaGraphChange,
  options: AthenaEffectRelationshipBuildOptions = {},
): AthenaEffectRelationshipUpdateResult {
  const started = performanceNow();
  const graph = buildAthenaDependencyGraph(field, {
    timestamp: options.timestamp,
    reason: "incremental-update",
  });
  const invalidation = invalidateAthenaDependencyGraph(graph, change);
  const context = createAthenaAwarenessContext(field, {
    timestamp: options.timestamp,
  });
  const relationshipMap = buildAthenaEffectRelationshipMapFromContext(
    context,
    graph,
    {
      ...options,
      reason: "incremental-update",
    },
  );
  const full = buildAthenaEffectRelationshipMap(field, {
    ...options,
    reason: "full-rebuild",
  });
  const incrementalUpdateDurationMs = performanceNow() - started;

  return {
    relationshipMap: {
      ...relationshipMap,
      diagnostics: {
        ...relationshipMap.diagnostics,
        incrementalUpdateDurationMs,
      },
    },
    invalidation,
    equivalentToFullRebuild:
      previous.version === ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION &&
      mapperIdentity(relationshipMap) === mapperIdentity(full),
  };
}

export function createAthenaEffectRelationshipQueryApi(
  relationshipMap: AthenaEffectRelationshipMap,
  graph: AthenaDependencyGraph,
): AthenaEffectRelationshipQueryApi {
  return {
    getRelationship: (id) => relationshipById(relationshipMap, id),
    getTriggersObservingEvent: (eventCategory) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.triggersByEvent[eventCategory],
      ),
    getReplacementEffectsModifyingEvent: (eventCategory) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.replacementsByEvent[eventCategory],
      ),
    getStaticEffectsReadingValue: (total) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.staticReadersByTotal[total],
      ),
    getRelationshipsOriginatingFromPermanent: (groupId) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.relationshipsBySourceGroupId[groupId],
      ),
    getRelationshipsAffectingPermanent: (groupId) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.relationshipsByAffectedGroupId[groupId],
      ),
    getDisabledRelationships: () =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.disabledRelationshipIds,
      ),
    getAuthorityRequiredRelationships: () =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.authorityRequiredRelationshipIds,
      ),
    getUnsupportedRelationships: () =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.unsupportedRelationshipIds,
      ),
    getFollowUpEventsForEvent: (eventCategory) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.followUpEventsByEvent[eventCategory],
      ).flatMap((relationship) => relationship.generatedEvents),
    getRequiredChoicesForEvent: (eventCategory) =>
      relationshipsFromIndex(
        relationshipMap,
        relationshipMap.indexes.choiceRequiredRelationshipIds,
      )
        .filter((relationship) =>
          relationship.observedEvents.some(
            (event) => event.eventCategory === eventCategory,
          ),
        )
        .flatMap((relationship) => relationship.requiredChoices),
    getRelationshipsForEchoIntent: (input) => {
      const eventCategories = eventCategoriesForIntent(input.kind);
      return uniqueMappedRelationships(
        eventCategories.flatMap((eventCategory) => [
          ...relationshipsFromIndex(
            relationshipMap,
            relationshipMap.indexes.triggersByEvent[eventCategory],
          ),
          ...relationshipsFromIndex(
            relationshipMap,
            relationshipMap.indexes.replacementsByEvent[eventCategory],
          ),
          ...relationshipsFromIndex(
            relationshipMap,
            relationshipMap.indexes.followUpEventsByEvent[eventCategory],
          ),
        ]),
      );
    },
    getInvalidationForChange: (graphChange) =>
      invalidateAthenaDependencyGraph(graph, graphChange),
  };
}

function mapEffectDefinitionRelationships(
  context: AthenaAwarenessContext,
  graph: AthenaDependencyGraph,
): AthenaMappedEffectRelationship[] {
  const relationships: AthenaMappedEffectRelationship[] = [];
  const effectNodes = graph.nodes.filter(
    (node) => node.type === "effect-definition",
  );

  for (const effectNode of effectNodes) {
    const graphRelationships = graph.relationships.filter(
      (relationship) => relationship.from === effectNode.id,
    );
    if (graphRelationships.length === 0) continue;
    const sourceObject = effectNode.groupId
      ? (context.battlefield.find(
          (object) => object.groupId === effectNode.groupId,
        ) ?? null)
      : null;
    const categories = categoriesForEffectNode(effectNode, graphRelationships);
    for (const category of categories) {
      relationships.push(
        createMappedRelationship({
          context,
          graph,
          category,
          effectNode,
          sourceObject,
          graphRelationships,
        }),
      );
    }
  }

  return relationships;
}

function mapUnsupportedObjectRelationships(
  context: AthenaAwarenessContext,
  graph: AthenaDependencyGraph,
): AthenaMappedEffectRelationship[] {
  return context.battlefield
    .filter((object) => object.sourceUnavailableReason === "unsupported-effect")
    .map((object) => {
      const graphRelationships = graph.relationships.filter(
        (relationship) =>
          relationship.sourceGroupId === object.groupId &&
          (relationship.type === "requires-authority" ||
            relationship.requiresAuthority ||
            relationship.requiresManualResolution),
      );
      const graphNode =
        graph.nodes.find(
          (node) =>
            node.type === "battlefield-object" &&
            node.groupId === object.groupId,
        ) ?? null;
      const category = "unsupported-effect";
      return createMappedRelationship({
        context,
        graph,
        category,
        effectNode:
          graphNode ??
          fallbackEffectNode(context, object, "unsupported-or-manual-source"),
        sourceObject: object,
        graphRelationships,
      });
    });
}

function createMappedRelationship(input: {
  context: AthenaAwarenessContext;
  graph: AthenaDependencyGraph;
  category: AthenaEffectRelationshipCategory;
  effectNode: AthenaGraphNode;
  sourceObject: AthenaBattlefieldObject | null;
  graphRelationships: AthenaGraphRelationship[];
}): AthenaMappedEffectRelationship {
  const categoryRelationships = relationshipsForCategory(
    input.category,
    input.graphRelationships,
  );
  const graphRelationships =
    categoryRelationships.length > 0
      ? categoryRelationships
      : input.graphRelationships;
  const observedGraphRelationships = observedRelationshipsForCategory(
    input.category,
    graphRelationships,
    input.graphRelationships,
  );
  const source = sourceDescriptor(
    input.context,
    input.effectNode,
    input.sourceObject,
    graphRelationships,
  );
  const observedEvents = triggerConditionsForRelationships(
    input.effectNode,
    observedGraphRelationships,
    input.sourceObject,
  );
  const generatedEvents = generatedEventsForRelationship(
    input.category,
    input.graphRelationships,
    input.graph,
    input.effectNode,
    input.sourceObject,
  );
  const affectedObjectSet = affectedObjectSetForRelationship(
    input.category,
    input.graphRelationships,
    input.context,
    input.sourceObject,
  );
  const requiredChoices = choiceRequirementsForRelationship(
    input.category,
    input.graphRelationships,
    observedEvents,
    input.sourceObject,
  );
  const supportStatus =
    firstDefined(
      graphRelationships.map((relationship) => relationship.supportStatus),
    ) ?? input.effectNode.supportStatus;
  const support =
    firstDefined(
      graphRelationships.map((relationship) => relationship.support),
    ) ?? input.effectNode.support;
  const requiresAuthority = graphRelationships.some(
    (relationship) => relationship.requiresAuthority,
  );
  const requiresManualResolution = graphRelationships.some(
    (relationship) => relationship.requiresManualResolution,
  );
  const enabled =
    input.effectNode.enabled &&
    graphRelationships.some((relationship) => relationship.enabled);
  const disabledReason =
    firstDisabledReason(graphRelationships) ??
    input.sourceObject?.sourceUnavailableReason ??
    null;
  const state = relationshipState({
    category: input.category,
    enabled,
    disabledReason,
    support,
    supportStatus,
    requiresAuthority,
    requiresManualResolution,
  });
  const generatedEventCategories = uniqueStrings(
    generatedEvents.map((event) => event.category),
  ) as AthenaEventCategory[];
  const relevantTotals = uniqueStrings(
    graphRelationships.flatMap((relationship) => relationship.relevantTotals),
  ) as RelevantTotalKey[];
  const targetGroupIds = uniqueStrings([
    ...affectedObjectSet.groupIds,
    ...input.graphRelationships.flatMap(
      (relationship) => relationship.targetGroupIds,
    ),
  ]);
  const authoritySource = authoritySourceForMappedRelationship(
    graphRelationships,
    input.context.currentAuthoritySource,
  );
  const id = mappedRelationshipId({
    category: input.category,
    source,
    observedEvents,
    generatedEventCategories,
    relevantTotals,
  });

  return {
    id,
    version: ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION,
    category: input.category,
    state,
    source,
    observedEvents,
    triggerCondition: observedEvents[0] ?? null,
    affectedObjectSet,
    generatedEventCategories,
    generatedEvents,
    requiredChoices,
    optional:
      Boolean(input.effectNode.metadata.optional) ||
      Boolean(input.effectNode.metadata.may) ||
      Boolean(input.sourceObject?.oracleText?.toLowerCase().includes("may")),
    modifiesEvent: input.category === "replacement-effect",
    modificationCategory:
      input.category === "replacement-effect"
        ? modificationCategoryForEvents(
            observedEvents.map((event) => event.eventCategory),
          )
        : null,
    relevantTotals,
    targetGroupIds,
    graphNodeIds: uniqueStrings([
      input.effectNode.id,
      ...input.graphRelationships.flatMap((relationship) => [
        relationship.from,
        relationship.to,
      ]),
    ]),
    graphRelationshipIds: uniqueStrings(
      input.graphRelationships.map((relationship) => relationship.id),
    ),
    supportStatus,
    support,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    enabled,
    disabledReason,
    requiresAuthority,
    requiresManualResolution,
    relationshipMetadata: mergeMetadata(graphRelationships, input.effectNode),
  };
}

function categoriesForEffectNode(
  effectNode: AthenaGraphNode,
  graphRelationships: AthenaGraphRelationship[],
): AthenaEffectRelationshipCategory[] {
  const categories = new Set<AthenaEffectRelationshipCategory>();
  const effectKind = effectNode.effectKind;
  const metadata = effectNode.metadata;
  const hasObserves = graphRelationships.some(
    (relationship) => relationship.type === "observes",
  );
  const hasModifies = graphRelationships.some(
    (relationship) => relationship.type === "modifies",
  );
  const hasReads = graphRelationships.some(
    (relationship) => relationship.type === "reads",
  );
  const hasCreates = graphRelationships.some(
    (relationship) => relationship.type === "creates",
  );
  const hasCounters = graphRelationships.some(
    (relationship) => relationship.type === "places-counters-on",
  );
  const hasAuthority = graphRelationships.some(
    (relationship) => relationship.requiresAuthority,
  );
  const hasUnsupported = graphRelationships.some(
    (relationship) => relationship.support === "unsupported-effect",
  );

  if (effectKind === "replacement-effect" || hasModifies) {
    categories.add("replacement-effect");
  }
  if (effectKind === "static-effect" || hasReads) {
    categories.add("static-effect");
    categories.add("relevant-total-reader");
    if (hasReads) categories.add("scaling-effect");
  }
  if (effectKind === "custom-automation") {
    categories.add("custom-supported-automation");
    if (metadata.trigger === "activate-field")
      categories.add("background-watcher");
    if (metadata.action === "create-token") categories.add("token-creation");
    if (metadata.action === "add-counters") categories.add("counter-placement");
    if (metadata.action === "life") categories.add("life-modification");
  }
  if (effectKind === "triggered-ability" || hasObserves) {
    categories.add("triggered-ability");
  }
  if (hasCreates) categories.add("token-creation");
  if (hasCounters) categories.add("counter-placement");
  if (isLifeEffect(effectNode, graphRelationships)) {
    categories.add("life-modification");
  }
  if (hasAuthority) categories.add("authority-required");
  if (hasUnsupported) categories.add("unsupported-effect");

  return [...categories].sort((a, b) => a.localeCompare(b));
}

function relationshipsForCategory(
  category: AthenaEffectRelationshipCategory,
  relationships: AthenaGraphRelationship[],
): AthenaGraphRelationship[] {
  if (category === "replacement-effect") {
    return relationships.filter(
      (relationship) => relationship.type === "modifies",
    );
  }
  if (
    category === "static-effect" ||
    category === "relevant-total-reader" ||
    category === "scaling-effect" ||
    category === "continuous-effect" ||
    category === "characteristic-defining-effect"
  ) {
    return relationships.filter(
      (relationship) =>
        relationship.type === "reads" ||
        relationship.type === "affects" ||
        relationship.type === "invalidates",
    );
  }
  if (category === "token-creation") {
    return relationships.filter(
      (relationship) =>
        relationship.type === "creates" || relationship.type === "observes",
    );
  }
  if (category === "counter-placement") {
    return relationships.filter(
      (relationship) =>
        relationship.type === "places-counters-on" ||
        relationship.type === "observes" ||
        relationship.type === "requires-choice",
    );
  }
  if (category === "authority-required") {
    return relationships.filter(
      (relationship) =>
        relationship.requiresAuthority ||
        relationship.type === "requires-authority",
    );
  }
  if (category === "unsupported-effect") {
    return relationships.filter(
      (relationship) =>
        relationship.support === "unsupported-effect" ||
        relationship.requiresManualResolution,
    );
  }
  if (category === "life-modification") {
    return relationships.filter(
      (relationship) =>
        relationship.type === "observes" ||
        relationship.metadata.helper === "life-on-creature-entry" ||
        relationship.metadata.helper === "impact-tremors" ||
        relationship.metadata.action === "life",
    );
  }
  return relationships.filter(
    (relationship) => relationship.type === "observes",
  );
}

function observedRelationshipsForCategory(
  category: AthenaEffectRelationshipCategory,
  categoryRelationships: AthenaGraphRelationship[],
  allRelationships: AthenaGraphRelationship[],
): AthenaGraphRelationship[] {
  if (category === "replacement-effect") {
    return categoryRelationships.filter(
      (relationship) => relationship.type === "modifies",
    );
  }
  const observers = allRelationships.filter(
    (relationship) => relationship.type === "observes",
  );
  if (observers.length > 0) return observers;
  return categoryRelationships;
}

function sourceDescriptor(
  context: AthenaAwarenessContext,
  effectNode: AthenaGraphNode,
  sourceObject: AthenaBattlefieldObject | null,
  graphRelationships: AthenaGraphRelationship[],
): AthenaEffectSourceDescriptor {
  const definitionIdentifier = stripNodePrefix(
    effectNode.id,
    "athena-node:effect:",
  );
  const abilityIdentifier =
    stringMetadata(effectNode.metadata.helper) ??
    stringMetadata(effectNode.metadata.action) ??
    definitionIdentifier;
  const authoritySource = authoritySourceForMappedRelationship(
    graphRelationships,
    context.currentAuthoritySource,
  );
  return {
    id: `athena-effect-source:${definitionIdentifier}`,
    stableIdentity: [
      context.sessionId,
      sourceObject?.primaryObjectId ??
        effectNode.groupId ??
        definitionIdentifier,
      abilityIdentifier,
    ].join(":"),
    battlefieldObjectGroupId: effectNode.groupId,
    objectIds: sourceObject?.objectIds ?? effectNode.objectIds,
    controller: sourceObject?.controller ?? null,
    owner: sourceObject?.owner ?? null,
    abilityIdentifier,
    definitionIdentifier,
    supportLevel: sourceObject?.supportStatus ?? effectNode.supportStatus,
    authoritySource,
    authorityPrecedence: rankAthenaAuthoritySource(authoritySource),
    enabled: effectNode.enabled,
    trackingEnabled: sourceObject?.trackingEnabled ?? true,
    depowerMode: sourceObject?.depowerMode ?? "none",
    transformationState: sourceObject?.lineage.transformed
      ? "transformed"
      : "current-face",
    currentCardFace: sourceObject?.identityName ?? sourceObject?.label ?? null,
    graphNodeId: effectNode.id,
  };
}

function triggerConditionsForRelationships(
  effectNode: AthenaGraphNode,
  relationships: AthenaGraphRelationship[],
  sourceObject: AthenaBattlefieldObject | null,
): AthenaTriggerConditionDescriptor[] {
  const eventCategories = uniqueStrings(
    relationships.flatMap((relationship) => relationship.eventCategories),
  ) as AthenaEventCategory[];
  const optional =
    Boolean(effectNode.metadata.optional) ||
    Boolean(effectNode.metadata.may) ||
    Boolean(sourceObject?.oracleText?.toLowerCase().includes("may"));
  return eventCategories.map((eventCategory) => ({
    id: `athena-trigger-condition:${stripNodePrefix(effectNode.id, "athena-node:effect:")}:${eventCategory}`,
    eventCategory,
    description: `${effectNode.label} becomes relevant when ${eventCategory} is reported.`,
    optional,
    metadata: {
      sourceGroupId: effectNode.groupId,
      effectKind: effectNode.effectKind,
    },
  }));
}

function generatedEventsForRelationship(
  category: AthenaEffectRelationshipCategory,
  relationships: AthenaGraphRelationship[],
  graph: AthenaDependencyGraph,
  effectNode: AthenaGraphNode,
  sourceObject: AthenaBattlefieldObject | null,
): AthenaGeneratedEventDescriptor[] {
  const generated = new Map<string, AthenaGeneratedEventDescriptor>();
  const sourceRelationshipId = mappedSourceKey(effectNode, category);
  for (const relationship of relationships) {
    if (relationship.type === "creates") {
      addGeneratedEvent(generated, {
        category: "token-created",
        sourceRelationshipId,
        label: `${effectNode.label} may create a token event.`,
        optional: isOptionalSource(effectNode, sourceObject),
        requiresChoice: relationship.requiresManualResolution,
      });
      addGeneratedEvent(generated, {
        category: "token-entered",
        sourceRelationshipId,
        label: `${effectNode.label} may create a token-entered event.`,
        optional: isOptionalSource(effectNode, sourceObject),
        requiresChoice: relationship.requiresManualResolution,
      });
      const tokenNode = graph.nodes.find((node) => node.id === relationship.to);
      if (
        typeof tokenNode?.metadata.cardTypes === "string" &&
        tokenNode.metadata.cardTypes.includes("Creature")
      ) {
        addGeneratedEvent(generated, {
          category: "creature-entered",
          sourceRelationshipId,
          label: `${effectNode.label} may create a creature-entered event.`,
          optional: isOptionalSource(effectNode, sourceObject),
          requiresChoice: relationship.requiresManualResolution,
        });
      }
    }
    if (relationship.type === "places-counters-on") {
      addGeneratedEvent(generated, {
        category: "counter-placed",
        sourceRelationshipId,
        label: `${effectNode.label} may create a counter-placement event.`,
        optional: isOptionalSource(effectNode, sourceObject),
        requiresChoice: relationship.requiresManualResolution,
      });
    }
  }

  const helper = stringMetadata(effectNode.metadata.helper);
  if (
    category === "life-modification" ||
    helper === "life-on-creature-entry" ||
    helper === "impact-tremors" ||
    effectNode.metadata.action === "life"
  ) {
    addGeneratedEvent(generated, {
      category: helper === "impact-tremors" ? "life-lost" : "life-gained",
      sourceRelationshipId,
      label: `${effectNode.label} may create a life-change event.`,
      optional: isOptionalSource(effectNode, sourceObject),
      requiresChoice: false,
    });
  }

  return sortGeneratedEvents([...generated.values()]);
}

function addGeneratedEvent(
  generated: Map<string, AthenaGeneratedEventDescriptor>,
  input: Omit<AthenaGeneratedEventDescriptor, "id">,
): void {
  const id = `athena-generated-event:${input.sourceRelationshipId}:${input.category}`;
  generated.set(id, { id, ...input });
}

function affectedObjectSetForRelationship(
  category: AthenaEffectRelationshipCategory,
  relationships: AthenaGraphRelationship[],
  context: AthenaAwarenessContext,
  sourceObject: AthenaBattlefieldObject | null,
): AthenaEffectTargetSetDescriptor {
  const targetGroupIds = uniqueStrings(
    relationships.flatMap((relationship) => relationship.targetGroupIds),
  );
  const targets = targetGroupIds
    .map((groupId) =>
      context.battlefield.find((object) => object.groupId === groupId),
    )
    .filter((object): object is AthenaBattlefieldObject => Boolean(object));
  const relevantTotals = uniqueStrings(
    relationships.flatMap((relationship) => relationship.relevantTotals),
  ) as RelevantTotalKey[];
  const zones = uniqueStrings(targets.map((target) => target.zone)) as Zone[];
  const sourceOnly =
    Boolean(sourceObject) &&
    targetGroupIds.length === 1 &&
    targetGroupIds[0] === sourceObject?.groupId;
  const kind = targetSetKind({
    category,
    targets,
    sourceOnly,
    relevantTotals,
  });
  return {
    kind,
    label: targetSetLabel(kind, targets, relevantTotals),
    groupIds: targetGroupIds,
    objectIds: uniqueStrings(
      relationships.flatMap((relationship) => relationship.targetObjectIds),
    ),
    relevantTotals,
    zones,
    subtype: commonSubtype(targets),
    includesSource: sourceOnly,
    requiresChoice: relationships.some(
      (relationship) =>
        relationship.type === "requires-choice" ||
        relationship.requiresManualResolution,
    ),
  };
}

function choiceRequirementsForRelationship(
  category: AthenaEffectRelationshipCategory,
  relationships: AthenaGraphRelationship[],
  observedEvents: AthenaTriggerConditionDescriptor[],
  sourceObject: AthenaBattlefieldObject | null,
): AthenaEffectChoiceRequirementDescriptor[] {
  const choices: AthenaEffectChoiceRequirementDescriptor[] = [];
  for (const relationship of relationships) {
    if (relationship.requiresAuthority) {
      choices.push(
        choiceRequirement({
          kind: "authority",
          relationship,
          prompt: `${sourceObject?.label ?? "This effect"} requires BoardState authority or manual resolution.`,
        }),
      );
    }
    if (
      relationship.requiresManualResolution ||
      relationship.type === "requires-choice"
    ) {
      choices.push(
        choiceRequirement({
          kind: choiceKindForRelationship(category, relationship),
          relationship,
          prompt: choicePromptForRelationship(
            category,
            relationship,
            sourceObject,
          ),
        }),
      );
    }
  }
  if (sourceObject?.oracleText?.toLowerCase().includes("may")) {
    choices.push({
      id: `athena-choice:optional:${sourceObject.groupId}:${category}`,
      kind: "optional-decision",
      prompt: `${sourceObject.label} has an optional effect decision.`,
      sourceGroupId: sourceObject.groupId,
      candidateGroupIds: [],
      relevantTotals: [],
      eventCategories: observedEvents.map((event) => event.eventCategory),
      requiredBeforeCommit: true,
    });
  }
  return uniqueChoices(choices);
}

function choiceRequirement(input: {
  kind: AthenaEffectChoiceRequirementKind;
  relationship: AthenaGraphRelationship;
  prompt: string;
}): AthenaEffectChoiceRequirementDescriptor {
  return {
    id: `athena-choice:${input.kind}:${input.relationship.id}`,
    kind: input.kind,
    prompt: input.prompt,
    sourceGroupId: input.relationship.sourceGroupId,
    candidateGroupIds: input.relationship.targetGroupIds,
    relevantTotals: input.relationship.relevantTotals,
    eventCategories: input.relationship.eventCategories,
    requiredBeforeCommit: true,
  };
}

function relationshipState(input: {
  category: AthenaEffectRelationshipCategory;
  enabled: boolean;
  disabledReason: string | null;
  support: string | null;
  supportStatus: string | null;
  requiresAuthority: boolean;
  requiresManualResolution: boolean;
}): AthenaEffectRelationshipState {
  if (input.disabledReason === "not-tracked") return "tracking-disabled";
  if (input.disabledReason === "depowered") return "depowered";
  if (input.support === "unsupported-effect") return "unsupported";
  if (input.requiresAuthority) return "authority-required";
  if (input.requiresManualResolution) return "awaiting-manual-resolution";
  if (input.supportStatus === "partially-automated") {
    return "partially-supported";
  }
  if (input.disabledReason === "zone-not-battlefield") {
    return "temporarily-inactive";
  }
  if (!input.enabled) return "disabled";
  return "enabled";
}

function buildIndexes(
  relationships: AthenaMappedEffectRelationship[],
): AthenaEffectRelationshipIndexes {
  const relationshipIdsByCategory = Object.fromEntries(
    EFFECT_RELATIONSHIP_CATEGORIES.map((category) => [
      category,
      [] as string[],
    ]),
  ) as Record<AthenaEffectRelationshipCategory, string[]>;
  const indexes: AthenaEffectRelationshipIndexes = {
    relationshipIdsByCategory,
    relationshipsBySourceGroupId: {},
    relationshipsByAffectedGroupId: {},
    triggersByEvent: {},
    replacementsByEvent: {},
    staticReadersByTotal: {},
    followUpEventsByEvent: {},
    disabledRelationshipIds: [],
    unsupportedRelationshipIds: [],
    authorityRequiredRelationshipIds: [],
    choiceRequiredRelationshipIds: [],
  };

  for (const relationship of relationships) {
    pushIndex(
      indexes.relationshipIdsByCategory,
      relationship.category,
      relationship.id,
    );
    if (relationship.source.battlefieldObjectGroupId) {
      pushIndex(
        indexes.relationshipsBySourceGroupId,
        relationship.source.battlefieldObjectGroupId,
        relationship.id,
      );
    }
    for (const groupId of relationship.targetGroupIds) {
      pushIndex(
        indexes.relationshipsByAffectedGroupId,
        groupId,
        relationship.id,
      );
    }
    if (
      relationship.category === "triggered-ability" ||
      relationship.category === "background-watcher" ||
      relationship.category === "custom-supported-automation"
    ) {
      for (const event of relationship.observedEvents) {
        pushIndex(
          indexes.triggersByEvent,
          event.eventCategory,
          relationship.id,
        );
      }
    }
    if (relationship.category === "replacement-effect") {
      for (const event of relationship.observedEvents) {
        pushIndex(
          indexes.replacementsByEvent,
          event.eventCategory,
          relationship.id,
        );
      }
    }
    if (
      relationship.category === "static-effect" ||
      relationship.category === "relevant-total-reader" ||
      relationship.category === "scaling-effect" ||
      relationship.category === "continuous-effect" ||
      relationship.category === "characteristic-defining-effect"
    ) {
      for (const total of relationship.relevantTotals) {
        pushIndex(indexes.staticReadersByTotal, total, relationship.id);
      }
    }
    for (const event of relationship.observedEvents) {
      if (relationship.generatedEvents.length > 0) {
        pushIndex(
          indexes.followUpEventsByEvent,
          event.eventCategory,
          relationship.id,
        );
      }
    }
    if (!relationship.enabled || relationship.state !== "enabled") {
      indexes.disabledRelationshipIds.push(relationship.id);
    }
    if (relationship.support === "unsupported-effect") {
      indexes.unsupportedRelationshipIds.push(relationship.id);
    }
    if (relationship.requiresAuthority) {
      indexes.authorityRequiredRelationshipIds.push(relationship.id);
    }
    if (relationship.requiredChoices.length > 0) {
      indexes.choiceRequiredRelationshipIds.push(relationship.id);
    }
  }

  sortIndex(indexes.relationshipIdsByCategory);
  sortIndex(indexes.relationshipsBySourceGroupId);
  sortIndex(indexes.relationshipsByAffectedGroupId);
  sortIndex(indexes.triggersByEvent);
  sortIndex(indexes.replacementsByEvent);
  sortIndex(indexes.staticReadersByTotal);
  sortIndex(indexes.followUpEventsByEvent);
  indexes.disabledRelationshipIds = uniqueStrings(
    indexes.disabledRelationshipIds,
  );
  indexes.unsupportedRelationshipIds = uniqueStrings(
    indexes.unsupportedRelationshipIds,
  );
  indexes.authorityRequiredRelationshipIds = uniqueStrings(
    indexes.authorityRequiredRelationshipIds,
  );
  indexes.choiceRequiredRelationshipIds = uniqueStrings(
    indexes.choiceRequiredRelationshipIds,
  );
  return indexes;
}

function createDiagnostics(input: {
  relationships: AthenaMappedEffectRelationship[];
  fullRebuildDurationMs: number;
  incrementalUpdateDurationMs: number;
  relationshipRebuildReason: string;
  lastMapperError: string | null;
}): AthenaEffectRelationshipDiagnostics {
  const staticCategories: AthenaEffectRelationshipCategory[] = [
    "static-effect",
    "continuous-effect",
    "scaling-effect",
    "characteristic-defining-effect",
    "relevant-total-reader",
  ];
  return {
    mapperVersion: ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION,
    relationshipCount: input.relationships.length,
    triggerCount: input.relationships.filter(
      (relationship) => relationship.category === "triggered-ability",
    ).length,
    replacementCount: input.relationships.filter(
      (relationship) => relationship.category === "replacement-effect",
    ).length,
    staticCount: input.relationships.filter((relationship) =>
      staticCategories.includes(relationship.category),
    ).length,
    disabledRelationshipCount: input.relationships.filter(
      (relationship) => relationship.state !== "enabled",
    ).length,
    unsupportedRelationshipCount: input.relationships.filter(
      (relationship) => relationship.support === "unsupported-effect",
    ).length,
    authorityRequiredRelationshipCount: input.relationships.filter(
      (relationship) => relationship.requiresAuthority,
    ).length,
    generatedEventRelationshipCount: input.relationships.filter(
      (relationship) => relationship.generatedEvents.length > 0,
    ).length,
    averageRebuildDurationMs: input.fullRebuildDurationMs,
    fullRebuildDurationMs: input.fullRebuildDurationMs,
    incrementalUpdateDurationMs: input.incrementalUpdateDurationMs,
    relationshipRebuildReason: input.relationshipRebuildReason,
    lastMapperError: input.lastMapperError,
    productionVisible: false,
    directBattlefieldMutation: false,
  };
}

function isLifeEffect(
  effectNode: AthenaGraphNode,
  relationships: AthenaGraphRelationship[],
): boolean {
  return (
    effectNode.metadata.helper === "life-on-creature-entry" ||
    effectNode.metadata.helper === "impact-tremors" ||
    effectNode.metadata.action === "life" ||
    relationships.some(
      (relationship) =>
        relationship.eventCategories.includes("life-gained") ||
        relationship.eventCategories.includes("life-lost"),
    )
  );
}

function isOptionalSource(
  effectNode: AthenaGraphNode,
  sourceObject: AthenaBattlefieldObject | null,
): boolean {
  return (
    Boolean(effectNode.metadata.optional) ||
    Boolean(effectNode.metadata.may) ||
    Boolean(sourceObject?.oracleText?.toLowerCase().includes("may"))
  );
}

function targetSetKind(input: {
  category: AthenaEffectRelationshipCategory;
  targets: AthenaBattlefieldObject[];
  sourceOnly: boolean;
  relevantTotals: RelevantTotalKey[];
}): AthenaEffectTargetSetKind {
  if (input.sourceOnly) return "this-object";
  if (input.category === "life-modification") return "player";
  if (input.category === "replacement-effect") return "all-battlefield";
  if (input.category === "token-creation") return "token-groups";
  if (input.relevantTotals.length > 0 && input.targets.length === 0) {
    return "relevant-total";
  }
  if (input.targets.length === 0) return "none";
  if (input.targets.every((target) => target.isCreature)) {
    return "controlled-creatures";
  }
  if (input.targets.every((target) => target.isToken)) return "tokens";
  if (input.targets.every((target) => target.subtypes.includes("Equipment"))) {
    return "equipment";
  }
  if (input.targets.every((target) => target.cardTypes.includes("Artifact"))) {
    return "artifacts";
  }
  return "all-battlefield";
}

function targetSetLabel(
  kind: AthenaEffectTargetSetKind,
  targets: AthenaBattlefieldObject[],
  relevantTotals: RelevantTotalKey[],
): string {
  if (targets.length > 0) {
    return targets.length === 1
      ? targets[0].label
      : `${targets.length} battlefield object(s)`;
  }
  if (relevantTotals.length > 0) return relevantTotals.join(", ");
  return kind;
}

function commonSubtype(targets: AthenaBattlefieldObject[]): string | null {
  if (targets.length === 0) return null;
  const common = targets[0].subtypes.find((subtype) =>
    targets.every((target) => target.subtypes.includes(subtype)),
  );
  return common ?? null;
}

function choiceKindForRelationship(
  category: AthenaEffectRelationshipCategory,
  relationship: AthenaGraphRelationship,
): AthenaEffectChoiceRequirementKind {
  if (relationship.requiresAuthority) return "authority";
  if (
    category === "counter-placement" ||
    relationship.type === "affects" ||
    relationship.type === "requires-choice" ||
    relationship.metadata.action === "add-counters"
  ) {
    return "target";
  }
  if (relationship.relevantTotals.length > 0) return "quantity";
  return "manual-resolution";
}

function choicePromptForRelationship(
  category: AthenaEffectRelationshipCategory,
  relationship: AthenaGraphRelationship,
  sourceObject: AthenaBattlefieldObject | null,
): string {
  if (relationship.requiresAuthority) {
    return `${sourceObject?.label ?? "This effect"} requires authority before local resolution.`;
  }
  if (category === "counter-placement") return "Choose the counter target.";
  if (relationship.relevantTotals.length > 0)
    return "Confirm the relevant value.";
  return `${sourceObject?.label ?? "This effect"} requires manual resolution.`;
}

function modificationCategoryForEvents(
  eventCategories: AthenaEventCategory[],
): AthenaEffectModificationCategory {
  if (eventCategories.length > 1) return "event-modifier";
  if (eventCategories.includes("token-created")) return "token-multiplier";
  if (eventCategories.includes("counter-placed")) return "counter-multiplier";
  if (eventCategories.includes("permanent-entered")) {
    return "enter-battlefield-replacement";
  }
  return eventCategories.length > 0 ? "event-modifier" : "unknown";
}

function authoritySourceForMappedRelationship(
  relationships: AthenaGraphRelationship[],
  fallback: AthenaAuthoritySource,
): AthenaAuthoritySource {
  if (
    relationships.some(
      (relationship) =>
        relationship.authoritySource === "boardstate-authoritative-result",
    )
  ) {
    return "boardstate-authoritative-result";
  }
  return relationships[0]?.authoritySource ?? fallback;
}

function firstDisabledReason(
  relationships: AthenaGraphRelationship[],
): string | null {
  return (
    relationships.find((relationship) => relationship.disabledReason !== "none")
      ?.disabledReason ?? null
  );
}

function firstDefined<T>(values: Array<T | null | undefined>): T | null {
  return (
    values.find((value): value is T => value !== null && value !== undefined) ??
    null
  );
}

function stringMetadata(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function fallbackEffectNode(
  context: AthenaAwarenessContext,
  object: AthenaBattlefieldObject,
  key: string,
): AthenaGraphNode {
  return {
    id: `athena-node:effect:${object.groupId}:${key}`,
    type: "effect-definition",
    label: object.label,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    groupId: object.groupId,
    objectIds: [...object.objectIds],
    relevantTotal: null,
    zone: object.zone,
    eventCategory: null,
    effectKind: key,
    quantity: object.quantity,
    authoritySource: context.currentAuthoritySource,
    authorityPrecedence: context.authorityPrecedence,
    supportStatus: object.supportStatus,
    support:
      object.sourceUnavailableReason === "unsupported-effect"
        ? "unsupported-effect"
        : "manual-resolution-required",
    enabled: false,
    disabledReason:
      object.sourceUnavailableReason === "unsupported-effect"
        ? "support-boundary"
        : "manual-resolution-required",
    fingerprint: object.groupId,
    metadata: {
      sourceUnavailableReason: object.sourceUnavailableReason ?? "none",
    },
  };
}

function mergeMetadata(
  relationships: AthenaGraphRelationship[],
  effectNode: AthenaGraphNode,
): Record<string, string | number | boolean | null> {
  const metadata: Record<string, string | number | boolean | null> = {
    ...effectNode.metadata,
  };
  for (const relationship of relationships) {
    for (const [key, value] of Object.entries(relationship.metadata)) {
      if (metadata[key] === undefined) metadata[key] = value;
    }
  }
  return metadata;
}

function mappedRelationshipId(input: {
  category: AthenaEffectRelationshipCategory;
  source: AthenaEffectSourceDescriptor;
  observedEvents: AthenaTriggerConditionDescriptor[];
  generatedEventCategories: AthenaEventCategory[];
  relevantTotals: RelevantTotalKey[];
}): string {
  return [
    "athena-effect-rel",
    input.category,
    normalizeIdPart(input.source.definitionIdentifier),
    input.observedEvents.map((event) => event.eventCategory).join(".") ||
      "no-event",
    input.generatedEventCategories.join(".") || "no-generated",
    input.relevantTotals.join(".") || "no-total",
  ].join(":");
}

function mappedSourceKey(
  effectNode: AthenaGraphNode,
  category: AthenaEffectRelationshipCategory,
): string {
  return `${category}:${stripNodePrefix(effectNode.id, "athena-node:effect:")}`;
}

function stripNodePrefix(value: string, prefix: string): string {
  return value.startsWith(prefix) ? value.slice(prefix.length) : value;
}

function pushIndex(
  index: Record<string, string[]>,
  key: string,
  value: string,
): void {
  const entries = index[key] ?? [];
  if (!entries.includes(value)) entries.push(value);
  index[key] = entries;
}

function sortIndex(index: Record<string, string[]>): void {
  for (const [key, value] of Object.entries(index)) {
    index[key] = uniqueStrings(value);
  }
}

function relationshipById(
  relationshipMap: AthenaEffectRelationshipMap,
  id: string,
): AthenaMappedEffectRelationship | null {
  return (
    relationshipMap.relationships.find(
      (relationship) => relationship.id === id,
    ) ?? null
  );
}

function relationshipsFromIndex(
  relationshipMap: AthenaEffectRelationshipMap,
  ids: string[] | undefined,
): AthenaMappedEffectRelationship[] {
  if (!ids) return [];
  return ids
    .map((id) => relationshipById(relationshipMap, id))
    .filter((relationship): relationship is AthenaMappedEffectRelationship =>
      Boolean(relationship),
    );
}

function eventCategoriesForIntent(
  kind: AmbientIntentKind,
): AthenaEventCategory[] {
  switch (kind) {
    case "play-land":
      return ["land-entered", "permanent-entered"];
    case "create-token":
      return ["token-created", "token-entered", "creature-entered"];
    case "add-counters":
      return ["counter-placed"];
    case "remove-counters":
      return ["counter-removed"];
    case "modify-life":
      return ["life-gained", "life-lost"];
    case "modify-commander-damage":
      return ["damage-dealt", "combat-damage"];
    case "attack":
      return ["attack-declared"];
    case "tap":
      return ["permanent-tapped"];
    case "untap":
      return ["permanent-untapped"];
    case "cast-spell":
      return ["spell-cast"];
    case "destroy-permanent":
      return ["permanent-died"];
    case "sacrifice-permanent":
      return ["permanent-sacrificed"];
    case "exile-permanent":
      return ["permanent-exiled"];
    case "return-permanent":
      return ["permanent-returned-to-battlefield"];
    case "transform-permanent":
      return ["permanent-transformed"];
    default:
      return [];
  }
}

function sortMappedRelationships(
  relationships: AthenaMappedEffectRelationship[],
): AthenaMappedEffectRelationship[] {
  return relationships.sort((a, b) => a.id.localeCompare(b.id));
}

function sortGeneratedEvents(
  events: AthenaGeneratedEventDescriptor[],
): AthenaGeneratedEventDescriptor[] {
  return events.sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueMappedRelationships(
  relationships: AthenaMappedEffectRelationship[],
): AthenaMappedEffectRelationship[] {
  const byId = new Map<string, AthenaMappedEffectRelationship>();
  for (const relationship of relationships)
    byId.set(relationship.id, relationship);
  return sortMappedRelationships([...byId.values()]);
}

function uniqueChoices(
  choices: AthenaEffectChoiceRequirementDescriptor[],
): AthenaEffectChoiceRequirementDescriptor[] {
  const byId = new Map<string, AthenaEffectChoiceRequirementDescriptor>();
  for (const choice of choices) byId.set(choice.id, choice);
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function uniqueStrings<T extends string>(values: T[]): T[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function normalizeIdPart(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9:+/.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
}

function fingerprintMapperInput(
  context: AthenaAwarenessContext,
  graph: AthenaDependencyGraph,
  relationships: AthenaMappedEffectRelationship[],
): string {
  return serializeStable({
    version: ATHENA_EFFECT_RELATIONSHIP_MAPPER_VERSION,
    fieldId: context.fieldId,
    sessionId: context.sessionId,
    graphFingerprint: graph.fingerprint,
    relationships: relationships.map((relationship) => ({
      id: relationship.id,
      state: relationship.state,
      observedEvents: relationship.observedEvents.map(
        (event) => event.eventCategory,
      ),
      generatedEventCategories: relationship.generatedEventCategories,
      targetGroupIds: relationship.targetGroupIds,
      graphRelationshipIds: relationship.graphRelationshipIds,
    })),
  });
}

function mapperIdentity(relationshipMap: AthenaEffectRelationshipMap): string {
  return serializeStable({
    relationships: relationshipMap.relationships.map((relationship) => ({
      id: relationship.id,
      state: relationship.state,
      authoritySource: relationship.authoritySource,
      support: relationship.support,
      graphRelationshipIds: relationship.graphRelationshipIds,
      generatedEventCategories: relationship.generatedEventCategories,
      relevantTotals: relationship.relevantTotals,
    })),
  });
}

function performanceNow(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
